"use client";

import { purgeDeadline } from "@snapalbum/shared";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { requestDeletionAction } from "@/app/[locale]/(app)/events/[id]/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatInstantDate } from "@/lib/events";

/**
 * Deleting an event (R5) takes two deliberate steps: the first button only opens a confirmation
 * that says what will happen and when, with the "keep" button first in reading order.
 */
export function DeleteEvent({ eventId, title }: { eventId: string; title: string }) {
  const t = useTranslations("dashboard.danger");
  const locale = useLocale();
  // Set when the dialog opens: the purge deadline is 7 days from that moment.
  const [deadline, setDeadline] = useState<string | null>(null);

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        {deadline ? (
          <div
            role="alertdialog"
            aria-labelledby="delete-title"
            aria-describedby="delete-description"
            className="flex flex-col gap-4 rounded-2xl bg-danger-soft p-5"
          >
            <p id="delete-title" className="font-semibold text-danger">
              {t("confirmTitle", { title })}
            </p>
            <p id="delete-description" className="text-sm">
              {t("confirmDescription", {
                date: deadline,
              })}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" autoFocus onClick={() => setDeadline(null)}>
                {t("keep")}
              </Button>
              <form action={requestDeletionAction.bind(null, eventId)}>
                <Button type="submit" className="bg-danger text-white shadow-none hover:bg-danger">
                  <Trash2 aria-hidden />
                  {t("confirm")}
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="self-start text-danger"
            onClick={() => setDeadline(formatInstantDate(purgeDeadline(new Date()), locale))}
          >
            <Trash2 aria-hidden />
            {t("start")}
          </Button>
        )}
      </div>
    </Card>
  );
}
