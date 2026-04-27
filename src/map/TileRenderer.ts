import type { TileContent } from './tileTypes';
import {
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

const CHUNK_TILES = 16;

/** Set of tile types that are drawn base-only in the ground pass. */
const DECORATION_TYPES = new Set([
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
]);

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

/**
 * Lazily-populated chunk cache: pre-renders CHUNK_TILES×CHUNK_TILES blocks of
 * static base tiles to offscreen canvases. Animated decoration overlays are
 * NOT cached — they're drawn separately in the overlay pass.
 */
export class TileChunkCache {
  private chunks = new Map<number, OffscreenCanvas | HTMLCanvasElement>();
  private chunksX: number;
  private chunksY: number;

  constructor(
    private structure: TileContent[][],
    private ts: number,
  ) {
    const rows = structure.length;
    const cols = structure[0]?.length ?? rows;
    this.chunksX = Math.ceil(cols / CHUNK_TILES);
    this.chunksY = Math.ceil(rows / CHUNK_TILES);
  }

  private getChunk(cx: number, cy: number): OffscreenCanvas | HTMLCanvasElement {
    const key = cy * this.chunksX + cx;
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;

    const ts = this.ts;
    const structure = this.structure;
    const rows = structure.length;
    const cols = structure[0]?.length ?? rows;

    const tileX0 = cx * CHUNK_TILES;
    const tileY0 = cy * CHUNK_TILES;
    const tileX1 = Math.min(tileX0 + CHUNK_TILES, cols);
    const tileY1 = Math.min(tileY0 + CHUNK_TILES, rows);
    const pw = (tileX1 - tileX0) * ts;
    const ph = (tileY1 - tileY0) * ts;

    if (typeof OffscreenCanvas !== 'undefined') {
      chunk = new OffscreenCanvas(pw, ph);
    } else {
      chunk = document.createElement('canvas');
      chunk.width = pw;
      chunk.height = ph;
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-non-null-assertion
    const cctx = chunk.getContext('2d')! as CanvasRenderingContext2D;

    for (let y = tileY0; y < tileY1; y++) {
      for (let x = tileX0; x < tileX1; x++) {
        const tile = structure[y][x];
        const sx = (x - tileX0) * ts;
        const sy = (y - tileY0) * ts;
        const isDecoration = DECORATION_TYPES.has(tile.type);
        drawTile(cctx, structure, tile.type, sx, sy, ts, x, y, isDecoration);
      }
    }

    this.chunks.set(key, chunk);
    return chunk;
  }

  renderVisible(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    const ts = this.ts;
    const chunkPx = CHUNK_TILES * ts;

    const cx0 = Math.max(0, Math.floor(cameraX / chunkPx));
    const cy0 = Math.max(0, Math.floor(cameraY / chunkPx));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((cameraX + viewW) / chunkPx));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((cameraY + viewH) / chunkPx));

    // Floor the camera-relative offset once so all chunks share the same
    // sub-pixel alignment — prevents hairline gaps between adjacent chunks.
    const baseX = Math.floor(-cameraX);
    const baseY = Math.floor(-cameraY);

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.getChunk(cx, cy);
        const dx = baseX + cx * chunkPx;
        const dy = baseY + cy * chunkPx;
        ctx.drawImage(chunk, dx, dy);
      }
    }
  }
}

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
  chunkCache?: TileChunkCache,
): void {
  if (chunkCache) {
    chunkCache.renderVisible(ctx, cameraX, cameraY, viewW, viewH);
    return;
  }

  // Fallback: draw tiles directly (used when no cache is available)
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
      const isDecoration = DECORATION_TYPES.has(tile.type);
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
      if (!DECORATION_TYPES.has(tile.type)) continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      drawTile(ctx, structure, tile.type, sx, sy, ts, x, y, false);
    }
  }
}
