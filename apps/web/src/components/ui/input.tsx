import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        // 44 px minimum touch target (NF-031); 16 px text so iOS does not zoom on focus.
        "min-h-12 w-full rounded-xl bg-surface px-4 text-base text-foreground ring-1 ring-border outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-primary/30 aria-[invalid=true]:ring-danger disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "min-h-12 w-full cursor-pointer rounded-xl bg-surface px-4 text-base text-foreground ring-1 ring-border outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
