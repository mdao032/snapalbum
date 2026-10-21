import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/server/client-ip";

const headers = (values: Record<string, string>) => new Headers(values);

describe("S-003: adresse du visiteur", () => {
  it("S-003: préfère l'en-tête posé par Vercel, qu'un visiteur ne peut pas falsifier", () => {
    expect(
      clientIpFrom(
        headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.9" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("S-003: sinon la première adresse de x-forwarded-for", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": " 198.51.100.9 , 10.0.0.1" }))).toBe(
      "198.51.100.9",
    );
  });

  it("S-003: sinon x-real-ip, sinon rien", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "192.0.2.4" }))).toBe("192.0.2.4");
    expect(clientIpFrom(headers({}))).toBeUndefined();
    expect(clientIpFrom(headers({ "x-forwarded-for": "  " }))).toBeUndefined();
  });
});
