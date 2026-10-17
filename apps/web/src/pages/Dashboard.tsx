import type { ConfigResponse, InstanceInfo, MeResponse, WeeksResponse } from "@agenthabit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { CommitForm } from "../components/CommitForm.js";
import { StravaCard } from "../components/StravaCard.js";
import { Button, Card, Loading, Notice } from "../components/ui.js";
import { WeekCard } from "../components/WeekCard.js";
import { reconcilePendingCommit } from "../flows.js";

const RETRY_MS = 20_000;

interface Loaded {
  readonly config: ConfigResponse;
  readonly me: MeResponse;
  readonly weeks: WeeksResponse;
  /** `Date.now()` when the answer arrived, to keep counting from the server's `now`. */
  readonly loadedAtMs: number;
  readonly mirrorWaiting: boolean;
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
        // A commit left over from an earlier attempt goes first, so the week shows it.
        const reconciled = await reconcilePendingCommit({ api, address });
        const [config, me, weeks] = await Promise.all([api.config(), api.me(), api.weeks()]);
        if (mine !== latest.current) return;
        setState({
          kind: "ready",
          data: {
            config,
            me,
            weeks,
            loadedAtMs: Date.now(),
            mirrorWaiting: reconciled === "waiting",
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

  // While a position is on-chain but unreported, ask again: the pending hash is retried on load.
  const unreported =
    state.kind === "ready" &&
    [state.data.weeks.currentWeek, state.data.weeks.nextWeek].some(
      (week) => week.position?.state === "Active" && week.position.commitTxHash === null,
    );
  useEffect(() => {
    if (!unreported) return;
    const timer = window.setInterval(() => void load(true), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [unreported, load]);

  if (state.kind === "loading") return <Loading label="Cargando tu semana…" />;
  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <Notice tone="error">{state.message}</Notice>
        <Button onClick={() => void load(false)}>Reintentar</Button>
      </div>
    );
  }

  const { config, me, weeks, loadedAtMs, mirrorWaiting } = state.data;
  const instance = pickInstance(config, weeks);
  const nowMs = Date.parse(weeks.now) + (Date.now() - loadedAtMs);
  const reload = () => load(true);

  return (
    <div className="space-y-4">
      {mirrorWaiting && (
        <Notice tone="info">
          Tu compromiso anterior ya fue enviado a la cadena, pero todavía no aparece aquí. Actualiza
          la página en un minuto.
        </Notice>
      )}
      <StravaCard connected={me.stravaConnected} onChanged={reload} />
      <Card title="Esta semana" headingId="h-current">
        <WeekCard
          week={weeks.currentWeek}
          instance={instance}
          nowMs={nowMs}
          kind="current"
          onChanged={reload}
        />
      </Card>
      <Card title="La semana que viene" headingId="h-next">
        {(weeks.nextWeek.position === null || committed) && (
          <CommitForm
            week={weeks.nextWeek}
            instance={instance}
            stravaConnected={me.stravaConnected}
            onDone={() => {
              // Keep the form mounted: it is showing the result of the transaction.
              setCommitted(true);
              void reload();
            }}
          />
        )}
        {weeks.nextWeek.position !== null && (
          <WeekCard
            week={weeks.nextWeek}
            instance={instance}
            nowMs={nowMs}
            kind="next"
            onChanged={reload}
          />
        )}
      </Card>
    </div>
  );
}
