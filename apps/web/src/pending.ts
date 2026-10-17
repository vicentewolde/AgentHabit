import { ReportPositionRequestSchema } from "@agenthabit/core";
import { z } from "zod";

/**
 * A commit the wallet signed that the API has not recorded yet, kept so its hash is never lost.
 *
 * It goes in `localStorage` keyed by the wallet address (so it survives closing the tab) and only
 * holds public chain data: the contract, the week, the signed transaction and its hash. The
 * session token is never stored here; it stays in `sessionStorage` (`session.ts`).
 *
 * Two stages: `signedXdr` alone means the wallet signed but the API never confirmed receiving it
 * (the network dropped); the next load submits it again, which is safe because a transaction is
 * identified by its hash. With `txHash` the transaction was sent and only the report is missing.
 */
const PendingCommitSchema = z.object({
  address: z.string().min(1).max(100),
  chain: z.literal("stellar"),
  contract: ReportPositionRequestSchema.shape.contract,
  weekId: ReportPositionRequestSchema.shape.weekId,
  signedXdr: z.string().min(1).max(20_000).optional(),
  txHash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
});
export type PendingCommit = z.infer<typeof PendingCommitSchema>;

const PREFIX = "agenthabit.pending.";

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPending(address: string): PendingCommit | null {
  try {
    const raw = store()?.getItem(PREFIX + address);
    if (raw === null || raw === undefined) return null;
    const parsed = PendingCommitSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.address !== address) return null;
    if (parsed.data.signedXdr === undefined && parsed.data.txHash === undefined) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function savePending(pending: PendingCommit): void {
  try {
    store()?.setItem(PREFIX + pending.address, JSON.stringify(pending));
  } catch {
    // Storage is blocked or full: the commit is still on its way, only the safety net is missing.
  }
}

export function clearPending(address: string): void {
  try {
    store()?.removeItem(PREFIX + address);
  } catch {
    // Nothing to clear.
  }
}
