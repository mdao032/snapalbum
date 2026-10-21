import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline message. Errors are announced at once (`role="alert"`), confirmations politely. */
export function Alert({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium",
        tone === "error" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
