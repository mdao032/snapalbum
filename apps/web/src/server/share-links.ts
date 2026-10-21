import "server-only";
import { buildShareUrl } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/config/env";
import { listShareLinks } from "./gallery";

/** A share link as the organiser's dashboard shows it, with its full address (F-054). */
export interface ShareLinkView {
  id: string;
  url: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * The share links of an event the caller owns, with the address to give out: under the language
 * prefix of the event, on the public site address. Other people's events give an empty list.
 */
export async function shareLinkViews(
  admin: SupabaseClient<Database>,
  ownerId: string,
  eventId: string,
): Promise<ShareLinkView[]> {
  const { data: event, error } = await admin
    .from("events")
    .select("locale")
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return [];
  const locale = event.locale === "en" ? "en" : "fr";
  const links = await listShareLinks(admin, ownerId, eventId);
  return links.map((link) => ({
    id: link.id,
    url: buildShareUrl(clientEnv.NEXT_PUBLIC_SITE_URL, link.token, locale),
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
  }));
}
