/**
 * Ryan's shirt: a light-blue chambray button-up, the base garment over his
 * torso. Its body is the rig's torso in his look's cloth and cut; over it go
 * the open neck with a white V-neck undershirt showing in it, the placket and
 * its small white buttons, and the soft blousing where the tail is tucked in
 * under the belt. The collar is a pointed shirt collar lying open on his
 * shoulders rather than the jacket's stand collar.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { pt } from '../../art/biped/geometry';
import { crease } from '../../art/biped/paint';
import type { Ramp } from '../../art/biped/palette';
import { NECK_WIDTH } from '../../art/biped/proportions';
import {
  OPEN_NECK_DEPTH,
  openNeckCorners,
  paintJacket,
  traceGarmentTorso,
  traceOpenNeck,
  type TorsoFrame,
} from '../../art/biped/torso';
import type { ViewSpec } from '../../art/biped/rig';
import { type Pt, rgba } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** A plain white cotton undershirt, cool in its shade so it never reads as skin. */
const UNDERSHIRT: Ramp = {
  deep: '#7d8290',
  shadow: '#a3a8b4',
  dark: '#c0c4cc',
  mid: '#d6d8dd',
  base: '#e9eaed',
  light: '#f6f6f7',
  rim: '#ffffff',
};
const BUTTON = '#f4f5f7';

/** The collar wraps the neck at about the jacket collar's own width. */
const NECK_WRAP = 1.15;
/**
 * The undershirt's own V inside the open neck, which shows a little skin at
 * the throat: this much of the open neck's width at the top, and of its depth.
 */
const UNDER_V_SHARE = 0.7;
const UNDER_V_DEPTH = 0.5;
/** The placket runs from the open neck to the hem, a narrow band a step down from the cloth. */
const PLACKET_HALF = 0.014;
const PLACKET_ALPHA = 0.55;
/** The placket's own fold catches the key along its lit edge. */
const PLACKET_LIP_ALPHA = 0.5;
const PLACKET_LIP_WIDTH = 0.008;
/** The buttons below the open ones, down the placket. */
const BUTTON_YS = [0.2, 0.285, 0.37] as const;
const BUTTON_RADIUS = 0.0095;
const BUTTON_ALPHA = 0.9;
/** The open neck's edges are the cloth turned back: a shade line just inside them. */
const OPEN_EDGE_WIDTH = 0.012;
const OPEN_EDGE_OPACITY = 0.7;
/**
 * The tail tucked under the belt blouses over it: a soft fold of the cloth a
 * little above the hem, its lit lip below it.
 */
const BLOUSE_RISE = 0.07;
const BLOUSE_WIDTH = 0.02;
const BLOUSE_OPACITY = 0.6;
/** Head-on the blousing hangs a touch lower at the centre. */
const BLOUSE_SAG = 0.012;
/** How far past the torso a stroke runs, so the clip, not its round cap, ends it. */
const OVERREACH = 0.5;

/** The pointed collar head-on: each wing from behind the neck out over the shoulder and down to its point. */
const COLLAR_BACK_Y = -0.06;
const COLLAR_SPREAD = 1.12;
const COLLAR_SPREAD_Y = -0.01;
const COLLAR_POINT_X = 0.5;
const COLLAR_POINT_Y = 0.08;
const COLLAR_INNER_X = 0.86;
const COLLAR_INNER_Y = -0.03;
/** The shadow the collar's wing casts on the shirt just below its edge. */
const COLLAR_SHADOW_WIDTH = 0.016;
const COLLAR_SHADOW_OPACITY = 0.4;
/**
 * The stand of the collar round the back of the neck, seen from behind: it
 * rises well up the nape, as a shirt collar does, so from behind the neck
 * shows only above it. Head-on it is behind his neck, so only its wings at
 * the front show.
 */
const COLLAR_STAND_TOP_Y = -0.1;
const COLLAR_STAND_BOTTOM_Y = -0.015;
/** Edge-on: the collar stands round the neck and its point drops onto the chest. */
const PROFILE_COLLAR = {
  backBottom: pt(-0.12, 0.0),
  backTop: pt(-0.11, -0.06),
  frontTop: pt(0.08, -0.03),
  point: pt(0.17, 0.09),
  frontBottom: pt(0.03, 0.05),
} as const;
/** A quadratic only reaches halfway to its control point. */
const QUAD_CONTROL_REACH = 2;

function neckHalf(view: ViewSpec): number {
  return NECK_WIDTH * view.girth * NECK_WRAP;
}

function trace(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  const [first, ...rest] = points;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

function fillPolygon(ctx: Ctx, points: readonly Pt[], colour: string): void {
  trace(ctx, points);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** The open neck: the white undershirt in the V of the shirt, skin in the V of the undershirt. */
function paintOpenNeck(ctx: Ctx, torso: TorsoFrame, view: ViewSpec, skin: Ramp): void {
  traceOpenNeck(ctx, torso, view);
  ctx.fillStyle = UNDERSHIRT.base;
  ctx.fill();
  traceOpenNeck(ctx, torso, view, UNDER_V_SHARE, UNDER_V_DEPTH);
  ctx.fillStyle = skin.mid;
  ctx.fill();
  if (view.profile) return;
  const [left, right, point] = openNeckCorners(torso, view, 1, 1);
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(point.x, point.y);
      ctx.lineTo(right.x, right.y);
    },
    OPEN_EDGE_WIDTH,
    torso.material,
    OPEN_EDGE_OPACITY,
  );
}

function paintPlacket(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const top = OPEN_NECK_DEPTH;
  const bottom = torso.hemY;
  fillPolygon(
    ctx,
    [
      at(-PLACKET_HALF, top),
      at(PLACKET_HALF, top),
      torso.hem(PLACKET_HALF),
      torso.hem(-PLACKET_HALF),
    ],
    rgba(torso.material.mid, PLACKET_ALPHA),
  );
  const lipTop = at(-PLACKET_HALF, top);
  const lipBottom = at(-PLACKET_HALF, bottom);
  ctx.strokeStyle = rgba(torso.material.light, PLACKET_LIP_ALPHA);
  ctx.lineWidth = PLACKET_LIP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(lipTop.x, lipTop.y);
  ctx.lineTo(lipBottom.x, lipBottom.y);
  ctx.stroke();
  ctx.fillStyle = rgba(BUTTON, BUTTON_ALPHA);
  for (const y of BUTTON_YS) {
    const button = at(0, y);
    ctx.beginPath();
    ctx.arc(button.x, button.y, BUTTON_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Head-on, how far either side of his centre the bloused fold runs before
 * {@link OVERREACH} carries it on past his sides, in halves of his neck's
 * width: two, a whole neck's width each way.
 */
const BLOUSE_HALF_SPAN_NECK_HALVES = 2;

/** The fold of the bloused tail, across the whole torso above the belt; the clip ends it at his sides. */
function paintBlousing(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const reach = view.profile ? OVERREACH : neckHalf(view) * BLOUSE_HALF_SPAN_NECK_HALVES;
  const y = torso.hemY - BLOUSE_RISE;
  const left = torso.at(-reach - OVERREACH, y);
  const right = torso.at(reach + OVERREACH, y);
  const mid = torso.at(0, y + (view.profile ? 0 : BLOUSE_SAG * QUAD_CONTROL_REACH));
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.quadraticCurveTo(mid.x, mid.y, right.x, right.y);
    },
    BLOUSE_WIDTH,
    torso.material,
    BLOUSE_OPACITY,
  );
}

function paintShirtBody(
  ctx: Ctx,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
): void {
  const { skeleton, view, look, torso } = frame;
  paintJacket(ctx, skeleton, context.pose, view, look);
  withClip(
    ctx,
    () => traceGarmentTorso(ctx, skeleton, context.pose, view, look),
    () => {
      paintBlousing(ctx, torso, view);
      if (view.showsBack) return;
      paintOpenNeck(ctx, torso, view, look.skin);
      if (!view.profile) paintPlacket(ctx, torso);
    },
  );
}

/** One wing of the pointed collar head-on, `side` −1 or +1 across him. */
function collarWing(torso: TorsoFrame, view: ViewSpec, side: number): Pt[] {
  const half = neckHalf(view);
  const { at } = torso;
  return [
    at(side * half, COLLAR_BACK_Y),
    at(side * half * COLLAR_SPREAD, COLLAR_SPREAD_Y),
    at(side * half * COLLAR_POINT_X, COLLAR_POINT_Y),
    at(side * half * COLLAR_INNER_X, COLLAR_INNER_Y),
  ];
}

function paintCollarShadow(ctx: Ctx, torso: TorsoFrame, from: Pt, to: Pt): void {
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    },
    COLLAR_SHADOW_WIDTH,
    torso.material,
    COLLAR_SHADOW_OPACITY,
  );
}

/** The collar's band hugs the neck: its top edge is this much narrower than its foot. */
const COLLAR_STAND_HUG = 0.86;
/** Its edges curve with the neck's round, dipping at the middle by this much. */
const COLLAR_STAND_CURVE = 0.012;
const COLLAR_STAND_LIP_WIDTH = 0.012;

/** The collar's stand round the back of the neck, seen from behind: a curved band, lit along its fold. */
function paintCollarStand(ctx: Ctx, torso: TorsoFrame, half: number): void {
  const { at } = torso;
  const topHalf = half * COLLAR_STAND_HUG;
  const dip = COLLAR_STAND_CURVE * QUAD_CONTROL_REACH;
  ctx.beginPath();
  const start = at(-topHalf, COLLAR_STAND_TOP_Y);
  ctx.moveTo(start.x, start.y);
  const topMid = at(0, COLLAR_STAND_TOP_Y + dip);
  const topRight = at(topHalf, COLLAR_STAND_TOP_Y);
  ctx.quadraticCurveTo(topMid.x, topMid.y, topRight.x, topRight.y);
  const bottomRight = at(half, COLLAR_STAND_BOTTOM_Y);
  ctx.lineTo(bottomRight.x, bottomRight.y);
  const bottomMid = at(0, COLLAR_STAND_BOTTOM_Y + dip);
  const bottomLeft = at(-half, COLLAR_STAND_BOTTOM_Y);
  ctx.quadraticCurveTo(bottomMid.x, bottomMid.y, bottomLeft.x, bottomLeft.y);
  ctx.closePath();
  ctx.fillStyle = torso.material.base;
  ctx.fill();
  ctx.strokeStyle = torso.material.light;
  ctx.lineWidth = COLLAR_STAND_LIP_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(topMid.x, topMid.y, topRight.x, topRight.y);
  ctx.stroke();
}

function paintCollarFacing(ctx: Ctx, torso: TorsoFrame, view: ViewSpec): void {
  const half = neckHalf(view);
  if (view.showsBack) {
    paintCollarStand(ctx, torso, half);
    return;
  }
  for (const side of [-1, 1]) {
    const wing = collarWing(torso, view, side);
    paintCollarShadow(ctx, torso, wing[1], wing[2]);
    fillPolygon(ctx, wing, side < 0 ? torso.material.light : torso.material.base);
  }
}

function paintCollarProfile(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const depth = torso.cut.profileDepth;
  const p = (q: Pt): Pt => at(q.x * depth, q.y);
  const c = PROFILE_COLLAR;
  paintCollarShadow(ctx, torso, p(c.point), p(c.frontBottom));
  fillPolygon(
    ctx,
    [p(c.backBottom), p(c.backTop), p(c.frontTop), p(c.point), p(c.frontBottom)],
    torso.material.light,
  );
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintShirtBody(ctx, frame, context);
  else if (frame.piece === 'collar') {
    if (frame.view.profile) paintCollarProfile(ctx, frame.torso);
    else paintCollarFacing(ctx, frame.torso, frame.view);
  }
}

export const RYAN_SHIRT = defineGarment({
  id: 'ryan_shirt',
  name: 'Chambray shirt',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['torso'],
  paint: { torso: humanEveryView(paintTorso) },
});
