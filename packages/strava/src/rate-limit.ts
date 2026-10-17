/**
 * Strava's read limits, from the `X-ReadRateLimit-*` headers: two integers, the 15-minute window
 * first and the daily one second (docs/integraciones/strava.md, section 6). Header names are
 * case-insensitive (`Headers.get` already is).
 */
export interface ReadLimit {
  readonly shortLimit: number;
  readonly shortUsage: number;
  readonly dailyLimit: number;
  readonly dailyUsage: number;
}

function pair(value: string | null): [number, number] | null {
  if (value === null) return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  const [first, second] = parts;
  if (
    parts.length !== 2 ||
    first === undefined ||
    second === undefined ||
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    second < 0
  ) {
    return null;
  }
  return [first, second];
}

/** The read limit a response reports, or null when its headers are missing or malformed. */
export function parseReadLimit(headers: Headers): ReadLimit | null {
  const limit = pair(headers.get("x-readratelimit-limit"));
  const usage = pair(headers.get("x-readratelimit-usage"));
  if (limit === null || usage === null) return null;
  return { shortLimit: limit[0], dailyLimit: limit[1], shortUsage: usage[0], dailyUsage: usage[1] };
}

/** True when either window is used up: the next read must wait for a later run. */
export function isExhausted(limit: ReadLimit): boolean {
  return limit.shortUsage >= limit.shortLimit || limit.dailyUsage >= limit.dailyLimit;
}
