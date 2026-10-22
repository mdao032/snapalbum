"use client";

import { SlideshowQueue } from "@snapalbum/shared/gallery";
import type { GalleryAccess } from "@snapalbum/shared/schemas";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { galleryApi } from "@/lib/gallery/use-gallery";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** How long a photo stays on screen. */
const SLIDE_MS = 8_000;
/** The cross-fade between two photos (also in `globals.css`). */
const FADE_MS = 1_200;
/** The cursor and the buttons hide after this long without movement. */
const IDLE_MS = 3_000;
/** The album is read again this often, in case a Realtime message was missed. */
const RESYNC_MS = 5 * 60_000;
/** Photos taken from the album when the page opens (the rotation of older ones). */
const SEED_PAGES = 2;

interface Slide {
  key: number;
  url: string;
}

/** Decodes a picture before it is shown, so the fade never reveals a half-loaded one. */
async function preload(url: string): Promise<boolean> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return true;
  } catch {
    return false;
  }
}

/**
 * The live slideshow (F-060 to F-064): new photos arrive through Supabase Realtime and are shown
 * first, older ones rotate, the next picture is fetched and decoded while the current one is on
 * screen, and the QR code stays in a corner. Built to run for a whole evening: it keeps only
 * identifiers (bounded) and the two pictures being faded, and asks for a fresh signed address each
 * time (they expire after an hour). The screen is kept awake with the Wake Lock API when the
 * browser has it.
 */
export function LiveSlideshow({
  eventCode,
  eventId,
  title,
  qr,
  madeWith,
}: {
  eventCode: string;
  eventId: string;
  title: string;
  /** The QR code of the event link, as an image address. */
  qr: string;
  /** The "Made with" notice of the plan, already worded; null when the plan has none. */
  madeWith: { label: string; mode: "visible" | "discreet" } | null;
}) {
  const t = useTranslations("live");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [started, setStarted] = useState(false);
  const [awake, setAwake] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // The show: Realtime, the queue and the clock. Everything imperative lives here, so a restart of
  // the effect (never in normal use) cleans up completely.
  useEffect(() => {
    const access: GalleryAccess = { type: "event", eventCode };
    const queue = new SlideshowQueue();
    let stopped = false;
    let shownOnce = false;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prepared: Promise<Slide | null> | null = null;
    let preparedFresh = false;

    /** Picks the next photo and gets it ready: signed address, then decoded. */
    async function prepare(): Promise<Slide | null> {
      preparedFresh = queue.hasFresh();
      // A photo that is not shown any more (hidden meanwhile) is dropped and the next one tried.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = queue.next();
        if (id === null) return null;
        try {
          const answer = await galleryApi.gallery({ action: "files", access, mediaIds: [id] });
          const url = answer.action === "files" ? answer.files[0]?.displayUrl : null;
          if (!url) {
            queue.remove(id);
            continue;
          }
          if (await preload(url)) {
            sequence += 1;
            return { key: sequence, url };
          }
        } catch {
          // No network for a moment: the next turn tries again.
        }
        return null;
      }
      return null;
    }

    async function show() {
      if (stopped) return;
      // What was made ready during the last turn; if there was nothing then, look again now.
      const slide = (await prepared) ?? (await prepare());
      prepared = null;
      if (stopped) return;
      if (slide) {
        shownOnce = true;
        setStarted(true);
        // Two layers at most: the new picture fades in over the previous one, which then goes.
        setSlides((current) => [...current.slice(-1), slide]);
        setTimeout(() => !stopped && setSlides((current) => current.slice(-1)), FADE_MS + 200);
      }
      // While this one is on screen, the next one is made ready.
      prepared = prepare();
      timer = setTimeout(() => void show(), SLIDE_MS);
    }

    /** A new photo: the very first one starts the show at once, a later one jumps the queue. */
    function onFresh() {
      if (!shownOnce) {
        clearTimeout(timer);
        void show();
      } else if (prepared && !preparedFresh) {
        prepared = prepare();
      }
    }

    async function readAlbum(): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < SEED_PAGES; page += 1) {
        const answer = await galleryApi.gallery({
          action: "list",
          access,
          sort: "sent",
          order: "desc",
          kind: "photo",
          limit: 100,
          cursor,
        });
        if (answer.action !== "list") break;
        ids.push(...answer.items.map((item) => item.mediaId));
        cursor = answer.nextCursor ?? undefined;
        if (!cursor) break;
      }
      return ids;
    }

    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Realtime applies the table's RLS for the role in the token it connects with: give it the
    // session's token before subscribing, or it would connect as an anonymous visitor and refuse.
    const subscribe = async () => {
      const { data } = await supabase.auth.getSession();
      if (stopped) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`live:${eventId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "media", filter: `event_id=eq.${eventId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id?: string };
              if (old.id) queue.remove(old.id);
              return;
            }
            const row = payload.new as {
              id: string;
              kind: string;
              status: string;
              moderation: string;
            };
            // Only what the album shows: a photo that is ready and approved (F-063).
            if (row.kind === "photo" && row.status === "ready" && row.moderation === "approved") {
              if (queue.addFresh(row.id)) onFresh();
            } else {
              queue.remove(row.id);
            }
          },
        )
        .subscribe();
    };
    void subscribe();

    readAlbum()
      .then((ids) => {
        if (stopped) return;
        queue.seed(ids);
        void show();
      })
      .catch(() => {
        // The album could not be read: Realtime may still bring photos, and the clock keeps going.
        if (!stopped) void show();
      });

    const resync = setInterval(() => {
      readAlbum()
        .then((ids) => {
          // Oldest first, so the newest ends up last in the queue of arrivals.
          for (const id of [...ids].reverse()) if (queue.addFresh(id)) onFresh();
        })
        .catch(() => undefined);
    }, RESYNC_MS);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(resync);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [eventCode, eventId]);

  // The screen stays on: the Wake Lock is released when the tab is hidden, so ask again on return.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      try {
        if (!stopped && document.visibilityState === "visible" && "wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Refused (low battery, no permission): the screen may sleep, nothing else breaks.
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // Cursor and buttons show on movement and hide again after a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), IDLE_MS);
    };
    wake();
    const events = ["mousemove", "mousedown", "keydown", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, wake);
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, []);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-black"
      style={{ cursor: awake ? "default" : "none" }}
      data-testid="live-stage"
    >
      <h1 className="sr-only">{title}</h1>

      {slides.map((slide) => (
        // A short-lived signed address of the storage: nothing `next/image` could serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={slide.key}
          src={slide.url}
          alt=""
          draggable={false}
          className="live-fade absolute inset-0 size-full object-contain"
          data-testid="live-slide"
        />
      ))}

      {!started ? (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center px-[10vw] text-center text-[clamp(1.25rem,3vw,2.5rem)] text-white/80"
        >
          {t("empty")}
        </p>
      ) : null}

      <div
        className="absolute bottom-[2vmin] right-[2vmin] flex flex-col items-center gap-[1vmin] rounded-[2vmin] bg-white p-[1.5vmin] text-black shadow-2xl"
        data-testid="live-qr"
      >
        {/* The QR code is a data address built on the server: nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt={t("qrAlt", { title })}
          className="size-[clamp(96px,16vmin,260px)]"
          draggable={false}
        />
        <p className="text-[clamp(0.8rem,2vmin,1.6rem)] font-semibold leading-tight">
          {t("addPhotos")}
        </p>
      </div>

      {madeWith ? (
        <p
          data-testid="made-with"
          data-mode={madeWith.mode}
          className={`absolute bottom-[2vmin] left-[2vmin] ${
            madeWith.mode === "visible"
              ? "text-[clamp(0.9rem,2.2vmin,1.8rem)] font-medium text-white/90"
              : "text-[clamp(0.75rem,1.6vmin,1.3rem)] text-white/70"
          }`}
        >
          {madeWith.label}
        </p>
      ) : null}

      <button
        type="button"
        onClick={toggleFullscreen}
        className={`absolute right-[2vmin] top-[2vmin] inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-black/60 px-4 text-sm text-white outline-none backdrop-blur transition-opacity focus-visible:ring-4 focus-visible:ring-white/60 ${
          awake ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        tabIndex={awake ? 0 : -1}
      >
        {fullscreen ? (
          <Minimize2 aria-hidden className="size-5" />
        ) : (
          <Maximize2 aria-hidden className="size-5" />
        )}
        {fullscreen ? t("exitFullscreen") : t("fullscreen")}
      </button>
    </div>
  );
}
