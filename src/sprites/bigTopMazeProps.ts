/**
 * The Big Top maze's furniture, drawn live rather than baked into a sheet.
 *
 * Everything the trap maze puts on the floor is here: the two crawlers'
 * interactables, the barriers those interactables open, the hall of mirrors, the
 * gas jets in the sawdust, the spotlights, and the tent dressing along the
 * trails. None of it animates in ways a sheet would serve — a handful of
 * rectangles and a flicker is cheaper live, and it lets every prop read its own
 * damage state without a frame table.
 *
 * The one rule that governs the whole file is the ownership language. A prop
 * Donut can act on is red-and-white striped canvas with gold trim and a gold
 * hoop drawn round it; a prop Carl can act on is deep circus blue and brass on
 * heavy timber, with brass strike chevrons. A player should be able to name the
 * prop and its owner from the colours alone at a 32-pixel tile.
 */

import type { BeamDirection, MirrorFacing, MirrorKind } from '../map/bigTopMazeLayout';
import { drawBox } from '../ui/Box';
import { drawText } from '../ui/TextBox';
import { drawDangerTile } from './dangerTelegraph';
import {
  MIN_VISIBLE_ALPHA,
  flameStamps,
  gradientStopRgba,
  hashUnit,
  stampTeardrop,
  type FlameStamps,
} from './flameStamps';

// ── State the systems hand the art ────────────────────────────────────────────

/** How a destructible currently looks. */
export interface MazeDestructibleArt {
  /** 1 at full, 0 at broken. */
  readonly integrity: number;
  readonly broken: boolean;
  /** True for a few frames after a landed blow. */
  readonly struck: boolean;
  /** Which side the acting crawler stands on. */
  readonly facing: 'west' | 'east';
  /** Monotonic frame counter owned by the prop. */
  readonly phase: number;
  readonly pulsing: boolean;
}

/** How the show bell's stand currently looks. */
export interface MazeBellArt {
  readonly phase: number;
  readonly struck: boolean;
  /** True while the bell's hold is running. */
  readonly holding: boolean;
  /** 1 → 0 across the hold. */
  readonly holdFraction: number;
  /** False while the stand is on cooldown and will not answer. */
  readonly ready: boolean;
  readonly pulsing: boolean;
}

/** How one steerable mirror currently looks. */
export interface MazeMirrorArt {
  readonly kind: MirrorKind;
  /** The two tile edges the glass connects. */
  readonly facing: MirrorFacing;
  readonly phase: number;
  readonly struck: boolean;
  /** True for a few frames after it is knocked round. */
  readonly turning: boolean;
  readonly pulsing: boolean;
}

/** How one star target in the dividing wall currently looks. */
export interface MazeStarArt {
  readonly phase: number;
  /** How many of the beams this star needs are on it right now, 0..1. */
  readonly litFraction: number;
  /** True once the star has latched its barriers open. */
  readonly latched: boolean;
}

// ── Palette ───────────────────────────────────────────────────────────────────

interface Ink {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Every translucent colour in the file goes through here.
 *
 * `gradientStopRgba` clamps and fixes the decimal, which is what keeps a tiny
 * computed alpha from formatting as exponent notation — a form some canvas
 * implementations reject outright, painting a solid smear where a whisper of
 * light was wanted.
 */
function inkRgba(ink: Ink, alpha: number): string {
  return gradientStopRgba(ink.r, ink.g, ink.b, alpha);
}

const STRIPE_RED_INK: Ink = { r: 198, g: 48, b: 56 };
const STRIPE_WHITE_INK: Ink = { r: 240, g: 231, b: 216 };
const GOLD_INK: Ink = { r: 240, g: 194, b: 70 };
const GOLD_DEEP_INK: Ink = { r: 170, g: 124, b: 30 };

const CIRCUS_BLUE_INK: Ink = { r: 29, g: 58, b: 116 };
const BLUE_LIGHT_INK: Ink = { r: 58, g: 104, b: 182 };
const BRASS_INK: Ink = { r: 196, g: 148, b: 56 };
const BRASS_LIGHT_INK: Ink = { r: 232, g: 194, b: 116 };

const TIMBER_DARK_INK: Ink = { r: 58, g: 38, b: 18 };
const TIMBER_MID_INK: Ink = { r: 106, g: 72, b: 34 };
const TIMBER_LIGHT_INK: Ink = { r: 143, g: 104, b: 53 };

const IRON_DARK_INK: Ink = { r: 34, g: 39, b: 45 };
const IRON_MID_INK: Ink = { r: 76, g: 85, b: 95 };
const IRON_LIGHT_INK: Ink = { r: 120, g: 131, b: 142 };
const MASONRY_INK: Ink = { r: 92, g: 84, b: 74 };
const MASONRY_SHADE_INK: Ink = { r: 62, g: 56, b: 49 };

const SAND_INK: Ink = { r: 196, g: 172, b: 122 };
const ROPE_INK: Ink = { r: 200, g: 177, b: 132 };

const VELVET_INK: Ink = { r: 122, g: 22, b: 32 };
const VELVET_SHADE_INK: Ink = { r: 74, g: 12, b: 20 };
const LIMELIGHT_INK: Ink = { r: 255, g: 246, b: 214 };
const EMBER_INK: Ink = { r: 255, g: 138, b: 48 };
const SHADOW_INK: Ink = { r: 8, g: 6, b: 10 };

/**
 * The one colour the tent uses for "this is clear, go".
 *
 * Shared by the boards a rung bell has bought and by every barrier the party has
 * opened, because they are the same promise made about two different kinds of
 * ground — and a player who has learned it once should never have to learn it
 * again in another hue.
 */
const CLEAR_GREEN_INK: Ink = { r: 138, g: 226, b: 168 };
const CORPSE_INK: Ink = { r: 46, g: 42, b: 48 };
const STRAW_INK: Ink = { r: 176, g: 148, b: 76 };
const GLASS_INK: Ink = { r: 158, g: 190, b: 204 };

const STRIPE_RED = inkRgba(STRIPE_RED_INK, 1);
const STRIPE_WHITE = inkRgba(STRIPE_WHITE_INK, 1);
const GOLD = inkRgba(GOLD_INK, 1);
const GOLD_DEEP = inkRgba(GOLD_DEEP_INK, 1);
const CIRCUS_BLUE = inkRgba(CIRCUS_BLUE_INK, 1);
const BLUE_LIGHT = inkRgba(BLUE_LIGHT_INK, 1);
const BRASS = inkRgba(BRASS_INK, 1);
const BRASS_LIGHT = inkRgba(BRASS_LIGHT_INK, 1);
const TIMBER_DARK = inkRgba(TIMBER_DARK_INK, 1);
const TIMBER_MID = inkRgba(TIMBER_MID_INK, 1);
const TIMBER_LIGHT = inkRgba(TIMBER_LIGHT_INK, 1);
const IRON_DARK = inkRgba(IRON_DARK_INK, 1);
const IRON_MID = inkRgba(IRON_MID_INK, 1);
const IRON_LIGHT = inkRgba(IRON_LIGHT_INK, 1);
const MASONRY = inkRgba(MASONRY_INK, 1);
const MASONRY_SHADE = inkRgba(MASONRY_SHADE_INK, 1);
const SAND = inkRgba(SAND_INK, 1);
const ROPE_COLOR = inkRgba(ROPE_INK, 1);
const VELVET = inkRgba(VELVET_INK, 1);
const VELVET_SHADE = inkRgba(VELVET_SHADE_INK, 1);
const LIMELIGHT = inkRgba(LIMELIGHT_INK, 1);
const CORPSE = inkRgba(CORPSE_INK, 1);
const STRAW = inkRgba(STRAW_INK, 1);
const CRACK_COLOR = inkRgba(SHADOW_INK, 1);

const TAU = Math.PI * 2;

// ── Shared behaviour ──────────────────────────────────────────────────────────

/**
 * The "the act wants this one" glow, at roughly one breath a second.
 *
 * Slow on purpose: a fast pulse on half a dozen props at once turns the lane
 * into a strobe, and the point of the cue is to be findable at a glance rather
 * than to be loud.
 */
const PULSE_PERIOD_FRAMES = 60;
const PULSE_RADIANS_PER_FRAME = TAU / PULSE_PERIOD_FRAMES;

function pulseStrength(phase: number, pulsing: boolean): number {
  if (!pulsing) return 0;
  return 0.5 + 0.5 * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
}

const HALO_RING_COUNT = 3;
const HALO_INNER_RADIUS = 0.33;
const HALO_RING_STEP = 0.08;
const HALO_RING_WIDTH = 0.05;
const HALO_PEAK_ALPHA = 0.55;

/** Concentric strokes rather than a radial gradient — this runs on many tiles a frame. */
function paintPulseHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strength: number,
  ink: Ink,
): void {
  if (strength < MIN_VISIBLE_ALPHA) return;
  ctx.lineWidth = Math.max(1, size * HALO_RING_WIDTH);
  for (let ring = 0; ring < HALO_RING_COUNT; ring++) {
    ctx.strokeStyle = inkRgba(ink, (HALO_PEAK_ALPHA * strength) / (ring + 1));
    ctx.beginPath();
    ctx.arc(cx, cy, size * (HALO_INNER_RADIUS + HALO_RING_STEP * ring), 0, TAU);
    ctx.stroke();
  }
}

/** How wide the shock ring sits by default, as a fraction of the tile. */
const IMPACT_RADIUS = 0.36;
const IMPACT_GLOW_RINGS = 3;
const IMPACT_GLOW_ALPHA = 0.34;
const IMPACT_GLOW_SPREAD = 0.35;
const IMPACT_RIM_ALPHA = 0.9;
const IMPACT_RIM_WIDTH = 0.055;
const IMPACT_SPARK_COUNT = 6;
const IMPACT_SPARK_LENGTH = 0.16;
const IMPACT_SPARK_ALPHA = 0.7;

/**
 * The flash over a prop that has just been hit.
 *
 * Shaped to the prop and added rather than painted over it: an opaque fill
 * across the whole tile hides the thing the player just hit, which reads as the
 * prop having vanished rather than as a blow landing. Lightening keeps the
 * stripes, the timber and the damage state legible right through the flash, and
 * the crisp rim and sparks are what actually sell the impact.
 */
function paintImpact(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  size: number,
  struck: boolean,
  radiusFraction: number = IMPACT_RADIUS,
): void {
  if (!struck) return;
  const radius = size * radiusFraction;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ring = IMPACT_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, IMPACT_GLOW_ALPHA / (ring * ring));
    ctx.beginPath();
    ctx.arc(
      centreX,
      centreY,
      radius * (1 - IMPACT_GLOW_SPREAD + IMPACT_GLOW_SPREAD * ring),
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = inkRgba(LIMELIGHT_INK, IMPACT_RIM_ALPHA);
  ctx.lineWidth = Math.max(1, size * IMPACT_RIM_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = inkRgba(LIMELIGHT_INK, IMPACT_SPARK_ALPHA);
  for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark++) {
    const angle = (TAU / IMPACT_SPARK_COUNT) * spark;
    const outer = radius + size * IMPACT_SPARK_LENGTH;
    ctx.beginPath();
    ctx.moveTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
    ctx.lineTo(centreX + Math.cos(angle) * outer, centreY + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Which way the dividing wall lies from a prop's own tile: +1 east, -1 west.
 *
 * A prop faces the crawler who can reach it, so the wall it is fixed to is
 * always on the far side of that.
 */
function wallDirectionFor(facing: MazeDestructibleArt['facing']): number {
  return facing === 'east' ? -1 : 1;
}

/**
 * How many blows have landed, from the integrity that is left.
 *
 * Every destructible in the maze takes three, and the damage art is staged
 * rather than continuous so a player can count the remaining work from across
 * the lane.
 */
const DAMAGE_STAGE_COUNT = 3;

function hitsLanded(integrity: number): number {
  const remaining = Math.max(0, Math.min(1, integrity));
  return Math.min(DAMAGE_STAGE_COUNT, Math.round((1 - remaining) * DAMAGE_STAGE_COUNT));
}

/**
 * Splits that open across a prop as it is worked down.
 *
 * Deliberately far heavier than a hairline: at 32 pixels a one-pixel crack over
 * a textured prop is invisible, and a damage state nobody can see reads as a
 * prop that is not taking damage at all.
 */
const CRACK_STAGE_ONE = 1;
const CRACK_STAGE_TWO = 2;
const CRACK_WIDTH_FRACTION = 0.055;
const CRACK_SHADOW_OFFSET = 0.03;

function paintCracks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  integrity: number,
): void {
  const stage = hitsLanded(integrity);
  if (stage < CRACK_STAGE_ONE) return;
  const strokeWidth = Math.max(2, size * CRACK_WIDTH_FRACTION);
  const offset = size * CRACK_SHADOW_OFFSET;

  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = CRACK_COLOR;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.22, y);
  ctx.lineTo(x + width * 0.5, y + height * 0.52);
  ctx.lineTo(x + width * 0.3, y + height);
  ctx.stroke();

  ctx.strokeStyle = inkRgba(STRIPE_WHITE_INK, 0.35);
  ctx.lineWidth = Math.max(1, strokeWidth * 0.4);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.22 + offset, y);
  ctx.lineTo(x + width * 0.5 + offset, y + height * 0.52);
  ctx.stroke();

  if (stage < CRACK_STAGE_TWO) return;
  ctx.strokeStyle = CRACK_COLOR;
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  ctx.moveTo(x + width * 0.82, y + height * 0.08);
  ctx.lineTo(x + width * 0.56, y + height * 0.58);
  ctx.lineTo(x + width * 0.78, y + height);
  ctx.stroke();
}

/** The gold hoop that marks a prop as Donut's to shoot. */
const HOOP_RADIUS = 0.44;
const HOOP_WIDTH = 0.045;
const HOOP_TICK_COUNT = 4;
const HOOP_TICK_LENGTH = 0.07;
const HOOP_IDLE_ALPHA = 0.6;

function paintDonutHoop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strength: number,
): void {
  const radius = size * HOOP_RADIUS;
  ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
  ctx.strokeStyle = inkRgba(GOLD_INK, HOOP_IDLE_ALPHA + (1 - HOOP_IDLE_ALPHA) * strength);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();
  for (let tick = 0; tick < HOOP_TICK_COUNT; tick++) {
    const angle = (TAU / HOOP_TICK_COUNT) * tick;
    const inner = radius;
    const outer = radius + size * HOOP_TICK_LENGTH;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

/** The brass chevrons that mark a prop as Carl's to smash, on the face he can reach. */
const CHEVRON_COUNT = 2;
const CHEVRON_HALF_HEIGHT = 0.09;
const CHEVRON_DEPTH = 0.09;
const CHEVRON_GAP = 0.13;
const CHEVRON_WIDTH = 0.05;
const CHEVRON_IDLE_ALPHA = 0.7;

function paintCarlChevrons(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  facing: MazeDestructibleArt['facing'],
  strength: number,
): void {
  // Pointing at the timber from the side Carl stands on, so the mark says where
  // the blow goes rather than merely that a blow is wanted.
  const approach = facing === 'east' ? 1 : -1;
  const tipX = cx - approach * size * HOOP_RADIUS;
  ctx.strokeStyle = inkRgba(
    BRASS_LIGHT_INK,
    CHEVRON_IDLE_ALPHA + (1 - CHEVRON_IDLE_ALPHA) * strength,
  );
  ctx.lineWidth = Math.max(1, size * CHEVRON_WIDTH);
  for (let index = 0; index < CHEVRON_COUNT; index++) {
    const backX = tipX + approach * size * (CHEVRON_DEPTH + CHEVRON_GAP * index);
    ctx.beginPath();
    ctx.moveTo(backX, cy - size * CHEVRON_HALF_HEIGHT);
    ctx.lineTo(tipX + approach * size * CHEVRON_GAP * index, cy);
    ctx.lineTo(backX, cy + size * CHEVRON_HALF_HEIGHT);
    ctx.stroke();
  }
}

/**
 * The stream of sand out of a torn ballast sack.
 *
 * One stream per landed blow, running until the sack gives entirely. A sack that
 * only changes silhouette between hits reads as a sack that has stopped caring;
 * the falling grains are what say it is still emptying.
 */
const SAND_STREAM_GRAINS = 7;
const SAND_GRAIN_SIZE = 0.05;
const SAND_FALL_FRAMES = 22;
const SAND_DRIFT = 0.05;
const SAND_PILE_WIDTH = 0.16;
const SAND_PILE_HEIGHT = 0.045;
const SAND_STREAM_ALPHA = 0.85;
const HASH_SALT_LEAK_LANE = 37;
const HASH_SALT_LEAK_PHASE = 73;

function paintSandLeak(
  ctx: CanvasRenderingContext2D,
  ripX: number,
  ripY: number,
  floorY: number,
  size: number,
  phase: number,
  streamCount: number,
): void {
  if (streamCount <= 0) return;
  const grain = Math.max(1, size * SAND_GRAIN_SIZE);
  for (let stream = 0; stream < streamCount; stream++) {
    const lane = (hashUnit(stream + HASH_SALT_LEAK_LANE, stream) - 0.5) * size * SAND_DRIFT * 4;
    const startX = ripX + lane;
    const drop = Math.max(grain, floorY - ripY);
    for (let index = 0; index < SAND_STREAM_GRAINS; index++) {
      const seeded = hashUnit(stream + HASH_SALT_LEAK_PHASE, index);
      const travel = (phase / SAND_FALL_FRAMES + seeded + index / SAND_STREAM_GRAINS) % 1;
      ctx.fillStyle = inkRgba(SAND_INK, SAND_STREAM_ALPHA * (1 - travel * travel));
      ctx.fillRect(startX - grain / 2, ripY + drop * travel, grain, grain);
    }
    ctx.fillStyle = inkRgba(SAND_INK, SAND_STREAM_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      startX,
      floorY,
      size * SAND_PILE_WIDTH * (1 + stream * 0.2),
      size * SAND_PILE_HEIGHT,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }
}

// ── Donut's targets ───────────────────────────────────────────────────────────

const SANDBAG_WIDTH = 0.56;
const SANDBAG_HEIGHT = 0.5;
const SANDBAG_TOP = 0.3;
/** How far off its tile's centre the bag sits, toward the wall it hangs on. */
const SANDBAG_WALL_HUG = 0.3;
/** Fraction of the bag's width at its tied neck and at its resting foot. */
const SANDBAG_NECK_FRACTION = 0.22;
const SANDBAG_FOOT_FRACTION = 0.42;
/** Where down the bag its widest point sits. */
const SANDBAG_BELLY_FRACTION = 0.62;
/** How far the sack sags and spreads once all three blows have landed. */
const SANDBAG_SLUMP_DROP = 0.11;
const SANDBAG_SLUMP_SPREAD = 0.22;
const SANDBAG_STRIPE_COUNT = 5;
const SANDBAG_TRIM_HEIGHT = 0.05;
const SANDBAG_FLOOR_Y = 0.88;
const SANDBAG_BURST_SPILL_WIDTH = 0.85;
const SANDBAG_BURST_SPILL_HEIGHT = 0.09;
const SANDBAG_BURST_SKIN_WIDTH = 0.5;
const SANDBAG_BURST_SKIN_HEIGHT = 0.06;
const SANDBAG_BURST_SKIN_Y = 0.78;

const ROPE_WIDTH = 0.055;
const ROPE_SWAY_TILES = 0.02;
const ROPE_SWAY_SPEED = 0.045;

/**
 * The sandbag counterweight: a striped canvas bag roped to the gate mechanism.
 *
 * Drawn as a bulging sack rather than a box because a rectangle at this size is
 * indistinguishable from a crate, and a crate is not something a player thinks
 * to shoot.
 */
export function drawMazeSandbag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  ctx.save();
  const wallDirection = wallDirectionFor(state.facing);
  const stage = hitsLanded(state.integrity);
  const wear = stage / DAMAGE_STAGE_COUNT;
  const bagWidth = size * SANDBAG_WIDTH * (1 + SANDBAG_SLUMP_SPREAD * wear);
  const bagHeight = size * SANDBAG_HEIGHT * (1 - SANDBAG_SLUMP_SPREAD * wear);
  const centreX = x + size / 2 + (wallDirection * size * SANDBAG_WALL_HUG) / 2;
  const bagTop = y + size * (SANDBAG_TOP + SANDBAG_SLUMP_DROP * wear);
  const floorY = y + size * SANDBAG_FLOOR_Y;

  if (state.broken) {
    paintBurstSandbag(ctx, centreX, y, size, bagWidth);
    ctx.restore();
    return;
  }

  const strength = pulseStrength(state.phase, state.pulsing);
  paintPulseHalo(ctx, x + size / 2, y + size / 2, size, strength, GOLD_INK);

  const sway = Math.sin(state.phase * ROPE_SWAY_SPEED) * size * ROPE_SWAY_TILES;
  const bagCentreX = centreX + sway;

  // The rope runs off the top of the tile: the mechanism it answers to is up in
  // the tent rigging, which is nowhere the player can reach.
  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(centreX, y);
  ctx.lineTo(bagCentreX, bagTop);
  ctx.stroke();

  const bagBottom = bagTop + bagHeight;
  const bellyY = bagTop + bagHeight * SANDBAG_BELLY_FRACTION;
  ctx.beginPath();
  ctx.moveTo(bagCentreX - bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.quadraticCurveTo(
    bagCentreX - bagWidth / 2,
    bellyY,
    bagCentreX - bagWidth * SANDBAG_FOOT_FRACTION,
    bagBottom,
  );
  ctx.lineTo(bagCentreX + bagWidth * SANDBAG_FOOT_FRACTION, bagBottom);
  ctx.quadraticCurveTo(
    bagCentreX + bagWidth / 2,
    bellyY,
    bagCentreX + bagWidth * SANDBAG_NECK_FRACTION,
    bagTop,
  );
  ctx.closePath();
  ctx.fillStyle = STRIPE_WHITE;
  ctx.fill();

  ctx.save();
  ctx.clip();
  paintCircusStripes(ctx, bagCentreX - bagWidth, bagTop, bagWidth * 2, bagHeight);
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.24);
  ctx.fillRect(bagCentreX - bagWidth, bellyY, bagWidth * 2, bagBottom - bellyY);
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(
    bagCentreX - bagWidth,
    bagTop,
    bagWidth * 2,
    Math.max(1, size * SANDBAG_TRIM_HEIGHT),
  );
  ctx.fillRect(
    bagCentreX - bagWidth,
    bagBottom - size * SANDBAG_TRIM_HEIGHT,
    bagWidth * 2,
    Math.max(1, size * SANDBAG_TRIM_HEIGHT),
  );
  ctx.restore();

  // The tie at the neck, which is what makes it a sack rather than a cushion.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(bagCentreX - bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.lineTo(bagCentreX + bagWidth * SANDBAG_NECK_FRACTION, bagTop);
  ctx.stroke();

  paintCracks(ctx, bagCentreX - bagWidth / 2, bagTop, bagWidth, bagHeight, size, state.integrity);
  paintSandLeak(ctx, bagCentreX, bagBottom, floorY, size, state.phase, stage);
  paintDonutHoop(ctx, x + size / 2, y + size / 2, size, strength);
  paintImpact(ctx, bagCentreX, bagTop + bagHeight / 2, size, state.struck);
  ctx.restore();
}

/** Vertical big-top stripes, laid over an already-white ground. */
function paintCircusStripes(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const stripeWidth = width / SANDBAG_STRIPE_COUNT;
  ctx.fillStyle = STRIPE_RED;
  for (let stripe = 0; stripe < SANDBAG_STRIPE_COUNT; stripe += 2) {
    ctx.fillRect(left + stripeWidth * stripe, top, stripeWidth, height);
  }
}

/** What is left once the bag gives: a spill of sand and an empty skin over it. */
function paintBurstSandbag(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  size: number,
  bagWidth: number,
): void {
  ctx.fillStyle = SAND;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    y + size * SANDBAG_FLOOR_Y,
    bagWidth * SANDBAG_BURST_SPILL_WIDTH,
    size * SANDBAG_BURST_SPILL_HEIGHT,
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.fillStyle = STRIPE_RED;
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    y + size * SANDBAG_BURST_SKIN_Y,
    bagWidth * SANDBAG_BURST_SKIN_WIDTH,
    size * SANDBAG_BURST_SKIN_HEIGHT,
    0,
    0,
    TAU,
  );
  ctx.fill();
}

const RING_RADIUS = 0.17;
const RING_WIDTH = 0.06;
const RING_TOP = 0.16;
const RING_SACK_WIDTH = 0.4;
const RING_SACK_HEIGHT = 0.4;
const RING_SACK_TOP = 0.34;
const RING_SLUMP_DROP = 0.09;
const RING_STRAP_WIDTH = 0.04;

/** The release ring: a striped ballast sack hung off a gold trip ring. */
export function drawMazeReleaseRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const stage = hitsLanded(state.integrity);
  const wear = stage / DAMAGE_STAGE_COUNT;
  const floorY = y + size * SANDBAG_FLOOR_Y;

  if (state.broken) {
    ctx.strokeStyle = GOLD_DEEP;
    ctx.lineWidth = Math.max(1, size * RING_WIDTH);
    ctx.beginPath();
    ctx.arc(centreX, y + size * (RING_TOP + RING_RADIUS), size * RING_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = SAND;
    ctx.beginPath();
    ctx.ellipse(centreX, floorY, size * RING_SACK_WIDTH, size * SAND_PILE_HEIGHT * 2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  const strength = pulseStrength(state.phase, state.pulsing);
  paintPulseHalo(ctx, centreX, y + size / 2, size, strength, GOLD_INK);

  const ringCentreY = y + size * (RING_TOP + RING_RADIUS);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(2, size * RING_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, ringCentreY, size * RING_RADIUS, 0, TAU);
  ctx.stroke();

  const sackTop = y + size * (RING_SACK_TOP + RING_SLUMP_DROP * wear);
  const sackWidth = size * RING_SACK_WIDTH * (1 + SANDBAG_SLUMP_SPREAD * wear);
  const sackHeight = size * RING_SACK_HEIGHT * (1 - SANDBAG_SLUMP_SPREAD * wear);

  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = Math.max(1, size * RING_STRAP_WIDTH);
  ctx.beginPath();
  ctx.moveTo(centreX, ringCentreY);
  ctx.lineTo(centreX, sackTop);
  ctx.stroke();

  ctx.fillStyle = STRIPE_WHITE;
  ctx.fillRect(centreX - sackWidth / 2, sackTop, sackWidth, sackHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(centreX - sackWidth / 2, sackTop, sackWidth, sackHeight);
  ctx.clip();
  paintCircusStripes(ctx, centreX - sackWidth / 2, sackTop, sackWidth, sackHeight);
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(1, size * SANDBAG_TRIM_HEIGHT);
  ctx.strokeRect(centreX - sackWidth / 2, sackTop, sackWidth, sackHeight);

  paintCracks(ctx, centreX - sackWidth / 2, sackTop, sackWidth, sackHeight, size, state.integrity);
  paintSandLeak(ctx, centreX, sackTop + sackHeight, floorY, size, state.phase, stage);
  paintDonutHoop(ctx, centreX, y + size / 2, size, strength);
  paintImpact(ctx, centreX, sackTop + sackHeight / 2, size, state.struck);
  ctx.restore();
}

const BELL_STAND_WIDTH = 0.16;
const BELL_STAND_TOP = 0.42;
const BELL_STAND_FOOT_WIDTH = 0.44;
const BELL_STAND_FOOT_HEIGHT = 0.08;
const BELL_RADIUS = 0.22;
const BELL_TOP = 0.18;
const BELL_LIP_HEIGHT = 0.06;
const BELL_CROWN_RADIUS = 0.05;
const BELL_SWING_RADIANS = 0.34;
const BELL_SWING_SPEED = 0.5;
const BELL_RING_ARC_COUNT = 3;
const BELL_RING_ARC_STEP = 0.09;
const BELL_HOLD_RING_RADIUS = 0.42;
const BELL_HOLD_RING_WIDTH = 0.07;
const BELL_COOLDOWN_ALPHA = 0.4;

/** The show bell: strike it and the act holds its breath for as long as it rings. */
export function drawMazeShowBell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeBellArt,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const strength = pulseStrength(state.phase, state.pulsing);
  if (!state.ready) ctx.globalAlpha = BELL_COOLDOWN_ALPHA;

  paintPulseHalo(ctx, centreX, y + size / 2, size, strength, GOLD_INK);

  ctx.fillStyle = STRIPE_RED;
  ctx.fillRect(
    centreX - (size * BELL_STAND_FOOT_WIDTH) / 2,
    y + size * (1 - BELL_STAND_FOOT_HEIGHT - 0.06),
    size * BELL_STAND_FOOT_WIDTH,
    size * BELL_STAND_FOOT_HEIGHT,
  );
  ctx.fillStyle = STRIPE_WHITE;
  ctx.fillRect(
    centreX - (size * BELL_STAND_WIDTH) / 2,
    y + size * BELL_STAND_TOP,
    size * BELL_STAND_WIDTH,
    size * (1 - BELL_STAND_TOP - 0.06),
  );
  ctx.fillStyle = STRIPE_RED;
  ctx.fillRect(
    centreX - (size * BELL_STAND_WIDTH) / 2,
    y + size * BELL_STAND_TOP,
    (size * BELL_STAND_WIDTH) / 2,
    size * (1 - BELL_STAND_TOP - 0.06),
  );

  const swing = state.holding ? Math.sin(state.phase * BELL_SWING_SPEED) * BELL_SWING_RADIANS : 0;
  const pivotY = y + size * BELL_TOP;
  ctx.save();
  ctx.translate(centreX, pivotY);
  ctx.rotate(swing);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(-size * BELL_RADIUS, size * BELL_RADIUS);
  ctx.quadraticCurveTo(-size * BELL_RADIUS, 0, 0, 0);
  ctx.quadraticCurveTo(size * BELL_RADIUS, 0, size * BELL_RADIUS, size * BELL_RADIUS);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(
    -size * BELL_RADIUS,
    size * BELL_RADIUS - size * BELL_LIP_HEIGHT,
    size * BELL_RADIUS * 2,
    size * BELL_LIP_HEIGHT,
  );
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(0, -size * BELL_CROWN_RADIUS, size * BELL_CROWN_RADIUS, 0, TAU);
  ctx.fill();
  ctx.restore();

  if (state.holding) {
    ctx.strokeStyle = inkRgba(LIMELIGHT_INK, 0.5);
    ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
    for (let arc = 0; arc < BELL_RING_ARC_COUNT; arc++) {
      const radius = size * (BELL_RADIUS + BELL_RING_ARC_STEP * (arc + 1));
      ctx.beginPath();
      ctx.arc(centreX, pivotY + (size * BELL_RADIUS) / 2, radius, -TAU / 4, TAU / 4);
      ctx.stroke();
    }
    // The remaining hold, drawn as an arc that empties clockwise: the stand is
    // the only thing in the act that tells a player how much time is left.
    const remaining = Math.max(0, Math.min(1, state.holdFraction));
    ctx.strokeStyle = inkRgba(GOLD_INK, 0.9);
    ctx.lineWidth = Math.max(2, size * BELL_HOLD_RING_WIDTH);
    ctx.beginPath();
    ctx.arc(
      centreX,
      y + size / 2,
      size * BELL_HOLD_RING_RADIUS,
      -TAU / 4,
      -TAU / 4 + TAU * remaining,
    );
    ctx.stroke();
  }

  paintDonutHoop(ctx, centreX, y + size / 2, size, strength);
  paintImpact(ctx, centreX, y + size * (BELL_TOP + BELL_RADIUS / 2), size, state.struck);
  ctx.restore();
}

// ── Carl's targets ────────────────────────────────────────────────────────────

const BRACE_WIDTH = 0.32;
const BRACE_HEIGHT = 0.8;
const BRACE_TOP = 0.12;
const BRACE_STRUT_HEIGHT = 0.16;
const BRACE_STRUT_LENGTH = 0.4;
const BRACE_BAND_HEIGHT = 0.13;
const BRACE_BAND_Y = 0.3;
const BRACE_STRAP_HEIGHT = 0.05;
/** How far a fully worked timber leans off plumb before it finally gives. */
const BRACE_MAX_LEAN_RADIANS = 0.2;
/** One bite out of the timber per landed blow. */
const BRACE_CHUNK_DEPTH = 0.13;
const BRACE_CHUNK_HEIGHT = 0.11;
const BRACE_RUBBLE_HEIGHT = 0.14;
const BRACE_RUBBLE_WIDTH = 1.6;
const BRACE_RUBBLE_Y = 0.78;
const NAIL_RADIUS = 0.035;

/** The load-bearing brace: a painted timber driven through the wall, strutted at its foot. */
export function drawMazeBrace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  ctx.save();
  const wallDirection = wallDirectionFor(state.facing);
  const braceWidth = size * BRACE_WIDTH;
  const braceX = x + size / 2 - braceWidth / 2 + (wallDirection * size * BRACE_WIDTH) / 2;
  const braceY = y + size * BRACE_TOP;
  const braceHeight = size * BRACE_HEIGHT;
  const footY = braceY + braceHeight;

  if (state.broken) {
    ctx.fillStyle = TIMBER_DARK;
    ctx.fillRect(
      braceX - braceWidth * 0.3,
      y + size * BRACE_RUBBLE_Y,
      braceWidth * BRACE_RUBBLE_WIDTH,
      size * BRACE_RUBBLE_HEIGHT,
    );
    ctx.fillStyle = CIRCUS_BLUE;
    ctx.fillRect(braceX, y + size * BRACE_RUBBLE_Y, braceWidth, (size * BRACE_RUBBLE_HEIGHT) / 2);
    ctx.restore();
    return;
  }

  const strength = pulseStrength(state.phase, state.pulsing);
  paintPulseHalo(ctx, x + size / 2, y + size / 2, size, strength, BRASS_LIGHT_INK);

  const stage = hitsLanded(state.integrity);
  const lean = (BRACE_MAX_LEAN_RADIANS * stage) / DAMAGE_STAGE_COUNT;

  ctx.save();
  // A worked timber leans away from the crawler hitting it, pivoting on its foot.
  ctx.translate(braceX + braceWidth / 2, footY);
  ctx.rotate(lean * wallDirection);
  ctx.translate(-(braceX + braceWidth / 2), -footY);

  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(braceX, braceY, braceWidth, braceHeight);
  ctx.fillStyle = TIMBER_LIGHT;
  ctx.fillRect(braceX, braceY, braceWidth * 0.34, braceHeight);
  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(braceX + braceWidth * 0.78, braceY, braceWidth * 0.22, braceHeight);

  ctx.fillStyle = CIRCUS_BLUE;
  ctx.fillRect(braceX, braceY + size * BRACE_BAND_Y, braceWidth, size * BRACE_BAND_HEIGHT);
  ctx.fillStyle = BLUE_LIGHT;
  ctx.fillRect(braceX, braceY + size * BRACE_BAND_Y, braceWidth, (size * BRACE_BAND_HEIGHT) / 3);
  ctx.fillStyle = BRASS;
  ctx.fillRect(braceX, braceY + braceHeight * 0.66, braceWidth, size * BRACE_STRAP_HEIGHT);
  ctx.fillRect(braceX, braceY + braceHeight * 0.12, braceWidth, size * BRACE_STRAP_HEIGHT);

  // The strut into the wall, which is what makes the timber read as holding
  // something up rather than merely standing there.
  const strutY = footY - size * BRACE_STRUT_HEIGHT;
  const strutLength = size * BRACE_STRUT_LENGTH;
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(
    wallDirection > 0 ? braceX + braceWidth : braceX - strutLength,
    strutY,
    strutLength,
    size * BRACE_STRUT_HEIGHT,
  );

  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(braceX + braceWidth / 2, braceY + braceHeight * 0.2, size * NAIL_RADIUS, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(braceX + braceWidth / 2, braceY + braceHeight * 0.7, size * NAIL_RADIUS, 0, TAU);
  ctx.fill();

  paintBraceChunks(ctx, braceX, braceY, braceWidth, braceHeight, size, stage, wallDirection);
  paintCracks(ctx, braceX, braceY, braceWidth, braceHeight, size, state.integrity);
  ctx.restore();

  paintCarlChevrons(ctx, x + size / 2, y + size / 2, size, state.facing, strength);
  paintImpact(
    ctx,
    braceX + braceWidth / 2,
    braceY + braceHeight / 2,
    size,
    state.struck,
    BRACE_WIDTH,
  );
  ctx.restore();
}

/** One bite out of the strike face per landed blow, plus the splinters under it. */
function paintBraceChunks(
  ctx: CanvasRenderingContext2D,
  braceX: number,
  braceY: number,
  braceWidth: number,
  braceHeight: number,
  size: number,
  stage: number,
  wallDirection: number,
): void {
  if (stage <= 0) return;
  const strikeEdge = wallDirection > 0 ? braceX : braceX + braceWidth;
  const inward = wallDirection > 0 ? 1 : -1;
  for (let chunk = 0; chunk < stage; chunk++) {
    const chunkY = braceY + braceHeight * (0.24 + 0.24 * chunk);
    const depth = size * BRACE_CHUNK_DEPTH * (0.7 + hashUnit(chunk, chunk) * 0.6);
    const height = size * BRACE_CHUNK_HEIGHT;
    ctx.fillStyle = CRACK_COLOR;
    ctx.beginPath();
    ctx.moveTo(strikeEdge, chunkY);
    ctx.lineTo(strikeEdge + inward * depth, chunkY + height / 2);
    ctx.lineTo(strikeEdge, chunkY + height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = TIMBER_LIGHT;
    ctx.fillRect(
      strikeEdge + inward * depth,
      chunkY + height / 2,
      inward * Math.max(1, size * SAND_GRAIN_SIZE),
      Math.max(1, size * SAND_GRAIN_SIZE),
    );
  }
}

const CAPSTAN_BASE_WIDTH = 0.72;
const CAPSTAN_BASE_HEIGHT = 0.18;
const CAPSTAN_BASE_Y = 0.74;
const CAPSTAN_DRUM_RADIUS = 0.28;
const CAPSTAN_DRUM_CENTRE_Y = 0.48;
const CAPSTAN_SPOKE_COUNT = 6;
const CAPSTAN_SPOKE_WIDTH = 0.045;
const CAPSTAN_HUB_RADIUS = 0.07;
/** How far the drum turns for each blow that lands on it. */
const CAPSTAN_NOTCH_TURN_RADIANS = TAU / 12;
const CAPSTAN_NOTCH_LENGTH = 0.1;
const CAPSTAN_NOTCH_WIDTH = 0.07;
const CAPSTAN_NOTCH_ARC = TAU / 8;
const CAPSTAN_ROPE_TURNS = 2;
const CAPSTAN_ROPE_STEP = 0.05;

/** The capstan: a brass drum on a timber bed, turned a notch by every blow. */
export function drawMazeCapstan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const drumY = y + size * CAPSTAN_DRUM_CENTRE_Y;
  const radius = size * CAPSTAN_DRUM_RADIUS;
  const stage = hitsLanded(state.integrity);

  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(
    centreX - (size * CAPSTAN_BASE_WIDTH) / 2,
    y + size * CAPSTAN_BASE_Y,
    size * CAPSTAN_BASE_WIDTH,
    size * CAPSTAN_BASE_HEIGHT,
  );
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(
    centreX - (size * CAPSTAN_BASE_WIDTH) / 2,
    y + size * CAPSTAN_BASE_Y,
    size * CAPSTAN_BASE_WIDTH,
    (size * CAPSTAN_BASE_HEIGHT) / 2,
  );

  if (state.broken) {
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    ctx.ellipse(centreX, y + size * CAPSTAN_BASE_Y, radius, radius / 3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  const strength = pulseStrength(state.phase, state.pulsing);
  paintPulseHalo(ctx, centreX, y + size / 2, size, strength, BRASS_LIGHT_INK);

  const turn = stage * CAPSTAN_NOTCH_TURN_RADIANS;
  ctx.save();
  ctx.translate(centreX, drumY);
  ctx.rotate(turn);

  ctx.fillStyle = CIRCUS_BLUE;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.82, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = Math.max(1, size * CAPSTAN_SPOKE_WIDTH);
  for (let spoke = 0; spoke < CAPSTAN_SPOKE_COUNT; spoke++) {
    const angle = (TAU / CAPSTAN_SPOKE_COUNT) * spoke;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.3, Math.sin(angle) * radius * 0.3);
    ctx.lineTo(Math.cos(angle) * radius * 0.78, Math.sin(angle) * radius * 0.78);
    ctx.stroke();
  }

  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, (size * ROPE_WIDTH) / 2);
  for (let coil = 0; coil < CAPSTAN_ROPE_TURNS; coil++) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.82 - size * CAPSTAN_ROPE_STEP * coil, 0, TAU);
    ctx.stroke();
  }

  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(0, 0, size * CAPSTAN_HUB_RADIUS, 0, TAU);
  ctx.fill();

  // One notch cut into the rim per blow — the count of work already done, which
  // a turning drum alone cannot show once it has come back round.
  ctx.strokeStyle = CRACK_COLOR;
  ctx.lineWidth = Math.max(2, size * CAPSTAN_NOTCH_WIDTH);
  for (let notch = 0; notch < stage; notch++) {
    const angle = -TAU / 4 + CAPSTAN_NOTCH_ARC * notch;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(
      Math.cos(angle) * (radius - size * CAPSTAN_NOTCH_LENGTH),
      Math.sin(angle) * (radius - size * CAPSTAN_NOTCH_LENGTH),
    );
    ctx.stroke();
  }
  ctx.restore();

  paintCarlChevrons(ctx, centreX, drumY, size, state.facing, strength);
  paintImpact(ctx, centreX, drumY, size, state.struck, CAPSTAN_DRUM_RADIUS);
  ctx.restore();
}

// ── Mirrors ───────────────────────────────────────────────────────────────────

const MIRROR_PLATE_LENGTH = 0.86;
const MIRROR_PLATE_THICKNESS = 0.14;
const MIRROR_GLASS_THICKNESS = 0.07;
const MIRROR_POST_RADIUS = 0.07;
const MIRROR_GLINT_SPEED = 0.031;
const MIRROR_GLINT_LENGTH = 0.2;
const MIRROR_TURN_ARC_RADIUS = 0.4;
const MIRROR_TURN_ARC_SWEEP = TAU / 6;

/**
 * Which way a facing's diagonal runs, in radians.
 *
 * A facing names the two tile edges the glass connects, so NE and SW both cut
 * the tile on the down-right diagonal and NW and SE both cut it on the up-right
 * one — the difference between the pair is which side of the plate is glass.
 */
function mirrorPlateAngle(facing: MirrorFacing): number {
  return facing === 'NE' || facing === 'SW' ? Math.PI / 4 : -Math.PI / 4;
}

/** The unit vector out of the reflective face, toward the corner the facing names. */
function mirrorFaceNormal(facing: MirrorFacing): { readonly nx: number; readonly ny: number } {
  const diagonal = Math.SQRT1_2;
  if (facing === 'NE') return { nx: diagonal, ny: -diagonal };
  if (facing === 'SE') return { nx: diagonal, ny: diagonal };
  if (facing === 'SW') return { nx: -diagonal, ny: diagonal };
  return { nx: -diagonal, ny: -diagonal };
}

/** A steerable mirror, drawn as a plate with a glass face and a dead back. */
export function drawMazeMirror(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeMirrorArt,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const donutOwned = state.kind === 'swivel_mirror';
  const frameInk = donutOwned ? GOLD_INK : BRASS_LIGHT_INK;
  const backColor = donutOwned ? STRIPE_RED : CIRCUS_BLUE;
  const strength = pulseStrength(state.phase, state.pulsing);

  paintPulseHalo(ctx, centreX, centreY, size, strength, frameInk);

  ctx.fillStyle = donutOwned ? GOLD_DEEP : TIMBER_DARK;
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * MIRROR_POST_RADIUS, 0, TAU);
  ctx.fill();

  const angle = mirrorPlateAngle(state.facing);
  const normal = mirrorFaceNormal(state.facing);
  const halfLength = (size * MIRROR_PLATE_LENGTH) / 2;
  const thickness = size * MIRROR_PLATE_THICKNESS;

  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.rotate(angle);
  ctx.fillStyle = backColor;
  ctx.fillRect(-halfLength, -thickness / 2, halfLength * 2, thickness);
  ctx.fillStyle = inkRgba(frameInk, 1);
  ctx.fillRect(-halfLength, -thickness / 2, halfLength * 2, Math.max(1, thickness * 0.25));
  ctx.restore();

  // The glass itself is offset a hair onto the reflective side, so which face
  // answers a beam is readable without turning the tile over in your head.
  const glassOffset = thickness * 0.45;
  ctx.save();
  ctx.translate(centreX + normal.nx * glassOffset, centreY + normal.ny * glassOffset);
  ctx.rotate(angle);
  ctx.fillStyle = inkRgba(GLASS_INK, 0.9);
  ctx.fillRect(
    -halfLength,
    (-size * MIRROR_GLASS_THICKNESS) / 2,
    halfLength * 2,
    size * MIRROR_GLASS_THICKNESS,
  );

  const glint = ((state.phase * MIRROR_GLINT_SPEED) % 1) * 2 - 1;
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, 0.75);
  ctx.fillRect(
    glint * halfLength,
    (-size * MIRROR_GLASS_THICKNESS) / 2,
    size * MIRROR_GLINT_LENGTH,
    size * MIRROR_GLASS_THICKNESS,
  );
  ctx.restore();

  if (state.turning) {
    ctx.strokeStyle = inkRgba(LIMELIGHT_INK, 0.7);
    ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
    ctx.beginPath();
    ctx.arc(centreX, centreY, size * MIRROR_TURN_ARC_RADIUS, angle, angle + MIRROR_TURN_ARC_SWEEP);
    ctx.stroke();
  }

  paintImpact(ctx, centreX, centreY, size, state.struck);
  ctx.restore();
}

// ── Barriers and architecture ─────────────────────────────────────────────────

const GRATE_BAR_COUNT = 5;
const GRATE_INSET = 0.2;
const GRATE_BAR_WIDTH = 0.06;
const MASONRY_COURSE_COUNT = 4;
const MASONRY_JOINT_WIDTH = 0.02;

/**
 * The permanent grate in the dividing wall: iron behind a masonry surround.
 *
 * The surround is what separates it from the gate and the vent grille at a
 * glance. All three are grey holes in a wall otherwise; only this one is part of
 * the building, and a player who reads it as machinery waits for it to open.
 */
export function drawMazeGrate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = MASONRY;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = MASONRY_SHADE;
  const courseHeight = size / MASONRY_COURSE_COUNT;
  for (let course = 0; course < MASONRY_COURSE_COUNT; course++) {
    ctx.fillRect(x, y + courseHeight * course, size, Math.max(1, size * MASONRY_JOINT_WIDTH));
    // Staggered head joints, so the surround reads as coursed stone rather than
    // as a set of stacked shelves.
    const joint = course % 2 === 0 ? size * 0.35 : size * 0.65;
    ctx.fillRect(
      x + joint,
      y + courseHeight * course,
      Math.max(1, size * MASONRY_JOINT_WIDTH),
      courseHeight,
    );
  }

  const inset = size * GRATE_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x + inset, y + inset, span, span);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * GRATE_BAR_WIDTH;
  for (let bar = 0; bar < GRATE_BAR_COUNT; bar++) {
    const bx = x + inset + (span / GRATE_BAR_COUNT) * bar + (span / GRATE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + inset, barWidth, span);
  }
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}

const GATE_BAR_COUNT = 4;
const GATE_BAR_WIDTH = 0.09;
const GATE_RAIL_HEIGHT = 0.09;
const GATE_ROPE_X = 0.12;
const GATE_PULLEY_RADIUS = 0.09;
const GATE_PULLEY_Y = 0.1;
const GATE_WEIGHT_WIDTH = 0.16;
const GATE_WEIGHT_HEIGHT = 0.22;
const GATE_WEIGHT_Y = 0.52;

/**
 * A counterweighted gate, drawn shut. Nothing draws it open — it stops existing.
 *
 * The rope, pulley and hanging weight are the whole point of the drawing: a
 * player has to believe this particular wall is a thing that lifts, and bars
 * alone say only "you cannot pass here".
 */
export function drawMazeGate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * GATE_BAR_WIDTH;
  for (let bar = 0; bar < GATE_BAR_COUNT; bar++) {
    const bx = x + (size / GATE_BAR_COUNT) * bar + (size / GATE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y, barWidth, size);
  }
  const railHeight = size * GATE_RAIL_HEIGHT;
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y + size * 0.2, size, railHeight);
  ctx.fillRect(x, y + size * 0.72, size, railHeight);

  const ropeX = x + size * GATE_ROPE_X;
  const pulleyY = y + size * GATE_PULLEY_Y;
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(ropeX, pulleyY, size * GATE_PULLEY_RADIUS, 0, TAU);
  ctx.fill();
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(ropeX, pulleyY, size * GATE_PULLEY_RADIUS * 0.4, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH * 0.7);
  ctx.beginPath();
  ctx.moveTo(ropeX, y);
  ctx.lineTo(ropeX, pulleyY);
  ctx.moveTo(ropeX + size * GATE_PULLEY_RADIUS, pulleyY);
  ctx.lineTo(ropeX + size * GATE_PULLEY_RADIUS, y + size * GATE_WEIGHT_Y);
  ctx.stroke();

  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(
    ropeX + size * GATE_PULLEY_RADIUS - (size * GATE_WEIGHT_WIDTH) / 2,
    y + size * GATE_WEIGHT_Y,
    size * GATE_WEIGHT_WIDTH,
    size * GATE_WEIGHT_HEIGHT,
  );
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(
    ropeX + size * GATE_PULLEY_RADIUS - (size * GATE_WEIGHT_WIDTH) / 2,
    y + size * GATE_WEIGHT_Y,
    size * GATE_WEIGHT_WIDTH,
    Math.max(1, size * MASONRY_JOINT_WIDTH * 2),
  );
  ctx.restore();
}

const BARRICADE_PLANK_COUNT = 4;
const BARRICADE_PLANK_GAP = 0.03;

/** A boarded barricade, drawn shut. */
export function drawMazeBarricade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(x, y, size, size);
  const plankHeight = size / BARRICADE_PLANK_COUNT;
  for (let plank = 0; plank < BARRICADE_PLANK_COUNT; plank++) {
    ctx.fillStyle = plank % 2 === 0 ? TIMBER_MID : TIMBER_LIGHT;
    ctx.fillRect(
      x,
      y + plankHeight * plank + size * BARRICADE_PLANK_GAP,
      size,
      plankHeight - size * BARRICADE_PLANK_GAP * 2,
    );
    ctx.fillStyle = BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(x + size * 0.18, y + plankHeight * (plank + 0.5), size * NAIL_RADIUS, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + size * 0.82, y + plankHeight * (plank + 0.5), size * NAIL_RADIUS, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const CAGE_BAR_COUNT = 6;
const CAGE_BAR_WIDTH = 0.05;
const CAGE_FRAME_WIDTH = 0.09;
const CAGE_SHADOW_RADIUS = 0.26;
const CAGE_SHADOW_SPEED = 0.017;
const CAGE_SHADOW_TRAVEL = 0.22;
const CAGE_STRAW_COUNT = 6;
const CAGE_STRAW_HEIGHT = 0.1;

/** A menagerie cage gate: bars, and something behind them that has not stopped moving. */
export function drawMazeCageGate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.92);
  ctx.fillRect(x, y, size, size);

  const drift = Math.sin(phase * CAGE_SHADOW_SPEED) * size * CAGE_SHADOW_TRAVEL;
  ctx.fillStyle = inkRgba(CORPSE_INK, 0.7);
  ctx.beginPath();
  ctx.arc(x + size / 2 + drift, y + size * 0.55, size * CAGE_SHADOW_RADIUS, 0, TAU);
  ctx.fill();

  ctx.fillStyle = IRON_MID;
  const barWidth = size * CAGE_BAR_WIDTH;
  for (let bar = 0; bar < CAGE_BAR_COUNT; bar++) {
    const bx = x + (size / CAGE_BAR_COUNT) * bar + (size / CAGE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y, barWidth, size);
  }
  ctx.fillStyle = IRON_DARK;
  const frame = size * CAGE_FRAME_WIDTH;
  ctx.fillRect(x, y, size, frame);
  ctx.fillRect(x, y + size - frame, size, frame);
  ctx.fillRect(x, y, frame, size);
  ctx.fillRect(x + size - frame, y, frame, size);
  ctx.fillStyle = STRIPE_RED;
  ctx.fillRect(x, y, size, Math.max(1, frame * 0.35));

  ctx.strokeStyle = STRAW;
  ctx.lineWidth = 1;
  for (let straw = 0; straw < CAGE_STRAW_COUNT; straw++) {
    const sx = x + size * hashUnit(straw, straw);
    const tilt = (hashUnit(straw, -straw) - 0.5) * size * CAGE_STRAW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(sx, y + size - frame);
    ctx.lineTo(sx + tilt, y + size - frame - size * CAGE_STRAW_HEIGHT);
    ctx.stroke();
  }
  ctx.restore();
}

const CURTAIN_FOLD_COUNT = 5;
const CURTAIN_SWAY_SPEED = 0.021;
const CURTAIN_SWAY_TILES = 0.03;
const CURTAIN_FRINGE_HEIGHT = 0.1;
const CURTAIN_TASSEL_COUNT = 5;
const CURTAIN_TASSEL_RADIUS = 0.035;

/** The velvet drape between acts: heavy, gold-fringed, never quite still. */
export function drawMazeCurtain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = VELVET;
  ctx.fillRect(x, y, size, size);
  const foldWidth = size / CURTAIN_FOLD_COUNT;
  ctx.fillStyle = VELVET_SHADE;
  for (let fold = 0; fold < CURTAIN_FOLD_COUNT; fold++) {
    const sway = Math.sin(phase * CURTAIN_SWAY_SPEED + fold) * size * CURTAIN_SWAY_TILES;
    ctx.beginPath();
    ctx.moveTo(x + foldWidth * fold, y);
    ctx.lineTo(x + foldWidth * fold + sway, y + size);
    ctx.lineTo(x + foldWidth * fold + sway + foldWidth * 0.4, y + size);
    ctx.lineTo(x + foldWidth * fold + foldWidth * 0.4, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, y, size, size * CURTAIN_FRINGE_HEIGHT);
  ctx.fillStyle = GOLD_DEEP;
  for (let tassel = 0; tassel < CURTAIN_TASSEL_COUNT; tassel++) {
    const tx = x + (size / CURTAIN_TASSEL_COUNT) * (tassel + 0.5);
    ctx.beginPath();
    ctx.arc(tx, y + size * CURTAIN_FRINGE_HEIGHT, size * CURTAIN_TASSEL_RADIUS, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ── Everything the party has already opened ───────────────────────────────────

/**
 * How an opened way currently looks.
 *
 * `flare` is 1 on the frame it opened and falls to 0 over the next few seconds.
 * It exists because the crawler who opens a door is standing at the *other*
 * crawler's wall: the moment of opening is watched from the wrong side of the
 * tent, so the tile has to shout once and then go on quietly saying it forever.
 */
export interface MazeWayOpenArt {
  readonly phase: number;
  readonly flare: number;
}

/**
 * Every barrier in the tent opens a north–south passage, and the art leans on it
 * hard: the jambs are drawn on the east and west edges and the chevrons point
 * the way the party is walking. Asserted by the maze's own gate.
 */
const WAY_JAMB_WIDTH = 0.14;
const WAY_HEADER_HEIGHT = 0.16;
const WAY_LEAF_BAR_COUNT = 4;
const WAY_LEAF_BAR_WIDTH = 0.06;
const WAY_LEAF_DROP = 0.1;
const WAY_ROPE_SLACK = 0.06;
/** The threshold light, brightest at the far edge the party is walking toward. */
const WAY_THRESHOLD_NEAR_ALPHA = 0.12;
const WAY_THRESHOLD_FAR_ALPHA = 0.62;
const WAY_GLOW_ALPHA = 0.34;
const WAY_CHEVRON_COUNT = 2;
const WAY_CHEVRON_WIDTH = 0.24;
const WAY_CHEVRON_HEIGHT = 0.12;
const WAY_CHEVRON_SPACING = 0.22;
const WAY_CHEVRON_BASE_Y = 0.74;
const WAY_CHEVRON_ALPHA = 0.95;
const WAY_CHEVRON_WIDTH_SCALE = 0.09;
/** How far the chevrons drift up their own tile, and how fast. */
const WAY_CHEVRON_DRIFT = 0.1;
const WAY_CHEVRON_DRIFT_SPEED = 0.045;
const WAY_FLARE_RING_WIDTH = 0.08;
const WAY_FLARE_RING_RADIUS = 0.9;
const WAY_FLARE_WASH_ALPHA = 0.55;

/**
 * The green "go" chevrons an opened way wears, pointing north.
 *
 * The one moving thing on an otherwise static tile, because a doorway that has
 * been open for a minute still has to out-read a wall of identical cage fronts
 * from across a lane.
 */
function paintWayChevrons(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
  alpha: number,
): void {
  const drift = ((phase * WAY_CHEVRON_DRIFT_SPEED) % 1) * size * WAY_CHEVRON_DRIFT;
  ctx.save();
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, alpha);
  ctx.lineWidth = Math.max(1, size * WAY_CHEVRON_WIDTH_SCALE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const centreX = x + size / 2;
  const half = (size * WAY_CHEVRON_WIDTH) / 2;
  for (let chevron = 0; chevron < WAY_CHEVRON_COUNT; chevron++) {
    const baseY = y + size * (WAY_CHEVRON_BASE_Y - WAY_CHEVRON_SPACING * chevron) - drift;
    ctx.beginPath();
    ctx.moveTo(centreX - half, baseY);
    ctx.lineTo(centreX, baseY - size * WAY_CHEVRON_HEIGHT);
    ctx.lineTo(centreX + half, baseY);
    ctx.stroke();
  }
  ctx.restore();
}

/** The wash and the ring a way throws on the frames right after it opens. */
function paintWayFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  flare: number,
): void {
  if (flare <= 0) return;
  ctx.save();
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, WAY_FLARE_WASH_ALPHA * flare);
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, flare);
  ctx.lineWidth = Math.max(1, size * WAY_FLARE_RING_WIDTH);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * WAY_FLARE_RING_RADIUS * (1 - flare), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * A barrier the party has opened: the leaf hauled up into the header, the jambs
 * left standing, and the floor between them marked as somewhere to walk.
 *
 * Nothing used to be drawn here at all — the tile simply stopped being a gate.
 * In the fire walk's narrow corridors that read as open ground; in the menagerie
 * it left a one-tile doorway in a wall of identical cage fronts, and playtesters
 * walked past their own opened cage because the wall around it had not changed.
 */
export function drawMazeWayOpen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeWayOpenArt,
): void {
  ctx.save();
  const jamb = size * WAY_JAMB_WIDTH;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, jamb, size);
  ctx.fillRect(x + size - jamb, y, jamb, size);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, jamb, size * WAY_HEADER_HEIGHT);
  ctx.fillRect(x + size - jamb, y, jamb, size * WAY_HEADER_HEIGHT);

  const header = size * WAY_HEADER_HEIGHT;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x, y, size, header);
  ctx.fillStyle = IRON_MID;
  const barWidth = size * WAY_LEAF_BAR_WIDTH;
  for (let bar = 0; bar < WAY_LEAF_BAR_COUNT; bar++) {
    const bx = x + (size / WAY_LEAF_BAR_COUNT) * bar + (size / WAY_LEAF_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + header, barWidth, size * WAY_LEAF_DROP);
  }

  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = Math.max(1, size * ROPE_WIDTH * 0.7);
  ctx.beginPath();
  ctx.moveTo(x + jamb, y + header);
  ctx.quadraticCurveTo(
    x + size / 2,
    y + header + size * WAY_ROPE_SLACK,
    x + size - jamb,
    y + header,
  );
  ctx.stroke();

  // Light spilling through from the far side, then the tent's own "go" green
  // over it. Both are needed: the brightness is what separates a doorway from
  // the wall it is cut into, and the green is what says whose doing it was.
  const openingX = x + jamb;
  const openingY = y + header;
  const openingWidth = size - jamb * 2;
  const openingHeight = size - header;
  const threshold = ctx.createLinearGradient(0, y + size, 0, openingY);
  threshold.addColorStop(0, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_NEAR_ALPHA));
  threshold.addColorStop(1, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_FAR_ALPHA));
  ctx.fillStyle = threshold;
  ctx.fillRect(openingX, openingY, openingWidth, openingHeight);
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, WAY_GLOW_ALPHA);
  ctx.fillRect(openingX, openingY, openingWidth, openingHeight);

  paintWayChevrons(ctx, x, y, size, state.phase, WAY_CHEVRON_ALPHA);
  paintWayFlare(ctx, x, y, size, state.flare);
  ctx.restore();
}

const OPEN_CURTAIN_GATHER_WIDTH = 0.3;
const OPEN_CURTAIN_FOLD_COUNT = 3;
const OPEN_CURTAIN_TIEBACK_Y = 0.5;
const OPEN_CURTAIN_TIEBACK_HEIGHT = 0.12;
const OPEN_CURTAIN_GAP_ALPHA = 0.55;

/**
 * The interval curtain, drawn hauled back to both jambs.
 *
 * Same reason as the gate above: an opened curtain that simply stopped being
 * drawn left an arch that looked exactly like the one still holding a drape,
 * and players stood in front of a way that had been open for a minute.
 */
export function drawMazeCurtainOpen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeWayOpenArt,
): void {
  ctx.save();
  const gather = size * OPEN_CURTAIN_GATHER_WIDTH;
  const gapX = x + gather;
  const gapWidth = size - gather * 2;
  ctx.fillStyle = inkRgba(SHADOW_INK, OPEN_CURTAIN_GAP_ALPHA);
  ctx.fillRect(gapX, y, gapWidth, size);
  const threshold = ctx.createLinearGradient(0, y + size, 0, y);
  threshold.addColorStop(0, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_NEAR_ALPHA));
  threshold.addColorStop(1, inkRgba(LIMELIGHT_INK, WAY_THRESHOLD_FAR_ALPHA));
  ctx.fillStyle = threshold;
  ctx.fillRect(gapX, y, gapWidth, size);
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, WAY_GLOW_ALPHA);
  ctx.fillRect(gapX, y, gapWidth, size);

  for (const gatherX of [x, x + size - gather]) {
    ctx.fillStyle = VELVET;
    ctx.fillRect(gatherX, y, gather, size);
    ctx.fillStyle = VELVET_SHADE;
    const foldWidth = gather / OPEN_CURTAIN_FOLD_COUNT;
    for (let fold = 0; fold < OPEN_CURTAIN_FOLD_COUNT; fold += 2) {
      ctx.fillRect(gatherX + foldWidth * fold, y, foldWidth, size);
    }
    ctx.fillStyle = GOLD;
    ctx.fillRect(
      gatherX,
      y + size * OPEN_CURTAIN_TIEBACK_Y,
      gather,
      size * OPEN_CURTAIN_TIEBACK_HEIGHT,
    );
    ctx.fillStyle = GOLD_DEEP;
    ctx.beginPath();
    ctx.arc(
      gatherX + gather / 2,
      y + size * (OPEN_CURTAIN_TIEBACK_Y + OPEN_CURTAIN_TIEBACK_HEIGHT),
      size * CURTAIN_TASSEL_RADIUS,
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.fillStyle = GOLD;
  ctx.fillRect(x, y, size, size * CURTAIN_FRINGE_HEIGHT);

  paintWayChevrons(ctx, x, y, size, state.phase, WAY_CHEVRON_ALPHA);
  paintWayFlare(ctx, x, y, size, state.flare);
  ctx.restore();
}

const WINDOW_INSET = 0.18;
const WINDOW_BAR_COUNT = 3;
const WINDOW_BAR_WIDTH = 0.05;
const WINDOW_SILL_HEIGHT = 0.08;

/** The barred window between the paired curtain rooms — a sightline, never a door. */
export function drawMazeCurtainWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = MASONRY;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = MASONRY_SHADE;
  ctx.fillRect(x, y + size * (1 - WINDOW_SILL_HEIGHT), size, size * WINDOW_SILL_HEIGHT);

  const inset = size * WINDOW_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.85);
  ctx.fillRect(x + inset, y + inset, span, span);
  ctx.fillStyle = inkRgba(GLASS_INK, 0.18);
  ctx.fillRect(x + inset, y + inset, span, span * 0.4);

  ctx.fillStyle = IRON_LIGHT;
  const barWidth = size * WINDOW_BAR_WIDTH;
  for (let bar = 0; bar < WINDOW_BAR_COUNT; bar++) {
    const bx =
      x + inset + (span / WINDOW_BAR_COUNT) * bar + (span / WINDOW_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + inset, barWidth, span);
  }
  ctx.strokeStyle = IRON_DARK;
  ctx.lineWidth = Math.max(1, size * WINDOW_BAR_WIDTH);
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}

const ACT_GATE_POST_WIDTH = 0.18;
const ACT_GATE_STRIPE_COUNT = 6;
const ACT_GATE_BANNER_HEIGHT = 0.26;
const ACT_GATE_BANNER_SAG = 0.08;
const ACT_GATE_RIPPLE_SPEED = 0.033;

/** The arch that closes an act: two striped posts under a sagging banner. */
export function drawMazeActGate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.55);
  ctx.fillRect(x, y, size, size);

  const postWidth = size * ACT_GATE_POST_WIDTH;
  paintStripedPost(ctx, x, y, postWidth, size, ACT_GATE_STRIPE_COUNT);
  paintStripedPost(ctx, x + size - postWidth, y, postWidth, size, ACT_GATE_STRIPE_COUNT);

  const sag = size * ACT_GATE_BANNER_SAG * (1 + Math.sin(phase * ACT_GATE_RIPPLE_SPEED));
  ctx.fillStyle = STRIPE_RED;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + size / 2, y + sag, x + size, y);
  ctx.lineTo(x + size, y + size * ACT_GATE_BANNER_HEIGHT);
  ctx.quadraticCurveTo(
    x + size / 2,
    y + size * ACT_GATE_BANNER_HEIGHT + sag,
    x,
    y + size * ACT_GATE_BANNER_HEIGHT,
  );
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(
    x,
    y + size * ACT_GATE_BANNER_HEIGHT,
    size,
    Math.max(1, size * MASONRY_JOINT_WIDTH * 2),
  );
  ctx.restore();
}

/** A red-and-white barber's post, used by the act arches and the trail posts alike. */
function paintStripedPost(
  ctx: CanvasRenderingContext2D,
  postX: number,
  postY: number,
  width: number,
  height: number,
  stripeCount: number,
): void {
  ctx.fillStyle = STRIPE_WHITE;
  ctx.fillRect(postX, postY, width, height);
  ctx.fillStyle = STRIPE_RED;
  const stripeHeight = height / stripeCount;
  for (let stripe = 0; stripe < stripeCount; stripe += 2) {
    ctx.fillRect(postX, postY + stripeHeight * stripe, width, stripeHeight);
  }
  ctx.fillStyle = GOLD_DEEP;
  ctx.fillRect(postX, postY, Math.max(1, width * 0.2), height);
}

const EXIT_DOOR_INSET = 0.1;
const EXIT_DOOR_PANEL_INSET = 0.2;
const EXIT_LAMP_RADIUS = 0.1;
const EXIT_LAMP_Y = 0.16;
const EXIT_LAMP_PULSE_SPEED = 0.05;
const EXIT_LAMP_GLOW_RINGS = 3;
const EXIT_HANDLE_RADIUS = 0.05;

/** The way out of an act: a timber door under a lamp that is always lit. */
export function drawMazeExitDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  ctx.fillStyle = MASONRY_SHADE;
  ctx.fillRect(x, y, size, size);
  const inset = size * EXIT_DOOR_INSET;
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset);
  ctx.fillStyle = TIMBER_DARK;
  const panelInset = size * EXIT_DOOR_PANEL_INSET;
  ctx.fillRect(x + panelInset, y + panelInset, size - panelInset * 2, size - panelInset);
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(x + size * (1 - EXIT_DOOR_PANEL_INSET), y + size / 2, size * EXIT_HANDLE_RADIUS, 0, TAU);
  ctx.fill();

  const glow = 0.6 + 0.4 * Math.sin(phase * EXIT_LAMP_PULSE_SPEED);
  const lampX = x + size / 2;
  const lampY = y + size * EXIT_LAMP_Y;
  for (let ring = EXIT_LAMP_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, (0.18 * glow) / ring);
    ctx.beginPath();
    ctx.arc(lampX, lampY, size * EXIT_LAMP_RADIUS * (1 + ring), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = LIMELIGHT;
  ctx.beginPath();
  ctx.arc(lampX, lampY, size * EXIT_LAMP_RADIUS, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ── Hall of mirrors ───────────────────────────────────────────────────────────

const STAR_POINT_COUNT = 5;
const STAR_OUTER_RADIUS = 0.4;
const STAR_INNER_RADIUS = 0.17;
const STAR_PLATE_RADIUS = 0.46;
const STAR_LATCH_SPIN_SPEED = 0.02;
const STAR_LATCH_RAY_COUNT = 8;
const STAR_LATCH_RAY_LENGTH = 0.14;

/** A star target set in the dividing wall, lit by however many beams it still wants. */
export function drawMazeStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: MazeStarArt,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const lit = Math.max(0, Math.min(1, state.litFraction));

  ctx.fillStyle = IRON_DARK;
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * STAR_PLATE_RADIUS, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
  ctx.stroke();

  ctx.beginPath();
  for (let point = 0; point < STAR_POINT_COUNT * 2; point++) {
    const radius = size * (point % 2 === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS);
    // Started at the top so the star reads upright rather than as a cog.
    const angle = -TAU / 4 + (TAU / (STAR_POINT_COUNT * 2)) * point;
    const px = centreX + Math.cos(angle) * radius;
    const py = centreY + Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = inkRgba(IRON_MID_INK, 1);
  ctx.fill();

  if (lit > MIN_VISIBLE_ALPHA || state.latched) {
    const brightness = state.latched ? 1 : lit;
    ctx.fillStyle = inkRgba(GOLD_INK, brightness);
    ctx.fill();
    paintPulseHalo(ctx, centreX, centreY, size, brightness, GOLD_INK);
  }

  if (state.latched) {
    ctx.strokeStyle = inkRgba(LIMELIGHT_INK, 0.8);
    ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
    const spin = state.phase * STAR_LATCH_SPIN_SPEED;
    for (let ray = 0; ray < STAR_LATCH_RAY_COUNT; ray++) {
      const angle = spin + (TAU / STAR_LATCH_RAY_COUNT) * ray;
      const inner = size * STAR_PLATE_RADIUS;
      const outer = inner + size * STAR_LATCH_RAY_LENGTH;
      ctx.beginPath();
      ctx.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
      ctx.lineTo(centreX + Math.cos(angle) * outer, centreY + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const LIMELIGHT_BODY_LENGTH = 0.6;
const LIMELIGHT_BODY_WIDTH = 0.44;
const LIMELIGHT_LENS_RADIUS = 0.15;
const LIMELIGHT_MOUNT_WIDTH = 0.16;
const LIMELIGHT_FLARE_RINGS = 3;
const LIMELIGHT_FLICKER_SPEED = 0.11;
const LIMELIGHT_FLICKER_DEPTH = 0.2;

/** Rotation, in radians, that turns the +x axis into a beam heading. */
function headingAngle(direction: BeamDirection): number {
  if (direction === 'east') return 0;
  if (direction === 'south') return TAU / 4;
  if (direction === 'west') return TAU / 2;
  return -TAU / 4;
}

/** A limelight projector, bolted into the wall of its lane and aimed down it. */
export function drawMazeLimelight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  direction: BeamDirection,
  phase: number,
): void {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(headingAngle(direction));

  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(
    (-size * LIMELIGHT_BODY_LENGTH) / 2 - size * LIMELIGHT_MOUNT_WIDTH,
    (-size * LIMELIGHT_MOUNT_WIDTH) / 2,
    size * LIMELIGHT_MOUNT_WIDTH,
    size * LIMELIGHT_MOUNT_WIDTH,
  );
  ctx.fillStyle = BRASS;
  ctx.fillRect(
    (-size * LIMELIGHT_BODY_LENGTH) / 2,
    (-size * LIMELIGHT_BODY_WIDTH) / 2,
    size * LIMELIGHT_BODY_LENGTH,
    size * LIMELIGHT_BODY_WIDTH,
  );
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(
    (-size * LIMELIGHT_BODY_LENGTH) / 2,
    (-size * LIMELIGHT_BODY_WIDTH) / 2,
    size * LIMELIGHT_BODY_LENGTH,
    size * LIMELIGHT_BODY_WIDTH * 0.25,
  );

  const flicker = 1 - LIMELIGHT_FLICKER_DEPTH * (1 - Math.sin(phase * LIMELIGHT_FLICKER_SPEED));
  const lensX = (size * LIMELIGHT_BODY_LENGTH) / 2;
  for (let ring = LIMELIGHT_FLARE_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, (0.22 * flicker) / ring);
    ctx.beginPath();
    ctx.arc(lensX, 0, size * LIMELIGHT_LENS_RADIUS * (1 + ring * 0.6), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = LIMELIGHT;
  ctx.beginPath();
  ctx.arc(lensX, 0, size * LIMELIGHT_LENS_RADIUS * flicker, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * The cold span's own gold, kept well clear of every timber and brass in the
 * tent.
 *
 * The palette's `GOLD_INK` is a paint colour, and at the alphas a beam wants it
 * sat down among the planks and read as varnish rather than as light. Light has
 * to be nearly white at its centre whatever its temperature, so the cold beam
 * is a pale gold with a cream core — unmistakably lit, and still unmistakably
 * not the white-hot span.
 */
const BEAM_GOLD_INK: Ink = { r: 255, g: 214, b: 96 };
const BEAM_GOLD_CORE_INK: Ink = { r: 255, g: 246, b: 196 };

const BEAM_HOT_CORE_WIDTH = 0.24;
const BEAM_HOT_BLOOM_WIDTH = 0.72;
const BEAM_HOT_BODY_WIDTH = 0.44;
const BEAM_COLD_CORE_WIDTH = 0.14;
const BEAM_COLD_BODY_WIDTH = 0.34;
const BEAM_COLD_BLOOM_WIDTH = 0.58;
const BEAM_HOT_BLOOM_ALPHA = 0.42;
const BEAM_COLD_BLOOM_ALPHA = 0.26;
const BEAM_HOT_BODY_ALPHA = 0.85;
const BEAM_COLD_BODY_ALPHA = 0.82;
const BEAM_CORE_ALPHA = 0.95;
const BEAM_SHIMMER_COUNT = 3;
const BEAM_SHIMMER_LENGTH = 0.22;
const BEAM_SHIMMER_SPEED = 0.06;
const BEAM_HOT_SHIMMER_ALPHA = 0.55;
const BEAM_COLD_SHIMMER_ALPHA = 0.3;

/**
 * One tile of a limelight's ray.
 *
 * The unbent span out of the lens is white-hot and kills; everything past the
 * first mirror is cold gold. The two have to be told apart at speed and at a
 * glance, so the difference is colour *and* width *and* how fast the shimmer
 * runs, not colour alone.
 */
export function drawMazeBeamTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  state: { readonly hot: boolean; readonly heading: BeamDirection; readonly phase: number },
): void {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(headingAngle(state.heading));

  const bloomWidth = size * (state.hot ? BEAM_HOT_BLOOM_WIDTH : BEAM_COLD_BLOOM_WIDTH);
  const bodyWidth = size * (state.hot ? BEAM_HOT_BODY_WIDTH : BEAM_COLD_BODY_WIDTH);
  const coreWidth = size * (state.hot ? BEAM_HOT_CORE_WIDTH : BEAM_COLD_CORE_WIDTH);

  ctx.fillStyle = inkRgba(
    state.hot ? EMBER_INK : BEAM_GOLD_INK,
    state.hot ? BEAM_HOT_BLOOM_ALPHA : BEAM_COLD_BLOOM_ALPHA,
  );
  ctx.fillRect(-size / 2, -bloomWidth / 2, size, bloomWidth);
  // The body is where the rule is read: a hot span is white with a fire fringe,
  // a cold one is gold through and through. Giving the hot body the ember colour
  // put the two states a step apart on the wheel instead of a world apart.
  ctx.fillStyle = inkRgba(
    state.hot ? LIMELIGHT_INK : BEAM_GOLD_INK,
    state.hot ? BEAM_HOT_BODY_ALPHA : BEAM_COLD_BODY_ALPHA,
  );
  ctx.fillRect(-size / 2, -bodyWidth / 2, size, bodyWidth);
  ctx.fillStyle = inkRgba(state.hot ? LIMELIGHT_INK : BEAM_GOLD_CORE_INK, BEAM_CORE_ALPHA);
  ctx.fillRect(-size / 2, -coreWidth / 2, size, coreWidth);

  const shimmerAlpha = state.hot ? BEAM_HOT_SHIMMER_ALPHA : BEAM_COLD_SHIMMER_ALPHA;
  const speed = BEAM_SHIMMER_SPEED * (state.hot ? 2 : 1);
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, shimmerAlpha);
  for (let shimmer = 0; shimmer < BEAM_SHIMMER_COUNT; shimmer++) {
    const travel = (state.phase * speed + shimmer / BEAM_SHIMMER_COUNT) % 1;
    ctx.fillRect(
      -size / 2 + size * travel,
      -bodyWidth / 4,
      size * BEAM_SHIMMER_LENGTH,
      bodyWidth / 2,
    );
  }
  ctx.restore();
}

// ── Flame vents ───────────────────────────────────────────────────────────────

const VENT_GRILLE_SLOTS = 3;
const VENT_SLOT_WIDTH = 0.14;
const VENT_SLOT_HEIGHT = 0.44;
const VENT_RIM_INSET = 0.12;
const VENT_RIM_WIDTH = 0.06;
/**
 * The pilot light kept burning behind the slots, so a fire lane can be read cold.
 *
 * Steady rather than breathing. The grille takes no frame counter, and the only
 * clock to hand was the tile's position on screen — which in a scrolling world
 * slides the shimmer across the grille as the camera moves, so the vent appears
 * to stir whenever the player walks. A constant ember says "always warm" without
 * ever suggesting the jet has lit.
 */
const VENT_EMBER_ALPHA = 0.5;
/** Below this the flame is a lick rather than a column, and rises/falls with it. */
const FLAME_RAMP_FRACTION = 0.2;

/**
 * The gas jet, cold: a brass-rimmed grille sunk into the sawdust, still glowing.
 *
 * The ember behind the slots is the whole reason the grille is not grey: a
 * player has to be able to plan a route round the fire lanes before any of them
 * has ever fired, and an unlit grille is indistinguishable from a floor drain.
 */
export function drawFlameVentGrille(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  // The grille is on screen from the moment the maze is, and the flame is not.
  // Baking the stamps here spends the cost on a frame with nothing at stake
  // rather than on the frame a vent lights under somebody.
  flameStamps();
  ctx.save();
  const inset = size * VENT_RIM_INSET;
  const span = size - inset * 2;

  ctx.fillStyle = BRASS;
  ctx.fillRect(x + inset, y + inset, span, span);
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(x + inset, y + inset, span, Math.max(1, size * VENT_RIM_WIDTH * 0.5));
  const rim = size * VENT_RIM_WIDTH;
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(x + inset + rim, y + inset + rim, span - rim * 2, span - rim * 2);

  ctx.fillStyle = inkRgba(EMBER_INK, VENT_EMBER_ALPHA);
  ctx.fillRect(x + inset + rim, y + inset + rim, span - rim * 2, span - rim * 2);

  ctx.fillStyle = inkRgba(SHADOW_INK, 0.95);
  const slotWidth = size * VENT_SLOT_WIDTH;
  const slotHeight = size * VENT_SLOT_HEIGHT;
  for (let slot = 0; slot < VENT_GRILLE_SLOTS; slot++) {
    const sx =
      x + inset + (span / VENT_GRILLE_SLOTS) * slot + (span / VENT_GRILLE_SLOTS - slotWidth) / 2;
    ctx.fillRect(sx, y + size / 2 - slotHeight / 2, slotWidth, slotHeight);
  }
  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}

/** The warning: the shared "this ground is about to hurt" language, on one tile. */
export function drawFlameVentTelegraph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  drawDangerTile(ctx, x, y, size, Math.min(1, progress + FLAME_RAMP_FRACTION));
}

/** How far the tallest parcel gets before it has burned out, in tiles. */
const FLAME_HEIGHT_TILES = 1.55;
/** Where in its tile the column stands: a little forward of centre, on the grille. */
const FLAME_BASE_Y = 0.72;

const FLAME_BASE_GLOW_RADIUS = 0.72;
const FLAME_GLOW_ALPHA = 0.14;
/** How much of the pool of light the flicker takes away at its dimmest. */
const FLAME_GLOW_FLICKER_DEPTH = 0.28;
/**
 * Two speeds that share no common period, so the pool never settles into a
 * pulse the eye can count. Radians per frame, well under Nyquist.
 */
const FLAME_GLOW_SLOW_SPEED = 0.17;
const FLAME_GLOW_FAST_SPEED = 0.41;

/**
 * How many parcels of burning gas are in the air at once. Each is born at the
 * grille, rises, narrows and dies, and the next is born behind it — which is
 * what makes the column read as a flow rather than as a shape that wobbles.
 */
const FLAME_PARCEL_COUNT = 16;
/** How long a parcel takes to travel from the grille to the top of the column. */
const FLAME_PARCEL_LIFETIME_FRAMES = 26;
/** Half-width of a parcel at birth. */
const FLAME_PARCEL_FOOT_HALF_WIDTH = 0.22;
/**
 * Taller than it is wide by a wide margin, because the bend is baked into the
 * stamp: a squat parcel draws the same curve across a short span and the S comes
 * out as a fin sticking off the column instead of as a lick leaning over.
 */
const FLAME_PARCEL_BODY_HEIGHT = 0.78;
/**
 * How far up a parcel keeps its full girth before it starts necking in. A jet
 * out of a floor grille is violent and dense in its lower half and only comes
 * apart near the top; a parcel that tapers from birth gives a candle instead.
 */
const FLAME_PARCEL_WAIST_START = 0.5;
/**
 * Under one, width falls away more slowly than the climb does once the waist is
 * passed. A parcel that has thinned to nothing by mid-height leaves a band where
 * the column is neither body nor lick, and the eruption reads as two stacked
 * things — a glow with darts over it — instead of one flame.
 */
const FLAME_PARCEL_TAPER_EXPONENT = 0.8;
/** How much of its body height a parcel keeps once it has reached the top. */
const FLAME_PARCEL_BODY_SURVIVAL = 0.46;
/**
 * How much of the climb is acceleration rather than steady travel. Hot gas
 * speeds up as it rises, which spreads the parcels apart near the top — and that
 * spread is what lets the last few read as licks that have shed the column.
 */
const FLAME_RISE_ACCELERATION = 0.5;
/** A parcel is drawn from nothing over the first slice of its life. */
const FLAME_PARCEL_BIRTH_FRACTION = 0.08;

/** Two incommensurate sway frequencies, in radians over one parcel's whole life. */
const FLAME_SWAY_PRIMARY_CYCLE = 3.1;
const FLAME_SWAY_SECONDARY_CYCLE = 7.9;
const FLAME_SWAY_PRIMARY_TILES = 0.15;
const FLAME_SWAY_SECONDARY_TILES = 0.06;
/** The whole column's slow drift, as if a draught crossed the tent. */
const FLAME_DRAFT_TILES = 0.1;
const FLAME_DRAFT_SPEED = 0.023;
/** Narrower than this and the stamp lands on nothing; skip the draw call. */
const FLAME_MIN_STAMP_HALF_WIDTH = 0.4;

/**
 * How far a parcel is allowed to tilt off vertical, in radians, at full sway.
 *
 * Kept modest because the baked bend already supplies most of the lean: tilt and
 * curve stacking up together swing a lick past the horizontal, and a horizontal
 * lick reads as a blade stuck out of the column rather than as fire.
 */
const FLAME_MAX_LEAN_RADIANS = 0.28;

/**
 * The whole column's lean, in tiles of sideways travel at the top of the climb.
 *
 * Nothing about combustion is mirrored, and a jet whose centre of mass sits dead
 * over its burner reads as a lamp. Two incommensurate slow clocks let the lean
 * wander instead of swinging on a countable beat.
 */
const FLAME_COLUMN_LEAN_TILES = 0.26;
const FLAME_COLUMN_LEAN_SLOW_SPEED = 0.031;
const FLAME_COLUMN_LEAN_FAST_SPEED = 0.073;
const FLAME_COLUMN_LEAN_FAST_SHARE = 0.35;
/** How much of the lean the anchored parts at the burner take. */
const FLAME_ROOT_LEAN_SHARE = 0.4;
const FLAME_THROAT_LEAN_SHARE = 0.25;

/** How far the roots' centre of mass slides off the burner's centre line. */
const FLAME_ROOT_BIAS_TILES = 0.07;
const FLAME_ROOT_BIAS_SPEED = 0.047;

/**
 * How far off the centre line a parcel is allowed to root. Together with the
 * parcel's own girth this is what makes the flame leave the grille at close to
 * the full width of its tile instead of sprouting from a point.
 */
const FLAME_PARCEL_ROOT_SPREAD_TILES = 0.24;

/** How far a release may slide inside its own slot on the birth clock, 0..1. */
const FLAME_PARCEL_RELEASE_JITTER = 0.7;

/** How far a parcel's width and brightness are allowed to vary from birth to birth. */
const FLAME_PARCEL_WIDTH_JITTER = 0.4;
const FLAME_PARCEL_ALPHA_FLOOR = 0.72;

/** The cool gas at the burner, which is dark because it has not caught yet. */
const FLAME_FUEL_HALF_WIDTH = 0.2;
const FLAME_FUEL_HEIGHT = 0.05;
const FLAME_FUEL_FLICKER_DEPTH = 0.3;
const FLAME_FUEL_FLICKER_SPEED = 0.29;

/**
 * The root: the dense mass sitting on the burner mouth.
 *
 * The parcels alone leave this exact spot dim, because each one's foot travels
 * up with it and only the youngest are still down here — which puts the flame's
 * thinnest ink where a jet is at its most violent. The root is what the parcels
 * tear away from.
 */
const FLAME_ROOT_HALF_WIDTH = 0.36;
const FLAME_ROOT_HEIGHT = 0.66;
const FLAME_ROOT_LIFT = 0.03;
const FLAME_ROOT_FLICKER_DEPTH = 0.07;
const FLAME_ROOT_FLICKER_SPEED = 0.19;

/** The bright throat just above the fuel: a small hot spot, never a wide bulb. */
const FLAME_THROAT_HALF_WIDTH = 0.075;
const FLAME_THROAT_HEIGHT = 0.1;
const FLAME_THROAT_LIFT = 0.1;
const FLAME_THROAT_ALPHA = 0.5;
const FLAME_THROAT_FLICKER_DEPTH = 0.3;
const FLAME_THROAT_FLICKER_SPEED = 0.61;

/** Sparks that leave the column and burn out over it. */
const FLAME_EMBER_COUNT = 3;
const FLAME_EMBER_LIFETIME_FRAMES = 44;
/** Where up the column an ember detaches, and how far past the top it carries. */
const FLAME_EMBER_RELEASE_HEIGHT = 0.4;
const FLAME_EMBER_TRAVEL_TILES = 0.85;
const FLAME_EMBER_DRIFT_TILES = 0.26;
const FLAME_EMBER_RADIUS_TILES = 0.045;
const FLAME_EMBER_ALPHA = 0.9;
/** A spark is drawn from nothing over the first slice of its life, as a parcel is. */
const FLAME_EMBER_BIRTH_FRACTION = 0.12;

/**
 * Distinct offsets into the hash so a parcel's width, brightness, sway and root
 * are four independent draws rather than four readings of one number — reusing a
 * draw ties the shape to the lean and the column starts to look combed.
 */
const HASH_SALT_WIDTH = 101;
const HASH_SALT_BRIGHTNESS = 211;
const HASH_SALT_SWAY_PRIMARY = 307;
const HASH_SALT_SWAY_SECONDARY = 401;
const HASH_SALT_ROOT = 509;
const HASH_SALT_SPARK_LANE = 601;
const HASH_SALT_BEND = 709;
const HASH_SALT_BEND_MIRROR = 811;

/**
 * The eruption: a column of fire standing out of the grille.
 *
 * `burn` is 0..1 across the burn; the column ramps up over its first fifth
 * and falls away over its last, so the flame arrives and leaves rather than
 * blinking. `phase` is a frame accumulator, and everything below is a pure
 * function of it.
 *
 * The column is a *flow*, not a silhouette. Parcels of gas are born across the
 * whole mouth of the grille on a rolling clock, rise, neck in, cool and go out.
 * A wobbling outline reads as a flag; only travelling parcels read as combustion.
 *
 * Every piece of it is a baked soft stamp rather than a filled path. Fire has no
 * crisp boundary above the burner, and a path fill has nothing but — a dozen of
 * them stacked up reads as cut paper however the curve is shaped.
 */
export function drawFlameVentColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  burn: number,
  phase: number,
): void {
  const rise = Math.min(1, burn / FLAME_RAMP_FRACTION);
  const fall = Math.min(1, (1 - burn) / FLAME_RAMP_FRACTION);
  const intensity = Math.max(0, Math.min(rise, fall));
  if (intensity < MIN_VISIBLE_ALPHA) return;

  const stamps = flameStamps();
  const cx = x + size / 2;
  const baseY = y + size * FLAME_BASE_Y;
  const columnHeight = size * FLAME_HEIGHT_TILES * intensity;
  const draft = Math.sin(phase * FLAME_DRAFT_SPEED) * size * FLAME_DRAFT_TILES;
  const lean = columnLean(size, phase);

  ctx.save();
  paintFlameGlow(ctx, stamps, cx, baseY, size, intensity, phase);
  paintFlameRoot(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFuelShadow(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFlameParcels(ctx, stamps, cx, baseY, size, columnHeight, intensity, phase, draft, lean);
  ctx.globalCompositeOperation = 'lighter';
  paintFlameThroat(ctx, stamps, cx, baseY, size, intensity, phase, lean);
  paintFlameEmbers(ctx, stamps, cx, baseY, size, intensity, phase, draft);
  ctx.restore();
}

/**
 * How far the top of the column has slid off its burner's centre line, in
 * pixels. The parts nearer the grille take a share of it; the parts in free air
 * take all of it.
 */
function columnLean(size: number, phase: number): number {
  const slowWander = Math.sin(phase * FLAME_COLUMN_LEAN_SLOW_SPEED);
  const fastWander = Math.sin(phase * FLAME_COLUMN_LEAN_FAST_SPEED);
  const blended =
    slowWander * (1 - FLAME_COLUMN_LEAN_FAST_SHARE) + fastWander * FLAME_COLUMN_LEAN_FAST_SHARE;
  return size * FLAME_COLUMN_LEAN_TILES * blended;
}

/**
 * The pool of light the column throws on the sawdust around its grille.
 *
 * It breathes with the column rather than sitting steady: a lamp that holds
 * still under a fire that does not is the tell that the fire is a decal.
 */
function paintFlameGlow(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
): void {
  const slowBreath = Math.sin(phase * FLAME_GLOW_SLOW_SPEED);
  const fastBreath = Math.sin(phase * FLAME_GLOW_FAST_SPEED);
  const breath = 1 - FLAME_GLOW_FLICKER_DEPTH * (1 - (slowBreath + fastBreath) / 2);
  const radius = size * FLAME_BASE_GLOW_RADIUS * breath;
  ctx.globalAlpha = Math.min(1, FLAME_GLOW_ALPHA * intensity * breath);
  ctx.drawImage(stamps.glow, cx - radius, baseY - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

/**
 * The unlit gas sitting on the burner, laid down under the flame body.
 *
 * Real flame is dark where the fuel has not caught, and that darkness is what
 * makes the throat above it read as hot rather than merely as pale.
 */
function paintFuelShadow(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const unrest = 1 - FLAME_FUEL_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_FUEL_FLICKER_SPEED));
  const halfWidth = size * FLAME_FUEL_HALF_WIDTH * unrest;
  const halfHeight = size * FLAME_FUEL_HEIGHT;
  const centreX = cx + lean * FLAME_ROOT_LEAN_SHARE;
  ctx.globalAlpha = intensity;
  ctx.drawImage(
    stamps.fuel,
    centreX - halfWidth,
    baseY - halfHeight,
    halfWidth * 2,
    halfHeight * 2,
  );
  ctx.globalAlpha = 1;
}

/** The dense mass on the burner mouth that the rising parcels tear away from. */
function paintFlameRoot(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const surge = 1 - FLAME_ROOT_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_ROOT_FLICKER_SPEED));
  const rootHeight = size * FLAME_ROOT_HEIGHT * surge;
  const tilt = Math.max(
    -FLAME_MAX_LEAN_RADIANS,
    Math.min(FLAME_MAX_LEAN_RADIANS, (lean * FLAME_ROOT_LEAN_SHARE) / Math.max(rootHeight, 1)),
  );
  stampTeardrop(
    ctx,
    stamps.root,
    cx,
    baseY + size * FLAME_ROOT_LIFT,
    size * FLAME_ROOT_HALF_WIDTH * surge,
    rootHeight,
    tilt,
    intensity,
    // Never mirrored: the root's curve is a standing feature of the burner, and
    // flipping it on the sign of a wandering lean would pop as the lean crosses zero.
    false,
  );
}

/**
 * The hard-burning neck just above the fuel.
 *
 * Narrow on purpose, and additive: this is the only white-hot thing in the
 * column, and a wide one turns the burner mouth into a pale bulb. Painted rather
 * than added it reads as grey over the dark iron instead of as heat.
 */
function paintFlameThroat(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  lean: number,
): void {
  const pulse = 1 - FLAME_THROAT_FLICKER_DEPTH * (1 - Math.sin(phase * FLAME_THROAT_FLICKER_SPEED));
  const halfWidth = size * FLAME_THROAT_HALF_WIDTH * pulse;
  const halfHeight = size * FLAME_THROAT_HEIGHT * pulse;
  const centreY = baseY - size * FLAME_THROAT_LIFT - halfHeight;
  const centreX = cx + lean * FLAME_THROAT_LEAN_SHARE;
  ctx.globalAlpha = Math.min(1, FLAME_THROAT_ALPHA * intensity);
  ctx.drawImage(
    stamps.throat,
    centreX - halfWidth,
    centreY - halfHeight,
    halfWidth * 2,
    halfHeight * 2,
  );
  ctx.globalAlpha = 1;
}

/**
 * The body of the column: parcels of gas on a rolling birth clock.
 *
 * A parcel picks its colour tier from how far it has climbed, so the ramp runs
 * up the column rather than across its layers, and nothing has to be tinted at
 * draw time.
 */
function paintFlameParcels(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  columnHeight: number,
  intensity: number,
  phase: number,
  draft: number,
  lean: number,
): void {
  const clock = phase / FLAME_PARCEL_LIFETIME_FRAMES;
  const topTier = stamps.body.length - 1;
  const rootBias = size * FLAME_ROOT_BIAS_TILES * Math.sin(phase * FLAME_ROOT_BIAS_SPEED);
  for (let i = 0; i < FLAME_PARCEL_COUNT; i++) {
    // Nudged off the metronome, but only within its own slot. A free offset
    // clumps the releases, and a clumped ensemble is dense and then sparse on a
    // cycle exactly one parcel-lifetime long — the whole column throbs.
    const slot = i + (hashUnit(i, i) - 0.5) * FLAME_PARCEL_RELEASE_JITTER;
    const release = clock + slot / FLAME_PARCEL_COUNT;
    const birthNumber = Math.floor(release);
    const age = release - birthNumber;

    const widthJitter =
      1 + (hashUnit(birthNumber + HASH_SALT_WIDTH, i) - 0.5) * FLAME_PARCEL_WIDTH_JITTER;
    const brightness =
      FLAME_PARCEL_ALPHA_FLOOR +
      (1 - FLAME_PARCEL_ALPHA_FLOOR) * hashUnit(birthNumber + HASH_SALT_BRIGHTNESS, i);
    const birthFade = Math.min(1, age / FLAME_PARCEL_BIRTH_FRACTION);
    const alpha = intensity * brightness * birthFade;
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const climb = age * (1 - FLAME_RISE_ACCELERATION + FLAME_RISE_ACCELERATION * age);
    const footY = baseY - columnHeight * climb;

    const swaySeedPrimary = hashUnit(birthNumber + HASH_SALT_SWAY_PRIMARY, i) * TAU;
    const swaySeedSecondary = hashUnit(birthNumber + HASH_SALT_SWAY_SECONDARY, i) * TAU;
    const sway =
      size *
      age *
      (FLAME_SWAY_PRIMARY_TILES * Math.sin(age * FLAME_SWAY_PRIMARY_CYCLE + swaySeedPrimary) +
        FLAME_SWAY_SECONDARY_TILES *
          Math.sin(age * FLAME_SWAY_SECONDARY_CYCLE + swaySeedSecondary));
    const root =
      (hashUnit(birthNumber + HASH_SALT_ROOT, i) - 0.5) * size * FLAME_PARCEL_ROOT_SPREAD_TILES;
    const footX = cx + root + rootBias + sway + draft * age + lean * climb;

    const pastWaist = Math.max(0, age - FLAME_PARCEL_WAIST_START) / (1 - FLAME_PARCEL_WAIST_START);
    const girth = Math.pow(1 - pastWaist, FLAME_PARCEL_TAPER_EXPONENT);
    const halfWidth = size * FLAME_PARCEL_FOOT_HALF_WIDTH * widthJitter * girth;
    const bodyHeight =
      size *
      FLAME_PARCEL_BODY_HEIGHT *
      widthJitter *
      (FLAME_PARCEL_BODY_SURVIVAL + (1 - FLAME_PARCEL_BODY_SURVIVAL) * (1 - age));
    if (halfWidth < FLAME_MIN_STAMP_HALF_WIDTH) continue;

    const tier = Math.min(topTier, Math.floor(climb * stamps.body.length));
    const bends = stamps.body[tier];
    const bendChoice = hashUnit(birthNumber + HASH_SALT_BEND, i);
    const bendIndex = Math.min(bends.length - 1, Math.floor(bendChoice * bends.length));
    const stamp = bends[bendIndex];
    const mirrored = hashUnit(birthNumber + HASH_SALT_BEND_MIRROR, i) < 0.5;
    const tilt = Math.max(
      -FLAME_MAX_LEAN_RADIANS,
      Math.min(FLAME_MAX_LEAN_RADIANS, (sway + lean * climb) / Math.max(bodyHeight, 1)),
    );
    stampTeardrop(
      ctx,
      stamp,
      footX,
      footY,
      halfWidth,
      bodyHeight,
      tilt,
      Math.min(1, alpha),
      mirrored,
    );
  }
}

/**
 * Sparks that have left the column and burn out above it.
 *
 * A flame that never sheds anything reads as a solid object; the detached ink is
 * what says the thing is coming apart as it goes. Three at a time — a handful
 * more and it stops being a fire and becomes a sparkler.
 */
function paintFlameEmbers(
  ctx: CanvasRenderingContext2D,
  stamps: FlameStamps,
  cx: number,
  baseY: number,
  size: number,
  intensity: number,
  phase: number,
  draft: number,
): void {
  const clock = phase / FLAME_EMBER_LIFETIME_FRAMES;
  for (let i = 0; i < FLAME_EMBER_COUNT; i++) {
    const release = clock + i / FLAME_EMBER_COUNT + hashUnit(i, -i);
    const birthNumber = Math.floor(release);
    const age = release - birthNumber;
    const birthFade = Math.min(1, age / FLAME_EMBER_BIRTH_FRACTION);
    const alpha = intensity * FLAME_EMBER_ALPHA * (1 - age) * birthFade;
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const lane = hashUnit(birthNumber + HASH_SALT_SPARK_LANE, i) - 0.5;
    const wobble = Math.sin(age * FLAME_SWAY_SECONDARY_CYCLE + lane * TAU);
    const emberX = cx + size * FLAME_EMBER_DRIFT_TILES * (lane * 2 + wobble * age) + draft * age;
    const releaseY = baseY - size * FLAME_HEIGHT_TILES * FLAME_EMBER_RELEASE_HEIGHT * intensity;
    const emberY = releaseY - size * FLAME_EMBER_TRAVEL_TILES * age * intensity;
    const radius = size * FLAME_EMBER_RADIUS_TILES * (1 - age);

    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(stamps.ember, emberX - radius, emberY - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}

// ── Spotlights ────────────────────────────────────────────────────────────────

/**
 * The two states of the menagerie's lanterns have to be told apart in one
 * glance, because getting them the wrong way round is a death.
 *
 * They are separated on three axes at once rather than on brightness alone:
 * the warning is amber and the strike is white-hot, the warning is a ring round
 * a nearly-empty pool and the strike is a filled disc, and the warning's edge
 * closes inward while the strike's edge is fixed. Any one of the three read on
 * its own is enough to name the state.
 */
const SPOT_WARM_INK: Ink = { r: 255, g: 176, b: 46 };
const SPOT_WARM_OUTER_RADIUS = 0.68;
const SPOT_WARM_CLOSE = 0.22;
const SPOT_WARM_FILL_ALPHA = 0.34;
/** The pool is already a warning on its first frame, so it never starts from nothing. */
const SPOT_WARM_FILL_FLOOR = 0.55;
const SPOT_WARM_RING_ALPHA = 0.95;
const SPOT_WARM_RING_WIDTH = 0.1;
/** Where the closing ring will finally land, marked from the first frame. */
const SPOT_WARM_LANDING_RADIUS = 0.46;
const SPOT_WARM_LANDING_ALPHA = 0.45;
const SPOT_WARM_LANDING_WIDTH = 0.04;

const SPOT_BEAM_RADIUS = 0.5;
const SPOT_BEAM_CORE_ALPHA = 0.72;
const SPOT_BEAM_BLOOM_RINGS = 3;
const SPOT_BEAM_BLOOM_ALPHA = 0.3;
const SPOT_BEAM_BLOOM_SPREAD = 0.3;
const SPOT_BEAM_RIM_ALPHA = 1;
const SPOT_BEAM_RIM_WIDTH = 0.07;
const SPOT_MOTE_COUNT = 5;
const SPOT_MOTE_RADIUS = 0.03;
const SPOT_MOTE_SPEED = 0.024;
const SPOT_MOTE_ALPHA = 0.55;

const SPOT_DOCK_RADIUS = 0.46;
const SPOT_DOCK_FILL_ALPHA = 0.22;
const SPOT_DOCK_ARC_WIDTH = 0.07;

/** The warning pool: an amber ring closing on the tile the lamps are about to find. */
export function drawSpotlightWarm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  const closing = Math.max(0, Math.min(1, progress));
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;

  ctx.fillStyle = inkRgba(
    SPOT_WARM_INK,
    SPOT_WARM_FILL_ALPHA * (SPOT_WARM_FILL_FLOOR + (1 - SPOT_WARM_FILL_FLOOR) * closing),
  );
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_WARM_LANDING_RADIUS, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(SPOT_WARM_INK, SPOT_WARM_LANDING_ALPHA);
  ctx.lineWidth = Math.max(1, size * SPOT_WARM_LANDING_WIDTH);
  ctx.stroke();

  ctx.strokeStyle = inkRgba(SPOT_WARM_INK, SPOT_WARM_RING_ALPHA);
  ctx.lineWidth = Math.max(2, size * SPOT_WARM_RING_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * (SPOT_WARM_OUTER_RADIUS - SPOT_WARM_CLOSE * closing), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** The lamps themselves, on the floor: a hard white pool with dust turning in it. */
export function drawSpotlightBeam(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
  phase: number,
): void {
  const strength = Math.max(0, Math.min(1, progress));
  if (strength < MIN_VISIBLE_ALPHA) return;
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const radius = size * SPOT_BEAM_RADIUS;

  for (let ring = SPOT_BEAM_BLOOM_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(LIMELIGHT_INK, (SPOT_BEAM_BLOOM_ALPHA * strength) / (ring * ring));
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius * (1 + SPOT_BEAM_BLOOM_SPREAD * ring), 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = inkRgba(LIMELIGHT_INK, SPOT_BEAM_CORE_ALPHA * strength);
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(LIMELIGHT_INK, SPOT_BEAM_RIM_ALPHA * strength);
  ctx.lineWidth = Math.max(2, size * SPOT_BEAM_RIM_WIDTH);
  ctx.stroke();

  ctx.fillStyle = inkRgba(SPOT_WARM_INK, SPOT_MOTE_ALPHA * strength);
  for (let mote = 0; mote < SPOT_MOTE_COUNT; mote++) {
    const angle = phase * SPOT_MOTE_SPEED + (TAU / SPOT_MOTE_COUNT) * mote;
    const reach = radius * (0.3 + 0.55 * hashUnit(mote, mote));
    ctx.beginPath();
    ctx.arc(
      centreX + Math.cos(angle) * reach,
      centreY + Math.sin(angle) * reach,
      size * SPOT_MOTE_RADIUS,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();
}

const SPOT_CLEAR_RADIUS = 0.42;
const SPOT_CLEAR_FILL_ALPHA = 0.16;
const SPOT_CLEAR_RING_ALPHA = 0.5;
const SPOT_CLEAR_RING_WIDTH = 0.05;
const SPOT_CLEAR_BREATH = 0.12;

/**
 * The mark on a stretch of boards whose lanterns a bell has called away.
 *
 * Deliberately cool green rather than the warning's amber, and a *shrinking*
 * ring rather than a closing one. Drawing the warning's own outline at zero
 * progress was tried first and read as "about to light" — playtesters would not
 * step onto ground they had just paid to clear, because it was still painted
 * the colour of the thing they were avoiding.
 */
export function drawSpotlightClear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const breath =
    1 - SPOT_CLEAR_BREATH + SPOT_CLEAR_BREATH * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
  const radius = size * SPOT_CLEAR_RADIUS * breath;
  ctx.save();
  ctx.fillStyle = inkRgba(CLEAR_GREEN_INK, SPOT_CLEAR_FILL_ALPHA);
  ctx.beginPath();
  ctx.arc(centreX, centreY, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = inkRgba(CLEAR_GREEN_INK, SPOT_CLEAR_RING_ALPHA);
  ctx.lineWidth = Math.max(1, size * SPOT_CLEAR_RING_WIDTH);
  ctx.stroke();
  ctx.restore();
}

/** The pool of light that sits on a rung bell's stand while its lanterns are held off the floor. */
export function drawSpotlightDock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  holdFraction: number,
  phase: number,
): void {
  const remaining = Math.max(0, Math.min(1, holdFraction));
  ctx.save();
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const breath = 0.85 + 0.15 * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, SPOT_DOCK_FILL_ALPHA * breath);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_DOCK_RADIUS, 0, TAU);
  ctx.fill();
  // The docked lamps are the whole reason the lane is safe, so the arc that runs
  // out is the same reading as the bell's — one clock shown in two places.
  ctx.strokeStyle = inkRgba(GOLD_INK, 0.9);
  ctx.lineWidth = Math.max(2, size * SPOT_DOCK_ARC_WIDTH);
  ctx.beginPath();
  ctx.arc(centreX, centreY, size * SPOT_DOCK_RADIUS, -TAU / 4, -TAU / 4 + TAU * remaining);
  ctx.stroke();
  ctx.restore();
}

// ── Comprehension aids ────────────────────────────────────────────────────────

const CHIP_WIDTH = 1.3;
const CHIP_HEIGHT = 0.42;
const CHIP_LIFT = 0.42;
const CHIP_RADIUS = 3;
const CHIP_BORDER_WIDTH = 1.5;
/**
 * Cap height as a fraction of the tile rather than a pixel count, so the chip
 * holds its proportions at any tile size — a fixed 9px label is right at 32px
 * and a speck on a zoomed render.
 */
const CHIP_TEXT_FRACTION = 0.28;
const CHIP_TEXT_MIN_SIZE = 7;
/** The text sits a hair above the box's own middle, because a cap-height run reads low. */
const CHIP_TEXT_NUDGE = 0.5;

/** A small floating chip naming whose job this is: DONUT gold-on-red, CARL brass-on-blue. */
export function drawTargetNameChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  owner: 'human' | 'cat',
): void {
  const donutOwned = owner === 'cat';
  const textSize = Math.max(CHIP_TEXT_MIN_SIZE, size * CHIP_TEXT_FRACTION);
  const width = size * CHIP_WIDTH;
  const height = size * CHIP_HEIGHT;
  const box = drawBox(ctx, {
    x: x + size / 2,
    y: y - size * CHIP_LIFT,
    width,
    height,
    alignX: 'center',
    fill: donutOwned ? inkRgba(STRIPE_RED_INK, 0.9) : inkRgba(CIRCUS_BLUE_INK, 0.9),
    border: donutOwned ? GOLD : BRASS_LIGHT,
    borderWidth: CHIP_BORDER_WIDTH,
    radius: CHIP_RADIUS,
  });
  drawText(ctx, donutOwned ? 'DONUT' : 'CARL', {
    x: box.x + box.width / 2,
    y: box.y + (box.height - textSize) / 2 - CHIP_TEXT_NUDGE,
    size: textSize,
    bold: true,
    align: 'center',
    color: donutOwned ? GOLD : BRASS_LIGHT,
    outline: true,
  });
}

const ROPE_SAG_PIXELS = 10;
const ROPE_PULLEY_RADIUS = 4;
const ROPE_LINE_WIDTH = 2;
const ROPE_SHADOW_OFFSET = 1;

/**
 * A sagging rope from a target, over a pulley block, to the barrier it lifts.
 *
 * Slack at rest and straight once pulled: the rope is the only thing that says
 * *which* far-away wall a prop answers to, and a taut line drawn at every moment
 * makes the link look already spent.
 */
export function drawMazeRope(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  state: { readonly pulled: number; readonly owner: 'human' | 'cat' },
): void {
  if (points.length < 2) return;
  const slack = 1 - Math.max(0, Math.min(1, state.pulled));
  const donutOwned = state.owner === 'cat';
  ctx.save();
  ctx.lineWidth = ROPE_LINE_WIDTH;
  ctx.lineCap = 'round';

  ctx.strokeStyle = inkRgba(SHADOW_INK, 0.5);
  paintRopePath(ctx, points, slack, ROPE_SHADOW_OFFSET);
  ctx.strokeStyle = donutOwned ? GOLD : BRASS_LIGHT;
  paintRopePath(ctx, points, slack, 0);

  ctx.fillStyle = donutOwned ? STRIPE_RED : CIRCUS_BLUE;
  for (let index = 1; index < points.length - 1; index++) {
    const block = points[index];
    ctx.beginPath();
    ctx.arc(block.x, block.y, ROPE_PULLEY_RADIUS, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function paintRopePath(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  slack: number,
  offset: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y + offset);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    ctx.quadraticCurveTo(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2 + slack * ROPE_SAG_PIXELS + offset,
      to.x,
      to.y + offset,
    );
  }
  ctx.stroke();
}

// ── Trail dressing ────────────────────────────────────────────────────────────

const RUNNER_INSET = 0.1;
const RUNNER_BORDER_WIDTH = 0.06;
const RUNNER_WEAVE_COUNT = 4;
const RUNNER_WEAVE_ALPHA = 0.12;

/** The ring-mat runner: the carpet a crawler's own trail is laid on. */
export function drawRingMatRunner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  owner: 'human' | 'cat',
): void {
  ctx.save();
  const donutOwned = owner === 'cat';
  const inset = size * RUNNER_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = donutOwned ? inkRgba(VELVET_INK, 0.85) : inkRgba(CIRCUS_BLUE_INK, 0.85);
  ctx.fillRect(x + inset, y, span, size);
  ctx.fillStyle = donutOwned ? inkRgba(GOLD_INK, 0.9) : inkRgba(BRASS_LIGHT_INK, 0.9);
  const border = Math.max(1, size * RUNNER_BORDER_WIDTH);
  ctx.fillRect(x + inset, y, border, size);
  ctx.fillRect(x + inset + span - border, y, border, size);

  ctx.fillStyle = inkRgba(SHADOW_INK, RUNNER_WEAVE_ALPHA);
  const weaveHeight = size / RUNNER_WEAVE_COUNT;
  for (let weave = 0; weave < RUNNER_WEAVE_COUNT; weave += 2) {
    ctx.fillRect(x + inset + border, y + weaveHeight * weave, span - border * 2, weaveHeight);
  }
  ctx.restore();
}

const FOOTLIGHT_HOUSING_WIDTH = 0.22;
const FOOTLIGHT_HOUSING_HEIGHT = 0.12;
const FOOTLIGHT_BULB_RADIUS = 0.09;
const FOOTLIGHT_GLOW_RINGS = 2;
const FOOTLIGHT_FLICKER_SPEED = 0.07;
const FOOTLIGHT_FLICKER_DEPTH = 0.18;

/** A footlight along the trail's edge: a brass shell and a warm bulb. */
export function drawFootlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  const centreX = x + size / 2;
  const bulbY = y + size * 0.56;
  const glow = 1 - FOOTLIGHT_FLICKER_DEPTH * (1 - Math.sin(phase * FOOTLIGHT_FLICKER_SPEED));
  for (let ring = FOOTLIGHT_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = inkRgba(GOLD_INK, (0.2 * glow) / ring);
    ctx.beginPath();
    ctx.arc(centreX, bulbY, size * FOOTLIGHT_BULB_RADIUS * (1 + ring), 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = BRASS;
  ctx.fillRect(
    centreX - (size * FOOTLIGHT_HOUSING_WIDTH) / 2,
    bulbY,
    size * FOOTLIGHT_HOUSING_WIDTH,
    size * FOOTLIGHT_HOUSING_HEIGHT,
  );
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, glow);
  ctx.beginPath();
  ctx.arc(centreX, bulbY, size * FOOTLIGHT_BULB_RADIUS, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const ARCH_POST_WIDTH = 0.3;
const ARCH_POST_TOP = 0.08;
const ARCH_POST_STRIPES = 7;
const ARCH_FINIAL_RADIUS = 0.1;
const ARCH_BUNTING_COUNT = 3;
const ARCH_BUNTING_HEIGHT = 0.16;
const ARCH_BUNTING_SWAY_SPEED = 0.029;
const ARCH_BUNTING_SWAY = 0.04;

/** An act arch post: a striped column with bunting strung off its head. */
export function drawActArchPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  const postWidth = size * ARCH_POST_WIDTH;
  const postX = x + size / 2 - postWidth / 2;
  const postY = y + size * ARCH_POST_TOP;
  paintStripedPost(ctx, postX, postY, postWidth, size - size * ARCH_POST_TOP, ARCH_POST_STRIPES);

  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x + size / 2, postY, size * ARCH_FINIAL_RADIUS, 0, TAU);
  ctx.fill();

  const sway = Math.sin(phase * ARCH_BUNTING_SWAY_SPEED) * size * ARCH_BUNTING_SWAY;
  for (let flag = 0; flag < ARCH_BUNTING_COUNT; flag++) {
    const flagX = x + (size / ARCH_BUNTING_COUNT) * flag;
    const flagWidth = size / ARCH_BUNTING_COUNT;
    ctx.fillStyle = flag % 2 === 0 ? STRIPE_RED : GOLD;
    ctx.beginPath();
    ctx.moveTo(flagX, postY);
    ctx.lineTo(flagX + flagWidth, postY);
    ctx.lineTo(flagX + flagWidth / 2 + sway, postY + size * ARCH_BUNTING_HEIGHT);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const ARCH_BOARD_WIDTH_TILES = 7;
const ARCH_BOARD_HEIGHT = 0.68;
const ARCH_BOARD_TOP = 0.1;
const ARCH_BOARD_RIM = 0.06;
const ARCH_BOARD_TEXT_SIZE = 8;
const ARCH_BOARD_TEXT_DROP = 0.42;

/**
 * The painted board over an arch, naming the act behind it.
 *
 * Drawn from the tile at the centre of the arch and spilling well past it,
 * because an act's name is a sign hung across a gap rather than a decoration
 * that fits on one tile.
 */
export function drawActArchBoard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  label: string,
): void {
  const boardWidth = size * ARCH_BOARD_WIDTH_TILES;
  const boardX = x + size / 2 - boardWidth / 2;
  const boardY = y + size * ARCH_BOARD_TOP;
  const boardHeight = size * ARCH_BOARD_HEIGHT;

  ctx.save();
  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(boardX, boardY, boardWidth, boardHeight);
  ctx.fillStyle = TIMBER_MID;
  const rim = size * ARCH_BOARD_RIM;
  ctx.fillRect(boardX + rim, boardY + rim, boardWidth - rim * 2, boardHeight - rim * 2);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(1, rim / 2);
  ctx.strokeRect(boardX + rim, boardY + rim, boardWidth - rim * 2, boardHeight - rim * 2);
  ctx.restore();

  drawText(ctx, label, {
    x: x + size / 2,
    y: boardY + boardHeight * ARCH_BOARD_TEXT_DROP,
    size: ARCH_BOARD_TEXT_SIZE,
    bold: true,
    color: GOLD,
    align: 'center',
    outline: TIMBER_DARK,
  });
}

const BLEACHER_SEAT_HEIGHT = 0.22;
const BLEACHER_BODY_WIDTH = 0.34;
const BLEACHER_BODY_HEIGHT = 0.4;
const BLEACHER_HEAD_RADIUS = 0.12;
const BLEACHER_SLUMP_SPREAD = 0.22;
const BLEACHER_TILT_SPREAD = 0.5;
const HASH_SALT_SEAT_SLUMP = 17;
const HASH_SALT_SEAT_TILT = 29;

/**
 * A dead spectator still in their seat.
 *
 * Deliberately a flat silhouette: there are dozens of these in the stands, they
 * never move, and the tent's horror is in the number of them rather than in any
 * one face.
 */
export function drawBleacherDead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seed: number,
): void {
  ctx.save();
  ctx.fillStyle = TIMBER_DARK;
  ctx.fillRect(x, y + size * (1 - BLEACHER_SEAT_HEIGHT), size, size * BLEACHER_SEAT_HEIGHT);
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(x, y + size * (1 - BLEACHER_SEAT_HEIGHT), size, Math.max(1, size * 0.03));

  const slump = (hashUnit(seed, HASH_SALT_SEAT_SLUMP) - 0.5) * BLEACHER_SLUMP_SPREAD;
  const tilt = (hashUnit(seed, HASH_SALT_SEAT_TILT) - 0.5) * BLEACHER_TILT_SPREAD;
  const bodyWidth = size * BLEACHER_BODY_WIDTH;
  const bodyHeight = size * BLEACHER_BODY_HEIGHT * (1 - slump);
  const seatY = y + size * (1 - BLEACHER_SEAT_HEIGHT);
  const centreX = x + size / 2;

  ctx.fillStyle = CORPSE;
  ctx.fillRect(centreX - bodyWidth / 2, seatY - bodyHeight, bodyWidth, bodyHeight);
  ctx.beginPath();
  ctx.arc(
    centreX + tilt * size * BLEACHER_HEAD_RADIUS,
    seatY - bodyHeight - size * BLEACHER_HEAD_RADIUS * 0.6,
    size * BLEACHER_HEAD_RADIUS,
    0,
    TAU,
  );
  ctx.fill();
  ctx.restore();
}

const MENAGERIE_CAGE_INSET = 0.06;
const MENAGERIE_BAR_COUNT = 5;
const MENAGERIE_BAR_WIDTH = 0.05;
const MENAGERIE_STRAW_COUNT = 7;
const MENAGERIE_STRAW_HEIGHT = 0.14;
const MENAGERIE_OCCUPANT_RADIUS = 0.18;
const HASH_SALT_CAGE_OCCUPANT = 43;
/** Below this the cage is drawn empty — whatever was in it has already been let out. */
const MENAGERIE_OCCUPIED_THRESHOLD = 0.45;

/** A menagerie cage front: bars, straw, and sometimes a shape that has stopped moving. */
export function drawMenagerieCage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seed: number,
): void {
  ctx.save();
  const inset = size * MENAGERIE_CAGE_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = inkRgba(SHADOW_INK, 0.9);
  ctx.fillRect(x + inset, y + inset, span, span);

  if (hashUnit(seed, HASH_SALT_CAGE_OCCUPANT) > MENAGERIE_OCCUPIED_THRESHOLD) {
    ctx.fillStyle = inkRgba(CORPSE_INK, 0.85);
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.62, size * MENAGERIE_OCCUPANT_RADIUS, 0, TAU);
    ctx.fill();
  }

  ctx.strokeStyle = STRAW;
  ctx.lineWidth = 1;
  for (let straw = 0; straw < MENAGERIE_STRAW_COUNT; straw++) {
    const sx = x + inset + span * hashUnit(seed + straw, straw);
    const lean = (hashUnit(seed + straw, -straw) - 0.5) * size * MENAGERIE_STRAW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(sx, y + size - inset);
    ctx.lineTo(sx + lean, y + size - inset - size * MENAGERIE_STRAW_HEIGHT);
    ctx.stroke();
  }

  ctx.fillStyle = IRON_MID;
  const barWidth = size * MENAGERIE_BAR_WIDTH;
  for (let bar = 0; bar < MENAGERIE_BAR_COUNT; bar++) {
    const bx =
      x + inset + (span / MENAGERIE_BAR_COUNT) * bar + (span / MENAGERIE_BAR_COUNT - barWidth) / 2;
    ctx.fillRect(bx, y + inset, barWidth, span);
  }
  ctx.fillStyle = TIMBER_MID;
  ctx.fillRect(x, y, size, inset);
  ctx.fillRect(x, y + size - inset, size, inset);
  ctx.fillStyle = STRIPE_RED;
  ctx.fillRect(x, y, size, Math.max(1, inset * 0.5));
  ctx.restore();
}

const HALL_FRAME_INSET = 0.06;
const HALL_FRAME_WIDTH = 0.07;
const HALL_REFLECTION_HEIGHT = 0.44;
const HALL_REFLECTION_WIDTH = 0.2;
const HALL_REFLECTION_ALPHA = 0.3;
const HALL_GLINT_WIDTH = 0.14;
const HALL_GLINT_SPEED = 0.013;
const HALL_GLINT_ALPHA = 0.35;
const HASH_SALT_HALL_OCCUPANT = 59;
/** Above this the pane shows the cat's silhouette instead of the human's. */
const HALL_CAT_REFLECTION_THRESHOLD = 0.5;
const HALL_CAT_EAR_HEIGHT = 0.1;

/** A hall-of-mirrors pane: dim glass with a crawler faked into it and a travelling glint. */
export function drawMirrorHallGlass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seed: number,
  phase: number,
): void {
  ctx.save();
  const inset = size * HALL_FRAME_INSET;
  const span = size - inset * 2;
  ctx.fillStyle = inkRgba(GLASS_INK, 0.22);
  ctx.fillRect(x + inset, y + inset, span, span);

  // Not the real crawlers: the hall's whole trick is that the figures in the
  // glass are somebody else's reflection, and a faithful one would be read as
  // the player's own position.
  const catPane = hashUnit(seed, HASH_SALT_HALL_OCCUPANT) > HALL_CAT_REFLECTION_THRESHOLD;
  const figureWidth = size * HALL_REFLECTION_WIDTH;
  const figureHeight = size * HALL_REFLECTION_HEIGHT * (catPane ? 0.6 : 1);
  const figureX = x + size / 2 - figureWidth / 2;
  const figureY = y + size - inset - figureHeight;
  ctx.fillStyle = inkRgba(SHADOW_INK, HALL_REFLECTION_ALPHA);
  ctx.fillRect(figureX, figureY, figureWidth, figureHeight);
  if (catPane) {
    ctx.beginPath();
    ctx.moveTo(figureX, figureY);
    ctx.lineTo(figureX + figureWidth * 0.3, figureY - size * HALL_CAT_EAR_HEIGHT);
    ctx.lineTo(figureX + figureWidth * 0.5, figureY);
    ctx.lineTo(figureX + figureWidth * 0.7, figureY - size * HALL_CAT_EAR_HEIGHT);
    ctx.lineTo(figureX + figureWidth, figureY);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(figureX + figureWidth / 2, figureY, figureWidth * 0.4, 0, TAU);
    ctx.fill();
  }

  const travel = (phase * HALL_GLINT_SPEED + hashUnit(seed, seed)) % 1;
  ctx.fillStyle = inkRgba(LIMELIGHT_INK, HALL_GLINT_ALPHA);
  ctx.fillRect(x + inset + span * travel, y + inset, size * HALL_GLINT_WIDTH, span);

  ctx.strokeStyle = GOLD_DEEP;
  ctx.lineWidth = Math.max(1, size * HALL_FRAME_WIDTH);
  ctx.strokeRect(x + inset, y + inset, span, span);
  ctx.restore();
}
