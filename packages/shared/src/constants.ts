/**
 * Constants shared by the web and the mobile apps, with no dependency at all (not even zod), so a
 * client component can import them without pulling the validation library into the browser bundle.
 */

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export const EVENT_TYPES = ["wedding", "birthday", "corporate", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Alphabet without ambiguous characters (no 0/o, 1/l/i) for public event codes (F-012). */
export const PUBLIC_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const PUBLIC_CODE_LENGTH = 10;

export const WELCOME_MESSAGE_MAX_LENGTH = 500;
export const EVENT_TITLE_MAX_LENGTH = 80;
export const DISPLAY_NAME_MAX_LENGTH = 100;
/** A guest's first name, optional (F-033). */
export const GUEST_NAME_MAX_LENGTH = 60;

/** Accent colors offered as one-tap choices; each keeps white text readable (WCAG AA). */
export const ACCENT_PRESETS = [
  "#6d4aff",
  "#be185d",
  "#1d4ed8",
  "#15803d",
  "#c2410c",
  "#334155",
] as const;
