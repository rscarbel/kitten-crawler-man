/**
 * The moving surface of dungeon water: choppy wavelets, the dark troughs
 * between them, whitecaps and foam streaks, laid over the opaque column
 * (`dungeonWaterColumn.ts`) every frame.
 *
 * Terrain is chunk-baked, so the column cannot move; this can. It is a short
 * looping strip of frames painted once per floor theme into a wrapped patch
 * several tiles across, and each frame is drawn as a repeating pattern over
 * the visible water in a handful of rect fills, one per depth. Nothing is
 * painted per frame but those fills.
 *
 * Every wave is a whole number of wavelengths across the patch and advances a
 * whole number of wavelengths over the loop, and every noise field is sampled
 * on the patch's torus (moving round a circle in noise space for the parts
 * that churn), so the patch tiles without a seam and the last frame runs back
 * into the first.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { canvasGeneration } from '../../core/rendering/canvasRecovery';
import { MAX_WATER_DEPTH } from '../tileTypes';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../dungeon/floorTheme';
import { NoiseField } from '../tilegen/noise';
import { snapUserX, snapUserY } from './deviceSnap';
import {
  DUNGEON_WATER_PLANS,
  type DungeonWaterSurfaceInk,
  type WaterInk,
} from '../../sprites/sheets/dungeonWaterSheets';

/** Tiles across the wrapped patch: wide enough that the repeat is not read as a grid. */
const PATCH_TILES = 5;
const PATCH_WORLD_PX = PATCH_TILES * TILE_SIZE;
/**
 * Painted pixels per world pixel. The chop is soft-edged, so a little under
 * the usual device scale is indistinguishable and saves most of the bytes.
 */
export const DUNGEON_WATER_SURFACE_DENSITY = 1.5;
const PATCH_PX = Math.round(PATCH_WORLD_PX * DUNGEON_WATER_SURFACE_DENSITY);
const LOOP_FRAMES = 16;
const LOOP_FRAMES_PER_SECOND = 6;

const TWO_PI = Math.PI * 2;
const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;

/**
 * One train of wavelets: `kx`, `ky` whole wavelengths across the patch,
 * advancing `cycles` whole wavelengths per loop (negative runs the other way).
 * Most trains run roughly across the screen, so the chop reads as rows of
 * wavelets seen at the camera's tilt; a few cross them at odd angles and
 * against them, which is what makes the surface churned rather than a swell.
 */
interface WaveTrain {
  readonly kx: number;
  readonly ky: number;
  readonly cycles: number;
  readonly amplitude: number;
  readonly phase: number;
}

const WAVE_TRAINS: readonly WaveTrain[] = [
  { kx: 1, ky: 3, cycles: 1, amplitude: 1, phase: 0 },
  { kx: -2, ky: 5, cycles: 1, amplitude: 0.75, phase: 1.7 },
  { kx: 3, ky: 4, cycles: -1, amplitude: 0.5, phase: 4.1 },
  { kx: 5, ky: 2, cycles: -1, amplitude: 0.3, phase: 2.6 },
  { kx: -3, ky: 8, cycles: 2, amplitude: 0.25, phase: 5.3 },
];
const WAVE_AMPLITUDE_TOTAL = WAVE_TRAINS.reduce((sum, train) => sum + train.amplitude, 0);
/** Raises each wavelet's profile to a peak with flat troughs between, as wind-chop has. */
const CREST_SHARPNESS = 1.8;

/** Static bending of the wave trains, in patch widths, so their fronts are not ruled lines. */
const STILL_WARP_PATCHES = 0.05;
/** The part of the bending that churns over the loop. */
const CHURN_WARP_PATCHES = 0.02;
/** Radius of the circle the churning noise is sampled round over one loop, in patch pixels. */
const CHURN_ORBIT_PX = PATCH_PX * 0.18;
const WARP_NOISE_PERIOD = 4;
const WARP_NOISE_OCTAVES = 3;
/**
 * The chop is rougher in some places than others: its height is scaled by a
 * slow noise between these, so the surface carries rough and calmer patches
 * rather than one even texture.
 */
const ROUGHNESS_MIN = 0.35;
const ROUGHNESS_MAX = 1.25;
const ROUGHNESS_NOISE_PERIOD = 2;
const ROUGHNESS_NOISE_OCTAVES = 2;
const SEED_WARP_X = 11;
const SEED_WARP_Y = 23;
const SEED_CHURN_X = 37;
const SEED_CHURN_Y = 41;
const SEED_ROUGHNESS = 53;

/** Light falls from the top of the screen and a little to the left. */
const LIGHT_X = -0.3;
const LIGHT_Y = -0.95;
/** Slope (height per patch pixel) to light. */
const SLOPE_GAIN = 30;
/** Only the steepest lit faces catch a highlight, so it is a line along a crest, not a patch. */
const HIGHLIGHT_FROM = 0.35;
const HIGHLIGHT_TO = 0.9;
const HIGHLIGHT_MAX_ALPHA = 0.2;
const SHADOW_FROM = 0.1;
const SHADOW_TO = 0.8;
const SHADOW_MAX_ALPHA = 0.26;

/** Whitecaps: the tallest crests of the roughest water break. */
const CAP_HEIGHT_FROM = 0.62;
const CAP_HEIGHT_TO = 0.8;
const CAP_MAX_ALPHA = 0.42;
/**
 * Foam streaks: a fine noise squeezed across the screen into streaks,
 * thresholded into scum, and kept only where a slower noise gathers it into
 * drifting rafts.
 */
const STREAK_NOISE_PERIOD = 6;
const STREAK_NOISE_OCTAVES = 2;
const STREAK_STRETCH = 3;
const STREAK_FROM = 0.62;
const STREAK_TO = 0.78;
const STREAK_MAX_ALPHA = 0.16;
const RAFT_NOISE_PERIOD = 3;
const RAFT_NOISE_OCTAVES = 2;
const RAFT_FROM = 0.56;
const RAFT_TO = 0.7;
const SEED_STREAKS = 67;
const SEED_RAFTS = 79;

interface PaintedFrames {
  readonly theme: DungeonFloorThemeId;
  readonly generation: number;
  readonly frames: Array<CanvasSurface | null>;
  readonly patterns: Array<CanvasPattern | null>;
}

let painted: PaintedFrames | null = null;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function positiveMod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function crestProfile(wave: number): number {
  return ((wave + 1) / 2) ** CREST_SHARPNESS;
}

/** Where the churning noise is sampled from on loop frame `frame`. */
function churnOrbit(frame: number): {
  readonly angle: number;
  readonly x: number;
  readonly y: number;
} {
  const angle = (frame / LOOP_FRAMES) * TWO_PI;
  return { angle, x: Math.cos(angle) * CHURN_ORBIT_PX, y: Math.sin(angle) * CHURN_ORBIT_PX };
}

/** Wave height over the whole patch for loop frame `frame`, about 0..1. */
function heightField(noise: NoiseField, frame: number): Float64Array {
  const orbit = churnOrbit(frame);
  const heights = new Float64Array(PATCH_PX * PATCH_PX);
  for (let y = 0; y < PATCH_PX; y++) {
    for (let x = 0; x < PATCH_PX; x++) {
      const stillX = noise.fbm(x, y, SEED_WARP_X, WARP_NOISE_OCTAVES, WARP_NOISE_PERIOD) - 0.5;
      const stillY = noise.fbm(x, y, SEED_WARP_Y, WARP_NOISE_OCTAVES, WARP_NOISE_PERIOD) - 0.5;
      const churnX =
        noise.fbm(x + orbit.x, y + orbit.y, SEED_CHURN_X, WARP_NOISE_OCTAVES, WARP_NOISE_PERIOD) -
        0.5;
      const churnY =
        noise.fbm(x - orbit.y, y + orbit.x, SEED_CHURN_Y, WARP_NOISE_OCTAVES, WARP_NOISE_PERIOD) -
        0.5;
      const u = x / PATCH_PX + stillX * STILL_WARP_PATCHES + churnX * CHURN_WARP_PATCHES;
      const v = y / PATCH_PX + stillY * STILL_WARP_PATCHES + churnY * CHURN_WARP_PATCHES;
      let height = 0;
      for (const train of WAVE_TRAINS) {
        const phase =
          TWO_PI * (train.kx * u + train.ky * v) - train.cycles * orbit.angle + train.phase;
        height += train.amplitude * crestProfile(Math.sin(phase));
      }
      const roughnessNoise = noise.fbm(
        x + orbit.y,
        y - orbit.x,
        SEED_ROUGHNESS,
        ROUGHNESS_NOISE_OCTAVES,
        ROUGHNESS_NOISE_PERIOD,
      );
      const roughness = ROUGHNESS_MIN + (ROUGHNESS_MAX - ROUGHNESS_MIN) * roughnessNoise;
      heights[y * PATCH_PX + x] = (height / WAVE_AMPLITUDE_TOTAL) * roughness;
    }
  }
  return heights;
}

/** Lays `ink` at `alpha` over the straight-alpha pixel at `at`. */
function layOver(rgba: Float64Array, at: number, ink: WaterInk, alpha: number): void {
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

/** Paints loop frame `frame` of the chop, in straight-alpha RGBA bytes. */
function paintDungeonWaterSurfaceFrame(
  ink: DungeonWaterSurfaceInk,
  frame: number,
): Uint8ClampedArray {
  const noise = new NoiseField(PATCH_PX);
  const heights = heightField(noise, frame);
  const orbit = churnOrbit(frame);
  const rgba = new Float64Array(PATCH_PX * PATCH_PX * RGBA_CHANNELS);
  for (let y = 0; y < PATCH_PX; y++) {
    const up = positiveMod(y - 1, PATCH_PX);
    const down = positiveMod(y + 1, PATCH_PX);
    for (let x = 0; x < PATCH_PX; x++) {
      const left = positiveMod(x - 1, PATCH_PX);
      const right = positiveMod(x + 1, PATCH_PX);
      const height = heights[y * PATCH_PX + x];
      const slopeX = (heights[y * PATCH_PX + right] - heights[y * PATCH_PX + left]) / 2;
      const slopeY = (heights[down * PATCH_PX + x] - heights[up * PATCH_PX + x]) / 2;
      const lit = -(slopeX * LIGHT_X + slopeY * LIGHT_Y) * SLOPE_GAIN;
      const at = (y * PATCH_PX + x) * RGBA_CHANNELS;

      layOver(rgba, at, ink.trough, smoothstep(SHADOW_FROM, SHADOW_TO, -lit) * SHADOW_MAX_ALPHA);
      layOver(
        rgba,
        at,
        ink.crest,
        smoothstep(HIGHLIGHT_FROM, HIGHLIGHT_TO, lit) * HIGHLIGHT_MAX_ALPHA,
      );

      const cap = smoothstep(CAP_HEIGHT_FROM, CAP_HEIGHT_TO, height) * CAP_MAX_ALPHA;
      const streakNoise = noise.fbm(
        x + orbit.x,
        y * STREAK_STRETCH + orbit.y,
        SEED_STREAKS,
        STREAK_NOISE_OCTAVES,
        STREAK_NOISE_PERIOD,
      );
      const raftNoise = noise.fbm(
        x - orbit.y,
        y + orbit.x,
        SEED_RAFTS,
        RAFT_NOISE_OCTAVES,
        RAFT_NOISE_PERIOD,
      );
      const streak =
        smoothstep(STREAK_FROM, STREAK_TO, streakNoise) * smoothstep(RAFT_FROM, RAFT_TO, raftNoise);
      layOver(rgba, at, ink.foam, Math.max(cap, streak * STREAK_MAX_ALPHA));
    }
  }
  const bytes = new Uint8ClampedArray(rgba.length);
  for (let at = 0; at < rgba.length; at += RGBA_CHANNELS) {
    bytes[at + RED] = rgba[at + RED];
    bytes[at + GREEN] = rgba[at + GREEN];
    bytes[at + BLUE] = rgba[at + BLUE];
    bytes[at + ALPHA] = rgba[at + ALPHA] * BYTE_MAX;
  }
  return bytes;
}

function releasePainted(): void {
  if (painted === null) return;
  for (const frame of painted.frames) {
    if (frame !== null) releaseSurface(frame);
  }
  painted = null;
}

/** The frames for the current theme, dropped and restarted after a theme change or canvas loss. */
function currentFrames(): PaintedFrames {
  const theme = dungeonFloorTheme().id;
  const generation = canvasGeneration();
  if (painted?.theme === theme && painted.generation === generation) return painted;
  releasePainted();
  const fresh: PaintedFrames = {
    theme,
    generation,
    frames: new Array<CanvasSurface | null>(LOOP_FRAMES).fill(null),
    patterns: new Array<CanvasPattern | null>(LOOP_FRAMES).fill(null),
  };
  painted = fresh;
  return fresh;
}

function frameSurface(set: PaintedFrames, frame: number): CanvasSurface {
  const existing = set.frames[frame];
  if (existing !== null) return existing;
  const surface = allocCanvas('groundTileParts', PATCH_PX, PATCH_PX);
  const surfaceCtx = surfaceContext(surface);
  const image = surfaceCtx.createImageData(PATCH_PX, PATCH_PX);
  image.data.set(paintDungeonWaterSurfaceFrame(DUNGEON_WATER_PLANS[set.theme].surface, frame));
  surfaceCtx.putImageData(image, 0, 0);
  set.frames[frame] = surface;
  return surface;
}

function framePattern(
  ctx: CanvasRenderingContext2D,
  set: PaintedFrames,
  frame: number,
): CanvasPattern | null {
  const existing = set.patterns[frame];
  if (existing !== null) return existing;
  const pattern = ctx.createPattern(frameSurface(set, frame), 'repeat');
  set.patterns[frame] = pattern;
  return pattern;
}

/**
 * Paints every frame of the loop for the current floor theme, so the first
 * seconds in the water do not pay for it on the render path.
 */
export function warmDungeonWaterSurface(): void {
  const set = currentFrames();
  for (let frame = 0; frame < LOOP_FRAMES; frame++) frameSurface(set, frame);
}

/** Gives back the painted loop: called for a map with no dungeon water to draw it on. */
export function releaseDungeonWaterSurface(): void {
  releasePainted();
}

/** The loop frame shown at `timeSeconds`. */
function dungeonWaterSurfaceFrameAt(timeSeconds: number): number {
  return positiveMod(Math.floor(timeSeconds * LOOP_FRAMES_PER_SECOND), LOOP_FRAMES);
}

/**
 * The painted chop patch shown at `timeSeconds`, at
 * {@link DUNGEON_WATER_SURFACE_DENSITY} painted pixels per world pixel and
 * repeating every patch, for a caller that lays it through its own mask.
 */
export function dungeonWaterSurfacePatchAt(timeSeconds: number): CanvasSurface {
  return frameSurface(currentFrames(), dungeonWaterSurfaceFrameAt(timeSeconds));
}

const DEPTH_LEVELS = MAX_WATER_DEPTH + 1;

interface WaterRun {
  tx: number;
  ty: number;
  tiles: number;
}

/**
 * Visible dungeon water gathered into horizontal runs per depth, so a frame's
 * chop is one filled path per depth. Reused across frames: `reset`, then `add`
 * every water tile row by row, left to right.
 */
export class DungeonWaterRuns {
  private readonly runs: WaterRun[][] = Array.from({ length: DEPTH_LEVELS }, () => []);
  private readonly counts = new Array<number>(DEPTH_LEVELS).fill(0);

  reset(): void {
    this.counts.fill(0);
  }

  get isEmpty(): boolean {
    return this.counts.every((count) => count === 0);
  }

  add(tx: number, ty: number, depth: number): void {
    const level = Math.min(MAX_WATER_DEPTH, Math.max(0, depth));
    const list = this.runs[level];
    const count = this.counts[level];
    const last = count > 0 ? list[count - 1] : undefined;
    if (last?.ty === ty && last.tx + last.tiles === tx) {
      last.tiles++;
      return;
    }
    if (count === list.length) list.push({ tx, ty, tiles: 1 });
    else {
      const run = list[count];
      run.tx = tx;
      run.ty = ty;
      run.tiles = 1;
    }
    this.counts[level] = count + 1;
  }

  /**
   * Traces depth `level`'s runs as rects in `transform`'s user space, `scale`
   * units to a world pixel, each edge on a whole device pixel so two depths
   * meet without a hairline; false when there are none.
   */
  traceDepth(
    ctx: CanvasRenderingContext2D,
    level: number,
    scale: number,
    transform: DOMMatrix,
  ): boolean {
    const count = this.counts[level] ?? 0;
    if (count === 0) return false;
    const list = this.runs[level];
    const tilePx = TILE_SIZE * scale;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const run = list[i];
      const left = snapUserX(transform, run.tx * tilePx);
      const top = snapUserY(transform, run.ty * tilePx);
      const right = snapUserX(transform, (run.tx + run.tiles) * tilePx);
      const bottom = snapUserY(transform, (run.ty + 1) * tilePx);
      ctx.rect(left, top, right - left, bottom - top);
    }
    return true;
  }
}

/**
 * Draws the chop over `runs` at `timeSeconds`. The pattern is anchored to the
 * world, not the screen, so the water stays put under a moving camera.
 */
export function drawDungeonWaterSurface(
  ctx: CanvasRenderingContext2D,
  runs: DungeonWaterRuns,
  camX: number,
  camY: number,
  timeSeconds: number,
): void {
  if (runs.isEmpty) return;
  const set = currentFrames();
  const pattern = framePattern(ctx, set, dungeonWaterSurfaceFrameAt(timeSeconds));
  if (pattern === null) return;
  const strength = DUNGEON_WATER_PLANS[set.theme].surface.strengthByDepth;
  const previousAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.translate(-camX, -camY);
  ctx.scale(1 / DUNGEON_WATER_SURFACE_DENSITY, 1 / DUNGEON_WATER_SURFACE_DENSITY);
  ctx.fillStyle = pattern;
  const transform = ctx.getTransform();
  for (let level = 0; level < DEPTH_LEVELS; level++) {
    if (!runs.traceDepth(ctx, level, DUNGEON_WATER_SURFACE_DENSITY, transform)) continue;
    ctx.globalAlpha = previousAlpha * strength[level];
    ctx.fill();
  }
  ctx.restore();
}
