import { describe, expect, it } from "vitest";
import { PLANS } from "../plans";
import { checkFileLimits } from "./quota";

describe("SPEC 8.2: limites d'un fichier selon l'offre (lues dans plans.ts)", () => {
  it("SPEC 8.2: une vidéo de 30 s passe sur l'offre gratuite, pas 31 s", () => {
    const max = PLANS.free.maxVideoSeconds;
    expect(
      checkFileLimits({ plan: "free", kind: "video", bytes: 1, durationSeconds: max }),
    ).toEqual({ ok: true });
    expect(
      checkFileLimits({ plan: "free", kind: "video", bytes: 1, durationSeconds: max + 1 }),
    ).toEqual({ ok: false, reason: "video_too_long" });
  });

  it("SPEC 8.2: les offres payantes autorisent 180 s", () => {
    for (const plan of ["event", "pro"] as const) {
      expect(checkFileLimits({ plan, kind: "video", bytes: 1, durationSeconds: 180 }).ok).toBe(
        true,
      );
      expect(checkFileLimits({ plan, kind: "video", bytes: 1, durationSeconds: 181 }).ok).toBe(
        false,
      );
    }
  });

  it("SPEC 8.2: une durée inconnue n'est pas un motif de refus côté navigateur (le serveur la demande)", () => {
    expect(checkFileLimits({ plan: "free", kind: "video", bytes: 1 }).ok).toBe(true);
    expect(
      checkFileLimits({ plan: "free", kind: "video", bytes: 1, durationSeconds: null }).ok,
    ).toBe(true);
  });

  it("R1: la taille maximale d'une vidéo et d'une photo vient du plan", () => {
    expect(
      checkFileLimits({ plan: "free", kind: "video", bytes: PLANS.free.maxVideoBytes + 1 }),
    ).toEqual({ ok: false, reason: "file_too_large" });
    expect(
      checkFileLimits({ plan: "free", kind: "photo", bytes: PLANS.free.maxPhotoBytes + 1 }),
    ).toEqual({ ok: false, reason: "file_too_large" });
    expect(
      checkFileLimits({ plan: "free", kind: "photo", bytes: PLANS.free.maxPhotoBytes }).ok,
    ).toBe(true);
  });

  it("SPEC 8.2: la durée d'une photo n'est jamais contrôlée", () => {
    expect(
      checkFileLimits({ plan: "free", kind: "photo", bytes: 1, durationSeconds: 9999 }).ok,
    ).toBe(true);
  });
});
