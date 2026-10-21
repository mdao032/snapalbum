import { describe, expect, it } from "vitest";
import { hashAccessCode, verifyAccessCode } from "@/server/access-code";

describe("S-006: code d'accès haché", () => {
  it("S-006: le code n'apparaît jamais dans ce qui est stocké", async () => {
    const hash = await hashAccessCode("482915");
    expect(hash).not.toContain("482915");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("S-006: le bon code est reconnu, un autre non", async () => {
    const hash = await hashAccessCode("4821");
    expect(await verifyAccessCode("4821", hash)).toBe(true);
    for (const wrong of ["4822", "482", "48210", "", "0000", " 4821"]) {
      expect(await verifyAccessCode(wrong, hash)).toBe(false);
    }
  });

  it("S-006: deux hachages du même code diffèrent (sel aléatoire)", async () => {
    const [a, b] = await Promise.all([hashAccessCode("1234"), hashAccessCode("1234")]);
    expect(a).not.toBe(b);
    expect(await verifyAccessCode("1234", a)).toBe(true);
    expect(await verifyAccessCode("1234", b)).toBe(true);
  });

  it.each([
    ["rien", undefined],
    ["null", null],
    ["un nombre", 1234],
    ["une chaîne vide", ""],
    ["un format inconnu", "bcrypt$10$abc"],
    ["des morceaux manquants", "scrypt$16384$8$1$c2FsdA"],
    ["un hachage trop court", "scrypt$16384$8$1$c2FsdA==$YWJj"],
    ["un coût nul", "scrypt$0$8$1$c2FsdA==$" + "A".repeat(43) + "="],
    ["un coût qui gèlerait le serveur", "scrypt$1073741824$32$4$c2FsdA==$" + "A".repeat(43) + "="],
    ["un coût non numérique", "scrypt$x$8$1$c2FsdA==$" + "A".repeat(43) + "="],
  ])(
    "S-006: une valeur stockée corrompue (%s) n'accepte rien, sans jamais échouer",
    async (_label, stored) => {
      expect(await verifyAccessCode("1234", stored)).toBe(false);
    },
  );
});
