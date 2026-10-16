# AgentHabit

Put money on your running goal. You lock 20–50 USDC in a contract and set a weekly distance
goal; Strava verifies your runs. Hit the goal and you get everything back. Miss it and the money
stays locked in the contract forever: nobody collects it, not the platform and not other users.

- **Two chains, same behaviour:** Stellar (Soroban) and Avalanche (Solidity), one adapter per
  chain over a shared domain core.
- **No custody:** the contracts have no admin, no withdrawal and no upgrade.
- **The verifier's failure never costs the user:** if the oracle does not settle in time, anyone
  can return the deposit to its owner.
- **Testnet only** (Stellar testnet and Avalanche Fuji) until Phase 2.

Status: Phase 1 (MVP on testnet); Phase 0 closed at `v0.0.1`. See [ROADMAP.md](ROADMAP.md).
Project docs are in Spanish under [docs/](docs/).

## Layout

```
apps/        web · api · settler (the oracle's daily job)
packages/    core · config · db · strava · chain-stellar · chain-avalanche
contracts/   stellar/ (Cargo workspace) · evm/ (Foundry project)
deployments/ the only bridge between TypeScript and the contracts
scripts/     bootstrap and deploy scripts
docs/        roadmap state, decisions, phase specs and logs (Spanish)
```

The pnpm workspace covers `apps/*` and `packages/*` only. The contract workspaces have no
`package.json`; they are run from the root with dedicated scripts.

## Requirements

- Node 22 (`.nvmrc`) and pnpm 11.24.0 (`packageManager`)
- Rust 1.98.0 with the `wasm32v1-none` target, pinned in `contracts/stellar/rust-toolchain.toml`
  (rustup installs it on the first `cargo` call inside `contracts/stellar`)
- `stellar` CLI 28.1.0, which builds the Soroban contract
- Foundry 1.8.5, for the EVM contract (binaries in `~/.foundry/bin`)

Install the pinned `stellar` CLI (Homebrew always installs the latest one instead):

```bash
cargo install --locked stellar-cli --version 28.1.0
```

Install the pinned Foundry, once `foundryup` is installed from https://getfoundry.sh:

```bash
foundryup --install v1.8.5
```

The EVM dependencies (forge-std, OpenZeppelin) are git submodules pinned to release tags. After
cloning:

```bash
git submodule update --init
```

## Commands

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Lint, typecheck and test (no network):

```bash
pnpm check
```

Format and fix lint issues:

```bash
pnpm format
```

Soroban contract tests:

```bash
pnpm run contracts:test:stellar
```

Build the Soroban contract for the network (`soroban-sdk` 29 only builds through the CLI):

```bash
pnpm run contracts:build:stellar
```

EVM contract tests:

```bash
pnpm run contracts:test:evm
```

Testnet keys, Friendbot and the USDC trustline (touches Stellar testnet; safe to run again):

```bash
pnpm run bootstrap
```

It writes the deployer, oracle and test-user keys for both chains into `.env.local` (mode
`0600`), never replacing a key that exists, and prints only public addresses. On Fuji it touches
nothing: it prints the addresses to paste into the AVAX and Circle USDC faucets by hand.

## Configuration

`pnpm run bootstrap` creates `.env.local` from `.env.example` on its first run and fills in the
keys; follow the comments for the rest. Keys are never typed into argv. Settlement runs in
`SETTLE_MODE=dry-run` by default: it computes and prints, but does not sign.

## License

Apache-2.0. See [LICENSE](LICENSE).
