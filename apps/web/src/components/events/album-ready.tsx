"use client";

import { Check, Mail } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * "The album is ready" (F-044): the organiser tells the guests who left an e-mail address that the
 * link to the album is available. It can only be done once, so it asks first ("Not yet" comes
 * first and is selected). Only the number of guests waiting is shown, never their addresses.
 */
export function AlbumReady({
  waitingCount,
  readyAt,
  onDeclare,
}: {
  waitingCount: number;
  /** When the album was declared ready, or null. */
  readyAt: string | null;
  onDeclare: () => Promise<{ ok: true; readyAt: string } | { ok: false }>;
}) {
  const t = useTranslations("dashboard.albumReady");
  const format = useFormatter();
  const [declaredAt, setDeclaredAt] = useState(readyAt);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function declare() {
    setAsking(false);
    setFailed(false);
    startTransition(async () => {
      const result = await onDeclare();
      if (result.ok) setDeclaredAt(result.readyAt);
      else setFailed(true);
    });
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        <p>{t("waiting", { count: waitingCount })}</p>

        {declaredAt ? (
          <div className="flex flex-col gap-1" data-testid="album-ready-done">
            <p role="status" className="flex items-center gap-2 font-medium">
              <Check aria-hidden className="size-5 text-primary" />
              {t("done", {
                date: format.dateTime(new Date(declaredAt), {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              })}
            </p>
            <p className="text-muted-foreground">{t("doneHint")}</p>
          </div>
        ) : asking ? (
          <div role="group" aria-label={t("ask")} className="flex flex-col gap-3">
            <p className="font-medium">{t("ask")}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" autoFocus onClick={() => setAsking(false)}>
                {t("askNo")}
              </Button>
              <Button disabled={pending} onClick={declare}>
                {t("askYes")}
              </Button>
            </div>
          </div>
        ) : (
          <Button className="self-start" disabled={pending} onClick={() => setAsking(true)}>
            <Mail aria-hidden />
            {t("action")}
          </Button>
        )}

        {failed ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {t("failed")}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
