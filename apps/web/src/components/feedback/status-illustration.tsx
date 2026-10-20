import { cn } from "@/lib/utils";

type Tone = "neutral" | "warm" | "danger";

const tones: Record<Tone, { ring: string; fill: string; stroke: string }> = {
  neutral: { ring: "bg-primary-soft", fill: "#f0ecff", stroke: "#6d4aff" },
  warm: { ring: "bg-warm-soft", fill: "#fff0eb", stroke: "#c2410c" },
  danger: { ring: "bg-danger-soft", fill: "#fdecec", stroke: "#c0262d" },
};

/**
 * Friendly picture for empty, error and not-found states: a polaroid with a tone-colored mark.
 * Decorative only.
 */
export function StatusIllustration({
  tone = "neutral",
  mark,
  className,
}: {
  tone?: Tone;
  mark: "question" | "alert" | "plus";
  className?: string;
}) {
  const colors = tones[tone];
  return (
    <div
      aria-hidden
      className={cn(
        "relative grid size-28 place-items-center rounded-full",
        colors.ring,
        className,
      )}
    >
      <svg viewBox="0 0 64 64" fill="none" className="size-16 -rotate-6">
        <rect
          x="8"
          y="6"
          width="48"
          height="52"
          rx="8"
          fill="white"
          stroke={colors.stroke}
          strokeWidth="2.5"
        />
        <rect x="14" y="12" width="36" height="30" rx="4" fill={colors.fill} />
        {mark === "question" && (
          <path
            d="M27 24.5a5 5 0 1 1 7.2 4.5c-1.4.7-2.2 1.7-2.2 3.2M32 36.5v.1"
            stroke={colors.stroke}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {mark === "alert" && (
          <path
            d="M32 20v10M32 35.5v.1"
            stroke={colors.stroke}
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
        {mark === "plus" && (
          <path
            d="M32 21v16M24 29h16"
            stroke={colors.stroke}
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
        <path d="M20 50h24" stroke={colors.stroke} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
