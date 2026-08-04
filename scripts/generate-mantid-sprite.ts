#!/usr/bin/env tsx
/**
 * Generates the two Mantid sprite sheets:
 *
 *   `mantid` — the bounty boss, an enormous dark-carapaced praying mantis
 *   `mantis` — the crony mantises that escort him, and a reusable regular mob
 *
 * Both are baked from one drawing engine (`scripts/mantidArt.ts`) with different
 * `MantidBuild`s and different scales, the way the four goblin sheets are. They
 * are the same species; only the boss carries the rage rows.
 *
 * The anatomy and the painting live in the art module; this file is the
 * choreography plus the bake: one pose function per animation row, sampled per
 * frame, then measured and laid out.
 *
 * Rows (see the `mantid` / `mantis` entries in src/images/enemies/manifest.json):
 *    walk / walk_side / walk_away     — the rocking mantis gait
 *    idle / idle_side / idle_away     — swaying, head pivoting, antennae sweeping
 *    slash / slash_side / slash_away  — one raptorial strike: cock, snap, refold
 *    flurry / flurry_side / flurry_away  (boss only) — both arms, fast wide arcs
 *    rage_pause                        (boss only) — reared, cocked, trembling
 *    gore                              — the dismemberment pieces, one per column
 *
 * The frame geometry is measured rather than declared: the raptorial arms reach
 * more than half a tile past the body on a strike, and a hand-guessed cell is
 * how a snapped-out forelimb ends up sheared off at the frame edge.
 *
 * Run: npm run gen:mantid
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  FEMUR_LENGTH,
  FEMUR_SPINES,
  FORELIMB_SOCKET_ALONG,
  GROUND_Y,
  HEAD_DEPTH,
  HEAD_WIDTH,
  PRONOTUM_LENGTH,
  THORAX_RX,
  TIBIA_LENGTH,
  TIBIA_SPINES,
  MANTID_BOSS_BUILD,
  MANTIS_CRONY_BUILD,
  type LegPose,
  type MantidBuild,
  type MantidPose,
  type RaptorialPose,
  clamp01,
  deg,
  drawMantidBack,
  drawMantidFront,
  drawMantidSide,
  easeInOut,
  hump,
  lerp,
  ramp,
  restPose,
  TWO_PI,
  type LegPose as ArtLegPose,
} from './mantidArt.js';
import { mantidGorePieces } from './mantidGore.js';
// The runtime's own copy of the piece order, imported so the bake can police it.
import { MANTID_GORE_PARTS } from '../src/sprites/mantidSprite.js';

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

const WALK_FRAMES = 8;
const IDLE_FRAMES = 8;
const SLASH_FRAMES = 9;
const FLURRY_FRAMES = 8;
const RAGE_FRAMES = 6;

// ── Pose helpers ─────────────────────────────────────────────────────────────

const PLANTED: LegPose = { dx: 0, dy: 0, lift: 0, splay: 1 };

function leg(dx: number, dy: number, lift: number, splay = 1): LegPose {
  return { dx, dy, lift, splay };
}

function arm(swing: number, unfold: number, spread = 0, reach = 0): RaptorialPose {
  return { swing, unfold, spread, reach };
}

/**
 * A foot in the walk. Mantises are slow, deliberate walkers: a long stance and a
 * short, high, hesitant swing. Speeding the swing up turns the gait into a
 * beetle scuttle, which is the one thing this animal must not look like.
 */
const SWING_SHARE = 0.36;

function gaitFoot(phase: number, reach: number, height: number): LegPose {
  const cycle = ((phase % 1) + 1) % 1;
  const swinging = cycle < SWING_SHARE;
  const t = swinging ? cycle / SWING_SHARE : (cycle - SWING_SHARE) / (1 - SWING_SHARE);
  const dx = swinging ? lerp(-reach, reach, easeInOut(t)) : lerp(reach, -reach, t);
  const lift = swinging ? hump(t) : 0;
  return { dx, dy: 0, lift: lift * height, splay: lerp(1, 0.9, lift) };
}

// ── Walk ─────────────────────────────────────────────────────────────────────

const WALK_BOB = 0.016;
const WALK_SWAY = 0.02;
const WALK_REACH_SIDE = 0.085;
const WALK_LIFT = 1;
const WALK_HEIGHT_SCALE = 0.9;

/**
 * A mantis walks its four legs in diagonal pairs — middle-left with hind-right —
 * and rocks the whole body from side to side as it goes, a leftover of the
 * swaying it does to mimic vegetation. The rock is at the *stride* frequency,
 * not twice it, and that slow lateral roll is the gait's whole signature.
 */
function diagonalFeet(
  phase: number,
  reach: number,
): Pick<MantidPose, 'midL' | 'midR' | 'hindL' | 'hindR'> {
  return {
    midL: gaitFoot(phase, reach, WALK_LIFT),
    hindR: gaitFoot(phase, reach * WALK_HEIGHT_SCALE, WALK_LIFT),
    midR: gaitFoot(phase + 0.5, reach, WALK_LIFT),
    hindL: gaitFoot(phase + 0.5, reach * WALK_HEIGHT_SCALE, WALK_LIFT),
  };
}

function walkSide(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...restPose(),
    bob: -WALK_BOB * Math.cos(angle * 2),
    sway: WALK_SWAY * 0.4 * Math.sin(angle),
    lean: deg(2.4) * Math.sin(angle),
    pronotumPitch: deg(3.5) * Math.sin(angle + Math.PI / 4),
    headPitch: deg(-2.5) * Math.sin(angle),
    headTurn: 0.18 * Math.sin(angle * 0.5),
    gaze: 0.5,
    antenna: phase,
    abdomenLift: 0.012 * Math.sin(angle),
    abdomenSway: Math.sin(angle),
    breathe: Math.sin(angle),
    foreL: arm(deg(4) * Math.sin(angle), 0.06 + 0.04 * hump(phase)),
    foreR: arm(deg(-4) * Math.sin(angle), 0.05),
    ...diagonalFeet(phase, WALK_REACH_SIDE),
    time: phase,
  };
}

function walkFront(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...walkSide(phase),
    // Head-on there is no stride length to show, so the lateral rock carries the
    // entire animation.
    sway: WALK_SWAY * Math.sin(angle),
    lean: deg(4) * Math.sin(angle),
    pronotumYaw: deg(5) * Math.sin(angle),
    headTurn: 0.35 * Math.sin(angle * 0.5),
    gaze: 0.6 * Math.sin(angle * 0.5),
    midL: gaitFoot(phase, WALK_REACH_SIDE * 0.5, WALK_LIFT),
    hindR: gaitFoot(phase, WALK_REACH_SIDE * 0.45, WALK_LIFT),
    midR: gaitFoot(phase + 0.5, WALK_REACH_SIDE * 0.5, WALK_LIFT),
    hindL: gaitFoot(phase + 0.5, WALK_REACH_SIDE * 0.45, WALK_LIFT),
  };
}

function walkBack(phase: number): MantidPose {
  const front = walkFront(phase);
  return {
    ...front,
    // Seen from behind the same rock runs the other way across the screen.
    sway: -front.sway,
    lean: -front.lean,
    pronotumYaw: -front.pronotumYaw,
    headTurn: -front.headTurn,
    abdomenLift: front.abdomenLift * 1.4,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * The sway. A standing mantis rocks continuously — it is the single most
 * recognisable thing the animal does when it is not moving, and without it a
 * stopped mantis is indistinguishable from a dead one at tile size.
 */
const IDLE_SWAY = 0.026;
const IDLE_BREATH = 0.006;
/** Cycles of head pivot per idle loop. Slower than the sway: it is a *look*. */
const IDLE_HEAD_CYCLES = 0.5;

function idleSide(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...restPose(),
    sway: IDLE_SWAY * Math.sin(angle),
    bob: IDLE_BREATH * Math.sin(angle * 2),
    lean: deg(3) * Math.sin(angle),
    breathe: Math.sin(angle * 2),
    pronotumPitch: deg(2) * Math.sin(angle),
    headTurn: 0.4 * Math.sin(angle * IDLE_HEAD_CYCLES),
    headTilt: deg(5) * Math.sin(angle),
    // The gaze lags the head turn, so the eye keeps hold of the viewer while the
    // head swings. A pupil locked to the head reads as a doll's.
    gaze: -0.7 * Math.sin(angle * IDLE_HEAD_CYCLES),
    antenna: phase,
    abdomenSway: 0.6 * Math.sin(angle),
    foreL: arm(deg(3) * Math.sin(angle * 2), 0.05 + 0.03 * Math.sin(angle * 3)),
    foreR: arm(deg(-3) * Math.sin(angle * 2), 0.04),
    midL: PLANTED,
    midR: PLANTED,
    hindL: PLANTED,
    hindR: PLANTED,
    time: phase,
  };
}

function idleFront(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...idleSide(phase),
    sway: IDLE_SWAY * 1.3 * Math.sin(angle),
    pronotumYaw: deg(7) * Math.sin(angle),
    headTurn: 0.55 * Math.sin(angle * IDLE_HEAD_CYCLES),
    gaze: -0.8 * Math.sin(angle * IDLE_HEAD_CYCLES),
  };
}

function idleBack(phase: number): MantidPose {
  const front = idleFront(phase);
  return {
    ...front,
    sway: -front.sway,
    pronotumYaw: -front.pronotumYaw,
    headTurn: -front.headTurn,
    abdomenLift: 0.01 * Math.sin(phase * TWO_PI),
  };
}

// ── Slash ────────────────────────────────────────────────────────────────────

/**
 * One raptorial strike. The three windows are deliberately uneven: a mantis
 * cocks slowly and visibly — that is the player's cue to move — and then the
 * strike itself is over in two frames. Evening them out removes both the tell
 * and the shock.
 */
const SLASH_COCK_END = 0.36;
const SLASH_SNAP_END = 0.56;
/** How far the whole animal drives forward on the strike, in tile units. */
const SLASH_LUNGE = 0.11;

interface SlashPhases {
  readonly cock: number;
  readonly snap: number;
  readonly recover: number;
}

function slashPhases(progress: number): SlashPhases {
  return {
    cock: easeInOut(ramp(progress, 0, SLASH_COCK_END)),
    snap: easeInOut(ramp(progress, SLASH_COCK_END, SLASH_SNAP_END)),
    recover: easeInOut(ramp(progress, SLASH_SNAP_END, 1)),
  };
}

/** The striking arm, in whichever view. `mirror` matches the view's arm sign. */
function strikingArm(s: SlashPhases): RaptorialPose {
  const cocked = s.cock * (1 - s.snap);
  const driven = s.snap * (1 - s.recover);
  return arm(
    deg(-34) * cocked + deg(30) * driven,
    // The snap goes nearly straight and the refold is fast but not instant, so
    // the last frames of the row still show the arm coming home.
    0.06 + 0.92 * driven,
    0,
    0.03 * driven,
  );
}

function slashSide(progress: number): MantidPose {
  const s = slashPhases(progress);
  const cocked = s.cock * (1 - s.snap);
  const driven = s.snap * (1 - s.recover);
  return {
    ...restPose(),
    lunge: SLASH_LUNGE * driven,
    bob: 0.018 * cocked - 0.012 * driven,
    lean: deg(-6) * cocked + deg(9) * driven,
    squash: 1 - 0.03 * driven,
    pronotumPitch: deg(-13) * cocked + deg(16) * driven,
    headPitch: deg(7) * cocked - deg(11) * driven,
    gaze: 0.9,
    antenna: progress * 0.5,
    abdomenLift: -0.02 * cocked,
    abdomenCurl: deg(9) * cocked,
    wingFlare: 0.14 * cocked,
    foreL: strikingArm(s),
    // The off arm hauls back as a counterweight rather than sitting still; a
    // stationary second arm makes the strike read as a puppet's.
    foreR: arm(deg(20) * cocked - deg(12) * driven, 0.04),
    // The hind legs brace back against the lunge instead of following it.
    midL: leg(0.03 * driven, 0, 0, 0.96),
    midR: leg(0.02 * driven, 0, 0, 0.96),
    hindL: leg(-0.045 * driven, 0, 0, 1.04),
    hindR: leg(-0.035 * driven, 0, 0, 1.04),
    breathe: cocked,
    time: progress,
  };
}

function slashFront(progress: number): MantidPose {
  const s = slashPhases(progress);
  const cocked = s.cock * (1 - s.snap);
  const driven = s.snap * (1 - s.recover);
  return {
    ...slashSide(progress),
    // Head-on there is no forward reach to show, so the strike is sold by the
    // arm crossing the body and the whole animal dropping toward the camera.
    lunge: 0,
    squash: 1 - 0.07 * driven,
    lean: deg(-3) * cocked + deg(5) * driven,
    pronotumYaw: deg(-9) * cocked + deg(11) * driven,
    foreL: { ...strikingArm(s), spread: 0.55 * cocked - 0.35 * driven },
    foreR: arm(deg(14) * cocked, 0.04, 0.25 * cocked),
    midL: PLANTED,
    midR: PLANTED,
    hindL: leg(0.02 * driven, 0, 0, 1.03),
    hindR: leg(0.02 * driven, 0, 0, 1.03),
  };
}

function slashBack(progress: number): MantidPose {
  const front = slashFront(progress);
  return {
    ...front,
    // From behind almost nothing of the arm shows past the wing cases; what the
    // player reads is the body dropping and the abdomen kicking up.
    pronotumYaw: -front.pronotumYaw,
    abdomenCurl: front.abdomenCurl * 1.6,
    abdomenLift: -0.025 * easeInOut(ramp(progress, 0, SLASH_SNAP_END)),
  };
}

// ── Flurry ───────────────────────────────────────────────────────────────────

/**
 * Both arms, alternating, at double the strike rate — the boss's three-second
 * kill window. The row loops, so it has no cock and no recovery: it is a
 * blender, and it has to look like one from the first frame the player sees.
 */
const FLURRY_ARC = deg(58);
const FLURRY_LEAN = deg(7);

function flurryArm(phase: number): RaptorialPose {
  const cycle = ((phase % 1) + 1) % 1;
  // Each arm spends the first half of its own cycle throwing and the second half
  // recovering, so at any instant one arm is out and the other is coming back.
  const throwT = clamp01(cycle / 0.5);
  const swing = -FLURRY_ARC * 0.5 + FLURRY_ARC * easeInOut(throwT);
  const unfold = cycle < 0.5 ? easeInOut(cycle / 0.5) : 1 - easeInOut((cycle - 0.5) / 0.5);
  return arm(swing, 0.1 + 0.85 * unfold, 0.35 * unfold, 0.02 * unfold);
}

function flurrySide(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...restPose(),
    lean: FLURRY_LEAN + deg(3) * Math.sin(angle * 2),
    bob: -0.014 * Math.abs(Math.sin(angle)),
    lunge: 0.03,
    squash: 0.98,
    pronotumPitch: deg(10) + deg(4) * Math.sin(angle * 2),
    headPitch: deg(-8),
    gaze: 1,
    antenna: phase * 2,
    abdomenCurl: deg(16),
    abdomenSway: Math.sin(angle * 2),
    wingFlare: 0.3,
    foreL: flurryArm(phase),
    foreR: flurryArm(phase + 0.5),
    midL: gaitFoot(phase * 2, 0.05, 0.6),
    midR: gaitFoot(phase * 2 + 0.5, 0.05, 0.6),
    hindL: leg(-0.02, 0, 0, 1.05),
    hindR: leg(-0.03, 0, 0, 1.05),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

function flurryFront(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  return {
    ...flurrySide(phase),
    lunge: 0,
    lean: deg(3) * Math.sin(angle),
    pronotumYaw: deg(8) * Math.sin(angle * 2),
    foreL: { ...flurryArm(phase), spread: 0.7 },
    foreR: { ...flurryArm(phase + 0.5), spread: 0.7 },
  };
}

function flurryBack(phase: number): MantidPose {
  const front = flurryFront(phase);
  return {
    ...front,
    pronotumYaw: -front.pronotumYaw,
    abdomenLift: -0.02,
  };
}

// ── Rage pause ───────────────────────────────────────────────────────────────

/**
 * The invincible second. The pose has to say "something is about to happen"
 * without the exclamation mark above it: reared back over the hind legs, both
 * arms cocked wide and open rather than folded, wing cases thrown up in a
 * deimatic display, and the whole body shivering.
 *
 * Held for a full second, so the loop is slow and the tremble carries it.
 */
const RAGE_TREMBLE = 0.012;

function ragePause(phase: number): MantidPose {
  const angle = phase * TWO_PI;
  // The display *builds* across the loop rather than sitting flat, which is what
  // stops a one-second hold from reading as a freeze bug.
  const swell = 0.7 + 0.3 * Math.sin(angle - Math.PI / 2);
  return {
    ...restPose(),
    rear: swell,
    tremble: RAGE_TREMBLE,
    lean: deg(-4) * swell,
    squash: 1 + 0.02 * swell,
    pronotumPitch: deg(-18) * swell,
    headPitch: deg(12) * swell,
    gaze: 0,
    antenna: phase * 3,
    abdomenCurl: deg(30) * swell,
    abdomenLift: -0.03 * swell,
    wingFlare: swell,
    foreL: arm(deg(-46) * swell, 0.4 * swell, 0.8 * swell),
    foreR: arm(deg(-46) * swell, 0.4 * swell, 0.8 * swell),
    midL: leg(0.03, 0, 0, 0.94),
    midR: leg(0.03, 0, 0, 0.94),
    hindL: leg(-0.03, 0, 0, 1.06),
    hindR: leg(-0.03, 0, 0, 1.06),
    breathe: 1,
    time: phase,
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
  readonly pose: ((t: number) => MantidPose) | null;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const GORE_PIECES = mantidGorePieces();

/**
 * Extra scale applied to the gore pieces on top of the variant scale.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * animal, so they do not inherit its scale — but they do have to survive the
 * runtime's own downscale to a 32 px tile.
 */
const GORE_PIECE_SCALE = 1.4;

const SHARED_ROWS: readonly RowSpec[] = [
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
    name: 'slash',
    frameCount: SLASH_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => slashFront(shotProgress(f, SLASH_FRAMES)),
  },
  {
    name: 'slash_side',
    frameCount: SLASH_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => slashSide(shotProgress(f, SLASH_FRAMES)),
  },
  {
    name: 'slash_away',
    frameCount: SLASH_FRAMES,
    kind: 'oneShot',
    view: 'back',
    pose: (f) => slashBack(shotProgress(f, SLASH_FRAMES)),
  },
];

const BOSS_ONLY_ROWS: readonly RowSpec[] = [
  {
    name: 'flurry',
    frameCount: FLURRY_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => flurryFront(cyclePhase(f, FLURRY_FRAMES)),
  },
  {
    name: 'flurry_side',
    frameCount: FLURRY_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => flurrySide(cyclePhase(f, FLURRY_FRAMES)),
  },
  {
    name: 'flurry_away',
    frameCount: FLURRY_FRAMES,
    kind: 'loop',
    view: 'back',
    pose: (f) => flurryBack(cyclePhase(f, FLURRY_FRAMES)),
  },
  {
    name: 'rage_pause',
    frameCount: RAGE_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => ragePause(cyclePhase(f, RAGE_FRAMES)),
  },
];

const GORE_ROW: RowSpec = {
  name: 'gore',
  frameCount: GORE_PIECES.length,
  kind: 'gore',
  view: 'side',
  pose: null,
};

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

// ── Variants ─────────────────────────────────────────────────────────────────

export type VariantId = 'mantid' | 'mantis';

export interface Variant {
  readonly id: VariantId;
  readonly build: MantidBuild;
  /**
   * How much of a tile the animal fills, scaled about its own ground line so its
   * feet stay on the tile they belong to.
   */
  readonly scale: number;
  readonly rows: readonly RowSpec[];
  readonly sheetPath: string;
  readonly manifestPath: string;
}

/**
 * The boss is drawn at nearly three tiles tall. That is a deliberate silhouette
 * decision rather than a stat one: a bounty target has to be identifiable as
 * *the* thing on the field from the edge of the screen, and at two tiles this
 * animal is merely a large bug.
 */
const BOSS_SCALE = 2.5;
/** The crony reads as a full-grown mantis but still fits a corridor. */
const CRONY_SCALE = 1.3;

export const VARIANTS: readonly Variant[] = [
  {
    id: 'mantid',
    build: MANTID_BOSS_BUILD,
    scale: BOSS_SCALE,
    rows: [...SHARED_ROWS, ...BOSS_ONLY_ROWS, GORE_ROW],
    sheetPath: 'src/images/enemies/mantid.png',
    manifestPath: 'enemies/mantid.png',
  },
  {
    id: 'mantis',
    build: MANTIS_CRONY_BUILD,
    scale: CRONY_SCALE,
    rows: [...SHARED_ROWS, GORE_ROW],
    sheetPath: 'src/images/enemies/mantis.png',
    manifestPath: 'enemies/mantis.png',
  },
];

export function variantById(id: string): Variant {
  const found = VARIANTS.find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no mantid variant named "${id}"`);
  return found;
}

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
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(variant: Variant, goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE * variant.scale;
  const jobs: FrameJob[] = [];
  for (const row of variant.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = GORE_PIECES[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * goreUnit, originY + recentre.y * goreUnit);
            ctx.scale(goreUnit, goreUnit);
            piece.paint(ctx, variant.build);
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
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line so a bigger mantis still stands on the
          // tile its feet belong to rather than floating above it.
          ctx.translate(0, GROUND_Y);
          ctx.scale(variant.scale, variant.scale);
          ctx.translate(0, -GROUND_Y);
          if (view === 'front') drawMantidFront(ctx, pose(frame), variant.build);
          else if (view === 'back') drawMantidBack(ctx, pose(frame), variant.build);
          else drawMantidSide(ctx, pose(frame), variant.build);
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
const MEASURE_SIZE = 768;

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
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  readonly goreRadius: number;
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Frames that painted nothing — the signature of a NaN pose. */
  readonly blankFrames: readonly string[];
  /** Frames whose ink touched the measurement canvas edge — the pose is off-scale. */
  readonly clippedFrames: readonly string[];
}

function measure(variant: Variant, jobs: readonly FrameJob[]): Extents {
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE * variant.scale;
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
  const clippedFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(ctx, originX, originY);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }
    if (
      box.minX <= 0 ||
      box.minY <= 0 ||
      box.maxX >= MEASURE_SIZE - 1 ||
      box.maxY >= MEASURE_SIZE - 1
    ) {
      clippedFrames.push(`${job.row.name}[${job.frame}]`);
    }

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      // A severed limb has its mass well off its construction origin, which
      // would leave it drawn to one side of a cell sized for it. This offset
      // pulls the ink back to the middle, which is what makes `goreRadius`
      // below a meaningful measure of how big the pieces actually are.
      const previous = goreOffsets.get(job.frame) ?? { x: 0, y: 0 };
      goreOffsets.set(job.frame, {
        x: previous.x + (originX - inkCentreX) / goreUnit,
        y: previous.y + (originY - inkCentreY) / goreUnit,
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

  return { left, right, up, down, goreRadius, goreOffsets, blankFrames, clippedFrames };
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
  readonly variant: Variant;
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

export function bake(variant: Variant): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second repaints it centred on that measurement.
  const measured = measure(variant, buildJobs(variant));
  const jobs = buildJobs(variant, measured.goreOffsets);
  const extents = measure(variant, jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `[${variant.id}] these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }
  if (extents.clippedFrames.length > 0) {
    throw new Error(
      `[${variant.id}] these frames ran off the ${MEASURE_SIZE}px measuring canvas, so their true ` +
        `extent is unknown and the baked cell would shear them: ${extents.clippedFrames.join(', ')}`,
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `[${variant.id}] the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the ` +
        `animation rows need — shrink the longest piece rather than paying for it on all ` +
        `${variant.rows.length} rows`,
    );
  }

  const columns = Math.max(...variant.rows.map((row) => row.frameCount));
  const sheet = createCanvas(
    columns * geometry.frameWidth,
    variant.rows.length * geometry.frameHeight,
  );
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  const rowIndexOf = new Map(variant.rows.map((row, index) => [row.name, index]));

  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in the variant`);

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
    variant,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

// ── Anatomy bake gates ───────────────────────────────────────────────────────

/**
 * Assertions that encode what reviewers caught, so it cannot regress.
 *
 * These are geometric truths about the *anatomy constants*, checked before a
 * pixel is painted. They are cheap and they are the only thing standing between
 * a refactor and a mantis whose arms have quietly migrated onto its abdomen.
 */
export function assertAnatomy(): void {
  const problems: string[] = [];

  // The single cue that sells the animal: the raptorial sockets sit on the far
  // end of the pronotum, right behind the head — not on the thorax with the
  // walking legs, and never on the abdomen.
  if (FORELIMB_SOCKET_ALONG < MIN_FORELIMB_SOCKET_ALONG) {
    problems.push(
      `the raptorial forelimbs socket ${FORELIMB_SOCKET_ALONG.toFixed(2)} along the pronotum; ` +
        `they belong past ${MIN_FORELIMB_SOCKET_ALONG}, just behind the head`,
    );
  }
  // Four walking legs, and only four. The forelimbs are not walking legs and
  // must never plant, so this counts the *pose*'s legs rather than a literal.
  const walkingLegCount = countWalkingLegs();
  if (walkingLegCount !== WALKING_LEG_COUNT) {
    problems.push(`a mantis has ${WALKING_LEG_COUNT} walking legs, not ${walkingLegCount}`);
  }
  // The pronotum has to be long. It is the posture; a short one is a grasshopper.
  const pronotumToThorax = PRONOTUM_LENGTH / (THORAX_RX * 2);
  if (pronotumToThorax < MIN_PRONOTUM_TO_THORAX_RATIO) {
    problems.push(
      `the pronotum is only ${pronotumToThorax.toFixed(2)}x the leg-bearing thorax; a mantis ` +
        `carries at least ${MIN_PRONOTUM_TO_THORAX_RATIO}x`,
    );
  }
  // The head must be wider than it is deep or the triangle stops reading.
  const headWidthToDepth = HEAD_WIDTH / HEAD_DEPTH;
  if (headWidthToDepth < MIN_HEAD_WIDTH_TO_DEPTH) {
    problems.push(
      `the head is ${headWidthToDepth.toFixed(2)}x wider than deep; the mantis triangle needs ` +
        `at least ${MIN_HEAD_WIDTH_TO_DEPTH}x`,
    );
  }
  // The femur is the heavy segment and must out-mass the tibia that folds on it.
  if (FEMUR_LENGTH <= TIBIA_LENGTH) {
    problems.push('the raptorial femur must be longer than the tibia that folds back along it');
  }
  // Spines on both closing edges, or the arms are just sticks.
  if (FEMUR_SPINES < MIN_SPINES_PER_SEGMENT || TIBIA_SPINES < MIN_SPINES_PER_SEGMENT) {
    problems.push(
      `both raptorial segments need at least ${MIN_SPINES_PER_SEGMENT} grasping spines ` +
        `(femur ${FEMUR_SPINES}, tibia ${TIBIA_SPINES})`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`mantid anatomy gates failed:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * The thresholds the gates hold the art to.
 *
 * These are the only literals here on purpose: the *measurements* are imported
 * from `mantidArt.ts`, so moving a socket or shortening the pronotum there
 * fails the bake. An earlier version mirrored the measurements as local
 * constants too, which quietly made every gate a comparison of two compile-time
 * literals that could never fail.
 */
const MIN_FORELIMB_SOCKET_ALONG = 0.6;
const WALKING_LEG_COUNT = 4;
const MIN_PRONOTUM_TO_THORAX_RATIO = 1.5;
const MIN_HEAD_WIDTH_TO_DEPTH = 1.2;
const MIN_SPINES_PER_SEGMENT = 5;

/** Whether a pose field is a walking leg rather than a scalar or a raptorial. */
function isWalkingLeg(value: unknown): value is ArtLegPose {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate.dx === 'number' &&
    typeof candidate.dy === 'number' &&
    typeof candidate.lift === 'number' &&
    typeof candidate.splay === 'number'
  );
}

/** Counts the walking legs the pose actually carries, so the gate cannot be a literal. */
function countWalkingLegs(): number {
  return Object.values(restPose()).filter(isWalkingLeg).length;
}

// ── Manifest verification ────────────────────────────────────────────────────

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
  sheet.variant.rows.forEach((row, index) => {
    if (row.kind === 'gore') {
      GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: sheet.variant.manifestPath,
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
function verifyManifest(sheets: readonly BakedSheet[]): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  let mismatched = false;
  for (const sheet of sheets) {
    const required = manifestEntryFor(sheet);
    if (canonicalJson(manifest[sheet.variant.id]) !== canonicalJson(required)) {
      console.error(
        `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${sheet.variant.id}" entry with:\n` +
          `${JSON.stringify({ [sheet.variant.id]: required }, null, 2)}\n`,
      );
      mismatched = true;
    }
  }
  if (mismatched) {
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

/**
 * Fails the bake when the runtime's piece list has drifted from the sheet's.
 *
 * `BodyPartGoreSystem` looks a piece up by its *state name*, so renaming one in
 * `mantidGore.ts` rebakes cleanly, updates the manifest cleanly and passes every
 * other gate — and then silently drops that body part in play, because the
 * runtime list still asks for a state the sheet no longer has. Nothing else in
 * the pipeline connects the two.
 */
function assertGoreStatesMatchRuntime(): void {
  const baked = GORE_STATES.join(', ');
  const runtime = MANTID_GORE_PARTS.join(', ');
  if (baked !== runtime) {
    throw new Error(
      'the gore pieces this bake produces are not the ones the runtime asks for.\n' +
        `  baked   (scripts/mantidGore.ts): ${baked}\n` +
        `  runtime (src/sprites/mantidSprite.ts): ${runtime}`,
    );
  }
}

function writeSheets(): void {
  assertAnatomy();
  assertGoreStatesMatchRuntime();
  const sheets: BakedSheet[] = [];
  for (const variant of VARIANTS) {
    console.log(
      `Generating ${variant.id} sprite sheet (tileScale=${TILE_SCALE}, scale=${variant.scale})…`,
    );
    const sheet = bake(variant);
    writeFileSync(resolve(variant.sheetPath), sheet.buffer);
    sheets.push(sheet);
    console.log(`  → ${variant.sheetPath}`);
    console.log(
      `  → ${sheet.columns * sheet.geometry.frameWidth}×${variant.rows.length * sheet.geometry.frameHeight}px  ` +
        `(${variant.rows.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
    );
    variant.rows.forEach((row, index) => {
      console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
    });
    console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  }
  verifyManifest(sheets);
}

// The review harness imports the variants from here, so painting the sheets has
// to be something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}
