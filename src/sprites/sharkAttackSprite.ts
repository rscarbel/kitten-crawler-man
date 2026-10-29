/**
 * The shark scripted death: a great white's head bursting up out of the water
 * under a crawler, its jaws closing on them, and the head sinking back into a
 * churn of foam; and the red pool it leaves on the surface.
 *
 * Painted straight onto the canvas each frame from a handful of paths, as a
 * pure function of the frame, so it holds no surfaces and replays exactly.
 * Every length is in tiles and scaled by the tile size it is drawn at.
 */

import { GREAT_WHITE_INK } from './art/greatWhiteInk';
import { lerp } from './art/propPaint';

/** World ticks the whole breach plays for, from the first swell to the last ripple. */
export const SHARK_ATTACK_FRAMES = 84;

/** The tick the jaws close on the victim: they are not drawn from here on. */
export const SHARK_ATTACK_TAKEN_FRAME = 24;

/** Ticks the red pool takes to spread to its full size. */
const SHARK_BLOOD_POOL_SPREAD_FRAMES = 90;

/** The beats of the breach, in world ticks from its start. */
const BEATS = {
  /** The dark shape and the swell under the surface before it breaks. */
  swellEnd: 10,
  /** The head at its full height, mouth wide. */
  peak: 18,
  /** The jaws shut. */
  bite: SHARK_ATTACK_TAKEN_FRAME,
  /** It holds, thrashing, before it drops. */
  holdEnd: 40,
  /** Back under the surface. */
  sunk: 54,
} as const;

/** The head's shape, in tiles, with its base on the waterline. */
const HEAD = {
  height: 1.7,
  halfWidth: 0.55,
  /** How far up the head the widest point sits, as a share of its height. */
  widestAt: 0.25,
  snoutHalfWidth: 0.14,
  /** The white belly's reach up the front, as a share of the head's height. */
  bellyTop: 0.46,
  bellyHalfWidth: 0.38,
  /** The belly's edge is ragged: grey tongues reach down into the white this far, as a share of its size. */
  bellyTeeth: 26,
  bellyTongue: 0.12,
  /** The lit rim down the head's left side, as a share of its half-width. */
  rimFrom: -0.92,
  rimTo: -0.62,
  /** The mouth's centre up the front, and its size when wide open. */
  mouthCentre: 0.45,
  mouthHalfWidth: 0.36,
  mouthHalfHeightOpen: 0.3,
  /** The upper jaw arches higher in the middle than at the corners; the lower jaw sags less. */
  upperArch: 1.5,
  lowerArch: 1.1,
  /** The rim of gum around the mouth, as a share of the mouth's size. */
  gumRim: 0.1,
  teethPerJaw: 7,
  toothLength: 0.11,
  eyeHeight: 0.74,
  eyeSpread: 0.3,
  eyeRadius: 0.055,
  /** The gill slits low on each side. */
  gillHeight: 0.08,
  gillSpacing: 0.055,
  gillLength: 0.15,
  gillCount: 5,
  /** The side-to-side thrash while it holds, in tiles and radians per tick. */
  thrashTiles: 0.06,
  thrashRate: 0.9,
} as const;

/** How the surface reacts, in tiles. */
const WATER = {
  /** Ellipses on the surface are this much shorter than they are wide, for the camera's tilt. */
  perspective: 0.42,
  swellRadius: 0.6,
  rippleCount: 3,
  rippleMaxRadius: 1.8,
  rippleSpacingFrames: 9,
  rippleLifeFrames: 40,
  foamRadius: 0.75,
  dropletCount: 16,
  dropletMaxRise: 1.4,
  dropletMaxSpread: 1.3,
  dropletLifeFrames: 26,
  dropletRadius: 0.06,
  /** A second burst of spray as the head crashes back down. */
  crashFrame: BEATS.holdEnd + 6,
} as const;

const POOL = {
  maxRadius: 1.4,
  /** The darker heart of the pool, as a share of its radius. */
  heartShare: 0.55,
  /** Soft blooms the pool is built from, so its edge thins into the murk instead of ending. */
  lobes: 6,
  lobeReach: 0.6,
  lobeMinShare: 0.45,
  lobeShareSpread: 0.3,
  /** A brighter strand of blood curling through it, turning this far each tick. */
  strandTurnPerTick: 0.004,
  strandSweep: 2.2,
  strandRadiusShare: 0.6,
  strandWidthTiles: 1 / 20,
} as const;

const INK = {
  sharkBack: GREAT_WHITE_INK.back,
  sharkBackShade: GREAT_WHITE_INK.backShade,
  sharkBackLight: GREAT_WHITE_INK.backLight,
  sharkBelly: GREAT_WHITE_INK.belly,
  sharkBellyShade: GREAT_WHITE_INK.bellyShade,
  mouth: GREAT_WHITE_INK.mouth,
  gum: GREAT_WHITE_INK.gum,
  tooth: GREAT_WHITE_INK.tooth,
  eye: GREAT_WHITE_INK.eye,
  gill: GREAT_WHITE_INK.gill,
  outline: GREAT_WHITE_INK.outline,
  swell: 'rgba(10, 14, 11, 0.5)',
  ripple: 'rgba(204, 210, 190, 0.85)',
  foam: 'rgba(224, 226, 210, 0.85)',
  collar: 'rgba(182, 190, 168, 0.5)',
  droplet: 'rgba(214, 220, 200, 0.95)',
  bloodDroplet: 'rgba(158, 20, 28, 0.95)',
  poolEdge: 'rgba(150, 18, 24, 0.55)',
  poolClear: 'rgba(150, 18, 24, 0)',
  poolHeart: 'rgba(96, 6, 12, 0.7)',
  poolHeartClear: 'rgba(96, 6, 12, 0)',
  poolStrand: 'rgba(186, 40, 44, 0.55)',
} as const;

const TAU = Math.PI * 2;

/** 0 at `from`, 1 at `to`, clamped. */
function progress(frame: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (frame - from) / (to - from)));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** A fixed pseudo-random value in [0, 1) for `index`, so the spray is the same every play. */
function scatter(index: number, salt: number): number {
  const wave = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return wave - Math.floor(wave);
}

/** How far out of the water the head stands, as a share of its height. */
function riseShare(frame: number): number {
  if (frame < BEATS.swellEnd) return 0;
  if (frame < BEATS.peak) return easeOut(progress(frame, BEATS.swellEnd, BEATS.peak));
  if (frame < BEATS.holdEnd) return 1;
  return 1 - progress(frame, BEATS.holdEnd, BEATS.sunk) ** 2;
}

/** How wide the mouth is open, 0 shut to 1 wide. */
function gape(frame: number): number {
  if (frame < BEATS.peak) return progress(frame, BEATS.swellEnd, BEATS.peak);
  return 1 - progress(frame, BEATS.peak, BEATS.bite);
}

function surfaceEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * WATER.perspective, 0, 0, TAU);
}

function drawSwell(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, t: number) {
  const grow = progress(frame, 0, BEATS.swellEnd);
  const fade = 1 - progress(frame, BEATS.peak, BEATS.sunk);
  if (grow <= 0 || fade <= 0) return;
  ctx.globalAlpha = fade;
  ctx.fillStyle = INK.swell;
  surfaceEllipse(ctx, x, y, WATER.swellRadius * t * (0.5 + grow / 2));
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawRipples(
  ctx: CanvasRenderingContext2D,
  frame: number,
  x: number,
  y: number,
  t: number,
): void {
  ctx.strokeStyle = INK.ripple;
  ctx.lineWidth = Math.max(1, t / 16);
  for (let ring = 0; ring < WATER.rippleCount; ring++) {
    const born = BEATS.swellEnd + ring * WATER.rippleSpacingFrames;
    const age = progress(frame, born, born + WATER.rippleLifeFrames);
    if (age <= 0 || age >= 1) continue;
    ctx.globalAlpha = 1 - age;
    surfaceEllipse(ctx, x, y, WATER.rippleMaxRadius * t * easeOut(age));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawFoam(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, t: number) {
  const churn = Math.max(
    progress(frame, BEATS.swellEnd, BEATS.peak) * (1 - progress(frame, BEATS.bite, BEATS.holdEnd)),
    1 - Math.abs(frame - WATER.crashFrame) / BEATS.peak,
  );
  if (churn <= 0) return;
  ctx.globalAlpha = Math.min(1, churn);
  ctx.fillStyle = INK.foam;
  surfaceEllipse(ctx, x, y, WATER.foamRadius * t * (0.6 + churn * 0.4));
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** One burst of spray thrown up and out from the breach, falling back under gravity. */
function drawSpray(
  ctx: CanvasRenderingContext2D,
  colour: string,
  frame: number,
  burstFrame: number,
  salt: number,
  x: number,
  y: number,
  t: number,
): void {
  const life = progress(frame, burstFrame, burstFrame + WATER.dropletLifeFrames);
  if (life <= 0 || life >= 1) return;
  ctx.fillStyle = colour;
  ctx.globalAlpha = 1 - life * life;
  for (let i = 0; i < WATER.dropletCount; i++) {
    const angle = scatter(i, salt) * TAU;
    const spread = WATER.dropletMaxSpread * (0.4 + scatter(i, salt + 1) * 0.6) * t;
    const rise = WATER.dropletMaxRise * (0.4 + scatter(i, salt + 2) * 0.6) * t;
    const dx = Math.cos(angle) * spread * life;
    const surfaceDy = Math.sin(angle) * spread * life * WATER.perspective;
    // A parabola: up and out, then back down onto the surface.
    const lift = rise * 4 * life * (1 - life);
    ctx.beginPath();
    ctx.arc(x + dx, y + surfaceDy - lift, WATER.dropletRadius * t, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The head's outline, base on the waterline at (0, 0), snout up. */
function headPath(ctx: CanvasRenderingContext2D, t: number): void {
  const h = HEAD.height * t;
  const w = HEAD.halfWidth * t;
  const widestY = -h * HEAD.widestAt;
  const snoutW = HEAD.snoutHalfWidth * t;
  ctx.beginPath();
  ctx.moveTo(-w * 0.9, 0);
  ctx.quadraticCurveTo(-w * 1.05, widestY, -w * 0.8, -h * 0.6);
  ctx.quadraticCurveTo(-snoutW * 1.6, -h * 0.97, 0, -h);
  ctx.quadraticCurveTo(snoutW * 1.6, -h * 0.97, w * 0.8, -h * 0.6);
  ctx.quadraticCurveTo(w * 1.05, widestY, w * 0.9, 0);
  ctx.closePath();
}

/** Serrated triangular teeth along a jaw whose height at `x` is `jawY(x)`. */
function drawTeeth(
  ctx: CanvasRenderingContext2D,
  jawY: (x: number) => number,
  halfWidth: number,
  pointing: 1 | -1,
  t: number,
): void {
  const toothLength = HEAD.toothLength * t;
  const step = (halfWidth * 2) / HEAD.teethPerJaw;
  ctx.fillStyle = INK.tooth;
  ctx.beginPath();
  for (let i = 0; i < HEAD.teethPerJaw; i++) {
    const left = -halfWidth + i * step;
    const right = left + step;
    const middle = left + step / 2;
    // Teeth shorten toward the corners of the jaw, where it curves away.
    const across = 1 - Math.abs((i + 0.5) / HEAD.teethPerJaw - 0.5) * 1.2;
    ctx.moveTo(left, jawY(left));
    ctx.lineTo(middle, jawY(middle) + pointing * toothLength * across);
    ctx.lineTo(right, jawY(right));
  }
  ctx.fill();
}

/** A jaw's height across the mouth: `centreY` in the middle, falling to `cornerY` at the corners. */
function archY(x: number, halfWidth: number, centreY: number, cornerY: number): number {
  const share = Math.min(1, Math.abs(x) / halfWidth);
  return lerp(centreY, cornerY, share * share);
}

/**
 * The white front of the head: a dome up the throat whose edge is the great
 * white's hard, ragged countershading line rather than a smooth curve.
 */
function bellyPath(ctx: CanvasRenderingContext2D, halfWidth: number, height: number): void {
  ctx.beginPath();
  ctx.moveTo(-halfWidth, 0);
  for (let i = 0; i <= HEAD.bellyTeeth; i++) {
    const angle = Math.PI + (Math.PI * i) / HEAD.bellyTeeth;
    const tongue = i % 2 === 1 ? 1 - HEAD.bellyTongue * (0.5 + scatter(i, BELLY_SALT) * 0.5) : 1;
    ctx.lineTo(Math.cos(angle) * halfWidth * tongue, Math.sin(angle) * height * tongue);
  }
  ctx.lineTo(halfWidth, 0);
  ctx.closePath();
}
const BELLY_SALT = 7;

function drawHead(ctx: CanvasRenderingContext2D, frame: number, t: number): void {
  const h = HEAD.height * t;
  const open = gape(frame);

  headPath(ctx, t);
  ctx.fillStyle = INK.sharkBack;
  ctx.fill();
  ctx.lineWidth = Math.max(1, t / 20);
  ctx.strokeStyle = INK.outline;
  ctx.stroke();

  // Banded light from the upper left: a lit rim down the near side, the far side in shadow,
  // so the head reads as a round cone rather than a cut-out.
  ctx.save();
  headPath(ctx, t);
  ctx.clip();
  const w = HEAD.halfWidth * t;
  ctx.fillStyle = INK.sharkBackLight;
  ctx.fillRect(w * HEAD.rimFrom, -h, w * (HEAD.rimTo - HEAD.rimFrom), h);
  ctx.fillStyle = INK.sharkBackShade;
  ctx.fillRect(w * 0.35, -h, w, h);

  ctx.fillStyle = INK.sharkBelly;
  bellyPath(ctx, HEAD.bellyHalfWidth * t, h * HEAD.bellyTop);
  ctx.fill();
  ctx.save();
  bellyPath(ctx, HEAD.bellyHalfWidth * t, h * HEAD.bellyTop);
  ctx.clip();
  ctx.fillStyle = INK.sharkBellyShade;
  ctx.fillRect(HEAD.bellyHalfWidth * t * 0.3, -h, HEAD.bellyHalfWidth * t, h);
  ctx.restore();
  ctx.restore();

  ctx.strokeStyle = INK.gill;
  ctx.lineWidth = Math.max(1, t / 24);
  for (const side of [-1, 1] as const) {
    for (let g = 0; g < HEAD.gillCount; g++) {
      const gy = -h * (HEAD.gillHeight + g * HEAD.gillSpacing);
      const gx = side * HEAD.halfWidth * t * 0.78;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx - side * HEAD.gillLength * t * 0.3, gy - HEAD.gillLength * t);
      ctx.stroke();
    }
  }

  const mouthY = -h * HEAD.mouthCentre;
  const mouthW = HEAD.mouthHalfWidth * t;
  const mouthH = Math.max(t / 32, HEAD.mouthHalfHeightOpen * t * open);
  const upperTop = mouthY - mouthH * HEAD.upperArch;
  const lowerBottom = mouthY + mouthH * HEAD.lowerArch;
  // Each jaw is a quadratic through the corners; its control sits twice as far out as the jaw reaches.
  const jawPath = (rim: number) => {
    ctx.beginPath();
    ctx.moveTo(-mouthW * (1 + rim), mouthY);
    ctx.quadraticCurveTo(
      0,
      mouthY + (upperTop - mouthY) * 2 * (1 + rim),
      mouthW * (1 + rim),
      mouthY,
    );
    ctx.quadraticCurveTo(
      0,
      mouthY + (lowerBottom - mouthY) * 2 * (1 + rim),
      -mouthW * (1 + rim),
      mouthY,
    );
    ctx.closePath();
  };
  ctx.fillStyle = INK.gum;
  jawPath(HEAD.gumRim);
  ctx.fill();
  ctx.fillStyle = INK.mouth;
  jawPath(0);
  ctx.fill();
  const toothSpan = mouthW * 0.82;
  drawTeeth(ctx, (x) => archY(x, mouthW, upperTop, mouthY), toothSpan, 1, t);
  drawTeeth(ctx, (x) => archY(x, mouthW, lowerBottom, mouthY), toothSpan, -1, t);

  ctx.fillStyle = INK.eye;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(side * HEAD.eyeSpread * t, -h * HEAD.eyeHeight, HEAD.eyeRadius * t, 0, TAU);
    ctx.fill();
  }
}

/**
 * One frame of the breach, centred on the surface point (`screenX`, `screenY`)
 * where the victim stood.
 */
export function drawSharkAttackSprite(
  ctx: CanvasRenderingContext2D,
  frame: number,
  screenX: number,
  screenY: number,
  tileSize: number,
): void {
  if (frame < 0 || frame >= SHARK_ATTACK_FRAMES) return;
  const t = tileSize;
  ctx.save();
  drawSwell(ctx, frame, screenX, screenY, t);
  drawRipples(ctx, frame, screenX, screenY, t);
  drawFoam(ctx, frame, screenX, screenY, t);

  const rise = riseShare(frame);
  if (rise > 0) {
    const thrashing = frame >= BEATS.bite && frame < BEATS.holdEnd;
    const thrash = thrashing ? Math.sin(frame * HEAD.thrashRate) * HEAD.thrashTiles * t : 0;
    ctx.save();
    // Everything below the waterline is under the surface and unseen.
    ctx.beginPath();
    ctx.rect(
      screenX - HEAD.height * t,
      screenY - HEAD.height * t * 2,
      HEAD.height * t * 2,
      HEAD.height * t * 2,
    );
    ctx.clip();
    ctx.translate(screenX + thrash, screenY + HEAD.height * t * (1 - rise));
    drawHead(ctx, frame, t);
    ctx.restore();
    // The surface closes over the head's base, so it rises out of the water rather than off it.
    ctx.fillStyle = INK.collar;
    surfaceEllipse(ctx, screenX, screenY, HEAD.halfWidth * t * 1.1);
    ctx.fill();
  }

  drawSpray(ctx, INK.droplet, frame, BEATS.swellEnd, 1, screenX, screenY, t);
  // The jaws closing throw up the only red the breach shows before the pool spreads.
  drawSpray(ctx, INK.bloodDroplet, frame, BEATS.bite, 3, screenX, screenY, t);
  drawSpray(ctx, INK.droplet, frame, WATER.crashFrame, 2, screenX, screenY, t);
  ctx.restore();
}

/**
 * The red pool left on the surface, `ageFrames` after it began to spread,
 * centred on (`screenX`, `screenY`). It spreads, then stays.
 */
export function drawSharkBloodPoolSprite(
  ctx: CanvasRenderingContext2D,
  ageFrames: number,
  screenX: number,
  screenY: number,
  tileSize: number,
): void {
  if (ageFrames < 0) return;
  const spread = easeOut(progress(ageFrames, 0, SHARK_BLOOD_POOL_SPREAD_FRAMES));
  const radius = POOL.maxRadius * tileSize * spread;
  if (radius <= 0) return;
  ctx.save();
  for (let lobe = 0; lobe < POOL.lobes; lobe++) {
    const angle = scatter(lobe, POOL_SALT) * TAU;
    const reach = radius * POOL.lobeReach * scatter(lobe, POOL_SALT + 1);
    const lobeRadius =
      radius * (POOL.lobeMinShare + scatter(lobe, POOL_SALT + 2) * POOL.lobeShareSpread);
    softBlot(
      ctx,
      screenX + Math.cos(angle) * reach,
      screenY + Math.sin(angle) * reach * WATER.perspective,
      lobeRadius,
      INK.poolEdge,
      INK.poolClear,
    );
  }
  softBlot(ctx, screenX, screenY, radius * POOL.heartShare, INK.poolHeart, INK.poolHeartClear);

  const turn = ageFrames * POOL.strandTurnPerTick;
  ctx.strokeStyle = INK.poolStrand;
  ctx.lineWidth = Math.max(1, tileSize * POOL.strandWidthTiles);
  ctx.beginPath();
  ctx.ellipse(
    screenX,
    screenY,
    radius * POOL.strandRadiusShare,
    radius * POOL.strandRadiusShare * WATER.perspective,
    0,
    turn,
    turn + POOL.strandSweep,
  );
  ctx.stroke();
  ctx.restore();
}

const POOL_SALT = 5;

/** A round wash fading from `inner` at its centre to `outer` at its rim, flattened onto the surface. */
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
  gradient.addColorStop(POOL_BLOT_SOLID_SHARE, inner);
  gradient.addColorStop(1, outer);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, WATER.perspective);
  ctx.translate(-x, -y);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** How much of a blot's radius is solid before it starts to thin. */
const POOL_BLOT_SOLID_SHARE = 0.55;
