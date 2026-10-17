//! Runs the shared case table (`contracts/fixtures/cases.json`, generated from packages/core)
//! against the Soroban contract. The Foundry runner reads the same file (A-3).
extern crate std;

use std::{format, string::String, string::ToString, vec::Vec as StdVec};

use serde::Deserialize;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events as _, IssuerFlags, Ledger as _, MockAuth, MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    xdr::ScErrorType,
    Address, Env, Event as _, IntoVal, Symbol, TryFromVal, Val, Vec,
};

use crate::{
    Commitment, CommitmentClient, Committed, DataKey, Error, Position, ReleasedStale, Settled,
    State, TTL_EXTEND_TO, TTL_THRESHOLD,
};

const FIXTURE: &str = include_str!("../../../fixtures/cases.json");
const DECIMALS: i128 = 10_000_000;
const STARTING_BALANCE: i128 = 1_000 * DECIMALS;

#[derive(Deserialize)]
struct Fixture {
    cases: StdVec<Case>,
    config: FixtureConfig,
    constructor_cases: StdVec<ConstructorCase>,
    contract_errors: StdVec<ContractError>,
}

#[derive(Deserialize)]
struct FixtureConfig {
    grace: String,
    max_amount_usdc: String,
    max_goal_m: String,
    min_amount_usdc: String,
    min_goal_m: String,
    stale_after: String,
    week_anchor: String,
    week_len: String,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    steps: StdVec<Step>,
}

#[derive(Deserialize)]
struct Step {
    action: String,
    actor: String,
    amount: String,
    error: String,
    forfeited: String,
    goal_m: String,
    met: String,
    owner: String,
    owner_balance: String,
    result: String,
    state: String,
    time: String,
    week_id: String,
}

#[derive(Deserialize)]
struct ConstructorCase {
    error: String,
    grace: String,
    max_amount_usdc: String,
    max_goal_m: String,
    min_amount_usdc: String,
    min_goal_m: String,
    name: String,
    stale_after: String,
    week_anchor: String,
    week_len: String,
}

#[derive(Deserialize)]
struct ContractError {
    code: String,
    name: String,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE).expect("contracts/fixtures/cases.json parses")
}

fn num<T: core::str::FromStr>(value: &str) -> T
where
    T::Err: core::fmt::Debug,
{
    value.parse().expect("a decimal string")
}

const ALL_ERRORS: [Error; 11] = [
    Error::BeforeAnchor,
    Error::InvalidConfig,
    Error::AlreadyCommitted,
    Error::PositionNotFound,
    Error::PositionNotActive,
    Error::WrongWeek,
    Error::OutsideSettleWindow,
    Error::NotStaleYet,
    Error::AmountOutOfRange,
    Error::GoalOutOfRange,
    Error::BalanceMismatch,
];

fn error_name(error: Error) -> String {
    format!("{error:?}")
}

fn state_name(state: State) -> String {
    format!("{state:?}")
}

/// The Stellar Asset Contract numbers its own errors 1 to 13 (`ContractError` in
/// soroban-env-host); ours start at 101 (A-12).
const SAC_ERROR_CODES: core::ops::RangeInclusive<u32> = 1..=13;

/// Names a failure by its host error (spec 4.3). Our contract errors by name; another
/// contract's error in the SAC's range is `TokenFailure`.
///
/// A missing `require_auth` signature reaches the caller as `Error(Context, InvalidAction)`,
/// the same error a Rust panic produces, so the type alone cannot tell them apart. It counts as
/// `Unauthorized` only when the step really left the required signer out; with the signer
/// present it is `Unexpected` and fails the case. A panic that fired regardless of the signer
/// would also break every case where the signer did sign.
fn classify(error: soroban_sdk::Error, signer_missing: bool) -> String {
    if error.is_type(ScErrorType::Contract) {
        let code = error.get_code();
        if let Some(own) = ALL_ERRORS.iter().find(|own| **own as u32 == code) {
            return error_name(*own);
        }
        if SAC_ERROR_CODES.contains(&code) {
            return "TokenFailure".to_string();
        }
    } else if signer_missing
        && (error.is_type(ScErrorType::Auth) || error.is_type(ScErrorType::Context))
    {
        return "Unauthorized".to_string();
    }
    format!("Unexpected({error:?})")
}

/// The text of a caught panic, to check which error a failed constructor raised.
fn panic_message(payload: &(dyn core::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    payload
        .downcast_ref::<&str>()
        .map(|message| message.to_string())
        .unwrap_or_default()
}

struct World<'a> {
    env: Env,
    user: Address,
    stranger: Address,
    oracle: Address,
    token: TokenClient<'a>,
    admin: StellarAssetClient<'a>,
    contract: CommitmentClient<'a>,
    min_amount: i128,
    max_amount: i128,
    touched: StdVec<(Address, u64)>,
}

impl World<'_> {
    fn new(config: &FixtureConfig) -> Self {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(issuer);
        // Lets the issuer deauthorize a trustline, which is how the table blocks an owner.
        sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let token = TokenClient::new(&env, &sac.address());
        let admin = StellarAssetClient::new(&env, &sac.address());
        let user = Address::generate(&env);
        let stranger = Address::generate(&env);
        let oracle = Address::generate(&env);
        let min_amount = num::<i128>(&config.min_amount_usdc) * DECIMALS;
        let max_amount = num::<i128>(&config.max_amount_usdc) * DECIMALS;

        let contract_id = env.register(
            Commitment,
            (
                sac.address(),
                oracle.clone(),
                min_amount,
                max_amount,
                num::<u64>(&config.min_goal_m),
                num::<u64>(&config.max_goal_m),
                num::<u64>(&config.week_anchor),
                num::<u64>(&config.week_len),
                num::<u64>(&config.grace),
                num::<u64>(&config.stale_after),
            ),
        );
        let contract = CommitmentClient::new(&env, &contract_id);

        env.mock_all_auths();
        admin.mint(&user, &STARTING_BALANCE);
        admin.mint(&stranger, &STARTING_BALANCE);

        World {
            env,
            user,
            stranger,
            oracle,
            token,
            admin,
            contract,
            min_amount,
            max_amount,
            touched: StdVec::new(),
        }
    }

    fn actor(&self, name: &str) -> Address {
        match name {
            "user" => self.user.clone(),
            "stranger" => self.stranger.clone(),
            "oracle" => self.oracle.clone(),
            other => panic!("unknown actor {other}"),
        }
    }

    fn amount(&self, reference: &str) -> i128 {
        match reference {
            "min" => self.min_amount,
            "max" => self.max_amount,
            "mid" => (self.min_amount + self.max_amount) / 2,
            "below_min" => self.min_amount - 1,
            "above_max" => self.max_amount + 1,
            "zero" => 0,
            other => panic!("unknown amount {other}"),
        }
    }

    /// Calls the contract and returns its value, or the failure named by [`classify`]. Goes
    /// through `try_invoke_contract` so the host error keeps its type (`Auth`, `Contract`, ...).
    fn invoke<T: TryFromVal<Env, Val>>(
        &self,
        func: &str,
        args: Vec<Val>,
        signer_missing: bool,
    ) -> Result<T, String> {
        match self.env.try_invoke_contract::<T, soroban_sdk::Error>(
            &self.contract.address,
            &Symbol::new(&self.env, func),
            args,
        ) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err("Unexpected(return value)".to_string()),
            Err(Ok(error)) => Err(classify(error, signer_missing)),
            Err(Err(invoke)) => Err(format!("Unexpected({invoke:?})")),
        }
    }

    /// Only `actor` signs: a call that needs someone else's signature fails like on the network.
    fn sign_as(&self, actor: &Address, invoke: &MockAuthInvoke) {
        self.env.mock_auths(&[MockAuth {
            address: actor,
            invoke,
        }]);
    }

    fn run(&mut self, label: &str, step: &Step) {
        let owner = self.actor(&step.owner);
        let actor = self.actor(&step.actor);
        let week_id: u64 = num(&step.week_id);
        self.env.ledger().set_timestamp(num(&step.time));
        let owner_before = self.token.balance(&owner);
        let contract_before = self.token.balance(&self.contract.address);
        let forfeited_before = self.contract.total_forfeited();

        let contract_id = self.contract.address.clone();
        let token_id = self.token.address.clone();
        let mut result = String::new();
        let failure = match step.action.as_str() {
            "commit" => {
                self.touched.push((owner.clone(), week_id));
                let amount = self.amount(&step.amount);
                let goal: u64 = num(&step.goal_m);
                let transfer = [MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: (owner.clone(), contract_id.clone(), amount).into_val(&self.env),
                    sub_invokes: &[],
                }];
                self.sign_as(
                    &actor,
                    &MockAuthInvoke {
                        contract: &contract_id,
                        fn_name: "commit",
                        args: (owner.clone(), week_id, amount, goal).into_val(&self.env),
                        sub_invokes: &transfer,
                    },
                );
                let args = (owner.clone(), week_id, amount, goal).into_val(&self.env);
                self.invoke::<()>("commit", args, actor != owner).err()
            }
            "settle" => {
                self.touched.push((owner.clone(), week_id));
                let met = step.met == "true";
                self.sign_as(
                    &actor,
                    &MockAuthInvoke {
                        contract: &contract_id,
                        fn_name: "settle",
                        args: (owner.clone(), week_id, met).into_val(&self.env),
                        sub_invokes: &[],
                    },
                );
                let args = (owner.clone(), week_id, met).into_val(&self.env);
                self.invoke::<()>("settle", args, actor != self.oracle)
                    .err()
            }
            "release_if_stale" => {
                self.touched.push((owner.clone(), week_id));
                // Needs nobody's signature: whoever calls it, the money goes to the owner.
                self.env.mock_auths(&[]);
                let args = (owner.clone(), week_id).into_val(&self.env);
                self.invoke::<()>("release_if_stale", args, false).err()
            }
            "current_week" => {
                match self.invoke::<u64>("current_week", Vec::new(&self.env), false) {
                    Ok(week) => {
                        result = week.to_string();
                        None
                    }
                    Err(failure) => Some(failure),
                }
            }
            "block" | "unblock" => {
                self.env.mock_all_auths();
                self.admin
                    .set_authorized(&owner, &(step.action.as_str() == "unblock"));
                None
            }
            other => panic!("{label}: unknown action {other}"),
        };

        assert_eq!(failure.unwrap_or_default(), step.error, "{label}: error");
        assert_eq!(result, step.result, "{label}: result");

        let position = self.contract.get_position(&owner, &week_id);
        assert_eq!(state_name(position.state), step.state, "{label}: state");

        let owner_after = self.token.balance(&owner);
        let expected_owner = match step.owner_balance.as_str() {
            "credited" => owner_before + position.amount,
            "debited" => owner_before - position.amount,
            _ => owner_before,
        };
        assert_eq!(owner_after, expected_owner, "{label}: owner balance");

        let expected_forfeited = if step.forfeited == "increased" {
            position.amount
        } else {
            0
        };
        assert_eq!(
            self.contract.total_forfeited() - forfeited_before,
            expected_forfeited,
            "{label}: forfeited"
        );

        // A successful commit stores exactly what was asked, and the contract receives exactly it.
        if step.action == "commit" && step.error.is_empty() {
            let asked = self.amount(&step.amount);
            assert_eq!(position.amount, asked, "{label}: stored amount");
            assert_eq!(
                position.goal_m,
                num::<u64>(&step.goal_m),
                "{label}: stored goal"
            );
            assert_eq!(
                self.token.balance(&self.contract.address),
                contract_before + asked,
                "{label}: received"
            );
        }

        self.assert_balance_invariant(label);
    }

    /// balance(contract) = Σ Active amounts + total_forfeited, after every step.
    fn assert_balance_invariant(&self, label: &str) {
        let mut seen: StdVec<(Address, u64)> = StdVec::new();
        let mut active = 0i128;
        for (owner, week_id) in &self.touched {
            if seen.contains(&(owner.clone(), *week_id)) {
                continue;
            }
            seen.push((owner.clone(), *week_id));
            let position = self.contract.get_position(owner, week_id);
            if position.state == State::Active {
                active += position.amount;
            }
        }
        assert_eq!(
            self.token.balance(&self.contract.address),
            active + self.contract.total_forfeited(),
            "{label}: balance invariant"
        );
    }
}

#[test]
fn the_contract_errors_carry_the_numbers_of_the_case_table() {
    let fixture = fixture();
    assert_eq!(fixture.contract_errors.len(), ALL_ERRORS.len());
    for expected in &fixture.contract_errors {
        let error = ALL_ERRORS
            .iter()
            .find(|error| error_name(**error) == expected.name)
            .unwrap_or_else(|| panic!("no contract error named {}", expected.name));
        assert_eq!(
            *error as u32,
            num::<u32>(&expected.code),
            "{}",
            expected.name
        );
    }
}

#[test]
fn the_shared_case_table_holds() {
    let fixture = fixture();
    assert!(!fixture.cases.is_empty());
    for case in &fixture.cases {
        let mut world = World::new(&fixture.config);
        for (index, step) in case.steps.iter().enumerate() {
            world.run(&format!("{} step {index}", case.name), step);
        }
    }
}

#[test]
fn the_constructor_cases_hold() {
    let fixture = fixture();
    assert!(!fixture.constructor_cases.is_empty());
    for case in &fixture.constructor_cases {
        let env = Env::default();
        let token = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        let oracle = Address::generate(&env);
        let args = (
            token,
            oracle,
            num::<i128>(&case.min_amount_usdc) * DECIMALS,
            num::<i128>(&case.max_amount_usdc) * DECIMALS,
            num::<u64>(&case.min_goal_m),
            num::<u64>(&case.max_goal_m),
            num::<u64>(&case.week_anchor),
            num::<u64>(&case.week_len),
            num::<u64>(&case.grace),
            num::<u64>(&case.stale_after),
        );
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(Commitment, args);
        }));
        // Only the contract's own InvalidConfig counts: any other panic fails the case.
        let failure = match outcome {
            Ok(()) => String::new(),
            Err(payload) if panic_message(payload.as_ref()).contains("Error(Contract, #102)") => {
                "InvalidConfig".to_string()
            }
            Err(payload) => format!("Unexpected({})", panic_message(payload.as_ref())),
        };
        assert_eq!(failure, case.error, "{}", case.name);
    }
}

// --- Soroban-only properties ----------------------------------------------------------------

/// Network values read from stellar-testnet with getLedgerEntries on 2026-10-16.
const NETWORK_MAX_ENTRY_TTL: u32 = 3_110_400;
const NETWORK_MIN_PERSISTENT_TTL: u32 = 120_960;
const SECONDS_PER_LEDGER: u64 = 5;

fn production_world() -> World<'static> {
    let world = World::new(&fixture().config);
    world.env.ledger().with_mut(|ledger| {
        ledger.max_entry_ttl = NETWORK_MAX_ENTRY_TTL;
        ledger.min_persistent_entry_ttl = NETWORK_MIN_PERSISTENT_TTL;
        ledger.sequence_number = 1_000;
    });
    world
}

/// Moves the ledger clock and the sequence number together, at the network's close time.
fn advance_to(env: &Env, timestamp: u64) {
    env.ledger().with_mut(|ledger| {
        let ledgers = (timestamp - ledger.timestamp) / SECONDS_PER_LEDGER;
        ledger.timestamp = timestamp;
        ledger.sequence_number += u32::try_from(ledgers).expect("fits in u32");
    });
}

// The TTL constants stay inside the network limits, checked at compile time. At least 30 days
// at 5-second ledgers (spec 4.2).
const _: () = {
    assert!(TTL_THRESHOLD < TTL_EXTEND_TO);
    assert!(TTL_EXTEND_TO <= NETWORK_MAX_ENTRY_TTL);
    assert!(TTL_THRESHOLD >= NETWORK_MIN_PERSISTENT_TTL);
    assert!(TTL_THRESHOLD as u64 * SECONDS_PER_LEDGER >= 30 * 86_400);
};

#[test]
fn a_commit_keeps_the_position_alive_until_its_release_window() {
    let world = production_world();
    let env = &world.env;
    let config = world.contract.config();
    let at = |week: u64, offset: u64| config.week_anchor + week * config.week_len + offset;
    env.ledger().set_timestamp(at(0, 10));

    env.mock_all_auths();
    world
        .contract
        .commit(&world.user, &1, &world.min_amount, &config.min_goal_m);

    let key = DataKey::Position(world.user.clone(), 1);
    let (position_ttl, instance_ttl) = env.as_contract(&world.contract.address, || {
        (
            env.storage().persistent().get_ttl(&key),
            env.storage().instance().get_ttl(),
        )
    });
    assert_eq!(position_ttl, TTL_EXTEND_TO);
    // The constructor extended the instance a few ledgers earlier; it stays above the threshold.
    assert!(instance_ttl >= TTL_THRESHOLD);

    // The release window opens 21 days later; the position is still live and readable.
    let release_opens = at(2, 0) + config.stale_after;
    advance_to(env, release_opens);
    let position: Position = world.contract.get_position(&world.user, &1);
    assert_eq!(position.state, State::Active);
    assert_eq!(position.amount, world.min_amount);

    world.contract.release_if_stale(&world.user, &1);
    assert_eq!(
        world.contract.get_position(&world.user, &1).state,
        State::ReleasedStale
    );
    assert_eq!(world.token.balance(&world.user), STARTING_BALANCE);
}

#[test]
fn a_deauthorized_trustline_blocks_the_refund_and_keeps_the_position_active() {
    let world = production_world();
    let env = &world.env;
    let config = world.contract.config();
    let week_end = config.week_anchor + 2 * config.week_len;
    env.ledger().set_timestamp(config.week_anchor + 10);
    env.mock_all_auths();
    world
        .contract
        .commit(&world.user, &1, &world.max_amount, &config.min_goal_m);

    world.admin.set_authorized(&world.user, &false);
    env.ledger().set_timestamp(week_end + config.grace);
    assert!(world.contract.try_settle(&world.user, &1, &true).is_err());
    assert_eq!(
        world.contract.get_position(&world.user, &1).state,
        State::Active
    );
    assert_eq!(
        world.token.balance(&world.contract.address),
        world.max_amount
    );

    world.admin.set_authorized(&world.user, &true);
    world.contract.settle(&world.user, &1, &true);
    assert_eq!(
        world.contract.get_position(&world.user, &1).state,
        State::Returned
    );
}

#[test]
fn every_move_publishes_its_event() {
    let world = production_world();
    let env = &world.env;
    let config = world.contract.config();
    env.ledger().set_timestamp(config.week_anchor + 10);
    env.mock_all_auths();

    world
        .contract
        .commit(&world.user, &1, &world.min_amount, &config.min_goal_m);
    let committed = Committed {
        user: world.user.clone(),
        week_id: 1,
        amount: world.min_amount,
        goal_m: config.min_goal_m,
    };
    assert!(env
        .events()
        .all()
        .events()
        .contains(&committed.to_xdr(env, &world.contract.address)));

    env.ledger()
        .set_timestamp(config.week_anchor + 2 * config.week_len + config.grace);
    world.contract.settle(&world.user, &1, &false);
    let settled = Settled {
        user: world.user.clone(),
        week_id: 1,
        met: false,
        amount: world.min_amount,
    };
    assert!(env
        .events()
        .all()
        .events()
        .contains(&settled.to_xdr(env, &world.contract.address)));

    world
        .contract
        .commit(&world.user, &3, &world.max_amount, &config.max_goal_m);
    env.ledger()
        .set_timestamp(config.week_anchor + 4 * config.week_len + config.stale_after);
    world.contract.release_if_stale(&world.user, &3);
    let released = ReleasedStale {
        user: world.user.clone(),
        week_id: 3,
        amount: world.max_amount,
    };
    assert!(env
        .events()
        .all()
        .events()
        .contains(&released.to_xdr(env, &world.contract.address)));
}

#[test]
fn config_returns_the_constructor_arguments() {
    let world = production_world();
    let config = world.contract.config();
    let fixture = fixture().config;
    assert_eq!(config.token, world.token.address);
    assert_eq!(config.oracle, world.oracle);
    assert_eq!(config.min_amount, 20 * DECIMALS);
    assert_eq!(config.max_amount, 50 * DECIMALS);
    assert_eq!(config.week_anchor, num::<u64>(&fixture.week_anchor));
    assert_eq!(config.week_len, num::<u64>(&fixture.week_len));
    assert_eq!(config.grace, num::<u64>(&fixture.grace));
    assert_eq!(config.stale_after, num::<u64>(&fixture.stale_after));
}

#[test]
fn an_archived_position_is_restored_on_access_and_still_releases() {
    let world = production_world();
    let env = &world.env;
    let config = world.contract.config();
    env.ledger().set_timestamp(config.week_anchor + 10);
    env.mock_all_auths();
    world
        .contract
        .commit(&world.user, &1, &world.min_amount, &config.min_goal_m);
    let key = DataKey::Position(world.user.clone(), 1);
    let live_until = env.ledger().sequence()
        + env.as_contract(&world.contract.address, || {
            env.storage().persistent().get_ttl(&key)
        });

    // 40 days with no writes: past the 31-day TTL, so the entry is archived.
    advance_to(env, config.week_anchor + 10 + 40 * 86_400);
    assert!(env.ledger().sequence() > live_until);

    // Protocol 23+ restores an archived persistent entry when a call touches it; the test
    // environment of soroban-sdk 29 does the same. On the network, T6 checks it by RPC.
    assert_eq!(
        world.contract.get_position(&world.user, &1).state,
        State::Active
    );
    world.contract.release_if_stale(&world.user, &1);
    assert_eq!(world.token.balance(&world.user), STARTING_BALANCE);
    let ttl = env.as_contract(&world.contract.address, || {
        env.storage().persistent().get_ttl(&key)
    });
    assert_eq!(ttl, TTL_EXTEND_TO);
}
