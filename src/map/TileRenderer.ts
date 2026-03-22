import {
  TileContent,
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
} from './tileTypes';

import { drawTerrainTile } from './tiles/terrainTiles';
import { drawSpecialFloorTile } from './tiles/specialFloorTiles';
import { drawBuildingTile } from './tiles/buildingTiles';
import { drawDecorationTile } from './tiles/decorationTiles';
import { drawInteriorTile } from './tiles/interiorTiles';

/**
 * Draws a single tile. Dispatches to category-specific renderers.
 *
 * When `baseOnly` is true, decoration tiles that extend above their bounds
 * only draw their ground fill — the full visual is drawn later via the
 * decorations overlay so entities appear behind tall structures.
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly = false,
) {
  // In the first (ground) pass, decorations that extend above tile bounds only
  // draw their base fill so entities rendered between passes appear behind them.
  if (baseOnly) {
    // Delegate base-only drawing to category renderers — they handle baseOnly internally
    if (drawBuildingTile(ctx, structure, type, sx, sy, ts, tx, ty, true)) return;
    if (drawDecorationTile(ctx, structure, type, sx, sy, ts, tx, ty, true)) return;
    return;
  }

  // Try each category renderer in turn — first match wins
  if (drawTerrainTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
  if (drawSpecialFloorTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
  if (drawBuildingTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
  if (drawDecorationTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
  if (drawInteriorTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
}

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
): void {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const ts = tileHeight;
  const startX = Math.max(0, Math.floor(cameraX / ts));
  const startY = Math.max(0, Math.floor(cameraY / ts));
  const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts));
  const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts));

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      // Decorations that should appear above entities are drawn as base-only
      // here; the full visual is drawn in renderDecorationsOverlay after entities.
      const isDecoration =
        tile.type === TORCH ||
        tile.type === WELL ||
        tile.type === TREE ||
        tile.type === FOUNTAIN ||
        tile.type === BUILDING_WALL ||
        tile.type === ROOF_THATCH ||
        tile.type === ROOF_SLATE ||
        tile.type === ROOF_RED ||
        tile.type === ROOF_GREEN ||
        tile.type === ROOF_CIRCUS_RED ||
        tile.type === ROOF_CIRCUS_BLUE ||
        tile.type === ROOF_CIRCUS_PURPLE;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, isDecoration);
    }
  }
}

/**
 * Draws a single decoration tile at full fidelity (used for z-sorted rendering).
 */
export function drawDecorationTileFull(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  ts: number,
): void {
  drawTile(ctx, structure, structure[ty][tx].type, sx, sy, ts, tx, ty, false);
}

/**
 * Second render pass: draws the full visuals for tall decoration tiles
 * (TORCH, WELL, TREE, FOUNTAIN) on top of entities so they correctly occlude
 * characters walking near them from any direction.
 */
export function renderDecorationsOverlay(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
): void {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const ts = tileHeight;
  const startX = Math.max(0, Math.floor(cameraX / ts));
  const startY = Math.max(0, Math.floor(cameraY / ts));
  const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts));
  const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts));

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      if (
        tile.type !== TORCH &&
        tile.type !== WELL &&
        tile.type !== TREE &&
        tile.type !== FOUNTAIN &&
        tile.type !== BUILDING_WALL &&
        tile.type !== ROOF_THATCH &&
        tile.type !== ROOF_SLATE &&
        tile.type !== ROOF_RED &&
        tile.type !== ROOF_GREEN &&
        tile.type !== ROOF_CIRCUS_RED &&
        tile.type !== ROOF_CIRCUS_BLUE &&
        tile.type !== ROOF_CIRCUS_PURPLE
      )
        continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, false);
    }
  }
}
