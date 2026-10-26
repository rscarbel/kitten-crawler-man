/**
 * The Hazard Goggles on the human crawler: two round amber lenses in black
 * rims over his eyes, held on by a cracked rubber strap round his head.
 *
 * At the tile his head is about five pixels across and his eyes a pixel
 * apart, so the goggles are a dark band across the eye line broken by two
 * bright amber dots: the lenses are drawn bigger than his eyes and much
 * lighter than his skin, and the rims and strap far darker, so the band
 * reads at any size the cell is baked at.
 */

import type { BipedHeadFrame } from '../../art/biped/bipedParts';
import { FACE_FEATURES, withFacePlane } from '../../art/biped/head';
import { HEAD_RX } from '../../art/biped/proportions';
import { defineGarment } from '../garmentDef';
import { paintHeadStrap, type StrapLook } from './faceWear';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const RUBBER = '#141416';
/** The cracks in the strap catch the light as pale nicks across it. */
const RUBBER_CRACK = '#5a5a60';
const RIM = '#0e0c0a';
const AMBER_DEEP = '#a8520a';
const AMBER = '#ffab1f';
const AMBER_LIGHT = '#ffe07a';
const LENS_GLINT = '#fffbe8';

/** Each lens is wider than his eye, so the rim sits on the brow and cheek round it. */
const LENS_RADIUS = 0.046;
const RIM_WIDTH = 0.022;
/** The lenses sit a touch wider apart than his eyes: goggles are built for any face. */
const LENS_SPREAD = 1.08;
/** The bridge between the lenses over his nose. */
const BRIDGE_WIDTH = 0.026;
const STRAP_WIDTH = 0.05;

/** The amber steps from a lit upper-left band to a deep lower edge across the lens. */
const LENS_LIT_UNTIL = 0.35;
const LENS_DEEP_FROM = 0.75;
const GLINT_X = -0.4;
const GLINT_Y = -0.4;
const GLINT_RADIUS = 0.013;

/** Edge-on the lens is a cup standing off his eye, seen side-on as a narrow upright oval. */
const PROFILE_LENS_STANDOFF = 0.045;
const PROFILE_LENS_SQUASH = 0.6;
/** The cracks along the strap edge-on and from behind, as fractions of its run. */
const CRACK_LENGTH = 0.03;
const CRACK_WIDTH = 0.01;
const PROFILE_CRACK_XS = [-0.04, -0.1] as const;
const BACK_CRACK_XS = [-0.05, 0.045] as const;

const STRAP: StrapLook = {
  colour: RUBBER,
  width: STRAP_WIDTH,
  y: FACE_FEATURES.eyeY,
  profileFromX: FACE_FEATURES.profileEyeX,
};

function lensFill(ctx: Ctx, cx: number, cy: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(
    cx - LENS_RADIUS,
    cy - LENS_RADIUS,
    cx + LENS_RADIUS,
    cy + LENS_RADIUS,
  );
  gradient.addColorStop(0, AMBER_LIGHT);
  gradient.addColorStop(LENS_LIT_UNTIL, AMBER);
  gradient.addColorStop(LENS_DEEP_FROM, AMBER);
  gradient.addColorStop(1, AMBER_DEEP);
  return gradient;
}

/** One lens in its rim, `squash` across (1 head-on). */
function paintLens(ctx: Ctx, cx: number, cy: number, squash: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(squash, 1);
  ctx.beginPath();
  ctx.arc(0, 0, LENS_RADIUS + RIM_WIDTH / 2, 0, FULL_TURN);
  ctx.fillStyle = RIM;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, LENS_RADIUS - RIM_WIDTH / 2, 0, FULL_TURN);
  ctx.fillStyle = lensFill(ctx, 0, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(LENS_RADIUS * GLINT_X, LENS_RADIUS * GLINT_Y, GLINT_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = LENS_GLINT;
  ctx.fill();
  ctx.restore();
}

function paintCracks(ctx: Ctx, xs: readonly number[]): void {
  ctx.strokeStyle = RUBBER_CRACK;
  ctx.lineWidth = CRACK_WIDTH;
  ctx.lineCap = 'round';
  for (const x of xs) {
    ctx.beginPath();
    ctx.moveTo(x, STRAP.y - CRACK_LENGTH / 2);
    ctx.lineTo(x + CRACK_WIDTH, STRAP.y + CRACK_LENGTH / 2);
    ctx.stroke();
  }
}

function paintFacing(ctx: Ctx): void {
  const lensX = FACE_FEATURES.eyeDx * LENS_SPREAD;
  const y = FACE_FEATURES.eyeY;
  ctx.beginPath();
  ctx.moveTo(-HEAD_RX, y);
  ctx.lineTo(HEAD_RX, y);
  ctx.strokeStyle = RUBBER;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-lensX, y);
  ctx.lineTo(lensX, y);
  ctx.strokeStyle = RIM;
  ctx.lineWidth = BRIDGE_WIDTH;
  ctx.stroke();
  for (const side of [-1, 1]) paintLens(ctx, side * lensX, y, 1);
}

function paintProfile(ctx: Ctx, frame: BipedHeadFrame): void {
  paintHeadStrap(ctx, frame, STRAP);
  paintCracks(ctx, PROFILE_CRACK_XS);
  paintLens(
    ctx,
    FACE_FEATURES.profileEyeX + PROFILE_LENS_STANDOFF,
    FACE_FEATURES.eyeY,
    PROFILE_LENS_SQUASH,
  );
}

function paintHead(ctx: Ctx, frame: BipedHeadFrame): void {
  if (frame.view.showsBack) {
    paintHeadStrap(ctx, frame, STRAP);
    paintCracks(ctx, BACK_CRACK_XS);
    return;
  }
  if (frame.view.profile) {
    paintProfile(ctx, frame);
    return;
  }
  withFacePlane(ctx, frame.pose, frame.view, () => paintFacing(ctx));
}

export const HUMAN_HAZARD_GOGGLES = defineGarment({
  id: 'human_hazard_goggles',
  name: 'Hazard Goggles',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['head'],
  paint: { head: humanEveryView(paintHead) },
});
