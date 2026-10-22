"use server";

import type { Locale } from "@snapalbum/shared";
import { revalidatePath } from "next/cache";
import { cancelAccountDeletion, requestAccountDeletion } from "@/server/account";
import { getOrganiser, updateProfile } from "@/server/auth";
import { scheduleAccountDeletionNotice } from "@/server/notify-after";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type AccountFormState =
  { status: "idle" } | { status: "saved"; locale: Locale } | { status: "error" };

/** Saves the name and the preferred language (F-003). */
export async function updateProfileAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return { status: "error" };

  const result = await updateProfile(supabase, user.id, {
    displayName: String(formData.get("displayName") ?? ""),
    locale: formData.get("locale"),
  });
  return result.ok ? { status: "saved", locale: result.locale } : { status: "error" };
}

export type DeletionFormState =
  | { status: "idle" }
  /** The day the deletion becomes final (an ISO instant). */
  | { status: "requested"; purgeAt: string }
  | { status: "cancelled" }
  | { status: "error"; error: "failed" | "too_late" };

/**
 * Starts the deletion of the account (F-004): the person must have ticked the box, the events
 * close for guests at once, a confirmation e-mail goes out, and the 7 days start. The user is the
 * one the session says; nothing in the form chooses it.
 */
export async function requestAccountDeletionAction(
  _previous: DeletionFormState,
  formData: FormData,
): Promise<DeletionFormState> {
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user || formData.get("confirm") !== "on") return { status: "error", error: "failed" };

  try {
    const admin = createSupabaseAdminClient();
    const result = await requestAccountDeletion(admin, user.id);
    if (!result.ok) return { status: "error", error: "failed" };
    scheduleAccountDeletionNotice(admin, user.id, result.deletedAt);
    revalidatePath("/", "layout");
    return { status: "requested", purgeAt: result.purgeAt.toISOString() };
  } catch (error) {
    console.error("[account] deletion request failed", error);
    return { status: "error", error: "failed" };
  }
}

/** Cancels the deletion within the 7 days: the account and the events closed by it come back. */
export async function cancelAccountDeletionAction(
  _previous: DeletionFormState,
): Promise<DeletionFormState> {
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user) return { status: "error", error: "failed" };

  try {
    const result = await cancelAccountDeletion(createSupabaseAdminClient(), user.id);
    if (!result.ok) {
      return { status: "error", error: result.reason === "too_late" ? "too_late" : "failed" };
    }
    revalidatePath("/", "layout");
    return { status: "cancelled" };
  } catch (error) {
    console.error("[account] deletion cancel failed", error);
    return { status: "error", error: "failed" };
  }
}
