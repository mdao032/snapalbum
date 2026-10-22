import { APP_NAME } from "@snapalbum/shared/brand";
import type { Locale } from "@snapalbum/shared/messages";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { TESTIMONIALS, type Testimonial } from "@/content/testimonials";
import { Section } from "./section";

/** Real testimonials only: with none, the section is not on the page at all (step 5.1). */
export function Testimonials({ entries = TESTIMONIALS }: { entries?: readonly Testimonial[] }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  if (entries.length === 0) return null;

  return (
    <Section id="temoignages" title={t("testimonialsTitle", { appName: APP_NAME })}>
      <ul className="grid gap-5 md:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.author} className="flex">
            <Card className="flex w-full flex-col gap-4">
              <blockquote className="text-pretty">{entry.quote[locale]}</blockquote>
              <p className="mt-auto text-sm font-semibold text-muted-foreground">{entry.author}</p>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
