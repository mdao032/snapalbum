import { describe, expect, it } from "vitest";
import {
  BETA_CODE_ALPHABET,
  BETA_CODE_LENGTH,
  formatBetaCode,
  generateBetaCode,
  normalizeBetaCode,
} from "./index";

describe("6.1: codes d'invitation de la bêta", () => {
  it("6.1: un code a dix caractères de l'alphabet sans caractères ambigus", () => {
    const code = generateBetaCode((max) => Math.floor(Math.random() * max));
    expect(code).toHaveLength(BETA_CODE_LENGTH);
    expect([...code].every((character) => BETA_CODE_ALPHABET.includes(character))).toBe(true);
    for (const ambiguous of ["0", "O", "1", "I", "L"]) {
      expect(BETA_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("6.1: la source aléatoire détermine le code, de la première à la dernière lettre", () => {
    expect(generateBetaCode(() => 0)).toBe("AAAAAAAAAA");
    expect(generateBetaCode((max) => max - 1)).toBe("9999999999");
  });

  it("6.1: l'affichage est en deux groupes de cinq et se relit en code", () => {
    expect(formatBetaCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(normalizeBetaCode(formatBetaCode("ABCDEFGHJK"))).toBe("ABCDEFGHJK");
  });

  it("6.1: la saisie tolère minuscules, espaces et tirets", () => {
    expect(normalizeBetaCode(" abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizeBetaCode("abcde-fghjk")).toBe("ABCDEFGHJK");
  });

  it("6.1: une saisie qui ne peut pas être un code est refusée sans requête", () => {
    expect(normalizeBetaCode("")).toBeNull();
    expect(normalizeBetaCode("ABCDEFGHJ")).toBeNull();
    expect(normalizeBetaCode("ABCDEFGHJKM")).toBeNull();
    expect(normalizeBetaCode("ABCDE0GHJK")).toBeNull();
    expect(normalizeBetaCode("ABCDEFGHJ€")).toBeNull();
  });
});
