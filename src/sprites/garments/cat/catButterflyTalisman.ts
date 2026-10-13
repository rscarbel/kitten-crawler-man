/**
 * The Talisman of the Slate Butterfly on Donut: a small slate-blue butterfly
 * charm with silver edges, hung from a fine silver chain round her neck. It
 * hangs at her throat over the cream of her bib head-on and in profile; from
 * behind only the chain shows, across her nape. It swings a little with her
 * sway, the way a charm on a collar jingles.
 *
 * Painted on her neck, after her body and before her head, so her chin and
 * cheek ruffs fall over the chain as they would over a collar.
 */

import type { CatNeckFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, type GarmentFrameContext, withViewFallback } from '../garmentDef';
import { paintGlint, SILVER } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

const SLATE = '#6a86ab';
const SLATE_LIGHT = '#d4e6fa';
const SLATE_DEEP = '#2c3a4d';
const BODY_INK = '#1c1a22';

const CHAIN_WIDTH = 0.022;
/** The ring the charm hangs from, and how far below the chain the butterfly's body hangs. */
const RING_RADIUS = 0.014;
const HANG = 0.06;
/** The butterfly: a forewing and a smaller hindwing each side of a thin body. */
const FOREWING_RX = 0.056;
const FOREWING_RY = 0.04;
const FOREWING_OUT = 0.058;
const FOREWING_UP = 0.016;
const FOREWING_TILT = 0.9;
const HINDWING_RX = 0.038;
const HINDWING_RY = 0.03;
const HINDWING_OUT = 0.032;
const HINDWING_DOWN = 0.027;
const HINDWING_TILT = -0.7;
const WING_EDGE = 0.008;
const BODY_HALF_LENGTH = 0.055;
/** Two feelers up from the body, splayed: the mark that says butterfly rather than bow. */
const ANTENNA_LENGTH = 0.035;
const ANTENNA_SPREAD = 0.03;
const BODY_WIDTH = 0.018;
const GLINT_REACH = 0.03;
/** The glint sits high on the forewing nearest the light. */
const GLINT_UP = 0.3;
const WING_MID_STOP = 0.5;
const RING_WIDTH = 0.015;
/** In profile the wings are seen partly edge-on. */
const PROFILE_WING_SQUASH = 0.5;
/** How far her sway swings the charm, as a turn of the charm per unit of sway. */
const SWING_PER_SWAY = 6;
const MAX_SWING = 0.3;
/**
 * Lying on her side the charm rests on the floor beside her neck rather than
 * hanging: its drop shrinks with her roll, to this share at the most.
 */
const LYING_HANG_SHARE = 0.3;

/** The point on the band at `angle`, in pose space. */
function bandPoint(frame: CatNeckFrame, angle: number): { x: number; y: number } {
  const { band, tilt } = frame;
  const lx = Math.cos(angle) * band.rx;
  const ly = Math.sin(angle) * band.ry;
  return {
    x: band.cx + lx * Math.cos(tilt) - ly * Math.sin(tilt),
    y: band.cy + lx * Math.sin(tilt) + ly * Math.cos(tilt),
  };
}

function strokeChain(ctx: Ctx, frame: CatNeckFrame, from: number, to: number): void {
  const { band, tilt } = frame;
  ctx.beginPath();
  ctx.ellipse(band.cx, band.cy, band.rx, band.ry, tilt, from, to);
  ctx.strokeStyle = SILVER.base;
  ctx.lineWidth = CHAIN_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintWing(ctx: Ctx, x: number, y: number, rx: number, ry: number, tilt: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, tilt, 0, FULL_TURN);
  const gradient = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  gradient.addColorStop(0, SLATE_LIGHT);
  gradient.addColorStop(WING_MID_STOP, SLATE);
  gradient.addColorStop(1, SLATE_DEEP);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = SLATE_DEEP;
  ctx.lineWidth = WING_EDGE;
  ctx.stroke();
}

/** The butterfly hanging from `at`, wings spread to `squash` of their width. */
function paintButterfly(
  ctx: Ctx,
  at: { x: number; y: number },
  swing: number,
  squash: number,
  roll: number,
): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(swing);
  ctx.beginPath();
  ctx.arc(0, 0, RING_RADIUS, 0, FULL_TURN);
  ctx.strokeStyle = SILVER.light;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
  ctx.translate(0, HANG * Math.max(LYING_HANG_SHARE, Math.cos(roll)));
  ctx.scale(squash, 1);
  for (const side of [-1, 1]) {
    paintWing(
      ctx,
      side * HINDWING_OUT,
      HINDWING_DOWN,
      HINDWING_RX,
      HINDWING_RY,
      side * HINDWING_TILT,
    );
    paintWing(
      ctx,
      side * FOREWING_OUT,
      -FOREWING_UP,
      FOREWING_RX,
      FOREWING_RY,
      side * FOREWING_TILT,
    );
  }
  ctx.beginPath();
  ctx.moveTo(0, -BODY_HALF_LENGTH);
  ctx.lineTo(0, BODY_HALF_LENGTH);
  for (const side of [-1, 1]) {
    ctx.moveTo(0, -BODY_HALF_LENGTH);
    ctx.lineTo(side * ANTENNA_SPREAD, -BODY_HALF_LENGTH - ANTENNA_LENGTH);
  }
  ctx.strokeStyle = BODY_INK;
  ctx.lineWidth = BODY_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  paintGlint(ctx, SILVER, -FOREWING_OUT, -FOREWING_UP - FOREWING_RY * GLINT_UP, GLINT_REACH);
  ctx.restore();
}

function swingOf(context: GarmentFrameContext<'cat'>): number {
  return Math.max(-MAX_SWING, Math.min(MAX_SWING, -context.pose.sway * SWING_PER_SWAY));
}

function paintFront(ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void {
  ctx.save();
  strokeChain(ctx, frame, 0, HALF_TURN);
  paintButterfly(ctx, bandPoint(frame, QUARTER_TURN), swingOf(context), 1, context.pose.roll);
  ctx.restore();
}

function paintBack(ctx: Ctx, frame: CatNeckFrame): void {
  strokeChain(ctx, frame, 0, HALF_TURN);
}

function paintSide(ctx: Ctx, frame: CatNeckFrame, context: GarmentFrameContext<'cat'>): void {
  ctx.save();
  strokeChain(ctx, frame, -QUARTER_TURN, QUARTER_TURN);
  paintButterfly(
    ctx,
    bandPoint(frame, QUARTER_TURN),
    swingOf(context),
    PROFILE_WING_SQUASH,
    context.pose.roll,
  );
  ctx.restore();
}

export const CAT_BUTTERFLY_TALISMAN = defineGarment({
  id: 'cat_butterfly_talisman',
  name: 'Talisman of the Slate Butterfly',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'over',
  region: ['neck'],
  paint: {
    neck: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
