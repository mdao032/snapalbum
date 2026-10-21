"use client";

import { messages } from "@snapalbum/shared/messages";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

/** Content of the last-resort error page, split from it so it is not part of any first load. */
export default function GlobalErrorView({
  error,
  reset,
  locale,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  locale: "fr" | "en";
}) {
  const t = messages[locale];

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        as="h1"
        tone="warm"
        mark="alert"
        title={t.error.title}
        description={t.error.description}
        action={
          <Button type="button" onClick={reset}>
            {t.common.retry}
          </Button>
        }
      />
    </main>
  );
}
