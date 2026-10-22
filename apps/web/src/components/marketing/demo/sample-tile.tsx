import { Cake, Flower2, Heart, PartyPopper, Sunset, Users, type LucideIcon } from "lucide-react";
import type { SampleId } from "./demo-state";
import { cn } from "@/lib/utils";

const ART: Record<SampleId, { icon: LucideIcon; gradient: string }> = {
  couple: { icon: Heart, gradient: "from-violet-300 to-fuchsia-300" },
  cake: { icon: Cake, gradient: "from-orange-200 to-rose-300" },
  dance: { icon: PartyPopper, gradient: "from-sky-200 to-indigo-300" },
  bouquet: { icon: Flower2, gradient: "from-pink-200 to-violet-300" },
  cousins: { icon: Users, gradient: "from-emerald-200 to-teal-300" },
  sunset: { icon: Sunset, gradient: "from-amber-200 to-orange-300" },
};

/** A sample "photo": a colour wash and a drawing, so the demo needs no image file and no upload. */
export function SampleTile({ sample, className }: { sample: SampleId; className?: string }) {
  const { icon: Icon, gradient } = ART[sample];
  return (
    <span
      aria-hidden
      className={cn(
        "grid aspect-square place-items-center rounded-xl bg-gradient-to-br text-foreground/70",
        gradient,
        className,
      )}
    >
      <Icon className="size-1/3" />
    </span>
  );
}
