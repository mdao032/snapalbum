"use client";

import {
  DOUBLE_TAP_ZOOM,
  RESET_VIEW,
  clampView,
  distanceBetween,
  fitSize,
  midpointOf,
  neighbourhood,
  swipeDirection,
  urlsAreStale,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "@snapalbum/shared/gallery";
import {
  REPORT_REASONS,
  type GalleryAccess,
  type GalleryFile,
  type ReportReason,
} from "@snapalbum/shared/schemas";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { galleryApi, type GalleryEntry } from "@/lib/gallery/use-gallery";
import { cn } from "@/lib/utils";

/** Photos on each side of the open one whose files are fetched ahead of time. */
const AHEAD = 2;
/** Zoom step of the buttons, the keyboard and the wheel. */
const ZOOM_STEP = 1.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
/** The next page is asked when the viewer gets this close to the last photo loaded. */
const NEED_MORE_WITHIN = 5;

interface Fetched {
  file: GalleryFile;
  at: number;
}

const noopSubscribe = () => () => undefined;
/** Whether this browser can share a picture file (Web Share level 2): phones, some desktops. */
const canShareFiles = () =>
  typeof navigator.canShare === "function" &&
  navigator.canShare({ files: [new File([], "a.jpg", { type: "image/jpeg" })] });

/**
 * The full-screen viewer (F-051): a native modal dialog (focus kept inside, Escape closes), swipe
 * between photos, pinch or double tap to zoom, arrows and keys, video playback, download and
 * share. The thumbnail shows at once; the display version loads over it (F-053).
 */
export function Viewer({
  entries,
  index,
  access,
  title,
  hasMore,
  onIndexChange,
  onNeedMore,
  onClose,
}: {
  entries: readonly GalleryEntry[];
  index: number;
  access: GalleryAccess;
  title: string;
  hasMore: boolean;
  onIndexChange: (index: number) => void;
  onNeedMore: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("gallery.viewer");
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [files, setFiles] = useState<Record<string, Fetched>>({});
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<View>(RESET_VIEW);
  const [dragX, setDragX] = useState(0);
  // A finger is down: the photo follows it with no easing; otherwise changes ease in.
  const [gesturing, setGesturing] = useState(false);
  const [shareProblem, setShareProblem] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportNotice, setReportNotice] = useState<"thanks" | "failed" | null>(null);
  const shareable = useSyncExternalStore(noopSubscribe, canShareFiles, () => false);

  const entry = entries[index]!;
  const file = files[entry.mediaId]?.file;
  const isVideo = entry.kind === "video";
  const fitted = fitSize({ width: entry.width ?? 4, height: entry.height ?? 3 }, stageSize);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= entries.length) return;
      setView(RESET_VIEW);
      setDragX(0);
      setShareProblem(false);
      setReporting(false);
      setReportNotice(null);
      onIndexChange(target);
    },
    [entries.length, onIndexChange],
  );

  // A native modal: open it on mount, and keep the page behind it from scrolling.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
      if (element.open) element.close();
    };
  }, []);

  // Size of the viewing area, to fit the photo and bound the zoom.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Files of this photo and its neighbours, a few at a time; renewed when about to expire.
  useEffect(() => {
    const wanted = neighbourhood(index, entries.length, AHEAD)
      .map((position) => entries[position]!.mediaId)
      .filter((id) => {
        const known = files[id];
        return !known || urlsAreStale(known.at, 3600, Date.now());
      });
    if (wanted.length === 0) return;
    let active = true;
    galleryApi
      .gallery({ action: "files", access, mediaIds: wanted })
      .then((answer) => {
        if (!active || answer.action !== "files") return;
        const at = Date.now();
        setFiles((current) => ({
          ...current,
          ...Object.fromEntries(answer.files.map((item) => [item.mediaId, { file: item, at }])),
        }));
        setFailed(false);
        // Warm the cache for the next photos so swiping shows them at once.
        for (const item of answer.files) {
          if (item.displayUrl) new Image().src = item.displayUrl;
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
    // `files` is read to skip what is known; it must not restart the request when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, entries, access, retry]);

  // Near the end of what is loaded: bring the next page in.
  useEffect(() => {
    if (hasMore && index >= entries.length - NEED_MORE_WITHIN) onNeedMore();
  }, [index, entries.length, hasMore, onNeedMore]);

  const applyView = useCallback(
    (next: View) => setView(clampView(next, fitted, stageSize)),
    [fitted, stageSize],
  );
  const zoomBy = useCallback(
    (factor: number, point: Point = { x: 0, y: 0 }) =>
      setView((current) => clampView(zoomAt(current, factor, point), fitted, stageSize)),
    [fitted, stageSize],
  );

  // Pointer gestures on the photo: one finger swipes (or pans when zoomed), two pinch.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    startView: View;
    startPoint: Point;
    startTime: number;
    pinch: { distance: number; middle: Point } | null;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef(0);

  const relative = (event: { clientX: number; clientY: number }): Point => {
    const rect = stage.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect ? rect.left + rect.width / 2 : 0),
      y: event.clientY - (rect ? rect.top + rect.height / 2 : 0),
    };
  };

  function onPointerDown(event: React.PointerEvent) {
    if (isVideo) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, relative(event));
    setGesturing(true);
    const points = [...pointers.current.values()];
    const startPoint = points[0]!;
    gesture.current = {
      startView: view,
      startPoint,
      startTime: Date.now(),
      pinch:
        points.length >= 2
          ? {
              distance: distanceBetween(points[0]!, points[1]!),
              middle: midpointOf(points[0]!, points[1]!),
            }
          : null,
      moved: gesture.current?.moved ?? false,
    };
    if (points.length === 1) gesture.current.moved = false;
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = gesture.current;
    if (!current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, relative(event));
    const points = [...pointers.current.values()];

    if (points.length >= 2 && current.pinch) {
      const distance = distanceBetween(points[0]!, points[1]!);
      const middle = midpointOf(points[0]!, points[1]!);
      const zoomed = zoomAt(
        current.startView,
        distance / current.pinch.distance,
        current.pinch.middle,
      );
      applyView({
        ...zoomed,
        x: zoomed.x + middle.x - current.pinch.middle.x,
        y: zoomed.y + middle.y - current.pinch.middle.y,
      });
      current.moved = true;
      return;
    }

    const dx = points[0]!.x - current.startPoint.x;
    const dy = points[0]!.y - current.startPoint.y;
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) current.moved = true;
    if (current.startView.scale > 1) {
      applyView({ ...current.startView, x: current.startView.x + dx, y: current.startView.y + dy });
    } else {
      // Not zoomed: the photo follows the finger sideways, and a swipe changes photo on release.
      setDragX(dx);
    }
  }

  function onPointerEnd(event: React.PointerEvent) {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (!current) return;
    if (pointers.current.size > 0) {
      // A finger left a pinch: carry on from where the other one is.
      const rest = [...pointers.current.values()][0]!;
      gesture.current = { ...current, startView: view, startPoint: rest, pinch: null };
      return;
    }
    gesture.current = null;
    setGesturing(false);

    const end = relative(event);
    const dx = end.x - current.startPoint.x;
    const dy = end.y - current.startPoint.y;
    const elapsed = Date.now() - current.startTime;
    setDragX(0);

    if (current.startView.scale === 1 && view.scale === 1) {
      const direction = swipeDirection(dx, dy, elapsed);
      if (direction === "next") return goTo(index + 1);
      if (direction === "previous") return goTo(index - 1);
    }
    if (!current.moved) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        if (view.scale > 1) setView(RESET_VIEW);
        else zoomBy(DOUBLE_TAP_ZOOM, end);
      } else {
        lastTap.current = now;
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowRight":
        goTo(index + 1);
        break;
      case "ArrowLeft":
        goTo(index - 1);
        break;
      case "+":
      case "=":
        if (!isVideo) zoomBy(ZOOM_STEP);
        break;
      case "-":
        if (!isVideo) zoomBy(1 / ZOOM_STEP);
        break;
      case "0":
        setView(RESET_VIEW);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  async function report(reason: ReportReason) {
    setReporting(false);
    try {
      await galleryApi.report({ access, mediaId: entry.mediaId, reason });
      setReportNotice("thanks");
    } catch {
      setReportNotice("failed");
    }
  }

  async function share() {
    const source = file?.displayUrl;
    if (!source) return;
    setShareProblem(false);
    try {
      const blob = await (await fetch(source)).blob();
      const picture = new File([blob], `${title}.${blob.type.split("/")[1] ?? "jpg"}`, {
        type: blob.type,
      });
      if (!navigator.canShare({ files: [picture] })) throw new Error("not shareable");
      await navigator.share({ files: [picture], title });
    } catch (error) {
      // Closing the share sheet is not a failure.
      if ((error as { name?: string }).name !== "AbortError") setShareProblem(true);
    }
  }

  const iconButton =
    "inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white outline-none backdrop-blur transition hover:bg-black/75 focus-visible:ring-4 focus-visible:ring-white/60 disabled:opacity-40 [&_svg]:size-5";

  return (
    <dialog
      ref={dialog}
      aria-label={t("label")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-black p-0 text-white"
      data-testid="gallery-viewer"
    >
      <div
        ref={stage}
        className="absolute inset-0 flex touch-none items-center justify-center select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={(event) => {
          if (!isVideo) zoomBy(Math.exp(-event.deltaY * 0.002), relative(event));
        }}
      >
        {isVideo ? (
          file?.videoUrl ? (
            <video
              key={entry.mediaId}
              controls
              playsInline
              preload="metadata"
              poster={entry.thumbUrl ?? undefined}
              src={file.videoUrl}
              className="max-h-full max-w-full"
              data-testid="viewer-video"
            />
          ) : null
        ) : (
          <div
            className="relative"
            style={{
              width: fitted.width,
              height: fitted.height,
              transform: `translate(${view.x + dragX}px, ${view.y}px) scale(${view.scale})`,
              transition: gesturing ? "none" : "transform 150ms ease-out",
            }}
          >
            {entry.thumbUrl ? (
              // The thumbnail is already in the cache: the photo shows at once, then sharpens.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.thumbUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 size-full object-contain"
              />
            ) : null}
            {file?.displayUrl ? (
              // A short-lived signed address of the storage: nothing `next/image` could serve.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={entry.mediaId}
                src={file.displayUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 size-full object-contain"
                data-testid="viewer-photo"
              />
            ) : null}
          </div>
        )}

        {!file && !failed ? (
          <p
            role="status"
            className="absolute bottom-24 rounded-full bg-black/60 px-4 py-2 text-sm"
          >
            {t("loading")}
          </p>
        ) : null}
        {failed && !file ? (
          <div className="absolute bottom-24 flex flex-col items-center gap-2 rounded-2xl bg-black/70 p-4">
            <p role="alert">{t("fileError")}</p>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full bg-white px-5 font-medium text-black"
              onClick={() => setRetry((count) => count + 1)}
            >
              {t("retry")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-3">
        <p
          className="pointer-events-auto rounded-full bg-black/55 px-4 py-2 text-sm"
          aria-live="polite"
        >
          {t("position", { index: index + 1, total: entries.length })}
        </p>
        <button
          type="button"
          className={cn(iconButton, "pointer-events-auto")}
          aria-label={t("close")}
          onClick={onClose}
          autoFocus
        >
          <X aria-hidden />
        </button>
      </div>

      {index > 0 ? (
        <button
          type="button"
          className={cn(iconButton, "absolute left-3 top-1/2 -translate-y-1/2")}
          aria-label={t("previous")}
          onClick={() => goTo(index - 1)}
        >
          <ChevronLeft aria-hidden />
        </button>
      ) : null}
      {index < entries.length - 1 ? (
        <button
          type="button"
          className={cn(iconButton, "absolute right-3 top-1/2 -translate-y-1/2")}
          aria-label={t("next")}
          onClick={() => goTo(index + 1)}
        >
          <ChevronRight aria-hidden />
        </button>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
        {reportNotice ? (
          <p role="status" className="rounded-full bg-black/70 px-4 py-2 text-sm">
            {t(reportNotice === "thanks" ? "reportThanks" : "reportFailed")}
          </p>
        ) : null}
        {reporting ? (
          <div
            role="group"
            aria-label={t("reportTitle")}
            className="flex flex-col items-center gap-2 rounded-2xl bg-black/80 p-3"
          >
            <p className="text-sm font-medium">{t("reportTitle")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="min-h-11 cursor-pointer rounded-full bg-white px-4 text-sm font-medium text-black"
                  onClick={() => void report(reason)}
                >
                  {t(`reportReasons.${reason}`)}
                </button>
              ))}
              <button
                type="button"
                className="min-h-11 cursor-pointer rounded-full bg-white/20 px-4 text-sm"
                onClick={() => setReporting(false)}
              >
                {t("reportCancel")}
              </button>
            </div>
          </div>
        ) : null}
        {shareProblem ? (
          <p role="alert" className="rounded-full bg-black/70 px-4 py-2 text-sm">
            {t("shareFailed")}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          {isVideo ? null : (
            <>
              <button
                type="button"
                className={iconButton}
                aria-label={t("zoomOut")}
                disabled={view.scale <= 1}
                onClick={() => zoomBy(1 / ZOOM_STEP)}
              >
                <ZoomOut aria-hidden />
              </button>
              <button
                type="button"
                className={iconButton}
                aria-label={t("zoomIn")}
                onClick={() => zoomBy(ZOOM_STEP)}
              >
                <ZoomIn aria-hidden />
              </button>
            </>
          )}
          <button
            type="button"
            className={cn(iconButton, "w-auto gap-2 px-4 text-sm font-medium")}
            aria-expanded={reporting}
            data-testid="viewer-report"
            onClick={() => setReporting(!reporting)}
          >
            <Flag aria-hidden />
            {t("report")}
          </button>
          {file ? (
            <a
              href={file.downloadUrl}
              download
              className={cn(iconButton, "w-auto gap-2 px-4 text-sm font-medium")}
              data-testid="viewer-download"
            >
              <Download aria-hidden />
              {t("download")}
            </a>
          ) : null}
          {shareable && !isVideo && file?.displayUrl ? (
            <button
              type="button"
              className={cn(iconButton, "w-auto gap-2 px-4 text-sm font-medium")}
              onClick={() => void share()}
            >
              <Share2 aria-hidden />
              {t("share")}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
