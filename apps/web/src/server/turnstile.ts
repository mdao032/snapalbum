import "server-only";
import { getServerEnv } from "@/config/env.server";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Checks a Cloudflare Turnstile token (S-012).
 * Returns true when the check is not configured (local development) or the token is valid.
 * A configured check fails closed: a missing token, a refusal or an unreachable Cloudflare is false.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const secret = getServerEnv().TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetcher(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    console.error("[turnstile] verification request failed", error);
    return false;
  }
}
