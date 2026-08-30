/**
 * Shady, as a painted figure: the choreography, the cell geometry, and the
 * `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table, and the placement of a pose inside its cell. Anatomy, palette and
 * every stroke of paint live in `shadyArt.ts`.
 *
 * He has one facing. He stands at a fixed spot facing the plaza and never
 * turns, so a profile and a back view would be twice the art for frames nothing
 * can reach.
 *
 * The art invariants live in `scripts/gates-shady.ts`, which the review harness
 * runs: `npm run render:shady`.
 */

import {
  clamp01,
  deg,
  drawShady,
  easeInOut,
  hump,
  lerp,
  pt,
  ramp,
  restingPose,
  SHOULDER_Y,
  type ShadyPose,
} from './shadyArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
/** The tile sits low in the frame: his raised hand needs the room above it. */
const TILE_Y = 62;
/** Where his soles sit inside the tile, matching the other humanoid sheets. */
const GROUND_OFFSET_IN_TILE = 0.9;

/**
 * Where the figure's origin — the point between his feet — sits inside the cell.
 *
 * These numbers were measured by the bake this figure replaces, and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
export const ORIGIN_X = TILE_X + TILE_SCALE / 2;
export const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

/**
 * How much of a tile Shady fills. Set against Carl (2.03 tiles authored × 0.72)
 * so the two stand in the same street at plausible relative heights — Shady a
 * shade shorter, which is the point of his slouch.
 */
export const SHADY_SCALE = 0.8;

const IDLE_FRAMES = 10;
const SCRATCH_FRAMES = 14;
const TALK_FRAMES = 8;

// ── Idle choreography ────────────────────────────────────────────────────────

const TURN = Math.PI * 2;

/**
 * The weight shift, as a −1…1 signal that *holds* at each extreme.
 *
 * Not a sine. A blind review of the first bake measured a clean single sinusoid
 * with 6.8–10% silhouette change on every consecutive frame — not one still
 * frame in the loop — and named it a pendulum: serene, or dancing. Nerves are
 * irregular. Somebody shifts, stands there, then shifts back.
 */
const SHIFT_DURATION = 0.34;
function weightShift(rawT: number): number {
  // Wrapped, because `trailOf` samples this at a *negative* offset near the
  // start of the loop. `ramp` clamps rather than wrapping, so an unwrapped
  // argument returned the beginning of the cycle where the end belonged — which
  // is a discontinuity at exactly the seam, and it measured as a 2.2x hitch at
  // the wrap with a stall beside it, once per loop forever.
  const t = ((rawT % 1) + 1) % 1;
  const rise = easeInOut(
    ramp(t, FIRST_SHIFT_AT - SHIFT_DURATION / 2, FIRST_SHIFT_AT + SHIFT_DURATION / 2),
  );
  const fall = easeInOut(
    ramp(t, SECOND_SHIFT_AT - SHIFT_DURATION / 2, SECOND_SHIFT_AT + SHIFT_DURATION / 2),
  );
  return -1 + 2 * rise - 2 * fall;
}
const FIRST_SHIFT_AT = 0.25;
const SECOND_SHIFT_AT = 0.75;

/**
 * How far a hanging mass trails the body, given how far the body has travelled
 * since `lag` ago. Sampling the drive signal at an offset and differencing it is
 * an exact lag; the first bake instead added a phase-shifted sine of its own,
 * which measured as the hood and hem *leading* the shoulders by a quarter cycle
 * — the robe animating the man. Same trap as Carl's arm swing.
 */
function trailOf(t: number, lag: number): number {
  return weightShift(t - lag) - weightShift(t);
}

const IDLE_SWAY = 0.026;
const IDLE_LEAN = deg(2);
/** Breathing runs off the clock, not the shift, so the two never sit in phase. */
const IDLE_BREATH_SLOUCH = 0.035;
const IDLE_BREATH_BOB = 0.008;
const IDLE_BREATH_RATE = 2;

/**
 * How far behind the body the hood and the hem each run, in cycles.
 *
 * Small. The first pass at these put the hood's peak four frames behind the
 * shoulders' on a ten-frame loop — 144°, near enough anti-phase that the head
 * read as counter-rotating off the neck rather than trailing it.
 */
const HOOD_TRAIL = 0.115;
const HEM_TRAIL = 0.115;
/**
 * The hood swings further than the hem. A weight shift is driven from the
 * pelvis, so the head is what actually travels; a robe whose skirt moves 1.6×
 * as far as its wearer's head reads as a hoop skirt, not as a man.
 */
const HOOD_TRAIL_GAIN = 1.1;
/**
 * The coat's hem swings further than the shoulders driving it, not less. A skirt
 * that trails its own wearer by less than the wearer moves is starched.
 */
const HEM_TRAIL_GAIN = 1.25;

/**
 * A single quick glance, once per loop, on top of a slow drift. This is the
 * irregularity — the loop is otherwise deliberately mostly still.
 */
const IDLE_GLANCE_DRIFT = 0.22;
const IDLE_FLICK = 0.62;
const IDLE_FLICK_AT = 0.6;
const IDLE_FLICK_WIDTH = 0.16;

/** Where his hands work, either side of the belt buckle. */
const BELT_HAND_Y = -0.78;
const BELT_HAND_SPREAD = 0.235;
/**
 * The two hands never mirror each other. The first bake moved them as one
 * symmetric unit at identical heights, which cannot read as "restless" however
 * far it travels — so one worries at the belt on the fast beat while the other
 * picks at its own sleeve on the slow one, at different heights.
 */
const LEFT_HAND_LIFT = 0.05;
const LEFT_HAND_DRIFT = 0.03;
const LEFT_HAND_RATE = 3;
const RIGHT_HAND_DRIFT = 0.018;
const RIGHT_HAND_RATE = 1;
const LEFT_FIST_BASE = 0.3;
const RIGHT_FIST_BASE = 0.55;
const FIST_TRAVEL = 0.22;

function idlePose(t: number): ShadyPose {
  const pose = restingPose();
  const shift = weightShift(t);
  const breath = Math.sin(t * TURN * IDLE_BREATH_RATE);

  pose.sway = shift * IDLE_SWAY;
  pose.lean = shift * IDLE_LEAN;
  pose.slouch += breath * IDLE_BREATH_SLOUCH;
  pose.bob = breath * IDLE_BREATH_BOB;
  pose.hoodLag = trailOf(t, HOOD_TRAIL) * HOOD_TRAIL_GAIN;
  pose.hemSway = trailOf(t, HEM_TRAIL) * HEM_TRAIL_GAIN;

  const flick = hump(ramp(t, IDLE_FLICK_AT, IDLE_FLICK_AT + IDLE_FLICK_WIDTH));
  pose.headTurn = shift * IDLE_GLANCE_DRIFT - flick * IDLE_FLICK;

  pose.leftHand = pt(
    pose.sway - BELT_HAND_SPREAD + Math.sin(t * TURN * LEFT_HAND_RATE) * LEFT_HAND_DRIFT,
    BELT_HAND_Y - LEFT_HAND_LIFT,
  );
  pose.rightHand = pt(
    pose.sway + BELT_HAND_SPREAD + Math.sin(t * TURN * RIGHT_HAND_RATE) * RIGHT_HAND_DRIFT,
    BELT_HAND_Y,
  );
  pose.leftFist = LEFT_FIST_BASE + Math.sin(t * TURN * LEFT_HAND_RATE) * FIST_TRAVEL;
  pose.rightFist = RIGHT_FIST_BASE + Math.sin(t * TURN * RIGHT_HAND_RATE) * FIST_TRAVEL;
  return pose;
}

// ── Scratch choreography ─────────────────────────────────────────────────────

/**
 * A fast attack, a long working hold, and a slower relaxed return.
 *
 * Deliberately asymmetric. With the reach and the return the same length the
 * whole row measured as an exact frame-for-frame palindrome — the hand went up
 * and came back down the identical path, which reads as a machine rather than
 * as somebody dealing with an itch.
 */
const SCRATCH_REACH_END = 0.16;
const SCRATCH_RUB_END = 0.66;
/**
 * Behind the hood on the near side, high enough that the hood covers most of the
 * hand. Head-on, a back-of-neck scratch is carried by the *elbow* winging out —
 * the hand itself should barely show. Placed at the chest it read as clutching
 * something; placed outboard of the hood it read as adjusting sunglasses.
 */
const SCRATCH_HAND_X = 0.15;
const SCRATCH_HAND_Y = -1.44;
/** How far the hand travels out from the body on the way up — an elbow-led arc. */
const SCRATCH_ARC_OUT = 0.13;
/**
 * The rub itself. The first bake used a travel so small that six of the twelve
 * frames measured as a dead stop — the animation raised a hand, froze for half
 * its runtime, and lowered it, and the scratching never happened.
 */
const SCRATCH_RUB_TRAVEL = 0.075;
/**
 * Rubs that fit in the hold *and can be sampled*.
 *
 * About six frames land inside the working window. 2.5 cycles aliased against
 * them into a sub-pixel wobble that measured as a dead freeze; 1.5 cycles
 * aliased the other way, into a hand teleporting a hand-width per frame in
 * alternating directions. One cycle is six samples — enough that each half of
 * the rub is monotone, which is what makes it read as a rub rather than as
 * noise. This is the Nyquist limit, not a taste call: more rubs need more
 * frames, not a bigger number here.
 */
const SCRATCH_RUB_CYCLES = 1;
/** The hood jiggles against the hand rather than sitting still through it. */
const SCRATCH_HOOD_JIGGLE = 1.4;
const SCRATCH_TILT_JIGGLE = deg(2.4);
/**
 * A man reaching the back of his own neck tilts his head away from the hand and
 * drops his chin. Without this the head sat locked to a tenth of a pixel through
 * the whole row while an arm moved around it.
 */
const SCRATCH_HEAD_LEAN = -0.55;
/** He hunches further and tips his head into the hand while scratching. */
const SCRATCH_EXTRA_SLOUCH = 0.14;
const SCRATCH_HEAD_TILT = deg(-6);
const SCRATCH_HEAD_TURN = -0.35;
/** The free hand stays put but tightens — the tell that he is uncomfortable. */
const SCRATCH_FREE_FIST = 0.8;
/** A scratching hand is open — a fist cannot scratch anything. */
const SCRATCH_OPEN_FIST = 0.1;
/**
 * The one arm on this figure whose elbow genuinely travels sideways: reaching
 * over the shoulder swings it out into the picture plane, so the head-on
 * foreshortening that keeps his resting arms tucked has to relax.
 */
const SCRATCH_ARM_FORESHORTEN = 0.22;

function scratchPose(t: number): ShadyPose {
  // Written as edits to the idle he leaves and returns to, so the row hands
  // back to a pose the idle actually contains.
  const pose = idlePose(0);
  const up = ramp(t, 0, SCRATCH_REACH_END);
  const down = ramp(t, SCRATCH_RUB_END, 1);
  const raised = easeInOut(clamp01(up - down));
  const rubbing = clamp01(up) * (1 - clamp01(down));
  const rub = Math.sin(ramp(t, SCRATCH_REACH_END, SCRATCH_RUB_END) * TURN * SCRATCH_RUB_CYCLES);
  const rubAmount = rub * rubbing;

  const restX = pose.rightHand.x;
  const restY = pose.rightHand.y;
  const arc = hump(clamp01(up - down)) * SCRATCH_ARC_OUT;
  pose.rightHand = pt(
    lerp(restX, SCRATCH_HAND_X, raised) + arc + rubAmount * SCRATCH_RUB_TRAVEL,
    lerp(restY, SCRATCH_HAND_Y, raised) - rubAmount * SCRATCH_RUB_TRAVEL,
  );
  pose.rightFist = lerp(pose.rightFist, SCRATCH_OPEN_FIST, raised);
  pose.leftFist = lerp(pose.leftFist, SCRATCH_FREE_FIST, raised);
  pose.rightArmForeshorten = lerp(pose.rightArmForeshorten, SCRATCH_ARM_FORESHORTEN, raised);
  // The raised limb is painted after the shoulder cape, or the cape swallows it
  // whole and only the hand shows past the hood as an unexplained nub.
  pose.rightArmOverMantle = raised > SCRATCH_OVER_MANTLE_AT;

  pose.slouch += SCRATCH_EXTRA_SLOUCH * raised;
  pose.headTilt = SCRATCH_HEAD_TILT * raised + rubAmount * SCRATCH_TILT_JIGGLE;
  pose.headTurn = lerp(pose.headTurn, SCRATCH_HEAD_TURN, raised);
  pose.hoodLag += rubAmount * SCRATCH_HOOD_JIGGLE + raised * SCRATCH_HEAD_LEAN;
  // The lower body counterbalances, and keeps moving *through* the hold rather
  // than settling into a pose and holding it. Driving it off `raised` alone left
  // the hem and both feet bit-identical for six consecutive frames — the same
  // freeze, one layer down, hiding behind a fix that only moved the hand.
  pose.sway = -SCRATCH_COUNTER_SWAY * raised + rubAmount * SCRATCH_COUNTER_RUB_SWAY;
  pose.hemSway = SCRATCH_COUNTER_HEM * raised + rubAmount * SCRATCH_COUNTER_RUB_HEM;
  return pose;
}

const SCRATCH_COUNTER_SWAY = 0.014;
const SCRATCH_COUNTER_HEM = 0.5;
/** How much of the rub reaches the hips and the hem, so neither ever freezes. */
const SCRATCH_COUNTER_RUB_SWAY = 0.008;
const SCRATCH_COUNTER_RUB_HEM = 0.55;

/**
 * How far up the arm has to be before the cape stops being in front of it.
 *
 * Held late on purpose: swapped early, the part-raised arm and the cape leave a
 * slit between them that shows the background straight through his armpit.
 */
const SCRATCH_OVER_MANTLE_AT = 0.55;

// ── Talk choreography ────────────────────────────────────────────────────────

/**
 * He straightens and leans in to talk. The first bake changed nothing but the
 * lateral head wobble, measured at zero vertical travel and identical sprite
 * height on all four frames — so opening the dialog box produced no visible
 * state change at all.
 */
const TALK_SLOUCH_RELIEF = 0.16;
/** The lean-in itself: he drops and compresses toward the person he is talking to. */
const TALK_LEAN_IN_BOB = 0.075;
const TALK_LEAN_IN_SLOUCH = 0.3;
/** The lean itself breathes over the loop, so the motion is up-down not side-side. */
const TALK_LEAN_SWELL = 0.045;
/** The gesturing hand comes up to about chest height, palm turned over. */
const TALK_GESTURE_X = 0.19;
const TALK_GESTURE_LIFT = 0.3;
const TALK_GESTURE_TRAVEL = 0.04;
const TALK_GESTURE_FIST = 0.2;
const TALK_HEAD_TURN = 0.06;
/** A conspiratorial dip on the accent frame, so the loop has a beat in it. */
const TALK_DIP = 0.04;
/** The hood barely trails while he talks — he is leaning, not swinging. */
const TALK_HOOD_LAG_SHARE = 0.3;
const TALK_ARM_FORESHORTEN = 0.35;

function talkPose(t: number): ShadyPose {
  const pose = idlePose(0);
  const phase = t * TURN;
  // The lean swells and settles across the loop rather than sliding sideways.
  // The first pass moved 2.7x as far horizontally as vertically, which reads as
  // a head wobbling on a still body rather than as a man leaning in to talk.
  const swell = hump(t);
  pose.slouch += TALK_LEAN_IN_SLOUCH - TALK_SLOUCH_RELIEF + swell * TALK_LEAN_SWELL;
  pose.bob = TALK_LEAN_IN_BOB + swell * TALK_DIP;
  pose.headTurn = Math.sin(phase) * TALK_HEAD_TURN;
  pose.hoodLag = -Math.cos(phase) * HOOD_TRAIL_GAIN * TALK_HOOD_LAG_SHARE;
  pose.rightHand = pt(
    TALK_GESTURE_X + Math.sin(phase) * TALK_GESTURE_TRAVEL,
    SHOULDER_Y + TALK_GESTURE_LIFT + Math.cos(phase) * TALK_GESTURE_TRAVEL,
  );
  pose.rightFist = TALK_GESTURE_FIST;
  pose.rightArmForeshorten = TALK_ARM_FORESHORTEN;
  pose.rightArmOverMantle = true;
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  /** Loops sample the cycle evenly; one-shots sample the frame's own position. */
  readonly loops: boolean;
  readonly pose: (frame: number) => ShadyPose;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

export const SHADY_ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    loops: true,
    pose: (f) => idlePose(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'scratch',
    frameCount: SCRATCH_FRAMES,
    loops: false,
    pose: (f) => scratchPose(shotProgress(f, SCRATCH_FRAMES)),
  },
  {
    name: 'talk',
    frameCount: TALK_FRAMES,
    loops: true,
    pose: (f) => talkPose(cyclePhase(f, TALK_FRAMES)),
  },
];

function rowNamed(state: string): RowSpec | undefined {
  return SHADY_ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell of Shady, in the cell's own pixels. The pose is anchored at
 * the ground line under the cell's centre, which is what ties the art to the
 * tile he stands on.
 */
function paintShadyFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = rowNamed(state);
  if (row === undefined) return;
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE * SHADY_SCALE, TILE_SCALE * SHADY_SCALE);
  drawShady(ctx, row.pose(frame));
  ctx.restore();
}

function shadyStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of SHADY_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const SHADY_FIGURE: FigureDef = {
  id: 'shady',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(shadyStateFrames()),
  paintFrame: paintShadyFrame,
};
