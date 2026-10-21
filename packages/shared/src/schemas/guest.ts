import { z } from "zod";
import { GUEST_NAME_MAX_LENGTH } from "../constants";
import { publicCodeSchema, uuidSchema } from "./common";

/** Version of the terms a guest accepts (F-034). Bump it when the text changes. */
export const TERMS_VERSION = "2026-10";

/** The optional access code of an event: 4 to 6 digits (F-017). */
export const accessCodeSchema = z.string().regex(/^\d{4,6}$/, "Invalid access code");

/**
 * `POST /api/guests/join` body (SPEC 8.1, F-033 to F-035): a guest joins an event on their first
 * action. The name is optional, the terms must be accepted, the code is asked only when the
 * organiser set one.
 */
export const joinEventRequestSchema = z.object({
  eventCode: publicCodeSchema,
  displayName: z
    .string()
    .trim()
    .max(GUEST_NAME_MAX_LENGTH)
    .optional()
    .transform((value) => value || undefined),
  acceptTerms: z.literal(true),
  accessCode: accessCodeSchema.optional(),
  /** Cloudflare Turnstile token (S-012), present when the widget is configured. */
  turnstileToken: z.string().max(4096).optional(),
});
export type JoinEventRequest = z.input<typeof joinEventRequestSchema>;

export const joinEventResponseSchema = z.object({
  guestId: uuidSchema,
  displayName: z.string().nullable(),
  /**
   * Set when this call opened a new anonymous session: the apps keep these tokens (the web gets
   * the same session as cookies). Null when the caller already had a session.
   */
  session: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresAt: z.number().int().nullable(),
    })
    .nullable(),
});
export type JoinEventResponse = z.infer<typeof joinEventResponseSchema>;
