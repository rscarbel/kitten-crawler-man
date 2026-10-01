/**
 * The cellars' furniture as map data: which tile types it is, which of them
 * are solid, which are seen past, and which carry a light.
 *
 * Grouped here so every registry that has to know about them — walkability,
 * sight, the two decoration passes, the floor probe — spreads one set rather
 * than listing a dozen types. A two-tile piece is laid on the grid the way the
 * service level's are: an anchor on its south-west tile and a part tile beside
 * it (see `serviceLevelProps.ts`).
 */

import {
  BOTTLE_RACK,
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  CLAY_URN,
  FALLEN_BEAM,
  GLOW_FUNGUS,
  GRAIN_SACK,
  RUBBLE_HEAP,
  RUBBLE_SLOPE,
  SARCOPHAGUS,
  SPEAR_RACK,
  STRAW_SCATTER,
  WINE_CASK,
} from './tileTypes';

/** Solid cellar pieces, every one drawn whole from its anchor in the Y-sorted pass. */
export const CELLAR_SOLID_TILE_TYPES: ReadonlySet<number> = new Set([
  CLAY_URN,
  GRAIN_SACK,
  WINE_CASK,
  BOTTLE_RACK,
  CELLAR_TABLE,
  SPEAR_RACK,
  RUBBLE_HEAP,
  RUBBLE_SLOPE,
  FALLEN_BEAM,
  SARCOPHAGUS,
]);

/**
 * Walkable pieces that still stand up off the floor — a candle flame, a
 * fungus cap — and so are drawn in the Y-sorted pass, where a crawler walking
 * north of one is drawn behind it.
 */
export const CELLAR_STANDING_DECAL_TILE_TYPES: ReadonlySet<number> = new Set([
  CANDLE_CLUSTER,
  GLOW_FUNGUS,
]);

/** Walkable floor dressing baked flat into the floor's chunks. */
export const CELLAR_FLAT_DECAL_TILE_TYPES: ReadonlySet<number> = new Set([STRAW_SCATTER]);

/** Every cellar tile the Y-sorted overlay pass draws. */
export const CELLAR_OVERLAY_TILE_TYPES: ReadonlySet<number> = new Set([
  ...CELLAR_SOLID_TILE_TYPES,
  ...CELLAR_STANDING_DECAL_TILE_TYPES,
]);

/** Every cellar tile type the tile renderer paints. */
export const CELLAR_TILE_TYPES: ReadonlySet<number> = new Set([
  ...CELLAR_OVERLAY_TILE_TYPES,
  ...CELLAR_FLAT_DECAL_TILE_TYPES,
]);

/**
 * Solid pieces low enough to see and shoot past. Only the bottle rack, a
 * shelf of glass standing taller than Carl, hides what is behind it; a spear
 * rack is mostly gaps.
 */
export const CELLAR_SIGHT_TRANSPARENT_TILE_TYPES: ReadonlySet<number> = new Set(
  [...CELLAR_SOLID_TILE_TYPES].filter((type) => type !== BOTTLE_RACK),
);

/**
 * Pieces that carry a light — a candle's flame, a table's candle stub, the
 * fungus's glow — and so are left out of a room rolled as unlit.
 */
export const CELLAR_LIGHT_CARRYING_TILE_TYPES: ReadonlySet<number> = new Set([
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  GLOW_FUNGUS,
]);

/**
 * Pieces standing against a north face that climb up over it, so the face
 * column behind one carries no dressing of its own.
 */
export const FACE_CLIMBING_PROP_TILE_TYPES: ReadonlySet<number> = new Set([
  BOTTLE_RACK,
  SPEAR_RACK,
]);
