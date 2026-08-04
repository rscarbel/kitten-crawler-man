/**
 * Stride the x cell coordinate is multiplied by when the two are packed into one
 * key, and so the width of the y window that packs without collisions.
 *
 * Negative world positions are safe here, on two counts that `verify-separation`
 * pins down. `cx * RANGE + cy` is injective over *any* 100,000-wide window of
 * `cy`, so -50,000 to 49,999 is as sound as 0 to 99,999; and even a genuine
 * collision would only put two cells in one bucket, which costs a few extra
 * candidates and nothing else, because every query re-tests what it pulls out.
 */
const CELL_COORD_RANGE = 100000;

/** Generic spatial hash grid. T needs x, y in pixel-space. */
export class SpatialGrid<T extends { x: number; y: number }> {
  private readonly cs: number; // cell size in pixels
  private readonly cells = new Map<number, Set<T>>();

  constructor(cellSize: number) {
    this.cs = cellSize;
  }

  private key(cx: number, cy: number): number {
    return cx * CELL_COORD_RANGE + cy;
  }

  private cellOf(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cs), Math.floor(y / this.cs)];
  }

  insert(entity: T): void {
    const [cx, cy] = this.cellOf(entity.x, entity.y);
    const k = this.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = new Set<T>();
      this.cells.set(k, cell);
    }
    cell.add(entity);
  }

  remove(entity: T): void {
    const [cx, cy] = this.cellOf(entity.x, entity.y);
    this.cells.get(this.key(cx, cy))?.delete(entity);
  }

  /**
   * Call this after moving an entity from (oldX, oldY) to its new position.
   * A no-op if the entity is still in the same grid cell.
   */
  move(entity: T, oldX: number, oldY: number): void {
    const ocx = Math.floor(oldX / this.cs);
    const ocy = Math.floor(oldY / this.cs);
    const [cx, cy] = this.cellOf(entity.x, entity.y);
    if (ocx === cx && ocy === cy) return; // same cell — nothing to do
    this.cells.get(this.key(ocx, ocy))?.delete(entity);
    const k = this.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = new Set<T>();
      this.cells.set(k, cell);
    }
    cell.add(entity);
  }

  /**
   * Return all entities within `radius` pixels of (cx, cy).
   * Pass an existing Set to merge results (useful for union queries without extra allocation).
   */
  queryCircle(cx: number, cy: number, radius: number, out = new Set<T>()): Set<T> {
    const cs = this.cs;
    const minCX = Math.floor((cx - radius) / cs);
    const maxCX = Math.floor((cx + radius) / cs);
    const minCY = Math.floor((cy - radius) / cs);
    const maxCY = Math.floor((cy + radius) / cs);
    const rSq = radius * radius;
    for (let gy = minCY; gy <= maxCY; gy++) {
      for (let gx = minCX; gx <= maxCX; gx++) {
        const bucket = this.cells.get(this.key(gx, gy));
        if (!bucket) continue;
        for (const e of bucket) {
          const dx = e.x - cx;
          const dy = e.y - cy;
          if (dx * dx + dy * dy <= rSq) out.add(e);
        }
      }
    }
    return out;
  }

  /**
   * Return all entities whose position falls inside the given pixel rectangle
   * [x, x+w) × [y, y+h).  Useful for viewport culling.
   */
  queryRect(x: number, y: number, w: number, h: number, out: T[] = []): T[] {
    const cs = this.cs;
    const minCX = Math.floor(x / cs);
    const maxCX = Math.floor((x + w) / cs);
    const minCY = Math.floor(y / cs);
    const maxCY = Math.floor((y + h) / cs);
    const x2 = x + w;
    const y2 = y + h;
    for (let gy = minCY; gy <= maxCY; gy++) {
      for (let gx = minCX; gx <= maxCX; gx++) {
        const bucket = this.cells.get(this.key(gx, gy));
        if (!bucket) continue;
        for (const e of bucket) {
          if (e.x >= x && e.x < x2 && e.y >= y && e.y < y2) out.push(e);
        }
      }
    }
    return out;
  }
}
