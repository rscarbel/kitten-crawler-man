#!/usr/bin/env tsx
/**
 * Generates the cockroach sheet: the vermin the Hoarder vomits up.
 *
 * The anatomy and the painting live in `scripts/cockroachArt.ts` and the severed
 * pieces in `scripts/cockroachGore.ts`; this file is only the choreography — one
 * pose function per animation row, sampled per frame — plus the bake.
 *
 * Rows (see the `cockroach` entry in src/images/enemies/manifest.json):
 *    0 skitter       — toward the camera, alternating-tripod run
 *    1 skitter_side  — profile, drawn heading +X and mirrored at runtime
 *    2 skitter_back
 *    3 idle          — near-still: antennae sweeping, one leg resettling
 *    4 idle_side
 *    5 idle_back
 *    6 bite          — rear up, then lunge forward and down
 *    7 bite_side
 *    8 bite_back
 *    9 gore          — the eight pieces, one per column
 *
 * The tile anchor is the **centre of the body**, not a ground line: this animal
 * is a third of a tile long and lies flat, so it is centred in its tile the way
 * a coin is centred on a plate.
 *
 * Run: npx tsx scripts/generate-cockroach-sprite.gates.ts  — the gate module is
 * the entry point, and it is what may write. Running this file directly writes
 * without gating and is for debugging only.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  ANTENNA_MIN_SPAN_TILES,
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
import { cockroachGorePieces } from './cockroachGore';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Every cell is painted at twice its size and downsampled, for clean edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept around the furthest ink, so nothing touches a cell border. */
const FRAME_PADDING = 5;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;
/** Scratch canvas the extents are measured on; larger than any frame can be. */
const MEASURE_SIZE = 384;

/**
 * Size of the whole animal relative to a tile. A cockroach is vermin — it has to
 * read as something you could step on, and at 1.0 it filled its tile like a dog.
 */
const COCKROACH_SCALE = 0.92;

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

// ── Row manifest ─────────────────────────────────────────────────────────────

type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: CockroachView;
  /** Null on the gore row, whose cells are pieces rather than poses. */
  readonly pose: ((frame: number) => CockroachPose) | null;
}

const GORE_PIECES = cockroachGorePieces();

/**
 * Extra scale the gore pieces are painted at on top of {@link COCKROACH_SCALE}.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * creature, so they do not inherit its scale — but they do have to survive the
 * runtime's own 0.5x, and they must not overshoot it either: at 2 a single
 * severed wing measured wider than the whole living roach, which reads as the
 * player having killed something much larger than the thing that was there.
 * `G6` is the floor under this number and the living sprite is the ceiling.
 */
const GORE_PIECE_SCALE = 1.3;
/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

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

/** The progress each frame of a one-shot row is sampled at. */
export function biteProgressOf(frame: number): number {
  return shotProgress(frame, BITE_FRAMES);
}

// ── Bake ─────────────────────────────────────────────────────────────────────

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
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
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the body's centre, which is the origin of the painter's
          // own frame *and* the tile anchor, so a size change cannot move the
          // creature off the tile it walks on.
          ctx.scale(COCKROACH_SCALE, COCKROACH_SCALE);
          drawCockroach(ctx, pose(frame), view);
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 24;

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
  /** Furthest the animation rows reach from the body's centre, in pixels. */
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

    if (job.row.kind === 'gore') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      // A severed part has its mass well off its construction origin, which
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

/**
 * The cell, derived from what the frames actually painted.
 *
 * Both half-extents are taken from the *worst* side and doubled, which is what
 * keeps the painter's origin exactly on the cell centre — the anchor this
 * creature registers on. Written any other way the tile drifts as poses change,
 * and nothing downstream would notice.
 */
function geometryFor(extents: Extents): SheetGeometry {
  // Both axes have to clear the gore radius: a spinning piece sweeps the cell's
  // *inscribed* circle, so a cell wide enough but not tall enough still clips.
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const halfHeight = Math.max(extents.up, extents.down) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const frameHeight = roundUpTo(Math.max(halfHeight * 2, goreSpan), FRAME_SIZE_QUANTUM);
  return {
    frameWidth,
    frameHeight,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: frameHeight / 2 - TILE_SCALE / 2,
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
const GORE_AREA_INFLATION_LIMIT = 1.6;

export function bake(): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs());
  const jobs = buildJobs(measured.goreOffsets);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `these frames painted nothing, which almost always means a NaN in the pose: ` +
        `${extents.blankFrames.join(', ')}`,
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
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
    job.paint(cellCtx, geometry.frameWidth / 2, geometry.frameHeight / 2);
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

// ── Manifest ─────────────────────────────────────────────────────────────────

const SHEET_PATH = 'src/images/enemies/cockroach.png';
const MANIFEST_PATH = 'src/images/enemies/manifest.json';
const MANIFEST_KEY = 'cockroach';
const MANIFEST_RELATIVE_PATH = 'enemies/cockroach.png';

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

export function manifestEntry(sheet: BakedSheet): ManifestEntry {
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
    path: MANIFEST_RELATIVE_PATH,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

/**
 * A stable string for comparing two manifest entries. Key order in JSON carries
 * no meaning, so a hand-edit that reorders `tileX` and `tileY` must not read as
 * a mismatch.
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
 * their edits. A mismatch prints the entry to paste — a sheet on disk that its
 * manifest does not describe renders as garbage.
 */
function verifyManifest(sheet: BakedSheet): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntry(sheet);
  if (canonicalJson(manifest[MANIFEST_KEY]) === canonicalJson(required)) {
    console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
    return;
  }
  console.error(
    `\n${MANIFEST_PATH} is out of sync with the bake. Add or replace its "${MANIFEST_KEY}" entry ` +
      `with:\n${JSON.stringify(required, null, 2)}\n`,
  );
  process.exitCode = 1;
}

export function writeSheet(): void {
  console.log(
    `Generating the cockroach sheet (tileScale=${TILE_SCALE}, scale=${COCKROACH_SCALE})…`,
  );
  const sheet = bake();
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);

  const width = sheet.columns * sheet.geometry.frameWidth;
  const height = ROWS.length * sheet.geometry.frameHeight;
  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${width}×${height}px  (${ROWS.length} rows × ${sheet.columns} cols of ` +
      `${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  console.log(`  bite impact frame: ${BITE_IMPACT_FRAME} of ${BITE_FRAMES}`);
  console.log(`  antenna span floor: ${ANTENNA_MIN_SPAN_TILES} tiles`);
  console.log(`  gore states: ${GORE_STATES.join(', ')}`);
  verifyManifest(sheet);
}

// The review harness and the gate module import ROWS from here, so painting the
// sheet has to be something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheet();
}

export { idle, skitter };
