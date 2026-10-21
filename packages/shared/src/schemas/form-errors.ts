import type { z } from "zod";

/** What is wrong with a form field, in terms the interface can translate. */
export type FieldErrorCode = "required" | "too_long" | "invalid";

/** First problem of each field of a failed Zod parse, keyed by field name. */
export function toFieldErrors(error: z.ZodError): Record<string, FieldErrorCode> {
  const result: Record<string, FieldErrorCode> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (field in result) continue;
    if (issue.code === "too_big") result[field] = "too_long";
    else if (issue.code === "too_small") result[field] = "required";
    else result[field] = "invalid";
  }
  return result;
}
