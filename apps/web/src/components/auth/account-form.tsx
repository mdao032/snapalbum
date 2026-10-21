"use client";

import { DISPLAY_NAME_MAX_LENGTH, LOCALES, type Locale } from "@snapalbum/shared/constants";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { updateProfileAction, type AccountFormState } from "@/app/[locale]/(app)/account/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/i18n/navigation";

const IDLE: AccountFormState = { status: "idle" };

/** "My account" form (F-003): name and preferred language. The e-mail address is shown, not editable. */
export function AccountForm({
  email,
  displayName,
  locale,
}: {
  email: string;
  displayName: string;
  locale: Locale;
}) {
  const t = useTranslations("account");
  const tLanguage = useTranslations("language");
  const currentLocale = useLocale();
  const router = useRouter();
  const [state, save, saving] = useActionState(updateProfileAction, IDLE);

  // The interface follows the language just chosen.
  useEffect(() => {
    if (state.status === "saved" && state.locale !== currentLocale) {
      router.replace("/account", { locale: state.locale });
    }
  }, [state, currentLocale, router]);

  return (
    <Card className="p-6 sm:p-8">
      <form action={save} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="account-email" className="font-medium">
            {t("emailLabel")}
          </label>
          <Input
            id="account-email"
            type="email"
            value={email}
            readOnly
            aria-describedby="account-email-hint"
            className="bg-muted"
          />
          <p id="account-email-hint" className="text-sm text-muted-foreground">
            {t("emailHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="displayName" className="font-medium">
            {t("nameLabel")}
          </label>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
            placeholder={t("namePlaceholder")}
            aria-describedby="displayName-hint"
          />
          <p id="displayName-hint" className="text-sm text-muted-foreground">
            {t("nameHint")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="locale" className="font-medium">
            {t("localeLabel")}
          </label>
          <Select id="locale" name="locale" defaultValue={locale} aria-describedby="locale-hint">
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {tLanguage(code)}
              </option>
            ))}
          </Select>
          <p id="locale-hint" className="text-sm text-muted-foreground">
            {t("localeHint")}
          </p>
        </div>

        {state.status === "saved" ? <Alert tone="success">{t("saved")}</Alert> : null}
        {state.status === "error" ? <Alert tone="error">{t("saveError")}</Alert> : null}

        <Button type="submit" size="lg" disabled={saving} className="self-start">
          {saving ? <Spinner className="text-current" /> : null}
          {saving ? t("saving") : t("save")}
        </Button>
      </form>
    </Card>
  );
}
