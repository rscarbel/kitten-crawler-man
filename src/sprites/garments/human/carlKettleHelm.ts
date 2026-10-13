/**
 * The Issue Kettle Helm on Carl: a wide-brimmed iron pot with a leather chin
 * strap and somebody else's dent in the crown. At the 32 px tile the helm is
 * a handful of pixels, so steel has to come from the shapes rather than the
 * shading: a smooth bowl with a hard specular on its lit shoulder, sitting in
 * a broad, thick brim whose rolled edge catches the light all round the front.
 */

import type { CarlHeadFrame } from '../../art/carl/carlParts';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from '../../art/carl/proportions';
import { IRON, metalFill } from '../cat/metalInk';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

const STRAP = '#3e2410';
const STRAP_WIDTH = 0.042;
const BRIM_UNDERSIDE = '#16181c';
const DENT_SHADOW = '#1d2126';

/** Where the brim sits, in head radii above the eye line: over the brow, clear of the eyes. */
const BRIM_RISE = 0.6;
/** How far the brim stands out past the skull all round. */
const BRIM_OVERHANG = 0.072;
/** The brim is seen from above, so its circle flattens to this share of its width. */
const BRIM_FORESHORTEN = 0.24;
/** The rolled edge shows this thick below the brim's top. */
const BRIM_EDGE = 0.034;
const RIM_LIGHT_WIDTH = 0.03;
/** The front stretch of the rim that catches the key light, as radians round from its right end. */
const RIM_LIT_FROM = 0.35;
const RIM_LIT_TO = HALF_TURN;

/** The bowl stands out past the skull a little and rises this far above the brim. */
const DOME_OVERHANG = 0.03;
const DOME_HEIGHT = 0.15;

/** The bowl's hard banding, as fractions of its key-light gradient's radius. */
const DOME_LIGHT_CENTRE_X = -0.45;
const DOME_LIGHT_CENTRE_Y = -0.62;
const DOME_GRADIENT_REACH = 1.55;
const DOME_GLINT_UNTIL = 0.1;
const DOME_LIGHT_UNTIL = 0.3;
const DOME_BASE_UNTIL = 0.62;
const DOME_FEATHER = 0.035;

/** The specular, a hard bright spot on the bowl's lit shoulder. */
const SPECULAR_X = -0.42;
const SPECULAR_Y = -0.62;
const SPECULAR_RX = 0.032;
const SPECULAR_RY = 0.022;
const SPECULAR_TILT = -0.6;

/** The dent, high on the crown's shadowed side. */
const DENT_X = 0.36;
const DENT_Y = -0.66;
const DENT_RX = 0.036;
const DENT_RY = 0.022;
const DENT_TILT = 0.5;
const DENT_ALPHA = 0.8;
/** The dent's lower lip catches the light, which is what makes it a dent and not a stain. */
const DENT_LIP_DROP = 0.014;

/** The brim's shadow on his forehead. */
const BRIM_SHADOW_ALPHA = 0.45;
const BRIM_SHADOW_DEPTH = 0.004;
/** The shadow is a thin band over the brow: any deeper and it masks the eyes. */
const BRIM_SHADOW_SQUASH = 0.6;

/** Head-on the strap leaves the brim at the temples and runs down the cheeks under the chin. */
const STRAP_ROOT_X = 0.9;
const STRAP_CHIN_X = 0.42;
const STRAP_CHIN_Y = 1.18;
const STRAP_CHEEK_X = 1.02;
const STRAP_CHEEK_Y = 0.55;

/**
 * Edge-on the brim stands off less than head-on: the skull is deeper than it
 * is wide, and the hat allowance is measured round the head-on oval.
 */
const PROFILE_BRIM_OVERHANG = 0.04;
/** Edge-on the brim tips down over the brow. */
const PROFILE_TILT = 0.09;
const PROFILE_FORESHORTEN = 0.14;
/** Edge-on the strap leaves the brim above the ear and runs forward under the jaw. */
const PROFILE_STRAP_ROOT_X = -0.05;
const PROFILE_STRAP_CHIN_X = 0.42;
const PROFILE_STRAP_CHIN_Y = 1.04;
const PROFILE_STRAP_BEND_X = 0.05;
const PROFILE_STRAP_BEND_Y = 0.7;

interface HelmShape {
  readonly cx: number;
  readonly brimY: number;
  readonly brimHalfWidth: number;
  readonly brimHalfDepth: number;
  readonly domeHalfWidth: number;
}

function domeBaseHalfDepth(shape: HelmShape): number {
  return (shape.brimHalfDepth * shape.domeHalfWidth) / shape.brimHalfWidth;
}

function traceDome(ctx: Ctx, shape: HelmShape): void {
  const { cx, brimY, domeHalfWidth } = shape;
  ctx.beginPath();
  ctx.ellipse(cx, brimY, domeHalfWidth, DOME_HEIGHT, 0, HALF_TURN, FULL_TURN);
  ctx.ellipse(cx, brimY, domeHalfWidth, domeBaseHalfDepth(shape), 0, 0, HALF_TURN);
  ctx.closePath();
}

function domeFill(ctx: Ctx, shape: HelmShape): CanvasGradient {
  const { cx, brimY, domeHalfWidth } = shape;
  const lightX = cx + domeHalfWidth * DOME_LIGHT_CENTRE_X;
  const lightY = brimY + DOME_HEIGHT * DOME_LIGHT_CENTRE_Y;
  const gradient = ctx.createRadialGradient(
    lightX,
    lightY,
    0,
    lightX,
    lightY,
    domeHalfWidth * DOME_GRADIENT_REACH,
  );
  gradient.addColorStop(0, IRON.light);
  gradient.addColorStop(DOME_GLINT_UNTIL, IRON.light);
  gradient.addColorStop(DOME_LIGHT_UNTIL - DOME_FEATHER, IRON.light);
  gradient.addColorStop(DOME_LIGHT_UNTIL + DOME_FEATHER, IRON.base);
  gradient.addColorStop(DOME_BASE_UNTIL - DOME_FEATHER, IRON.base);
  gradient.addColorStop(DOME_BASE_UNTIL + DOME_FEATHER, IRON.shadow);
  gradient.addColorStop(1, IRON.shadow);
  return gradient;
}

function paintBrimShadow(ctx: Ctx, shape: HelmShape): void {
  ctx.save();
  ctx.globalAlpha = BRIM_SHADOW_ALPHA;
  ctx.beginPath();
  ctx.ellipse(
    shape.cx,
    shape.brimY + BRIM_EDGE + BRIM_SHADOW_DEPTH,
    shape.domeHalfWidth,
    shape.brimHalfDepth * BRIM_SHADOW_SQUASH,
    0,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.fill();
  ctx.restore();
}

function paintBrim(ctx: Ctx, shape: HelmShape): void {
  const { cx, brimY, brimHalfWidth, brimHalfDepth } = shape;
  ctx.beginPath();
  ctx.ellipse(cx, brimY + BRIM_EDGE, brimHalfWidth, brimHalfDepth, 0, 0, FULL_TURN);
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, brimY, brimHalfWidth, brimHalfDepth, 0, 0, FULL_TURN);
  ctx.fillStyle = metalFill(
    ctx,
    IRON,
    cx - brimHalfWidth,
    brimY - brimHalfDepth,
    cx + brimHalfWidth,
    brimY + brimHalfDepth,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, brimY, brimHalfWidth, brimHalfDepth, 0, RIM_LIT_FROM, RIM_LIT_TO);
  ctx.strokeStyle = IRON.light;
  ctx.lineWidth = RIM_LIGHT_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintDome(ctx: Ctx, shape: HelmShape): void {
  const { cx, brimY, domeHalfWidth } = shape;
  traceDome(ctx, shape);
  ctx.fillStyle = domeFill(ctx, shape);
  ctx.fill();

  ctx.save();
  ctx.translate(cx + domeHalfWidth * DENT_X, brimY + DOME_HEIGHT * DENT_Y);
  ctx.rotate(DENT_TILT);
  ctx.beginPath();
  ctx.ellipse(0, DENT_LIP_DROP, DENT_RX, DENT_RY, 0, 0, FULL_TURN);
  ctx.fillStyle = IRON.base;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, DENT_RX, DENT_RY, 0, 0, FULL_TURN);
  ctx.globalAlpha = DENT_ALPHA;
  ctx.fillStyle = DENT_SHADOW;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx + domeHalfWidth * SPECULAR_X, brimY + DOME_HEIGHT * SPECULAR_Y);
  ctx.rotate(SPECULAR_TILT);
  ctx.beginPath();
  ctx.ellipse(0, 0, SPECULAR_RX, SPECULAR_RY, 0, 0, FULL_TURN);
  ctx.fillStyle = IRON.glint;
  ctx.fill();
  ctx.restore();
}

function strokeStrap(
  ctx: Ctx,
  fromX: number,
  fromY: number,
  bendX: number,
  bendY: number,
  toX: number,
  toY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(bendX, bendY, toX, toY);
  ctx.strokeStyle = STRAP;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * Head-on the strap is one band from temple to temple round the chin: drawn as
 * two cheek strokes that never meet, it reads as sideburns.
 */
function paintChinStrap(ctx: Ctx, brimY: number): void {
  ctx.beginPath();
  ctx.moveTo(-HEAD_RX * STRAP_ROOT_X, brimY);
  ctx.quadraticCurveTo(
    -HEAD_RX * STRAP_CHEEK_X,
    HEAD_RY * STRAP_CHEEK_Y,
    -HEAD_RX * STRAP_CHIN_X,
    HEAD_RY * STRAP_CHIN_Y,
  );
  ctx.lineTo(HEAD_RX * STRAP_CHIN_X, HEAD_RY * STRAP_CHIN_Y);
  ctx.quadraticCurveTo(
    HEAD_RX * STRAP_CHEEK_X,
    HEAD_RY * STRAP_CHEEK_Y,
    HEAD_RX * STRAP_ROOT_X,
    brimY,
  );
  ctx.strokeStyle = STRAP;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function paintHelm(ctx: Ctx, shape: HelmShape): void {
  paintBrimShadow(ctx, shape);
  paintBrim(ctx, shape);
  paintDome(ctx, shape);
}

function facingShape(): HelmShape {
  const brimHalfWidth = HEAD_RX + BRIM_OVERHANG;
  return {
    cx: 0,
    brimY: -HEAD_RY * BRIM_RISE,
    brimHalfWidth,
    brimHalfDepth: brimHalfWidth * BRIM_FORESHORTEN,
    domeHalfWidth: HEAD_RX + DOME_OVERHANG,
  };
}

function paintFacing(ctx: Ctx, showsFace: boolean): void {
  const shape = facingShape();
  if (showsFace) paintChinStrap(ctx, shape.brimY);
  paintHelm(ctx, shape);
}

function paintProfile(ctx: Ctx): void {
  const brimHalfWidth = HEAD_DEPTH + PROFILE_BRIM_OVERHANG;
  const shape: HelmShape = {
    cx: 0,
    brimY: -HEAD_RY * BRIM_RISE,
    brimHalfWidth,
    brimHalfDepth: brimHalfWidth * PROFILE_FORESHORTEN,
    domeHalfWidth: HEAD_DEPTH + DOME_OVERHANG,
  };
  strokeStrap(
    ctx,
    HEAD_DEPTH * PROFILE_STRAP_ROOT_X,
    shape.brimY,
    HEAD_DEPTH * PROFILE_STRAP_BEND_X,
    HEAD_RY * PROFILE_STRAP_BEND_Y,
    HEAD_DEPTH * PROFILE_STRAP_CHIN_X,
    HEAD_RY * PROFILE_STRAP_CHIN_Y,
  );
  ctx.save();
  ctx.translate(shape.cx, shape.brimY);
  ctx.rotate(PROFILE_TILT);
  ctx.translate(-shape.cx, -shape.brimY);
  paintHelm(ctx, shape);
  ctx.restore();
}

function paintHead(ctx: Ctx, frame: CarlHeadFrame): void {
  ctx.save();
  if (frame.view.profile) paintProfile(ctx);
  else paintFacing(ctx, !frame.view.showsBack);
  ctx.restore();
}

export const CARL_KETTLE_HELM = defineGarment({
  id: 'carl_kettle_helm',
  name: 'Issue Kettle Helm',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  hides: [{ kind: 'feature', feature: 'hair' }],
  paint: { head: carlEveryView(paintHead) },
});
