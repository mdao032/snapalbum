"use client";

import { ApiError, createApiClient } from "@snapalbum/shared/api-client";
import type { MyMediaItem } from "@snapalbum/shared/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Button } from "@/components/ui/button";

const api = createApiClient({ baseUrl: "" });

type State =
  { status: "loading" } | { status: "error" } | { status: "ready"; items: MyMediaItem[] };

/**
 * "Mes photos" (F-038): what this guest has sent, with the right to delete any of it (G-005).
 * Deleting asks twice, with "keep" first, because it removes the photo for everyone. Loaded only
 * when the guest opens the panel. `refreshKey` changes when an upload finishes.
 */
export function MyPhotos({ eventCode, refreshKey }: { eventCode: string; refreshKey: number }) {
  const t = useTranslations("guest.mine");
  const format = useFormatter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const tFeedback = useTranslations("feedback");

  // Bumped to load again (retry button, a photo already gone elsewhere).
  const [attempt, setAttempt] = useState(0);

  // Loads on opening and again whenever an upload finishes.
  useEffect(() => {
    let active = true;
    api
      .myMedia({ action: "list", eventCode })
      .then((answer) => {
        if (active) {
          setState(
            answer.action === "list"
              ? { status: "ready", items: answer.items }
              : { status: "error" },
          );
        }
      })
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [eventCode, refreshKey, attempt]);

  async function remove(mediaId: string) {
    setAsking(null);
    try {
      await api.myMedia({ action: "delete", mediaId });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", items: current.items.filter((item) => item.mediaId !== mediaId) }
          : current,
      );
      setNotice(t("deleted"));
    } catch (error) {
      // Already gone (deleted from another tab): the list is simply refreshed.
      if (error instanceof ApiError && error.code === "not_found") setAttempt((count) => count + 1);
      else setNotice(t("deleteFailed"));
    }
  }

  return (
    <section aria-label={t("title")} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {notice ? (
        <p role="status" className="text-center text-sm font-medium">
          {notice}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t("loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-center text-sm">
            {t("error")}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((count) => count + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "ready" && state.items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {state.items.map((item) => {
            const date = format.dateTime(new Date(item.createdAt), {
              dateStyle: "medium",
              timeStyle: "short",
            });
            return (
              <li
                key={item.mediaId}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  {item.thumbUrl ? (
                    // A short-lived signed address of the storage: nothing `next/image` could serve.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbUrl}
                      alt={t(item.kind === "video" ? "videoAlt" : "photoAlt", { date })}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  {item.kind === "video" ? (
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                      {t("video")}
                    </span>
                  ) : null}
                </div>
                {item.moderation === "pending" ? (
                  <p className="text-xs text-muted-foreground">{t("awaiting")}</p>
                ) : null}
                {asking === item.mediaId ? (
                  <div role="group" aria-label={t("confirm")} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{t("confirm")}</p>
                    <Button variant="secondary" autoFocus onClick={() => setAsking(null)}>
                      {t("confirmNo")}
                    </Button>
                    <Button onClick={() => void remove(item.mediaId)}>{t("confirmYes")}</Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    aria-label={`${t("deleteLabel")} (${date})`}
                    onClick={() => setAsking(item.mediaId)}
                  >
                    {t("delete")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Offered once something was sent, and only here: nothing is added to the first screen. */}
      {state.status === "ready" && state.items.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
          <Button
            variant="secondary"
            aria-expanded={feedbackOpen}
            onClick={() => setFeedbackOpen(!feedbackOpen)}
          >
            {tFeedback("guest.open")}
          </Button>
          {feedbackOpen ? (
            <FeedbackForm
              audience="guest"
              eventCode={eventCode}
              onDone={() => setFeedbackOpen(false)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
