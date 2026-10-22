"use client";

import { DELETION_GRACE_DAYS } from "@snapalbum/shared";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  cancelAccountDeletionAction,
  requestAccountDeletionAction,
  type DeletionFormState,
} from "@/app/[locale]/(app)/account/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatInstantDate } from "@/lib/events";

const IDLE: DeletionFormState = { status: "idle" };

/**
 * Deleting the account (F-004, G-004): what it does, a box to tick, a button. Once asked, the card
 * turns into the countdown with a way back, for the 7 days of reflection (R5).
 */
export function DeleteAccountCard({ purgeAt }: { purgeAt: string | null }) {
  const t = useTranslations("account.delete");
  const locale = useLocale();
  const [requestState, request, requesting] = useActionState(requestAccountDeletionAction, IDLE);
  const [cancelState, cancel, cancelling] = useActionState(cancelAccountDeletionAction, IDLE);
  const [confirmed, setConfirmed] = useState(false);

  // The server's answer to each action refreshes the page, so `purgeAt` is always the truth.
  const pending = purgeAt;
  const date = (instant: string) => formatInstantDate(instant, locale);
  const failure =
    requestState.status === "error"
      ? requestState.error
      : cancelState.status === "error"
        ? cancelState.error
        : null;

  return (
    <Card className="p-6 sm:p-8" data-testid="delete-account" data-pending={pending ? "yes" : "no"}>
      <div className="flex flex-col gap-4">
        {pending ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-danger">
                {t("pendingTitle", { date: date(pending) })}
              </h2>
              <p>{t("pendingText")}</p>
            </div>
            {requestState.status === "requested" ? (
              <Alert tone="success">{t("requested", { date: date(requestState.purgeAt) })}</Alert>
            ) : null}
            {failure ? (
              <Alert tone="error">{failure === "too_late" ? t("tooLate") : t("failed")}</Alert>
            ) : null}
            <form action={cancel}>
              <Button type="submit" size="lg" disabled={cancelling}>
                {cancelling ? <Spinner className="text-current" /> : null}
                {t("cancel")}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">{t("title")}</h2>
              <p className="text-muted-foreground">{t("intro")}</p>
            </div>
            {cancelState.status === "cancelled" ? (
              <Alert tone="success">{t("cancelled")}</Alert>
            ) : null}
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>{t("point1", { days: DELETION_GRACE_DAYS })}</li>
              <li>{t("point2")}</li>
              <li>{t("point3")}</li>
            </ul>
            <p className="text-sm text-muted-foreground">{t("download")}</p>
            {failure ? <Alert tone="error">{t("failed")}</Alert> : null}
            <form action={request} className="flex flex-col gap-4">
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="confirm"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-1 size-5 cursor-pointer accent-primary"
                />
                <span>{t("confirm", { days: DELETION_GRACE_DAYS })}</span>
              </label>
              <Button
                type="submit"
                size="lg"
                variant="secondary"
                disabled={!confirmed || requesting}
                className="self-start text-danger"
              >
                {requesting ? <Spinner className="text-current" /> : null}
                {t("submit")}
              </Button>
            </form>
          </>
        )}
      </div>
    </Card>
  );
}
