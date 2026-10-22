// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((target: { href: string; locale: string }) => {
  throw new Error(`redirect:${target.href}`);
});
vi.mock("@/i18n/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));

const getAdmin = vi.fn();
vi.mock("@/server/auth", () => ({ getAdmin }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));
vi.mock("@/server/storage", () => ({ getStorage: () => ({ storage: true }) }));

const setEventSuspended = vi.fn(async () => ({ ok: true }));
const extendEvent = vi.fn(async () => ({ ok: true }));
vi.mock("@/server/admin", () => ({ setEventSuspended, extendEvent }));

const moderateMedia = vi.fn(async () => ({ ok: true, body: { changed: 1 } }));
const dismissReports = vi.fn(async () => ({ ok: true, body: { changed: 1 } }));
vi.mock("@/server/moderation", () => ({ moderateMedia, dismissReports }));

const { suspendEventAction, extendEventAction, handleReportAction } =
  await import("@/app/[locale]/(admin)/admin/actions");

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const MEDIA = "00000000-0000-4000-8000-000000000001";
const ADMIN = { id: "admin-1" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

/** Runs an action and returns where it sent the person back to. */
async function outcome(action: (data: FormData) => Promise<void>, data: FormData) {
  await expect(action(data)).rejects.toThrow(/^redirect:/);
  return redirect.mock.calls.at(-1)?.[0].href;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdmin.mockResolvedValue(ADMIN);
});

describe("S-001: les gestes de l'administrateur revérifient le rôle", () => {
  it("sans administrateur, aucun geste n'agit : retour avec « échec »", async () => {
    getAdmin.mockResolvedValue(null);
    const base = { eventId: EVENT, mediaId: MEDIA, returnTo: "/admin/reports" };
    expect(await outcome(suspendEventAction, form({ ...base, suspended: "true" }))).toBe(
      "/admin/reports?failed=1",
    );
    expect(await outcome(extendEventAction, form({ ...base, months: "3" }))).toBe(
      "/admin/reports?failed=1",
    );
    expect(await outcome(handleReportAction, form({ ...base, action: "delete" }))).toBe(
      "/admin/reports?failed=1",
    );
    expect(setEventSuspended).not.toHaveBeenCalled();
    expect(extendEvent).not.toHaveBeenCalled();
    expect(moderateMedia).not.toHaveBeenCalled();
    expect(dismissReports).not.toHaveBeenCalled();
  });

  it("l'adresse de retour reste dans l'espace administrateur, sinon c'est l'aperçu", async () => {
    for (const returnTo of [
      "https://evil.example.test/",
      "//evil.example.test",
      "/events",
      "/admin/../events",
      "",
    ]) {
      const href = await outcome(
        suspendEventAction,
        form({ eventId: EVENT, suspended: "true", returnTo }),
      );
      expect(href, returnTo).toBe("/admin?done=1");
    }
    expect(
      await outcome(
        suspendEventAction,
        form({ eventId: EVENT, suspended: "true", returnTo: `/admin/events/${EVENT}` }),
      ),
    ).toBe(`/admin/events/${EVENT}?done=1`);
  });
});

describe("F-091: suspendre, prolonger, traiter un signalement", () => {
  it("suspendre ou lever la suspension, avec l'identifiant de l'administrateur", async () => {
    await outcome(suspendEventAction, form({ eventId: EVENT, suspended: "true" }));
    await outcome(suspendEventAction, form({ eventId: EVENT, suspended: "false" }));
    expect(setEventSuspended).toHaveBeenNthCalledWith(1, { admin: true }, "admin-1", EVENT, true);
    expect(setEventSuspended).toHaveBeenNthCalledWith(2, { admin: true }, "admin-1", EVENT, false);
  });

  it("un identifiant qui n'en est pas un n'atteint jamais la base", async () => {
    expect(
      await outcome(suspendEventAction, form({ eventId: "pas-un-uuid", suspended: "true" })),
    ).toBe("/admin?failed=1");
    expect(setEventSuspended).not.toHaveBeenCalled();
  });

  it("la prolongation n'accepte que les durées proposées", async () => {
    expect(await outcome(extendEventAction, form({ eventId: EVENT, months: "6" }))).toBe(
      "/admin?done=1",
    );
    expect(extendEvent).toHaveBeenCalledWith({ admin: true }, "admin-1", EVENT, 6);
    for (const months of ["0", "5", "120", "abc", ""]) {
      expect(await outcome(extendEventAction, form({ eventId: EVENT, months }))).toBe(
        "/admin?failed=1",
      );
    }
    expect(extendEvent).toHaveBeenCalledTimes(1);
  });

  it("un refus de la base est rendu comme un échec", async () => {
    setEventSuspended.mockResolvedValueOnce({ ok: false });
    expect(await outcome(suspendEventAction, form({ eventId: EVENT, suspended: "true" }))).toBe(
      "/admin?failed=1",
    );
  });

  it("masquer et supprimer passent par la modération en administrateur, ignorer ferme les signalements", async () => {
    const base = { eventId: EVENT, mediaId: MEDIA };
    await outcome(handleReportAction, form({ ...base, action: "hide" }));
    await outcome(handleReportAction, form({ ...base, action: "delete" }));
    await outcome(handleReportAction, form({ ...base, action: "dismiss" }));
    const asAdmin = expect.objectContaining({ asAdmin: true });
    expect(moderateMedia).toHaveBeenNthCalledWith(1, asAdmin, "admin-1", EVENT, "hide", [MEDIA]);
    expect(moderateMedia).toHaveBeenNthCalledWith(2, asAdmin, "admin-1", EVENT, "delete", [MEDIA]);
    expect(dismissReports).toHaveBeenCalledWith(asAdmin, "admin-1", EVENT, [MEDIA]);
  });

  it("une action inconnue, comme « approuver », est refusée", async () => {
    for (const action of ["approve", "restore", "reject", "", "drop table"]) {
      expect(
        await outcome(handleReportAction, form({ eventId: EVENT, mediaId: MEDIA, action })),
      ).toBe("/admin?failed=1");
    }
    expect(moderateMedia).not.toHaveBeenCalled();
  });
});
