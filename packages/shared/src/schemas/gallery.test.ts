import { describe, expect, it } from "vitest";
import { GALLERY_MAX_FILES, galleryRequestSchema, shareTokenSchema } from "./gallery";
import { API_ERROR_CODES } from "./upload";

const ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const access = { type: "event" as const, eventCode: "k7m2x9qvbr" };

describe("F-039, F-052: requêtes de la galerie", () => {
  it("F-052: une liste prend le tri et la taille de page par défaut", () => {
    const parsed = galleryRequestSchema.parse({ action: "list", access });
    expect(parsed).toMatchObject({ action: "list", sort: "taken", order: "desc", limit: 60 });
  });

  it("F-052: accepte les filtres photo, vidéo et invité", () => {
    const parsed = galleryRequestSchema.parse({
      action: "list",
      access,
      kind: "video",
      guestId: ID,
      sort: "sent",
      order: "asc",
    });
    expect(parsed).toMatchObject({ kind: "video", guestId: ID, sort: "sent", order: "asc" });
  });

  it.each([
    ["un tri inconnu", { action: "list", access, sort: "random" }],
    ["une taille de page énorme", { action: "list", access, limit: 5000 }],
    ["un filtre invité qui n'est pas un identifiant", { action: "list", access, guestId: "x" }],
    ["un accès sans code ni jeton", { action: "list", access: { type: "event" } }],
    ["une action inconnue", { action: "delete", access }],
    ["une liste vide de fichiers", { action: "files", access, mediaIds: [] }],
    [
      "trop de fichiers d'un coup",
      { action: "files", access, mediaIds: Array(GALLERY_MAX_FILES + 1).fill(ID) },
    ],
  ])("NF-043: refuse %s", (_name, body) => {
    expect(galleryRequestSchema.safeParse(body).success).toBe(false);
  });

  it("F-054: le jeton d'un lien de partage a la forme attendue", () => {
    expect(shareTokenSchema.safeParse("a".repeat(32)).success).toBe(true);
    expect(shareTokenSchema.safeParse("court").success).toBe(false);
    expect(shareTokenSchema.safeParse("a/b".padEnd(40, "c")).success).toBe(false);
  });

  it("F-039: le code d'erreur de galerie fermée est connu des clients", () => {
    expect(API_ERROR_CODES).toContain("gallery_closed");
  });
});
