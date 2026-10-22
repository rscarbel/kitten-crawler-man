import { noteDrawFailure, recoverDrawState } from '../core/drawFailure';
import { SERVICE_PROP_TILE_TYPES } from './serviceLevelProps';
import { stealthGateExtentsPx } from './tiles/stealthGateTiles';
import { serviceLevelPropExtentsPx } from './tiles/serviceLevelPropTiles';
import { CELLAR_OVERLAY_TILE_TYPES } from './cellarProps';
import { cellarPropExtentsPx } from './tiles/cellarPropTiles';
import type { TileContent } from './tileTypes';
import {
  BONE_PILE,
  SLUMPED_SKELETON,
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  BRAZIER,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  BARREL,
  BARREL_SIDE,
  BOOKSHELF,
  CRAWLER_SIGN,
  CRATE,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  FLASH_WALL,
  PIGMENT_SHELF,
  GRINDING_SLAB,
  BOSS_ROOM_PROP_TILE_TYPES,
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  STEALTH_GATE_CLOSED,
  STEALTH_GATE_OPEN,
  ROCK_DEPOSIT,
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  TENT_POLE,
  RIVER_REEDS,
} from './tileTypes';
import { drawTerrainTile } from './tiles/terrainTiles';
import { drawBossRoomTile } from './tiles/bossRoomTiles';
import { drawSpecialFloorTile } from './tiles/specialFloorTiles';
import { drawBuildingTile } from './tiles/buildingTiles';
import {
  drawDecorationTile,
  drawDecorationLifeLayer,
  REED_OVERHANG_PX,
  reedStandVariant,
} from './tiles/decorationTiles';
import {
  allocCanvas,
  allocReadableCanvas,
  BYTES_PER_MEGABYTE,
  CanvasContextUnavailableError,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../core/canvasSurface';
import {
  canvasGeneration,
  registerPurgeProbe,
  reportCanvasAllocationFailure,
} from '../core/canvasRecovery';
import {
  recordSheetLookups,
  environmentRepaintCursor,
  environmentSheetsRepaintedSince,
  repaintedSheetRevision,
  touchEnvironmentSheets,
} from './environmentArtCache';
import { perfMonitor } from '../core/PerfMonitor';
import { drawInteriorTile } from './tiles/interiorTiles';
import { hollowPropExtentsPx } from './tiles/hollowVillageTiles';
import { circusStructureExtentsPx } from './tiles/circusStructureTiles';
import { tentPoleExtentsPx } from './tiles/tentPoleTiles';
import { hollowWallExtentsPx } from './tiles/hollowWallTiles';
import { hollowGateExtentsPx, hollowPalisadeExtentsPx } from './tiles/hollowPalisadeTiles';
import { tileIndex } from './tileIndex';
import {
  getMapSpriteExtentsPx,
  getSpriteExtentsPxByKey,
  getSpriteExtentsPxForTileType,
  type MapSpriteExtentsPx,
} from '../core/SpriteLoader';

import { CHUNK_TILES } from './tiles/chunkTiles';

/**
 * Milliseconds of chunk baking a frame of play may spend, matching the figure
 * cache's per-frame bake budget. In time rather than chunk count because one
 * chunk costs anywhere from a few to forty milliseconds depending on what is
 * painted in it, and a count lets four expensive ones land on the same frame.
 * One bake always runs regardless, so a cache can never stall.
 */
const CHUNK_BAKE_BUDGET_MS = 4;

/**
 * Milliseconds of a frame's chunk budget that work for ground not yet on
 * screen may spend: baking ahead of the camera and patching off-screen
 * chunks. Kept well under {@link CHUNK_BAKE_BUDGET_MS} because it runs on
 * every frame of a walk, on top of the figure cache's own prewarm, and a frame
 * pushed past a vsync is a visible stutter. It is still plenty: the camera
 * takes a whole chunk's width — about 200 frames at walking pace, 70 at three
 * times that — to reach the chunks one ahead of it, while a leading column
 * of the costliest town chunks needs a few dozen frames at this pace.
 */
const CHUNK_SPECULATIVE_BUDGET_MS = 1;

/**
 * Baked chunks kept alive. A 1080p view spans 20 chunks, so this holds the
 * visible screen, the ring prefetched ahead of a moving camera, and a couple of
 * screens of scroll history.
 */
const MAX_CACHED_CHUNKS = 60;

const CHUNK_IDLE_RELEASE_SECONDS = 30;
const CHUNK_FRAMES_PER_SECOND = 60;
/**
 * Frames of this map's own drawing a chunk may go undrawn before it is let go,
 * however far below {@link MAX_CACHED_CHUNKS} the cache is. A map that lives
 * for a whole visit to the floor otherwise keeps every chunk of the last
 * screens it showed for good: measured headless on floor 3, a party that
 * walked the town before going to Briar Hollow still held 20 chunks (20 MB)
 * more than one that went straight there after standing 35 seconds. Half a
 * minute keeps the ground a fight circles over and lets the walk behind go.
 * Counted on the cache's own frames, so a map not drawn at all (the floor
 * outside while the party is in a building) ages nothing.
 */
const CHUNK_IDLE_RELEASE_FRAMES = CHUNK_IDLE_RELEASE_SECONDS * CHUNK_FRAMES_PER_SECOND;

declare const __DEV_BUILD__: boolean | undefined;
/** Whether this is a dev build, where the stale-chunk drain is watched. */
const WATCHES_STALE_DRAIN = typeof __DEV_BUILD__ !== 'undefined' && __DEV_BUILD__;
/**
 * Frames a visible stale chunk may go without any stale chunk re-baking before
 * a dev build warns. Every frame re-bakes at least one visible stale chunk
 * unless a cold chunk took the frame's guaranteed bake, so a screenful drains
 * in well under this; a count that reaches it means one never will.
 */
const STALE_DRAIN_WARN_FRAMES = 300;

/** A visible stale chunk is remembered as its two chunk coordinates, flat in one array. */
const CHUNK_COORDS_PER_ENTRY = 2;

/** Sentinel chunk key meaning "no candidate found". Real keys are non-negative. */
const NO_CHUNK = -1;

/** Chunks baked since the module loaded, for gates that must see none baked on a given frame. */
let chunkBakesTotal = 0;

/** Every chunk bake so far; a gate measures a window as a difference. */
export function tileChunkBakeCount(): number {
  return chunkBakesTotal;
}

let chunkPaintMsTotal = 0;

/**
 * Milliseconds spent painting chunks — whole bakes, sliced bakes and patches —
 * since the module loaded; a frame's share is measured as a difference.
 */
export function tileChunkPaintMsTotal(): number {
  return chunkPaintMsTotal;
}

/**
 * Weight the newest measurement carries in the chunk bake cost estimate. Low for
 * the same reason as the other paced caches: one bake beside a collection must
 * not set the next frame's pacing.
 */
const CHUNK_BAKE_COST_SMOOTHING = 0.25;

interface CachedChunk {
  canvas: CanvasSurface;
  /** Frame this chunk was last drawn from — drives LRU eviction. */
  lastUsedFrame: number;
  /** Environment sheets its pixels came from, kept drawn while the chunk is. */
  sheets: readonly string[];
  /**
   * Whether the purge probe found ink in this chunk the first time it read it,
   * or null before then. Only a chunk once seen with ink can be judged purged
   * when it reads blank: a chunk of nothing but void is blank from birth.
   */
  probedInk: boolean | null;
  /**
   * The canvas generation it was baked in. A chunk from before a recovery may
   * belong to a cache nobody renders any more, which will never drop it.
   */
  generation: number;
  /**
   * Baked before a sheet it draws from was repainted. Still blitted, because
   * the old picture is far better than a cold chunk's cost, and re-baked when
   * the frame's budget allows.
   */
  stale: boolean;
}

/**
 * How far past a changed tile its chunk patch reaches, in tiles. A ground
 * painter reads its immediate neighbours (fringes, occlusion bands), so the
 * tiles beside a changed one may draw differently too.
 */
const CHUNK_REPAINT_MARGIN_TILES = 1;
/**
 * How far, in tiles, a base painter may draw past its own tile. A repaint
 * draws this ring of tiles around its clip so their overreach is laid back.
 */
const TILE_PAINT_OVERREACH_TILES = 1;

/** The tile rectangle (end exclusive) one chunk repaints in place. */
interface ChunkRepaintPatch {
  readonly cx: number;
  readonly cy: number;
  tileX0: number;
  tileY0: number;
  tileX1: number;
  tileY1: number;
}

/**
 * A chunk bake spread across frames: a fresh canvas the chunk's tiles are
 * painted into in the bake's own row-major order, a frame's leftover budget at
 * a time, so the finished canvas holds exactly what one bake would have.
 * Until it finishes, the chunk's old picture (or, ahead of the view, nothing)
 * is what is drawn.
 */
interface ChunkBakeJob {
  readonly cx: number;
  readonly cy: number;
  readonly key: number;
  readonly canvas: CanvasSurface;
  /** Index, in the bake's row-major order, of the next tile to paint. */
  nextTile: number;
  readonly sheets: Set<string>;
  /** Painting time so far, folded into the bake cost estimate once it finishes. */
  spentMs: number;
  /** A sheet it drew from was repainted after it began, so it finishes as a stale chunk. */
  stale: boolean;
}

/** Frames a cache waits after a failed bake before baking again. */
const CHUNK_BAKE_RETRY_FRAMES = 60;
/**
 * How long the overlay cache waits after a failed render before rendering a
 * new entry again. In time rather than frames because the overlay cache has no
 * frame of its own: it is asked once per decoration drawn.
 */
const OVERLAY_RENDER_RETRY_MS = 1000;

/**
 * Stale overlay entries redrawn per frame after a sheet lands. Most entries
 * are roof and wall tiles that redraw in a fraction of a millisecond, so this
 * clears a town screen's worth in well under half a second without any one
 * frame paying for all of it.
 */
const OVERLAY_REDRAWS_PER_FRAME = 8;

/**
 * Canvas memory the overlay cache may hold. A town screen draws a few
 * megabytes of entries — its buildings dominate, at up to half a megabyte
 * each — so this keeps several screens of walked-past town warm while capping
 * what a long walk can pile up.
 */
const OVERLAY_CACHE_BUDGET_MEGABYTES = 32;
const OVERLAY_CACHE_BUDGET_BYTES = OVERLAY_CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
/**
 * Where an eviction pass stops, below the budget, so a cache hovering at its
 * cap evicts in occasional batches rather than one entry every frame.
 */
const OVERLAY_CACHE_EVICT_TO_MEGABYTES = 24;
const OVERLAY_CACHE_EVICT_TO_BYTES = OVERLAY_CACHE_EVICT_TO_MEGABYTES * BYTES_PER_MEGABYTE;

let warnedTileArtFailure = false;

/**
 * For a chunk or decoration entry that failed to paint. Logged once, because
 * the cause — usually the browser's canvas memory running out — repeats on
 * every frame until it clears.
 */
function noteTileArtFailure(error: unknown): void {
  if (error instanceof CanvasContextUnavailableError) reportCanvasAllocationFailure();
  if (warnedTileArtFailure) return;
  warnedTileArtFailure = true;
  console.error('[TileRenderer] tile art failed to paint; it is drawn uncached and retried', error);
}

/**
 * The chunk the purge probe reads: the last one any cache blitted, so it is
 * always ground the player is looking at.
 */
let probeChunk: CachedChunk | null = null;
/**
 * Whether any cache has blitted {@link probeChunk} since the last probe. A
 * chunk nobody draws any more is let go rather than read, so a floor that has
 * been left is neither probed nor kept alive by the probe.
 */
let probeChunkDrawnSinceProbe = false;
/** Edge of the downsampled read of the probe chunk. */
const PROBE_SAMPLE_PX = 4;
/** Edge of the square in the middle of the chunk the probe reads from. */
const PROBE_SOURCE_PX = 64;
const PROBE_ALPHA_CHANNEL = 3;
const RGBA_STRIDE = 4;
let probeSurface: CanvasSurface | null = null;

/**
 * Whether the probe chunk has lost the ink it had when first read.
 *
 * Drawn through a small software surface rather than read directly: reading a
 * GPU canvas back moves it out of GPU memory for good, and the chunk would then
 * stop being drawn the fast way.
 */
function probeChunkPurged(): boolean {
  const chunk = probeChunk;
  const drawnSinceProbe = probeChunkDrawnSinceProbe;
  probeChunkDrawnSinceProbe = false;
  if (chunk === null) return false;
  const stale =
    !drawnSinceProbe ||
    chunk.generation !== canvasGeneration() ||
    chunk.canvas.width === 0 ||
    chunk.canvas.height === 0;
  if (stale) {
    probeChunk = null;
    return false;
  }
  // Let go of up front and taken back only by a read that completes: a chunk
  // whose read throws reports one purge and is never read again.
  probeChunk = null;
  const ctx = probeContext();
  ctx.clearRect(0, 0, PROBE_SAMPLE_PX, PROBE_SAMPLE_PX);
  const sourceW = Math.min(PROBE_SOURCE_PX, chunk.canvas.width);
  const sourceH = Math.min(PROBE_SOURCE_PX, chunk.canvas.height);
  const sourceX = Math.floor((chunk.canvas.width - sourceW) / 2);
  const sourceY = Math.floor((chunk.canvas.height - sourceH) / 2);
  ctx.drawImage(
    chunk.canvas,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    PROBE_SAMPLE_PX,
    PROBE_SAMPLE_PX,
  );
  const pixels = ctx.getImageData(0, 0, PROBE_SAMPLE_PX, PROBE_SAMPLE_PX).data;
  let hasInk = false;
  for (let index = PROBE_ALPHA_CHANNEL; index < pixels.length; index += RGBA_STRIDE) {
    if (pixels[index] > 0) {
      hasInk = true;
      break;
    }
  }
  chunk.probedInk ??= hasInk;
  const purged = chunk.probedInk && !hasInk;
  // Reported once: the recovery it sets off drops this chunk anyway, and a
  // chunk still blank afterwards must not set off another.
  if (!purged) probeChunk = chunk;
  return purged;
}

function probeContext(): CanvasRenderingContext2D {
  const surface = probeSurface ?? allocReadableCanvas('misc', PROBE_SAMPLE_PX, PROBE_SAMPLE_PX);
  try {
    const ctx = surfaceContext(surface);
    probeSurface = surface;
    return ctx;
  } catch (error) {
    releaseSurface(surface);
    probeSurface = null;
    throw error;
  }
}

registerPurgeProbe(probeChunkPurged);

/**
 * Tile types whose full visuals are drawn in the Y-sorted overlay pass.
 * Static PNG-based types (TORCH, BRAZIER, WELL) are also in this set but
 * are not cached by OverlayTileCache since they already resolve to a single
 * drawImage call.
 */
const DECORATION_TYPES = new Set([
  // The dead. Y-sorted so a crawler north of a skeleton is drawn behind it.
  BONE_PILE,
  SLUMPED_SKELETON,
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
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
  CRAWLER_SIGN,
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
  // The garrison's and the inking shop's tall props. Y-sorted so a player
  // standing north of a training dummy is drawn behind it. `MAP_TABLE` and
  // `INK_BENCH` are absent for the same reason `TABLE` and `BED` are: both are
  // waist height, drawn flat in the base pass, and nothing walks behind them.
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  FLASH_WALL,
  PIGMENT_SHELF,
  GRINDING_SLAB,
  // Boss-room props, low ones included: a boss or a crawler north of a garbage
  // bag must still be drawn behind it.
  ...BOSS_ROOM_PROP_TILE_TYPES,
  // Briar Hollow's walls, palisade, gate and blocking props. Y-sorted so a
  // crawler standing north of one is drawn behind it.
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  // The stealth gate's portcullis stands up out of its slot, so a crawler
  // north of it is drawn behind the bars.
  STEALTH_GATE_CLOSED,
  STEALTH_GATE_OPEN,
  // The circus grounds' tents, pavilions and arch posts. Y-sorted so a crawler
  // standing north of a tent is drawn behind it.
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  // The Big Top's tent poles. Y-sorted so the mast rising out of view passes
  // behind a crawler south of it and in front of one north of it.
  TENT_POLE,
  // Riverbank reeds stand taller than their tile, so a crawler wading behind
  // a stand is hidden by it.
  RIVER_REEDS,
  // The service level's furniture. Its part tiles are absent: they bake as
  // floor, and their anchor draws the whole piece over them.
  ...SERVICE_PROP_TILE_TYPES,
  // The cellars' furniture, its candles and its fungus; a two-tile piece's
  // part tile is drawn by its anchor, as the service level's are.
  ...CELLAR_OVERLAY_TILE_TYPES,
]);

/**
 * Subset of DECORATION_TYPES whose rendering involves multiple canvas 2D API
 * calls per frame and therefore benefits from pre-rendering to a canvas.
 * PNG-sprite tiles (TREE, TORCH, BRAZIER, WELL) are excluded — they're already a
 * single drawImage call and gain nothing from an extra cache layer.
 */
const CACHEABLE_OVERLAY_TYPES = new Set([
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  // Not multi-op, but drawn by rescaling a full-resolution sheet — the tower
  // overhangs hundreds of pixels — so caching skips a resample per frame.
  SPRITE_BUILDING,
  MAIN_TOWER,
  // Static and genuinely multi-op — a face, a stepped block, a lip, three cracks
  // and a shadow — which is exactly what this cache is for.
  CLIFF,
  // One blit, but of a sheet painted at twice the display scale: the Big Top is
  // twelve tiles wide, and caching skips resampling all of it every frame.
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  // Many gradients, collars and a vine climbing out of view: static, and
  // costly to replay every frame.
  TENT_POLE,
  // A dozen tapered stems each, and many to a screen along a bank. Entries are
  // shared per stand variant, so the cache stays a few dozen canvases however
  // long the river.
  RIVER_REEDS,
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
  if (drawBossRoomTile(ctx, structure, type, sx, sy, ts, tx, ty)) return;
}

/** Set of roof tile types — used when computing BUILDING_WALL gable overhead. */
const ROOF_TILE_TYPES = new Set([ROOF_THATCH, ROOF_SLATE, ROOF_RED, ROOF_GREEN]);

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
  /** The canvas generation the chunks were baked in; see `canvasGeneration`. */
  private generation = canvasGeneration();
  /** The repainted-sheet revision the chunks were baked under; see `repaintedSheetRevision`. */
  private sheetRevision = repaintedSheetRevision();
  /** How far through the eviction repaints this cache has read; see `environmentSheetsRepaintedSince`. */
  private repaintCursor = environmentRepaintCursor();
  /** No chunk is baked before this frame; set by a bake that threw. */
  private bakeRetryFrame = 0;
  /** Measured cost of one chunk bake, or null before the first. */
  private chunkBakeEstimateMs: number | null = null;
  /** The previous frame's camera, so the prefetch knows which way the view is moving. */
  private previousCameraX: number | null = null;
  private previousCameraY: number | null = null;
  /** Chunk coordinates of this frame's visible stale chunks, reused across frames. */
  private readonly staleVisible: number[] = [];
  /** Frames in a row that showed a stale chunk and re-baked none; dev builds only. */
  private framesWithoutStaleBake = 0;
  private warnedStaleDrain = false;
  /**
   * Changed tiles whose baked pixels are not yet repainted, per chunk key.
   * A visible chunk's patch is painted before the chunk is drawn, so a change
   * never shows its old art; an off-screen one waits for spare budget.
   */
  private readonly pendingPatches = new Map<number, ChunkRepaintPatch>();
  /** The one chunk bake in progress across frames, if any. */
  private job: ChunkBakeJob | null = null;

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

  private allocChunkCanvas(cx: number, cy: number): CanvasSurface {
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);
    return allocCanvas('tileChunks', (tileX1 - tileX0) * this.ts, (tileY1 - tileY0) * this.ts);
  }

  /**
   * Paints a chunk's tiles into its canvas in the bake's row-major order, from
   * tile `fromTile`, until `deadlineMs` passes — always at least one tile —
   * and returns the index of the next tile to paint. Every sheet a tile drew
   * from is added to `sheets`.
   */
  private paintChunkTiles(
    canvas: CanvasSurface,
    cx: number,
    cy: number,
    fromTile: number,
    deadlineMs: number,
    sheets: Set<string>,
  ): number {
    const ts = this.ts;
    const structure = this.structure;
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);
    const widthTiles = tileX1 - tileX0;
    const tileCount = widthTiles * (tileY1 - tileY0);
    const cctx = surfaceContext(canvas);
    let nextTile = fromTile;
    const recorded = recordSheetLookups(() => {
      while (nextTile < tileCount) {
        const x = tileX0 + (nextTile % widthTiles);
        const y = tileY0 + Math.floor(nextTile / widthTiles);
        const tile = structure[y][x];
        const isDecoration = DECORATION_TYPES.has(tile.type);
        drawTile(
          cctx,
          structure,
          tile.type,
          (x - tileX0) * ts,
          (y - tileY0) * ts,
          ts,
          x,
          y,
          isDecoration,
        );
        nextTile++;
        if (performance.now() >= deadlineMs) break;
      }
    });
    for (const key of recorded) sheets.add(key);
    return nextTile;
  }

  private chunkTileCount(cx: number, cy: number): number {
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);
    return (tileX1 - tileX0) * (tileY1 - tileY0);
  }

  /** Makes a finished canvas the chunk's picture, releasing the one it replaces. */
  private installChunk(
    key: number,
    canvas: CanvasSurface,
    sheets: ReadonlySet<string>,
    stale: boolean,
  ): CachedChunk {
    const cached: CachedChunk = {
      canvas,
      lastUsedFrame: this.frameCounter,
      sheets: sheets.size === 0 ? [] : [...sheets],
      probedInk: null,
      generation: canvasGeneration(),
      stale,
    };
    const replaced = this.chunks.get(key);
    if (replaced !== undefined) this.releaseChunk(replaced);
    this.chunks.set(key, cached);
    chunkBakesTotal += 1;
    return cached;
  }

  private bakeChunk(cx: number, cy: number): CachedChunk {
    const key = this.chunkKey(cx, cy);
    const canvas = this.allocChunkCanvas(cx, cy);
    const sheets = new Set<string>();
    try {
      this.paintChunkTiles(canvas, cx, cy, 0, Number.POSITIVE_INFINITY, sheets);
    } catch (error) {
      releaseSurface(canvas);
      throw error;
    }
    // Painted from the structure as it stands, so every patch owed is in it.
    this.pendingPatches.delete(key);
    return this.installChunk(key, canvas, sheets, false);
  }

  /** Folds one finished bake's cost into the estimate every budgeted caller paces itself by. */
  private noteBakeCost(elapsedMs: number): void {
    perfMonitor.count('chunkBakes', 1);
    const estimate = this.chunkBakeEstimateMs;
    this.chunkBakeEstimateMs =
      estimate === null ? elapsedMs : estimate + (elapsedMs - estimate) * CHUNK_BAKE_COST_SMOOTHING;
  }

  /**
   * A failure holds off every bake for a while: the usual cause is the
   * browser's canvas memory running out, and retrying every frame would only
   * fail every frame.
   */
  private noteBakeFailure(error: unknown): void {
    this.bakeRetryFrame = this.frameCounter + CHUNK_BAKE_RETRY_FRAMES;
    noteTileArtFailure(error);
  }

  /**
   * Bakes a chunk now, or returns null when the bake threw. A stale chunk
   * whose re-bake fails keeps its old picture. A chunk with a bake in progress
   * across frames finishes that one, which costs only what it has left.
   *
   * Returns how long it took as well.
   */
  private timedBake(cx: number, cy: number): { chunk: CachedChunk | null; elapsedMs: number } {
    if (this.frameCounter < this.bakeRetryFrame) return { chunk: null, elapsedMs: 0 };
    const job = this.job;
    if (job?.key === this.chunkKey(cx, cy)) {
      const startedAt = performance.now();
      const chunk = this.advanceJob(job, Number.POSITIVE_INFINITY);
      return { chunk, elapsedMs: performance.now() - startedAt };
    }
    const perfStartedAt = perfMonitor.begin();
    const startedAt = performance.now();
    let chunk: CachedChunk | null = null;
    try {
      chunk = this.bakeChunk(cx, cy);
    } catch (error) {
      this.noteBakeFailure(error);
    }
    const elapsedMs = performance.now() - startedAt;
    chunkPaintMsTotal += elapsedMs;
    perfMonitor.end('chunkBake', perfStartedAt);
    this.noteBakeCost(elapsedMs);
    return { chunk, elapsedMs };
  }

  private startJob(cx: number, cy: number): ChunkBakeJob | null {
    let canvas: CanvasSurface;
    try {
      canvas = this.allocChunkCanvas(cx, cy);
    } catch (error) {
      this.noteBakeFailure(error);
      return null;
    }
    const key = this.chunkKey(cx, cy);
    // The old picture stays on screen until the job finishes, and the job may
    // yet be dropped, so a patch it owes is painted now rather than discarded.
    // Its tiles are painted from the structure as it stands from here on, so
    // only a change after this point is still owed.
    const resident = this.chunks.get(key);
    if (resident !== undefined) this.applyPendingPatch(key, resident);
    else this.pendingPatches.delete(key);
    const job: ChunkBakeJob = {
      cx,
      cy,
      key,
      canvas,
      nextTile: 0,
      sheets: new Set(),
      spentMs: 0,
      stale: false,
    };
    this.job = job;
    return job;
  }

  /**
   * Paints the job's next tiles until `deadlineMs`, at least one, and installs
   * the chunk once its last tile is painted. Returns the installed chunk, or
   * null while unfinished or when painting threw.
   */
  private advanceJob(job: ChunkBakeJob, deadlineMs: number): CachedChunk | null {
    const perfStartedAt = perfMonitor.begin();
    const startedAt = performance.now();
    try {
      job.nextTile = this.paintChunkTiles(
        job.canvas,
        job.cx,
        job.cy,
        job.nextTile,
        deadlineMs,
        job.sheets,
      );
    } catch (error) {
      this.dropJob();
      this.noteBakeFailure(error);
      return null;
    } finally {
      const elapsedMs = performance.now() - startedAt;
      job.spentMs += elapsedMs;
      chunkPaintMsTotal += elapsedMs;
      perfMonitor.end('chunkBake', perfStartedAt);
    }
    if (job.nextTile < this.chunkTileCount(job.cx, job.cy)) return null;
    this.job = null;
    this.noteBakeCost(job.spentMs);
    const installed = this.installChunk(job.key, job.canvas, job.sheets, job.stale);
    // A change made while the job ran is owed to the new picture, which a
    // caller may draw straight away.
    this.applyPendingPatch(job.key, installed);
    return this.chunks.get(job.key) ?? null;
  }

  private dropJob(): void {
    const job = this.job;
    if (job === null) return;
    this.job = null;
    releaseSurface(job.canvas);
  }

  /** Whether another bake fits in what is left of `budgetMs`, by the measured cost of one. */
  private bakeFits(spentMs: number, budgetMs: number): boolean {
    const estimate = this.chunkBakeEstimateMs;
    return estimate !== null && spentMs + estimate <= budgetMs;
  }

  /**
   * Drops every chunk when the canvases have been rebuilt since they were
   * baked, since their pixels may be gone. A repainted sheet landing only marks
   * them stale: their pixels are intact, just drawn against the sheet's
   * fallback colour.
   */
  private syncCanvasGeneration(): void {
    const current = canvasGeneration();
    const revision = repaintedSheetRevision();
    if (this.generation !== current) {
      this.generation = current;
      this.sheetRevision = revision;
      this.bakeRetryFrame = 0;
      this.dispose();
      return;
    }
    if (this.sheetRevision !== revision) {
      this.sheetRevision = revision;
      this.markAllStale();
      return;
    }
    // A building's own sheet is never baked into the ground; any other may
    // have been drawn at its fallback by chunks baked while it was gone.
    const repainted = environmentSheetsRepaintedSince(this.repaintCursor);
    this.repaintCursor = repainted.cursor;
    if (repainted.sheets.some((sheet) => !sheet.drawnOnlyByItsBuilding)) this.markAllStale();
  }

  /**
   * Marks every baked chunk for re-baking, for when a sheet the chunks draw
   * from has landed. Each keeps being drawn until its re-bake fits a frame's
   * budget, visible chunks first, so a sheet landing never costs a screenful of
   * baking on one frame.
   */
  markAllStale(): void {
    for (const chunk of this.chunks.values()) chunk.stale = true;
    if (this.job !== null) this.job.stale = true;
  }

  /** Releases every baked chunk's pixels. The cache stays usable and re-bakes on demand. */
  dispose(): void {
    for (const chunk of this.chunks.values()) this.releaseChunk(chunk);
    this.chunks.clear();
    this.pendingPatches.clear();
    this.dropJob();
  }

  private releaseChunk(chunk: CachedChunk): void {
    if (probeChunk === chunk) probeChunk = null;
    releaseSurface(chunk.canvas);
  }

  /**
   * Bakes the cold or stale chunks a view at this camera would show, for up to
   * `budgetMs`, and returns the fraction of them now warm.
   *
   * For a loading screen covering a floor's arrival, so the first frame of play
   * has nothing left to bake. A chunk starts only if its measured cost fits what
   * is left, except the first when `mustProgress` says nothing else has run this
   * frame.
   */
  bakeView(
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
    budgetMs: number,
    mustProgress: boolean,
  ): number {
    const chunkPx = CHUNK_TILES * this.ts;
    const cx0 = Math.max(0, Math.floor(cameraX / chunkPx));
    const cy0 = Math.max(0, Math.floor(cameraY / chunkPx));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((cameraX + viewW) / chunkPx));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((cameraY + viewH) / chunkPx));
    const inView = Math.max(0, cx1 - cx0 + 1) * Math.max(0, cy1 - cy0 + 1);
    if (inView === 0) return 1;
    this.syncCanvasGeneration();
    let spentMs = 0;
    let startedAny = false;
    let warm = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = this.chunkKey(cx, cy);
        const cached = this.chunks.get(key);
        if (cached !== undefined && !cached.stale) {
          // A patch is a fraction of a bake, so it is never what holds a
          // loading screen up.
          spentMs += this.applyPendingPatch(key, cached);
          warm++;
          continue;
        }
        const owedFirstChunk = mustProgress && !startedAny;
        if (!owedFirstChunk && !this.bakeFits(spentMs, budgetMs)) continue;
        startedAny = true;
        // Counted warm even when it fails: a loading screen waiting on it would
        // otherwise never finish, and play paints a failed chunk tile by tile.
        spentMs += this.timedBake(cx, cy).elapsedMs;
        warm++;
      }
    }
    return warm / inView;
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
    perfMonitor.count('chunkDirectDraws', 1);
    const ts = this.ts;
    const structure = this.structure;
    const { tileX0, tileY0, tileX1, tileY1 } = this.chunkTileBounds(cx, cy);
    ctx.save();
    try {
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
    } finally {
      ctx.restore();
    }
  }

  /**
   * Queues a repaint of the baked pixels around tiles whose base art changed.
   * Required whenever a base tile changes at runtime — a chunk is baked once
   * and reused forever, so a smashed barrel would otherwise keep showing its
   * intact art on top of its own wreckage — and a few tiles cost far less than
   * re-baking the whole chunk.
   *
   * Nothing is painted here. A visible chunk's patch is painted into its canvas
   * just before the chunk is drawn, from the frame's bake budget; an off-screen
   * one waits for spare budget, or for the chunk to scroll into view. A patch
   * reproduces exactly what a bake lays down in its rectangle, so a patched
   * chunk never needs re-baking.
   *
   * Each tile's patch is widened by {@link CHUNK_REPAINT_MARGIN_TILES}, since a
   * neighbour's painter may read the changed tile, and patched in every chunk
   * it overlaps, so a change on a chunk border leaves no seam. A chunk neither
   * resident nor being baked is left alone: it bakes fresh when it is next seen.
   */
  repaintTiles(tiles: ReadonlyArray<{ readonly x: number; readonly y: number }>): void {
    this.syncCanvasGeneration();
    if (this.chunks.size === 0 && this.job === null) return;
    const patches = this.pendingPatches;
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;
    for (const tile of tiles) {
      const tileX0 = Math.max(0, tile.x - CHUNK_REPAINT_MARGIN_TILES);
      const tileY0 = Math.max(0, tile.y - CHUNK_REPAINT_MARGIN_TILES);
      const tileX1 = Math.min(cols, tile.x + CHUNK_REPAINT_MARGIN_TILES + 1);
      const tileY1 = Math.min(rows, tile.y + CHUNK_REPAINT_MARGIN_TILES + 1);
      if (tileX0 >= tileX1 || tileY0 >= tileY1) continue;
      const cx0 = Math.floor(tileX0 / CHUNK_TILES);
      const cy0 = Math.floor(tileY0 / CHUNK_TILES);
      const cx1 = Math.floor((tileX1 - 1) / CHUNK_TILES);
      const cy1 = Math.floor((tileY1 - 1) / CHUNK_TILES);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = this.chunkKey(cx, cy);
          const resident = this.chunks.has(key);
          // A re-bake in progress would finish without a patch the old
          // picture is about to be given, so it starts over when next chosen.
          if (resident && this.job?.key === key) this.dropJob();
          // A first bake in progress may already have painted these tiles as
          // they were, so it owes the patch as much as a finished chunk does.
          if (!resident && this.job?.key !== key) continue;
          const patch = patches.get(key);
          if (patch === undefined) {
            patches.set(key, { cx, cy, tileX0, tileY0, tileX1, tileY1 });
            continue;
          }
          patch.tileX0 = Math.min(patch.tileX0, tileX0);
          patch.tileY0 = Math.min(patch.tileY0, tileY0);
          patch.tileX1 = Math.max(patch.tileX1, tileX1);
          patch.tileY1 = Math.max(patch.tileY1, tileY1);
        }
      }
    }
  }

  /**
   * Paints the patch owed to a resident chunk, if any, and returns how long it
   * took. A chunk whose patch throws is dropped, since a chunk half repainted
   * is worse than none: it bakes again when next seen.
   */
  private applyPendingPatch(key: number, chunk: CachedChunk): number {
    const patch = this.pendingPatches.get(key);
    if (patch === undefined) return 0;
    this.pendingPatches.delete(key);
    const startedAt = performance.now();
    try {
      this.repaintPatch(chunk, patch);
    } catch (error) {
      this.releaseChunk(chunk);
      this.chunks.delete(key);
      noteTileArtFailure(error);
    }
    const elapsedMs = performance.now() - startedAt;
    chunkPaintMsTotal += elapsedMs;
    return elapsedMs;
  }

  /**
   * Repaints one chunk's share of a patch, clipped to the patch and to the
   * chunk's own canvas. Every tile within {@link TILE_PAINT_OVERREACH_TILES}
   * of the clip is drawn, in the bake's row order, because a painter reaching
   * past its own tile lays pixels inside the clip that the bake laid there too.
   */
  private repaintPatch(chunk: CachedChunk, patch: ChunkRepaintPatch): void {
    perfMonitor.count('chunkRepaints', 1);
    const ts = this.ts;
    const structure = this.structure;
    const bounds = this.chunkTileBounds(patch.cx, patch.cy);
    const clipX0 = Math.max(patch.tileX0, bounds.tileX0);
    const clipY0 = Math.max(patch.tileY0, bounds.tileY0);
    const clipX1 = Math.min(patch.tileX1, bounds.tileX1);
    const clipY1 = Math.min(patch.tileY1, bounds.tileY1);
    if (clipX0 >= clipX1 || clipY0 >= clipY1) return;
    // Held to the chunk's own tiles, as the bake is: a neighbour chunk's
    // tiles never drew into this canvas, so their overreach must not either.
    const drawX0 = Math.max(bounds.tileX0, clipX0 - TILE_PAINT_OVERREACH_TILES);
    const drawY0 = Math.max(bounds.tileY0, clipY0 - TILE_PAINT_OVERREACH_TILES);
    const drawX1 = Math.min(bounds.tileX1, clipX1 + TILE_PAINT_OVERREACH_TILES);
    const drawY1 = Math.min(bounds.tileY1, clipY1 + TILE_PAINT_OVERREACH_TILES);
    const cctx = surfaceContext(chunk.canvas);
    const clipLeft = (clipX0 - bounds.tileX0) * ts;
    const clipTop = (clipY0 - bounds.tileY0) * ts;
    const clipWidth = (clipX1 - clipX0) * ts;
    const clipHeight = (clipY1 - clipY0) * ts;
    cctx.save();
    try {
      cctx.beginPath();
      cctx.rect(clipLeft, clipTop, clipWidth, clipHeight);
      cctx.clip();
      cctx.clearRect(clipLeft, clipTop, clipWidth, clipHeight);
      const patchSheets = recordSheetLookups(() => {
        for (let y = drawY0; y < drawY1; y++) {
          for (let x = drawX0; x < drawX1; x++) {
            const tile = structure[y][x];
            const isDecoration = DECORATION_TYPES.has(tile.type);
            drawTile(
              cctx,
              structure,
              tile.type,
              (x - bounds.tileX0) * ts,
              (y - bounds.tileY0) * ts,
              ts,
              x,
              y,
              isDecoration,
            );
          }
        }
      });
      // The rest of the chunk still shows what it was baked from.
      const addedSheets = patchSheets.filter((key) => !chunk.sheets.includes(key));
      if (addedSheets.length > 0) chunk.sheets = [...chunk.sheets, ...addedSheets];
    } finally {
      cctx.restore();
    }
  }

  /**
   * Draws the chunks under this view, all from one per-frame time budget. A
   * visible chunk owed a patch is patched before it is drawn, and a cold one
   * bakes; the first bake always runs, so the cache never stalls. What is left
   * goes to one bake spread across frames: a visible stale chunk's re-bake,
   * whose old picture is drawn until it finishes, else the next cold chunk just
   * ahead of a moving camera. Spare time after that patches off-screen chunks.
   * `unbounded` lifts the budget, for a map's very first frame: every visible
   * chunk is cold there, and throttling only smears the same work across
   * frames the player spends waiting on a black screen anyway.
   */
  renderVisible(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
    unbounded = false,
  ): void {
    const ts = this.ts;
    const chunkPx = CHUNK_TILES * ts;
    this.frameCounter++;
    this.syncCanvasGeneration();

    const cx0 = Math.max(0, Math.floor(cameraX / chunkPx));
    const cy0 = Math.max(0, Math.floor(cameraY / chunkPx));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((cameraX + viewW) / chunkPx));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((cameraY + viewH) / chunkPx));

    // Floor the camera-relative offset once so all chunks share the same
    // sub-pixel alignment — prevents hairline gaps between adjacent chunks.
    const baseX = Math.floor(-cameraX);
    const baseY = Math.floor(-cameraY);

    const budgetMs = unbounded ? Number.POSITIVE_INFINITY : CHUNK_BAKE_BUDGET_MS;
    let spentMs = 0;
    let bakedAny = false;
    const staleVisible = this.staleVisible;
    staleVisible.length = 0;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = baseX + cx * chunkPx;
        const dy = baseY + cy * chunkPx;
        const key = this.chunkKey(cx, cy);
        let cached = this.chunks.get(key);
        // Never held to the budget: a patch is a fraction of a bake, there is
        // at most a screenful of them, and a chunk drawn without its patch
        // would show the change's old art.
        if (cached !== undefined && this.pendingPatches.has(key)) {
          spentMs += this.applyPendingPatch(key, cached);
          cached = this.chunks.get(key);
        }
        if (cached) {
          cached.lastUsedFrame = this.frameCounter;
          touchEnvironmentSheets(cached.sheets);
          ctx.drawImage(cached.canvas, dx, dy);
          probeChunk = cached;
          probeChunkDrawnSinceProbe = true;
          if (cached.stale) staleVisible.push(cx, cy);
          continue;
        }
        if (!bakedAny || this.bakeFits(spentMs, budgetMs)) {
          bakedAny = true;
          const { chunk, elapsedMs } = this.timedBake(cx, cy);
          spentMs += elapsedMs;
          if (!unbounded) perfMonitor.count('chunkColdBakes', 1);
          if (chunk !== null) {
            ctx.drawImage(chunk.canvas, dx, dy);
            continue;
          }
        }
        // A chunk that cannot be painted is left out rather than allowed to
        // abort the frame: every chunk after it, and everything drawn over the
        // floor, would vanish with it, on every frame until it painted.
        try {
          this.drawChunkDirect(ctx, cx, cy, dx, dy);
        } catch (error) {
          noteTileArtFailure(error);
        }
      }
    }

    perfMonitor.count('staleChunks', staleVisible.length / CHUNK_COORDS_PER_ENTRY);
    const backgroundStartedAt = performance.now();
    const deadlineMs = backgroundStartedAt + Math.max(0, budgetMs - spentMs);
    const speculativeDeadlineMs = unbounded
      ? deadlineMs
      : Math.min(deadlineMs, backgroundStartedAt + CHUNK_SPECULATIVE_BUDGET_MS);
    let rebakedStale = false;
    // The guaranteed bake: a frame that baked nothing cold always moves a
    // stale re-bake on, so a screenful of stale chunks always drains.
    let owedProgress = !bakedAny;
    while (this.frameCounter >= this.bakeRetryFrame) {
      if (!owedProgress && performance.now() >= deadlineMs) break;
      const job = this.job ?? this.startNextJob(cameraX, cameraY, cx0, cy0, cx1, cy1);
      if (job === null) break;
      owedProgress = false;
      const inView = job.cx >= cx0 && job.cx <= cx1 && job.cy >= cy0 && job.cy <= cy1;
      if (inView) rebakedStale = true;
      // A bake ahead of the camera that stands between a stale chunk on screen
      // and its re-bake is finished at the full budget, so the stale one is
      // never held to the speculative pace.
      const blocksStaleRebake = staleVisible.length > 0;
      const jobDeadlineMs = inView || blocksStaleRebake ? deadlineMs : speculativeDeadlineMs;
      const chunk = this.advanceJob(job, jobDeadlineMs);
      if (chunk === null) break;
      if (inView) ctx.drawImage(chunk.canvas, baseX + job.cx * chunkPx, baseY + job.cy * chunkPx);
    }

    if (WATCHES_STALE_DRAIN) this.watchStaleDrain(staleVisible.length > 0, rebakedStale);

    this.patchOffscreen(speculativeDeadlineMs);
    this.previousCameraX = cameraX;
    this.previousCameraY = cameraY;

    this.evictLeastRecentlyUsed();
    this.releaseIdleChunks();
  }

  private watchStaleDrain(showsStale: boolean, rebakedStale: boolean): void {
    this.framesWithoutStaleBake = showsStale && !rebakedStale ? this.framesWithoutStaleBake + 1 : 0;
    if (this.warnedStaleDrain || this.framesWithoutStaleBake < STALE_DRAIN_WARN_FRAMES) return;
    this.warnedStaleDrain = true;
    console.warn(
      `[TileRenderer] a visible stale chunk has gone ${STALE_DRAIN_WARN_FRAMES} frames without any stale chunk re-baking`,
    );
  }

  /**
   * Starts the next bake spread across frames: a visible stale chunk's first,
   * since its old picture is on screen, then the next cold chunk ahead of the
   * camera. Null when there is neither.
   */
  private startNextJob(
    cameraX: number,
    cameraY: number,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
  ): ChunkBakeJob | null {
    const staleVisible = this.staleVisible;
    for (let index = 0; index < staleVisible.length; index += CHUNK_COORDS_PER_ENTRY) {
      const cx = staleVisible[index];
      const cy = staleVisible[index + 1];
      if (this.chunks.get(this.chunkKey(cx, cy))?.stale === true) return this.startJob(cx, cy);
    }
    const ahead = this.nextChunkAhead(cameraX, cameraY, cx0, cy0, cx1, cy1);
    if (ahead === NO_CHUNK) return null;
    return this.startJob(ahead % this.chunksX, Math.floor(ahead / this.chunksX));
  }

  /**
   * The key of the first cold chunk just past the edge of the view the camera
   * is moving toward, or {@link NO_CHUNK}. A chunk that scrolls in cold is
   * baked whole on the frame it appears, or painted tile by tile — which costs
   * as much as baking it — on every frame until it bakes, so the cheapest cold
   * chunk is one baked before it ever scrolls in. Moving diagonally, the
   * corner chunk between the leading column and row is included.
   */
  private nextChunkAhead(
    cameraX: number,
    cameraY: number,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
  ): number {
    const movedX = cameraX - (this.previousCameraX ?? cameraX);
    const movedY = cameraY - (this.previousCameraY ?? cameraY);
    const rowFrom = movedY < 0 ? cy0 - 1 : cy0;
    const rowTo = movedY > 0 ? cy1 + 1 : cy1;
    if (movedX !== 0) {
      const column = movedX > 0 ? cx1 + 1 : cx0 - 1;
      for (let cy = rowFrom; cy <= rowTo; cy++) {
        const key = this.coldChunkKey(column, cy);
        if (key !== NO_CHUNK) return key;
      }
    }
    if (movedY !== 0) {
      const row = movedY > 0 ? cy1 + 1 : cy0 - 1;
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = this.coldChunkKey(cx, row);
        if (key !== NO_CHUNK) return key;
      }
    }
    return NO_CHUNK;
  }

  /** The chunk's key when it is on the map and not baked, else {@link NO_CHUNK}. */
  private coldChunkKey(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) return NO_CHUNK;
    const key = this.chunkKey(cx, cy);
    return this.chunks.has(key) ? NO_CHUNK : key;
  }

  /**
   * Paints the patches owed to chunks off screen until `deadlineMs`, so a
   * chunk scrolling back into view has nothing left to patch. A patch owed to
   * a chunk no longer resident is dropped: it bakes fresh when next seen.
   */
  private patchOffscreen(deadlineMs: number): void {
    for (const [key] of this.pendingPatches) {
      if (performance.now() >= deadlineMs) return;
      const chunk = this.chunks.get(key);
      if (chunk !== undefined) {
        this.applyPendingPatch(key, chunk);
        continue;
      }
      if (this.job?.key !== key) this.pendingPatches.delete(key);
    }
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
      this.dropChunk(oldestKey);
    }
  }

  /** Lets go of every chunk not drawn within {@link CHUNK_IDLE_RELEASE_FRAMES}. */
  private releaseIdleChunks(): void {
    const oldestKeptFrame = this.frameCounter - CHUNK_IDLE_RELEASE_FRAMES;
    for (const [key, chunk] of this.chunks) {
      if (chunk.lastUsedFrame < oldestKeptFrame) this.dropChunk(key);
    }
  }

  private dropChunk(key: number): void {
    const chunk = this.chunks.get(key);
    if (chunk !== undefined) this.releaseChunk(chunk);
    this.chunks.delete(key);
    // A bake in progress for it still owes the patches made since it began.
    if (this.job?.key !== key) this.pendingPatches.delete(key);
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
  unboundedChunkBakes = false,
): void {
  if (chunkCache) {
    chunkCache.renderVisible(ctx, cameraX, cameraY, viewW, viewH, unboundedChunkBakes);
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
  /** Tile type the entry was rendered for; a change re-renders it. */
  type: number;
  /** The facade sheet a sprite building's entry was drawn from; undefined for every other type. */
  spriteKey: string | undefined;
  /** Environment sheets its pixels came from, kept drawn while the entry is. */
  sheets: readonly string[];
  /** Rendered before a sheet it may draw from landed; served until a frame's allowance redraws it. */
  stale: boolean;
  /** The overlay cache frame this entry was last drawn on, for eviction. */
  lastUsedFrame: number;
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
  // A village prop is drawn whole from one tile of its footprint; the rest of
  // the footprint reaches nowhere.
  if (type === HOLLOW_PROP_LOW || type === HOLLOW_PROP_TALL) {
    return hollowPropExtentsPx(structure, tx, ty);
  }
  // Likewise a circus structure: drawn whole from one tile, the rest reaching nowhere.
  if (type === CIRCUS_STRUCTURE_TALL || type === CIRCUS_STRUCTURE_LOW) {
    return circusStructureExtentsPx(structure, tx, ty);
  }
  if (type === TENT_POLE) return tentPoleExtentsPx(structure, tx, ty, ts);
  if (type === RIVER_REEDS) return { left: 0, up: REED_OVERHANG_PX, right: 0, down: 0 };
  const serviceExtents = serviceLevelPropExtentsPx(type, ts);
  if (serviceExtents !== null) return serviceExtents;
  const cellarExtents = cellarPropExtentsPx(type, ts);
  if (cellarExtents !== null) return cellarExtents;
  if (type === HOLLOW_WALL) return hollowWallExtentsPx(structure, tx, ty, ts);
  if (type === HOLLOW_PALISADE) return hollowPalisadeExtentsPx(ts);
  if (type === HOLLOW_GATE) return hollowGateExtentsPx(structure, tx, ty, ts);
  if (type === STEALTH_GATE_CLOSED || type === STEALTH_GATE_OPEN) {
    return stealthGateExtentsPx(structure, tx, ty, ts);
  }
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
 * `TREE` does not land here: its sheets declare `tileTypeId: 13`, so a
 * three-tile canopy gets its real extents rather than this one-tile guess. A
 * tree that fell back here would have its crown culled the moment its own tile
 * left the screen.
 */
function unregisteredDecorationExtents(ts: number): MapSpriteExtentsPx {
  return { left: ts, up: ts, right: ts, down: ts };
}

/**
 * The key of the entry a tile shares with every other tile drawing the same
 * picture, or null when its picture is its own.
 */
function sharedOverlayKey(type: number, tx: number, ty: number): string | null {
  if (type === RIVER_REEDS) return `${type}:${reedStandVariant(tx, ty)}`;
  return null;
}

function surfaceBytes(surface: CanvasSurface): number {
  return surface.width * surface.height * RGBA_STRIDE;
}

/**
 * Lazily-populated per-tile (or per-type) canvas cache for the decoration overlay pass.
 *
 * Each entry is a pre-rendered canvas covering the tile's full visual
 * extent (including any content that reaches above the tile boundary, such as
 * gable roofs or fountain water jets).  At draw time the entry is blitted with
 * a single drawImage call instead of replaying all canvas operations. An
 * entry is always the still picture; a building's animated layer is drawn over
 * it per frame by `drawDecorationLifeLayer`.
 *
 * Cache sharing rules:
 *  - BUILDING_WALL, ROOF_*: one canvas per tile (tx, ty) — each has position-dependent details.
 *  - RIVER_REEDS: one canvas per stand variant, shared by every tile drawing it.
 *  - TREE / TORCH / BRAZIER / WELL / FOUNTAIN: excluded — they already resolve to
 *    one drawImage call.
 */
export class OverlayTileCache {
  private readonly cache = new Map<number, OverlayCacheEntry>();
  private readonly shared = new Map<string, OverlayCacheEntry>();
  private readonly gridWidth: number;
  /** The canvas generation the entries were rendered in; see `canvasGeneration`. */
  private generation = canvasGeneration();
  /** The repainted-sheet revision the entries were rendered under; see `repaintedSheetRevision`. */
  private sheetRevision = repaintedSheetRevision();
  /** How far through the eviction repaints this cache has read; see `environmentSheetsRepaintedSince`. */
  private repaintCursor = environmentRepaintCursor();
  /** No new entry is rendered before this time; set by a render that threw. */
  private renderRetryAtMs = 0;
  /** Advanced by {@link beginFrame}; stamps each entry as it is drawn, for eviction. */
  private frame = 0;
  private staleRedrawsThisFrame = 0;
  private residentBytes = 0;

  constructor(
    private readonly structure: TileContent[][],
    private readonly ts: number,
  ) {
    this.gridWidth = structure[0]?.length ?? structure.length;
  }

  /**
   * Marks a frame boundary: resets the per-frame redraw allowance and evicts
   * the least recently drawn entries while the cache is over its byte budget.
   */
  beginFrame(): void {
    this.evictLeastRecentlyUsed();
    this.frame++;
    this.staleRedrawsThisFrame = 0;
  }

  /** Whether this tile has an up-to-date entry for its type. */
  has(type: number, tx: number, ty: number): boolean {
    this.syncCanvasGeneration();
    const sharedKey = sharedOverlayKey(type, tx, ty);
    const entry =
      sharedKey === null
        ? this.cache.get(tileIndex(tx, ty, this.gridWidth))
        : this.shared.get(sharedKey);
    return entry?.type === type && !entry.stale;
  }

  /**
   * Returns the pre-rendered entry for this tile, or null when it could not be
   * rendered — the caller then draws the tile directly. A stale entry is
   * redrawn only while this frame's allowance lasts and is served as it is
   * otherwise. A failure holds off new entries for a while: the usual cause is
   * the browser's canvas memory running out, and every decoration on screen
   * would otherwise fail again every frame.
   */
  get(type: number, tx: number, ty: number): OverlayCacheEntry | null {
    return this.lookup(type, tx, ty, true);
  }

  /** {@link get}, redrawing a stale entry whatever this frame has spent: for a loading screen. */
  warm(type: number, tx: number, ty: number): OverlayCacheEntry | null {
    return this.lookup(type, tx, ty, false);
  }

  private lookup(
    type: number,
    tx: number,
    ty: number,
    capStaleRedraws: boolean,
  ): OverlayCacheEntry | null {
    this.syncCanvasGeneration();
    const sharedKey = sharedOverlayKey(type, tx, ty);
    const entries: Map<number | string, OverlayCacheEntry> =
      sharedKey === null ? this.cache : this.shared;
    const key = sharedKey ?? tileIndex(tx, ty, this.gridWidth);
    const hit = entries.get(key);
    // A shared entry is keyed by its picture, so its type always matches.
    if (hit !== undefined && (sharedKey !== null || hit.type === type)) {
      hit.lastUsedFrame = this.frame;
      touchEnvironmentSheets(hit.sheets);
      if (!hit.stale) return hit;
      const allowanceSpent = this.staleRedrawsThisFrame >= OVERLAY_REDRAWS_PER_FRAME;
      if (capStaleRedraws && allowanceSpent) return hit;
      this.staleRedrawsThisFrame++;
      try {
        return this.refreshStale(entries, key, hit, type, tx, ty);
      } catch (error) {
        this.dropEntry(entries, key, hit);
        this.noteRenderFailure(error);
        return null;
      }
    }
    if (performance.now() < this.renderRetryAtMs) return null;
    try {
      const entry = this.renderEntry(type, tx, ty);
      if (hit !== undefined) this.dropEntry(entries, key, hit);
      this.addEntry(entries, key, entry);
      return entry;
    } catch (error) {
      this.noteRenderFailure(error);
      return null;
    }
  }

  /**
   * Repaints a stale entry into the canvas it already has, or into a new one
   * when the tile's reach has changed size since — a sheet landing can register
   * extents its fallback did not have.
   */
  private refreshStale(
    entries: Map<number | string, OverlayCacheEntry>,
    key: number | string,
    entry: OverlayCacheEntry,
    type: number,
    tx: number,
    ty: number,
  ): OverlayCacheEntry {
    const frame = this.entryFrame(type, tx, ty);
    const sameSize =
      frame.width === entry.canvas.width &&
      frame.height === entry.canvas.height &&
      frame.overhead === entry.overhead &&
      frame.leftOverhang === entry.leftOverhang;
    if (!sameSize) {
      const replacement = this.renderEntry(type, tx, ty);
      this.dropEntry(entries, key, entry);
      this.addEntry(entries, key, replacement);
      return replacement;
    }
    const perfStartedAt = perfMonitor.begin();
    const ctx = surfaceContext(entry.canvas);
    ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    entry.sheets = recordSheetLookups(() =>
      drawTile(
        ctx,
        this.structure,
        type,
        entry.leftOverhang,
        entry.overhead,
        this.ts,
        tx,
        ty,
        false,
      ),
    );
    entry.stale = false;
    perfMonitor.end('overlayBake', perfStartedAt);
    perfMonitor.count('overlayRedraws', 1);
    return entry;
  }

  private noteRenderFailure(error: unknown): void {
    this.renderRetryAtMs = performance.now() + OVERLAY_RENDER_RETRY_MS;
    noteTileArtFailure(error);
  }

  private addEntry(
    entries: Map<number | string, OverlayCacheEntry>,
    key: number | string,
    entry: OverlayCacheEntry,
  ): void {
    entries.set(key, entry);
    this.residentBytes += surfaceBytes(entry.canvas);
  }

  private dropEntry(
    entries: Map<number | string, OverlayCacheEntry>,
    key: number | string,
    entry: OverlayCacheEntry,
  ): void {
    this.residentBytes -= surfaceBytes(entry.canvas);
    releaseSurface(entry.canvas);
    entries.delete(key);
  }

  /**
   * Drop a tile's entry so it re-renders. Needed whenever the tile's art
   * changes at runtime — the entry is otherwise kept until evicted.
   */
  invalidateTile(tileX: number, tileY: number): void {
    const key = tileIndex(tileX, tileY, this.gridWidth);
    const entry = this.cache.get(key);
    if (entry === undefined) return;
    this.dropEntry(this.cache, key, entry);
  }

  /**
   * Drops the entries drawn from one sprite sheet, for when that sheet lands.
   * A sprite building's entry is drawn from its own facade sheet and nothing
   * else, so a facade landing touches only its building.
   */
  invalidateSpriteKey(spriteKey: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.spriteKey === spriteKey) this.dropEntry(this.cache, key, entry);
    }
  }

  /**
   * Marks entries for redrawing, for when a sheet they may draw from has
   * landed; each is served as it is until a frame's redraw allowance reaches
   * it. Sprite buildings are left alone unless `includeFacades` says a facade
   * sheet may have changed too, since a facade's own landing is
   * {@link invalidateSpriteKey}'s.
   */
  markAllStale(includeFacades: boolean): void {
    for (const entries of [this.cache, this.shared]) {
      for (const entry of entries.values()) {
        if (!includeFacades && entry.spriteKey !== undefined) continue;
        entry.stale = true;
      }
    }
  }

  /** Releases every entry's pixels. The cache stays usable and re-renders on demand. */
  dispose(): void {
    for (const entry of this.cache.values()) releaseSurface(entry.canvas);
    for (const entry of this.shared.values()) releaseSurface(entry.canvas);
    this.cache.clear();
    this.shared.clear();
    this.residentBytes = 0;
  }

  /**
   * As `TileChunkCache`'s: a canvas rebuild drops every entry, and a purge's
   * repaint landing marks them all stale, facades included, since any sheet
   * may be the one repainted. A building's sheet landing drops only that
   * building's entries.
   */
  private syncCanvasGeneration(): void {
    const current = canvasGeneration();
    const revision = repaintedSheetRevision();
    if (this.generation !== current) {
      this.generation = current;
      this.sheetRevision = revision;
      this.dispose();
      return;
    }
    if (this.sheetRevision !== revision) {
      this.sheetRevision = revision;
      this.markAllStale(true);
      return;
    }
    const repainted = environmentSheetsRepaintedSince(this.repaintCursor);
    this.repaintCursor = repainted.cursor;
    for (const sheet of repainted.sheets) {
      // A building's sheet is drawn by that building's entries alone.
      if (sheet.drawnOnlyByItsBuilding) this.invalidateSpriteKey(sheet.key);
      else this.markAllStale(false);
    }
  }

  /**
   * Keeps the cache inside its byte budget. Every building a player has ever
   * walked past would otherwise stay resident for the life of the floor, which
   * a phone's canvas memory cannot afford. An entry drawn on the frame just
   * finished is never evicted: it is on screen and would only be rendered again.
   */
  private evictLeastRecentlyUsed(): void {
    if (this.residentBytes <= OVERLAY_CACHE_BUDGET_BYTES) return;
    const candidates: Array<{
      entries: Map<number | string, OverlayCacheEntry>;
      key: number | string;
      entry: OverlayCacheEntry;
    }> = [];
    for (const entries of [this.cache, this.shared]) {
      for (const [key, entry] of entries) {
        if (entry.lastUsedFrame >= this.frame) continue;
        candidates.push({ entries, key, entry });
      }
    }
    candidates.sort((a, b) => a.entry.lastUsedFrame - b.entry.lastUsedFrame);
    for (const candidate of candidates) {
      if (this.residentBytes <= OVERLAY_CACHE_EVICT_TO_BYTES) return;
      this.dropEntry(candidate.entries, candidate.key, candidate.entry);
    }
  }

  /** The canvas a tile's entry needs, and where the tile's own square sits in it. */
  private entryFrame(type: number, tx: number, ty: number) {
    const { ts } = this;
    const extents = decorationTileExtentsPx(this.structure, type, tx, ty, ts);
    const overhead = Math.max(0, Math.ceil(extents.up));
    const leftOverhang = Math.max(0, Math.ceil(extents.left));
    return {
      overhead,
      leftOverhang,
      width: leftOverhang + ts + Math.max(0, Math.ceil(extents.right)),
      height: overhead + ts + Math.max(0, Math.ceil(extents.down)),
    };
  }

  private renderEntry(type: number, tx: number, ty: number): OverlayCacheEntry {
    const perfStartedAt = perfMonitor.begin();
    const { overhead, leftOverhang, width, height } = this.entryFrame(type, tx, ty);
    const canvas = allocCanvas('tileOverlays', width, height);
    let sheets: readonly string[];
    try {
      const ctx = surfaceContext(canvas);
      sheets = recordSheetLookups(() =>
        drawTile(ctx, this.structure, type, leftOverhang, overhead, this.ts, tx, ty, false),
      );
    } catch (error) {
      releaseSurface(canvas);
      throw error;
    }
    perfMonitor.end('overlayBake', perfStartedAt);
    perfMonitor.count('overlayRedraws', 1);
    return {
      canvas,
      overhead,
      leftOverhang,
      type,
      spriteKey: type === SPRITE_BUILDING ? this.structure[ty][tx].spriteKey : undefined,
      sheets,
      stale: false,
      lastUsedFrame: this.frame,
    };
  }
}

/**
 * Draws a single decoration tile at full fidelity (used for z-sorted rendering).
 * When an OverlayTileCache is provided, cacheable tile types blit a pre-rendered
 * canvas instead of replaying all draw commands every frame. A building's
 * animated layer is drawn over it only at `fullDetail`.
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
  fullDetail = true,
): void {
  const type = structure[ty][tx].type;
  drawDecorationStill(ctx, structure, type, tx, ty, sx, sy, ts, overlayCache);
  if (fullDetail) drawDecorationLifeLayer(ctx, structure, type, sx, sy, ts, tx, ty);
}

function drawDecorationStill(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  ts: number,
  overlayCache: OverlayTileCache | undefined,
): void {
  if (overlayCache && CACHEABLE_OVERLAY_TYPES.has(type)) {
    const entry = overlayCache.get(type, tx, ty);
    if (entry !== null) {
      ctx.drawImage(entry.canvas, sx - entry.leftOverhang, sy - entry.overhead);
      return;
    }
    // Left out if even this fails, rather than allowed to abort the pass:
    // every decoration and body drawn after it would vanish with it.
    ctx.save();
    try {
      drawTile(ctx, structure, type, sx, sy, ts, tx, ty, false);
    } catch (error) {
      noteTileArtFailure(error);
    } finally {
      ctx.restore();
    }
    return;
  }
  drawTile(ctx, structure, type, sx, sy, ts, tx, ty, false);
}

/** The tile rectangle a decoration pass over this view must scan, overhang included. */
function decorationScanBounds(
  structure: TileContent[][],
  ts: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
): { startX: number; startY: number; endX: number; endY: number } {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  // Widen the scan by the worst-case sprite overhang so decorations whose
  // anchor tile is just off-screen don't pop out of existence at the edges.
  const extents = getMapSpriteExtentsPx();
  return {
    startX: Math.max(0, Math.floor(cameraX / ts) - Math.ceil(extents.right / ts)),
    startY: Math.max(0, Math.floor(cameraY / ts) - Math.ceil(extents.down / ts)),
    endX: Math.min(cols - 1, Math.ceil((cameraX + viewW) / ts) + Math.ceil(extents.left / ts)),
    endY: Math.min(rows - 1, Math.ceil((cameraY + viewH) / ts) + Math.ceil(extents.up / ts)),
  };
}

/** Measured cost of rendering one overlay entry, shared by every cache; null before the first. */
let overlayEntryEstimateMs: number | null = null;

/**
 * Renders the overlay entries a view at this camera would draw, for up to
 * `budgetMs`, and returns the fraction of them now warm.
 *
 * For a loading screen covering a floor's arrival: each decoration's entry is
 * otherwise rendered on the first frame that draws it, and a town's first
 * screenful is dozens of them — tens of milliseconds on the first frame of play.
 * An entry starts only if its measured cost fits what is left, except the first
 * when `mustProgress` says nothing else has run this frame.
 */
export function bakeDecorationsForView(
  structure: TileContent[][],
  ts: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
  overlayCache: OverlayTileCache,
  budgetMs: number,
  mustProgress: boolean,
): number {
  const { startX, startY, endX, endY } = decorationScanBounds(
    structure,
    ts,
    cameraX,
    cameraY,
    viewW,
    viewH,
  );
  let inView = 0;
  let warm = 0;
  let spentMs = 0;
  let startedAny = false;
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const type = structure[y][x].type;
      if (!DECORATION_TYPES.has(type) || !CACHEABLE_OVERLAY_TYPES.has(type)) continue;
      inView++;
      if (overlayCache.has(type, x, y)) {
        warm++;
        continue;
      }
      const owedFirstEntry = mustProgress && !startedAny;
      const estimate = overlayEntryEstimateMs;
      const fits = estimate !== null && spentMs + estimate <= budgetMs;
      if (!owedFirstEntry && !fits) continue;
      startedAny = true;
      const startedAt = performance.now();
      overlayCache.warm(type, x, y);
      const elapsed = performance.now() - startedAt;
      spentMs += elapsed;
      overlayEntryEstimateMs =
        estimate === null ? elapsed : estimate + (elapsed - estimate) * CHUNK_BAKE_COST_SMOOTHING;
      warm++;
    }
  }
  return inView === 0 ? 1 : warm / inView;
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
  fullDetail = true,
): void {
  const ts = tileHeight;
  const { startX, startY, endX, endY } = decorationScanBounds(
    structure,
    ts,
    cameraX,
    cameraY,
    viewW,
    viewH,
  );

  const baseline = ctx.getTransform();
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const tile = structure[y][x];
      if (!DECORATION_TYPES.has(tile.type)) continue;
      const sx = x * ts - cameraX;
      const sy = y * ts - cameraY;
      try {
        drawDecorationTileFull(ctx, structure, x, y, sx, sy, ts, overlayCache, fullDetail);
      } catch (error) {
        noteDrawFailure('TileRenderer', error);
        recoverDrawState(ctx, baseline);
      }
    }
  }
}
