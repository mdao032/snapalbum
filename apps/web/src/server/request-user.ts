import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/config/env";
import { createSupabaseServerClient } from "./supabase/server";

/** A failure of the Auth server itself (overload, outage, network), as opposed to a refused token. */
function isAuthServerTrouble(error: { status?: number; name?: string }): boolean {
  if (typeof error.status === "number" && (error.status === 429 || error.status >= 500))
    return true;
  return error.name === "AuthRetryableFetchError";
}

export interface RequestUser {
  id: string;
  isAnonymous: boolean;
}

/**
 * Bearer tokens already verified by the Auth server, kept briefly so a burst of calls from one
 * app does not turn into a burst of calls to the Auth server (load test of phase 2: 300 guests
 * overloaded it). What makes this safe:
 * - only a token the Auth server accepted is stored, never a failure;
 * - the key is the SHA-256 of the whole token, so a forged token cannot match an entry and the
 *   token itself is not kept in memory;
 * - an entry never outlives the token's own expiry, and lives at most `TOKEN_CACHE_TTL_MS`: a
 *   revoked token or deleted account is accepted for one minute at most;
 * - the size is bounded, the oldest entry goes first.
 * Only Bearer tokens are cached; the web's cookie session is verified on every call.
 */
export const TOKEN_CACHE_TTL_MS = 60_000;
export const TOKEN_CACHE_MAX_ENTRIES = 5_000;
const verified = new Map<string, { user: RequestUser; expiresAt: number }>();

const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");

/** The `exp` claim in milliseconds, or Infinity when unreadable (the TTL then bounds the entry). */
function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return typeof payload.exp === "number" ? payload.exp * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

function remember(token: string, user: RequestUser) {
  const expiresAt = Math.min(Date.now() + TOKEN_CACHE_TTL_MS, tokenExpiry(token));
  if (expiresAt <= Date.now()) return;
  if (verified.size >= TOKEN_CACHE_MAX_ENTRIES) {
    const oldest = verified.keys().next().value;
    if (oldest !== undefined) verified.delete(oldest);
  }
  verified.set(tokenKey(token), { user, expiresAt });
}

/** For tests: forget everything verified so far. */
export function clearTokenCache() {
  verified.clear();
}

/**
 * Who calls an API route: the web sends its session cookie, the mobile apps and the App Clip send
 * `Authorization: Bearer <access token>` (`packages/shared` API client). Either way the token is
 * checked with the Auth server (`getUser`), never just decoded, so it cannot be forged.
 */
export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const header = request.headers.get("authorization");
  const token = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1];

  if (token) {
    const hit = verified.get(tokenKey(token));
    if (hit && hit.expiresAt > Date.now()) return hit.user;
  }

  const client = token
    ? createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : await createSupabaseServerClient();

  const { data, error } = token ? await client.auth.getUser(token) : await client.auth.getUser();
  if (error && isAuthServerTrouble(error)) {
    // The Auth server is overloaded or unreachable: that says nothing about the caller. Answering
    // "unauthorized" would make a guest believe their session is gone; fail instead, and the
    // client tries again later (a 5xx is retried, never given up on).
    throw new Error(`Auth server unavailable: ${error.message}`);
  }
  if (error || !data.user) return null;
  const user = { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
  if (token) remember(token, user);
  return user;
}
