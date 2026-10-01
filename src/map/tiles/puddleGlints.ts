/**
 * The live half of standing water: a soft specular streak along a puddle's far
 * rim where a light's pool reaches it. The water itself is baked into the
 * floor by `floorFeatureArt.ts`; this is the part that has to move with the
 * lights, so it is drawn per frame, and only for the puddles in view.
 *
 * One streak per puddle, along the inside of its north rim — the camera looks
 * down and a little south, so still water shows the room's light there — and a
 * second, shorter and set deeper in, only on a wide one. Never a pair of equal
 * dots side by side: two small bright points in the dark is what a creature's
 * eye-shine looks like, and the water must never be mistaken for one.
 *
 * Meant to be drawn by the lighting pass over its darkness, in the same
 * additive step as its glows: a glint is light, and where no light falls on the
 * water there is none.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { FloorSurface } from '../dungeon/floorSurface';
import {
  LIQUID_EDGE_FIELD,
  liquidField,
  WATER_FEATURES,
  type PlacedFloorFeature,
} from '../dungeon/floorFeatures';

/** Light level below which a puddle shows no glint at all. */
const GLINT_MIN_LIGHT = 0.15;
/** Peak opacity of the main streak at full light; the second is fainter. */
const GLINT_ALPHA = 0.32;
const SECOND_GLINT_ALPHA_SHARE = 0.6;
/** A streak's thickness, in tiles. */
const GLINT_THICKNESS_TILES = 0.11;
/** How much of the rim's run the main streak covers, and its longest, in tiles. */
const GLINT_RIM_SHARE = 0.55;
const GLINT_MAX_LENGTH_TILES = 1.5;
/** Even a tiny puddle's streak is longer than it is thick, so it never reads as a dot. */
const MIN_STREAK_LENGTH_TILES = 0.3;
/** The steepest a streak tilts to follow the rim. */
const MAX_STREAK_TILT = Math.PI / 8;
/** How far inside the rim the streak lies, in tiles. */
const GLINT_RIM_INSET_TILES = 0.22;
/** A rim this long, in tiles, gets a second, shorter streak set deeper in. */
const SECOND_GLINT_MIN_RIM_TILES = 2.4;
const SECOND_GLINT_LENGTH_SHARE = 0.45;
const SECOND_GLINT_DEPTH_TILES = 0.35;
/** Where along the rim the second streak sits, as a share of the rim's run from its west end. */
const SECOND_GLINT_ALONG_SHARE = 0.78;
/** How far into the water past the edge the rim is taken to lie, as summed field. */
const RIM_FIELD_MARGIN = 0.12;
/** Columns the rim is sampled at, per tile. */
const RIM_SAMPLES_PER_TILE = 6;
/** Rows a column is searched at for its rim, per tile. */
const RIM_SEARCH_STEPS_PER_TILE = 12;
/** The slow shimmer of moving air over the water. */
const GLINT_SHIMMER_PERIOD_MS = 2400;
const GLINT_SHIMMER_DEPTH = 0.3;
/** The second streak shimmers out of step with the first. */
const SECOND_GLINT_PHASE = 2.1;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const GLINT_SPRITE_PX = 32;
const GLINT_CORE_STOP = 0.2;
const GLINT_CORE_RGBA = 'rgba(236, 244, 255, 1)';
const GLINT_EDGE_RGBA = 'rgba(236, 244, 255, 0)';

let glintSprite: CanvasSurface | null = null;

/** A soft white ellipse, painted once and stretched per streak. */
function sprite(): CanvasSurface {
  if (glintSprite !== null) return glintSprite;
  const surface = allocCanvas(GLINT_SPRITE_PX, GLINT_SPRITE_PX);
  const ctx = surfaceContext(surface);
  const centre = GLINT_SPRITE_PX * HALF;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  gradient.addColorStop(0, GLINT_CORE_RGBA);
  gradient.addColorStop(GLINT_CORE_STOP, GLINT_CORE_RGBA);
  gradient.addColorStop(1, GLINT_EDGE_RGBA);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLINT_SPRITE_PX, GLINT_SPRITE_PX);
  glintSprite = surface;
  return surface;
}

/** One streak, in world tile units. */
interface GlintStreak {
  readonly centreX: number;
  readonly centreY: number;
  readonly length: number;
  /** The rim's slope at the streak, radians from east. */
  readonly angle: number;
  readonly alphaShare: number;
  readonly phase: number;
}

/** Each water feature's streaks, worked out once from its shape. */
const streakCache = new WeakMap<PlacedFloorFeature, ReadonlyArray<GlintStreak>>();

/** The north rim of a water feature, as one point per sampled column that holds water. */
function northRim(feature: PlacedFloorFeature): Array<{ x: number; y: number }> {
  const { footprint } = feature;
  const rim: Array<{ x: number; y: number }> = [];
  const columns = Math.round(footprint.w * RIM_SAMPLES_PER_TILE);
  const rows = Math.round(footprint.h * RIM_SEARCH_STEPS_PER_TILE);
  for (let column = 0; column < columns; column++) {
    const x = footprint.x + (column + HALF) / RIM_SAMPLES_PER_TILE;
    for (let row = 0; row < rows; row++) {
      const y = footprint.y + (row + HALF) / RIM_SEARCH_STEPS_PER_TILE;
      if (liquidField(feature, x, y) >= LIQUID_EDGE_FIELD + RIM_FIELD_MARGIN) {
        rim.push({ x, y });
        break;
      }
    }
  }
  return rim;
}

/** Points a streak is checked at along its length, and across its thickness. */
const FIT_SAMPLES_ALONG = 9;
const FIT_SAMPLES_ACROSS = [-HALF, 0, HALF] as const;
/** A streak that strays off the water is shortened by this share and tried again. */
const FIT_SHRINK = 0.8;

/**
 * The streak shortened until every part of it lies on a puddle tile, or null
 * when it would have to shrink below {@link MIN_STREAK_LENGTH_TILES}. The test
 * is by tile, at sample points along and across the streak: it keeps a glint
 * off dry tiles, not inside the painted outline of the water on a wet one. A rim
 * can run over a tile whose centre is dry, and a crisp highlight on dry floor
 * is a hard line, not a glint on water.
 */
function fittedToWater(streak: GlintStreak, surface: FloorSurface): GlintStreak | null {
  const dirX = Math.cos(streak.angle);
  const dirY = Math.sin(streak.angle);
  const onWater = (length: number): boolean => {
    for (let i = 0; i < FIT_SAMPLES_ALONG; i++) {
      const along = (i / (FIT_SAMPLES_ALONG - 1) - HALF) * length;
      for (const share of FIT_SAMPLES_ACROSS) {
        const across = share * GLINT_THICKNESS_TILES;
        const x = streak.centreX + dirX * along - dirY * across;
        const y = streak.centreY + dirY * along + dirX * across;
        if (!surface.isPuddleAt(Math.floor(x), Math.floor(y))) return false;
      }
    }
    return true;
  };
  for (let length = streak.length; length >= MIN_STREAK_LENGTH_TILES; length *= FIT_SHRINK) {
    if (onWater(length)) return { ...streak, length };
  }
  return null;
}

function streaksFor(
  feature: PlacedFloorFeature,
  surface: FloorSurface,
): ReadonlyArray<GlintStreak> {
  const cached = streakCache.get(feature);
  if (cached !== undefined) return cached;
  const rim = northRim(feature);
  const candidates: GlintStreak[] = [];
  if (rim.length > 0) {
    const first = rim[0];
    const last = rim[rim.length - 1];
    const run = last.x - first.x;
    const middle = rim[Math.floor(rim.length / 2)];
    const angle = Math.atan2(last.y - first.y, Math.max(run, Number.EPSILON));
    // Only a gentle tilt follows the rim; a steep one reads as a scratch.
    const tilt = Math.max(-MAX_STREAK_TILT, Math.min(MAX_STREAK_TILT, angle));
    candidates.push({
      centreX: middle.x,
      centreY: middle.y + GLINT_RIM_INSET_TILES,
      length: Math.min(
        GLINT_MAX_LENGTH_TILES,
        Math.max(MIN_STREAK_LENGTH_TILES, run * GLINT_RIM_SHARE),
      ),
      angle: tilt,
      alphaShare: 1,
      phase: 0,
    });
    if (run >= SECOND_GLINT_MIN_RIM_TILES) {
      const along =
        rim[Math.min(rim.length - 1, Math.floor(rim.length * SECOND_GLINT_ALONG_SHARE))];
      candidates.push({
        centreX: along.x,
        centreY: along.y + GLINT_RIM_INSET_TILES + SECOND_GLINT_DEPTH_TILES,
        length: candidates[0].length * SECOND_GLINT_LENGTH_SHARE,
        angle: tilt,
        alphaShare: SECOND_GLINT_ALPHA_SHARE,
        phase: SECOND_GLINT_PHASE,
      });
    }
  }
  const streaks: GlintStreak[] = [];
  for (const candidate of candidates) {
    const fitted = fittedToWater(candidate, surface);
    if (fitted !== null) streaks.push(fitted);
  }
  streakCache.set(feature, streaks);
  return streaks;
}

/** The view a glint pass draws into, in world pixels. */
export interface PuddleGlintView {
  readonly camX: number;
  readonly camY: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly tileSize: number;
}

/**
 * Draws the streaks of every water feature in view that a light reaches.
 *
 * `lightAt` is how much light a tile has, 0–1 — the lighting pass's
 * `staticLightAt`. Leaves `ctx`'s composite, alpha and transform as it found
 * them.
 */
export function drawPuddleGlints(
  ctx: CanvasRenderingContext2D,
  surface: FloorSurface,
  view: PuddleGlintView,
  lightAt: (tileX: number, tileY: number) => number,
  nowMs: number,
): void {
  const { camX, camY, viewW, viewH, tileSize } = view;
  const viewLeft = camX / tileSize;
  const viewTop = camY / tileSize;
  const viewRight = (camX + viewW) / tileSize;
  const viewBottom = (camY + viewH) / tileSize;
  const image = sprite();
  const thickness = tileSize * GLINT_THICKNESS_TILES;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const feature of surface.features) {
    if (!WATER_FEATURES.has(feature.kind)) continue;
    const { footprint } = feature;
    if (footprint.x > viewRight || footprint.y > viewBottom) continue;
    if (footprint.x + footprint.w < viewLeft || footprint.y + footprint.h < viewTop) continue;
    for (const streak of streaksFor(feature, surface)) {
      const light = lightAt(Math.floor(streak.centreX), Math.floor(streak.centreY));
      if (light < GLINT_MIN_LIGHT) continue;
      const wave = Math.sin((nowMs / GLINT_SHIMMER_PERIOD_MS) * FULL_TURN + streak.phase);
      const shimmer = 1 - GLINT_SHIMMER_DEPTH * HALF * (1 + wave);
      const length = streak.length * tileSize;
      ctx.globalAlpha = Math.min(1, light) * GLINT_ALPHA * streak.alphaShare * shimmer;
      ctx.save();
      ctx.translate(streak.centreX * tileSize - camX, streak.centreY * tileSize - camY);
      ctx.rotate(streak.angle);
      ctx.drawImage(image, -length * HALF, -thickness * HALF, length, thickness);
      ctx.restore();
    }
  }
  ctx.restore();
}
