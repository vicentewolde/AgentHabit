import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { Button, Loading, Notice } from "../components/ui.js";

/**
 * What Strava put in the URL (A-19). `code` is a one-time credential: it is read once, removed
 * from the address bar at once, forwarded to the API and never logged or stored.
 */
const ReturnedSchema = z.object({
  code: z.string().min(1).max(200),
  scope: z.string().max(200),
  state: z.string().regex(/^[0-9a-f]{32}$/),
});
export type StravaReturn =
  | {
      readonly kind: "granted";
      readonly code: string;
      readonly scope: string;
      readonly state: string;
    }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" };

/**
 * Reads Strava's answer from `window.location` and strips the query string from the address bar
 * and the history entry in the same breath. Call it once, before the first render.
 */
export function takeStravaReturn(): StravaReturn {
  const params = new URLSearchParams(window.location.search);
  window.history.replaceState(null, "", window.location.pathname);
  if (params.get("error") !== null) return { kind: "denied" };
  const parsed = ReturnedSchema.safeParse({
    code: params.get("code") ?? "",
    scope: params.get("scope") ?? "",
    state: params.get("state") ?? "",
  });
  return parsed.success ? { kind: "granted", ...parsed.data } : { kind: "invalid" };
}

type Result =
  | { readonly kind: "working" }
  | { readonly kind: "connected" }
  | { readonly kind: "error"; readonly message: string };

export function StravaCallback(props: {
  readonly returned: StravaReturn;
  readonly navigate: (path: string) => void;
}) {
  const { api, session, sessionLost } = useApp();
  const { returned } = props;
  const [result, setResult] = useState<Result>({ kind: "working" });
  // A re-render or Strict Mode must not spend the one-time code twice.
  const sent = useRef(false);

  useEffect(() => {
    if (returned.kind !== "granted" || session === null || sent.current) return;
    sent.current = true;
    api
      .stravaCallback({ code: returned.code, scope: returned.scope, state: returned.state })
      .then(() => setResult({ kind: "connected" }))
      .catch((error: unknown) => setResult({ kind: "error", message: messageFor(error) }));
  }, [api, returned, session]);

  const home = (
    <Button onClick={() => props.navigate("/")} className="mt-2">
      Volver a mi semana
    </Button>
  );

  if (returned.kind === "denied") {
    return (
      <div className="space-y-3">
        <Notice tone="warning">
          No diste permiso en Strava, así que no se conectó. Puedes intentarlo otra vez desde
          “Conectar Strava”.
        </Notice>
        {home}
      </div>
    );
  }
  if (returned.kind === "invalid") {
    return (
      <div className="space-y-3">
        <Notice tone="error">
          La respuesta de Strava no se entiende. Vuelve a empezar desde “Conectar Strava”.
        </Notice>
        {home}
      </div>
    );
  }
  if (session === null) {
    return (
      <div className="space-y-3">
        <Notice tone="warning">
          {sessionLost
            ? "Tu sesión terminó mientras estabas en Strava. "
            : "No encontramos tu sesión: se pierde al cerrar la pestaña. "}
          Vincula tu billetera de nuevo y vuelve a pulsar “Conectar Strava”: el permiso que diste
          pertenece a la billetera que lo pidió, y esta vez no se puede completar.
        </Notice>
        {home}
      </div>
    );
  }
  if (result.kind === "working") return <Loading label="Conectando Strava…" />;
  if (result.kind === "error") {
    return (
      <div className="space-y-3">
        <Notice tone="error">{result.message}</Notice>
        {home}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Notice tone="success">Listo: Strava quedó conectado a tu billetera.</Notice>
      {home}
    </div>
  );
}
