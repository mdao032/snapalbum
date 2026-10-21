import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_BYTES, MAX_THUMB_BYTES, PLANS } from "../plans";
import { mediaKey } from "../storage/keys";
import { multipartRequestSchema, reserveUploadRequestSchema } from "./upload";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const MEDIA = "a1b2c3d4-0000-4000-8000-123456789abc";

const photo = {
  eventCode: "k7m2x9qvbr",
  kind: "photo",
  sha256: "a".repeat(64),
  mimeType: "image/jpeg",
  extension: "jpg",
  bytes: 3_000_000,
  displayBytes: 400_000,
  thumbBytes: 20_000,
};

describe("SPEC 8.1: demande de réservation", () => {
  it("SPEC 8.1: accepte une photo avec sa version d'affichage et sa miniature (WebP par défaut)", () => {
    const parsed = reserveUploadRequestSchema.parse(photo);
    expect(parsed.previewFormat).toBe("webp");
  });

  it("SPEC 8.1: une vidéo n'a pas de version d'affichage", () => {
    const video = {
      ...photo,
      kind: "video",
      mimeType: "video/mp4",
      extension: "mp4",
      displayBytes: undefined,
    };
    expect(reserveUploadRequestSchema.safeParse(video).success).toBe(true);
    expect(reserveUploadRequestSchema.safeParse({ ...video, displayBytes: 1000 }).success).toBe(
      false,
    );
  });

  it("SPEC 8.1: une photo sans version d'affichage est refusée", () => {
    expect(
      reserveUploadRequestSchema.safeParse({ ...photo, displayBytes: undefined }).success,
    ).toBe(false);
  });

  it.each([
    ["extension inconnue", { extension: "exe" }],
    ["extension avec chemin", { extension: "jpg/../x" }],
    ["empreinte invalide", { sha256: "zz" }],
    ["code d'événement invalide", { eventCode: "abc" }],
    ["taille nulle", { bytes: 0 }],
    ["taille démesurée", { bytes: 6 * 1024 ** 3 }],
    ["miniature absente", { thumbBytes: undefined }],
    ["largeur démesurée", { width: 100_000 }],
    ["durée négative", { durationSeconds: -3 }],
    ["date mal formée", { takenAt: "hier" }],
    ["format d'aperçu inconnu", { previewFormat: "gif" }],
  ])("S-002: refuse : %s", (_label, change) => {
    expect(reserveUploadRequestSchema.safeParse({ ...photo, ...change }).success).toBe(false);
  });
});

describe("NF-013: envoi en morceaux (contrat)", () => {
  it("NF-013: cinq actions, chacune avec son identifiant de média", () => {
    for (const action of ["create", "status", "complete", "abort"]) {
      expect(multipartRequestSchema.safeParse({ action, mediaId: MEDIA }).success).toBe(true);
    }
    expect(
      multipartRequestSchema.safeParse({ action: "part", mediaId: MEDIA, partNumber: 3 }).success,
    ).toBe(true);
  });

  it("NF-013: refuse une action inconnue, un numéro de morceau hors limites, un identifiant invalide", () => {
    expect(multipartRequestSchema.safeParse({ action: "steal", mediaId: MEDIA }).success).toBe(
      false,
    );
    for (const partNumber of [0, 10_001, 1.5]) {
      expect(
        multipartRequestSchema.safeParse({ action: "part", mediaId: MEDIA, partNumber }).success,
      ).toBe(false);
    }
    expect(multipartRequestSchema.safeParse({ action: "create", mediaId: "../x" }).success).toBe(
      false,
    );
  });
});

describe("SPEC 3: limites de fichiers par offre", () => {
  it("SPEC 3: toutes les offres limitent la taille des photos, sans envoi en morceaux", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.maxPhotoBytes).toBe(50 * 1024 * 1024);
    }
  });

  it("SPEC 8.1: limites des versions préparées", () => {
    expect(MAX_DISPLAY_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_THUMB_BYTES).toBe(1024 * 1024);
  });
});

describe("SPEC 8.1: clés des versions préparées", () => {
  it("SPEC 8.1: l'affichage et la miniature acceptent WebP ou JPEG, jamais autre chose", () => {
    expect(mediaKey(EVENT, MEDIA, "display", "jpg")).toBe(`events/${EVENT}/display/${MEDIA}.jpg`);
    expect(mediaKey(EVENT, MEDIA, "thumb")).toBe(`events/${EVENT}/thumb/${MEDIA}.webp`);
    expect(() => mediaKey(EVENT, MEDIA, "display", "png")).toThrow();
    expect(() => mediaKey(EVENT, MEDIA, "thumb", "../x")).toThrow();
  });
});
