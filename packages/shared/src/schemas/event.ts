import { z } from "zod";
import { ACCENT_PRESETS, EVENT_TITLE_MAX_LENGTH, WELCOME_MESSAGE_MAX_LENGTH } from "../constants";
import { accentColorSchema, eventTypeSchema, localeSchema } from "./common";

export { ACCENT_PRESETS, EVENT_TITLE_MAX_LENGTH, WELCOME_MESSAGE_MAX_LENGTH };

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

/**
 * "Personalise" form (F-011). Empty strings come straight from the form: no message means `null`,
 * no accent means `null` (the product color). The event date is not editable here (it drives the
 * expiry, so only the server changes it).
 */
export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(EVENT_TITLE_MAX_LENGTH),
  type: eventTypeSchema,
  locale: localeSchema,
  welcomeMessage: z
    .string()
    .trim()
    .max(WELCOME_MESSAGE_MAX_LENGTH)
    .transform((value) => (value === "" ? null : value)),
  accentColor: z.union([accentColorSchema, z.literal("")]).transform((v) => (v === "" ? null : v)),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
