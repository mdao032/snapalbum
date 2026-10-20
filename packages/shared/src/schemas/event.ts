import { z } from "zod";
import { accentColorSchema, eventTypeSchema, localeSchema } from "./common";

export const WELCOME_MESSAGE_MAX_LENGTH = 500;
export const EVENT_TITLE_MAX_LENGTH = 80;

/** Event creation form (F-010, F-011), validated on the client and on the server. */
export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(EVENT_TITLE_MAX_LENGTH),
  eventDate: z.iso.date(),
  type: eventTypeSchema,
  locale: localeSchema,
  welcomeMessage: z.string().trim().max(WELCOME_MESSAGE_MAX_LENGTH).optional(),
  accentColor: accentColorSchema.optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;
