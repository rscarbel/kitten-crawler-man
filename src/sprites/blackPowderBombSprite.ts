/**
 * The black powder bomb in the air, its blast, and the soft shadow any lobbed
 * explosive casts on the floor under it. The goblins' bombs and the player's
 * Black Powder Bomb are drawn by these same painters, so the thing a
 * Black Powder Goblin throws is visibly the thing it drops.
 *
 * Every painter takes its picture from its arguments alone (age, spin, seed),
 * so a review render replays any frame exactly.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/rendering/canvasSurface';
import { tone } from './art/itemIcons/iconPaint';
import { drawDynamiteExplosion, type ExplosionPicture } from './dynamiteExplosion';
import { paintFuseBead, paintFuseSmoke, paintFuseSparks } from './fuseEffects';

/** What a bomb in flight looks like this frame. */
export interface BlackPowderBombFlightOptions {
  /** Frames since it left the hand; drives the fuse's sparks and smoke. */
  readonly ageFrames: number;
  /** Turns of spin so far, in radians. */
  readonly spin: number;
  /** Fixes the bomb's spark pattern so two bombs in the air differ. */
  readonly seed: number;
  /**
   * The bomb's screen velocity in px per frame, so the fuse's sparks and smoke
   * stream out behind it. Left out, they are shed as if it hung still.
   */
  readonly velocityX?: number;
  readonly velocityY?: number;
}

const FULL_TURN = Math.PI * 2;
const BOMB_RADIUS_TILES = 0.21;

// The palette is the item icon's, so the bomb in the air and in the bag are one object.
const IRON = '#30343a';
const IRON_SHADOW = tone(IRON, -0.55);
const IRON_LIT = tone(IRON, 0.3);
/** The line where the form turns from the light, darker than the shadow beside it. */
const TERMINATOR_INK = tone(IRON, -0.8);
/** Floor light bounced onto the underside: cool, faint and confined to a thin rim. */
const REFLECTED_LIGHT = '#6f7c8c';
const REFLECTED_ALPHA = 0.55;
const SPECULAR_INK = '#e4ebf2';
const SPECULAR_HALO_INK = tone(IRON, 0.5);
const OUTLINE_INK = '#0b0c0e';

/**
 * How far the lit lens is pushed toward the light, per unit radius. The lit
 * side is the sphere's own outline shifted up-left, so the terminator is one
 * curved line across the form, not a ring round its centre.
 */
const LIT_SHIFT_X = -0.3;
const LIT_SHIFT_Y = -0.36;
const TERMINATOR_WIDTH_SHARE = 0.16;
/** How far the reflected rim's cut-out is pushed toward the light; small, so the rim stays thin. */
const RIM_SHIFT_X = -0.1;
const RIM_SHIFT_Y = -0.16;
const SPECULAR_X = -0.4;
const SPECULAR_Y = -0.44;
const SPECULAR_RX = 0.2;
const SPECULAR_RY = 0.13;
const SPECULAR_HALO_SCALE = 1.9;
const SPECULAR_TILT = -Math.PI / 4;
const OUTLINE_WIDTH_SHARE = 0.12;

/** The sphere is baked at this many times its on-screen size, then drawn down, so its edges are smooth. */
const BAKE_SUPERSAMPLE = 4;
/** Room round the baked sphere for its outline, in on-screen pixels. */
const BAKE_PAD_PX = 1;

/**
 * The seam runs round the bomb's equator. The bomb's axis (through the neck)
 * is tipped a little toward the viewer, so the seam's front half is a shallow
 * arc below the centre rather than a straight line.
 */
const SEAM_TILT_RY = 0.3;
const SEAM_DROP = 0.04;
const SEAM_INK = 'rgba(8, 9, 11, 0.85)';
const SEAM_RIDGE_INK = 'rgba(120, 128, 140, 0.55)';
const SEAM_RIDGE_OFFSET = 0.13;
const SEAM_WIDTH_PX = 1;
/** The seam fades out on the shadowed side, where there is nothing to catch its ridge. */
const SEAM_RIDGE_SPAN = 0.6;

/** Where the neck leaves the sphere, as a share of its radius; inside the rim so the sphere overlaps its foot. */
const NECK_ROOT_SHARE = 0.8;
const NECK_WIDTH_SHARE = 0.42;
const NECK_LENGTH_SHARE = 0.42;
const NECK_LIP_WIDTH_SHARE = 0.56;
const NECK_LIP_HEIGHT_SHARE = 0.16;
const NECK_IRON = '#4a4f57';
const NECK_SHADE_INK = tone(NECK_IRON, -0.5);

const FUSE_CORD = '#b9965c';
const FUSE_TWIST_INK = tone(FUSE_CORD, -0.55);
const FUSE_WIDTH_PX = 1.6;
/** The cord's curve from the neck's mouth, per unit radius, in the neck's frame: up, then bending over. */
const FUSE_CONTROL_X = 0.1;
const FUSE_CONTROL_Y = -0.55;
const FUSE_END_X = 0.6;
const FUSE_END_Y = -0.7;
const FUSE_TWISTS = 3;
const FUSE_TWIST_HALF_PX = 0.8;

const bakedSpheres = new Map<number, CanvasSurface>();

/** Spheres are baked per whole on-screen pixel of radius and drawn to the exact size. */
function bakedSphere(radius: number): { surface: CanvasSurface; drawRadius: number } {
  const key = Math.max(1, Math.ceil(radius));
  let surface = bakedSpheres.get(key);
  if (surface === undefined) {
    surface = bakeSphere(key);
    bakedSpheres.set(key, surface);
  }
  return { surface, drawRadius: radius * ((key + BAKE_PAD_PX) / key) };
}

/**
 * The cast-iron ball under a fixed upper-left light. Its shading never turns
 * with the spin, because the light does not, so it is baked once per size;
 * only the seam, neck and fuse, which are on the iron, turn with it.
 */
function bakeSphere(radius: number): CanvasSurface {
  const extent = (radius + BAKE_PAD_PX) * BAKE_SUPERSAMPLE;
  const size = Math.ceil(extent * 2);
  const surface = allocCanvas('props', size, size);
  const ctx = surfaceContext(surface);
  const r = radius * BAKE_SUPERSAMPLE;
  const c = size / 2;
  const traceSphere = (dx: number, dy: number): void => {
    ctx.beginPath();
    ctx.arc(c + dx * r, c + dy * r, r, 0, FULL_TURN);
  };

  traceSphere(0, 0);
  ctx.lineWidth = r * OUTLINE_WIDTH_SHARE * 2;
  ctx.strokeStyle = OUTLINE_INK;
  ctx.stroke();
  ctx.fillStyle = IRON_SHADOW;
  ctx.fill();

  ctx.save();
  traceSphere(0, 0);
  ctx.clip();

  traceSphere(LIT_SHIFT_X, LIT_SHIFT_Y);
  const litFill = ctx.createLinearGradient(c - r, c - r, c + r * LIT_SHIFT_X, c + r * LIT_SHIFT_Y);
  litFill.addColorStop(0, IRON_LIT);
  litFill.addColorStop(1, IRON);
  ctx.fillStyle = litFill;
  ctx.fill();
  ctx.strokeStyle = TERMINATOR_INK;
  ctx.lineWidth = r * TERMINATOR_WIDTH_SHARE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c, c, r, 0, FULL_TURN);
  ctx.arc(c + RIM_SHIFT_X * r, c + RIM_SHIFT_Y * r, r, 0, FULL_TURN);
  ctx.globalAlpha = REFLECTED_ALPHA;
  ctx.fillStyle = REFLECTED_LIGHT;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;

  const specX = c + SPECULAR_X * r;
  const specY = c + SPECULAR_Y * r;
  ctx.fillStyle = SPECULAR_HALO_INK;
  ctx.beginPath();
  ctx.ellipse(
    specX,
    specY,
    SPECULAR_RX * r * SPECULAR_HALO_SCALE,
    SPECULAR_RY * r * SPECULAR_HALO_SCALE,
    SPECULAR_TILT,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = SPECULAR_INK;
  ctx.beginPath();
  ctx.ellipse(specX, specY, SPECULAR_RX * r, SPECULAR_RY * r, SPECULAR_TILT, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
  return surface;
}

/** The neck and twisted fuse in the neck's frame (origin at the bomb's centre, -Y up the neck). */
function paintNeckAndFuse(
  ctx: CanvasRenderingContext2D,
  radius: number,
): { tipX: number; tipY: number } {
  const rootY = -radius * NECK_ROOT_SHARE;
  const neckHalf = (radius * NECK_WIDTH_SHARE) / 2;
  const neckTop = rootY - radius * NECK_LENGTH_SHARE;
  const lipHalf = (radius * NECK_LIP_WIDTH_SHARE) / 2;
  const lipTop = neckTop - radius * NECK_LIP_HEIGHT_SHARE;

  const tipX = radius * FUSE_END_X;
  const tipY = lipTop + radius * FUSE_END_Y;
  const controlX = radius * FUSE_CONTROL_X;
  const controlY = lipTop + radius * FUSE_CONTROL_Y;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = FUSE_WIDTH_PX + 1;
  ctx.beginPath();
  ctx.moveTo(0, lipTop);
  ctx.quadraticCurveTo(controlX, controlY, tipX, tipY);
  ctx.stroke();
  ctx.strokeStyle = FUSE_CORD;
  ctx.lineWidth = FUSE_WIDTH_PX;
  ctx.stroke();
  // A twisted cord reads by its slanted dark grooves crossing it.
  ctx.strokeStyle = FUSE_TWIST_INK;
  ctx.lineWidth = 1 / 2;
  for (let twist = 1; twist <= FUSE_TWISTS; twist++) {
    const t = twist / (FUSE_TWISTS + 1);
    const u = 1 - t;
    const x = 2 * u * t * controlX + t * t * tipX;
    const y = u * u * lipTop + 2 * u * t * controlY + t * t * tipY;
    ctx.beginPath();
    ctx.moveTo(x - FUSE_TWIST_HALF_PX, y - FUSE_TWIST_HALF_PX);
    ctx.lineTo(x + FUSE_TWIST_HALF_PX, y + FUSE_TWIST_HALF_PX);
    ctx.stroke();
  }

  ctx.fillStyle = OUTLINE_INK;
  ctx.fillRect(-lipHalf - 1 / 2, lipTop - 1 / 2, lipHalf * 2 + 1, rootY - lipTop + 1);
  ctx.fillStyle = NECK_IRON;
  ctx.fillRect(-neckHalf, neckTop, neckHalf * 2, rootY - neckTop);
  ctx.fillRect(-lipHalf, lipTop, lipHalf * 2, neckTop - lipTop);
  ctx.fillStyle = NECK_SHADE_INK;
  ctx.fillRect(0, neckTop, neckHalf, rootY - neckTop);
  ctx.fillRect(0, lipTop, lipHalf, neckTop - lipTop);
  return { tipX, tipY };
}

/** The light's direction on screen: up and to the left. */
const LIGHT_ANGLE = (-3 * Math.PI) / 4;

/**
 * Where on the seam's front half, as an angle in the bomb's own frame, the
 * light falls most squarely: the light stays put while the seam turns.
 */
function seamLitAngle(spin: number): number {
  const local = LIGHT_ANGLE - spin;
  const wrapped = local - FULL_TURN * Math.floor((local + Math.PI) / FULL_TURN);
  if (wrapped >= 0) return wrapped;
  return wrapped < -Math.PI / 2 ? Math.PI : 0;
}

/** The seam's front half, turned with the bomb; its ridge catches light only on the side facing it. */
function paintSeam(ctx: CanvasRenderingContext2D, radius: number, spin: number): void {
  const seamY = radius * SEAM_DROP;
  const seamRy = radius * SEAM_TILT_RY;
  const ridgeHalf = (Math.PI * SEAM_RIDGE_SPAN) / 2;
  const litAngle = seamLitAngle(spin);
  ctx.save();
  ctx.rotate(spin);
  ctx.lineWidth = SEAM_WIDTH_PX;
  ctx.strokeStyle = SEAM_INK;
  ctx.beginPath();
  ctx.ellipse(0, seamY, radius, seamRy, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = SEAM_RIDGE_INK;
  ctx.beginPath();
  ctx.ellipse(
    0,
    seamY + radius * SEAM_RIDGE_OFFSET,
    radius,
    seamRy,
    0,
    Math.max(0, litAngle - ridgeHalf),
    Math.min(Math.PI, litAngle + ridgeHalf),
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * A cast-iron bomb with a short neck and a lit, twisted fuse, centred on
 * screen point (x, y) and turned by `spin`. The light stays upper left however
 * it turns: one curved terminator, a tight specular and a faint bounce of
 * floor light under its lower rim are baked once, and only the seam round its
 * equator, the neck and the fuse turn with it.
 */
export function drawBlackPowderBombFlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  opts: BlackPowderBombFlightOptions,
): void {
  const radius = tileSize * BOMB_RADIUS_TILES;
  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.rotate(opts.spin);
  const fuse = paintNeckAndFuse(ctx, radius);
  ctx.restore();

  const { surface, drawRadius } = bakedSphere(radius);
  ctx.drawImage(surface, -drawRadius, -drawRadius, drawRadius * 2, drawRadius * 2);
  paintSeam(ctx, radius, opts.spin);
  ctx.restore();

  const cos = Math.cos(opts.spin);
  const sin = Math.sin(opts.spin);
  const tipX = x + cos * fuse.tipX - sin * fuse.tipY;
  const tipY = y + sin * fuse.tipX + cos * fuse.tipY;
  const burn = {
    ageFrames: opts.ageFrames,
    seed: opts.seed,
    velocityX: opts.velocityX ?? 0,
    velocityY: opts.velocityY ?? 0,
    urgent: false,
  };
  paintFuseSmoke(ctx, tipX, tipY, tileSize, burn);
  paintFuseSparks(ctx, tipX, tipY, tileSize, burn);
  paintFuseBead(ctx, tipX, tipY, tileSize, burn);
}

/**
 * A black powder blast, in world pixels like {@link drawDynamiteExplosion}:
 * the same painter with the black powder variant, so the goblins' bombs and
 * the player's look identical.
 */
export function drawBlackPowderExplosion(
  ctx: CanvasRenderingContext2D,
  picture: ExplosionPicture,
  camX: number,
  camY: number,
): void {
  drawDynamiteExplosion(ctx, picture, camX, camY, 'black_powder');
}

const SHADOW_RADIUS_TILES = 0.24;
/** The floor is seen at an angle, so a round shadow lies flattened. */
const SHADOW_SQUASH = 0.45;
const SHADOW_PEAK_ALPHA = 0.55;
/** Height, in tiles, at which the shadow has spread and faded to its weakest. */
const SHADOW_FADE_HEIGHT_TILES = 2.5;
/** Shares of full strength and of a hard edge a shadow keeps at its highest. */
const SHADOW_MIN_STRENGTH = 0.4;
const SHADOW_MAX_SPREAD = 1.7;
/** Where the shadow's solid core ends, as a share of its radius, at the floor and at its highest. */
const SHADOW_CORE_LOW = 0.6;
const SHADOW_CORE_HIGH = 0;
const SHADOW_INK_RGB = '0, 0, 0';

/**
 * The shadow on the floor at screen point (x, y) under a thrown object
 * `heightPx` above it. High up it is wide, faint and soft-edged; as the object
 * comes down it shrinks, darkens and its edge hardens onto the landing point,
 * which is how the eye reads a lob's height.
 */
export function drawThrownBombShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heightPx: number,
  tileSize: number,
): void {
  const height = Math.min(1, Math.max(0, heightPx / (tileSize * SHADOW_FADE_HEIGHT_TILES)));
  const spread = 1 + (SHADOW_MAX_SPREAD - 1) * height;
  const strength = 1 - (1 - SHADOW_MIN_STRENGTH) * height;
  const core = SHADOW_CORE_LOW + (SHADOW_CORE_HIGH - SHADOW_CORE_LOW) * height;
  const radius = tileSize * SHADOW_RADIUS_TILES * spread;
  const alpha = SHADOW_PEAK_ALPHA * strength;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${SHADOW_INK_RGB}, ${alpha})`);
  gradient.addColorStop(core, `rgba(${SHADOW_INK_RGB}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${SHADOW_INK_RGB}, 0)`);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, SHADOW_SQUASH);
  ctx.translate(-x, -y);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}
