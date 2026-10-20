import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusIllustration } from "./status-illustration";

/**
 * Empty state: always say what is missing and offer a way forward (`action`).
 * Used for empty galleries, empty event lists, missing results...
 */
export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
  mark = "plus",
  as: Heading = "h2",
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "warm" | "danger";
  mark?: "question" | "alert" | "plus";
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center gap-5 px-4 py-12 text-center sm:py-16", className)}
    >
      <StatusIllustration tone={tone} mark={mark} />
      <div className="flex max-w-md flex-col gap-2">
        <Heading className="text-title">{title}</Heading>
        {description && <p className="text-lead text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
