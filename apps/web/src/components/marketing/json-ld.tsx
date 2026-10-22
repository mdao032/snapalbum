import { jsonLdScript } from "@/lib/seo";

/** Structured data for search engines. Only data built on the server from `plans.ts` and the texts. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // The content is our own JSON, with `<` escaped by `jsonLdScript`.
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
