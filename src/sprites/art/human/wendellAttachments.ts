/**
 * Wendell's own clothes and habits, painted on Carl's rig: an architect's
 * waistcoat worn over builder's rolled shirtsleeves, the spectacles of a man
 * who spent his twenties at a drafting table, a carpenter's pencil behind
 * his ear, mud from the pasture on his boots, and the stoop the drafting
 * table left him with.
 *
 * The waistcoat, spectacles and pencil are `CarlAttachments`, painted inside
 * the figure's own composition from the solved skeleton: laid on after the
 * figure is finished (the way `townAccessories.ts` lays its shapes) they sit
 * at fixed figure-space points, and a head that bobs through a walk or turns
 * through a talk leaves its spectacles hanging in the air beside it.
 */

import type { CarlAttachments } from '../carl/figure';
import { headAngle } from '../carl/head';
import { CALF_WIDTH, HEAD_DEPTH, HEAD_RX, HEAD_RY, THIGH_WIDTH } from '../carl/proportions';
import type { CarlPose, CarlView, Skeleton, ViewSpec } from '../carl/rig';
import { torsoFrame, traceGarmentTorso, type TorsoFrame } from '../carl/torso';
import { mix, rgba, type Pt } from '../carlArt';
import { drawShoeMud } from './townAccessories';

type Ctx = CanvasRenderingContext2D;

// ── Waistcoat ────────────────────────────────────────────────────────────────

/** Brown wool gone soft at the edges: darker than the linen by enough to read as a second garment at 32px. */
const WAISTCOAT_COLOR = '#4a3322';
/** The back is a cheaper, greyer lining cloth, as a real waistcoat's is. */
const WAISTCOAT_BACK_COLOR = '#5a5046';
const WAISTCOAT_INK = '#1c140e';
const LIGHT_TOWARD = '#ffffff';
const SHADE_TOWARD = '#100c14';
const WAISTCOAT_LIT_MIX = 0.18;
const WAISTCOAT_SHADE_MIX = 0.35;
/** Brass buttons, the one bright mark down the front. */
const BUTTON_COLOR = '#d8b060';
const BUTTON_RADIUS = 0.011;
const BUTTON_ROWS: readonly number[] = [0.2, 0.28, 0.36];
const WAISTCOAT_EDGE_WIDTH = 0.012;

/**
 * Head-on landmarks in the torso frame's own units: `x` across from the
 * spine, `y` down from the shoulder line (the waist is about 0.43 down).
 * The panels stop short of the shoulder's outer edge so the linen shows at
 * each shoulder cap; the fronts part in a V above the top button, where the
 * shirt shows, and drop to points below the waist.
 */
const PANEL_NECK_X = 0.07;
const PANEL_NECK_Y = -0.03;
const PANEL_STRAP_X = 0.17;
const PANEL_STRAP_Y = 0;
const ARMHOLE_CONTROL_X = 0.16;
const ARMHOLE_CONTROL_Y = 0.13;
/** Past the torso's own half-width, so the clip, not the panel, draws the side seam. */
const PANEL_SIDE_X = 0.4;
const PANEL_SIDE_Y = 0.2;
const V_BOTTOM_X = 0.012;
const V_BOTTOM_Y = 0.17;
const POINT_X = 0.03;
/** How far below the garment's own hem the front points hang. */
const POINT_DROP = 0.06;
const SIDE_HEM_RISE = 0.01;
const WELT_X = 0.11;
const WELT_Y = 0.33;
const WELT_HALF = 0.04;
const WELT_WIDTH = 0.01;
const WELT_ALPHA = 0.8;

/** Seen from behind: a lining panel between the armholes and a strap with its buckle. */
const BACK_ARMHOLE_X = 0.17;
const BACK_TOP_Y = 0.02;
const BACK_STRAP_Y = 0.34;
const BACK_STRAP_HALF = 0.11;
const BACK_STRAP_WIDTH = 0.022;
const BUCKLE_HALF = 0.02;
/** Edge-on the panel starts below the collar, so the shirt still shows at the neck. */
const PROFILE_TOP_Y = 0.03;
const PROFILE_BUTTON_X = 0.22;
const PROFILE_BACK_X = -0.4;
const PROFILE_FRONT_X = 0.45;

function waistcoatFill(ctx: Ctx, base: string, frame: TorsoFrame): void {
  const from = frame.at(-PANEL_SIDE_X, 0);
  const to = frame.at(PANEL_SIDE_X, 0);
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, mix(base, LIGHT_TOWARD, WAISTCOAT_LIT_MIX));
  gradient.addColorStop(1, mix(base, SHADE_TOWARD, WAISTCOAT_SHADE_MIX));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = WAISTCOAT_INK;
  ctx.lineWidth = WAISTCOAT_EDGE_WIDTH;
  ctx.stroke();
}

function paintFrontPanels(ctx: Ctx, skeleton: Skeleton, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  const at = (x: number, y: number): Pt => frame.at(x, y);
  for (const side of [-1, 1]) {
    const neck = at(side * PANEL_NECK_X, PANEL_NECK_Y);
    const strap = at(side * PANEL_STRAP_X, PANEL_STRAP_Y);
    const armholeControl = at(side * ARMHOLE_CONTROL_X, ARMHOLE_CONTROL_Y);
    const sideSeam = at(side * PANEL_SIDE_X, PANEL_SIDE_Y);
    const sideHem = at(side * PANEL_SIDE_X, frame.hemY - SIDE_HEM_RISE);
    const point = at(side * POINT_X, frame.hemY + POINT_DROP);
    const vBottom = at(side * V_BOTTOM_X, V_BOTTOM_Y);
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(strap.x, strap.y);
    ctx.quadraticCurveTo(armholeControl.x, armholeControl.y, sideSeam.x, sideSeam.y);
    ctx.lineTo(sideHem.x, sideHem.y);
    ctx.lineTo(point.x, point.y);
    ctx.lineTo(vBottom.x, vBottom.y);
    ctx.closePath();
    waistcoatFill(ctx, WAISTCOAT_COLOR, frame);
    const weltFrom = at(side * (WELT_X - WELT_HALF), WELT_Y);
    const weltTo = at(side * (WELT_X + WELT_HALF), WELT_Y);
    ctx.strokeStyle = rgba(WAISTCOAT_INK, WELT_ALPHA);
    ctx.lineWidth = WELT_WIDTH;
    ctx.beginPath();
    ctx.moveTo(weltFrom.x, weltFrom.y);
    ctx.lineTo(weltTo.x, weltTo.y);
    ctx.stroke();
  }
  ctx.fillStyle = BUTTON_COLOR;
  for (const y of BUTTON_ROWS) {
    const button = at(0, y);
    ctx.beginPath();
    ctx.arc(button.x, button.y, BUTTON_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBackPanel(ctx: Ctx, skeleton: Skeleton, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  const at = (x: number, y: number): Pt => frame.at(x, y);
  const topLeft = at(-BACK_ARMHOLE_X, BACK_TOP_Y);
  const topRight = at(BACK_ARMHOLE_X, BACK_TOP_Y);
  const leftControl = at(-ARMHOLE_CONTROL_X, ARMHOLE_CONTROL_Y);
  const rightControl = at(ARMHOLE_CONTROL_X, ARMHOLE_CONTROL_Y);
  const leftSeam = at(-PANEL_SIDE_X, PANEL_SIDE_Y);
  const rightSeam = at(PANEL_SIDE_X, PANEL_SIDE_Y);
  const leftHem = at(-PANEL_SIDE_X, frame.hemY);
  const rightHem = at(PANEL_SIDE_X, frame.hemY);
  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.quadraticCurveTo(rightControl.x, rightControl.y, rightSeam.x, rightSeam.y);
  ctx.lineTo(rightHem.x, rightHem.y);
  ctx.lineTo(leftHem.x, leftHem.y);
  ctx.lineTo(leftSeam.x, leftSeam.y);
  ctx.quadraticCurveTo(leftControl.x, leftControl.y, topLeft.x, topLeft.y);
  ctx.closePath();
  waistcoatFill(ctx, WAISTCOAT_BACK_COLOR, frame);
  const strapFrom = at(-BACK_STRAP_HALF, BACK_STRAP_Y);
  const strapTo = at(BACK_STRAP_HALF, BACK_STRAP_Y);
  ctx.strokeStyle = WAISTCOAT_COLOR;
  ctx.lineWidth = BACK_STRAP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(strapFrom.x, strapFrom.y);
  ctx.lineTo(strapTo.x, strapTo.y);
  ctx.stroke();
  const buckle = at(0, BACK_STRAP_Y);
  ctx.strokeStyle = BUTTON_COLOR;
  ctx.lineWidth = WELT_WIDTH;
  ctx.strokeRect(buckle.x - BUCKLE_HALF, buckle.y - BUCKLE_HALF, BUCKLE_HALF * 2, BUCKLE_HALF * 2);
}

function paintProfilePanel(ctx: Ctx, skeleton: Skeleton, pose: CarlPose): void {
  const frame = torsoFrame(skeleton, pose);
  const at = (x: number, y: number): Pt => frame.at(x, y);
  const topBack = at(PROFILE_BACK_X, PROFILE_TOP_Y);
  const topFront = at(PROFILE_FRONT_X, PROFILE_TOP_Y);
  const hemFront = at(PROFILE_FRONT_X, frame.hemY + POINT_DROP);
  const hemBack = at(PROFILE_BACK_X, frame.hemY + POINT_DROP);
  ctx.beginPath();
  ctx.moveTo(topBack.x, topBack.y);
  ctx.lineTo(topFront.x, topFront.y);
  ctx.lineTo(hemFront.x, hemFront.y);
  ctx.lineTo(hemBack.x, hemBack.y);
  ctx.closePath();
  waistcoatFill(ctx, WAISTCOAT_COLOR, frame);
  ctx.fillStyle = BUTTON_COLOR;
  for (const y of BUTTON_ROWS) {
    const button = at(PROFILE_BUTTON_X, y);
    ctx.beginPath();
    ctx.arc(button.x, button.y, BUTTON_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintWaistcoat(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  ctx.save();
  traceGarmentTorso(ctx, skeleton, pose, view);
  ctx.clip();
  if (view.profile) paintProfilePanel(ctx, skeleton, pose);
  else if (view.showsBack) paintBackPanel(ctx, skeleton, pose);
  else paintFrontPanels(ctx, skeleton, pose);
  ctx.restore();
}

// ── Spectacles ───────────────────────────────────────────────────────────────

/**
 * Head-local units, the same the head is painted in: origin at the head's
 * centre, which is the eye line, +Y down, the face toward +X edge-on.
 */
const LENS_DX = HEAD_RX * 0.4;
const LENS_RADIUS = HEAD_RX * 0.23;
/** Slightly under the eye line: spectacles ride on the nose, not on the brow. */
const LENS_Y = HEAD_RY * 0.03;
/** Dark wire rims: at 32px the rim is what reads, not the glass. */
const RIM_COLOR = '#1e1812';
const RIM_WIDTH = 0.014;
const LENS_TINT = 'rgba(214, 232, 240, 0.55)';
const GLINT_COLOR = 'rgba(255, 255, 255, 0.9)';
const GLINT_RADIUS = LENS_RADIUS * 0.45;
/** The glint sits to the key side of each lens, up and left. */
const GLINT_OFFSET = LENS_RADIUS * 0.4;
const TEMPLE_REACH_X = HEAD_RX * 0.97;
const PROFILE_LENS_X = HEAD_DEPTH * 0.78;
const PROFILE_LENS_RX = LENS_RADIUS * 0.45;
/** Edge-on the temple arm runs back to the ear, which sits behind the head's centre. */
const PROFILE_EAR_X = -HEAD_DEPTH * 0.2;
const PROFILE_EAR_Y = HEAD_RY * 0.04;
const BACK_HOOK_TOP_Y = -HEAD_RY * 0.05;
const BACK_HOOK_BOTTOM_Y = HEAD_RY * 0.14;

function paintLens(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = LENS_TINT;
  ctx.fill();
  ctx.strokeStyle = RIM_COLOR;
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  ctx.fillStyle = GLINT_COLOR;
  ctx.beginPath();
  ctx.arc(cx - GLINT_OFFSET * (rx / LENS_RADIUS), cy - GLINT_OFFSET, GLINT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function strokeLine(ctx: Ctx, from: Pt, to: Pt): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function paintSpectacles(ctx: Ctx, view: ViewSpec): void {
  ctx.strokeStyle = RIM_COLOR;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  if (view.showsBack) {
    for (const side of [-1, 1]) {
      strokeLine(
        ctx,
        { x: side * TEMPLE_REACH_X, y: BACK_HOOK_TOP_Y },
        { x: side * TEMPLE_REACH_X, y: BACK_HOOK_BOTTOM_Y },
      );
    }
    return;
  }
  if (view.profile) {
    strokeLine(
      ctx,
      { x: PROFILE_LENS_X - PROFILE_LENS_RX, y: LENS_Y },
      { x: PROFILE_EAR_X, y: PROFILE_EAR_Y },
    );
    paintLens(ctx, PROFILE_LENS_X, LENS_Y, PROFILE_LENS_RX, LENS_RADIUS);
    return;
  }
  for (const side of [-1, 1]) {
    strokeLine(
      ctx,
      { x: side * (LENS_DX + LENS_RADIUS), y: LENS_Y },
      { x: side * TEMPLE_REACH_X, y: LENS_Y },
    );
  }
  ctx.strokeStyle = RIM_COLOR;
  strokeLine(
    ctx,
    { x: -LENS_DX + LENS_RADIUS, y: LENS_Y },
    { x: LENS_DX - LENS_RADIUS, y: LENS_Y },
  );
  for (const side of [-1, 1]) paintLens(ctx, side * LENS_DX, LENS_Y, LENS_RADIUS, LENS_RADIUS);
}

// ── The pencil behind his ear ────────────────────────────────────────────────

/** A carpenter's flat pencil in its ochre paint, sharpened to a graphite point. */
const PENCIL_BODY = '#d0a040';
const PENCIL_POINT = '#3a3430';
const PENCIL_WIDTH = 0.026;
const PENCIL_POINT_SHARE = 0.25;
/**
 * Head-on the pencil pokes out past the side of the head at the ear, tipped
 * back; edge-on it lies along the side of the head above the ear, point
 * forward. Head-local units.
 */
const PENCIL_FACING_FROM: Pt = { x: HEAD_RX * 0.78, y: -HEAD_RY * 0.42 };
const PENCIL_FACING_TO: Pt = { x: HEAD_RX * 1.2, y: HEAD_RY * 0.02 };
const PENCIL_PROFILE_FROM: Pt = { x: -HEAD_DEPTH * 0.62, y: -HEAD_RY * 0.12 };
const PENCIL_PROFILE_TO: Pt = { x: HEAD_DEPTH * 0.12, y: -HEAD_RY * 0.28 };

function paintPencil(ctx: Ctx, view: ViewSpec): void {
  const from = view.profile ? PENCIL_PROFILE_FROM : PENCIL_FACING_FROM;
  const to = view.profile ? PENCIL_PROFILE_TO : PENCIL_FACING_TO;
  // Head-on it is behind his right ear, which the mirrored front view puts
  // on the viewer's left and the back view on the viewer's right.
  const sideSign = view.showsBack || view.profile ? 1 : -1;
  const start = { x: from.x * sideSign, y: from.y };
  const end = { x: to.x * sideSign, y: to.y };
  const pointStart = {
    x: end.x + (start.x - end.x) * PENCIL_POINT_SHARE,
    y: end.y + (start.y - end.y) * PENCIL_POINT_SHARE,
  };
  ctx.lineCap = 'butt';
  ctx.lineWidth = PENCIL_WIDTH;
  ctx.strokeStyle = PENCIL_BODY;
  strokeLine(ctx, start, pointStart);
  ctx.strokeStyle = PENCIL_POINT;
  strokeLine(ctx, pointStart, end);
}

function paintHeadDetails(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(headAngle(pose));
  paintPencil(ctx, view);
  paintSpectacles(ctx, view);
  ctx.restore();
}

// ── Trouser seat ─────────────────────────────────────────────────────────────

/** Worn grey-brown drill, a step lighter and cooler than the waistcoat so the two read as two garments; shared with the look's own trouser colour. */
export const WENDELL_TROUSER_COLOR = '#50483c';
/**
 * The trousers `townAccessories.ts` lays over the finished figure leave a gap
 * between the legs, and a shirt cut stops at the waist, so Carl's boxers show
 * through it. Painting the seat and legs in trouser cloth inside the
 * composition, where the shorts are, closes it.
 */
const SEAT_OUTER_SHARE = 1.2;
const SEAT_CROTCH_DROP = 0.14;
const THIGH_STROKE_SHARE = 2.1;
const SHIN_STROKE_SHARE = 1.9;

function paintTrouserSeat(ctx: Ctx, skeleton: Skeleton): void {
  const { leftLeg, rightLeg, hip } = skeleton;
  const outer = THIGH_WIDTH * SEAT_OUTER_SHARE;
  const leftSign = Math.sign(leftLeg.root.x - hip.x) || -1;
  const rightSign = Math.sign(rightLeg.root.x - hip.x) || 1;
  ctx.fillStyle = WENDELL_TROUSER_COLOR;
  ctx.strokeStyle = WENDELL_TROUSER_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(leftLeg.root.x + leftSign * outer, leftLeg.root.y);
  ctx.lineTo(rightLeg.root.x + rightSign * outer, rightLeg.root.y);
  ctx.lineTo(rightLeg.joint.x, rightLeg.joint.y);
  ctx.lineTo(hip.x, hip.y + SEAT_CROTCH_DROP);
  ctx.lineTo(leftLeg.joint.x, leftLeg.joint.y);
  ctx.closePath();
  ctx.fill();
  for (const leg of [leftLeg, rightLeg]) {
    ctx.lineWidth = THIGH_WIDTH * THIGH_STROKE_SHARE;
    strokeLine(ctx, leg.root, leg.joint);
    ctx.lineWidth = CALF_WIDTH * SHIN_STROKE_SHARE;
    strokeLine(ctx, leg.joint, leg.end);
  }
}

/** How far past the head's own outline the pencil reaches, as a share of its half-width. */
const HEAD_DETAIL_REACH = 1.3;

export const WENDELL_ATTACHMENTS: CarlAttachments = {
  overLegs: (ctx, skeleton) => paintTrouserSeat(ctx, skeleton),
  over: (ctx, skeleton, view, pose) => {
    paintWaistcoat(ctx, skeleton, view, pose);
    paintHeadDetails(ctx, skeleton, view, pose);
  },
  reach: (skeleton) => [
    { x: skeleton.headCentre.x - HEAD_RX * HEAD_DETAIL_REACH, y: skeleton.headCentre.y - HEAD_RY },
    { x: skeleton.headCentre.x + HEAD_RX * HEAD_DETAIL_REACH, y: skeleton.headCentre.y - HEAD_RY },
  ],
};

// ── Posture ──────────────────────────────────────────────────────────────────

/**
 * Years over a drafting table: edge-on the chest and head come forward over
 * the waist; head-on the chest pitches toward the camera and the shoulders
 * round down. Only the spine moves — the feet stay exactly where the row put
 * them, so the walk's foot lock is untouched.
 */
const STOOP_SPINE_BEND = 0.22;
const STOOP_TORSO_PITCH = 0.3;
const STOOP_CHEST_DROP = -0.025;

export function wendellPosture(pose: CarlPose, view: CarlView): CarlPose {
  if (view === 'side') return { ...pose, spineBend: (pose.spineBend ?? 0) + STOOP_SPINE_BEND };
  return {
    ...pose,
    torsoPitch: (pose.torsoPitch ?? 0) + STOOP_TORSO_PITCH,
    chestRise: (pose.chestRise ?? 0) + STOOP_CHEST_DROP,
  };
}

/** Pasture mud, drawn over the boots once they are painted. */
export function wendellBootMud(ctx: Ctx, _view: CarlView, pose: CarlPose): void {
  drawShoeMud(ctx, pose);
}
