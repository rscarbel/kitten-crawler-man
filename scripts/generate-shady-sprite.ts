#!/usr/bin/env tsx
/**
 * Generates the `shady` sprite sheet — the hooded man who sells bounties beside
 * the town notice board.
 *
 * The anatomy and the painting live in `scripts/shadyArt.ts`; this file is the
 * choreography plus the bake gates.
 *
 * Rows (see the `shady` entry in src/images/npcs/manifest.json):
 *    0 idle    — looping fidget: weight shifts, hood lags, hands work the belt
 *    1 scratch — one-shot: a hand goes up under the back of the hood and back
 *    2 talk    — looping lean-in, played while his dialog is open
 *
 * He has one facing. He stands at a fixed spot facing the plaza and never
 * turns, so a profile and a back view would be twice the art for frames nothing
 * can reach.
 *
 * The gates live here rather than in a separate `.gates.ts` (the goblin/rat-kin
 * shape) because this figure has three rows and no gait: the sheet is baked into
 * memory, measured, and only written if every gate passes, which is the property
 * the split file exists to guarantee.
 *
 * Run: npx tsx scripts/generate-shady-sprite.ts   (npm run gen:shady)
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  buildSkeleton,
  clamp01,
  cowlWindow,
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
} from './shadyArt.js';

// ── Sheet geometry (must match the manifest entry) ───────────────────────────

export const FRAME_W = 128;
export const FRAME_H = 128;
/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
/** The tile sits low in the frame: his raised hand needs the room above it. */
export const TILE_Y = 62;
/** Where his soles sit inside the tile, matching the other humanoid sheets. */
const GROUND_OFFSET_IN_TILE = 0.9;
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/**
 * How much of a tile Shady fills. Set against Carl (2.03 tiles authored × 0.72)
 * so the two stand in the same street at plausible relative heights — Shady a
 * shade shorter, which is the point of his slouch.
 */
const SHADY_SCALE = 0.8;

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
 * Where the hand ends up: at the hood's lower back edge, level with his jaw —
 * the back of the *neck*. The first bake put it out beside the cowl at eye
 * level, which reads as adjusting a pair of sunglasses.
 */
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

export const ROWS: readonly RowSpec[] = [
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

// ── Bake ─────────────────────────────────────────────────────────────────────

export const SHEET_PATH = 'src/images/npcs/shady.png';
const MANIFEST_PATH = 'src/images/npcs/manifest.json';
const MANIFEST_KEY = 'shady';

interface BakedFrame {
  readonly row: number;
  readonly col: number;
  readonly name: string;
  /** RGBA at frame resolution (already downsampled). */
  readonly data: Uint8ClampedArray;
}

function paintFrame(frameCtx: Ctx, pose: ShadyPose): void {
  frameCtx.clearRect(0, 0, FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  frameCtx.save();
  frameCtx.translate(ORIGIN_X * SUPERSAMPLE, ORIGIN_Y * SUPERSAMPLE);
  frameCtx.scale(TILE_SCALE * SUPERSAMPLE, TILE_SCALE * SUPERSAMPLE);
  frameCtx.scale(SHADY_SCALE, SHADY_SCALE);
  drawShady(frameCtx, pose);
  frameCtx.restore();
}

function bake(): { sheet: Buffer; frames: BakedFrame[] } {
  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  const sheet = createCanvas(cols * FRAME_W, ROWS.length * FRAME_H);
  const sheetCtx = sheet.getContext('2d');

  const superFrame = createCanvas(FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  const superCtx = superFrame.getContext('2d');
  const downFrame = createCanvas(FRAME_W, FRAME_H);
  const downCtx = downFrame.getContext('2d');

  const frames: BakedFrame[] = [];
  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    for (let col = 0; col < spec.frameCount; col++) {
      paintFrame(superCtx, spec.pose(col));
      downCtx.clearRect(0, 0, FRAME_W, FRAME_H);
      downCtx.drawImage(
        superFrame,
        0,
        0,
        superFrame.width,
        superFrame.height,
        0,
        0,
        FRAME_W,
        FRAME_H,
      );
      frames.push({
        row,
        col,
        name: spec.name,
        data: downCtx.getImageData(0, 0, FRAME_W, FRAME_H).data,
      });
      sheetCtx.drawImage(downFrame, col * FRAME_W, row * FRAME_H);
    }
  }
  return { sheet: sheet.toBuffer('image/png'), frames };
}

// ── Gates ────────────────────────────────────────────────────────────────────

/** Alpha above which a pixel counts as ink. */
const INK_ALPHA = 8;

function alphaAt(data: Uint8ClampedArray, x: number, y: number): number {
  return data[(y * FRAME_W + x) * 4 + 3];
}

/**
 * G1 — a frame that paints outside its cell is sheared flat by the sheet blit
 * and baked in, which nothing downstream can detect.
 */
function gateBorderClip(frames: readonly BakedFrame[]): void {
  for (const frame of frames) {
    for (let x = 0; x < FRAME_W; x++) {
      if (alphaAt(frame.data, x, 0) > INK_ALPHA)
        throw new Error(`G1 ${frame.name}[${frame.col}] paints on the top edge at x=${x}`);
      if (alphaAt(frame.data, x, FRAME_H - 1) > INK_ALPHA)
        throw new Error(`G1 ${frame.name}[${frame.col}] paints on the bottom edge at x=${x}`);
    }
    for (let y = 0; y < FRAME_H; y++) {
      if (alphaAt(frame.data, 0, y) > INK_ALPHA)
        throw new Error(`G1 ${frame.name}[${frame.col}] paints on the left edge at y=${y}`);
      if (alphaAt(frame.data, FRAME_W - 1, y) > INK_ALPHA)
        throw new Error(`G1 ${frame.name}[${frame.col}] paints on the right edge at y=${y}`);
    }
  }
}

/**
 * Highest channel value any pixel inside the cowl may reach.
 *
 * Deliberately far below the hood's own darkest cloth: a blind review found the
 * first bake's brightest cowl pixel was *brighter* than the hood's shadow, which
 * is exactly when the darkness stops being a void and the lit part starts
 * reading as a brow with a mouth under it.
 */
const COWL_MAX_CHANNEL = 12;

/**
 * G2 — the hood interior is solid darkness at every frame.
 *
 * This is non-negotiable, and exactly the property a later palette tweak, a
 * stray highlight or a shifted brow lip could undo without anything else
 * looking wrong.
 */
function gateCowlIsVoid(frames: readonly BakedFrame[]): void {
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const spec = ROWS[frame.row];
    const window = cowlWindow(spec.pose(frame.col));
    const cx = ORIGIN_X + window.cx * TILE_SCALE * SHADY_SCALE;
    const cy = ORIGIN_Y + window.cy * TILE_SCALE * SHADY_SCALE;
    const rx = window.rx * TILE_SCALE * SHADY_SCALE;
    const ry = window.ry * TILE_SCALE * SHADY_SCALE;
    let sampled = 0;
    let worst = 0;
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
      for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) continue;
        const at = (y * FRAME_W + x) * 4;
        if (frame.data[at + 3] <= INK_ALPHA) {
          throw new Error(
            `G2 ${frame.name}[${frame.col}] has a hole in the cowl at (${x},${y}) — the hood is see-through`,
          );
        }
        sampled++;
        worst = Math.max(worst, frame.data[at], frame.data[at + 1], frame.data[at + 2]);
      }
    }
    if (sampled === 0) throw new Error(`G2 ${frame.name}[${frame.col}] sampled no cowl pixels`);
    if (worst > COWL_MAX_CHANNEL) {
      throw new Error(
        `G2 ${frame.name}[${frame.col}] cowl interior reaches ${worst} against a limit of ${COWL_MAX_CHANNEL} — a face is showing`,
      );
    }
  }
}

/** Below this the elbow is effectively on the shoulder→wrist line and its side is noise. */
const ELBOW_BEND_EPSILON = 1e-4;

/**
 * G3 — an elbow must never invert mid-row.
 *
 * The standard bipedal gate, and the one the scratch row exists to trip: an arm
 * authored by its hand target folds through the straight-arm singularity if the
 * target crosses the shoulder, and the elbow snaps to the other side for a
 * frame. Measured as the sign of the cross product of shoulder→elbow with
 * shoulder→wrist, which is which side of the limb's own line the joint sits on.
 */
function gateElbowNeverInverts(): void {
  for (const spec of ROWS) {
    for (const side of ['left', 'right'] as const) {
      let established = 0;
      for (let col = 0; col < spec.frameCount; col++) {
        const pose = spec.pose(col);
        // Measured through the art module's own solver, so the gate reads the
        // geometry the painter draws rather than a re-derivation of it.
        const skeleton = buildSkeleton(pose);
        const chain = side === 'left' ? skeleton.leftArm : skeleton.rightArm;
        const ax = chain.joint.x - chain.root.x;
        const ay = chain.joint.y - chain.root.y;
        const bx = chain.end.x - chain.root.x;
        const by = chain.end.y - chain.root.y;
        const cross = ax * by - ay * bx;
        if (Math.abs(cross) < ELBOW_BEND_EPSILON) continue;
        const sign = Math.sign(cross);
        if (established === 0) {
          established = sign;
          continue;
        }
        if (sign !== established) {
          throw new Error(
            `G3 ${spec.name}[${col}] ${side} elbow flipped to the other side of the arm (cross ${cross.toFixed(5)})`,
          );
        }
      }
    }
  }
}

/** Fraction above the median consecutive delta at which a loop seam counts as a pop. */
const LOOP_SEAM_LIMIT = 2.2;

function frameDelta(a: BakedFrame, b: BakedFrame): number {
  let sum = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]);
  }
  return sum;
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** G4 — a looping row that jumps at the seam pops once per cycle, forever. */
function gateLoopCloses(frames: readonly BakedFrame[]): void {
  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    if (!spec.loops || spec.frameCount < LOOP_GATE_MIN_FRAMES) continue;
    const rowFrames = frames.filter((f) => f.row === row);
    const steps: number[] = [];
    for (let i = 1; i < rowFrames.length; i++)
      steps.push(frameDelta(rowFrames[i - 1], rowFrames[i]));
    const seam = frameDelta(rowFrames[rowFrames.length - 1], rowFrames[0]);
    const typical = median(steps);
    if (typical > 0 && seam > typical * LOOP_SEAM_LIMIT) {
      throw new Error(
        `G4 ${spec.name} loop seam is ${seam.toFixed(0)} against a median step of ${typical.toFixed(0)}`,
      );
    }
  }
}

/** A two-frame loop has no median to compare a seam against. */
const LOOP_GATE_MIN_FRAMES = 4;

/** Fraction above the median step at which a one-shot's hand-off counts as a jump. */
const SETTLE_LIMIT = 2.5;

/**
 * G5 — a one-shot has to hand back to the pose the idle actually starts from,
 * or the figure snaps the instant the animation ends.
 */
function gateOneShotSettles(frames: readonly BakedFrame[]): void {
  const idleStart = frames.find((f) => f.row === 0 && f.col === 0);
  if (idleStart === undefined) throw new Error('G5 could not find idle frame 0');
  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    if (spec.loops) continue;
    const rowFrames = frames.filter((f) => f.row === row);
    const steps: number[] = [];
    for (let i = 1; i < rowFrames.length; i++)
      steps.push(frameDelta(rowFrames[i - 1], rowFrames[i]));
    const handOff = frameDelta(rowFrames[rowFrames.length - 1], idleStart);
    const typical = median(steps);
    if (typical > 0 && handOff > typical * SETTLE_LIMIT) {
      throw new Error(
        `G5 ${spec.name} ends ${handOff.toFixed(0)} away from idle frame 0, against a median step of ${typical.toFixed(0)}`,
      );
    }
  }
}

/** Pixels of slack allowed between the measured sole line and the declared tile floor. */
const ANCHOR_TOLERANCE_PX = 3;

/**
 * G6 — a redraw moves the tile anchor, and the health bar and quest marker key
 * off it. Measured rather than trusted.
 */
function gateAnchor(frames: readonly BakedFrame[]): void {
  const idleStart = frames.find((f) => f.row === 0 && f.col === 0);
  if (idleStart === undefined) throw new Error('G6 could not find idle frame 0');
  let lowest = -1;
  let leftmost = FRAME_W;
  let rightmost = -1;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (alphaAt(idleStart.data, x, y) <= INK_ALPHA) continue;
      lowest = Math.max(lowest, y);
      leftmost = Math.min(leftmost, x);
      rightmost = Math.max(rightmost, x);
    }
  }
  if (lowest < 0) throw new Error('G6 idle frame 0 is empty');
  if (Math.abs(lowest - ORIGIN_Y) > ANCHOR_TOLERANCE_PX) {
    throw new Error(
      `G6 his soles bake at y=${lowest} against a declared ground line of ${ORIGIN_Y.toFixed(1)}`,
    );
  }
  const centre = (leftmost + rightmost) / 2;
  if (Math.abs(centre - ORIGIN_X) > ANCHOR_CENTRE_TOLERANCE_PX) {
    throw new Error(
      `G6 he bakes centred on x=${centre.toFixed(1)} against a tile centre of ${ORIGIN_X}`,
    );
  }
  if (lowest >= TILE_Y + TILE_SCALE) {
    throw new Error(
      `G6 his soles at y=${lowest} fall below the tile (ends ${TILE_Y + TILE_SCALE})`,
    );
  }
}

/** He fidgets sideways, so his centre of ink is not pinned to the tile centre. */
const ANCHOR_CENTRE_TOLERANCE_PX = 6;

interface ManifestState {
  row: number;
  frameCount: number;
}
interface ManifestEntry {
  path: string;
  frameWidth: number;
  frameHeight: number;
  tileX: number;
  tileY: number;
  tileScale: number;
  states: Record<string, ManifestState>;
}

function expectedManifestEntry(): ManifestEntry {
  const states: Record<string, ManifestState> = {};
  ROWS.forEach((row, index) => {
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: 'npcs/shady.png',
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * G7 — the manifest is the single most common wiring bug after a redraw. The
 * generator prints the block and *verifies* it; it never writes it, so a change
 * of geometry is always a deliberate paste.
 */
function gateManifestSync(): void {
  const expected = expectedManifestEntry();
  const printed = JSON.stringify({ [MANIFEST_KEY]: expected }, null, 2);
  const raw: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  const fail = (why: string): never => {
    throw new Error(`G7 ${MANIFEST_PATH} is out of sync: ${why}\n\nPaste this block:\n${printed}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('not an object');
  const entry: unknown = Reflect.get(raw, MANIFEST_KEY);
  if (entry === undefined) return fail(`no "${MANIFEST_KEY}" entry`);
  if (JSON.stringify(entry) !== JSON.stringify(expected)) {
    return fail('the entry does not match the measured geometry');
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

function writeSheet(): void {
  console.log(
    `Generating Shady sprite sheet (${FRAME_W}×${FRAME_H}px frames, tileScale=${TILE_SCALE})…`,
  );
  const { sheet, frames } = bake();

  gateBorderClip(frames);
  gateCowlIsVoid(frames);
  gateElbowNeverInverts();
  gateLoopCloses(frames);
  gateOneShotSettles(frames);
  gateAnchor(frames);

  const outPath = resolve(SHEET_PATH);
  writeFileSync(outPath, sheet);
  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  console.log(`  → ${outPath}`);
  console.log(
    `  → ${cols * FRAME_W}×${ROWS.length * FRAME_H}px  (${ROWS.length} rows × ${cols} cols)`,
  );
  ROWS.forEach((r, i) => {
    console.log(`     row ${i}: ${r.name} (${r.frameCount} frames)`);
  });
  console.log(`tileX=${TILE_X}  tileY=${TILE_Y}  tileScale=${TILE_SCALE}`);
  console.log(
    `\nManifest block for ${MANIFEST_PATH}:\n${JSON.stringify({ [MANIFEST_KEY]: expectedManifestEntry() }, null, 2)}`,
  );
  gateManifestSync();
  console.log('\nAll gates passed.');
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}
