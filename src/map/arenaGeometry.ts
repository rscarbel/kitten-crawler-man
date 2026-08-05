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
/**
 * Width of the concourse — the walkable ring carved just outside the arena wall.
 *
 * The whole circuit is walkable and the antechamber is the only gap in it, which is
 * the shape that makes the fight legible as *optional*: a crawler can walk the
 * entire way round a sealed iron drum, see the one door in it, and keep going.
 */
export const ARENA_RING_WIDTH = 2;
/** Rock kept around the arena structure so nothing else can touch its ring. */
export const ARENA_RESERVE_MARGIN = 1;

/**
 * How far the concourse reaches from the arena's centre — the outer edge of the ring.
 *
 * Exported because four things have to agree on it exactly: the ring carve, the seal
 * across the door row, the free-roam approach corridor's pivot, and the span solved
 * below. `ARENA_REACH` is a different number — it includes the reserved rock margin —
 * so this one had been recomputed at each site.
 */
export const ARENA_CONCOURSE_REACH = ARENA_RADIUS + ARENA_RING_WIDTH;

/**
 * How far the concourse still reaches sideways on the arena's own door row.
 *
 * The door row is the outermost row of the wall, so the ring's band there runs from
 * just outside the disc out to this — solved from the two radii rather than counted
 * off a picture, because everything below is positioned relative to it.
 */
const CONCOURSE_DOOR_ROW_SPAN = Math.floor(
  Math.sqrt(ARENA_CONCOURSE_REACH ** 2 - ARENA_RADIUS ** 2),
);

/**
 * Distance from the arena's centre column, in tiles, at which the concourse drops
 * down into the antechamber on each flank.
 *
 * A tile inside the ring's own reach on that row, so the walled stretch between them
 * and the door is as long as it can be while still leaving the ring's outermost
 * column sealed: between the door and these links the door row is
 * sealed, and that seal is the only thing stopping the concourse being a way *in*
 * rather than a way round. Derived so they cannot drift outside the band they have to
 * be inside — a link on rock carves nothing and orphans the ring.
 */
export const ARENA_CONCOURSE_LINK_OUTER_DX = CONCOURSE_DOOR_ROW_SPAN - 1;
export const ARENA_CONCOURSE_LINK_INNER_DX = ARENA_CONCOURSE_LINK_OUTER_DX - 1;

/**
 * Least width the antechamber may be.
 *
 * Wide enough to reach out under both concourse links, which is what joins the ring
 * to the safe room. Narrower and the ring's two ends dead-end against rock, leaving a
 * band of floor nothing can walk on — the exact failure `validateProgression`'s I6b
 * exists to catch, and the reason the outer ring used to be suppressed entirely.
 *
 * This also covers the ring's southern overhang, which reaches less far than the
 * links do on the row below the door, so one bound serves both.
 */
export const ARENA_ANTECHAMBER_MIN_WIDTH = ARENA_CONCOURSE_LINK_OUTER_DX * 2 + 1;

/**
 * Radius of the walkable interior — the floor the fight happens on.
 *
 * Shared rather than re-derived, because the boss caroms off a circle of this radius
 * while the generator carves the wall from it: the two have to be the same number or
 * the ball bounces off thin air, or halfway inside the ironwork.
 */
export const ARENA_INTERIOR_RADIUS_TILES = ARENA_RADIUS - ARENA_WALL_THICKNESS;

/** How far the arena's own ground reaches from its centre. */
export const ARENA_REACH = ARENA_CONCOURSE_REACH + ARENA_RESERVE_MARGIN;

/**
 * Columns the arena's south door occupies, relative to the arena's centre column.
 *
 * Shared because two things have to agree about it exactly: the generator cuts these
 * columns out of the wall, and the concourse seal walls off every *other* column of
 * the door row. Written out twice, narrowing the door would leave the seal skipping a
 * column it should have walled — putting concourse floor directly against the arena
 * door, which is the one bypass the seal exists to prevent.
 */
export const ARENA_DOOR_COLUMN_OFFSETS: readonly number[] = [-1, 0];

/** Tile the arena's south door opens through. */
export function arenaDoorTileAt(centre: Point): Point {
  return { x: centre.x, y: centre.y + ARENA_RADIUS };
}

/**
 * Columns the arena's north gate occupies, relative to the arena's centre column.
 *
 * A separate constant from the door's, even though the shape is identical today,
 * because the two openings serve different jobs — one is the fight's only entrance,
 * the other is a way off the ring into the beyond pocket — and nothing should force
 * them to stay the same width just because they started that way.
 */
export const ARENA_GATE_COLUMN_OFFSETS: readonly number[] = [-1, 0];

/**
 * Tile the arena's north gate opens through, diametrically opposite the door.
 *
 * Mirrors `arenaDoorTileAt`. Unlike the door, the gate never breaches the arena's
 * own wall — it only opens the reserve margin, joining the concourse ring to the
 * beyond pocket — so the drum stays enterable only through the south door.
 */
export function arenaGateTileAt(centre: Point): Point {
  return { x: centre.x, y: centre.y - ARENA_RADIUS };
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
