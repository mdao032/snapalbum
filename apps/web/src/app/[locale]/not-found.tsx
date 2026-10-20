import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <PageShell>
      <div className="container-page flex flex-1 items-center justify-center">
        <EmptyState
          as="h1"
          mark="question"
          title={t("title")}
          description={t("description")}
          action={
            <Button asChild>
              <Link href="/">{t("cta")}</Link>
            </Button>
          }
        />
      </div>
    </PageShell>
  );
}
