"use client";

import {
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TYPES,
  LOCALES,
  createEventSchema,
  toFieldErrors,
  type FieldErrorCode,
  type Locale,
} from "@snapalbum/shared";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, type FormEvent } from "react";
import { createEventAction, type CreateEventState } from "@/app/[locale]/(app)/events/new/actions";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Link } from "@/i18n/navigation";

const IDLE: CreateEventState = { status: "idle" };

/** Event creation on a single page (F-010): name, date, type and guest language. */
export function CreateEventForm({ today }: { today: string }) {
  const t = useTranslations("events");
  const tApi = useTranslations("apiErrors");
  const tLanguage = useTranslations("language");
  const locale = useLocale() as Locale;
  const [state, create, creating] = useActionState(createEventAction, IDLE);
  const [clientErrors, setClientErrors] = useState<Record<string, FieldErrorCode>>({});

  // The same Zod schema as the server, so mistakes show up without a round trip.
  function validate(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = createEventSchema.safeParse({
      title: data.get("title"),
      eventDate: data.get("eventDate"),
      type: data.get("type"),
      locale: data.get("locale"),
    });
    if (parsed.success) {
      setClientErrors({});
      return;
    }
    event.preventDefault();
    setClientErrors(toFieldErrors(parsed.error));
  }

  const fieldErrors = {
    ...(state.status === "error" ? state.fieldErrors : undefined),
    ...clientErrors,
  };
  const fieldError = (name: string): string | undefined => {
    const code = fieldErrors[name];
    return code ? t(`fieldErrors.${code}`, { max: EVENT_TITLE_MAX_LENGTH }) : undefined;
  };

  let formError: string | null = null;
  if (state.status === "error" && !state.fieldErrors) {
    formError =
      state.error === "failed" || state.error === "validation"
        ? t(`errors.${state.error}`)
        : tApi(state.error);
  } else if (Object.keys(clientErrors).length > 0) {
    formError = t("errors.validation");
  }

  return (
    <Card className="p-6 sm:p-8">
      <form action={create} onSubmit={validate} noValidate className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Field id="title" label={t("new.titleLabel")} error={fieldError("title")}>
          {(aria) => (
            <Input
              id="title"
              name="title"
              required
              maxLength={EVENT_TITLE_MAX_LENGTH * 2}
              autoComplete="off"
              placeholder={t("new.titlePlaceholder")}
              {...aria}
            />
          )}
        </Field>

        <Field id="eventDate" label={t("new.dateLabel")} error={fieldError("eventDate")}>
          {(aria) => (
            <Input
              id="eventDate"
              name="eventDate"
              type="date"
              required
              defaultValue={today}
              {...aria}
            />
          )}
        </Field>

        <Field id="type" label={t("new.typeLabel")} error={fieldError("type")}>
          {(aria) => (
            <Select id="type" name="type" defaultValue="wedding" {...aria}>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="locale"
          label={t("new.localeLabel")}
          hint={t("new.localeHint")}
          error={fieldError("locale")}
        >
          {(aria) => (
            <Select id="locale" name="locale" defaultValue={locale} {...aria}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {tLanguage(code)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={creating}>
            {creating ? <Spinner className="text-current" /> : null}
            {creating ? t("new.submitting") : t("new.submit")}
          </Button>
          <Link href="/events" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            {t("new.cancel")}
          </Link>
        </div>
      </form>
    </Card>
  );
}
