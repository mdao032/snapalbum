import { ChevronDown } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { marketingFacts } from "@/lib/marketing-facts";
import { Section } from "./section";

export const FAQ_IDS = [
  "app",
  "network",
  "limits",
  "quality",
  "retention",
  "privacy",
  "download",
  "guestDelete",
  "refund",
  "pro",
] as const;

/** The questions and answers as plain text, figures filled in from `plans.ts`; also feeds the JSON-LD. */
export async function getFaqEntries(): Promise<{ id: string; question: string; answer: string }[]> {
  const t = await getTranslations("home.faq");
  const facts = marketingFacts(await getLocale());
  return FAQ_IDS.map((id) => ({
    id,
    question: t(`${id}.q`),
    answer: t(`${id}.a`, facts),
  }));
}

/** Questions that open and close with the platform's own `<details>`: no script, works with a keyboard. */
export async function Faq() {
  const t = await getTranslations("home");
  const entries = await getFaqEntries();

  return (
    <Section id="faq" title={t("faqTitle")} tone="soft">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {entries.map((entry) => (
          <details
            key={entry.id}
            className="group rounded-2xl bg-surface shadow-soft ring-1 ring-border/70 open:ring-primary/40"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-3 font-semibold outline-none focus-visible:ring-4 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
              <span className="text-pretty">{entry.question}</span>
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <p className="px-5 pb-5 text-pretty text-muted-foreground">{entry.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
