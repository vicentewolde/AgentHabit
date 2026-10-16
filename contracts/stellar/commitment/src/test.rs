use soroban_sdk::Env;

use crate::Commitment;

#[test]
fn the_empty_contract_registers_in_a_test_environment() {
    let env = Env::default();
    let address = env.register(Commitment, ());

    assert!(env.as_contract(&address, || true));
}
