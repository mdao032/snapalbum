import { describe, expect, it } from "vitest";
import { FEEDBACK_MESSAGE_MAX_LENGTH, feedbackRequestSchema } from "./feedback";

const valid = { audience: "guest", eventCode: "abcdefghjk", rating: 4, locale: "fr" } as const;

describe("6.2: avis", () => {
  it("6.2: la note est un entier de 1 à 5, le commentaire est facultatif et nettoyé", () => {
    const parsed = feedbackRequestSchema.parse({ ...valid, message: "  Très bien  " });
    expect(parsed.message).toBe("Très bien");
    expect(feedbackRequestSchema.parse(valid).message).toBe("");
    for (const rating of [0, 6, 2.5, "3", null]) {
      expect(feedbackRequestSchema.safeParse({ ...valid, rating }).success, String(rating)).toBe(
        false,
      );
    }
  });

  it("6.2: le public, la langue et le code d'événement sont contrôlés", () => {
    expect(feedbackRequestSchema.safeParse({ ...valid, audience: "visitor" }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({ ...valid, locale: "de" }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({ ...valid, eventCode: "x" }).success).toBe(false);
  });

  it("6.2: un commentaire trop long est refusé", () => {
    const long = "x".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1);
    expect(feedbackRequestSchema.safeParse({ ...valid, message: long }).success).toBe(false);
    const limit = "x".repeat(FEEDBACK_MESSAGE_MAX_LENGTH);
    expect(feedbackRequestSchema.safeParse({ ...valid, message: limit }).success).toBe(true);
  });
});
