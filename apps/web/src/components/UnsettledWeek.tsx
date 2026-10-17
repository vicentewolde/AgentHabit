import type { InstanceInfo, WeekView } from "@agenthabit/core";
import { formatKm, formatUsdc } from "../amounts.js";
import { canRelease, formatMoment } from "../time.js";
import { ReleaseBox } from "./ReleaseBox.js";
import { ExplorerLink, Notice } from "./ui.js";
import { UnregisteredNotice } from "./WeekCard.js";

/**
 * An earlier week whose deposit is still locked. Until `releaseOpensAt` it waits for the oracle
 * to settle it; from then on anyone, the owner included, can return it ("recuperar").
 */
export function UnsettledWeek(props: {
  readonly week: WeekView;
  readonly instance: InstanceInfo;
  readonly nowMs: number;
  readonly onChanged: () => void;
}) {
  const { week, instance } = props;
  const position = week.position;
  if (position === null) return null;

  return (
    <>
      <p className="text-sm text-slate-700">
        Semana del {formatMoment(week.startsAt)} al {formatMoment(week.endsAt)}
      </p>
      <p>
        Depósito de <strong>{formatUsdc(BigInt(position.amount))} USDC</strong> con una meta de{" "}
        <strong>{formatKm(position.goalM)} km</strong>. Sigue bloqueado: todavía no se liquida.
      </p>
      {position.commitTxHash === null ? (
        <UnregisteredNotice />
      ) : (
        <p>
          <ExplorerLink template={instance.explorerTxUrl} hash={position.commitTxHash} />
        </p>
      )}
      {canRelease(week, props.nowMs) ? (
        <ReleaseBox weekId={week.weekId} instance={instance} onDone={props.onChanged} />
      ) : (
        <Notice tone="info">
          Esperando la liquidación del oráculo, que puede hacerla desde el{" "}
          {formatMoment(week.settleOpensAt)}. Si no se liquida, podrás recuperar tu depósito desde
          el {formatMoment(week.releaseOpensAt)}.
        </Notice>
      )}
    </>
  );
}
