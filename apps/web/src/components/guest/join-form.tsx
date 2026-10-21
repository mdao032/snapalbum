"use client";

import { GUEST_NAME_MAX_LENGTH } from "@snapalbum/shared/constants";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/** Where the guest's first name is remembered on this device (F-033). */
const NAME_KEY = "snapalbum:guest-name";

/** Error codes of the join route that have a message of their own. */
const KNOWN_ERRORS = [
  "access_code_required",
  "access_code_invalid",
  "captcha_failed",
  "rate_limited",
  "event_suspended",
  "validation_failed",
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

interface JoinPayload {
  eventCode: string;
  displayName?: string;
  acceptTerms: true;
  accessCode?: string;
  turnstileToken?: string;
}

/**
 * Calls the join route. Plain `fetch` on purpose: this form is part of the page's first
 * JavaScript, and the shared API client (with its validation library) is loaded only when
 * photos are actually sent (NF-002).
 */
async function postJoin(payload: JoinPayload): Promise<{ displayName: string | null }> {
  let response: Response;
  try {
    response = await fetch("/api/guests/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("network_error");
  }
  const body = (await response.json().catch(() => null)) as {
    displayName?: string | null;
    error?: { code?: string };
  } | null;
  if (!response.ok) throw new Error(body?.error?.code ?? "internal_error");
  return { displayName: body?.displayName ?? null };
}

/**
 * The light step before a guest's first upload (F-033, F-034, F-035): an optional first name,
 * the terms, and the access code only when the organiser set one. No account, no password.
 */
export function JoinForm({
  eventCode,
  requiresAccessCode,
  turnstileSiteKey,
  onJoined,
}: {
  eventCode: string;
  requiresAccessCode: boolean;
  turnstileSiteKey: string | undefined;
  /** Called once the guest is registered (the page then sends the photos already chosen). */
  onJoined: (displayName: string | null) => void;
}) {
  const t = useTranslations("guest.join");
  const tApi = useTranslations("apiErrors");
  const nameInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsMissing, setTermsMissing] = useState(false);
  const [captchaReady, setCaptchaReady] = useState(!turnstileSiteKey);

  // The name remembered on this device (F-033), put in the field once the page runs here.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAME_KEY);
      if (saved && nameInput.current && !nameInput.current.value) nameInput.current.value = saved;
    } catch {
      // Storage can be blocked (private mode): the field just stays empty.
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("terms") !== "on") {
      setTermsMissing(true);
      return;
    }
    setTermsMissing(false);
    setError(null);
    setPending(true);

    const name = String(data.get("displayName") ?? "").trim();
    const code = String(data.get("accessCode") ?? "").trim();
    try {
      const result = await postJoin({
        eventCode,
        displayName: name || undefined,
        acceptTerms: true,
        accessCode: code || undefined,
        turnstileToken: String(data.get("cf-turnstile-response") ?? "") || undefined,
      });
      try {
        window.localStorage.setItem(NAME_KEY, result.displayName ?? "");
      } catch {
        // Not remembering the name is harmless.
      }
      onJoined(result.displayName);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : "";
      setError(
        (KNOWN_ERRORS as readonly string[]).includes(reason)
          ? tApi(reason as KnownError)
          : t("failed"),
      );
      setPending(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field id="displayName" label={t("nameLabel")} hint={t("nameHint")}>
          {(aria) => (
            <Input
              ref={nameInput}
              id="displayName"
              name="displayName"
              autoComplete="given-name"
              maxLength={GUEST_NAME_MAX_LENGTH}
              {...aria}
            />
          )}
        </Field>

        {requiresAccessCode ? (
          <Field id="accessCode" label={t("codeLabel")} hint={t("codeHint")}>
            {(aria) => (
              <Input
                id="accessCode"
                name="accessCode"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                maxLength={6}
                autoComplete="off"
                required
                {...aria}
              />
            )}
          </Field>
        ) : null}

        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              name="terms"
              aria-describedby={termsMissing ? "terms-error" : undefined}
              aria-invalid={termsMissing}
              className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary"
            />
            <span>{t("termsLabel")}</span>
          </label>
          {termsMissing ? (
            <p id="terms-error" role="alert" className="pl-9 text-sm font-medium text-danger">
              {t("termsRequired")}
            </p>
          ) : null}
        </div>

        {turnstileSiteKey ? (
          <TurnstileField
            siteKey={turnstileSiteKey}
            resetKey={error}
            onReadyChange={setCaptchaReady}
          />
        ) : null}

        <Button type="submit" size="lg" disabled={pending || !captchaReady}>
          {pending ? <Spinner className="text-current" /> : null}
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </Card>
  );
}
