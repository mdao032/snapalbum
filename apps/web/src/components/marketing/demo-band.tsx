import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** A band that sends visitors to the demo: they can try the guest page without an account. */
export function DemoBand() {
  const t = useTranslations("home.demoBand");

  return (
    <section aria-labelledby="demo-band-title" className="container-page py-6 sm:py-10">
      <div className="bg-aurora flex flex-col items-center gap-5 rounded-3xl bg-surface p-8 text-center shadow-soft ring-1 ring-border/70 sm:p-12">
        <h2 id="demo-band-title" className="text-headline text-balance">
          {t("title")}
        </h2>
        <p className="text-lead max-w-2xl text-pretty text-muted-foreground">{t("text")}</p>
        <Link href="/demo" className={cn(buttonVariants({ size: "lg" }))}>
          {t("cta")}
          <ArrowRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}
