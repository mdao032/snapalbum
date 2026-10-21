import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "../constants";
import { localeSchema } from "../schemas/common";

export { DISPLAY_NAME_MAX_LENGTH };

/** Sign-in with a magic link (F-001). The address is normalised so one person has one account. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  locale: localeSchema,
  /** Page asked before the login screen; sanitised by the server before use. */
  next: z.string().max(512).optional(),
  /** Cloudflare Turnstile token (S-012), present when the widget is configured. */
  turnstileToken: z.string().max(4096).optional(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** "My account" form (F-003): the only profile fields an organiser may change (RLS enforces it too). */
export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(DISPLAY_NAME_MAX_LENGTH)
    .transform((value) => (value === "" ? null : value)),
  locale: localeSchema,
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Why a login attempt ended on the login page, passed as `?error=` (validated before display). */
export const LOGIN_ERROR_CODES = ["link_expired", "oauth_failed"] as const;
export const loginErrorSchema = z.enum(LOGIN_ERROR_CODES);
export type LoginErrorCode = z.infer<typeof loginErrorSchema>;
