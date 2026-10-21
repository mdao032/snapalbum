// @vitest-environment node
import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganiser = vi.fn();
vi.mock("@/server/auth", () => ({ getOrganiser }));

const getOwnEvent = vi.fn();
const getPublicEvent = vi.fn();
vi.mock("@/server/events", () => ({ getOwnEvent, getPublicEvent }));

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { GET: qrRoute } = await import("@/app/api/events/[id]/qr/route");
const { GET: cardRoute } = await import("@/app/api/events/[id]/card/route");
const { GET: shortLinkRoute } = await import("@/app/s/[code]/route");

const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const CODE = "k7m2x9qvbr";
const event = {
  id: EVENT_ID,
  public_code: CODE,
  title: "Mariage de Léa et Tom",
  locale: "fr",
  accent_color: "#be185d",
};

const context = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const call = (
  route: (request: Request, context: never) => Promise<Response>,
  id: string,
  query = "",
) => route(new Request(`https://app.example.test/api/events/${id}/x${query}`), context(id));

beforeEach(() => {
  vi.clearAllMocks();
  getOrganiser.mockResolvedValue({ id: "user-1" });
  getOwnEvent.mockResolvedValue(event);
});

describe("F-013: route du QR code", () => {
  it("F-013: renvoie un SVG par défaut, sans téléchargement forcé", async () => {
    const response = await call(qrRoute, EVENT_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.text()).toContain("<svg");
  });

  it("F-013: le PNG se décode en lien court construit depuis NEXT_PUBLIC_SHORT_LINK_BASE", async () => {
    const response = await call(qrRoute, EVENT_ID, "?format=png&download=1");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="qr-${CODE}.png"`,
    );
    const image = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    expect(image.width).toBe(1024);
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    // The test environment sets NEXT_PUBLIC_SHORT_LINK_BASE to http://localhost:3000.
    expect(decoded?.data).toBe(`http://localhost:3000/${CODE}`);
  });

  it("F-013: la couleur de l'événement est utilisée à la demande", async () => {
    const svg = await (await call(qrRoute, EVENT_ID, "?color=accent")).text();
    expect(svg).toContain("#be185d");
  });

  it("F-013: ignore les paramètres invalides plutôt que d'échouer", async () => {
    const response = await call(qrRoute, EVENT_ID, "?format=gif&color=rouge");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("S-001: refuse un visiteur sans session organisateur (401)", async () => {
    getOrganiser.mockResolvedValue(null);
    const response = await call(qrRoute, EVENT_ID);
    expect(response.status).toBe(401);
    expect(getOwnEvent).not.toHaveBeenCalled();
  });

  it("S-001: un événement qui n'est pas le sien ou inconnu donne 404", async () => {
    getOwnEvent.mockResolvedValue(null);
    expect((await call(qrRoute, EVENT_ID)).status).toBe(404);
  });

  it("F-013: un identifiant mal formé donne 404 sans interroger la base", async () => {
    expect((await call(qrRoute, "pas-un-uuid")).status).toBe(404);
    expect(getOwnEvent).not.toHaveBeenCalled();
  });
});

describe("F-014: route des cartes PDF", () => {
  it.each(["a6", "a5", "tent"])("F-014: renvoie un PDF pour le format %s", async (format) => {
    const response = await call(cardRoute, EVENT_ID, `?format=${format}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${format}-${CODE}.pdf"`,
    );
    const doc = await PDFDocument.load(await response.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
  });

  it("F-014: refuse un format absent ou inconnu (400)", async () => {
    expect((await call(cardRoute, EVENT_ID)).status).toBe(400);
    expect((await call(cardRoute, EVENT_ID, "?format=a3")).status).toBe(400);
  });

  it("S-001: exige d'être l'organisateur de l'événement", async () => {
    getOrganiser.mockResolvedValue(null);
    expect((await call(cardRoute, EVENT_ID, "?format=a6")).status).toBe(401);
    getOrganiser.mockResolvedValue({ id: "user-2" });
    getOwnEvent.mockResolvedValue(null);
    expect((await call(cardRoute, EVENT_ID, "?format=a6")).status).toBe(404);
  });
});

describe("F-012: lien court", () => {
  const scan = (code: string) =>
    shortLinkRoute(new NextRequest(`https://app.example.test/s/${code}`), {
      params: Promise.resolve({ code }),
    } as never);
  const target = (response: Response) =>
    new URL(response.headers.get("location") ?? "", "https://app.example.test").pathname;

  it("F-012: envoie vers la page de l'événement, sans préfixe pour un événement français", async () => {
    getPublicEvent.mockResolvedValue({ locale: "fr" });
    const response = await scan(CODE);
    expect(response.status).toBe(307);
    expect(target(response)).toBe(`/e/${CODE}`);
  });

  it("F-012: envoie vers la version anglaise pour un événement anglais", async () => {
    getPublicEvent.mockResolvedValue({ locale: "en" });
    expect(target(await scan(CODE))).toBe(`/en/e/${CODE}`);
  });

  it("F-042: ne redirige jamais ailleurs que sur le site (pas de store, pas d'autre domaine)", async () => {
    getPublicEvent.mockResolvedValue({ locale: "en" });
    const response = await scan(CODE);
    expect(new URL(response.headers.get("location") ?? "").origin).toBe("https://app.example.test");
  });

  it("F-012: un code inconnu va quand même à la page de l'événement, qui répondra 404", async () => {
    getPublicEvent.mockResolvedValue(null);
    expect(target(await scan(CODE))).toBe(`/e/${CODE}`);
  });

  it("F-012: un incident de base de données ne casse pas un QR code imprimé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPublicEvent.mockRejectedValue(new Error("db down"));
    expect(target(await scan(CODE))).toBe(`/e/${CODE}`);
  });

  it("F-012: un code mal formé renvoie vers l'accueil", async () => {
    const response = await scan("abc");
    expect(target(response)).toBe("/");
    expect(getPublicEvent).not.toHaveBeenCalled();
  });
});
