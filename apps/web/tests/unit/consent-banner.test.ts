import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountConsent } from "../../public/consent/banner.js";
import { ANALYTICS_ID_KEY } from "../../public/consent/analytics.js";
import { CONSENT_KEY, serializeConsent } from "../../public/consent/consent.js";

const config = {
  key: "phc_test",
  host: "https://eu.i.posthog.com",
  cookiesHref: "/legal/cookies",
  texts: {
    title: "Votre choix sur les cookies",
    text: "Le site utilise des cookies nécessaires. <b>Refuser ne change rien.</b>",
    more: "En savoir plus",
    refuse: "Refuser",
    accept: "Accepter",
  },
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const banner = () => document.querySelector<HTMLElement>("[data-testid=consent-banner]");
const button = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  ) as HTMLElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let fetchMock: ReturnType<typeof vi.fn>;
let controller: { destroy: () => void } | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  vi.unstubAllGlobals();
});

const mount = (storage = memoryStorage()) => {
  controller = mountConsent({ config, storage });
  return storage;
};

describe("G-003: bandeau de cookies", () => {
  it("sans choix, le bandeau apparaît, rien n'est envoyé ni enregistré", async () => {
    const storage = mount();
    await tick();
    expect(banner()).not.toBeNull();
    expect(banner()?.querySelector("h2")?.textContent).toBe("Votre choix sur les cookies");
    expect(banner()?.querySelector("a")?.getAttribute("href")).toBe("/legal/cookies");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it("« Refuser » et « Accepter » sont deux boutons identiques", () => {
    mount();
    expect(button("Refuser").className).toBe(button("Accepter").className);
    expect(button("Refuser").className).toContain("min-h-11");
    expect(button("Refuser").getAttribute("type")).toBe("button");
  });

  it("les textes sont posés comme du texte, jamais comme du HTML", () => {
    mount();
    expect(banner()?.querySelector("p b")).toBeNull();
    expect(banner()?.textContent).toContain("<b>Refuser ne change rien.</b>");
  });

  it("refuser enregistre le choix, ferme le bandeau et n'envoie jamais rien", async () => {
    const storage = mount();
    button("Refuser").click();
    expect(banner()).toBeNull();
    expect(JSON.parse(storage.data.get(CONSENT_KEY) ?? "{}").choice).toBe("refused");
    window.history.pushState({}, "", "/pricing");
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.data.has(ANALYTICS_ID_KEY)).toBe(false);
  });

  it("accepter lance la mesure : une page vue tout de suite, une par page ensuite, sans paramètre", async () => {
    const storage = mount();
    button("Accepter").click();
    expect(banner()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/capture/");
    expect(init.credentials).toBe("omit");
    const first = JSON.parse(init.body as string);
    expect(first).toMatchObject({
      api_key: "phc_test",
      event: "$pageview",
      properties: { platform: "web", $pathname: "/" },
    });

    window.history.pushState({}, "", "/pricing?secret=1");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.properties.$pathname).toBe("/pricing");
    expect(JSON.stringify(second)).not.toContain("secret");
    expect(second.distinct_id).toBe(first.distinct_id);
    expect(storage.data.get(ANALYTICS_ID_KEY)).toBe(first.distinct_id);

    // The same page twice counts once.
    window.history.replaceState({}, "", "/pricing#tarifs");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un choix déjà accepté démarre la mesure sans bandeau ; refusé, rien", () => {
    mount(memoryStorage({ [CONSENT_KEY]: serializeConsent("accepted", Date.now()) }));
    expect(banner()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller?.destroy();

    fetchMock.mockClear();
    mount(memoryStorage({ [CONSENT_KEY]: serializeConsent("refused", Date.now()) }));
    expect(banner()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un choix de plus de six mois est redemandé", () => {
    const old = serializeConsent("accepted", Date.now() - 200 * 24 * 3600 * 1000);
    mount(memoryStorage({ [CONSENT_KEY]: old }));
    expect(banner()).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("« Gérer les cookies » rouvre le bandeau ; refuser arrête la mesure et efface l'identifiant", async () => {
    document.body.innerHTML =
      '<button type="button" data-manage-cookies>Gérer les cookies</button>';
    const storage = mount(
      memoryStorage({ [CONSENT_KEY]: serializeConsent("accepted", Date.now()) }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.data.has(ANALYTICS_ID_KEY)).toBe(true);

    document.querySelector<HTMLElement>("[data-manage-cookies]")?.click();
    expect(banner()).not.toBeNull();
    expect(document.activeElement?.id).toBe("consent-title");

    button("Refuser").click();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("[data-manage-cookies]"));
    expect(storage.data.has(ANALYTICS_ID_KEY)).toBe(false);

    window.history.pushState({}, "", "/pricing");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("avec un stockage bloqué, le bandeau se ferme quand même et rien n'est gardé", () => {
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
    controller = mountConsent({ config, storage: blocked });
    expect(banner()).not.toBeNull();
    button("Refuser").click();
    expect(banner()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("démonter remet l'historique du navigateur tel qu'il était", () => {
    const { pushState, replaceState } = window.history;
    mount();
    expect(window.history.pushState).not.toBe(pushState);
    controller?.destroy();
    controller = null;
    expect(window.history.pushState).toBe(pushState);
    expect(window.history.replaceState).toBe(replaceState);
    expect(banner()).toBeNull();
  });
});
