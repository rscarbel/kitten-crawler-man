/**
 * Lets Briar Hollow's tile painters see the village's site record.
 *
 * A tile painter is handed the map's `structure` grid and a position, never the
 * `GameMap` — the same call shape every renderer in `src/map/tiles/` shares.
 * The village's walls need to know which side of them is indoors, and its crop
 * rows which crop a field was sown with; both are facts about the site, not
 * about any one tile. Rather than stamp a per-tile flag that could drift from
 * the site, the site is looked up by the grid it was painted onto.
 *
 * Keyed weakly on the grid, so a map that is thrown away takes its entry with
 * it, and two maps alive at once (a headless harness building several seeds)
 * never see each other's village.
 */

import type { TileContent } from '../tileTypes';
import type { BriarHollowSite } from '../overworld/briarHollowSite';

const sites = new WeakMap<TileContent[][], BriarHollowSite>();

/** Records the village painted onto `structure`. Called once, where the map is generated. */
export function registerBriarHollowSite(structure: TileContent[][], site: BriarHollowSite): void {
  sites.set(structure, site);
}

/** The village painted onto `structure`, if any. */
export function briarHollowSiteFor(structure: TileContent[][]): BriarHollowSite | undefined {
  return sites.get(structure);
}
