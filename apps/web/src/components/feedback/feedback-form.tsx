"use client";

import { ApiError, createApiClient } from "@snapalbum/shared/api-client";
import { FEEDBACK_MESSAGE_MAX_LENGTH } from "@snapalbum/shared/schemas";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const api = createApiClient({ baseUrl: "" });
const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * Feedback (step 6.2): a rating from 1 to 5 and an optional comment, for an
 * organiser (on their event page) or a guest (after a first successful upload). The server checks
 * that the author belongs to the event. Nothing here is required beyond the rating.
 */
export function FeedbackForm({
  audience,
  eventCode,
  onDone,
}: {
  audience: "organiser" | "guest";
  eventCode: string;
  /** Called after the thanks, if the form lives in a panel the person can close. */
  onDone?: () => void;
}) {
  const t = useTranslations("feedback");
  const tApi = useTranslations("apiErrors");
  const locale = useLocale();
  const [rating, setRating] = useState<number | null>(null);
  const [ratingMissing, setRatingMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating === null) {
      setRatingMissing(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.feedback({
        audience,
        eventCode,
        rating,
        message: String(new FormData(event.currentTarget).get("message") ?? ""),
        locale: locale === "en" ? "en" : "fr",
      });
      setSent(true);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === "rate_limited"
          ? tApi("rate_limited")
          : t("failed"),
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="feedback-thanks">
        <Alert tone="success">{t("thanks")}</Alert>
        {onDone ? (
          <Button variant="secondary" onClick={onDone}>
            {t("close")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="feedback-form" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">{t(`${audience}.question`)}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-describedby="feedback-scale">
          {RATINGS.map((value) => (
            <label
              key={value}
              className={cn(
                "inline-flex size-12 cursor-pointer items-center justify-center rounded-full text-lg font-semibold ring-1 ring-border has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/30",
                rating === value ? "bg-primary text-primary-foreground ring-primary" : "bg-surface",
              )}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => {
                  setRating(value);
                  setRatingMissing(false);
                }}
                className="sr-only"
                aria-label={t("option", { value })}
              />
              <span aria-hidden>{value}</span>
            </label>
          ))}
        </div>
        <p id="feedback-scale" className="text-sm text-muted-foreground">
          {t("scale")}
        </p>
        {ratingMissing ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {t("ratingMissing")}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="feedback-message" className="font-medium">
          {t(`${audience}.message`)}
        </label>
        <textarea
          id="feedback-message"
          name="message"
          rows={4}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          className="w-full rounded-xl bg-surface px-4 py-3 text-base text-foreground ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-primary/30"
          aria-describedby="feedback-optional"
        />
        <p id="feedback-optional" className="text-sm text-muted-foreground">
          {t("optional")}
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? <Spinner className="text-current" /> : null}
        {pending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
