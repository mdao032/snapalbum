import { z } from "zod";
import { accessCodeSchema } from "../schemas/guest";

/** Default upload window around the event date (F-016). */
export const UPLOAD_WINDOW_DAYS_BEFORE = 7;
export const UPLOAD_WINDOW_DAYS_AFTER = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Content of `events.settings` (jsonb). Keys are snake_case because the database reads them too
 * (`reserve_media_slot`, phase 2).
 */
export const eventSettingsSchema = z
  .object({
    /** Guests can browse the gallery (F-015, F-039). */
    gallery_visible: z.boolean(),
    /** New media wait for the organiser's approval before appearing (F-015, F-071). */
    require_approval: z.boolean(),
    /** Uploads are accepted between these two instants (F-016). */
    upload_opens_at: z.iso.datetime(),
    upload_closes_at: z.iso.datetime(),
    /** Hash of the optional access code (F-017). Never the code itself. */
    access_code_hash: z.string().nullable().optional(),
    /** When the organiser declared the album ready: guests who asked get its link (F-044). */
    album_ready_at: z.iso.datetime().nullable().optional(),
  })
  .refine((s) => Date.parse(s.upload_opens_at) < Date.parse(s.upload_closes_at), {
    message: "The upload window must open before it closes",
    path: ["upload_closes_at"],
  });

export type EventSettings = z.infer<typeof eventSettingsSchema>;

/** Parses an ISO calendar date (`2026-09-12`) as midnight UTC. */
export function parseEventDate(eventDate: string): Date {
  const parsed = new Date(`${eventDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid event date: ${eventDate}`);
  return parsed;
}

export function defaultEventSettings(eventDate: string): EventSettings {
  const day = parseEventDate(eventDate).getTime();
  return {
    gallery_visible: true,
    require_approval: false,
    upload_opens_at: new Date(day - UPLOAD_WINDOW_DAYS_BEFORE * DAY_MS).toISOString(),
    upload_closes_at: new Date(day + UPLOAD_WINDOW_DAYS_AFTER * DAY_MS).toISOString(),
    access_code_hash: null,
  };
}

/** True when `now` is inside the organiser's upload window. */
export function isUploadWindowOpen(settings: EventSettings, now: Date): boolean {
  const time = now.getTime();
  return (
    time >= Date.parse(settings.upload_opens_at) && time < Date.parse(settings.upload_closes_at)
  );
}

/**
 * "Settings" form of the dashboard (F-015, F-016). The two instants come from the browser as ISO
 * dates (the organiser's own time zone is applied there); the access code hash is never touched.
 */
export const updateEventSettingsSchema = z
  .object({
    gallery_visible: z.boolean(),
    require_approval: z.boolean(),
    upload_opens_at: z.iso.datetime(),
    upload_closes_at: z.iso.datetime(),
    /** A new access code (F-017), "" to remove it, absent to leave it as it is. */
    access_code: z.union([accessCodeSchema, z.literal("")]).optional(),
  })
  .refine((s) => Date.parse(s.upload_opens_at) < Date.parse(s.upload_closes_at), {
    message: "The upload window must open before it closes",
    path: ["upload_closes_at"],
  });

export type UpdateEventSettingsInput = z.infer<typeof updateEventSettingsSchema>;
