#!/usr/bin/env tsx
/**
 * Generates the `rat` sprite sheet — the vermin that fills floor 1's hallways.
 *
 * The anatomy and the painting live in `scripts/ratArt.ts` and the eight gore
 * pieces in `scripts/ratGore.ts`; this file is only the choreography plus the
 * bake: one pose function per animation row, sampled per frame, then measured
 * and laid out.
 *
 * Rows (see the `rat` entry in src/images/enemies/manifest.json):
 *    0 walk       — scurrying toward the camera
 *    1 walk_side  — profile, drawn facing +X and mirrored at runtime
 *    2 walk_away  — scurrying away, tail trailing toward the viewer
 *    3 idle       — breathing, sniffing, whisker twitch, ear flick
 *    4 idle_side
 *    5 idle_away
 *    6 bite       — rear, lunge, snap, recover
 *    7 bite_side
 *    8 bite_away
 *    9 gore       — the eight pieces, one per column
 *
 * The frame geometry is measured rather than declared: the gore pieces spin
 * about the centre of their cell, so the cell has to clear the longest piece's
 * *inscribed circle*, and hand-guessing that number is how a tail ends up
 * clipping its own corners as it tumbles.
 *
 * Run: npm run gen:rat
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  GROUND_Y,
  type FootPose,
  type RatPose,
  type TailPose,
  clamp01,
  deg,
  drawRatBack,
  drawRatFront,
  drawRatSide,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  TWO_PI,
} from './ratArt.js';
import { ratGorePieces } from './ratGore.js';

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
 * How much of a tile the rat fills, scaled about its own ground line so its feet
 * stay on the tile they belong to.
 *
 * Seven eighths, not the two thirds a real rat's size next to a goblin would
 * argue for: this is a dungeon monster the player has to read as a threat, and
 * at the anatomically honest size its head stopped being resolvable at a 32 px
 * tile.
 */
const RAT_SCALE = 7 / 8;

/**
 * Extra scale applied to the gore pieces on top of `RAT_SCALE`.
 *
 * Anatomically a rat's severed head is tiny, and drawn at its true size it comes
 * out about five screen pixels across once the runtime's own 0.5× is applied —
 * below the size at which a shape can be told from any other shape. The pieces
 * are deliberately oversized so the set stays namable; the alternative is eight
 * indistinguishable red specks.
 */
const GORE_PIECE_SCALE = 1.4;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 8;
const BITE_FRAMES = 8;

/** Pixels per tile unit a gore piece is painted at. */
const GORE_UNIT = TILE_SCALE * RAT_SCALE * GORE_PIECE_SCALE;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const PLANTED: FootPose = { dx: 0, dy: 0, lift: 0, splay: 0.55 };

function foot(dx: number, dy: number, lift: number, splay = 0.55): FootPose {
  return { dx, dy, lift, splay };
}

function tailPose(
  base: number,
  curl: number,
  wave = 0,
  phase = 0,
  flick = 0,
  rootX = 0,
  rootY = 0,
): TailPose {
  return { base, curl, wave, phase, flick, rootX, rootY };
}

/**
 * Tail carriage per view. Curl accumulates clockwise on screen, so a tail that
 * leaves to the left lifts its tip with a positive curl.
 */
const SIDE_TAIL_BASE = deg(168);
const FRONT_TAIL_BASE = deg(-14);
/**
 * From behind, the tail comes down the screen toward the viewer. It is given a
 * healthy curl in every back-view pose on purpose: a tail that runs dead
 * straight down the middle of the rump reads as a crack in the sprite.
 */
const BACK_TAIL_BASE = deg(72);
/**
 * How far off the spine the tail roots in the back views. Dropped straight down
 * the centre it bisects the rump and reads as a split in the sprite.
 */
const BACK_TAIL_ROOT_X = 0.05;

const BLINK_HOLD = 0.05;

/** A blink centred on `at`, expressed in cycle phase. */
function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

/**
 * A foot in the scurry: a fast low swing forward, then a long stance dragging
 * back. Rats do not lift their feet — the swing is barely off the floor and the
 * stride is short and quick, which is the whole difference between a scurry and
 * a cat's walk.
 */
const SWING_SHARE = 0.38;

function gaitFoot(phase: number, reach: number, height: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const dx = swinging ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  const lift = swinging ? hump(t) : 0;
  // Toes curl under on the swing and splay on the plant, which is what stops the
  // foot from reading as a fixed blob sliding along the floor.
  return { dx, dy: -lift * height, lift, splay: lerp(0.72, 0.18, lift) };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_BOB = 0.012;
const WALK_SWAY = 0.016;
const WALK_REACH_SIDE = 0.085;
/** Foot clearance on the swing, in tile units. Deliberately tiny. */
const WALK_LIFT_SIDE = 0.045;
/**
 * How far the spine flexes over one stride. Small on purpose — see
 * `SIDE_ARCH_RISE` in ratArt.ts for why a legible hump is the wrong call here.
 */
const WALK_ARCH = 0.3;
/** Whiskers sweep back at speed and forward on the gather. */
const WALK_WHISKER_SWEEP = 0.35;

/** A diagonal trot: it reads far more clearly than a lateral walk at tile size. */
function walkSide(phase: number): RatPose {
  const angle = phase * TWO_PI;
  return {
    ...restPose(),
    bob: -WALK_BOB * Math.cos(angle * 2),
    // The back bunches as the hind feet gather under the body and stretches as
    // they drive back — two flexions per stride, opposite in phase to the bob.
    arch: WALK_ARCH * Math.sin(angle * 2),
    lean: deg(1.5) * Math.sin(angle * 2),
    headY: WALK_BOB * 0.6 * Math.cos(angle * 2 + Math.PI),
    headX: 0.01 * Math.sin(angle),
    headTilt: deg(2) * Math.sin(angle),
    earL: 0.15 + 0.25 * Math.sin(angle * 2),
    earR: 0.15 - 0.25 * Math.sin(angle * 2),
    eyeOpen: blink(phase, 0.35),
    whisker: WALK_WHISKER_SWEEP * Math.sin(angle * 2),
    tail: tailPose(SIDE_TAIL_BASE, 0.35, 0.55, angle, 0.35 * Math.sin(angle)),
    frontR: gaitFoot(phase, WALK_REACH_SIDE, WALK_LIFT_SIDE),
    frontL: gaitFoot(phase + 0.5, WALK_REACH_SIDE, WALK_LIFT_SIDE),
    hindR: gaitFoot(phase + 0.5, WALK_REACH_SIDE * 1.1, WALK_LIFT_SIDE * 0.9),
    hindL: gaitFoot(phase, WALK_REACH_SIDE * 1.1, WALK_LIFT_SIDE * 0.9),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

/**
 * Head-on, a foot does not swing across the body — it lifts, tracks inward under
 * the chest the way a rat's near-single-track scurry does, and plants a little
 * further down the screen as it comes toward the camera.
 */
const WALK_FRONT_LIFT = 0.12;
const WALK_FRONT_TRACK_IN = 0.028;
const WALK_FRONT_PLANT = 0.012;

function frontStep(phase: number, side: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const lift = swinging ? hump(t) : 0;
  const trackIn = swinging ? Math.sin(t * Math.PI) : 0;
  const plant = swinging ? 0 : WALK_FRONT_PLANT * hump(t);
  return {
    dx: -side * WALK_FRONT_TRACK_IN * trackIn,
    dy: plant - WALK_FRONT_LIFT * lift,
    lift,
    splay: lerp(0.7, 0.2, lift),
  };
}

function walkFront(phase: number): RatPose {
  const angle = phase * TWO_PI;
  const sway = WALK_SWAY * Math.sin(angle);
  return {
    ...restPose(),
    bob: -WALK_BOB * Math.cos(angle * 2),
    sway,
    lean: deg(3) * Math.sin(angle),
    arch: WALK_ARCH * 0.5 * Math.sin(angle * 2),
    // The head stays over the centreline while the shoulders roll under it.
    headX: -sway * 0.6,
    headY: WALK_BOB * 0.4 * Math.cos(angle * 2),
    headTilt: deg(-2.5) * Math.sin(angle),
    headTurn: 0.1 * Math.sin(angle),
    earL: 0.3,
    earR: 0.3,
    eyeOpen: blink(phase, 0.7),
    whisker: WALK_WHISKER_SWEEP * Math.sin(angle * 2),
    tail: tailPose(FRONT_TAIL_BASE, -0.55, 0.5, angle, 0.3 * Math.sin(angle * 2)),
    frontL: frontStep(phase, -1),
    frontR: frontStep(phase + 0.5, 1),
    // The hind feet only peek past the flanks head-on. Bobbing them too reads as
    // four balls juggling rather than as an animal walking, so they stay put and
    // the front pair carries the whole rhythm.
    hindL: PLANTED,
    hindR: PLANTED,
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

function walkBack(phase: number): RatPose {
  const angle = phase * TWO_PI;
  const front = walkFront(phase);
  // From behind it is the hind pair that shows, so the step swaps legs.
  return {
    ...front,
    sway: -front.sway,
    headX: -front.headX,
    lean: -front.lean,
    headTilt: -front.headTilt,
    headTurn: 0.06 * Math.sin(angle),
    tail: tailPose(BACK_TAIL_BASE, 1.25, 0.7, angle, 0.4 * Math.sin(angle * 2), BACK_TAIL_ROOT_X),
    frontL: PLANTED,
    frontR: PLANTED,
    hindL: frontStep(phase, -1),
    hindR: frontStep(phase + 0.5, 1),
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BREATH = 0.005;
/**
 * A resting rat is never still: it sniffs several times a second, and the nose
 * bob is the cue that separates an idle rat from a stopped one.
 */
const IDLE_SNIFF_CYCLES = 5;
const IDLE_SNIFF_DEPTH = 0.008;

function idleFront(phase: number): RatPose {
  const angle = phase * TWO_PI;
  const sniff = Math.sin(angle * IDLE_SNIFF_CYCLES);
  return {
    ...restPose(),
    bob: IDLE_BREATH * Math.sin(angle),
    breathe: Math.sin(angle),
    arch: 0.2 + 0.15 * Math.sin(angle),
    headY: IDLE_SNIFF_DEPTH * sniff,
    headTilt: deg(2) * Math.sin(angle * 0.5),
    headTurn: 0.12 * Math.sin(angle * 0.5),
    earL: 0.35 + 0.35 * Math.sin(angle * 2),
    earR: 0.35 - 0.35 * Math.sin(angle * 2),
    eyeOpen: blink(phase, 0.55),
    whisker: 0.45 * sniff,
    tail: tailPose(FRONT_TAIL_BASE, -0.5, 0.35, angle, 0.4 * Math.sin(angle * 2)),
    time: phase,
  };
}

function idleSide(phase: number): RatPose {
  const angle = phase * TWO_PI;
  return {
    ...idleFront(phase),
    headX: 0.006 * Math.sin(angle * IDLE_SNIFF_CYCLES),
    tail: tailPose(SIDE_TAIL_BASE, 0.5, 0.3, angle, 0.5 * Math.sin(angle * 2)),
  };
}

function idleBack(phase: number): RatPose {
  const angle = phase * TWO_PI;
  return {
    ...idleFront(phase),
    tail: tailPose(BACK_TAIL_BASE, 1.15, 0.45, angle, 0.5 * Math.sin(angle * 2), BACK_TAIL_ROOT_X),
  };
}

// ── Bite ─────────────────────────────────────────────────────────────────────

const BITE_WINDUP_END = 0.32;
const BITE_SNAP_END = 0.6;
/** How far the whole animal drives forward on the strike, in tile units. */
const BITE_LUNGE_REACH = 0.16;
interface BitePhases {
  readonly gather: number;
  readonly strike: number;
  readonly recover: number;
  readonly gape: number;
  readonly bared: number;
}

function bitePhases(progress: number): BitePhases {
  const gather = easeInOut(ramp(progress, 0, BITE_WINDUP_END));
  const strike = easeInOut(ramp(progress, BITE_WINDUP_END, BITE_SNAP_END));
  const recover = easeInOut(ramp(progress, BITE_SNAP_END, 1));
  return {
    gather,
    strike,
    recover,
    // The jaw opens on the gather, stays wide across the lunge, and snaps shut
    // the instant the strike lands — the snap is the frame that reads as damage.
    gape: easeInOut(ramp(progress, 0.04, 0.3)) * (1 - easeInOut(ramp(progress, 0.5, 0.62))),
    // The teeth stay bared into the recovery; a rat does not put them away the
    // moment it lets go.
    bared: clamp01(ramp(progress, 0.02, 0.18)) * (1 - easeInOut(ramp(progress, 0.8, 1))),
  };
}

function biteSide(progress: number): RatPose {
  const b = bitePhases(progress);
  const drive = b.strike * (1 - b.recover);
  return {
    ...restPose(),
    lunge: BITE_LUNGE_REACH * drive,
    bob: 0.012 * b.gather - 0.014 * drive,
    sway: -0.03 * b.gather,
    // Humped hard on the gather, thrown flat as the body extends into the bite.
    arch: lerp(0.9, -0.7, b.strike) * (1 - b.recover * 0.6),
    lean: deg(-5) * b.gather + deg(7) * drive,
    squash: 1 - 0.05 * drive,
    headX: lerp(-0.025, 0.05, b.strike) * (1 - b.recover * 0.7),
    headY: -0.01 * b.gather + 0.018 * drive,
    headTilt: deg(-8) * b.gather + deg(10) * drive,
    // Ears pinned flat: the universal mammal tell that an attack is coming.
    earL: -1,
    earR: -1,
    eyeOpen: lerp(1, 0.55, b.gather),
    mouth: b.gape,
    incisor: b.bared,
    whisker: 1 - 1.6 * drive,
    tail: tailPose(SIDE_TAIL_BASE, 0.8 - 0.9 * drive, 1.1, progress * 7, -1.2 * drive),
    frontR: foot(0.05 * b.gather + 0.03 * drive, -0.05 * drive, drive, 0.3),
    frontL: foot(0.03 * b.gather, -0.03 * drive, drive * 0.7, 0.3),
    hindR: foot(-0.05 * b.gather, 0, 0, 0.85),
    hindL: foot(-0.03 * b.gather, 0, 0, 0.85),
    time: progress,
  };
}

function biteFront(progress: number): RatPose {
  const b = bitePhases(progress);
  const drive = b.strike * (1 - b.recover);
  return {
    ...restPose(),
    bob: 0.012 * b.gather - 0.018 * drive,
    // Head-on there is no forward reach to show, so the lunge is sold by the
    // body squashing wide and the head dropping toward the camera instead.
    squash: 1 - 0.09 * drive,
    arch: lerp(0.9, -0.5, b.strike) * (1 - b.recover * 0.6),
    lean: deg(-3) * b.gather + deg(4) * drive,
    headY: -0.012 * b.gather + 0.05 * drive,
    headTilt: deg(4) * Math.sin(progress * TWO_PI * 2) * drive,
    earL: -1,
    earR: -1,
    eyeOpen: lerp(1, 0.5, b.gather),
    mouth: b.gape,
    incisor: b.bared,
    whisker: 1 - 1.6 * drive,
    tail: tailPose(FRONT_TAIL_BASE, -0.7 + 0.5 * drive, 1, progress * 7, -1 * drive),
    frontL: foot(-0.04 * drive, -0.06 * drive, drive, 0.3),
    frontR: foot(0.04 * drive, -0.06 * drive, drive, 0.3),
    hindL: PLANTED,
    hindR: PLANTED,
    time: progress,
  };
}

function biteBack(progress: number): RatPose {
  const b = bitePhases(progress);
  const drive = b.strike * (1 - b.recover);
  return {
    ...restPose(),
    bob: 0.012 * b.gather - 0.02 * drive,
    squash: 1 - 0.07 * drive,
    arch: lerp(0.9, -0.5, b.strike) * (1 - b.recover * 0.6),
    lean: deg(3) * b.gather - deg(5) * drive,
    // Seen from behind the bite is all rump: the haunches gather, the tail
    // whips, and the head is hidden. Anything else here would be invented.
    headY: -0.02 * drive,
    earL: -1,
    earR: -1,
    tail: tailPose(BACK_TAIL_BASE, 1.2, 1.3, progress * 7, 1.4 * drive, BACK_TAIL_ROOT_X),
    hindL: foot(-0.03 * b.gather, 0, 0, 0.85),
    hindR: foot(0.03 * b.gather, 0, 0, 0.85),
    time: progress,
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
  readonly pose: ((t: number) => RatPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const GORE_PIECES = ratGorePieces();

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
    name: 'bite',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => biteFront(shotProgress(f, BITE_FRAMES)),
  },
  {
    name: 'bite_side',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => biteSide(shotProgress(f, BITE_FRAMES)),
  },
  {
    name: 'bite_away',
    frameCount: BITE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => biteBack(shotProgress(f, BITE_FRAMES)),
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
   * Animation cells anchor on the painter's own origin; gore cells anchor on the
   * centre of the cell, because that is the point the runtime spins them about.
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

      const pose = row.pose;
      if (pose === null) throw new Error(`row "${row.name}" is not gore but has no pose function`);
      const view = row.view;
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        recentre: { x: 0, y: 0 },
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line so a smaller rat still stands on the
          // tile its feet belong to rather than floating above it.
          ctx.translate(0, GROUND_Y);
          ctx.scale(RAT_SCALE, RAT_SCALE);
          ctx.translate(0, -GROUND_Y);
          if (view === 'front') drawRatFront(ctx, pose(frame));
          else if (view === 'back') drawRatBack(ctx, pose(frame));
          else drawRatSide(ctx, pose(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

/**
 * How much bigger than the animation rows need the gore may make every cell.
 * Rotation safety is free — `geometryFor` guarantees it — so this bounds cost,
 * not correctness.
 */
const GORE_AREA_INFLATION_LIMIT = 2;

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
      // A severed limb has its mass well off its construction origin, and the
      // runtime spins about the cell centre — an off-centre piece orbits rather
      // than tumbles. This offset is what pulls its ink back onto the pivot.
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
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}× the area the animation ` +
        `rows need — shrink the longest piece rather than paying for it on all ${ROWS.length} rows`,
    );
  }
  if (inflation > 1) {
    console.log(`  gore widens each cell to ${inflation.toFixed(2)}× the animation rows' own size`);
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
    const originX = geometry.frameWidth / 2;
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
    job.paint(cellCtx, originX, originY);
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

export const SHEET_PATH = 'src/images/enemies/rat.png';
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
    path: 'enemies/rat.png',
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
 * `tileY` must not read as a mismatch. Sorting before stringifying is enough
 * here because the entry is two levels deep and holds no arrays.
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
 * on disk that its manifest does not describe renders as garbage, and a warning
 * on a zero exit is a state this repo has already been found sitting in.
 */
function verifyManifest(sheet: BakedSheet): void {
  const required = manifestEntryFor(sheet);
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  if (canonicalJson(manifest.rat) !== canonicalJson(required)) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "rat" entry with:\n` +
        `${JSON.stringify(required, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheet(): void {
  console.log(`Generating rat sprite sheet (tileScale=${TILE_SCALE}, scale=${RAT_SCALE})…`);
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
