import type { TileContent } from '../tileTypes';
import {
  HOARD_PILE,
  HOARD_TOWER,
  HOARD_BAG,
  HOARD_RUBBLE,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  GYM_TREADMILL_BELT,
  KRAKAREN_WADE,
  KRAKAREN_TANK,
  KRAKAREN_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  LAB_WEB,
  ARENA_MUD,
} from '../tileTypes';
import { drawHoarderTile } from './bossRooms/hoarderTiles';
import { drawGymTile } from './bossRooms/gymTiles';
import { drawKrakarenTile } from './bossRooms/krakarenTiles';
import { drawLabTile } from './bossRooms/labTiles';
import { drawColosseumTile } from './bossRooms/colosseumTiles';

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
    drawHoarderTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawGymTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawKrakarenTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawLabTile(ctx, structure, type, sx, sy, ts, tx, ty) ||
    drawColosseumTile(ctx, structure, type, sx, sy, ts, tx, ty)
  );
}

const BOSS_ROOM_MINIMAP_COLORS: ReadonlyMap<number, string> = new Map([
  [HOARD_PILE, '#4a3a22'],
  [HOARD_TOWER, '#5a4a2e'],
  [HOARD_BAG, '#34382c'],
  [HOARD_RUBBLE, '#3e3020'],
  [GYM_RACK, '#4a4a52'],
  [GYM_SQUAT_RACK, '#5a5a64'],
  [GYM_CABLE_STACK, '#5a5a64'],
  [GYM_TREADMILL_BELT, '#262626'],
  [KRAKAREN_WADE, '#1f4a60'],
  [KRAKAREN_TANK, '#3a8078'],
  [KRAKAREN_CONSOLE, '#4e5e68'],
  [LAB_BENCH, '#5a5048'],
  [LAB_SHELF, '#4a4038'],
  [LAB_WEB, '#9a9a92'],
  [ARENA_MUD, '#4e3824'],
]);

/**
 * The minimap colour of a boss-room dressing tile, or undefined for any other
 * type. Shared by both minimaps, which otherwise draw an unknown type grey.
 */
export function bossRoomMinimapColor(type: number): string | undefined {
  return BOSS_ROOM_MINIMAP_COLORS.get(type);
}
