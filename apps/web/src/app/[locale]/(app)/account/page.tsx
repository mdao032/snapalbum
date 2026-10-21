import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AccountForm } from "@/components/auth/account-form";
import { routing } from "@/i18n/routing";
import { getProfile, requireOrganiser } from "@/server/auth";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "account",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // A layout is not re-checked on client-side navigation: the page asks again.
  const { supabase, user } = await requireOrganiser(locale);
  const profile = await getProfile(supabase, user.id);
  const t = await getTranslations("account");

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-title">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <AccountForm
          email={user.email ?? ""}
          displayName={profile?.display_name ?? ""}
          locale={profile && hasLocale(routing.locales, profile.locale) ? profile.locale : locale}
        />
      </div>
    </div>
  );
}
