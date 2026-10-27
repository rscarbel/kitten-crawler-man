/**
 * Angel, an exotic dancer, and her pole: one solved frame painted in figure
 * units with the pole's base on the stage floor at the origin.
 *
 * She is painted from a pose solved as a small 3D skeleton (`skeleton.ts`) and
 * projected into one of three views: head-on, from behind, or in profile.
 * Everything here works in figure units — two tiles to the unit — with the
 * floor at `FOOT_Y`; see `proportions.ts`.
 */

import { fillSoftEllipse } from '../softShade';
import { drawArm, drawGripOverPole } from './arms';
import { drawBackCurtain, drawBackHair, drawFaceLocks, drawHead } from './head';
import {
  drawContactShadows,
  drawLegFrontBack,
  drawLegSide,
  HEAD_ON_SILHOUETTE_SHADE,
  PROFILE_SILHOUETTE_SHADE,
  type LimbPaint,
} from './legs';
import { shadeSilhouette, traceSmooth, type Ctx, type FigureBox } from './paint';
import {
  drawAngelProfileBody,
  drawAngelProfileDetails,
  drawAngelProfileHair,
  drawAngelProfileHead,
  HAIR_OVER_FACE_SWING,
  profileHeadPlacement,
  type ProfileHeadPlacement,
} from './profile';
import { FIGURE_SCALE, FOOT_Y, NECK_TOP_Y, SHOULDER_Y } from './proportions';
import { paintDancePole } from '../dancePole/dancePole';
import { SIDES, project, type AngelSkeleton, type BodySide } from './skeleton';
import { onTorsoAt, torsoWarp, drawTorso, drawTorsoDetails } from './torso';
import type { AngelFrame } from './dance/pose';

/**
 * The figure-unit box her torso and legs stay inside in each view, which sizes
 * the scratch surface their silhouette is shaded on.
 */
const TORSO_HALF_SPAN = 0.12;
/** Past any joint, the widest a leg's flesh or a foot reaches. */
const LIMB_REACH = 0.07;
const HEAD_ON_FOOT_DROP = 0.07;
/** A bend from the hips can carry the torso's top below the neck's rest height. */
const TORSO_BOX_HEADROOM = 0.06;

function bodyBox(skeleton: AngelSkeleton, view: AngelFrame['view']): FigureBox {
  let left = -TORSO_HALF_SPAN;
  let right = TORSO_HALF_SPAN;
  let top = NECK_TOP_Y - TORSO_BOX_HEADROOM;
  for (const side of SIDES) {
    const leg = skeleton.legs[side];
    for (const joint of [leg.hip, leg.knee, leg.ankle, leg.heel, leg.toe]) {
      const p = project(view, joint);
      left = Math.min(left, p.x - LIMB_REACH);
      right = Math.max(right, p.x + LIMB_REACH);
      top = Math.min(top, p.y - LIMB_REACH);
    }
    const shoulder = project(view, skeleton.arms[side].shoulder);
    left = Math.min(left, shoulder.x - TORSO_HALF_SPAN);
    right = Math.max(right, shoulder.x + TORSO_HALF_SPAN);
    top = Math.min(top, shoulder.y - TORSO_HALF_SPAN);
  }
  return { left, top, right, bottom: FOOT_Y + HEAD_ON_FOOT_DROP };
}

/** The head rides the chest and turns on its own about the base of the neck. */
function withHeadFrame(ctx: Ctx, paint: () => void, roll: number): void {
  ctx.save();
  ctx.translate(0, NECK_TOP_Y);
  ctx.rotate(roll);
  ctx.translate(0, -NECK_TOP_Y);
  paint();
  ctx.restore();
}

/**
 * Looking back over her shoulder from behind: the head turns most of the way
 * round on the neck, so it is drawn as her profile on the neck of the back
 * view. She looks back over her left shoulder — screen left from behind, the
 * side away from the pole, which would otherwise stand across her face.
 */
const LOOK_BACK_THRESHOLD = 0.5;
const LOOK_BACK_SHOULDER_SHIFT = 0.028;

function drawLookingBack(ctx: Ctx, skeleton: AngelSkeleton): void {
  const warp = torsoWarp(skeleton);
  const neck = warp.map(0, NECK_TOP_Y);
  // Turned over her shoulder the face clears the shoulder's own outline, so
  // its profile edge shows against what is behind her, not against her skin.
  const placement: ProfileHeadPlacement = {
    neck: { x: LOOK_BACK_SHOULDER_SHIFT, y: neck.y },
    tilt: skeleton.headPitch,
  };
  ctx.save();
  ctx.translate(neck.x, 0);
  ctx.scale(-1, 1);
  drawAngelProfileHair(ctx, placement, {
    trail: skeleton.hairTrail,
    lift: skeleton.hairLift,
    swing: skeleton.hairSwing,
  });
  drawAngelProfileHead(ctx, placement);
  ctx.restore();
}

function drawHeadOn(ctx: Ctx, skeleton: AngelSkeleton, back: boolean, lp: LimbPaint): void {
  const view = back ? 'back' : 'front';
  const warp = torsoWarp(skeleton);
  const onChest = (paint: () => void): void => {
    ctx.save();
    onTorsoAt(ctx, warp, SHOULDER_Y);
    paint();
    ctx.restore();
  };
  const lookingBack = back && skeleton.lookBack > LOOK_BACK_THRESHOLD;

  if (!back) onChest(() => drawBackHair(ctx, skeleton.hairSway));

  // The leg nearer the camera is drawn last.
  const nearness = (side: BodySide): number => (back ? -1 : 1) * skeleton.legs[side].knee.z;
  const order: BodySide[] = nearness(-1) <= nearness(1) ? [-1, 1] : [1, -1];
  const legOutlines = order.map((side, i) => ({
    side,
    outline: drawLegFrontBack(lp, side, skeleton.legs[side], i === 0),
  }));
  const torsoPaint = { ctx, back };
  const torsoTrace = drawTorso(torsoPaint, warp);
  shadeSilhouette(
    ctx,
    bodyBox(skeleton, view),
    [
      torsoTrace,
      ...legOutlines.flatMap(({ outline }) =>
        outline.map((shape) => (target: Ctx) => traceSmooth(target, shape, true)),
      ),
    ],
    HEAD_ON_SILHOUETTE_SHADE,
  );
  drawTorsoDetails(torsoPaint, warp);

  for (const side of SIDES) drawArm(lp, side, skeleton.arms[side], false);

  if (lookingBack) {
    drawLookingBack(ctx, skeleton);
    return;
  }
  onChest(() => {
    withHeadFrame(
      ctx,
      () => {
        if (back) {
          drawBackCurtain(ctx, skeleton.hairSway, skeleton.hairLift);
        }
        drawHead(ctx, back);
        if (!back) drawFaceLocks(ctx, skeleton.hairSway, skeleton.hairLift);
      },
      skeleton.headRoll,
    );
  });
}

function drawInProfile(ctx: Ctx, skeleton: AngelSkeleton, lp: LimbPaint): void {
  // Drawn as her right side: her left limbs are the far ones.
  const far: BodySide = -1;
  const near: BodySide = 1;
  const placement = profileHeadPlacement(skeleton);
  const hair = {
    trail: skeleton.hairTrail,
    lift: skeleton.hairLift,
    swing: skeleton.hairSwing,
  };
  const hairOverFace = skeleton.hairSwing < HAIR_OVER_FACE_SWING;
  // Both legs go under the torso, so the seat overhangs the back of the near
  // thigh and the groin closes over its front, the way they do on a body.
  drawArm(lp, far, skeleton.arms[far], true);
  const farLeg = drawLegSide(lp, far, skeleton.legs[far], true);
  const nearLeg = drawLegSide(lp, near, skeleton.legs[near], false);
  const torsoTrace = drawAngelProfileBody(ctx, skeleton);
  shadeSilhouette(
    ctx,
    bodyBox(skeleton, 'side'),
    [
      torsoTrace,
      ...[farLeg, nearLeg].map((outline) => (target: Ctx) => traceSmooth(target, outline, true)),
    ],
    PROFILE_SILHOUETTE_SHADE,
  );
  drawAngelProfileDetails(ctx, skeleton);
  if (!hairOverFace) drawAngelProfileHair(ctx, placement, hair);
  drawArm(lp, near, skeleton.arms[near], false);
  drawAngelProfileHead(ctx, placement);
  if (hairOverFace) drawAngelProfileHair(ctx, placement, hair);
}

const AIRBORNE_SHADOW_RADIUS_X = 0.08;
const AIRBORNE_SHADOW_RADIUS_Y = 0.022;
const AIRBORNE_SHADOW_COLOR = '#0a0d14';
const AIRBORNE_SHADOW_ALPHA = 0.3;

/** Figure height in device pixels below which the finest modelling is under a pixel. */
const FINE_MODELLING_MIN_FIGURE_HEIGHT_PX = 140;

/** Her drawn height in device pixels, read off the destination transform's scale. */
function figureHeightPx(ctx: Ctx): number {
  const transform = ctx.getTransform();
  return Math.hypot(transform.c, transform.d) * (FOOT_Y - NECK_TOP_Y) * FIGURE_SCALE;
}

function drawBody(ctx: Ctx, frame: AngelFrame, lp: LimbPaint): void {
  const { skeleton } = frame;
  if (frame.view === 'side') drawInProfile(ctx, skeleton, lp);
  else drawHeadOn(ctx, skeleton, frame.view === 'back', lp);
}

function drawGrips(frame: AngelFrame, lp: LimbPaint): void {
  for (const side of SIDES) {
    const far = frame.view === 'side' && side < 0;
    drawGripOverPole(lp, frame.skeleton.arms[side], far);
  }
}

/**
 * The shared stage pole, painted into her cell: she walks and spins behind it
 * as well as in front of it, so it is drawn over her or under her in depth
 * order, never by the stage behind her.
 */
function drawPole(ctx: Ctx): void {
  ctx.save();
  ctx.translate(0, FOOT_Y);
  ctx.scale(1 / FIGURE_SCALE, 1 / FIGURE_SCALE);
  paintDancePole(ctx, POLE_BASE);
  ctx.restore();
}

const POLE_BASE = { x: 0, y: 0 };

/**
 * Paint one frame: her contact shadows, then her and the pole in depth order. Coordinates are figure units, the pole's base at
 * `(0, FOOT_Y)`.
 */
export function drawAngel(ctx: Ctx, frame: AngelFrame): void {
  const fineModelling = figureHeightPx(ctx) >= FINE_MODELLING_MIN_FIGURE_HEIGHT_PX;
  ctx.save();
  ctx.translate(frame.root.x, frame.root.y);
  if (frame.flip) ctx.scale(-1, 1);
  drawContactShadows(ctx, frame.view, frame.skeleton.legs);
  if (frame.airborne) {
    // Off the floor her feet cast no contact shadow, so her body's own shadow
    // on the stage under her is what shows how high she is.
    fillSoftEllipse(
      ctx,
      0,
      FOOT_Y,
      AIRBORNE_SHADOW_RADIUS_X,
      AIRBORNE_SHADOW_RADIUS_Y,
      AIRBORNE_SHADOW_COLOR,
      AIRBORNE_SHADOW_ALPHA,
    );
  }
  ctx.restore();

  if (!frame.poleInFront) drawPole(ctx);
  ctx.save();
  ctx.translate(frame.root.x, frame.root.y);
  if (frame.flip) ctx.scale(-1, 1);
  const lp: LimbPaint = { ctx, view: frame.view, fineModelling };
  drawBody(ctx, frame, lp);
  ctx.restore();

  if (frame.poleInFront) {
    drawPole(ctx);
    ctx.save();
    ctx.translate(frame.root.x, frame.root.y);
    if (frame.flip) ctx.scale(-1, 1);
    drawGrips(frame, lp);
    ctx.restore();
  }
}
