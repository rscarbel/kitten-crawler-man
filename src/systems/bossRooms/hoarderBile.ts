/**
 * How the Hoarder's bile travels through her lair.
 *
 * The bolus is lobbed, not shot: it arcs over her junk and comes down on the
 * far side. Only the room's structure stops it — walls, the edge of the map —
 * because if every heap stopped bile, every heap would be cover, and a crawler
 * could sit out her whole fight behind one.
 */

import type { GameMap } from '../../map/GameMap';
import { HOARD_BAG, HOARD_PILE, HOARD_TOWER } from '../../map/tileTypes';

const HOARD_JUNK_TYPES: ReadonlySet<number> = new Set([HOARD_PILE, HOARD_TOWER, HOARD_BAG]);

/** Whether a tile is her junk: solid to walk into, but low enough to lob over. */
export function isHoardJunk(gameMap: GameMap, tileX: number, tileY: number): boolean {
  const row = tileY >= 0 && tileY < gameMap.structure.length ? gameMap.structure[tileY] : undefined;
  if (row === undefined || tileX < 0 || tileX >= row.length) return false;
  return HOARD_JUNK_TYPES.has(row[tileX].type);
}

/** Whether a bolus flying into this tile ends there: anything solid that is not her junk. */
export function stopsBile(gameMap: GameMap, tileX: number, tileY: number): boolean {
  return !gameMap.isWalkable(tileX, tileY) && !isHoardJunk(gameMap, tileX, tileY);
}

/** How high over its shadow a bolus flies at the start and end of its flight. */
const BILE_LOB_FLOOR_PX = 10;
/** The extra height at the top of the arc. */
const BILE_LOB_ARC_PX = 14;

/**
 * How far above its own shadow a bolus is drawn, `age` frames into a flight of
 * at most `lifetime`. Always off the ground: the height is what says it will
 * clear the junk, and the shadow beneath it is where it actually is.
 */
export function bileLobHeight(age: number, lifetime: number): number {
  const progress = Math.min(1, age / lifetime);
  return BILE_LOB_FLOOR_PX + BILE_LOB_ARC_PX * Math.sin(progress * Math.PI);
}

const BILE_SHADOW_RX_PX = 7;
const BILE_SHADOW_RY_PX = 3;
const BILE_SHADOW = 'rgba(20,14,6,0.45)';

/** The bolus's shadow on the floor: where it really is, and where it will land. */
export function drawBileShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = BILE_SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y, BILE_SHADOW_RX_PX, BILE_SHADOW_RY_PX, 0, 0, Math.PI * 2);
  ctx.fill();
}
