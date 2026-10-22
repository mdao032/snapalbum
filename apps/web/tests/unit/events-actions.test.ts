import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganiser = vi.fn();
vi.mock("@/server/auth", () => ({ getOrganiser }));

const createEvent = vi.fn();
const updateEventPresentation = vi.fn();
vi.mock("@/server/events", () => ({ createEvent, updateEventPresentation }));

const checkRateLimit = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  EVENT_CREATION_RATE_LIMIT: { name: "event-creation", limit: 10, windowSeconds: 3600 },
}));

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));

vi.mock("@/server/notify-after", () => ({
  scheduleWelcome: vi.fn(),
  scheduleQuotaReached: vi.fn(),
  schedulePaymentConfirmed: vi.fn(),
  scheduleDeletionNotice: vi.fn(),
  scheduleAlbumReady: vi.fn(),
}));

const redirect = vi.fn((_target: unknown): never => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("@/i18n/navigation", () => ({ redirect }));

const { createEventAction } = await import("@/app/[locale]/(app)/events/new/actions");
const { personalizeEventAction } = await import("@/app/[locale]/(app)/events/[id]/actions");

const IDLE = { status: "idle" } as const;
const EVENT_ID = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const validCreation = {
  title: "Mariage de Léa et Tom",
  eventDate: "2026-09-12",
  type: "wedding",
  locale: "fr",
};

beforeEach(() => {
  vi.clearAllMocks();
  getOrganiser.mockResolvedValue({ id: "user-1" });
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 3600 });
  createEvent.mockResolvedValue({ ok: true, event: { id: EVENT_ID } });
});

describe("F-010: création d'événement (action)", () => {
  it("F-010: crée l'événement pour l'organisateur connecté puis ouvre sa page", async () => {
    await expect(createEventAction(IDLE, form(validCreation))).rejects.toThrow("NEXT_REDIRECT");
    expect(createEvent).toHaveBeenCalledWith(
      { admin: true },
      "user-1",
      expect.objectContaining({
        title: "Mariage de Léa et Tom",
        eventDate: "2026-09-12",
      }),
    );
    expect(redirect).toHaveBeenCalledWith({ href: `/events/${EVENT_ID}`, locale: "fr" });
  });

  it("F-010: renvoie vers la connexion sans session organisateur", async () => {
    getOrganiser.mockResolvedValue(null);
    await expect(createEventAction(IDLE, form(validCreation))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith({ href: "/login", locale: "fr" });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("F-010: signale chaque champ invalide sans toucher à la base", async () => {
    const result = await createEventAction(
      IDLE,
      form({ ...validCreation, title: " ", eventDate: "demain" }),
    );
    expect(result).toEqual({
      status: "error",
      error: "validation",
      fieldErrors: { title: "required", eventDate: "invalid" },
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("S-003: refuse au-delà de 10 créations par heure et par compte", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 100 });
    const result = await createEventAction(IDLE, form(validCreation));
    expect(result).toEqual({ status: "error", error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }), "user-1");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("F-010: annonce le quota d'événements gratuits atteint", async () => {
    createEvent.mockResolvedValue({ ok: false, reason: "free_event_limit" });
    expect(await createEventAction(IDLE, form(validCreation))).toEqual({
      status: "error",
      error: "free_event_limit",
    });
  });

  it("F-010: reste propre quand la base échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createEvent.mockRejectedValue(new Error("db down"));
    expect(await createEventAction(IDLE, form(validCreation))).toEqual({
      status: "error",
      error: "failed",
    });
  });
});

describe("F-011: personnalisation (action)", () => {
  const valid = {
    title: "Mariage de Léa et Tom",
    type: "wedding",
    locale: "fr",
    welcomeMessage: "Bienvenue !",
    accentColor: "#1d4ed8",
  };

  it("F-011: enregistre la personnalisation", async () => {
    updateEventPresentation.mockResolvedValue({ ok: true, event: {} });
    expect(await personalizeEventAction(EVENT_ID, IDLE, form(valid))).toEqual({ status: "saved" });
    expect(updateEventPresentation).toHaveBeenCalledWith({}, EVENT_ID, valid);
  });

  it("F-011: signale les champs invalides (message trop long)", async () => {
    const result = await personalizeEventAction(
      EVENT_ID,
      IDLE,
      form({ ...valid, welcomeMessage: "a".repeat(501) }),
    );
    expect(result).toEqual({ status: "error", fieldErrors: { welcomeMessage: "too_long" } });
    expect(updateEventPresentation).not.toHaveBeenCalled();
  });

  it("F-011: refuse un identifiant d'événement mal formé", async () => {
    expect(await personalizeEventAction("pas-un-uuid", IDLE, form(valid))).toEqual({
      status: "error",
    });
    expect(updateEventPresentation).not.toHaveBeenCalled();
  });

  it("S-001: un événement qui n'est pas à l'organisateur n'est pas modifié", async () => {
    updateEventPresentation.mockResolvedValue({ ok: false, reason: "not_found" });
    expect(await personalizeEventAction(EVENT_ID, IDLE, form(valid))).toEqual({ status: "error" });
  });

  it("F-011: renvoie vers la connexion sans session organisateur", async () => {
    getOrganiser.mockResolvedValue(null);
    await expect(personalizeEventAction(EVENT_ID, IDLE, form(valid))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(updateEventPresentation).not.toHaveBeenCalled();
  });

  it("F-011: reste propre quand la base échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateEventPresentation.mockRejectedValue(new Error("db down"));
    expect(await personalizeEventAction(EVENT_ID, IDLE, form(valid))).toEqual({ status: "error" });
  });
});
