// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { productDetails } from "@snapalbum/shared";
import { fakeAdmin, type Row } from "./fake-admin";

const env: { BETA_MODE?: boolean } = {};
vi.mock("@/config/env.server", () => ({ getServerEnv: () => env }));

const {
  createBetaInvitation,
  isBetaMode,
  listBetaInvitations,
  redeemBetaInvitation,
  revokeBetaInvitation,
} = await import("@/server/beta");

const ADMIN = "0aaaaaaa-1111-4111-8111-111111111111";
const USER = "0bbbbbbb-2222-4222-8222-222222222222";
const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";

beforeEach(() => {
  env.BETA_MODE = true;
});

describe("6.1: bêta fermée", () => {
  it("6.1: sans BETA_MODE, rien n'est créé et aucun code n'est accepté", async () => {
    env.BETA_MODE = undefined;
    const rpc = vi.fn();
    const admin = fakeAdmin({}, { create_beta_invitation: rpc, redeem_beta_invitation: rpc });
    expect(isBetaMode()).toBe(false);
    expect(await createBetaInvitation(admin, ADMIN, "a@example.test")).toEqual({
      ok: false,
      reason: "beta_off",
    });
    expect(await redeemBetaInvitation(admin, USER, EVENT, "ABCDE-FGHJK")).toEqual({
      ok: false,
      reason: "beta_off",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("6.1: création d'un code", () => {
  it("6.1: envoie l'administrateur, l'adresse et un code tiré, et rend le code", async () => {
    const calls: Row[] = [];
    const admin = fakeAdmin(
      {},
      {
        create_beta_invitation: (args) => {
          calls.push(args);
          return { ok: true, id: "inv-1" };
        },
      },
    );
    const result = await createBetaInvitation(admin, ADMIN, "a@example.test", () => 0);
    expect(result).toEqual({ ok: true, id: "inv-1", code: "AAAAAAAAAA" });
    expect(calls).toEqual([{ p_actor: ADMIN, p_email: "a@example.test", p_code: "AAAAAAAAAA" }]);
  });

  it("6.1: un code déjà pris fait tirer un autre code", async () => {
    const codes: string[] = [];
    const admin = fakeAdmin(
      {},
      {
        create_beta_invitation: (args) => {
          codes.push(String(args.p_code));
          return codes.length < 3 ? { ok: false, reason: "duplicate_code" } : { ok: true, id: "x" };
        },
      },
    );
    let next = 0;
    const result = await createBetaInvitation(admin, ADMIN, "a@example.test", () => next++ % 31);
    expect(result.ok).toBe(true);
    expect(new Set(codes).size).toBe(3);
  });

  it("6.1: une adresse déjà invitée ou mal formée est expliquée, sans nouveau tirage", async () => {
    const rpc = vi.fn(() => ({ ok: false, reason: "already_invited" }));
    const admin = fakeAdmin({}, { create_beta_invitation: rpc });
    expect(await createBetaInvitation(admin, ADMIN, "a@example.test")).toEqual({
      ok: false,
      reason: "already_invited",
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    const bad = fakeAdmin(
      {},
      { create_beta_invitation: () => ({ ok: false, reason: "invalid_input" }) },
    );
    expect(await createBetaInvitation(bad, ADMIN, "nope")).toEqual({
      ok: false,
      reason: "invalid_email",
    });
  });

  it("6.1: cinq codes de suite déjà pris : erreur franche plutôt qu'une boucle", async () => {
    const admin = fakeAdmin(
      {},
      { create_beta_invitation: () => ({ ok: false, reason: "duplicate_code" }) },
    );
    await expect(createBetaInvitation(admin, ADMIN, "a@example.test")).rejects.toThrow(
      /free invitation code/,
    );
  });
});

describe("6.1: utilisation d'un code", () => {
  it("6.1: le code saisi est normalisé et la durée vient de plans.ts", async () => {
    const calls: Row[] = [];
    const admin = fakeAdmin(
      {},
      {
        redeem_beta_invitation: (args) => {
          calls.push(args);
          return { ok: true, plan: "event", expires_at: "2027-10-22T00:00:00Z" };
        },
      },
    );
    const result = await redeemBetaInvitation(admin, USER, EVENT, " abcde-fghjk ");
    expect(result).toEqual({ ok: true, plan: "event", expiresAt: "2027-10-22T00:00:00Z" });
    expect(calls).toEqual([
      {
        p_user_id: USER,
        p_event_id: EVENT,
        p_code: "ABCDEFGHJK",
        p_months: productDetails("event").months,
      },
    ]);
  });

  it("6.1: une saisie qui ne peut pas être un code n'interroge pas la base", async () => {
    const rpc = vi.fn();
    const admin = fakeAdmin({}, { redeem_beta_invitation: rpc });
    expect(await redeemBetaInvitation(admin, USER, EVENT, "abc")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("6.1: chaque refus de la base est rendu tel quel", async () => {
    for (const reason of ["invalid_code", "already_used", "revoked", "not_free"]) {
      const admin = fakeAdmin({}, { redeem_beta_invitation: () => ({ ok: false, reason }) });
      expect(await redeemBetaInvitation(admin, USER, EVENT, "ABCDEFGHJK")).toEqual({
        ok: false,
        reason,
      });
    }
  });
});

describe("6.1: liste et annulation", () => {
  it("6.1: la liste envoie la taille et le décalage de page ; l'annulation, l'administrateur", async () => {
    const calls: Record<string, Row> = {};
    const admin = fakeAdmin(
      {},
      {
        admin_list_beta_invitations: (args) => {
          calls.list = args;
          return { total: 0, rows: [] };
        },
        revoke_beta_invitation: (args) => {
          calls.revoke = args;
          return { ok: true };
        },
      },
    );
    await listBetaInvitations(admin, 3);
    expect(calls.list).toEqual({ p_limit: 25, p_offset: 50 });
    expect(await revokeBetaInvitation(admin, ADMIN, "inv-1")).toEqual({ ok: true });
    expect(calls.revoke).toEqual({ p_actor: ADMIN, p_id: "inv-1" });
  });
});
