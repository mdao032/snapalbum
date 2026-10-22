import { describe, expect, it } from "vitest";
import { canCancelDeletion } from "./lifecycle";
import { albumReadyDueAt, dueReminderDays, isRecapDue, purgeAfter, reminderKind } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("R3: rappels d'expiration à J-7 et J-1, avec des dates simulées", () => {
  const expires = "2026-10-13T00:00:00Z";

  it("rien avant J-7", () => {
    expect(dueReminderDays(expires, at("2026-10-05T23:59:59Z"))).toBeNull();
  });

  it("à J-7 (et jusqu'à J-1), le rappel de 7 jours est dû", () => {
    expect(dueReminderDays(expires, at("2026-10-06T00:00:00Z"))).toBe(7);
    expect(dueReminderDays(expires, at("2026-10-11T23:59:59Z"))).toBe(7);
  });

  it("à J-1, le rappel de 1 jour est dû", () => {
    expect(dueReminderDays(expires, at("2026-10-12T00:00:00Z"))).toBe(1);
    expect(dueReminderDays(expires, at("2026-10-12T23:59:59Z"))).toBe(1);
  });

  it("plus de rappel une fois l'album fermé", () => {
    expect(dueReminderDays(expires, at("2026-10-13T00:00:00Z"))).toBeNull();
    expect(dueReminderDays(expires, at("2026-11-01T00:00:00Z"))).toBeNull();
  });

  it("chaque rappel a son nom de journal", () => {
    expect(reminderKind(7)).toBe("expiry_reminder_7");
    expect(reminderKind(1)).toBe("expiry_reminder_1");
  });
});

describe("SPEC 14: récapitulatif du lendemain", () => {
  it("dû à partir du lendemain de la fête (36 h après minuit UTC du jour J), pas avant", () => {
    expect(isRecapDue("2026-09-12", at("2026-09-13T11:59:59Z"))).toBe(false);
    expect(isRecapDue("2026-09-12", at("2026-09-13T12:00:00Z"))).toBe(true);
  });

  it("plus envoyé pour une fête ancienne (tâche arrêtée longtemps)", () => {
    expect(isRecapDue("2026-09-12", at("2026-09-20T12:00:00Z"))).toBe(false);
  });
});

describe("F-044: quand les invités reçoivent le lien de l'album", () => {
  it("à J+1 par défaut", () => {
    expect(albumReadyDueAt({ eventDate: "2026-09-12" }).toISOString()).toBe(
      "2026-09-13T12:00:00.000Z",
    );
  });

  it("dès que l'organisateur déclare l'album prêt, s'il le fait avant", () => {
    expect(
      albumReadyDueAt({
        eventDate: "2026-09-12",
        readyAt: "2026-09-12T22:00:00.000Z",
      }).toISOString(),
    ).toBe("2026-09-12T22:00:00.000Z");
  });

  it("une déclaration tardive n'avance rien : J+1 reste l'échéance", () => {
    expect(
      albumReadyDueAt({
        eventDate: "2026-09-12",
        readyAt: "2026-09-20T10:00:00.000Z",
      }).toISOString(),
    ).toBe("2026-09-13T12:00:00.000Z");
  });
});

describe("R5: annuler une suppression", () => {
  const now = at("2026-10-14T00:00:00Z");
  const base = { status: "pending_deletion", deleted_at: "2026-10-13T00:00:00Z" };

  it("la suppression demandée par l'organisateur s'annule pendant 7 jours", () => {
    expect(canCancelDeletion({ ...base, deletion_reason: "user" }, now)).toBe(true);
    expect(
      canCancelDeletion({ ...base, deletion_reason: "user" }, at("2026-10-21T00:00:00Z")),
    ).toBe(false);
  });

  it("un album expiré ne s'annule pas : il se récupère en payant", () => {
    expect(canCancelDeletion({ ...base, deletion_reason: "expired" }, now)).toBe(false);
  });
});

describe("SPEC 9.2: la purge suit l'expiration de 7 jours", () => {
  it("dernier jour pour récupérer un album expiré", () => {
    expect(purgeAfter("2026-10-13T00:00:00Z").toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
});
