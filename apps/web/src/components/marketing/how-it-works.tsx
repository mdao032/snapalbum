import { Camera, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { QrArt } from "./qr-art";
import { Section } from "./section";

const STEPS = ["create", "scan", "collect"] as const;
type Step = (typeof STEPS)[number];

const TILES = [
  "from-violet-300 to-fuchsia-300",
  "from-orange-200 to-rose-300",
  "from-sky-200 to-indigo-300",
  "from-amber-200 to-orange-300",
];

/** What each step looks like: drawn with CSS and SVG (nothing to download), hidden from screen readers. */
function StepVisual({ step }: { step: Step }) {
  return (
    <div
      aria-hidden
      className="grid h-44 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 via-surface to-warm/15"
    >
      {step === "create" ? (
        <div className="flex w-44 flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-lift ring-1 ring-border/70">
          <span className="h-2.5 w-24 rounded-full bg-foreground/80" />
          <span className="h-2 w-full rounded-full bg-muted" />
          <span className="h-2 w-2/3 rounded-full bg-muted" />
          <div className="mt-1 flex items-end justify-between">
            <QrArt className="size-12 text-foreground" />
            <span className="h-7 w-16 rounded-full bg-primary" />
          </div>
        </div>
      ) : null}
      {step === "scan" ? (
        <div className="relative w-24 rounded-[1.4rem] bg-foreground p-1.5 shadow-lift">
          <div className="grid h-36 place-items-center rounded-[1.1rem] bg-surface">
            <div className="relative grid size-16 place-items-center rounded-xl ring-2 ring-primary">
              <QrArt className="size-10 text-foreground" />
              <Camera className="absolute -bottom-3 size-5 rounded-full bg-primary p-1 text-primary-foreground" />
            </div>
          </div>
        </div>
      ) : null}
      {step === "collect" ? (
        <div className="w-44 rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-border/70">
          <div className="mb-2 flex items-center justify-between">
            <span className="h-2.5 w-16 rounded-full bg-muted" />
            <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
              <ImagePlus className="size-3" />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {TILES.map((gradient) => (
              <span
                key={gradient}
                className={`aspect-[4/3] rounded-lg bg-gradient-to-br ${gradient}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** « Comment ça marche » in three steps (step 5.1), with a picture of each. */
export function HowItWorks() {
  const t = useTranslations("home");

  return (
    <Section id="comment-ca-marche" title={t("howTitle")} subtitle={t("howSubtitle")} tone="soft">
      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex">
            <Card className="flex w-full flex-col gap-5">
              <StepVisual step={step} />
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-primary">
                  {t("stepLabel", { number: index + 1 })}
                </p>
                <h3 className="text-title">{t(`steps.${step}.title`)}</h3>
                <p className="text-muted-foreground">{t(`steps.${step}.text`)}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}
