/**
 * The Padded Gambeson on Carl: twenty layers of linen quilted flat, worn over
 * his jacket's body. At the tile it is an unbleached tan coat, its padding
 * ridged into vertical channels by the quilting seams, closed down the front
 * and finished with a padded stand collar and a rolled hem.
 */

import type { CarlTorsoFrame } from '../../art/carl/carlParts';
import { crease, FIGURE_CREASE_LAYERS, shadeForm } from '../../art/carl/paint';
import { deriveRamp } from '../../art/carl/palette';
import { CHEST_HALF } from '../../art/carl/proportions';
import {
  COLLAR_RIM_WIDTH,
  collarShape,
  traceCollar,
  traceGarmentTorso,
  type TorsoFrame,
} from '../../art/carl/torso';
import type { Pt } from '../../art/carlArt';
import { rgba } from '../../art/carlArt';
import { strokeSoftCrease, withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const LINEN = deriveRamp('#d3c39e');

/** Quilted padding turns into shadow gradually: a broad, soft terminator. */
const TORSO_SOFTNESS = 1.8;
/** Profile depth of his torso from shoulder blades to pecs, halved. */
const PROFILE_HALF_DEPTH = 0.32;

/** Across-the-body spacing of the quilting seams, in torso units. */
const CHANNEL_PITCH = 0.13;
/** Seams start just above the shoulder line so the trapezius slope clips them. */
const CHANNEL_TOP_Y = -0.08;
/** Below the hem, so the silhouette clip ends every seam cleanly. */
const CHANNEL_HEM_OVERREACH = 0.05;
/** Padding swells over the chest: the seams bow out this much at mid-chest. */
const CHANNEL_CHEST_BOW = 1.08;
const CHANNEL_CHEST_Y = 0.15;
/** A quilting seam pinches the padding into a soft trough, not a sharp leather fold. */
const SEAM_WIDTH = 0.032;
const SEAM_OPACITY = 0.95;
/**
 * Each channel's padding puffs up between its seams: a soft lit ridge down its
 * middle, nudged toward the key, is what turns stripes into quilting.
 */
const RIDGE_WIDTH = 0.05;
const RIDGE_ALPHA = 0.8;
const RIDGE_KEY_SHIFT = -0.012;

/** The opening down the front: the left panel lapped over the right, closed with ties. */
const OPENING_X = -0.015;
const OPENING_OPACITY = 0.95;
const TIE_YS = [0.08, 0.2, 0.32] as const;
const TIE_RADIUS = 0.018;
const TIE_COLOUR = '#4a3322';

/** The rolled hem: a padded band whose top edge catches the key. */
const HEM_ROLL_RISE = 0.06;
const HEM_ROLL_ALPHA = 0.75;
const HEM_ROLL_LIP_WIDTH = 0.02;
const HEM_ROLL_LIP_ALPHA = 0.6;

/**
 * Rows stitched across the channels, so the padding puffs into boxes rather
 * than running as stripes a printed pinstripe could also make.
 */
const CROSS_SEAM_YS = [0.17, 0.3] as const;
const CROSS_SEAM_SAG = 0.012;

/**
 * Twenty layers of linen stand off the jacket: the coat's edge is laid round
 * the jacket's silhouette in its shadow tone before the coat itself.
 */
const PADDING_BULK = 0.03;

/** A stitch line across the shoulders, where the sleeves' padding is sewn on. */
const YOKE_Y = 0.04;
const YOKE_ALPHA = 0.6;

/** The padded collar stands proud of the neck and is stitched once along its length. */
const COLLAR_STITCH_SHARE = 0.5;
const COLLAR_STITCH_WIDTH = 0.012;
const COLLAR_STITCH_ALPHA = 0.55;
const COLLAR_RIM_ALPHA = 0.8;

/** In profile the seams run down his side from the shoulder blades to the chest. */
const PROFILE_CHANNEL_XS = [-0.195, -0.065, 0.065, 0.195] as const;

function strokeSeam(ctx: Ctx, from: Pt, control: Pt, to: Pt, opacity: number): void {
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    SEAM_WIDTH,
    LINEN,
    opacity,
  );
}

function channelAt(ctx: Ctx, torso: TorsoFrame, x: number, opacity = SEAM_OPACITY): void {
  strokeSeam(
    ctx,
    torso.at(x, CHANNEL_TOP_Y),
    torso.at(x * CHANNEL_CHEST_BOW, CHANNEL_CHEST_Y),
    torso.hem(x, CHANNEL_HEM_OVERREACH),
    opacity,
  );
}

function ridgeAt(ctx: Ctx, torso: TorsoFrame, x: number): void {
  const shifted = x + RIDGE_KEY_SHIFT;
  const from = torso.at(shifted, CHANNEL_TOP_Y);
  const control = torso.at(shifted * CHANNEL_CHEST_BOW, CHANNEL_CHEST_Y);
  const to = torso.hem(shifted, CHANNEL_HEM_OVERREACH);
  strokeSoftCrease(
    ctx,
    RIDGE_WIDTH,
    LINEN.light,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    RIDGE_ALPHA,
    FIGURE_CREASE_LAYERS,
  );
}

function paintRidges(ctx: Ctx, torso: TorsoFrame, halfWidth: number): void {
  for (let x = CHANNEL_PITCH / 2; x < halfWidth; x += CHANNEL_PITCH) {
    ridgeAt(ctx, torso, x);
    ridgeAt(ctx, torso, -x);
  }
}

function paintChannels(ctx: Ctx, torso: TorsoFrame, halfWidth: number, skipCentre: boolean): void {
  paintRidges(ctx, torso, halfWidth);
  const firstSeam = skipCentre ? 1 : 0;
  for (let i = firstSeam; i * CHANNEL_PITCH < halfWidth; i++) {
    const x = i * CHANNEL_PITCH;
    channelAt(ctx, torso, x);
    if (i > 0) channelAt(ctx, torso, -x);
  }
}

function paintHemRoll(ctx: Ctx, torso: TorsoFrame, halfWidth: number): void {
  const rollTop = torso.hem(-halfWidth, -HEM_ROLL_RISE);
  const rollTopEnd = torso.hem(halfWidth, -HEM_ROLL_RISE);
  const below = torso.hem(halfWidth, CHANNEL_HEM_OVERREACH);
  const belowStart = torso.hem(-halfWidth, CHANNEL_HEM_OVERREACH);
  ctx.beginPath();
  ctx.moveTo(rollTop.x, rollTop.y);
  ctx.lineTo(rollTopEnd.x, rollTopEnd.y);
  ctx.lineTo(below.x, below.y);
  ctx.lineTo(belowStart.x, belowStart.y);
  ctx.closePath();
  ctx.fillStyle = rgba(LINEN.dark, HEM_ROLL_ALPHA);
  ctx.fill();
  ctx.lineCap = 'butt';
  ctx.lineWidth = HEM_ROLL_LIP_WIDTH;
  ctx.strokeStyle = rgba(LINEN.rim, HEM_ROLL_LIP_ALPHA);
  ctx.beginPath();
  ctx.moveTo(rollTop.x, rollTop.y);
  ctx.lineTo(rollTopEnd.x, rollTopEnd.y);
  ctx.stroke();
}

function paintCrossSeams(ctx: Ctx, torso: TorsoFrame, halfWidth: number): void {
  for (const y of CROSS_SEAM_YS) {
    strokeSeam(
      ctx,
      torso.at(-halfWidth, y),
      torso.at(0, y + CROSS_SEAM_SAG),
      torso.at(halfWidth, y),
      SEAM_OPACITY,
    );
  }
}

function paintYokeStitch(ctx: Ctx, torso: TorsoFrame, halfWidth: number): void {
  const from = torso.at(-halfWidth, YOKE_Y);
  const to = torso.at(halfWidth, YOKE_Y);
  const control = torso.at(0, YOKE_Y);
  strokeSeam(ctx, from, control, to, YOKE_ALPHA);
}

function paintOpening(ctx: Ctx, torso: TorsoFrame): void {
  strokeSeam(
    ctx,
    torso.at(OPENING_X, CHANNEL_TOP_Y),
    torso.at(OPENING_X, CHANNEL_CHEST_Y),
    torso.hem(OPENING_X, CHANNEL_HEM_OVERREACH),
    OPENING_OPACITY,
  );
  ctx.fillStyle = TIE_COLOUR;
  for (const y of TIE_YS) {
    const tie = torso.at(OPENING_X, y);
    ctx.beginPath();
    ctx.arc(tie.x, tie.y, TIE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBody(ctx: Ctx, frame: CarlTorsoFrame, context: GarmentFrameContext<'human'>): void {
  const { skeleton, view, torso } = frame;
  const trace = (): void => traceGarmentTorso(ctx, skeleton, context.pose, view);
  const shoulderHalf = Math.max(
    -torso.acrossOf(skeleton.leftShoulder),
    torso.acrossOf(skeleton.rightShoulder),
  );
  const halfWidth = view.profile ? PROFILE_HALF_DEPTH : shoulderHalf;
  const chestHalf = CHEST_HALF * view.girth;
  trace();
  ctx.lineJoin = 'round';
  ctx.lineWidth = PADDING_BULK * 2;
  ctx.strokeStyle = LINEN.dark;
  ctx.stroke();
  shadeForm(
    ctx,
    trace,
    { from: torso.at(0, 0), to: torso.at(0, torso.hemY) },
    LINEN,
    { halfWidth, softness: TORSO_SOFTNESS },
    () => {
      if (view.profile) {
        paintRidges(ctx, torso, PROFILE_HALF_DEPTH);
        for (const x of PROFILE_CHANNEL_XS) channelAt(ctx, torso, x);
        paintCrossSeams(ctx, torso, PROFILE_HALF_DEPTH * 2);
        paintHemRoll(ctx, torso, PROFILE_HALF_DEPTH * 2);
        return;
      }
      paintYokeStitch(ctx, torso, shoulderHalf);
      paintChannels(ctx, torso, chestHalf, !view.showsBack);
      paintCrossSeams(ctx, torso, shoulderHalf);
      paintHemRoll(ctx, torso, shoulderHalf);
      if (!view.showsBack) paintOpening(ctx, torso);
    },
  );
}

function paintCollar(ctx: Ctx, frame: CarlTorsoFrame): void {
  const collar = collarShape(frame.torso, frame.view, 0);
  traceCollar(ctx, collar);
  ctx.fillStyle = LINEN.light;
  ctx.fill();
  withClip(
    ctx,
    () => traceCollar(ctx, collar),
    () => {
      const share = COLLAR_STITCH_SHARE;
      const mid = (a: Pt, b: Pt): Pt => ({
        x: a.x + (b.x - a.x) * share,
        y: a.y + (b.y - a.y) * share,
      });
      const left = mid(collar.bottomLeft, collar.topLeft);
      const centre = mid(collar.bottomMid, collar.topMid);
      const right = mid(collar.bottomRight, collar.topRight);
      ctx.lineWidth = COLLAR_STITCH_WIDTH;
      ctx.strokeStyle = rgba(LINEN.dark, COLLAR_STITCH_ALPHA);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.quadraticCurveTo(centre.x, centre.y, right.x, right.y);
      ctx.stroke();
    },
  );
}

function paintCollarRim(ctx: Ctx, frame: CarlTorsoFrame): void {
  const collar = collarShape(frame.torso, frame.view, 0);
  ctx.lineCap = 'round';
  ctx.lineWidth = COLLAR_RIM_WIDTH;
  ctx.strokeStyle = rgba(LINEN.rim, COLLAR_RIM_ALPHA);
  ctx.beginPath();
  ctx.moveTo(collar.topLeft.x, collar.topLeft.y);
  ctx.quadraticCurveTo(collar.topMid.x, collar.topMid.y, collar.topRight.x, collar.topRight.y);
  ctx.stroke();
}

function paintTorso(ctx: Ctx, frame: CarlTorsoFrame, context: GarmentFrameContext<'human'>): void {
  ctx.save();
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
  else paintCollarRim(ctx, frame);
  ctx.restore();
}

export const CARL_GAMBESON = defineGarment({
  id: 'carl_gambeson',
  name: 'Padded Gambeson',
  wearer: 'human',
  material: 'cloth',
  layer: 'outer',
  region: ['torso'],
  paint: { torso: carlEveryView(paintTorso) },
});
