"use client";

import { aspectOf, buildRows, targetHeightFor, urlsAreStale } from "@snapalbum/shared/gallery";
import type { GalleryAccess, GalleryOrder, GallerySort } from "@snapalbum/shared/schemas";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_FILTERS,
  useGallery,
  type GalleryEntry,
  type GalleryFilters,
} from "@/lib/gallery/use-gallery";
import { cn } from "@/lib/utils";
import { BlurPlaceholder } from "./blur-placeholder";

// The full-screen viewer comes only when a photo is opened.
const Viewer = dynamic(() => import("./viewer").then((module) => module.Viewer));

const GAP = 4;
/** Rows kept ready above and below the screen. */
const OVERSCAN = 3;
/** Next page is asked when the screen gets this close to the last row. */
const PREFETCH_ROWS = 12;
/** Thumbnail addresses are checked this often (they last an hour). */
const RENEW_CHECK_MS = 60_000;

const SORTS = ["takenDesc", "takenAsc", "sentDesc", "sentAsc"] as const;
type SortChoice = (typeof SORTS)[number];

const SORT_VALUES: Record<SortChoice, { sort: GallerySort; order: GalleryOrder }> = {
  takenDesc: { sort: "taken", order: "desc" },
  takenAsc: { sort: "taken", order: "asc" },
  sentDesc: { sort: "sent", order: "desc" },
  sentAsc: { sort: "sent", order: "asc" },
};

const sortChoiceOf = (filters: GalleryFilters): SortChoice =>
  SORTS.find(
    (choice) =>
      SORT_VALUES[choice].sort === filters.sort && SORT_VALUES[choice].order === filters.order,
  ) ?? "takenDesc";

/**
 * The album (F-039, F-050 to F-054): a grid of thumbnails virtualised by row, a sort and filters,
 * and the full-screen viewer. It serves a guest (session) and the holder of a share link (token)
 * alike. Loaded on demand, never with the first page of the guest.
 */
export function Gallery({ access: given, title }: { access: GalleryAccess; title: string }) {
  const t = useTranslations("gallery");
  // The parent may rebuild this object on every render; the album it names never changes.
  const [access] = useState(given);
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const gallery = useGallery(access, filters);
  const entries = gallery.entries;
  const status = gallery.status;
  const hasMoreCursor = gallery.nextCursor !== null;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Width of the grid, and where it starts on the page (the window scrolls, not the grid). The
  // section is observed too: whatever appears above the grid (count line, notices) moves it.
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setWidth(Math.floor(rect.width));
      setScrollMargin(rect.top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () =>
      buildRows(
        entries.map((entry) => aspectOf(entry.width, entry.height)),
        { width, targetHeight: targetHeightFor(width), gap: GAP },
      ),
    [entries, width],
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index]?.height ?? 0) + GAP,
    getItemKey: (index) => entries[rows[index]?.cells[0]?.index ?? 0]?.mediaId ?? index,
    overscan: OVERSCAN,
    scrollMargin,
  });
  // Row heights come from the layout, not from measuring: tell the virtualizer when they change.
  useEffect(() => {
    virtualizer.measure();
  }, [rows, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows.at(-1)?.index ?? -1;
  const firstRow = virtualRows[0]?.index ?? 0;

  // Next page, before the guest reaches the end.
  const { loadMore } = gallery;
  useEffect(() => {
    if (status === "ready" && hasMoreCursor && lastRow >= rows.length - PREFETCH_ROWS) loadMore();
  }, [status, hasMoreCursor, lastRow, rows.length, loadMore]);

  // Fresh thumbnail addresses for what is on screen, before the old ones expire (SPEC 9.1).
  const { renewThumbs, urlsValidSeconds } = gallery;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), RENEW_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const visible = new Set<string>();
    for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
      for (const cell of rows[rowIndex]?.cells ?? []) {
        const entry = entries[cell.index];
        if (entry && urlsAreStale(entry.urlAt, urlsValidSeconds, Date.now())) {
          visible.add(entry.mediaId);
        }
      }
    }
    if (visible.size > 0) renewThumbs([...visible]);
  }, [firstRow, lastRow, rows, entries, urlsValidSeconds, renewThumbs, tick]);

  const patch = (change: Partial<GalleryFilters>) =>
    setFilters((current) => ({ ...current, ...change }));
  const filtered = filters.kind !== null || filters.guestId !== null;

  return (
    <section aria-label={t("title")} className="flex flex-col gap-4">
      <Controls
        filters={filters}
        guests={gallery.guests}
        total={gallery.total}
        onChange={patch}
        disabled={status === "loading" && entries.length === 0}
      />

      {status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p role="alert" className="text-center">
            {gallery.problem === "closed" ? t("closed") : t("error")}
          </p>
          {gallery.problem === "closed" ? null : (
            <Button variant="secondary" onClick={gallery.retry}>
              {t("retry")}
            </Button>
          )}
        </div>
      ) : null}

      {status === "loading" ? <GridSkeleton /> : null}

      {status === "ready" && entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-center text-muted-foreground">
            {filtered ? t("emptyFiltered") : t("empty")}
          </p>
          {filtered ? (
            <Button variant="secondary" onClick={() => patch({ kind: null, guestId: null })}>
              {t("resetFilters")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={container}
        aria-label={t("grid")}
        role="group"
        className="relative w-full"
        style={{ height: entries.length > 0 ? virtualizer.getTotalSize() : 0 }}
        data-testid="gallery-grid"
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              role="presentation"
              className="absolute left-0 top-0 flex w-full"
              style={{
                height: row.height,
                gap: GAP,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              {row.cells.map((cell) => {
                const entry = entries[cell.index];
                if (!entry) return null;
                return (
                  <Tile
                    key={entry.mediaId}
                    entry={entry}
                    width={cell.width}
                    height={row.height}
                    onOpen={() => setOpenIndex(cell.index)}
                    onBroken={() => renewThumbs([entry.mediaId])}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {gallery.loadingMore ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t("loadingMore")}
        </p>
      ) : null}

      {openIndex !== null && entries[openIndex] ? (
        <Viewer
          entries={entries}
          index={Math.min(openIndex, entries.length - 1)}
          access={access}
          title={title}
          hasMore={hasMoreCursor}
          onIndexChange={setOpenIndex}
          onNeedMore={loadMore}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </section>
  );
}

function Controls({
  filters,
  guests,
  total,
  onChange,
  disabled,
}: {
  filters: GalleryFilters;
  guests: { id: string; name: string | null; count: number }[];
  total: number | null;
  onChange: (change: Partial<GalleryFilters>) => void;
  disabled: boolean;
}) {
  const t = useTranslations("gallery.controls");
  const tCount = useTranslations("gallery");
  const kinds = [
    { value: null, label: t("kinds.all") },
    { value: "photo" as const, label: t("kinds.photo") },
    { value: "video" as const, label: t("kinds.video") },
  ];
  const selectClass =
    "min-h-11 w-full rounded-xl bg-surface px-3 text-base ring-1 ring-border outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

  return (
    <div className="flex flex-col gap-3" aria-label={t("title")} role="group">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t("kindLabel")} className="flex gap-2">
          {kinds.map((kind) => (
            <Button
              key={kind.label}
              type="button"
              variant={filters.kind === kind.value ? "primary" : "secondary"}
              aria-pressed={filters.kind === kind.value}
              disabled={disabled}
              className="px-4"
              onClick={() => onChange({ kind: kind.value })}
            >
              {kind.label}
            </Button>
          ))}
        </div>
        <label className="flex min-w-48 max-w-sm flex-1 flex-col gap-1 text-sm font-medium">
          {t("sortLabel")}
          <select
            className={selectClass}
            value={sortChoiceOf(filters)}
            disabled={disabled}
            onChange={(event) => onChange(SORT_VALUES[event.target.value as SortChoice])}
          >
            {SORTS.map((choice) => (
              <option key={choice} value={choice}>
                {t(`sort.${choice}`)}
              </option>
            ))}
          </select>
        </label>
        {guests.length > 1 ? (
          <label className="flex min-w-48 max-w-sm flex-1 flex-col gap-1 text-sm font-medium">
            {t("guestLabel")}
            <select
              className={selectClass}
              value={filters.guestId ?? ""}
              onChange={(event) => onChange({ guestId: event.target.value || null })}
            >
              <option value="">{t("allGuests")}</option>
              {guests.map((guest) => (
                <option key={guest.id} value={guest.id}>
                  {t("guestOption", {
                    name: guest.name ?? t("anonymousGuest"),
                    count: guest.count,
                  })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {total !== null ? tCount("count", { count: total }) : ""}
      </p>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-1" data-testid="gallery-skeleton">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="aspect-[4/3] animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function Tile({
  entry,
  width,
  height,
  onOpen,
  onBroken,
}: {
  entry: GalleryEntry;
  width: number;
  height: number;
  onOpen: () => void;
  onBroken: () => void;
}) {
  const t = useTranslations("gallery.tile");
  const format = useFormatter();
  const [loaded, setLoaded] = useState(false);
  const date = format.dateTime(new Date(entry.takenAt ?? entry.createdAt), {
    dateStyle: "medium",
  });
  const isVideo = entry.kind === "video";

  return (
    <button
      type="button"
      aria-label={t(isVideo ? "openVideo" : "open", { date })}
      onClick={onOpen}
      className="relative block shrink-0 cursor-pointer overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
      style={{ width, height }}
      data-testid="gallery-tile"
      data-media-id={entry.mediaId}
    >
      <BlurPlaceholder hash={entry.blurhash} />
      {entry.thumbUrl ? (
        // A short-lived signed address of the storage: nothing `next/image` could serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.thumbUrl}
          alt=""
          width={width}
          height={height}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={onBroken}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {isVideo ? (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
          <Play aria-hidden className="size-3 fill-current" />
          {t("video")}
        </span>
      ) : null}
    </button>
  );
}
