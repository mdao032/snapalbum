import "server-only";
import {
  READ_URL_TTL_SECONDS,
  type ApiErrorCode,
  type GalleryAccess,
  type GalleryGuest,
  type GalleryItem,
  type GalleryRequestParsed,
  type GalleryResponse,
  type ShareLink,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Storage } from "./storage";

type Client = SupabaseClient<Database>;
type ParsedRequest = GalleryRequestParsed;

export interface GalleryDeps {
  /** Service role client: the server checks who asks, then reads on their behalf. */
  admin: Client;
  storage: Storage;
}

type Failure = { ok: false; status: number; code: ApiErrorCode };
export type GalleryResult<T> = { ok: true; body: T } | Failure;
const fail = (status: number, code: ApiErrorCode): Failure => ({ ok: false, status, code });

/** What the caller is allowed to see once their access is checked. */
interface Granted {
  eventId: string;
  title: string;
  accentColor: string | null;
  /** Guest names and the "sent by" filter: for the event's own people, never for a share link. */
  showGuests: boolean;
}

/**
 * Who may look at the album (F-039, F-054):
 *  - a guest of the event, when the organiser opened the gallery (the code of an event with an
 *    access code is asked at joining, so being a guest is the proof);
 *  - the organiser;
 *  - anyone holding a share link that is not revoked, with no session at all.
 * An event that is suspended or being deleted shows nothing, to anyone.
 */
export async function resolveGalleryAccess(
  admin: Client,
  user: { id: string } | null,
  access: GalleryAccess,
): Promise<GalleryResult<Granted>> {
  if (access.type === "share") {
    const { data: link, error } = await admin
      .from("share_links")
      .select("event_id")
      .eq("token", access.token)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!link) return fail(404, "not_found");
    const { data: event, error: eventError } = await admin
      .from("events")
      .select("id, title, status, accent_color")
      .eq("id", link.event_id)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event || event.status !== "active") return fail(404, "not_found");
    return {
      ok: true,
      body: {
        eventId: event.id,
        title: event.title,
        accentColor: event.accent_color,
        showGuests: false,
      },
    };
  }

  if (!user) return fail(401, "unauthorized");
  const { data: event, error } = await admin
    .from("events")
    .select("id, title, status, owner_id, settings, accent_color")
    .eq("public_code", access.eventCode)
    .maybeSingle();
  if (error) throw error;
  if (!event || event.status !== "active") return fail(404, "not_found");

  const granted: Granted = {
    eventId: event.id,
    title: event.title,
    accentColor: event.accent_color,
    showGuests: true,
  };
  if (event.owner_id === user.id) return { ok: true, body: granted };

  const { data: guest, error: guestError } = await admin
    .from("guests")
    .select("id, blocked_at")
    .eq("event_id", event.id)
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (guestError) throw guestError;
  if (!guest || guest.blocked_at) return fail(403, "forbidden");

  const settings = event.settings as Record<string, unknown> | null;
  if (settings?.gallery_visible !== true) return fail(403, "gallery_closed");
  return { ok: true, body: granted };
}

const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

function encodeCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString("base64url");
}

function decodeCursor(raw: string): [string, string] | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const iso = (value: string) => new Date(value).toISOString();

/** What the gallery shows: approved media whose files are checked and stored (F-039, F-071). */
function shownMedia(admin: Client, eventId: string) {
  return admin
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "ready")
    .eq("moderation", "approved");
}

async function listPage(
  deps: GalleryDeps,
  granted: Granted,
  request: Extract<ParsedRequest, { action: "list" }>,
): Promise<GalleryResult<Extract<GalleryResponse, { action: "list" }>>> {
  const { admin, storage } = deps;
  const sortColumn = request.sort === "taken" ? "captured_at" : "created_at";
  const ascending = request.order === "asc";
  const guestFilter = granted.showGuests ? request.guestId : undefined;

  const cursor = request.cursor ? decodeCursor(request.cursor) : null;
  if (request.cursor && !cursor) return fail(400, "validation_failed");

  let query = admin
    .from("media")
    .select(
      "id, kind, width, height, duration_s, blurhash, key_thumb, taken_at, created_at, captured_at",
    )
    .eq("event_id", granted.eventId)
    .eq("status", "ready")
    .eq("moderation", "approved");
  if (request.kind) query = query.eq("kind", request.kind);
  if (guestFilter) query = query.eq("guest_id", guestFilter);
  if (cursor) {
    // Keyset pagination: strictly after the last item seen, ties broken by id. A new upload
    // between two pages can never shift a page and repeat or skip a photo.
    const [value, id] = cursor;
    const op = ascending ? "gt" : "lt";
    query = query.or(
      `${sortColumn}.${op}."${value}",and(${sortColumn}.eq."${value}",id.${op}.${id})`,
    );
  }
  const { data, error } = await query
    .order(sortColumn, { ascending })
    .order("id", { ascending })
    .limit(request.limit + 1);
  if (error) throw error;

  const rows = data ?? [];
  const pageRows = rows.slice(0, request.limit);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > request.limit && last
      ? encodeCursor(request.sort === "taken" ? last.captured_at! : last.created_at, last.id)
      : null;

  const items: GalleryItem[] = await Promise.all(
    pageRows.map(async (row) => ({
      mediaId: row.id,
      kind: row.kind as "photo" | "video",
      width: row.width,
      height: row.height,
      durationS: row.duration_s,
      blurhash: row.blurhash,
      thumbUrl: row.key_thumb ? await storage.presignRead(row.key_thumb) : null,
      takenAt: row.taken_at ? iso(row.taken_at) : null,
      createdAt: iso(row.created_at),
    })),
  );

  // Totals and guests are only worth computing once: the client keeps them while it pages.
  let total: number | null = null;
  let guests: GalleryGuest[] = [];
  if (!request.cursor) {
    let count = shownMedia(admin, granted.eventId);
    if (request.kind) count = count.eq("kind", request.kind);
    if (guestFilter) count = count.eq("guest_id", guestFilter);
    const { count: matching, error: countError } = await count;
    if (countError) throw countError;
    total = matching ?? 0;

    if (granted.showGuests) {
      const { data: rowsOfGuests, error: guestsError } = await admin.rpc("gallery_guests", {
        p_event_id: granted.eventId,
      });
      if (guestsError) throw guestsError;
      guests = (rowsOfGuests ?? []).map((row) => ({
        id: row.guest_id,
        name: row.display_name,
        count: Number(row.media_count),
      }));
    }
  }

  return {
    ok: true,
    body: {
      action: "list",
      items,
      nextCursor,
      total,
      urlsValidSeconds: READ_URL_TTL_SECONDS,
      guests,
    },
  };
}

/** The media of `ids` that the gallery shows, whoever asks: a hidden or foreign id is simply absent. */
async function shownRows(admin: Client, eventId: string, ids: readonly string[]) {
  const { data, error } = await admin
    .from("media")
    .select("id, kind, key_original, key_display, key_thumb")
    .eq("event_id", eventId)
    .eq("status", "ready")
    .eq("moderation", "approved")
    .in("id", [...ids]);
  if (error) throw error;
  return data ?? [];
}

/** `jolie-fete-3f2b8c1e.jpg`: the file name offered when a guest saves a photo. */
export function downloadName(title: string, mediaId: string, key: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const extension = /\.([a-z0-9]{2,5})$/i.exec(key)?.[1]?.toLowerCase() ?? "bin";
  return `${slug || "album"}-${mediaId.slice(0, 8)}.${extension}`;
}

/**
 * The album for a guest, the organiser or a share link holder: a page of thumbnails with their
 * addresses signed in one batch (F-050), fresh addresses before the old ones expire, and the files
 * the full-screen viewer needs (F-051). Files never pass through the server (SPEC 9.1).
 */
export async function gallery(
  deps: GalleryDeps,
  user: { id: string } | null,
  request: ParsedRequest,
): Promise<GalleryResult<GalleryResponse>> {
  const access = await resolveGalleryAccess(deps.admin, user, request.access);
  if (!access.ok) return access;
  const granted = access.body;

  switch (request.action) {
    case "list":
      return listPage(deps, granted, request);

    case "thumbs": {
      const rows = await shownRows(deps.admin, granted.eventId, request.mediaIds);
      const urls = await Promise.all(
        rows.map(async (row) => ({
          mediaId: row.id,
          thumbUrl: row.key_thumb ? await deps.storage.presignRead(row.key_thumb) : null,
        })),
      );
      return {
        ok: true,
        body: { action: "thumbs", urls, urlsValidSeconds: READ_URL_TTL_SECONDS },
      };
    }

    case "files": {
      const rows = await shownRows(deps.admin, granted.eventId, request.mediaIds);
      const files = (
        await Promise.all(
          rows.map(async (row) => {
            // A video has only its original; a photo's original is not kept on every plan.
            const saved = row.key_original ?? row.key_display;
            if (!saved) return null;
            const name = downloadName(granted.title, row.id, saved);
            const isVideo = row.kind === "video";
            return {
              mediaId: row.id,
              displayUrl:
                !isVideo && row.key_display
                  ? await deps.storage.presignRead(row.key_display)
                  : null,
              videoUrl:
                isVideo && row.key_original
                  ? await deps.storage.presignRead(row.key_original)
                  : null,
              downloadUrl: await deps.storage.presignRead(saved, { downloadName: name }),
            };
          }),
        )
      ).filter((file) => file !== null);
      return {
        ok: true,
        body: { action: "files", files, urlsValidSeconds: READ_URL_TTL_SECONDS },
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Share links (F-054)
// ---------------------------------------------------------------------------------------------

/** Whether `ownerId` owns the event: the only person who manages its share links. */
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

const toShareLink = (row: {
  id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
}): ShareLink => ({
  id: row.id,
  token: row.token,
  createdAt: iso(row.created_at),
  revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
});

/** The links of an event, newest first (revoked ones included, as a record). */
export async function listShareLinks(
  admin: Client,
  ownerId: string,
  eventId: string,
): Promise<ShareLink[]> {
  if (!(await ownsEvent(admin, ownerId, eventId))) return [];
  const { data, error } = await admin
    .from("share_links")
    .select("id, token, created_at, revoked_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toShareLink);
}

/** Active links at one time per event: enough to share, few enough to keep track of. */
export const MAX_ACTIVE_SHARE_LINKS = 5;

/** A new link, 24 random bytes long (192 bits: not guessable). Null if the event is not theirs. */
export async function createShareLink(
  admin: Client,
  ownerId: string,
  eventId: string,
): Promise<{ ok: true; link: ShareLink } | { ok: false; reason: "not_found" | "too_many" }> {
  if (!(await ownsEvent(admin, ownerId, eventId))) return { ok: false, reason: "not_found" };
  const { count, error: countError } = await admin
    .from("share_links")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("revoked_at", null);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_ACTIVE_SHARE_LINKS) return { ok: false, reason: "too_many" };

  const { data, error } = await admin
    .from("share_links")
    .insert({
      event_id: eventId,
      token: randomBytes(24).toString("base64url"),
      created_by: ownerId,
    })
    .select("id, token, created_at, revoked_at")
    .single();
  if (error) throw error;
  return { ok: true, link: toShareLink(data) };
}

/** Stops a link at once. Revoking twice is harmless; a link of someone else's event is not found. */
export async function revokeShareLink(
  admin: Client,
  ownerId: string,
  eventId: string,
  linkId: string,
): Promise<boolean> {
  if (!(await ownsEvent(admin, ownerId, eventId))) return false;
  const { data, error } = await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("event_id", eventId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return true;
  // Already revoked counts as done; an unknown link does not.
  const { data: existing, error: lookupError } = await admin
    .from("share_links")
    .select("id")
    .eq("id", linkId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  return existing !== null;
}

export { decodeCursor, encodeCursor };
