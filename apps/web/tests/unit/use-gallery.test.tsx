import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryFilters } from "@/lib/gallery/use-gallery";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const access = { type: "event" as const, eventCode: "k7m2x9qvbr" };
const filters = (change: Partial<GalleryFilters> = {}): GalleryFilters => ({
  sort: "taken",
  order: "desc",
  kind: null,
  guestId: null,
  ...change,
});

const item = (n: number) => ({
  mediaId: id(n),
  kind: "photo" as const,
  width: 1200,
  height: 800,
  durationS: null,
  blurhash: null,
  thumbUrl: `https://signed.test/thumb-${n}?v=1`,
  takenAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
});

const page = (numbers: number[], extra: Record<string, unknown> = {}) => ({
  action: "list",
  items: numbers.map(item),
  nextCursor: null,
  total: numbers.length,
  urlsValidSeconds: 3600,
  guests: [],
  ...extra,
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Body = { action: string; cursor?: string; kind?: string; mediaIds?: string[] };
let handler: (body: Body) => Promise<Response> | Response;
const requests: Body[] = [];

async function loadHook() {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      requests.push(body);
      return handler(body);
    }),
  );
  return (await import("@/lib/gallery/use-gallery")).useGallery;
}

beforeEach(() => {
  requests.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F-050: chargement de la galerie", () => {
  it("F-050: charge la première page avec le total, les invités et l'instant des adresses", async () => {
    handler = () =>
      reply(
        page([1, 2], {
          total: 2,
          guests: [{ id: id(90), name: "Anna", count: 2 }],
          nextCursor: "suite",
        }),
      );
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entries.map((entry) => entry.mediaId)).toEqual([id(1), id(2)]);
    expect(result.current.entries[0]!.urlAt).toBeGreaterThan(0);
    expect(result.current.total).toBe(2);
    expect(result.current.guests).toEqual([{ id: id(90), name: "Anna", count: 2 }]);
    expect(result.current.nextCursor).toBe("suite");
    expect(requests[0]).toMatchObject({ action: "list" });
  });

  it("F-050: la page suivante s'ajoute sans doublon, et une page déjà demandée n'est pas redemandée en parallèle", async () => {
    handler = (body) =>
      reply(body.cursor ? page([2, 3], { total: null }) : page([1, 2], { nextCursor: "suite" }));
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(result.current.entries.map((entry) => entry.mediaId)).toEqual([id(1), id(2), id(3)]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.loadingMore).toBe(false);
    expect(requests.filter((request) => request.cursor === "suite")).toHaveLength(1);

    // Nothing left: asking again does nothing.
    act(() => result.current.loadMore());
    expect(requests).toHaveLength(2);
  });

  it("F-050: une page qui échoue en route garde l'album affiché et permet de réessayer plus bas", async () => {
    let fail = true;
    handler = (body) => {
      if (!body.cursor) return reply(page([1], { nextCursor: "suite" }));
      return fail ? reply({ error: { code: "internal_error" } }, 500) : reply(page([2]));
    };
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.status).toBe("ready");
    expect(result.current.entries).toHaveLength(1);

    fail = false;
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
  });

  it("F-052: changer un filtre repart de la première page et ignore une réponse arrivée trop tard", async () => {
    let releaseOld: (response: Response) => void = () => undefined;
    handler = (body) =>
      body.kind === "video"
        ? reply(page([9]))
        : new Promise<Response>((resolve) => {
            releaseOld = resolve;
          });
    const useGallery = await loadHook();
    const { result, rerender } = renderHook(
      ({ current }: { current: GalleryFilters }) => useGallery(access, current),
      { initialProps: { current: filters() } },
    );

    rerender({ current: filters({ kind: "video" }) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entries.map((entry) => entry.mediaId)).toEqual([id(9)]);

    // The answer for the first request finally arrives: it must not replace the new list.
    await act(async () => {
      releaseOld(reply(page([1, 2, 3])));
      await Promise.resolve();
    });
    expect(result.current.entries.map((entry) => entry.mediaId)).toEqual([id(9)]);
  });

  it("F-039: une galerie fermée est signalée comme telle, toute autre panne comme indisponible, et on peut réessayer", async () => {
    handler = () => reply({ error: { code: "gallery_closed" } }, 403);
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.problem).toBe("closed");

    handler = () => reply({ error: { code: "internal_error" } }, 500);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.problem).toBe("unavailable"));

    handler = () => reply(page([1]));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.problem).toBeNull();
  });

  it("F-050: une réponse d'un autre type que la liste est une erreur, pas un album vide", async () => {
    handler = () => reply({ action: "thumbs", urls: [], urlsValidSeconds: 3600 });
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

describe("SPEC 9.1: renouvellement des miniatures", () => {
  it("SPEC 9.1: remplace l'adresse et l'instant des miniatures demandées, sans redemander celles en cours", async () => {
    let release: (response: Response) => void = () => undefined;
    handler = (body) =>
      body.action === "thumbs"
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : reply(page([1, 2]));
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = result.current.entries[0]!;

    act(() => {
      result.current.renewThumbs([id(1)]);
      result.current.renewThumbs([id(1)]);
    });
    // The request leaves a tick later (the client reads its token first).
    await waitFor(() =>
      expect(requests.filter((request) => request.action === "thumbs")).toHaveLength(1),
    );

    await act(async () => {
      release(
        reply({
          action: "thumbs",
          urls: [{ mediaId: id(1), thumbUrl: "https://signed.test/thumb-1?v=2" }],
          urlsValidSeconds: 3600,
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.entries[0]!.thumbUrl).toContain("v=2"));
    expect(result.current.entries[0]!.urlAt).toBeGreaterThanOrEqual(before.urlAt);
    // The other thumbnail keeps its address.
    expect(result.current.entries[1]!.thumbUrl).toContain("v=1");
  });

  it("SPEC 9.1: demande les adresses par paquets de 100 au plus, et une panne n'abîme rien", async () => {
    handler = (body) =>
      body.action === "thumbs"
        ? reply({ error: { code: "internal_error" } }, 500)
        : reply(page([1]));
    const useGallery = await loadHook();
    const { result } = renderHook(() => useGallery(access, filters()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const many = Array.from({ length: 230 }, (_, n) => id(n + 1));
    act(() => result.current.renewThumbs(many));
    await waitFor(() =>
      expect(requests.filter((request) => request.action === "thumbs")).toHaveLength(3),
    );
    const sizes = requests
      .filter((request) => request.action === "thumbs")
      .map((request) => request.mediaIds?.length);
    expect(sizes).toEqual([100, 100, 30]);
    expect(result.current.status).toBe("ready");
    expect(result.current.entries[0]!.thumbUrl).toContain("v=1");
  });
});
