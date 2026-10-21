"use server";

import {
  toFieldErrors,
  updateEventSchema,
  updateEventSettingsSchema,
  uuidSchema,
  type FieldErrorCode,
} from "@snapalbum/shared";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getOrganiser } from "@/server/auth";
import { createShareLink, revokeShareLink } from "@/server/gallery";
import { shareLinkViews, type ShareLinkView } from "@/server/share-links";
import {
  cancelEventDeletion,
  markAlbumReady,
  requestEventDeletion,
  updateEventPresentation,
  updateEventSettings,
} from "@/server/events";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
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

export type SettingsState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: "invalid" | "invalid_code" | "failed" };

/** Saves who sees the gallery, whether uploads need approval, and the upload window (F-015, F-016). */
export async function saveSettingsAction(
  eventId: string,
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return redirect({ href: "/login", locale: await getLocale() });
  if (!uuidSchema.safeParse(eventId).success) return { status: "error", error: "failed" };

  const input = {
    // An unchecked checkbox is simply absent from the form.
    gallery_visible: formData.get("gallery_visible") === "on",
    require_approval: formData.get("require_approval") === "on",
    upload_opens_at: text(formData, "upload_opens_at"),
    upload_closes_at: text(formData, "upload_closes_at"),
    // An empty field leaves the code as it is; the checkbox removes it (F-017).
    access_code:
      formData.get("remove_access_code") === "on" ? "" : text(formData, "access_code") || undefined,
  };
  const parsed = updateEventSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const codeProblem = parsed.error.issues.some((issue) => issue.path[0] === "access_code");
    return { status: "error", error: codeProblem ? "invalid_code" : "invalid" };
  }

  try {
    const result = await updateEventSettings(supabase, eventId, input);
    if (!result.ok) return { status: "error", error: "failed" };
    // E.g. "an access code is set" comes from the server: refresh the page that shows it.
    revalidatePath("/[locale]/events/[id]", "page");
    return { status: "saved" };
  } catch (error) {
    console.error("[events] settings update failed", error);
    return { status: "error", error: "failed" };
  }
}

async function ownerOf(eventId: string) {
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user) return redirect({ href: "/login", locale: await getLocale() });
  if (!uuidSchema.safeParse(eventId).success) return null;
  return user.id;
}

/** Asks for the deletion of the event: purged in 7 days unless cancelled (R5). */
export async function requestDeletionAction(eventId: string): Promise<void> {
  const ownerId = await ownerOf(eventId);
  if (ownerId) await requestEventDeletion(createSupabaseAdminClient(), ownerId, eventId);
  redirect({ href: `/events/${eventId}`, locale: await getLocale() });
}

/** Brings a deleted event back, while the 7 days have not run out (R5). */
export async function cancelDeletionAction(eventId: string): Promise<void> {
  const ownerId = await ownerOf(eventId);
  if (ownerId) await cancelEventDeletion(createSupabaseAdminClient(), ownerId, eventId);
  redirect({ href: `/events/${eventId}`, locale: await getLocale() });
}

export type ShareLinksState =
  { ok: true; links: ShareLinkView[] } | { ok: false; error: "failed" | "too_many" };

/** Creates a read-only share link for the gallery (F-054). */
export async function createShareLinkAction(eventId: string): Promise<ShareLinksState> {
  const ownerId = await ownerOf(eventId);
  if (!ownerId) return { ok: false, error: "failed" };
  try {
    const admin = createSupabaseAdminClient();
    const created = await createShareLink(admin, ownerId, eventId);
    if (!created.ok) {
      return { ok: false, error: created.reason === "too_many" ? "too_many" : "failed" };
    }
    return { ok: true, links: await shareLinkViews(admin, ownerId, eventId) };
  } catch (error) {
    console.error("[events] share link creation failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Revokes a share link: it stops working at once (F-054). */
export async function revokeShareLinkAction(
  eventId: string,
  linkId: string,
): Promise<ShareLinksState> {
  const ownerId = await ownerOf(eventId);
  if (!ownerId || !uuidSchema.safeParse(linkId).success) return { ok: false, error: "failed" };
  try {
    const admin = createSupabaseAdminClient();
    if (!(await revokeShareLink(admin, ownerId, eventId, linkId))) {
      return { ok: false, error: "failed" };
    }
    return { ok: true, links: await shareLinkViews(admin, ownerId, eventId) };
  } catch (error) {
    console.error("[events] share link revocation failed", error);
    return { ok: false, error: "failed" };
  }
}

export type AlbumReadyState = { ok: true; readyAt: string } | { ok: false };

/** Declares the album ready: the guests who left an e-mail address get its link (F-044). */
export async function markAlbumReadyAction(eventId: string): Promise<AlbumReadyState> {
  const ownerId = await ownerOf(eventId);
  if (!ownerId) return { ok: false };
  try {
    const result = await markAlbumReady(createSupabaseAdminClient(), ownerId, eventId);
    if (!result.ok) return { ok: false };
    revalidatePath("/[locale]/events/[id]", "page");
    return { ok: true, readyAt: result.readyAt };
  } catch (error) {
    console.error("[events] album ready failed", error);
    return { ok: false };
  }
}
