import type { ReactNode } from "react";
import { PageShell } from "@/components/layout/page-shell";

/**
 * Written pages (one per occasion): the same frame as the marketing pages but no `loading.tsx`, so an
 * unknown address is answered with a real 404 before anything is streamed.
 */
export default function ContentLayout({ children }: { children: ReactNode }) {
  return <PageShell>{children}</PageShell>;
}
