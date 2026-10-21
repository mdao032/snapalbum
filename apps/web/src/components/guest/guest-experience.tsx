"use client";

import type { UploadEngine, UploadItem } from "@snapalbum/shared/upload";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";

// The join step (and its bot check) is only needed by a guest who has not joined yet.
const JoinForm = dynamic(() => import("./join-form").then((module) => module.JoinForm));

/** Reasons that have a message of their own; anything else falls back to a generic one. */
const KNOWN_REASONS = [
  "unsupported_format",
  "corrupted",
  "album_full",
  "upload_failed",
  "network_error",
] as const;
type KnownReason = (typeof KNOWN_REASONS)[number];

function reasonKey(reason: string | undefined): KnownReason {
  return (KNOWN_REASONS as readonly string[]).includes(reason ?? "")
    ? (reason as KnownReason)
    : "upload_failed";
}

/**
 * What the guest does on the event page: two big buttons (camera, gallery), the light join step
 * the first time, and a live view of what is being sent (F-030 to F-037). The upload machinery is
 * a separate chunk, loaded when the first file is chosen, so this page stays light (NF-002).
 */
export function GuestExperience({
  eventCode,
  joined: initiallyJoined,
  displayName: initialName,
  requiresAccessCode,
  turnstileSiteKey,
}: {
  eventCode: string;
  joined: boolean;
  displayName: string | null;
  requiresAccessCode: boolean;
  turnstileSiteKey: string | undefined;
}) {
  const t = useTranslations("guest");
  const [joined, setJoined] = useState(initiallyJoined);
  const [displayName, setDisplayName] = useState(initialName);
  const [showJoin, setShowJoin] = useState(false);
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [online, setOnline] = useState(true);
  const engineRef = useRef<Promise<UploadEngine<File>> | null>(null);
  const engineSync = useRef<UploadEngine<File> | null>(null);

  const getEngine = useCallback((): Promise<UploadEngine<File>> => {
    engineRef.current ??= import("./upload-runtime").then(({ createGuestEngine }) => {
      const engine = createGuestEngine({ eventCode, onNeedJoin: () => setShowJoin(true) });
      engineSync.current = engine;
      engine.subscribe(() => setItems(engine.getItems()));
      return engine;
    });
    return engineRef.current;
  }, [eventCode]);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    // Reset so that choosing the same file again still fires a change.
    event.target.value = "";
    if (chosen.length === 0) return;
    if (!joined) setShowJoin(true);
    const engine = await getEngine();
    engine.add(chosen);
  }

  function onJoined(name: string | null) {
    setJoined(true);
    setDisplayName(name);
    setShowJoin(false);
    engineSync.current?.resumeAfterJoin();
  }

  const summary = {
    total: items.length,
    sent: items.filter((item) => item.status === "sent").length,
    waiting: items.filter((item) => item.status !== "sent" && item.status !== "rejected").length,
  };

  // Connection back: try everything that was waiting again right away (NF-011).
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      engineSync.current?.retryNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Closing the page now would lose what is not sent yet: ask first (F-037).
  useEffect(() => {
    if (summary.waiting === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [summary.waiting]);

  return (
    <div className="flex flex-col gap-5">
      {joined ? (
        <p role="status" className="text-center font-medium">
          {displayName ? t("join.joinedAs", { name: displayName }) : t("join.joinedAnonymous")}
        </p>
      ) : null}

      {showJoin && !joined ? (
        <JoinForm
          eventCode={eventCode}
          requiresAccessCode={requiresAccessCode}
          turnstileSiteKey={turnstileSiteKey}
          onJoined={onJoined}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="sr-only">{t("upload.title")}</h2>
        <Button asChild size="lg" className="min-h-16 text-lg">
          <label>
            {t("upload.camera")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              data-testid="camera-input"
              onChange={onFiles}
            />
          </label>
        </Button>
        <Button asChild size="lg" variant="secondary" className="min-h-16 text-lg">
          <label>
            {t("upload.gallery")}
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="sr-only"
              data-testid="gallery-input"
              onChange={onFiles}
            />
          </label>
        </Button>
      </div>

      {!online ? (
        <p role="status" className="rounded-xl bg-warm-soft px-4 py-3 text-center font-medium">
          {t("upload.offline")}
        </p>
      ) : null}

      {items.length > 0 ? (
        <section aria-label={t("upload.title")} className="flex flex-col gap-3">
          {summary.waiting > 0 ? (
            <p
              role="status"
              className="sticky top-0 z-10 rounded-xl bg-warm-soft px-4 py-3 text-center font-medium"
            >
              {t("upload.pendingBanner", { count: summary.waiting })}
            </p>
          ) : (
            <p role="status" className="text-center font-medium">
              {t("upload.allSent")}
            </p>
          )}
          <progress
            className="h-3 w-full"
            max={summary.total}
            value={summary.sent}
            aria-label={t("upload.progress", { sent: summary.sent, total: summary.total })}
          />
          <p className="text-center text-sm text-muted-foreground">
            {t("upload.progress", { sent: summary.sent, total: summary.total })}
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                data-status={item.status}
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 text-sm">{t(`upload.status.${item.status}`)}</span>
                </span>
                {item.status === "uploading" ? (
                  <progress
                    className="h-2 w-full"
                    max={1}
                    value={item.progress}
                    aria-label={item.name}
                  />
                ) : null}
                {item.reason && item.status !== "sent" ? (
                  <span className="text-sm text-muted-foreground">
                    {t(`upload.reasons.${reasonKey(item.reason)}`)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {items.some((item) => item.status === "failed" || item.status === "waiting_quota") ? (
            <Button variant="secondary" onClick={() => engineSync.current?.retryNow()}>
              {t("upload.retry")}
            </Button>
          ) : null}
        </section>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{t("upload.keepOpen")}</p>
      )}
    </div>
  );
}
