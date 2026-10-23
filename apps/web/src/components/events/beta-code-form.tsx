"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { BetaCodeState } from "@/app/[locale]/(app)/events/[id]/payment/actions";

/**
 * Field beta (step 6.1): where an organiser enters the invitation code they were given. Shown on a
 * free event while the beta is open; the server checks the code, the event and the organiser.
 */
export function BetaCodeForm({
  action,
}: {
  action: (previous: BetaCodeState, formData: FormData) => Promise<BetaCodeState>;
}) {
  const t = useTranslations("dashboard.plan.beta");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl bg-muted p-4"
      data-testid="beta-code-form"
    >
      <h3 className="text-lg font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <Field
        id="beta-code"
        label={t("label")}
        error={state.status === "error" ? t(`errors.${state.reason}`) : undefined}
      >
        {(aria) => (
          <Input
            id="beta-code"
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={24}
            placeholder={t("placeholder")}
            className="font-mono uppercase tracking-wider"
            {...aria}
          />
        )}
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? <Spinner className="text-current" /> : null}
        {pending ? t("working") : t("submit")}
      </Button>
    </form>
  );
}

export function BetaDone() {
  const t = useTranslations("dashboard.plan.beta");
  return <Alert tone="success">{t("done")}</Alert>;
}
