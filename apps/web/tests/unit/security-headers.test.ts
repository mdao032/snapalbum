import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/config/security-headers";

const valueOf = (rule: (typeof securityHeaders)[number], key: string) =>
  rule.headers.find((header) => header.key === key)?.value;

describe("S-004: en-têtes de sécurité de base", () => {
  it("S-004: chaque règle pose les quatre en-têtes communs", () => {
    expect(securityHeaders).toHaveLength(2);
    for (const rule of securityHeaders) {
      expect(valueOf(rule, "X-Content-Type-Options")).toBe("nosniff");
      expect(valueOf(rule, "X-Frame-Options")).toBe("DENY");
      expect(valueOf(rule, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(valueOf(rule, "Strict-Transport-Security")).toMatch(/^max-age=\d+$/);
    }
  });

  it("S-004: la caméra est interdite partout sauf sur les pages invité", () => {
    const [everywhere, guest] = securityHeaders;
    expect(valueOf(everywhere!, "Permissions-Policy")).toContain("camera=()");
    expect(valueOf(guest!, "Permissions-Policy")).toContain("camera=(self)");
    for (const rule of securityHeaders) {
      expect(valueOf(rule, "Permissions-Policy")).toContain("geolocation=()");
    }
  });

  it("S-004: les deux règles se partagent les chemins sans se chevaucher", () => {
    const [everywhere, guest] = securityHeaders;
    expect(everywhere!.source).toContain("(?!");
    expect(guest!.source).not.toContain("(?!");
  });
});
