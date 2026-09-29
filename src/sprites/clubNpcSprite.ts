/**
 * Canvas-drawn figure for the Desperado Club's DJ.
 *
 * Doctor Bones is the one club figure left on this humanoid: he is a fixture
 * at his decks rather than a citizen, and giving a skeleton his own painted
 * rig for one pose is not worth the closed-set figure-cast machinery the
 * dancers, patrons and station staff now use instead
 * (`src/sprites/art/skyfowl/`, `src/sprites/art/townCastFigure.ts`).
 */

import { scaleHumanoidBox } from './humanoidScale';

const TWO_PI = Math.PI * 2;

/** A single frame of limb placement, all offsets as fractions of the figure size `s`. */
interface Pose {
  bounce: number;
  hipShift: number;
  lean: number;
  leftArmRaise: number;
  rightArmRaise: number;
  leftArmOut: number;
  rightArmOut: number;
  leftLegLift: number;
  rightLegLift: number;
  headTilt: number;
}

/** DJ leans over the decks, both hands low and working, head nodding. */
function djPose(phase: number): Pose {
  const t = phase * 0.12;
  return {
    bounce: Math.abs(Math.sin(t)) * 0.03,
    hipShift: 0,
    lean: 0,
    leftArmRaise: -0.2 + Math.sin(t) * 0.2,
    rightArmRaise: -0.2 + Math.sin(t + Math.PI) * 0.2,
    leftArmOut: 0.85,
    rightArmOut: 0.85,
    leftLegLift: 0,
    rightLegLift: 0,
    headTilt: Math.sin(t) * 0.05,
  };
}

/** The club's animation clock ticks once per 60 Hz frame; figures timed in seconds divide by this. */
export const CLUB_ANIM_FRAMES_PER_SECOND = 60;

const DJ_SKIN = '#e8e6de';
const DJ_OUTFIT = '#2a1a3a';
const DJ_ACCENT = '#e0407a';

/**
 * Draws the DJ standing at (sx, sy) sized to `s` pixels. `phase` advances the
 * animation clock.
 */
export function drawClubNpc(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phase: number,
): void {
  ctx.save();
  const box = scaleHumanoidBox(sx, sy, s);
  const cx = box.sx + box.s * 0.5;
  drawSkeletonHumanoid(ctx, cx, box.sy, box.s, djPose(phase));
  ctx.restore();
}

/** Pose-driven humanoid: torso + swinging arms + head, skeleton-coloured. Reads as motion because every limb tracks the pose. */
function drawSkeletonHumanoid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  sy: number,
  s: number,
  pose: Pose,
): void {
  const bsy = sy - pose.bounce * s;
  const hipX = cx + pose.hipShift * s;
  const shoulderCX = cx + (pose.hipShift + pose.lean) * s;

  const hipY = bsy + s * 0.62;
  const shoulderY = bsy + s * 0.4;
  const legLen = s * 0.24;
  const legW = s * 0.12;

  const drawLeg = (dir: number, lift: number): void => {
    const footX = hipX + dir * s * 0.09;
    const footY = hipY + legLen - lift * s * 0.14;
    ctx.strokeStyle = '#141018';
    ctx.lineWidth = legW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(footX, hipY);
    ctx.lineTo(footX + dir * lift * s * 0.05, footY);
    ctx.stroke();
  };
  drawLeg(-1, pose.leftLegLift);
  drawLeg(1, pose.rightLegLift);

  const torsoW = s * 0.32;
  const torsoTopX = shoulderCX - torsoW / 2;
  ctx.fillStyle = DJ_OUTFIT;
  ctx.beginPath();
  ctx.moveTo(torsoTopX, shoulderY);
  ctx.lineTo(torsoTopX + torsoW, shoulderY);
  ctx.lineTo(hipX + torsoW * 0.42, hipY);
  ctx.lineTo(hipX - torsoW * 0.42, hipY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = DJ_ACCENT;
  ctx.fillRect(shoulderCX - s * 0.02, shoulderY, s * 0.04, hipY - shoulderY);

  const armLen = s * 0.28;
  const drawArm = (dir: number, raise: number, out: number): void => {
    const shX = shoulderCX + dir * torsoW * 0.5;
    const handX = shX + dir * armLen * out;
    const handY = shoulderY + armLen * (0.9 - raise * 1.7);
    ctx.strokeStyle = DJ_OUTFIT;
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shX, shoulderY + s * 0.02);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = DJ_SKIN;
    ctx.beginPath();
    ctx.arc(handX, handY, s * 0.055, 0, TWO_PI);
    ctx.fill();
  };
  drawArm(-1, pose.leftArmRaise, pose.leftArmOut);
  drawArm(1, pose.rightArmRaise, pose.rightArmOut);

  const headCX = shoulderCX + pose.headTilt * s;
  const headCY = bsy + s * 0.26;
  const headR = s * 0.13;
  ctx.fillStyle = DJ_SKIN;
  ctx.beginPath();
  ctx.arc(headCX, headCY - s * 0.02, headR * 1.12, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = DJ_SKIN;
  ctx.beginPath();
  ctx.arc(headCX, headCY + s * 0.02, headR, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(headCX - s * 0.05, headCY, s * 0.035, 0, TWO_PI);
  ctx.arc(headCX + s * 0.05, headCY, s * 0.035, 0, TWO_PI);
  ctx.fill();
}
