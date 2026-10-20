import { getPlan, type PlanId } from "../plans";

export type MediaKind = "photo" | "video";

export type QuotaRefusal =
  "album_full" | "video_limit_reached" | "video_too_long" | "file_too_large";

export type QuotaDecision = { ok: true } | { ok: false; reason: QuotaRefusal };

export interface QuotaInput {
  plan: PlanId;
  /** Media already stored for the event. */
  mediaCount: number;
  videoCount: number;
  kind: MediaKind;
  bytes: number;
  durationSeconds?: number | null;
}

/**
 * Pure quota rules (R1). The server is the authority: clients may call this to explain a
 * refusal early, but a client-side "ok" never grants anything.
 */
export function checkQuota(input: QuotaInput): QuotaDecision {
  const plan = getPlan(input.plan);

  if (input.mediaCount >= plan.maxMedia) {
    return { ok: false, reason: "album_full" };
  }

  if (input.kind === "video") {
    if (plan.maxVideos !== null && input.videoCount >= plan.maxVideos) {
      return { ok: false, reason: "video_limit_reached" };
    }
    if (input.bytes > plan.maxVideoBytes) {
      return { ok: false, reason: "file_too_large" };
    }
    if (input.durationSeconds != null && input.durationSeconds > plan.maxVideoSeconds) {
      return { ok: false, reason: "video_too_long" };
    }
  }

  return { ok: true };
}

/** Share of the media quota used, between 0 and 1. */
export function quotaUsage(plan: PlanId, mediaCount: number): number {
  const max = getPlan(plan).maxMedia;
  return Math.min(1, Math.max(0, mediaCount / max));
}
