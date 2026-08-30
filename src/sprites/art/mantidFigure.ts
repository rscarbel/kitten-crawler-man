/**
 * The Mantid and the crony Mantis, as painted figures: the choreography, the
 * cell geometry, and the two `FigureDef`s the runtime cache and the review
 * harness both draw through.
 *
 * One drawing engine, two builds, two scales — the boss is the same species as
 * his escort and runs the same rows, except that only he carries `flurry` and
 * `rage_pause`. This module is choreography and nothing else: one pose function
 * per row, the row table, and the placement of a pose or a gore piece inside
 * its cell. Anatomy, palette and every stroke of paint live in `mantidArt.ts`
 * and `mantidGore.ts`.
 *
 * Rows:
 *    walk / walk_side / walk_away        — the rocking mantis gait
 *    idle / idle_side / idle_away        — swaying, head pivoting, antennae sweeping
 *    slash / slash_side / slash_away     — one raptorial strike: cock, snap, refold
 *    flurry / flurry_side / flurry_away  (boss only) — both arms, fast wide arcs
 *    rage_pause                          (boss only) — reared, cocked, trembling
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them.
 *
 * The art invariants live in `scripts/gates-mantid.ts`, which the review
 * harness runs: `npm run render:mantid`.
 */

import {
  GROUND_Y,
  MANTID_BOSS_BUILD,
  MANTIS_CRONY_BUILD,
  TWO_PI,
  type LegPose,
  type MantidBuild,
  type MantidPose,
  type Pt,
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
} from './mantidArt';
import { type MantidGorePiece, mantidGorePieces } from './mantidGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

// ── Row lengths ──────────────────────────────────────────────────────────────

export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 8;
export const SLASH_FRAMES = 9;
export const FLURRY_FRAMES = 8;
export const RAGE_FRAMES = 6;

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
export const SLASH_COCK_END = 0.36;
export const SLASH_SNAP_END = 0.56;
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
export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: (t: number) => MantidPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
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

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);
// ── Variants ─────────────────────────────────────────────────────────────────

export type MantidVariantId = 'mantid' | 'mantis';

function pt(x: number, y: number): Pt {
  return { x, y };
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

/**
 * The cell a variant's poses and gore pieces are painted into, and where its
 * own tile sits inside it.
 *
 * These four numbers per variant were measured by the bake these figures
 * replace — the widest pose plus padding, quantised — and
 * `scripts/parity-figure-sheet.ts` is what proved the painters still fill
 * exactly those cells. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/**
 * How far each gore piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible
 * pixels, so a piece drawn off-centre in its cell orbits rather than tumbles.
 * The offsets are in the piece's own units, the same ones its `paint` is scaled
 * by, and they were measured from the painted ink of each piece — separately
 * per variant, because the two builds do not draw the same shapes. Measuring is
 * something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-mantid.ts` re-measures them on every render.
 */
const BOSS_GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_raptorial_arm', pt(0.07142857142857142, 0.03125)],
  ['gore_head', pt(0.015625, 0.022321428571428572)],
  ['gore_pronotum', pt(0.008928571428571428, -0.06473214285714286)],
  ['gore_abdomen', pt(0.07366071428571429, -0.017857142857142856)],
  ['gore_wing_case', pt(0.03794642857142857, -0.033482142857142856)],
  ['gore_leg', pt(0.029017857142857144, -0.013392857142857142)],
  ['gore_entrails', pt(0.004464285714285714, -0.03794642857142857)],
  ['gore_carapace', pt(-0.029017857142857144, 0.026785714285714284)],
]);

const CRONY_GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_raptorial_arm', pt(0.06868131868131869, 0.034340659340659344)],
  ['gore_head', pt(0.017170329670329672, 0.02146291208791209)],
  ['gore_pronotum', pt(0.008585164835164836, -0.06438873626373627)],
  ['gore_abdomen', pt(0.0729739010989011, -0.017170329670329672)],
  ['gore_wing_case', pt(0.03863324175824176, -0.034340659340659344)],
  ['gore_leg', pt(0.034340659340659344, -0.012877747252747254)],
  ['gore_entrails', pt(0.004292582417582418, -0.034340659340659344)],
  ['gore_carapace', pt(-0.025755494505494508, 0.030048076923076927)],
]);

export interface MantidVariant {
  readonly id: MantidVariantId;
  readonly build: MantidBuild;
  /**
   * How much of a tile the animal fills, scaled about its own ground line so
   * its feet stay on the tile they belong to.
   */
  readonly scale: number;
  readonly rows: readonly RowSpec[];
  readonly cell: CellGeometry;
  readonly goreRecentre: ReadonlyMap<string, Pt>;
}

export const MANTID_VARIANT: MantidVariant = {
  id: 'mantid',
  build: MANTID_BOSS_BUILD,
  scale: BOSS_SCALE,
  rows: [...SHARED_ROWS, ...BOSS_ONLY_ROWS],
  cell: { frameWidth: 272, frameHeight: 208, tileX: 104, tileY: 125 },
  goreRecentre: BOSS_GORE_RECENTRE,
};

export const MANTIS_VARIANT: MantidVariant = {
  id: 'mantis',
  build: MANTIS_CRONY_BUILD,
  scale: CRONY_SCALE,
  rows: SHARED_ROWS,
  cell: { frameWidth: 152, frameHeight: 112, tileX: 44, tileY: 36 },
  goreRecentre: CRONY_GORE_RECENTRE,
};

export const MANTID_VARIANTS: readonly MantidVariant[] = [MANTID_VARIANT, MANTIS_VARIANT];

export function mantidVariantById(id: string): MantidVariant {
  const found = MANTID_VARIANTS.find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no mantid variant named "${id}"`);
  return found;
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** Pixels per tile unit a variant's gore pieces are painted at. */
export function goreUnitOf(variant: MantidVariant): number {
  return TILE_SCALE * GORE_PIECE_SCALE * variant.scale;
}

/** Poses are painted with the origin on the ground line, at the cell's centre. */
function poseOriginOf(variant: MantidVariant): Pt {
  return pt(variant.cell.frameWidth / 2, variant.cell.tileY + TILE_SCALE / 2);
}

function pieceOf(state: string): MantidGorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function recentreOf(variant: MantidVariant, state: string): Pt {
  const offset = variant.goreRecentre.get(state);
  if (offset === undefined) {
    throw new Error(`no gore recentring offset for "${state}" on ${variant.id}`);
  }
  return offset;
}

function rowOf(variant: MantidVariant, state: string): RowSpec | undefined {
  return variant.rows.find((row) => row.name === state);
}

function paintView(
  ctx: CanvasRenderingContext2D,
  view: View,
  pose: MantidPose,
  build: MantidBuild,
): void {
  if (view === 'front') drawMantidFront(ctx, pose, build);
  else if (view === 'back') drawMantidBack(ctx, pose, build);
  else drawMantidSide(ctx, pose, build);
}

/**
 * Paints one cell of a mantis, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile the creature stands on, and the variant's scale
 * is applied about that ground line so a bigger mantis still stands on its own
 * tile rather than floating above it. A gore piece is anchored at the cell's
 * centre instead, because the only thing that reads its cell is the spin the
 * gore field applies about that point.
 */
function paintMantidFrame(
  variant: MantidVariant,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const { cell } = variant;
  const row = rowOf(variant, state);
  if (row === undefined) {
    const piece = pieceOf(state);
    const recentre = recentreOf(variant, state);
    const goreUnit = goreUnitOf(variant);
    ctx.save();
    ctx.translate(
      cell.frameWidth / 2 + recentre.x * goreUnit,
      cell.frameHeight / 2 + recentre.y * goreUnit,
    );
    ctx.scale(goreUnit, goreUnit);
    piece.paint(ctx, variant.build);
    ctx.restore();
    return;
  }
  const origin = poseOriginOf(variant);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(variant.scale, variant.scale);
  ctx.translate(0, -GROUND_Y);
  paintView(ctx, row.view, row.pose(frame), variant.build);
  ctx.restore();
}

/** Every state a variant declares, pose rows first and then the gore pieces. */
function stateFramesOf(variant: MantidVariant): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of variant.rows) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

function figureOf(variant: MantidVariant): FigureDef {
  return {
    id: variant.id,
    frameWidth: variant.cell.frameWidth,
    frameHeight: variant.cell.frameHeight,
    tileX: variant.cell.tileX,
    tileY: variant.cell.tileY,
    tileScale: TILE_SCALE,
    states: figureStates(stateFramesOf(variant)),
    paintFrame: (ctx, state, frame) => {
      paintMantidFrame(variant, ctx, state, frame);
    },
  };
}

export const MANTID_FIGURE: FigureDef = figureOf(MANTID_VARIANT);
export const MANTIS_FIGURE: FigureDef = figureOf(MANTIS_VARIANT);

/** The figure a sheet name selects, for code that holds one of the two names. */
export function mantidFigureOf(id: MantidVariantId): FigureDef {
  return id === 'mantid' ? MANTID_FIGURE : MANTIS_FIGURE;
}
