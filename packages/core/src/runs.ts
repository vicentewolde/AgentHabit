import type { WeekParams } from "./week.js";
import { weekEnd } from "./week.js";

/**
 * Which Strava activities count toward a week, and how they add up (spec 4.5). Pure domain:
 * `packages/strava` parses the API response with zod and hands over this shape; nothing here
 * knows about HTTP. Every field but `id` is optional, as in the API (spec 4.8).
 */
export interface ActivitySummary {
  /** Strava's int64 id, kept as a decimal string: it can exceed 2^53. */
  readonly id: string;
  readonly sportType?: string;
  /** Metres, fractional. */
  readonly distanceM?: number;
  /** Seconds. */
  readonly movingTimeS?: number;
  /** `start_date`, in UTC. Never `start_date_local`, which moves with the athlete's time zone. */
  readonly startDate?: Date;
  readonly trainer?: boolean;
  readonly manual?: boolean;
  readonly deviceName?: string | null;
  readonly uploadId?: string | null;
}

/** Why an activity does not count. One reason per activity: the first rule it breaks. */
export type RejectionReason =
  | "outside_week"
  | "not_a_run"
  | "trainer"
  | "manual"
  | "no_device"
  | "no_distance_or_time"
  | "too_fast";

/**
 * The field a filter needs and Strava did not send. Such an activity can neither count nor be
 * ruled out, so the whole reading is incomplete (A-17): the position is skipped, and if it never
 * settles it is released to its owner. A verifier gap never costs the user (spec 4.6).
 */
export type MissingField = "start_date" | "sport_type" | "manual" | "distance" | "moving_time";

export type ActivityVerdict =
  | { readonly kind: "counted" }
  | { readonly kind: "rejected"; readonly reason: RejectionReason }
  | { readonly kind: "incomplete"; readonly missing: MissingField };

/** Only outdoor and trail runs count; `VirtualRun` is a different value and does not (A-9). */
export const COUNTED_SPORT_TYPES: ReadonlySet<string> = new Set(["Run", "TrailRun"]);

/**
 * The fastest pace that still counts: 2:30 min/km, i.e. 150 seconds per kilometre. Anything
 * faster is a car or a bike labelled as a run.
 */
export const FASTEST_PACE_S_PER_KM = 150;

/** The first second of week `w`: `week_anchor + w · week_len`. */
export function weekStart(weekId: bigint, params: WeekParams): bigint {
  return params.weekAnchor + weekId * params.weekLen;
}

const counted: ActivityVerdict = { kind: "counted" };
const rejected = (reason: RejectionReason): ActivityVerdict => ({ kind: "rejected", reason });
const incomplete = (missing: MissingField): ActivityVerdict => ({ kind: "incomplete", missing });

/** Whether `activity` counts for week `weekId`, the first rule it breaks, or what is missing. */
export function judgeActivity(
  activity: ActivitySummary,
  weekId: bigint,
  params: WeekParams,
): ActivityVerdict {
  const start = activity.startDate;
  if (start === undefined || Number.isNaN(start.getTime())) return incomplete("start_date");
  // The window is half-open, [week_start, week_end), in whole seconds of UTC.
  const startS = BigInt(Math.floor(start.getTime() / 1000));
  if (startS < weekStart(weekId, params) || startS >= weekEnd(weekId, params)) {
    return rejected("outside_week");
  }
  if (activity.sportType === undefined) return incomplete("sport_type");
  if (!COUNTED_SPORT_TYPES.has(activity.sportType)) return rejected("not_a_run");
  // Spec 4.5 excludes `trainer = true`; a missing flag is not a treadmill.
  if (activity.trainer === true) return rejected("trainer");
  if (activity.manual === undefined) return incomplete("manual");
  if (activity.manual) return rejected("manual");
  // No device name and no upload id is a real answer, not a gap: the run was typed in.
  if (!hasText(activity.deviceName) && !hasText(activity.uploadId)) return rejected("no_device");

  const distance = activity.distanceM;
  const movingTime = activity.movingTimeS;
  if (distance === undefined || !Number.isFinite(distance)) return incomplete("distance");
  if (movingTime === undefined || !Number.isFinite(movingTime)) return incomplete("moving_time");
  if (distance <= 0 || movingTime <= 0) return rejected("no_distance_or_time");
  // Pace with moving time: seconds per km = movingTime / (distance / 1000). Compared without
  // dividing, so a tiny distance cannot round its way through.
  if (movingTime * 1000 < FASTEST_PACE_S_PER_KM * distance) return rejected("too_fast");
  return counted;
}

export interface WeekTotal {
  /** Whole metres: each counted run is truncated to the metre before summing. */
  readonly totalM: bigint;
  /** The ids that make up the total, in input order. Strava data: kept at most 7 days. */
  readonly countedIds: readonly string[];
  readonly rejected: readonly { readonly id: string; readonly reason: RejectionReason }[];
  /** Activities that could not be judged. Any entry makes the total unusable for `settle`. */
  readonly incomplete: readonly { readonly id: string; readonly missing: MissingField }[];
}

/**
 * Adds up the valid runs of week `weekId`. An activity listed twice (pages overlapping while the
 * athlete uploads) counts once.
 */
export function weekTotal(
  activities: readonly ActivitySummary[],
  weekId: bigint,
  params: WeekParams,
): WeekTotal {
  const seen = new Set<string>();
  const countedIds: string[] = [];
  const rejectedList: { id: string; reason: RejectionReason }[] = [];
  const incompleteList: { id: string; missing: MissingField }[] = [];
  let totalM = 0n;

  for (const activity of activities) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    const verdict = judgeActivity(activity, weekId, params);
    if (verdict.kind === "rejected") {
      rejectedList.push({ id: activity.id, reason: verdict.reason });
    } else if (verdict.kind === "incomplete") {
      incompleteList.push({ id: activity.id, missing: verdict.missing });
    } else {
      // A counted run has a positive, finite distance.
      totalM += BigInt(Math.floor(activity.distanceM ?? 0));
      countedIds.push(activity.id);
    }
  }

  return { totalM, countedIds, rejected: rejectedList, incomplete: incompleteList };
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}
