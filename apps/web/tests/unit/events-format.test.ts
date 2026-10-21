import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "@/components/events/settings-form";
import { formatBytes, formatInstantDate } from "@/lib/events";

describe("F-018: affichage des tailles et des échéances", () => {
  it("F-018: affiche l'espace en octets, Ko, Mo, Go avec les unités de la langue", () => {
    expect(formatBytes(0, "fr")).toBe("0 o");
    expect(formatBytes(1536, "fr")).toBe("2 Ko");
    expect(formatBytes(5 * 1024 * 1024, "fr")).toBe("5 Mo");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, "fr")).toBe("1,5 Go");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, "en")).toBe("1.5 GB");
  });

  it("R5: affiche la date limite de purge en toutes lettres", () => {
    expect(formatInstantDate("2026-10-28T10:00:00Z", "fr")).toBe("28 octobre 2026");
    expect(formatInstantDate(new Date("2026-10-28T10:00:00Z"), "en")).toBe("October 28, 2026");
  });
});

describe("F-016: dates de la période d'envoi", () => {
  it("F-016: un instant revient identique après l'aller-retour par le champ de saisie", () => {
    const iso = "2026-09-05T08:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it("F-016: le champ de saisie reçoit le format année-mois-jour T heure:minute", () => {
    expect(toLocalInput("2026-09-05T08:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("F-016: une saisie vide ou invalide donne une chaîne vide, que le serveur refuse", () => {
    expect(fromLocalInput("")).toBe("");
    expect(fromLocalInput("pas une date")).toBe("");
  });
});
