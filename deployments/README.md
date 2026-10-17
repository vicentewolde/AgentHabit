# Deployments

`stellar-testnet.json` is written by `pnpm run deploy:stellar` (T6a, first run with `--yes`); until then none exist. They are the only bridge between the TypeScript side and the
contracts (P-2). Each file records one network's deployed instances (production and rehearsal),
their constructor parameters and the interface exported at deploy time. Chain adapters read them
through zod; no TypeScript package imports anything from `contracts/`.

| File | Network | Written by |
|---|---|---|
| `stellar-testnet.json` | Stellar testnet | T6 (`pnpm run deploy:stellar`) |
| `avalanche-fuji.json` | Avalanche Fuji (chainId 43113) | T6 (`pnpm run deploy:avalanche`) |

Nothing here changes without the user's explicit OK.
