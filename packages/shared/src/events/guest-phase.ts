import { parseEventDate, type EventSettings } from "./settings";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The party is over this many hours after the start of the event date (midnight UTC): the evening
 * of the event, its late night, and the morning after, whatever the time zone (F-043). The event
 * date has no time of day, so this is a margin rather than a measurement.
 */
export const EVENT_OVER_AFTER_HOURS = 36;

/** When the event is considered over, for the page the guests see (F-043). */
export function eventOverAt(eventDate: string): Date {
  return new Date(parseEventDate(eventDate).getTime() + EVENT_OVER_AFTER_HOURS * HOUR_MS);
}

/**
 * What the event page offers a guest right now (F-043):
 *  - `soon`: uploads are not open yet;
 *  - `live`: the event is on, sending photos is the main action;
 *  - `after`: the event is over but the upload window is still open, so the album comes first and
 *    sending stays available as a secondary action;
 *  - `closed`: the upload window has ended, only the album remains.
 * Only a convenience for the screen: the server decides what is accepted (`reserve_media_slot`).
 */
export type GuestPhase = "soon" | "live" | "after" | "closed";

export function guestPhase(
  event: {
    eventDate: string;
    settings: Pick<EventSettings, "upload_opens_at" | "upload_closes_at"> &
      Partial<Pick<EventSettings, "album_ready_at">>;
  },
  now: Date,
): GuestPhase {
  const time = now.getTime();
  if (time < Date.parse(event.settings.upload_opens_at)) return "soon";
  if (time >= Date.parse(event.settings.upload_closes_at)) return "closed";
  // The organiser declaring the album ready ends the party for the page, whatever the date says.
  const readyAt = event.settings.album_ready_at
    ? Date.parse(event.settings.album_ready_at)
    : Infinity;
  return time >= Math.min(eventOverAt(event.eventDate).getTime(), readyAt) ? "after" : "live";
}
