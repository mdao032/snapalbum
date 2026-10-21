import { qrQuerySchema } from "@snapalbum/shared";
import { loadPrintableEvent } from "@/server/printables";
import { qrDarkColor, qrPng, qrSvg } from "@/server/qr";

/** The event's QR code, as SVG or 1 024 px PNG (F-013). Private: it follows the event's accent. */
export async function GET(request: Request, context: RouteContext<"/api/events/[id]/qr">) {
  const { id } = await context.params;
  const loaded = await loadPrintableEvent(id);
  if ("error" in loaded) return loaded.error;

  const query = qrQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const dark = qrDarkColor(query.color, loaded.event.accent_color);
  const headers: Record<string, string> = { "Cache-Control": "private, no-cache" };
  if (query.download) {
    headers["Content-Disposition"] =
      `attachment; filename="qr-${loaded.event.public_code}.${query.format}"`;
  }

  if (query.format === "png") {
    const png = await qrPng(loaded.link, dark);
    return new Response(new Uint8Array(png), {
      headers: { ...headers, "Content-Type": "image/png" },
    });
  }
  const svg = await qrSvg(loaded.link, dark);
  return new Response(svg, {
    headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" },
  });
}
