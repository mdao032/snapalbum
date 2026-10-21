import { describe, expect, it } from "vitest";
import { DELETION_GRACE_DAYS } from "../plans";
import { canCancelDeletion, canRequestDeletion, purgeDeadline } from "./lifecycle";
import { computeEventUsage, USAGE_WARNING_PERCENT } from "./usage";
import { updateEventSettingsSchema } from "./settings";

describe("R5: suppression d'un événement", () => {
  it("R5: la purge a lieu 7 jours après la demande", () => {
    expect(DELETION_GRACE_DAYS).toBe(7);
    expect(purgeDeadline("2026-10-21T10:00:00.000Z").toISOString()).toBe(
      "2026-10-28T10:00:00.000Z",
    );
  });

  it("R5: seul un événement actif peut être supprimé", () => {
    expect(canRequestDeletion({ status: "active", deleted_at: null })).toBe(true);
    expect(
      canRequestDeletion({ status: "pending_deletion", deleted_at: "2026-10-21T10:00:00Z" }),
    ).toBe(false);
    expect(canRequestDeletion({ status: "suspended", deleted_at: null })).toBe(false);
  });

  it("R5: l'annulation est possible jusqu'à la date limite, pas après", () => {
    const event = { status: "pending_deletion", deleted_at: "2026-10-21T10:00:00Z" };
    expect(canCancelDeletion(event, new Date("2026-10-28T09:59:59Z"))).toBe(true);
    expect(canCancelDeletion(event, new Date("2026-10-28T10:00:00Z"))).toBe(false);
  });

  it("R5: on n'annule pas ce qui n'est pas en suppression", () => {
    expect(canCancelDeletion({ status: "active", deleted_at: null }, new Date())).toBe(false);
    expect(canCancelDeletion({ status: "pending_deletion", deleted_at: null }, new Date())).toBe(
      false,
    );
  });
});

describe("F-018: quota restant", () => {
  it("F-018: lit le quota dans plans.ts, avec le reste et le pourcentage", () => {
    const usage = computeEventUsage({ plan: "free", mediaCount: 50 });
    expect(usage).toMatchObject({ quota: 200, used: 50, remaining: 150, percent: 25, level: "ok" });
    expect(usage.videoQuota).toBe(10);
  });

  it("F-018: prévient à partir de 80 % et signale l'album plein", () => {
    expect(USAGE_WARNING_PERCENT).toBe(80);
    expect(computeEventUsage({ plan: "free", mediaCount: 160 }).level).toBe("warning");
    expect(computeEventUsage({ plan: "free", mediaCount: 199 })).toMatchObject({
      level: "warning",
      percent: 99,
    });
    expect(computeEventUsage({ plan: "free", mediaCount: 200 })).toMatchObject({
      level: "full",
      percent: 100,
      remaining: 0,
    });
  });

  it("F-018: un décompte au-delà du quota reste borné", () => {
    expect(computeEventUsage({ plan: "free", mediaCount: 250 })).toMatchObject({
      percent: 100,
      remaining: 0,
    });
  });

  it("F-018: les offres payantes ont leur propre quota et pas de limite de vidéos", () => {
    const usage = computeEventUsage({ plan: "event", mediaCount: 0 });
    expect(usage.quota).toBe(10_000);
    expect(usage.videoQuota).toBeNull();
  });
});

describe("F-015, F-016: réglages", () => {
  const valid = {
    gallery_visible: true,
    require_approval: false,
    upload_opens_at: "2026-09-05T00:00:00.000Z",
    upload_closes_at: "2026-10-12T00:00:00.000Z",
  };

  it("F-016: accepte une fenêtre d'envoi cohérente", () => {
    expect(updateEventSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it("F-016: refuse une fenêtre qui se ferme avant de s'ouvrir", () => {
    expect(
      updateEventSettingsSchema.safeParse({
        ...valid,
        upload_closes_at: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("F-015: refuse des dates qui ne sont pas des instants ISO", () => {
    expect(
      updateEventSettingsSchema.safeParse({ ...valid, upload_opens_at: "demain" }).success,
    ).toBe(false);
  });
});
