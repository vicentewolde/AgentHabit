import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app-context.js";
import { StravaCard } from "../components/StravaCard.js";
import { Card } from "../components/ui.js";
import { REVOKE_SENTENCE } from "../copy.js";

/** The rules and the privacy notice, in plain language (spec T7). */
export function Rules() {
  const { session, api } = useApp();
  const [connected, setConnected] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    api
      .me()
      .then((me) => setConnected(me.stravaConnected))
      .catch(() => setConnected(null));
  }, [api]);

  useEffect(() => {
    if (session !== null) refresh();
  }, [session, refresh]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reglas y privacidad</h1>

      <Card title="Cómo funciona" headingId="r-how">
        <p>
          Bloqueas un monto en USDC en un contrato y fijas una meta semanal de kilómetros corridos.
          Solo puedes comprometer la semana que viene. Si cumples la meta, recuperas todo.
        </p>
      </Card>

      <Card title="Lo que se pierde no es de nadie" headingId="r-lost">
        <p>
          Si no cumples, el dinero queda bloqueado en el contrato para siempre. Nadie lo cobra: ni
          AgentHabit, ni otros usuarios. El contrato no tiene dueño, ni retiro, ni forma de
          cambiarlo.
        </p>
      </Card>

      <Card title="Qué carreras cuentan" headingId="r-runs">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Solo carreras de Strava, al aire libre: tipo “Carrera” (Run) o “Trail” (TrailRun).
          </li>
          <li>Grabadas por un dispositivo (reloj o teléfono).</li>
          <li>No cuentan las actividades manuales ni las de cinta.</li>
          <li>El ritmo debe ser humano: no más rápido que 2:30 min/km.</li>
          <li>No se aceptan carreras ingresadas a mano. Strava es la única fuente.</li>
        </ul>
      </Card>

      <Card title="Qué datos de Strava guardamos" headingId="r-data">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Guardamos tus carreras de la semana por <strong>7 días como máximo</strong>. Después
            solo queda el resultado: cumpliste o no.
          </li>
          <li>Nadie más ve tus datos: ni tus kilómetros, ni tu meta, ni tus carreras.</li>
          <li>
            Tus datos de Strava no se usan para entrenar ni alimentar ninguna inteligencia
            artificial.
          </li>
          <li>La web guarda tu sesión solo en esta pestaña; se borra al cerrarla.</li>
        </ul>
      </Card>

      <Card title="Si no se liquida la semana" headingId="r-stale">
        <p>
          Una vez al día un proceso del servicio cierra las semanas ya terminadas. Si ese proceso
          falla y no liquida tu semana, pasada una ventana de espera cualquiera puede devolver el
          depósito a su dueño. Cuando eso ocurre, en “Mi semana” aparece el botón “Recuperar mi
          depósito”.
        </p>
      </Card>

      <Card title="Revocar Strava cuenta como no cumplir" headingId="r-revoke">
        <p className="font-medium">{REVOKE_SENTENCE}</p>
        <p>
          Esto vale si desconectas Strava desde aquí, o si lo revocas desde la configuración de
          Strava. Sin esta regla, quien no cumple podría revocar el acceso y recuperar su depósito.
        </p>
        {session !== null && connected !== null && (
          <StravaCard connected={connected} onChanged={refresh} />
        )}
      </Card>
    </div>
  );
}
