import "server-only";
import {
  checkDeclaredFormat,
  checkQuota,
  getPlan,
  isPreviewImage,
  matchesKind,
  mediaKey,
  MAX_DISPLAY_BYTES,
  MAX_THUMB_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  multipartPartCount,
  needsMultipart,
  UPLOAD_URL_TTL_SECONDS,
  type ApiErrorCode,
  type CompleteUploadResponse,
  type MultipartRequest,
  type MultipartResponse,
  type MyMediaRequest,
  type MyMediaResponse,
  type ParsedReserveUploadRequest,
  type PlanId,
  type ReserveUploadResponse,
  type SignedTarget,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Storage } from "./storage";

type Client = SupabaseClient<Database>;
type MediaRow = Database["public"]["Tables"]["media"]["Row"];

export interface UploadDeps {
  /** Service role client: the media tables are only written by the server. */
  admin: Client;
  storage: Storage;
  now?: () => Date;
  newId?: () => string;
}

export type UploadFailure = { ok: false; status: number; code: ApiErrorCode };
export type UploadResult<T> = { ok: true; body: T } | UploadFailure;

const fail = (status: number, code: ApiErrorCode): UploadFailure => ({ ok: false, status, code });

/** What `reserve_media_slot` answers when it refuses, as an HTTP status and an API error code. */
const REFUSALS: Record<string, [number, ApiErrorCode]> = {
  event_not_found: [404, "not_found"],
  event_suspended: [403, "event_suspended"],
  upload_window_closed: [403, "upload_window_closed"],
  not_a_guest: [403, "forbidden"],
  guest_blocked: [403, "guest_blocked"],
  terms_required: [403, "terms_required"],
  album_full: [409, "album_full"],
  video_limit_reached: [409, "video_limit_reached"],
  invalid_input: [400, "validation_failed"],
};

/** The `reserve_media_slot` answer (a jsonb): see the migration for the shapes. */
interface ReservationAnswer {
  ok: boolean;
  result?: "reserved" | "resumed" | "duplicate";
  reason?: string;
  media_id?: string;
}

/** Multipart uploads are abandoned after a day: the bucket rule deletes the parts (docs). */
const MULTIPART_LIFETIME_MS = 24 * 60 * 60 * 1000;

function contentTypeOfPreview(key: string): string {
  return key.endsWith(".jpg") ? "image/jpeg" : "image/webp";
}

/**
 * Reserves an upload slot for a guest and returns the signed addresses (SPEC 8.1, step 3). The
 * server decides everything: plan limits come from `plans.ts`, the guest from the verified
 * session, the keys from the shared layout. The database function takes the slot atomically.
 */
export async function reserveUpload(
  deps: UploadDeps,
  user: { id: string },
  input: ParsedReserveUploadRequest,
): Promise<UploadResult<ReserveUploadResponse>> {
  const { admin, storage } = deps;
  const now = deps.now?.() ?? new Date();

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, plan")
    .eq("public_code", input.eventCode)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return fail(404, "not_found");
  const plan = getPlan(event.plan as PlanId);

  // Everything that needs no counting is decided here, once, from the plan.
  if (!checkDeclaredFormat(input.mimeType, input.extension, input.kind)) {
    return fail(415, "unsupported_format");
  }
  if (input.kind === "video" && input.durationSeconds === undefined)
    return fail(400, "validation_failed");
  if (
    (input.kind === "photo" && input.bytes > plan.maxPhotoBytes) ||
    (input.displayBytes ?? 0) > MAX_DISPLAY_BYTES ||
    input.thumbBytes > MAX_THUMB_BYTES
  ) {
    return fail(413, "file_too_large");
  }
  const stateless = checkQuota({
    plan: plan.id,
    mediaCount: 0,
    videoCount: 0,
    kind: input.kind,
    bytes: input.bytes,
    durationSeconds: input.durationSeconds,
  });
  if (!stateless.ok)
    return fail(stateless.reason === "file_too_large" ? 413 : 422, stateless.reason);

  const mediaId = (deps.newId ?? randomUUID)();
  const previewExtension = input.previewFormat === "jpeg" ? "jpg" : "webp";
  // Videos keep their single file as the "original"; photos keep it only on paid plans (R2).
  const storesOriginal = input.kind === "video" || plan.keepsOriginals;

  // The generated types cannot express "nullable argument": the function accepts null for each.
  const args = {
    p_event_id: event.id,
    p_user_id: user.id,
    p_media_id: mediaId,
    p_sha256: input.sha256,
    p_kind: input.kind,
    p_mime_type: input.mimeType.toLowerCase(),
    p_bytes_original: storesOriginal ? input.bytes : null,
    p_bytes_display: input.kind === "photo" ? (input.displayBytes ?? null) : null,
    p_bytes_thumb: input.thumbBytes,
    p_width: input.width ?? null,
    p_height: input.height ?? null,
    p_duration_s: input.durationSeconds ?? null,
    p_taken_at: input.takenAt ?? null,
    p_key_original: storesOriginal
      ? mediaKey(event.id, mediaId, "original", input.extension)
      : null,
    p_key_display:
      input.kind === "photo" ? mediaKey(event.id, mediaId, "display", previewExtension) : null,
    p_key_thumb: mediaKey(event.id, mediaId, "thumb", previewExtension),
    p_max_media: plan.maxMedia,
    p_max_videos: plan.maxVideos,
  };
  const { data, error } = await admin.rpc(
    "reserve_media_slot",
    args as unknown as Database["public"]["Functions"]["reserve_media_slot"]["Args"],
  );
  if (error) throw error;

  const answer = data as unknown as ReservationAnswer;
  if (!answer.ok) {
    const [status, code] = REFUSALS[answer.reason ?? ""] ?? [500, "internal_error" as ApiErrorCode];
    return fail(status, code);
  }
  if (answer.result === "duplicate" && answer.media_id) {
    return { ok: true, body: { status: "already_received", mediaId: answer.media_id } };
  }
  if (!answer.media_id) return fail(500, "internal_error");

  // A reservation resumed after an interruption keeps the keys of its first request.
  const { data: media, error: mediaError } = await admin
    .from("media")
    .select("*")
    .eq("id", answer.media_id)
    .single();
  if (mediaError) throw mediaError;

  // The placeholder only decorates the gallery: failing to store it never fails the upload.
  if (input.blurhash && !media.blurhash) {
    await admin.from("media").update({ blurhash: input.blurhash }).eq("id", media.id);
  }

  const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  const sign = async (key: string, contentType: string, bytes: number): Promise<SignedTarget> => {
    const signed = await storage.presignUpload(key, { contentType, contentLength: bytes });
    return { url: signed.url, headers: signed.headers, expiresAt };
  };

  const multipart =
    media.kind === "video" && media.bytes_original !== null && needsMultipart(media.bytes_original);
  return {
    ok: true,
    body: {
      status: "reserved",
      mediaId: media.id,
      plan: plan.id,
      original:
        media.key_original && media.bytes_original && !multipart
          ? await sign(media.key_original, media.mime_type, media.bytes_original)
          : null,
      multipart:
        multipart && media.bytes_original
          ? {
              partSize: MULTIPART_PART_SIZE_BYTES,
              partCount: multipartPartCount(media.bytes_original),
            }
          : null,
      display:
        media.key_display && media.bytes_display
          ? await sign(
              media.key_display,
              contentTypeOfPreview(media.key_display),
              media.bytes_display,
            )
          : null,
      thumb: await sign(
        media.key_thumb ?? "",
        contentTypeOfPreview(media.key_thumb ?? ""),
        media.bytes_thumb ?? 0,
      ),
    },
  };
}

/** The media of this guest, or null: someone else's media looks like a missing one. */
async function loadOwnMedia(
  admin: Client,
  userId: string,
  mediaId: string,
): Promise<MediaRow | null> {
  const { data, error } = await admin
    .from("media")
    .select("*, guests!inner(auth_user_id)")
    .eq("id", mediaId)
    .eq("guests.auth_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // The joined `guests` column only served the ownership filter above.
  return data as unknown as MediaRow;
}

function keysOf(media: MediaRow): string[] {
  return [media.key_original, media.key_display, media.key_thumb].filter((key): key is string =>
    Boolean(key),
  );
}

/** Removes the files of a refused upload and frees its slot (the counters follow by trigger). */
async function discard(deps: UploadDeps, media: MediaRow): Promise<void> {
  await Promise.all(
    keysOf(media).map((key) => deps.storage.deleteObject(key).catch(() => undefined)),
  );
  const { error } = await deps.admin.from("media").delete().eq("id", media.id);
  if (error) throw error;
}

function statusOf(media: Pick<MediaRow, "moderation">): CompleteUploadResponse["status"] {
  return media.moderation === "pending" ? "pending_moderation" : "ready";
}

/**
 * Confirms an upload (SPEC 8.1, step 5): every file must be in the storage with the declared
 * size, and its first bytes must match what it claims to be (S-002). A file that is not what it
 * says is deleted and its slot freed; a missing or short file is only "not finished yet".
 */
export async function completeUpload(
  deps: UploadDeps,
  user: { id: string },
  mediaId: string,
): Promise<UploadResult<CompleteUploadResponse>> {
  const media = await loadOwnMedia(deps.admin, user.id, mediaId);
  if (!media) return fail(404, "not_found");
  // Confirming twice is harmless (NF-012).
  if (media.status === "ready" || media.status === "uploaded") {
    return { ok: true, body: { mediaId: media.id, status: statusOf(media) } };
  }
  if (media.status !== "pending") return fail(404, "not_found");

  const expected = [
    {
      key: media.key_original,
      bytes: media.bytes_original,
      valid: (b: Uint8Array) => matchesKind(b, media.kind as "photo" | "video"),
    },
    { key: media.key_display, bytes: media.bytes_display, valid: isPreviewImage },
    { key: media.key_thumb, bytes: media.bytes_thumb, valid: isPreviewImage },
  ].filter((file): file is { key: string; bytes: number; valid: (b: Uint8Array) => boolean } =>
    Boolean(file.key && file.bytes),
  );

  for (const file of expected) {
    const info = await deps.storage.head(file.key);
    if (!info || info.size !== file.bytes) return fail(409, "upload_incomplete");
  }
  for (const file of expected) {
    const start = await deps.storage.readStart(file.key, 32);
    if (!file.valid(start)) {
      await discard(deps, media);
      return fail(422, "invalid_file");
    }
  }

  const { error } = await deps.admin
    .from("media")
    .update({ status: "ready" })
    .eq("id", media.id)
    .eq("status", "pending");
  if (error) throw error;
  return { ok: true, body: { mediaId: media.id, status: statusOf(media) } };
}

/** What every multipart action needs: the guest's own pending video and its original's key. */
async function loadMultipartTarget(deps: UploadDeps, userId: string, mediaId: string) {
  const media = await loadOwnMedia(deps.admin, userId, mediaId);
  if (!media || media.status !== "pending")
    return { ok: false, failure: fail(404, "not_found") } as const;
  if (!media.key_original || !media.bytes_original || !needsMultipart(media.bytes_original)) {
    return { ok: false, failure: fail(400, "validation_failed") } as const;
  }
  return {
    ok: true,
    media,
    key: media.key_original,
    bytes: media.bytes_original,
    partCount: multipartPartCount(media.bytes_original),
  } as const;
}

async function findUpload(admin: Client, mediaId: string) {
  const { data, error } = await admin
    .from("uploads")
    .select("id, multipart_upload_id, expires_at")
    .eq("media_id", mediaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Size the part `partNumber` must have: all parts are full except possibly the last (NF-013). */
export function expectedPartSize(totalBytes: number, partNumber: number): number {
  const start = (partNumber - 1) * MULTIPART_PART_SIZE_BYTES;
  return Math.max(0, Math.min(MULTIPART_PART_SIZE_BYTES, totalBytes - start));
}

/** Sending a large video in parts (NF-013), one action per request. */
export async function multipartAction(
  deps: UploadDeps,
  user: { id: string },
  request: MultipartRequest,
): Promise<UploadResult<MultipartResponse>> {
  const { admin, storage } = deps;
  const now = deps.now?.() ?? new Date();
  const target = await loadMultipartTarget(deps, user.id, request.mediaId);
  if (!target.ok) return target.failure;
  const { media, key, bytes, partCount } = target;
  let upload = await findUpload(admin, media.id);

  if (request.action === "create") {
    if (upload && new Date(upload.expires_at) > now) {
      return {
        ok: true,
        body: { action: "create", partSize: MULTIPART_PART_SIZE_BYTES, partCount },
      };
    }
    if (upload) {
      await storage.abortMultipart(key, upload.multipart_upload_id).catch(() => undefined);
      await admin.from("uploads").delete().eq("id", upload.id);
    }
    const uploadId = await storage.createMultipart(key, media.mime_type);
    const { error } = await admin.from("uploads").insert({
      media_id: media.id,
      multipart_upload_id: uploadId,
      expires_at: new Date(now.getTime() + MULTIPART_LIFETIME_MS).toISOString(),
    });
    if (error) {
      await storage.abortMultipart(key, uploadId).catch(() => undefined);
      throw error;
    }
    return { ok: true, body: { action: "create", partSize: MULTIPART_PART_SIZE_BYTES, partCount } };
  }

  // Every other action works on an upload that exists and has not expired.
  if (!upload || new Date(upload.expires_at) <= now) return fail(409, "upload_incomplete");

  switch (request.action) {
    case "part": {
      if (request.partNumber > partCount) return fail(400, "validation_failed");
      const length = expectedPartSize(bytes, request.partNumber);
      const url = await storage.presignPart(key, upload.multipart_upload_id, request.partNumber, {
        contentLength: length,
      });
      const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
      return {
        ok: true,
        body: {
          action: "part",
          partNumber: request.partNumber,
          target: { url, headers: { "Content-Length": String(length) }, expiresAt },
        },
      };
    }
    case "status": {
      const parts = await storage.listParts(key, upload.multipart_upload_id);
      await admin
        .from("uploads")
        .update({ parts_done: parts.map((part) => part.partNumber) })
        .eq("id", upload.id);
      return {
        ok: true,
        body: {
          action: "status",
          parts: parts.map(({ partNumber, size }) => ({ partNumber, size })),
        },
      };
    }
    case "complete": {
      const parts = await storage.listParts(key, upload.multipart_upload_id);
      const complete =
        parts.length === partCount &&
        parts.every((part) => part.size === expectedPartSize(bytes, part.partNumber));
      if (!complete) return fail(409, "upload_incomplete");
      // The storage is the truth: the parts and their tags come from it, not from the browser.
      await storage.completeMultipart(
        key,
        upload.multipart_upload_id,
        parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
      );
      await admin.from("uploads").delete().eq("id", upload.id);
      upload = null;
      return { ok: true, body: { action: "complete" } };
    }
    case "abort": {
      await storage.abortMultipart(key, upload.multipart_upload_id).catch(() => undefined);
      await admin.from("uploads").delete().eq("id", upload.id);
      return { ok: true, body: { action: "abort" } };
    }
  }
}

/** Most recent uploads shown in "Mes photos". */
const MY_MEDIA_LIMIT = 200;

/**
 * The guest's own uploads and deletion of one of them (F-038, G-005). Only the guest's own media
 * is ever reachable: someone else's looks like a missing one. A deletion frees the quota slot (the
 * counters ignore deleted media) and removes the files from the storage; the same file can be sent
 * again later.
 */
export async function myMedia(
  deps: UploadDeps,
  user: { id: string },
  request: MyMediaRequest,
): Promise<UploadResult<MyMediaResponse>> {
  if (request.action === "delete") {
    const media = await loadOwnMedia(deps.admin, user.id, request.mediaId);
    if (!media) return fail(404, "not_found");
    // Deleting twice is harmless.
    if (media.status === "deleted") return { ok: true, body: { action: "delete" } };
    const { error } = await deps.admin
      .from("media")
      .update({ status: "deleted" })
      .eq("id", media.id);
    if (error) throw error;
    await Promise.all(
      keysOf(media).map((key) => deps.storage.deleteObject(key).catch(() => undefined)),
    );
    return { ok: true, body: { action: "delete" } };
  }

  const { data: event, error: eventError } = await deps.admin
    .from("events")
    .select("id")
    .eq("public_code", request.eventCode)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return fail(404, "not_found");
  const { data: guest, error: guestError } = await deps.admin
    .from("guests")
    .select("id")
    .eq("event_id", event.id)
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (guestError) throw guestError;
  if (!guest) return { ok: true, body: { action: "list", items: [] } };

  const { data: rows, error } = await deps.admin
    .from("media")
    .select("id, kind, moderation, created_at, key_thumb")
    .eq("guest_id", guest.id)
    .eq("status", "ready")
    // A photo the organiser refused is not shown back to its author as waiting.
    .neq("moderation", "rejected")
    .order("created_at", { ascending: false })
    .limit(MY_MEDIA_LIMIT);
  if (error) throw error;

  const items = await Promise.all(
    (rows ?? []).map(async (row) => ({
      mediaId: row.id,
      kind: row.kind as "photo" | "video",
      moderation: row.moderation === "pending" ? ("pending" as const) : ("approved" as const),
      createdAt: new Date(row.created_at).toISOString(),
      thumbUrl: row.key_thumb ? await deps.storage.presignRead(row.key_thumb) : null,
    })),
  );
  return { ok: true, body: { action: "list", items } };
}
