// @vitest-environment node
import { APP_NAME, BRAND_COLORS } from "@snapalbum/shared/brand";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const template = readFileSync(
  fileURLToPath(new URL("../../../../supabase/templates/magic_link.html", import.meta.url)),
  "utf8",
);

describe("F-001: modèle de l'e-mail de connexion", () => {
  it("F-001: le lien de retour porte le jeton, pour fonctionner depuis n'importe quel appareil", () => {
    expect(template).toContain("{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email");
  });

  it("F-001: le nom et la couleur du produit suivent brand.ts (le modèle ne peut pas l'importer)", () => {
    expect(template).toContain(APP_NAME);
    expect(template.toLowerCase()).toContain(BRAND_COLORS.primary);
    expect(template.toLowerCase()).toContain(BRAND_COLORS.canvas);
  });

  it("section 12: existe en français et en anglais, le français étant la langue par défaut", () => {
    expect(template).toContain("Me connecter");
    expect(template).toContain("Sign in");
    expect(template).toMatch(/\{\{ if \.Data\.locale \}\}\{\{ if eq \.Data\.locale "en" \}\}/);
  });

  it("F-001: le même fichier sert à l'inscription et à la connexion (config locale)", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url)),
      "utf8",
    );
    for (const section of ["confirmation", "magic_link"]) {
      expect(config).toMatch(
        new RegExp(
          `\\[auth\\.email\\.template\\.${section}\\][^\\[]*content_path = "\\./supabase/templates/magic_link\\.html"`,
        ),
      );
    }
  });
});
