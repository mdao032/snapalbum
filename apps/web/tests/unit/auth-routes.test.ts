import { describe, expect, it } from "vitest";
import { hasSupabaseSessionCookie, protectedAreaOf } from "@/lib/auth-routes";

describe("F-001: pages protégées", () => {
  it("F-001: Mon compte est réservé aux organisateurs, dans les deux langues", () => {
    expect(protectedAreaOf("/account")).toBe("app");
    expect(protectedAreaOf("/en/account")).toBe("app");
    expect(protectedAreaOf("/account/delete")).toBe("app");
    expect(protectedAreaOf("/events")).toBe("app");
    expect(protectedAreaOf("/en/events/new")).toBe("app");
  });

  it("F-001: l'administration est une zone à part", () => {
    expect(protectedAreaOf("/admin")).toBe("admin");
    expect(protectedAreaOf("/en/admin/users")).toBe("admin");
  });

  it("F-001: l'accueil, la connexion et les pages voisines restent publiques", () => {
    for (const path of ["/", "/en", "/login", "/en/login", "/accounting", "/administrator"]) {
      expect(protectedAreaOf(path)).toBeNull();
    }
  });

  it("F-001: reconnaît le cookie de session Supabase, y compris découpé en morceaux", () => {
    expect(hasSupabaseSessionCookie(["theme", "sb-127-auth-token"])).toBe(true);
    expect(hasSupabaseSessionCookie(["sb-127-auth-token.0", "sb-127-auth-token.1"])).toBe(true);
    expect(hasSupabaseSessionCookie(["theme", "NEXT_LOCALE"])).toBe(false);
    expect(hasSupabaseSessionCookie([])).toBe(false);
  });
});
