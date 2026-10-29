import type { TileContent } from '../tileTypes';
import {
  TRASH_PILE,
  TRASH_TOWER,
  TRASH_BAG,
  TRASH_RUBBLE,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  GYM_KETTLEBELL_RACK,
  GYM_TREADMILL_BELT,
  POWER_LAB_TANK,
  POWER_LAB_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  LAB_WEB,
} from '../tileTypes';
import { drawTrashGremlinTile } from './bossRooms/trashGremlinTiles';
import { drawGymTile } from './bossRooms/gymTiles';
import { drawPowerLabTile } from './bossRooms/powerLabTiles';
import { drawLabTile } from './bossRooms/labTiles';

/**
 * Paints any boss-room dressing tile, or returns false for a type that is not
 * one. Each room's painter lives in its own file so each room can change
 * without touching the others.
 */
export function drawBossRoomTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  return (
    drawTrashGremlinTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawGymTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawPowerLabTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawLabTile(ctx, structure, type, sx, sy, ts, tx, ty)
  );
}

const BOSS_ROOM_MINIMAP_COLORS: ReadonlyMap<number, string> = new Map([
  [TRASH_PILE, '#4a3a22'],
  [TRASH_TOWER, '#5a4a2e'],
  [TRASH_BAG, '#34382c'],
  [TRASH_RUBBLE, '#3e3020'],
  [GYM_RACK, '#4a4a52'],
  [GYM_SQUAT_RACK, '#5a5a64'],
  [GYM_CABLE_STACK, '#5a5a64'],
  [GYM_KETTLEBELL_RACK, '#4a4a52'],
  [GYM_TREADMILL_BELT, '#262626'],
  [POWER_LAB_TANK, '#3a8078'],
  [POWER_LAB_CONSOLE, '#4e5e68'],
  [LAB_BENCH, '#5a5048'],
  [LAB_SHELF, '#4a4038'],
  [LAB_WEB, '#9a9a92'],
]);

/**
 * The minimap colour of a boss-room dressing tile, or undefined for any other
 * type. Shared by both minimaps, which otherwise draw an unknown type grey.
 */
export function bossRoomMinimapColor(type: number): string | undefined {
  return BOSS_ROOM_MINIMAP_COLORS.get(type);
}
