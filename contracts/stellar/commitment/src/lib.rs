//! AgentHabit commitment contract for Soroban (spec 4.2, P-3).
//!
//! A user locks USDC for next week's running goal. The oracle settles it: met returns the
//! deposit, missed keeps it in this contract forever. If the oracle never settles, anyone can
//! return the deposit to its owner. Same semantics as `contracts/evm/src/Commitment.sol`; both
//! pass the shared case table in `contracts/fixtures/cases.json`.
//!
//! No admin, no withdrawal, no upgrade, no pause: every parameter is fixed in the constructor.
//! Validation order, the same on both chains: week exists, authorization, position state, time
//! window, amount and goal limits, token.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};

/// Ledgers per day at the network's 5-second target close time (stellar-testnet, 2026-10-16).
const LEDGERS_PER_DAY: u32 = 17_280;
/// Every write keeps the position and the instance alive for at least 30 days, and extends them
/// to 31: a position lives at most about 21 days from `commit` to `week_end + stale_after` in
/// production. Far below the network's `max_entry_ttl` of 3,110,400 ledgers.
pub const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
pub const TTL_EXTEND_TO: u32 = 31 * LEDGERS_PER_DAY;

/// Numbered by the case table (`contract_errors` in the fixture): Solidity names the same
/// errors without numbers. They start at 101 so a Stellar Asset Contract error (1 to 13), which
/// propagates through our calls with its own number, never reads as one of ours (A-12).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    BeforeAnchor = 101,
    InvalidConfig = 102,
    AlreadyCommitted = 103,
    PositionNotFound = 104,
    PositionNotActive = 105,
    WrongWeek = 106,
    OutsideSettleWindow = 107,
    NotStaleYet = 108,
    AmountOutOfRange = 109,
    GoalOutOfRange = 110,
    BalanceMismatch = 111,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum State {
    None = 0,
    Active = 1,
    Returned = 2,
    Forfeited = 3,
    ReleasedStale = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub amount: i128,
    pub goal_m: u64,
    pub state: State,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub token: Address,
    pub oracle: Address,
    pub min_amount: i128,
    pub max_amount: i128,
    pub min_goal_m: u64,
    pub max_goal_m: u64,
    pub week_anchor: u64,
    pub week_len: u64,
    pub grace: u64,
    pub stale_after: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    TotalForfeited,
    Position(Address, u64),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Committed {
    #[topic]
    pub user: Address,
    #[topic]
    pub week_id: u64,
    pub amount: i128,
    pub goal_m: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settled {
    #[topic]
    pub user: Address,
    #[topic]
    pub week_id: u64,
    pub met: bool,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleasedStale {
    #[topic]
    pub user: Address,
    #[topic]
    pub week_id: u64,
    pub amount: i128,
}

#[contract]
pub struct Commitment;

#[contractimpl]
impl Commitment {
    /// Fixes every parameter for the life of the contract. Rules: `0 < min_amount ≤ max_amount`,
    /// `0 < min_goal_m ≤ max_goal_m`, `week_len > 0` and `0 < grace < stale_after`.
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        token: Address,
        oracle: Address,
        min_amount: i128,
        max_amount: i128,
        min_goal_m: u64,
        max_goal_m: u64,
        week_anchor: u64,
        week_len: u64,
        grace: u64,
        stale_after: u64,
    ) {
        if min_amount <= 0
            || min_amount > max_amount
            || min_goal_m == 0
            || min_goal_m > max_goal_m
            || week_len == 0
            || grace == 0
            || grace >= stale_after
        {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        let config = Config {
            token,
            oracle,
            min_amount,
            max_amount,
            min_goal_m,
            max_goal_m,
            week_anchor,
            week_len,
            grace,
            stale_after,
        };
        let storage = env.storage().instance();
        storage.set(&DataKey::Config, &config);
        storage.set(&DataKey::TotalForfeited, &0i128);
        storage.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Locks `amount` for `week_id`, which must be next week (A-8). Needs `user`'s authorization,
    /// which also covers the token transfer.
    pub fn commit(
        env: Env,
        user: Address,
        week_id: u64,
        amount: i128,
        goal_m: u64,
    ) -> Result<(), Error> {
        let config = load_config(&env);
        let current = current_week_at(&env, &config)?;
        user.require_auth();
        let key = DataKey::Position(user.clone(), week_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyCommitted);
        }
        if Some(week_id) != current.checked_add(1) {
            return Err(Error::WrongWeek);
        }
        if amount < config.min_amount || amount > config.max_amount {
            return Err(Error::AmountOutOfRange);
        }
        if goal_m < config.min_goal_m || goal_m > config.max_goal_m {
            return Err(Error::GoalOutOfRange);
        }

        let token = token::TokenClient::new(&env, &config.token);
        let contract = env.current_contract_address();
        let before = token.balance(&contract);
        token.transfer(&user, &contract, &amount);
        // Same guard as the EVM contract; the SAC never charges a fee, so this never trips here.
        if token.balance(&contract) != before + amount {
            return Err(Error::BalanceMismatch);
        }

        let position = Position {
            amount,
            goal_m,
            state: State::Active,
        };
        save_position(&env, &key, &position);
        Committed {
            user,
            week_id,
            amount,
            goal_m,
        }
        .publish(&env);
        Ok(())
    }

    /// The oracle settles a week inside `[week_end + grace, week_end + stale_after)`. `met`
    /// returns the deposit; otherwise it stays here. The distance never goes on-chain (A-4).
    pub fn settle(env: Env, user: Address, week_id: u64, met: bool) -> Result<(), Error> {
        let config = load_config(&env);
        config.oracle.require_auth();
        let key = DataKey::Position(user.clone(), week_id);
        let mut position = load_active_position(&env, &key)?;
        let now = u128::from(env.ledger().timestamp());
        let end = week_end(&config, week_id);
        if now < end + u128::from(config.grace) || now >= end + u128::from(config.stale_after) {
            return Err(Error::OutsideSettleWindow);
        }

        if met {
            // A refused refund (trustline deauthorized or removed) traps the whole call, and the
            // position stays Active.
            token::TokenClient::new(&env, &config.token).transfer(
                &env.current_contract_address(),
                &user,
                &position.amount,
            );
            position.state = State::Returned;
        } else {
            position.state = State::Forfeited;
            let storage = env.storage().instance();
            let total: i128 = storage.get(&DataKey::TotalForfeited).unwrap_or(0);
            storage.set(&DataKey::TotalForfeited, &(total + position.amount));
        }

        save_position(&env, &key, &position);
        Settled {
            user,
            week_id,
            met,
            amount: position.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Anyone returns a deposit the oracle did not settle, from `week_end + stale_after` on and
    /// with no deadline. The money only ever goes to the position's owner.
    pub fn release_if_stale(env: Env, user: Address, week_id: u64) -> Result<(), Error> {
        let config = load_config(&env);
        let key = DataKey::Position(user.clone(), week_id);
        let mut position = load_active_position(&env, &key)?;
        let now = u128::from(env.ledger().timestamp());
        if now < week_end(&config, week_id) + u128::from(config.stale_after) {
            return Err(Error::NotStaleYet);
        }

        token::TokenClient::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &user,
            &position.amount,
        );
        position.state = State::ReleasedStale;
        save_position(&env, &key, &position);
        ReleasedStale {
            user,
            week_id,
            amount: position.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// `floor((now − week_anchor) / week_len)`; fails with `BeforeAnchor` before the anchor.
    pub fn current_week(env: Env) -> Result<u64, Error> {
        current_week_at(&env, &load_config(&env))
    }

    /// A missing position reads as `State::None` with zero amount and goal.
    pub fn get_position(env: Env, user: Address, week_id: u64) -> Position {
        env.storage()
            .persistent()
            .get(&DataKey::Position(user, week_id))
            .unwrap_or(Position {
                amount: 0,
                goal_m: 0,
                state: State::None,
            })
    }

    pub fn config(env: Env) -> Config {
        load_config(&env)
    }

    /// Sum of every forfeited deposit. It never leaves the contract (A-5).
    pub fn total_forfeited(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalForfeited)
            .unwrap_or(0)
    }
}

fn load_config(env: &Env) -> Config {
    // Set by the constructor, which always runs: a missing config cannot happen.
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidConfig))
}

fn current_week_at(env: &Env, config: &Config) -> Result<u64, Error> {
    let now = env.ledger().timestamp();
    if now < config.week_anchor {
        return Err(Error::BeforeAnchor);
    }
    Ok((now - config.week_anchor) / config.week_len)
}

/// `week_anchor + (w + 1) · week_len` in 128 bits: it cannot overflow for a `u64` week.
fn week_end(config: &Config, week_id: u64) -> u128 {
    u128::from(config.week_anchor) + (u128::from(week_id) + 1) * u128::from(config.week_len)
}

fn load_active_position(env: &Env, key: &DataKey) -> Result<Position, Error> {
    let position: Position = env
        .storage()
        .persistent()
        .get(key)
        .ok_or(Error::PositionNotFound)?;
    if position.state != State::Active {
        return Err(Error::PositionNotActive);
    }
    Ok(position)
}

/// Positions live in persistent storage, never temporary, and every write extends both the
/// position and the instance (spec 4.2).
fn save_position(env: &Env, key: &DataKey, position: &Position) {
    let persistent = env.storage().persistent();
    persistent.set(key, position);
    persistent.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[cfg(test)]
mod test;
