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
  BARREL,
  BARREL_SIDE,
  BOOKSHELF,
  CRATE,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
} from './tileTypes';
import { drawTerrainTile } from './tiles/terrainTiles';
import { drawSpecialFloorTile } from './tiles/specialFloorTiles';
import { drawBuildingTile } from './tiles/buildingTiles';
import { drawDecorationTile, decorationAnimationFrame } from './tiles/decorationTiles';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import { drawInteriorTile } from './tiles/interiorTiles';
import { tileIndex } from './tileIndex';
import {
  getMapSpriteExtentsPx,
  getSpriteExtentsPxByKey,
  getSpriteExtentsPxForTileType,
  type MapSpriteExtentsPx,
} from '../core/SpriteLoader';

const CHUNK_TILES = 16;

/**
 * Cold-chunk baking allowed per frame, counted in tiles so the budget means the
 * same thing whatever the chunk size. Four chunks' worth: enough that a scroll
 * warms up in a frame or two, small enough that no single frame pays for a
 * screenful. Chunks over budget fall back to direct drawing, which costs about
 * the same as the bake minus the allocation.
 */
const CHUNK_BAKES_PER_FRAME = 4;
const MAX_CHUNK_BAKE_TILES_PER_FRAME = CHUNK_TILES * CHUNK_TILES * CHUNK_BAKES_PER_FRAME;

/**
 * Baked chunks kept alive. A 1080p view spans 20 chunks, so this holds the
 * visible screen plus a couple of screens of scroll history.
 */
const MAX_CACHED_CHUNKS = 60;

/** Sentinel chunk key meaning "no candidate found". Real keys are non-negative. */
const NO_CHUNK = -1;

interface CachedChunk {
  canvas: CanvasSurface;
  /** Frame this chunk was last drawn from — drives LRU eviction. */
  lastUsedFrame: number;
}

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
  // Smashable props sit in the Y-sorted pass so a player standing north of a
  // crate is drawn behind it and one standing south is drawn in front.
  BARREL,
  BARREL_SIDE,
  CRATE,
  BOOKSHELF,
  // The wilderness's boulders. Y-sorted so a player standing north of a rock is
  // drawn behind it and one standing south is drawn in front — a two-tile-wide
  // boulder overhangs its own tile, so flat-drawing it would put the player's
  // feet through the stone.
  BOULDER_SMALL,
  BOULDER_LARGE,
  // The goblin camp, and the wilderness's ledges. Each is taller than its own
  // tile and a player should be able to stand behind one, so all three are
  // Y-sorted rather than baked flat into the chunk.
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
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
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  // Not multi-op, but drawn by rescaling a full-resolution sheet — the tower
  // overhangs hundreds of pixels — so caching skips a resample per frame.
  SPRITE_BUILDING,
  MAIN_TOWER,
  // Static and genuinely multi-op — a face, a stepped block, a lip, three cracks
  // and a shadow — which is exactly what this cache is for.
  CLIFF,
]);

/** Tile type used where a neighbour lookup falls off the grid. */
const NO_TILE_TYPE = -1;

/** Gable roof overhead: extends 2.75 tile-heights above the back wall tile origin. */
const GABLE_OVERHEAD_SCALE = 2.75;

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
  if (drawDecorationTile(ctx, structure, type, sx, sy, ts, tx, ty, false)) return;
  if (drawInteriorTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
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
  private chunks = new Map<number, CachedChunk>();
  private chunksX: number;
  private chunksY: number;
  private frameCounter = 0;
  private hasRenderedOnce = false;

  constructor(
    private structure: TileContent[][],
    private ts: number,
  ) {
    const rows = structure.length;
    const cols = structure[0]?.length ?? rows;
    this.chunksX = Math.ceil(cols / CHUNK_TILES);
    this.chunksY = Math.ceil(rows / CHUNK_TILES);
  }

  private chunkKey(cx: number, cy: number): number {
    return cy * this.chunksX + cx;
  }

  /** Last tile (exclusive) of a chunk on each axis, clamped to the grid. */
  private chunkTileBounds(cx: number, cy: number) {
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;
    const tileX0 = cx * CHUNK_TILES;
    const tileY0 = cy * CHUNK_TILES;
    return {
      tileX0,
      tileY0,
      tileX1: Math.min(tileX0 + CHUNK_TILES, cols),
      tileY1: Math.min(tileY0 + CHUNK_TILES, rows),
    };
  }

  private bakeChunk(cx: number, cy: number): CachedChunk {
    const ts = this.ts;
    const structure = this.structure;
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);

    const canvas = allocCanvas((tileX1 - tileX0) * ts, (tileY1 - tileY0) * ts);
    const cctx = surfaceContext(canvas);

    for (let y = tileY0; y < tileY1; y++) {
      for (let x = tileX0; x < tileX1; x++) {
        const tile = structure[y][x];
        const sx = (x - tileX0) * ts;
        const sy = (y - tileY0) * ts;
        const isDecoration = DECORATION_TYPES.has(tile.type);
        drawTile(cctx, structure, tile.type, sx, sy, ts, x, y, isDecoration);
      }
    }

    const cached: CachedChunk = { canvas, lastUsedFrame: this.frameCounter };
    this.chunks.set(this.chunkKey(cx, cy), cached);
    return cached;
  }

  /**
   * Paints a chunk's tiles straight to the target — the cold-chunk fallback.
   * Clipped to the chunk's own rectangle, because the baked path is implicitly
   * clipped to its canvas and a tile painter may reach past its tile.
   */
  private drawChunkDirect(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    originX: number,
    originY: number,
  ): void {
    const ts = this.ts;
    const structure = this.structure;
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(originX, originY, (tileX1 - tileX0) * ts, (tileY1 - tileY0) * ts);
    ctx.clip();
    for (let y = tileY0; y < tileY1; y++) {
      for (let x = tileX0; x < tileX1; x++) {
        const tile = structure[y][x];
        const isDecoration = DECORATION_TYPES.has(tile.type);
        drawTile(
          ctx,
          structure,
          tile.type,
          originX + (x - tileX0) * ts,
          originY + (y - tileY0) * ts,
          ts,
          x,
          y,
          isDecoration,
        );
      }
    }
    ctx.restore();
  }

  /**
   * Drop the pre-rendered block covering a tile so it re-bakes on the next
   * frame. Required whenever a base tile changes at runtime — a chunk is baked
   * once and reused forever, so a smashed barrel would otherwise keep showing
   * its intact art on top of its own wreckage.
   */
  invalidateTile(tileX: number, tileY: number): void {
    const cx = Math.floor(tileX / CHUNK_TILES);
    const cy = Math.floor(tileY / CHUNK_TILES);
    this.chunks.delete(this.chunkKey(cx, cy));
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
    this.frameCounter++;

    const cx0 = Math.max(0, Math.floor(cameraX / chunkPx));
    const cy0 = Math.max(0, Math.floor(cameraY / chunkPx));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((cameraX + viewW) / chunkPx));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((cameraY + viewH) / chunkPx));

    // Floor the camera-relative offset once so all chunks share the same
    // sub-pixel alignment — prevents hairline gaps between adjacent chunks.
    const baseX = Math.floor(-cameraX);
    const baseY = Math.floor(-cameraY);

    // The first frame on a map has every visible chunk cold. Throttling there
    // only smears the same work across many frames while the player waits on a
    // black screen anyway, so the load transition absorbs it in one go.
    let bakeBudget = this.hasRenderedOnce
      ? MAX_CHUNK_BAKE_TILES_PER_FRAME
      : Number.POSITIVE_INFINITY;
    this.hasRenderedOnce = true;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = baseX + cx * chunkPx;
        const dy = baseY + cy * chunkPx;
        const cached = this.chunks.get(this.chunkKey(cx, cy));
        if (cached) {
          cached.lastUsedFrame = this.frameCounter;
          ctx.drawImage(cached.canvas, dx, dy);
          continue;
        }
        // Baking every cold chunk on the frame a scroll reveals them is what
        // used to cost 40-100 ms. Bake up to the budget; paint the rest the
        // slow way, and they bake over the next frame or two.
        if (bakeBudget > 0) {
          bakeBudget -= CHUNK_TILES * CHUNK_TILES;
          ctx.drawImage(this.bakeChunk(cx, cy).canvas, dx, dy);
        } else {
          this.drawChunkDirect(ctx, cx, cy, dx, dy);
        }
      }
    }

    this.evictLeastRecentlyUsed();
  }

  /**
   * A fully explored town would otherwise retain every chunk it ever baked —
   * hundreds of megabytes of canvas backing store for ground the player left
   * long ago.
   */
  private evictLeastRecentlyUsed(): void {
    // A scan per eviction rather than a sort of the whole cache: eviction runs
    // on every frame the cache is over cap, but drops only a chunk or two.
    while (this.chunks.size > MAX_CACHED_CHUNKS) {
      let oldestKey = NO_CHUNK;
      let oldestFrame = Number.POSITIVE_INFINITY;
      for (const [key, chunk] of this.chunks) {
        if (chunk.lastUsedFrame < oldestFrame) {
          oldestFrame = chunk.lastUsedFrame;
          oldestKey = key;
        }
      }
      // Never evict a chunk drawn this frame. On a display wide enough to show
      // more chunks than the cap, they all tie on age, and evicting them would
      // re-bake and re-evict the same chunks every frame.
      if (oldestKey === NO_CHUNK || oldestFrame === this.frameCounter) return;
      this.chunks.delete(oldestKey);
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
  canvas: CanvasSurface;
  /** Pixels above the tile's sy origin reserved in the canvas. Blit at (sx, sy - overhead). */
  overhead: number;
  /** Pixels left of the tile's sx origin reserved in the canvas. Blit at (sx - overhang). */
  leftOverhang: number;
  /** Tile type and animation frame the entry was baked for; a change re-bakes it. */
  type: number;
  animationFrame: number;
}

/** Art that never leaves its own tile square. */
const NO_DECORATION_EXTENTS: MapSpriteExtentsPx = { left: 0, up: 0, right: 0, down: 0 };

/**
 * How far past its own square a decoration tile's art reaches, in pixels per
 * direction. Shared between the overlay cache — which sizes its canvases to
 * exactly this — and the viewport cull, which widens its scan by it: a tile
 * whose art is drawn wider than it is culled pops in at the screen edge.
 */
export function decorationTileExtentsPx(
  structure: TileContent[][],
  type: number,
  tx: number,
  ty: number,
  ts: number,
): MapSpriteExtentsPx {
  if (type === BUILDING_WALL) {
    // The gable roof (intS case) extends up to 2.75 × ts above the tile.
    const hasGableBelow = ROOF_TILE_TYPES.has(structure[ty + 1]?.[tx]?.type ?? NO_TILE_TYPE);
    const up = hasGableBelow ? Math.ceil(ts * GABLE_OVERHEAD_SCALE) : 0;
    return { left: 0, up, right: 0, down: 0 };
  }
  // Roofs are painted, not blitted, and every stroke stays inside the tile.
  // They are also the bulk of what the overlay cache holds, so handing them the
  // sprite fallback below would grow each cached canvas ninefold — and the
  // per-frame blit with it — for slack that can never be drawn into.
  if (ROOF_TILE_TYPES.has(type)) return NO_DECORATION_EXTENTS;
  if (type === SPRITE_BUILDING) {
    const spriteKey = structure[ty][tx].spriteKey;
    const extents = spriteKey === undefined ? undefined : getSpriteExtentsPxByKey(spriteKey);
    return extents ?? unregisteredDecorationExtents(ts);
  }
  return getSpriteExtentsPxForTileType(type) ?? unregisteredDecorationExtents(ts);
}

/**
 * Reach assumed for a sprite-drawn decoration that declares no extents against
 * its tile type — torches, braziers and the like. One tile covers the tallest of
 * them (a torch reaches exactly one tile up), and every such type is cull-margin
 * only: none is cached, so the slack costs nothing but scan width.
 *
 * `TREE` used to land here and no longer does: its sheets declare
 * `tileTypeId: 13`, so a three-tile canopy gets its real extents rather than
 * this one-tile guess. A tree that fell back here would have its crown culled
 * the moment its own tile left the screen.
 */
function unregisteredDecorationExtents(ts: number): MapSpriteExtentsPx {
  return { left: ts, up: ts, right: ts, down: ts };
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
 *  - BUILDING_WALL, ROOF_*: one canvas per tile (tx, ty) — each has position-dependent details.
 *  - TREE / TORCH / BRAZIER / WELL / FOUNTAIN: excluded — they already resolve to
 *    one drawImage call.
 */
export class OverlayTileCache {
  private readonly cache = new Map<number, OverlayCacheEntry>();
  private readonly gridWidth: number;

  constructor(
    private readonly structure: TileContent[][],
    private readonly ts: number,
  ) {
    this.gridWidth = structure[0]?.length ?? structure.length;
  }

  /** Returns the pre-rendered entry for this tile at its current animation frame. */
  get(type: number, tx: number, ty: number, animationFrame: number): OverlayCacheEntry {
    const key = tileIndex(tx, ty, this.gridWidth);
    const hit = this.cache.get(key);
    if (hit?.type === type) {
      if (hit.animationFrame === animationFrame) return hit;
      // Only the picture changed. The tower's entry alone is half a megabyte
      // and turns over four times a second, so redraw into the canvas it
      // already has rather than allocating a fresh one every animation frame.
      this.redrawEntry(hit, type, tx, ty, animationFrame);
      return hit;
    }
    const entry = this.renderEntry(type, tx, ty, animationFrame);
    this.cache.set(key, entry);
    return entry;
  }

  private redrawEntry(
    entry: OverlayCacheEntry,
    type: number,
    tx: number,
    ty: number,
    animationFrame: number,
  ): void {
    const ctx = surfaceContext(entry.canvas);
    ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    drawTile(ctx, this.structure, type, entry.leftOverhang, entry.overhead, this.ts, tx, ty, false);
    entry.animationFrame = animationFrame;
  }

  /**
   * Drop a tile's entry so it re-renders. Needed whenever the tile's art
   * changes at runtime — the entry is otherwise kept for the map's lifetime.
   */
  invalidateTile(tileX: number, tileY: number): void {
    this.cache.delete(tileIndex(tileX, tileY, this.gridWidth));
  }

  private renderEntry(
    type: number,
    tx: number,
    ty: number,
    animationFrame: number,
  ): OverlayCacheEntry {
    const { ts } = this;
    const extents = decorationTileExtentsPx(this.structure, type, tx, ty, ts);
    const overhead = Math.max(0, Math.ceil(extents.up));
    const leftOverhang = Math.max(0, Math.ceil(extents.left));
    const width = leftOverhang + ts + Math.max(0, Math.ceil(extents.right));
    const height = overhead + ts + Math.max(0, Math.ceil(extents.down));

    const canvas = allocCanvas(width, height);
    const ctx = surfaceContext(canvas);
    drawTile(ctx, this.structure, type, leftOverhang, overhead, ts, tx, ty, false);
    return { canvas, overhead, leftOverhang, type, animationFrame };
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
    const animationFrame = decorationAnimationFrame(structure, type, tx, ty);
    const entry = overlayCache.get(type, tx, ty, animationFrame);
    ctx.drawImage(entry.canvas, sx - entry.leftOverhang, sy - entry.overhead);
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
