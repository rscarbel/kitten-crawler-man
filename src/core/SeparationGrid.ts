/**
 * A uniform grid rebuilt from scratch every frame, for finding which of a small
 * set of bodies are within a short radius of each other.
 *
 * Deliberately *not* `SpatialGrid`. That one is a persistent `Map` of `Set`s,
 * which is the right shape for what it does — long-lived membership, queries at
 * radii of many tiles — and the wrong shape here twice over. Its buckets hold
 * every mob on the level, so a one-tile query has to fetch and then reject
 * hundreds of bodies that were never candidates; and answering through a `Set`
 * costs a hash per candidate, which at this radius dwarfs the arithmetic the
 * hash was meant to save. Measured against the all-pairs loop it replaced, that
 * shape lost at every mob count the game reaches (`npm run bench:separation`).
 *
 * So this indexes only the bodies handed to it, into flat integer arrays: `head`
 * gives the first body in a cell, `next` chains the rest, and both are reused
 * across frames. Lookup is an array read. Nothing is allocated once the buffers
 * are big enough, and because the index is thrown away each frame there is no
 * membership to keep in sync with the world — the drift bug that mirroring
 * inserts and removes into a second persistent grid would have invited cannot
 * happen here.
 */

/** Sentinel for "no body" in the `head`/`next` chains. */
const NO_BODY = -1;

/**
 * Ceiling on cells per body. Bodies bunched near two distant players span a
 * bounding box far larger than their count justifies, and the per-frame `fill`
 * that clears `head` is charged per cell — so past this ratio the grid coarsens
 * its cells instead, trading a few more candidates per lookup for a clear that
 * stays proportional to the roster.
 */
export const MAX_CELLS_PER_BODY = 8;

/**
 * Floor on how much each coarsening round may grow a cell.
 *
 * The natural correction is the square root of the overshoot, which collapses to
 * nothing when the layout lands only just over budget: a 1% overshoot asks for a
 * 0.5% larger cell, `Math.floor` drops no cell at all, and the round repeats
 * having changed nothing measurable. Sweeping realistic rosters that way reaches
 * 72 rounds — on the hot path, only once the roster is large enough for the grid
 * to be in use at all, and varying frame to frame as mobs drift. A floor makes
 * each round shrink the count geometrically, which lands it in single digits.
 */
const MIN_COARSEN_GROWTH = 1.25;

export class SeparationGrid<T extends { readonly x: number; readonly y: number }> {
  private bodies: readonly T[] = [];
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  private cellSize = 1;
  private originX = 0;
  private originY = 0;
  private cellsX = 0;
  private cellsY = 0;
  /** How many cells out from a body's own the query radius can reach. */
  private cellSpan = 1;
  private candidateBuffer = new Int32Array(0);

  /**
   * Indexes `bodies` for neighbour lookups out to `radius`. Positions are read
   * once here, so nothing may move until the next rebuild.
   */
  build(bodies: readonly T[], radius: number): void {
    this.bodies = bodies;
    const bodyCount = bodies.length;
    if (bodyCount === 0) {
      this.cellsX = 0;
      this.cellsY = 0;
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const body of bodies) {
      if (body.x < minX) minX = body.x;
      if (body.x > maxX) maxX = body.x;
      if (body.y < minY) minY = body.y;
      if (body.y > maxY) maxY = body.y;
    }

    let cellSize = radius;
    let cellsX = Math.floor((maxX - minX) / cellSize) + 1;
    let cellsY = Math.floor((maxY - minY) / cellSize) + 1;
    const cellBudget = bodyCount * MAX_CELLS_PER_BODY;
    // Repeated rather than one scaling step: the correction is derived from the
    // cell *count*, but each axis also carries a +1 for its partial cell, so a
    // long thin bounding box (a corridor's worth of mobs, all on one row) can
    // still sit well over budget after a single pass. `MIN_COARSEN_GROWTH` is
    // what keeps the repetition cheap; one cell on each axis is always inside
    // the budget, so it terminates.
    while (cellsX * cellsY > cellBudget) {
      cellSize *= Math.max(MIN_COARSEN_GROWTH, Math.sqrt((cellsX * cellsY) / cellBudget));
      cellsX = Math.floor((maxX - minX) / cellSize) + 1;
      cellsY = Math.floor((maxY - minY) / cellSize) + 1;
    }

    this.cellSize = cellSize;
    this.originX = minX;
    this.originY = minY;
    this.cellsX = cellsX;
    this.cellsY = cellsY;
    this.cellSpan = Math.ceil(radius / cellSize);

    const cellCount = cellsX * cellsY;
    if (this.head.length < cellCount) this.head = new Int32Array(cellCount);
    if (this.next.length < bodyCount) this.next = new Int32Array(bodyCount);
    // A lookup can turn up every other body, and never more than that.
    if (this.candidateBuffer.length < bodyCount) this.candidateBuffer = new Int32Array(bodyCount);
    this.head.fill(NO_BODY, 0, cellCount);

    // Chained head-first, so a cell's bodies come back in descending index
    // order. Order within a cell does not matter: the caller sums forces.
    for (let i = 0; i < bodyCount; i++) {
      const cell = this.cellIndexOf(bodies[i]);
      this.next[i] = this.head[cell];
      this.head[cell] = i;
    }
  }

  private cellIndexOf(body: T): number {
    const gx = Math.floor((body.x - this.originX) / this.cellSize);
    const gy = Math.floor((body.y - this.originY) / this.cellSize);
    return gy * this.cellsX + gx;
  }

  /**
   * Cells the last {@link build} laid out. Exposed so a harness can check that
   * the coarsening kept the per-frame clear proportional to the roster — an
   * overshoot there costs memory and frame time without changing any result, so
   * nothing else would catch it.
   */
  get cellCount(): number {
    return this.cellsX * this.cellsY;
  }

  /**
   * Body indices written by the last {@link collectCandidates} call, valid up
   * to the count that call returned.
   *
   * Exposed as the grid's own buffer rather than filled into one the caller
   * passes: a plain `number[]` costs about twice as much to fill as this typed
   * array does, and at this radius that difference moves the crossover with the
   * all-pairs loop by tens of mobs.
   *
   * Only `build` may ever reassign the underlying array. Callers hold this
   * reference across a whole pass, so growing it from inside a lookup would
   * leave them reading a buffer nothing writes to any more — and silently, since
   * the stale one is still the right length.
   */
  get candidates(): Int32Array {
    return this.candidateBuffer;
  }

  /**
   * Finds the bodies in the cells reaching the query radius around `bodyIndex`,
   * writing them into {@link candidates} and returning how many there are.
   *
   * Candidates, not results: cells are square and the radius is round, so this
   * over-reports and never under-reports. `bodyIndex` itself is excluded. The
   * caller measures the real distance anyway to size the force, so filtering
   * twice would only cost.
   */
  collectCandidates(bodyIndex: number): number {
    const body = this.bodies[bodyIndex];
    const gx = Math.floor((body.x - this.originX) / this.cellSize);
    const gy = Math.floor((body.y - this.originY) / this.cellSize);
    const span = this.cellSpan;
    const firstX = Math.max(0, gx - span);
    const lastX = Math.min(this.cellsX - 1, gx + span);
    const firstY = Math.max(0, gy - span);
    const lastY = Math.min(this.cellsY - 1, gy + span);
    const out = this.candidateBuffer;
    let found = 0;
    for (let cellY = firstY; cellY <= lastY; cellY++) {
      const rowStart = cellY * this.cellsX;
      for (let cellX = firstX; cellX <= lastX; cellX++) {
        let candidate = this.head[rowStart + cellX];
        while (candidate !== NO_BODY) {
          if (candidate !== bodyIndex) {
            out[found] = candidate;
            found++;
          }
          candidate = this.next[candidate];
        }
      }
    }
    return found;
  }
}
