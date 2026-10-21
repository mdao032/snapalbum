import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api-client";
import type { SignedTarget } from "../schemas/upload";
import {
  classifyFailure,
  createUploadEngine,
  PrepareError,
  PutError,
  type PreparedMedia,
  type UploadIO,
} from "./engine";

interface FakeBlob {
  size: number;
  label: string;
}
interface FakeFile {
  name: string;
  size: number;
}

const MB = 1024 * 1024;
const blob = (size: number, label = "b"): FakeBlob => ({ size, label });
const target = (name: string): SignedTarget => ({
  url: `https://r2.test/${name}`,
  headers: {},
  expiresAt: "2026-10-21T10:15:00.000Z",
});
const MEDIA = "a1b2c3d4-0000-4000-8000-123456789abc";

const photo = (overrides: Partial<PreparedMedia<FakeBlob>> = {}): PreparedMedia<FakeBlob> => ({
  kind: "photo",
  sha256: "a".repeat(64),
  mimeType: "image/jpeg",
  extension: "jpg",
  bytes: 3000,
  displayBytes: 400,
  thumbBytes: 100,
  previewFormat: "webp",
  original: blob(3000, "original"),
  display: blob(400, "display"),
  thumb: blob(100, "thumb"),
  ...overrides,
});

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(
  options: {
    prepare?: (file: FakeFile) => Promise<PreparedMedia<FakeBlob>>;
    reserve?: () => Promise<unknown>;
    put?: (target: SignedTarget, body: FakeBlob) => Promise<void>;
    multipart?: (body: { action: string; partNumber?: number }) => Promise<unknown>;
    complete?: () => Promise<unknown>;
    maxConcurrent?: number;
  } = {},
) {
  let clock = 1_000_000;
  const scheduled: { run: () => void; at: number; cancelled: boolean }[] = [];
  const reserve = vi.fn(
    options.reserve ??
      (async () => ({
        status: "reserved",
        mediaId: MEDIA,
        original: null,
        multipart: null,
        display: target("display"),
        thumb: target("thumb"),
      })),
  );
  const complete = vi.fn(options.complete ?? (async () => ({ mediaId: MEDIA, status: "ready" })));
  const multipart = vi.fn(
    options.multipart ?? (async (body: { action: string }) => ({ action: body.action })),
  );
  const puts: { url: string; size: number }[] = [];
  const io: UploadIO<FakeFile, FakeBlob> = {
    prepare: vi.fn(options.prepare ?? (async () => photo())),
    put: vi.fn(async (t, body, onProgress) => {
      puts.push({ url: t.url, size: body.size });
      onProgress(body.size);
      await options.put?.(t, body);
    }),
    slice: (body, start, end) => blob(end - start, `${body.label}:${start}-${end}`),
  };
  const needJoin = vi.fn();
  const engine = createUploadEngine<FakeFile, FakeBlob>({
    api: { reserveUpload: reserve, completeUpload: complete, multipart } as never,
    io,
    eventCode: "k7m2x9qvbr",
    now: () => clock,
    schedule: (run, delay) => {
      const entry = { run, at: clock + delay, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    newId: (() => {
      let n = 0;
      return () => `local-${(n += 1)}`;
    })(),
    maxConcurrent: options.maxConcurrent,
    onNeedJoin: needJoin,
  });
  return {
    engine,
    reserve,
    complete,
    multipart,
    io,
    puts,
    needJoin,
    clock: () => clock,
    advance: (ms: number) => {
      clock += ms;
      for (const entry of scheduled.filter((e) => !e.cancelled && e.at <= clock)) {
        entry.cancelled = true;
        entry.run();
      }
    },
  };
}

const file = (name = "IMG_1.jpg", size = 3000): FakeFile => ({ name, size });

describe("SPEC 8.1: classement des échecs", () => {
  it.each([
    [new PrepareError("unsupported_format"), "reject", "unsupported_format"],
    [new PrepareError("corrupted"), "reject", "corrupted"],
    [new ApiError(409, "album_full"), "wait_quota", "album_full"],
    [new ApiError(409, "video_limit_reached"), "reject", "video_limit_reached"],
    [new ApiError(422, "video_too_long"), "reject", "video_too_long"],
    [new ApiError(413, "file_too_large"), "reject", "file_too_large"],
    [new ApiError(415, "unsupported_format"), "reject", "unsupported_format"],
    [new ApiError(422, "invalid_file"), "reject", "invalid_file"],
    [new ApiError(403, "upload_window_closed"), "reject", "upload_window_closed"],
    [new ApiError(403, "guest_blocked"), "reject", "guest_blocked"],
    [new ApiError(0, "network_error"), "retry", "network_error"],
    [new ApiError(429, "rate_limited"), "retry", "rate_limited"],
    [new ApiError(409, "upload_incomplete"), "retry", "upload_incomplete"],
    [new ApiError(500, "internal_error"), "retry", "internal_error"],
    [new ApiError(200, "invalid_response"), "retry", "upload_failed"],
    [new PutError(403), "retry", "upload_failed"],
    [new PutError(500), "retry", "upload_failed"],
    [new TypeError("Failed to fetch"), "retry", "network_error"],
  ])("NF-010: %s → %s", (error, action, reason) => {
    expect(classifyFailure(error)).toMatchObject({ action, reason });
  });

  it.each([
    new ApiError(401, "unauthorized"),
    new ApiError(403, "forbidden"),
    new ApiError(403, "terms_required"),
  ])("F-035: %s demande de rejoindre l'événement d'abord", (error) => {
    expect(classifyFailure(error)).toEqual({ action: "join" });
  });
});

describe("SPEC 8.1: envoi d'une photo", () => {
  it("prépare, réserve, envoie l'affichage puis la miniature, confirme, et le fichier est envoyé", async () => {
    const { engine, reserve, complete, puts } = setup();
    engine.add([file()]);
    await flush();

    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: "k7m2x9qvbr",
        kind: "photo",
        bytes: 3000,
        displayBytes: 400,
        thumbBytes: 100,
      }),
    );
    expect(puts.map((p) => p.url)).toEqual(["https://r2.test/display", "https://r2.test/thumb"]);
    expect(complete).toHaveBeenCalledWith({ mediaId: MEDIA });
    expect(engine.getItems()[0]).toMatchObject({
      status: "sent",
      progress: 1,
      name: "IMG_1.jpg",
      mediaId: MEDIA,
    });
    expect(engine.getSummary()).toMatchObject({ total: 1, sent: 1, pending: 0 });
  });

  it("R2: une photo d'une offre payante envoie aussi son original", async () => {
    const { engine, puts } = setup({
      reserve: async () => ({
        status: "reserved",
        mediaId: MEDIA,
        multipart: null,
        original: target("original"),
        display: target("display"),
        thumb: target("thumb"),
      }),
    });
    engine.add([file()]);
    await flush();
    expect(puts.map((p) => p.url)).toEqual([
      "https://r2.test/display",
      "https://r2.test/thumb",
      "https://r2.test/original",
    ]);
  });

  it("NF-012: un fichier déjà reçu est marqué envoyé sans rien envoyer", async () => {
    const { engine, puts, complete } = setup({
      reserve: async () => ({ status: "already_received", mediaId: MEDIA }),
    });
    engine.add([file()]);
    await flush();
    expect(engine.getItems()[0]?.status).toBe("sent");
    expect(puts).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it("F-036: la progression suit les octets envoyés et ne dépasse pas 99 % avant la confirmation", async () => {
    const progress: number[] = [];
    const { engine } = setup({
      put: async () => {
        progress.push(engine.getItems()[0]?.progress ?? -1);
      },
    });
    engine.add([file()]);
    await flush();
    expect(progress.every((p) => p >= 0 && p <= 0.99)).toBe(true);
    expect(engine.getItems()[0]?.progress).toBe(1);
  });

  it("NF-010: tout le circuit est refait après un échec réseau, et le fichier arrive", async () => {
    let first = true;
    const { engine, advance, reserve } = setup({
      put: async () => {
        if (first) {
          first = false;
          throw new TypeError("network down");
        }
      },
    });
    engine.add([file()]);
    await flush();
    expect(engine.getItems()[0]).toMatchObject({
      status: "failed",
      reason: "network_error",
      attempts: 1,
    });

    advance(1000);
    await flush();
    expect(engine.getItems()[0]?.status).toBe("sent");
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it("NF-011: le délai de reprise double à chaque échec (1 s, 2 s, 4 s)", async () => {
    const { engine, advance, clock } = setup({
      put: async () => {
        throw new PutError(500);
      },
    });
    engine.add([file()]);
    await flush();
    const delay = () => (engine.getItems()[0]?.retryAt ?? 0) - clock();
    expect(delay()).toBe(1000);
    advance(1000);
    await flush();
    expect(delay()).toBe(2000);
    advance(2000);
    await flush();
    expect(delay()).toBe(4000);
  });

  it("NF-011: un fichier en échec n'est pas relancé avant l'heure prévue", async () => {
    const { engine, advance, reserve } = setup({
      put: async () => {
        throw new PutError(500);
      },
    });
    engine.add([file()]);
    await flush();
    advance(900);
    await flush();
    expect(reserve).toHaveBeenCalledTimes(1);
    advance(100);
    await flush();
    expect(reserve).toHaveBeenCalledTimes(2);
  });
});

describe("NF-003: trois envois simultanés au plus", () => {
  it("NF-003: n'envoie jamais plus de trois fichiers à la fois, et finit par tous les envoyer", async () => {
    let running = 0;
    let peak = 0;
    const { engine } = setup({
      put: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      },
    });
    engine.add(Array.from({ length: 8 }, (_, i) => file(`IMG_${i}.jpg`)));
    for (let i = 0; i < 30; i += 1) await flush();
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(engine.getSummary()).toMatchObject({ total: 8, sent: 8, pending: 0 });
  }, 30_000);

  it("NF-003: 50 photos ajoutées d'un coup ne bloquent pas : tout part dans l'ordre d'ajout", async () => {
    const order: string[] = [];
    const { engine } = setup({
      prepare: async (f) => {
        order.push(f.name);
        return photo({ sha256: f.name.padEnd(64, "0") });
      },
    });
    engine.add(Array.from({ length: 50 }, (_, i) => file(`P${String(i).padStart(2, "0")}.jpg`)));
    for (let i = 0; i < 60; i += 1) await flush();
    expect(engine.getSummary().sent).toBe(50);
    expect(order.slice(0, 3)).toEqual(["P00.jpg", "P01.jpg", "P02.jpg"]);
  }, 60_000);
});

describe("SPEC 8.3: refus et attentes", () => {
  it("SPEC 8.3: un fichier corrompu ou d'un format non pris en charge est refusé, les autres continuent", async () => {
    const { engine } = setup({
      prepare: async (f) => {
        if (f.name === "bad.heic") throw new PrepareError("unsupported_format");
        return photo({ sha256: f.name.padEnd(64, "0") });
      },
    });
    engine.add([file("bad.heic"), file("ok.jpg")]);
    await flush();
    const byName = Object.fromEntries(engine.getItems().map((i) => [i.name, i]));
    expect(byName["bad.heic"]).toMatchObject({ status: "rejected", reason: "unsupported_format" });
    expect(byName["ok.jpg"]?.status).toBe("sent");
    expect(engine.getSummary()).toMatchObject({ sent: 1, rejected: 1 });
  });

  it("R1: album plein : le fichier reste sur l'appareil en attente de place, sans réessai automatique", async () => {
    const { engine, advance, reserve } = setup({
      reserve: async () => {
        throw new ApiError(409, "album_full");
      },
    });
    engine.add([file()]);
    await flush();
    expect(engine.getItems()[0]).toMatchObject({ status: "waiting_quota", reason: "album_full" });
    advance(10 * 60_000);
    await flush();
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(engine.getSummary().waitingQuota).toBe(1);
  });

  it("R1: quand l'organisateur passe en payant, retryNow renvoie les fichiers en attente", async () => {
    let full = true;
    const { engine } = setup({
      reserve: async () => {
        if (full) throw new ApiError(409, "album_full");
        return { status: "already_received", mediaId: MEDIA };
      },
    });
    engine.add([file()]);
    await flush();
    full = false;
    engine.retryNow();
    await flush();
    expect(engine.getItems()[0]?.status).toBe("sent");
  });

  it("R1: la limite de vidéos refuse cette vidéo pour de bon, sans bloquer les photos", async () => {
    const { engine } = setup({
      prepare: async (f) =>
        f.name.endsWith(".mp4")
          ? photo({
              kind: "video",
              mimeType: "video/mp4",
              extension: "mp4",
              display: undefined,
              displayBytes: undefined,
              sha256: "b".repeat(64),
            })
          : photo(),
      reserve: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, "video_limit_reached"))
        .mockResolvedValue({ status: "already_received", mediaId: MEDIA }),
    });
    engine.add([file("clip.mp4"), file("photo.jpg")]);
    await flush();
    const byName = Object.fromEntries(engine.getItems().map((i) => [i.name, i]));
    expect(byName["clip.mp4"]).toMatchObject({ status: "rejected", reason: "video_limit_reached" });
    expect(byName["photo.jpg"]?.status).toBe("sent");
  });

  it("S-002: un fichier jugé invalide par le serveur est refusé définitivement", async () => {
    const { engine } = setup({
      complete: async () => {
        throw new ApiError(422, "invalid_file");
      },
    });
    engine.add([file()]);
    await flush();
    expect(engine.getItems()[0]).toMatchObject({ status: "rejected", reason: "invalid_file" });
  });

  it("NF-010: un envoi « pas terminé » côté serveur est repris, jamais abandonné", async () => {
    const { engine } = setup({
      complete: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, "upload_incomplete"))
        .mockResolvedValue({ mediaId: MEDIA, status: "ready" }),
    });
    engine.add([file()]);
    await flush();
    expect(engine.getItems()[0]).toMatchObject({ status: "failed", reason: "upload_incomplete" });
  });
});

describe("F-035: rejoindre l'événement avant d'envoyer", () => {
  it("quand la session manque, l'envoi se met en pause et prévient une seule fois, puis reprend après l'adhésion", async () => {
    let joined = false;
    const { engine, needJoin, reserve } = setup({
      reserve: async () => {
        if (!joined) throw new ApiError(401, "unauthorized");
        return { status: "already_received", mediaId: MEDIA };
      },
    });
    engine.add([file("a.jpg"), file("b.jpg")]);
    await flush();
    expect(needJoin).toHaveBeenCalled();
    expect(engine.getItems().every((i) => i.status === "queued")).toBe(true);
    const callsBefore = reserve.mock.calls.length;

    // Paused: adding more files does not send anything.
    engine.add([file("c.jpg")]);
    await flush();
    expect(reserve.mock.calls.length).toBe(callsBefore);

    joined = true;
    engine.resumeAfterJoin();
    await flush();
    expect(engine.getSummary()).toMatchObject({ total: 3, sent: 3 });
  });
});

describe("NF-013: vidéo en morceaux", () => {
  const video = (bytes: number) =>
    photo({
      kind: "video",
      mimeType: "video/mp4",
      extension: "mp4",
      bytes,
      displayBytes: undefined,
      display: undefined,
      original: blob(bytes, "video"),
    });
  const reservedMultipart = (partCount: number) => ({
    status: "reserved",
    mediaId: MEDIA,
    original: null,
    display: null,
    multipart: { partSize: 10 * MB, partCount },
    thumb: target("thumb"),
  });
  const partAnswer = (n: number) => ({
    action: "part",
    partNumber: n,
    target: target(`part-${n}`),
  });

  it("envoie la miniature, crée l'envoi, envoie chaque morceau à sa taille, assemble, puis confirme", async () => {
    const calls: string[] = [];
    const { engine, puts, complete } = setup({
      prepare: async () => video(25 * MB),
      reserve: async () => reservedMultipart(3),
      multipart: async (body) => {
        calls.push(`${body.action}${body.partNumber ?? ""}`);
        if (body.action === "status") return { action: "status", parts: [] };
        if (body.action === "part") return partAnswer(body.partNumber ?? 0);
        return { action: body.action };
      },
    });
    engine.add([file("clip.mp4", 25 * MB)]);
    await flush();

    expect(calls).toEqual(["create", "status", "part1", "part2", "part3", "complete"]);
    expect(puts.map((p) => [p.url.split("/").pop(), p.size])).toEqual([
      ["thumb", 100],
      ["part-1", 10 * MB],
      ["part-2", 10 * MB],
      ["part-3", 5 * MB],
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(engine.getItems()[0]?.status).toBe("sent");
  });

  it("NF-013: après une coupure, les morceaux déjà reçus par le serveur ne sont pas renvoyés", async () => {
    const calls: string[] = [];
    const { engine, puts } = setup({
      prepare: async () => video(25 * MB),
      reserve: async () => reservedMultipart(3),
      multipart: async (body) => {
        calls.push(`${body.action}${body.partNumber ?? ""}`);
        if (body.action === "status") {
          return {
            action: "status",
            parts: [
              { partNumber: 1, size: 10 * MB },
              { partNumber: 2, size: 10 * MB },
            ],
          };
        }
        if (body.action === "part") return partAnswer(body.partNumber ?? 0);
        return { action: body.action };
      },
    });
    engine.add([file("clip.mp4", 25 * MB)]);
    await flush();
    expect(calls).toEqual(["create", "status", "part3", "complete"]);
    expect(puts.filter((p) => p.url.includes("part-")).map((p) => p.url.split("/").pop())).toEqual([
      "part-3",
    ]);
  });

  it("NF-013: un morceau reçu à la mauvaise taille est renvoyé", async () => {
    const calls: string[] = [];
    const { engine } = setup({
      prepare: async () => video(25 * MB),
      reserve: async () => reservedMultipart(3),
      multipart: async (body) => {
        calls.push(`${body.action}${body.partNumber ?? ""}`);
        if (body.action === "status")
          return { action: "status", parts: [{ partNumber: 1, size: 3 * MB }] };
        if (body.action === "part") return partAnswer(body.partNumber ?? 0);
        return { action: body.action };
      },
    });
    engine.add([file("clip.mp4", 25 * MB)]);
    await flush();
    expect(calls).toContain("part1");
  });
});

describe("F-036, F-037: suivi de la file", () => {
  it("prévient les abonnés à chaque changement, et on peut se désabonner", async () => {
    const { engine } = setup();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.add([file()]);
    await flush();
    expect(listener.mock.calls.length).toBeGreaterThan(2);
    const count = listener.mock.calls.length;
    unsubscribe();
    engine.add([file("b.jpg")]);
    await flush();
    expect(listener.mock.calls.length).toBe(count);
  });

  it("la liste change d'identité à chaque changement (comparable par référence)", async () => {
    const { engine } = setup();
    const before = engine.getItems();
    engine.add([file()]);
    expect(engine.getItems()).not.toBe(before);
  });

  it("F-037: le résumé compte ce qui attend, ce qui est envoyé et ce qui est refusé", async () => {
    const { engine } = setup({
      prepare: async (f) => {
        if (f.name === "bad") throw new PrepareError("corrupted");
        return photo({ sha256: f.name.padEnd(64, "0") });
      },
    });
    engine.add([file("bad"), file("a"), file("b")]);
    await flush();
    expect(engine.getSummary()).toEqual({
      total: 3,
      sent: 2,
      pending: 0,
      failed: 0,
      rejected: 1,
      waitingQuota: 0,
    });
  });
});
