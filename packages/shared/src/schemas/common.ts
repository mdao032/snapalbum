import { z } from "zod";
import {
  DEFAULT_LOCALE,
  EVENT_TYPES,
  LOCALES,
  PUBLIC_CODE_ALPHABET,
  PUBLIC_CODE_LENGTH,
  type EventType,
  type Locale,
} from "../constants";

export { DEFAULT_LOCALE, EVENT_TYPES, LOCALES, PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH };
export type { EventType, Locale };
export const localeSchema = z.enum(LOCALES);

export const eventTypeSchema = z.enum(EVENT_TYPES);

export const publicCodeSchema = z
  .string()
  .regex(new RegExp(`^[${PUBLIC_CODE_ALPHABET}]{${PUBLIC_CODE_LENGTH},}$`), "Invalid event code");

export const accentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color");

export const uuidSchema = z.uuid();

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Invalid SHA-256 digest");
