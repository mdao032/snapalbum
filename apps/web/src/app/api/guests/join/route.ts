import { joinEventRequestSchema } from "@snapalbum/shared";
import { apiError, apiJson, guarded, parseBody } from "@/server/api-response";
import { clientIpFrom } from "@/server/client-ip";
import { joinEvent } from "@/server/guests";
import { ACCESS_CODE_RATE_LIMIT, checkRateLimit, GUEST_JOIN_RATE_LIMIT } from "@/server/rate-limit";
import { getRequestUser } from "@/server/request-user";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { verifyTurnstileToken } from "@/server/turnstile";

/**
 * A guest joins an event: robot check, access code, anonymous session and guest record
 * (F-033 to F-035, F-017, S-012). Works with the web cookie or an app's Bearer token.
 */
export function POST(request: Request) {
  return guarded(async () => {
    const body = await parseBody(request, joinEventRequestSchema);
    if (!body.ok) return body.response;

    const ip = clientIpFrom(request.headers);
    const limit = await checkRateLimit(GUEST_JOIN_RATE_LIMIT, ip ?? "unknown");
    if (!limit.allowed) {
      return apiError(429, "rate_limited", { "Retry-After": String(limit.retryAfterSeconds) });
    }

    const user = await getRequestUser(request);
    const result = await joinEvent(
      {
        admin: createSupabaseAdminClient(),
        // Server client: the session cookie is written on the answer (the web); the tokens are
        // also returned in the body for the apps.
        signInAnonymously: async () => {
          const supabase = await createSupabaseServerClient();
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error || !data.user || !data.session) return null;
          return {
            userId: data.user.id,
            session: {
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token,
              expiresAt: data.session.expires_at ?? null,
            },
          };
        },
        verifyHuman: (token) => verifyTurnstileToken(token, ip),
        allowCodeAttempt: async (key) =>
          (await checkRateLimit(ACCESS_CODE_RATE_LIMIT, key)).allowed,
      },
      { userId: user?.id ?? null, ip },
      body.data,
    );
    return result.ok ? apiJson(result.body) : apiError(result.status, result.code);
  });
}
