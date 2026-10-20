import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "../schemas";
import { flattenMessageKeys, messages } from "./index";

describe("section 12: traductions", () => {
  it("les clés existent à l'identique en français et en anglais", () => {
    expect(flattenMessageKeys(messages.en).sort()).toEqual(flattenMessageKeys(messages.fr).sort());
  });

  it("aucune traduction n'est vide", () => {
    const check = (tree: unknown): void => {
      if (typeof tree === "string") {
        expect(tree.trim().length).toBeGreaterThan(0);
      } else if (typeof tree === "object" && tree !== null) {
        Object.values(tree).forEach(check);
      }
    };
    check(messages.fr);
    check(messages.en);
  });

  it("chaque code d'erreur de l'API est traduit dans les deux langues", () => {
    for (const locale of ["fr", "en"] as const) {
      for (const code of API_ERROR_CODES) {
        expect(messages[locale].apiErrors[code]).toBeTruthy();
      }
    }
  });
});
