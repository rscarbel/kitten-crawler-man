/**
 * The rat, as a painted figure: the choreography, the cell geometry, and the
 * `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell.
 * Anatomy, palette and every stroke of paint live in `ratArt.ts` and
 * `ratGore.ts`.
 *
 * A pose row hangs off the ground line inside the tile the rat stands on; a gore
 * piece hangs off the centre of the cell, because that is the point the runtime
 * spins it about.
 *
 * The art invariants live in `scripts/gates-rat.ts`, which the review harness
 * runs: `npm run render:rat`.
 */

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
} from './ratArt';
import { ratGorePieces, type GorePiece } from './ratGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ─────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

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
 * Extra scale applied to the gore pieces on top of {@link RAT_SCALE}.
 *
 * Anatomically a rat's severed head is tiny, and drawn at its true size it comes
 * out about five screen pixels across once the runtime's own 0.5x is applied —
 * below the size at which a shape can be told from any other shape. The pieces
 * are deliberately oversized so the set stays namable; the alternative is eight
 * indistinguishable red specks.
 */
const GORE_PIECE_SCALE = 1.4;

/** Pixels per tile unit a gore piece is painted at. */
export const GORE_UNIT = TILE_SCALE * RAT_SCALE * GORE_PIECE_SCALE;

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * creature's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the widest
 * pose plus padding, quantised, and both axes widened to clear the longest gore
 * piece's *inscribed* circle so a spinning tail does not cut its own corners —
 * and `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. `tileY` is negative because the rat is much shorter than a
 * tile: the tile box it registers on extends above the cell's own top edge.
 */
const FRAME_WIDTH = 144;
const FRAME_HEIGHT = 80;
const TILE_X = 40;
const TILE_Y = -9;

/** A pose hangs off the middle of the tile box, which is where its ground line is. */
export const POSE_ORIGIN_X = FRAME_WIDTH / 2;
export const POSE_ORIGIN_Y = TILE_Y + TILE_SCALE / 2;
/** A gore piece spins about the cell's own centre, so that is where it is painted. */
export const GORE_ORIGIN_X = FRAME_WIDTH / 2;
export const GORE_ORIGIN_Y = FRAME_HEIGHT / 2;

export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 8;
export const BITE_FRAMES = 8;

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

// ── Row manifest ───────────────────────────────────────────────────────

export type RatView = 'front' | 'side' | 'back';
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: RatView;
  readonly pose: (frame: number) => RatPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const GORE_PIECES: readonly GorePiece[] = ratGorePieces();

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
];

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

// ── Gore placement ───────────────────────────────────────────────────

/**
 * How far each gore piece is nudged so that its ink, not its construction
 * origin, sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its cell, so a piece
 * drawn off-centre in that cell orbits rather than tumbles. The offsets are in
 * the piece's own units, the same ones its `paint` is scaled by, and they were
 * measured from the painted ink of each piece — something only an offline pass
 * can do. They are frozen here and `scripts/gates-rat.ts` re-measures them on
 * every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, { readonly x: number; readonly y: number }> =
  new Map([
    ['gore_head', { x: 0.051020408163265314, y: 0.03188775510204082 }],
    ['gore_torso', { x: -0.012755102040816329, y: 0.012755102040816329 }],
    ['gore_haunch', { x: 0.03188775510204082, y: 0 }],
    ['gore_foreleg', { x: 0.01913265306122449, y: 0.03188775510204082 }],
    ['gore_tail', { x: 0.04464285714285715, y: 0.01913265306122449 }],
    ['gore_ribchunk', { x: 0.012755102040816329, y: -0.006377551020408164 }],
    ['gore_entrails', { x: 0.012755102040816329, y: 0.03188775510204082 }],
    ['gore_pelt', { x: 0, y: 0.012755102040816329 }],
  ]);

function goreRecentreOf(state: string): { readonly x: number; readonly y: number } {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): GorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return ROWS.find((row) => row.name === state);
}

function paintView(ctx: CanvasRenderingContext2D, view: RatView, pose: RatPose): void {
  if (view === 'front') drawRatFront(ctx, pose);
  else if (view === 'back') drawRatBack(ctx, pose);
  else drawRatSide(ctx, pose);
}

/** Paints one cell of the rat, in the cell's own pixels. */
function paintRatFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(GORE_ORIGIN_X + recentre.x * GORE_UNIT, GORE_ORIGIN_Y + recentre.y * GORE_UNIT);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  // Scaled about the ground line so a smaller rat still stands on the tile its
  // feet belong to rather than floating above it.
  ctx.translate(0, GROUND_Y);
  ctx.scale(RAT_SCALE, RAT_SCALE);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function ratStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const RAT_FIGURE: FigureDef = {
  id: 'rat',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(ratStateFrames()),
  paintFrame: paintRatFrame,
};
