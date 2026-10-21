import { getPlan, type PlanId } from "../plans";
import { parseEventDate } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpiryInput {
  plan: PlanId;
  /** Event calendar date, `YYYY-MM-DD`. */
  eventDate: string;
  /** When the plan was bought (required for the paid event plan). */
  purchasedAt?: Date;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * When an event's media are deleted (SPEC section 3, retention).
 * - free: 30 days after the event date, counting the event day itself;
 * - event: 12 months after the purchase;
 * - pro: `null`, because expiry follows the subscription (phase 8).
 */
export function computeExpiresAt(input: ExpiryInput): Date | null {
  const retention = getPlan(input.plan).retention;

  switch (retention.kind) {
    case "days_after_event":
      return new Date(parseEventDate(input.eventDate).getTime() + (retention.days + 1) * DAY_MS);
    case "months_after_purchase":
      if (!input.purchasedAt) {
        throw new Error("A purchase date is required to compute the expiry of a paid event");
      }
      return addMonths(input.purchasedAt, retention.months);
    case "while_subscribed":
      return null;
  }
}
