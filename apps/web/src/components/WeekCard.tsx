import type { InstanceInfo, WeekView } from "@agenthabit/core";
import { formatKm, formatUsdc } from "../amounts.js";
import { canRelease, describeDaysLeft, formatMoment } from "../time.js";
import { ReleaseBox } from "./ReleaseBox.js";
import { ExplorerLink, Notice } from "./ui.js";

type Position = NonNullable<WeekView["position"]>;

const STATE_TEXT: Record<Position["state"], string> = {
  Active: "Activo: tu depósito está bloqueado hasta que se cierre la semana.",
  Returned: "Cumpliste la meta: tu depósito volvió a tu billetera.",
  Forfeited:
    "No cumpliste la meta: el depósito quedó bloqueado en el contrato para siempre. Nadie lo cobra.",
  ReleasedStale:
    "La semana no se cerró a tiempo, así que el contrato devolvió tu depósito a tu billetera.",
};

function Progress(props: { readonly totalM: number; readonly goalM: number }) {
  const percent =
    props.goalM > 0 ? Math.min(100, Math.floor((props.totalM / props.goalM) * 100)) : 0;
  return (
    <div>
      <p className="mb-1 text-lg font-semibold">
        {formatKm(props.totalM)} de {formatKm(props.goalM)} km
      </p>
      <div
        role="progressbar"
        aria-label="Kilómetros corridos esta semana"
        aria-valuemin={0}
        aria-valuemax={props.goalM}
        aria-valuenow={Math.min(props.totalM, props.goalM)}
        aria-valuetext={`${formatKm(props.totalM)} de ${formatKm(props.goalM)} kilómetros`}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full bg-emerald-700" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** One week as its owner sees it: the position, the km, the days left and the way out. */
export function WeekCard(props: {
  readonly week: WeekView;
  readonly instance: InstanceInfo;
  readonly nowMs: number;
  readonly kind: "current" | "next";
  readonly onChanged: () => void;
}) {
  const { week, instance } = props;
  const position = week.position;

  return (
    <>
      <p className="text-sm text-slate-700">
        Del {formatMoment(week.startsAt)} al {formatMoment(week.endsAt)}
      </p>

      {position === null ? (
        <p>
          No tienes un compromiso esta semana.
          {props.kind === "current" &&
            " Solo se puede comprometer la semana que viene, así nadie fija su meta con los kilómetros ya corridos."}
        </p>
      ) : (
        <>
          <p>
            Depósito de <strong>{formatUsdc(BigInt(position.amount))} USDC</strong> con una meta de{" "}
            <strong>{formatKm(position.goalM)} km</strong>.
          </p>
          <p>{STATE_TEXT[position.state]}</p>
          {props.kind === "current" && position.state === "Active" && (
            <>
              {week.totalM === null ? (
                <p className="text-slate-700">
                  Todavía no tenemos una lectura de tus carreras. Conecta Strava para ver tus
                  kilómetros.
                </p>
              ) : (
                <>
                  <Progress totalM={week.totalM} goalM={position.goalM} />
                  {week.readAt !== null && (
                    <p className="text-sm text-slate-700">
                      Leído desde Strava: {formatMoment(week.readAt)}
                    </p>
                  )}
                </>
              )}
              <p className="font-medium">{describeDaysLeft(week.endsAt, props.nowMs)}</p>
            </>
          )}
          {position.commitTxHash === null ? (
            position.state === "Active" && (
              <Notice tone="warning">
                Tu compromiso ya está en la cadena, pero todavía no quedó registrado en AgentHabit.
                Lo seguimos intentando cada vez que abres o actualizas esta página; mantén esta
                pestaña abierta o vuelve en un rato. Hasta que se registre, tu semana no se puede
                liquidar.
              </Notice>
            )
          ) : (
            <p>
              <ExplorerLink template={instance.explorerTxUrl} hash={position.commitTxHash} />
            </p>
          )}
          {canRelease(week, props.nowMs) && (
            <ReleaseBox weekId={week.weekId} onDone={props.onChanged} instance={instance} />
          )}
        </>
      )}
    </>
  );
}
