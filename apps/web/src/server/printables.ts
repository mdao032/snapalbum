import "server-only";
import { buildShortLink, uuidSchema } from "@snapalbum/shared";
import { clientEnv } from "@/config/env";
import { getOrganiser } from "./auth";
import { getOwnEvent, type EventRow } from "./events";
import { createSupabaseServerClient } from "./supabase/server";

export type PrintableEvent = { event: EventRow; link: string } | { error: Response };

/**
 * Shared by the QR code and the card routes: only the signed-in owner gets the files of an event.
 * Anything else is a plain JSON error; a missing event and someone else's look the same (404).
 */
export async function loadPrintableEvent(eventId: string): Promise<PrintableEvent> {
  if (!uuidSchema.safeParse(eventId).success) {
    return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  }
  const supabase = await createSupabaseServerClient();
  const user = await getOrganiser(supabase);
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };

  const event = await getOwnEvent(supabase, eventId);
  if (!event) return { error: Response.json({ error: "not_found" }, { status: 404 }) };

  return { event, link: buildShortLink(clientEnv.NEXT_PUBLIC_SHORT_LINK_BASE, event.public_code) };
}
