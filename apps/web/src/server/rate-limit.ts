import "server-only";
import { getServerEnv } from "@/config/env.server";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Sign-in requests: 5 per 15 minutes per IP address (S-003). */
export const LOGIN_RATE_LIMIT: RateLimitRule = { name: "login", limit: 5, windowSeconds: 15 * 60 };

/** Event creation: 10 per hour per account (S-003). */
export const EVENT_CREATION_RATE_LIMIT: RateLimitRule = {
  name: "event-creation",
  limit: 10,
  windowSeconds: 60 * 60,
};

/** Upload reservations: 60 per minute per guest and 1 000 per minute per event (S-003). */
export const GUEST_RESERVE_RATE_LIMIT: RateLimitRule = {
  name: "upload-reserve-guest",
  limit: 60,
  windowSeconds: 60,
};
export const EVENT_RESERVE_RATE_LIMIT: RateLimitRule = {
  name: "upload-reserve-event",
  limit: 1000,
  windowSeconds: 60,
};

/** Joining an event: 20 per hour per address. */
export const GUEST_JOIN_RATE_LIMIT: RateLimitRule = {
  name: "guest-join",
  limit: 20,
  windowSeconds: 60 * 60,
};

/**
 * Gallery requests: 240 per minute per guest, or per address for a share link. A screen of
 * thumbnails asks a handful of times when scrolling fast; this only stops scraping.
 */
export const GALLERY_RATE_LIMIT: RateLimitRule = {
  name: "gallery",
  limit: 240,
  windowSeconds: 60,
};

/** Leaving or withdrawing an e-mail address (F-044): 10 per hour per guest. */
export const NOTIFY_RATE_LIMIT: RateLimitRule = {
  name: "guest-notify",
  limit: 10,
  windowSeconds: 60 * 60,
};

/** Opening a payment page (SPEC 13): 10 per hour per organiser. */
export const CHECKOUT_RATE_LIMIT: RateLimitRule = {
  name: "checkout",
  limit: 10,
  windowSeconds: 60 * 60,
};

/** The copy of an account's data (G-004): 5 per hour per organiser, it reads a lot of rows. */
export const ACCOUNT_EXPORT_RATE_LIMIT: RateLimitRule = {
  name: "account-export",
  limit: 5,
  windowSeconds: 60 * 60,
};

/** Reporting photos (F-073): 20 per hour per person. */
export const REPORT_RATE_LIMIT: RateLimitRule = {
  name: "gallery-report",
  limit: 20,
  windowSeconds: 60 * 60,
};

/** Wrong access codes (S-006): 5 attempts per 10 minutes per address and event. */
export const ACCESS_CODE_RATE_LIMIT: RateLimitRule = {
  name: "access-code",
  limit: 5,
  windowSeconds: 10 * 60,
};

type Fetcher = typeof fetch;

const memoryWindows = new Map<string, { count: number; resetAt: number }>();
let warnedAboutMemoryFallback = false;

/** Fixed-window counter held in this server instance: a weak fallback when Upstash is absent. */
function checkInMemory(rule: RateLimitRule, key: string, now: number): RateLimitResult {
  const current = memoryWindows.get(key);
  if (!current || current.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: rule.windowSeconds };
  }
  current.count += 1;
  return {
    allowed: current.count <= rule.limit,
    remaining: Math.max(0, rule.limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

/** Fixed-window counter in Upstash Redis through its REST pipeline (INCR, EXPIRE NX, TTL). */
async function checkWithUpstash(
  rule: RateLimitRule,
  key: string,
  upstash: { url: string; token: string },
  fetcher: Fetcher,
): Promise<RateLimitResult> {
  const response = await fetcher(`${upstash.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${upstash.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, rule.windowSeconds, "NX"],
      ["TTL", key],
    ]),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Upstash answered ${response.status}`);

  const results = (await response.json()) as { result?: number; error?: string }[];
  const count = results[0]?.result;
  const ttl = results[2]?.result;
  if (typeof count !== "number") throw new Error(results[0]?.error ?? "Unexpected Upstash reply");

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: typeof ttl === "number" && ttl > 0 ? ttl : rule.windowSeconds,
  };
}

/** SHA-256 of the identifier, so no raw IP address is stored in Redis. */
async function hashIdentifier(identifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identifier));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface RateLimitDeps {
  fetcher?: Fetcher;
  now?: () => number;
}

/**
 * Counts one attempt for `identifier` (an IP address) against `rule` (S-003).
 * Uses Upstash Redis when configured. Without it, or if it is unreachable, falls back to a
 * per-instance counter and says so in the logs: the limit is then best-effort, not absent.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  identifier: string,
  deps: RateLimitDeps = {},
): Promise<RateLimitResult> {
  const { fetcher = fetch, now = Date.now } = deps;
  const env = getServerEnv();
  const key = `rl:${rule.name}:${await hashIdentifier(identifier)}`;

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await checkWithUpstash(
        rule,
        key,
        { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN },
        fetcher,
      );
    } catch (error) {
      console.error("[rate-limit] Upstash unreachable, using the in-memory fallback", error);
    }
  } else if (process.env.NODE_ENV === "production" && !warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true;
    console.warn("[rate-limit] Upstash is not configured: limits only hold per server instance");
  }
  return checkInMemory(rule, key, now());
}

/** Test helper: forgets every in-memory window. */
export function resetRateLimitMemory(): void {
  memoryWindows.clear();
  warnedAboutMemoryFallback = false;
}
