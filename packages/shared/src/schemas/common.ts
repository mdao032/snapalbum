import { z } from "zod";

export const LOCALES = ["fr", "en"] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export const EVENT_TYPES = ["wedding", "birthday", "corporate", "other"] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = (typeof EVENT_TYPES)[number];

/** Alphabet without ambiguous characters (no 0/o, 1/l/i) for public event codes (F-012). */
export const PUBLIC_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const PUBLIC_CODE_LENGTH = 10;

export const publicCodeSchema = z
  .string()
  .regex(new RegExp(`^[${PUBLIC_CODE_ALPHABET}]{${PUBLIC_CODE_LENGTH},}$`), "Invalid event code");

export const accentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color");

export const uuidSchema = z.uuid();

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Invalid SHA-256 digest");
