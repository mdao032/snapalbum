"use client";

import type { ModerationItem } from "@snapalbum/shared/schemas";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  moderateAction,
  moderationFileAction,
} from "@/app/[locale]/(app)/events/[id]/moderation/actions";
import { Button } from "@/components/ui/button";

/**
 * One-by-one approval (F-071), made for speed: the photo takes the screen, "A" approves, "R"
 * refuses, the arrows skip, Escape leaves. The list is the pending photos of the moderation page;
 * a decided photo leaves it and the next one comes up.
 */
export function ReviewMode({
  eventId,
  items,
  onClose,
}: {
  eventId: string;
  items: ModerationItem[];
  onClose: () => void;
}) {
  const t = useTranslations("moderation.review");
  const dialog = useRef<HTMLDialogElement>(null);
  const [queue, setQueue] = useState(items);
  const [position, setPosition] = useState(0);
  const [url, setUrl] = useState<{ id: string; src: string | null; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = queue[Math.min(position, Math.max(queue.length - 1, 0))];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  // The picture of the current photo: the display version, fetched when it comes up.
  useEffect(() => {
    if (!current) return;
    let active = true;
    moderationFileAction(eventId, current.mediaId).then((answer) => {
      if (!active) return;
      setUrl({
        id: current.mediaId,
        src: answer.ok && answer.kind === "photo" ? answer.url : null,
        failed: !answer.ok || !answer.url,
      });
    });
    return () => {
      active = false;
    };
  }, [eventId, current]);

  async function decide(action: "approve" | "reject") {
    if (!current || busy) return;
    setBusy(true);
    const result = await moderateAction(eventId, action, [current.mediaId]);
    setBusy(false);
    if (!result.ok) return;
    setQueue((rest) => rest.filter((item) => item.mediaId !== current.mediaId));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key.toLowerCase()) {
      case "a":
        void decide("approve");
        break;
      case "r":
        void decide("reject");
        break;
      case "arrowright":
        setPosition((value) => Math.min(value + 1, queue.length - 1));
        break;
      case "arrowleft":
        setPosition((value) => Math.max(value - 1, 0));
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const shown = url && current && url.id === current.mediaId ? url : null;

  return (
    <dialog
      ref={dialog}
      aria-label={t("title")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-black p-0 text-white"
      data-testid="review-mode"
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <p className="rounded-full bg-white/15 px-4 py-2 text-sm" aria-live="polite">
          {current
            ? t("position", {
                index: Math.min(position, queue.length - 1) + 1,
                total: queue.length,
              })
            : t("done")}
        </p>
        <Button variant="secondary" onClick={onClose} autoFocus>
          {t("close")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {current ? (
          shown?.src ? (
            // A short-lived signed address of the storage: nothing `next/image` could serve.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown.src}
              alt=""
              className="max-h-full max-w-full object-contain"
              data-testid="review-photo"
            />
          ) : shown?.failed ? (
            <p role="alert">{t("fileError")}</p>
          ) : (
            <p role="status">{t("loading")}</p>
          )
        ) : (
          <p role="status" className="text-xl">
            {t("done")}
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 p-4">
        {current ? (
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              variant="secondary"
              disabled={position === 0}
              onClick={() => setPosition((value) => Math.max(value - 1, 0))}
            >
              {t("previous")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => void decide("reject")}
              data-testid="review-reject"
            >
              <X aria-hidden />
              {t("reject")}
            </Button>
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void decide("approve")}
              data-testid="review-approve"
            >
              <Check aria-hidden />
              {t("approve")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={position >= queue.length - 1}
              onClick={() => setPosition((value) => Math.min(value + 1, queue.length - 1))}
            >
              {t("skip")}
            </Button>
          </div>
        ) : null}
        <p className="text-sm text-white/70">{t("shortcuts")}</p>
      </div>
    </dialog>
  );
}
