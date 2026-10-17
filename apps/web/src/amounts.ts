import { type InstanceInfo, USDC_DECIMALS, usdcToUnits } from "@agenthabit/core";
import { WebError } from "./errors.js";

/**
 * Amounts and goals as the form reads them. Money is a `bigint` in the token's smallest unit and
 * is never a float; distances are whole metres. The text a person types is parsed with string
 * arithmetic only, so 20.10 USDC is exactly 201_000_000 units.
 */

const STELLAR_DECIMALS = USDC_DECIMALS.stellar;
/** The form takes cents, not the seven decimals the token has (what is shown never truncates). */

const AMOUNT_RE = /^(\d{1,12})(?:[.,](\d{1,2}))?$/;
const KM_RE = /^(\d{1,6})(?:[.,](\d{1,3}))?$/;

/** "25", "25.5" or "25,50" to Stellar USDC units; `null` when it is not an amount. */
export function parseUsdc(text: string): bigint | null {
  const match = AMOUNT_RE.exec(text.trim());
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(STELLAR_DECIMALS, "0") || "0");
  return usdcToUnits(whole, "stellar") + fraction;
}

/** Stellar USDC units to text for people, exact: "25", "25,5", "25,0000001". */
export function formatUsdc(units: bigint): string {
  const scale = 10n ** BigInt(STELLAR_DECIMALS);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(STELLAR_DECIMALS, "0");
  const shown = fraction.replace(/0+$/, "");
  return shown === "" ? whole.toString() : `${whole.toString()},${shown}`;
}

/** "10", "10.5" or "10,25" km to whole metres; `null` when it is not a distance. */
export function parseKmToMetres(text: string): number | null {
  const match = KM_RE.exec(text.trim());
  if (match === null) return null;
  const km = Number.parseInt(match[1] ?? "0", 10);
  const metres = Number.parseInt((match[2] ?? "").padEnd(3, "0") || "0", 10);
  return km * 1000 + metres;
}

/** Whole metres to text for people in km: 10500 gives "10,5". */
export function formatKm(metres: number): string {
  const km = Math.floor(metres / 1000);
  const rest = (metres % 1000).toString().padStart(3, "0").replace(/0+$/, "");
  return rest === "" ? km.toString() : `${km},${rest}`;
}

/** Amounts are converted with Stellar's 7 decimals: refuse an instance that says otherwise. */
export function assertStellarUsdc(instance: InstanceInfo): InstanceInfo {
  if (instance.tokenDecimals !== USDC_DECIMALS.stellar) {
    throw new WebError(
      "WebConfig",
      `The instance's token has ${instance.tokenDecimals} decimals, not ${USDC_DECIMALS.stellar}`,
    );
  }
  return instance;
}

export interface CommitLimits {
  readonly minAmount: bigint;
  readonly maxAmount: bigint;
  readonly minGoalM: number;
  readonly maxGoalM: number;
}

export interface CommitFormErrors {
  amount?: string;
  goal?: string;
}

export type CommitValidation =
  | { readonly ok: true; readonly amount: bigint; readonly goalM: number }
  | { readonly ok: false; readonly errors: CommitFormErrors };

/** Checks both fields against the contract's limits; the messages are the form's own. */
export function validateCommit(
  amountText: string,
  goalText: string,
  limits: CommitLimits,
): CommitValidation {
  const errors: CommitFormErrors = {};

  const amount = parseUsdc(amountText);
  if (amount === null) {
    errors.amount = "Escribe un monto en USDC, por ejemplo 25.";
  } else if (amount < limits.minAmount || amount > limits.maxAmount) {
    errors.amount = `El monto debe estar entre ${formatUsdc(limits.minAmount)} y ${formatUsdc(limits.maxAmount)} USDC.`;
  }

  const goalM = parseKmToMetres(goalText);
  if (goalM === null) {
    errors.goal = "Escribe una meta en kilómetros, por ejemplo 15.";
  } else if (goalM < limits.minGoalM || goalM > limits.maxGoalM) {
    errors.goal = `La meta debe estar entre ${formatKm(limits.minGoalM)} y ${formatKm(limits.maxGoalM)} km.`;
  }

  if (
    amount === null ||
    goalM === null ||
    errors.amount !== undefined ||
    errors.goal !== undefined
  ) {
    return { ok: false, errors };
  }
  return { ok: true, amount, goalM };
}
