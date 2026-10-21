import { z } from "zod";
import { ORIGINAL_EXTENSIONS } from "../storage/keys";
import { publicCodeSchema, sha256Schema, uuidSchema } from "./common";

export const mediaKindSchema = z.enum(["photo", "video"]);

const positiveBytes = z
  .number()
  .int()
  .positive()
  .max(5 * 1024 ** 3);

/**
 * `POST /api/uploads/reserve` body (SPEC 8.1, step 3). `bytes` is the size of the original file;
 * the browser prepares a display version (photos) and a thumbnail before reserving, so it knows
 * their exact sizes, which are signed into the upload addresses (S-002).
 */
export const reserveUploadRequestSchema = z
  .object({
    eventCode: publicCodeSchema,
    kind: mediaKindSchema,
    sha256: sha256Schema,
    mimeType: z.string().min(3).max(100),
    /** Extension of the original file, without the dot. */
    extension: z.enum(ORIGINAL_EXTENSIONS),
    bytes: positiveBytes,
    /** Photos only: size of the display version (WebP, or JPEG where WebP is missing). */
    displayBytes: positiveBytes.optional(),
    thumbBytes: positiveBytes,
    /** Format of the prepared versions: WebP unless the browser cannot encode it. */
    previewFormat: z.enum(["webp", "jpeg"]).default("webp"),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
    durationSeconds: z.number().nonnegative().max(86400).optional(),
    takenAt: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "photo" && value.displayBytes === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["displayBytes"],
        message: "A photo needs its display version",
      });
    }
    if (value.kind === "video" && value.displayBytes !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["displayBytes"],
        message: "A video has no display version",
      });
    }
  });
export type ReserveUploadRequest = z.input<typeof reserveUploadRequestSchema>;
export type ParsedReserveUploadRequest = z.output<typeof reserveUploadRequestSchema>;

const signedTargetSchema = z.object({
  url: z.url(),
  /** Headers to send with the PUT, exactly as signed. */
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type SignedTarget = z.infer<typeof signedTargetSchema>;

export const reserveUploadResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("reserved"),
    mediaId: uuidSchema,
    /** Single-request upload of the original (paid-plan photos, short videos). */
    original: signedTargetSchema.nullable(),
    /** Large videos: send the original in parts through `/api/uploads/multipart`. */
    multipart: z
      .object({ partSize: z.number().int().positive(), partCount: z.number().int().positive() })
      .nullable(),
    /** Photos only. */
    display: signedTargetSchema.nullable(),
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

/** `POST /api/uploads/multipart`: sending a large video in parts (NF-013). */
export const multipartRequestSchema = z.discriminatedUnion("action", [
  /** Starts (or resumes) the multipart upload of the original. */
  z.object({ action: z.literal("create"), mediaId: uuidSchema }),
  /** Address for one part (1 to `partCount`). */
  z.object({
    action: z.literal("part"),
    mediaId: uuidSchema,
    partNumber: z.number().int().min(1).max(10000),
  }),
  /** Parts already stored, to resume at the right part after an interruption. */
  z.object({ action: z.literal("status"), mediaId: uuidSchema }),
  /** All parts sent: assemble the file (the server reads the parts from the storage). */
  z.object({ action: z.literal("complete"), mediaId: uuidSchema }),
  /** Gives up: frees what was received. */
  z.object({ action: z.literal("abort"), mediaId: uuidSchema }),
]);
export type MultipartRequest = z.infer<typeof multipartRequestSchema>;

export const multipartResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    partSize: z.number().int().positive(),
    partCount: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("part"),
    partNumber: z.number().int().positive(),
    target: signedTargetSchema,
  }),
  z.object({
    action: z.literal("status"),
    parts: z.array(
      z.object({ partNumber: z.number().int().positive(), size: z.number().int().nonnegative() }),
    ),
  }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("abort") }),
]);
export type MultipartResponse = z.infer<typeof multipartResponseSchema>;

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
  "terms_required",
  "upload_incomplete",
  "invalid_file",
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
