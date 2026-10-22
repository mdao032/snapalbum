import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../../public/consent/entry.js";

const page = {
  cookiesHref: "/legal/cookies",
  texts: {
    title: "Votre choix sur les cookies",
    text: "Texte.",
    more: "En savoir plus",
    refuse: "Refuser",
    accept: "Accepter",
  },
};

const answer = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

let controller: { destroy: () => void } | null = null;

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = `
    <script type="application/json" id="consent-config">${JSON.stringify(page)}</script>
    <button type="button" data-manage-cookies hidden>Gérer les cookies</button>`;
});

afterEach(() => {
  controller?.destroy();
  controller = null;
});

const manage = () => document.querySelector<HTMLElement>("[data-manage-cookies]")!;
const banner = () => document.querySelector("[data-testid=consent-banner]");

describe("G-003: démarrage du bandeau", () => {
  it("avec une mesure configurée : le lien de gestion apparaît et le bandeau s'ouvre", async () => {
    const fetcher = answer(200, { key: "phc_test", host: "https://eu.i.posthog.com" });
    controller = await boot({ fetcher });
    expect(fetcher).toHaveBeenCalledWith("/api/analytics-config", { credentials: "omit" });
    expect(manage().hidden).toBe(false);
    expect(banner()).not.toBeNull();
  });

  it("sans mesure (204) : ni bandeau, ni lien de gestion", async () => {
    controller = await boot({ fetcher: answer(204) });
    expect(controller).toBeNull();
    expect(manage().hidden).toBe(true);
    expect(banner()).toBeNull();
  });

  it("une réponse abîmée, une panne ou une page sans configuration ne montrent rien", async () => {
    expect(await boot({ fetcher: answer(200, { key: 3 }) })).toBeNull();
    expect(await boot({ fetcher: answer(200, "pas un objet") })).toBeNull();
    expect(
      await boot({
        fetcher: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    ).toBeNull();
    document.body.innerHTML = "";
    expect(await boot({ fetcher: answer(200, { key: "k", host: "h" }) })).toBeNull();
    expect(banner()).toBeNull();
  });

  it("une configuration de page illisible ne fait rien", async () => {
    document.getElementById("consent-config")!.textContent = "{pas du json";
    const fetcher = answer(200, { key: "k", host: "h" });
    expect(await boot({ fetcher })).toBeNull();
    expect(banner()).toBeNull();
  });
});
