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
 *
 * A black powder bomb is the same painter with a different
 * {@link ExplosionVariant}: powder burns faster and dirtier than dynamite, so
 * its flash is shorter and whiter, its fire is gone in a blink, its smoke is
 * a heavy black plume that hangs long after, the cast-iron shell flies apart
 * as shrapnel, and the dust it kicks up rolls outward along the floor.
 */

import type { CanvasSurface } from '../core/rendering/canvasSurface';
import {
  bakeSoftDisc,
  FLAME_BODY_TIERS,
  FLAME_GLOW_INK,
  gradientStopRgba,
  hashUnit,
  type FlameInk,
} from './flameStamps';

/** Which blast a picture is painted as. */
export type ExplosionVariant = 'dynamite' | 'black_powder';

/** Frames from a dynamite detonation until the last of the smoke is gone. */
export const EXPLOSION_TOTAL_FRAMES = 110;
/** Frames from a black powder detonation until the last of its heavier plume is gone. */
export const BLACK_POWDER_EXPLOSION_TOTAL_FRAMES = 150;
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
/**
 * Black powder smoke, darkest first. Powder burns with far more unburnt
 * carbon than dynamite, so its plume is near-black and only the first puffs,
 * still over the fire, are lit warm from underneath.
 */
const POWDER_SMOKE_INKS: ReadonlyArray<FlameInk> = [
  { red: 52, green: 36, blue: 28, alpha: 1 },
  { red: 34, green: 32, blue: 31, alpha: 1 },
  { red: 50, green: 49, blue: 48, alpha: 1 },
  { red: 72, green: 71, blue: 70, alpha: 1 },
];
const DUST_INK: FlameInk = { red: 128, green: 112, blue: 94, alpha: 1 };
/** Floor dust fouled with powder soot, kicked up by a black powder blast. */
const POWDER_DUST_INK: FlameInk = { red: 88, green: 80, blue: 72, alpha: 1 };
const SCORCH_INK: FlameInk = { red: 10, green: 8, blue: 6, alpha: 1 };
const DISC_BAKE_PX = 64;
const GLOW_BAKE_PX = 128;

interface ExplosionStamps {
  /** Fire discs from hottest to coolest: white, yellow, then the shared flame tiers. */
  readonly fire: ReadonlyArray<CanvasSurface>;
  readonly smoke: ReadonlyArray<CanvasSurface>;
  readonly powderSmoke: ReadonlyArray<CanvasSurface>;
  readonly soot: CanvasSurface;
  readonly dust: CanvasSurface;
  readonly powderDust: CanvasSurface;
  readonly scorch: CanvasSurface;
  readonly glow: CanvasSurface;
  /** A yellow-white wash: the harder, less orange light of a powder flash. */
  readonly hardGlow: CanvasSurface;
  readonly flash: CanvasSurface;
}

type SmokeStampKey = 'smoke' | 'powderSmoke';
type DustStampKey = 'dust' | 'powderDust';
type GlowStampKey = 'glow' | 'hardGlow';

/** The detonation's light: how bright, how wide and how quickly it dies. */
interface FlashStyle {
  /** Frames the detonation lights the room for. */
  readonly frames: number;
  /** Frames over which the flash falls to a third of its brightness. */
  readonly decayFrames: number;
  /** How far past the fireball's reach the flash lights the floor. */
  readonly reach: number;
  readonly peakAlpha: number;
  /** The white-hot centre of the flash, as a share of the fireball's reach. */
  readonly coreReach: number;
  readonly coreFrames: number;
  readonly glow: GlowStampKey;
}

interface FireballStyle {
  readonly billowCount: number;
  /** Frames a billow takes to reach its full throw from the centre. */
  readonly expandFrames: number;
  readonly minLife: number;
  readonly lifeSpread: number;
  /** The first share of a billow's life at which it is still white-hot. */
  readonly whiteShare: number;
  /** How many fire stamps past white a billow cools through before it is soot. */
  readonly coolingStamps: number;
}

interface SmokeStyle {
  readonly count: number;
  readonly minStart: number;
  readonly startSpread: number;
  readonly minLife: number;
  readonly lifeSpread: number;
  readonly maxThrow: number;
  readonly minLift: number;
  readonly liftSpread: number;
  readonly minSize: number;
  readonly sizeSpread: number;
  readonly growth: number;
  readonly peakAlpha: number;
  readonly stamps: SmokeStampKey;
}

interface DustStyle {
  /** Frames the dust front takes to roll out to its furthest. */
  readonly frontFrames: number;
  readonly puffCount: number;
  /** How far past the blast's reach the dust front rolls. */
  readonly overshoot: number;
  readonly puffSize: number;
  readonly puffGrowth: number;
  readonly peakAlpha: number;
  /**
   * How high a puff climbs as it rolls, per unit of blast reach. A dynamite
   * blast's dust skims flat; a powder blast's curls up off the floor as it
   * goes, which is what makes it read as a rolling ring rather than a ripple.
   */
  readonly rollLift: number;
  readonly stamp: DustStampKey;
}

/**
 * Everything that makes one kind of blast look like itself. Shapes, counts and
 * timings only: the particle laws (ballistics, drag, cooling) are shared, so a
 * variant is a different explosive, not a different physics.
 */
interface ExplosionStyle {
  readonly flash: FlashStyle;
  readonly fireball: FireballStyle;
  readonly smoke: SmokeStyle;
  readonly sparkCount: number;
  /** Fragments of a cast-iron shell; none from a paper-wrapped stick. */
  readonly shrapnelCount: number;
  readonly debrisCount: number;
  readonly dust: DustStyle;
  /** Frames the floor glows orange after the flash. */
  readonly afterglowFrames: number;
  /** Frames the blast lights the room, falling to nothing; drives {@link explosionLightRemaining}. */
  readonly lightFrames: number;
}

let bakedStamps: ExplosionStamps | null = null;

function stamps(): ExplosionStamps {
  bakedStamps ??= {
    fire: [WHITE_HOT_INK, YELLOW_HOT_INK, ...FLAME_BODY_TIERS.slice(0, FIREBALL_FLAME_TIERS)].map(
      (ink) => bakeSoftDisc({ ...ink, alpha: 1 }, DISC_BAKE_PX),
    ),
    smoke: SMOKE_INKS.map((ink) => bakeSoftDisc(ink, DISC_BAKE_PX)),
    powderSmoke: POWDER_SMOKE_INKS.map((ink) => bakeSoftDisc(ink, DISC_BAKE_PX)),
    soot: bakeSoftDisc(SOOT_INK, DISC_BAKE_PX),
    dust: bakeSoftDisc(DUST_INK, DISC_BAKE_PX),
    powderDust: bakeSoftDisc(POWDER_DUST_INK, DISC_BAKE_PX),
    scorch: bakeSoftDisc(SCORCH_INK, DISC_BAKE_PX),
    glow: bakeSoftDisc(FLAME_GLOW_INK, GLOW_BAKE_PX),
    hardGlow: bakeSoftDisc(YELLOW_HOT_INK, GLOW_BAKE_PX),
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

function paintFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  age: number,
  style: FlashStyle,
): void {
  if (age >= style.frames) return;
  const brightness = style.peakAlpha * Math.exp(-age / style.decayFrames);
  const baked = stamps();
  const reach = radius * style.reach;
  stampDisc(ctx, baked[style.glow], x, y, reach, reach * GROUND_SQUASH, brightness);
  if (age < style.coreFrames) {
    const coreReach = radius * style.coreReach * (1 + age / style.coreFrames);
    stampDisc(ctx, baked.flash, x, y, coreReach, coreReach, 1 - age / style.coreFrames);
  }
}

// ── Fireball ─────────────────────────────────────────────────────────────────

const BILLOW_MAX_START_DELAY = 5;
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
  style: FireballStyle,
): BillowState | null {
  const startDelay = draw(core.seed, SALT_BILLOW, index, 0) * BILLOW_MAX_START_DELAY;
  const life = style.minLife + draw(core.seed, SALT_BILLOW, index, 1) * style.lifeSpread;
  const lived = age - startDelay;
  if (lived < 0 || lived >= life) return null;
  const cooled = lived / life;
  const expansion = easeOutCubic(clamp01(lived / style.expandFrames));
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
function fireStampFor(cooled: number, style: FireballStyle): CanvasSurface | null {
  const { fire } = stamps();
  if (cooled < style.whiteShare) return fire[0] ?? null;
  const coolingShare = (cooled - style.whiteShare) / (1 - style.whiteShare);
  const firstCoolingTier = 1;
  const tierSpan = Math.min(fire.length - firstCoolingTier, style.coolingStamps);
  const tier = firstCoolingTier + Math.min(tierSpan - 1, Math.floor(coolingShare * tierSpan));
  return fire[tier] ?? null;
}

function paintFireball(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
  style: FireballStyle,
): void {
  const { glow, soot } = stamps();
  for (let index = 0; index < style.billowCount; index++) {
    const billow = billowAt(core, coreRadius, index, age, style);
    if (billow === null) continue;
    const stamp = fireStampFor(billow.cooled, style);
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

/** How much further out a puff drifts by the time it has thinned away. */
const SMOKE_DRIFT_GROWTH = 0.6;
/** Share of a puff's life it takes to thicken in, so smoke never pops into existence. */
const SMOKE_FADE_IN_SHARE = 0.2;
const SMOKE_FADE_OUT_EXPONENT = 1.4;

function paintSmoke(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
  style: SmokeStyle,
): void {
  const smoke = stamps()[style.stamps];
  for (let index = 0; index < style.count; index++) {
    const start = style.minStart + draw(core.seed, SALT_SMOKE, index, 0) * style.startSpread;
    const life = style.minLife + draw(core.seed, SALT_SMOKE, index, 1) * style.lifeSpread;
    const lived = age - start;
    if (lived < 0 || lived >= life) continue;
    const progress = lived / life;
    const angle = draw(core.seed, SALT_SMOKE, index, 2) * TAU;
    const throwShare = Math.sqrt(draw(core.seed, SALT_SMOKE, index, 3)) * style.maxThrow;
    const throwPx = throwShare * coreRadius * (1 + SMOKE_DRIFT_GROWTH * progress);
    const liftShare = style.minLift + draw(core.seed, SALT_SMOKE, index, 4) * style.liftSpread;
    const liftPx = liftShare * coreRadius * easeOutCubic(progress);
    const sizeShare = style.minSize + draw(core.seed, SALT_SMOKE, index, 5) * style.sizeSpread;
    const radius = sizeShare * coreRadius * (1 + style.growth * progress);
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
      style.peakAlpha * fadeIn * fadeOut,
    );
  }
}

// ── Sparks ───────────────────────────────────────────────────────────────────

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

function paintSparks(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  age: number,
  count: number,
): void {
  ctx.lineCap = 'round';
  for (let index = 0; index < count; index++) {
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

function paintDebris(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  age: number,
  count: number,
): void {
  for (let index = 0; index < count; index++) {
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

// ── Shrapnel ─────────────────────────────────────────────────────────────────

const SALT_SHRAPNEL = 701;
const SHRAPNEL_MIN_SPEED = 9;
const SHRAPNEL_SPEED_SPREAD = 7;
/** Iron fragments are heavier than sparks, so the air slows them less. */
const SHRAPNEL_DRAG = 0.86;
const SHRAPNEL_MIN_LIFE = 9;
const SHRAPNEL_LIFE_SPREAD = 9;
/** Shrapnel flies nearly flat: a shell bursts outward, not upward. */
const SHRAPNEL_MIN_RISE = 0.2;
const SHRAPNEL_RISE_SPREAD = 1;
const SHRAPNEL_GRAVITY = 0.12;
/** Frames of travel a streak spans; longer than a spark's, because shrapnel is faster. */
const SHRAPNEL_TRAIL_FRAMES = 4;
/** The share of a streak nearest its head that is still hot. */
const SHRAPNEL_HOT_HEAD_SHARE = 0.4;
const SHRAPNEL_MIN_WIDTH = 1.4;
const SHRAPNEL_WIDTH_SPREAD = 0.9;
/** Shrapnel leaves the blast already this far out, as a share of the fireball's reach. */
const SHRAPNEL_BIRTH_REACH = 0.15;
const SHRAPNEL_TAIL_INK = 'rgba(28, 27, 27, 0.95)';
const SHRAPNEL_HOT_RED = 255;
const SHRAPNEL_HOT_GREEN = 196;
const SHRAPNEL_HOT_BLUE = 120;

function shrapnelPoint(
  speed: number,
  angle: number,
  rise: number,
  t: number,
  birthPx: number,
): { x: number; y: number } {
  const travelled = birthPx + (speed * (1 - Math.pow(SHRAPNEL_DRAG, t))) / (1 - SHRAPNEL_DRAG);
  const height = Math.max(0, rise * t - (SHRAPNEL_GRAVITY * t * t) / 2);
  return {
    x: Math.cos(angle) * travelled,
    y: Math.sin(angle) * travelled * GROUND_SQUASH - height,
  };
}

/**
 * The bomb's cast-iron shell torn into fragments: fast, nearly flat streaks
 * whose dark tails are the iron and whose heads glow from the blast. Painted
 * over the fire, not added to it, because iron is darker than the fire it
 * flies through.
 */
function paintShrapnel(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
  count: number,
): void {
  ctx.lineCap = 'round';
  const birthPx = coreRadius * SHRAPNEL_BIRTH_REACH;
  for (let index = 0; index < count; index++) {
    const life =
      SHRAPNEL_MIN_LIFE + draw(core.seed, SALT_SHRAPNEL, index, 0) * SHRAPNEL_LIFE_SPREAD;
    if (age >= life) continue;
    // Spread evenly round the circle with jitter, so a burst never leaves a wide gap.
    const angle = ((index + draw(core.seed, SALT_SHRAPNEL, index, 1)) / count) * TAU;
    const speed =
      SHRAPNEL_MIN_SPEED + draw(core.seed, SALT_SHRAPNEL, index, 2) * SHRAPNEL_SPEED_SPREAD;
    const rise =
      SHRAPNEL_MIN_RISE + draw(core.seed, SALT_SHRAPNEL, index, 3) * SHRAPNEL_RISE_SPREAD;
    const head = shrapnelPoint(speed, angle, rise, age, birthPx);
    const tail = shrapnelPoint(
      speed,
      angle,
      rise,
      Math.max(0, age - SHRAPNEL_TRAIL_FRAMES),
      birthPx,
    );
    const neck = {
      x: head.x + (tail.x - head.x) * SHRAPNEL_HOT_HEAD_SHARE,
      y: head.y + (tail.y - head.y) * SHRAPNEL_HOT_HEAD_SHARE,
    };
    const remaining = 1 - age / life;
    ctx.globalAlpha = remaining;
    ctx.lineWidth =
      SHRAPNEL_MIN_WIDTH + draw(core.seed, SALT_SHRAPNEL, index, 4) * SHRAPNEL_WIDTH_SPREAD;
    ctx.strokeStyle = SHRAPNEL_TAIL_INK;
    ctx.beginPath();
    ctx.moveTo(core.x + tail.x, core.y + tail.y);
    ctx.lineTo(core.x + neck.x, core.y + neck.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = gradientStopRgba(
      SHRAPNEL_HOT_RED,
      SHRAPNEL_HOT_GREEN,
      SHRAPNEL_HOT_BLUE,
      remaining,
    );
    ctx.beginPath();
    ctx.moveTo(core.x + neck.x, core.y + neck.y);
    ctx.lineTo(core.x + head.x, core.y + head.y);
    ctx.stroke();
  }
}

// ── Ground shock ─────────────────────────────────────────────────────────────

const DUST_JITTER = 0.12;
/** Frames the pressure front itself is visible, as a thin pale ring ahead of the dust. */
const SHOCK_RING_FRAMES = 9;
const SHOCK_RING_START_WIDTH = 2;
const SHOCK_RING_ALPHA = 0.28;
/** A rolling puff curls up fastest as it leaves and settles as it slows, half a wave over its run. */
const DUST_ROLL_HALF_WAVE = Math.PI;

function paintGroundShock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seed: number,
  age: number,
  style: DustStyle,
): void {
  if (age < SHOCK_RING_FRAMES) {
    const progress = age / SHOCK_RING_FRAMES;
    const ringRadius = radius * style.overshoot * easeOutCubic(progress);
    ctx.globalAlpha = SHOCK_RING_ALPHA * (1 - progress);
    ctx.strokeStyle = '#fff4dc';
    ctx.lineWidth = SHOCK_RING_START_WIDTH * (1 - progress) + 1;
    ctx.beginPath();
    ctx.ellipse(x, y, ringRadius, ringRadius * GROUND_SQUASH, 0, 0, TAU);
    ctx.stroke();
  }

  if (age >= style.frontFrames) return;
  const progress = age / style.frontFrames;
  const frontRadius = radius * style.overshoot * easeOutCubic(progress);
  const dust = stamps()[style.stamp];
  const liftPx = radius * style.rollLift * Math.sin(progress * DUST_ROLL_HALF_WAVE);
  for (let index = 0; index < style.puffCount; index++) {
    const angle = (index / style.puffCount + draw(seed, SALT_DUST, index, 0) * DUST_JITTER) * TAU;
    const reach = frontRadius * (1 - draw(seed, SALT_DUST, index, 1) * DUST_JITTER);
    const puffRadius = radius * style.puffSize * (1 + style.puffGrowth * progress);
    // A rolling puff stands up off the floor, so it is rounder than one lying flat.
    const puffHeight = puffRadius * (GROUND_SQUASH + (1 - GROUND_SQUASH) * style.rollLift);
    stampDisc(
      ctx,
      dust,
      x + Math.cos(angle) * reach,
      y + Math.sin(angle) * reach * GROUND_SQUASH - liftPx,
      puffRadius,
      puffHeight,
      style.peakAlpha * (1 - progress),
    );
  }
}

// ── Afterglow ────────────────────────────────────────────────────────────────

const AFTERGLOW_REACH = 1.3;
const AFTERGLOW_ALPHA = 0.5;

function paintAfterglow(
  ctx: CanvasRenderingContext2D,
  core: BlastCore,
  coreRadius: number,
  age: number,
  frames: number,
): void {
  if (age >= frames) return;
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
    AFTERGLOW_ALPHA * (1 - age / frames),
  );
  ctx.globalCompositeOperation = previous;
}

// ── Variants ─────────────────────────────────────────────────────────────────

const DYNAMITE_STYLE: ExplosionStyle = {
  flash: {
    frames: 10,
    decayFrames: 2.5,
    reach: 1.6,
    peakAlpha: 0.85,
    coreReach: 0.42,
    coreFrames: 6,
    glow: 'glow',
  },
  fireball: {
    billowCount: 30,
    expandFrames: 11,
    minLife: 22,
    lifeSpread: 22,
    whiteShare: 0.08,
    coolingStamps: FIREBALL_FLAME_TIERS + 1,
  },
  smoke: {
    count: 18,
    minStart: 10,
    startSpread: 18,
    minLife: 58,
    lifeSpread: 22,
    maxThrow: 0.55,
    minLift: 0.6,
    liftSpread: 0.7,
    minSize: 0.18,
    sizeSpread: 0.12,
    growth: 1.3,
    peakAlpha: 0.62,
    stamps: 'smoke',
  },
  sparkCount: 30,
  shrapnelCount: 0,
  debrisCount: 14,
  dust: {
    frontFrames: 30,
    puffCount: 22,
    overshoot: 1.15,
    puffSize: 0.13,
    puffGrowth: 1.2,
    peakAlpha: 0.42,
    rollLift: 0,
    stamp: 'dust',
  },
  afterglowFrames: 40,
  lightFrames: EXPLOSION_TOTAL_FRAMES,
};

/**
 * Powder deflagrates in a blink and leaves a heavy pall: a flash that is
 * whiter and over in half the time, a fireball that barely gets past yellow
 * before it is soot, a near-black plume that outlives a dynamite blast's
 * smoke by a long way, iron shrapnel, and a dust ring that rolls up off the
 * floor as it spreads.
 */
const BLACK_POWDER_STYLE: ExplosionStyle = {
  flash: {
    frames: 6,
    decayFrames: 1.3,
    reach: 1.35,
    peakAlpha: 1,
    coreReach: 0.6,
    coreFrames: 4,
    glow: 'hardGlow',
  },
  fireball: {
    billowCount: 24,
    expandFrames: 6,
    minLife: 11,
    lifeSpread: 10,
    whiteShare: 0.18,
    coolingStamps: 4,
  },
  smoke: {
    count: 30,
    minStart: 3,
    startSpread: 12,
    minLife: 95,
    lifeSpread: 38,
    maxThrow: 0.7,
    minLift: 0.45,
    liftSpread: 0.8,
    minSize: 0.24,
    sizeSpread: 0.16,
    growth: 1.5,
    peakAlpha: 0.85,
    stamps: 'powderSmoke',
  },
  sparkCount: 14,
  shrapnelCount: 18,
  debrisCount: 10,
  dust: {
    frontFrames: 46,
    puffCount: 30,
    overshoot: 1.3,
    puffSize: 0.17,
    puffGrowth: 1.6,
    peakAlpha: 0.6,
    rollLift: 0.16,
    stamp: 'powderDust',
  },
  afterglowFrames: 18,
  lightFrames: 60,
};

const EXPLOSION_STYLES: Readonly<Record<ExplosionVariant, ExplosionStyle>> = {
  dynamite: DYNAMITE_STYLE,
  black_powder: BLACK_POWDER_STYLE,
};

const TOTAL_FRAMES: Readonly<Record<ExplosionVariant, number>> = {
  dynamite: EXPLOSION_TOTAL_FRAMES,
  black_powder: BLACK_POWDER_EXPLOSION_TOTAL_FRAMES,
};

/** Frames a blast of this kind is drawn for; a system drops it at this age. */
export function explosionTotalFrames(variant: ExplosionVariant): number {
  return TOTAL_FRAMES[variant];
}

/**
 * How bright the light a blast throws on the room still is, 1 at detonation
 * and 0 once it is spent. A powder blast's light dies with its short fire,
 * long before its smoke has cleared.
 */
export function explosionLightRemaining(variant: ExplosionVariant, ageFrames: number): number {
  return clamp01(1 - ageFrames / EXPLOSION_STYLES[variant].lightFrames);
}

// ── Public painters ──────────────────────────────────────────────────────────

/**
 * Paints one blast at its current age, offset by the camera. Every stick in a
 * chain gets its own fireball, staggered by its delay; the flash, the shock
 * ring and the dust front belong to the blast as a whole, and the ring and the
 * dust reach its full radius. `variant` picks the explosive: a black powder
 * bomb is this same blast with the timings and inks of {@link ExplosionVariant}
 * `'black_powder'`.
 */
export function drawDynamiteExplosion(
  ctx: CanvasRenderingContext2D,
  picture: ExplosionPicture,
  camX: number,
  camY: number,
  variant: ExplosionVariant = 'dynamite',
): void {
  const style = EXPLOSION_STYLES[variant];
  ctx.save();
  const centreX = picture.x - camX;
  const centreY = picture.y - camY;
  const firstSeed = picture.cores[0]?.seed ?? 0;
  const screenCores = picture.cores.map((core) => ({
    ...core,
    x: core.x - camX,
    y: core.y - camY,
  }));

  paintGroundShock(ctx, centreX, centreY, picture.radius, firstSeed, picture.ageFrames, style.dust);
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age < 0) continue;
    paintAfterglow(ctx, core, picture.coreRadius, age, style.afterglowFrames);
    paintDebris(ctx, core, age, style.debrisCount);
  }
  // Smoke over the fire: it thickens in as the fireball chars, so the last of
  // the glow is seen through it rather than drawn on top of it.
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintFireball(ctx, core, picture.coreRadius, age, style.fireball);
  }
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintSmoke(ctx, core, picture.coreRadius, age, style.smoke);
  }
  if (style.shrapnelCount > 0) {
    for (const core of screenCores) {
      const age = picture.ageFrames - core.delayFrames;
      if (age >= 0) paintShrapnel(ctx, core, picture.coreRadius, age, style.shrapnelCount);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const core of screenCores) {
    const age = picture.ageFrames - core.delayFrames;
    if (age >= 0) paintSparks(ctx, core, age, style.sparkCount);
  }
  // Once per blast rather than per stick: additive flashes stacked for every
  // stick in a chain burn the whole screen to a white rectangle.
  paintFlash(ctx, centreX, centreY, picture.coreRadius, picture.ageFrames, style.flash);
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

/** How far a scorch's farthest stamp can reach from its centre, as a share of its radius. */
const SCORCH_REACH_SHARE = Math.max(
  SCORCH_CENTRE_SIZE,
  SCORCH_BLOTCH_OFFSET + SCORCH_BLOTCH_MIN_SIZE + SCORCH_BLOTCH_SIZE_SPREAD,
  SCORCH_SPECK_MIN_REACH +
    SCORCH_SPECK_REACH_SPREAD +
    SCORCH_SPECK_MIN_SIZE +
    SCORCH_SPECK_SIZE_SPREAD,
);

/** The farthest any part of a scorch of `radius` is drawn from its centre, in pixels. */
export function scorchMarkReachPx(radius: number): number {
  return radius * SCORCH_REACH_SHARE;
}

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
