#!/usr/bin/env tsx
/**
 * Bakes the three Krakaren Clone sheets: the boss body, the guard tentacle that
 * bursts out of the floor beside the player, and the giant slam tentacle.
 *
 * This module is choreography and tiling only. Anatomy, palette and every
 * stroke of paint live in `scripts/krakarenArt.ts`, the severed pieces in
 * `scripts/krakarenGore.ts`, and every row length in
 * `src/sprites/krakarenAttackTiming.ts` — the one place the runtime and the
 * bake can agree about when a tentacle connects.
 *
 * Three sheets rather than one for the reason the troglodyte's tongue is its
 * own sheet: the slam tentacle rises two and a half tiles and the guard
 * tentacle erupts wherever the player is standing, so folding either into the
 * body's cells would inflate all ninety of them. Sharing one generator is what
 * keeps their geometry conventions — tile scale, ground line, padding — from
 * drifting apart.
 *
 * Side rows are drawn facing +X and mirrored by the runtime's `flipX`, the way
 * every other creature sheet in the game handles a profile; there is no
 * separate leftward pose to keep in step.
 *
 * Every loop runs a whole number of cycles across its row and no row runs more
 * than one: eight to ten frames cannot carry a faster oscillation than that
 * without the sampled cycle aliasing into a strobe or a freeze.
 *
 * Run: npx tsx scripts/generate-krakaren-sprite.ts
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { type Pt, clamp01 } from './carlArt.js';
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
} from './krakarenArt.js';
import {
  GORE_PIECE_SCALE,
  type GorePiece,
  krakarenGorePieces,
  krakarenTentacleGorePieces,
} from './krakarenGore.js';
import { TWO_PI } from './ratArt.js';
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
} from '../src/sprites/krakarenAttackTiming.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the furthest ink and the edge of its cell. */
const FRAME_PADDING = 5;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;
/**
 * Where the ground line sits inside the tile, in pixels of the tile the art is
 * drawn at — the same line every other dungeon creature stands on. Held in
 * whole pixels so `tileY` comes out an integer: a fractional anchor puts every
 * blit on a half pixel and softens the whole sprite for nothing.
 */
export const GROUND_OFFSET_PX = 58;
/**
 * Scratch canvas for measurement. Comfortably larger than the slam tentacle,
 * which is the tallest thing in the fight at two and a half tiles.
 */
const MEASURE_SPAN = 512;
const MEASURE_ORIGIN = MEASURE_SPAN / 2;
/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

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

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  /**
   * Null where the row has no single view: the gore rows, whose cells are
   * pieces, and the slam tentacle's, which is one shape seen from one side.
   */
  readonly view: KrakarenView | null;
  /** Paints one frame in tile units about the subject's ground point. */
  readonly draw: ((ctx: Ctx, frame: number) => void) | null;
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
  {
    name: 'gore',
    frameCount: krakarenGorePieces().length,
    kind: 'gore',
    view: null,
    draw: null,
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
  {
    name: 'gore',
    frameCount: krakarenTentacleGorePieces().length,
    kind: 'gore',
    view: null,
    draw: null,
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

// ── Sheets ───────────────────────────────────────────────────────────────────

export interface SheetSpec {
  /** Manifest key. */
  readonly key: string;
  /** Where the PNG is written, from the repository root. */
  readonly path: string;
  /** How the manifest refers to that PNG. */
  readonly relativePath: string;
  readonly rows: readonly RowSpec[];
  /** Empty where a sheet has no gore row — the slam tentacle is never killable. */
  readonly gorePieces: readonly GorePiece[];
}

export const BODY_SHEET: SheetSpec = {
  key: 'krakaren',
  path: 'src/images/bosses/krakaren.png',
  relativePath: 'bosses/krakaren.png',
  rows: BODY_ROWS,
  gorePieces: krakarenGorePieces(),
};

export const GUARD_SHEET: SheetSpec = {
  key: 'krakaren_tentacle',
  path: 'src/images/bosses/krakaren_tentacle.png',
  relativePath: 'bosses/krakaren_tentacle.png',
  rows: GUARD_ROWS,
  gorePieces: krakarenTentacleGorePieces(),
};

export const SLAM_SHEET: SheetSpec = {
  key: 'krakaren_slam',
  path: 'src/images/bosses/krakaren_slam.png',
  relativePath: 'bosses/krakaren_slam.png',
  rows: SLAM_ROWS,
  gorePieces: [],
};

export const SHEETS: readonly SheetSpec[] = [BODY_SHEET, GUARD_SHEET, SLAM_SHEET];

const MANIFEST_PATH = 'src/images/bosses/manifest.json';

/** The gore states of a sheet, in the order `BodyPartGoreSystem` spawns them. */
export function goreStatesOf(spec: SheetSpec): readonly string[] {
  return spec.gorePieces.map((piece) => piece.state);
}

// ── Bake ─────────────────────────────────────────────────────────────────────

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  /**
   * Animation cells anchor on the painter's own origin — the subject's ground
   * point; gore cells anchor on the centre of the cell, so every piece is
   * measured and laid out about the same point.
   */
  readonly anchor: 'origin' | 'cellCentre';
  /** Shift applied to a gore piece so its painted ink lands on the cell centre. */
  readonly recentre: Pt;
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(spec: SheetSpec, goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const row of spec.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = spec.gorePieces[frame];
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

      const draw = row.draw;
      if (draw === null) throw new Error(`row "${row.name}" is not gore but has no draw function`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          draw(ctx, frame);
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/** Alpha above which a pixel counts as painted, when measuring ink extents. */
const INK_ALPHA_THRESHOLD = 8;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxOf(ctx: Ctx, width: number, height: number): InkBox | null {
  const { data } = ctx.getImageData(0, 0, width, height);
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
  const canvas = createCanvas(MEASURE_SPAN, MEASURE_SPAN);
  const ctx = canvas.getContext('2d');

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SPAN, MEASURE_SPAN);
    job.paint(ctx, MEASURE_ORIGIN, MEASURE_ORIGIN);
    const box = inkBoxOf(ctx, MEASURE_SPAN, MEASURE_SPAN);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }

    if (job.anchor === 'cellCentre') {
      // A severed piece has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it. This offset
      // pulls the ink back to the middle, which is what makes `goreRadius` a
      // meaningful measure of how big the pieces actually are.
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      goreOffsets.set(job.frame, {
        x: job.recentre.x + (MEASURE_ORIGIN - inkCentreX) / GORE_UNIT,
        y: job.recentre.y + (MEASURE_ORIGIN - inkCentreY) / GORE_UNIT,
      });
      const halfWidth = (box.maxX - box.minX) / 2;
      const halfHeight = (box.maxY - box.minY) / 2;
      goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight));
      continue;
    }

    left = Math.max(left, MEASURE_ORIGIN - box.minX);
    right = Math.max(right, box.maxX - MEASURE_ORIGIN);
    up = Math.max(up, MEASURE_ORIGIN - box.minY);
    down = Math.max(down, box.maxY - MEASURE_ORIGIN);
  }

  return { left, right, up, down, goreRadius, goreOffsets, blankFrames };
}

interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

/**
 * The cell has to hold the widest pose *and* the inscribed circle of the
 * largest gore piece, which spins about its own ink centre at runtime: a cell
 * wide enough but not tall enough still clips the spin.
 */
function geometryFor(extents: Extents): SheetGeometry {
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
    tileX: Math.round(frameWidth / 2 - TILE_SCALE / 2),
    tileY: originY - GROUND_OFFSET_PX,
  };
}

export interface BakedSheet {
  readonly spec: SheetSpec;
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness: the pieces are authored at their own scale, and a fat one
 * quietly doubles every cell on the sheet, blank ones included.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

export function bake(spec: SheetSpec): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(buildJobs(spec));
  const jobs = buildJobs(spec, measured.goreOffsets);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `${spec.key}: these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `${spec.key}: the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the ` +
        `animation rows need — shrink the longest piece rather than paying for it on all ` +
        `${spec.rows.length} rows`,
    );
  }

  const columns = Math.max(...spec.rows.map((row) => row.frameCount));
  const sheet = createCanvas(
    columns * geometry.frameWidth,
    spec.rows.length * geometry.frameHeight,
  );
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');
  const rowIndexOf = new Map(spec.rows.map((row, index) => [row.name, index]));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in ${spec.key}`);

    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + GROUND_OFFSET_PX;
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
    spec,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

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
  sheet.spec.rows.forEach((row, index) => {
    if (row.kind === 'gore') {
      goreStatesOf(sheet.spec).forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: sheet.spec.relativePath,
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
 * Checks `manifest.json` against the bake rather than rewriting it: that file
 * is shared with every other sprite in the game and other agents edit it, so a
 * generator that rewrote it would silently clobber their work. A mismatch
 * returns the entry to paste — a sheet on disk its manifest does not describe
 * renders as garbage.
 */
export function manifestMismatch(sheet: BakedSheet): string | null {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntry(sheet);
  if (canonicalJson(manifest[sheet.spec.key]) === canonicalJson(required)) return null;
  return (
    `${MANIFEST_PATH} is out of sync with the bake. Replace its "${sheet.spec.key}" entry with:\n` +
    JSON.stringify(required, null, 2)
  );
}

/** Writes sheets the caller has already baked (and, in the gates, measured). */
export function writeSheets(sheets: readonly BakedSheet[]): void {
  for (const sheet of sheets) {
    const { frameWidth, frameHeight, tileX, tileY } = sheet.geometry;
    const rows = sheet.spec.rows;
    writeFileSync(resolve(sheet.spec.path), sheet.buffer);
    console.log(`  → ${sheet.spec.path}`);
    console.log(
      `     ${sheet.columns * frameWidth}×${rows.length * frameHeight}px  ` +
        `(${rows.length} rows × ${sheet.columns} cols of ${frameWidth}×${frameHeight})`,
    );
    rows.forEach((row, index) => {
      console.log(
        `     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view ?? 'no view'}, ${row.kind})`,
      );
    });
    console.log(`     tileX=${tileX}  tileY=${tileY}  tileScale=${TILE_SCALE}`);
  }

  let mismatched = false;
  for (const sheet of sheets) {
    const complaint = manifestMismatch(sheet);
    if (complaint === null) {
      console.log(`  manifest: "${sheet.spec.key}" is in sync`);
      continue;
    }
    console.error(`\n${complaint}\n`);
    mismatched = true;
  }
  if (mismatched) process.exitCode = 1;
}

function generate(): void {
  console.log(`Generating the Krakaren sheets (tileScale=${TILE_SCALE})…`);
  writeSheets(SHEETS.map(bake));
}

// The review harness and the gate module import `bake` from here, so painting
// the sheets has to be something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  generate();
}
