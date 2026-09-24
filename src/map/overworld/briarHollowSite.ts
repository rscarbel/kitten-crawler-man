/**
 * Briar Hollow's placement on the floor-3 overworld: where the village sits
 * and how big its palisade footprint is.
 *
 * A minimal placeholder. The siting, palisade ring, gate and district layout
 * are generated elsewhere; this type only carries the footprint other systems
 * need to know about before that generator exists — whether a tile falls
 * inside the village, and where its bounds are for camera and spawn checks.
 */

import type { TilePoint } from '../town/townPlan';

/** Briar Hollow's site on the overworld map, in tile coordinates. */
export interface BriarHollowSite {
  /** Centre of the palisade ring. */
  readonly centre: TilePoint;
  /** Half-width and half-height of the palisade's bounding rectangle, in tiles. */
  readonly halfWidthTiles: number;
  readonly halfHeightTiles: number;
}
