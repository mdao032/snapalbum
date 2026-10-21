"use client";

import { ApiError, createApiClient } from "@snapalbum/shared/api-client";
import { emailSchema } from "@snapalbum/shared/auth";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const api = createApiClient({ baseUrl: "" });

/**
 * "Tell me when the album is ready" (F-044): an optional e-mail address with a consent of its own,
 * never bundled with the terms. One e-mail is sent, with the link of the album, and the address is
 * erased when the event ends. The guest can see what they left and take it back at any time.
 * Loaded only when the guest opens it.
 */
export function NotifyEmail({
  eventCode,
  initialEmail,
  onClose,
}: {
  eventCode: string;
  initialEmail: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("guest.notify");
  const tApi = useTranslations("apiErrors");
  const [saved, setSaved] = useState(initialEmail);
  const [editing, setEditing] = useState(initialEmail === null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function failureMessage(failure: unknown): string {
    return failure instanceof ApiError && failure.code === "rate_limited"
      ? tApi("rate_limited")
      : t("failed");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = emailSchema.safeParse(String(data.get("email") ?? ""));
    const consent = data.get("consent") === "on";
    setEmailInvalid(!email.success);
    setConsentMissing(!consent);
    setError(null);
    if (!email.success || !consent) return;

    setPending(true);
    try {
      const answer = await api.notify({
        action: "set",
        eventCode,
        email: email.data,
        consent: true,
      });
      if (answer.action === "set") setSaved(answer.email);
      setEditing(false);
      setNotice(null);
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  async function withdraw() {
    setPending(true);
    setError(null);
    try {
      await api.notify({ action: "clear", eventCode });
      setSaved(null);
      setEditing(false);
      setNotice(t("withdrawn"));
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-6" data-testid="notify-email">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          {editing ? <p className="text-muted-foreground">{t("intro")}</p> : null}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        {editing ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field
              id="notify-email"
              label={t("emailLabel")}
              error={emailInvalid ? t("emailInvalid") : undefined}
            >
              {(aria) => (
                <Input
                  id="notify-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  defaultValue={saved ?? ""}
                  {...aria}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input
                  type="checkbox"
                  name="consent"
                  aria-describedby={consentMissing ? "notify-consent-error" : undefined}
                  aria-invalid={consentMissing}
                  className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary"
                />
                <span>{t("consentLabel")}</span>
              </label>
              {consentMissing ? (
                <p
                  id="notify-consent-error"
                  role="alert"
                  className="pl-9 text-sm font-medium text-danger"
                >
                  {t("consentRequired")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner className="text-current" /> : null}
                {pending ? t("submitting") : t("submit")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("close")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p role="status" className="font-medium">
              {saved ? t("saved", { email: saved }) : notice}
            </p>
            <div className="flex flex-wrap gap-3">
              {saved ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    {t("change")}
                  </Button>
                  <Button type="button" variant="secondary" disabled={pending} onClick={withdraw}>
                    {t("withdraw")}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                  {t("open")}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("close")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
