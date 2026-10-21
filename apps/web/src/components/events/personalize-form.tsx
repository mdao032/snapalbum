"use client";

import {
  ACCENT_PRESETS,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TYPES,
  LOCALES,
  WELCOME_MESSAGE_MAX_LENGTH,
  isAccentReadable,
  makeAccentReadable,
  type EventType,
  type Locale,
} from "@snapalbum/shared";
import { BRAND_COLORS } from "@snapalbum/shared/brand";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  personalizeEventAction,
  type PersonalizeState,
} from "@/app/[locale]/(app)/events/[id]/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { EventCover } from "./event-cover";

const IDLE: PersonalizeState = { status: "idle" };

export interface PersonalizeValues {
  title: string;
  type: EventType;
  locale: Locale;
  welcomeMessage: string;
  accentColor: string | null;
}

/** "Personalise" form (F-011): name, language, welcome message, accent color and a live preview. */
export function PersonalizeForm({
  eventId,
  values,
}: {
  eventId: string;
  values: PersonalizeValues;
}) {
  const t = useTranslations("events");
  const tLanguage = useTranslations("language");
  const [state, save, saving] = useActionState(personalizeEventAction.bind(null, eventId), IDLE);
  const [accent, setAccent] = useState<string | null>(values.accentColor);
  const [message, setMessage] = useState(values.welcomeMessage);

  const isPreset = accent === null || (ACCENT_PRESETS as readonly string[]).includes(accent);
  const customColor = !isPreset && accent ? accent : "#7c3aed";
  // What will actually be saved: too-light colors are darkened (F-011).
  const effective = accent ? makeAccentReadable(accent) : null;
  const adjusted = accent !== null && !isAccentReadable(accent);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const fieldError = (name: string) =>
    fieldErrors?.[name]
      ? t(`fieldErrors.${fieldErrors[name]}`, {
          max: name === "title" ? EVENT_TITLE_MAX_LENGTH : WELCOME_MESSAGE_MAX_LENGTH,
        })
      : undefined;

  return (
    <Card className="p-6 sm:p-8">
      <form action={save} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("detail.personalizeTitle")}</h2>
          <p className="text-muted-foreground">{t("detail.personalizeSubtitle")}</p>
        </div>

        {state.status === "error" && !fieldErrors ? (
          <Alert tone="error">{t("errors.saveFailed")}</Alert>
        ) : null}
        {state.status === "saved" ? <Alert tone="success">{t("detail.saved")}</Alert> : null}

        <Field id="title" label={t("detail.titleLabel")} error={fieldError("title")}>
          {(aria) => (
            <Input
              id="title"
              name="title"
              required
              defaultValue={values.title}
              maxLength={EVENT_TITLE_MAX_LENGTH * 2}
              {...aria}
            />
          )}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="type" label={t("detail.typeLabel")}>
            {(aria) => (
              <Select id="type" name="type" defaultValue={values.type} {...aria}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="locale" label={t("detail.localeLabel")}>
            {(aria) => (
              <Select id="locale" name="locale" defaultValue={values.locale} {...aria}>
                {LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {tLanguage(code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          id="welcomeMessage"
          label={t("detail.welcomeLabel")}
          hint={t("detail.welcomeCount", {
            count: message.length,
            max: WELCOME_MESSAGE_MAX_LENGTH,
          })}
          error={fieldError("welcomeMessage")}
        >
          {(aria) => (
            <textarea
              id="welcomeMessage"
              name="welcomeMessage"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("detail.welcomePlaceholder")}
              className="min-h-24 w-full rounded-xl bg-surface p-4 text-base text-foreground ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-primary/30 aria-[invalid=true]:ring-danger"
              {...aria}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-medium">{t("detail.accentLabel")}</legend>
          <input type="hidden" name="accentColor" value={accent ?? ""} />
          <div className="flex flex-wrap items-center gap-3">
            {[null, ...ACCENT_PRESETS.slice(1)].map((preset) => {
              const color = preset ?? BRAND_COLORS.primary;
              const selected = accent === preset;
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={selected}
                  aria-label={
                    preset === null
                      ? t("detail.accentDefault")
                      : t("detail.accentPreset", { color })
                  }
                  onClick={() => setAccent(preset)}
                  className={cn(
                    "size-11 cursor-pointer rounded-full ring-offset-2 ring-offset-surface outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
                    selected ? "ring-2 ring-foreground" : "ring-1 ring-border",
                  )}
                  style={{ backgroundColor: color }}
                />
              );
            })}
            <label
              className={cn(
                "relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-full text-xs font-medium ring-offset-2 ring-offset-surface focus-within:ring-4 focus-within:ring-primary/40",
                !isPreset ? "ring-2 ring-foreground" : "ring-1 ring-border",
              )}
              style={{ backgroundColor: !isPreset ? customColor : undefined }}
            >
              <span className="sr-only">{t("detail.accentCustom")}</span>
              <input
                type="color"
                value={customColor}
                onChange={(event) => setAccent(event.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              {isPreset ? <span aria-hidden>+</span> : null}
            </label>
          </div>
          {adjusted && effective ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("detail.accentAdjusted", { color: effective })}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("detail.coverLabel")}</p>
          <EventCover accentColor={effective} className="h-28 rounded-2xl" />
          <p className="text-sm text-muted-foreground">{t("detail.coverHint")}</p>
        </div>

        <Button type="submit" size="lg" disabled={saving} className="self-start">
          {saving ? <Spinner className="text-current" /> : null}
          {saving ? t("detail.saving") : t("detail.save")}
        </Button>
      </form>
    </Card>
  );
}
