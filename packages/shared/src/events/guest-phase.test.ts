import { describe, expect, it } from "vitest";
import { EVENT_OVER_AFTER_HOURS, eventOverAt, guestPhase } from "./guest-phase";

const event = {
  eventDate: "2026-09-12",
  settings: {
    upload_opens_at: "2026-09-05T00:00:00.000Z",
    upload_closes_at: "2026-10-12T00:00:00.000Z",
  },
};
const at = (iso: string) => guestPhase(event, new Date(iso));

describe("F-043: ce que la page de l'événement propose", () => {
  it("F-043: avant l'ouverture des envois, l'événement est « bientôt »", () => {
    expect(at("2026-09-04T23:59:59Z")).toBe("soon");
  });

  it("F-043: de l'ouverture jusqu'au lendemain de la fête, l'envoi est l'action principale", () => {
    expect(at("2026-09-05T00:00:00Z")).toBe("live");
    expect(at("2026-09-12T12:00:00Z")).toBe("live");
    // The party runs past midnight: the night after is still the event.
    expect(at("2026-09-13T04:00:00Z")).toBe("live");
  });

  it("F-043: après la fête, l'album passe devant tant que la fenêtre d'envoi est ouverte", () => {
    expect(at("2026-09-13T12:00:00Z")).toBe("after");
    expect(at("2026-10-11T23:59:59Z")).toBe("after");
  });

  it("F-043: une fois la fenêtre d'envoi finie, il ne reste que l'album", () => {
    expect(at("2026-10-12T00:00:00Z")).toBe("closed");
    expect(at("2027-01-01T00:00:00Z")).toBe("closed");
  });

  it("F-043: si l'organisateur ferme les envois le soir même, la fin de la fenêtre l'emporte", () => {
    const early = {
      ...event,
      settings: { ...event.settings, upload_closes_at: "2026-09-12T20:00:00.000Z" },
    };
    expect(guestPhase(early, new Date("2026-09-12T19:59:00Z"))).toBe("live");
    expect(guestPhase(early, new Date("2026-09-12T20:00:00Z"))).toBe("closed");
  });

  it("F-043: la fête est finie 36 h après le début de sa date", () => {
    expect(EVENT_OVER_AFTER_HOURS).toBe(36);
    expect(eventOverAt("2026-09-12").toISOString()).toBe("2026-09-13T12:00:00.000Z");
  });

  it("F-043, F-044: dès que l'organisateur déclare l'album prêt, la page passe à « après », même le soir de la fête", () => {
    const ready = {
      ...event,
      settings: { ...event.settings, album_ready_at: "2026-09-12T22:00:00.000Z" },
    };
    expect(guestPhase(ready, new Date("2026-09-12T21:59:00Z"))).toBe("live");
    expect(guestPhase(ready, new Date("2026-09-12T22:00:00Z"))).toBe("after");
    // It never reopens uploads that the window closed, nor announces an event not yet open.
    expect(guestPhase(ready, new Date("2026-10-12T00:00:00Z"))).toBe("closed");
    expect(guestPhase(ready, new Date("2026-09-01T00:00:00Z"))).toBe("soon");
  });
});
