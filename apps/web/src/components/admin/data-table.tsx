import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A table that scrolls inside its box on a narrow screen: the page itself never scrolls sideways. */
export function DataTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    // A box that scrolls must be reachable with the keyboard, and named for screen readers.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-2xl bg-surface shadow-soft ring-1 ring-border/70 outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
    >
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border/70">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 text-sm font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  children,
  className,
  numeric,
}: {
  children: ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td className={cn("px-4 py-3 align-top", numeric && "tabular-nums", className)}>{children}</td>
  );
}
