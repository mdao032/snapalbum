"use client";

import { messages } from "@snapalbum/shared/messages";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import "./globals.css";

// Last-resort error page: replaces the whole document, so it cannot rely on the locale layout.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale =
    typeof navigator !== "undefined" && navigator.language.startsWith("en") ? "en" : "fr";
  const t = messages[locale];

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="bg-background text-foreground">
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
      </body>
    </html>
  );
}
