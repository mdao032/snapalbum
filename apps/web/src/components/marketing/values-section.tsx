import { CloudOff, MonitorPlay, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Section } from "./section";

const VALUES = [
  { id: "reliable", icon: CloudOff },
  { id: "quality", icon: Sparkles },
  { id: "live", icon: MonitorPlay },
  { id: "moderate", icon: ShieldCheck },
] as const;

/** What sets the service apart, in four sentences that the product can keep (SPEC 1.3). */
export function ValuesSection() {
  const t = useTranslations("home");

  return (
    <Section id="atouts" title={t("valuesTitle")} subtitle={t("valuesSubtitle")}>
      <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2">
        {VALUES.map(({ id, icon: Icon }) => (
          <li key={id} className="flex gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Icon className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-title">{t(`values.${id}.title`)}</h3>
              <p className="text-muted-foreground">{t(`values.${id}.text`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
