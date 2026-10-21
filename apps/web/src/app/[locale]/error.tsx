"use client";

import dynamic from "next/dynamic";

// The error screen (header, footer, error reporting) is a separate chunk: every page carries this
// boundary, and none should pay for it before something actually fails (NF-002).
const ErrorView = dynamic(() => import("@/components/feedback/error-view"));

export default function ErrorPage(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView {...props} />;
}
