import { OG_SIZE, renderOpenGraphImage } from "@/lib/og-image";

export const size = OG_SIZE;
export const contentType = "image/png";

/** The picture shown when this page is shared (step 5.1). */
export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  return renderOpenGraphImage((await params).locale);
}
