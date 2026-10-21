"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useSyncExternalStore } from "react";
import { saveSettingsAction, type SettingsState } from "@/app/[locale]/(app)/events/[id]/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const IDLE: SettingsState = { status: "idle" };
const noopSubscribe = () => () => {};

export interface SettingsValues {
  galleryVisible: boolean;
  requireApproval: boolean;
  /** ISO instants, as stored. */
  uploadOpensAt: string;
  uploadClosesAt: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** An ISO instant as the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` expects, in local time. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The reverse: what the person typed (their own time zone) as an ISO instant, or "" if invalid. */
export function fromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function Switch({
  id,
  name,
  label,
  hint,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-describedby={`${id}-hint`}
          className="size-5 shrink-0 cursor-pointer accent-primary"
        />
        {label}
      </label>
      <p id={`${id}-hint`} className="pl-8 text-sm text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/** Album settings (F-015, F-016): gallery visibility, approval, and the upload window. */
export function SettingsForm({ eventId, values }: { eventId: string; values: SettingsValues }) {
  const t = useTranslations("dashboard.settings");
  const [state, save, saving] = useActionState(saveSettingsAction.bind(null, eventId), IDLE);
  // The dates are shown in the visitor's time zone, which the server does not know: they appear
  // once the page runs in the browser.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [opens, setOpens] = useState(() => toLocalInput(values.uploadOpensAt));
  const [closes, setCloses] = useState(() => toLocalInput(values.uploadClosesAt));

  return (
    <Card className="p-6 sm:p-8">
      <form action={save} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {state.status === "saved" ? <Alert tone="success">{t("saved")}</Alert> : null}
        {state.status === "error" ? (
          <Alert tone="error">{t(state.error === "invalid" ? "invalid" : "failed")}</Alert>
        ) : null}

        <Switch
          id="gallery_visible"
          name="gallery_visible"
          label={t("galleryLabel")}
          hint={t("galleryHint")}
          defaultChecked={values.galleryVisible}
        />
        <Switch
          id="require_approval"
          name="require_approval"
          label={t("approvalLabel")}
          hint={t("approvalHint")}
          defaultChecked={values.requireApproval}
        />

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 font-medium">{t("windowTitle")}</legend>
          {mounted ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="opens" label={t("opens")}>
                {(aria) => (
                  <Input
                    id="opens"
                    type="datetime-local"
                    required
                    value={opens}
                    onChange={(event) => setOpens(event.target.value)}
                    {...aria}
                  />
                )}
              </Field>
              <Field id="closes" label={t("closes")}>
                {(aria) => (
                  <Input
                    id="closes"
                    type="datetime-local"
                    required
                    value={closes}
                    onChange={(event) => setCloses(event.target.value)}
                    {...aria}
                  />
                )}
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          )}
          <input type="hidden" name="upload_opens_at" value={fromLocalInput(opens)} />
          <input type="hidden" name="upload_closes_at" value={fromLocalInput(closes)} />
          <p className="text-sm text-muted-foreground">{t("windowHint")}</p>
        </fieldset>

        <Button type="submit" size="lg" disabled={saving || !mounted} className="self-start">
          {saving ? <Spinner className="text-current" /> : null}
          {saving ? t("saving") : t("save")}
        </Button>
      </form>
    </Card>
  );
}
