/**
 * Where dungeon water meets dry floor: an irregular waterline that wanders
 * across the tile grid, the floor beside it soaked dark, and laps of water
 * and foam running up over the wet floor and draining back.
 *
 * The waterline is the zero contour of one field defined in world space — a
 * softened water/dry map of the tiles plus a meandering noise — so every tile
 * that samples it agrees with its neighbours along their shared edges and the
 * line never kinks at a tile boundary. Only tiles whose 5×5 neighbourhood
 * holds both water and dry floor (the shore band) can see the contour; walls
 * and floor under a float count as neither. Every other tile is wholly water
 * or wholly dry and is drawn as open water or plain floor.
 *
 * Two halves draw from the same per-tile record:
 * - baked into the terrain chunk ({@link drawDungeonShoreBake}): the soaked
 *   floor, and the water column clipped to the wandering waterline;
 * - per frame ({@link drawDungeonShoreSurface}): the chop clipped to the same
 *   line, fading to calm in the shallows, and the lap loop.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  resizeSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { canvasGeneration, onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../dungeon/floorTheme';
import { NoiseField } from '../tilegen/noise';
import {
  FloorTypeValue,
  isDungeonWater,
  MAX_WATER_DEPTH,
  VOID_TYPE,
  type TileContent,
} from '../tileTypes';
import {
  DUNGEON_WATER_PLANS,
  type DungeonWaterPlan,
  type WaterInk,
} from '../../sprites/sheets/dungeonWaterSheets';
import { dungeonWaterDepth } from '../dungeonWater';
import {
  drawDungeonWaterColumn,
  dungeonWaterRevision,
  warmDungeonWaterColumn,
} from './dungeonWaterColumn';
import { DUNGEON_WATER_SURFACE_DENSITY, dungeonWaterSurfacePatchAt } from './dungeonWaterSurface';
import { drawImageSnapped } from './deviceSnap';

/** Tiles either side of a tile whose water decides its shore: the softening's reach plus the interpolation's. */
const DUNGEON_SHORE_REACH_TILES = 2;
/** A wall's wetness reads the tiles beside it. */
const WALL_WETNESS_REACH_TILES = 1;
/** How far from a tile whose water changes the shore drawn on another tile can change. */
export const DUNGEON_SHORE_REPAINT_REACH_TILES =
  DUNGEON_SHORE_REACH_TILES + WALL_WETNESS_REACH_TILES;
const WINDOW_TILES = DUNGEON_SHORE_REACH_TILES * 2 + 1;

/** The shore's painted pixels, matched to the chop so its mask lines up pixel for pixel. */
const SHORE_PX = Math.round(TILE_SIZE * DUNGEON_WATER_SURFACE_DENSITY);

/*
 * Every distance below is in units of the shore field, where a straight
 * shoreline climbs a third of a unit per tile: one unit is about three tiles.
 */

/** How far the waterline meanders either side of the tile edge. */
const SHORE_WANDER = 0.12;
/** The column feathers in over this band, so the waterline is soft but still a line. */
const COLUMN_EDGE_FROM = -0.012;
const COLUMN_EDGE_TO = 0.03;
/** The chop calms to nothing at the waterline over this much water. */
const CHOP_CALM_REACH = 0.1;
/** How far up the floor the soaking reaches at most, and how much of that it may fall short by. */
const WET_REACH = 0.18;
const WET_REACH_SHORTFALL = 0.45;
/** The soaking stops darkening once the water over it is this deep, where the column has taken over. */
const WET_UNDER_WATER = 0.04;
/** How far a lap runs up past the waterline at its height. */
const LAP_REACH = 0.07;
/** Half the width of the foam riding a lap's front, and of the scum resting on the waterline. */
const LAP_FOAM_HALF_WIDTH = 0.022;
const REST_FOAM_HALF_WIDTH = 0.016;
/** A lap's film thins out as it reaches the top of its run. */
const LAP_FILM_THINNING = 0.5;

const LAP_FRAMES = 8;
const LAP_FRAMES_PER_SECOND = 4;
/** How many whole lap cycles the phase drifts over across the shore, so laps travel along it rather than breathing in step. */
const LAP_PHASE_SPREAD = 2;

/**
 * World-space noise is sampled from a field that wraps far beyond any map,
 * so it never repeats inside one. Its lattice periods are powers of two so
 * every cell is a whole number of pixels.
 */
const NOISE_WRAP_PX = 65536;
const WANDER_PERIOD = NOISE_WRAP_PX / 64;
const WANDER_OCTAVES = 4;
const WET_REACH_PERIOD = NOISE_WRAP_PX / 32;
const WET_REACH_OCTAVES = 2;
const LAP_PHASE_PERIOD = NOISE_WRAP_PX / 128;
const LAP_PHASE_OCTAVES = 2;
const FOAM_BREAKUP_PERIOD = NOISE_WRAP_PX / 8;
const FOAM_BREAKUP_OCTAVES = 2;
/** Foam only where the breakup noise clears this, so it lies in clots and strings, not a ruled line. */
const FOAM_BREAKUP_FROM = 0.38;
const FOAM_BREAKUP_TO = 0.6;
const SEED_WANDER = 211;
const SEED_WET_REACH = 223;
const SEED_LAP_PHASE = 227;
const SEED_LAP_FOAM = 229;
const SEED_REST_FOAM = 233;

const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;
const TWO_PI = Math.PI * 2;

const noise = new NoiseField(NOISE_WRAP_PX);

/** How much of a tile the water covers, before the waterline's meander: 1 water, 0 dry floor. */
type Wetness = 0 | 1;

/**
 * Water 1, dry floor 0. Floor under a float takes 1, since the water runs
 * under it. A wall takes 1 when water laps against one of its faces, so a
 * shoreline meeting a wall runs into it square instead of curling away from it.
 */
function wetnessAt(structure: TileContent[][], tx: number, ty: number): Wetness {
  const isOnMap = ty >= 0 && tx >= 0 && ty < structure.length && tx < structure[ty].length;
  if (!isOnMap) return 0;
  const cell = structure[ty][tx];
  if (isDungeonWater(cell) || cell.underFloat === true) return 1;
  if (!isSolid(cell)) return 0;
  const touchesWater =
    isDungeonWater(structure[ty - 1]?.[tx]) ||
    isDungeonWater(structure[ty + 1]?.[tx]) ||
    isDungeonWater(structure[ty]?.[tx - 1]) ||
    isDungeonWater(structure[ty]?.[tx + 1]);
  return touchesWater ? 1 : 0;
}

function isSolid(cell: TileContent): boolean {
  return cell.type === FloorTypeValue.wall || cell.type === VOID_TYPE;
}

/**
 * Whether a tile says nothing about where the shore is: a wall, which water
 * meets square whichever side of it the floor is dry, or floor under a float.
 * Without this every wall a room's water reaches would make a shore of the
 * water along it, which draws exactly as open water at many times the cost.
 */
function isShoreNeutral(cell: TileContent): boolean {
  return isSolid(cell) || cell.underFloat === true;
}

/** The wetness of a tile's 5×5 neighbourhood, row-major: everything its shore depends on. */
function wetnessWindow(structure: TileContent[][], tx: number, ty: number): Wetness[] {
  const window: Wetness[] = [];
  for (let dy = -DUNGEON_SHORE_REACH_TILES; dy <= DUNGEON_SHORE_REACH_TILES; dy++) {
    for (let dx = -DUNGEON_SHORE_REACH_TILES; dx <= DUNGEON_SHORE_REACH_TILES; dx++) {
      window.push(wetnessAt(structure, tx + dx, ty + dy));
    }
  }
  return window;
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function positiveMod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/**
 * The shore field over one tile. Softened wetness is each tile's 3×3 mean,
 * read at tile centres and interpolated between them, so the waterline sits
 * on the tile edge before the meander moves it.
 */
class ShoreField {
  /** Softened wetness at the centres of the tile and its eight neighbours, row-major. */
  private readonly softened: number[] = [];

  constructor(
    window: readonly Wetness[],
    private readonly tx: number,
    private readonly ty: number,
  ) {
    for (let cy = 1; cy < WINDOW_TILES - 1; cy++) {
      for (let cx = 1; cx < WINDOW_TILES - 1; cx++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += window[(cy + dy) * WINDOW_TILES + cx + dx];
        }
        this.softened.push(sum / 9);
      }
    }
  }

  /** Positive in water, negative on dry floor, zero on the waterline. */
  signal(worldX: number, worldY: number): number {
    const gridX = worldX / TILE_SIZE - 0.5 - (this.tx - 1);
    const gridY = worldY / TILE_SIZE - 0.5 - (this.ty - 1);
    const cellX = Math.min(1, Math.max(0, Math.floor(gridX)));
    const cellY = Math.min(1, Math.max(0, Math.floor(gridY)));
    const u = gridX - cellX;
    const v = gridY - cellY;
    const softenedSpan = WINDOW_TILES - 2;
    const at = (x: number, y: number): number => this.softened[y * softenedSpan + x];
    const top = at(cellX, cellY) + (at(cellX + 1, cellY) - at(cellX, cellY)) * u;
    const bottom = at(cellX, cellY + 1) + (at(cellX + 1, cellY + 1) - at(cellX, cellY + 1)) * u;
    const wetness = top + (bottom - top) * v;
    const meander =
      (noise.fbm(worldX, worldY, SEED_WANDER, WANDER_OCTAVES, WANDER_PERIOD) - 0.5) *
      2 *
      SHORE_WANDER;
    return wetness - 0.5 + meander;
  }
}

/** How a shore tile's water is drawn: not at all, edge to edge as open water, or through a mask. */
type Coverage =
  | { readonly kind: 'none' }
  | { readonly kind: 'full' }
  | { readonly kind: 'masked'; readonly mask: CanvasSurface };

interface ShoreRecord {
  /** The wetness window it was painted from; a record whose window has changed is repainted. */
  readonly signature: string;
  /** The water revision the signature was last found current at, so an unchanged map skips the check. */
  checkedAtRevision: number;
  readonly column: Coverage;
  readonly chop: Coverage;
  readonly wet: CanvasSurface | null;
  readonly laps: readonly CanvasSurface[] | null;
}

interface ShoreCache {
  readonly structure: TileContent[][];
  readonly theme: DungeonFloorThemeId;
  readonly generation: number;
  revision: number;
  /** 1 for a walkable tile in the shore band, by `ty * cols + tx`. */
  band: Uint8Array;
  readonly records: Map<number, ShoreRecord>;
}

let cache: ShoreCache | null = null;

function releaseRecord(record: ShoreRecord): void {
  if (record.column.kind === 'masked') releaseSurface(record.column.mask);
  if (record.chop.kind === 'masked') releaseSurface(record.chop.mask);
  if (record.wet !== null) releaseSurface(record.wet);
  for (const lap of record.laps ?? []) releaseSurface(lap);
}

function releaseCache(): void {
  if (cache === null) return;
  for (const record of cache.records.values()) releaseRecord(record);
  cache = null;
}

const SIDE_DRY = 0;
const SIDE_WET = 1;
const SIDE_NEUTRAL = 2;

function buildBand(structure: TileContent[][]): Uint8Array {
  const rows = structure.length;
  const cols = structure[0]?.length ?? 0;
  const band = new Uint8Array(rows * cols);
  if (!structure.some((row) => row.some((cell) => isDungeonWater(cell)))) return band;
  const sides = new Uint8Array(rows * cols);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const cell = structure[ty][tx];
      const side = isShoreNeutral(cell) ? SIDE_NEUTRAL : isDungeonWater(cell) ? SIDE_WET : SIDE_DRY;
      sides[ty * cols + tx] = side;
    }
  }
  const reach = DUNGEON_SHORE_REACH_TILES;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (sides[ty * cols + tx] === SIDE_NEUTRAL) continue;
      let wetSeen = false;
      let drySeen = false;
      for (let y = Math.max(0, ty - reach); y <= Math.min(rows - 1, ty + reach); y++) {
        for (let x = Math.max(0, tx - reach); x <= Math.min(cols - 1, tx + reach); x++) {
          const side = sides[y * cols + x];
          if (side === SIDE_WET) wetSeen = true;
          else if (side === SIDE_DRY) drySeen = true;
        }
      }
      if (wetSeen && drySeen) band[ty * cols + tx] = 1;
    }
  }
  return band;
}

/** Gives back every record whose tile has left the band, which no draw will ask for again. */
function releaseRecordsOutside(shore: ShoreCache): void {
  for (const [key, record] of shore.records) {
    if (shore.band[key] === 1) continue;
    releaseRecord(record);
    shore.records.delete(key);
  }
}

function cacheFor(structure: TileContent[][]): ShoreCache {
  const theme = dungeonFloorTheme().id;
  const generation = canvasGeneration();
  const revision = dungeonWaterRevision(structure);
  if (cache?.structure === structure && cache.theme === theme && cache.generation === generation) {
    if (cache.revision !== revision) {
      cache.revision = revision;
      cache.band = buildBand(structure);
      releaseRecordsOutside(cache);
    }
    return cache;
  }
  releaseCache();
  const fresh: ShoreCache = {
    structure,
    theme,
    generation,
    revision,
    band: buildBand(structure),
    records: new Map(),
  };
  cache = fresh;
  return fresh;
}

/** True for a walkable tile near enough a waterline to be drawn by this module rather than as open water or dry floor. */
export function isDungeonShoreTile(structure: TileContent[][], tx: number, ty: number): boolean {
  const cols = structure[0]?.length ?? 0;
  if (tx < 0 || ty < 0 || tx >= cols || ty >= structure.length) return false;
  return cacheFor(structure).band[ty * cols + tx] === 1;
}

/** Paints straight-alpha RGBA bytes into a fresh shore-sized surface, or null when nothing in them shows. */
function surfaceFrom(rgba: Uint8ClampedArray): CanvasSurface | null {
  let anyInk = false;
  for (let at = ALPHA; at < rgba.length; at += RGBA_CHANNELS) {
    if (rgba[at] > 0) {
      anyInk = true;
      break;
    }
  }
  if (!anyInk) return null;
  const surface = allocCanvas('groundTileParts', SHORE_PX, SHORE_PX);
  const surfaceCtx = surfaceContext(surface);
  const image = surfaceCtx.createImageData(SHORE_PX, SHORE_PX);
  image.data.set(rgba);
  surfaceCtx.putImageData(image, 0, 0);
  return surface;
}

function coverageFrom(alphas: Float32Array): Coverage {
  if (alphas.every((alpha) => alpha <= 0)) return { kind: 'none' };
  if (alphas.every((alpha) => alpha >= 1)) return { kind: 'full' };
  const rgba = new Uint8ClampedArray(alphas.length * RGBA_CHANNELS);
  for (let i = 0; i < alphas.length; i++) {
    const at = i * RGBA_CHANNELS;
    rgba[at + RED] = BYTE_MAX;
    rgba[at + GREEN] = BYTE_MAX;
    rgba[at + BLUE] = BYTE_MAX;
    rgba[at + ALPHA] = alphas[i] * BYTE_MAX;
  }
  const mask = surfaceFrom(rgba);
  return mask === null ? { kind: 'none' } : { kind: 'masked', mask };
}

/** Lays `ink` at `alpha` over the straight-alpha float pixel at `at`. */
function layOver(rgba: Float32Array, at: number, ink: WaterInk, alpha: number): void {
  if (alpha <= 0) return;
  const below = rgba[at + ALPHA];
  const combined = alpha + below * (1 - alpha);
  const keep = (below * (1 - alpha)) / combined;
  const take = alpha / combined;
  rgba[at + RED] = ink.r * take + rgba[at + RED] * keep;
  rgba[at + GREEN] = ink.g * take + rgba[at + GREEN] * keep;
  rgba[at + BLUE] = ink.b * take + rgba[at + BLUE] * keep;
  rgba[at + ALPHA] = combined;
}

function toBytes(rgba: Float32Array): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(rgba.length);
  for (let at = 0; at < rgba.length; at += RGBA_CHANNELS) {
    bytes[at + RED] = rgba[at + RED];
    bytes[at + GREEN] = rgba[at + GREEN];
    bytes[at + BLUE] = rgba[at + BLUE];
    bytes[at + ALPHA] = rgba[at + ALPHA] * BYTE_MAX;
  }
  return bytes;
}

/** A foam band of `halfWidth` either side of `center`, broken into clots by `breakup`. */
function foamAlpha(signal: number, center: number, halfWidth: number, breakup: number): number {
  const across = 1 - Math.abs(signal - center) / halfWidth;
  if (across <= 0) return 0;
  return across * across * smoothstep(FOAM_BREAKUP_FROM, FOAM_BREAKUP_TO, breakup);
}

function paintRecord(
  plan: DungeonWaterPlan,
  window: readonly Wetness[],
  signature: string,
  revision: number,
  tx: number,
  ty: number,
): ShoreRecord {
  const field = new ShoreField(window, tx, ty);
  const pixels = SHORE_PX * SHORE_PX;
  const signals = new Float32Array(pixels);
  const columnAlphas = new Float32Array(pixels);
  const chopAlphas = new Float32Array(pixels);
  const wet = new Float32Array(pixels * RGBA_CHANNELS);
  const lapPhases = new Float32Array(pixels);
  const lapBreakups = new Float32Array(pixels);
  const restBreakups = new Float32Array(pixels);
  const ink = plan.shore;
  for (let py = 0; py < SHORE_PX; py++) {
    const worldY = ty * TILE_SIZE + (py + 0.5) / DUNGEON_WATER_SURFACE_DENSITY;
    for (let px = 0; px < SHORE_PX; px++) {
      const worldX = tx * TILE_SIZE + (px + 0.5) / DUNGEON_WATER_SURFACE_DENSITY;
      const i = py * SHORE_PX + px;
      const signal = field.signal(worldX, worldY);
      signals[i] = signal;
      columnAlphas[i] = smoothstep(COLUMN_EDGE_FROM, COLUMN_EDGE_TO, signal);
      chopAlphas[i] = smoothstep(0, CHOP_CALM_REACH, signal);
      const reachNoise = noise.fbm(
        worldX,
        worldY,
        SEED_WET_REACH,
        WET_REACH_OCTAVES,
        WET_REACH_PERIOD,
      );
      const wetReach = WET_REACH * (1 - WET_REACH_SHORTFALL * reachNoise);
      const soaked =
        (1 - smoothstep(0, wetReach, -signal)) * (1 - smoothstep(0, WET_UNDER_WATER, signal));
      layOver(wet, i * RGBA_CHANNELS, ink.wet, soaked * ink.wetAlpha);
      lapPhases[i] =
        noise.fbm(worldX, worldY, SEED_LAP_PHASE, LAP_PHASE_OCTAVES, LAP_PHASE_PERIOD) *
        LAP_PHASE_SPREAD;
      lapBreakups[i] = noise.fbm(
        worldX,
        worldY,
        SEED_LAP_FOAM,
        FOAM_BREAKUP_OCTAVES,
        FOAM_BREAKUP_PERIOD,
      );
      restBreakups[i] = noise.fbm(
        worldX,
        worldY,
        SEED_REST_FOAM,
        FOAM_BREAKUP_OCTAVES,
        FOAM_BREAKUP_PERIOD,
      );
    }
  }

  const film = plan.byDepth[1];
  const laps: CanvasSurface[] = [];
  for (let frame = 0; frame < LAP_FRAMES; frame++) {
    const rgba = new Float32Array(pixels * RGBA_CHANNELS);
    for (let i = 0; i < pixels; i++) {
      const signal = signals[i];
      const at = i * RGBA_CHANNELS;
      const height = 0.5 - 0.5 * Math.cos(TWO_PI * (frame / LAP_FRAMES + lapPhases[i]));
      const front = -LAP_REACH * height;
      const underLap = smoothstep(front - LAP_FOAM_HALF_WIDTH / 2, front, signal);
      const filmAlpha =
        underLap * (1 - columnAlphas[i]) * ink.filmAlpha * (1 - LAP_FILM_THINNING * height);
      layOver(rgba, at, film, filmAlpha);
      const rest = foamAlpha(signal, 0, REST_FOAM_HALF_WIDTH, restBreakups[i]) * ink.restFoamAlpha;
      const riding =
        foamAlpha(signal, front, LAP_FOAM_HALF_WIDTH, lapBreakups[i]) * ink.lapFoamAlpha;
      layOver(rgba, at, plan.surface.foam, Math.max(rest, riding));
    }
    const lap = surfaceFrom(toBytes(rgba));
    if (lap === null) break;
    laps.push(lap);
  }
  const lapsComplete = laps.length === LAP_FRAMES;
  if (!lapsComplete) for (const lap of laps) releaseSurface(lap);

  return {
    signature,
    checkedAtRevision: revision,
    column: coverageFrom(columnAlphas),
    chop: coverageFrom(chopAlphas),
    wet: surfaceFrom(toBytes(wet)),
    laps: lapsComplete ? laps : null,
  };
}

function recordAt(structure: TileContent[][], tx: number, ty: number): ShoreRecord | null {
  const shore = cacheFor(structure);
  const cols = structure[0]?.length ?? 0;
  if (shore.band[ty * cols + tx] !== 1) return null;
  const key = ty * cols + tx;
  const existing = shore.records.get(key);
  if (existing?.checkedAtRevision === shore.revision) return existing;
  const window = wetnessWindow(structure, tx, ty);
  const signature = window.join('');
  if (existing?.signature === signature) {
    existing.checkedAtRevision = shore.revision;
    return existing;
  }
  if (existing !== undefined) releaseRecord(existing);
  const plan = DUNGEON_WATER_PLANS[shore.theme];
  const record = paintRecord(plan, window, signature, shore.revision, tx, ty);
  shore.records.set(key, record);
  return record;
}

/**
 * Paints every shore tile's record ahead of the first bake, so neither a chunk
 * bake nor the first frames by the water pay for them. A map with no dungeon
 * water gives the previous map's shore back.
 */
function warmDungeonShore(structure: TileContent[][]): void {
  const shore = cacheFor(structure);
  if (!shore.band.includes(1)) {
    releaseCache();
    return;
  }
  const cols = structure[0]?.length ?? 0;
  for (let key = 0; key < shore.band.length; key++) {
    if (shore.band[key] === 1) recordAt(structure, key % cols, Math.floor(key / cols));
  }
}

/**
 * A recovery leaves every record and the column's samples painted into dead
 * surfaces, and repainting them lazily would land on the render path all at
 * once, so the floor's water is painted again straight away.
 */
onCanvasRecovery(() => {
  const structure = cache?.structure;
  releaseCache();
  if (structure !== undefined) warmDungeonWater(structure);
});

/**
 * Paints everything the map's dungeon water draws from ahead of its first
 * frame: the column's samples, the moving surface and every shore record.
 * Call again after water is poured or a float set down outside a drain, so
 * the change is not painted on the render path.
 */
export function warmDungeonWater(structure: TileContent[][]): void {
  warmDungeonWaterColumn(structure);
  warmDungeonShore(structure);
}

let bakeScratch: CanvasSurface | null = null;

function bakeScratchSized(size: number): CanvasSurface {
  if (bakeScratch === null) {
    bakeScratch = allocCanvas('groundTileParts', size, size);
    return bakeScratch;
  }
  if (bakeScratch.width !== size || bakeScratch.height !== size) {
    resizeSurface(bakeScratch, size, size);
  }
  return bakeScratch;
}

/**
 * Draws the water's part of a ground tile into the terrain bake: for a shore
 * tile the soaked floor and the column clipped to the waterline, for open
 * water the column alone, and nothing for dry floor away from the water.
 */
export function drawDungeonShoreBake(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const record = recordAt(structure, tx, ty);
  if (record === null) {
    if (isDungeonWater(structure[ty]?.[tx]))
      drawDungeonWaterColumn(ctx, structure, sx, sy, ts, tx, ty);
    return;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (record.wet !== null) ctx.drawImage(record.wet, sx, sy, ts, ts);
  switch (record.column.kind) {
    case 'none':
      break;
    case 'full':
      drawDungeonWaterColumn(ctx, structure, sx, sy, ts, tx, ty);
      break;
    case 'masked': {
      const transform = ctx.getTransform();
      const deviceScale = Math.hypot(transform.a, transform.b);
      const size = Math.max(1, Math.ceil(ts * deviceScale));
      const scratch = bakeScratchSized(size);
      const scratchCtx = surfaceContext(scratch);
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
      scratchCtx.globalCompositeOperation = 'source-over';
      scratchCtx.clearRect(0, 0, size, size);
      drawDungeonWaterColumn(scratchCtx, structure, 0, 0, size, tx, ty);
      scratchCtx.globalCompositeOperation = 'destination-in';
      scratchCtx.imageSmoothingEnabled = true;
      scratchCtx.imageSmoothingQuality = 'high';
      scratchCtx.drawImage(record.column.mask, 0, 0, size, size);
      scratchCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0, size, size, sx, sy, ts, ts);
      break;
    }
    default: {
      const unhandled: never = record.column;
      throw new Error(`Unhandled shore coverage: ${JSON.stringify(unhandled)}`);
    }
  }
  ctx.restore();
}

/** The depth whose chop strength a shore tile takes: its own, or the deepest water touching it. */
function chopDepthAt(structure: TileContent[][], tx: number, ty: number): number {
  const rows = structure.length;
  const cols = structure[0]?.length ?? 0;
  let deepest = 0;
  for (let y = Math.max(0, ty - 1); y <= Math.min(rows - 1, ty + 1); y++) {
    for (let x = Math.max(0, tx - 1); x <= Math.min(cols - 1, tx + 1); x++) {
      deepest = Math.max(deepest, dungeonWaterDepth(structure[y][x]));
    }
  }
  const ownDepth = dungeonWaterDepth(structure[ty][tx]);
  const depth = ownDepth > 0 ? ownDepth : deepest;
  return Math.min(MAX_WATER_DEPTH, Math.max(1, Math.round(depth)));
}

/** Visible shore tiles, gathered by the caller each frame: `reset`, then `add`. */
export class DungeonShoreTiles {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private count = 0;

  reset(): void {
    this.count = 0;
  }

  add(tx: number, ty: number): void {
    if (this.count === this.xs.length) {
      this.xs.push(tx);
      this.ys.push(ty);
    } else {
      this.xs[this.count] = tx;
      this.ys[this.count] = ty;
    }
    this.count++;
  }

  get size(): number {
    return this.count;
  }

  tileX(index: number): number {
    return this.xs[index];
  }

  tileY(index: number): number {
    return this.ys[index];
  }
}

let frameScratch: CanvasSurface | null = null;
const scratchPatterns = new WeakMap<CanvasSurface, CanvasPattern>();

function frameScratchContext(): CanvasRenderingContext2D {
  frameScratch ??= allocCanvas('groundTileParts', SHORE_PX, SHORE_PX);
  return surfaceContext(frameScratch);
}

function scratchPattern(
  scratchCtx: CanvasRenderingContext2D,
  patch: CanvasSurface,
): CanvasPattern | null {
  const existing = scratchPatterns.get(patch);
  if (existing !== undefined) return existing;
  const pattern = scratchCtx.createPattern(patch, 'repeat');
  if (pattern !== null) scratchPatterns.set(patch, pattern);
  return pattern;
}

/**
 * Draws the moving water over the visible shore tiles at `timeSeconds`: the
 * chop calming into the shallows and clipped to the waterline, then the laps.
 * The chop is the same world-anchored patch the open water is filled with,
 * so the two meet without a seam.
 */
export function drawDungeonShoreSurface(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  tiles: DungeonShoreTiles,
  camX: number,
  camY: number,
  timeSeconds: number,
): void {
  if (tiles.size === 0) return;
  const strengthByDepth = DUNGEON_WATER_PLANS[dungeonFloorTheme().id].surface.strengthByDepth;
  const lapFrame = positiveMod(Math.floor(timeSeconds * LAP_FRAMES_PER_SECOND), LAP_FRAMES);
  const scratchCtx = frameScratchContext();
  const pattern = scratchPattern(scratchCtx, dungeonWaterSurfacePatchAt(timeSeconds));
  const previousAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.translate(-camX, -camY);
  const transform = ctx.getTransform();
  for (let i = 0; i < tiles.size; i++) {
    const tx = tiles.tileX(i);
    const ty = tiles.tileY(i);
    const record = recordAt(structure, tx, ty);
    if (record === null) continue;
    const worldX = tx * TILE_SIZE;
    const worldY = ty * TILE_SIZE;
    if (record.chop.kind !== 'none' && pattern !== null && frameScratch !== null) {
      const originX = worldX * DUNGEON_WATER_SURFACE_DENSITY;
      const originY = worldY * DUNGEON_WATER_SURFACE_DENSITY;
      scratchCtx.globalCompositeOperation = 'source-over';
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
      scratchCtx.clearRect(0, 0, SHORE_PX, SHORE_PX);
      scratchCtx.setTransform(1, 0, 0, 1, -originX, -originY);
      scratchCtx.fillStyle = pattern;
      scratchCtx.fillRect(originX, originY, SHORE_PX, SHORE_PX);
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (record.chop.kind === 'masked') {
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(record.chop.mask, 0, 0);
        scratchCtx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = previousAlpha * strengthByDepth[chopDepthAt(structure, tx, ty)];
      drawImageSnapped(ctx, frameScratch, worldX, worldY, TILE_SIZE, TILE_SIZE, transform);
    }
    const lap = record.laps?.[lapFrame];
    if (lap !== undefined) {
      ctx.globalAlpha = previousAlpha;
      drawImageSnapped(ctx, lap, worldX, worldY, TILE_SIZE, TILE_SIZE, transform);
    }
  }
  ctx.restore();
  ctx.globalAlpha = previousAlpha;
}
