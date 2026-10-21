"use server";

import type { Locale } from "@snapalbum/shared";
import { getOrganiser, updateProfile } from "@/server/auth";
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
