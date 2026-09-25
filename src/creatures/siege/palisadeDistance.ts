/**
 * How far every tile around Briar Hollow stands from its palisade, for a
 * creature that must keep its distance from the wall — the necromancer, who
 * commands from outside and never comes in.
 *
 * Built once per site by a breadth-first walk outward from the ring's own
 * tiles (the palisade and the gate), eight-connected, so a distance is the
 * number of king's moves to the nearest ring tile. It measures the ring as
 * generated: a breach is still ring for this purpose, because stepping into a
 * breach is stepping into the village.
 */

import { isInsideRing, type BriarHollowSite } from '../../map/overworld/briarHollowSite';

/** Past this many tiles from the ring nothing is measured: {@link PalisadeDistanceField.distanceAt} answers Infinity. */
export const PALISADE_DISTANCE_MARGIN_TILES = 24;

/** A tile strictly inside the ring. */
export const INSIDE_PALISADE = -1;

const UNREACHED = -2;

const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class PalisadeDistanceField {
  private readonly originX: number;
  private readonly originY: number;
  private readonly width: number;
  private readonly height: number;
  private readonly distances: Int16Array;

  constructor(site: BriarHollowSite) {
    const bounds = site.palisadeBounds;
    this.originX = bounds.x - PALISADE_DISTANCE_MARGIN_TILES;
    this.originY = bounds.y - PALISADE_DISTANCE_MARGIN_TILES;
    this.width = bounds.w + PALISADE_DISTANCE_MARGIN_TILES * 2;
    this.height = bounds.h + PALISADE_DISTANCE_MARGIN_TILES * 2;
    this.distances = new Int16Array(this.width * this.height).fill(UNREACHED);

    const queue: number[] = [];
    const seed = (tileX: number, tileY: number): void => {
      const index = this.indexOf(tileX, tileY);
      if (index === null || this.distances[index] === 0) return;
      this.distances[index] = 0;
      queue.push(index);
    };
    for (const tile of site.palisadePath) seed(tile.x, tile.y);
    for (const tile of site.gate.tiles) seed(tile.x, tile.y);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = y * this.width + x;
        if (this.distances[index] !== UNREACHED) continue;
        const relX = this.originX + x - bounds.x;
        const relY = this.originY + y - bounds.y;
        if (isInsideRing(relX, relY)) this.distances[index] = INSIDE_PALISADE;
      }
    }

    // The queue grows while it is walked; a for-of over an array visits what is pushed during it.
    for (const index of queue) {
      const x = index % this.width;
      const y = Math.floor(index / this.width);
      const next = this.distances[index] + 1;
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const neighbour = ny * this.width + nx;
        if (this.distances[neighbour] !== UNREACHED) continue;
        this.distances[neighbour] = next;
        queue.push(neighbour);
      }
    }
  }

  private indexOf(tileX: number, tileY: number): number | null {
    const x = tileX - this.originX;
    const y = tileY - this.originY;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return y * this.width + x;
  }

  /**
   * Tiles from the ring: 0 on it, {@link INSIDE_PALISADE} strictly inside it,
   * and Infinity past the measured margin.
   */
  distanceAt(tileX: number, tileY: number): number {
    const index = this.indexOf(tileX, tileY);
    if (index === null) return Infinity;
    const distance = this.distances[index];
    return distance === UNREACHED ? Infinity : distance;
  }

  /** Whether a tile is outside the ring by at least `minTiles`. */
  isOutsideBy(tileX: number, tileY: number, minTiles: number): boolean {
    const distance = this.distanceAt(tileX, tileY);
    return distance !== INSIDE_PALISADE && distance >= minTiles;
  }
}

const fieldsBySite = new WeakMap<BriarHollowSite, PalisadeDistanceField>();

/** The one distance field for `site`, built the first time anything asks. */
export function palisadeDistanceFor(site: BriarHollowSite): PalisadeDistanceField {
  const cached = fieldsBySite.get(site);
  if (cached !== undefined) return cached;
  const field = new PalisadeDistanceField(site);
  fieldsBySite.set(site, field);
  return field;
}
