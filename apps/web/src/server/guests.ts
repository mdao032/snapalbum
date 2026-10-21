import "server-only";
import { TERMS_VERSION, type ApiErrorCode, type JoinEventResponse } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAccessCode } from "./access-code";

type Client = SupabaseClient<Database>;

export type GuestFailure = { ok: false; status: number; code: ApiErrorCode };
export type GuestResult<T> = { ok: true; body: T } | GuestFailure;
const fail = (status: number, code: ApiErrorCode): GuestFailure => ({ ok: false, status, code });

export interface JoinDeps {
  admin: Client;
  /** Opens an anonymous session (the web gets it as cookies) and returns its identity. */
  signInAnonymously: () => Promise<{
    userId: string;
    session: NonNullable<JoinEventResponse["session"]>;
  } | null>;
  /** Cloudflare Turnstile check (S-012): true when valid or when the check is not configured. */
  verifyHuman: (token: string | undefined) => Promise<boolean>;
  /** Counts one access code attempt (S-006): false when the limit is reached. */
  allowCodeAttempt: (key: string) => Promise<boolean>;
  now?: () => Date;
}

export interface JoinInput {
  eventCode: string;
  displayName?: string;
  accessCode?: string;
  turnstileToken?: string;
}

/** PostgreSQL `unique_violation`: two joins of the same guest at once. */
const UNIQUE_VIOLATION = "23505";

/** The stored hash of the event's access code, or null when the organiser set none (F-017). */
function accessCodeHashOf(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const hash = (settings as Record<string, unknown>).access_code_hash;
  return typeof hash === "string" && hash !== "" ? hash : null;
}

/**
 * A guest joins an event on their first action (F-033 to F-035): the terms they accepted are
 * recorded with the date, an anonymous session is opened if they have none, and a `guests` row
 * links that session to the event. Calling it again is harmless: the guest is found, only their
 * name may change, and the terms stay recorded as first accepted.
 */
export async function joinEvent(
  deps: JoinDeps,
  context: { userId: string | null; ip: string | undefined },
  input: JoinInput,
): Promise<GuestResult<JoinEventResponse>> {
  const { admin } = deps;
  const now = (deps.now?.() ?? new Date()).toISOString();

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, status, settings")
    .eq("public_code", input.eventCode)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return fail(404, "not_found");
  if (event.status !== "active") return fail(403, "event_suspended");

  let existing: {
    id: string;
    display_name: string | null;
    terms_accepted_at: string | null;
  } | null = null;
  if (context.userId) {
    const { data, error } = await admin
      .from("guests")
      .select("id, display_name, terms_accepted_at")
      .eq("event_id", event.id)
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    existing = data;
  }

  // A new session is the moment robots are stopped (S-012); a returning guest is not asked again.
  if (!context.userId && !(await deps.verifyHuman(input.turnstileToken))) {
    return fail(403, "captcha_failed");
  }

  // The access code is asked once, while the guest is not admitted yet (F-017, S-006).
  const storedHash = accessCodeHashOf(event.settings);
  if (!existing && storedHash) {
    if (!input.accessCode) return fail(403, "access_code_required");
    if (!(await deps.allowCodeAttempt(`${context.ip ?? "unknown"}:${event.id}`))) {
      return fail(429, "rate_limited");
    }
    if (!(await verifyAccessCode(input.accessCode, storedHash))) {
      return fail(403, "access_code_invalid");
    }
  }

  let userId = context.userId;
  let session: JoinEventResponse["session"] = null;
  if (!userId) {
    const opened = await deps.signInAnonymously();
    if (!opened) return fail(500, "internal_error");
    userId = opened.userId;
    session = opened.session;
  }

  if (existing) {
    const changes: { display_name?: string; terms_accepted_at?: string; terms_version?: string } =
      {};
    if (input.displayName !== undefined) changes.display_name = input.displayName;
    if (!existing.terms_accepted_at) {
      changes.terms_accepted_at = now;
      changes.terms_version = TERMS_VERSION;
    }
    if (Object.keys(changes).length > 0) {
      const { error } = await admin.from("guests").update(changes).eq("id", existing.id);
      if (error) throw error;
    }
    return {
      ok: true,
      body: {
        guestId: existing.id,
        displayName: changes.display_name ?? existing.display_name,
        session,
      },
    };
  }

  const { data: created, error: insertError } = await admin
    .from("guests")
    .insert({
      event_id: event.id,
      auth_user_id: userId,
      display_name: input.displayName ?? null,
      terms_accepted_at: now,
      terms_version: TERMS_VERSION,
    })
    .select("id, display_name")
    .single();
  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION) throw insertError;
    // Two clicks at once: the other request created the guest, use it.
    const { data: found, error } = await admin
      .from("guests")
      .select("id, display_name")
      .eq("event_id", event.id)
      .eq("auth_user_id", userId)
      .single();
    if (error) throw error;
    return { ok: true, body: { guestId: found.id, displayName: found.display_name, session } };
  }
  return { ok: true, body: { guestId: created.id, displayName: created.display_name, session } };
}

/** The guest record of a signed-in visitor for an event, or null when they have not joined. */
export async function getGuestOfEvent(
  admin: Client,
  eventId: string,
  userId: string,
): Promise<{ id: string; displayName: string | null } | null> {
  const { data, error } = await admin
    .from("guests")
    .select("id, display_name")
    .eq("event_id", eventId)
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, displayName: data.display_name } : null;
}
