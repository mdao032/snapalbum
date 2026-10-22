import { useTranslations } from "next-intl";
import { LEGAL_ENTITY } from "@/content/legal-entity";
import { fillLegalText, isLawyerNote, legalFacts } from "@/lib/legal";

const MARK = "rounded bg-warm-soft px-1.5 py-0.5 font-medium text-foreground";

/**
 * A paragraph or a list item of a legal text: figures come from `plans.ts`, the publisher's facts
 * from `content/legal-entity.ts`, and a fact not given yet is shown as a highlighted "to be
 * completed" mark (nothing is invented). A paragraph in brackets is a note for the lawyer.
 */
export function LegalText({
  text,
  locale,
  as: Tag = "p",
}: {
  text: string;
  locale: string;
  as?: "p" | "li";
}) {
  const t = useTranslations("legal.common");
  const parts = fillLegalText(text, LEGAL_ENTITY, legalFacts(locale));
  const content = parts.map((part, index) =>
    part.kind === "text" ? (
      <span key={index}>{part.text}</span>
    ) : (
      <mark key={index} className={MARK}>
        {`[${t("placeholder", { label: t(`fields.${part.field}`) })}]`}
      </mark>
    ),
  );

  if (isLawyerNote(text)) {
    return <Tag className={`${MARK} block text-pretty`}>{content}</Tag>;
  }
  return <Tag className="text-pretty">{content}</Tag>;
}
