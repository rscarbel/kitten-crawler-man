/**
 * The time limit's scripted death: Caroline ends a crawler who took too long
 * on a Nightmare floor. The body swells and shudders, bursts into a spray of
 * blood, and leaves a wide red pool on the floor.
 *
 * Painted straight onto the canvas each frame from a handful of paths, as a
 * pure function of the frame, so it holds no surfaces and replays exactly.
 * Every length is in tiles and scaled by the tile size it is drawn at. The
 * point it is centred on is where the crawler's feet stood.
 */

import { lerp } from './art/propPaint';
import { hashUnit } from './flameStamps';

/** World ticks the whole death plays for, from the first swell to the last droplet landing. */
export const TIME_LIMIT_DETONATION_FRAMES = 60;

/** The tick the body bursts: the crawler is not drawn from here on. */
export const TIME_LIMIT_DETONATION_TAKEN_FRAME = 36;

/** How far above the feet the body's middle is, in tiles: where it swells and bursts from. */
export const TIME_LIMIT_DETONATION_BODY_RISE_TILES = 0.45;

/** Ticks the pool takes to spread to its full size. */
const POOL_SPREAD_FRAMES = 75;

/** The swelling body, in tiles and ticks. */
const SWELL = {
  startRadius: 0.28,
  endRadius: 0.62,
  /** Taller than wide, like the body it covers. */
  heightShare: 1.2,
  startAlpha: 0.3,
  endAlpha: 0.92,
  /** The shudder grows from nothing to this, in tiles. */
  maxShakeTiles: 0.09,
  shakeRateX: 2.3,
  shakeRateY: 3.1,
  /** A throb on top of the growth: its depth as a share of the radius, and its rate per tick. */
  throbShare: 0.06,
  throbRate: 0.9,
  veins: 5,
  veinWidthTiles: 1 / 28,
  /** Where the bright inner flesh gives way to the dark rim, as a share of the radius. */
  fleshShare: 0.35,
} as const;

/** The burst, in tiles and ticks from the moment the body goes. */
const BURST = {
  flashFrames: 8,
  flashMaxRadius: 1.1,
  /** Where the flash stays solid before it fades to its rim, as a share of its radius. */
  flashSolidShare: 0.4,
  droplets: 28,
  dropletLifeFrames: TIME_LIMIT_DETONATION_FRAMES - TIME_LIMIT_DETONATION_TAKEN_FRAME,
  dropletMaxSpread: 2.1,
  dropletMinSpreadShare: 0.35,
  dropletMaxRise: 1.2,
  dropletMinRiseShare: 0.3,
  dropletMinRadius: 0.04,
  dropletRadiusSpread: 0.06,
  /** A parabola's peak height is a quarter of this factor times the rise. */
  parabolaFactor: 4,
} as const;

const POOL = {
  maxRadius: 2.1,
  /** Floor ellipses are this much shorter than they are wide, for the camera's tilt. */
  perspective: 0.5,
  heartShare: 0.55,
  lobes: 8,
  lobeReach: 0.65,
  lobeMinShare: 0.4,
  lobeShareSpread: 0.35,
  /** Where each soft blot stays solid before it fades to its rim, as a share of its radius. */
  blotSolidShare: 0.55,
  /** Spatter flung past the pool's edge. */
  spatters: 14,
  spatterMinReach: 0.95,
  spatterReachSpread: 0.6,
  spatterMinRadius: 0.05,
  spatterRadiusSpread: 0.07,
} as const;

const INK = {
  fleshCore: 'rgba(214, 74, 70, 1)',
  fleshRim: 'rgba(120, 12, 20, 1)',
  vein: 'rgba(70, 4, 12, 0.85)',
  flash: 'rgba(236, 60, 52, 0.85)',
  flashClear: 'rgba(236, 60, 52, 0)',
  droplet: 'rgba(150, 14, 22, 0.95)',
  poolEdge: 'rgba(132, 14, 20, 0.6)',
  poolClear: 'rgba(132, 14, 20, 0)',
  poolHeart: 'rgba(82, 4, 10, 0.78)',
  poolHeartClear: 'rgba(82, 4, 10, 0)',
  spatter: 'rgba(110, 10, 16, 0.75)',
} as const;

const TAU = Math.PI * 2;
/** The middle of `hashUnit`'s range, so a scattered bend leans either way. */
const SCATTER_MIDPOINT = 0.5;
const DROPLET_SALT = 11;
const VEIN_SALT = 17;
const POOL_SALT = 23;
const SPATTER_SALT = 29;

/** 0 at `from`, 1 at `to`, clamped. */
function progress(frame: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (frame - from) / (to - from)));
}

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * One frame of the death, centred on (`screenX`, `screenY`), the screen point
 * under the crawler's feet. Draws nothing outside the death's frames.
 */
export function drawTimeLimitDetonationSprite(
  ctx: CanvasRenderingContext2D,
  frame: number,
  screenX: number,
  screenY: number,
  tileSize: number,
): void {
  if (frame < 0 || frame >= TIME_LIMIT_DETONATION_FRAMES) return;
  const bodyY = screenY - TIME_LIMIT_DETONATION_BODY_RISE_TILES * tileSize;
  ctx.save();
  if (frame < TIME_LIMIT_DETONATION_TAKEN_FRAME) {
    drawSwell(ctx, frame, screenX, bodyY, tileSize);
  } else {
    const burstFrame = frame - TIME_LIMIT_DETONATION_TAKEN_FRAME;
    drawFlash(ctx, burstFrame, screenX, bodyY, tileSize);
    drawDroplets(ctx, burstFrame, screenX, screenY, tileSize);
  }
  ctx.restore();
}

/** The body bloating red over the crawler, shuddering harder the nearer it is to bursting. */
function drawSwell(
  ctx: CanvasRenderingContext2D,
  frame: number,
  x: number,
  y: number,
  t: number,
): void {
  const swell = easeIn(progress(frame, 0, TIME_LIMIT_DETONATION_TAKEN_FRAME));
  const shake = SWELL.maxShakeTiles * swell * t;
  const cx = x + Math.sin(frame * SWELL.shakeRateX) * shake;
  const cy = y + Math.cos(frame * SWELL.shakeRateY) * shake;
  const throb = 1 + Math.sin(frame * SWELL.throbRate) * SWELL.throbShare * swell;
  const radius = lerp(SWELL.startRadius, SWELL.endRadius, swell) * throb * t;
  const height = radius * SWELL.heightShare;

  ctx.globalAlpha = lerp(SWELL.startAlpha, SWELL.endAlpha, swell);
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, height);
  gradient.addColorStop(0, INK.fleshCore);
  gradient.addColorStop(SWELL.fleshShare, INK.fleshCore);
  gradient.addColorStop(1, INK.fleshRim);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius, height, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = INK.vein;
  ctx.lineWidth = Math.max(1, SWELL.veinWidthTiles * t);
  for (let i = 0; i < SWELL.veins; i++) {
    const angle = hashUnit(i, VEIN_SALT) * TAU;
    const bend = (hashUnit(i, VEIN_SALT + 1) - SCATTER_MIDPOINT) * radius;
    const startX = cx + Math.cos(angle) * radius * SWELL.fleshShare;
    const startY = cy + Math.sin(angle) * height * SWELL.fleshShare;
    const endX = cx + Math.cos(angle) * radius;
    const endY = cy + Math.sin(angle) * height;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo((startX + endX) / 2 + bend, (startY + endY) / 2 - bend, endX, endY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The red flash where the body was, gone within a few ticks. */
function drawFlash(
  ctx: CanvasRenderingContext2D,
  burstFrame: number,
  x: number,
  y: number,
  t: number,
): void {
  const life = progress(burstFrame, 0, BURST.flashFrames);
  if (life >= 1) return;
  // Starts at the swollen body's full size, so the tick it bursts reads as a
  // burst rather than as the body simply vanishing.
  const radius = lerp(SWELL.endRadius, BURST.flashMaxRadius, easeOut(life)) * t;
  ctx.globalAlpha = 1 - life;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, INK.flash);
  gradient.addColorStop(BURST.flashSolidShare, INK.flash);
  gradient.addColorStop(1, INK.flashClear);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Blood thrown up and out from the body, falling back to the floor around the feet. */
function drawDroplets(
  ctx: CanvasRenderingContext2D,
  burstFrame: number,
  feetX: number,
  feetY: number,
  t: number,
): void {
  const life = progress(burstFrame, 0, BURST.dropletLifeFrames);
  if (life >= 1) return;
  const launchHeight = TIME_LIMIT_DETONATION_BODY_RISE_TILES * t;
  ctx.fillStyle = INK.droplet;
  ctx.globalAlpha = 1 - life * life;
  for (let i = 0; i < BURST.droplets; i++) {
    const angle = hashUnit(i, DROPLET_SALT) * TAU;
    const spreadShare =
      BURST.dropletMinSpreadShare +
      hashUnit(i, DROPLET_SALT + 1) * (1 - BURST.dropletMinSpreadShare);
    const riseShare =
      BURST.dropletMinRiseShare + hashUnit(i, DROPLET_SALT + 2) * (1 - BURST.dropletMinRiseShare);
    const spread = BURST.dropletMaxSpread * spreadShare * t * easeOut(life);
    const lift = BURST.dropletMaxRise * riseShare * t * BURST.parabolaFactor * life * (1 - life);
    // Launched from the body's middle and landing on the floor, so the height it starts at drains away.
    const height = launchHeight * (1 - life) + lift;
    const radius =
      (BURST.dropletMinRadius + hashUnit(i, DROPLET_SALT + 3) * BURST.dropletRadiusSpread) * t;
    ctx.beginPath();
    ctx.arc(
      feetX + Math.cos(angle) * spread,
      feetY + Math.sin(angle) * spread * POOL.perspective - height,
      radius,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The pool left on the floor, `ageFrames` after it began to spread, centred on
 * (`screenX`, `screenY`). It spreads, then stays.
 */
export function drawTimeLimitBloodPoolSprite(
  ctx: CanvasRenderingContext2D,
  ageFrames: number,
  screenX: number,
  screenY: number,
  tileSize: number,
): void {
  if (ageFrames < 0) return;
  const spread = easeOut(progress(ageFrames, 0, POOL_SPREAD_FRAMES));
  const radius = POOL.maxRadius * tileSize * spread;
  if (radius <= 0) return;
  ctx.save();
  for (let lobe = 0; lobe < POOL.lobes; lobe++) {
    const angle = hashUnit(lobe, POOL_SALT) * TAU;
    const reach = radius * POOL.lobeReach * hashUnit(lobe, POOL_SALT + 1);
    const lobeRadius =
      radius * (POOL.lobeMinShare + hashUnit(lobe, POOL_SALT + 2) * POOL.lobeShareSpread);
    softBlot(
      ctx,
      screenX + Math.cos(angle) * reach,
      screenY + Math.sin(angle) * reach * POOL.perspective,
      lobeRadius,
      INK.poolEdge,
      INK.poolClear,
    );
  }
  softBlot(ctx, screenX, screenY, radius * POOL.heartShare, INK.poolHeart, INK.poolHeartClear);

  ctx.fillStyle = INK.spatter;
  for (let i = 0; i < POOL.spatters; i++) {
    const angle = hashUnit(i, SPATTER_SALT) * TAU;
    const reach =
      radius * (POOL.spatterMinReach + hashUnit(i, SPATTER_SALT + 1) * POOL.spatterReachSpread);
    const dotRadius =
      (POOL.spatterMinRadius + hashUnit(i, SPATTER_SALT + 2) * POOL.spatterRadiusSpread) * tileSize;
    ctx.beginPath();
    ctx.ellipse(
      screenX + Math.cos(angle) * reach,
      screenY + Math.sin(angle) * reach * POOL.perspective,
      dotRadius,
      dotRadius * POOL.perspective,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();
}

/** A round wash fading from `inner` at its centre to `outer` at its rim, flattened onto the floor. */
function softBlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  inner: string,
  outer: string,
): void {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(POOL.blotSolidShare, inner);
  gradient.addColorStop(1, outer);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, POOL.perspective);
  ctx.translate(-x, -y);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}
