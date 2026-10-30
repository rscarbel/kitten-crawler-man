/**
 * A ward wall: a curtain of arcane fire standing on a line of floor runes.
 *
 * Lit, it is a row of overlapping tongues rising off the line, a deep crimson
 * body behind additive red flame and a pale hot heart, with wisps and motes
 * climbing through it, lightning crawling down it and its light pooled on the
 * floor and the jambs either side. Resting, a live ward between its burns,
 * it is only a few faint ember-gold sparks drifting up off its line, with no
 * red, no runes, no curtain and no light on the floor, so the ground plainly
 * reads as safe to cross. Dormant, a ward out for good, it is the runes alone gone cold: ash
 * grey, with a few dead embers and no red anywhere, so red on a ward only
 * ever means it can hurt.
 *
 * A wall is drawn a tile at a time from whole baked frames: each tile's curtain
 * is a seamless loop of {@link LOOP_FRAMES} frames, painted from the stamps
 * below at the canvas's own device scale the first time it is needed and kept
 * in a {@link RecentSurfaceCache}, so a frame on screen costs one unscaled
 * `drawImage` per tile, one for the floor glow under the run and, only on a
 * wall lit enough to crackle, a lightning stroke. A wall's brightness picks one
 * of a few baked levels and fades it with `globalAlpha`; nothing is
 * re-composited per frame. All motion is read off the clock the caller passes,
 * so a world that stops ticking stops the wall.
 */

import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../core/rendering/canvasSurface';
import { MAX_SHARP_RENDER_SCALE } from '../core/input/Settings';
import { onCanvasRecovery } from '../core/rendering/canvasRecovery';
import { RecentSurfaceCache } from '../core/rendering/recentSurfaceCache';
import { renderFrameNumber } from '../core/rendering/renderFrameClock';
import { worldPalette } from '../ui/theme/worldInk';
import { hashUnit } from './flameStamps';
import { mulberry32, type Rng } from './person/rng';
import { drawRadialGlow, type GlowStop } from './radialGlow';

/** One straight run of a ward wall, in world pixels at foot level. */
export interface WardWallRun {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/** Where the world is on screen and the world clock the wall moves by. */
export interface WardWallView {
  readonly camX: number;
  readonly camY: number;
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
}

/**
 * How lit a wall is. `lit` stands the curtain up at `intensity` (0 to 1) of
 * full; `resting` shows only a live ward's few sparks between burns, and
 * `dormant` only a spent ward's cold runes and embers, each at `strength` of
 * full.
 */
export type WardWallState =
  | { readonly kind: 'lit'; readonly intensity: number }
  | { readonly kind: 'resting'; readonly strength: number }
  | { readonly kind: 'dormant'; readonly strength: number };

const TAU = Math.PI * 2;
const HALF = 0.5;

// ── Stamps ─────────────────────────────────────────────────────────────────

/** Device pixels a stamp is baked at per world pixel; the camera rarely zooms past this. */
const STAMP_DENSITY = 2;
const TONGUE_STAMP_WIDTH_PX = 24;
const TONGUE_STAMP_HEIGHT_PX = 64;
/** The widest lobe's radius as a share of the stamp's width; the rest is room for the bend. */
const TONGUE_LOBE_RADIUS_SHARE = 0.26;
const TONGUE_LOBES = 40;
/** Lobes thin out toward the tip as well as narrowing, so the tip melts away instead of ending in a dot. */
const TONGUE_TIP_FADE_EXPONENT = 0.6;
/** How fast a tongue narrows toward its tip, as an exponent on the remaining height. */
const TONGUE_TAPER = 0.75;
const TONGUE_MIN_LOBE_RADIUS_PX = 0.6;
const TONGUE_FOOT_INSET_SHARE = 0.8;
const TONGUE_BEND_MIN = 0.25;
const TONGUE_BEND_MAX = 0.95;
const TONGUE_TURNS_MIN = 1;
const TONGUE_TURNS_MAX = 2.2;
/** Holds the foot on the axis while the bend builds, so a tongue never slides off its rune. */
const TONGUE_BEND_ONSET = 0.6;
const TONGUE_VARIANTS = 8;
/** Thin bright strands running up a tongue, which is what makes it read as spun energy rather than fire. */
const FILAMENTS_PER_TONGUE = 2;
const FILAMENT_ALPHA = 0.55;
const FILAMENT_WIDTH_PX = 0.55;
const FILAMENT_REACH_SHARE = 0.85;
const FILAMENT_WOBBLE_SHARE = 0.55;
const FILAMENT_STEPS = 10;

const RUNE_STAMP_PX = 16;
const RUNE_VARIANTS = 6;
const RUNE_RING_SHARE = 0.4;
const RUNE_INNER_SHARE = 0.27;
const RUNE_POINTS = 6;
const RUNE_STROKES_MIN = 3;
const RUNE_STROKES_MAX = 5;
/** Each stroke jumps this many points round the inner hexagon or one more, never to a neighbour, so strokes cross the sigil. */
const RUNE_STROKE_SKIP_MIN = 2;
const RUNE_STROKE_SKIP_CHOICES = 2;
const RUNE_LINE_WIDTH_PX = 1.1;
const RUNE_HALO_BLUR_PX = 2.5;
/** The ring is broken into this many arcs, each with a small gap, like a carved circle. */
const RUNE_RING_ARCS = 3;
const RUNE_RING_GAP_RAD = 0.35;

const TONGUE_BAKE_SEED = 0x5a4d;
/** The range each tongue's filament seed is drawn from. */
const FILAMENT_SEED_RANGE = 0x5a4d;
const RUNE_BAKE_SEED = 0x7e11;

/** The curtain's three lit layers, and the dead embers a ward that is out keeps instead. */
type TongueLayer = 'body' | 'flame' | 'heart' | 'ember';
type LitTongueLayer = Exclude<TongueLayer, 'ember'>;
const TONGUE_LAYERS: readonly TongueLayer[] = ['body', 'flame', 'heart', 'ember'];

/** Whether a ward can hurt, which is all that decides whether it is drawn in red. */
type WardTone = 'live' | 'spent';
const WARD_TONES: readonly WardTone[] = ['live', 'spent'];

interface WardStamps {
  readonly tongues: Readonly<Record<TongueLayer, readonly CanvasSurface[]>>;
  readonly runes: Readonly<Record<WardTone, readonly CanvasSurface[]>>;
}

let stamps: WardStamps | null = null;

onCanvasRecovery(() => {
  if (stamps === null) return;
  for (const layer of TONGUE_LAYERS) stamps.tongues[layer].forEach(releaseSurface);
  for (const tone of WARD_TONES) stamps.runes[tone].forEach(releaseSurface);
  stamps = null;
});

/** The colours a ward is drawn in: its reds while it can hurt, ash once it is out for good. */
function toneInk(tone: WardTone): {
  readonly rune: string;
  readonly runeHalo: string;
  readonly mote: string;
  readonly floorGlowCore: string;
  readonly floorGlowFade: string;
} {
  switch (tone) {
    case 'live':
      return worldPalette.wardWall;
    case 'spent':
      return worldPalette.wardSpent;
    default: {
      const unhandled: never = tone;
      throw new Error(`unhandled ward tone ${String(unhandled)}`);
    }
  }
}

function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

function bentOffset(along: number, bend: number, turns: number, phase: number): number {
  return bend * Math.pow(along, TONGUE_BEND_ONSET) * Math.sin(along * Math.PI * turns + phase);
}

function layerInk(layer: TongueLayer): { readonly core: string; readonly fade: string } {
  const ink = worldPalette.wardWall;
  switch (layer) {
    case 'body':
      return { core: ink.bodyCore, fade: ink.bodyFade };
    case 'flame':
      return { core: ink.flameCore, fade: ink.flameFade };
    case 'heart':
      return { core: ink.heartCore, fade: ink.heartFade };
    case 'ember':
      return { core: worldPalette.wardSpent.emberCore, fade: worldPalette.wardSpent.emberFade };
    default: {
      const unhandled: never = layer;
      throw new Error(`unhandled tongue layer ${String(unhandled)}`);
    }
  }
}

interface TongueShape {
  readonly bend: number;
  readonly turns: number;
  readonly phase: number;
  readonly filamentSeed: number;
}

/**
 * A tongue: soft discs stacked up an S-bent axis, fat at the foot and pinched
 * at the tip, each disc's alpha divided by how many neighbours overlap it so
 * the foot does not saturate into a slab while the tip stays a ghost.
 */
function bakeTongue(layer: TongueLayer, shape: TongueShape): CanvasSurface {
  const width = TONGUE_STAMP_WIDTH_PX * STAMP_DENSITY;
  const height = TONGUE_STAMP_HEIGHT_PX * STAMP_DENSITY;
  const surface = allocCanvas('effects', width, height);
  const ctx = surfaceContext(surface);
  const ink = layerInk(layer);
  const maxRadius = width * TONGUE_LOBE_RADIUS_SHARE;
  const footY = height - maxRadius * TONGUE_FOOT_INSET_SHARE;
  const lobeSpacing = (footY - TONGUE_MIN_LOBE_RADIUS_PX * STAMP_DENSITY) / (TONGUE_LOBES - 1);
  const axisX = (along: number): number =>
    width * HALF + maxRadius * bentOffset(along, shape.bend, shape.turns, shape.phase);
  ctx.globalCompositeOperation = 'lighter';
  for (let lobe = 0; lobe < TONGUE_LOBES; lobe++) {
    const along = lobe / (TONGUE_LOBES - 1);
    const radius = Math.max(
      TONGUE_MIN_LOBE_RADIUS_PX * STAMP_DENSITY,
      maxRadius * Math.pow(1 - along, TONGUE_TAPER),
    );
    const x = axisX(along);
    const y = footY - lobeSpacing * lobe;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, ink.core);
    gradient.addColorStop(1, ink.fade);
    const overlapping = Math.max(1, (radius * 2) / lobeSpacing);
    ctx.globalAlpha = Math.pow(1 - along, TONGUE_TIP_FADE_EXPONENT) / overlapping;
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  if (layer === 'flame') {
    const rng = mulberry32(shape.filamentSeed);
    ctx.globalAlpha = FILAMENT_ALPHA;
    ctx.strokeStyle = worldPalette.wardWall.filament;
    ctx.lineWidth = FILAMENT_WIDTH_PX * STAMP_DENSITY;
    ctx.lineCap = 'round';
    for (let strand = 0; strand < FILAMENTS_PER_TONGUE; strand++) {
      const lane = between(rng, -FILAMENT_WOBBLE_SHARE, FILAMENT_WOBBLE_SHARE);
      const wobblePhase = between(rng, 0, TAU);
      const reach = FILAMENT_REACH_SHARE * between(rng, HALF, 1);
      ctx.beginPath();
      for (let step = 0; step <= FILAMENT_STEPS; step++) {
        const along = (step / FILAMENT_STEPS) * reach;
        const narrowing = Math.pow(1 - along, TONGUE_TAPER);
        const wobble = Math.sin(along * TAU + wobblePhase) * FILAMENT_WOBBLE_SHARE;
        const x = axisX(along) + maxRadius * narrowing * (lane + wobble) * HALF;
        const y = footY - lobeSpacing * (TONGUE_LOBES - 1) * along;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  return surface;
}

/** A carved sigil: a broken ring round a few angular strokes between points of an inner hexagon. */
function bakeRune(rng: Rng, tone: WardTone): CanvasSurface {
  const size = RUNE_STAMP_PX * STAMP_DENSITY;
  const surface = allocCanvas('effects', size, size);
  const ctx = surfaceContext(surface);
  const ink = toneInk(tone);
  const centre = size * HALF;
  const ringRadius = size * RUNE_RING_SHARE;
  const innerRadius = size * RUNE_INNER_SHARE;
  ctx.strokeStyle = ink.rune;
  ctx.lineWidth = RUNE_LINE_WIDTH_PX * STAMP_DENSITY;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = ink.runeHalo;
  ctx.shadowBlur = RUNE_HALO_BLUR_PX * STAMP_DENSITY;
  const ringTurn = between(rng, 0, TAU);
  const arcSpan = TAU / RUNE_RING_ARCS;
  for (let arc = 0; arc < RUNE_RING_ARCS; arc++) {
    const start = ringTurn + arc * arcSpan + RUNE_RING_GAP_RAD * HALF;
    ctx.beginPath();
    ctx.arc(centre, centre, ringRadius, start, start + arcSpan - RUNE_RING_GAP_RAD);
    ctx.stroke();
  }
  const pointAt = (index: number): { x: number; y: number } => {
    const angle = ringTurn + (index / RUNE_POINTS) * TAU;
    return {
      x: centre + Math.cos(angle) * innerRadius,
      y: centre + Math.sin(angle) * innerRadius,
    };
  };
  const strokes = Math.round(between(rng, RUNE_STROKES_MIN, RUNE_STROKES_MAX));
  ctx.beginPath();
  let at = Math.floor(rng() * RUNE_POINTS);
  const first = pointAt(at);
  ctx.moveTo(first.x, first.y);
  for (let stroke = 0; stroke < strokes; stroke++) {
    const skip = RUNE_STROKE_SKIP_MIN + Math.floor(rng() * RUNE_STROKE_SKIP_CHOICES);
    at = (at + skip) % RUNE_POINTS;
    const next = pointAt(at);
    ctx.lineTo(next.x, next.y);
  }
  ctx.stroke();
  return surface;
}

function ensureStamps(): WardStamps {
  if (stamps !== null) return stamps;
  const shapeRng = mulberry32(TONGUE_BAKE_SEED);
  const shapes: TongueShape[] = [];
  for (let variant = 0; variant < TONGUE_VARIANTS; variant++) {
    const mirror = variant % 2 === 0 ? 1 : -1;
    shapes.push({
      bend: mirror * between(shapeRng, TONGUE_BEND_MIN, TONGUE_BEND_MAX),
      turns: between(shapeRng, TONGUE_TURNS_MIN, TONGUE_TURNS_MAX),
      phase: between(shapeRng, 0, Math.PI),
      filamentSeed: Math.floor(shapeRng() * FILAMENT_SEED_RANGE),
    });
  }
  // Both tones draw from the same seed, so a ward that goes out keeps the very sigils it burned on.
  const runesIn = (tone: WardTone): CanvasSurface[] => {
    const runeRng = mulberry32(RUNE_BAKE_SEED);
    const runes: CanvasSurface[] = [];
    for (let variant = 0; variant < RUNE_VARIANTS; variant++) runes.push(bakeRune(runeRng, tone));
    return runes;
  };
  const baked: WardStamps = {
    tongues: {
      body: shapes.map((shape) => bakeTongue('body', shape)),
      flame: shapes.map((shape) => bakeTongue('flame', shape)),
      heart: shapes.map((shape) => bakeTongue('heart', shape)),
      ember: shapes.map((shape) => bakeTongue('ember', shape)),
    },
    runes: { live: runesIn('live'), spent: runesIn('spent') },
  };
  stamps = baked;
  return baked;
}
// ── One tile of curtain ────────────────────────────────────────────────────

/** How tall the curtain stands at full, in world pixels: well over a crawler's head. */
const WALL_HEIGHT_PX = 46;
/** The share of full height a barely lit wall still stands at. */
const LIT_FLOOR_HEIGHT_SHARE = 0.3;
/** Height of the embers on a dormant wall. */
const EMBER_HEIGHT_PX = 6;
/** Distance between tongues along the line. */
const TONGUE_SPACING_PX = 6;
/** The heart is sparser than the flame round it, or the overlapping hearts add up to a white bar. */
const HEART_SPACING_PX = 11;
/** How far a tongue's foot may stray off the line, so the curtain has thickness. */
const TONGUE_FOOT_JITTER_PX = 2.2;
const LAYER_HALF_WIDTH_PX: Readonly<Record<TongueLayer, number>> = {
  body: 8,
  flame: 11,
  heart: 3.2,
  ember: 11,
};
const LAYER_HEIGHT_SHARE: Readonly<Record<LitTongueLayer, number>> = {
  body: 0.9,
  flame: 1,
  heart: 0.55,
};

/**
 * A tile's curtain loops every {@link LOOP_FRAMES} frames of {@link FRAME_MS}.
 * Every rhythm painted into it repeats a whole number of times per loop, so
 * the last frame runs into the first without a seam.
 */
const LOOP_FRAMES = 16;
const FRAME_MS = 60;
const LOOP_MS = LOOP_FRAMES * FRAME_MS;
/** How long each layer holds one shape before the next: the outer body churns slower than the flame. */
const LAYER_SHAPE_HOLD_MS: Readonly<Record<TongueLayer, number>> = {
  body: LOOP_MS / (TONGUE_VARIANTS * 1),
  flame: LOOP_MS / (TONGUE_VARIANTS * 2),
  heart: LOOP_MS / (TONGUE_VARIANTS * 2),
  ember: LOOP_MS / (TONGUE_VARIANTS * 2),
};
/** Each tongue's height swings between this share of its own and the whole of it. */
const TONGUE_FLICKER_FLOOR = 0.68;
const TONGUE_FLICKER_PERIOD_MS = LOOP_MS / 2;
const TONGUE_FLICKER_SECOND_PERIOD_MS = LOOP_MS / 4;
const TONGUE_FLICKER_SECOND_SHARE = 0.35;
/** The quick swing's phase is spread this much wider than the slow one's, so the two never peak together along the line. */
const TONGUE_FLICKER_SECOND_PHASE_SPREAD = 2;
/** The body is drawn over the floor, so a barely lit wall must not black out the ground it stands on. */
const BODY_ALPHA_FLOOR = 0.35;
const FLAME_ALPHA_FLOOR = 0.15;
/** Tongues overlap several deep up the line, so each one's light is a share of what the wall shows. */
const FLAME_ALPHA_PEAK = 0.62;
const HEART_ALPHA_PEAK = 0.75;
/** The heart only shows once the wall is well lit; below this it fades out on a curve. */
const HEART_ALPHA_EXPONENT = 1.6;

const RUNE_SPACING_PX = 16;
const RUNE_DRAW_PX = 13;
/** Runes lie on the floor, so they are drawn squashed into the ground plane. */
const RUNE_FLOOR_SQUASH = 0.6;
const RUNE_LIT_ALPHA_FLOOR = 0.45;
const RUNE_DORMANT_ALPHA = 0.5;
const RUNE_BREATH_PERIOD_MS = LOOP_MS;
const RUNE_BREATH_SHARE = 0.35;

const WISPS_PER_TILE = 3;
const WISP_RISE_MS = LOOP_MS;
const WISP_RADIUS_PX = 5;
const WISP_SWAY_PX = 3;
const WISP_ALPHA = 0.8;

const MOTES_PER_TILE = 6;
const DORMANT_MOTES_PER_TILE = 2;
/** A resting ward's whole show: so few sparks that nobody takes its line for a wall. */
const RESTING_MOTES_PER_TILE = 4;
const MOTE_RISE_MS = LOOP_MS;
/** Motes rise out of the curtain's top, past the tongues that throw them. */
const MOTE_RISE_OVER_WALL = 1.3;
const DORMANT_MOTE_RISE_PX = 14;
const MOTE_SIZE_PX = 1.3;
const MOTE_SWAY_PX = 4;

/**
 * Salts that keep each of a tile's scattered draws its own, so a wisp's place
 * along the line is not its rise, and a mote's start in its life is not where
 * it stands.
 */
const WISP_ALONG_SALT = 0.5;
const MOTE_LIFE_SALT = 0.5;
const MOTE_ALONG_SALT = 0.5;

const EMBER_SPACING_PX = 9;
const EMBER_ALPHA = 0.3;

/** The length of wall one baked frame covers. */
const TILE_LENGTH_PX = 32;

/** A wall runs down a column of tiles or along a row of them. */
type WallAxis = 'column' | 'row';

/** A run of wall as the painters walk it: where it starts, which way it goes and how far. */
interface RunFrame {
  readonly fromX: number;
  readonly fromY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly perpX: number;
  readonly perpY: number;
  readonly length: number;
  readonly seed: number;
}

/** What a baked tile shows: the curtain at one of {@link LIT_LEVELS}, a resting ward's sparks, or the dormant runes. */
type TileLook =
  | { readonly kind: 'lit'; readonly level: number }
  | { readonly kind: 'resting' }
  | { readonly kind: 'dormant' };

function tongueFlicker(nowMs: number, slot: number, seed: number): number {
  const phase = hashUnit(seed, slot) * TAU;
  const slow = HALF + HALF * Math.sin((TAU * nowMs) / TONGUE_FLICKER_PERIOD_MS + phase);
  const quickPhase = phase * TONGUE_FLICKER_SECOND_PHASE_SPREAD;
  const quick =
    HALF + HALF * Math.sin((TAU * nowMs) / TONGUE_FLICKER_SECOND_PERIOD_MS + quickPhase);
  const swing = slow * (1 - TONGUE_FLICKER_SECOND_SHARE) + quick * TONGUE_FLICKER_SECOND_SHARE;
  return TONGUE_FLICKER_FLOOR + (1 - TONGUE_FLICKER_FLOOR) * swing;
}

function paintRunes(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  runes: readonly CanvasSurface[],
  alpha: number,
  nowMs: number,
): void {
  const count = Math.max(1, Math.round(frame.length / RUNE_SPACING_PX));
  const spacing = frame.length / count;
  const drawHeight = RUNE_DRAW_PX * RUNE_FLOOR_SQUASH;
  for (let index = 0; index < count; index++) {
    const along = spacing * (index + HALF);
    const x = frame.fromX + frame.dirX * along;
    const y = frame.fromY + frame.dirY * along;
    const rune = runes[Math.floor(hashUnit(frame.seed, index) * runes.length)];
    const breathPhase = (TAU * nowMs) / RUNE_BREATH_PERIOD_MS + index;
    const breath = 1 - RUNE_BREATH_SHARE * (HALF + HALF * Math.sin(breathPhase));
    ctx.globalAlpha = alpha * breath;
    ctx.drawImage(rune, x - RUNE_DRAW_PX * HALF, y - drawHeight * HALF, RUNE_DRAW_PX, drawHeight);
  }
}

function paintTongues(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  layer: TongueLayer,
  variants: readonly CanvasSurface[],
  heightPx: number,
  alpha: number,
  spacing: number,
  nowMs: number,
): void {
  const slots = Math.max(1, Math.round(frame.length / spacing));
  const step = frame.length / slots;
  const stampScale =
    LAYER_HALF_WIDTH_PX[layer] / (TONGUE_STAMP_WIDTH_PX * TONGUE_LOBE_RADIUS_SHARE);
  const drawWidth = TONGUE_STAMP_WIDTH_PX * stampScale;
  const hold = LAYER_SHAPE_HOLD_MS[layer];
  ctx.globalAlpha = alpha;
  for (let slot = 0; slot < slots; slot++) {
    const along = step * (slot + HALF);
    const jitter = (hashUnit(slot, frame.seed) - HALF) * 2 * TONGUE_FOOT_JITTER_PX;
    const footX = frame.fromX + frame.dirX * along + frame.perpX * jitter;
    const footY = frame.fromY + frame.dirY * along + frame.perpY * jitter;
    const slotPhase = hashUnit(frame.seed + slot, slot);
    const shapeIndex = Math.floor(nowMs / hold + slotPhase * TONGUE_VARIANTS) + slot;
    const stamp = variants[shapeIndex % variants.length];
    const drawHeight = heightPx * tongueFlicker(nowMs, slot, frame.seed);
    ctx.drawImage(stamp, footX - drawWidth * HALF, footY - drawHeight, drawWidth, drawHeight);
  }
}

function paintWisps(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  heightPx: number,
  alpha: number,
  nowMs: number,
): void {
  const ink = worldPalette.wardWall;
  const stops: readonly GlowStop[] = [
    { offset: 0, color: ink.wispCore },
    { offset: 1, color: ink.wispFade },
  ];
  for (let wisp = 0; wisp < WISPS_PER_TILE; wisp++) {
    const life = fract(nowMs / WISP_RISE_MS + hashUnit(wisp, frame.seed));
    const along = frame.length * hashUnit(frame.seed, wisp + WISP_ALONG_SALT);
    const sway = Math.sin(life * TAU + wisp) * WISP_SWAY_PX;
    const x = frame.fromX + frame.dirX * along + sway;
    const y = frame.fromY + frame.dirY * along - life * heightPx;
    ctx.globalAlpha = alpha * WISP_ALPHA * Math.sin(life * Math.PI);
    drawRadialGlow(ctx, x, y, WISP_RADIUS_PX * (1 - life * HALF), stops);
  }
}

function paintMotes(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  count: number,
  risePx: number,
  alpha: number,
  nowMs: number,
  ink: string,
): void {
  ctx.fillStyle = ink;
  for (let mote = 0; mote < count; mote++) {
    const offset = hashUnit(mote + MOTE_LIFE_SALT, frame.seed);
    const life = fract(nowMs / MOTE_RISE_MS + offset);
    const along = frame.length * hashUnit(frame.seed + MOTE_ALONG_SALT, mote);
    const sway = Math.sin(life * Math.PI + offset * TAU) * MOTE_SWAY_PX * life;
    const x = frame.fromX + frame.dirX * along + frame.perpX * sway;
    const y = frame.fromY + frame.dirY * along - life * risePx;
    ctx.globalAlpha = alpha * (1 - life);
    ctx.fillRect(x - MOTE_SIZE_PX * HALF, y - MOTE_SIZE_PX * HALF, MOTE_SIZE_PX, MOTE_SIZE_PX);
  }
}

function litHeightPx(level: number): number {
  return WALL_HEIGHT_PX * (LIT_FLOOR_HEIGHT_SHARE + (1 - LIT_FLOOR_HEIGHT_SHARE) * level);
}

/** One tile of curtain at one moment of its loop, painted from the stamps along `tile`. */
function paintTile(
  ctx: CanvasRenderingContext2D,
  tile: RunFrame,
  look: TileLook,
  nowMs: number,
): void {
  const baked = ensureStamps();
  if (look.kind === 'resting') {
    ctx.globalCompositeOperation = 'lighter';
    paintMotes(
      ctx,
      tile,
      RESTING_MOTES_PER_TILE,
      DORMANT_MOTE_RISE_PX,
      1,
      nowMs,
      worldPalette.wardResting.mote,
    );
    return;
  }
  if (look.kind === 'dormant') {
    paintRunes(ctx, tile, baked.runes.spent, RUNE_DORMANT_ALPHA, nowMs);
    ctx.globalCompositeOperation = 'lighter';
    paintTongues(
      ctx,
      tile,
      'ember',
      baked.tongues.ember,
      EMBER_HEIGHT_PX,
      EMBER_ALPHA,
      EMBER_SPACING_PX,
      nowMs,
    );
    paintMotes(
      ctx,
      tile,
      DORMANT_MOTES_PER_TILE,
      DORMANT_MOTE_RISE_PX,
      1,
      nowMs,
      toneInk('spent').mote,
    );
    return;
  }
  const { level } = look;
  const heightPx = litHeightPx(level);
  paintTongues(
    ctx,
    tile,
    'body',
    baked.tongues.body,
    heightPx * LAYER_HEIGHT_SHARE.body,
    BODY_ALPHA_FLOOR + (1 - BODY_ALPHA_FLOOR) * level,
    TONGUE_SPACING_PX,
    nowMs,
  );
  ctx.globalCompositeOperation = 'lighter';
  const runeAlpha = RUNE_LIT_ALPHA_FLOOR + (1 - RUNE_LIT_ALPHA_FLOOR) * level;
  paintRunes(ctx, tile, baked.runes.live, runeAlpha, nowMs);
  paintTongues(
    ctx,
    tile,
    'flame',
    baked.tongues.flame,
    heightPx * LAYER_HEIGHT_SHARE.flame,
    FLAME_ALPHA_FLOOR + (FLAME_ALPHA_PEAK - FLAME_ALPHA_FLOOR) * level,
    TONGUE_SPACING_PX,
    nowMs,
  );
  paintWisps(ctx, tile, heightPx, level, nowMs);
  paintTongues(
    ctx,
    tile,
    'heart',
    baked.tongues.heart,
    heightPx * LAYER_HEIGHT_SHARE.heart,
    HEART_ALPHA_PEAK * Math.pow(level, HEART_ALPHA_EXPONENT),
    HEART_SPACING_PX,
    nowMs,
  );
  const risePx = heightPx * MOTE_RISE_OVER_WALL;
  paintMotes(ctx, tile, MOTES_PER_TILE, risePx, level, nowMs, toneInk('live').mote);
}

// ── Baked tile frames ──────────────────────────────────────────────────────

/**
 * The brightnesses a lit tile is baked at. A wall between them draws the
 * nearest, faded by `globalAlpha` when dimmer than the lowest: the faint
 * warning a crawler who cannot perceive a ward sees, and the doorway ward's
 * warning and burn, each land on their own level.
 */
const LIT_LEVELS = [0.4, 0.7, 1] as const;
/** Distinct curtains a tile may wear, so a long wall does not repeat itself tile by tile. */
const TILE_VARIANTS = 3;
const TILE_VARIANT_SEED_STRIDE = 104729;

/**
 * How far a baked tile reaches past its own length of line, in world pixels:
 * sideways for the widest tongue and its wandering foot, up for the tallest
 * tongue and the motes it throws, down for the runes and motes at its foot.
 */
const TILE_SIDE_REACH_PX = 24;
/** Room above the highest mote for its own size and the antialiasing round it. */
const TILE_RISE_SLACK_PX = 2;
const TILE_RISE_REACH_PX = Math.ceil(WALL_HEIGHT_PX * MOTE_RISE_OVER_WALL) + TILE_RISE_SLACK_PX;
const TILE_FOOT_REACH_PX = 6;
/** A dormant or resting tile's embers and motes stay low, so its frames are far shorter. */
const DORMANT_RISE_REACH_PX = DORMANT_MOTE_RISE_PX + EMBER_HEIGHT_PX;

interface TileBox {
  /** The tile's start on the line, measured from the frame's top-left corner. */
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

function tileBox(axis: WallAxis, look: TileLook): TileBox {
  const rise = look.kind === 'lit' ? TILE_RISE_REACH_PX : DORMANT_RISE_REACH_PX;
  switch (axis) {
    case 'column':
      return {
        originX: TILE_SIDE_REACH_PX,
        originY: rise,
        width: TILE_SIDE_REACH_PX * 2,
        height: rise + TILE_LENGTH_PX + TILE_FOOT_REACH_PX,
      };
    case 'row':
      return {
        originX: TILE_SIDE_REACH_PX,
        originY: rise,
        width: TILE_SIDE_REACH_PX * 2 + TILE_LENGTH_PX,
        height: rise + TILE_FOOT_REACH_PX + TONGUE_FOOT_JITTER_PX,
      };
    default: {
      const unhandled: never = axis;
      throw new Error(`unhandled wall axis ${String(unhandled)}`);
    }
  }
}

/** Device pixels per world pixel a tile is baked at are rounded to this step, so a zoom does not bake a new set for every sliver of scale. */
const DEVICE_SCALE_STEP = 0.5;
const MIN_DEVICE_SCALE = 1;
/** The sharpest the game ever renders; the budget below is sized for frames baked at it. */
const MAX_DEVICE_SCALE = MAX_SHARP_RENDER_SCALE;
/**
 * The baked tile frames' byte budget. A wall lit at one level in three
 * variants is 48 frames, 3.7 MB at the largest device scale; this leaves room
 * for a pulsing ward's other levels and the dormant runes beside it.
 */
const TILE_FRAME_BUDGET_MEGABYTES = 10;
/** A frame drawn this frame or the one before is on screen and never let go. */
const TILE_FRAME_PROTECTED_FRAMES = 1;
/** Frames not drawn for this many idle frames are let go, so leaving the storey empties the cache. */
const TILE_FRAME_IDLE_RELEASE_FRAMES = 600;
/**
 * New frames baked in one render frame. A wall coming into view needs one
 * frame per tile at once; past this, a tile shows its loop's first frame
 * until its own is ready, baking that first frame if it has none yet, so a
 * wall never blinks out and a newly seen one bakes at most one frame a tile.
 */
const TILE_BAKES_PER_FRAME = 3;
const FIRST_LOOP_FRAME = 0;

const tileFrames = new RecentSurfaceCache<CanvasSurface>(
  TILE_FRAME_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE,
  TILE_FRAME_PROTECTED_FRAMES,
  (surface) => surface,
  TILE_FRAME_IDLE_RELEASE_FRAMES,
);
onCanvasRecovery(() => tileFrames.clear());

let bakeFrame = -1;
let bakesThisFrame = 0;

function lookKey(look: TileLook): string {
  return look.kind === 'lit' ? `lit${look.level}` : look.kind;
}

function bakeTileFrame(
  axis: WallAxis,
  look: TileLook,
  variant: number,
  frameIndex: number,
  deviceScale: number,
): CanvasSurface {
  const box = tileBox(axis, look);
  const surface = allocCanvas(
    'effects',
    Math.ceil(box.width * deviceScale),
    Math.ceil(box.height * deviceScale),
  );
  const ctx = surfaceContext(surface);
  ctx.scale(deviceScale, deviceScale);
  const alongColumn = axis === 'column';
  const tile: RunFrame = {
    fromX: box.originX,
    fromY: box.originY,
    dirX: alongColumn ? 0 : 1,
    dirY: alongColumn ? 1 : 0,
    perpX: alongColumn ? -1 : 0,
    perpY: alongColumn ? 0 : 1,
    length: TILE_LENGTH_PX,
    seed: (variant + 1) * TILE_VARIANT_SEED_STRIDE,
  };
  paintTile(ctx, tile, look, frameIndex * FRAME_MS);
  return surface;
}

function tileFrame(
  axis: WallAxis,
  look: TileLook,
  variant: number,
  frameIndex: number,
  deviceScale: number,
): CanvasSurface {
  const key = (index: number): string =>
    `${axis}:${lookKey(look)}:${variant}:${index}:${deviceScale}`;
  const cached = tileFrames.get(key(frameIndex));
  if (cached !== undefined) return cached;
  const frameNow = renderFrameNumber();
  if (frameNow !== bakeFrame) {
    bakeFrame = frameNow;
    bakesThisFrame = 0;
  }
  const bakeAndKeep = (index: number): CanvasSurface => {
    bakesThisFrame++;
    const baked = bakeTileFrame(axis, look, variant, index, deviceScale);
    tileFrames.set(key(index), baked);
    return baked;
  };
  const overBakeBudget = bakesThisFrame >= TILE_BAKES_PER_FRAME;
  if (!overBakeBudget) return bakeAndKeep(frameIndex);
  return tileFrames.get(key(FIRST_LOOP_FRAME)) ?? bakeAndKeep(FIRST_LOOP_FRAME);
}

// ── The wall ───────────────────────────────────────────────────────────────

/** How far the wall's light reaches across the floor and onto whatever stands beside it. */
const GLOW_REACH_PX = 34;
const GLOW_LIT_ALPHA_FLOOR = 0.25;
const GLOW_LIT_ALPHA_SPAN = 0.55;
const GLOW_DORMANT_ALPHA = 0.08;
const GLOW_FLICKER_PERIOD_MS = 170;
const GLOW_FLICKER_SHARE = 0.18;

/** Lightning runs through a wall only this lit or more, so only a wall that bars or bites crackles. */
const ARC_INTENSITY = 0.85;
/** How long one bolt holds before the next is struck. */
const ARC_HOLD_MS = 80;
const ARC_CHANCE = 0.6;
const ARC_SECOND_CHANCE = 0.2;
const ARC_STEP_PX = 7;
/** A bolt wanders sideways by at most this much a step, and never further than this from the line. */
const ARC_WANDER_PX = 4;
const ARC_REACH_PX = 9;
const ARC_MIN_SPAN_SHARE = 0.35;
const ARC_TOP_SHARE = 0.92;
const ARC_GLOW_WIDTH_PX = 2.6;
const ARC_CORE_WIDTH_PX = 0.8;

const SEED_STRIDE = 7919;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function runFrame(
  run: WardWallRun,
  view: WardWallView,
  index: number,
  wardSeed: number,
): RunFrame | null {
  const dx = run.to.x - run.from.x;
  const dy = run.to.y - run.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const fromX = run.from.x - view.camX;
  const fromY = run.from.y - view.camY;
  const toX = run.to.x - view.camX;
  const toY = run.to.y - view.camY;
  const margin = TILE_RISE_REACH_PX + GLOW_REACH_PX;
  const offScreen =
    Math.max(fromX, toX) < -margin ||
    Math.min(fromX, toX) > view.width + margin ||
    Math.max(fromY, toY) < -margin ||
    Math.min(fromY, toY) > view.height + margin;
  if (offScreen) return null;
  const dirX = dx / length;
  const dirY = dy / length;
  return {
    fromX,
    fromY,
    dirX,
    dirY,
    perpX: -dirY,
    perpY: dirX,
    length,
    // Not the run's x: a sweeping ward slides sideways, and its tiles must keep their curtains as it goes.
    seed: wardSeed + Math.round(run.from.y) * SEED_STRIDE + index,
  };
}

function glowPool(deviceScale: number, tone: WardTone): CanvasSurface {
  const key = `glow:${tone}:${deviceScale}`;
  const cached = tileFrames.get(key);
  if (cached !== undefined) return cached;
  const size = Math.ceil(GLOW_REACH_PX * 2 * deviceScale);
  const surface = allocCanvas('effects', size, size);
  const ctx = surfaceContext(surface);
  const ink = toneInk(tone);
  const centre = size * HALF;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  gradient.addColorStop(0, ink.floorGlowCore);
  gradient.addColorStop(1, ink.floorGlowFade);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  tileFrames.set(key, surface);
  return surface;
}

/** The wall's light on the floor and on whatever stands beside it: one baked pool per tile, overlapping into a band. */
function paintGlow(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  alpha: number,
  deviceScale: number,
  tone: WardTone,
): void {
  const pool = glowPool(deviceScale, tone);
  const tiles = Math.max(1, Math.round(frame.length / TILE_LENGTH_PX));
  const step = frame.length / tiles;
  const diameter = GLOW_REACH_PX * 2;
  ctx.globalAlpha = alpha;
  for (let tile = 0; tile < tiles; tile++) {
    const along = step * (tile + HALF);
    const x = frame.fromX + frame.dirX * along;
    const y = frame.fromY + frame.dirY * along;
    ctx.drawImage(pool, x - GLOW_REACH_PX, y - GLOW_REACH_PX, diameter, diameter);
  }
}

/** A bolt crawling down through the curtain from near its top to a foot on the line. */
function traceArc(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  heightPx: number,
  rng: Rng,
): void {
  const span = frame.length * between(rng, ARC_MIN_SPAN_SHARE, 1);
  const start = (frame.length - span) * rng();
  const steps = Math.max(2, Math.ceil((span + heightPx) / ARC_STEP_PX));
  const topLift = heightPx * ARC_TOP_SHARE * between(rng, HALF, 1);
  const downward = rng() < HALF;
  let wander = 0;
  ctx.beginPath();
  for (let step = 0; step <= steps; step++) {
    const share = step / steps;
    const along = start + span * (downward ? share : 1 - share);
    const lift = topLift * (1 - share);
    wander = Math.max(
      -ARC_REACH_PX,
      Math.min(ARC_REACH_PX, wander + (rng() - HALF) * 2 * ARC_WANDER_PX),
    );
    const sideways = step === steps ? 0 : wander;
    const x = frame.fromX + frame.dirX * along + frame.perpX * sideways;
    const y = frame.fromY + frame.dirY * along + frame.perpY * sideways - lift;
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function paintArcs(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  heightPx: number,
  nowMs: number,
): void {
  const strike = Math.floor(nowMs / ARC_HOLD_MS);
  const rng = mulberry32(strike * SEED_STRIDE + frame.seed);
  const bolts = (rng() < ARC_CHANCE ? 1 : 0) + (rng() < ARC_SECOND_CHANCE ? 1 : 0);
  if (bolts === 0) return;
  const ink = worldPalette.wardWall;
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let bolt = 0; bolt < bolts; bolt++) {
    traceArc(ctx, frame, heightPx, rng);
    ctx.strokeStyle = ink.arcGlow;
    ctx.lineWidth = ARC_GLOW_WIDTH_PX;
    ctx.stroke();
    ctx.strokeStyle = ink.arcCore;
    ctx.lineWidth = ARC_CORE_WIDTH_PX;
    ctx.stroke();
  }
}

function nearestLitLevel(intensity: number): number {
  let best: number = LIT_LEVELS[0];
  for (const level of LIT_LEVELS) {
    if (Math.abs(level - intensity) < Math.abs(best - intensity)) best = level;
  }
  return best;
}

function deviceScaleOf(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  const scale = Math.hypot(transform.a, transform.b);
  const stepped = Math.round(scale / DEVICE_SCALE_STEP) * DEVICE_SCALE_STEP;
  return Math.max(MIN_DEVICE_SCALE, Math.min(MAX_DEVICE_SCALE, stepped));
}

function paintTiles(
  ctx: CanvasRenderingContext2D,
  frame: RunFrame,
  look: TileLook,
  deviceScale: number,
  nowMs: number,
): void {
  const axis: WallAxis = Math.abs(frame.dirY) >= Math.abs(frame.dirX) ? 'column' : 'row';
  const box = tileBox(axis, look);
  const tiles = Math.max(1, Math.round(frame.length / TILE_LENGTH_PX));
  const step = frame.length / tiles;
  const loopFrame = Math.floor(nowMs / FRAME_MS);
  const fromTheBack = frame.dirY >= 0 && frame.dirX >= 0;
  for (let order = 0; order < tiles; order++) {
    const tile = fromTheBack ? order : tiles - 1 - order;
    const variant = Math.floor(hashUnit(frame.seed, tile) * TILE_VARIANTS);
    const offset = Math.floor(hashUnit(tile, frame.seed) * LOOP_FRAMES);
    const surface = tileFrame(axis, look, variant, (loopFrame + offset) % LOOP_FRAMES, deviceScale);
    const startX = Math.min(
      frame.fromX + frame.dirX * step * tile,
      frame.fromX + frame.dirX * step * (tile + 1),
    );
    const startY = Math.min(
      frame.fromY + frame.dirY * step * tile,
      frame.fromY + frame.dirY * step * (tile + 1),
    );
    ctx.drawImage(surface, startX - box.originX, startY - box.originY, box.width, box.height);
  }
}

/** How a wall in `state` at `strength` is drawn: which baked look, how faded, and how much light it throws on the floor. */
function wallPaint(
  state: WardWallState,
  strength: number,
  nowMs: number,
): { look: TileLook; tileAlpha: number; glowAlpha: number; tone: WardTone } {
  switch (state.kind) {
    case 'lit': {
      const level = nearestLitLevel(strength);
      const glowFlicker =
        1 - GLOW_FLICKER_SHARE * (HALF + HALF * Math.sin((TAU * nowMs) / GLOW_FLICKER_PERIOD_MS));
      return {
        look: { kind: 'lit', level },
        tileAlpha: Math.min(1, strength / level),
        glowAlpha: (GLOW_LIT_ALPHA_FLOOR + GLOW_LIT_ALPHA_SPAN * strength) * glowFlicker,
        tone: 'live',
      };
    }
    case 'resting':
      return { look: { kind: 'resting' }, tileAlpha: strength, glowAlpha: 0, tone: 'live' };
    case 'dormant':
      return {
        look: { kind: 'dormant' },
        tileAlpha: strength,
        glowAlpha: GLOW_DORMANT_ALPHA * strength,
        tone: 'spent',
      };
    default: {
      const unhandled: never = state;
      throw new Error(`unhandled ward wall state ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Draws a ward wall along `runs` in `state`: its light on the floor, a baked
 * frame per tile of line and, on a wall lit enough, lightning. A ward that
 * hurts draws its red ground warning under this, never instead. `wardSeed`
 * is the ward's own, so two wards side by side never move in step.
 */
export function drawWardWall(
  ctx: CanvasRenderingContext2D,
  runs: readonly WardWallRun[],
  wardSeed: number,
  state: WardWallState,
  view: WardWallView,
): void {
  const strength = state.kind === 'lit' ? clamp01(state.intensity) : clamp01(state.strength);
  if (strength <= 0) return;
  const nowMs = view.nowMs;
  const deviceScale = deviceScaleOf(ctx);
  const { look, tileAlpha, glowAlpha, tone } = wallPaint(state, strength, nowMs);
  ctx.save();
  runs.forEach((run, index) => {
    const frame = runFrame(run, view, index, wardSeed);
    if (frame === null) return;
    if (glowAlpha > 0) {
      ctx.globalCompositeOperation = 'lighter';
      paintGlow(ctx, frame, glowAlpha, deviceScale, tone);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = tileAlpha;
    paintTiles(ctx, frame, look, deviceScale, nowMs);
    if (look.kind === 'lit' && strength >= ARC_INTENSITY) {
      ctx.globalCompositeOperation = 'lighter';
      paintArcs(ctx, frame, litHeightPx(strength), nowMs);
    }
  });
  ctx.restore();
}
