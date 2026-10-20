import { describe, expect, it } from "vitest";
import { PLANS, PLAN_IDS, formatPrice, getPlan, isPaidPlan } from "./plans";

describe("section 3: offres", () => {
  it("expose les trois offres avec les quotas de départ", () => {
    expect(getPlan("free").maxMedia).toBe(200);
    expect(getPlan("event").maxMedia).toBe(10_000);
    expect(getPlan("event").priceCents).toBe(4900);
  });

  it("R2: seules les offres payantes conservent les originaux", () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id].keepsOriginals).toBe(isPaidPlan(id));
    }
  });

  it("F-045: l'offre gratuite affiche la mention visible, l'offre Pro n'en a aucune", () => {
    expect(PLANS.free.watermark).toBe("visible");
    expect(PLANS.pro.watermark).toBe("none");
  });

  it("formate les prix selon la langue", () => {
    expect(formatPrice(4900, "fr")).toMatch(/^49\s€$/u);
    expect(formatPrice(4900, "en")).toBe("€49");
    expect(formatPrice(1950, "en")).toBe("€19.50");
  });
});
