# @agenthabit/web

The AgentHabit web app for T7a: Stellar only (A-22), UI in Spanish. React + Vite + Tailwind, wallets
through `@creit.tech/stellar-wallets-kit` (Freighter module only, bundled, no CDN, P-7).

The contract with the API is `packages/core/src/api-contract.ts`: every response is parsed with
the same zod schema the API answers with.

## Run it against the mock API (no real API needed)

Two terminals, from the repository root:

```bash
pnpm run web:mock-api
```

```bash
pnpm run web:dev
```

The web is on http://localhost:5173 (`strictPort`: if something else uses 5173, Vite fails instead of moving, because the web origin is part of the signed message and of Strava's redirect; stop whatever holds the port) and calls `VITE_API_URL` (default `http://localhost:3000`). The
mock API is dev only (`apps/web/dev/`, never imported by the app) and implements `/config`,
`/link/*`, `/me`, `/strava/*`, `/weeks/me` (with `unsettledWeeks`), `/tx/commit`, `/tx/release`,
`/tx/submit`, `GET /tx/{hash}` and `/positions` with canned data. It really verifies the SEP-53 signature of the link message and
builds real (harmless `manage_data`) Stellar transactions for the wallet to sign; nothing is sent
to any network.

Pick the state to click through at http://localhost:3000/__mock, or start with one:

```bash
MOCK_SCENARIO=active pnpm run web:mock-api
```

Scenarios: `fresh`, `no-position`, `active`, `waiting-settlement`, `expired`, `unregistered`,
`tx-failed`, `tx-pending`, `tx-stuck`, `session-expired`.

## Build

```bash
VITE_API_URL=https://api.example.com pnpm --filter @agenthabit/web build
```

The static site lands in `apps/web/dist/site`. The build also writes the Content-Security-Policy
into `index.html` (as a `<meta>`, with `connect-src` limited to the site and the API origin) and
into `dist/site/_headers` with the same policy plus `frame-ancestors 'none'`, `nosniff` and
`no-referrer`. The host must serve `index.html` for every path (`/reglas`, `/strava/callback`).

Note: the wallets kit applies a style rule at load that the policy blocks (one console error); it
only styles the kit's own modal, which this app does not open.

## Tests

```bash
pnpm exec vitest run apps/web
```

## Privacy rules the code keeps

- The session token lives in `sessionStorage` only: never in a URL, in `localStorage` or in a log.
- `/strava/callback` reads `code`, `scope` and `state` once, strips them from the address bar before
  rendering, forwards them with the session, and never logs or stores them.
- No analytics, no CDN, no web fonts, no third-party requests other than the wallet's own.
