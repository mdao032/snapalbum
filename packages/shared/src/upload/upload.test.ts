import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./backoff";
import { formatMediaFileName, slugifyGuestName } from "./filename";
import {
  createQueueItem,
  markFailed,
  markSent,
  markUploading,
  markWaitingQuota,
  pickNextItems,
  resetForRetry,
  summarizeQueue,
} from "./queue";
import { checkQuota, quotaUsage } from "./quota";

describe("NF-011: délai exponentiel", () => {
  it("NF-011: double le délai à chaque tentative puis plafonne à 60 s", () => {
    expect([0, 1, 2, 3].map(backoffDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelayMs(6)).toBe(60_000);
    expect(backoffDelayMs(500)).toBe(60_000);
  });

  it("NF-011: ignore les tentatives négatives", () => {
    expect(backoffDelayMs(-3)).toBe(1000);
  });
});

describe("NF-003: file d'attente d'envoi", () => {
  it("NF-003: ne démarre jamais plus de 3 envois simultanés", () => {
    const items = Array.from({ length: 10 }, (_, i) => createQueueItem(`m${i}`, i));
    expect(pickNextItems(items, 100)).toHaveLength(3);
  });

  it("NF-003: tient compte des envois déjà en cours", () => {
    const items = [
      markUploading(createQueueItem("a", 1)),
      markUploading(createQueueItem("b", 2)),
      createQueueItem("c", 3),
      createQueueItem("d", 4),
    ];
    expect(pickNextItems(items, 100).map((i) => i.id)).toEqual(["c"]);
  });

  it("NF-011: attend la fin du délai avant de réessayer un envoi échoué", () => {
    const failed = markFailed(createQueueItem("a", 0), 10_000);
    expect(failed.attempts).toBe(1);
    expect(pickNextItems([failed], 10_500)).toHaveLength(0);
    expect(pickNextItems([failed], 11_000)).toHaveLength(1);
  });

  it("NF-011: reprend immédiatement après retour du réseau", () => {
    const failed = markFailed(createQueueItem("a", 0), 10_000);
    expect(pickNextItems([resetForRetry(failed)], 10_001)).toHaveLength(1);
  });

  it("R1: conserve les fichiers quand l'album est plein, puis les relance", () => {
    const waiting = markWaitingQuota(createQueueItem("a", 0));
    expect(pickNextItems([waiting], 100)).toHaveLength(0);
    expect(resetForRetry(waiting).status).toBe("queued");
  });

  it("NF-010: un fichier envoyé ne revient jamais dans la file", () => {
    const sent = markSent(createQueueItem("a", 0));
    expect(resetForRetry(sent).status).toBe("sent");
    expect(pickNextItems([sent], 100)).toHaveLength(0);
  });

  it("F-036: résume l'état global de la file", () => {
    const items = [
      markSent(createQueueItem("a", 0)),
      createQueueItem("b", 1),
      markFailed(createQueueItem("c", 2), 0),
      markWaitingQuota(createQueueItem("d", 3)),
    ];
    expect(summarizeQueue(items)).toEqual({
      total: 4,
      sent: 1,
      pending: 1,
      failed: 1,
      rejected: 0,
      waitingQuota: 1,
    });
  });
});

describe("R1: quotas", () => {
  it("R1: refuse un envoi quand l'album gratuit est plein", () => {
    expect(
      checkQuota({ plan: "free", mediaCount: 200, videoCount: 0, kind: "photo", bytes: 1 }),
    ).toEqual({ ok: false, reason: "album_full" });
  });

  it("R1: accepte la dernière place disponible", () => {
    expect(
      checkQuota({ plan: "free", mediaCount: 199, videoCount: 0, kind: "photo", bytes: 1 }).ok,
    ).toBe(true);
  });

  it("R2: relève le quota après passage à l'offre Événement", () => {
    expect(
      checkQuota({ plan: "event", mediaCount: 200, videoCount: 0, kind: "photo", bytes: 1 }).ok,
    ).toBe(true);
  });

  it("refuse une vidéo trop longue, trop lourde ou au-delà du nombre autorisé", () => {
    const base = { plan: "free", mediaCount: 0, videoCount: 0, kind: "video", bytes: 1 } as const;
    expect(checkQuota({ ...base, durationSeconds: 31 })).toEqual({
      ok: false,
      reason: "video_too_long",
    });
    expect(checkQuota({ ...base, videoCount: 10 })).toEqual({
      ok: false,
      reason: "video_limit_reached",
    });
    expect(checkQuota({ ...base, bytes: 101 * 1024 * 1024 })).toEqual({
      ok: false,
      reason: "file_too_large",
    });
    expect(checkQuota({ ...base, durationSeconds: 30 }).ok).toBe(true);
  });

  it("calcule la part de quota utilisée entre 0 et 1", () => {
    expect(quotaUsage("free", 100)).toBe(0.5);
    expect(quotaUsage("free", 999)).toBe(1);
    expect(quotaUsage("free", -5)).toBe(0);
  });
});

describe("F-083: noms de fichiers lisibles", () => {
  it("F-083: formate AAAA-MM-JJ_HHMMSS_prenom_n.ext", () => {
    expect(
      formatMediaFileName({
        takenAt: new Date("2026-06-20T14:05:09Z"),
        guestName: "Élodie D.",
        index: 12,
        extension: ".JPG",
      }),
    ).toBe("2026-06-20_140509_elodie-d_12.jpg");
  });

  it("F-083: utilise le fuseau horaire demandé", () => {
    expect(
      formatMediaFileName({
        takenAt: new Date("2026-06-20T22:30:00Z"),
        guestName: null,
        index: 1,
        extension: "webp",
        timeZone: "Europe/Paris",
      }),
    ).toBe("2026-06-21_003000_invite_1.webp");
  });

  it("F-083: remplace un prénom vide ou illisible par « invite »", () => {
    expect(slugifyGuestName("   ")).toBe("invite");
    expect(slugifyGuestName("***")).toBe("invite");
    expect(slugifyGuestName(null)).toBe("invite");
  });
});
