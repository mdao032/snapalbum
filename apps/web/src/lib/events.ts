import { BRAND_COLORS } from "@snapalbum/shared/brand";
import type { Database } from "@snapalbum/shared/db-types";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

/** What the organiser sees as an event's state: "expired" is derived, not stored. */
export type EventDisplayStatus = "active" | "expired" | "suspended" | "pending_deletion";

export function eventDisplayStatus(
  event: Pick<EventRow, "status" | "expires_at">,
  now: Date,
): EventDisplayStatus {
  if (event.status === "suspended" || event.status === "pending_deletion") return event.status;
  if (event.expires_at && Date.parse(event.expires_at) <= now.getTime()) return "expired";
  return "active";
}

/** `2026-09-12` as a long date in the viewer's language. Calendar dates carry no time zone. */
export function formatEventDate(eventDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${eventDate}T00:00:00Z`),
  );
}

/** The CSS background of the default cover, drawn from the event's accent color. */
export function defaultCoverBackground(accentColor: string | null): string {
  const base = accentColor ?? BRAND_COLORS.primary;
  return `linear-gradient(135deg, ${base} 0%, color-mix(in srgb, ${base} 45%, ${BRAND_COLORS.warm}) 100%)`;
}

/** Today's calendar date, `YYYY-MM-DD` (UTC), the default of the creation form. */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** An instant as a long calendar date in the viewer's language (UTC, like event dates). */
export function formatInstantDate(instant: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

const BYTE_UNITS = {
  fr: ["o", "Ko", "Mo", "Go", "To"],
  en: ["B", "KB", "MB", "GB", "TB"],
} as const;

/** `1536` as "1,5 Ko" / "1.5 KB": binary steps, one decimal from the megabyte up. */
export function formatBytes(bytes: number, locale: string): string {
  const units = locale === "en" ? BYTE_UNITS.en : BYTE_UNITS.fr;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 2 ? 1 : 0;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
  return `${number}\u00a0${units[unit]}`;
}
