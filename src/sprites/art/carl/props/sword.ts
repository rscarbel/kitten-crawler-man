/**
 * The Fury of Taranis: a bronze-hilted, silver-bladed arming sword with
 * lightning living along its edge, painted in its own frame — the fist's grip
 * at the origin, the blade running out along +X, the pommel behind along −X,
 * in figure units.
 *
 * It is an equipment-chosen item, composited between his cell's two layers
 * rather than painted inside them, so unlike a row's own prop it carries its
 * own outline: drawn over the floor without one, a two-pixel blade has no
 * edge to read against the stone.
 */

import { type Pt, rgba } from '../../carlArt';
import { printHash } from '../paint';
import { FAR_LIMB_SHADE, receded, recededGloss } from '../palette';
import {
  TARANIS_BRONZE,
  TARANIS_GRIP_WRAP,
  TARANIS_LIGHTNING,
  TARANIS_OUTLINE,
  TARANIS_SILVER,
} from '../../taranisPalette';

type Ctx = CanvasRenderingContext2D;

/** From the grip's centre back to the pommel's centre. */
const POMMEL_BEHIND = 0.085;
const POMMEL_RADIUS = 0.03;
/** The pommel's lit cap sits up and back toward the key light, a little under half its size. */
const POMMEL_GLINT_TOWARD_LIGHT = 0.3;
const POMMEL_GLINT_SIZE = 0.45;
/** The grip's half-thickness, wrapped leather between the fist's two edges. */
const GRIP_HALF = 0.018;
/** From the grip's centre forward to the crossguard. */
const GUARD_AHEAD = 0.07;
/** The crossguard's half-span across the blade, and its half-thickness along it. */
const GUARD_HALF_SPAN = 0.105;
const GUARD_HALF_THICK = 0.022;
/**
 * The blade, guard to tip. Long enough to reach well past his fist at the
 * 32 px tile — a sword shorter than his forearm reads as a dagger.
 */
const BLADE_LENGTH = 0.74;
const BLADE_HALF_AT_GUARD = 0.036;
/** Where the edges begin to close toward the point, as a share of the blade from the guard. */
const BLADE_TAPER_FROM = 0.78;
const BLADE_HALF_AT_TAPER = 0.03;
/** The fuller's ridge highlight runs from just past the guard to short of the point. */
const RIDGE_FROM_SHARE = 0.06;
const RIDGE_TO_SHARE = 0.84;
const RIDGE_WIDTH = 0.012;
/** Outline round the whole silhouette, in figure units. */
export const SWORD_OUTLINE_WIDTH = 0.02;

/** Where the edge's lightning runs: along both edges, starting a little past the guard. */
const CRACKLE_FROM_SHARE = 0.12;
const CRACKLE_TO_SHARE = 1;
/** How many kinks one edge's arc has, and how far one strays off the edge. */
const CRACKLE_SEGMENTS = 9;
const CRACKLE_STRAY = 0.034;
/**
 * A kink strays half its draw off the edge and half along it, and the off-edge
 * half always points outward, so the arc wanders over the steel's edge rather
 * than across the blade's face.
 */
const CRACKLE_OUTWARD_SHARE = 0.5;
const CRACKLE_WANDER_SHARE = 0.5;
/** One arc down each cutting edge. */
const EDGES = 2;
const CRACKLE_GLOW_WIDTH = 0.04;
const CRACKLE_GLOW_ALPHA = 0.45;
const CRACKLE_ARC_WIDTH = 0.018;
const CRACKLE_CORE_WIDTH = 0.008;
/** A spark of loose lightning off the point. */
const TIP_SPARK_RADIUS = 0.05;
const TIP_SPARK_ALPHA = 0.55;

/**
 * How many distinct pictures of the crackle there are. The holder cycles
 * through them over time, so the edge visibly fizzes while each picture stays
 * a fixed, cacheable bitmap.
 */
export const SWORD_CRACKLE_PHASES = 3;

const GUARD_X = GUARD_AHEAD;
const TIP_X = GUARD_AHEAD + BLADE_LENGTH;
const TAPER_X = GUARD_X + BLADE_LENGTH * BLADE_TAPER_FROM;

function traceBlade(ctx: Ctx): void {
  ctx.moveTo(GUARD_X, -BLADE_HALF_AT_GUARD);
  ctx.lineTo(TAPER_X, -BLADE_HALF_AT_TAPER);
  ctx.lineTo(TIP_X, 0);
  ctx.lineTo(TAPER_X, BLADE_HALF_AT_TAPER);
  ctx.lineTo(GUARD_X, BLADE_HALF_AT_GUARD);
  ctx.closePath();
}

function traceGuard(ctx: Ctx): void {
  ctx.rect(GUARD_X - GUARD_HALF_THICK, -GUARD_HALF_SPAN, GUARD_HALF_THICK * 2, GUARD_HALF_SPAN * 2);
}

function traceGrip(ctx: Ctx): void {
  ctx.rect(-POMMEL_BEHIND, -GRIP_HALF, POMMEL_BEHIND + GUARD_X, GRIP_HALF * 2);
}

function tracePommel(ctx: Ctx): void {
  ctx.moveTo(-POMMEL_BEHIND + POMMEL_RADIUS, 0);
  ctx.arc(-POMMEL_BEHIND, 0, POMMEL_RADIUS, 0, Math.PI * 2);
}

function traceSilhouette(ctx: Ctx): void {
  ctx.beginPath();
  traceBlade(ctx);
  traceGuard(ctx);
  traceGrip(ctx);
  tracePommel(ctx);
}

/** A fixed pseudo-random value in [−1, 1] for one kink of one edge in one phase. */
function kinkOffset(phase: number, edge: number, kink: number): number {
  return printHash(phase * EDGES + edge, kink) * 2 - 1;
}

/** The blade's half-width at `x` along it, for laying the crackle on its edge. */
function bladeHalfAt(x: number): number {
  if (x <= TAPER_X) {
    const share = (x - GUARD_X) / (TAPER_X - GUARD_X);
    return BLADE_HALF_AT_GUARD + (BLADE_HALF_AT_TAPER - BLADE_HALF_AT_GUARD) * share;
  }
  return BLADE_HALF_AT_TAPER * (1 - (x - TAPER_X) / (TIP_X - TAPER_X));
}

function crackleArc(ctx: Ctx, phase: number, edge: number): void {
  const side = edge === 0 ? -1 : 1;
  const fromX = GUARD_X + BLADE_LENGTH * CRACKLE_FROM_SHARE;
  const toX = GUARD_X + BLADE_LENGTH * CRACKLE_TO_SHARE;
  ctx.beginPath();
  for (let kink = 0; kink <= CRACKLE_SEGMENTS; kink++) {
    const x = fromX + ((toX - fromX) * kink) / CRACKLE_SEGMENTS;
    const stray = kink === 0 ? 0 : kinkOffset(phase, edge, kink) * CRACKLE_STRAY;
    const y =
      side * (bladeHalfAt(x) + Math.abs(stray) * CRACKLE_OUTWARD_SHARE) +
      stray * CRACKLE_WANDER_SHARE;
    if (kink === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function paintCrackle(ctx: Ctx, phase: number, baseAlpha: number): void {
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  for (let edge = 0; edge < EDGES; edge++) {
    crackleArc(ctx, phase, edge);
    ctx.globalAlpha = baseAlpha * CRACKLE_GLOW_ALPHA;
    ctx.strokeStyle = TARANIS_LIGHTNING.glow;
    ctx.lineWidth = CRACKLE_GLOW_WIDTH;
    ctx.stroke();
    ctx.globalAlpha = baseAlpha;
    ctx.strokeStyle = TARANIS_LIGHTNING.arc;
    ctx.lineWidth = CRACKLE_ARC_WIDTH;
    ctx.stroke();
    ctx.strokeStyle = TARANIS_LIGHTNING.core;
    ctx.lineWidth = CRACKLE_CORE_WIDTH;
    ctx.stroke();
  }
  const spark = ctx.createRadialGradient(TIP_X, 0, 0, TIP_X, 0, TIP_SPARK_RADIUS);
  spark.addColorStop(0, TARANIS_LIGHTNING.core);
  spark.addColorStop(1, rgba(TARANIS_LIGHTNING.glow, 0));
  ctx.globalAlpha = baseAlpha * TIP_SPARK_ALPHA;
  ctx.fillStyle = spark;
  ctx.beginPath();
  ctx.arc(TIP_X, 0, TIP_SPARK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paints the sword about its grip at the origin, blade along +X, in figure
 * units. `shaded` puts it in the light of an arm behind his body. `phase`
 * (0 to {@link SWORD_CRACKLE_PHASES} − 1) picks the crackle's picture.
 */
export function drawTaranisSword(ctx: Ctx, shaded: boolean, phase: number): void {
  const shade = shaded ? FAR_LIMB_SHADE : 0;
  const bronze = receded(TARANIS_BRONZE, shade);
  const silver = recededGloss(TARANIS_SILVER, shade);
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.lineJoin = 'round';

  traceSilhouette(ctx);
  ctx.strokeStyle = TARANIS_OUTLINE;
  ctx.lineWidth = SWORD_OUTLINE_WIDTH * 2;
  ctx.stroke();

  // The blade is two flat bevels meeting at the ridge: the one turned up to
  // the key light is pale, the other a step down, which is what reads as a
  // ground edge rather than a flat strip at two pixels across.
  ctx.beginPath();
  traceBlade(ctx);
  ctx.fillStyle = silver.mid;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  traceBlade(ctx);
  ctx.clip();
  ctx.fillStyle = silver.light;
  ctx.fillRect(GUARD_X, -BLADE_HALF_AT_GUARD, BLADE_LENGTH, BLADE_HALF_AT_GUARD);
  ctx.restore();
  const ridgeFrom: Pt = { x: GUARD_X + BLADE_LENGTH * RIDGE_FROM_SHARE, y: 0 };
  const ridgeTo: Pt = { x: GUARD_X + BLADE_LENGTH * RIDGE_TO_SHARE, y: 0 };
  ctx.beginPath();
  ctx.moveTo(ridgeFrom.x, ridgeFrom.y);
  ctx.lineTo(ridgeTo.x, ridgeTo.y);
  ctx.strokeStyle = silver.specular;
  ctx.lineWidth = RIDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  traceGrip(ctx);
  ctx.fillStyle = TARANIS_GRIP_WRAP;
  ctx.fill();

  ctx.beginPath();
  traceGuard(ctx);
  ctx.fillStyle = bronze.base;
  ctx.fill();
  ctx.fillStyle = bronze.light;
  ctx.fillRect(GUARD_X - GUARD_HALF_THICK, -GUARD_HALF_SPAN, GUARD_HALF_THICK, GUARD_HALF_SPAN * 2);

  ctx.beginPath();
  tracePommel(ctx);
  ctx.fillStyle = bronze.base;
  ctx.fill();
  const glintOffset = POMMEL_RADIUS * POMMEL_GLINT_TOWARD_LIGHT;
  ctx.beginPath();
  ctx.arc(
    -POMMEL_BEHIND - glintOffset,
    -glintOffset,
    POMMEL_RADIUS * POMMEL_GLINT_SIZE,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = bronze.rim;
  ctx.fill();

  paintCrackle(ctx, phase, baseAlpha);
  ctx.restore();
}

/**
 * The sword's measurements about its grip, in figure units: what a held-visual
 * definition of it declares its handle and head from.
 */
export const TARANIS_SWORD_DIMENSIONS = {
  /** Grip centre back to the pommel's centre. */
  pommelBehind: POMMEL_BEHIND,
  /** Grip centre forward to the crossguard. */
  guardAhead: GUARD_AHEAD,
  /** Guard to point. */
  bladeLength: BLADE_LENGTH,
  /** The crossguard's full span, the widest part of the head. */
  guardSpan: GUARD_HALF_SPAN * 2,
  guardThickness: GUARD_HALF_THICK * 2,
} as const;

function swordMaterials(shaded: boolean): {
  readonly bronze: ReturnType<typeof receded>;
  readonly silver: ReturnType<typeof recededGloss>;
} {
  const shade = shaded ? FAR_LIMB_SHADE : 0;
  return { bronze: receded(TARANIS_BRONZE, shade), silver: recededGloss(TARANIS_SILVER, shade) };
}

/**
 * The hilt alone — the wrapped grip and the pommel, outlined — in the frame
 * {@link drawTaranisSword} uses, for a painter that draws the blade over it
 * separately.
 */
export function drawTaranisHilt(ctx: Ctx, shaded: boolean): void {
  const { bronze } = swordMaterials(shaded);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  traceGrip(ctx);
  tracePommel(ctx);
  ctx.strokeStyle = TARANIS_OUTLINE;
  ctx.lineWidth = SWORD_OUTLINE_WIDTH * 2;
  ctx.stroke();

  ctx.beginPath();
  traceGrip(ctx);
  ctx.fillStyle = TARANIS_GRIP_WRAP;
  ctx.fill();

  ctx.beginPath();
  tracePommel(ctx);
  ctx.fillStyle = bronze.base;
  ctx.fill();
  const glintOffset = POMMEL_RADIUS * POMMEL_GLINT_TOWARD_LIGHT;
  ctx.beginPath();
  ctx.arc(
    -POMMEL_BEHIND - glintOffset,
    -glintOffset,
    POMMEL_RADIUS * POMMEL_GLINT_SIZE,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = bronze.rim;
  ctx.fill();
  ctx.restore();
}

/**
 * The crossguard, the blade and its crackle, outlined, in the frame
 * {@link drawTaranisSword} uses — everything {@link drawTaranisHilt} leaves out.
 */
export function drawTaranisBlade(ctx: Ctx, shaded: boolean, phase: number): void {
  const { bronze, silver } = swordMaterials(shaded);
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.lineJoin = 'round';

  ctx.beginPath();
  traceBlade(ctx);
  traceGuard(ctx);
  ctx.strokeStyle = TARANIS_OUTLINE;
  ctx.lineWidth = SWORD_OUTLINE_WIDTH * 2;
  ctx.stroke();

  ctx.beginPath();
  traceBlade(ctx);
  ctx.fillStyle = silver.mid;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  traceBlade(ctx);
  ctx.clip();
  ctx.fillStyle = silver.light;
  ctx.fillRect(GUARD_X, -BLADE_HALF_AT_GUARD, BLADE_LENGTH, BLADE_HALF_AT_GUARD);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(GUARD_X + BLADE_LENGTH * RIDGE_FROM_SHARE, 0);
  ctx.lineTo(GUARD_X + BLADE_LENGTH * RIDGE_TO_SHARE, 0);
  ctx.strokeStyle = silver.specular;
  ctx.lineWidth = RIDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  traceGuard(ctx);
  ctx.fillStyle = bronze.base;
  ctx.fill();
  ctx.fillStyle = bronze.light;
  ctx.fillRect(GUARD_X - GUARD_HALF_THICK, -GUARD_HALF_SPAN, GUARD_HALF_THICK, GUARD_HALF_SPAN * 2);

  paintCrackle(ctx, phase, baseAlpha);
  ctx.restore();
}
