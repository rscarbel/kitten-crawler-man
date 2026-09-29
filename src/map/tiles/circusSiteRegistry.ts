/**
 * Lets the circus grounds' tile painters see the grounds' site record.
 *
 * A tile painter is handed the map's `structure` grid and a position, never the
 * `GameMap` — the same call shape every renderer in `src/map/tiles/` shares.
 * The grounds' decals (the vine runners, the wagon ruts, the stain by the cage
 * wagon) are placed off where the Big Top and the wagons stood, which is a
 * fact about the site rather than about any one tile, so the site is looked up
 * by the grid it was painted onto, as `hollowSiteRegistry.ts` does for Briar
 * Hollow.
 *
 * Keyed weakly on the grid, so a map that is thrown away takes its entry with
 * it, and two maps alive at once (a headless harness building several seeds)
 * never see each other's grounds.
 */

import type { TileContent } from '../tileTypes';
import type { CircusGroundsSite } from '../overworld/circusGroundsLayout';

/** The grounds painted onto one grid, and the one piece of quest state their ground art shows. */
export interface CircusGroundsRecord {
  readonly site: CircusGroundsSite;
  /**
   * Whether the vine runners have died back: once Grimaldi is redeemed the
   * vine that is Grimaldi lets go of the grounds, and the runners bake brown.
   */
  vinesWithered: boolean;
}

const records = new WeakMap<TileContent[][], CircusGroundsRecord>();

/** Records the grounds painted onto `structure`. Called once, where the map is generated. */
export function registerCircusGroundsSite(
  structure: TileContent[][],
  site: CircusGroundsSite,
): void {
  records.set(structure, { site, vinesWithered: false });
}

/** The grounds painted onto `structure`, if any. */
export function circusGroundsFor(structure: TileContent[][]): CircusGroundsRecord | undefined {
  return records.get(structure);
}
