import { describe, expect, it } from "vitest";
import {
  defaultCoverBackground,
  eventDisplayStatus,
  formatEventDate,
  todayIsoDate,
} from "@/lib/events";

const now = new Date("2026-10-21T10:00:00Z");

describe("F-018: état affiché d'un événement", () => {
  it("F-018: un événement actif non expiré est en cours", () => {
    expect(eventDisplayStatus({ status: "active", expires_at: "2026-11-01T00:00:00Z" }, now)).toBe(
      "active",
    );
    expect(eventDisplayStatus({ status: "active", expires_at: null }, now)).toBe("active");
  });

  it("F-018: un événement actif dont l'expiration est passée est terminé", () => {
    expect(eventDisplayStatus({ status: "active", expires_at: "2026-10-21T10:00:00Z" }, now)).toBe(
      "expired",
    );
  });

  it("F-018: suspendu et en cours de suppression restent affichés tels quels", () => {
    expect(eventDisplayStatus({ status: "suspended", expires_at: null }, now)).toBe("suspended");
    expect(
      eventDisplayStatus({ status: "pending_deletion", expires_at: "2020-01-01T00:00:00Z" }, now),
    ).toBe("pending_deletion");
  });
});

describe("F-010: dates et couverture", () => {
  it("F-010: formate la date du jour de l'événement sans décalage de fuseau, dans chaque langue", () => {
    expect(formatEventDate("2026-09-12", "fr")).toBe("12 septembre 2026");
    expect(formatEventDate("2026-09-12", "en")).toBe("September 12, 2026");
  });

  it("F-010: propose la date du jour par défaut", () => {
    expect(todayIsoDate(now)).toBe("2026-10-21");
  });

  it("F-011: la couverture par défaut suit la couleur d'accent, sinon celle du produit", () => {
    expect(defaultCoverBackground("#1d4ed8")).toContain("#1d4ed8");
    expect(defaultCoverBackground(null)).toContain("#6d4aff");
  });
});
