import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * "Your data" (G-004): a copy of what the account holds, as a JSON file. A plain link to the
 * download route, which only ever serves the signed-in person's own data.
 */
export async function AccountDataCard() {
  const t = await getTranslations("account.data");

  return (
    <Card className="p-6 sm:p-8" data-testid="account-data">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <a
          href="/api/account/export"
          download
          className={`${buttonVariants({ variant: "secondary" })} self-start`}
        >
          <Download aria-hidden />
          {t("export")}
        </a>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
    </Card>
  );
}
