/**
 * The measurements a dungeon wall face is laid out by, shared by the wall
 * painter and the face dressing painted onto it. In tiles throughout.
 */

import type { RGB } from '../../map/tilegen/raster';
import { WALL_FACE_RISE_TILES } from '../../map/dungeon/wallLight';

/** A face is two tiles tall: its lower tile at the floor, its upper tile above. */
export const FACE_STRIP_ROWS = 2;
/**
 * Wall top showing above the cap in an upper-face tile. What is left of the two
 * tiles is the face itself, a little over one and a half tiles: taller than Carl,
 * which is what stops it reading as a kerb.
 */
export const WALL_TOP_TILES = FACE_STRIP_ROWS - WALL_FACE_RISE_TILES;
/** The cap: the lit top edge of the wall seen from above. About 3.5 px at 32 px a tile. */
export const CAP_TILES = 0.11;
/** Where the face below the cap begins. */
export const BODY_TOP_TILES = WALL_TOP_TILES + CAP_TILES;
/** The return where a face turns away at a doorway or a stub's end. */
export const JAMB_TILES = 0.08;
/** The lit arris where a face turns into its jamb. */
export const ARRIS_TILES = 0.03;
/**
 * How far in from an open side anything hung on a face must stop, so the jamb
 * and its arris always show: both rounded up to whole pixels at the game's size.
 */
export const JAMB_CLEARANCE_TILES = 0.13;

export type Side = 'west' | 'east';

export function rgba(color: RGB, alpha: number): string {
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha})`;
}
