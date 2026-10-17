import type { WeekView } from "@agenthabit/core";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until `endsAt`, rounded up, never below 0. */
export function daysLeft(endsAt: string, nowMs: number): number {
  const remaining = Date.parse(endsAt) - nowMs;
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

/** "Quedan 3 días", "Termina hoy" or "La semana ya terminó". */
export function describeDaysLeft(endsAt: string, nowMs: number): string {
  if (Date.parse(endsAt) <= nowMs) return "La semana ya terminó";
  const days = daysLeft(endsAt, nowMs);
  if (days <= 1) return "Termina hoy o mañana: queda menos de un día";
  return `Quedan ${days} días`;
}

/** The release button rule (spec T7): the window is open and the deposit is still locked. */
export function canRelease(week: WeekView, nowMs: number): boolean {
  return week.position?.state === "Active" && Date.parse(week.releaseOpensAt) <= nowMs;
}

const dateTime = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** A moment in the reader's own time zone. */
export function formatMoment(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : dateTime.format(ms);
}
