import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A band of a public page: one heading, an optional sentence under it, then the content. */
export function Section({
  id,
  title,
  subtitle,
  children,
  className,
  tone = "plain",
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  tone?: "plain" | "soft";
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-20", tone === "soft" && "bg-muted/50", className)}
    >
      <div className="container-page flex flex-col gap-10 py-14 sm:py-20">
        <header className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
          <h2 id={`${id}-title`} className="text-headline text-balance">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-lead text-pretty text-muted-foreground">{subtitle}</p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}
