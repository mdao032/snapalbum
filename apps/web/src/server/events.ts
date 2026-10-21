import "server-only";
import {
  checkEventCreationQuota,
  computeExpiresAt,
  createEventSchema,
  defaultEventSettings,
  generatePublicCode,
  makeAccentReadable,
  updateEventSchema,
  type CreateEventInput,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;
export type EventRow = Database["public"]["Tables"]["events"]["Row"];

export type CreateEventResult =
  { ok: true; event: EventRow } | { ok: false; reason: "free_event_limit" };

/** PostgreSQL `unique_violation`. */
const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;

/**
 * Creates an event for an organiser (F-010 to F-012). Uses the ADMIN client on purpose: the
 * database refuses organisers direct inserts so the quota, the plan, the expiry and the public
 * code can only be set here. The caller must pass the id of the authenticated user.
 */
export async function createEvent(
  admin: Client,
  ownerId: string,
  rawInput: CreateEventInput,
  now: Date = new Date(),
): Promise<CreateEventResult> {
  const input = createEventSchema.parse(rawInput);

  const { count, error: countError } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("plan", "free")
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);
  if (countError) throw countError;

  const decision = checkEventCreationQuota({ activeFreeEvents: count ?? 0 });
  if (!decision.ok) return decision;

  const expiresAt = computeExpiresAt({ plan: "free", eventDate: input.eventDate });

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin
      .from("events")
      .insert({
        owner_id: ownerId,
        public_code: generatePublicCode(),
        title: input.title,
        event_date: input.eventDate,
        type: input.type,
        locale: input.locale,
        welcome_message: input.welcomeMessage || null,
        // White text on the accent must stay readable (F-011): darken it if needed.
        accent_color: input.accentColor ? makeAccentReadable(input.accentColor) : null,
        plan: "free",
        settings: defaultEventSettings(input.eventDate),
        expires_at: expiresAt?.toISOString() ?? null,
      })
      .select()
      .single();

    if (!error) return { ok: true, event: data };
    // A code collision is astronomically unlikely, but handled: draw another code.
    if (error.code !== UNIQUE_VIOLATION || !error.message.includes("public_code")) throw error;
  }

  throw new Error(`Could not generate a unique public code after ${MAX_CODE_ATTEMPTS} attempts`);
}

/** The organiser's events, newest first. Pass the USER client: RLS limits the rows. */
export async function listOwnEvents(client: Client): Promise<EventRow[]> {
  const { data, error } = await client
    .from("events")
    .select("*")
    .order("event_date", { ascending: false });
  if (error) throw error;
  return data;
}

/** One of the organiser's events, or null (also when it belongs to someone else: RLS hides it). */
export async function getOwnEvent(client: Client, eventId: string): Promise<EventRow | null> {
  const { data, error } = await client.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error) throw error;
  return data;
}

export type UpdateEventResult = { ok: true; event: EventRow } | { ok: false; reason: "not_found" };

/**
 * Saves the presentation of an event (F-011). Pass the USER client: RLS and column privileges
 * decide what may change, and an event that is not active or not theirs updates zero rows.
 */
export async function updateEventPresentation(
  client: Client,
  eventId: string,
  rawInput: unknown,
): Promise<UpdateEventResult> {
  const input = updateEventSchema.parse(rawInput);
  const { data, error } = await client
    .from("events")
    .update({
      title: input.title,
      type: input.type,
      locale: input.locale,
      welcome_message: input.welcomeMessage,
      // White text on the accent must stay readable (F-011): darken it if needed.
      accent_color: input.accentColor ? makeAccentReadable(input.accentColor) : null,
    })
    .eq("id", eventId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true, event: data } : { ok: false, reason: "not_found" };
}
