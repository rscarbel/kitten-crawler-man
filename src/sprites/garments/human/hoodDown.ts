/**
 * A hood worn down: bunched round the back of the neck head-on, lying flat
 * down the upper back from behind, a lump behind the nape edge-on. Painted
 * in the torso's own frame by whichever torso garment has one, in that
 * garment's cloth — the Lucky Hoodie's fleece, a monk's wool habit.
 */

import { crease } from '../../art/biped/paint';
import type { Ramp } from '../../art/biped/palette';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import { pt } from '../../art/biped/geometry';
import { rgba, type Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { strokeLine } from './torsoCover';

type Ctx = CanvasRenderingContext2D;

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

export function paintBackHood(ctx: Ctx, torso: TorsoFrame, cloth: Ramp): void {
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
  ctx.fillStyle = rgba(cloth.deep, BACK_HOOD_SHADOW_ALPHA);
  ctx.fill();
  ctx.restore();
  outline();
  const lit = at(0, BACK_HOOD_TOP_Y);
  const shaded = at(0, BACK_HOOD_TIP_Y);
  const fall = ctx.createLinearGradient(lit.x, lit.y, shaded.x, shaded.y);
  fall.addColorStop(0, cloth.light);
  fall.addColorStop(1, cloth.mid);
  ctx.fillStyle = fall;
  ctx.fill();
  withClip(ctx, outline, () => {
    crease(ctx, outline, BACK_HOOD_EDGE_WIDTH, cloth, BACK_HOOD_EDGE_ALPHA);
    const left = at(-BACK_HOOD_MOUTH_HALF, BACK_HOOD_TOP_Y);
    const right = at(BACK_HOOD_MOUTH_HALF, BACK_HOOD_TOP_Y);
    const low = at(0, BACK_HOOD_TOP_Y + BACK_HOOD_MOUTH_DEPTH * QUAD_CONTROL_REACH);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(low.x, low.y, right.x, right.y);
    ctx.closePath();
    ctx.fillStyle = cloth.deep;
    ctx.fill();
  });
}

export function paintProfileHood(ctx: Ctx, torso: TorsoFrame, cloth: Ramp): void {
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
  ctx.fillStyle = cloth.light;
  ctx.fill();
  withClip(ctx, outline, () => {
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.quadraticCurveTo(low.x, low.y, front.x, front.y);
    ctx.strokeStyle = rgba(cloth.shadow, PROFILE_HOOD_SHADE_ALPHA);
    ctx.lineWidth = HOOD_FOLD_WIDTH * QUAD_CONTROL_REACH;
    ctx.stroke();
    strokeLine(ctx, [front, top], rgba(cloth.deep, PROFILE_HOOD_MOUTH_ALPHA), HOOD_FOLD_WIDTH);
  });
}

/** Head-on the hood is a thick roll round the neck, standing out past it and meeting in a V at the throat. */
export function paintFacingHood(ctx: Ctx, torso: TorsoFrame, view: ViewSpec, cloth: Ramp): void {
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
  ctx.fillStyle = cloth.light;
  ctx.fill();
  crease(ctx, outline, HOOD_FOLD_WIDTH, cloth, HOOD_FOLD_ALPHA);
  ctx.restore();
}

/** From behind, the hood's rim stands round the base of his neck over the hood lying on his back. */
export function paintBackHoodRim(ctx: Ctx, torso: TorsoFrame, view: ViewSpec, cloth: Ramp): void {
  const { at } = torso;
  const half = BACK_HOOD_TOP_HALF * view.girth;
  const left = at(-half, BACK_HOOD_TOP_Y);
  const right = at(half, BACK_HOOD_TOP_Y);
  const mid = at(0, BACK_HOOD_TOP_Y + BACK_HOOD_MOUTH_DEPTH);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.quadraticCurveTo(mid.x, mid.y, right.x, right.y);
  ctx.strokeStyle = cloth.light;
  ctx.lineWidth = HOOD_FOLD_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}
