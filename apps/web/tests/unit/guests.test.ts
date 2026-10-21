import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { hashAccessCode } from "@/server/access-code";
import { getGuestOfEvent, joinEvent, type JoinDeps } from "@/server/guests";

const EVENT = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11";
const USER = "11111111-1111-4111-8111-111111111111";
const NEW_USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-21T10:00:00Z");

interface Script {
  event?: { id: string; status: string; settings: unknown } | null;
  guest?: Record<string, unknown> | null;
  insert?: { data?: unknown; error?: { code: string } | null };
  refetch?: Record<string, unknown>;
}

function fakeAdmin(script: Script) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  let guestReads = 0;
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "update", "insert"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      if (table === "events") return { data: script.event ?? null, error: null };
      return { data: script.guest ?? null, error: null };
    };
    chain.single = async () => {
      if (table === "guests" && calls.some((c) => c.method === "insert") && guestReads === 0) {
        guestReads += 1;
        return { data: script.insert?.data ?? null, error: script.insert?.error ?? null };
      }
      return { data: script.refetch ?? script.insert?.data, error: null };
    };
    chain.then = (resolve: (value: unknown) => void) => resolve({ error: null });
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const deps = (admin: SupabaseClient, overrides: Partial<JoinDeps> = {}): JoinDeps => ({
  admin,
  signInAnonymously: vi.fn(async () => ({
    userId: NEW_USER,
    session: { accessToken: "access", refreshToken: "refresh", expiresAt: 1_800_000_000 },
  })),
  verifyHuman: vi.fn(async () => true),
  allowCodeAttempt: vi.fn(async () => true),
  now: () => NOW,
  ...overrides,
});

const input = { eventCode: "k7m2x9qvbr" };
const open = { id: EVENT, status: "active", settings: {} };
const created = { data: { id: "guest-1", display_name: null } };

let hash = "";
beforeAll(async () => {
  hash = await hashAccessCode("4821");
});

describe("F-035: un nouvel invité rejoint l'événement", () => {
  it("F-035: ouvre une session anonyme, enregistre l'invité et les conditions acceptées avec leur date", async () => {
    const { client, calls } = fakeAdmin({ event: open, insert: created });
    const d = deps(client);
    const result = await joinEvent(
      d,
      { userId: null, ip: "203.0.113.7" },
      { ...input, displayName: "Élodie" },
    );

    expect(result).toEqual({
      ok: true,
      body: {
        guestId: "guest-1",
        displayName: null,
        session: { accessToken: "access", refreshToken: "refresh", expiresAt: 1_800_000_000 },
      },
    });
    expect(d.signInAnonymously).toHaveBeenCalledTimes(1);
    const inserted = calls.find((c) => c.table === "guests" && c.method === "insert")?.args[0];
    expect(inserted).toMatchObject({
      event_id: EVENT,
      auth_user_id: NEW_USER,
      display_name: "Élodie",
      terms_accepted_at: NOW.toISOString(),
      terms_version: "2026-10",
    });
  });

  it("F-033: le prénom est facultatif", async () => {
    const { client, calls } = fakeAdmin({ event: open, insert: created });
    await joinEvent(deps(client), { userId: null, ip: "x" }, input);
    expect(calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({ display_name: null });
  });

  it("F-035: quelqu'un qui a déjà une session (organisateur, autre appareil) la garde : pas de nouvelle session", async () => {
    const { client, calls } = fakeAdmin({ event: open, insert: created });
    const d = deps(client);
    const result = await joinEvent(d, { userId: USER, ip: "x" }, input);
    expect(result).toMatchObject({ ok: true, body: { session: null } });
    expect(d.signInAnonymously).not.toHaveBeenCalled();
    expect(d.verifyHuman).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({ auth_user_id: USER });
  });

  it("NF-012: deux clics en même temps : le second retrouve l'invité créé par le premier", async () => {
    const { client } = fakeAdmin({
      event: open,
      insert: { error: { code: "23505" } },
      refetch: { id: "guest-9", display_name: "Léa" },
    });
    expect(await joinEvent(deps(client), { userId: USER, ip: "x" }, input)).toEqual({
      ok: true,
      body: { guestId: "guest-9", displayName: "Léa", session: null },
    });
  });
});

describe("F-035: un invité qui revient", () => {
  it("F-035: est retrouvé, sans nouvelle ligne ni nouvelle date de conditions", async () => {
    const { client, calls } = fakeAdmin({
      event: open,
      guest: { id: "guest-1", display_name: "Léa", terms_accepted_at: "2026-10-01T00:00:00Z" },
    });
    const result = await joinEvent(deps(client), { userId: USER, ip: "x" }, input);
    expect(result).toEqual({
      ok: true,
      body: { guestId: "guest-1", displayName: "Léa", session: null },
    });
    expect(calls.some((c) => c.method === "insert" || c.method === "update")).toBe(false);
  });

  it("F-033: son prénom peut être modifié", async () => {
    const { client, calls } = fakeAdmin({
      event: open,
      guest: { id: "guest-1", display_name: "Léa", terms_accepted_at: "2026-10-01T00:00:00Z" },
    });
    const result = await joinEvent(
      deps(client),
      { userId: USER, ip: "x" },
      { ...input, displayName: "Léa M." },
    );
    expect(result).toMatchObject({ ok: true, body: { displayName: "Léa M." } });
    expect(calls.find((c) => c.method === "update")?.args[0]).toEqual({ display_name: "Léa M." });
  });

  it("F-034: des conditions jamais enregistrées le sont à ce passage", async () => {
    const { client, calls } = fakeAdmin({
      event: open,
      guest: { id: "guest-1", display_name: null, terms_accepted_at: null },
    });
    await joinEvent(deps(client), { userId: USER, ip: "x" }, input);
    expect(calls.find((c) => c.method === "update")?.args[0]).toMatchObject({
      terms_accepted_at: NOW.toISOString(),
      terms_version: "2026-10",
    });
  });
});

describe("F-017, S-006: code d'accès", () => {
  const protectedEvent = { id: EVENT, status: "active", settings: { access_code_hash: "" } };
  const withCode = () => ({ ...protectedEvent, settings: { access_code_hash: hash } });

  it("F-017: sans code défini, rien n'est demandé (un hachage vide ou absurde n'en définit pas)", async () => {
    for (const settings of [
      {},
      { access_code_hash: "" },
      { access_code_hash: null },
      { access_code_hash: 12 },
      null,
      [],
    ]) {
      const { client } = fakeAdmin({ event: { ...open, settings }, insert: created });
      const d = deps(client);
      expect(await joinEvent(d, { userId: null, ip: "x" }, input)).toMatchObject({ ok: true });
      expect(d.allowCodeAttempt).not.toHaveBeenCalled();
    }
  });

  it("F-017: avec un code défini, le code est obligatoire (403) et aucune session n'est ouverte", async () => {
    const { client } = fakeAdmin({ event: withCode(), insert: created });
    const d = deps(client);
    expect(await joinEvent(d, { userId: null, ip: "x" }, input)).toEqual({
      ok: false,
      status: 403,
      code: "access_code_required",
    });
    expect(d.signInAnonymously).not.toHaveBeenCalled();
  });

  it("S-006: un mauvais code est refusé et ne crée ni session ni invité", async () => {
    const { client, calls } = fakeAdmin({ event: withCode(), insert: created });
    const d = deps(client);
    expect(await joinEvent(d, { userId: null, ip: "x" }, { ...input, accessCode: "0000" })).toEqual(
      {
        ok: false,
        status: 403,
        code: "access_code_invalid",
      },
    );
    expect(d.signInAnonymously).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("F-017: le bon code admet l'invité", async () => {
    const { client } = fakeAdmin({ event: withCode(), insert: created });
    expect(
      await joinEvent(deps(client), { userId: null, ip: "x" }, { ...input, accessCode: "4821" }),
    ).toMatchObject({ ok: true });
  });

  it("S-006: les tentatives sont comptées par adresse et par événement, et limitées (429)", async () => {
    const { client } = fakeAdmin({ event: withCode(), insert: created });
    const allow = vi.fn(async () => false);
    const result = await joinEvent(
      deps(client, { allowCodeAttempt: allow }),
      { userId: null, ip: "203.0.113.7" },
      { ...input, accessCode: "4821" },
    );
    expect(result).toEqual({ ok: false, status: 429, code: "rate_limited" });
    expect(allow).toHaveBeenCalledWith(`203.0.113.7:${EVENT}`);
  });

  it("F-017: un invité déjà admis n'a pas à ressaisir le code", async () => {
    const { client } = fakeAdmin({
      event: withCode(),
      guest: { id: "guest-1", display_name: null, terms_accepted_at: "2026-10-01T00:00:00Z" },
    });
    const d = deps(client);
    expect(await joinEvent(d, { userId: USER, ip: "x" }, input)).toMatchObject({ ok: true });
    expect(d.allowCodeAttempt).not.toHaveBeenCalled();
  });
});

describe("S-012: protection anti-robots à la création de session", () => {
  it("S-012: sans jeton valide, aucune session n'est créée", async () => {
    const { client } = fakeAdmin({ event: open, insert: created });
    const d = deps(client, { verifyHuman: vi.fn(async () => false) });
    expect(await joinEvent(d, { userId: null, ip: "x" }, input)).toEqual({
      ok: false,
      status: 403,
      code: "captcha_failed",
    });
    expect(d.signInAnonymously).not.toHaveBeenCalled();
  });

  it("S-012: transmet le jeton du navigateur à la vérification", async () => {
    const { client } = fakeAdmin({ event: open, insert: created });
    const d = deps(client);
    await joinEvent(d, { userId: null, ip: "x" }, { ...input, turnstileToken: "token-1" });
    expect(d.verifyHuman).toHaveBeenCalledWith("token-1");
  });
});

describe("refus généraux", () => {
  it("un événement inconnu est introuvable, un événement suspendu ou en suppression est fermé", async () => {
    expect(
      await joinEvent(deps(fakeAdmin({ event: null }).client), { userId: null, ip: "x" }, input),
    ).toEqual({
      ok: false,
      status: 404,
      code: "not_found",
    });
    for (const status of ["suspended", "pending_deletion"]) {
      const { client } = fakeAdmin({ event: { ...open, status } });
      expect(await joinEvent(deps(client), { userId: null, ip: "x" }, input)).toEqual({
        ok: false,
        status: 403,
        code: "event_suspended",
      });
    }
  });

  it("une session anonyme qui échoue donne une erreur interne, sans invité", async () => {
    const { client, calls } = fakeAdmin({ event: open, insert: created });
    const d = deps(client, { signInAnonymously: vi.fn(async () => null) });
    expect(await joinEvent(d, { userId: null, ip: "x" }, input)).toEqual({
      ok: false,
      status: 500,
      code: "internal_error",
    });
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("retrouve l'invité d'un événement pour la page invité", async () => {
    const { client } = fakeAdmin({ guest: { id: "guest-1", display_name: "Léa" } });
    expect(await getGuestOfEvent(client, EVENT, USER)).toEqual({
      id: "guest-1",
      displayName: "Léa",
      notifyEmail: null,
    });
    expect(await getGuestOfEvent(fakeAdmin({ guest: null }).client, EVENT, USER)).toBeNull();
  });
});
