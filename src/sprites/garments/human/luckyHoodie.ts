/**
 * The Lucky Hoodie on the human crawler: a faded red pullover hoodie worn over
 * his shirt. At the tile it is a red torso and red sleeves pushed up his
 * forearms; what says "hoodie" rather than "red shirt" is the hood bunched
 * round the back of his neck, the pale drawstrings dropping from its throat,
 * the kangaroo pocket across his belly and the ribbed band at the hem.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { crease } from '../../art/biped/paint';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import { pt } from '../../art/biped/geometry';
import { rgba, type Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import {
  fillPolygon,
  matteRamp,
  paintCoverBody,
  withDeepShade,
  strokeLine,
  withinTorso,
} from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Washed so many times the red has gone a little brick. */
const FADED_RED = withDeepShade(matteRamp('#a4473f'));
const DRAWSTRING = '#f4ede0';
const DRAWSTRING_TIP = '#8d8578';

/** Fleece pushed up the forearm bunches into a thicker roll than a shirt's or a jacket's. */
const FLEECE_CUFF_BULK = 3;

/** Fleece folds softer than leather, deeper than a shirt. */
const FLEECE_FOLD_WEIGHT = 0.5;
const FLEECE_SEAM_WEIGHT = 0.4;

/** The ribbed band at the hem, standing this far up from it. */
const HEM_BAND_RISE = 0.055;
const HEM_BAND_ALPHA = 0.75;
const HEM_BAND_LIP_WIDTH = 0.014;
const HEM_BAND_LIP_ALPHA = 0.55;
/** How far past the torso a band runs, so the clip, not its end, finishes it at his sides. */
const OVERREACH = 0.5;

/** The kangaroo pocket head-on: a trapezoid over the belly, its slanted sides the hand openings. */
const POCKET_TOP_Y = 0.27;
const POCKET_BOTTOM_RISE = 0.06;
const POCKET_TOP_HALF = 0.075;
const POCKET_BOTTOM_HALF = 0.125;
const POCKET_FILL_ALPHA = 0.5;
const POCKET_EDGE_WIDTH = 0.014;
const POCKET_EDGE_ALPHA = 0.8;
const POCKET_OPENING_WIDTH = 0.016;
const POCKET_OPENING_ALPHA = 0.85;
/** Edge-on the pocket's front bulges a touch over the belly, a seam where it meets the body. */
const PROFILE_POCKET_BACK_X = 0.05;

/** The drawstrings drop from either side of the throat, a little apart. */
const DRAWSTRING_X = 0.028;
const DRAWSTRING_TOP_Y = 0.01;
const DRAWSTRING_BOTTOM_Y = 0.16;
const DRAWSTRING_SWAY = 0.008;
const DRAWSTRING_WIDTH = 0.018;
const DRAWSTRING_TIP_LENGTH = 0.022;
/** Edge-on one string shows, hanging just off the front of his chest. */
const PROFILE_DRAWSTRING_X = 0.07;

/** The hood bunched round the neck head-on: how far it stands out past the neck, and how high behind it. */
const HOOD_OUTER_HALF = 0.19;
const HOOD_TOP_Y = -0.12;
const HOOD_SHOULDER_Y = 0.015;
const HOOD_THROAT_Y = 0.045;
const HOOD_INNER_HALF = 0.075;
const HOOD_INNER_Y = 0.0;
/** Head-on the neck stands in front of the hood behind it: the hood is left off the neck's column. */
const NECK_COLUMN_SHARE = 0.95;
const NECK_COLUMN_BOTTOM_Y = 0.0;
const HOOD_FOLD_WIDTH = 0.022;
const HOOD_FOLD_ALPHA = 0.9;

/** From behind the hood lies flat down his upper back, a rounded point between the shoulder blades. */
const BACK_HOOD_TOP_Y = -0.07;
const BACK_HOOD_TOP_HALF = 0.14;
const BACK_HOOD_WAIST_Y = 0.1;
const BACK_HOOD_WAIST_HALF = 0.12;
const BACK_HOOD_TIP_Y = 0.22;
const BACK_HOOD_EDGE_WIDTH = 0.024;
const BACK_HOOD_EDGE_ALPHA = 0.95;
/** The hood lies on his back, so it casts a soft shadow just below its edge. */
const BACK_HOOD_SHADOW_DROP = 0.022;
const BACK_HOOD_SHADOW_ALPHA = 0.5;
/** The hood's mouth, the dark inside of it, a crescent along its top. */
const BACK_HOOD_MOUTH_DEPTH = 0.045;
const BACK_HOOD_MOUTH_HALF = 0.11;

/**
 * Edge-on the hood is a lump bunched behind his nape. Its back stands a fixed
 * distance off his back, whatever his depth: scaled with a lean man's
 * shallow torso it shrinks inside his own outline and vanishes.
 */
const PROFILE_HOOD = {
  top: pt(-0.06, -0.12),
  back: pt(-0.24, -0.03),
  low: pt(-0.25, 0.1),
  front: pt(-0.02, 0.03),
} as const;
const PROFILE_HOOD_STANDOFF = 0.04;
const PROFILE_HOOD_SHADE_ALPHA = 0.55;
const PROFILE_HOOD_MOUTH_ALPHA = 0.7;
/** A quadratic reaches only halfway to its control point. */
const QUAD_CONTROL_REACH = 2;

function paintHemBand(ctx: Ctx, torso: TorsoFrame): void {
  const top = (x: number): Pt => torso.hem(x, -HEM_BAND_RISE);
  fillPolygon(
    ctx,
    [
      top(-OVERREACH),
      top(OVERREACH),
      torso.hem(OVERREACH, OVERREACH),
      torso.hem(-OVERREACH, OVERREACH),
    ],
    rgba(FADED_RED.dark, HEM_BAND_ALPHA),
  );
  strokeLine(
    ctx,
    [top(-OVERREACH), top(OVERREACH)],
    rgba(FADED_RED.light, HEM_BAND_LIP_ALPHA),
    HEM_BAND_LIP_WIDTH,
  );
}

function paintPocket(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const bottomY = torso.hemY - POCKET_BOTTOM_RISE;
  const corners = [
    at(-POCKET_TOP_HALF, POCKET_TOP_Y),
    at(POCKET_TOP_HALF, POCKET_TOP_Y),
    at(POCKET_BOTTOM_HALF, bottomY),
    at(-POCKET_BOTTOM_HALF, bottomY),
  ];
  fillPolygon(ctx, corners, rgba(FADED_RED.mid, POCKET_FILL_ALPHA));
  strokeLine(
    ctx,
    [corners[0], corners[1]],
    rgba(FADED_RED.light, POCKET_EDGE_ALPHA),
    POCKET_EDGE_WIDTH,
  );
  const opening = rgba(FADED_RED.deep, POCKET_OPENING_ALPHA);
  strokeLine(ctx, [corners[1], corners[2]], opening, POCKET_OPENING_WIDTH);
  strokeLine(ctx, [corners[0], corners[3]], opening, POCKET_OPENING_WIDTH);
}

function paintProfilePocket(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const top = torso.at(PROFILE_POCKET_BACK_X * depth, POCKET_TOP_Y);
  const bottom = torso.at(PROFILE_POCKET_BACK_X * depth, torso.hemY - POCKET_BOTTOM_RISE);
  strokeLine(ctx, [top, bottom], rgba(FADED_RED.deep, POCKET_OPENING_ALPHA), POCKET_OPENING_WIDTH);
}

function strokeDrawstring(ctx: Ctx, from: Pt, to: Pt): void {
  strokeLine(ctx, [from, to], DRAWSTRING, DRAWSTRING_WIDTH);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const tip = pt(
    to.x + (dx / length) * DRAWSTRING_TIP_LENGTH,
    to.y + (dy / length) * DRAWSTRING_TIP_LENGTH,
  );
  strokeLine(ctx, [to, tip], DRAWSTRING_TIP, DRAWSTRING_WIDTH);
}

function paintDrawstrings(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  if (view.profile) {
    const x = PROFILE_DRAWSTRING_X * torso.cut.profileDepth;
    strokeDrawstring(ctx, at(x, DRAWSTRING_TOP_Y), at(x + DRAWSTRING_SWAY, DRAWSTRING_BOTTOM_Y));
    return;
  }
  for (const side of [-1, 1]) {
    strokeDrawstring(
      ctx,
      at(side * DRAWSTRING_X, DRAWSTRING_TOP_Y),
      at(side * (DRAWSTRING_X + DRAWSTRING_SWAY), DRAWSTRING_BOTTOM_Y),
    );
  }
}

function paintBackHood(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const outline = (): void => {
    ctx.beginPath();
    const start = at(-BACK_HOOD_TOP_HALF, BACK_HOOD_TOP_Y);
    ctx.moveTo(start.x, start.y);
    const top = at(BACK_HOOD_TOP_HALF, BACK_HOOD_TOP_Y);
    ctx.lineTo(top.x, top.y);
    const rightWaist = at(BACK_HOOD_WAIST_HALF, BACK_HOOD_WAIST_Y);
    const tip = at(0, BACK_HOOD_TIP_Y);
    const tipControlRight = at(BACK_HOOD_WAIST_HALF, BACK_HOOD_TIP_Y);
    const tipControlLeft = at(-BACK_HOOD_WAIST_HALF, BACK_HOOD_TIP_Y);
    const leftWaist = at(-BACK_HOOD_WAIST_HALF, BACK_HOOD_WAIST_Y);
    ctx.lineTo(rightWaist.x, rightWaist.y);
    ctx.quadraticCurveTo(tipControlRight.x, tipControlRight.y, tip.x, tip.y);
    ctx.quadraticCurveTo(tipControlLeft.x, tipControlLeft.y, leftWaist.x, leftWaist.y);
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(0, BACK_HOOD_SHADOW_DROP);
  outline();
  ctx.fillStyle = rgba(FADED_RED.deep, BACK_HOOD_SHADOW_ALPHA);
  ctx.fill();
  ctx.restore();
  outline();
  const lit = at(0, BACK_HOOD_TOP_Y);
  const shaded = at(0, BACK_HOOD_TIP_Y);
  const fall = ctx.createLinearGradient(lit.x, lit.y, shaded.x, shaded.y);
  fall.addColorStop(0, FADED_RED.light);
  fall.addColorStop(1, FADED_RED.mid);
  ctx.fillStyle = fall;
  ctx.fill();
  withClip(ctx, outline, () => {
    crease(ctx, outline, BACK_HOOD_EDGE_WIDTH, FADED_RED, BACK_HOOD_EDGE_ALPHA);
    const left = at(-BACK_HOOD_MOUTH_HALF, BACK_HOOD_TOP_Y);
    const right = at(BACK_HOOD_MOUTH_HALF, BACK_HOOD_TOP_Y);
    const low = at(0, BACK_HOOD_TOP_Y + BACK_HOOD_MOUTH_DEPTH * QUAD_CONTROL_REACH);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(low.x, low.y, right.x, right.y);
    ctx.closePath();
    ctx.fillStyle = FADED_RED.deep;
    ctx.fill();
  });
}

function paintProfileHood(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const p = (q: Pt, standoff: number): Pt => torso.at(q.x * depth - standoff, q.y);
  const h = PROFILE_HOOD;
  const top = p(h.top, 0);
  const back = p(h.back, PROFILE_HOOD_STANDOFF);
  const low = p(h.low, PROFILE_HOOD_STANDOFF);
  const front = p(h.front, 0);
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(front.x, front.y);
    ctx.quadraticCurveTo(top.x, top.y, back.x, back.y);
    ctx.quadraticCurveTo(low.x, low.y, front.x, front.y);
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = FADED_RED.light;
  ctx.fill();
  withClip(ctx, outline, () => {
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.quadraticCurveTo(low.x, low.y, front.x, front.y);
    ctx.strokeStyle = rgba(FADED_RED.shadow, PROFILE_HOOD_SHADE_ALPHA);
    ctx.lineWidth = HOOD_FOLD_WIDTH * QUAD_CONTROL_REACH;
    ctx.stroke();
    strokeLine(ctx, [front, top], rgba(FADED_RED.deep, PROFILE_HOOD_MOUTH_ALPHA), HOOD_FOLD_WIDTH);
  });
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const cut = { foldWeight: FLEECE_FOLD_WEIGHT, seamWeight: FLEECE_SEAM_WEIGHT };
  paintCoverBody(ctx, frame, context, FADED_RED, cut);
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    paintHemBand(ctx, torso);
    if (view.profile) {
      paintProfilePocket(ctx, torso);
      return;
    }
    if (view.showsBack) {
      paintBackHood(ctx, torso);
      return;
    }
    paintPocket(ctx, torso);
  });
  if (view.profile) paintProfileHood(ctx, torso);
}

/** Head-on the hood is a thick roll round the neck, standing out past it and meeting in a V at the throat. */
function paintFacingHood(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  const outer = HOOD_OUTER_HALF * view.girth;
  const inner = HOOD_INNER_HALF * view.girth;
  const outline = (): void => {
    ctx.beginPath();
    const leftShoulder = at(-outer, HOOD_SHOULDER_Y);
    ctx.moveTo(leftShoulder.x, leftShoulder.y);
    const leftTop = at(-outer, HOOD_TOP_Y);
    const rightTop = at(outer, HOOD_TOP_Y);
    const rightShoulder = at(outer, HOOD_SHOULDER_Y);
    ctx.bezierCurveTo(
      leftTop.x,
      leftTop.y,
      rightTop.x,
      rightTop.y,
      rightShoulder.x,
      rightShoulder.y,
    );
    const throat = at(0, HOOD_THROAT_Y);
    const rightInner = at(inner, HOOD_INNER_Y);
    const leftInner = at(-inner, HOOD_INNER_Y);
    ctx.quadraticCurveTo(rightInner.x, rightInner.y + HOOD_THROAT_Y, throat.x, throat.y);
    ctx.quadraticCurveTo(leftInner.x, leftInner.y + HOOD_THROAT_Y, leftShoulder.x, leftShoulder.y);
    ctx.closePath();
  };
  const neckHalf = NECK_WIDTH * view.girth * NECK_COLUMN_SHARE;
  const neckColumn = [
    at(-neckHalf, HOOD_TOP_Y * QUAD_CONTROL_REACH),
    at(neckHalf, HOOD_TOP_Y * QUAD_CONTROL_REACH),
    at(neckHalf, NECK_COLUMN_BOTTOM_Y),
    at(-neckHalf, NECK_COLUMN_BOTTOM_Y),
  ];
  const offNeck = (): void => {
    outline();
    const [a, b, c, d] = neckColumn;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(d.x, d.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
  };
  ctx.save();
  offNeck();
  ctx.clip('evenodd');
  outline();
  ctx.fillStyle = FADED_RED.light;
  ctx.fill();
  crease(ctx, outline, HOOD_FOLD_WIDTH, FADED_RED, HOOD_FOLD_ALPHA);
  ctx.restore();
}

/** From behind, the hood's rim stands round the base of his neck over the hood lying on his back. */
function paintBackHoodRim(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const { at } = torso;
  const half = BACK_HOOD_TOP_HALF * view.girth;
  const left = at(-half, BACK_HOOD_TOP_Y);
  const right = at(half, BACK_HOOD_TOP_Y);
  const mid = at(0, BACK_HOOD_TOP_Y + BACK_HOOD_MOUTH_DEPTH);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.quadraticCurveTo(mid.x, mid.y, right.x, right.y);
  ctx.strokeStyle = FADED_RED.light;
  ctx.lineWidth = HOOD_FOLD_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintCollar(ctx: Ctx, frame: BipedTorsoFrame): void {
  const { torso, view } = frame;
  if (view.profile) {
    paintDrawstrings(ctx, torso, view);
    return;
  }
  if (view.showsBack) {
    paintBackHoodRim(ctx, torso, view);
    return;
  }
  paintFacingHood(ctx, torso, view);
  paintDrawstrings(ctx, torso, view);
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
}

export const LUCKY_HOODIE = defineGarment({
  id: 'human_lucky_hoodie',
  name: 'Lucky Hoodie',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['torso'],
  covers: ['chest'],
  sleeves: { cloth: FADED_RED, cut: { cuffBulk: FLEECE_CUFF_BULK } },
  paint: { torso: humanEveryView(paintTorso) },
});
