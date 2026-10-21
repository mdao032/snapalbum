import { cardQuerySchema, localeSchema } from "@snapalbum/shared";
import { buildCardPdf } from "@/server/card-pdf";
import { loadPrintableEvent } from "@/server/printables";
import { qrDarkColor } from "@/server/qr";
import { BRAND_COLORS } from "@snapalbum/shared/brand";
import { makeAccentReadable } from "@snapalbum/shared";

/** A printable PDF card (A6, A5 or table tent) with the event's QR code (F-014). */
export async function GET(request: Request, context: RouteContext<"/api/events/[id]/card">) {
  const { id } = await context.params;
  const loaded = await loadPrintableEvent(id);
  if ("error" in loaded) return loaded.error;

  const query = cardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "validation_failed" }, { status: 400 });

  const { event, link } = loaded;
  const accent = makeAccentReadable(event.accent_color ?? BRAND_COLORS.primary);
  const pdf = await buildCardPdf({
    format: query.data.format,
    title: event.title,
    // The card is read by guests: it speaks the language of the event.
    locale: localeSchema.catch("fr").parse(event.locale),
    link,
    accentColor: accent,
    qrColor: qrDarkColor(query.data.color, event.accent_color),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${query.data.format}-${event.public_code}.pdf"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
