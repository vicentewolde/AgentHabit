# Scripts

Operational scripts, run from the repo root. Keys are written to `.env.local`, never to argv or
logs.

| Script | Command | Lands with |
|---|---|---|
| `bootstrap.ts` | `pnpm run bootstrap` | T2 ✓ |
| `gen-cases.ts` | `pnpm run cases:gen` | T4 ✓ |
| `deploy-stellar.ts` | `pnpm run deploy:stellar` (plan only; `--yes` sends, `--reset` after a testnet reset) | T6a ✓ |
| `deploy-avalanche.ts` | `pnpm run deploy:avalanche` | T6 |
| `lib/` | `env-file`, `network`, `keys`, `stellar-testnet` and the bootstrap logic, with tests; `cases-path` | T2 ✓, T4 ✓ |

`pnpm run bootstrap` takes no arguments. It writes missing keys to `.env.local` (mode `0600`),
funds missing Stellar accounts with Friendbot, adds the test user's USDC trustline if absent and
prints the Fuji addresses for the manual faucets. Every line it prints goes through a guard that
stops the run (`SecretLeak`) rather than print a secret.

`pnpm run cases:gen` writes `contracts/fixtures/cases.json` from the case table in
`packages/core` (A-3). It touches no network. `gen-cases.test.ts` runs in `pnpm check` and fails
when the committed JSON no longer matches the table.
