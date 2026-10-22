import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Last call to action of the home page. */
export function FinalCta() {
  const t = useTranslations("home");

  return (
    <section aria-labelledby="final-cta-title" className="container-page pb-16 pt-6 sm:pb-24">
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-foreground p-8 text-center text-background sm:p-12">
        <h2 id="final-cta-title" className="text-headline text-balance">
          {t("finalTitle")}
        </h2>
        <p className="text-lead max-w-xl text-pretty opacity-80">{t("finalText")}</p>
        <Button asChild size="lg">
          <Link href="/login">
            {t("cta")}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <p className="text-sm opacity-70">{t("ctaHint")}</p>
      </div>
    </section>
  );
}
