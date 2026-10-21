import { z } from "zod";
import { publicCodeSchema, sha256Schema, uuidSchema } from "./common";

export const mediaKindSchema = z.enum(["photo", "video"]);

/** `POST /api/uploads/reserve` body (SPEC 8.1, step 3). */
export const reserveUploadRequestSchema = z.object({
  eventCode: publicCodeSchema,
  kind: mediaKindSchema,
  sha256: sha256Schema,
  mimeType: z.string().min(3).max(100),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  takenAt: z.iso.datetime().optional(),
});
export type ReserveUploadRequest = z.infer<typeof reserveUploadRequestSchema>;

const signedTargetSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

export const reserveUploadResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("reserved"),
    mediaId: uuidSchema,
    original: signedTargetSchema.nullable(),
    display: signedTargetSchema,
    thumb: signedTargetSchema,
  }),
  /** The same file was already received: nothing to upload (NF-012). */
  z.object({ status: z.literal("already_received"), mediaId: uuidSchema }),
]);
export type ReserveUploadResponse = z.infer<typeof reserveUploadResponseSchema>;

export const completeUploadRequestSchema = z.object({
  mediaId: uuidSchema,
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

export const completeUploadResponseSchema = z.object({
  mediaId: uuidSchema,
  status: z.enum(["ready", "pending_moderation"]),
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

/** Stable error codes returned by the API so every client can translate them. */
export const API_ERROR_CODES = [
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "album_full",
  "video_limit_reached",
  "video_too_long",
  "file_too_large",
  "upload_window_closed",
  "guest_blocked",
  "free_event_limit",
  "event_suspended",
  "unsupported_format",
  "internal_error",
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
