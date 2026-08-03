/**
 * The wet, sickening statuses: `poison`, `sepsis` and `spit_venom`.
 *
 * All three read as "something is inside you and it is getting worse", and the
 * cue that carries that is the body tint. A green cloud drawn *beside* a
 * character is weather; the same green multiplied *into* the character's own
 * art is illness. The particles on top only say which illness it is — bubbles
 * boiling out of the skin for poison, pustules bursting for sepsis, acid
 * running off and eating the floor for venom.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import {
  bodyX,
  bodyY,
  drawDroplet,
  drawGlow,
  drawGroundPool,
  hashRange,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;

/** The colours one kind of contamination shows in. */
interface OozePalette {
  /** Multiplied into the character's art to sicken it. */
  readonly tint: Rgb;
  /** The haze hanging around the body. */
  readonly haze: Rgb;
  /** Bubbles, pustules and drips. */
  readonly fluid: Rgb;
  /** The bright highlight on those, so they read as wet. */
  readonly sheen: Rgb;
}

const POISON: OozePalette = {
  tint: [104, 196, 78],
  haze: [74, 168, 62],
  fluid: [42, 176, 70],
  sheen: [186, 250, 140],
};

const SEPSIS: OozePalette = {
  tint: [138, 150, 44],
  haze: [96, 104, 28],
  fluid: [154, 176, 30],
  sheen: [232, 246, 128],
};

const VENOM: OozePalette = {
  tint: [156, 190, 20],
  haze: [124, 152, 12],
  fluid: [168, 208, 8],
  sheen: [232, 255, 120],
};

/**
 * How far the tint pulls the art toward the sickly colour. Multiply keeps the
 * sprite's own shading, so this can sit high without flattening the figure.
 */
const POISON_TINT_ALPHA = 0.55;
const SEPSIS_TINT_ALPHA = 0.68;
const VENOM_TINT_ALPHA = 0.4;
const TINT_PULSE_SPEED = 0.0035;
const TINT_PULSE_DEPTH = 0.18;
const AILMENT_RIM_ALPHA = 0.4;

const HAZE_COUNT = 6;
const HAZE_RATE_PER_MS = 0.00021;
const HAZE_ORBIT_REACH = 0.45;
const HAZE_SWIRL_REACH = 0.3;
/** The haze hangs at chest height and only creeps upward. */
const HAZE_START_UP = 0.45;
const HAZE_RISE = 0.5;
const HAZE_RADIUS_START = 0.5;
const HAZE_RADIUS_END = 0.9;
const HAZE_ALPHA = 0.36;

const BUBBLE_COUNT = 6;
const BUBBLE_RATE_PER_MS = 0.00075;
/** Bubbles surface anywhere on the torso and climb clear of the head. */
const BUBBLE_START_UP = 0.35;
const BUBBLE_RISE = 0.75;
/**
 * Half-width of the band particles surface in, as a share of the figure's own
 * width. Anything approaching 0.5 puts them off the edge of the body, where they
 * stop reading as *coming out of* the character and start reading as weather.
 */
const BUBBLE_ACROSS_SPREAD = 0.32;
const BUBBLE_RADIUS_MIN = 0.07;
const BUBBLE_RADIUS_MAX = 0.14;
/** Fraction of a bubble's life spent intact before it breaks open. */
const BUBBLE_POP_START = 0.78;
/**
 * How far the burst ring opens past the bubble that made it. Kept small: a ring
 * that expands much further stops reading as a skin breaking and starts reading
 * as a separate hoop drifting away.
 */
const BUBBLE_POP_REACH = 0.9;
/** Rate the bubble fades out over, independent of how far its ring opens. */
const BUBBLE_FADE_RATE = 2.2;
const BUBBLE_LINE_WIDTH = 1.4;
const BUBBLE_SHEEN_OFFSET = 0.35;
const BUBBLE_SHEEN_SCALE = 0.34;

const DRIP_COUNT = 7;
const DRIP_RATE_PER_MS = 0.00042;
/** Drips form on the torso and fall to just past the feet. */
const DRIP_START_UP = 0.6;
const DRIP_FALL = 0.62;
const DRIP_ACROSS_SPREAD = 0.38;
const DRIP_RADIUS = 0.08;
const DRIP_NECK = 0.16;
/** Last stretch of the fall, over which the drop fades out. */
const DRIP_LAND_START = 0.8;

const PUSTULE_COUNT = 4;
const PUSTULE_RATE_PER_MS = 0.00034;
const PUSTULE_RADIUS = 0.22;
const PUSTULE_UP_MIN = 0.25;
const PUSTULE_UP_MAX = 0.85;
/** A pustule spends most of its life swelling, then bursts all at once. */
const PUSTULE_BURST_START = 0.72;
const PUSTULE_SWELL_FADE_IN = 5;
const PUSTULE_SPATTER_COUNT = 5;
const PUSTULE_SPATTER_REACH = 0.8;
const PUSTULE_SPATTER_RADIUS = 0.09;

const PUDDLE_RADIUS_X = 1.5;
const PUDDLE_RADIUS_Y = 0.16;
const PUDDLE_ALPHA = 0.6;
const SIZZLE_COUNT = 7;
const SIZZLE_RATE_PER_MS = 0.0013;
const SIZZLE_RISE = 0.3;
const SIZZLE_SPREAD = 0.9;
const SIZZLE_RADIUS = 0.16;
const SIZZLE_ALPHA = 0.55;

function tintLayer(f: StatusVisualFrame, palette: OozePalette, strength: number): SilhouetteLayer {
  const pulse = 1 - TINT_PULSE_DEPTH * (HALF + HALF * Math.sin(f.timeMs * TINT_PULSE_SPEED));
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(palette.tint, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    blend: 'multiply',
    alpha: strength * pulse * f.fade,
    rimColor: rgba(palette.sheen, 1),
    rimAlpha: AILMENT_RIM_ALPHA * pulse * f.fade,
  };
}

export function poisonBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return tintLayer(f, POISON, POISON_TINT_ALPHA);
}

export function sepsisBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return tintLayer(f, SEPSIS, SEPSIS_TINT_ALPHA);
}

export function venomBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return tintLayer(f, VENOM, VENOM_TINT_ALPHA);
}

export function drawPoison(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawHaze(ctx, f, POISON, 0);
  drawBubbles(ctx, f, POISON, HAZE_COUNT);
  drawDrips(ctx, f, POISON, HAZE_COUNT + BUBBLE_COUNT);
}

export function drawSepsis(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawHaze(ctx, f, SEPSIS, 0);
  drawPustules(ctx, f, SEPSIS, HAZE_COUNT);
  drawDrips(ctx, f, SEPSIS, HAZE_COUNT + PUSTULE_COUNT);
}

export function drawSpitVenom(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawAcidPuddle(ctx, f, VENOM);
  drawDrips(ctx, f, VENOM, 0);
  drawSizzle(ctx, f, VENOM, DRIP_COUNT);
}

/** Slow, heavy vapour clinging to the figure rather than rising off it. */
function drawHaze(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
  indexOffset: number,
): void {
  for (let i = 0; i < HAZE_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, HAZE_RATE_PER_MS);
    const alpha = Math.sin(phase * Math.PI) * HAZE_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const orbit = hashRange(key, -1, 1) * f.width * HAZE_ORBIT_REACH;
    const swirl = Math.sin(phase * Math.PI * 2 + key) * f.width * HAZE_SWIRL_REACH;
    const radius = f.width * (HAZE_RADIUS_START + (HAZE_RADIUS_END - HAZE_RADIUS_START) * phase);

    drawGlow(
      ctx,
      palette.haze,
      f.centerX + orbit + swirl,
      bodyY(f, HAZE_START_UP + HAZE_RISE * phase),
      radius,
      alpha,
    );
  }
}

/** Gas boiling out of the skin: a taut bead that swells, rises and breaks open. */
function drawBubbles(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
  indexOffset: number,
): void {
  ctx.lineWidth = BUBBLE_LINE_WIDTH;
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, BUBBLE_RATE_PER_MS);
    const alpha = Math.min(1, (1 - phase) * BUBBLE_FADE_RATE) * f.fade;
    if (alpha <= 0) continue;

    const x = bodyX(f, hashRange(key, HALF - BUBBLE_ACROSS_SPREAD, HALF + BUBBLE_ACROSS_SPREAD));
    const y = bodyY(f, BUBBLE_START_UP + BUBBLE_RISE * phase);
    const radius = f.width * hashRange(key + 1, BUBBLE_RADIUS_MIN, BUBBLE_RADIUS_MAX);

    ctx.globalAlpha = alpha;
    if (phase < BUBBLE_POP_START) {
      ctx.fillStyle = rgba(palette.fluid, 1);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(palette.sheen, 1);
      ctx.beginPath();
      ctx.arc(
        x - radius * BUBBLE_SHEEN_OFFSET,
        y - radius * BUBBLE_SHEEN_OFFSET,
        radius * BUBBLE_SHEEN_SCALE,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } else {
      const burst = (phase - BUBBLE_POP_START) / (1 - BUBBLE_POP_START);
      ctx.strokeStyle = rgba(palette.sheen, 1);
      ctx.beginPath();
      ctx.arc(x, y, radius * (1 + burst * BUBBLE_POP_REACH), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Blisters that swell on the skin and spray when they go. */
function drawPustules(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
  indexOffset: number,
): void {
  for (let i = 0; i < PUSTULE_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, PUSTULE_RATE_PER_MS);
    const x = bodyX(f, hashRange(key, HALF - BUBBLE_ACROSS_SPREAD, HALF + BUBBLE_ACROSS_SPREAD));
    const y = bodyY(f, hashRange(key + 1, PUSTULE_UP_MIN, PUSTULE_UP_MAX));
    const radius = f.width * PUSTULE_RADIUS;

    if (phase < PUSTULE_BURST_START) {
      const swell = phase / PUSTULE_BURST_START;
      ctx.globalAlpha = Math.min(1, swell * PUSTULE_SWELL_FADE_IN) * f.fade;
      ctx.fillStyle = rgba(palette.fluid, 1);
      ctx.beginPath();
      ctx.arc(x, y, radius * swell, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(palette.sheen, 1);
      ctx.beginPath();
      ctx.arc(
        x - radius * swell * BUBBLE_SHEEN_OFFSET,
        y - radius * swell * BUBBLE_SHEEN_OFFSET,
        radius * swell * BUBBLE_SHEEN_SCALE,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      continue;
    }

    const burst = (phase - PUSTULE_BURST_START) / (1 - PUSTULE_BURST_START);
    ctx.globalAlpha = (1 - burst) * f.fade;
    ctx.fillStyle = rgba(palette.fluid, 1);
    for (let drop = 0; drop < PUSTULE_SPATTER_COUNT; drop++) {
      const angle = (drop / PUSTULE_SPATTER_COUNT) * Math.PI * 2 + key;
      const reach = f.width * PUSTULE_SPATTER_REACH * burst;
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(angle) * reach,
        y + Math.sin(angle) * reach,
        f.width * PUSTULE_SPATTER_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

/** Fluid running off the figure and falling clear of it. */
function drawDrips(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
  indexOffset: number,
): void {
  for (let i = 0; i < DRIP_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, DRIP_RATE_PER_MS);
    // Only the last stretch fades, so a drop stays solid all the way down and
    // reads as liquid rather than as a dissolving spark.
    const alpha =
      (phase < DRIP_LAND_START ? 1 : 1 - (phase - DRIP_LAND_START) / (1 - DRIP_LAND_START)) *
      f.fade;
    if (alpha <= 0) continue;

    const x = bodyX(f, hashRange(key, HALF - DRIP_ACROSS_SPREAD, HALF + DRIP_ACROSS_SPREAD));
    // Squared so the drop accelerates, which is the whole difference between
    // falling and drifting.
    const y = bodyY(f, DRIP_START_UP - DRIP_FALL * phase * phase);
    const radius = f.width * DRIP_RADIUS;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(palette.fluid, 1);
    drawDroplet(ctx, x, y, radius, f.width * DRIP_NECK);
    ctx.fillStyle = rgba(palette.sheen, 1);
    ctx.beginPath();
    ctx.arc(
      x - radius * BUBBLE_SHEEN_OFFSET,
      y - radius * BUBBLE_SHEEN_OFFSET,
      radius * BUBBLE_SHEEN_SCALE,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** The pool of acid a spit-covered target leaves under itself. */
function drawAcidPuddle(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
): void {
  drawGroundPool(
    ctx,
    palette.fluid,
    f.centerX,
    f.footY,
    f.width * PUDDLE_RADIUS_X,
    f.height * PUDDLE_RADIUS_Y,
    PUDDLE_ALPHA * f.fade,
  );
}

/** Wisps coming off the acid, which is what says it is still eating away. */
function drawSizzle(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: OozePalette,
  indexOffset: number,
): void {
  for (let i = 0; i < SIZZLE_COUNT; i++) {
    const key = f.seed + (i + indexOffset) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + indexOffset, SIZZLE_RATE_PER_MS);
    const alpha = (1 - phase) * SIZZLE_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const x = bodyX(f, hashRange(key, HALF - SIZZLE_SPREAD, HALF + SIZZLE_SPREAD));
    drawGlow(
      ctx,
      palette.sheen,
      x,
      bodyY(f, SIZZLE_RISE * phase),
      f.width * SIZZLE_RADIUS * (1 + phase),
      alpha,
    );
  }
}
