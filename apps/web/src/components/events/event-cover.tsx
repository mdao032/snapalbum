import { defaultCoverBackground } from "@/lib/events";
import { cn } from "@/lib/utils";

/**
 * Default cover (F-011): a gradient in the event's accent color. Decorative, so hidden from
 * screen readers. A photo uploaded by the organiser replaces it from phase 2 (R2 storage).
 */
export function EventCover({
  accentColor,
  className,
}: {
  accentColor: string | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("relative isolate overflow-hidden", className)}
      style={{ backgroundImage: defaultCoverBackground(accentColor) }}
    >
      <span className="absolute -right-6 -top-8 size-32 rounded-full bg-white/20" />
      <span className="absolute -bottom-10 left-6 size-24 rounded-full bg-white/15" />
    </div>
  );
}
