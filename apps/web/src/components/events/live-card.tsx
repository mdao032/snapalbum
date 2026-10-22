import { Presentation } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Opens the live slideshow in its own tab, for the screen of the party (F-060). */
export async function LiveCard({ code }: { code: string }) {
  const t = await getTranslations("dashboard.liveCard");
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <a
          href={`/e/${code}/live`}
          target="_blank"
          rel="noopener"
          className={`${buttonVariants()} self-start`}
          data-testid="open-live"
        >
          <Presentation aria-hidden />
          {t("open")}
        </a>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
    </Card>
  );
}
