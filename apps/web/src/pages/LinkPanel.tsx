import { useState } from "react";
import { messageFor } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { Button, Card, Notice } from "../components/ui.js";
import { FAILURE_SENTENCE_GENERIC } from "../copy.js";

/** Step 1: connect Freighter and sign the link message. */
export function LinkPanel() {
  const { link, sessionLost } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await link();
    } catch (failure) {
      setError(messageFor(failure));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {sessionLost && (
        <Notice tone="warning">
          Tu sesión terminó. Vincula tu billetera de nuevo para seguir.
        </Notice>
      )}
      <Card title="Compromete tus kilómetros" headingId="h-intro">
        <p>
          Bloqueas un monto en USDC y fijas una meta de kilómetros corridos para la semana. Strava
          verifica tus carreras. Si cumples, recuperas todo.
        </p>
        <p>{FAILURE_SENTENCE_GENERIC}</p>
        <p className="text-sm text-slate-700">
          Para empezar, conecta tu billetera Freighter y firma un mensaje. Firmar el mensaje no
          mueve dinero ni cuesta nada.
        </p>
        {error !== null && <Notice tone="error">{error}</Notice>}
        <Button onClick={onClick} disabled={busy}>
          {busy ? "Esperando a Freighter…" : "Conectar Freighter y vincular"}
        </Button>
      </Card>
    </div>
  );
}
