/**
 * DEV ONLY. A stand-in for the AgentHabit API so the web can be clicked through before the real
 * endpoints exist (T7a). It speaks the contract of `packages/core/src/api-contract.ts` and
 * validates every body it sends and receives with those same schemas. Nothing in `src/` imports
 * this folder (a test enforces it), so it can never reach the production bundle.
 *
 * It really verifies the SEP-53 signature of the link message and really builds Stellar
 * transactions for the wallet to sign (a harmless `manage_data` operation: no money moves, and the
 * transaction is never sent to any network), so a real Freighter can be tried against it.
 */

import { randomBytes } from "node:crypto";
import {
  BuildCommitRequestSchema,
  BuildReleaseRequestSchema,
  buildLinkMessage,
  ChallengeRequestSchema,
  ChallengeResponseSchema,
  ConfigResponseSchema,
  type InstanceInfo,
  MeResponseSchema,
  PreparedTxResponseSchema,
  ReportPositionRequestSchema,
  ReportPositionResponseSchema,
  StravaCallbackRequestSchema,
  StravaCallbackResponseSchema,
  StravaConnectResponseSchema,
  StravaDisconnectResponseSchema,
  SubmitTxRequestSchema,
  SubmitTxResponseSchema,
  usdcToUnits,
  VerifyRequestSchema,
  VerifyResponseSchema,
  WeeksResponseSchema,
  type WeekView,
} from "@agenthabit/core";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export const SCENARIOS = [
  { name: "fresh", label: "Usuario nuevo: sin Strava y sin compromiso" },
  { name: "no-position", label: "Con Strava, sin compromiso (el flujo de comprometer funciona)" },
  { name: "active", label: "Compromiso activo, con kilómetros leídos" },
  {
    name: "waiting-settlement",
    label: "Semana anterior sin liquidar, todavía dentro de la espera del oráculo",
  },
  { name: "expired", label: "Semana anterior sin liquidar y vencida: aparece el botón Recuperar" },
  { name: "unregistered", label: "Compromiso en la cadena pero sin hash registrado (aviso)" },
  { name: "tx-failed", label: "Con Strava, y /tx/submit responde FAILED" },
  {
    name: "tx-pending",
    label: "Con Strava, /tx/submit responde PENDING y GET /tx/{hash} confirma al 3.er sondeo",
  },
  { name: "tx-stuck", label: "Con Strava, y la transacción queda PENDING para siempre" },
  { name: "session-expired", label: "Toda llamada con sesión responde 401" },
] as const;
export type ScenarioName = (typeof SCENARIOS)[number]["name"];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const ANCHOR_MS = Date.parse("2026-08-03T03:00:00Z");

type PositionState = "Active" | "Returned" | "Forfeited" | "ReleasedStale";
interface MockPosition {
  state: PositionState;
  amount: string;
  goalM: number;
  commitTxHash: string | null;
}

interface MockState {
  scenario: ScenarioName;
  stravaConnected: boolean;
  positions: Map<string, MockPosition>;
  totalM: number | null;
  /** Submitted transactions still PENDING, with how many times they were asked about. */
  pendingTxs: Map<string, { note: string; address: string; polls: number }>;
  /** Hashes whose outcome is final. */
  finishedTxs: Map<string, "SUCCESS" | "FAILED">;
  /** Transactions the mock "confirmed", by hash: what the position report is checked against. */
  confirmed: Map<string, { weekId: string; address: string }>;
}

function pad(n: number): string {
  return n.toString();
}

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

export function mockInstance(): InstanceInfo {
  return {
    chain: "stellar",
    kind: "production",
    contract: contractId(1),
    token: contractId(2),
    tokenDecimals: 7,
    networkPassphrase: Networks.TESTNET,
    explorerTxUrl: "https://stellar.expert/explorer/testnet/tx/{hash}",
    minAmount: usdcToUnits(20n, "stellar").toString(),
    maxAmount: usdcToUnits(50n, "stellar").toString(),
    minGoalM: 1000,
    maxGoalM: 100_000,
    weekLenS: 604_800,
    graceS: 10_800,
    staleAfterS: 604_800,
  };
}

export interface MockOptions {
  /** The web's origin: CORS, the link message's domain and the fake Strava redirect. */
  readonly webOrigin?: string;
  readonly now?: () => Date;
  readonly scenario?: ScenarioName;
}

function initialState(scenario: ScenarioName, nowMs: number): MockState {
  const state: MockState = {
    scenario,
    stravaConnected: scenario !== "fresh",
    positions: new Map(),
    totalM: null,
    pendingTxs: new Map(),
    finishedTxs: new Map(),
    confirmed: new Map(),
  };
  const currentId = weekIdAt(nowMs);
  const fakeHash = "ab".repeat(32);
  if (scenario === "active") {
    state.positions.set(currentId, {
      state: "Active",
      amount: usdcToUnits(25n, "stellar").toString(),
      goalM: 15_000,
      commitTxHash: fakeHash,
    });
    state.totalM = 6300;
  }
  if (scenario === "unregistered") {
    state.positions.set(currentId, {
      state: "Active",
      amount: usdcToUnits(25n, "stellar").toString(),
      goalM: 15_000,
      commitTxHash: null,
    });
  }
  const earlier = {
    state: "Active" as const,
    amount: usdcToUnits(30n, "stellar").toString(),
    goalM: 20_000,
    commitTxHash: fakeHash,
  };
  if (scenario === "waiting-settlement") {
    state.positions.set(pad(Number(currentId) - 1), { ...earlier });
  }
  if (scenario === "expired") {
    // Three weeks back: its release window (end + 9 days) opened five days ago.
    state.positions.set(pad(Number(currentId) - 3), { ...earlier });
  }
  return state;
}

function weekIdAt(ms: number): string {
  return pad(Math.max(0, Math.floor((ms - ANCHOR_MS) / WEEK_MS)));
}

function weekView(
  id: string,
  state: MockState,
  position: MockPosition | undefined,
  nowMs: number,
  current: boolean,
): WeekView {
  const startMs = ANCHOR_MS + Number(id) * WEEK_MS;
  const endMs = startMs + WEEK_MS;
  const read = current && state.stravaConnected && position?.state === "Active";
  return {
    weekId: id,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    settleOpensAt: new Date(endMs + 3 * 60 * 60 * 1000).toISOString(),
    releaseOpensAt: new Date(endMs + 9 * DAY_MS).toISOString(),
    position: position === undefined ? null : { ...position },
    totalM: read && state.totalM !== null ? state.totalM : null,
    readAt: read && state.totalM !== null ? new Date(nowMs - 10 * 60_000).toISOString() : null,
  };
}

/** Builds the mock API. Pure Hono: the server lives in `mock-api.ts`. */
export function createMockApp(options: MockOptions = {}): Hono {
  const webOrigin = options.webOrigin ?? "http://localhost:5173";
  const now = options.now ?? (() => new Date());
  const instance = mockInstance();
  let state = initialState(options.scenario ?? "no-position", now().getTime());
  const sessions = new Map<string, string>();
  const challenges = new Map<string, { address: string; message: string; expiresAt: number }>();
  const stravaStates = new Map<string, string>();

  const app = new Hono();
  app.use("*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));

  function fail(c: Context, code: string, status: ContentfulStatusCode) {
    return c.json({ error: code }, status);
  }

  /** Sends `data` only after the contract's schema accepts it: a mock bug throws, not lies. */
  function reply<S extends z.ZodType>(c: Context, schema: S, data: z.input<S>) {
    return c.json(schema.parse(data));
  }

  async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | null> {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  }

  /** The wallet address of the session, or null (also null in the session-expired scenario). */
  function sessionAddress(c: Context): { address: string; token: string } | null {
    if (state.scenario === "session-expired") return null;
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const address = sessions.get(token);
    return address === undefined ? null : { address, token };
  }

  const ids = () => {
    const nowMs = now().getTime();
    const current = weekIdAt(nowMs);
    return { nowMs, current, next: pad(Number(current) + 1) };
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/config", (c) => reply(c, ConfigResponseSchema, { webOrigin, instances: [instance] }));

  app.post("/link/challenge", async (c) => {
    const body = await readBody(c, ChallengeRequestSchema);
    if (
      body === null ||
      body.chain !== "stellar" ||
      !StrKey.isValidEd25519PublicKey(body.address)
    ) {
      return fail(c, "InvalidRequest", 400);
    }
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    const nonce = randomBytes(16).toString("hex");
    const message = buildLinkMessage({
      chain: "stellar",
      domain: new URL(webOrigin).host,
      uri: webOrigin,
      address: body.address,
      nonce,
      issuedAt,
      expiresAt,
    });
    challenges.set(nonce, { address: body.address, message, expiresAt: expiresAt.getTime() });
    return reply(c, ChallengeResponseSchema, {
      nonce,
      message,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post("/link/verify", async (c) => {
    const body = await readBody(c, VerifyRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);
    const challenge = challenges.get(body.nonce);
    challenges.delete(body.nonce); // one try per challenge
    if (challenge === undefined || challenge.expiresAt <= now().getTime()) {
      return fail(c, "LinkRejected", 401);
    }
    let valid = false;
    try {
      // A plain Uint8Array: the crypto library refuses a Node Buffer when tests run under jsdom.
      const signature = new Uint8Array(Buffer.from(body.signature, "base64"));
      valid =
        signature.length === 64 &&
        Keypair.fromPublicKey(challenge.address).verifyMessage(challenge.message, signature);
    } catch {
      valid = false;
    }
    if (!valid) return fail(c, "LinkRejected", 401);
    const sessionToken = randomBytes(24).toString("hex");
    sessions.set(sessionToken, challenge.address);
    return reply(c, VerifyResponseSchema, {
      sessionToken,
      expiresAt: new Date(now().getTime() + DAY_MS).toISOString(),
      chain: "stellar",
      address: challenge.address,
    });
  });

  app.get("/me", (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    return reply(c, MeResponseSchema, {
      chain: "stellar",
      address: session.address,
      stravaConnected: state.stravaConnected,
    });
  });

  app.get("/strava/connect", (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const stravaState = randomBytes(16).toString("hex");
    stravaStates.set(stravaState, session.token);
    // The real API answers Strava's authorize URL; the mock sends the browser straight back.
    const url = `${webOrigin}/strava/callback?state=${stravaState}&code=mock-code&scope=read,activity:read_all`;
    return reply(c, StravaConnectResponseSchema, { url });
  });

  app.post("/strava/callback", async (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const body = await readBody(c, StravaCallbackRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);
    if (stravaStates.get(body.state) !== session.token) return fail(c, "LinkRejected", 401);
    stravaStates.delete(body.state);
    if (!/activity:read_all/.test(body.scope)) return fail(c, "StravaScopeMissing", 400);
    state.stravaConnected = true;
    return reply(c, StravaCallbackResponseSchema, { connected: true });
  });

  app.post("/strava/disconnect", (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const was = state.stravaConnected;
    state.stravaConnected = false;
    return reply(c, StravaDisconnectResponseSchema, { disconnected: was });
  });

  app.get("/weeks/me", (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const { nowMs, current, next } = ids();
    return reply(c, WeeksResponseSchema, {
      now: new Date(nowMs).toISOString(),
      instance,
      currentWeek: weekView(current, state, state.positions.get(current), nowMs, true),
      nextWeek: weekView(next, state, state.positions.get(next), nowMs, false),
      // Earlier weeks whose position is still Active, newest first.
      unsettledWeeks: [...state.positions.entries()]
        .filter(([id, position]) => Number(id) < Number(current) && position.state === "Active")
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([id, position]) => weekView(id, state, position, nowMs, false)),
    });
  });

  /** A real, unsigned Stellar transaction for the wallet: a harmless `manage_data` note. */
  function prepareTx(address: string, note: string, weekId: string) {
    const tx = new TransactionBuilder(new Account(address, "0"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "agenthabit-mock", value: note }))
      .setTimeout(300)
      .build();
    return { xdr: tx.toXDR(), networkPassphrase: Networks.TESTNET, weekId };
  }

  app.post("/tx/commit", async (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const body = await readBody(c, BuildCommitRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);
    const amount = BigInt(body.amount);
    if (
      amount < BigInt(instance.minAmount) ||
      amount > BigInt(instance.maxAmount) ||
      body.goalM < instance.minGoalM ||
      body.goalM > instance.maxGoalM
    ) {
      return fail(c, "ContractRejected", 422);
    }
    const { next } = ids();
    if (state.positions.has(next)) return fail(c, "ContractRejected", 422);
    return reply(
      c,
      PreparedTxResponseSchema,
      prepareTx(session.address, `commit:${body.amount}:${body.goalM}:${next}`, next),
    );
  });

  app.post("/tx/release", async (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const body = await readBody(c, BuildReleaseRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);
    const position = state.positions.get(body.weekId);
    const releaseMs = ANCHOR_MS + (Number(body.weekId) + 1) * WEEK_MS + 9 * DAY_MS;
    if (position?.state !== "Active" || releaseMs > ids().nowMs) {
      return fail(c, "ContractRejected", 422);
    }
    return reply(
      c,
      PreparedTxResponseSchema,
      prepareTx(session.address, `release:${body.weekId}`, body.weekId),
    );
  });

  /** What a confirmed transaction does on-chain; the API only learns a hash from /positions. */
  function applyTx(note: string, address: string, txHash: string) {
    const [action, ...rest] = note.split(":");
    if (action === "commit") {
      const [amount, goalM, weekId] = rest;
      if (amount === undefined || goalM === undefined || weekId === undefined) return;
      state.confirmed.set(txHash, { weekId, address });
      state.positions.set(weekId, {
        state: "Active",
        amount,
        goalM: Number(goalM),
        commitTxHash: null,
      });
    } else if (action === "release") {
      const position = state.positions.get(rest[0] ?? "");
      if (position !== undefined) position.state = "ReleasedStale";
    }
  }

  app.post("/tx/submit", async (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const body = await readBody(c, SubmitTxRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);

    let note = "";
    let txHash = "";
    try {
      const tx = TransactionBuilder.fromXDR(body.xdr, Networks.TESTNET);
      if ("innerTransaction" in tx) return fail(c, "TransactionNotAllowed", 400);
      const op = tx.operations[0];
      if (
        tx.signatures.length === 0 ||
        tx.source !== session.address ||
        op?.type !== "manageData" ||
        op.name !== "agenthabit-mock" ||
        op.value === undefined ||
        op.value === null
      ) {
        return fail(c, "TransactionNotAllowed", 400);
      }
      note = Buffer.from(op.value).toString("utf8");
      txHash = Buffer.from(tx.hash()).toString("hex");
    } catch {
      return fail(c, "InvalidRequest", 400);
    }

    if (state.scenario === "tx-failed") {
      state.finishedTxs.set(txHash, "FAILED");
      return reply(c, SubmitTxResponseSchema, { txHash, status: "FAILED" });
    }

    if (state.scenario === "tx-pending" || state.scenario === "tx-stuck") {
      state.pendingTxs.set(txHash, { note, address: session.address, polls: 0 });
      return reply(c, SubmitTxResponseSchema, { txHash, status: "PENDING" });
    }
    applyTx(note, session.address, txHash);
    state.finishedTxs.set(txHash, "SUCCESS");
    return reply(c, SubmitTxResponseSchema, { txHash, status: "SUCCESS" });
  });

  /** `GET /tx/{hash}`: PENDING until the scenario lets it land. */
  app.get("/tx/:hash", (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const hash = c.req.param("hash");
    if (!/^[0-9a-f]{64}$/.test(hash)) return fail(c, "InvalidRequest", 400);
    const pending = state.pendingTxs.get(hash);
    if (pending !== undefined) {
      pending.polls += 1;
      if (state.scenario === "tx-pending" && pending.polls >= 3) {
        applyTx(pending.note, pending.address, hash);
        state.pendingTxs.delete(hash);
        state.finishedTxs.set(hash, "SUCCESS");
        return reply(c, SubmitTxResponseSchema, { txHash: hash, status: "SUCCESS" });
      }
      return reply(c, SubmitTxResponseSchema, { txHash: hash, status: "PENDING" });
    }
    return reply(c, SubmitTxResponseSchema, {
      txHash: hash,
      status: state.finishedTxs.get(hash) ?? "FAILED",
    });
  });

  app.post("/positions", async (c) => {
    const session = sessionAddress(c);
    if (session === null) return fail(c, "Unauthenticated", 401);
    const body = await readBody(c, ReportPositionRequestSchema);
    if (body === null) return fail(c, "InvalidRequest", 400);
    const known = state.confirmed.get(body.txHash);
    if (known === undefined || known.weekId !== body.weekId || known.address !== session.address) {
      return fail(c, "PositionUnverified", 422);
    }
    const position = state.positions.get(body.weekId);
    if (position === undefined) return fail(c, "PositionUnverified", 422);
    position.commitTxHash = body.txHash;
    return reply(c, ReportPositionResponseSchema, {
      chain: "stellar",
      contract: body.contract,
      weekId: body.weekId,
      amount: position.amount,
      goalM: String(position.goalM),
    });
  });

  // --- Dev controls: pick the state to click through ---------------------------------------
  app.get("/__mock", (c) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>Mock API (dev)</title>
<style>body{font:16px system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem}button{display:block;margin:.4rem 0;padding:.5rem .8rem;font:inherit;text-align:left;width:100%}</style>
<h1>Mock API (solo desarrollo)</h1>
<p>Escenario actual: <strong>${state.scenario}</strong>. Elegir uno reinicia los datos.</p>
${SCENARIOS.map(
  (s) =>
    `<form method="post" action="/__mock/scenario"><input type="hidden" name="name" value="${s.name}"><button>${s.name}: ${s.label}</button></form>`,
).join("")}`,
    ),
  );

  app.post("/__mock/scenario", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    const raw: unknown = contentType.includes("json")
      ? await c.req.json().catch(() => undefined)
      : Object.fromEntries(await c.req.formData().catch(() => new FormData()));
    const name = typeof raw === "object" && raw !== null && "name" in raw ? String(raw.name) : "";
    const found = SCENARIOS.find((s) => s.name === name);
    if (found === undefined) return fail(c, "InvalidRequest", 400);
    state = initialState(found.name, now().getTime());
    return contentType.includes("json") ? c.json({ scenario: found.name }) : c.redirect("/__mock");
  });

  return app;
}
