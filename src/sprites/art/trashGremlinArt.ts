/**
 * The Trash Gremlin's painter: one draw per view over one shared pose.
 *
 * The anatomy, the gear and the rig are split by concern under
 * `trashGremlin/` — proportions, palette, the rig and its projection, the paint
 * primitives, the body, the head, and what it carries. This module owns only
 * the draw order of each view, which is where depth is decided: what is behind
 * the body, what is in front of it, and which parts share a silhouette.
 *
 * Coordinates are figure units — tiles at the figure's own scale — with the
 * origin on the ground between the feet; the figure module scales and places
 * that in the cell. Knows nothing about animation.
 */

import { type Pt, rgba } from './carlArt';
import {
  armForms,
  footForms,
  handForms,
  legForms,
  neckForm,
  paintFootClaws,
  paintHandClaws,
  tailForm,
  torsoForms,
} from './trashGremlin/body';
import {
  canDepth,
  canForms,
  lidForm,
  lidHandleForm,
  paintCanString,
  paintStraps,
  sackForms,
} from './trashGremlin/gear';
import {
  EYE_ACROSS,
  EYE_DEPTH,
  EYE_UP,
  PROFILE_EYE,
  crownForms,
  earForm,
  headForm,
  headFrame,
  headPoint,
  paintSac,
  paintSacHalo,
  paintSpray,
} from './trashGremlin/head';
import { CONTACT_SHADOW, HIDE, HIDE_FAR, HIDE_LEG } from './trashGremlin/palette';
import { type Ctx, type Form, type Lighting, paintSlab, traceEllipse } from './trashGremlin/paint';
import {
  type GremlinPose,
  type GremlinView,
  type Skeleton,
  buildSkeleton,
  nearness,
  project,
  pt,
  v3,
} from './trashGremlin/rig';

export type { GremlinPose, GremlinView, V3 } from './trashGremlin/rig';
export {
  ARM_REACH,
  EAR_REST_LIFT,
  LEG_REACH,
  armReachDemand,
  buildSkeleton,
  legReachDemand,
  restingPose,
  v3,
} from './trashGremlin/rig';
export { torsoOutlineCurvature } from './trashGremlin/body';

const SHADOW_RX = 0.5;
const SHADOW_RY = 0.13;
const SHADOW_ALPHA = 0.32;

function paintContactShadow(ctx: Ctx, sk: Skeleton, view: GremlinView): void {
  const under = project(v3(sk.pelvis.x, 0, sk.pelvis.z), view);
  ctx.fillStyle = rgba(CONTACT_SHADOW, SHADOW_ALPHA);
  ctx.beginPath();
  traceEllipse(pt(under.x, 0), SHADOW_RX, SHADOW_RY)(ctx);
  ctx.fill();
}

const LEFT = -1;
const RIGHT = 1;
/**
 * Which way each thumb points across the hand, as the hand is seen: a thumb is
 * on the inside of the hand, so the two hands' thumbs face each other head-on.
 */
const LEFT_THUMB = 1;
const RIGHT_THUMB = -1;

function legSlab(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
  side: number,
  lighting: Lighting,
): void {
  const leg = side === LEFT ? sk.leftLeg : sk.rightLeg;
  const foot = side === LEFT ? pose.leftFoot : pose.rightFoot;
  const pitch = side === LEFT ? pose.leftFootPitch : pose.rightFootPitch;
  const ramp = view === 'side' && side === LEFT ? HIDE_FAR : HIDE_LEG;
  const feetFirst = view === 'back';
  const legParts = legForms(leg, view, ramp);
  const footParts = footForms(foot, pitch, side, view, ramp);
  paintSlab(ctx, feetFirst ? [...footParts, ...legParts] : [...legParts, ...footParts], lighting);
  paintFootClaws(ctx, foot, pitch, side, view);
}

function armSlab(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
  side: number,
  lighting: Lighting,
): void {
  const arm = side === LEFT ? sk.leftArm : sk.rightArm;
  const fist = side === LEFT ? pose.leftFist : pose.rightFist;
  const thumb = (side === LEFT ? LEFT_THUMB : RIGHT_THUMB) * (view === 'front' ? -1 : 1);
  const ramp = view === 'side' && side === LEFT ? HIDE_FAR : HIDE;
  paintSlab(
    ctx,
    [...armForms(arm, view, ramp), ...handForms(arm, fist, thumb, view, ramp)],
    lighting,
  );
  paintHandClaws(ctx, arm, fist, thumb, view);
}

function headSlab(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
  lighting: Lighting,
): void {
  const frame = headFrame(sk, view);
  const lit = lighting === 'lit';
  const head = headForm(sk, pose, view, lit);
  if (view === 'side') {
    const far = earForm(frame, LEFT, pose.leftEar, false, HIDE_FAR);
    const near = earForm(frame, RIGHT, pose.rightEar, true, HIDE);
    paintSlab(ctx, [far, head], lighting);
    paintSlab(ctx, [near], lighting);
  } else {
    const ears = [
      earForm(frame, LEFT, pose.leftEar, true, HIDE),
      earForm(frame, RIGHT, pose.rightEar, true, HIDE),
    ];
    paintSlab(ctx, [...ears, head], lighting);
  }
  paintSlab(ctx, crownForms(frame), lighting);
}

function sacAndSpray(ctx: Ctx, sk: Skeleton, pose: GremlinPose, view: GremlinView): void {
  if (view === 'back') return;
  const frame = headFrame(sk, view);
  paintSacHalo(ctx, frame, pose);
  paintSac(ctx, frame, pose);
  paintSpray(ctx, frame, pose);
}

function gearBehind(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
  lighting: Lighting,
): void {
  paintCanString(ctx, sk, pose, view);
  paintSlab(ctx, canForms(sk, pose, view), lighting);
  paintSlab(ctx, sackForms(sk, pose, view), lighting);
  paintSlab(ctx, [lidForm(sk, pose, view)], lighting);
}

function lidWithHandle(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form[] {
  const handle = lidHandleForm(sk, pose, view);
  return handle === null ? [lidForm(sk, pose, view)] : [lidForm(sk, pose, view), handle];
}

function drawFront(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  lighting: Lighting,
  options: ViewOptions,
): void {
  if (options.tail) paintSlab(ctx, [tailForm(sk, pose, 'front', HIDE)], lighting);
  gearBehind(ctx, sk, pose, 'front', lighting);
  const legOrder =
    nearness(sk.leftLeg.end, 'front') <= nearness(sk.rightLeg.end, 'front')
      ? [LEFT, RIGHT]
      : [RIGHT, LEFT];
  for (const side of legOrder) legSlab(ctx, sk, pose, 'front', side, lighting);
  paintSlab(ctx, [neckForm(sk, 'front'), ...torsoForms(sk, pose, 'front')], lighting);
  paintStraps(ctx, sk, pose, 'front');
  for (const side of [LEFT, RIGHT]) armSlab(ctx, sk, pose, 'front', side, lighting);
  headSlab(ctx, sk, pose, 'front', lighting);
  sacAndSpray(ctx, sk, pose, 'front');
}

function drawBack(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  lighting: Lighting,
  options: ViewOptions,
): void {
  headSlab(ctx, sk, pose, 'back', lighting);
  for (const side of [LEFT, RIGHT]) armSlab(ctx, sk, pose, 'back', side, lighting);
  const legOrder =
    nearness(sk.leftLeg.end, 'back') <= nearness(sk.rightLeg.end, 'back')
      ? [LEFT, RIGHT]
      : [RIGHT, LEFT];
  for (const side of legOrder) legSlab(ctx, sk, pose, 'back', side, lighting);
  paintSlab(ctx, [neckForm(sk, 'back'), ...torsoForms(sk, pose, 'back')], lighting);
  if (options.tail) paintSlab(ctx, [tailForm(sk, pose, 'back', HIDE)], lighting);
  paintStraps(ctx, sk, pose, 'back');
  paintSlab(ctx, sackForms(sk, pose, 'back'), lighting);
  paintCanString(ctx, sk, pose, 'back');
  paintSlab(ctx, canForms(sk, pose, 'back'), lighting);
  paintSlab(ctx, lidWithHandle(sk, pose, 'back'), lighting);
}

function drawSide(
  ctx: Ctx,
  sk: Skeleton,
  pose: GremlinPose,
  lighting: Lighting,
  options: ViewOptions,
): void {
  armSlab(ctx, sk, pose, 'side', LEFT, lighting);
  legSlab(ctx, sk, pose, 'side', LEFT, lighting);
  if (options.tail) paintSlab(ctx, [tailForm(sk, pose, 'side', HIDE)], lighting);
  paintSlab(ctx, [neckForm(sk, 'side'), ...torsoForms(sk, pose, 'side')], lighting);
  paintSlab(ctx, sackForms(sk, pose, 'side'), lighting);
  const cansNear = canDepth(sk, pose, 'side') > nearness(sk.pelvis, 'side');
  if (!cansNear) {
    paintCanString(ctx, sk, pose, 'side');
    paintSlab(ctx, canForms(sk, pose, 'side'), lighting);
  }
  paintSlab(ctx, lidWithHandle(sk, pose, 'side'), lighting);
  paintStraps(ctx, sk, pose, 'side');
  legSlab(ctx, sk, pose, 'side', RIGHT, lighting);
  if (cansNear) {
    paintCanString(ctx, sk, pose, 'side');
    paintSlab(ctx, canForms(sk, pose, 'side'), lighting);
  }
  armSlab(ctx, sk, pose, 'side', RIGHT, lighting);
  headSlab(ctx, sk, pose, 'side', lighting);
  sacAndSpray(ctx, sk, pose, 'side');
}

/** What a view paints beyond the body itself. */
export interface ViewOptions {
  /**
   * Whether the tail is drawn. Always, in the game; an art gate measuring where
   * the soles meet the floor paints it without, because from behind the tail
   * lies on the floor nearer the camera than the feet.
   */
  readonly tail: boolean;
}

const FULL_FIGURE: ViewOptions = { tail: true };

/** Paints the whole figure in one view, origin on the ground between its feet. */
export function drawTrashGremlinView(
  ctx: Ctx,
  view: GremlinView,
  pose: GremlinPose,
  options: ViewOptions = FULL_FIGURE,
): void {
  const sk = buildSkeleton(pose);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'source-over';
  paintContactShadow(ctx, sk, view);
  if (view === 'front') drawFront(ctx, sk, pose, 'lit', options);
  else if (view === 'back') drawBack(ctx, sk, pose, 'lit', options);
  else drawSide(ctx, sk, pose, 'lit', options);
  ctx.restore();
}

/**
 * Where the two eyes are on this pose, in figure units: the eye-shine the dark
 * shows of it is placed from the same head the painter draws.
 */
export function eyeCentres(pose: GremlinPose, view: GremlinView): { left: Pt; right: Pt } {
  const frame = headFrame(buildSkeleton(pose), view);
  if (view === 'side') {
    const eye = headPoint(frame, 0, PROFILE_EYE.y, PROFILE_EYE.x);
    return { left: eye, right: eye };
  }
  return {
    left: headPoint(frame, -EYE_ACROSS, EYE_UP, EYE_DEPTH),
    right: headPoint(frame, EYE_ACROSS, EYE_UP, EYE_DEPTH),
  };
}
