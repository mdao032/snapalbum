import { PLANS } from "@snapalbum/shared/plans";
import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/plan-format";

/** Intl separates number and unit with a narrow no-break space. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("F-045: les durées affichées viennent de plans.ts", () => {
  it("30 secondes restent des secondes, 3 minutes sont des minutes", () => {
    expect(plain(formatDuration(PLANS.free.maxVideoSeconds, "fr"))).toBe("30 s");
    expect(plain(formatDuration(PLANS.event.maxVideoSeconds, "fr"))).toBe("3 min");
    expect(plain(formatDuration(PLANS.free.maxVideoSeconds, "en"))).toBe("30 sec");
    expect(plain(formatDuration(PLANS.event.maxVideoSeconds, "en"))).toBe("3 min");
  });

  it("une durée qui n'est pas un nombre entier de minutes reste en secondes", () => {
    expect(plain(formatDuration(90, "fr"))).toBe("90 s");
    expect(plain(formatDuration(45, "fr"))).toBe("45 s");
  });
});
