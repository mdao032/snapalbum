import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./share-url";

const TOKEN = "a".repeat(32);

describe("F-054: adresse d'un lien de partage", () => {
  it("F-054: pas de préfixe de langue pour le français, /en pour l'anglais", () => {
    expect(buildShareUrl("https://snapalbum.test", TOKEN, "fr")).toBe(
      `https://snapalbum.test/g/${TOKEN}`,
    );
    expect(buildShareUrl("https://snapalbum.test", TOKEN, "en")).toBe(
      `https://snapalbum.test/en/g/${TOKEN}`,
    );
  });

  it("F-054: une adresse de base qui finit par une barre ne double pas la barre", () => {
    expect(buildShareUrl("http://localhost:3000/", TOKEN, "fr")).toBe(
      `http://localhost:3000/g/${TOKEN}`,
    );
  });
});
