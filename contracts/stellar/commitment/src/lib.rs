//! AgentHabit commitment contract for Soroban (P-3).
//!
//! Empty on purpose: T2 wires soroban-sdk so the crate builds for the network
//! (`wasm32v1-none`), and T5 writes the contract and its tests, with the same
//! semantics as `contracts/evm/src/Commitment.sol`.
#![no_std]

use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct Commitment;

#[contractimpl]
impl Commitment {}

#[cfg(test)]
mod test;
