"use client";

import type { Locale, LoginErrorCode } from "@snapalbum/shared";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  sendMagicLinkAction,
  signInWithGoogleAction,
  type LoginFormState,
} from "@/app/[locale]/(auth)/login/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { GoogleMark } from "./google-mark";
import { TurnstileField } from "./turnstile-field";

const IDLE: LoginFormState = { status: "idle" };

/** Sign-in screen (F-001, F-002): e-mail link, optional Google, then the "check your e-mails" state. */
export function LoginForm({
  locale,
  next,
  initialError,
  googleEnabled,
  turnstileSiteKey,
}: {
  locale: Locale;
  next: string | undefined;
  /** Why the visitor came back from `/auth/confirm` (expired link, failed Google sign-in). */
  initialError: LoginErrorCode | undefined;
  googleEnabled: boolean;
  turnstileSiteKey: string | undefined;
}) {
  const t = useTranslations("auth");
  const tApi = useTranslations("apiErrors");
  const [state, sendLink, sending] = useActionState(sendMagicLinkAction, IDLE);
  const [googleState, googleAction, googleOpening] = useActionState(signInWithGoogleAction, IDLE);
  const [captchaReady, setCaptchaReady] = useState(!turnstileSiteKey);
  // "Use another address" hides the sent state without leaving the page.
  const [dismissed, setDismissed] = useState<LoginFormState | null>(null);

  const hiddenFields = (
    <>
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
    </>
  );
  const captcha = turnstileSiteKey ? (
    <TurnstileField siteKey={turnstileSiteKey} resetKey={state} onReadyChange={setCaptchaReady} />
  ) : null;

  const errorCode =
    state.status === "error"
      ? state.error
      : googleState.status === "error"
        ? googleState.error
        : null;
  let errorText: string | null = null;
  if (errorCode === "rate_limited") errorText = tApi("rate_limited");
  else if (errorCode) errorText = t(`errors.${errorCode}`);
  else if (initialError) errorText = t(`errors.${initialError}`);

  // A failed "send again" keeps the confirmation card and shows the error inside it.
  const sentTo =
    state.status === "sent" && state !== dismissed
      ? state.email
      : state.status === "error" && state.resendEmail && state !== dismissed
        ? state.resendEmail
        : null;

  if (sentTo) {
    return (
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <h1 className="text-title">{t("checkEmail.title")}</h1>
        <p className="text-pretty text-muted-foreground" role="status">
          {t(
            state.status === "sent" && state.resent
              ? "checkEmail.resent"
              : "checkEmail.description",
            {
              email: sentTo,
            },
          )}
        </p>
        {state.status === "error" && errorText ? <Alert tone="error">{errorText}</Alert> : null}
        <p className="text-pretty text-sm text-muted-foreground">{t("checkEmail.hint")}</p>
        <form action={sendLink} className="flex w-full flex-col items-stretch gap-3">
          {hiddenFields}
          <input type="hidden" name="email" value={sentTo} />
          <input type="hidden" name="resend" value="1" />
          {captcha}
          <Button type="submit" variant="secondary" disabled={sending || !captchaReady}>
            {sending ? <Spinner /> : null}
            {t("checkEmail.resend")}
          </Button>
        </form>
        <Button type="button" variant="ghost" onClick={() => setDismissed(state)}>
          {t("checkEmail.change")}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-title">{t("login.title")}</h1>
        <p className="text-pretty text-muted-foreground">{t("login.subtitle")}</p>
      </div>

      {errorText ? <Alert tone="error">{errorText}</Alert> : null}

      <form action={sendLink} className="flex flex-col gap-4">
        {hiddenFields}
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="font-medium">
            {t("login.emailLabel")}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder={t("login.emailPlaceholder")}
            aria-invalid={state.status === "error" && state.error === "invalid_email"}
          />
        </div>
        {captcha}
        <Button type="submit" size="lg" disabled={sending || !captchaReady}>
          {sending ? <Spinner className="text-current" /> : null}
          {sending ? t("login.sending") : t("login.submit")}
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            {t("login.or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <form action={googleAction}>
            {hiddenFields}
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={googleOpening}
            >
              {googleOpening ? <Spinner /> : <GoogleMark />}
              {googleOpening ? t("login.googleOpening") : t("login.google")}
            </Button>
          </form>
        </>
      ) : null}

      <p className="text-pretty text-sm text-muted-foreground">{t("login.newHere")}</p>
    </Card>
  );
}
