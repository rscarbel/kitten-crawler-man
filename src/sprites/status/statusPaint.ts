/**
 * The paint box every status-effect visual draws with.
 *
 * Two ideas carry all of it:
 *
 * 1. **Soft light is a cached sprite, not a blur.** `shadowBlur` re-blurs on
 *    every fill and is the single most expensive thing a per-frame canvas draw
 *    can do; a radial-gradient disc baked once and blitted is both cheaper and
 *    softer. Every glow, ember, puff and pool here is that one disc, scaled.
 * 2. **Particles are phase functions, not objects.** A status is applied to
 *    dozens of mobs at once and every one of them would need a particle array,
 *    an integrator and a cull. Instead each particle is a pure function of
 *    `(clock, index, seed)`: its position along a fixed trajectory is read
 *    straight out of a sawtooth phase, so there is no state to allocate, tick or
 *    reset — a mob that walks off screen and back costs nothing and looks the
 *    same either way.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';

/** A colour as raw channels, so alpha can be varied per-particle without string surgery. */
export type Rgb = readonly [number, number, number];

/**
 * Alpha is rounded before it reaches a colour string: a computed value like
 * `5e-17` serialises in exponent form, which some canvas implementations reject
 * outright — dropping the whole `rgba()` and painting the default black.
 */
const ALPHA_DECIMALS = 3;

export function rgba(color: Rgb, alpha: number): string {
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_DECIMALS);
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${safe})`;
}

/**
 * Everything a status visual needs to know about the character it is painting.
 *
 * The box describes the **drawn figure**, not its tile. Those are not the same
 * thing and assuming they are is the mistake that makes a burning crawler look
 * like a crawler standing in a campfire: the human's art reaches two thirds of a
 * tile above his own tile and is only three fifths of one wide, so flames spread
 * across the tile pile up around his shins and never touch his chest.
 */
export interface StatusVisualFrame {
  /** Horizontal centre of the drawn figure, in screen pixels. */
  readonly centerX: number;
  /** The ground line the figure stands on, in screen pixels. */
  readonly footY: number;
  /** Width of the drawn figure in screen pixels. Horizontal spreads scale by it. */
  readonly width: number;
  /** Height of the drawn figure in screen pixels. Vertical reaches scale by it. */
  readonly height: number;
  /** Animation clock in milliseconds. */
  readonly timeMs: number;
  /**
   * Stable per-character number. Two adjacent burning mobs sharing a seed would
   * flicker in perfect lockstep, which reads as one effect rather than two.
   */
  readonly seed: number;
  /** Fades to 0 over the effect's last moments so nothing vanishes mid-flame. */
  readonly fade: number;
  /** Whether the character is walking — motion-dependent visuals key off this. */
  readonly moving: boolean;
  /** Unit facing, so trailing art knows which way is "behind". */
  readonly facingX: number;
  readonly facingY: number;
}

/** Top of the drawn figure — its head, not the top of its tile. */
export function bodyTop(f: StatusVisualFrame): number {
  return f.footY - f.height;
}

/**
 * A point on the figure, given in figure-relative fractions: `acrossFraction` 0
 * is its left edge and 1 its right, `upFraction` 0 is the ground and 1 the top
 * of its head.
 */
export function bodyX(f: StatusVisualFrame, acrossFraction: number): number {
  return f.centerX + (acrossFraction - HALF_SPAN) * f.width;
}

export function bodyY(f: StatusVisualFrame, upFraction: number): number {
  return f.footY - upFraction * f.height;
}

const HALF_SPAN = 0.5;

// -- Deterministic per-particle randomness ---------------------------------

const HASH_FREQUENCY = 127.1;
const HASH_AMPLITUDE = 43758.5453;

/** A stable pseudo-random number in [0, 1) for any integer or fractional key. */
export function hash01(key: number): number {
  const scattered = Math.sin(key * HASH_FREQUENCY) * HASH_AMPLITUDE;
  return scattered - Math.floor(scattered);
}

/** A stable pseudo-random number in [`min`, `max`) for any key. */
export function hashRange(key: number, min: number, max: number): number {
  return min + hash01(key) * (max - min);
}

/**
 * A particle's position through its life, in [0, 1): 0 the instant it is born,
 * approaching 1 as it dies. Staggering by the particle's own hash is what keeps
 * a group from pulsing together.
 */
export function particlePhase(f: StatusVisualFrame, index: number, ratePerMs: number): number {
  const stagger = hash01(f.seed + index * PHASE_STAGGER_STRIDE);
  const raw = f.timeMs * ratePerMs + stagger;
  return raw - Math.floor(raw);
}

/** Spacing between the hash keys a single particle draws its traits from. */
export const PARTICLE_KEY_STRIDE = 17;
const PHASE_STAGGER_STRIDE = 7;

// -- Cached soft-light discs -----------------------------------------------

/**
 * Resolution of the baked glow disc. Large enough that a boss-sized pool still
 * looks smooth when scaled up, small enough that a dozen of them per frame is a
 * rounding error.
 */
const GLOW_SPRITE_PX = 96;
const GLOW_CENTER_PX = GLOW_SPRITE_PX / 2;

/**
 * Where the falloff sits. A gradient that is opaque only at the exact centre
 * reads as a smudge; holding full strength across the inner fifth gives the
 * disc a core, which is what makes an ember look hot rather than foggy.
 */
const GLOW_CORE_STOP = 0.18;
const GLOW_MID_STOP = 0.45;
const GLOW_MID_ALPHA = 0.35;

const glowCache = new Map<string, CanvasSurface>();

/**
 * A soft radial disc of the given colour, baked once and reused. Draw it with
 * {@link drawGlow} rather than blitting it directly.
 */
function glowSprite(color: Rgb): CanvasSurface {
  const key = `${color[0]},${color[1]},${color[2]}`;
  const cached = glowCache.get(key);
  if (cached !== undefined) return cached;

  const surface = allocCanvas(GLOW_SPRITE_PX, GLOW_SPRITE_PX);
  const ctx = surfaceContext(surface);
  const gradient = ctx.createRadialGradient(
    GLOW_CENTER_PX,
    GLOW_CENTER_PX,
    0,
    GLOW_CENTER_PX,
    GLOW_CENTER_PX,
    GLOW_CENTER_PX,
  );
  gradient.addColorStop(0, rgba(color, 1));
  gradient.addColorStop(GLOW_CORE_STOP, rgba(color, 1));
  gradient.addColorStop(GLOW_MID_STOP, rgba(color, GLOW_MID_ALPHA));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX);

  glowCache.set(key, surface);
  return surface;
}

/**
 * A context that exists only to mint `CanvasGradient` objects, so a cached one
 * never outlives the surface it came from. The compositor's scratch surfaces are
 * reallocated whenever a larger entity appears; a gradient built from one of
 * those and then cached for the session would be holding a reference to a
 * context the engine has since thrown away.
 */
const GRADIENT_FACTORY_PX = 1;
let gradientFactory: CanvasRenderingContext2D | null = null;

export function gradientContext(): CanvasRenderingContext2D {
  gradientFactory ??= surfaceContext(allocCanvas(GRADIENT_FACTORY_PX, GRADIENT_FACTORY_PX));
  return gradientFactory;
}

/** Paints a soft disc of light centred on (`x`, `y`). */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  color: Rgb,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0 || radius <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
}

/**
 * A mote of light that keeps its colour on any ground: an opaque pass for the
 * hue, then an additive pass for the heat.
 *
 * Additive light alone is the trap here. On a dungeon floor it looks superb —
 * and on snow or sand every channel is already near its ceiling, so adding to it
 * just produces white. A burning crawler on a bright floor turned into a
 * colourless smear. The opaque pass is what survives that; the additive pass on
 * top is what still makes it glow in the dark.
 */
export function drawEmbermote(
  ctx: CanvasRenderingContext2D,
  hue: Rgb,
  heat: Rgb,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0 || radius <= 0) return;
  const previousBlend = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'source-over';
  drawGlow(ctx, hue, x, y, radius, alpha);
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, heat, x, y, radius * HEAT_CORE_SCALE, alpha);
  ctx.globalCompositeOperation = previousBlend;
}

/** The additive core is drawn smaller than the opaque body it sits inside. */
const HEAT_CORE_SCALE = 0.7;

/** Paints a soft disc squashed vertically, for light pooling on the ground. */
export function drawGroundPool(
  ctx: CanvasRenderingContext2D,
  color: Rgb,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  if (alpha <= 0 || radiusX <= 0 || radiusY <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(color), x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
}

// -- Shapes ----------------------------------------------------------------

/**
 * Waist of a flame tongue as a fraction of its own height. Real flame is far
 * taller than it is wide; anything rounder reads as a balloon.
 */
const TONGUE_WAIST_FRACTION = 0.42;
/** How far the tongue's widest point sits above its base. */
const TONGUE_SHOULDER_FRACTION = 0.4;

/**
 * A single lick of flame: a teardrop rooted at (`baseX`, `baseY`), rising
 * `height` pixels to a tip displaced sideways by `tipLean`.
 */
export function drawFlameTongue(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  width: number,
  height: number,
  tipLean: number,
): void {
  const halfWidth = width / 2;
  const waist = width * TONGUE_WAIST_FRACTION;
  const shoulderY = baseY - height * TONGUE_SHOULDER_FRACTION;
  const tipX = baseX + tipLean;
  const tipY = baseY - height;

  ctx.beginPath();
  ctx.moveTo(baseX - halfWidth, baseY);
  ctx.quadraticCurveTo(baseX - waist, shoulderY, tipX, tipY);
  ctx.quadraticCurveTo(baseX + waist, shoulderY, baseX + halfWidth, baseY);
  ctx.quadraticCurveTo(
    baseX,
    baseY + halfWidth * TONGUE_SHOULDER_FRACTION,
    baseX - halfWidth,
    baseY,
  );
  ctx.fill();
}

/** Number of segments a bolt is broken into. More reads as noise, fewer as a zigzag. */
const BOLT_SEGMENTS = 6;

/**
 * A jagged electrical bolt between two points. `spread` is how far each joint
 * may wander off the straight line, and `key` seeds that wander so a bolt is
 * stable within a frame but different from its neighbours.
 */
export function traceBolt(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  spread: number,
  key: number,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return;
  const normalX = -dy / length;
  const normalY = dx / length;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  for (let segment = 1; segment <= BOLT_SEGMENTS; segment++) {
    const along = segment / BOLT_SEGMENTS;
    // The taper keeps both ends pinned to their contact points; only the middle
    // of the bolt is allowed to wander.
    const taper = Math.sin(along * Math.PI);
    const offset = (hash01(key + segment) - 0.5) * spread * taper;
    ctx.lineTo(fromX + dx * along + normalX * offset, fromY + dy * along + normalY * offset);
  }
  ctx.stroke();
}

/** Points on a drawn star. Five is the shape a reader recognises instantly. */
const STAR_POINTS = 5;
/** Ratio of the inner vertices to the outer ones. */
const STAR_INNER_RATIO = 0.45;

/** A five-pointed star centred on (`x`, `y`), rotated by `spin` radians. */
export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  spin: number,
): void {
  ctx.beginPath();
  for (let vertex = 0; vertex < STAR_POINTS * 2; vertex++) {
    const isOuter = vertex % 2 === 0;
    const reach = isOuter ? radius : radius * STAR_INNER_RATIO;
    const angle = spin + (vertex / (STAR_POINTS * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * reach;
    const py = y + Math.sin(angle) * reach;
    if (vertex === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * A hanging droplet: a round belly under a drawn-out neck, which is what tells
 * the eye the fluid is thick rather than watery.
 */
export function drawDroplet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  neck: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - neck);
  ctx.quadraticCurveTo(x + radius, y - neck * 0.3, x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI);
  ctx.quadraticCurveTo(x - radius, y - neck * 0.3, x, y - neck);
  ctx.fill();
}
