import type { InstanceInfo } from "@agenthabit/core";
import { useState } from "react";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { runRelease } from "../flows.js";
import { Button, ExplorerLink, Notice } from "./ui.js";

type Result =
  | { readonly kind: "none" }
  | { readonly kind: "working"; readonly waiting: boolean }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "done";
      readonly status: "SUCCESS" | "FAILED" | "PENDING";
      readonly hash: string;
    };

/** "Recuperar": shown only when the release window is open and the deposit is still locked. */
export function ReleaseBox(props: {
  readonly weekId: string;
  readonly instance: InstanceInfo;
  readonly onDone: () => void;
}) {
  const { api, wallet, session, poll } = useApp();
  const [result, setResult] = useState<Result>({ kind: "none" });

  const onClick = async () => {
    if (session === null) return;
    setResult({ kind: "working", waiting: false });
    try {
      const outcome = await runRelease({
        api,
        wallet,
        address: session.address,
        instance: props.instance,
        weekId: props.weekId,
        poll,
        onStep: (step) => {
          if (step === "confirming") setResult({ kind: "working", waiting: true });
        },
      });
      setResult({ kind: "done", status: outcome.status, hash: outcome.txHash });
    } catch (error) {
      setResult({ kind: "error", message: messageFor(error) });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-3">
      <p className="font-medium text-amber-950">Puedes recuperar tu depósito</p>
      <p className="text-sm text-amber-950">
        Esta semana no se liquidó a tiempo, y pasada la ventana el contrato permite devolver el
        depósito a su dueño. Al pulsar el botón, tu billetera te pide firmar y el dinero vuelve a tu
        billetera, no a otra.
      </p>
      {result.kind === "error" && <Notice tone="error">{result.message}</Notice>}
      {result.kind === "done" && (
        <Notice tone={result.status === "SUCCESS" ? "success" : "warning"}>
          {result.status === "SUCCESS" && "Listo: tu depósito volvió a tu billetera. "}
          {result.status === "FAILED" &&
            "La transacción falló en la cadena y no se movió tu depósito. Puedes intentarlo de nuevo. "}
          {result.status === "PENDING" &&
            "Enviamos la transacción pero aún no se confirma. Actualiza la página en un minuto. "}
          <ExplorerLink template={props.instance.explorerTxUrl} hash={result.hash} />
        </Notice>
      )}
      {result.kind === "done" && result.status === "SUCCESS" ? (
        // Reloading removes this box, so it waits for the reader to have seen the result.
        <Button variant="secondary" onClick={props.onDone}>
          Actualizar mi semana
        </Button>
      ) : (
        <Button onClick={onClick} disabled={result.kind === "working" || session === null}>
          {result.kind === "working"
            ? result.waiting
              ? "Esperando la confirmación…"
              : "Esperando tu firma…"
            : "Recuperar mi depósito"}
        </Button>
      )}
    </div>
  );
}
