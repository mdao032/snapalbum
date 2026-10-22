// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_ID_KEY,
  createAnalytics,
  pageviewProperties,
} from "../../public/consent/analytics.js";
import {
  CONSENT_KEY,
  CONSENT_MAX_AGE_MS,
  parseConsent,
  readConsent,
  serializeConsent,
  writeConsent,
} from "../../public/consent/consent.js";
import { getAnalyticsConfig, POSTHOG_EU_HOST } from "@/server/analytics-config";

const NOW = Date.UTC(2026, 9, 22, 12);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("G-003: choix sur les cookies", () => {
  it("un choix enregistré se relit tel quel", () => {
    expect(parseConsent(serializeConsent("accepted", NOW), NOW)).toEqual({
      choice: "accepted",
      at: NOW,
    });
    expect(parseConsent(serializeConsent("refused", NOW), NOW)?.choice).toBe("refused");
  });

  it("sans choix, ou avec une valeur abîmée, on redemande", () => {
    const damaged = [
      null,
      "",
      "pas du json",
      "null",
      "[]",
      '{"choice":"oui","at":1}',
      '{"choice":"accepted"}',
    ];
    for (const raw of damaged) expect(parseConsent(raw, NOW)).toBeNull();
  });

  it("le choix est redemandé après six mois, jamais avant", () => {
    const old = serializeConsent("accepted", NOW - CONSENT_MAX_AGE_MS - 1);
    const recent = serializeConsent("accepted", NOW - CONSENT_MAX_AGE_MS + 1000);
    expect(parseConsent(old, NOW)).toBeNull();
    expect(parseConsent(recent, NOW)?.choice).toBe("accepted");
  });

  it("une date dans le futur est refusée", () => {
    expect(parseConsent(serializeConsent("accepted", NOW + 3_600_000), NOW)).toBeNull();
  });

  it("lecture et écriture passent par le stockage du navigateur", () => {
    const storage = memoryStorage();
    expect(readConsent(NOW, storage)).toBeNull();
    writeConsent("refused", NOW, storage);
    expect(storage.data.has(CONSENT_KEY)).toBe(true);
    expect(readConsent(NOW, storage)?.choice).toBe("refused");
  });

  it("un stockage bloqué ne fait jamais échouer la page : pas de choix, donc rien n'est mesuré", () => {
    expect(readConsent(NOW, blocked)).toBeNull();
    expect(() => writeConsent("accepted", NOW, blocked)).not.toThrow();
    expect(readConsent(NOW, null)).toBeNull();
  });
});

describe("G-003, SPEC 15: mesure d'audience", () => {
  const options = { key: "phc_test", host: "https://eu.i.posthog.com/" };

  it("rien n'est envoyé tant que la mesure n'a pas démarré", () => {
    const send = vi.fn();
    const analytics = createAnalytics({ ...options, send, storage: memoryStorage() });
    analytics.track("$pageview");
    expect(send).not.toHaveBeenCalled();
    expect(analytics.isRunning()).toBe(false);
  });

  it("après accord, un événement part vers l'adresse européenne avec la clé et la plateforme", () => {
    const send = vi.fn();
    const storage = memoryStorage();
    const analytics = createAnalytics({ ...options, send, storage, newId: () => "visiteur-1" });
    analytics.start();
    analytics.track("event_created", { plan: "free" });

    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0] as [string, string];
    expect(url).toBe("https://eu.i.posthog.com/capture/");
    expect(JSON.parse(body)).toMatchObject({
      api_key: "phc_test",
      event: "event_created",
      distinct_id: "visiteur-1",
      properties: { plan: "free", platform: "web", $lib: "snapalbum-web" },
    });
    expect(storage.data.get(ANALYTICS_ID_KEY)).toBe("visiteur-1");
  });

  it("le même visiteur garde le même identifiant, aléatoire et sans lien avec une personne", () => {
    const send = vi.fn();
    let count = 0;
    const analytics = createAnalytics({
      ...options,
      send,
      storage: memoryStorage(),
      newId: () => `id-${(count += 1)}`,
    });
    analytics.start();
    analytics.track("a");
    analytics.track("b");
    const ids = send.mock.calls.map(([, body]) => JSON.parse(body as string).distinct_id);
    expect(ids).toEqual(["id-1", "id-1"]);
  });

  it("changer d'avis arrête les envois et efface l'identifiant", () => {
    const send = vi.fn();
    const storage = memoryStorage();
    const analytics = createAnalytics({ ...options, send, storage });
    analytics.start();
    analytics.track("a");
    analytics.stop();
    analytics.track("b");
    expect(send).toHaveBeenCalledTimes(1);
    expect(storage.data.has(ANALYTICS_ID_KEY)).toBe(false);
    expect(analytics.isRunning()).toBe(false);
  });

  it("un stockage bloqué ne casse pas la mesure", () => {
    const send = vi.fn();
    const analytics = createAnalytics({ ...options, send, storage: blocked, newId: () => "tmp" });
    analytics.start();
    expect(() => analytics.track("a")).not.toThrow();
    expect(() => analytics.stop()).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("une page vue ne contient que l'adresse de la page, jamais de paramètres", () => {
    expect(pageviewProperties({ origin: "https://exemple.test", pathname: "/pricing" })).toEqual({
      $current_url: "https://exemple.test/pricing",
      $host: "exemple.test",
      $pathname: "/pricing",
    });
  });
});

describe("G-003, G-002: configuration de la mesure", () => {
  const saved = {
    key: process.env.POSTHOG_KEY,
    host: process.env.POSTHOG_HOST,
  };

  afterEach(() => {
    for (const [name, value] of [
      ["POSTHOG_KEY", saved.key],
      ["POSTHOG_HOST", saved.host],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("sans clé, pas de mesure et donc pas de bandeau", () => {
    delete process.env.POSTHOG_KEY;
    expect(getAnalyticsConfig()).toBeNull();
  });

  it("avec une clé, l'adresse européenne est celle par défaut", () => {
    process.env.POSTHOG_KEY = "phc_x";
    delete process.env.POSTHOG_HOST;
    expect(getAnalyticsConfig()).toEqual({ key: "phc_x", host: POSTHOG_EU_HOST });
    process.env.POSTHOG_HOST = "https://autre.exemple.test";
    expect(getAnalyticsConfig()?.host).toBe("https://autre.exemple.test");
  });
});
