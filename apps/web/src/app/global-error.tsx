"use client";

import dynamic from "next/dynamic";
import "./globals.css";

// Both languages' messages, error reporting and the page itself load only when this page is
// actually shown: the boundary is part of every first load, its content must not be (NF-002).
const GlobalErrorView = dynamic(() => import("./global-error-view"));

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

  return (
    <html lang={locale}>
      <body className="bg-background text-foreground">
        <GlobalErrorView error={error} reset={reset} locale={locale} />
      </body>
    </html>
  );
}
