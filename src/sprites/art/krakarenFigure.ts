/**
 * The Krakaren Clone, her guard tentacle and her slam tentacle, as painted
 * figures: the choreography, the cell geometry, and the three `FigureDef`s the
 * runtime cache and the review harness both draw through.
 *
 * This module is choreography and tiling only. Anatomy, palette and every
 * stroke of paint live in `krakarenArt.ts`, the severed pieces in
 * `krakarenGore.ts`, and every row length in `../krakarenAttackTiming.ts` —
 * the one place the runtime and the painter agree about when a tentacle
 * connects.
 *
 * Three figures rather than one for the reason the troglodyte's tongue is its
 * own figure: the slam tentacle rises two and a half tiles and the guard
 * tentacle erupts wherever the player is standing, so folding either into the
 * body's cells would inflate all ninety of them.
 *
 * Side rows are painted facing +X and mirrored by the runtime's `flipX`, the
 * way every other creature in the game handles a profile; there is no separate
 * leftward pose to keep in step.
 *
 * Every loop runs a whole number of cycles across its row and no row runs more
 * than one: eight to ten frames cannot carry a faster oscillation than that
 * without the sampled cycle aliasing into a strobe or a freeze.
 *
 * The art invariants live in `scripts/gates-krakaren.ts`, which the review
 * harness runs: `npm run render:krakaren`.
 */

import { type Pt, clamp01 } from './carlArt';
import {
  type GuardTentaclePose,
  type KrakarenPose,
  type KrakarenView,
  type SlamTentaclePose,
  drawGuardTentacle,
  drawKrakarenBack,
  drawKrakarenFront,
  drawKrakarenSide,
  drawSlamTentacle,
  restingKrakarenPose,
} from './krakarenArt';
import {
  GORE_PIECE_SCALE,
  type GorePiece,
  krakarenGorePieces,
  krakarenTentacleGorePieces,
} from './krakarenGore';
import { TWO_PI } from './ratArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  GUARD_TENTACLE_EMERGE_FRAMES,
  GUARD_TENTACLE_IDLE_FRAMES,
  GUARD_TENTACLE_RETREAT_FRAMES,
  GUARD_TENTACLE_STRIKE_FRAMES,
  KRAKAREN_CHANNEL_FRAMES,
  KRAKAREN_IDLE_FRAMES,
  KRAKAREN_SWIPE_FRAMES,
  KRAKAREN_SWIPE_IMPACT_PROGRESS,
  SLAM_TENTACLE_DIVE_FRAMES,
  SLAM_TENTACLE_LOOM_FRAMES,
  SLAM_TENTACLE_RISE_FRAMES,
  SLAM_TENTACLE_SMASH_FRAMES,
} from '../krakarenAttackTiming';

type Ctx = CanvasRenderingContext2D;

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * Where the ground line sits inside the tile, in pixels of the tile the art is
 * drawn at — the same line every other dungeon creature stands on. Held in
 * whole pixels so `tileY` comes out an integer: a fractional anchor puts every
 * blit on a half pixel and softens the whole sprite for nothing.
 */
export const GROUND_OFFSET_PX = 58;

/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

/**
 * Cell geometry measured by the bake that produced the sheets these figures
 * replace: the widest pose plus its clear padding, quantised, with the anchor
 * that ties the cell to the tile the creature stands on. Frozen here because
 * nothing can measure ink at runtime; `scripts/gates-krakaren.ts` repaints the
 * art and re-measures it against these numbers on every render.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

const BODY_CELL: CellGeometry = { frameWidth: 216, frameHeight: 184, tileX: 76, tileY: 100 };
const GUARD_CELL: CellGeometry = { frameWidth: 232, frameHeight: 160, tileX: 84, tileY: 48 };
const SLAM_CELL: CellGeometry = { frameWidth: 224, frameHeight: 288, tileX: 80, tileY: 113 };

// ── Pose sampling ────────────────────────────────────────────────────────────

/**
 * Loops sample the cycle evenly and never sample 1, so the last frame hands
 * back to the first without repeating it.
 */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/** One-shots sample end to end: the last frame is the row's full progress. */
function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

/**
 * Wide enough that three of the ten idle frames fall inside it. A blink
 * narrower than the frame spacing is sampled by one frame and snaps shut and
 * open again between two cells.
 *
 * Built as a smoothstep peaking at its own centre rather than as a `hump` of
 * the distance, which is zero at the centre of its own window and fires the
 * blink twice.
 */
const BLINK_WIDTH = 0.18;
const BLINK_AT = 0.7;

/** Half a cycle — the offset that centres a wrapped phase distance on zero. */
const HALF_CYCLE = 0.5;

const SMOOTHSTEP_LINEAR_GAIN = 3;
const SMOOTHSTEP_CURVE_GAIN = 2;

/** The classic 0→1 ease: flat at both ends, steepest through the middle. */
function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (SMOOTHSTEP_LINEAR_GAIN - SMOOTHSTEP_CURVE_GAIN * c);
}

/** A -1→1 wave remapped onto 0→1, which is how every swell here is driven. */
function unipolar(wave: number): number {
  return wave * HALF_CYCLE + HALF_CYCLE;
}

function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 1 + HALF_CYCLE) % 1) - HALF_CYCLE);
  if (distance > BLINK_WIDTH) return 0;
  return smoothstep(1 - distance / BLINK_WIDTH);
}

// ── Body: idle ───────────────────────────────────────────────────────────────

/**
 * One coil cycle per row and no more. The travelling wave down each tentacle is
 * the slowest-reading motion she has, and at ten samples a cycle it is already
 * close to the point where the coil reads as a shiver instead of a roll.
 */
const IDLE_COIL_CYCLES = 1;
const IDLE_MOUTH_CYCLES = 1;
const IDLE_BREATH_SWING = 0.42;
/** The whole mass rides up on the breath — she is a bag of water, not a rock. */
const IDLE_HEAVE = 0.035;
const IDLE_GAZE_DRIFT = 0.45;
/** The beak never fully closes: a chitin line that never moves reads as painted on. */
const IDLE_BEAK_GAPE = 0.18;
const RESTING_BREATH = restingKrakarenPose().breath;

function idlePose(phase: number): KrakarenPose {
  const breath = Math.sin(phase * TWO_PI);
  const pose = restingKrakarenPose();
  pose.coil = phase * IDLE_COIL_CYCLES;
  pose.breath = RESTING_BREATH + breath * IDLE_BREATH_SWING;
  pose.mouthCycle = phase * IDLE_MOUTH_CYCLES;
  pose.heave = -IDLE_HEAVE * unipolar(breath);
  pose.blink = blink(phase, BLINK_AT);
  // On its own slow beat rather than on the breath's: two things moving on one
  // clock read as one mechanism.
  pose.gaze = Math.sin(phase * TWO_PI * IDLE_GAZE_BEATS) * IDLE_GAZE_DRIFT;
  pose.beakGape = IDLE_BEAK_GAPE * unipolar(Math.cos(phase * TWO_PI));
  return pose;
}

/** Not a whole number of breaths, so the gaze and the breath never lock. */
const IDLE_GAZE_BEATS = 0.5;

// ── Body: the melee swipe ────────────────────────────────────────────────────

/**
 * Which ring tentacle lashes, per view.
 *
 * Each is picked so its root sits out on a flank of the ring *and* in front of
 * the mantle in that view — the ring's azimuth is offset by the camera, so the
 * index that reads as a near flank limb is different in each of the three.
 * A lash chosen behind the dome is drawn under it and the attack is invisible,
 * and a crown limb chosen to lash arches inward over the mantle instead of out
 * across the melee arc, which leaves the impact frame narrower than the wind-up.
 */
const SWIPE_TENTACLE_BY_VIEW: Record<KrakarenView, number> = { front: 2, side: 2, back: 8 };

const SWIPE_BREATH_SWING = 0.2;
const SWIPE_BRACE = 0.22;
/** She screams into the blow: the beak is widest on the frame the damage fires. */
const SWIPE_BEAK_GAPE = 0.85;
const SWIPE_GAZE = 0.8;
const SWIPE_HEAVE = 0.05;

/**
 * The melee lash. Everything that has to land on the damage frame is keyed off
 * `KRAKAREN_SWIPE_IMPACT_PROGRESS`, the same constant `KrakarenClone` counts
 * its damage frame off, so the peak of the motion and the moment of the blow
 * cannot drift apart.
 *
 * The body's own cycles run exactly once across the row, which puts the last
 * frame back on the first frame's pose — the one-shot has something to settle
 * onto and the hand-off back to the idle is not a snap.
 */
function swipePose(progress: number, view: KrakarenView): KrakarenPose {
  const p = clamp01(progress);
  const pose = restingKrakarenPose();
  const drive = impactPeak(p, KRAKAREN_SWIPE_IMPACT_PROGRESS);
  pose.coil = p;
  pose.breath = RESTING_BREATH + Math.sin(p * TWO_PI) * SWIPE_BREATH_SWING;
  pose.mouthCycle = p;
  pose.brace = drive * SWIPE_BRACE;
  pose.beakGape = drive * SWIPE_BEAK_GAPE;
  pose.gaze = drive * SWIPE_GAZE;
  pose.heave = -drive * SWIPE_HEAVE;
  pose.swipe = { tentacle: SWIPE_TENTACLE_BY_VIEW[view], progress: p };
  return pose;
}

/** A 0→1→0 shape whose peak sits exactly on `peak`, and which is 0 at both ends. */
function impactPeak(t: number, peak: number): number {
  const c = clamp01(t);
  const rising = c <= peak ? c / peak : 1 - (c - peak) / (1 - peak);
  return smoothstep(rising);
}

// ── Body: the slam channel ───────────────────────────────────────────────────

/**
 * Braced hard and held there. The channel plays through the slam telegraph, and
 * its whole job is to be a different silhouette from the idle at a 32 px tile:
 * the dome compresses onto the ring, the tentacles pull taut and root, and the
 * coil nearly stops.
 */
const CHANNEL_BRACE_BASE = 0.82;
const CHANNEL_BRACE_TREMOR = 0.18;
const CHANNEL_COIL_CYCLES = 1;
const CHANNEL_MOUTH_CYCLES = 1;
const CHANNEL_BREATH = 0.18;
const CHANNEL_BREATH_SWING = 0.14;
/** Every mouth on her opens together while she channels. That is the tell. */
const CHANNEL_MOUTH_SPREAD = 0.25;
const CHANNEL_BEAK_GAPE = 0.7;
const CHANNEL_HEAVE = 0.045;

function channelPose(phase: number): KrakarenPose {
  const tremor = Math.sin(phase * TWO_PI);
  const pose = restingKrakarenPose();
  pose.coil = phase * CHANNEL_COIL_CYCLES;
  pose.brace = CHANNEL_BRACE_BASE + tremor * CHANNEL_BRACE_TREMOR;
  pose.breath = CHANNEL_BREATH + tremor * CHANNEL_BREATH_SWING;
  pose.mouthCycle = phase * CHANNEL_MOUTH_CYCLES;
  pose.mouthSpread = CHANNEL_MOUTH_SPREAD;
  pose.beakGape = CHANNEL_BEAK_GAPE;
  pose.heave = CHANNEL_HEAVE * unipolar(tremor);
  pose.blink = 0;
  return pose;
}

// ── Guard tentacle ───────────────────────────────────────────────────────────

/**
 * One sway cycle per row everywhere, including the one-shots: the sway drives
 * both the base angle and the travelling wave through a sine, so a whole cycle
 * leaves an emerge or a retreat ending on the same lie it started from.
 */
const GUARD_SWAY_CYCLES = 1;
const GUARD_MOUTH_CYCLES = 1;

function guardEmergePose(progress: number): GuardTentaclePose {
  return {
    phase: 'emerge',
    progress: clamp01(progress),
    strikeView: 'front',
    sway: progress * GUARD_SWAY_CYCLES,
    mouthCycle: progress * GUARD_MOUTH_CYCLES,
  };
}

function guardIdlePose(phase: number): GuardTentaclePose {
  return {
    phase: 'idle',
    progress: 0,
    strikeView: 'front',
    sway: phase * GUARD_SWAY_CYCLES,
    mouthCycle: phase * GUARD_MOUTH_CYCLES,
  };
}

function guardStrikePose(progress: number, view: KrakarenView): GuardTentaclePose {
  return {
    phase: 'strike',
    progress: clamp01(progress),
    strikeView: view,
    sway: progress * GUARD_SWAY_CYCLES,
    mouthCycle: progress * GUARD_MOUTH_CYCLES,
  };
}

function guardRetreatPose(progress: number): GuardTentaclePose {
  return {
    phase: 'retreat',
    progress: clamp01(progress),
    strikeView: 'front',
    sway: progress * GUARD_SWAY_CYCLES,
    mouthCycle: progress * GUARD_MOUTH_CYCLES,
  };
}

// ── Slam tentacle ────────────────────────────────────────────────────────────

/**
 * The loom's coil is the only motion the risen tentacle has, and it has eight
 * frames to show it in — one cycle, which is four samples to a half-turn and
 * already the coarsest a quiver can be sampled and still read as one.
 */
const SLAM_COIL_CYCLES = 1;
const SLAM_MOUTH_CYCLES = 1;

function slamPose(
  phase: SlamTentaclePose['phase'],
  progress: number,
  cycle: number,
): SlamTentaclePose {
  return {
    phase,
    progress: clamp01(progress),
    coil: cycle * SLAM_COIL_CYCLES,
    mouthCycle: cycle * SLAM_MOUTH_CYCLES,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  /** Null where the row has no single view: the slam tentacle is one shape seen from one side. */
  readonly view: KrakarenView | null;
  /** Paints one frame in tile units about the subject's ground point. */
  readonly draw: (ctx: Ctx, frame: number) => void;
}

function paintBody(ctx: Ctx, view: KrakarenView, pose: KrakarenPose): void {
  if (view === 'front') drawKrakarenFront(ctx, pose);
  else if (view === 'back') drawKrakarenBack(ctx, pose);
  else drawKrakarenSide(ctx, pose);
}

export const BODY_ROWS: readonly RowSpec[] = [
  {
    name: 'idle',
    frameCount: KRAKAREN_IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    draw: (ctx, f) => paintBody(ctx, 'front', idlePose(cyclePhase(f, KRAKAREN_IDLE_FRAMES))),
  },
  {
    name: 'idle_side',
    frameCount: KRAKAREN_IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    draw: (ctx, f) => paintBody(ctx, 'side', idlePose(cyclePhase(f, KRAKAREN_IDLE_FRAMES))),
  },
  {
    name: 'idle_away',
    frameCount: KRAKAREN_IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    draw: (ctx, f) => paintBody(ctx, 'back', idlePose(cyclePhase(f, KRAKAREN_IDLE_FRAMES))),
  },
  {
    name: 'swipe',
    frameCount: KRAKAREN_SWIPE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    draw: (ctx, f) =>
      paintBody(ctx, 'front', swipePose(shotProgress(f, KRAKAREN_SWIPE_FRAMES), 'front')),
  },
  {
    name: 'swipe_side',
    frameCount: KRAKAREN_SWIPE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    draw: (ctx, f) =>
      paintBody(ctx, 'side', swipePose(shotProgress(f, KRAKAREN_SWIPE_FRAMES), 'side')),
  },
  {
    name: 'swipe_away',
    frameCount: KRAKAREN_SWIPE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    draw: (ctx, f) =>
      paintBody(ctx, 'back', swipePose(shotProgress(f, KRAKAREN_SWIPE_FRAMES), 'back')),
  },
  {
    name: 'channel',
    frameCount: KRAKAREN_CHANNEL_FRAMES,
    kind: 'loop',
    view: 'front',
    draw: (ctx, f) => paintBody(ctx, 'front', channelPose(cyclePhase(f, KRAKAREN_CHANNEL_FRAMES))),
  },
  {
    name: 'channel_side',
    frameCount: KRAKAREN_CHANNEL_FRAMES,
    kind: 'loop',
    view: 'side',
    draw: (ctx, f) => paintBody(ctx, 'side', channelPose(cyclePhase(f, KRAKAREN_CHANNEL_FRAMES))),
  },
  {
    name: 'channel_away',
    frameCount: KRAKAREN_CHANNEL_FRAMES,
    kind: 'loop',
    view: 'back',
    draw: (ctx, f) => paintBody(ctx, 'back', channelPose(cyclePhase(f, KRAKAREN_CHANNEL_FRAMES))),
  },
];

export const GUARD_ROWS: readonly RowSpec[] = [
  {
    name: 'emerge',
    frameCount: GUARD_TENTACLE_EMERGE_FRAMES,
    kind: 'oneShot',
    view: null,
    draw: (ctx, f) =>
      drawGuardTentacle(ctx, guardEmergePose(shotProgress(f, GUARD_TENTACLE_EMERGE_FRAMES))),
  },
  {
    name: 'idle',
    frameCount: GUARD_TENTACLE_IDLE_FRAMES,
    kind: 'loop',
    view: null,
    draw: (ctx, f) =>
      drawGuardTentacle(ctx, guardIdlePose(cyclePhase(f, GUARD_TENTACLE_IDLE_FRAMES))),
  },
  {
    name: 'strike',
    frameCount: GUARD_TENTACLE_STRIKE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    draw: (ctx, f) =>
      drawGuardTentacle(
        ctx,
        guardStrikePose(shotProgress(f, GUARD_TENTACLE_STRIKE_FRAMES), 'front'),
      ),
  },
  {
    name: 'strike_side',
    frameCount: GUARD_TENTACLE_STRIKE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    draw: (ctx, f) =>
      drawGuardTentacle(
        ctx,
        guardStrikePose(shotProgress(f, GUARD_TENTACLE_STRIKE_FRAMES), 'side'),
      ),
  },
  {
    name: 'strike_away',
    frameCount: GUARD_TENTACLE_STRIKE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    draw: (ctx, f) =>
      drawGuardTentacle(
        ctx,
        guardStrikePose(shotProgress(f, GUARD_TENTACLE_STRIKE_FRAMES), 'back'),
      ),
  },
  {
    name: 'retreat',
    frameCount: GUARD_TENTACLE_RETREAT_FRAMES,
    kind: 'oneShot',
    view: null,
    draw: (ctx, f) =>
      drawGuardTentacle(ctx, guardRetreatPose(shotProgress(f, GUARD_TENTACLE_RETREAT_FRAMES))),
  },
];

export const SLAM_ROWS: readonly RowSpec[] = [
  {
    name: 'rise',
    frameCount: SLAM_TENTACLE_RISE_FRAMES,
    kind: 'oneShot',
    view: null,
    draw: (ctx, f) => {
      const p = shotProgress(f, SLAM_TENTACLE_RISE_FRAMES);
      drawSlamTentacle(ctx, slamPose('rise', p, p));
    },
  },
  {
    name: 'loom',
    frameCount: SLAM_TENTACLE_LOOM_FRAMES,
    kind: 'loop',
    view: null,
    draw: (ctx, f) => {
      const phase = cyclePhase(f, SLAM_TENTACLE_LOOM_FRAMES);
      drawSlamTentacle(ctx, slamPose('loom', 0, phase));
    },
  },
  {
    name: 'dive',
    frameCount: SLAM_TENTACLE_DIVE_FRAMES,
    kind: 'oneShot',
    view: null,
    draw: (ctx, f) => {
      const p = shotProgress(f, SLAM_TENTACLE_DIVE_FRAMES);
      drawSlamTentacle(ctx, slamPose('dive', p, p));
    },
  },
  {
    name: 'smash',
    frameCount: SLAM_TENTACLE_SMASH_FRAMES,
    kind: 'oneShot',
    view: null,
    draw: (ctx, f) => {
      const p = shotProgress(f, SLAM_TENTACLE_SMASH_FRAMES);
      drawSlamTentacle(ctx, slamPose('smash', p, p));
    },
  },
];
// ── Gore recentring ────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/**
 * A severed piece has its mass well off its construction origin, which would
 * leave it drawn to one side of the cell the gore field spins it inside. These
 * offsets, in the piece's own units, pull each piece's painted ink onto the
 * centre of its cell. They were measured from the painted ink; measuring is
 * something only an offline pass can do, so they are frozen here and
 * `scripts/gates-krakaren.ts` re-measures their effect on every render.
 */
export const BODY_GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_mantle', pt(0.013786764705882353, -0.013786764705882353)],
  ['gore_stub', pt(-0.013786764705882353, 0.04136029411764706)],
  ['gore_eye', pt(-0.009191176470588236, -0.1286764705882353)],
  ['gore_tentacle_a', pt(0.08731617647058824, -0.02297794117647059)],
  ['gore_tentacle_b', pt(0.07352941176470588, 0.04136029411764706)],
  ['gore_mouth_cluster', pt(0.05514705882352941, -0.004595588235294118)],
  ['gore_entrails', pt(-0.013786764705882353, -0.027573529411764705)],
]);

export const GUARD_GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_tip', pt(0.06893382352941177, -0.05974264705882353)],
  ['gore_mid', pt(-0.004595588235294118, 0.027573529411764705)],
  ['gore_root', pt(-0.05514705882352941, 0.05974264705882353)],
  ['gore_sucker_shred', pt(0, -0.04595588235294118)],
]);

// ── Painting ─────────────────────────────────────────────────────────────────

/**
 * Everything a painted Krakaren figure needs to place a cell: its rows, its
 * frozen cell geometry, and the severed pieces that are its single-frame
 * states.
 */
interface KrakarenFigureSpec {
  readonly id: string;
  readonly cell: CellGeometry;
  readonly rows: readonly RowSpec[];
  readonly gorePieces: readonly GorePiece[];
  readonly goreRecentre: ReadonlyMap<string, Pt>;
}

/**
 * Paints one cell, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile the creature stands on. A gore piece is
 * anchored at the cell's centre instead, because the only thing that reads its
 * cell is the spin the gore field applies about that point.
 */
function paintSpecFrame(spec: KrakarenFigureSpec, ctx: Ctx, state: string, frame: number): void {
  const row = spec.rows.find((candidate) => candidate.name === state);
  if (row !== undefined) {
    ctx.save();
    ctx.translate(spec.cell.frameWidth / 2, spec.cell.tileY + GROUND_OFFSET_PX);
    ctx.scale(TILE_SCALE, TILE_SCALE);
    row.draw(ctx, frame);
    ctx.restore();
    return;
  }

  const piece = spec.gorePieces.find((candidate) => candidate.state === state);
  const recentre = spec.goreRecentre.get(state);
  if (piece === undefined || recentre === undefined) {
    throw new Error(`${spec.id} paints no state "${state}"`);
  }
  ctx.save();
  ctx.translate(
    spec.cell.frameWidth / 2 + recentre.x * GORE_UNIT,
    spec.cell.frameHeight / 2 + recentre.y * GORE_UNIT,
  );
  ctx.scale(GORE_UNIT, GORE_UNIT);
  piece.paint(ctx);
  ctx.restore();
}

/** Every state a figure declares, pose rows first and then the gore pieces. */
function stateFrames(spec: KrakarenFigureSpec): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of spec.rows) frames[row.name] = row.frameCount;
  for (const piece of spec.gorePieces) frames[piece.state] = 1;
  return frames;
}

function figureOf(spec: KrakarenFigureSpec): FigureDef {
  return {
    id: spec.id,
    frameWidth: spec.cell.frameWidth,
    frameHeight: spec.cell.frameHeight,
    tileX: spec.cell.tileX,
    tileY: spec.cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(stateFrames(spec)),
    paintFrame: (ctx, state, frame) => {
      paintSpecFrame(spec, ctx, state, frame);
    },
  };
}

const BODY_SPEC: KrakarenFigureSpec = {
  id: 'krakaren',
  cell: BODY_CELL,
  rows: BODY_ROWS,
  gorePieces: krakarenGorePieces(),
  goreRecentre: BODY_GORE_RECENTRE,
};

const GUARD_SPEC: KrakarenFigureSpec = {
  id: 'krakaren_tentacle',
  cell: GUARD_CELL,
  rows: GUARD_ROWS,
  gorePieces: krakarenTentacleGorePieces(),
  goreRecentre: GUARD_GORE_RECENTRE,
};

const SLAM_SPEC: KrakarenFigureSpec = {
  id: 'krakaren_slam',
  cell: SLAM_CELL,
  rows: SLAM_ROWS,
  gorePieces: [],
  goreRecentre: new Map(),
};

export const KRAKAREN_FIGURE: FigureDef = figureOf(BODY_SPEC);
export const KRAKAREN_TENTACLE_FIGURE: FigureDef = figureOf(GUARD_SPEC);
export const KRAKAREN_SLAM_FIGURE: FigureDef = figureOf(SLAM_SPEC);

/** The severed pieces of each figure, in the order `BodyPartGoreSystem` spawns them. */
export const KRAKAREN_GORE_STATES: readonly string[] = krakarenGorePieces().map((p) => p.state);
export const KRAKAREN_TENTACLE_GORE_STATES: readonly string[] = krakarenTentacleGorePieces().map(
  (p) => p.state,
);
