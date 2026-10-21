"use client";

import type { GuestPhase } from "@snapalbum/shared/events";
import type { PlanId } from "@snapalbum/shared/plans";
import type { StorageProblem, UploadEngine, UploadItem } from "@snapalbum/shared/upload";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { readPendingFlag } from "@/lib/upload/pending-flag";

// The join step (and its bot check) is only needed by a guest who has not joined yet.
const LOOKS_IN_APP =
  /; wv\)|Instagram|FB|WhatsApp|Snapchat|TikTok|Bytedance|Micro|Line\/|LinkedIn|Twitter/i;
const noopSubscribe = () => () => undefined;
const MyPhotos = dynamic(() => import("./my-photos").then((module) => module.MyPhotos));
const InAppNotice = dynamic(() => import("./in-app-notice").then((module) => module.InAppNotice));
const JoinForm = dynamic(() => import("./join-form").then((module) => module.JoinForm));
const NotifyEmail = dynamic(() => import("./notify-email").then((module) => module.NotifyEmail));
// The album (grid, viewer, their libraries) is only fetched when the guest opens the tab (NF-002).
const Gallery = dynamic(() =>
  import("@/components/gallery/gallery").then((module) => module.Gallery),
);

/** Reasons that have a message of their own; anything else falls back to a generic one. */
const KNOWN_REASONS = [
  "unsupported_format",
  "corrupted",
  "album_full",
  "video_too_long",
  "file_too_large",
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
  galleryVisible,
  phase,
  notifyEmail,
  title,
  turnstileSiteKey,
  plan,
  maxVideoSeconds,
}: {
  eventCode: string;
  joined: boolean;
  displayName: string | null;
  requiresAccessCode: boolean;
  /** The organiser opened the gallery to guests: the "Gallery" tab exists (F-039). */
  galleryVisible: boolean;
  /** What the event offers now: not yet, the event, after it, or uploads closed (F-043). */
  phase: GuestPhase;
  /** The address this guest left to be told when the album is ready (F-044). */
  notifyEmail: string | null;
  title: string;
  turnstileSiteKey: string | undefined;
  /** Plan of the event: its limits are applied before sending (SPEC 8.2). */
  plan: PlanId;
  maxVideoSeconds: number;
}) {
  const t = useTranslations("guest");
  const tGallery = useTranslations("gallery");
  const [joined, setJoined] = useState(initiallyJoined);
  const [displayName, setDisplayName] = useState(initialName);
  const [showJoin, setShowJoin] = useState(false);
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [online, setOnline] = useState(true);
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(null);
  const [resumed, setResumed] = useState(0);
  const [showMine, setShowMine] = useState(false);
  const [showNotify, setShowNotify] = useState(false);
  const [tab, setTab] = useState<"upload" | "gallery">("upload");
  // Once opened, the album stays mounted (hidden) so scroll and filters survive a trip to the other tab.
  const [galleryOpened, setGalleryOpened] = useState(false);
  // A browser built into another app is only recognised once the page runs (NF-023); the quick
  // test keeps the full detection out of the first load. False on the server and while hydrating.
  const inApp = useSyncExternalStore(
    noopSubscribe,
    () => LOOKS_IN_APP.test(navigator.userAgent),
    () => false,
  );
  const engineRef = useRef<Promise<UploadEngine<File>> | null>(null);
  const engineSync = useRef<UploadEngine<File> | null>(null);

  const getEngine = useCallback((): Promise<UploadEngine<File>> => {
    engineRef.current ??= import("./upload-runtime").then(({ createGuestEngine }) => {
      const engine = createGuestEngine({
        eventCode,
        plan,
        onNeedJoin: () => setShowJoin(true),
        onStorageProblem: setStorageProblem,
      });
      engineSync.current = engine;
      engine.subscribe(() => setItems(engine.getItems()));
      return engine;
    });
    return engineRef.current;
  }, [eventCode, plan]);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    // Reset so that choosing the same file again still fires a change.
    event.target.value = "";
    if (chosen.length === 0) return;
    if (!joined) setShowJoin(true);
    const engine = await getEngine();
    engine.add(chosen);
  }

  function selectTab(next: "upload" | "gallery") {
    setTab(next);
    if (next === "gallery") setGalleryOpened(true);
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

  // Files left on the device by an earlier visit (closed tab, crash) are taken back and sent (NF-010).
  useEffect(() => {
    if (!readPendingFlag(eventCode)) return;
    getEngine()
      .then((engine) => engine.restore())
      .then((count) => setResumed(count))
      .catch(() => undefined);
  }, [eventCode, getEngine]);

  // Back on the page: try what was waiting again right away (NF-011).
  useEffect(() => {
    const show = () => {
      if (document.visibilityState === "visible") engineSync.current?.retryNow();
    };
    document.addEventListener("visibilitychange", show);
    return () => document.removeEventListener("visibilitychange", show);
  }, []);

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

  // Uploads are not open yet: nothing to send, nothing to see.
  if (phase === "soon") {
    return (
      <Card className="flex flex-col gap-2 p-6 text-center">
        <h2 className="text-lg font-semibold">{t("comingSoonTitle")}</h2>
        <p className="text-muted-foreground">{t("comingSoonDescription")}</p>
      </Card>
    );
  }
  const canUpload = phase === "live" || phase === "after";
  // The album comes first once the party is over, if there is one to see (F-043).
  const albumFirst = galleryVisible && phase !== "live";

  return (
    <div className="flex flex-col gap-5">
      {joined ? (
        <p role="status" className="text-center font-medium">
          {displayName ? t("join.joinedAs", { name: displayName }) : t("join.joinedAnonymous")}
        </p>
      ) : null}

      {albumFirst && tab === "upload" ? (
        <Button size="lg" className="min-h-16 text-lg" onClick={() => selectTab("gallery")}>
          {t("album.view")}
        </Button>
      ) : null}

      {galleryVisible ? (
        <div
          role="tablist"
          aria-label={t("tabs.label")}
          className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            selectTab(tab === "upload" ? "gallery" : "upload");
          }}
        >
          {(["upload", "gallery"] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              data-testid={`tab-${name}`}
              onClick={() => selectTab(name)}
              className={cn(
                "min-h-11 cursor-pointer rounded-full px-4 font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-primary/30",
                tab === name ? "bg-surface shadow-sm ring-1 ring-border" : "text-muted-foreground",
              )}
            >
              {t(`tabs.${name}`)}
            </button>
          ))}
        </div>
      ) : null}

      {galleryVisible && galleryOpened ? (
        <div
          role="tabpanel"
          id="panel-gallery"
          aria-labelledby="tab-gallery"
          hidden={tab !== "gallery"}
        >
          {joined ? (
            <Gallery access={{ type: "event", eventCode }} title={title} />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-center font-medium">{tGallery("joinFirst")}</p>
              <JoinForm
                eventCode={eventCode}
                requiresAccessCode={requiresAccessCode}
                turnstileSiteKey={turnstileSiteKey}
                onJoined={onJoined}
              />
            </div>
          )}
        </div>
      ) : null}

      <div
        role={galleryVisible ? "tabpanel" : undefined}
        id="panel-upload"
        aria-labelledby={galleryVisible ? "tab-upload" : undefined}
        hidden={tab !== "upload"}
        className="flex flex-col gap-5"
      >
        {showJoin && !joined ? (
          <JoinForm
            eventCode={eventCode}
            requiresAccessCode={requiresAccessCode}
            turnstileSiteKey={turnstileSiteKey}
            onJoined={onJoined}
          />
        ) : null}

        {canUpload ? (
          <div className="flex flex-col gap-3">
            {phase === "after" && albumFirst ? (
              <p className="text-center text-muted-foreground">{t("upload.afterHint")}</p>
            ) : null}
            <h2 className="sr-only">{t("upload.title")}</h2>
            <Button
              asChild
              size="lg"
              variant={albumFirst ? "secondary" : "primary"}
              className="min-h-16 text-lg"
            >
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
        ) : (
          <div className="flex flex-col gap-1 text-center">
            <p role="status" className="font-medium">
              {t("upload.closed")}
            </p>
            {galleryVisible ? null : <p className="text-muted-foreground">{t("album.hidden")}</p>}
          </div>
        )}

        {joined ? (
          <Button
            variant="secondary"
            aria-expanded={showNotify}
            onClick={() => setShowNotify(!showNotify)}
          >
            {t("notify.open")}
          </Button>
        ) : null}
        {joined && showNotify ? (
          <NotifyEmail
            eventCode={eventCode}
            initialEmail={notifyEmail}
            onClose={() => setShowNotify(false)}
          />
        ) : null}

        {joined ? (
          <Button
            variant="secondary"
            aria-expanded={showMine}
            onClick={() => setShowMine(!showMine)}
          >
            {t(showMine ? "mine.close" : "mine.open")}
          </Button>
        ) : null}
        {joined && showMine ? <MyPhotos eventCode={eventCode} refreshKey={summary.sent} /> : null}

        {inApp ? <InAppNotice /> : null}

        {storageProblem ? (
          <p role="status" className="rounded-xl bg-warm-soft px-4 py-3 text-center font-medium">
            {t(
              storageProblem === "storage_full"
                ? "upload.storage.full"
                : "upload.storage.unavailable",
            )}
          </p>
        ) : null}

        {resumed > 0 ? (
          <p role="status" className="text-center font-medium">
            {t("upload.resumed", { count: resumed })}
          </p>
        ) : null}

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
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3"
                >
                  <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.previewUrl ? (
                      // A local object URL of the prepared thumbnail: nothing `next/image` could serve.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.previewUrl}
                        alt=""
                        width={56}
                        height={56}
                        className="size-full object-cover"
                        data-testid="upload-preview"
                      />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
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
                        {t(`upload.reasons.${reasonKey(item.reason)}`, {
                          seconds: maxVideoSeconds,
                        })}
                      </span>
                    ) : null}
                  </span>
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
    </div>
  );
}
