import { DEFAULT_LOCALE, localeSchema, publicCodeSchema } from "@snapalbum/shared";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEvent } from "@/server/events";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

/**
 * Where a scanned QR code lands (F-012, SPEC 6.2 bis): the short link `/{code}` is rewritten here
 * by the proxy, and the guest is sent to the event page in the event's language. The redirect is
 * temporary (307) so the destination can evolve (app, App Clip) without browsers remembering it.
 */
export async function GET(request: NextRequest, context: RouteContext<"/s/[code]">) {
  const { code } = await context.params;
  if (!publicCodeSchema.safeParse(code).success) {
    return NextResponse.redirect(new URL("/", request.url), 307);
  }

  let locale = DEFAULT_LOCALE;
  try {
    const event = await getPublicEvent(createSupabaseAdminClient(), code);
    if (event) locale = localeSchema.catch(DEFAULT_LOCALE).parse(event.locale);
  } catch (error) {
    // The event page does its own lookup: a hiccup here must not break a printed QR code.
    console.error("[short-link] lookup failed", error);
  }

  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return NextResponse.redirect(new URL(`${prefix}/e/${code}`, request.url), 307);
}
