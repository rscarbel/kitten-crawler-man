/**
 * The Lava Llama, as a painted figure: the choreography, the cell geometry, and
 * the `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `llamaArt.ts` and
 * `llamaGore.ts`.
 *
 * Rows:
 *    walk / walk_side / walk_away   — the pace, the camelid gait that rolls
 *                                     side to side rather than bobbing
 *    idle / idle_side / idle_away   — breathing, chewing, ear swivel, blink
 *    spit / spit_side / spit_away   — gather, charge up the throat, thrust,
 *                                     recover
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them.
 *
 * The art invariants live in `scripts/gates-llama.ts`, which the review harness
 * runs: `npm run render:llama`.
 */

import {
  GROUND_Y,
  type FootPose,
  type LlamaPose,
  type Pt,
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
} from './llamaArt';
import { llamaGorePieces } from './llamaGore';
import { type FigureDef, figureStates } from '../figure/figureDef';
// The release timing is shared with the runtime rather than copied here; see
// the header of that module for what goes wrong when the two drift.
import { LLAMA_SPIT_RELEASE_PROGRESS, LLAMA_SPIT_THRUST_SHARE } from '../llamaSpitTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

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

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * animal's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the
 * widest pose plus padding, quantised, widened until a spinning gore piece
 * clears the cell's inscribed circle — and `scripts/parity-figure-sheet.ts` is
 * what proved the painter still fills exactly that cell. The gates re-check
 * that nothing paints against the edge, which is what would say a pose has
 * outgrown them.
 */
const FRAME_WIDTH = 112;
const FRAME_HEIGHT = 112;
const TILE_X = 24;
const TILE_Y = 34;

/** Poses are painted with the origin on the tile's centre, at the cell's centre. */
const POSE_ORIGIN_X = FRAME_WIDTH / 2;
const POSE_ORIGIN_Y = TILE_Y + TILE_SCALE / 2;

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

export type View = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (t: number) => LlamaPose;
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
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

export const LLAMA_ROWS: readonly RowSpec[] = [
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
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

// ── Gore placement ───────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/**
 * How far each gore piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible
 * pixels, so a piece drawn off-centre in its cell orbits rather than tumbles.
 * The offsets are in the piece's own units, the same ones its `paint` is scaled
 * by, and they were measured from the painted ink of each piece. Measuring is
 * something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-llama.ts` re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_head', pt(0.046296296296296294, 0.04050925925925926)],
  ['gore_neck', pt(-0.011574074074074073, -0.023148148148148147)],
  ['gore_torso', pt(-0.01736111111111111, 0.005787037037037037)],
  ['gore_haunch', pt(0.046296296296296294, 0.04050925925925926)],
  ['gore_leg', pt(0.011574074074074073, 0.03472222222222222)],
  ['gore_ribcage', pt(0.011574074074074073, 0.005787037037037037)],
  ['gore_entrails', pt(0.01736111111111111, 0.011574074074074073)],
  ['gore_fleece', pt(-0.011574074074074073, 0.005787037037037037)],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): (typeof GORE_PIECES)[number] {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return LLAMA_ROWS.find((row) => row.name === state);
}

function paintView(ctx: CanvasRenderingContext2D, view: View, pose: LlamaPose): void {
  if (view === 'front') drawLlamaFront(ctx, pose);
  else if (view === 'back') drawLlamaBack(ctx, pose);
  else drawLlamaSide(ctx, pose);
}

/**
 * Paints one cell of the llama, in the cell's own pixels.
 *
 * A pose row is anchored on the centre of the creature's own tile, which is
 * what ties the art to the tile it stands on, and the animal's scale is applied
 * about its ground line so a taller llama still stands on that tile rather than
 * floating above it. A gore piece is anchored at the cell's centre instead,
 * because the only thing that reads its cell is the spin the gore field applies
 * about that point.
 */
function paintLlamaFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(
      FRAME_WIDTH / 2 + recentre.x * GORE_UNIT,
      FRAME_HEIGHT / 2 + recentre.y * GORE_UNIT,
    );
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(LLAMA_SCALE, LLAMA_SCALE);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function llamaStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of LLAMA_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const LLAMA_FIGURE: FigureDef = {
  id: 'llama',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(llamaStateFrames()),
  paintFrame: paintLlamaFrame,
};
