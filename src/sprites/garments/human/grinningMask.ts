/**
 * The Grinning Mask on the human crawler: a white porcelain face over his,
 * forehead to chin, with almond eye holes and a smile cut far too wide for
 * any face, tied on with a dark ribbon round his head. His hair and ears stay
 * outside it, so he still reads as a man wearing a mask.
 *
 * At the tile his face is about five pixels, so the mask is a white shield
 * with two dark holes and a dark crescent running nearly ear to ear: the
 * holes are painted as voids rather than cut through to his eyes, since an
 * eye seen through a hole a pixel wide averages into the porcelain, and the
 * grin is heavy and turned up hard at its corners, since a thin one reads as
 * a mouth line on a pale face rather than as a mask.
 */

import type { BipedHeadFrame } from '../../art/biped/bipedParts';
import { FACE_FEATURES, withFacePlane } from '../../art/biped/head';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from '../../art/biped/proportions';
import { type Pt } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import { paintHeadStrap, type StrapLook } from './faceWear';
import { tracePolygon } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

/** The cat's mask's porcelain and lacquer, so the pair read as one mask. */
const PORCELAIN_LIGHT = '#ffffff';
const PORCELAIN = '#e9e6ee';
const PORCELAIN_SHADE = '#a8a2b8';
const MASK_EDGE = '#4a4458';
const VOID_INK = '#16070c';
const LIP_RED = '#c0182e';
const RIBBON = '#241612';

/** Where the porcelain's lit band ends and its shade begins, down the face. */
const LIT_UNTIL = 0.3;
const SHADE_FROM = 0.75;
const EDGE_WIDTH = 0.012;
const RIBBON_WIDTH = 0.03;
const LIP_WIDTH = 0.007;

/**
 * Head-on, the mask's outline as fractions of the head's half-width and
 * half-height: across the forehead under the hairline, out over the
 * cheekbones and in to a broad chin. It stays inside the skull, so his ears
 * and the sides of his head frame it.
 */
const FACING_MASK: readonly Pt[] = [
  { x: 0, y: -0.78 },
  { x: 0.62, y: -0.7 },
  { x: 0.86, y: -0.3 },
  { x: 0.86, y: 0.25 },
  { x: 0.68, y: 0.85 },
  { x: 0.36, y: 1.16 },
  { x: 0, y: 1.22 },
];
/** The almond eye holes, larger than his eyes so the porcelain frames them, slanting up to the temples. */
const EYE_HOLE_RX_SHARE = 1.7;
const EYE_HOLE_RY_SHARE = 2.8;
const EYE_HOLE_SLANT = 0.3;
/** The grin: a crescent from near one ear to the other, its corners turned up level with his nose. */
const SMILE_HALF_WIDTH = 0.74;
const SMILE_CORNER_Y = 0.32;
const SMILE_BOTTOM_Y = 1.04;
const SMILE_TOP_Y = 0.55;

/**
 * Edge-on, the shell over the front of his face in fractions of the head's
 * depth across and half-height down: its own porcelain brow, nose and chin
 * standing just proud of his, its back edge close behind his eye so it hugs the face front rather than standing off the cheek.
 */
const PROFILE_MASK: readonly Pt[] = [
  { x: 0.6, y: -0.78 },
  { x: 0.95, y: -0.74 },
  { x: 1.06, y: -0.3 },
  { x: 1.0, y: -0.12 },
  { x: 1.24, y: 0.24 },
  { x: 1.02, y: 0.34 },
  { x: 1.06, y: 1.0 },
  { x: 0.82, y: 1.24 },
  { x: 0.6, y: 1.12 },
  { x: 0.5, y: 0.4 },
];
const PROFILE_EYE_HOLE_RX_SHARE = 1.9;
/** Edge-on the grin runs back from the mask's lips round the cheek and curls up. */
const PROFILE_SMILE_FRONT: Pt = { x: 1.04, y: 0.58 };
const PROFILE_SMILE_SAG: Pt = { x: 0.78, y: 0.82 };
const PROFILE_SMILE_END: Pt = { x: 0.58, y: 0.38 };
const PROFILE_SMILE_WIDTH = 0.036;
/** Where the ribbon leaves the shell's back edge. */
const PROFILE_RIBBON_FROM_X = 0.5;

const RIBBON_STRAP: StrapLook = {
  colour: RIBBON,
  width: RIBBON_WIDTH,
  y: FACE_FEATURES.eyeY,
  profileFromX: HEAD_DEPTH * PROFILE_RIBBON_FROM_X,
};

function porcelainFill(ctx: Ctx, top: number, bottom: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, PORCELAIN_LIGHT);
  gradient.addColorStop(LIT_UNTIL, PORCELAIN);
  gradient.addColorStop(SHADE_FROM, PORCELAIN);
  gradient.addColorStop(1, PORCELAIN_SHADE);
  return gradient;
}

function scaled(points: readonly Pt[], sx: number, sy: number): Pt[] {
  return points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

/** The head-on outline mirrored about the face's centre line, top round to chin and back. */
function facingOutline(): Pt[] {
  const right = scaled(FACING_MASK, HEAD_RX, HEAD_RY);
  const left = right
    .slice(1, -1)
    .reverse()
    .map((p) => ({ x: -p.x, y: p.y }));
  return [...right, ...left];
}

function paintPorcelain(ctx: Ctx, outline: readonly Pt[]): void {
  const ys = outline.map((p) => p.y);
  tracePolygon(ctx, outline);
  ctx.fillStyle = porcelainFill(ctx, Math.min(...ys), Math.max(...ys));
  ctx.fill();
  ctx.strokeStyle = MASK_EDGE;
  ctx.lineWidth = EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function paintEyeHole(ctx: Ctx, x: number, rx: number, slant: number): void {
  ctx.beginPath();
  ctx.ellipse(
    x,
    FACE_FEATURES.eyeY,
    rx,
    FACE_FEATURES.eyeRy * EYE_HOLE_RY_SHARE,
    slant,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = VOID_INK;
  ctx.fill();
}

function paintFacingSmile(ctx: Ctx): void {
  const half = HEAD_RX * SMILE_HALF_WIDTH;
  const cornerY = HEAD_RY * SMILE_CORNER_Y;
  ctx.beginPath();
  ctx.moveTo(-half, cornerY);
  ctx.quadraticCurveTo(0, HEAD_RY * SMILE_BOTTOM_Y * 2 - cornerY, half, cornerY);
  ctx.quadraticCurveTo(0, HEAD_RY * SMILE_TOP_Y * 2 - cornerY, -half, cornerY);
  ctx.closePath();
  ctx.fillStyle = VOID_INK;
  ctx.fill();
  ctx.strokeStyle = LIP_RED;
  ctx.lineWidth = LIP_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function paintFacing(ctx: Ctx): void {
  paintPorcelain(ctx, facingOutline());
  for (const side of [-1, 1]) {
    paintEyeHole(
      ctx,
      side * FACE_FEATURES.eyeDx,
      FACE_FEATURES.eyeRx * EYE_HOLE_RX_SHARE,
      -side * EYE_HOLE_SLANT,
    );
  }
  paintFacingSmile(ctx);
}

function paintProfile(ctx: Ctx, frame: BipedHeadFrame): void {
  paintHeadStrap(ctx, frame, RIBBON_STRAP);
  paintPorcelain(ctx, scaled(PROFILE_MASK, HEAD_DEPTH, HEAD_RY));
  paintEyeHole(
    ctx,
    FACE_FEATURES.profileEyeX,
    FACE_FEATURES.profileEyeRx * PROFILE_EYE_HOLE_RX_SHARE,
    0,
  );
  ctx.beginPath();
  ctx.moveTo(HEAD_DEPTH * PROFILE_SMILE_FRONT.x, HEAD_RY * PROFILE_SMILE_FRONT.y);
  ctx.quadraticCurveTo(
    HEAD_DEPTH * PROFILE_SMILE_SAG.x,
    HEAD_RY * PROFILE_SMILE_SAG.y,
    HEAD_DEPTH * PROFILE_SMILE_END.x,
    HEAD_RY * PROFILE_SMILE_END.y,
  );
  ctx.strokeStyle = VOID_INK;
  ctx.lineWidth = PROFILE_SMILE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintHead(ctx: Ctx, frame: BipedHeadFrame): void {
  if (frame.view.showsBack) {
    paintHeadStrap(ctx, frame, RIBBON_STRAP);
    return;
  }
  if (frame.view.profile) {
    paintProfile(ctx, frame);
    return;
  }
  withFacePlane(ctx, frame.pose, frame.view, () => paintFacing(ctx));
}

export const HUMAN_GRINNING_MASK = defineGarment({
  id: 'human_grinning_mask',
  name: 'Grinning Mask',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  paint: { head: humanEveryView(paintHead) },
});
