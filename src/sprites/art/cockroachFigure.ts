/**
 * The cockroach, as a painted figure: the choreography, the cell geometry, and
 * the `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `cockroachArt.ts` and
 * `cockroachGore.ts`.
 *
 * The tile anchor is the **centre of the body**, not a ground line: this animal
 * is a third of a tile long and lies flat, so it is centred in its tile the way
 * a coin is centred on a plate.
 *
 * The art invariants live in `scripts/gates-cockroach.ts`, which the review
 * harness runs: `npm run render:cockroach`.
 */

import {
  LEG_COUNT,
  clamp01,
  deg,
  drawCockroach,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  tripodOf,
  type AntennaPose,
  type CockroachPose,
  type CockroachView,
  type LegPose,
  type Pt,
} from './cockroachArt';
import { cockroachGorePieces, type CockroachGorePiece } from './cockroachGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ─────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * Size of the whole animal relative to a tile. A cockroach is vermin — it has to
 * read as something you could step on, and at 1.0 it filled its tile like a dog.
 */
const COCKROACH_SCALE = 0.92;

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * creature's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the widest
 * pose plus padding, quantised, and widened again so a spinning gore piece
 * sweeps the cell's inscribed circle without clipping — and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
const FRAME_WIDTH = 144;
const FRAME_HEIGHT = 144;
const TILE_X = 40;
const TILE_Y = 40;

/** Both a pose and a gore piece are painted about the cell's own centre. */
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = FRAME_HEIGHT / 2;

export const SKITTER_FRAMES = 8;
export const IDLE_FRAMES = 6;
export const BITE_FRAMES = 8;

/**
 * The frame the mob deals its damage on, and the frame the lunge must peak on.
 * Exported so the runtime and the gate read the same number.
 */
export const BITE_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

/** Phase of a looping row: 0 at the first frame, never reaching 1. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/** Progress through a one-shot row, sampled at the middle of each frame. */
function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** Where in its own stride one leg is, given the body's phase and its tripod. */
function legPhase(phase: number, index: number): number {
  const HALF_CYCLE_OFFSET = 0.5;
  return (phase + tripodOf(index) * HALF_CYCLE_OFFSET) % 1;
}

// ── Skitter ──────────────────────────────────────────────────────────────────

/**
 * How far the femur swings either side of its rest bearing over one stride.
 *
 * Small on purpose. A roach's legs beat far faster than they travel; a big
 * stride at eight frames a cycle is a creature *striding*, which is a lizard.
 */
const STRIDE = deg(19);
/** Fraction of the cycle a leg spends on the floor. */
const STANCE_SHARE = 0.5;
/** How much a leg shortens as it is lifted clear of the floor. */
const SWING_TUCK = 0.07;
const YAW_AMPLITUDE = deg(4.5);
const SWAY_AMPLITUDE = 0.012;
/**
 * The body's own surge, twice per stride — once per tripod push. Kept small
 * because two cycles across eight frames is only four samples each, and an
 * oscillation sampled that coarsely turns into a strobe rather than a push.
 */
const SURGE_AMPLITUDE = 0.008;
const SURGE_CYCLES_PER_STRIDE = 2;

function skitterLeg(phase: number, index: number): LegPose {
  const own = legPhase(phase, index);
  if (own < STANCE_SHARE) {
    // Stance: the foot is planted, so the body's own motion drags the femur
    // from its forward reach back toward the rear.
    const through = own / STANCE_SHARE;
    return { swing: lerp(-STRIDE, STRIDE, through), reach: 1, lift: 0 };
  }
  const through = (own - STANCE_SHARE) / (1 - STANCE_SHARE);
  const lift = hump(through);
  return {
    swing: lerp(STRIDE, -STRIDE, easeInOut(through)),
    reach: 1 - lift * SWING_TUCK,
    lift,
  };
}

const SKITTER_ANTENNA_SWEEP = deg(23);
const SKITTER_ANTENNA_CURL = deg(15);
/** The two antennae are deliberately out of step; a matched pair reads as horns. */
const ANTENNA_SIDE_PHASE = 0.31;

function skitterAntenna(phase: number, side: number): AntennaPose {
  const own = phase + (side > 0 ? ANTENNA_SIDE_PHASE : 0);
  const wave = Math.sin(own * Math.PI * 2);
  return {
    spread: wave * SKITTER_ANTENNA_SWEEP,
    curl: Math.cos(own * Math.PI * 2) * SKITTER_ANTENNA_CURL,
    extend: 1,
  };
}

function skitter(phase: number): CockroachPose {
  const wave = Math.sin(phase * Math.PI * 2);
  return {
    ...restPose(),
    legs: Array.from({ length: LEG_COUNT }, (_unused, index) => skitterLeg(phase, index)),
    leftAntenna: skitterAntenna(phase, -1),
    rightAntenna: skitterAntenna(phase, 1),
    yaw: wave * YAW_AMPLITUDE,
    sway: wave * SWAY_AMPLITUDE,
    surge: Math.cos(phase * Math.PI * 2 * SURGE_CYCLES_PER_STRIDE) * SURGE_AMPLITUDE,
    abdomenSwing: -wave * 0.35,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * A standing roach's antennae wave more slowly and less far than a running
 * one's — they whip when it runs. Reversed, the idle out-animates the skitter,
 * which is the one thing an idle must never do.
 */
const IDLE_ANTENNA_SWEEP = deg(13);
const IDLE_ANTENNA_CURL = deg(9);
/** The idle antennae sweep slower than the run's, over the whole six frames. */
const IDLE_ANTENNA_CYCLES = 1;
const IDLE_YAW = deg(1.4);
const IDLE_SWAY = 0.004;
/** Which leg resettles, and where in the cycle it picks itself up. */
const IDLE_ADJUST_LEG = 3;
const IDLE_ADJUST_AT = 0.34;
const IDLE_ADJUST_WIDTH = 0.34;
const IDLE_ADJUST_LIFT = 0.55;
const IDLE_ADJUST_SWING = deg(9);

function idleAntenna(phase: number, side: number): AntennaPose {
  const own = phase + (side > 0 ? ANTENNA_SIDE_PHASE : 0);
  return {
    spread: Math.sin(own * Math.PI * 2 * IDLE_ANTENNA_CYCLES) * IDLE_ANTENNA_SWEEP,
    curl: Math.sin(own * Math.PI * 2 * IDLE_ANTENNA_CYCLES + Math.PI / 3) * IDLE_ANTENNA_CURL,
    extend: 1,
  };
}

/**
 * A near-still animal. The whole row is deliberately close to the threshold of
 * visibility: an idling roach that visibly animates reads as an idling *pet*,
 * and this one has to look like it is waiting to run at you.
 */
function idle(phase: number): CockroachPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const adjust = hump(ramp(phase, IDLE_ADJUST_AT, IDLE_ADJUST_AT + IDLE_ADJUST_WIDTH));
  return {
    ...restPose(),
    legs: Array.from({ length: LEG_COUNT }, (_unused, index) =>
      index === IDLE_ADJUST_LEG
        ? {
            swing: adjust * IDLE_ADJUST_SWING,
            reach: 1 - adjust * SWING_TUCK,
            lift: adjust * IDLE_ADJUST_LIFT,
          }
        : { swing: 0, reach: 1, lift: 0 },
    ),
    leftAntenna: idleAntenna(phase, -1),
    rightAntenna: idleAntenna(phase, 1),
    yaw: breath * IDLE_YAW,
    sway: breath * IDLE_SWAY,
    abdomenSwing: breath * 0.12,
  };
}

// ── Bite ─────────────────────────────────────────────────────────────────────

/** Progress at which the lunge is at full reach — the middle of frame 4 of 8. */
const BITE_LUNGE_PEAK = (BITE_IMPACT_FRAME + 0.5) / BITE_FRAMES;
const BITE_LUNGE_START = 0.3;
const BITE_RECOVER_END = 0.98;
const BITE_REAR_PEAK = 0.34;
const BITE_REAR_END = 0.56;
const BITE_SURGE = 0.17;
const BITE_GAPE_OPEN_BY = 0.36;
const BITE_GAPE_CLOSE_BY = 0.78;
/** The front legs come off the floor with the front of the body and slam down with it. */
const BITE_FRONT_LEG_LIFT = 0.8;
const BITE_FRONT_LEG_SWING = deg(-14);
/** How far apart the two sides plant through the lunge. */
const BITE_BRACE_ASYMMETRY = deg(21);
const BITE_REAR_LEG_PUSH = deg(10);
const BITE_BRACE_REACH = 0.05;
/** The left forelimb comes up later than the right, so the rear is not a scale. */
const BITE_FRONT_LEG_LAG = 0.55;
const BITE_ANTENNA_FLING = deg(-26);
const BITE_ANTENNA_CURL = deg(20);
const BITE_CERCI_SPREAD = deg(14);

function biteRear(progress: number): number {
  if (progress <= BITE_REAR_PEAK) return easeInOut(ramp(progress, 0, BITE_REAR_PEAK));
  return 1 - easeInOut(ramp(progress, BITE_REAR_PEAK, BITE_REAR_END));
}

/**
 * The lunge itself, peaking **exactly** at {@link BITE_LUNGE_PEAK}.
 *
 * Written as two ramps meeting at the peak rather than as a hump over the whole
 * shot so the maximum lands on one declared frame instead of wherever a curve
 * happens to crest. `G-BITE` measures the argmax and compares it against
 * {@link BITE_IMPACT_FRAME}; the mob damages on that frame.
 */
function biteSurge(progress: number): number {
  if (progress <= BITE_LUNGE_PEAK)
    return easeInOut(ramp(progress, BITE_LUNGE_START, BITE_LUNGE_PEAK));
  return 1 - easeInOut(ramp(progress, BITE_LUNGE_PEAK, BITE_RECOVER_END));
}

export function bitePose(progress: number): CockroachPose {
  const rear = biteRear(progress);
  const lunge = biteSurge(progress);
  const gape =
    progress <= BITE_GAPE_OPEN_BY
      ? easeInOut(ramp(progress, 0, BITE_GAPE_OPEN_BY))
      : 1 - easeInOut(ramp(progress, BITE_LUNGE_PEAK, BITE_GAPE_CLOSE_BY));
  const legs: LegPose[] = Array.from({ length: LEG_COUNT }, (_unused, index) => {
    const isFrontPair = index < 2;
    // A lunging animal does not plant evenly. Braced symmetrically the whole
    // row measured as one uniform scale-up of a standing roach rather than as a
    // pose, so the two sides are deliberately out of step through the strike.
    const side = index % 2 === 0 ? 1 : -1;
    const brace = Math.max(rear, lunge) * BITE_BRACE_ASYMMETRY * side;
    if (!isFrontPair) {
      return {
        swing: lunge * BITE_REAR_LEG_PUSH + brace,
        reach: 1 + lunge * BITE_BRACE_REACH,
        lift: 0,
      };
    }
    return {
      swing: rear * BITE_FRONT_LEG_SWING + brace,
      reach: 1 - rear * SWING_TUCK,
      lift: rear * BITE_FRONT_LEG_LIFT * (side > 0 ? 1 : BITE_FRONT_LEG_LAG),
    };
  });
  const antenna = (side: number): AntennaPose => ({
    spread: (rear * BITE_ANTENNA_FLING + lunge * deg(8)) * (side > 0 ? 1 : 0.85),
    curl: rear * BITE_ANTENNA_CURL,
    extend: 1,
  });
  return {
    ...restPose(),
    legs,
    leftAntenna: antenna(-1),
    rightAntenna: antenna(1),
    surge: lunge * BITE_SURGE,
    rear,
    gape: clamp01(gape),
    cerciSpread: lunge * BITE_CERCI_SPREAD,
  };
}

// ── Row manifest ───────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: CockroachView;
  readonly pose: (frame: number) => CockroachPose;
}

const GORE_PIECES: readonly CockroachGorePiece[] = cockroachGorePieces();

/**
 * Extra scale the gore pieces are painted at on top of {@link COCKROACH_SCALE}.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * creature, so they do not inherit its scale — but they do have to survive the
 * runtime's own 0.5x, and they must not overshoot it either: at 2 a single
 * severed wing measured wider than the whole living roach, which reads as the
 * player having killed something much larger than the thing that was there.
 * The legibility gate is the floor under this number and the living sprite is
 * the ceiling.
 */
const GORE_PIECE_SCALE = 1.3;
/** Pixels per tile unit a gore piece is painted at. */
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

export const ROWS: readonly RowSpec[] = [
  {
    name: 'skitter',
    frameCount: SKITTER_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => skitter(cyclePhase(f, SKITTER_FRAMES)),
  },
  {
    name: 'skitter_side',
    frameCount: SKITTER_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => skitter(cyclePhase(f, SKITTER_FRAMES)),
  },
  {
    name: 'skitter_back',
    frameCount: SKITTER_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => skitter(cyclePhase(f, SKITTER_FRAMES)),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => idle(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => idle(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_back',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => idle(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'bite',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => bitePose(shotProgress(f, BITE_FRAMES)),
  },
  {
    name: 'bite_side',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => bitePose(shotProgress(f, BITE_FRAMES)),
  },
  {
    name: 'bite_back',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => bitePose(shotProgress(f, BITE_FRAMES)),
  },
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/** The progress each frame of a one-shot row is sampled at. */
export function biteProgressOf(frame: number): number {
  return shotProgress(frame, BITE_FRAMES);
}

// ── Gore placement ───────────────────────────────────────────────────

/**
 * How far each gore piece is nudged so that its ink, not its construction
 * origin, sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own cell, so a
 * piece drawn off-centre in that cell orbits rather than tumbles. The offsets
 * are in the piece's own units, the same ones its `paint` is scaled by, and
 * they were measured from the painted ink of each piece — something only an
 * offline pass can do. They are frozen here and `scripts/gates-cockroach.ts`
 * re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_head', { x: -0.012019230769230768, y: -0.006009615384615384 }],
  ['gore_pronotum', { x: 0.018028846153846152, y: -0.024038461538461536 }],
  ['gore_tegmen', { x: -0.012019230769230768, y: 0.018028846153846152 }],
  ['gore_abdomen', { x: 0.006009615384615384, y: 0.05408653846153846 }],
  ['gore_leg', { x: -0.012019230769230768, y: 0.06610576923076923 }],
  ['gore_legpair', { x: 0.006009615384615384, y: 0.03004807692307692 }],
  ['gore_thorax', { x: -0.036057692307692304, y: -0.06610576923076923 }],
  ['gore_cerci', { x: 0.006009615384615384, y: 0.03004807692307692 }],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): CockroachGorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell of the cockroach, in the cell's own pixels.
 *
 * A pose row is scaled about the body's centre, which is the origin of the
 * painter's own frame *and* the tile anchor, so a size change cannot move the
 * creature off the tile it walks on. A gore piece is anchored at the same
 * point, shifted by the frozen offset that puts its ink there.
 */
function paintCockroachFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(ORIGIN_X + recentre.x * GORE_UNIT, ORIGIN_Y + recentre.y * GORE_UNIT);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE * COCKROACH_SCALE, TILE_SCALE * COCKROACH_SCALE);
  drawCockroach(ctx, row.pose(frame), row.view);
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function cockroachStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const COCKROACH_FIGURE: FigureDef = {
  id: 'cockroach',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(cockroachStateFrames()),
  paintFrame: paintCockroachFrame,
};
