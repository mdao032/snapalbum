import type * as React from "react";
import { cn } from "@/lib/utils";

/** Shimmering placeholder shown while content loads. Decorative: hidden from screen readers. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton rounded-lg", className)} {...props} />;
}
