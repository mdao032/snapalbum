"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t("error.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("error.description")}</p>
      <Button type="button" onClick={reset}>
        {t("common.retry")}
      </Button>
    </main>
  );
}
