"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";

/** The page shown when a screen fails (SPEC: always a way out). Loaded only when it is needed. */
export default function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <PageShell>
      <div className="container-page flex flex-1 items-center justify-center">
        <EmptyState
          as="h1"
          tone="warm"
          mark="alert"
          title={t("error.title")}
          description={t("error.description")}
          action={
            <Button type="button" onClick={reset}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    </PageShell>
  );
}
