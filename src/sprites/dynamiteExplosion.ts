/**
 * A dynamite blast, painted as a pure function of its age.
 *
 * Nothing is simulated between frames: every billow, spark and chunk of rubble
 * is reconstructed from the blast's seed and how many frames it has been
 * burning, so a blast costs no per-frame bookkeeping and rewinds cleanly with a
 * checkpoint. What sells it as a real explosion rather than a cartoon one is
 * the order things happen in — a flash that lights the room for a few frames,
 * a fireball that boils outward and lifts as it cools from white through
 * orange to a sooty red, a ground-hugging shock of dust, rubble thrown on
 * ballistic arcs that lands and stays, and a column of smoke that outlives the
 * fire by a second.
 *
 * The fire is shaded with the game's one flame palette (`flameStamps`), so a
 * blast and a burning tree are visibly the same fire.
 */

import type { CanvasSurface } from '../core/canvasSurface';
import {
  bakeSoftDisc,
  FLAME_BODY_TIERS,
  FLAME_GLOW_INK,
  gradientStopRgba,
  hashUnit,
  type FlameInk,
} from './flameStamps';

/** Frames from detonation until the last of the smoke is gone. */
export const EXPLOSION_TOTAL_FRAMES = 110;
/** Frames the ground stays blackened after a blast, the last share of it fading. */
export const SCORCH_TOTAL_FRAMES = 1200;
const SCORCH_FADE_SHARE = 0.4;

const TAU = Math.PI * 2;
/**
 * How much a length laid on the floor is foreshortened on screen. The camera
 * looks down at an angle, so a ring of dust around the blast is an ellipse
 * wider than it is tall, while the fireball — which stands up off the floor —
 * is round.
 */
const GROUND_SQUASH = 0.55;

/** One stick's share of a blast: where it went off, and how many frames after the first. */
export interface BlastCore {
  readonly x: number;
  readonly y: number;
  readonly delayFrames: number;
  readonly seed: number;
}

/** Everything the painter needs about one blast, in world pixels. */
export interface ExplosionPicture {
  readonly x: number;
  readonly y: number;
  /** The whole blast's reach, which the shock ring and the dust front travel out to. */
  readonly radius: number;
  /** The reach of each stick's own fireball. */
  readonly coreRadius: number;
  readonly cores: ReadonlyArray<BlastCore>;
  readonly ageFrames: number;
}

// ── Baked inks ───────────────────────────────────────────────────────────────

/** The instant of detonation is white: hotter than anything else the palette paints. */
const WHITE_HOT_INK: FlameInk = { red: 255, green: 250, blue: 228, alpha: 1 };
const YELLOW_HOT_INK: FlameInk = { red: 255, green: 222, blue: 128, alpha: 1 };
/**
 * Smoke, darkest first. The first is lit from underneath by the fireball it is
 * rising off, which is why it carries red; the rest are the soot it cools into.
 */
const SMOKE_INKS: ReadonlyArray<FlameInk> = [
  { red: 96, green: 52, blue: 34, alpha: 1 },
  { red: 70, green: 64, blue: 60, alpha: 1 },
  { red: 92, green: 88, blue: 84, alpha: 1 },
  { red: 112, green: 108, blue: 104, alpha: 1 },
];
/** The soot a cooling billow chars to before it thins into the smoke column. */
const SOOT_INK: FlameInk = { red: 34, green: 28, blue: 26, alpha: 1 };
/**
 * How many of the shared flame tiers a billow cools through. The deepest tiers
 * are the translucent tips of a standing flame; a fireball chars to soot before
 * it ever gets that red, so they are left out.
 */
const FIREBALL_FLAME_TIERS = 6;
const DUST_INK: FlameInk = { red: 128, green: 112, blue: 94, alpha: 1 };
const SCORCH_INK: FlameInk = { red: 10, green: 8, blue: 6, alpha: 1 };
const DISC_BAKE_PX = 64;
const GLOW_BAKE_PX = 128;

interface ExplosionStamps {
  /** Fire discs from hottest to coolest: white, yellow, then the shared flame tiers. */
  readonly fire: ReadonlyArray<CanvasSurface>;
  readonly smoke: ReadonlyArray<CanvasSurface>;
  readonly soot: CanvasSurface;
  readonly dust: CanvasSurface;
  readonly scorch: CanvasSurface;
  readonly glow: CanvasSurface;
  readonly flash: CanvasSurface;
}

let bakedStamps: ExplosionStamps | null = null;

function stamps(): ExplosionStamps {
  bakedStamps ??= {
    fire: [WHITE_HOT_INK, YELLOW_HOT_INK, ...FLAME_BODY_TIERS.slice(0, FIREBALL_FLAME_TIERS)].map(
      (ink) => bakeSoftDisc({ ...ink, alpha: 1 }, DISC_BAKE_PX),
    ),
    smoke: SMOKE_INKS.map((ink) => bakeSoftDisc(ink, DISC_BAKE_PX)),
    soot: bakeSoftDisc(SOOT_INK, DISC_BAKE_PX),
    dust: bakeSoftDisc(DUST_INK, DISC_BAKE_PX),
    scorch: bakeSoftDisc(SCORCH_INK, DISC_BAKE_PX),
    glow: bakeSoftDisc(FLAME_GLOW_INK, GLOW_BAKE_PX),
    flash: bakeSoftDisc(WHITE_HOT_INK, GLOW_BAKE_PX),
  };
  return bakedStamps;
}

function stampDisc(
  ctx: CanvasRenderingContext2D,
  stamp: CanvasSurface,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  if (alpha <= 0 || radiusX <= 0 || radiusY <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(stamp, cx - radiusX, cy - radiusY, radiusX * 2, radiusY * 2);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Fast start, long settle. Cubic rather than the quadratic most limbs use: a
 * blast front covers most of its distance in its first few frames and then
 * all but stops against the air.
 */
function easeOutCubic(t: number): number {
  const remaining = 1 - clamp01(t);
  return 1 - remaining * remaining * remaining;
}

/**
 * Distinct salts per particle family, so a billow and a spark with the same
 * index never share their random draws and move in lockstep.
 */
const SALT_BILLOW = 101;
const SALT_SMOKE = 211;
const SALT_SPARK = 307;
const SALT_DEBRIS = 401;
const SALT_DUST = 503;
const SALT_SCORCH = 601;
/** Random draws each particle takes; also the stride between particles' hash inputs. */
const DRAWS_PER_PARTICLE = 8;

/** The `draw`th repeatable random number of particle `index` in a family. */
function draw(seed: number, salt: number, index: number, drawIndex: number): number {
  return hashUnit(seed + salt, index * DRAWS_PER_PARTICLE + drawIndex);
}

// ── Flash ────────────────────────────────────────────────────────────────────

/** Frames the detonation lights the room for. */
const FLASH_FRAMES = 10;
/** Frames over which the flash falls to a third of its brightness. */
const FLASH_DECAY_FRAMES = 2.5;
/** How far past the blast's reach the flash lights the floor. */
const FLASH_REACH = 1.6;
const FLASH_PEAK_ALPHA = 0.85;
/** The white-hot centre of the flash, as a share of the fireball's reach. */
const FLASH_CORE_REACH = 0.42;
const FLASH_CORE_FRAMES = 6;

function paintFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  age: number,
): void {
  if (age >= FLASH_FRAMES) return;
  const brightness = FLASH_PEAK_ALPHA * Math.exp(-age / FLASH_DECAY_FRAMES);
  const { glow, flash } = stamps();
  const reach = radius * FLASH_REACH;
  stampDisc(ctx, glow, x, y, reach, reach * GROUND_SQUASH, brightness);
  if (age < FLASH_CORE_FRAMES) {
    const coreReach = radius * FLASH_CORE_REACH * (1 + age / FLASH_CORE_FRAMES);
    stampDisc(ctx, flash, x, y, coreReach, coreReach, 1 - age / FLASH_CORE_FRAMES);
  }
}

// ── Fireball ─────────────────────────────────────────────────────────────────

const BILLOW_COUNT = 30;
/** Frames a billow takes to reach its full throw from the centre. */
const BILLOW_EXPAND_FRAMES = 11;
const BILLOW_MAX_START_DELAY = 5;
const BILLOW_MIN_LIFE = 22;
const BILLOW_LIFE_SPREAD = 22;
/** How far from the centre a billow is thrown, as a share of the fireball's reach. */
const BILLOW_MAX_THROW = 0.7;
const BILLOW_MIN_SIZE = 0.13;
const BILLOW_SIZE_SPREAD = 0.17;
/** Size a billow starts at, as a share of its full size, before the expansion inflates it. */
const BILLOW_BIRTH_SIZE = 0.45;
/** Extra size a billow puts on as it cools and spreads. */
const BILLOW_COOLING_GROWTH = 0.4;
/** How high the fireball lifts off the floor by the time a billow has cooled, per unit reach. */
const BILLOW_MIN_LIFT = 0.12;
const BILLOW_LIFT_SPREAD = 0.4;
/** Above one, the fireball hangs before it climbs, the way hot gas does. */
const BILLOW_LIFT_EXPONENT = 1.4;
/** The first frames of a billow's life at which it is still white-hot. */
const BILLOW_WHITE_SHARE = 0.08;
/** Makes a billow hold its opacity through its bright middle and fade at the end. */
const BILLOW_FADE_EXPONENT = 0.7;
/** Billows hotter than this are also laid down additively, so the core blooms. */
const BILLOW_BLOOM_HEAT = 0.5;
const BILLOW_BLOOM_ALPHA = 0.55;
/**
 * How a billow chars as it cools: the soot laid over it thickens with this
 * power of how far it has cooled, so the glow survives inside the smoke for a
 * while rather than the fire simply dimming.
 */
const BILLOW_CHAR_EXPONENT = 1.6;
const BILLOW_CHAR_PEAK_ALPHA = 0.85;

interface BillowState {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 0 at birth, 1 when burned out. */
  readonly cooled: number;
}

function billowAt(
  core: BlastCore,
  coreRadius: number,
  index: number,
  age: number,
): BillowState | null {
  const startDelay = draw(core.seed, SALT_BILLOW, index, 0) * BILLOW_MAX_START_DELAY;
  const life = BILLOW_MIN_LIFE + draw(core.seed, SALT_BILLOW, index, 1) * BILLOW_LIFE_SPREAD;
  const lived = age - startDelay;
  if (lived < 0 || lived >= life) return null;
  const cooled = lived / life;
  const expansion = easeOutCubic(clamp01(lived / BILLOW_EXPAND_FRAMES));
  const angle = draw(core.seed, SALT_BILLOW, index, 2) * TAU;
  // Square-rooted so billows fill the disc evenly rather than bunching at the centre.
  const throwShare = Math.sqrt(draw(core.seed, SALT_BILLOW, index, 3)) * BILLOW_MAX_THROW;
  const throwPx = throwShare * coreRadius * expansion;
  const liftShare = BILLOW_MIN_LIFT + draw(core.seed, SALT_BILLOW, index, 4) * BILLOW_LIFT_SPREAD;
  const liftPx = liftShare * coreRadius * Math.pow(cooled, BILLOW_LIFT_EXPONENT);
  const sizeShare = BILLOW_MIN_SIZE + draw(core.seed, SALT_BILLOW, index, 5) * BILLOW_SIZE_SPREAD;
  const growth = BILLOW_BIRTH_SIZE + (1 - BILLOW_BIRTH_SIZE) * expansion;
  return {
    x: core.x + Math.cos(angle) * throwPx,
    y: core.y + Math.sin(angle) * throwPx * GROUND_SQUASH - liftPx,
    radius: sizeShare * coreRadius * growth * (1 + BILLOW_COOLING_GROWTH * cooled),
    cooled,
  };
}

/** Which baked fire disc a billow this far through its life is shaded with. */
function fireStampFor(cooled: number): CanvasSurface | null {
  const { fire } = stamps();
  if (cooled < BILLOW_WHITE_SHARE) return fire[0] ?? null;
  const coolingShare = (cooled - BILLOW_WHITE_SHARE) / (1 - BILLOW_WHITE_SHARE);
  const firstCoolingTier = 1;
  const tierSpan = fire.length - firstCoolingTier;
  const tier = firstCoolingTier + Math.min(tierSpan - 1, Math.floor(coolingShare * tierSpan));
  return fire[tier] ?? null;
}

function paintFireball(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
): void {
  const { glow, soot } = stamps();
  for (let index = 0; index < BILLOW_COUNT; index++) {
    const billow = billowAt(core, coreRadius, index, age);
    if (billow === null) continue;
    const stamp = fireStampFor(billow.cooled);
    if (stamp === null) continue;
    const opacity = Math.pow(1 - billow.cooled, BILLOW_FADE_EXPONENT);
    stampDisc(ctx, stamp, billow.x, billow.y, billow.radius, billow.radius, opacity);
    const char = BILLOW_CHAR_PEAK_ALPHA * Math.pow(billow.cooled, BILLOW_CHAR_EXPONENT);
    stampDisc(ctx, soot, billow.x, billow.y, billow.radius, billow.radius, char * opacity);
    const heat = 1 - billow.cooled;
    if (heat > BILLOW_BLOOM_HEAT) {
      const previous = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      const bloom = (heat - BILLOW_BLOOM_HEAT) / (1 - BILLOW_BLOOM_HEAT);
      stampDisc(
        ctx,
        glow,
        billow.x,
        billow.y,
        billow.radius,
        billow.radius,
        bloom * BILLOW_BLOOM_ALPHA,
      );
      ctx.globalCompositeOperation = previous;
    }
  }
}

// ── Smoke ────────────────────────────────────────────────────────────────────

const SMOKE_COUNT = 18;
const SMOKE_MIN_START = 10;
const SMOKE_START_SPREAD = 18;
const SMOKE_MIN_LIFE = 58;
const SMOKE_LIFE_SPREAD = 22;
const SMOKE_MAX_THROW = 0.55;
/** How much further out a puff drifts by the time it has thinned away. */
const SMOKE_DRIFT_GROWTH = 0.6;
const SMOKE_MIN_LIFT = 0.6;
const SMOKE_LIFT_SPREAD = 0.7;
const SMOKE_MIN_SIZE = 0.18;
const SMOKE_SIZE_SPREAD = 0.12;
const SMOKE_GROWTH = 1.3;
const SMOKE_PEAK_ALPHA = 0.62;
/** Share of a puff's life it takes to thicken in, so smoke never pops into existence. */
const SMOKE_FADE_IN_SHARE = 0.2;
const SMOKE_FADE_OUT_EXPONENT = 1.4;

function paintSmoke(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
): void {
  const { smoke } = stamps();
  for (let index = 0; index < SMOKE_COUNT; index++) {
    const start = SMOKE_MIN_START + draw(core.seed, SALT_SMOKE, index, 0) * SMOKE_START_SPREAD;
    const life = SMOKE_MIN_LIFE + draw(core.seed, SALT_SMOKE, index, 1) * SMOKE_LIFE_SPREAD;
    const lived = age - start;
    if (lived < 0 || lived >= life) continue;
    const progress = lived / life;
    const angle = draw(core.seed, SALT_SMOKE, index, 2) * TAU;
    const throwShare = Math.sqrt(draw(core.seed, SALT_SMOKE, index, 3)) * SMOKE_MAX_THROW;
    const throwPx = throwShare * coreRadius * (1 + SMOKE_DRIFT_GROWTH * progress);
    const liftShare = SMOKE_MIN_LIFT + draw(core.seed, SALT_SMOKE, index, 4) * SMOKE_LIFT_SPREAD;
    const liftPx = liftShare * coreRadius * easeOutCubic(progress);
    const sizeShare = SMOKE_MIN_SIZE + draw(core.seed, SALT_SMOKE, index, 5) * SMOKE_SIZE_SPREAD;
    const radius = sizeShare * coreRadius * (1 + SMOKE_GROWTH * progress);
    const fadeIn = clamp01(progress / SMOKE_FADE_IN_SHARE);
    const fadeOut = Math.pow(1 - progress, SMOKE_FADE_OUT_EXPONENT);
    // Starts fire-lit and ends as pale soot, following the fire's own cooling.
    const inkIndex = Math.min(smoke.length - 1, Math.floor(progress * smoke.length));
    stampDisc(
      ctx,
      smoke[inkIndex],
      core.x + Math.cos(angle) * throwPx,
      core.y + Math.sin(angle) * throwPx * GROUND_SQUASH - liftPx,
      radius,
      radius,
      SMOKE_PEAK_ALPHA * fadeIn * fadeOut,
    );
  }
}

// ── Sparks ───────────────────────────────────────────────────────────────────

const SPARK_COUNT = 30;
const SPARK_MIN_SPEED = 5;
const SPARK_SPEED_SPREAD = 8;
/** Share of its speed a spark keeps each frame: air drag on a tiny, fast thing. */
const SPARK_DRAG = 0.9;
const SPARK_MIN_LIFE = 16;
const SPARK_LIFE_SPREAD = 20;
/** Frames of travel the streak spans — the motion blur that reads as speed. */
const SPARK_TRAIL_FRAMES = 2.5;
const SPARK_GRAVITY = 0.09;
const SPARK_MIN_LAUNCH_RISE = 1.5;
const SPARK_LAUNCH_RISE_SPREAD = 2.5;
const SPARK_MIN_WIDTH = 1.2;
const SPARK_WIDTH_SPREAD = 1.3;
const SPARK_HEAD_RED = 255;
const SPARK_HEAD_GREEN_HOT = 240;
const SPARK_HEAD_GREEN_COOL = 130;
const SPARK_HEAD_BLUE_HOT = 170;
const SPARK_HEAD_BLUE_COOL = 30;

interface SparkMotion {
  readonly speed: number;
  readonly angle: number;
  readonly rise: number;
}

/** Where a spark is after `t` frames, as (ground x, ground y, height). */
function sparkPosition(motion: SparkMotion, t: number): { x: number; y: number; z: number } {
  // The closed form of a velocity multiplied by `SPARK_DRAG` every frame.
  const travelled = (motion.speed * (1 - Math.pow(SPARK_DRAG, t))) / (1 - SPARK_DRAG);
  const height = Math.max(0, motion.rise * t - (SPARK_GRAVITY * t * t) / 2);
  return {
    x: Math.cos(motion.angle) * travelled,
    y: Math.sin(motion.angle) * travelled * GROUND_SQUASH,
    z: height,
  };
}

function paintSparks(ctx: CanvasRenderingContext2D, core: BlastCore, age: number): void {
  ctx.lineCap = 'round';
  for (let index = 0; index < SPARK_COUNT; index++) {
    const life = SPARK_MIN_LIFE + draw(core.seed, SALT_SPARK, index, 0) * SPARK_LIFE_SPREAD;
    if (age >= life) continue;
    const motion: SparkMotion = {
      speed: SPARK_MIN_SPEED + draw(core.seed, SALT_SPARK, index, 1) * SPARK_SPEED_SPREAD,
      angle: draw(core.seed, SALT_SPARK, index, 2) * TAU,
      rise:
        SPARK_MIN_LAUNCH_RISE + draw(core.seed, SALT_SPARK, index, 3) * SPARK_LAUNCH_RISE_SPREAD,
    };
    const head = sparkPosition(motion, age);
    const tail = sparkPosition(motion, Math.max(0, age - SPARK_TRAIL_FRAMES));
    const heat = 1 - age / life;
    const green = SPARK_HEAD_GREEN_COOL + (SPARK_HEAD_GREEN_HOT - SPARK_HEAD_GREEN_COOL) * heat;
    const blue = SPARK_HEAD_BLUE_COOL + (SPARK_HEAD_BLUE_HOT - SPARK_HEAD_BLUE_COOL) * heat;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = gradientStopRgba(SPARK_HEAD_RED, Math.round(green), Math.round(blue), heat);
    ctx.lineWidth = SPARK_MIN_WIDTH + draw(core.seed, SALT_SPARK, index, 4) * SPARK_WIDTH_SPREAD;
    ctx.beginPath();
    ctx.moveTo(core.x + tail.x, core.y + tail.y - tail.z);
    ctx.lineTo(core.x + head.x, core.y + head.y - head.z);
    ctx.stroke();
  }
}

// ── Debris ───────────────────────────────────────────────────────────────────

const DEBRIS_COUNT = 14;
const DEBRIS_MIN_SPEED = 2.2;
const DEBRIS_SPEED_SPREAD = 3.6;
const DEBRIS_MIN_LAUNCH_RISE = 3;
const DEBRIS_LAUNCH_RISE_SPREAD = 4;
const DEBRIS_GRAVITY = 0.42;
const DEBRIS_MIN_SIZE = 2;
const DEBRIS_SIZE_SPREAD = 3;
const DEBRIS_MAX_SPIN = 0.5;
/** Frames rubble lies where it landed before it has faded into the scorch. */
const DEBRIS_LINGER_FRAMES = 40;
const DEBRIS_SHADOW_ALPHA = 0.35;
const DEBRIS_SHADOW_SQUASH = 0.5;
const DEBRIS_COLORS: ReadonlyArray<string> = ['#2b2420', '#3d332c', '#524539', '#1c1816'];
/** Share of the rubble thrown up still glowing from the blast. */
const DEBRIS_HOT_SHARE = 0.3;
const DEBRIS_HOT_COLOR = '#ff7a1a';

function paintDebris(ctx: CanvasRenderingContext2D, core: BlastCore, age: number): void {
  for (let index = 0; index < DEBRIS_COUNT; index++) {
    const speed = DEBRIS_MIN_SPEED + draw(core.seed, SALT_DEBRIS, index, 0) * DEBRIS_SPEED_SPREAD;
    const angle = draw(core.seed, SALT_DEBRIS, index, 1) * TAU;
    const rise =
      DEBRIS_MIN_LAUNCH_RISE + draw(core.seed, SALT_DEBRIS, index, 2) * DEBRIS_LAUNCH_RISE_SPREAD;
    const flightFrames = (2 * rise) / DEBRIS_GRAVITY;
    const airborneFor = Math.min(age, flightFrames);
    const landedFor = age - flightFrames;
    if (landedFor > DEBRIS_LINGER_FRAMES) continue;
    const height = Math.max(
      0,
      rise * airborneFor - (DEBRIS_GRAVITY * airborneFor * airborneFor) / 2,
    );
    const groundX = core.x + Math.cos(angle) * speed * airborneFor;
    const groundY = core.y + Math.sin(angle) * speed * airborneFor * GROUND_SQUASH;
    const size = DEBRIS_MIN_SIZE + draw(core.seed, SALT_DEBRIS, index, 3) * DEBRIS_SIZE_SPREAD;
    const fade = landedFor > 0 ? 1 - landedFor / DEBRIS_LINGER_FRAMES : 1;

    ctx.globalAlpha = DEBRIS_SHADOW_ALPHA * fade;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(groundX, groundY, size, size * DEBRIS_SHADOW_SQUASH, 0, 0, TAU);
    ctx.fill();

    const spin = (draw(core.seed, SALT_DEBRIS, index, 4) * 2 - 1) * DEBRIS_MAX_SPIN;
    const isHot = draw(core.seed, SALT_DEBRIS, index, 5) < DEBRIS_HOT_SHARE && landedFor < 0;
    const colorIndex = Math.floor(draw(core.seed, SALT_DEBRIS, index, 6) * DEBRIS_COLORS.length);
    ctx.globalAlpha = fade;
    ctx.fillStyle = isHot ? DEBRIS_HOT_COLOR : (DEBRIS_COLORS[colorIndex] ?? '#2b2420');
    ctx.save();
    ctx.translate(groundX, groundY - height);
    ctx.rotate(spin * airborneFor);
    ctx.fillRect(-size / 2, -size / 2, size, size * GROUND_SQUASH + size / 2);
    ctx.restore();
  }
}

// ── Ground shock ─────────────────────────────────────────────────────────────

/** Frames the dust front takes to roll out to the blast's edge. */
const DUST_FRONT_FRAMES = 30;
const DUST_PUFF_COUNT = 22;
/** How far past the blast's reach the dust front rolls. */
const DUST_FRONT_OVERSHOOT = 1.15;
const DUST_PUFF_SIZE = 0.13;
const DUST_PUFF_GROWTH = 1.2;
const DUST_PEAK_ALPHA = 0.42;
const DUST_JITTER = 0.12;
/** Frames the pressure front itself is visible, as a thin pale ring ahead of the dust. */
const SHOCK_RING_FRAMES = 9;
const SHOCK_RING_START_WIDTH = 2;
const SHOCK_RING_ALPHA = 0.28;

function paintGroundShock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seed: number,
  age: number,
): void {
  if (age < SHOCK_RING_FRAMES) {
    const progress = age / SHOCK_RING_FRAMES;
    const ringRadius = radius * DUST_FRONT_OVERSHOOT * easeOutCubic(progress);
    ctx.globalAlpha = SHOCK_RING_ALPHA * (1 - progress);
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = SHOCK_RING_START_WIDTH * (1 - progress) + 1;
    ctx.beginPath();
    ctx.ellipse(x, y, ringRadius, ringRadius * GROUND_SQUASH, 0, 0, TAU);
    ctx.stroke();
  }

  if (age >= DUST_FRONT_FRAMES) return;
  const progress = age / DUST_FRONT_FRAMES;
  const frontRadius = radius * DUST_FRONT_OVERSHOOT * easeOutCubic(progress);
  const { dust } = stamps();
  for (let index = 0; index < DUST_PUFF_COUNT; index++) {
    const angle = (index / DUST_PUFF_COUNT + draw(seed, SALT_DUST, index, 0) * DUST_JITTER) * TAU;
    const reach = frontRadius * (1 - draw(seed, SALT_DUST, index, 1) * DUST_JITTER);
    const puffRadius = radius * DUST_PUFF_SIZE * (1 + DUST_PUFF_GROWTH * progress);
    stampDisc(
      ctx,
      dust,
      x + Math.cos(angle) * reach,
      y + Math.sin(angle) * reach * GROUND_SQUASH,
      puffRadius,
      puffRadius * GROUND_SQUASH,
      DUST_PEAK_ALPHA * (1 - progress),
    );
  }
}

// ── Afterglow ────────────────────────────────────────────────────────────────

/** Frames the floor under the fireball glows orange after the flash has gone. */
const AFTERGLOW_FRAMES = 40;
const AFTERGLOW_REACH = 1.3;
const AFTERGLOW_ALPHA = 0.5;

function paintAfterglow(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
): void {
  if (age >= AFTERGLOW_FRAMES) return;
  const reach = coreRadius * AFTERGLOW_REACH;
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  stampDisc(
    ctx,
    stamps().glow,
    core.x,
    core.y,
    reach,
    reach * GROUND_SQUASH,
    AFTERGLOW_ALPHA * (1 - age / AFTERGLOW_FRAMES),
  );
  ctx.globalCompositeOperation = previous;
}

// ── Public painters ──────────────────────────────────────────────────────────

/**
 * Paints one blast at its current age, offset by the camera. Every stick in a
 * chain gets its own fireball, staggered by its delay; the flash, the shock
 * ring and the dust front belong to the blast as a whole, and the ring and the
 * dust reach its full radius.
 */
export function drawDynamiteExplosion(
  ctx: CanvasRenderingContext2D,
  picture: ExplosionPicture,
  camX: number,
  camY: number,
): void {
  ctx.save();
  const centreX = picture.x - camX;
  const centreY = picture.y - camY;
  const firstSeed = picture.cores[0]?.seed ?? 0;
  const screenCores = picture.cores.map((core) => ({
    ...core,
    x: core.x - camX,
    y: core.y - camY,
  }));

  paintGroundShock(ctx, centreX, centreY, picture.radius, firstSeed, picture.ageFrames);
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age < 0) continue;
    paintAfterglow(ctx, core, picture.coreRadius, age);
    paintDebris(ctx, core, age);
  }
  // Smoke over the fire: it thickens in as the fireball chars, so the last of
  // the glow is seen through it rather than drawn on top of it.
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintFireball(ctx, core, picture.coreRadius, age);
  }
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintSmoke(ctx, core, picture.coreRadius, age);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintSparks(ctx, core, age);
  }
  // Once per blast rather than per stick: additive flashes stacked for every
  // stick in a chain burn the whole screen to a white rectangle.
  paintFlash(ctx, centreX, centreY, picture.coreRadius, picture.ageFrames);
  ctx.restore();
}

const SCORCH_BLOTCH_COUNT = 7;
const SCORCH_BLOTCH_OFFSET = 0.35;
const SCORCH_BLOTCH_MIN_SIZE = 0.3;
const SCORCH_BLOTCH_SIZE_SPREAD = 0.25;
const SCORCH_CENTRE_SIZE = 0.55;
const SCORCH_PEAK_ALPHA = 0.55;
const SCORCH_SPECK_COUNT = 18;
const SCORCH_SPECK_MIN_REACH = 0.45;
const SCORCH_SPECK_REACH_SPREAD = 0.5;
const SCORCH_SPECK_MIN_SIZE = 0.035;
const SCORCH_SPECK_SIZE_SPREAD = 0.05;

/**
 * The blackened floor a blast leaves behind: an irregular soot blotch with
 * specks of soot flung outward from its centre. Drawn in the ground pass, under
 * everything that stands on the floor.
 */
export function drawScorchMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seed: number,
  ageFrames: number,
): void {
  const fadeStart = SCORCH_TOTAL_FRAMES * (1 - SCORCH_FADE_SHARE);
  const fade =
    ageFrames < fadeStart ? 1 : 1 - (ageFrames - fadeStart) / (SCORCH_TOTAL_FRAMES - fadeStart);
  if (fade <= 0) return;
  const alpha = SCORCH_PEAK_ALPHA * fade;
  const { scorch } = stamps();
  ctx.save();
  const centreSize = radius * SCORCH_CENTRE_SIZE;
  stampDisc(ctx, scorch, x, y, centreSize, centreSize * GROUND_SQUASH, alpha);
  for (let index = 0; index < SCORCH_BLOTCH_COUNT; index++) {
    const angle = draw(seed, SALT_SCORCH, index, 0) * TAU;
    const offset = radius * SCORCH_BLOTCH_OFFSET * draw(seed, SALT_SCORCH, index, 1);
    const size =
      radius *
      (SCORCH_BLOTCH_MIN_SIZE + draw(seed, SALT_SCORCH, index, 2) * SCORCH_BLOTCH_SIZE_SPREAD);
    stampDisc(
      ctx,
      scorch,
      x + Math.cos(angle) * offset,
      y + Math.sin(angle) * offset * GROUND_SQUASH,
      size,
      size * GROUND_SQUASH,
      alpha,
    );
  }
  // Soot thrown past the blotch, thinning out toward the blast's edge.
  for (let index = 0; index < SCORCH_SPECK_COUNT; index++) {
    const specIndex = index + SCORCH_BLOTCH_COUNT;
    const angle = draw(seed, SALT_SCORCH, specIndex, 0) * TAU;
    const reachShare =
      SCORCH_SPECK_MIN_REACH + draw(seed, SALT_SCORCH, specIndex, 1) * SCORCH_SPECK_REACH_SPREAD;
    const size =
      radius *
      (SCORCH_SPECK_MIN_SIZE + draw(seed, SALT_SCORCH, specIndex, 2) * SCORCH_SPECK_SIZE_SPREAD);
    stampDisc(
      ctx,
      scorch,
      x + Math.cos(angle) * radius * reachShare,
      y + Math.sin(angle) * radius * reachShare * GROUND_SQUASH,
      size,
      size * GROUND_SQUASH,
      alpha * (1 - reachShare),
    );
  }
  ctx.restore();
}
