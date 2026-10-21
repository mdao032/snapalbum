import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RULE = { name: "test", limit: 3, windowSeconds: 60 };

async function load() {
  vi.resetModules();
  return import("@/server/rate-limit");
}

function upstashReply(count: number, ttl = 42): Response {
  return new Response(JSON.stringify([{ result: count }, { result: 1 }, { result: ttl }]));
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("S-003: limitation de débit sans Upstash (repli en mémoire)", () => {
  it("S-003: refuse à partir de la tentative suivant la limite", async () => {
    const { checkRateLimit } = await load();
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await checkRateLimit(RULE, "203.0.113.7"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("S-003: compte chaque adresse séparément", async () => {
    const { checkRateLimit } = await load();
    for (let i = 0; i < 4; i += 1) await checkRateLimit(RULE, "203.0.113.7");
    expect((await checkRateLimit(RULE, "203.0.113.8")).allowed).toBe(true);
  });

  it("S-003: repart de zéro quand la fenêtre est écoulée", async () => {
    const { checkRateLimit } = await load();
    let now = 1_000_000;
    for (let i = 0; i < 4; i += 1) await checkRateLimit(RULE, "ip", { now: () => now });
    expect((await checkRateLimit(RULE, "ip", { now: () => now })).allowed).toBe(false);
    now += 61_000;
    expect((await checkRateLimit(RULE, "ip", { now: () => now })).allowed).toBe(true);
  });

  it("S-003: annonce en production que la limite ne tient que par instance, une seule fois", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkRateLimit } = await load();
    await checkRateLimit(RULE, "a");
    await checkRateLimit(RULE, "b");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("S-003: la règle de connexion est de 5 tentatives par 15 minutes", async () => {
    const { LOGIN_RATE_LIMIT } = await load();
    expect(LOGIN_RATE_LIMIT).toMatchObject({ limit: 5, windowSeconds: 900 });
  });
});

describe("S-003: limitation de débit avec Upstash", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  });

  it("S-003: compte via le pipeline REST sans jamais envoyer l'adresse IP en clair", async () => {
    const { checkRateLimit } = await load();
    const fetcher = vi.fn().mockResolvedValue(upstashReply(2, 40));
    const result = await checkRateLimit(RULE, "203.0.113.7", { fetcher });

    expect(result).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 40 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.example.test/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
    expect(String(init.body)).not.toContain("203.0.113.7");
    expect(JSON.parse(String(init.body))[0][0]).toBe("INCR");
  });

  it("S-003: refuse quand le compteur dépasse la limite", async () => {
    const { checkRateLimit } = await load();
    const fetcher = vi.fn().mockResolvedValue(upstashReply(4));
    const result = await checkRateLimit(RULE, "ip", { fetcher });
    expect(result).toMatchObject({ allowed: false, remaining: 0 });
  });

  it.each([
    ["une réponse en erreur", () => new Response("nope", { status: 500 })],
    ["une réponse inattendue", () => new Response(JSON.stringify([{ error: "ERR" }]))],
  ])("S-003: bascule sur le repli en mémoire après %s", async (_label, reply) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await load();
    const fetcher = vi.fn().mockResolvedValue(reply());
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await checkRateLimit(RULE, "ip", { fetcher }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it("S-003: bascule sur le repli en mémoire quand Upstash est injoignable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await load();
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    expect((await checkRateLimit(RULE, "ip", { fetcher })).allowed).toBe(true);
  });
});
