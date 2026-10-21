import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganiser = vi.fn();
vi.mock("@/server/auth", () => ({ getOrganiser }));

const updateEventSettings = vi.fn();
const requestEventDeletion = vi.fn();
const cancelEventDeletion = vi.fn();
vi.mock("@/server/events", () => ({
  updateEventSettings,
  requestEventDeletion,
  cancelEventDeletion,
  updateEventPresentation: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ user: true }),
}));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const redirect = vi.fn((_target: unknown): never => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("@/i18n/navigation", () => ({ redirect }));

const { saveSettingsAction, requestDeletionAction, cancelDeletionAction } =
  await import("@/app/[locale]/(app)/events/[id]/actions");

const IDLE = { status: "idle" } as const;
const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const window = {
  upload_opens_at: "2026-09-05T00:00:00.000Z",
  upload_closes_at: "2026-10-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getOrganiser.mockResolvedValue({ id: "user-1" });
  updateEventSettings.mockResolvedValue({ ok: true, event: {} });
  requestEventDeletion.mockResolvedValue({ ok: true });
  cancelEventDeletion.mockResolvedValue({ ok: true });
});

describe("F-015, F-016: réglages (action)", () => {
  it("F-015: lit les cases cochées et décochées d'un formulaire", async () => {
    const result = await saveSettingsAction(
      EVENT_ID,
      IDLE,
      form({ gallery_visible: "on", ...window }),
    );
    expect(result).toEqual({ status: "saved" });
    // The dashboard is refreshed so what depends on the saved value (the access code) is current.
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/events/[id]", "page");
    expect(updateEventSettings).toHaveBeenCalledWith({ user: true }, EVENT_ID, {
      gallery_visible: true,
      require_approval: false,
      ...window,
    });
  });

  it("F-016: refuse une période qui se ferme avant de s'ouvrir", async () => {
    const result = await saveSettingsAction(
      EVENT_ID,
      IDLE,
      form({ upload_opens_at: window.upload_closes_at, upload_closes_at: window.upload_opens_at }),
    );
    expect(result).toEqual({ status: "error", error: "invalid" });
    expect(updateEventSettings).not.toHaveBeenCalled();
  });

  it("F-016: refuse des dates vides (saisie invalide dans le navigateur)", async () => {
    const result = await saveSettingsAction(EVENT_ID, IDLE, form({ upload_opens_at: "" }));
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("S-001: un événement qui n'est pas le sien est refusé", async () => {
    updateEventSettings.mockResolvedValue({ ok: false, reason: "not_found" });
    expect(await saveSettingsAction(EVENT_ID, IDLE, form(window))).toEqual({
      status: "error",
      error: "failed",
    });
  });

  it("F-015: renvoie vers la connexion sans session organisateur", async () => {
    getOrganiser.mockResolvedValue(null);
    await expect(saveSettingsAction(EVENT_ID, IDLE, form(window))).rejects.toThrow("NEXT_REDIRECT");
    expect(updateEventSettings).not.toHaveBeenCalled();
  });

  it("F-015: reste propre quand la base échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateEventSettings.mockRejectedValue(new Error("db down"));
    expect(await saveSettingsAction(EVENT_ID, IDLE, form(window))).toEqual({
      status: "error",
      error: "failed",
    });
  });
});

describe("R5: suppression et annulation (actions)", () => {
  it("R5: demande la suppression pour l'organisateur connecté puis revient sur la page", async () => {
    await expect(requestDeletionAction(EVENT_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(requestEventDeletion).toHaveBeenCalledWith({ admin: true }, "user-1", EVENT_ID);
    expect(redirect).toHaveBeenCalledWith({ href: `/events/${EVENT_ID}`, locale: "fr" });
  });

  it("R5: annule la suppression pour l'organisateur connecté", async () => {
    await expect(cancelDeletionAction(EVENT_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(cancelEventDeletion).toHaveBeenCalledWith({ admin: true }, "user-1", EVENT_ID);
  });

  it("R5: sans session organisateur, rien n'est supprimé ni annulé", async () => {
    getOrganiser.mockResolvedValue(null);
    await expect(requestDeletionAction(EVENT_ID)).rejects.toThrow("NEXT_REDIRECT");
    await expect(cancelDeletionAction(EVENT_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(requestEventDeletion).not.toHaveBeenCalled();
    expect(cancelEventDeletion).not.toHaveBeenCalled();
  });

  it("R5: un identifiant mal formé ne touche pas à la base", async () => {
    await expect(requestDeletionAction("pas-un-uuid")).rejects.toThrow("NEXT_REDIRECT");
    expect(requestEventDeletion).not.toHaveBeenCalled();
  });
});
