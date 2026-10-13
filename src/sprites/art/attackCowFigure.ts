/**
 * Carl's attack cow as a painted figure: the rows, the cell, and
 * `ATTACK_COW_FIGURE`. The look and its armour are in `attackCowArt.ts`; the
 * anatomy and the walking, idling and lying rows are the village cow's.
 *
 * Rows (each in three views — `name`, `name_side`, `name_away` — except the
 * ones lying on the ground, which have a front and a side only):
 *
 *    walk      — the cow's walk, driven by distance
 *    idle      — the cow's idle, head carried a little higher
 *    charge    — the run at a target, head down behind the horns, by distance
 *    headbutt  — a rear back and a drive forward with the helmet; lands mid-row
 *    limp      — the walk away to rest, favouring a foreleg, head hung
 *    happy     — the cow's petted bounce, played when she is revived
 *    downed    — knocked down: onto the knees, then the head to the ground
 *    lie_down  — the cow's settling down, for her rest
 *    lie       — the cow's lying hold
 *
 * The art is reviewed with `npm run render:cow -- --mode=attack`.
 */

import { clamp01, easeInOut, easeOut, hump } from './carlArt';
import { drawCow, type CowPose, type CowView } from './cowArt';
import { type RowKind, TILE_SCALE, cowRowsFor, cowStateName } from './cowFigure';
import { ATTACK_COW_LOOK, drawAttackCowOverlay } from './attackCowArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  COW_HAPPY_FRAMES,
  COW_IDLE_FRAMES,
  COW_LIE_DOWN_FRAMES,
  COW_LIE_FRAMES,
  COW_TROT_FRAMES,
  COW_WALK_FRAMES,
} from '../cowTiming';
import {
  ATTACK_COW_DOWNED_FRAMES,
  ATTACK_COW_HEADBUTT_FRAMES,
  ATTACK_COW_HEADBUTT_IMPACT_FRAME,
} from '../attackCowTiming';

type Ctx = CanvasRenderingContext2D;

/** Poses are sampled at the middle of a frame's hold, not its start. */
const MID_FRAME = 0.5;

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * The cow's own cell, a little taller: the helmet's crown and the collar's
 * spikes stand above the poll, and the headbutt's rear lifts them further.
 */
const FRAME_WIDTH = 168;
const FRAME_HEIGHT = 120;
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
const TILE_Y = 46;
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE / 2;

// ── Borrowed rows ────────────────────────────────────────────────────────────

const COW_ROWS = cowRowsFor('adult');

function cowRow(
  action: 'walk' | 'idle' | 'trot' | 'happy' | 'lie' | 'lie_down',
  view: CowView,
): (frame: number) => CowPose {
  const row = COW_ROWS.find((r) => r.name === cowStateName(action, view));
  if (row === undefined) throw new Error(`the cow paints no ${action} ${view}`);
  return row.pose;
}

// ── Carriage ─────────────────────────────────────────────────────────────────

/** Head up and ears forward: a cow on guard, not one chewing cud. */
const ALERT_NECK = -0.08;
const ALERT_EARS = 0.35;

function alert(pose: CowPose): CowPose {
  return {
    ...pose,
    neck: pose.neck + ALERT_NECK,
    earL: Math.max(pose.earL, ALERT_EARS),
    earR: Math.max(pose.earR, ALERT_EARS),
  };
}

// ── Charge ───────────────────────────────────────────────────────────────────

/** The trot with the head dropped to aim the helmet, ears pinned, tail out. */
const CHARGE_NECK = 0.5;
const CHARGE_HEAD = 0.28;
const CHARGE_LUNGE = 0.05;
const CHARGE_CROUCH = 0.03;
const CHARGE_PITCH = 0.06;
const CHARGE_TAIL = 0.8;
const PINNED_EARS = -0.8;

function chargePose(view: CowView, frame: number): CowPose {
  const trot = cowRow('trot', view)(frame);
  return {
    ...trot,
    neck: trot.neck + CHARGE_NECK,
    headPitch: trot.headPitch + CHARGE_HEAD,
    lunge: trot.lunge + CHARGE_LUNGE,
    bob: trot.bob + CHARGE_CROUCH,
    pitch: trot.pitch + CHARGE_PITCH,
    earL: PINNED_EARS,
    earR: PINNED_EARS,
    tailLift: CHARGE_TAIL,
  };
}

// ── Headbutt ─────────────────────────────────────────────────────────────────

/**
 * Rear back onto the hind legs with the head up, then drive the helmet forward
 * and down through the target, then settle. The drive peaks on the impact
 * frame, which is the one the blow lands on.
 */
const IMPACT_SHARE = (ATTACK_COW_HEADBUTT_IMPACT_FRAME + MID_FRAME) / ATTACK_COW_HEADBUTT_FRAMES;
const HEADBUTT_REAR_END = IMPACT_SHARE * 0.55;
const HEADBUTT_RECOVER_FROM = IMPACT_SHARE + 0.12;
const REAR_PITCH = -0.16;
const REAR_LUNGE = -0.08;
const REAR_NECK = -0.3;
const REAR_HEAD = -0.15;
const REAR_RISE = 0.02;
const DRIVE_PITCH = 0.1;
const DRIVE_LUNGE = 0.16;
const DRIVE_NECK = 0.62;
const DRIVE_HEAD = 0.3;
const DRIVE_CROUCH = 0.03;
/** The forefeet come up off the ground as she rears and stamp down into the drive. */
const REAR_FORE_LIFT = { dx: 0.04, dy: 0.09 } as const;
const HEADBUTT_TAIL_LASH = 0.9;

function headbuttPose(view: CowView, frame: number): CowPose {
  const t = (frame + MID_FRAME) / ATTACK_COW_HEADBUTT_FRAMES;
  const base = alert(cowRow('idle', view)(0));
  const rear = easeInOut(clamp01(t / HEADBUTT_REAR_END));
  const drive = easeOut(clamp01((t - HEADBUTT_REAR_END) / (IMPACT_SHARE - HEADBUTT_REAR_END)));
  const recover = easeInOut(clamp01((t - HEADBUTT_RECOVER_FROM) / (1 - HEADBUTT_RECOVER_FROM)));
  const reared = rear * (1 - drive);
  const driven = drive * (1 - recover);
  const foreLift = hump(clamp01(t / IMPACT_SHARE));
  const fore = {
    dx: REAR_FORE_LIFT.dx * foreLift,
    dy: -REAR_FORE_LIFT.dy * foreLift,
    lift: foreLift,
  };
  return {
    ...base,
    pitch: reared * REAR_PITCH + driven * DRIVE_PITCH,
    lunge: reared * REAR_LUNGE + driven * DRIVE_LUNGE,
    bob: -reared * REAR_RISE + driven * DRIVE_CROUCH,
    neck: base.neck + reared * REAR_NECK + driven * DRIVE_NECK,
    headPitch: base.headPitch + reared * REAR_HEAD + driven * DRIVE_HEAD,
    earL: PINNED_EARS,
    earR: PINNED_EARS,
    eyeOpen: 1,
    tailLift: CHARGE_TAIL * driven,
    tailSwing: Math.sin(t * Math.PI * 2) * HEADBUTT_TAIL_LASH * (1 - recover),
    frontL: fore,
    frontR: fore,
    time: t,
  };
}

// ── Limp ─────────────────────────────────────────────────────────────────────

/** The near foreleg held off the ground through the whole stride. */
const LIMP_HELD_FORE = { dx: 0.06, dy: -0.07, lift: 0.8 } as const;
const LIMP_NECK = 0.42;
const LIMP_HEAD = 0.12;
const LIMP_EARS = -0.35;
const LIMP_EYES = 0.55;
/** She drops onto the good foreleg with every stride, a deeper bob than a walk's. */
const LIMP_BOB = 0.025;

function limpPose(view: CowView, frame: number): CowPose {
  const walk = cowRow('walk', view)(frame);
  const stumble = Math.abs(Math.sin(walk.time * Math.PI * 2));
  return {
    ...walk,
    neck: walk.neck + LIMP_NECK,
    headPitch: walk.headPitch + LIMP_HEAD,
    bob: walk.bob + stumble * LIMP_BOB,
    earL: LIMP_EARS,
    earR: LIMP_EARS,
    eyeOpen: LIMP_EYES,
    tailLift: 0,
    frontL: LIMP_HELD_FORE,
  };
}

// ── Downed ───────────────────────────────────────────────────────────────────

/**
 * Knocked down: the knees go, then the hindquarters, and the head sinks to the
 * ground with the eyes shut. The last frame is held while she waits.
 */
const DOWNED_KNEES_END = 0.45;
const DOWNED_HIND_FROM = 0.2;
const DOWNED_HIND_END = 0.75;
const DOWNED_NECK = 0.55;
const DOWNED_HEAD = 0.35;
const DOWNED_TILT = 0.25;
const DOWNED_EARS = -0.2;

function downedPose(frame: number): CowPose {
  const t = frame / (ATTACK_COW_DOWNED_FRAMES - 1);
  const base = cowRow('idle', 'side')(0);
  const knees = easeOut(clamp01(t / DOWNED_KNEES_END));
  const hind = easeInOut(clamp01((t - DOWNED_HIND_FROM) / (DOWNED_HIND_END - DOWNED_HIND_FROM)));
  const slump = easeInOut(clamp01(t));
  return {
    ...base,
    lowerFore: knees,
    lowerHind: hind,
    neck: base.neck + slump * DOWNED_NECK,
    headPitch: base.headPitch + slump * DOWNED_HEAD,
    headTilt: slump * DOWNED_TILT,
    jaw: 0,
    jawSide: 0,
    earL: DOWNED_EARS * slump,
    earR: DOWNED_EARS * slump,
    eyeOpen: 1 - slump,
    tailLift: 0,
    tailSwing: 0,
    time: t,
  };
}

// ── Row table ────────────────────────────────────────────────────────────────

export type AttackCowAction =
  'walk' | 'idle' | 'charge' | 'headbutt' | 'limp' | 'happy' | 'downed' | 'lie_down' | 'lie';

export interface AttackCowRowSpec {
  readonly name: string;
  readonly action: AttackCowAction;
  readonly view: CowView;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => CowPose;
}

const ALL_VIEWS: readonly CowView[] = ['front', 'side', 'back'];
/** On the ground the rear view is a rump in the grass; the profile reads as lying far better. */
const GROUND_VIEWS: readonly CowView[] = ['front', 'side'];

export const ATTACK_COW_ACTION_VIEWS: Readonly<Record<AttackCowAction, readonly CowView[]>> = {
  walk: ALL_VIEWS,
  idle: ALL_VIEWS,
  charge: ALL_VIEWS,
  headbutt: ALL_VIEWS,
  limp: ALL_VIEWS,
  happy: ALL_VIEWS,
  downed: GROUND_VIEWS,
  lie_down: GROUND_VIEWS,
  lie: GROUND_VIEWS,
};

/** The state name for an action seen from a view: `charge`, `charge_side`, `charge_away`. */
export function attackCowStateName(action: AttackCowAction, view: CowView): string {
  if (view === 'side') return `${action}_side`;
  if (view === 'back') return `${action}_away`;
  return action;
}

interface ActionSpec {
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (view: CowView, frame: number) => CowPose;
}

/**
 * The downed pose is unaimed: its head-on view is the same collapse seen from
 * the front rather than a pose of its own.
 */
const ACTION_SPECS: Readonly<Record<AttackCowAction, ActionSpec>> = {
  walk: {
    frameCount: COW_WALK_FRAMES,
    kind: 'loop',
    pose: (view, frame) => cowRow('walk', view)(frame),
  },
  idle: {
    frameCount: COW_IDLE_FRAMES,
    kind: 'loop',
    pose: (view, frame) => alert(cowRow('idle', view)(frame)),
  },
  charge: { frameCount: COW_TROT_FRAMES, kind: 'loop', pose: chargePose },
  headbutt: { frameCount: ATTACK_COW_HEADBUTT_FRAMES, kind: 'oneShot', pose: headbuttPose },
  limp: { frameCount: COW_WALK_FRAMES, kind: 'loop', pose: limpPose },
  happy: {
    frameCount: COW_HAPPY_FRAMES,
    kind: 'oneShot',
    pose: (view, frame) => cowRow('happy', view)(frame),
  },
  downed: {
    frameCount: ATTACK_COW_DOWNED_FRAMES,
    kind: 'oneShot',
    pose: (_view, frame) => downedPose(frame),
  },
  lie_down: {
    frameCount: COW_LIE_DOWN_FRAMES,
    kind: 'oneShot',
    pose: (view, frame) => cowRow('lie_down', view)(frame),
  },
  lie: { frameCount: COW_LIE_FRAMES, kind: 'hold', pose: (view) => cowRow('lie', view)(0) },
};

export const ATTACK_COW_ACTIONS: readonly AttackCowAction[] = [
  'walk',
  'idle',
  'charge',
  'headbutt',
  'limp',
  'happy',
  'downed',
  'lie_down',
  'lie',
];

export const ATTACK_COW_ROWS: readonly AttackCowRowSpec[] = ATTACK_COW_ACTIONS.flatMap((action) => {
  const spec = ACTION_SPECS[action];
  return ATTACK_COW_ACTION_VIEWS[action].map((view) => ({
    name: attackCowStateName(action, view),
    action,
    view,
    frameCount: spec.frameCount,
    kind: spec.kind,
    pose: (frame: number) => spec.pose(view, frame),
  }));
});

// ── Painting ─────────────────────────────────────────────────────────────────

const ROWS_BY_NAME = new Map(ATTACK_COW_ROWS.map((row) => [row.name, row]));

function paintAttackCowFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS_BY_NAME.get(state);
  if (row === undefined) throw new Error(`attack_cow paints no state "${state}"`);
  const pose = row.pose(frame);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    drawCow(ctx, row.view, pose, ATTACK_COW_LOOK);
    drawAttackCowOverlay(ctx, row.view, pose);
  } finally {
    ctx.restore();
  }
}

function attackCowStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ATTACK_COW_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const ATTACK_COW_FIGURE: FigureDef = {
  id: 'attack_cow',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(attackCowStateFrames()),
  paintFrame: paintAttackCowFrame,
};
