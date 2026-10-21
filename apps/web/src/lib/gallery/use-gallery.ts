"use client";

import { ApiError, createApiClient } from "@snapalbum/shared/api-client";
import type {
  GalleryAccess,
  GalleryGuest,
  GalleryItem,
  GalleryOrder,
  GallerySort,
} from "@snapalbum/shared/schemas";
import { useCallback, useEffect, useRef, useState } from "react";

export const galleryApi = createApiClient({ baseUrl: "" });

/** A media of the grid, with the moment its thumbnail address was obtained (they expire, SPEC 9.1). */
export interface GalleryEntry extends GalleryItem {
  urlAt: number;
}

export interface GalleryFilters {
  sort: GallerySort;
  order: GalleryOrder;
  kind: "photo" | "video" | null;
  guestId: string | null;
}

export const DEFAULT_FILTERS: GalleryFilters = {
  sort: "taken",
  order: "desc",
  kind: null,
  guestId: null,
};

export type GalleryProblem = "closed" | "unavailable";

interface State {
  status: "loading" | "ready" | "error";
  problem: GalleryProblem | null;
  entries: GalleryEntry[];
  nextCursor: string | null;
  total: number | null;
  guests: GalleryGuest[];
  urlsValidSeconds: number;
  loadingMore: boolean;
}

const INITIAL: State = {
  status: "loading",
  problem: null,
  entries: [],
  nextCursor: null,
  total: null,
  guests: [],
  urlsValidSeconds: 3600,
  loadingMore: false,
};

const problemOf = (error: unknown): GalleryProblem =>
  error instanceof ApiError && error.code === "gallery_closed" ? "closed" : "unavailable";

/** Address renewals are asked in batches of at most this many media (the limit of the server). */
const RENEW_BATCH = 100;

/**
 * The album as the grid needs it: pages loaded one after the other (keyset cursor), reset when the
 * sort or a filter changes, and thumbnail addresses that can be renewed before they expire.
 * An answer that arrives after the filters changed again is dropped. `access` must stay the same
 * for the life of the component (the page mounts a new one for another album).
 */
export function useGallery(access: GalleryAccess, filters: GalleryFilters) {
  const { sort, order, kind, guestId } = filters;
  const [state, setState] = useState<State>(INITIAL);
  const [attempt, setAttempt] = useState(0);

  // The request changed (sort, filter, retry): start again from the first page. Adjusting state
  // while rendering is the React way to reset state from a prop, without an extra pass.
  const requestKey = [sort, order, kind, guestId, attempt].join("|");
  const [seenKey, setSeenKey] = useState(requestKey);
  if (seenKey !== requestKey) {
    setSeenKey(requestKey);
    setState(INITIAL);
  }

  const generation = useRef(0);
  const latest = useRef(state);
  const loadingMore = useRef(false);
  const renewing = useRef(new Set<string>());
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const fetchPage = useCallback(
    (cursor: string | undefined, current: number) =>
      galleryApi
        .gallery({
          action: "list",
          access,
          sort,
          order,
          kind: kind ?? undefined,
          guestId: guestId ?? undefined,
          cursor,
        })
        .then((answer) => {
          if (answer.action !== "list") throw new ApiError(200, "invalid_response");
          return generation.current === current ? answer : null;
        }),
    [access, sort, order, kind, guestId],
  );

  // First page, and again whenever the sort, a filter or the retry counter changes.
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    renewing.current.clear();
    loadingMore.current = false;
    fetchPage(undefined, current)
      .then((answer) => {
        if (!answer) return;
        const now = Date.now();
        setState({
          status: "ready",
          problem: null,
          entries: answer.items.map((item) => ({ ...item, urlAt: now })),
          nextCursor: answer.nextCursor,
          total: answer.total,
          guests: answer.guests,
          urlsValidSeconds: answer.urlsValidSeconds,
          loadingMore: false,
        });
      })
      .catch((error: unknown) => {
        if (generation.current !== current) return;
        setState({ ...INITIAL, status: "error", problem: problemOf(error) });
      });
    return () => {
      generation.current += 1;
    };
  }, [fetchPage, attempt]);

  const loadMore = useCallback(() => {
    const { status, nextCursor } = latest.current;
    if (status !== "ready" || !nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const current = generation.current;
    setState((previous) => ({ ...previous, loadingMore: true }));
    fetchPage(nextCursor, current)
      .then((answer) => {
        if (!answer) return;
        const now = Date.now();
        setState((previous) => {
          const known = new Set(previous.entries.map((entry) => entry.mediaId));
          const fresh = answer.items
            .filter((item) => !known.has(item.mediaId))
            .map((item) => ({ ...item, urlAt: now }));
          return {
            ...previous,
            entries: [...previous.entries, ...fresh],
            nextCursor: answer.nextCursor,
            urlsValidSeconds: answer.urlsValidSeconds,
            loadingMore: false,
          };
        });
      })
      .catch(() => {
        // The next scroll tries again: the page already shown stays usable.
        if (generation.current === current) {
          setState((previous) => ({ ...previous, loadingMore: false }));
        }
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [fetchPage]);

  /** Asks for fresh thumbnail addresses for these media, a batch at a time. */
  const renewThumbs = useCallback(
    (mediaIds: readonly string[]) => {
      const wanted = mediaIds.filter((id) => !renewing.current.has(id));
      if (wanted.length === 0) return;
      const current = generation.current;
      for (let start = 0; start < wanted.length; start += RENEW_BATCH) {
        const batch = wanted.slice(start, start + RENEW_BATCH);
        for (const id of batch) renewing.current.add(id);
        galleryApi
          .gallery({ action: "thumbs", access, mediaIds: batch })
          .then((answer) => {
            if (answer.action !== "thumbs" || generation.current !== current) return;
            const now = Date.now();
            const byId = new Map(answer.urls.map((entry) => [entry.mediaId, entry.thumbUrl]));
            setState((previous) => ({
              ...previous,
              urlsValidSeconds: answer.urlsValidSeconds,
              entries: previous.entries.map((entry) => {
                const url = byId.get(entry.mediaId);
                return url ? { ...entry, thumbUrl: url, urlAt: now } : entry;
              }),
            }));
          })
          .catch(() => undefined)
          .finally(() => {
            for (const id of batch) renewing.current.delete(id);
          });
      }
    },
    [access],
  );

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { ...state, loadMore, renewThumbs, retry };
}
