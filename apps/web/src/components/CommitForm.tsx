import type { InstanceInfo, WeekView } from "@agenthabit/core";
import { type FormEvent, useId, useState } from "react";
import { type CommitFormErrors, formatKm, formatUsdc, validateCommit } from "../amounts.js";
import { describeError, reasonOf } from "../api/messages.js";
import { useApp } from "../app-context.js";
import { failureSentence, REVOKE_SENTENCE } from "../copy.js";
import { isWebError } from "../errors.js";
import { type CommitStep, runCommit, type TxOutcome } from "../flows.js";
import { formatMoment } from "../time.js";
import { Button, ExplorerLink, FaucetLink, Notice } from "./ui.js";

type Phase =
  | { readonly kind: "form" }
  | {
      readonly kind: "confirm";
      readonly amount: bigint;
      readonly goalM: number;
      /** The week as it was on screen when the user pressed "Continuar": what they confirm. */
      readonly week: WeekView;
    }
  | { readonly kind: "working"; readonly step: CommitStep }
  | { readonly kind: "done"; readonly outcome: TxOutcome; readonly amount: bigint };

const STEP_TEXT: Record<CommitStep, string> = {
  preparing: "Preparando la transacción…",
  signing: "Esperando tu firma en Freighter…",
  sending: "Enviando a la red de Stellar. Puede tardar hasta 30 segundos…",
  confirming: "Esperando la confirmación de la red. Puede tardar hasta un minuto…",
  recording: "Registrando tu compromiso…",
};

/** The commit form for next week: amount, goal, a plain confirmation, then the wallet signs. */
export function CommitForm(props: {
  readonly week: WeekView;
  readonly instance: InstanceInfo;
  readonly stravaConnected: boolean;
  readonly onDone: () => void;
  /** The week changed under the user: reload the weeks. */
  readonly onStale: () => void;
}) {
  const { api, wallet, session, poll } = useApp();
  const { instance } = props;
  const amountId = useId();
  const goalId = useId();
  const [amountText, setAmountText] = useState("");
  const [goalText, setGoalText] = useState("");
  const [errors, setErrors] = useState<CommitFormErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [failure, setFailure] = useState<{ message: string; faucet: boolean } | null>(null);

  const limits = {
    minAmount: BigInt(instance.minAmount),
    maxAmount: BigInt(instance.maxAmount),
    minGoalM: instance.minGoalM,
    maxGoalM: instance.maxGoalM,
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const checked = validateCommit(amountText, goalText, limits);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPhase({ kind: "confirm", amount: checked.amount, goalM: checked.goalM, week: props.week });
  };

  const sign = async (amount: bigint, goalM: number, weekId: string) => {
    if (session === null) return;
    setFailure(null);
    setPhase({ kind: "working", step: "preparing" });
    try {
      const outcome = await runCommit({
        api,
        wallet,
        address: session.address,
        instance,
        weekId,
        amount,
        goalM,
        poll,
        onStep: (step) => setPhase({ kind: "working", step }),
      });
      if (outcome.status === "FAILED") {
        setFailure({
          message:
            "La transacción falló en la cadena y no se bloqueó tu depósito. Revisa que tengas USDC de prueba y XLM para la comisión, e intenta de nuevo.",
          faucet: false,
        });
        setPhase({ kind: "form" });
        return;
      }
      setPhase({ kind: "done", outcome, amount });
      props.onDone();
    } catch (error) {
      setFailure(describeError(error));
      setPhase({ kind: "form" });
      // The dates on screen are stale: reload so the form shows the real next week.
      if ((isWebError(error) && error.code === "WeekChanged") || reasonOf(error) === "WrongWeek") {
        props.onStale();
      }
    }
  };

  if (phase.kind === "done") {
    const { outcome } = phase;
    return (
      <div className="space-y-3">
        {outcome.status === "SUCCESS" && outcome.mirrored && (
          <Notice tone="success">
            Listo: bloqueaste {formatUsdc(phase.amount)} USDC para la semana que viene. Tu
            compromiso ya aparece en tu panel.
          </Notice>
        )}
        {outcome.status === "SUCCESS" && !outcome.mirrored && (
          <Notice tone="warning">
            Tu depósito quedó en la cadena, pero todavía no aparece en tu panel. Actualiza la página
            en un minuto: lo registraremos solo.
          </Notice>
        )}
        {outcome.status === "PENDING" && (
          <Notice tone="warning">
            Enviamos tu transacción pero aún no se confirma. Actualiza la página en un minuto: si
            quedó confirmada, aparecerá en tu panel.
          </Notice>
        )}
        <p>
          <ExplorerLink template={instance.explorerTxUrl} hash={outcome.txHash} />
        </p>
      </div>
    );
  }

  if (phase.kind === "working") {
    return (
      <p role="status" aria-live="polite" className="py-4 text-center font-medium">
        {STEP_TEXT[phase.step]}
      </p>
    );
  }

  if (phase.kind === "confirm") {
    const shown = formatUsdc(phase.amount);
    return (
      <section className="space-y-4" aria-labelledby="confirm-title">
        <h3 id="confirm-title" className="text-lg font-semibold">
          Revisa antes de firmar
        </h3>
        <p>
          Vas a bloquear <strong>{shown} USDC</strong> con una meta de{" "}
          <strong>{formatKm(phase.goalM)} km</strong> entre el {formatMoment(phase.week.startsAt)} y
          el {formatMoment(phase.week.endsAt)}.
        </p>
        <div className="space-y-2 rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-950">
          <p className="font-medium">{failureSentence(shown)}</p>
          <p className="font-medium">{REVOKE_SENTENCE}</p>
        </div>
        <p className="text-sm text-slate-700">
          Si cumples, recuperas todo. Tu billetera te mostrará la transacción para que la firmes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void sign(phase.amount, phase.goalM, phase.week.weekId)}>
            Entiendo, firmar y bloquear
          </Button>
          <Button variant="secondary" onClick={() => setPhase({ kind: "form" })}>
            Volver
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p>
        Solo se puede comprometer la semana que viene: del {formatMoment(props.week.startsAt)} al{" "}
        {formatMoment(props.week.endsAt)}.
      </p>
      {!props.stravaConnected && (
        <Notice tone="warning">
          Primero conecta Strava (arriba). Sin Strava no podemos contar tus kilómetros y perderías
          el depósito.
        </Notice>
      )}
      {failure !== null && (
        <Notice tone="error">
          {failure.message}
          {failure.faucet && <FaucetLink />}
        </Notice>
      )}

      <div>
        <label htmlFor={amountId} className="block font-medium">
          Monto a bloquear (USDC)
        </label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
          aria-describedby={`${amountId}-hint`}
          aria-invalid={errors.amount !== undefined}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-500 px-3"
        />
        <p id={`${amountId}-hint`} className="mt-1 text-sm text-slate-700">
          Entre {formatUsdc(limits.minAmount)} y {formatUsdc(limits.maxAmount)} USDC.
        </p>
        {errors.amount !== undefined && (
          <p role="alert" className="mt-1 text-sm font-medium text-red-800">
            {errors.amount}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={goalId} className="block font-medium">
          Meta de la semana (km)
        </label>
        <input
          id={goalId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={goalText}
          onChange={(event) => setGoalText(event.target.value)}
          aria-describedby={`${goalId}-hint`}
          aria-invalid={errors.goal !== undefined}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-500 px-3"
        />
        <p id={`${goalId}-hint`} className="mt-1 text-sm text-slate-700">
          Entre {formatKm(limits.minGoalM)} y {formatKm(limits.maxGoalM)} km.
        </p>
        {errors.goal !== undefined && (
          <p role="alert" className="mt-1 text-sm font-medium text-red-800">
            {errors.goal}
          </p>
        )}
      </div>

      <Button type="submit" disabled={!props.stravaConnected}>
        Continuar
      </Button>
    </form>
  );
}
