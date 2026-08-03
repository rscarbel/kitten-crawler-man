#!/usr/bin/env tsx
/**
 * Generates the `llama` sprite sheet — the Lava Llama that spits molten rock
 * from across a room on floors 1 and 2.
 *
 * The anatomy and the painting live in `scripts/llamaArt.ts`; this file is only
 * the choreography plus the bake: one pose function per animation row, sampled
 * per frame, then measured and laid out.
 *
 * Rows (see the `llama` entry in src/images/enemies/manifest.json):
 *    0 walk       — pacing toward the camera
 *    1 walk_side  — profile, drawn facing +X and mirrored at runtime
 *    2 walk_away  — pacing away, rump and tail toward the viewer
 *    3 idle       — breathing, chewing, ear swivel, blink
 *    4 idle_side
 *    5 idle_away
 *    6 spit       — gather, charge up the throat, thrust, recover
 *    7 spit_side
 *    8 spit_away
 *    9 gore       — the eight pieces, one per column
 *
 * The frame geometry is measured rather than declared: the neck alone is most
 * of a tile tall and it moves a long way across the spit, so a hand-guessed
 * cell is how the top of a reared head ends up sheared flat in the PNG.
 *
 * Run: npm run gen:llama
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  GROUND_Y,
  type FootPose,
  type LlamaPose,
  clamp01,
  deg,
  drawLlamaBack,
  drawLlamaFront,
  drawLlamaSide,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  TWO_PI,
} from './llamaArt.js';
import { llamaGorePieces } from './llamaGore.js';
// The release timing is shared with the runtime rather than copied here; see
// the header of that module for what goes wrong when the two drift.
import {
  LLAMA_SPIT_RELEASE_PROGRESS,
  LLAMA_SPIT_THRUST_SHARE,
} from '../src/sprites/llamaSpitTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the frame edge. */
const FRAME_PADDING = 6;
/** Frame dimensions are rounded up to this so the sheet stays tidily aligned. */
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

/**
 * How much of a tile the llama fills, scaled about its own ground line so its
 * feet stay on the tile they belong to.
 *
 * A real llama stands well over head height on a human, and drawn to that scale
 * next to Carl it would be a boss rather than a room-filler. This is the
 * compromise: tall enough that the neck still reads as the animal's whole
 * silhouette, short enough that two of them in a corridor are not a wall.
 */
const LLAMA_SCALE = 1.28;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 8;
const SPIT_FRAMES = 10;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const PLANTED: FootPose = { dx: 0, dy: 0, lift: 0, splay: 0.5 };

function foot(dx: number, dy: number, lift: number, splay = 0.5): FootPose {
  return { dx, dy, lift, splay };
}

const BLINK_HOLD = 0.06;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

/**
 * A foot in the pace: a long swing forward with real clearance, then a stance
 * dragging back. Llamas have a lot of leg and use it — unlike the rat, the
 * swing here is high and slow, and shortening it is what makes a llama walk
 * read as a scuttle.
 */
const SWING_SHARE = 0.44;

function gaitFoot(phase: number, reach: number, height: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const dx = swinging ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  const lift = swinging ? hump(t) : 0;
  return { dx, dy: -lift * height, lift, splay: lerp(0.75, 0.15, lift) };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_BOB = 0.014;
const WALK_SWAY = 0.022;
const WALK_REACH_SIDE = 0.1;
/** Foot clearance on the swing, in tile units. */
const WALK_LIFT_SIDE = 0.07;
const WALK_NECK_NOD = deg(3.5);

/**
 * Llamas — like every camelid — *pace*: the fore and hind leg on the same side
 * swing together, rather than diagonally as a horse or a rat trots. That is why
 * this walk rolls from side to side instead of bobbing, and it is the single
 * most identifiable thing about how the animal moves. Diagonalising these
 * phases would turn it back into a generic quadruped.
 */
function paceFeet(
  phase: number,
  reach: number,
  lift: number,
): Pick<LlamaPose, 'frontL' | 'frontR' | 'hindL' | 'hindR'> {
  return {
    frontL: gaitFoot(phase, reach, lift),
    hindL: gaitFoot(phase, reach * 1.05, lift * 0.9),
    frontR: gaitFoot(phase + 0.5, reach, lift),
    hindR: gaitFoot(phase + 0.5, reach * 1.05, lift * 0.9),
  };
}

function walkSide(phase: number): LlamaPose {
  const angle = phase * TWO_PI;
  return {
    ...restPose(),
    // One bob per stride rather than two: a pacer rises once as the swinging
    // pair leaves the floor, which is the visual signature of the gait.
    bob: -WALK_BOB * Math.cos(angle),
    lean: deg(1.6) * Math.sin(angle),
    neckLean: WALK_NECK_NOD * Math.sin(angle),
    neckCurve: deg(4) * Math.sin(angle + Math.PI / 3),
    headPitch: deg(-3) * Math.sin(angle),
    earL: 0.45 + 0.3 * Math.sin(angle * 2),
    earR: 0.45 - 0.3 * Math.sin(angle * 2),
    eyeOpen: blink(phase, 0.4),
    tailLift: 0.35 + 0.2 * Math.sin(angle),
    tailSway: Math.sin(angle * 2),
    ...paceFeet(phase, WALK_REACH_SIDE, WALK_LIFT_SIDE),
    breathe: Math.sin(angle),
    time: phase,
  };
}

/**
 * Head-on, a foot does not swing across the body — it lifts, tracks slightly
 * inward under the chest, and plants a little further down the screen as it
 * comes toward the camera.
 */
const WALK_AXIAL_LIFT = 0.14;
const WALK_AXIAL_TRACK_IN = 0.022;
const WALK_AXIAL_PLANT = 0.014;

function axialStep(phase: number, side: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const lift = swinging ? hump(t) : 0;
  const trackIn = swinging ? Math.sin(t * Math.PI) : 0;
  const plant = swinging ? 0 : WALK_AXIAL_PLANT * hump(t);
  return {
    dx: -side * WALK_AXIAL_TRACK_IN * trackIn,
    dy: plant - WALK_AXIAL_LIFT * lift,
    lift,
    splay: lerp(0.72, 0.18, lift),
  };
}

function walkFront(phase: number): LlamaPose {
  const angle = phase * TWO_PI;
  // The pace throws the whole body over the standing side, and head-on that
  // roll is the entire animation — there is no stride length to show.
  const sway = WALK_SWAY * Math.sin(angle);
  return {
    ...restPose(),
    bob: -WALK_BOB * Math.cos(angle),
    sway,
    lean: deg(4.5) * Math.sin(angle),
    neckLean: 0,
    neckCurve: deg(2) * Math.sin(angle),
    headTurn: 0.12 * Math.sin(angle),
    headTilt: deg(-3) * Math.sin(angle),
    earL: 0.5,
    earR: 0.5,
    eyeOpen: blink(phase, 0.7),
    tailLift: 0.3,
    tailSway: Math.sin(angle),
    frontL: axialStep(phase, -1),
    hindL: axialStep(phase, -1),
    frontR: axialStep(phase + 0.5, 1),
    hindR: axialStep(phase + 0.5, 1),
    breathe: Math.sin(angle),
    time: phase,
  };
}

function walkBack(phase: number): LlamaPose {
  const front = walkFront(phase);
  return {
    ...front,
    // Seen from behind the same pace rolls the other way on screen, and the
    // rump swings where the chest did.
    sway: -front.sway,
    lean: -front.lean,
    headTurn: -front.headTurn,
    headTilt: -front.headTilt,
    tailLift: 0.45,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BREATH = 0.006;
/**
 * A standing llama chews almost continuously. The jaw is the cue that separates
 * an idle llama from a stopped one, and it runs far faster than the breath.
 */
const IDLE_CHEW_CYCLES = 6;
const IDLE_CHEW_DEPTH = 0.16;

function idleSide(phase: number): LlamaPose {
  const angle = phase * TWO_PI;
  const chew = (Math.sin(angle * IDLE_CHEW_CYCLES) + 1) / 2;
  return {
    ...restPose(),
    bob: IDLE_BREATH * Math.sin(angle),
    breathe: Math.sin(angle),
    neckLean: deg(2.5) * Math.sin(angle * 0.5),
    neckCurve: deg(-3) + deg(2) * Math.sin(angle * 0.5),
    headPitch: deg(2) * Math.sin(angle * 0.5),
    // Ears swivel independently and out of phase — a llama almost never has
    // them aimed at the same thing, and matching them reads as a toy.
    earL: 0.55 + 0.4 * Math.sin(angle * 2),
    earR: 0.55 - 0.4 * Math.sin(angle * 2 + 1.1),
    eyeOpen: blink(phase, 0.6),
    jaw: chew * IDLE_CHEW_DEPTH,
    tailLift: 0.3 + 0.1 * Math.sin(angle),
    tailSway: 0.4 * Math.sin(angle * 1.5),
    time: phase,
  };
}

function idleFront(phase: number): LlamaPose {
  const angle = phase * TWO_PI;
  return {
    ...idleSide(phase),
    headTurn: 0.2 * Math.sin(angle * 0.5),
    headTilt: deg(3) * Math.sin(angle * 0.5),
  };
}

function idleBack(phase: number): LlamaPose {
  const angle = phase * TWO_PI;
  return {
    ...idleSide(phase),
    tailLift: 0.4 + 0.15 * Math.sin(angle),
    headTurn: -0.15 * Math.sin(angle * 0.5),
  };
}

// ── Spit ─────────────────────────────────────────────────────────────────────

/**
 * The thrust window, derived from the shared release fraction rather than
 * declared: the ball launches at the middle of the whip, so putting the whip
 * anywhere else would fire it on a pose where the neck has not moved yet.
 */
const SPIT_GATHER_END = LLAMA_SPIT_RELEASE_PROGRESS - LLAMA_SPIT_THRUST_SHARE / 2;
const SPIT_THRUST_END = LLAMA_SPIT_RELEASE_PROGRESS + LLAMA_SPIT_THRUST_SHARE / 2;
/** How far the whole animal drives forward on the thrust, in tile units. */
const SPIT_LUNGE_REACH = 0.1;

interface SpitPhases {
  /** Neck reeling back and the charge climbing the throat. */
  readonly gather: number;
  /** The forward whip of the neck that launches the ball. */
  readonly thrust: number;
  readonly recover: number;
  readonly jaw: number;
  readonly lip: number;
  /** How much of a charge is showing in the throat right now. */
  readonly charge: number;
}

function spitPhases(progress: number): SpitPhases {
  const gather = easeInOut(ramp(progress, 0, SPIT_GATHER_END));
  const thrust = easeInOut(ramp(progress, SPIT_GATHER_END, SPIT_THRUST_END));
  const recover = easeInOut(ramp(progress, SPIT_THRUST_END, 1));
  return {
    gather,
    thrust,
    recover,
    // The mouth opens late and shuts almost at once: the ball is out of it in a
    // couple of frames, and a llama that holds a gape looks like it is yawning.
    jaw: easeInOut(ramp(progress, 0.34, 0.5)) * (1 - easeInOut(ramp(progress, 0.6, 0.74))),
    // The lip peels back before the mouth opens and stays curled into the
    // recovery — the disgusted sneer is the half of this that reads at tile size.
    lip: easeInOut(ramp(progress, 0.1, 0.36)) * (1 - easeInOut(ramp(progress, 0.78, 1))),
    // The charge climbs the neck across the whole gather and is gone the instant
    // the thrust launches it, which is what makes the glow a usable warning.
    // The glow has to be gone the instant the thrust launches the ball, so it
    // fades across the whip rather than over a window of its own.
    charge:
      clamp01(ramp(progress, 0.05, SPIT_GATHER_END)) *
      (1 - clamp01(ramp(progress, SPIT_GATHER_END, LLAMA_SPIT_RELEASE_PROGRESS))),
  };
}

function spitSide(progress: number): LlamaPose {
  const s = spitPhases(progress);
  const drive = s.thrust * (1 - s.recover);
  // The coil has to unwind on the recovery as well as be overridden by the
  // thrust. Left as a bare `gather`, every one of these values is still at full
  // reel-back on the last frame, so the animation ends with the neck thrown
  // backwards and snaps to rest the instant the row stops playing.
  const coil = s.gather * (1 - s.recover);
  return {
    ...restPose(),
    lunge: SPIT_LUNGE_REACH * drive,
    bob: 0.014 * coil - 0.01 * drive,
    lean: deg(-4) * coil + deg(6) * drive,
    squash: 1 - 0.03 * drive,
    // The neck rocks back into a deep S on the gather and is whipped forward and
    // almost straight on the thrust. That reversal is the whole attack.
    neckLean: deg(-30) * coil + deg(50) * drive,
    neckCurve: deg(18) * coil - deg(24) * drive,
    neckCompress: coil * 0.8,
    headPitch: deg(16) * coil - deg(28) * drive,
    // Ears pinned flat: the universal mammal tell that something is coming.
    earL: -1,
    earR: -1,
    eyeOpen: lerp(1, 0.45, coil),
    jaw: s.jaw,
    lipCurl: s.lip,
    charge: s.charge,
    tailLift: 0.8 * coil,
    tailSway: -drive,
    frontL: foot(0.03 * drive, 0, 0, 0.8),
    frontR: foot(0.05 * drive, 0, 0, 0.8),
    // The hind pair braces back against the thrust rather than following it —
    // without the brace the whole animal reads as sliding forward on ice.
    hindL: foot(-0.04 * drive, 0, 0, 0.9),
    hindR: foot(-0.06 * drive, 0, 0, 0.9),
    breathe: coil,
    time: progress,
  };
}

function spitFront(progress: number): LlamaPose {
  const s = spitPhases(progress);
  const drive = s.thrust * (1 - s.recover);
  const coil = s.gather * (1 - s.recover);
  return {
    ...spitSide(progress),
    // Head-on there is no forward reach to show, so the thrust is sold by the
    // head dropping toward the camera and the chest squashing wide instead.
    lunge: 0,
    neckLean: 0,
    neckCurve: deg(7) * coil - deg(10) * drive,
    neckCompress: coil * 0.55 + drive * 0.35,
    squash: 1 - 0.07 * drive,
    lean: deg(2) * Math.sin(progress * TWO_PI) * drive,
    headPitch: deg(9) * coil - deg(15) * drive,
    headTurn: 0,
    headTilt: 0,
    frontL: foot(-0.02 * drive, 0, 0, 0.85),
    frontR: foot(0.02 * drive, 0, 0, 0.85),
    hindL: PLANTED,
    hindR: PLANTED,
  };
}

function spitBack(progress: number): LlamaPose {
  const s = spitPhases(progress);
  const drive = s.thrust * (1 - s.recover);
  const coil = s.gather * (1 - s.recover);
  return {
    ...spitFront(progress),
    // From behind the spit is all rump and neck: the head is hidden past the
    // shoulders and the charge in the throat is the only part of it that shows.
    // Anything more expressive here would be invented.
    lean: -deg(3) * coil + deg(4) * drive,
    tailLift: 0.9 * coil,
    hindL: foot(-0.03 * coil, 0, 0, 0.9),
    hindR: foot(0.03 * coil, 0, 0, 0.9),
  };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((t: number) => LlamaPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const GORE_PIECES = llamaGorePieces();

/**
 * Extra scale applied to the gore pieces on top of `LLAMA_SCALE`.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * animal, so they do not inherit its scale — but they do have to survive the
 * runtime's own 0.5x. Held at 1 they come out around six screen pixels across,
 * below the size at which one shape can be told from another.
 */
const GORE_PIECE_SCALE = 1.35;

/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

export const ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => walkFront(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => walkBack(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'spit',
    frameCount: SPIT_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => spitFront(shotProgress(f, SPIT_FRAMES)),
  },
  {
    name: 'spit_side',
    frameCount: SPIT_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => spitSide(shotProgress(f, SPIT_FRAMES)),
  },
  {
    name: 'spit_away',
    frameCount: SPIT_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => spitBack(shotProgress(f, SPIT_FRAMES)),
  },
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    kind: 'gore',
    view: 'side',
    pose: null,
  },
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

// ── Bake ─────────────────────────────────────────────────────────────────────

interface Pt {
  readonly x: number;
  readonly y: number;
}

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  /**
   * Animation cells anchor on the painter's own origin; gore cells anchor on
   * the centre of the cell, so every piece is measured and laid out about the
   * same point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  /** Shift applied to a gore piece so its painted ink lands on the cell centre. */
  readonly recentre: Pt;
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = GORE_PIECES[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          recentre,
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * GORE_UNIT, originY + recentre.y * GORE_UNIT);
            ctx.scale(GORE_UNIT, GORE_UNIT);
            piece.paint(ctx);
            ctx.restore();
          },
        });
        continue;
      }

      const { pose, view } = row;
      if (pose === null) throw new Error(`row "${row.name}" is not gore but has no pose function`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line so a taller llama still stands on the
          // tile its feet belong to rather than floating above it.
          ctx.translate(0, GROUND_Y);
          ctx.scale(LLAMA_SCALE, LLAMA_SCALE);
          ctx.translate(0, -GROUND_Y);
          if (view === 'front') drawLlamaFront(ctx, pose(frame));
          else if (view === 'back') drawLlamaBack(ctx, pose(frame));
          else drawLlamaSide(ctx, pose(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;
/** Scratch canvas for measurement; comfortably larger than any cell can be. */
const MEASURE_SIZE = 512;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxOf(ctx: Ctx, width: number, height: number): InkBox | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

interface Extents {
  /** Furthest the animation rows reach from the painter's origin, in pixels. */
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /** Furthest any gore piece reaches from its own ink centre, in pixels. */
  readonly goreRadius: number;
  /** Shift, in tile units, that puts each gore piece's ink on the cell centre. */
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Frames that painted nothing — the signature of a NaN pose. */
  readonly blankFrames: readonly string[];
}

function measure(jobs: readonly FrameJob[]): Extents {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(ctx, originX, originY);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      // A severed limb has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it. This offset
      // pulls the ink back to the middle, which is what makes `goreRadius`
      // below a meaningful measure of how big the pieces actually are.
      goreOffsets.set(job.frame, {
        x: job.recentre.x + (originX - inkCentreX) / GORE_UNIT,
        y: job.recentre.y + (originY - inkCentreY) / GORE_UNIT,
      });
      const halfWidth = (box.maxX - box.minX) / 2;
      const halfHeight = (box.maxY - box.minY) / 2;
      goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight));
      continue;
    }

    left = Math.max(left, originX - box.minX);
    right = Math.max(right, box.maxX - originX);
    up = Math.max(up, originY - box.minY);
    down = Math.max(down, box.maxY - originY);
  }

  return { left, right, up, down, goreRadius, goreOffsets, blankFrames };
}

export interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function geometryFor(extents: Extents): SheetGeometry {
  // Both axes have to clear the gore radius: a spinning piece sweeps the cell's
  // *inscribed* circle, so a cell wide enough but not tall enough still clips.
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(
    Math.max(originY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
  return {
    frameWidth,
    frameHeight,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: originY - TILE_SCALE / 2,
  };
}

export interface BakedSheet {
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

function bake(): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs());
  const jobs = buildJobs(measured.goreOffsets);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `these frames painted nothing, which almost always means a NaN in the pose: ${extents.blankFrames.join(', ')}`,
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  // Every cell is at least as wide and as tall as the longest piece's sweep, so
  // rotation safety holds by construction. What is worth policing is the cost:
  // one long piece can quietly inflate all ten rows to suit itself.
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the animation ` +
        `rows need — shrink the longest piece rather than paying for it on all ${ROWS.length} rows`,
    );
  }
  if (inflation > 1) {
    console.log(`  gore widens each cell to ${inflation.toFixed(2)}x the animation rows' own size`);
  }
  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const sheet = createCanvas(columns * geometry.frameWidth, ROWS.length * geometry.frameHeight);
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  const rowIndexOf = new Map(ROWS.map((row, index) => [row.name, index]));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in ROWS`);

    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
    job.paint(cellCtx, geometry.frameWidth / 2, originY);
    cellCtx.restore();

    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      job.frame * geometry.frameWidth,
      rowIndex * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );
  }

  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

export const SHEET_PATH = 'src/images/enemies/llama.png';
const MANIFEST_PATH = 'src/images/enemies/manifest.json';

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
  readonly colOffset?: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

/** The manifest entry this bake requires, printed so it can be pasted in. */
function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  ROWS.forEach((row, index) => {
    if (row.kind === 'gore') {
      GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: 'enemies/llama.png',
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * A stable string for comparing two manifest entries.
 *
 * Key order in JSON carries no meaning, so a hand-edit that reorders `tileX` and
 * `tileY` must not read as a mismatch.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

/**
 * Checks `manifest.json` against the bake rather than rewriting it: other agents
 * work in this repo, and a programmatic rewrite of a shared file would clobber
 * their edits. A mismatch prints the entry to paste and fails the run — a sheet
 * on disk that its manifest does not describe renders as garbage.
 */
function verifyManifest(sheet: BakedSheet): void {
  const required = manifestEntryFor(sheet);
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  if (canonicalJson(manifest.llama) !== canonicalJson(required)) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "llama" entry with:\n` +
        `${JSON.stringify(required, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheet(): void {
  console.log(`Generating llama sprite sheet (tileScale=${TILE_SCALE}, scale=${LLAMA_SCALE})…`);
  const sheet = bake();
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);

  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${sheet.columns * sheet.geometry.frameWidth}×${ROWS.length * sheet.geometry.frameHeight}px  ` +
      `(${ROWS.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  verifyManifest(sheet);
}

// The review harness imports ROWS from here, so painting the sheet has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}

export { bake, geometryFor, measure };
