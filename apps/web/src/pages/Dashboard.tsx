import type { ConfigResponse, InstanceInfo, MeResponse, WeeksResponse } from "@agenthabit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { CommitForm } from "../components/CommitForm.js";
import { StravaCard } from "../components/StravaCard.js";
import { UnsettledWeek } from "../components/UnsettledWeek.js";
import { Button, Card, ExplorerLink, Loading, Notice } from "../components/ui.js";
import { WeekCard } from "../components/WeekCard.js";
import { reconcilePendingCommit } from "../flows.js";
import type { PendingCommit } from "../pending.js";

const RETRY_MS = 20_000;
/** The clock on screen moves on its own: "Recuperar" must appear without a reload. */
const TICK_MS = 30_000;

interface Loaded {
  readonly config: ConfigResponse;
  readonly me: MeResponse;
  readonly weeks: WeeksResponse;
  /** `Date.now()` when the answer arrived, to keep counting from the server's `now`. */
  readonly loadedAtMs: number;
  /** A signed commit of this wallet that is still waiting to be confirmed or recorded. */
  readonly pending: PendingCommit | null;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly data: Loaded };

/** The instance the web shows: the one the weeks belong to, with the limits `/config` gives. */
export function pickInstance(config: ConfigResponse, weeks: WeeksResponse): InstanceInfo {
  const stellar = config.instances.filter((instance) => instance.chain === "stellar");
  return (
    stellar.find((instance) => instance.contract === weeks.instance.contract) ??
    stellar.find((instance) => instance.kind === "production") ??
    weeks.instance
  );
}

export function Dashboard() {
  const { api, session } = useApp();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [committed, setCommitted] = useState(false);
  const address = session?.address ?? "";
  // Only the latest request may write: a slow answer must not overwrite a newer one.
  const latest = useRef(0);

  const load = useCallback(
    async (quiet: boolean) => {
      const mine = ++latest.current;
      if (!quiet) setState({ kind: "loading" });
      try {
        // A commit left over from an earlier attempt is picked up in parallel with the reads.
        const [reconciled, config, me, firstWeeks] = await Promise.all([
          reconcilePendingCommit({ api, address }),
          api.config(),
          api.me(),
          api.weeks(),
        ]);
        // If the leftover was just recorded, the weeks read above may predate it.
        const weeks = reconciled.result === "mirrored" ? await api.weeks() : firstWeeks;
        if (mine !== latest.current) return;
        setState({
          kind: "ready",
          data: {
            config,
            me,
            weeks,
            loadedAtMs: Date.now(),
            pending: reconciled.pending,
          },
        });
      } catch (error) {
        if (mine !== latest.current) return;
        setState({ kind: "error", message: messageFor(error) });
      }
    },
    [api, address],
  );

  useEffect(() => {
    void load(false);
    return () => {
      latest.current++;
    };
  }, [load]);

  // Tick the clock so time-gated parts (the release button, days left) update by themselves.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // While a position is on-chain but unreported, or a signed commit is waiting, ask again: the
  // stored commit is retried on every load.
  const unreported =
    state.kind === "ready" &&
    [
      state.data.weeks.currentWeek,
      state.data.weeks.nextWeek,
      ...state.data.weeks.unsettledWeeks,
    ].some((week) => week.position?.state === "Active" && week.position.commitTxHash === null);
  const needsRetry = unreported || (state.kind === "ready" && state.data.pending !== null);
  useEffect(() => {
    if (!needsRetry) return;
    const timer = window.setInterval(() => void load(true), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [needsRetry, load]);

  if (state.kind === "loading") return <Loading label="Cargando tu semana…" />;
  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <Notice tone="error">{state.message}</Notice>
        <Button onClick={() => void load(false)}>Reintentar</Button>
      </div>
    );
  }

  const { config, me, weeks, loadedAtMs, pending } = state.data;
  const instance = pickInstance(config, weeks);
  const nowMs = Date.parse(weeks.now) + (Date.now() - loadedAtMs);
  const reload = () => load(true);
  const nextEmpty = weeks.nextWeek.position === null;
  // A waiting transaction replaces the form: signing again could lock the money twice.
  const showForm = committed || (nextEmpty && pending === null);
  const showPending = !committed && nextEmpty && pending !== null;

  return (
    <div className="space-y-4">
      <StravaCard connected={me.stravaConnected} onChanged={reload} />
      <Card title="Esta semana" headingId="h-current">
        <WeekCard
          week={weeks.currentWeek}
          instance={instance}
          nowMs={nowMs}
          kind="current"
          stravaConnected={me.stravaConnected}
        />
      </Card>
      {weeks.unsettledWeeks.length > 0 && (
        <Card title="Semanas anteriores sin liquidar" headingId="h-unsettled">
          <ul className="space-y-4">
            {weeks.unsettledWeeks.map((week) => (
              <li
                key={week.weekId}
                className="space-y-3 border-b border-slate-200 pb-4 last:border-0"
              >
                <UnsettledWeek week={week} instance={instance} nowMs={nowMs} onChanged={reload} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="La semana que viene" headingId="h-next">
        {showPending && pending !== null && (
          <Notice tone="info">
            Tienes una transacción en espera: ya firmaste tu compromiso y estamos esperando que la
            red lo confirme y que AgentHabit lo registre. No hace falta firmar de nuevo; esta página
            lo vuelve a intentar sola.{" "}
            {pending.txHash !== undefined && (
              <ExplorerLink template={instance.explorerTxUrl} hash={pending.txHash} />
            )}
          </Notice>
        )}
        {showForm && (
          <CommitForm
            week={weeks.nextWeek}
            instance={instance}
            stravaConnected={me.stravaConnected}
            onDone={() => {
              // Keep the form mounted: it is showing the result of the transaction.
              setCommitted(true);
              void reload();
            }}
            onStale={() => void reload()}
          />
        )}
        {weeks.nextWeek.position !== null && (
          <WeekCard
            week={weeks.nextWeek}
            instance={instance}
            nowMs={nowMs}
            kind="next"
            stravaConnected={me.stravaConnected}
          />
        )}
      </Card>
    </div>
  );
}
