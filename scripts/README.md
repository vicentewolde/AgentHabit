# Scripts

Operational scripts, run from the repo root. Keys are written to `.env.local`, never to argv or
logs.

| Script | Command | Lands with |
|---|---|---|
| `bootstrap.ts` | `pnpm run bootstrap` | T2 ✓ |
| `deploy-stellar.ts` | `pnpm run deploy:stellar` | T7 |
| `deploy-avalanche.ts` | `pnpm run deploy:avalanche` | T7 |
| `lib/` | `env-file`, `network`, `keys`, `stellar-testnet` and the bootstrap logic, with tests | T2 ✓ |

`pnpm run bootstrap` takes no arguments. It writes missing keys to `.env.local` (mode `0600`),
funds missing Stellar accounts with Friendbot, adds the test user's USDC trustline if absent and
prints the Fuji addresses for the manual faucets. Every line it prints goes through a guard that
stops the run (`SecretLeak`) rather than print a secret.
