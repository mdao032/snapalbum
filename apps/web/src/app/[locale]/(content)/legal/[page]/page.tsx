import { APP_NAME } from "@snapalbum/shared/brand";
import { messages } from "@snapalbum/shared/messages";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LegalText } from "@/components/legal/legal-text";
import { LEGAL_STATUS } from "@/content/legal-entity";
import { clientEnv } from "@/config/env";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isLegalPage, LEGAL_PAGES, type LegalPage, type LegalSection } from "@/lib/legal";
import { pageAlternates } from "@/lib/seo";

/** An unknown legal page is a real 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEGAL_PAGES.map((page) => ({ locale, page })));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/legal/[page]">): Promise<Metadata> {
  const { locale, page } = await params;
  if (!hasLocale(routing.locales, locale) || !isLegalPage(page)) return {};
  const t = await getTranslations({ locale, namespace: `legal.pages.${page}` });
  return {
    title: t("metaTitle"),
    description: t("metaDescription", { appName: APP_NAME }),
    alternates: pageAlternates(clientEnv.NEXT_PUBLIC_SITE_URL, locale, { kind: "legal", page }),
    // A draft is not for search engines: the pages open to them once a lawyer has validated them.
    robots: LEGAL_STATUS.reviewedByLawyer ? undefined : { index: false, follow: true },
  };
}

/**
 * A legal page (G-001): notice, terms of use, terms of sale, privacy, cookies. Drafts written from
 * how the service really works; the publisher's facts come from `content/legal-entity.ts`.
 */
export default async function LegalPageView({ params }: PageProps<"/[locale]/legal/[page]">) {
  const { locale, page } = await params;
  if (!hasLocale(routing.locales, locale) || !isLegalPage(page)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations(`legal.pages.${page}`);
  const tCommon = await getTranslations("legal.common");
  const tLayout = await getTranslations("layout");
  const sections = Object.entries(
    messages[locale].legal.pages[page].sections as Record<string, LegalSection>,
  );
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(`${LEGAL_STATUS.lastUpdated}T12:00:00Z`),
  );
  const others = LEGAL_PAGES.filter((other): other is LegalPage => other !== page);
  const linkLabel = {
    notice: tLayout("legalNotice"),
    terms: tLayout("legalTerms"),
    sales: tLayout("legalSales"),
    privacy: tLayout("legalPrivacy"),
    cookies: tLayout("legalCookies"),
  } satisfies Record<LegalPage, string>;

  return (
    <article className="container-page py-12 sm:py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-headline text-balance">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{tCommon("lastUpdated", { date })}</p>
        </header>

        {LEGAL_STATUS.reviewedByLawyer ? null : (
          <div
            role="note"
            data-testid="legal-draft"
            className="rounded-2xl bg-warm-soft px-5 py-4 text-foreground"
          >
            <p>
              <strong className="font-semibold">{tCommon("draftTitle")}.</strong>{" "}
              {tCommon("draftBody")}
            </p>
          </div>
        )}

        {sections.length > 4 ? (
          <nav aria-label={tCommon("contents")} className="rounded-2xl bg-muted/60 p-5">
            <p className="font-semibold">{tCommon("contents")}</p>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
              {sections.map(([key, section]) => (
                <li key={key}>
                  <a href={`#${key}`} className="inline-flex min-h-8 items-center hover:underline">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {sections.map(([key, section]) => (
          <section key={key} id={key} aria-labelledby={`${key}-title`} className="scroll-mt-20">
            <h2 id={`${key}-title`} className="text-title mb-3">
              {section.title}
            </h2>
            <div className="flex flex-col gap-3">
              {section.paragraphs.map((text) => (
                <LegalText key={text} text={text} locale={locale} />
              ))}
              {section.items ? (
                <ul className="flex list-disc flex-col gap-2 pl-6">
                  {section.items.map((text) => (
                    <LegalText key={text} text={text} locale={locale} as="li" />
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ))}

        <nav aria-label={tCommon("otherPages")} className="border-t border-border/60 pt-6">
          <p className="font-semibold">{tCommon("otherPages")}</p>
          <ul className="mt-2 flex flex-wrap gap-x-6">
            {others.map((other) => (
              <li key={other}>
                <Link
                  href={`/legal/${other}`}
                  className="inline-flex min-h-11 items-center text-primary hover:underline"
                >
                  {linkLabel[other]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </article>
  );
}
