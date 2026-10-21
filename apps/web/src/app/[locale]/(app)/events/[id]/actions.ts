"use server";

import {
  toFieldErrors,
  updateEventSchema,
  uuidSchema,
  type FieldErrorCode,
} from "@snapalbum/shared";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getOrganiser } from "@/server/auth";
import { updateEventPresentation } from "@/server/events";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type PersonalizeState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; fieldErrors?: Record<string, FieldErrorCode> };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Saves name, type, language, welcome message and accent color of an event (F-011). */
export async function personalizeEventAction(
  eventId: string,
  _previous: PersonalizeState,
  formData: FormData,
): Promise<PersonalizeState> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return redirect({ href: "/login", locale: await getLocale() });
  if (!uuidSchema.safeParse(eventId).success) return { status: "error" };

  const input = {
    title: text(formData, "title"),
    type: text(formData, "type"),
    locale: text(formData, "locale"),
    welcomeMessage: text(formData, "welcomeMessage"),
    accentColor: text(formData, "accentColor"),
  };
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  try {
    const result = await updateEventPresentation(supabase, eventId, input);
    return result.ok ? { status: "saved" } : { status: "error" };
  } catch (error) {
    console.error("[events] update failed", error);
    return { status: "error" };
  }
}
