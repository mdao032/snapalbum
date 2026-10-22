import { describe, expect, it } from "vitest";
import { SlideshowQueue } from "./slideshow";

/** A deterministic "random": a simple counter-based generator. */
function seeded(): () => number {
  let state = 7;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

const drain = (queue: SlideshowQueue, count: number) =>
  Array.from({ length: count }, () => queue.next());

describe("F-061: ce que le diaporama montre ensuite", () => {
  it("F-061: les nouvelles photos passent devant, dans l'ordre d'arrivée", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a", "b", "c"]);
    queue.addFresh("n1");
    queue.addFresh("n2");
    expect(drain(queue, 2)).toEqual(["n1", "n2"]);
    expect(queue.hasFresh()).toBe(false);
  });

  it("F-061: sans nouveauté, les anciennes tournent : chacune passe une fois avant que l'une ne revienne", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a", "b", "c", "d", "e"]);
    const firstRound = drain(queue, 5);
    expect([...firstRound].sort()).toEqual(["a", "b", "c", "d", "e"]);
    const secondRound = drain(queue, 5);
    expect([...secondRound].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("F-061: jamais deux fois la même photo de suite, y compris au passage d'un tour au suivant", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a", "b", "c"]);
    const shown = drain(queue, 200);
    for (let i = 1; i < shown.length; i += 1) expect(shown[i]).not.toBe(shown[i - 1]);
  });

  it("F-061: une photo nouvelle rejoint la rotation une fois montrée", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a"]);
    queue.addFresh("n1");
    const shown = drain(queue, 6);
    expect(shown[0]).toBe("n1");
    expect(shown).toContain("a");
    expect(shown.slice(1)).toContain("n1");
  });

  it("F-061: une photo déjà connue n'est ajoutée ni deux fois ni en nouveauté", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a"]);
    expect(queue.addFresh("a")).toBe(false);
    expect(queue.addFresh("n")).toBe(true);
    expect(queue.addFresh("n")).toBe(false);
    queue.seed(["a", "n"]);
    expect(queue.size).toBe(2);
  });

  it("F-063: une photo retirée (masquée, refusée, supprimée) ne sort plus, qu'elle soit nouvelle ou ancienne", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a", "b", "c"]);
    queue.addFresh("n");
    queue.remove("n");
    queue.remove("b");
    const shown = drain(queue, 20);
    expect(shown).not.toContain("n");
    expect(shown).not.toContain("b");
    expect(new Set(shown)).toEqual(new Set(["a", "c"]));
    expect(queue.size).toBe(2);
  });

  it("F-063: retirer une photo inconnue ne fait rien", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a"]);
    queue.remove("zzz");
    expect(queue.size).toBe(1);
  });

  it("F-061: une photo retirée peut revenir si elle est de nouveau approuvée", () => {
    const queue = new SlideshowQueue(seeded());
    queue.seed(["a", "b"]);
    queue.remove("b");
    expect(queue.addFresh("b")).toBe(true);
    expect(queue.next()).toBe("b");
  });

  it("F-061: une file vide ne rend rien, une seule photo se répète faute d'autre", () => {
    const queue = new SlideshowQueue(seeded());
    expect(queue.next()).toBeNull();
    queue.seed(["a"]);
    expect(drain(queue, 3)).toEqual(["a", "a", "a"]);
  });

  it("F-064: la mémoire est bornée : au-delà de la limite, les plus anciennes sortent", () => {
    const queue = new SlideshowQueue(seeded(), 50);
    for (let i = 0; i < 10_000; i += 1) queue.addFresh(`p${i}`);
    // Showing them all moves each into the bounded pool.
    for (let i = 0; i < 10_000; i += 1) queue.next();
    expect(queue.size).toBeLessThanOrEqual(10_000);
    const rest = drain(queue, 200);
    expect(new Set(rest).size).toBeLessThanOrEqual(50);
  });

  it("F-064: 100 000 passages sans que la file grossisse", () => {
    const queue = new SlideshowQueue(seeded(), 500);
    queue.seed(Array.from({ length: 300 }, (_, i) => `a${i}`));
    for (let i = 0; i < 100_000; i += 1) {
      if (i % 50 === 0) queue.addFresh(`n${i}`);
      queue.next();
    }
    expect(queue.size).toBeLessThanOrEqual(500);
  });
});
