import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("@/server/storage");
}

const R2 = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "snapalbum-media",
};

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  for (const name of [...Object.keys(R2), "R2_ENDPOINT", "R2_JURISDICTION"]) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("G-002: configuration du stockage", () => {
  it("G-002: vise par défaut la juridiction UE de R2", async () => {
    for (const [name, value] of Object.entries(R2)) vi.stubEnv(name, value);
    const { storageConfigFromEnv } = await load();
    expect(storageConfigFromEnv()).toMatchObject({
      endpoint: "https://acc123.eu.r2.cloudflarestorage.com",
      bucket: "snapalbum-media",
      forcePathStyle: false,
    });
  });

  it("G-002: la juridiction par défaut de Cloudflare se choisit explicitement", async () => {
    for (const [name, value] of Object.entries(R2)) vi.stubEnv(name, value);
    vi.stubEnv("R2_JURISDICTION", "default");
    const { storageConfigFromEnv } = await load();
    expect(storageConfigFromEnv().endpoint).toBe("https://acc123.r2.cloudflarestorage.com");
  });

  it("un émulateur local s'indique par R2_ENDPOINT, avec des adresses de type chemin", async () => {
    vi.stubEnv("R2_ENDPOINT", "http://127.0.0.1:9100");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "test");
    const { storageConfigFromEnv } = await load();
    expect(storageConfigFromEnv()).toMatchObject({
      endpoint: "http://127.0.0.1:9100",
      forcePathStyle: true,
    });
  });

  it("S-007: un réglage manquant donne une erreur claire plutôt qu'un échec obscur", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "acc123");
    const { storageConfigFromEnv } = await load();
    expect(() => storageConfigFromEnv()).toThrow(/Storage is not configured/);
  });

  it("S-007: refuse une juridiction inconnue", async () => {
    for (const [name, value] of Object.entries(R2)) vi.stubEnv(name, value);
    vi.stubEnv("R2_JURISDICTION", "moon");
    const { storageConfigFromEnv } = await load();
    expect(() => storageConfigFromEnv()).toThrow(/R2_JURISDICTION/);
  });

  it("le stockage de l'application est créé une seule fois", async () => {
    for (const [name, value] of Object.entries(R2)) vi.stubEnv(name, value);
    const { getStorage } = await load();
    expect(getStorage()).toBe(getStorage());
  });
});
