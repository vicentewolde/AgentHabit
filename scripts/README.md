# Scripts

Operational scripts, run from the repo root. Keys are written to `.env.local`, never to argv or
logs.

| Script | Command | Lands with |
|---|---|---|
| `bootstrap.ts` | `pnpm run bootstrap` | T2 |
| `deploy-stellar.ts` | `pnpm run deploy:stellar` | T7 |
| `deploy-avalanche.ts` | `pnpm run deploy:avalanche` | T7 |
| `lib/` | shared helpers (env file, network config) | T2 |
