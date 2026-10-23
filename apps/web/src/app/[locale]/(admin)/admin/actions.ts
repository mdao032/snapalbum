"use server";

import { ADMIN_EXTEND_MONTHS, uuidSchema } from "@snapalbum/shared";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { extendEvent, setEventSuspended } from "@/server/admin";
import { getAdmin } from "@/server/auth";
import { createBetaInvitation, revokeBetaInvitation } from "@/server/beta";
import { dismissReports, moderateMedia } from "@/server/moderation";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * The administrator's gestures (F-091). A page is not a guard: each action looks at the role again
 * before doing anything, and what it did, or could not do, is shown on the page it comes back to.
 * Each one leaves a line in the audit log with the administrator's identifier.
 */

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const RETURN_PATHS =
  /^\/admin(\/(events(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?|organisers|payments|reports|beta))?$/;

/** Where to come back to: a page of the administrator area, never an address from elsewhere. */
function returnPath(formData: FormData): string {
  const value = text(formData, "returnTo");
  return RETURN_PATHS.test(value) ? value : "/admin";
}

async function comeBack(formData: FormData, outcome: "done" | "failed"): Promise<never> {
  const locale = await getLocale();
  return redirect({ href: `${returnPath(formData)}?${outcome}=1`, locale });
}

export async function suspendEventAction(formData: FormData): Promise<void> {
  const admin = await getAdmin(await createSupabaseServerClient());
  const eventId = uuidSchema.safeParse(text(formData, "eventId"));
  if (!admin || !eventId.success) return comeBack(formData, "failed");

  const result = await setEventSuspended(
    createSupabaseAdminClient(),
    admin.id,
    eventId.data,
    text(formData, "suspended") === "true",
  );
  return comeBack(formData, result.ok ? "done" : "failed");
}

export async function extendEventAction(formData: FormData): Promise<void> {
  const admin = await getAdmin(await createSupabaseServerClient());
  const eventId = uuidSchema.safeParse(text(formData, "eventId"));
  const months = Number(text(formData, "months"));
  if (!admin || !eventId.success || !(ADMIN_EXTEND_MONTHS as readonly number[]).includes(months)) {
    return comeBack(formData, "failed");
  }
  const result = await extendEvent(createSupabaseAdminClient(), admin.id, eventId.data, months);
  return comeBack(formData, result.ok ? "done" : "failed");
}

/** Hides a reported media, deletes it for good, or keeps it and closes its reports. */
export async function handleReportAction(formData: FormData): Promise<void> {
  const admin = await getAdmin(await createSupabaseServerClient());
  const eventId = uuidSchema.safeParse(text(formData, "eventId"));
  const mediaId = uuidSchema.safeParse(text(formData, "mediaId"));
  const action = text(formData, "action");
  if (
    !admin ||
    !eventId.success ||
    !mediaId.success ||
    !["hide", "delete", "dismiss"].includes(action)
  ) {
    return comeBack(formData, "failed");
  }

  const deps = { admin: createSupabaseAdminClient(), storage: getStorage(), asAdmin: true };
  const result =
    action === "dismiss"
      ? await dismissReports(deps, admin.id, eventId.data, [mediaId.data])
      : await moderateMedia(deps, admin.id, eventId.data, action as "hide" | "delete", [
          mediaId.data,
        ]);
  return comeBack(formData, result.ok ? "done" : "failed");
}

/** Field beta (step 6.1): makes an invitation code for an organiser's address. */
export async function createBetaInvitationAction(formData: FormData): Promise<void> {
  const admin = await getAdmin(await createSupabaseServerClient());
  const email = z.email().safeParse(text(formData, "email").trim());
  const locale = await getLocale();
  const back = (outcome: string) =>
    redirect({ href: `${returnPath(formData)}?${outcome}`, locale });
  if (!admin) return back("failed=failed");
  if (!email.success) return back("failed=invalid_email");

  const result = await createBetaInvitation(createSupabaseAdminClient(), admin.id, email.data);
  return back(result.ok ? "done=1" : `failed=${result.reason}`);
}

/** Cancels an invitation code that has not been used. */
export async function revokeBetaInvitationAction(formData: FormData): Promise<void> {
  const admin = await getAdmin(await createSupabaseServerClient());
  const id = uuidSchema.safeParse(text(formData, "invitationId"));
  if (!admin || !id.success) return comeBack(formData, "failed");
  const result = await revokeBetaInvitation(createSupabaseAdminClient(), admin.id, id.data);
  return comeBack(formData, result.ok ? "done" : "failed");
}
