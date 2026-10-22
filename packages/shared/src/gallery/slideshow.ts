/**
 * What the live slideshow shows next (F-061): new photos first, in the order they arrived, then
 * the older ones in a shuffled round, never the same photo twice in a row. Holds only identifiers,
 * bounded, so it can run for a whole evening without growing (F-064). Pure and testable: the page
 * feeds it from the album and from Realtime, and asks it for the next photo.
 */
export class SlideshowQueue {
  private readonly fresh: string[] = [];
  /** Older photos, oldest known first. */
  private pool: string[] = [];
  private known = new Set<string>();
  private round: string[] = [];
  private last: string | null = null;

  constructor(
    private readonly random: () => number = Math.random,
    /** The pool keeps at most this many photos: the oldest go first. */
    private readonly poolLimit: number = 500,
  ) {}

  /** A photo that just arrived: it is shown before the older ones. Known photos are ignored. */
  addFresh(id: string): boolean {
    if (this.known.has(id)) return false;
    this.known.add(id);
    this.fresh.push(id);
    return true;
  }

  /** Photos already in the album, for the rotation. Known photos are ignored. */
  seed(ids: readonly string[]): void {
    for (const id of ids) {
      if (this.known.has(id)) continue;
      this.known.add(id);
      this.pool.push(id);
    }
    this.trim();
  }

  /** A photo that must not be shown any more (hidden, rejected, deleted). */
  remove(id: string): void {
    if (!this.known.delete(id)) return;
    const freshAt = this.fresh.indexOf(id);
    if (freshAt >= 0) this.fresh.splice(freshAt, 1);
    this.pool = this.pool.filter((other) => other !== id);
    this.round = this.round.filter((other) => other !== id);
    if (this.last === id) this.last = null;
  }

  /** Whether a new photo is waiting. */
  hasFresh(): boolean {
    return this.fresh.length > 0;
  }

  /** Photos the queue can still show. */
  get size(): number {
    return this.known.size;
  }

  /** The next photo to show, or null when there is none. */
  next(): string | null {
    const id = this.fresh.shift() ?? this.nextFromRound();
    if (id === null) return null;
    // A shown photo joins the rotation, so it comes back later.
    if (!this.pool.includes(id)) {
      this.pool.push(id);
      this.trim();
    }
    this.last = id;
    return id;
  }

  private nextFromRound(): string | null {
    if (this.round.length === 0) this.round = this.shuffled();
    // Never the photo that was just shown, unless it is the only one.
    const index = this.round.findIndex((id) => id !== this.last);
    if (index < 0) return this.round.length > 0 ? (this.round.shift() ?? null) : null;
    return this.round.splice(index, 1)[0] ?? null;
  }

  private shuffled(): string[] {
    const copy = [...this.pool];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  private trim(): void {
    while (this.pool.length > this.poolLimit) {
      const dropped = this.pool.shift();
      if (dropped !== undefined) {
        this.known.delete(dropped);
        this.round = this.round.filter((id) => id !== dropped);
      }
    }
  }
}
