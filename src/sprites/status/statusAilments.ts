/**
 * The wet, sickening statuses: `poison`, `spit_venom` and `numbed`.
 *
 * Poison and spit venom read as "something is inside you and it is getting
 * worse", and the cue that carries that is the body tint. A green cloud drawn
 * *beside* a character is weather; the same green multiplied *into* the
 * character's own art is illness. The particles on top only say which illness
 * it is — bubbles boiling out of the skin for poison, acid running off and
 * eating the floor for venom.
 *
 * Numbing venom only takes the legs, so its coat stops at the hips: a dull
 * green-grey creeping up from the feet, a wet sheen crawling slowly down it,
 * and thick drops that take their time letting go.
 */

import type { SilhouetteLayer } from '../../core/spriteAssets/silhouetteComposite';
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
  /** Bubbles and drips. */
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

const VENOM: OozePalette = {
  tint: [156, 190, 20],
  haze: [124, 152, 12],
  fluid: [168, 208, 8],
  sheen: [232, 255, 120],
};

/** Duller and greyer than poison: flesh going dead rather than flesh going bad. */
const NUMB: OozePalette = {
  tint: [132, 172, 100],
  haze: [96, 120, 78],
  fluid: [124, 168, 76],
  sheen: [214, 238, 176],
};

/**
 * How far the tint pulls the art toward the sickly colour. Multiply keeps the
 * sprite's own shading, so this can sit high without flattening the figure.
 */
const POISON_TINT_ALPHA = 0.55;
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

const PUDDLE_RADIUS_X = 1.5;
const PUDDLE_RADIUS_Y = 0.16;
const PUDDLE_ALPHA = 0.6;
const SIZZLE_COUNT = 7;
const SIZZLE_RATE_PER_MS = 0.0013;
const SIZZLE_RISE = 0.3;
const SIZZLE_SPREAD = 0.9;
const SIZZLE_RADIUS = 0.16;
const SIZZLE_ALPHA = 0.55;

/** Where the numb coat fades out, as a share of the figure's height above its feet: the hips. */
const NUMB_COAT_TOP_UP = 0.5;
/** Where the coat reaches full strength, so it deepens toward the feet instead of ending in a hard band. */
const NUMB_COAT_FULL_UP = 0.15;
const NUMB_COAT_ALPHA = 0.55;
/**
 * The wet band crawling down the legs. Slow on purpose: its pace is the
 * sluggishness the status is about.
 */
const NUMB_SHEEN_RATE_PER_MS = 0.0004;
/** Half the sheen band's height, as a share of the figure's height. */
const NUMB_SHEEN_HALF_BAND = 0.08;
const NUMB_SHEEN_ALPHA = 0.6;
/** Offsets the sheen's clock per character so a numbed pack does not shine in step. */
const NUMB_SHEEN_SEED_KEY = 5;

const NUMB_DRIP_COUNT = 4;
const NUMB_DRIP_RATE_PER_MS = 0.0003;
/** Share of a drop's life spent hanging off the knee and stretching before it lets go. */
const NUMB_DRIP_HANG = 0.65;
/** The drops form at the knees, the top of the part the venom has taken. */
const NUMB_DRIP_START_UP = 0.3;
const NUMB_DRIP_ACROSS_SPREAD = 0.2;
const NUMB_DRIP_RADIUS = 0.07;
const NUMB_DRIP_NECK_START = 0.05;
/** How long the neck has drawn out by the moment the drop lets go: thick fluid, slow to part. */
const NUMB_DRIP_NECK_END = 0.32;
const NUMB_POOL_RADIUS_X = 0.85;
const NUMB_POOL_RADIUS_Y = 0.1;
const NUMB_POOL_ALPHA = 0.45;

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

export function venomBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return tintLayer(f, VENOM, VENOM_TINT_ALPHA);
}

/**
 * The numbed legs: a coat laid over the art, opaque enough to read on dark
 * trousers, that fades out at the hips, then a wet sheen sliding down through it.
 */
export function numbedBodyLayers(f: StatusVisualFrame): readonly SilhouetteLayer[] {
  const coat: SilhouetteLayer = {
    paint: (target, box) => {
      const feetY = box.y + box.height;
      const legGradient = target.createLinearGradient(
        0,
        feetY,
        0,
        feetY - box.height * NUMB_COAT_TOP_UP,
      );
      const fullStop = NUMB_COAT_FULL_UP / NUMB_COAT_TOP_UP;
      legGradient.addColorStop(0, rgba(NUMB.tint, 1));
      legGradient.addColorStop(fullStop, rgba(NUMB.tint, 1));
      legGradient.addColorStop(1, rgba(NUMB.tint, 0));
      target.fillStyle = legGradient;
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    alpha: NUMB_COAT_ALPHA * f.fade,
  };

  const sheenPhase = particlePhase(f, NUMB_SHEEN_SEED_KEY, NUMB_SHEEN_RATE_PER_MS);
  const sheenUp = NUMB_COAT_TOP_UP * (1 - sheenPhase);
  const sheen: SilhouetteLayer = {
    paint: (target, box) => {
      const feetY = box.y + box.height;
      const centreY = feetY - box.height * sheenUp;
      const halfBand = box.height * NUMB_SHEEN_HALF_BAND;
      const band = target.createLinearGradient(0, centreY - halfBand, 0, centreY + halfBand);
      band.addColorStop(0, rgba(NUMB.sheen, 0));
      band.addColorStop(HALF, rgba(NUMB.sheen, 1));
      band.addColorStop(1, rgba(NUMB.sheen, 0));
      target.fillStyle = band;
      target.fillRect(box.x, centreY - halfBand, box.width, halfBand * 2);
    },
    blend: 'screen',
    alpha: NUMB_SHEEN_ALPHA * f.fade,
  };

  return [coat, sheen];
}

/** Thick drops gathering at the knees, hanging, and letting go into a dull pool at the feet. */
export function drawNumbed(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawGroundPool(
    ctx,
    NUMB.fluid,
    f.centerX,
    f.footY,
    f.width * NUMB_POOL_RADIUS_X,
    f.height * NUMB_POOL_RADIUS_Y,
    NUMB_POOL_ALPHA * f.fade,
  );

  for (let i = 0; i < NUMB_DRIP_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i, NUMB_DRIP_RATE_PER_MS);
    const x = bodyX(
      f,
      hashRange(key, HALF - NUMB_DRIP_ACROSS_SPREAD, HALF + NUMB_DRIP_ACROSS_SPREAD),
    );
    const maxRadius = f.width * NUMB_DRIP_RADIUS;

    let y: number;
    let radius: number;
    let neck: number;
    let alpha: number;
    if (phase < NUMB_DRIP_HANG) {
      const hang = phase / NUMB_DRIP_HANG;
      radius = maxRadius * hang;
      neck = f.width * (NUMB_DRIP_NECK_START + (NUMB_DRIP_NECK_END - NUMB_DRIP_NECK_START) * hang);
      // The belly sags as the neck draws out, so the drop is seen to stretch.
      y = bodyY(f, NUMB_DRIP_START_UP) + neck;
      alpha = 1;
    } else {
      const fall = (phase - NUMB_DRIP_HANG) / (1 - NUMB_DRIP_HANG);
      const releaseY = bodyY(f, NUMB_DRIP_START_UP) + f.width * NUMB_DRIP_NECK_END;
      // Squared so the drop accelerates once it has let go.
      y = releaseY + (f.footY - releaseY) * fall * fall;
      radius = maxRadius;
      neck = f.width * NUMB_DRIP_NECK_START;
      alpha = 1 - fall;
    }
    alpha *= f.fade;
    if (alpha <= 0 || radius <= 0) continue;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(NUMB.fluid, 1);
    drawDroplet(ctx, x, y, radius, neck);
    ctx.fillStyle = rgba(NUMB.sheen, 1);
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

export function drawPoison(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawHaze(ctx, f, POISON, 0);
  drawBubbles(ctx, f, POISON, HAZE_COUNT);
  drawDrips(ctx, f, POISON, HAZE_COUNT + BUBBLE_COUNT);
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
