/**
 * The Stormcaller as a held visual: a heavy, broad silver blade on a
 * hand-and-a-half bronze hilt. A bolt of lightning is set into its fuller and
 * a live crackle runs down both edges, one picture per crackle phase, so the
 * storm the swing throws visibly lives in the steel. Its colours are the
 * wave's own (`stormcallerPalette.ts`).
 */

import { rgba } from '../../art/bipedArt';
import { printHash } from '../../art/biped/paint';
import { FAR_LIMB_SHADE, receded, recededGloss } from '../../art/biped/palette';
import {
  STORMCALLER_BRONZE,
  STORMCALLER_GRIP_WRAP,
  STORMCALLER_LIGHTNING,
  STORMCALLER_SILVER,
} from '../../art/stormcallerPalette';
import { defineHeldVisual, type HeldHandleGeometry, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill } from '../heldPaint';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

/** Long enough for a second hand on the pommel: the grip of a heavy blade, not a duelling one. */
const HANDLE_LENGTH = 0.25;
const GRIP_POINT = 0.42;
const GRIP_HALF = 0.022;
/** The bronze wire wound round the grip, as shares of its run. */
const WIRE_TURNS: readonly number[] = [0.2, 0.4, 0.6, 0.8];
const WIRE_SLANT = 0.016;
const WIRE_WIDTH = 0.009;
const POMMEL_RADIUS = 0.04;
/** A storm-blue stone set in the pommel's face. */
const POMMEL_STONE_RADIUS = 0.018;

/** The guard's wings sweep forward toward the point at their tips. */
const GUARD_HALF_SPAN = 0.135;
const GUARD_HALF_THICK = 0.022;
const GUARD_WING_SWEEP = 0.045;
/** The guard's back edge is this share of its span: a block at the blade's root, wings beyond. */
const GUARD_ROOT_SHARE = 0.4;

const BLADE_LENGTH = 0.74;
/** A broad blade that swells a little before its point: weight carried out toward the tip. */
const BLADE_HALF_AT_GUARD = 0.056;
const BLADE_HALF_AT_SWELL = 0.064;
const SWELL_AT = 0.55;
const TAPER_FROM = 0.8;

/** The bolt set into the fuller: a zig-zag down the blade's middle, kink by kink. */
const BOLT_FROM = 0.06;
const BOLT_TO = 0.74;
const BOLT_KINKS: readonly number[] = [0, 0.6, -0.5, 0.7, -0.6, 0.5, 0];
const BOLT_SWAY = 0.03;
const BOLT_GLOW_WIDTH = 0.026;
const BOLT_ARC_WIDTH = 0.016;
const BOLT_CORE_WIDTH = 0.007;
const BOLT_GLOW_ALPHA = 0.4;
/** The fuller's dark channel the bolt sits in. */
const FULLER_WIDTH = 0.04;

/** How many distinct pictures of the edge crackle there are, cycled over time. */
export const STORMCALLER_CRACKLE_PHASES = 3;
const CRACKLE_FROM = 0.14;
const CRACKLE_SEGMENTS = 9;
const CRACKLE_STRAY = 0.028;
/** A kink strays half off the edge and half along it, and always outward, so the arc stays on the edge. */
const CRACKLE_OUTWARD_SHARE = 0.5;
const CRACKLE_WANDER_SHARE = 0.5;
const EDGES = 2;
const CRACKLE_GLOW_WIDTH = 0.04;
const CRACKLE_GLOW_ALPHA = 0.45;
const CRACKLE_ARC_WIDTH = 0.016;
const CRACKLE_CORE_WIDTH = 0.007;
const TIP_SPARK_RADIUS = 0.055;
const TIP_SPARK_ALPHA = 0.55;

function materials(look: HeldLook): {
  bronze: ReturnType<typeof receded>;
  silver: ReturnType<typeof recededGloss>;
} {
  const shade = look.shaded ? FAR_LIMB_SHADE : 0;
  return {
    bronze: receded(STORMCALLER_BRONZE, shade),
    silver: recededGloss(STORMCALLER_SILVER, shade),
  };
}

function bladeHalfAt(share: number): number {
  if (share <= SWELL_AT) {
    return BLADE_HALF_AT_GUARD + (BLADE_HALF_AT_SWELL - BLADE_HALF_AT_GUARD) * (share / SWELL_AT);
  }
  if (share <= TAPER_FROM) return BLADE_HALF_AT_SWELL;
  return BLADE_HALF_AT_SWELL * (1 - (share - TAPER_FROM) / (1 - TAPER_FROM));
}

function traceBlade(ctx: Ctx, base: number): void {
  const shares = [0, SWELL_AT, TAPER_FROM];
  ctx.beginPath();
  ctx.moveTo(base, -BLADE_HALF_AT_GUARD);
  for (const share of shares) ctx.lineTo(base + BLADE_LENGTH * share, -bladeHalfAt(share));
  ctx.lineTo(base + BLADE_LENGTH, 0);
  for (const share of [...shares].reverse()) {
    ctx.lineTo(base + BLADE_LENGTH * share, bladeHalfAt(share));
  }
  ctx.closePath();
}

function traceGuard(ctx: Ctx, base: number): void {
  ctx.beginPath();
  ctx.moveTo(base - GUARD_HALF_THICK, -GUARD_HALF_SPAN * GUARD_ROOT_SHARE);
  ctx.lineTo(base + GUARD_WING_SWEEP, -GUARD_HALF_SPAN);
  ctx.lineTo(base + GUARD_WING_SWEEP + GUARD_HALF_THICK, -GUARD_HALF_SPAN + GUARD_HALF_THICK);
  ctx.lineTo(base + GUARD_HALF_THICK, -BLADE_HALF_AT_GUARD);
  ctx.lineTo(base + GUARD_HALF_THICK, BLADE_HALF_AT_GUARD);
  ctx.lineTo(base + GUARD_WING_SWEEP + GUARD_HALF_THICK, GUARD_HALF_SPAN - GUARD_HALF_THICK);
  ctx.lineTo(base + GUARD_WING_SWEEP, GUARD_HALF_SPAN);
  ctx.lineTo(base - GUARD_HALF_THICK, GUARD_HALF_SPAN * GUARD_ROOT_SHARE);
  ctx.closePath();
}

function boltPath(ctx: Ctx, base: number): void {
  const from = base + BLADE_LENGTH * BOLT_FROM;
  const run = BLADE_LENGTH * (BOLT_TO - BOLT_FROM);
  ctx.beginPath();
  BOLT_KINKS.forEach((sway, index) => {
    const x = from + (run * index) / (BOLT_KINKS.length - 1);
    if (index === 0) ctx.moveTo(x, 0);
    else ctx.lineTo(x, sway * BOLT_SWAY);
  });
}

function strokeLightning(
  ctx: Ctx,
  glowAlpha: number,
  widths: { glow: number; arc: number; core: number },
): void {
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(STORMCALLER_LIGHTNING.glow, glowAlpha);
  ctx.lineWidth = widths.glow;
  ctx.stroke();
  ctx.strokeStyle = STORMCALLER_LIGHTNING.arc;
  ctx.lineWidth = widths.arc;
  ctx.stroke();
  ctx.strokeStyle = STORMCALLER_LIGHTNING.core;
  ctx.lineWidth = widths.core;
  ctx.stroke();
}

function kinkOffset(phase: number, edge: number, kink: number): number {
  return printHash(phase * EDGES + edge, kink) * 2 - 1;
}

function paintCrackle(ctx: Ctx, base: number, phase: number): void {
  for (let edge = 0; edge < EDGES; edge++) {
    const side = edge === 0 ? -1 : 1;
    ctx.beginPath();
    for (let kink = 0; kink <= CRACKLE_SEGMENTS; kink++) {
      const share = CRACKLE_FROM + ((1 - CRACKLE_FROM) * kink) / CRACKLE_SEGMENTS;
      const stray = kink === 0 ? 0 : kinkOffset(phase, edge, kink) * CRACKLE_STRAY;
      const x = base + BLADE_LENGTH * share;
      const y =
        side * (bladeHalfAt(share) + Math.abs(stray) * CRACKLE_OUTWARD_SHARE) +
        stray * CRACKLE_WANDER_SHARE;
      if (kink === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    strokeLightning(ctx, CRACKLE_GLOW_ALPHA, {
      glow: CRACKLE_GLOW_WIDTH,
      arc: CRACKLE_ARC_WIDTH,
      core: CRACKLE_CORE_WIDTH,
    });
  }
  const tipX = base + BLADE_LENGTH;
  const spark = ctx.createRadialGradient(tipX, 0, 0, tipX, 0, TIP_SPARK_RADIUS);
  spark.addColorStop(0, rgba(STORMCALLER_LIGHTNING.core, TIP_SPARK_ALPHA));
  spark.addColorStop(1, rgba(STORMCALLER_LIGHTNING.glow, 0));
  ctx.fillStyle = spark;
  ctx.beginPath();
  ctx.arc(tipX, 0, TIP_SPARK_RADIUS, 0, FULL_TURN);
  ctx.fill();
}

function paintStormBlade(ctx: Ctx, look: HeldLook, base: number): void {
  const { bronze, silver } = materials(look);
  traceBlade(ctx, base);
  outlineAndFill(ctx, silver.mid);
  ctx.save();
  traceBlade(ctx, base);
  ctx.clip();
  const litSide = look.light.y < 0 ? -1 : 1;
  ctx.fillStyle = silver.light;
  ctx.fillRect(base, litSide < 0 ? -BLADE_HALF_AT_SWELL : 0, BLADE_LENGTH, BLADE_HALF_AT_SWELL);
  boltPath(ctx, base);
  ctx.strokeStyle = silver.shadow;
  ctx.lineWidth = FULLER_WIDTH;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
  boltPath(ctx, base);
  strokeLightning(ctx, BOLT_GLOW_ALPHA, {
    glow: BOLT_GLOW_WIDTH,
    arc: BOLT_ARC_WIDTH,
    core: BOLT_CORE_WIDTH,
  });

  traceGuard(ctx, base);
  outlineAndFill(ctx, bronze.base);
  ctx.save();
  traceGuard(ctx, base);
  ctx.clip();
  ctx.fillStyle = bronze.light;
  ctx.fillRect(
    base - GUARD_HALF_THICK,
    litSide < 0 ? -GUARD_HALF_SPAN : 0,
    GUARD_WING_SWEEP * 2,
    GUARD_HALF_SPAN,
  );
  ctx.restore();

  paintCrackle(ctx, base, look.phase);
}

function paintStormHilt(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  const { bronze } = materials(look);
  const { buttX, headBase } = handle;
  ctx.beginPath();
  ctx.rect(buttX, -GRIP_HALF, headBase - buttX, GRIP_HALF * 2);
  outlineAndFill(ctx, heldShade(STORMCALLER_GRIP_WRAP, look));
  ctx.strokeStyle = bronze.mid;
  ctx.lineWidth = WIRE_WIDTH;
  ctx.beginPath();
  for (const share of WIRE_TURNS) {
    const x = buttX + (headBase - buttX) * share;
    ctx.moveTo(x - WIRE_SLANT, -GRIP_HALF);
    ctx.lineTo(x + WIRE_SLANT, GRIP_HALF);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(buttX, 0, POMMEL_RADIUS, 0, FULL_TURN);
  outlineAndFill(ctx, bronze.base);
  ctx.beginPath();
  ctx.arc(buttX, 0, POMMEL_STONE_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = STORMCALLER_LIGHTNING.glow;
  ctx.fill();
}

export const STORMCALLER_HELD = defineHeldVisual({
  id: 'stormcaller',
  name: 'The Stormcaller',
  archetype: 'oneHandHaft',
  weight: 'heavy',
  handle: { length: HANDLE_LENGTH, radius: 'thin' },
  head: {
    length: GUARD_HALF_THICK + BLADE_LENGTH,
    width: GUARD_HALF_SPAN * 2,
  },
  gripPoint: GRIP_POINT,
  phases: STORMCALLER_CRACKLE_PHASES,
  paintHandle: paintStormHilt,
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      paintStormBlade(ctx, look, handle.headBase);
      return;
    }
    seenOnEdge(ctx, () => paintStormBlade(ctx, look, handle.headBase));
    paintBladeEdgeGlint(
      ctx,
      handle.headBase,
      handle.headBase + BLADE_LENGTH,
      STORMCALLER_SILVER.specular,
    );
  },
});
