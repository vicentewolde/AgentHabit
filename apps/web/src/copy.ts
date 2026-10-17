/**
 * The sentences that must say the same thing everywhere they appear (confirmation, rules page,
 * disconnect warning). Plain Spanish, no jargon.
 */

/** What happens if the goal is not met (spec T7, "una frase"). */
export function failureSentence(amountText: string): string {
  return `Si no cumples la meta de la semana, tus ${amountText} USDC quedan bloqueados en el contrato para siempre: nadie los cobra, ni AgentHabit ni otros usuarios.`;
}

export const FAILURE_SENTENCE_GENERIC =
  "Si no cumples la meta de la semana, el dinero queda bloqueado en el contrato para siempre: nadie lo cobra, ni AgentHabit ni otros usuarios.";

/** A-10: revoking counts as failing. */
export const REVOKE_SENTENCE =
  "Revocar el acceso de AgentHabit a Strava cuenta como no cumplir la meta: esa semana se pierde el depósito.";
