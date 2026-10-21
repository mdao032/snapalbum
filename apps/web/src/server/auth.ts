import "server-only";
import {
  defaultAfterLoginPath,
  magicLinkRequestSchema,
  profileUpdateSchema,
  sanitizeRedirectPath,
  type Locale,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { checkRateLimit, LOGIN_RATE_LIMIT } from "./rate-limit";
import { verifyTurnstileToken } from "./turnstile";

type Client = SupabaseClient<Database>;
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type MagicLinkError = "invalid_email" | "captcha_failed" | "rate_limited" | "send_failed";
export type MagicLinkResult = { ok: true; email: string } | { ok: false; error: MagicLinkError };

/**
 * Link that the e-mail template appends `token_hash` to. It is also what the OAuth flow comes
 * back to: `/auth/confirm` is the single place where a sign-in becomes a session.
 */
export function buildConfirmUrl(siteUrl: string, locale: Locale, next: string | undefined): string {
  const url = new URL("/auth/confirm", siteUrl);
  url.searchParams.set("next", sanitizeRedirectPath(next, defaultAfterLoginPath(locale)));
  url.searchParams.set("locale", locale);
  return url.toString();
}

function isRateLimitError(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === "over_email_send_rate_limit";
}

/**
 * Sends a sign-in link (F-001). Order matters: the cheap checks run first so that a robot cannot
 * make the server call Cloudflare or Supabase at will (S-003, S-012).
 */
export async function requestMagicLink(
  supabase: Client,
  rawInput: unknown,
  context: { ip: string | undefined; siteUrl: string },
): Promise<MagicLinkResult> {
  const parsed = magicLinkRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid_email" };
  const { email, locale, next, turnstileToken } = parsed.data;

  const limit = await checkRateLimit(LOGIN_RATE_LIMIT, context.ip ?? "unknown");
  if (!limit.allowed) return { ok: false, error: "rate_limited" };

  if (!(await verifyTurnstileToken(turnstileToken, context.ip))) {
    return { ok: false, error: "captcha_failed" };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: buildConfirmUrl(context.siteUrl, locale, next),
      shouldCreateUser: true,
      // Read by the e-mail template (language) and by the profile trigger (preferred language).
      data: { locale },
    },
  });
  if (error) {
    return { ok: false, error: isRateLimitError(error) ? "rate_limited" : "send_failed" };
  }
  return { ok: true, email };
}

/** Starts the Google sign-in (F-002): returns the address of Google's consent screen. */
export async function startGoogleSignIn(
  supabase: Client,
  input: { locale: Locale; next: string | undefined; siteUrl: string },
): Promise<{ ok: true; url: string } | { ok: false }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: buildConfirmUrl(input.siteUrl, input.locale, input.next),
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return { ok: false };
  return { ok: true, url: data.url };
}

/**
 * The signed-in organiser, or null. Anonymous guest sessions (F-035) are signed-in sessions for
 * Supabase but never organisers. `getUser` asks the Auth server, so the answer cannot be forged
 * by editing a cookie.
 */
export async function getOrganiser(supabase: Client): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) return null;
  return data.user;
}

/**
 * For pages and layouts of the `(app)` group: the signed-in organiser, or a redirect to the login
 * page. The proxy already turns visitors away; this is the check that cannot be skipped.
 */
export async function requireOrganiser(locale: Locale): Promise<{ supabase: Client; user: User }> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return redirect({ href: "/login", locale });
  return { supabase, user };
}

export async function getProfile(supabase: Client, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Saves the "My account" form (F-003). RLS limits the writable columns to name and language. */
export async function updateProfile(
  supabase: Client,
  userId: string,
  rawInput: unknown,
): Promise<{ ok: true; locale: Locale } | { ok: false; error: "invalid" | "failed" }> {
  const parsed = profileUpdateSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName, locale: parsed.data.locale })
    .eq("user_id", userId)
    .select("user_id");
  // RLS turns a refused update into zero rows rather than an error.
  if (error || !data || data.length === 0) return { ok: false, error: "failed" };
  return { ok: true, locale: parsed.data.locale };
}
