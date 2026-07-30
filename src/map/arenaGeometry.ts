/**
 * The shape of the arena on the ground.
 *
 * Its own module because two parties have to agree on it exactly: the generator,
 * which carves the structure and reserves the rock it stands on, and the
 * progression validator, which has to block precisely that ground when checking
 * the floor survives without the arena. Widening the ring in one and not the
 * other would silently stop the check proving anything.
 */

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Radius of the arena disc, wall included. */
export const ARENA_RADIUS = 15;
/** Thickness of the metal wall around the arena's rim. */
export const ARENA_WALL_THICKNESS = 2;
/** Walkable ring carved just outside the arena wall, in tiles. */
export const ARENA_RING_WIDTH = 2;
/** Rock kept around the arena structure so nothing else can touch its ring. */
export const ARENA_RESERVE_MARGIN = 1;

/** How far the arena's own ground reaches from its centre. */
export const ARENA_REACH = ARENA_RADIUS + ARENA_RING_WIDTH + ARENA_RESERVE_MARGIN;

/** Tile the arena's south door opens through. */
export function arenaDoorTileAt(centre: Point): Point {
  return { x: centre.x, y: centre.y + ARENA_RADIUS };
}

/**
 * The ground the arena structure occupies.
 *
 * Stops at the door row rather than being a symmetric square: everything south of
 * that row belongs to the antechamber and the ordinary free region, so claiming
 * it would sterilise usable ground in the generator and over-block the flood in
 * the validator.
 */
export function arenaReserveRect(centre: Point): Rect {
  return {
    x: centre.x - ARENA_REACH,
    y: centre.y - ARENA_REACH,
    w: ARENA_REACH * 2 + 1,
    h: ARENA_REACH + ARENA_RADIUS + 1,
  };
}
