import { AgentHabitError } from "@agenthabit/core";
import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/api/client.js";
import { describeError, messageFor, reasonOf } from "../src/api/messages.js";
import { BASE_URL } from "./helpers.js";

const GENERIC = "El contrato no aceptó la operación. Revisa el monto, la meta y la semana.";

function rejected(reason?: string): AgentHabitError {
  return new AgentHabitError("ContractRejected", "refused", {
    details: { status: 422, reason },
  });
}

describe("the client keeps the reason of a contract refusal", () => {
  async function refusal(body: unknown) {
    const api = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => Response.json(body, { status: 422 }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    return api.buildCommit({ amount: "1", goalM: 1 }).catch((error: unknown) => error);
  }

  it("exposes it on the typed error", async () => {
    const failure = await refusal({ error: "ContractRejected", reason: "InsufficientBalance" });
    expect(failure).toBeInstanceOf(AgentHabitError);
    expect(reasonOf(failure)).toBe("InsufficientBalance");
    expect(failure instanceof AgentHabitError && failure.code).toBe("ContractRejected");
  });

  it("has no reason when the API sends none", async () => {
    const failure = await refusal({ error: "ContractRejected" });
    expect(reasonOf(failure)).toBeUndefined();
    expect(messageFor(failure)).toBe(GENERIC);
  });
});

describe("messages by reason", () => {
  const table: Record<string, string> = {
    InsufficientBalance:
      "No tienes suficiente USDC de prueba en esta wallet. Pide USDC en el faucet de Circle y vuelve a intentarlo.",
    NoUsdcTrustline:
      "Tu wallet todavía no puede guardar USDC. En Freighter agrega el activo USDC de testnet y pide USDC en el faucet de Circle.",
    AlreadyCommitted: "Ya tienes un compromiso para esa semana.",
    AmountOutOfRange: "El monto o la meta están fuera de los límites. Revisa el rango permitido.",
    GoalOutOfRange: "El monto o la meta están fuera de los límites. Revisa el rango permitido.",
    WrongWeek: "La semana cambió. Revisa las fechas y confirma de nuevo.",
    NotStaleYet: "Todavía no se puede recuperar este depósito: espera la fecha indicada.",
    PositionNotFound: "No hay un depósito activo para recuperar en esa semana.",
    PositionNotActive: "No hay un depósito activo para recuperar en esa semana.",
    TokenBlocked: "El token bloqueó esta wallet; no se puede completar la operación.",
  };

  for (const [reason, message] of Object.entries(table)) {
    it(`maps ${reason}`, () => {
      expect(messageFor(rejected(reason))).toBe(message);
    });
  }

  it("falls back to the generic message for the other contract errors and unknown reasons", () => {
    for (const reason of [
      "OutsideSettleWindow",
      "BeforeAnchor",
      "InvalidConfig",
      "BalanceMismatch",
      "SomethingNew",
      undefined,
    ]) {
      expect(messageFor(rejected(reason)), String(reason)).toBe(GENERIC);
    }
  });

  it("never shows a raw reason, and ignores a reason on another code", () => {
    expect(messageFor(rejected("SomethingNew"))).not.toContain("SomethingNew");
    const other = new AgentHabitError("NetworkError", "x", {
      details: { reason: "InsufficientBalance" },
    });
    expect(reasonOf(other)).toBeUndefined();
    expect(messageFor(other)).toContain("Revisa tu conexión");
  });

  it("offers the faucet only for the two token reasons", () => {
    for (const reason of Object.keys(table)) {
      const expected = reason === "InsufficientBalance" || reason === "NoUsdcTrustline";
      expect(describeError(rejected(reason)).faucet, reason).toBe(expected);
    }
    expect(describeError(rejected(undefined)).faucet).toBe(false);
    expect(describeError(new Error("x")).faucet).toBe(false);
  });
});
