import "server-only";
import {
  canCancelDeletion,
  canRequestDeletion,
  checkEventCreationQuota,
  computeExpiresAt,
  createEventSchema,
  defaultEventSettings,
  eventSettingsSchema,
  generatePublicCode,
  guestPhase,
  makeAccentReadable,
  publicCodeSchema,
  updateEventSchema,
  updateEventSettingsSchema,
  type CreateEventInput,
  type GuestPhase,
  type PlanId,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashAccessCode } from "./access-code";

type Client = SupabaseClient<Database>;
export type EventRow = Database["public"]["Tables"]["events"]["Row"];

export type CreateEventResult =
  | { ok: true; event: EventRow }
  | { ok: false; reason: "free_event_limit" | "account_pending_deletion" };

/** PostgreSQL `unique_violation`. */
const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;

/** Free events of an organiser that are still running (the quota counts these, see `plans.ts`). */
async function countActiveFreeEvents(admin: Client, ownerId: string, now: Date): Promise<number> {
  const { count, error } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("plan", "free")
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);
  if (error) throw error;
  return count ?? 0;
}

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

  // An account that is being deleted creates nothing new (F-004): it would be purged with the rest.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("deleted_at")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.deleted_at) return { ok: false, reason: "account_pending_deletion" };

  const decision = checkEventCreationQuota({
    activeFreeEvents: await countActiveFreeEvents(admin, ownerId, now),
  });
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

    if (!error) {
      // Two requests can both pass the check above before either writes. Count again now that
      // this event exists: if the quota is exceeded, the later one takes its event back. When both
      // see the excess, both retreat: the account never ends up over quota, and retrying works.
      const total = await countActiveFreeEvents(admin, ownerId, now);
      const recheck = checkEventCreationQuota({ activeFreeEvents: total - 1 });
      if (!recheck.ok) {
        const { error: deleteError } = await admin.from("events").delete().eq("id", data.id);
        if (deleteError) throw deleteError;
        return recheck;
      }
      return { ok: true, event: data };
    }
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

export type PublicEvent = Pick<
  EventRow,
  "id" | "title" | "welcome_message" | "accent_color" | "locale" | "status" | "expires_at" | "plan"
> & {
  /** The guest must enter the organiser's code before joining (F-017). The hash itself never leaves. */
  requiresAccessCode: boolean;
  /** The organiser opened the gallery to guests (F-015, F-039). */
  galleryVisible: boolean;
  /** What the page offers now: not yet, the event itself, after it, uploads closed (F-043). */
  phase: GuestPhase;
};

/**
 * What a guest may know about an event, found by its public code. Uses the ADMIN client on
 * purpose (visitors have no database rights) and returns only presentation fields, never the
 * owner, the counters or the settings. The plan is included for its limits (video duration, file
 * size), which the page applies before sending and states to the guest.
 */
export async function getPublicEvent(
  admin: Client,
  publicCode: string,
  now: Date = new Date(),
): Promise<PublicEvent | null> {
  if (!publicCodeSchema.safeParse(publicCode).success) return null;
  const { data, error } = await admin
    .from("events")
    .select(
      "id, title, welcome_message, accent_color, locale, status, expires_at, plan, settings, event_date",
    )
    .eq("public_code", publicCode)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { settings, event_date: eventDate, ...visible } = data;
  const values =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const hash = values.access_code_hash;
  const parsedSettings = eventSettingsSchema.safeParse(settings);
  return {
    ...visible,
    requiresAccessCode: typeof hash === "string" && hash !== "",
    galleryVisible: values.gallery_visible === true,
    // Settings that are not a valid window mean uploads are closed, as the database reads them.
    phase: parsedSettings.success
      ? guestPhase({ eventDate, settings: parsedSettings.data }, now)
      : "closed",
  };
}

export type SettingsResult = { ok: true; event: EventRow } | { ok: false; reason: "not_found" };

/**
 * Saves the visibility and upload-window settings (F-015, F-016). Pass the USER client (RLS). The
 * organiser's form never carries the access code hash, so the stored settings are merged, not
 * replaced.
 */
export async function updateEventSettings(
  client: Client,
  eventId: string,
  rawInput: unknown,
): Promise<SettingsResult> {
  const { access_code: accessCode, ...windowSettings } = updateEventSettingsSchema.parse(rawInput);
  const current = await getOwnEvent(client, eventId);
  if (!current) return { ok: false, reason: "not_found" };

  const existing =
    current.settings && typeof current.settings === "object" && !Array.isArray(current.settings)
      ? current.settings
      : {};
  const settings: Record<string, unknown> = { ...existing, ...windowSettings };
  // The code is only ever stored hashed (S-006): "" removes it, absent leaves it alone.
  if (accessCode === "") settings.access_code_hash = null;
  else if (accessCode) settings.access_code_hash = await hashAccessCode(accessCode);
  const { data, error } = await client
    .from("events")
    .update({ settings: settings as Database["public"]["Tables"]["events"]["Update"]["settings"] })
    .eq("id", eventId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true, event: data } : { ok: false, reason: "not_found" };
}

export type DeletionResult = { ok: true } | { ok: false; reason: "not_found" | "not_allowed" };

async function findOwnedEvent(admin: Client, ownerId: string, eventId: string) {
  const { data, error } = await admin
    .from("events")
    .select("id, status, deleted_at, deletion_reason")
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Starts the deletion of an event (R5): it disappears for guests at once and is purged after 7
 * days unless cancelled. Uses the ADMIN client because organisers cannot write `status`; the
 * ownership check is part of the query. The purge itself is a scheduled job (phase 4).
 */
export async function requestEventDeletion(
  admin: Client,
  ownerId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<DeletionResult> {
  const event = await findOwnedEvent(admin, ownerId, eventId);
  if (!event) return { ok: false, reason: "not_found" };
  if (!canRequestDeletion(event)) return { ok: false, reason: "not_allowed" };

  const { data, error } = await admin
    .from("events")
    .update({
      status: "pending_deletion",
      deleted_at: now.toISOString(),
      deletion_reason: "user",
    })
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .select("id");
  if (error) throw error;
  return data.length > 0 ? { ok: true } : { ok: false, reason: "not_allowed" };
}

/** Cancels a pending deletion while the 7 days have not run out (R5). */
export async function cancelEventDeletion(
  admin: Client,
  ownerId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<DeletionResult> {
  const event = await findOwnedEvent(admin, ownerId, eventId);
  if (!event) return { ok: false, reason: "not_found" };
  if (!canCancelDeletion(event, now)) return { ok: false, reason: "not_allowed" };

  const { data, error } = await admin
    .from("events")
    .update({ status: "active", deleted_at: null, deletion_reason: null })
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .eq("status", "pending_deletion")
    .select("id");
  if (error) throw error;
  return data.length > 0 ? { ok: true } : { ok: false, reason: "not_allowed" };
}

export interface EventStats {
  photos: number;
  videos: number;
  guests: number;
  bytesUsed: number;
}

/**
 * The dashboard counters (F-018). Until the media and guest tables arrive with phase 2, nothing
 * can be uploaded, so the counters come from the columns of `events` and videos and guests are 0.
 * Phase 2 replaces this body with real counts; callers do not change.
 */
export function getEventStats(event: Pick<EventRow, "media_count" | "bytes_used">): EventStats {
  return { photos: event.media_count, videos: 0, guests: 0, bytesUsed: event.bytes_used };
}

/**
 * Guests of an event who left an e-mail address and agreed to receive the album link (F-044). Only
 * the count is ever shown to the organiser; the addresses stay with the mailer (step 4.3).
 */
export async function countNotifyGuests(admin: Client, eventId: string): Promise<number> {
  const { count, error } = await admin
    .from("guests")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .not("notify_email", "is", null)
    .not("notify_consent_at", "is", null);
  if (error) throw error;
  return count ?? 0;
}

/** The plan of an event, for what depends on it on pages that only know the event's id. */
export async function getEventPlan(admin: Client, eventId: string): Promise<PlanId> {
  const { data, error } = await admin.from("events").select("plan").eq("id", eventId).maybeSingle();
  if (error) throw error;
  return (data?.plan as PlanId | undefined) ?? "free";
}

/**
 * Photos that only have their optimised version because they were sent while the event was on the
 * free plan (R2: originals are kept for what is sent after the upgrade). Counted by the database.
 */
export async function countOptimizedOnlyPhotos(admin: Client, eventId: string): Promise<number> {
  const { count, error } = await admin
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("kind", "photo")
    .eq("status", "ready")
    .is("key_original", null);
  if (error) throw error;
  return count ?? 0;
}

export type AlbumReadyResult =
  { ok: true; readyAt: string; alreadyReady: boolean } | { ok: false; reason: "not_found" };

/**
 * The organiser declares the album ready (F-044). The moment is kept in the event settings, once,
 * by a database function that locks the event: guests who asked to be told get their e-mail from
 * it (the mailer is wired in step 4.3), and declaring it twice, even at the same instant, changes
 * nothing, so the e-mails cannot go out twice. The function checks that the caller owns an active
 * event; this uses the ADMIN client.
 */
export async function markAlbumReady(
  admin: Client,
  ownerId: string,
  eventId: string,
): Promise<AlbumReadyResult> {
  const { data, error } = await admin.rpc("mark_album_ready", {
    p_event_id: eventId,
    p_owner_id: ownerId,
  });
  if (error) throw error;
  const answer = data as { ok: boolean; ready_at?: string; already?: boolean } | null;
  if (!answer?.ok || !answer.ready_at) return { ok: false, reason: "not_found" };
  return { ok: true, readyAt: answer.ready_at, alreadyReady: answer.already === true };
}
