import { Camera, Heart, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { QrArt } from "./qr-art";

const TILES = [
  "from-violet-300 to-fuchsia-300",
  "from-orange-200 to-rose-300",
  "from-sky-200 to-indigo-300",
  "from-amber-200 to-orange-300",
  "from-emerald-200 to-teal-300",
  "from-pink-200 to-violet-300",
];

/**
 * Decorative illustration of the product promise: guests' photos landing in one album.
 * Built with CSS and SVG only (no image to download), hidden from assistive technology.
 */
export function HeroVisual() {
  const t = useTranslations("home");

  return (
    <div aria-hidden className="relative mx-auto h-[32rem] w-full max-w-md sm:h-[34rem]">
      <div className="absolute inset-x-10 inset-y-6 -z-10 rounded-full bg-gradient-to-br from-primary/25 via-warm/20 to-transparent blur-3xl" />

      {/* The "album" on a phone */}
      <div className="absolute left-1/2 top-0 w-60 -translate-x-1/2 rotate-[3deg] rounded-[2.25rem] bg-foreground p-2.5 shadow-float sm:w-64">
        <div className="overflow-hidden rounded-[1.75rem] bg-surface">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <span className="h-2.5 w-20 rounded-full bg-muted" />
            <span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
              <ImagePlus className="size-3.5" />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {TILES.map((gradient, index) => (
              <div
                key={gradient}
                className={`aspect-[4/5] rounded-xl bg-gradient-to-br ${gradient} ${
                  index % 3 === 0 ? "row-span-1" : ""
                }`}
              />
            ))}
          </div>
          <div className="px-4 pb-4">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-primary to-warm" />
            </div>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {t("visualCounter", { count: 128 })}
            </p>
          </div>
        </div>
      </div>

      {/* The QR code guests scan */}
      <div
        className="absolute bottom-24 left-0 w-32 animate-float rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-border/70 sm:left-2 sm:w-36"
        style={{ "--tilt": "-6deg" } as CSSProperties}
      >
        <QrArt className="w-full text-foreground" />
        <div className="mt-2 flex justify-center text-primary">
          <Camera className="size-4" />
        </div>
      </div>

      {/* A new photo arrives */}
      <div
        className="absolute right-0 top-28 flex animate-float-delayed items-center gap-2.5 rounded-2xl bg-surface py-2.5 pl-2.5 pr-4 shadow-lift ring-1 ring-border/70 sm:-right-2"
        style={{ "--tilt": "4deg" } as CSSProperties}
      >
        <span className="grid size-9 place-items-center rounded-xl bg-warm-soft text-[#c2410c]">
          <Heart className="size-4 fill-current" />
        </span>
        <span className="text-sm font-semibold">{t("visualNew")}</span>
      </div>
    </div>
  );
}
