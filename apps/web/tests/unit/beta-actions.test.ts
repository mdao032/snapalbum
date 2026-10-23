// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((target: { href: string; locale: string }) => {
  throw new Error(`redirect:${target.href}`);
});
vi.mock("@/i18n/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));

const getAdmin = vi.fn();
const getOrganiser = vi.fn();
vi.mock("@/server/auth", () => ({ getAdmin, getOrganiser }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));
vi.mock("@/server/storage", () => ({ getStorage: () => ({}) }));
vi.mock("@/server/admin", () => ({}));
vi.mock("@/server/moderation", () => ({}));
vi.mock("@/server/payments", () => ({}));
vi.mock("@/server/notify-after", () => ({}));
vi.mock("@/config/env", () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const createBetaInvitation = vi.fn();
const revokeBetaInvitation = vi.fn();
const redeemBetaInvitation = vi.fn();
vi.mock("@/server/beta", () => ({
  createBetaInvitation,
  revokeBetaInvitation,
  redeemBetaInvitation,
}));

const checkRateLimit = vi.fn(async () => ({ allowed: true }));
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit,
  CHECKOUT_RATE_LIMIT: {},
  BETA_REDEEM_RATE_LIMIT: { name: "beta-redeem" },
}));

const { createBetaInvitationAction, revokeBetaInvitationAction } =
  await import("@/app/[locale]/(admin)/admin/actions");
const { redeemBetaCodeAction } = await import("@/app/[locale]/(app)/events/[id]/payment/actions");

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
async function sentBack(run: () => Promise<unknown>) {
  await expect(run()).rejects.toThrow(/^redirect:/);
  return redirect.mock.calls.at(-1)?.[0].href;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdmin.mockResolvedValue({ id: "admin-1" });
  getOrganiser.mockResolvedValue({ id: "user-1", email: "o@example.test" });
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("6.1: gestes de l'administrateur pour la bêta", () => {
  it("6.1: sans administrateur, rien n'est créé ni annulé", async () => {
    getAdmin.mockResolvedValue(null);
    expect(
      await sentBack(() =>
        createBetaInvitationAction(form({ email: "a@example.test", returnTo: "/admin/beta" })),
      ),
    ).toBe("/admin/beta?failed=failed");
    expect(
      await sentBack(() =>
        revokeBetaInvitationAction(form({ invitationId: EVENT, returnTo: "/admin/beta" })),
      ),
    ).toBe("/admin/beta?failed=1");
    expect(createBetaInvitation).not.toHaveBeenCalled();
    expect(revokeBetaInvitation).not.toHaveBeenCalled();
  });

  it("6.1: une adresse invalide est refusée avant la base ; une valide crée le code", async () => {
    expect(
      await sentBack(() =>
        createBetaInvitationAction(form({ email: "pas une adresse", returnTo: "/admin/beta" })),
      ),
    ).toBe("/admin/beta?failed=invalid_email");
    expect(createBetaInvitation).not.toHaveBeenCalled();

    createBetaInvitation.mockResolvedValue({ ok: true, id: "i", code: "ABCDEFGHJK" });
    expect(
      await sentBack(() =>
        createBetaInvitationAction(form({ email: " a@example.test ", returnTo: "/admin/beta" })),
      ),
    ).toBe("/admin/beta?done=1");
    expect(createBetaInvitation).toHaveBeenCalledWith({ admin: true }, "admin-1", "a@example.test");
  });

  it("6.1: le motif du refus revient sur la page, et le retour reste dans l'espace administrateur", async () => {
    createBetaInvitation.mockResolvedValue({ ok: false, reason: "already_invited" });
    expect(
      await sentBack(() =>
        createBetaInvitationAction(
          form({ email: "a@example.test", returnTo: "https://evil.test" }),
        ),
      ),
    ).toBe("/admin?failed=already_invited");
  });
});

describe("6.1: l'organisateur entre son code", () => {
  it("6.1: sans session, retour à la connexion ; l'identifiant d'événement est vérifié", async () => {
    getOrganiser.mockResolvedValue(null);
    expect(
      await sentBack(() => redeemBetaCodeAction(EVENT, { status: "idle" }, form({ code: "x" }))),
    ).toBe("/login");

    getOrganiser.mockResolvedValue({ id: "user-1" });
    expect(
      await redeemBetaCodeAction("pas-un-uuid", { status: "idle" }, form({ code: "ABCDEFGHJK" })),
    ).toEqual({ status: "error", reason: "event_not_found" });
    expect(redeemBetaInvitation).not.toHaveBeenCalled();
  });

  it("6.1: les essais sont limités par organisateur", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });
    expect(
      await redeemBetaCodeAction(EVENT, { status: "idle" }, form({ code: "ABCDEFGHJK" })),
    ).toEqual({ status: "error", reason: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith({ name: "beta-redeem" }, "user-1");
    expect(redeemBetaInvitation).not.toHaveBeenCalled();
  });

  it("6.1: un refus de la base est rendu à l'écran ; un succès renvoie sur l'événement", async () => {
    redeemBetaInvitation.mockResolvedValue({ ok: false, reason: "already_used" });
    expect(
      await redeemBetaCodeAction(EVENT, { status: "idle" }, form({ code: "ABCDEFGHJK" })),
    ).toEqual({ status: "error", reason: "already_used" });

    redeemBetaInvitation.mockResolvedValue({ ok: true, plan: "event", expiresAt: "x" });
    expect(
      await sentBack(() =>
        redeemBetaCodeAction(EVENT, { status: "idle" }, form({ code: "ABCDEFGHJK" })),
      ),
    ).toBe(`/events/${EVENT}?beta=done`);
    expect(redeemBetaInvitation).toHaveBeenLastCalledWith(
      { admin: true },
      "user-1",
      EVENT,
      "ABCDEFGHJK",
    );
  });
});
