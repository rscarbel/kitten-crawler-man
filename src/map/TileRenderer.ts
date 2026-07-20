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
  BRAZIER,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
} from './tileTypes';
import { frameTime } from '../utils';
import { getMapSpriteExtentsPx } from '../core/SpriteLoader';

import { drawTerrainTile } from './tiles/terrainTiles';
import { drawSpecialFloorTile } from './tiles/specialFloorTiles';
import { drawBuildingTile } from './tiles/buildingTiles';
import { drawDecorationTile } from './tiles/decorationTiles';
import { drawInteriorTile } from './tiles/interiorTiles';

const CHUNK_TILES = 16;

/**
 * Tile types whose full visuals are drawn in the Y-sorted overlay pass.
 * Static PNG-based types (TORCH, BRAZIER, WELL) are also in this set but
 * are not cached by OverlayTileCache since they already resolve to a single
 * drawImage call.
 */
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
  BRAZIER,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
]);

/**
 * Subset of DECORATION_TYPES whose rendering involves multiple canvas 2D API
 * calls per frame and therefore benefits from pre-rendering to an OffscreenCanvas.
 * PNG-sprite tiles (TREE, TORCH, BRAZIER, WELL) are excluded — they're already a
 * single drawImage call and gain nothing from an extra cache layer.
 */
const CACHEABLE_OVERLAY_TYPES = new Set([
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
]);

/** Number of discrete animation frames pre-rendered for the fountain center tile. */
const FOUNTAIN_ANIM_FRAMES = 30;

/** Gable roof overhead: extends 2.75 tile-heights above the back wall tile origin. */
const GABLE_OVERHEAD_SCALE = 2.75;
/** Fountain water jet overhead: extends 1.5 tile-heights above the center tile origin. */
const FOUNTAIN_OVERHEAD_SCALE = 1.5;

/**
 * Draws a single tile. Dispatches to category-specific renderers.
 *
 * When `baseOnly` is true, decoration tiles that extend above their bounds
 * only draw their ground fill — the full visual is drawn later via the
 * decorations overlay so entities appear behind tall structures.
 *
 * `tileTime` overrides the global `frameTime` for animated tiles (used when
 * pre-rendering specific animation frames into the overlay cache).
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
  tileTime?: number,
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
  if (drawDecorationTile(ctx, structure, type, sx, sy, ts, tx, ty, false, tileTime)) return;
  if (drawInteriorTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
}

/**
 * Allocates an OffscreenCanvas when available, falling back to a regular
 * HTMLCanvasElement for environments that don't support OffscreenCanvas.
 * OffscreenCanvas avoids layout-tree involvement and is generally faster.
 */
function allocCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Set of roof tile types — used when computing BUILDING_WALL gable overhead. */
const ROOF_TILE_TYPES = new Set([
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
]);

/**
 * Lazily-populated chunk cache: pre-renders CHUNK_TILES×CHUNK_TILES blocks of
 * static base tiles to offscreen canvases. Animated decoration overlays are
 * NOT cached here — they're drawn separately in the overlay pass.
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

    chunk = allocCanvas(pw, ph);
    // OffscreenCanvas returns OffscreenCanvasRenderingContext2D which shares the
    // same drawing API as CanvasRenderingContext2D.
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

interface OverlayCacheEntry {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  /** Pixels above the tile's sy origin reserved in the canvas. Blit at (sx, sy - overhead). */
  overhead: number;
}

/**
 * Lazily-populated per-tile (or per-type) canvas cache for the decoration overlay pass.
 *
 * Each entry is a pre-rendered OffscreenCanvas covering the tile's full visual
 * extent (including any content that reaches above the tile boundary, such as
 * gable roofs or fountain water jets).  At draw time the entry is blitted with
 * a single drawImage call instead of replaying all canvas operations.
 *
 * Cache sharing rules:
 *  - FOUNTAIN center: FOUNTAIN_ANIM_FRAMES canvases shared across all center tiles.
 *  - FOUNTAIN rim: one canvas per neighbor-mask × row-parity variant (≤ 32 total).
 *  - BUILDING_WALL, ROOF_*: one canvas per tile (tx, ty) — each has position-dependent details.
 *  - TREE / TORCH / BRAZIER / WELL: excluded — they already resolve to one drawImage call.
 */
export class OverlayTileCache {
  private readonly cache = new Map<string, OverlayCacheEntry>();

  constructor(
    private readonly structure: TileContent[][],
    private readonly ts: number,
  ) {}

  /** Returns the animation frame index for this tile at the current global time. */
  currentFrame(type: number, tx: number, ty: number): number {
    if (type !== FOUNTAIN) return 0;
    const { structure } = this;
    const isCenter =
      structure[ty - 1]?.[tx]?.type === FOUNTAIN &&
      structure[ty + 1]?.[tx]?.type === FOUNTAIN &&
      structure[ty]?.[tx + 1]?.type === FOUNTAIN &&
      structure[ty]?.[tx - 1]?.type === FOUNTAIN;
    return isCenter ? Math.floor(frameTime * FOUNTAIN_ANIM_FRAMES) % FOUNTAIN_ANIM_FRAMES : 0;
  }

  /** Returns the pre-rendered entry for this tile at the given frame index. */
  get(type: number, tx: number, ty: number, frame: number): OverlayCacheEntry {
    const key = this.cacheKey(type, tx, ty, frame);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const entry = this.renderEntry(type, tx, ty, frame);
    this.cache.set(key, entry);
    return entry;
  }

  private cacheKey(type: number, tx: number, ty: number, frame: number): string {
    if (type === FOUNTAIN) {
      const { structure } = this;
      const nN = structure[ty - 1]?.[tx]?.type === FOUNTAIN ? 1 : 0;
      const nS = structure[ty + 1]?.[tx]?.type === FOUNTAIN ? 1 : 0;
      const nE = structure[ty]?.[tx + 1]?.type === FOUNTAIN ? 1 : 0;
      const nW = structure[ty]?.[tx - 1]?.type === FOUNTAIN ? 1 : 0;
      if (nN && nS && nE && nW) return `FC_${frame}`;
      // Rim tiles key on neighbor mask and row parity (mortar seam offset uses ty & 1)
      return `FR_${nN}${nS}${nE}${nW}_${ty & 1}`;
    }
    return `${type}_${tx}_${ty}`;
  }

  private computeOverhead(type: number, tx: number, ty: number): number {
    const { ts, structure } = this;
    if (type === BUILDING_WALL) {
      // The gable roof (intS case) extends up to 2.5 × ts above the tile.
      const intS = ROOF_TILE_TYPES.has(structure[ty + 1]?.[tx]?.type ?? -1);
      return intS ? Math.ceil(ts * GABLE_OVERHEAD_SCALE) : 0;
    }
    if (type === FOUNTAIN) {
      const { structure: s } = this;
      const isCenter =
        s[ty - 1]?.[tx]?.type === FOUNTAIN &&
        s[ty + 1]?.[tx]?.type === FOUNTAIN &&
        s[ty]?.[tx + 1]?.type === FOUNTAIN &&
        s[ty]?.[tx - 1]?.type === FOUNTAIN;
      // Water jet extends ~1.25 × ts above center tile origin.
      return isCenter ? Math.ceil(ts * FOUNTAIN_OVERHEAD_SCALE) : 0;
    }
    return 0;
  }

  private renderEntry(type: number, tx: number, ty: number, frame: number): OverlayCacheEntry {
    const { ts } = this;
    const overhead = this.computeOverhead(type, tx, ty);
    const canvas = allocCanvas(ts, overhead + ts);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-non-null-assertion
    const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D;
    const tileTime = type === FOUNTAIN ? frame / FOUNTAIN_ANIM_FRAMES : undefined;
    drawTile(ctx, this.structure, type, 0, overhead, ts, tx, ty, false, tileTime);
    return { canvas, overhead };
  }
}

/**
 * Draws a single decoration tile at full fidelity (used for z-sorted rendering).
 * When an OverlayTileCache is provided, cacheable tile types blit a pre-rendered
 * canvas instead of replaying all draw commands every frame.
 */
export function drawDecorationTileFull(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  ts: number,
  overlayCache?: OverlayTileCache,
): void {
  const type = structure[ty][tx].type;
  if (overlayCache && CACHEABLE_OVERLAY_TYPES.has(type)) {
    const frame = overlayCache.currentFrame(type, tx, ty);
    const entry = overlayCache.get(type, tx, ty, frame);
    ctx.drawImage(entry.canvas, sx, sy - entry.overhead);
    return;
  }
  drawTile(ctx, structure, type, sx, sy, ts, tx, ty, false);
}

/**
 * Non-Y-sorted decoration overlay pass.  Prefer the Y-sorted path
 * (drawDecorationAt per visible tile via RenderPipeline) for correct depth ordering.
 */
export function renderDecorationsOverlay(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tileHeight: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
  overlayCache?: OverlayTileCache,
): void {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  const ts = tileHeight;
  // Widen the scan by the worst-case sprite overhang so decorations whose
  // anchor tile is just off-screen don't pop out of existence at the edges.
  const extents = getMapSpriteExtentsPx();
  const startX = Math.max(0, Math.floor(cameraX / ts) - Math.ceil(extents.right / ts));
  const startY = Math.max(0, Math.floor(cameraY / ts) - Math.ceil(extents.down / ts));
  const endX = Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts) + Math.ceil(extents.left / ts));
  const endY = Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts) + Math.ceil(extents.up / ts));

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      if (!DECORATION_TYPES.has(tile.type)) continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      drawDecorationTileFull(ctx, structure, x, y, sx, sy, ts, overlayCache);
    }
  }
}
