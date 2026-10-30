/**
 * The rows a long haft in his hands plays when he is not fighting with it,
 * as a staff: resting on it planted upright, walking with it as a walking
 * stick, the healing channel (planted, the light gathered in his raised
 * left palm), the hurried walk with it clutched to his chest, cowering
 * behind it, and the flinch that throws him back behind it held across him.
 * They are no rows of the crawler's: a figure on the rig that plays them
 * declares them in its own row table (`extendedHumanRowBook`). They belong to
 * the two-handed set, so any long haft held that way sits in the same fists.
 *
 * Each lays a hold on the bare-handed idle or walk (`withHold`), so the legs
 * and the breath are the rig's own.
 */

import type { CardinalView } from '../../facingView';
import { deg, lerp, type Pt } from '../bipedArt';
import { pt } from '../biped/geometry';
import { type BipedPose, HAFT_IN_PLANE, VIEWS } from '../biped/rig';
import { type FistPlace, type OneHandHold, type TwoHandHold, withHold } from './armedHold';
import { KNUCKLES_TO_CAMERA, PALM_TO_CAMERA, towards } from './handTurn';
import { buildLoop } from './actionsBuild';
import { idleBack, idleFront, idleSide } from './idles';
import { walkFacing, walkSide } from './locomotion';
import type { HumanRowDef } from '../humanFigure';
import {
  IDLE_FRAMES,
  IDLE_FRAME_TICKS,
  idleBlinkLid,
  idleBreathPhase,
  STAFF_BRACE_FRAMES,
  STAFF_BRACE_TICKS_PER_FRAME,
  STAFF_CHANNEL_FRAMES,
  STAFF_CHANNEL_RELEASE_FRAME,
  STAFF_CHANNEL_TICKS_PER_FRAME,
  STAFF_FLINCH_FRAMES,
  STAFF_FLINCH_TICKS_PER_FRAME,
  WALK_FRAMES,
} from './timing';

function idlePose(view: CardinalView, phase: number): BipedPose {
  if (view === 'side') return idleSide(phase);
  return view === 'back' ? idleBack(phase) : idleFront(phase);
}

function smooth(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

// ── The channel ──────────────────────────────────────────────────────────────

const CHANNEL_LAST = STAFF_CHANNEL_FRAMES - 1;
/** The hand takes this many frames to rise, and this many to come down at the end. */
const CHANNEL_RISE_FRAMES = 2;
const CHANNEL_FALL_FRAMES = 3;
/** How far raised the free hand is on a frame: up in two frames, held, down in the last three. */
function channelRaise(frame: number): number {
  const rising = smooth(frame / CHANNEL_RISE_FRAMES);
  const falling = smooth((CHANNEL_LAST - frame) / CHANNEL_FALL_FRAMES);
  return Math.min(rising, falling);
}

/**
 * The palm's light: a faint glow as the hand comes up, swelling to its full
 * strength on the release, then fading out as the hand lowers.
 */
const GLOW_GATHERED = 0.35;
const GLOW_FADE_FRAMES = 3;
function channelGlow(frame: number): number {
  if (frame <= STAFF_CHANNEL_RELEASE_FRAME) {
    const gathering = frame / STAFF_CHANNEL_RELEASE_FRAME;
    return channelRaise(frame) * lerp(GLOW_GATHERED, 1, gathering * gathering);
  }
  return 1 - smooth((frame - STAFF_CHANNEL_RELEASE_FRAME) / GLOW_FADE_FRAMES);
}

/**
 * The staff stands upright by his right side, its iron foot on the floor:
 * his right fist closed on it a hand's breadth down from the top, at the
 * height of his chest. Head-on it stands just outside his right shoulder;
 * edge-on a little ahead of his toes, so the pole shows clear of the robe.
 * The haft points straight down from the fist.
 */
const STAFF_DOWN = deg(90);
const PLANTED_FIST: Readonly<Record<CardinalView, FistPlace>> = {
  front: { wrist: pt(0.14, 0.24), bend: 'down' },
  back: { wrist: pt(0.14, 0.24), bend: 'down' },
  side: { wrist: pt(0.24, 0.04), bend: 'down' },
};
const PLANTED_PALM: Readonly<Record<CardinalView, ReturnType<typeof towards>>> = {
  front: towards(0.3, 0, -0.95),
  back: towards(0.3, 0, -0.95),
  side: KNUCKLES_TO_CAMERA,
};

/**
 * The free hand hangs at his side, then rises out in front of him to the
 * height of his face, palm open toward whoever he is healing. Head-on it is
 * out past his left shoulder, clear of his face; edge-on ahead of his face.
 */
const FREE_HANGING: Readonly<Record<CardinalView, Pt>> = {
  front: pt(-0.06, 0.6),
  back: pt(-0.06, 0.6),
  side: pt(0.02, 0.6),
};
const FREE_RAISED: Readonly<Record<CardinalView, Pt>> = {
  front: pt(-0.22, -0.4),
  back: pt(-0.22, -0.4),
  side: pt(0.42, -0.06),
};

/** He bows his head over the work and his eyes half close as the light gathers. */
const CHANNEL_CHIN = -0.3;
const CHANNEL_LID = 0.55;
/** The breath the idle draws, slowed to one through the whole channel. */
const CHANNEL_BREATHS = 1;

/** The staff planted in his right fist and his left hand `raise` of the way from hanging to raised, over `base`. */
function withStaffPlanted(view: CardinalView, base: BipedPose, raise: number): BipedPose {
  const hanging = FREE_HANGING[view];
  const raised = FREE_RAISED[view];
  const hold: OneHandHold = {
    kind: 'oneHand',
    fist: PLANTED_FIST[view],
    haftAngle: STAFF_DOWN,
    palm: PLANTED_PALM[view],
    free: {
      wrist: pt(lerp(hanging.x, raised.x, raise), lerp(hanging.y, raised.y, raise)),
      bend: 'down',
    },
  };
  return withHold(base, view, hold, 0);
}

/**
 * Standing at rest with the staff planted upright beside him, breathing as
 * the bare-handed idle breathes: how a man who walks with a staff waits.
 */
export function staffRest(view: CardinalView, phase: number, lid: number): BipedPose {
  const base = idlePose(view, phase);
  base.blink = lid;
  return withStaffPlanted(view, base, 0);
}

/** The healing channel in one view, on one of its frames. */
export function staffChannel(view: CardinalView, frame: number): BipedPose {
  const raise = channelRaise(frame);
  const base = idlePose(view, (frame / STAFF_CHANNEL_FRAMES) * CHANNEL_BREATHS);
  const pose = withStaffPlanted(view, base, raise);
  pose.chinLift = CHANNEL_CHIN * raise;
  pose.blink = Math.max(pose.blink, CHANNEL_LID * raise);
  pose.leftFist = 0;
  if (raise > 0) pose.leftHandShape = 'open';
  const glow = channelGlow(frame);
  if (glow > 0) pose.palmGlow = { hand: 'left', strength: glow };
  if (VIEWS[view].showsBack) pose.leftArmBehind = true;
  return pose;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * The bare-handed walk at `phase`, wrapped onto one turn so a phase of a whole
 * turn paints exactly the cycle's first frame: the two-handed grip is solved
 * iteratively, and the last hair of float error otherwise shows at the seam.
 */
function walkPose(view: CardinalView, phase: number): BipedPose {
  const wrapped = phase - Math.floor(phase);
  if (view === 'side') return walkSide(wrapped);
  return walkFacing(wrapped, view === 'back');
}

/**
 * Walking with the staff as a walking stick: his right fist high on it, the
 * pole hanging down beside him to just off the floor, a little ahead of him
 * edge-on, while his free arm swings with the stride as it does bare-handed.
 */
const AMBLE_FIST: Readonly<Record<CardinalView, FistPlace>> = {
  front: { wrist: pt(0.14, 0.2), bend: 'down' },
  back: { wrist: pt(0.14, 0.2), bend: 'down' },
  side: { wrist: pt(0.26, 0.02), bend: 'down' },
};
/** Edge-on the pole leans forward of plumb, its foot ahead of his leading toe. */
const AMBLE_HAFT: Readonly<Record<CardinalView, number>> = {
  front: STAFF_DOWN,
  back: STAFF_DOWN,
  side: deg(78),
};

/** Walking with the staff, `phase` of the way through the stride. */
export function staffAmble(view: CardinalView, phase: number): BipedPose {
  const hold: OneHandHold = {
    kind: 'oneHand',
    fist: AMBLE_FIST[view],
    haftAngle: AMBLE_HAFT[view],
    palm: PLANTED_PALM[view],
  };
  return withHold(walkPose(view, phase), view, hold, 0);
}

/**
 * Getting away: the walk's own legs, so the stride is paced by the same
 * ground, with the staff clutched to his chest in both fists (head-on slant
 * across him from his right hip to past his left shoulder), the
 * body hunched forward over the legs, the head down and the brow drawn in
 * fear. Edge-on the lean tips him toward where he is going; head-on it shows
 * as the chest pitched at the camera.
 */
const HURRY_LEAN = deg(20);
const HURRY_PITCH = 0.45;
const HURRY_CROUCH = 0.16;
const HURRY_CHIN = -0.35;
const HURRY_BROW = 0.8;
const HURRY_SPACING = 2;
const HURRY_FACING_FLARE = 0.3;
const HURRY_SIDE_FLARE = -0.35;
const HURRY_FACING: TwoHandHold = {
  kind: 'twoHand',
  butt: pt(0.32, 0.5),
  haftAngle: deg(-132),
  spacing: HURRY_SPACING,
  buttHand: 'right',
  depth: HAFT_IN_PLANE,
  palms: { left: towards(0.7, 0, -0.7), right: towards(-0.7, 0, -0.7) },
  elbowFlare: HURRY_FACING_FLARE,
};
const HURRY_HOLDS: Readonly<Record<CardinalView, TwoHandHold>> = {
  front: HURRY_FACING,
  back: HURRY_FACING,
  side: {
    kind: 'twoHand',
    butt: pt(0.24, 0.44),
    haftAngle: deg(-78),
    spacing: HURRY_SPACING,
    buttHand: 'right',
    depth: HAFT_IN_PLANE,
    palms: { left: PALM_TO_CAMERA, right: KNUCKLES_TO_CAMERA },
    elbowFlare: HURRY_SIDE_FLARE,
  },
};

/** The hurried walk in one view, `phase` of the way through its stride. */
export function staffHurry(view: CardinalView, phase: number): BipedPose {
  const base = walkPose(view, phase);
  if (VIEWS[view].profile) base.lean += HURRY_LEAN;
  else base.torsoPitch = (base.torsoPitch ?? 0) + (VIEWS[view].showsBack ? -1 : 1) * HURRY_PITCH;
  base.crouch += HURRY_CROUCH;
  base.chinLift = HURRY_CHIN;
  base.brow = HURRY_BROW;
  return withHold(base, view, HURRY_HOLDS[view], 0);
}

// ── Cowering ─────────────────────────────────────────────────────────────────

/**
 * Cowering from a threat he will not fight: sunk low, the staff clutched
 * upright to his chest in both fists, his head ducked and turned away and
 * his eyes screwed shut, trembling.
 */
const COWER_SPACING = 1.8;
const COWER_BROW = 0.6;
const COWER_CHIN = -0.6;
const COWER_HEAD_TURN = -0.7;
const COWER_HUNCH = deg(10);
const COWER_PITCH = 0.5;
const COWER_SHIVER = 0.012;
const COWER_HEAD_SHAKE = deg(5);

/**
 * The tremble, one value a frame: uneven, so no frame of the loop repeats
 * another and it reads as shaking rather than as a steady bob.
 */
const COWER_TREMBLE: readonly number[] = [0, 0.6, 1, 0.5, -0.25, -0.55];

/**
 * Cowering he hugs the staff to him in both fists: head-on it rises from his
 * middle out past his right shoulder, away from the face he has ducked and
 * turned the other way; edge-on it stands up in front of him.
 */
const COWER_HOLDS: Readonly<Record<CardinalView, TwoHandHold>> = {
  front: { ...HURRY_FACING, butt: pt(0.04, 0.5), haftAngle: deg(-58), spacing: COWER_SPACING },
  back: { ...HURRY_FACING, butt: pt(0.04, 0.5), haftAngle: deg(-58), spacing: COWER_SPACING },
  side: HURRY_HOLDS.side,
};

/** Cowering in one view, on one frame of its tremble. */
export function staffBrace(view: CardinalView, frame: number): BipedPose {
  const tremble = COWER_TREMBLE[frame % COWER_TREMBLE.length];
  // Down on one knee, as he kneels to build: the one stance of the rig that
  // lowers him on screen head-on as well as edge-on.
  const base = buildLoop(0, view);
  base.heldProps = [];
  base.leftHandShape = 'relaxed';
  base.rightHandShape = 'relaxed';
  base.bob += tremble * COWER_SHIVER;
  if (VIEWS[view].profile) base.lean += COWER_HUNCH;
  else base.torsoPitch = (base.torsoPitch ?? 0) + (VIEWS[view].showsBack ? -1 : 1) * COWER_PITCH;
  base.chinLift = COWER_CHIN;
  base.headTurn = VIEWS[view].profile ? 0 : COWER_HEAD_TURN;
  base.headTilt = tremble * COWER_HEAD_SHAKE;
  base.blink = 1;
  base.brow = COWER_BROW;
  return withHold(base, view, COWER_HOLDS[view], 0);
}

// ── The flinch ───────────────────────────────────────────────────────────────

/**
 * Struck: the body thrown back from the blow on the hit's frame, eyes shut
 * and mouth open, and easing back upright over the frames after.
 */
const FLINCH_RECOIL: readonly number[] = [1, 0.85, 0.6, 0.38, 0.2, 0.07];
const FLINCH_LEAN = deg(-16);
const FLINCH_PITCH = 0.6;
const FLINCH_TILT = deg(22);
const FLINCH_SWAY = 0.1;
const FLINCH_DUCK = 0.08;
const FLINCH_HEAD_TURN = -0.5;

/**
 * The staff stays upright close by his side in his fist as the blow lands, and his
 * free hand comes up in front of his brow, palm out.
 */
const FLINCH_HOLDS: Readonly<Record<CardinalView, OneHandHold>> = {
  front: {
    kind: 'oneHand',
    fist: { wrist: pt(0.24, 0.42), bend: 'down' },
    haftAngle: deg(-82),
    palm: towards(0.3, 0, -0.95),
    free: { wrist: pt(0.12, -0.3), bend: 'down' },
  },
  back: {
    kind: 'oneHand',
    fist: { wrist: pt(0.24, 0.42), bend: 'down' },
    haftAngle: deg(-82),
    palm: towards(0.3, 0, -0.95),
    free: { wrist: pt(0.12, -0.3), bend: 'down' },
  },
  side: {
    kind: 'oneHand',
    fist: { wrist: pt(0.16, 0.4), bend: 'down' },
    haftAngle: deg(-72),
    palm: KNUCKLES_TO_CAMERA,
    free: { wrist: pt(0.26, -0.3), bend: 'down' },
  },
};

/** The flinch in one view, on one of its frames. */
export function staffFlinch(view: CardinalView, frame: number): BipedPose {
  const recoil = FLINCH_RECOIL[Math.min(frame, FLINCH_RECOIL.length - 1)];
  const base = idlePose(view, 0);
  if (VIEWS[view].profile) {
    base.lean += FLINCH_LEAN * recoil;
    base.sway -= FLINCH_SWAY * recoil;
  } else {
    base.torsoPitch =
      (base.torsoPitch ?? 0) + (VIEWS[view].showsBack ? 1 : -1) * FLINCH_PITCH * recoil;
    base.headTurn = FLINCH_HEAD_TURN;
    base.sway += FLINCH_SWAY * recoil;
  }
  base.headTilt = FLINCH_TILT * recoil;
  base.crouch += FLINCH_DUCK * recoil;
  base.blink = recoil;
  base.mouth = recoil;
  base.brow = COWER_BROW;
  base.leftFootPlanted = true;
  base.rightFootPlanted = true;
  const pose = withHold(base, view, FLINCH_HOLDS[view], 0);
  pose.leftHandShape = 'open';
  pose.leftFist = 0;
  return pose;
}

// ── The rows ─────────────────────────────────────────────────────────────────

const NO_IMPACT: readonly number[] = [];

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/** Standing with the haft planted upright, breathing as the idle breathes. */
export function staffRestRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    frameTicks: IDLE_FRAME_TICKS,
    motionSet: 'twoHand',
    pose: (f) => staffRest(view, idleBreathPhase(f), idleBlinkLid(f)),
  };
}

/** The walk hunched forward in a hurry, on the walk's own legs and paced by the walk's ground. */
export function staffHurryRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    gait: 'walk',
    motionSet: 'twoHand',
    pose: (f) => staffHurry(view, cyclePhase(f, WALK_FRAMES)),
  };
}

/** Walking with the staff as a walking stick, on the walk's own legs and paced by the walk's ground. */
export function staffAmbleRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    gait: 'walk',
    motionSet: 'twoHand',
    pose: (f) => staffAmble(view, cyclePhase(f, WALK_FRAMES)),
  };
}

/** Struck while holding a haft: thrown back behind it and recovering. */
export function staffFlinchRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_FLINCH_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_FLINCH_TICKS_PER_FRAME,
    motionSet: 'twoHand',
    pose: (f) => staffFlinch(view, f),
  };
}

const CHANNEL_EVENTS = { release: [STAFF_CHANNEL_RELEASE_FRAME] } as const;

/** The healing channel with the haft planted. */
export function staffChannelRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_CHANNEL_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_CHANNEL_TICKS_PER_FRAME,
    eventFrames: CHANNEL_EVENTS,
    motionSet: 'twoHand',
    pose: (f) => staffChannel(view, f),
  };
}

/** Braced behind the haft, held as long as the threat is. */
export function staffBraceRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_BRACE_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_BRACE_TICKS_PER_FRAME,
    motionSet: 'twoHand',
    pose: (f) => staffBrace(view, f),
  };
}
