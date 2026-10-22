import { describe, expect, it } from "vitest";
import { PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH, publicCodeSchema } from "../schemas/common";
import { generatePublicCode } from "./code";
import { contrastRatio, isAccentReadable, makeAccentReadable, parseHexColor } from "./color";
import { computeExpiresAt } from "./expiry";
import { checkEventCreationQuota } from "./quota";
import { defaultEventSettings, eventSettingsSchema, isUploadWindowOpen } from "./settings";

describe("F-012: code public", () => {
  it("F-012: génère un code valide de la longueur voulue", () => {
    const code = generatePublicCode();
    expect(code).toHaveLength(PUBLIC_CODE_LENGTH);
    expect(publicCodeSchema.safeParse(code).success).toBe(true);
  });

  it("F-012: n'utilise jamais de caractère ambigu, sur un grand nombre de codes", () => {
    for (let i = 0; i < 500; i += 1) {
      for (const char of generatePublicCode()) {
        expect(PUBLIC_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("F-012: deux codes consécutifs sont différents", () => {
    expect(generatePublicCode()).not.toBe(generatePublicCode());
  });

  it("F-012: écarte les octets qui biaiseraient la répartition", () => {
    // 248 is the first rejected byte for a 31-character alphabet (31 * 8 = 248).
    let call = 0;
    const code = generatePublicCode((count) => {
      call += 1;
      return call === 1 ? new Uint8Array(count).fill(255) : new Uint8Array(count).fill(0);
    });
    expect(code).toBe(PUBLIC_CODE_ALPHABET[0]?.repeat(PUBLIC_CODE_LENGTH));
    expect(call).toBe(2);
  });

  it("F-012: répartit les caractères de façon uniforme", () => {
    const counts = new Map<string, number>();
    const total = 31_000;
    for (let i = 0; i < total / PUBLIC_CODE_LENGTH; i += 1) {
      for (const char of generatePublicCode()) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    const expected = total / PUBLIC_CODE_ALPHABET.length;
    for (const char of PUBLIC_CODE_ALPHABET) {
      // Generous tolerance: this catches a modulo bias, not statistical noise.
      expect(counts.get(char) ?? 0).toBeGreaterThan(expected * 0.7);
      expect(counts.get(char) ?? 0).toBeLessThan(expected * 1.3);
    }
  });
});

describe("F-016: paramètres et fenêtre d'envoi", () => {
  it("F-016: ouvre l'envoi 7 jours avant et le ferme 30 jours après l'événement", () => {
    const settings = defaultEventSettings("2026-09-12");
    expect(settings.upload_opens_at).toBe("2026-09-05T00:00:00.000Z");
    expect(settings.upload_closes_at).toBe("2026-10-12T00:00:00.000Z");
    expect(eventSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("F-015: par défaut la galerie est visible et la validation préalable désactivée", () => {
    const settings = defaultEventSettings("2026-09-12");
    expect(settings.gallery_visible).toBe(true);
    expect(settings.require_approval).toBe(false);
  });

  it("F-016: refuse une fenêtre qui se ferme avant de s'ouvrir", () => {
    const settings = {
      ...defaultEventSettings("2026-09-12"),
      upload_closes_at: "2026-09-01T00:00:00.000Z",
    };
    expect(eventSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("F-016: l'envoi est ouvert uniquement dans la fenêtre", () => {
    const settings = defaultEventSettings("2026-09-12");
    expect(isUploadWindowOpen(settings, new Date("2026-09-04T23:59:59Z"))).toBe(false);
    expect(isUploadWindowOpen(settings, new Date("2026-09-12T20:00:00Z"))).toBe(true);
    expect(isUploadWindowOpen(settings, new Date("2026-10-12T00:00:00Z"))).toBe(false);
  });

  it("refuse une date d'événement invalide", () => {
    expect(() => defaultEventSettings("pas-une-date")).toThrow(/Invalid event date/);
  });
});

describe("section 3: durée de conservation", () => {
  it("offre gratuite : 30 jours après la date de l'événement, jour J compris", () => {
    const expiresAt = computeExpiresAt({ plan: "free", eventDate: "2026-09-12" });
    expect(expiresAt?.toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("offre Événement : 12 mois après l'achat", () => {
    const expiresAt = computeExpiresAt({
      plan: "event",
      eventDate: "2026-09-12",
      purchasedAt: new Date("2026-09-20T10:00:00Z"),
    });
    expect(expiresAt?.toISOString()).toBe("2027-09-20T10:00:00.000Z");
  });

  it("offre Événement : acheté bien avant la fête, 12 mois comptés depuis la fête", () => {
    const expiresAt = computeExpiresAt({
      plan: "event",
      eventDate: "2027-06-01",
      purchasedAt: new Date("2026-09-20T10:00:00Z"),
    });
    expect(expiresAt?.toISOString()).toBe("2028-06-01T00:00:00.000Z");
  });

  it("offre Événement : exige la date d'achat", () => {
    expect(() => computeExpiresAt({ plan: "event", eventDate: "2026-09-12" })).toThrow(/purchase/);
  });

  it("offre Pro : pas d'expiration planifiée (suit l'abonnement)", () => {
    expect(computeExpiresAt({ plan: "pro", eventDate: "2026-09-12" })).toBeNull();
  });
});

describe("plans.ts: un seul événement gratuit actif", () => {
  it("autorise la création quand aucun événement gratuit n'est actif", () => {
    expect(checkEventCreationQuota({ activeFreeEvents: 0 })).toEqual({ ok: true });
  });

  it("refuse la création d'un second événement gratuit actif", () => {
    expect(checkEventCreationQuota({ activeFreeEvents: 1 })).toEqual({
      ok: false,
      reason: "free_event_limit",
    });
  });
});

describe("F-011: contraste de la couleur d'accent", () => {
  it("calcule le contraste du noir sur blanc (21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("accepte l'accent de la marque et refuse un jaune pâle", () => {
    expect(isAccentReadable("#6d4aff")).toBe(true);
    expect(isAccentReadable("#ffeb3b")).toBe(false);
  });

  it("F-011: assombrit un accent illisible jusqu'à respecter WCAG AA, en gardant sa teinte", () => {
    const fixed = makeAccentReadable("#ffeb3b");
    expect(isAccentReadable(fixed)).toBe(true);
    const [r, g, b] = parseHexColor(fixed);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("laisse un accent déjà lisible inchangé", () => {
    expect(makeAccentReadable("#6D4AFF")).toBe("#6d4aff");
  });

  it("rend du noir pour du blanc pur (aucune teinte à conserver)", () => {
    expect(isAccentReadable(makeAccentReadable("#ffffff"))).toBe(true);
  });

  it("refuse une couleur mal formée", () => {
    expect(() => parseHexColor("violet")).toThrow(/Invalid color/);
  });
});
