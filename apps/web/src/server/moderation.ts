import "server-only";
import {
  MAX_MODERATION_BATCH,
  READ_URL_TTL_SECONDS,
  type ApiErrorCode,
  type ModerationAction,
  type ModerationFilter,
  type ModerationItem,
  type ReportReason,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { decodeCursor, encodeCursor } from "./gallery";
import type { Storage } from "./storage";

type Client = SupabaseClient<Database>;

export interface ModerationDeps {
  /** Service role client: the server checks the caller owns the event, then acts for them. */
  admin: Client;
  storage: Storage;
  now?: () => Date;
}

type Failure = { ok: false; status: number; code: ApiErrorCode };
export type ModerationResult<T> = { ok: true; body: T } | Failure;
const fail = (status: number, code: ApiErrorCode): Failure => ({ ok: false, status, code });

/** Media per page of the moderation list. */
export const MODERATION_PAGE_SIZE = 60;
/** Open reports looked at when listing reported media. */
const OPEN_REPORTS_LIMIT = 1000;

/** The organiser's own, active event: the only one they can moderate. */
async function ownsEvent(admin: Client, ownerId: string, eventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function audit(
  admin: Client,
  ownerId: string,
  action: string,
  eventId: string,
  metadata: Record<string, unknown>,
) {
  const { error } = await admin.from("audit_log").insert({
    actor_id: ownerId,
    action,
    target_type: "event",
    target_id: eventId,
    metadata: metadata as never,
  });
  if (error) throw error;
}

/** Open reports of an event: how many on each media (F-073). */
async function openReportCounts(admin: Client, eventId: string): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from("reports")
    .select("media_id, media!inner(event_id, status)")
    .eq("media.event_id", eventId)
    .in("media.status", ["ready", "hidden"])
    .is("resolved_at", null)
    .limit(OPEN_REPORTS_LIMIT);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.media_id, (counts.get(row.media_id) ?? 0) + 1);
  return counts;
}

export interface ModerationCounts {
  pending: number;
  visible: number;
  hidden: number;
  refused: number;
  reported: number;
}

/** How much waits in each list, and the number that needs attention (to show on the dashboard). */
export async function moderationCounts(admin: Client, eventId: string): Promise<ModerationCounts> {
  const count = async (status: string, moderation?: string) => {
    let query = admin
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", status);
    if (moderation) query = query.eq("moderation", moderation);
    const { count: total, error } = await query;
    if (error) throw error;
    return total ?? 0;
  };
  const [pending, visible, hidden, refused, reports] = await Promise.all([
    count("ready", "pending"),
    count("ready", "approved"),
    count("hidden"),
    count("ready", "rejected"),
    openReportCounts(admin, eventId),
  ]);
  return { pending, visible, hidden, refused, reported: reports.size };
}

export interface ModerationGuest {
  id: string;
  name: string | null;
  count: number;
  blocked: boolean;
}

export interface ModerationPage {
  items: ModerationItem[];
  nextCursor: string | null;
  counts: ModerationCounts;
  /** Everyone who sent something, for blocking; first page only. */
  guests: ModerationGuest[];
}

/** One list of the moderation page, newest first, with the counts of all lists (F-070, F-071). */
export async function listModeration(
  deps: ModerationDeps,
  ownerId: string,
  eventId: string,
  options: { filter: ModerationFilter; cursor?: string; limit?: number },
): Promise<ModerationResult<ModerationPage>> {
  const { admin, storage } = deps;
  if (!(await ownsEvent(admin, ownerId, eventId))) return fail(404, "not_found");
  const limit = Math.min(options.limit ?? MODERATION_PAGE_SIZE, MODERATION_PAGE_SIZE);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (options.cursor && !cursor) return fail(400, "validation_failed");

  const reportCounts = await openReportCounts(admin, eventId);

  let query = admin
    .from("media")
    .select("id, kind, status, moderation, guest_id, key_thumb, created_at")
    .eq("event_id", eventId);
  switch (options.filter) {
    case "pending":
      query = query.eq("status", "ready").eq("moderation", "pending");
      break;
    case "visible":
      query = query.eq("status", "ready").eq("moderation", "approved");
      break;
    case "hidden":
      query = query.eq("status", "hidden");
      break;
    case "refused":
      query = query.eq("status", "ready").eq("moderation", "rejected");
      break;
    case "reported":
      query = query.in("id", [...reportCounts.keys()]).in("status", ["ready", "hidden"]);
      break;
  }
  if (cursor) {
    const [value, id] = cursor;
    query = query.or(`created_at.lt."${value}",and(created_at.eq."${value}",id.lt.${id})`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw error;

  const rows = data ?? [];
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null;

  const { data: guestRows, error: guestError } = await admin
    .from("guests")
    .select("id, display_name, blocked_at")
    .eq("event_id", eventId);
  if (guestError) throw guestError;
  const names = new Map((guestRows ?? []).map((guest) => [guest.id, guest.display_name]));

  const items: ModerationItem[] = await Promise.all(
    pageRows.map(async (row) => ({
      mediaId: row.id,
      kind: row.kind as "photo" | "video",
      thumbUrl: row.key_thumb ? await storage.presignRead(row.key_thumb) : null,
      guestId: row.guest_id,
      guestName: names.get(row.guest_id) ?? null,
      status: row.status,
      moderation: row.moderation,
      createdAt: new Date(row.created_at).toISOString(),
      reports: reportCounts.get(row.id) ?? 0,
    })),
  );

  let guests: ModerationGuest[] = [];
  if (!options.cursor) {
    const { data: tally, error: tallyError } = await admin
      .from("media")
      .select("guest_id")
      .eq("event_id", eventId)
      .in("status", ["ready", "hidden"])
      .limit(5000);
    if (tallyError) throw tallyError;
    const perGuest = new Map<string, number>();
    for (const row of tally ?? [])
      perGuest.set(row.guest_id, (perGuest.get(row.guest_id) ?? 0) + 1);
    guests = (guestRows ?? [])
      .map((guest) => ({
        id: guest.id,
        name: guest.display_name,
        count: perGuest.get(guest.id) ?? 0,
        blocked: guest.blocked_at !== null,
      }))
      // Blocked guests and those who sent the most come first.
      .sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.count - a.count);
  }

  return {
    ok: true,
    body: {
      items,
      nextCursor,
      counts: await moderationCounts(admin, eventId),
      guests,
    },
  };
}

/** Time the signed address of a moderation thumbnail lasts (shown for the client to renew). */
export const MODERATION_URL_SECONDS = READ_URL_TTL_SECONDS;

const keysOf = (row: {
  key_original: string | null;
  key_display: string | null;
  key_thumb: string | null;
}) => [row.key_original, row.key_display, row.key_thumb].filter((key): key is string => !!key);

/**
 * Hides, restores, approves, refuses or deletes media, one or many (F-070, F-071). Each action only
 * touches media in the state it applies to, so a double click or a list that is a bit stale cannot
 * do harm; the answer says how many were really changed.
 *  - approve: waiting or refused → shown in the album and the slideshow;
 *  - reject: waiting → refused (kept, can still be approved later);
 *  - hide: shown → hidden (kept, restorable);
 *  - restore: hidden → shown;
 *  - delete: any → gone for good: the files are removed and the quota is freed.
 * Hiding and deleting close the open reports on those media. The sensitive ones are logged.
 */
export async function moderateMedia(
  deps: ModerationDeps,
  ownerId: string,
  eventId: string,
  action: ModerationAction,
  mediaIds: readonly string[],
): Promise<ModerationResult<{ changed: number }>> {
  const { admin, storage } = deps;
  const ids = [...new Set(mediaIds)];
  if (ids.length === 0 || ids.length > MAX_MODERATION_BATCH) return fail(400, "validation_failed");
  if (!(await ownsEvent(admin, ownerId, eventId))) return fail(404, "not_found");

  let changedIds: string[] = [];

  switch (action) {
    case "approve": {
      const { data, error } = await admin
        .from("media")
        .update({ moderation: "approved" })
        .eq("event_id", eventId)
        .in("id", ids)
        .eq("status", "ready")
        .in("moderation", ["pending", "rejected"])
        .select("id");
      if (error) throw error;
      changedIds = (data ?? []).map((row) => row.id);
      break;
    }
    case "reject": {
      const { data, error } = await admin
        .from("media")
        .update({ moderation: "rejected" })
        .eq("event_id", eventId)
        .in("id", ids)
        .eq("status", "ready")
        .eq("moderation", "pending")
        .select("id");
      if (error) throw error;
      changedIds = (data ?? []).map((row) => row.id);
      break;
    }
    case "hide": {
      const { data, error } = await admin
        .from("media")
        .update({ status: "hidden" })
        .eq("event_id", eventId)
        .in("id", ids)
        .eq("status", "ready")
        .select("id");
      if (error) throw error;
      changedIds = (data ?? []).map((row) => row.id);
      break;
    }
    case "restore": {
      const { data, error } = await admin
        .from("media")
        .update({ status: "ready" })
        .eq("event_id", eventId)
        .in("id", ids)
        .eq("status", "hidden")
        .select("id");
      if (error) throw error;
      changedIds = (data ?? []).map((row) => row.id);
      break;
    }
    case "delete": {
      const { data, error } = await admin
        .from("media")
        .update({ status: "deleted" })
        .eq("event_id", eventId)
        .in("id", ids)
        .in("status", ["ready", "hidden", "pending", "uploaded", "rejected"])
        .select("id, key_original, key_display, key_thumb");
      if (error) throw error;
      const rows = data ?? [];
      changedIds = rows.map((row) => row.id);
      // The database row stays (the purge of the event removes it); the files go now.
      await Promise.all(
        rows.flatMap((row) =>
          keysOf(row).map((key) => storage.deleteObject(key).catch(() => undefined)),
        ),
      );
      break;
    }
  }

  if (changedIds.length > 0 && (action === "hide" || action === "delete")) {
    const { error } = await admin
      .from("reports")
      .update({ resolved_at: (deps.now?.() ?? new Date()).toISOString() })
      .in("media_id", changedIds)
      .is("resolved_at", null);
    if (error) throw error;
  }
  if (changedIds.length > 0 && action !== "approve" && action !== "restore") {
    await audit(admin, ownerId, `media.${action}`, eventId, {
      count: changedIds.length,
      mediaIds: changedIds.slice(0, 50),
    });
  }
  return { ok: true, body: { changed: changedIds.length } };
}

/** Blocks a guest of the event, or lets them back: their future uploads are refused (F-072). */
export async function setGuestBlocked(
  deps: ModerationDeps,
  ownerId: string,
  eventId: string,
  guestId: string,
  blocked: boolean,
): Promise<ModerationResult<{ blocked: boolean }>> {
  const { admin } = deps;
  if (!(await ownsEvent(admin, ownerId, eventId))) return fail(404, "not_found");
  const { data, error } = await admin
    .from("guests")
    .update({ blocked_at: blocked ? (deps.now?.() ?? new Date()).toISOString() : null })
    .eq("id", guestId)
    .eq("event_id", eventId)
    .select("id");
  if (error) throw error;
  if ((data?.length ?? 0) === 0) return fail(404, "not_found");
  await audit(admin, ownerId, blocked ? "guest.block" : "guest.unblock", eventId, { guestId });
  return { ok: true, body: { blocked } };
}

/** The organiser looked at the reports of these media and keeps them as they are (F-073). */
export async function dismissReports(
  deps: ModerationDeps,
  ownerId: string,
  eventId: string,
  mediaIds: readonly string[],
): Promise<ModerationResult<{ changed: number }>> {
  const { admin } = deps;
  const ids = [...new Set(mediaIds)];
  if (ids.length === 0 || ids.length > MAX_MODERATION_BATCH) return fail(400, "validation_failed");
  if (!(await ownsEvent(admin, ownerId, eventId))) return fail(404, "not_found");
  const { data: own, error: ownError } = await admin
    .from("media")
    .select("id")
    .eq("event_id", eventId)
    .in("id", ids);
  if (ownError) throw ownError;
  const mine = (own ?? []).map((row) => row.id);
  if (mine.length === 0) return { ok: true, body: { changed: 0 } };
  const { data, error } = await admin
    .from("reports")
    .update({ resolved_at: (deps.now?.() ?? new Date()).toISOString() })
    .in("media_id", mine)
    .is("resolved_at", null)
    .select("id");
  if (error) throw error;
  return { ok: true, body: { changed: data?.length ?? 0 } };
}

/**
 * Who is reporting, as an opaque hash: a guest by their session, anyone else by their address.
 * Salted with a server secret, so the hash cannot be turned back into an address, and only used to
 * count one report per person and photo (SPEC 7).
 */
export function reporterFingerprint(salt: string, who: { userId?: string; ip?: string }): string {
  return createHmac("sha256", salt)
    .update(who.userId ? `user:${who.userId}` : `ip:${who.ip ?? "unknown"}`)
    .digest("hex");
}

const UNIQUE_VIOLATION = "23505";

/**
 * A visitor of the album reports a photo (F-073). The photo must be one the album shows them;
 * reporting twice is accepted and counted once. The organiser sees it on the moderation page.
 */
export async function reportMedia(
  admin: Client,
  eventId: string,
  fingerprint: string,
  mediaId: string,
  reason: ReportReason,
): Promise<ModerationResult<{ ok: true }>> {
  const { data: media, error } = await admin
    .from("media")
    .select("id")
    .eq("id", mediaId)
    .eq("event_id", eventId)
    .eq("status", "ready")
    .eq("moderation", "approved")
    .maybeSingle();
  if (error) throw error;
  if (!media) return fail(404, "not_found");

  const { error: insertError } = await admin
    .from("reports")
    .insert({ media_id: mediaId, reason, reporter_fingerprint: fingerprint });
  if (insertError && insertError.code !== UNIQUE_VIOLATION) throw insertError;
  return { ok: true, body: { ok: true } };
}

/**
 * The picture (or video) of one media, whatever its state, for the organiser who reviews it: the
 * display version of a photo, the original of a video. Short-lived address (SPEC 9.1).
 */
export async function moderationFile(
  deps: ModerationDeps,
  ownerId: string,
  eventId: string,
  mediaId: string,
): Promise<ModerationResult<{ url: string | null; kind: "photo" | "video" }>> {
  const { admin, storage } = deps;
  if (!(await ownsEvent(admin, ownerId, eventId))) return fail(404, "not_found");
  const { data, error } = await admin
    .from("media")
    .select("kind, key_display, key_original")
    .eq("id", mediaId)
    .eq("event_id", eventId)
    .in("status", ["ready", "hidden"])
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, "not_found");
  const key = data.kind === "video" ? data.key_original : (data.key_display ?? data.key_original);
  return {
    ok: true,
    body: {
      url: key ? await storage.presignRead(key) : null,
      kind: data.kind as "photo" | "video",
    },
  };
}
