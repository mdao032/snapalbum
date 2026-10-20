import type * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-border/70", className)}
      {...props}
    />
  );
}
