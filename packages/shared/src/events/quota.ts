import { getPlan } from "../plans";

export type EventCreationDecision = { ok: true } | { ok: false; reason: "free_event_limit" };

/**
 * An organiser may keep a limited number of active free events at once (`plans.ts`).
 * Checked on the server when an event is created; the client only mirrors it for comfort.
 */
export function checkEventCreationQuota(input: {
  activeFreeEvents: number;
}): EventCreationDecision {
  const max = getPlan("free").maxActiveEvents;
  if (max !== null && input.activeFreeEvents >= max) {
    return { ok: false, reason: "free_event_limit" };
  }
  return { ok: true };
}
