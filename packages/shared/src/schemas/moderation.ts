import { z } from "zod";
import { galleryAccessSchema } from "./gallery";
import { uuidSchema } from "./common";
import { mediaKindSchema } from "./upload";

/** What the organiser can do with media (F-070, F-071). */
export const MODERATION_ACTIONS = ["approve", "reject", "hide", "restore", "delete"] as const;
export const moderationActionSchema = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

/** Media acted on in one go: enough for a whole page of the list, small enough for one request. */
export const MAX_MODERATION_BATCH = 200;

/** The lists of the moderation page. */
export const MODERATION_FILTERS = ["pending", "visible", "hidden", "refused", "reported"] as const;
export const moderationFilterSchema = z.enum(MODERATION_FILTERS);
export type ModerationFilter = z.infer<typeof moderationFilterSchema>;

/** Why a visitor reports a photo (F-073). */
export const REPORT_REASONS = ["inappropriate", "private", "other"] as const;
export const reportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * `POST /api/gallery/report` (F-073): a guest, or the holder of a share link, reports a photo they
 * see in the album. One report per person and photo; the organiser is told.
 */
export const reportRequestSchema = z.object({
  access: galleryAccessSchema,
  mediaId: uuidSchema,
  reason: reportReasonSchema,
});
export type ReportRequest = z.input<typeof reportRequestSchema>;

export const reportResponseSchema = z.object({ ok: z.literal(true) });
export type ReportResponse = z.infer<typeof reportResponseSchema>;

/** A media as the moderation page lists it. */
export const moderationItemSchema = z.object({
  mediaId: uuidSchema,
  kind: mediaKindSchema,
  thumbUrl: z.url().nullable(),
  guestId: uuidSchema,
  guestName: z.string().nullable(),
  status: z.string(),
  moderation: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Open reports on this media. */
  reports: z.number().int().nonnegative(),
});
export type ModerationItem = z.infer<typeof moderationItemSchema>;
