import "server-only";
import { getPlan, type ApiErrorCode, type PlanId } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCursor, encodeCursor } from "./gallery";
import type { Storage } from "./storage";

type Client = SupabaseClient<Database>;

export interface DownloadDeps {
  /** Service role client: the server checks the caller owns the event, then reads for them. */
  admin: Client;
  storage: Storage;
}

type Failure = { ok: false; status: number; code: ApiErrorCode };
export type DownloadResult<T> = { ok: true; body: T } | Failure;
const fail = (status: number, code: ApiErrorCode): Failure => ({ ok: false, status, code });

/** What goes into the ZIP: the files the offer keeps, or the optimised versions (F-080). */
export type DownloadVariant = "originals" | "optimized";

/** Files per page of the plan. */
export const PLAN_PAGE_SIZE = 500;
/** Files signed in one go: the browser asks right before downloading each group. */
export const SIGN_BATCH_SIZE = 100;

export interface PlanItem {
  mediaId: string;
  kind: "photo" | "video";
  /** When it was taken, or sent: the date in the file name. */
  at: string;
  guestName: string | null;
  /** The guest, to number their files. */
  guestId: string;
  /** Declared size of the file that will be downloaded, to cut the ZIPs. */
  bytes: number;
  extension: string;
}

export interface AlbumPlan {
  items: PlanItem[];
  nextCursor: string | null;
  /** The variant really used: what the offer allows. */
  variant: DownloadVariant;
  /** Whether the offer allows the originals (the choice is offered only then). */
  originalsAllowed: boolean;
  title: string;
}

/** The organiser's own, active event with its offer: the only one they can download. */
async function ownEvent(admin: Client, ownerId: string, eventId: string) {
  const { data, error } = await admin
    .from("events")
    .select("id, title, plan")
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The file of a media for a variant: the original when allowed and kept, else the display version. */
function fileFor(
  row: {
    kind: string;
    key_original: string | null;
    key_display: string | null;
    bytes_original: number | null;
    bytes_display: number | null;
  },
  variant: DownloadVariant,
): { key: string; bytes: number } | null {
  const useOriginal = variant === "originals" || row.kind === "video";
  const key = useOriginal
    ? (row.key_original ?? row.key_display)
    : (row.key_display ?? row.key_original);
  if (!key) return null;
  const bytes = key === row.key_original ? row.bytes_original : row.bytes_display;
  return { key, bytes: Number(bytes ?? 0) };
}

const extensionOf = (key: string) => /\.([a-z0-9]{2,5})$/i.exec(key)?.[1]?.toLowerCase() ?? "bin";

/**
 * What the album download contains, in the order the photos were taken (F-080, F-083): every
 * approved, ready media of the event, with what the browser needs to name and cut the ZIPs. Pages of
 * 500 (PostgREST answers at most 1 000 rows, and the next page needs one more to be known). The addresses are not here: they expire after an hour, so the browser asks for them
 * group by group right before downloading (`signAlbumFiles`). The offer decides the variant: the
 * originals only when `plans.ts` says the ZIP contains them, whatever the browser asks.
 */
export async function planAlbum(
  deps: DownloadDeps,
  ownerId: string,
  eventId: string,
  options: { variant: DownloadVariant; cursor?: string },
): Promise<DownloadResult<AlbumPlan>> {
  const { admin } = deps;
  const event = await ownEvent(admin, ownerId, eventId);
  if (!event) return fail(404, "not_found");
  const originalsAllowed = getPlan(event.plan as PlanId).zipContains === "originals";
  const variant: DownloadVariant = originalsAllowed ? options.variant : "optimized";

  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (options.cursor && !cursor) return fail(400, "validation_failed");

  let query = admin
    .from("media")
    .select(
      "id, kind, guest_id, taken_at, created_at, captured_at, key_original, key_display, bytes_original, bytes_display",
    )
    .eq("event_id", eventId)
    .eq("status", "ready")
    .eq("moderation", "approved");
  if (cursor) {
    const [value, id] = cursor;
    query = query.or(`captured_at.gt."${value}",and(captured_at.eq."${value}",id.gt.${id})`);
  }
  const { data, error } = await query
    .order("captured_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(PLAN_PAGE_SIZE + 1);
  if (error) throw error;

  const rows = data ?? [];
  const pageRows = rows.slice(0, PLAN_PAGE_SIZE);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > PLAN_PAGE_SIZE && last ? encodeCursor(last.captured_at!, last.id) : null;

  const { data: guests, error: guestError } = await admin
    .from("guests")
    .select("id, display_name")
    .eq("event_id", eventId);
  if (guestError) throw guestError;
  const names = new Map((guests ?? []).map((guest) => [guest.id, guest.display_name]));

  const items: PlanItem[] = [];
  for (const row of pageRows) {
    const file = fileFor(row, variant);
    if (!file) continue;
    items.push({
      mediaId: row.id,
      kind: row.kind as "photo" | "video",
      at: new Date(row.captured_at ?? row.created_at).toISOString(),
      guestName: names.get(row.guest_id) ?? null,
      guestId: row.guest_id,
      bytes: file.bytes,
      extension: extensionOf(file.key),
    });
  }
  return { ok: true, body: { items, nextCursor, variant, originalsAllowed, title: event.title } };
}

/**
 * Short-lived read addresses for a group of files of the album, right before the browser downloads
 * them (SPEC 9.1): at most 100, only media of the organiser's own event that the album contains,
 * and the variant the offer allows. Files never pass through the server.
 */
export async function signAlbumFiles(
  deps: DownloadDeps,
  ownerId: string,
  eventId: string,
  mediaIds: readonly string[],
  requested: DownloadVariant,
): Promise<DownloadResult<{ files: { mediaId: string; url: string }[] }>> {
  const { admin, storage } = deps;
  const ids = [...new Set(mediaIds)];
  if (ids.length === 0 || ids.length > SIGN_BATCH_SIZE) return fail(400, "validation_failed");
  const event = await ownEvent(admin, ownerId, eventId);
  if (!event) return fail(404, "not_found");
  const variant: DownloadVariant =
    getPlan(event.plan as PlanId).zipContains === "originals" ? requested : "optimized";

  const { data, error } = await admin
    .from("media")
    .select("id, kind, key_original, key_display, bytes_original, bytes_display")
    .eq("event_id", eventId)
    .eq("status", "ready")
    .eq("moderation", "approved")
    .in("id", ids);
  if (error) throw error;

  const files = (
    await Promise.all(
      (data ?? []).map(async (row) => {
        const file = fileFor(row, variant);
        return file ? { mediaId: row.id, url: await storage.presignRead(file.key) } : null;
      }),
    )
  ).filter((file) => file !== null);
  return { ok: true, body: { files } };
}
