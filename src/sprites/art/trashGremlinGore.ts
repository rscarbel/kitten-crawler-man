/**
 * The six pieces the Trash Gremlin comes apart into: its crowned head, the torn
 * ear, the bin lid off its back, a long arm with its big hand, a bowed leg with
 * its three-toed foot, and the tail.
 *
 * Each is painted with the same part painters as the living figure, so a piece
 * is recognisably the part it came off, then shaded from its own edge inward
 * rather than from a key light: a piece spins once it is thrown, and any single
 * light direction is wrong most of the time. The cut face comes from
 * `goreWound.ts`, shared with every other dismembered thing in the game.
 *
 * Shapes are chosen for silhouette first: six cells tumbling past at 16 px must
 * not read as six lumps. A wide eared head, a narrow ragged leaf, a disc, a long
 * stick ending in a splayed hand, a bent stick ending in a claw-toed foot, and a
 * thin curl.
 *
 * All drawing is in figure units with the origin at the centre of the piece's
 * own cell.
 */

import { type Pt, deg } from './bipedArt';
import { drawWound } from './goreWound';
import {
  armForms,
  footForms,
  handForms,
  legForms,
  paintFootClaws,
  paintHandClaws,
  taperedPathForm,
} from './trashGremlin/body';
import { lidForm, lidFrame, lidHandleForm } from './trashGremlin/gear';
import { crownForms, earForm, headForm, headFrame } from './trashGremlin/head';
import { HIDE } from './trashGremlin/palette';
import { type Ctx, paintSlab } from './trashGremlin/paint';
import { TAIL_ROOT_RADIUS, TAIL_TIP_RADIUS } from './trashGremlin/proportions';
import { type Chain, buildSkeleton, project, pt, restingPose, v3 } from './trashGremlin/rig';

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const WOUND_HIDE = HIDE.deep;

function piece(state: string, paint: (ctx: Ctx) => void): GorePiece {
  return { state, paint };
}

/** A pose for the head: slack-jawed, eyes shut, the sac emptied. */
function deadPose(): ReturnType<typeof restingPose> {
  const pose = restingPose();
  pose.jaw = DEAD_JAW;
  pose.blink = 1;
  pose.scowl = 0;
  pose.sac = 0;
  pose.sacGlow = 0;
  pose.rightEar = { lift: DEAD_EAR_DROOP, fold: DEAD_EAR_FOLD };
  return pose;
}

const DEAD_JAW = 0.45;
const DEAD_EAR_DROOP = -0.25;
const DEAD_EAR_FOLD = 0.15;

// ── Head ─────────────────────────────────────────────────────────────────────

const HEAD_NECK_WOUND_BELOW = 0.27;
const HEAD_NECK_WOUND_RADIUS = 0.1;
const HEAD_EAR_WOUND_ACROSS = 0.35;
const HEAD_EAR_WOUND_RADIUS = 0.07;
const HEAD_SEED = 3.1;

function headPiece(ctx: Ctx): void {
  const pose = deadPose();
  const sk = buildSkeleton(pose);
  const frame = headFrame(sk, 'front');
  ctx.save();
  ctx.translate(-frame.c.x, -frame.c.y);
  const right = earForm(frame, 1, pose.rightEar, true, HIDE);
  paintSlab(ctx, [right, headForm(sk, pose, 'front', false)], 'ambient');
  paintSlab(ctx, crownForms(frame), 'ambient');
  drawWound(ctx, {
    kind: 'torn',
    centre: pt(frame.c.x + HEAD_EAR_WOUND_ACROSS, frame.c.y),
    radius: HEAD_EAR_WOUND_RADIUS,
    squash: 0.6,
    angle: deg(90),
    bones: [],
    runAngle: deg(60),
    seed: HEAD_SEED,
    hide: WOUND_HIDE,
  });
  drawWound(ctx, {
    kind: 'torn',
    centre: pt(frame.c.x, frame.c.y + HEAD_NECK_WOUND_BELOW),
    radius: HEAD_NECK_WOUND_RADIUS,
    squash: 0.5,
    angle: 0,
    bones: [{ at: pt(0, 0), size: 0.35, hollow: true }],
    runAngle: deg(90),
    seed: HEAD_SEED + 1,
    hide: WOUND_HIDE,
  });
  ctx.restore();
}

// ── Ear ──────────────────────────────────────────────────────────────────────

const EAR_PIECE_TURN = deg(-25);
/**
 * Drawn a size up from the ear it came off: tumbling at half size the ear alone
 * is an 8 px sliver, and the torn ear is the one piece only this creature has.
 */
const EAR_PIECE_SCALE = 1.35;
const EAR_ROOT_WOUND_RADIUS = 0.07;
const EAR_HALF_SPAN = 0.37;
const EAR_SEED = 5.3;

function earPiece(ctx: Ctx): void {
  const pose = deadPose();
  const sk = buildSkeleton(pose);
  const frame = headFrame(sk, 'back');
  const ear = earForm(frame, -1, { lift: 0, fold: 0 }, true, HIDE);
  ctx.save();
  ctx.rotate(EAR_PIECE_TURN);
  ctx.scale(EAR_PIECE_SCALE, EAR_PIECE_SCALE);
  ctx.translate(-frame.c.x + EAR_HALF_SPAN + EAR_ROOT_OFFSET, -frame.c.y);
  paintSlab(ctx, [ear], 'ambient');
  drawWound(ctx, {
    kind: 'torn',
    centre: pt(frame.c.x - EAR_ROOT_OFFSET, frame.c.y),
    radius: EAR_ROOT_WOUND_RADIUS,
    squash: 0.55,
    angle: deg(90),
    bones: [],
    runAngle: deg(180),
    seed: EAR_SEED,
    hide: WOUND_HIDE,
  });
  ctx.restore();
}

const EAR_ROOT_OFFSET = 0.33;

// ── Lid ──────────────────────────────────────────────────────────────────────

const LID_PIECE_TURN = deg(18);

function lidPiece(ctx: Ctx): void {
  const pose = restingPose();
  const sk = buildSkeleton(pose);
  const lid = lidFrame(sk, pose);
  const centre = project(lid.centre, 'back');
  const handle = lidHandleForm(sk, pose, 'back');
  ctx.save();
  ctx.rotate(LID_PIECE_TURN);
  ctx.translate(-centre.x, -centre.y);
  paintSlab(
    ctx,
    handle === null ? [lidForm(sk, pose, 'back')] : [lidForm(sk, pose, 'back'), handle],
    'ambient',
  );
  ctx.restore();
}

// ── Arm ──────────────────────────────────────────────────────────────────────

/**
 * Folded hard at the elbow, the big hand splayed upward: a V no other piece
 * makes. Laid out flat in the back view's plane, where the projection is the
 * identity.
 */
const ARM_CHAIN: Chain = {
  root: v3(-0.42, -0.28, 0),
  joint: v3(0.02, 0.2, 0),
  end: v3(0.3, -0.22, 0),
};
const ARM_SEED = 7.7;
const ARM_WOUND_RADIUS = 0.065;

function armPiece(ctx: Ctx): void {
  paintSlab(
    ctx,
    [...armForms(ARM_CHAIN, 'back', HIDE), ...handForms(ARM_CHAIN, 0.1, 1, 'back', HIDE)],
    'ambient',
  );
  paintHandClaws(ctx, ARM_CHAIN, 0.1, 1, 'back');
  drawWound(ctx, {
    kind: 'torn',
    centre: pt(ARM_CHAIN.root.x, ARM_CHAIN.root.y),
    radius: ARM_WOUND_RADIUS,
    squash: 0.55,
    angle: deg(20),
    bones: [{ at: pt(0, 0), size: 0.4 }],
    runAngle: deg(200),
    seed: ARM_SEED,
    hide: WOUND_HIDE,
  });
}

// ── Leg ──────────────────────────────────────────────────────────────────────

/** In the profile's plane: (z, y) on the screen when x is zero. */
const LEG_SOLE = v3(0, 0.36, 0.05);
const LEG_CHAIN: Chain = {
  root: v3(0, -0.46, -0.16),
  joint: v3(0, -0.06, 0.2),
  end: v3(0, LEG_SOLE.y - 0.1, LEG_SOLE.z),
};
const LEG_SEED = 9.9;
const LEG_WOUND_RADIUS = 0.08;
const LEG_CENTRE: Pt = pt(0.05, -0.02);

function legPiece(ctx: Ctx): void {
  ctx.save();
  ctx.translate(-LEG_CENTRE.x, -LEG_CENTRE.y);
  paintSlab(
    ctx,
    [...legForms(LEG_CHAIN, 'side', HIDE), ...footForms(LEG_SOLE, 0, 1, 'side', HIDE)],
    'ambient',
  );
  paintFootClaws(ctx, LEG_SOLE, 0, 1, 'side');
  drawWound(ctx, {
    kind: 'clean',
    centre: pt(LEG_CHAIN.root.z, LEG_CHAIN.root.y),
    radius: LEG_WOUND_RADIUS,
    squash: 0.5,
    angle: deg(-40),
    bones: [{ at: pt(0, 0), size: 0.4 }],
    runAngle: deg(240),
    seed: LEG_SEED,
    hide: WOUND_HIDE,
  });
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

/** A coil: a thin line wound on itself, the one piece that is a spiral. */
const TAIL_STEPS = 40;
const TAIL_COIL_TURNS = 1.6;
const TAIL_COIL_OUTER = 0.42;
const TAIL_COIL_INNER = 0.05;
const TAIL_SEED = 11.3;

function tailPoints(): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= TAIL_STEPS; i++) {
    const s = i / TAIL_STEPS;
    const angle = s * TAIL_COIL_TURNS * Math.PI * 2;
    const radius = TAIL_COIL_OUTER + (TAIL_COIL_INNER - TAIL_COIL_OUTER) * s;
    points.push(pt(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return points;
}

function tailPiece(ctx: Ctx): void {
  const points = tailPoints();
  paintSlab(
    ctx,
    [taperedPathForm(points, TAIL_ROOT_RADIUS * 1.15, TAIL_TIP_RADIUS * 1.5, HIDE)],
    'ambient',
  );
  drawWound(ctx, {
    kind: 'clean',
    centre: points[0],
    radius: TAIL_ROOT_RADIUS * 1.2,
    squash: 0.6,
    angle: deg(90),
    bones: [{ at: pt(0, 0), size: 0.4, hollow: true }],
    runAngle: deg(180),
    seed: TAIL_SEED,
    hide: WOUND_HIDE,
  });
}

export function trashGremlinGorePieces(): readonly GorePiece[] {
  return [
    piece('gore_head', headPiece),
    piece('gore_ear', earPiece),
    piece('gore_lid', lidPiece),
    piece('gore_arm', armPiece),
    piece('gore_leg', legPiece),
    piece('gore_tail', tailPiece),
  ];
}
