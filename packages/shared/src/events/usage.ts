import { getPlan, type PlanId } from "../plans";

export type UsageLevel = "ok" | "warning" | "full";

export interface EventUsage {
  /** Media allowed by the plan (photos and videos together). */
  quota: number;
  used: number;
  remaining: number;
  /** 0 to 100, rounded down so "100 %" only means the album is really full. */
  percent: number;
  level: UsageLevel;
  /** Videos allowed on this plan, `null` when only the media quota applies. */
  videoQuota: number | null;
}

/** Share of the quota from which the organiser is warned (SPEC section 3, rule R4). */
export const USAGE_WARNING_PERCENT = 80;

/** Quota figures of the dashboard (F-018), read from `plans.ts` and never hard-coded. */
export function computeEventUsage(input: { plan: PlanId; mediaCount: number }): EventUsage {
  const plan = getPlan(input.plan);
  const used = Math.max(0, input.mediaCount);
  const percent = Math.min(100, Math.floor((used / plan.maxMedia) * 100));
  const level: UsageLevel =
    used >= plan.maxMedia ? "full" : percent >= USAGE_WARNING_PERCENT ? "warning" : "ok";
  return {
    quota: plan.maxMedia,
    used,
    remaining: Math.max(0, plan.maxMedia - used),
    percent,
    level,
    videoQuota: plan.maxVideos,
  };
}
