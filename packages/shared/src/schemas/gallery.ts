import "../zod-runtime";
import { z } from "zod";
import { publicCodeSchema, uuidSchema } from "./common";
import { mediaKindSchema } from "./upload";

/** Media per page of the gallery: one signed address per thumbnail, generated in one batch. */
export const GALLERY_PAGE_SIZE = 60;
export const GALLERY_MAX_PAGE_SIZE = 100;
/** Photos the viewer asks addresses for at once (the open one and its neighbours). */
export const GALLERY_MAX_FILES = 12;

/** A share link token: 24 random bytes in base64url (F-054). */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, "Invalid share token");

/**
 * Who asks for the gallery: a guest of the event (with the cookie or Bearer session) or the holder
 * of a read-only share link, who needs no session at all (F-039, F-054).
 */
export const galleryAccessSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), eventCode: publicCodeSchema }),
  z.object({ type: z.literal("share"), token: shareTokenSchema }),
]);
export type GalleryAccess = z.infer<typeof galleryAccessSchema>;

/** Sort key (F-052): the day a photo was taken (EXIF) or the day it was sent. */
export const gallerySortSchema = z.enum(["taken", "sent"]);
export type GallerySort = z.infer<typeof gallerySortSchema>;
export const galleryOrderSchema = z.enum(["desc", "asc"]);
export type GalleryOrder = z.infer<typeof galleryOrderSchema>;

/** Keyset cursor handed back by the server: opaque for clients. */
export const galleryCursorSchema = z.string().min(1).max(200);

export const galleryRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    access: galleryAccessSchema,
    sort: gallerySortSchema.default("taken"),
    order: galleryOrderSchema.default("desc"),
    /** Only photos or only videos; absent means both (F-052). */
    kind: mediaKindSchema.optional(),
    /** Only what one guest sent (F-052). Ignored on a share link, which shows no guest. */
    guestId: uuidSchema.optional(),
    cursor: galleryCursorSchema.optional(),
    limit: z.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE).default(GALLERY_PAGE_SIZE),
  }),
  /** Fresh addresses for the thumbnails the screen shows, before the old ones expire. */
  z.object({
    action: z.literal("thumbs"),
    access: galleryAccessSchema,
    mediaIds: z.array(uuidSchema).min(1).max(GALLERY_MAX_PAGE_SIZE),
  }),
  /** The display version, the video and the download of the photos the viewer shows. */
  z.object({
    action: z.literal("files"),
    access: galleryAccessSchema,
    mediaIds: z.array(uuidSchema).min(1).max(GALLERY_MAX_FILES),
  }),
]);
export type GalleryRequest = z.input<typeof galleryRequestSchema>;
/** The request once validated, with the defaults filled in (what the server works with). */
export type GalleryRequestParsed = z.output<typeof galleryRequestSchema>;

export const galleryItemSchema = z.object({
  mediaId: uuidSchema,
  kind: mediaKindSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationS: z.number().nonnegative().nullable(),
  blurhash: z.string().nullable(),
  /** Short-lived address of the thumbnail (SPEC 9.1). */
  thumbUrl: z.url().nullable(),
  takenAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

export const galleryGuestSchema = z.object({
  id: uuidSchema,
  /** Null for a guest who gave no name. */
  name: z.string().nullable(),
  count: z.number().int().nonnegative(),
});
export type GalleryGuest = z.infer<typeof galleryGuestSchema>;

export const galleryFileSchema = z.object({
  mediaId: uuidSchema,
  /** The 2 048 px version of a photo, to look at. Null for a video. */
  displayUrl: z.url().nullable(),
  /** The video itself, to play. Null for a photo. */
  videoUrl: z.url().nullable(),
  /** The file to save: the original when it is kept, else the display version. */
  downloadUrl: z.url(),
});
export type GalleryFile = z.infer<typeof galleryFileSchema>;

export const galleryResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    items: z.array(galleryItemSchema),
    /** Null on the last page. */
    nextCursor: galleryCursorSchema.nullable(),
    /** Media matching the filters (all pages); only sent with the first page, null after. */
    total: z.number().int().nonnegative().nullable(),
    /** Seconds the addresses of this page stay valid. */
    urlsValidSeconds: z.number().int().positive(),
    /** Guests with at least one media, for the filter. Only on the first page, empty on a share link. */
    guests: z.array(galleryGuestSchema),
  }),
  z.object({
    action: z.literal("thumbs"),
    urls: z.array(z.object({ mediaId: uuidSchema, thumbUrl: z.url().nullable() })),
    urlsValidSeconds: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("files"),
    files: z.array(galleryFileSchema),
    urlsValidSeconds: z.number().int().positive(),
  }),
]);
export type GalleryResponse = z.infer<typeof galleryResponseSchema>;
export type GalleryListResponse = Extract<GalleryResponse, { action: "list" }>;

/** `GET`-free summary of a share link for the organiser's dashboard (F-054). */
export const shareLinkSchema = z.object({
  id: uuidSchema,
  token: shareTokenSchema,
  createdAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;
