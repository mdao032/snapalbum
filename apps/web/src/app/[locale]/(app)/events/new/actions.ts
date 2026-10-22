"use server";

import { createEventSchema, toFieldErrors, type FieldErrorCode } from "@snapalbum/shared";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getOrganiser } from "@/server/auth";
import { createEvent } from "@/server/events";
import { scheduleWelcome } from "@/server/notify-after";
import { checkRateLimit, EVENT_CREATION_RATE_LIMIT } from "@/server/rate-limit";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type CreateEventState =
  | { status: "idle" }
  | {
      status: "error";
      error: "validation" | "free_event_limit" | "rate_limited" | "failed";
      fieldErrors?: Record<string, FieldErrorCode>;
    };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Creates the event (F-010) and goes to its page. The quota and the code are decided here. */
export async function createEventAction(
  _previous: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const locale = await getLocale();
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user) return redirect({ href: "/login", locale });

  const parsed = createEventSchema.safeParse({
    title: text(formData, "title"),
    eventDate: text(formData, "eventDate"),
    type: text(formData, "type"),
    locale: text(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", error: "validation", fieldErrors: toFieldErrors(parsed.error) };
  }

  if (!(await checkRateLimit(EVENT_CREATION_RATE_LIMIT, user.id)).allowed) {
    return { status: "error", error: "rate_limited" };
  }

  let eventId: string;
  try {
    const admin = createSupabaseAdminClient();
    const result = await createEvent(admin, user.id, parsed.data);
    if (!result.ok) return { status: "error", error: result.reason };
    eventId = result.event.id;
    // The welcome message, with the QR code, goes with the first event only.
    scheduleWelcome(admin, user.id, eventId);
  } catch (error) {
    console.error("[events] creation failed", error);
    return { status: "error", error: "failed" };
  }
  return redirect({ href: `/events/${eventId}`, locale });
}
