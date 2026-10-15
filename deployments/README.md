# Deployments

The only bridge between the TypeScript side and the contracts (P-2). Each file records one
network's deployed instances (production and rehearsal), their constructor parameters and the
interface exported at deploy time. Chain adapters read them through zod; no TypeScript package
imports anything from `contracts/`.

| File | Network | Written by |
|---|---|---|
| `stellar-testnet.json` | Stellar testnet | T7 (`pnpm run deploy:stellar`) |
| `avalanche-fuji.json` | Avalanche Fuji (chainId 43113) | T7 (`pnpm run deploy:avalanche`) |

Nothing here changes without the user's explicit OK.
