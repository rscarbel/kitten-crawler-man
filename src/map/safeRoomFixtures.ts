/**
 * Where a safe room's fixed furniture stands, as pure geometry.
 *
 * Lives in the map layer rather than in `SafeRoomSystem` because two things now
 * need it and the dependency has to run one way: `SafeRoomSystem` places
 * Mordecai and the bed here, and `safeRoomCounterLayout` has to keep the Bopca's
 * counter off the same tiles. The map layer has no other dependency on
 * `src/systems`, and pulling one in would drag both player classes along with it.
 */

/** How far off-centre Mordecai and the bed sit: a quarter of the room's width. */
const SAFE_ROOM_ANCHOR_HALFWIDTH_DIVISOR = 4;

/** A safe room, reduced to the two fields the fixture geometry depends on. */
export interface SafeRoomGeometry {
  bounds: { w: number };
  centre: { x: number; y: number };
}

/** The tiles Mordecai and the sleeping bed occupy, west first. */
export function mordecaiAndBedTiles(
  safeRoom: SafeRoomGeometry,
): [{ x: number; y: number }, { x: number; y: number }] {
  const halfWidth = Math.floor(safeRoom.bounds.w / SAFE_ROOM_ANCHOR_HALFWIDTH_DIVISOR);
  return [
    { x: safeRoom.centre.x - halfWidth, y: safeRoom.centre.y },
    { x: safeRoom.centre.x + halfWidth, y: safeRoom.centre.y },
  ];
}
