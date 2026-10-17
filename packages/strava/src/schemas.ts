import { z } from "zod";

/**
 * Strava's responses, as `docs/integraciones/strava.md` (section 5) describes them. Every field
 * the docs do not guarantee is optional; unknown fields are stripped and never stored.
 */

/** `activity:read_all` is required: with `activity:read`, "Only You" runs would not count. */
export const REQUIRED_SCOPE = "activity:read_all";

/** Strava separates scopes with commas in some places and spaces in others: accept both. */
export function scopeList(scope: string): string[] {
  return scope.split(/[\s,]+/).filter((part) => part !== "");
}

const nonEmpty = z.string().min(1);
const epochSeconds = z.number().int().nonnegative();

export const TokenExchangeSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: nonEmpty,
  refresh_token: nonEmpty,
  expires_at: epochSeconds,
  expires_in: z.number().int(),
  // Required here (D2): without the accepted scope the connection is refused.
  scope: z.string(),
  // Only the id is kept: no name, city or photo (POL 6.4).
  athlete: z.object({ id: z.number().int().positive() }),
});

export const TokenRefreshSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: nonEmpty,
  refresh_token: nonEmpty,
  expires_at: epochSeconds,
  expires_in: z.number().int(),
});

/** Strava's documented error body. Anything that does not match is a passing error. */
export const FaultSchema = z.object({
  message: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.string().optional(),
        field: z.string().optional(),
        resource: z.string().optional(),
      }),
    )
    .optional(),
});

const nullableText = z.string().nullish();

export const SummaryActivitySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sport_type: z.string().optional(),
  distance: z.number().nonnegative().optional(),
  moving_time: z.number().int().nonnegative().optional(),
  // ISO 8601 with a zone (`Z` or an offset): converted to UTC epoch, never read as local time.
  start_date: z.iso.datetime({ offset: true }).optional(),
  trainer: z.boolean().optional(),
  manual: z.boolean().optional(),
  device_name: nullableText,
  upload_id: z.number().int().nullish(),
});

export const ActivityPageSchema = z.array(SummaryActivitySchema);

export type TokenExchange = z.infer<typeof TokenExchangeSchema>;
export type TokenRefresh = z.infer<typeof TokenRefreshSchema>;
export type SummaryActivity = z.infer<typeof SummaryActivitySchema>;
