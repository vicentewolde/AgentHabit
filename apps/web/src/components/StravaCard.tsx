import { useState } from "react";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { REVOKE_SENTENCE } from "../copy.js";
import { WebError } from "../errors.js";
import { Button, Card, Notice } from "./ui.js";

/**
 * Where the browser may be sent to authorize Strava: Strava's own authorization page over https,
 * or this web's own callback page (what the dev mock API answers). Anything else is refused, so a
 * wrong answer from the API cannot send the user to another site.
 */
export function isAllowedStravaUrl(raw: string, webOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && url.hostname === "www.strava.com") return true;
  return url.origin === webOrigin && url.pathname === "/strava/callback";
}

/** Connect or disconnect Strava. Disconnecting counts as failing the week (A-10). */
export function StravaCard(props: {
  readonly connected: boolean;
  readonly onChanged: () => void;
  /** The web's own origin, from `/config`, for the dev-only direct callback. */
  readonly webOrigin: string;
}) {
  const { api, redirect } = useApp();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.stravaConnect();
      if (!isAllowedStravaUrl(url, props.webOrigin)) {
        setError(
          messageFor(new WebError("ServerResponse", "The API sent an unexpected Strava URL")),
        );
        setBusy(false);
        return;
      }
      redirect(url);
    } catch (failure) {
      setError(messageFor(failure));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.stravaDisconnect();
      setConfirming(false);
      props.onChanged();
    } catch (failure) {
      setError(messageFor(failure));
    }
    setBusy(false);
  };

  return (
    <Card title="Strava" headingId="h-strava">
      {error !== null && <Notice tone="error">{error}</Notice>}
      {props.connected ? (
        <>
          <p>Strava está conectado. Leemos tus carreras para contar los kilómetros.</p>
          {confirming ? (
            <div className="space-y-3 rounded-lg border border-red-400 bg-red-50 p-3">
              <p className="font-medium text-red-950">¿Desconectar Strava?</p>
              <p className="text-sm text-red-950">{REVOKE_SENTENCE}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={disconnect} disabled={busy}>
                  Sí, desconectar Strava
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                  No, mantener conectado
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Desconectar Strava
            </Button>
          )}
        </>
      ) : (
        <>
          <p>
            Para comprometerte, AgentHabit necesita ver tus carreras de Strava. Strava te pedirá
            permiso y volverás a esta página.
          </p>
          <Button onClick={connect} disabled={busy}>
            {busy ? "Abriendo Strava…" : "Conectar Strava"}
          </Button>
        </>
      )}
    </Card>
  );
}
