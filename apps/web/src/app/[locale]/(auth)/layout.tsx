import type { ReactNode } from "react";
import { PageShell } from "@/components/layout/page-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell>
      <div className="bg-aurora flex flex-1 items-center justify-center py-10 sm:py-16">
        <div className="container-page flex justify-center">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </PageShell>
  );
}
