import "../zod-runtime";
import { z } from "zod";
import { publicCodeSchema } from "./common";

/** Longest comment, in characters. */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 1000;

/**
 * Feedback during the field beta (step 6.2), from an organiser or from a guest of an event. The
 * server checks that the author really is who they say: the owner of the event for `organiser`, a
 * guest of it for `guest`. The comment is optional; the rating is not.
 */
export const feedbackRequestSchema = z.object({
  audience: z.enum(["organiser", "guest"]),
  eventCode: publicCodeSchema,
  rating: z.number().int().min(1).max(5),
  message: z.string().trim().max(FEEDBACK_MESSAGE_MAX_LENGTH).default(""),
  locale: z.enum(["fr", "en"]),
});
export type FeedbackRequest = z.input<typeof feedbackRequestSchema>;
export type FeedbackRequestParsed = z.output<typeof feedbackRequestSchema>;

export const feedbackResponseSchema = z.object({ ok: z.literal(true) });
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
