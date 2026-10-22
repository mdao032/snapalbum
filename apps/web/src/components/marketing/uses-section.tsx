import { ArrowRight, Building2, Cake, Heart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { USAGES, usageSlug, type Usage } from "@/lib/usages";
import { Section } from "./section";

const ICONS: Record<Usage, typeof Heart> = { wedding: Heart, birthday: Cake, corporate: Building2 };

/** One card per occasion, each leading to its own written page (step 5.1). */
export function UsesSection() {
  const t = useTranslations("home");
  const tUsages = useTranslations("usages.common.names");
  const locale = useLocale() as "fr" | "en";

  return (
    <Section id="occasions" title={t("usesTitle")} subtitle={t("usesSubtitle")}>
      <ul className="grid gap-5 md:grid-cols-3">
        {USAGES.map((usage) => {
          const Icon = ICONS[usage];
          return (
            <li key={usage} className="flex">
              <Card className="relative flex w-full flex-col gap-3 transition-shadow focus-within:ring-2 focus-within:ring-primary hover:shadow-lift">
                <span className="grid size-11 place-items-center rounded-xl bg-warm-soft text-[#c2410c]">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-title">{tUsages(usage)}</h3>
                <p className="text-muted-foreground">{t(`uses.${usage}`)}</p>
                <Link
                  href={`/usages/${usageSlug(locale, usage)}`}
                  className="mt-auto inline-flex min-h-11 items-center gap-2 font-semibold text-primary after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
                >
                  {t("usesLink")}
                  <span className="sr-only"> ({tUsages(usage)})</span>
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
