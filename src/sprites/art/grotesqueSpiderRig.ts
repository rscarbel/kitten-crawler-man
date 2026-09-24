/**
 * The Grotesque Spider's rig: her body plan, her eight legs, and the pose
 * every row and stage puts them in.
 *
 * She is painted from directly above, facing +Y, because a dorsal view is the
 * only view of a creature that survives being rotated to its facing: a face
 * painted toward the camera spins like a clock hand. Height is shown the way an
 * overhead camera would see it — a point higher off the floor projects further
 * from the pivot and larger — so a raised leg reads as raised at every
 * rotation, and its shadow stays on the floor directly below it.
 *
 * Every coordinate here is in tiles, in the figure's own frame: the origin is
 * the centre of the tile she stands on (the point she is rotated about), +x is
 * her right as seen from above, +y is forward, and `h` is height above the
 * floor. The painter in `grotesqueSpiderArt.ts` draws what this module solves,
 * and the gates measure the same solve, so a pose and its measurement cannot
 * disagree.
 *
 * Legs are rigid: every segment keeps its length in every pose. A pose asks
 * for a foot position, and the solver bends the joints to reach it; a foot the
 * leg cannot reach is recorded against its target rather than stretching the
 * leg, so a gate can see the demand the clamp would otherwise hide.
 */

import type { SpiderAttackStage } from '../../creatures/grotesqueSpiderTimeline';
import { clamp01, easeInOut, easeOut, hump, lerp, ramp } from './carlArt';
import { SPIDER_EGG_RADIUS_TILES } from './spiderEggArt';

// ── Rows, stages and the pose key ────────────────────────────────────────────

/** The attack rows; each is driven by an attack stage and its progress. */
export type GrotesqueSpiderAttackRow =
  'attack_slam' | 'attack_screech' | 'attack_spit' | 'attack_lay';

/** Every row the spider paints. */
export type GrotesqueSpiderState = 'idle' | 'walk' | GrotesqueSpiderAttackRow | 'death';

export type { SpiderAttackStage };

/**
 * Which pose to paint.
 *
 * Attack stages are the timeline's: the pose builds (tell), holds frozen
 * (lock), lands (strike, covering the frames the strike pose is held for) and
 * exposes her (recovery). For `attack_lay` the strike stage is one egg's
 * window, opening on the tick that egg lands, and lock is never entered.
 *
 * - Loops (`idle`, `walk`) are keyed by `cycle`, 0→1 once around the loop.
 * - Attacks are keyed by stage and `stageProgress`, 0→1 through that stage.
 * - `death` is keyed by `progress`, 0→1 from the killing blow to the final,
 *   held pose.
 */
export type GrotesqueSpiderPose =
  | { readonly row: 'idle' | 'walk'; readonly cycle: number }
  | {
      readonly row: GrotesqueSpiderAttackRow;
      readonly stage: SpiderAttackStage;
      readonly stageProgress: number;
    }
  | { readonly row: 'death'; readonly progress: number };

const HALF = 0.5;

// ── Body plan ────────────────────────────────────────────────────────────────

/**
 * Where her waist sits, forward of the pivot. The abdomen is by far her
 * heaviest mass, so the waist is pushed forward until her painted weight
 * centres on the tile she is rotated about; otherwise every turn swings her
 * rear across the floor.
 */
export const PEDICEL_Y = -0.1;
/**
 * How far her body sits to her right of the pivot. Her left carries the
 * over-long withered leg and her right only a stump, so centred she is heavy
 * on the left and swings that way every time she turns.
 */
const BALANCE_X = 0.07;
/**
 * The carapace and everything on it — eyes, maw, fangs, leg roots — is drawn
 * this much larger than its authored size, so its features are authored in
 * round numbers against a unit-ish plate.
 */
const CEPH_SIZE = 1.2;
/** The narrow waist between the two body sections, in carapace units. */
export const PEDICEL_GAP = 0.09;
export const CEPH_HALF_LENGTH = 0.5;
export const CEPH_HALF_WIDTH = 0.46;
/**
 * The abdomen's length against the carapace's drawn length. She is a
 * brood-mother swollen with eggs: the abdomen is the mass that sells her size,
 * while the smaller, paler carapace carries the face.
 */
export const ABDOMEN_TO_CEPH_LENGTH = 1.62;
export const ABDOMEN_HALF_LENGTH = CEPH_HALF_LENGTH * CEPH_SIZE * ABDOMEN_TO_CEPH_LENGTH;
/** Bulbous: nearly as wide as it is long, so it reads as heavy rather than as a second head. */
export const ABDOMEN_HALF_WIDTH = 0.76;
/** The carapace centre relative to the waist, before any pose scaling. */
export const CEPH_OFFSET = PEDICEL_GAP + CEPH_HALF_LENGTH;

/**
 * How far above the floor the camera sits, in tiles. High, so the view is
 * nearly flat: a leg raised toward a low camera balloons and slides out past
 * its own length, which reads as rubber. Height is carried instead by the
 * gap between a raised leg and its shadow, which the painter casts back.
 */
const CAMERA_HEIGHT = 14;
/** Height of her leg roots and carapace above the floor at rest. */
export const BODY_HEIGHT = 0.42;

/** How far the fangs reach past the carapace's front edge. */
const FANG_REACH = 0.56;
/** Fang tips, in carapace-local tiles forward of its centre: the mouth's front edge. */
export const FANG_TIP_Y = CEPH_HALF_LENGTH + FANG_REACH;
/** The pivot the carapace halves swing open about, carapace-local. */
export const SPLIT_PIVOT_Y = 0.02;
/** The second maw's centre and full radius, carapace-local. */
export const MAW_CENTRE_Y = 0.3;
export const MAW_MAX_RADIUS = 0.38;
/** How far each carapace half swings out when the maw is fully open. */
export const SPLIT_MAX_ANGLE = 0.8;
export const SPLIT_MAX_SHIFT = 0.12;

/** A 3-D point in the figure frame: tiles, with `h` the height above the floor. */
export interface P3 {
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

/** A 2-D point in the figure frame, in tiles. */
export interface P2 {
  readonly x: number;
  readonly y: number;
}

/** How much larger and further from the pivot a point at height `h` projects. */
export function perspectiveScale(h: number): number {
  return CAMERA_HEIGHT / (CAMERA_HEIGHT - h);
}

/** Where a 3-D point lands in the painted cell, in tiles from the pivot. */
export function project(p: P3): P2 {
  const k = perspectiveScale(p.h);
  return { x: p.x * k, y: p.y * k };
}

// ── 3-D vector helpers ───────────────────────────────────────────────────────

function add(a: P3, b: P3): P3 {
  return { x: a.x + b.x, y: a.y + b.y, h: a.h + b.h };
}

function sub(a: P3, b: P3): P3 {
  return { x: a.x - b.x, y: a.y - b.y, h: a.h - b.h };
}

function scale(a: P3, k: number): P3 {
  return { x: a.x * k, y: a.y * k, h: a.h * k };
}

function dot(a: P3, b: P3): number {
  return a.x * b.x + a.y * b.y + a.h * b.h;
}

function length3(a: P3): number {
  return Math.sqrt(dot(a, a));
}

/** Distance between two 3-D points. */
export function distance3(a: P3, b: P3): number {
  return length3(sub(a, b));
}

function normalise(a: P3, fallback: P3): P3 {
  const l = length3(a);
  return l > Number.EPSILON ? scale(a, 1 / l) : fallback;
}

/** `v` with its component along the unit vector `along` removed. */
function perpendicularPart(v: P3, along: P3): P3 {
  return sub(v, scale(along, dot(v, along)));
}

/** The angle at the vertex between sides `a` and `b` of a triangle whose third side is `c`. */
function triangleAngle(a: number, b: number, c: number): number {
  const cos = (a * a + b * b - c * c) / (2 * a * b);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** The span between the ends of two segments meeting at an interior angle. */
function spanAcross(a: number, b: number, interiorAngle: number): number {
  return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(interiorAngle));
}

const UP: P3 = { x: 0, y: 0, h: 1 };

// ── Legs ─────────────────────────────────────────────────────────────────────

/** How a leg is built: an ordinary limb, the withered mutant, or the capped stump. */
export type SpiderLegKind = 'normal' | 'withered' | 'stump';

/**
 * The tetrapod the leg steps with. An alternating tetrapod moves L1 R2 L3 R4
 * together, then R1 L2 R3 L4, so the body is always carried on four feet.
 */
export type SpiderGaitGroup = 'a' | 'b';

/** One of the eight legs, in the figure frame at rest. */
export interface SpiderLegDesc {
  /** -1 for her left, +1 for her right. */
  readonly side: number;
  /** 0 for the front pair (I) through 3 for the rear pair (IV). */
  readonly pair: number;
  readonly kind: SpiderLegKind;
  readonly group: SpiderGaitGroup;
  /** Where the coxa leaves the carapace, carapace-local. */
  readonly rootX: number;
  readonly rootY: number;
  /** Where the foot rests on the floor, in the figure frame. */
  readonly restX: number;
  readonly restY: number;
  /**
   * Segment lengths root to tip, in tiles. An ordinary leg is femur, tibia and
   * metatarsus; the withered leg has an extra joint in its metatarsus; the
   * stump is one cut femur.
   */
  readonly segments: readonly number[];
  /**
   * How far the leg's bending plane is rolled off vertical, radians; positive
   * tips the knee toward her front. The front legs' knees lean back and the
   * rear legs' forward, so from above each leg bows outward, as a real
   * spider's does. The withered leg leans the other way from its neighbours.
   */
  readonly kneeLean: number;
  /** Thickness multiplier against an ordinary leg. */
  readonly girth: number;
}

interface LegPairDesc {
  readonly rootX: number;
  readonly rootY: number;
  /** Rest foot, relative to the carapace centre at rest. */
  readonly footX: number;
  readonly footY: number;
  readonly segments: readonly [number, number, number];
  readonly kneeLean: number;
}

/**
 * The four ordinary leg pairs, her left side. Pairs I and IV are the longest,
 * as on a real spider, and every foot rests well short of full reach so each
 * knee rides high and splays out past her body from above.
 */
const LEG_PAIRS: readonly LegPairDesc[] = [
  {
    rootX: -0.3,
    rootY: 0.3,
    footX: -1.22,
    footY: 1.55,
    segments: [1.05, 0.84, 0.7],
    kneeLean: -0.8,
  },
  {
    rootX: -0.42,
    rootY: 0.1,
    footX: -2.15,
    footY: 0.4,
    segments: [1.0, 0.8, 0.7],
    kneeLean: -0.45,
  },
  {
    rootX: -0.42,
    rootY: -0.1,
    footX: -2.2,
    footY: -0.75,
    segments: [1.0, 0.78, 0.7],
    kneeLean: 0.45,
  },
  {
    rootX: -0.3,
    rootY: -0.3,
    footX: -1.58,
    footY: -1.95,
    segments: [1.05, 0.85, 0.75],
    kneeLean: 0.8,
  },
];

/**
 * The withered left leg II: over-long and thin, its metatarsus broken by an
 * extra joint that bends against the rest of the limb, its knee leaning the
 * wrong way.
 */
const WITHERED = {
  footX: -2.15,
  footY: 0.62,
  segments: [1.05, 0.9, 0.55, 0.5],
  kneeLean: 0.5,
  girth: 0.78,
} as const;
/** The right leg IV stump: a femur cut short, stitched and clamped. */
const STUMP = { femur: 0.8, stub: 0.3, girth: 1 } as const;
/** Where the stump's cut end is held: this share of its full length out from the root, and this high. */
const STUMP_REACH_SHARE = 0.82;
const STUMP_END_HEIGHT = 0.3;
const ORDINARY_GIRTH = 1;
/**
 * Every leg's lengths and resting reach, scaled together: the legs are laid
 * out at a round size and this fits her widest poses inside the circle her
 * cell turns through.
 */
const LEG_SCALE = 0.95;

const WITHERED_PAIR = 1;
const STUMP_PAIR = 3;
const LEFT = -1;
const RIGHT = 1;
const PAIR_COUNT = 4;

/** L1 R2 L3 R4 step together; so do R1 L2 R3 L4. */
function gaitGroup(side: number, pair: number): SpiderGaitGroup {
  const evenPair = pair % 2 === 0;
  return (side === LEFT) === evenPair ? 'a' : 'b';
}

/** The carapace centre at rest, in the figure frame. */
const CEPH_REST_Y = PEDICEL_Y + CEPH_OFFSET * CEPH_SIZE;

function buildLegs(): readonly SpiderLegDesc[] {
  const legs: SpiderLegDesc[] = [];
  for (const side of [LEFT, RIGHT]) {
    for (let pair = 0; pair < PAIR_COUNT; pair++) {
      const base = LEG_PAIRS[pair];
      const mirror = side === LEFT ? 1 : -1;
      const withered = side === LEFT && pair === WITHERED_PAIR;
      const stump = side === RIGHT && pair === STUMP_PAIR;
      const kind: SpiderLegKind = withered ? 'withered' : stump ? 'stump' : 'normal';
      const footX = BALANCE_X + (withered ? WITHERED.footX : base.footX) * mirror * LEG_SCALE;
      const footY = CEPH_REST_Y + (withered ? WITHERED.footY : base.footY) * LEG_SCALE;
      const built: readonly number[] = withered
        ? WITHERED.segments
        : stump
          ? [STUMP.femur, STUMP.stub]
          : base.segments;
      const segments = built.map((length) => length * LEG_SCALE);
      legs.push({
        side,
        pair,
        kind,
        group: gaitGroup(side, pair),
        rootX: base.rootX * mirror,
        rootY: base.rootY,
        restX: footX,
        restY: footY,
        segments,
        kneeLean: withered ? WITHERED.kneeLean : base.kneeLean,
        girth: withered ? WITHERED.girth : stump ? STUMP.girth : ORDINARY_GIRTH,
      });
    }
  }
  return legs;
}

/**
 * The eight legs: her left side front to back (L1–L4), then her right (R1–R4).
 *
 * Exported so a gate can walk the rig to each tip and look for ink there. A
 * missing leg is around two per cent of her ink, which no whole-cell score can
 * see; only the rig knows where the eighth foot should be.
 */
export const SPIDER_LEGS: readonly SpiderLegDesc[] = buildLegs();

/** The index of the stump in {@link SPIDER_LEGS}. */
export const STUMP_LEG_INDEX = SPIDER_LEGS.findIndex((leg) => leg.kind === 'stump');
/** The two front legs (L1, R1) — the slam's hammers. */
export const FRONT_LEG_INDICES: readonly number[] = SPIDER_LEGS.flatMap((leg, index) =>
  leg.pair === 0 ? [index] : [],
);

/** A leg solved into joints, every one in the figure frame. */
export interface SolvedLeg {
  readonly index: number;
  readonly desc: SpiderLegDesc;
  /** Root → … → foot, one more joint than the leg has segments. The stump's last point is its cap. */
  readonly joints: readonly P3[];
  /**
   * Where the pose asked the foot to be. The solver never stretches a leg, so
   * a foot asked to go further than the leg reaches stops short of this; a
   * gate compares the two to catch a pose that demands more than the leg has.
   */
  readonly target: P3;
  /** Painted after the body: a leg lifted high enough to pass over her. */
  readonly overBody: boolean;
}

// ── The solved pose ──────────────────────────────────────────────────────────

interface AbdomenSolve {
  /** Rotation of the abdomen about the waist, radians; positive swings its tail to her left. */
  readonly angle: number;
  /** Overall scale: below one sinks it toward the floor, above one inflates it. */
  readonly scale: number;
  /** Egg-sac membrane scale. */
  readonly swell: number;
  /** 0 full, 1 hanging empty and wrinkled. */
  readonly deflate: number;
}

/** An egg crowning at or leaving the ovipositor, in the figure frame. */
export interface LayingEgg {
  readonly at: P3;
  readonly radius: number;
  /** 0 still held at the ovipositor's mouth, 1 expelled and about to land. */
  readonly dropped: number;
}

/** The venom glob, in carapace-local tiles. */
export interface SpitGlob {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 0 sitting, 1 flung: stretches it along its path. */
  readonly fling: number;
}

/** Everything the painter draws for one pose. */
export interface SpiderSolve {
  /** Waist position in the figure frame. */
  readonly waist: P2;
  /** Body height multiplier; roots and body scale follow it. */
  readonly lift: number;
  /** Extra scale on the carapace, about the waist: raised above one, drooped below. */
  readonly cephScale: number;
  readonly abdomen: AbdomenSolve;
  readonly legs: readonly SolvedLeg[];
  /** Second maw, 0 sealed to 1 fully split. */
  readonly maw: number;
  /** Throat glow, 0–1. */
  readonly mawGlow: number;
  /** How far the chelicerae spread, 0–1. */
  readonly cheliceraSpread: number;
  /** Pedipalp twitch, -1–1. */
  readonly palp: number;
  /** Per small eye, 0 open to 1 shut. */
  readonly lids: readonly number[];
  readonly centralLid: number;
  /** Where the central eye looks, -1–1 each way; +y is forward. */
  readonly look: P2;
  /** Pupils blown wide (screech, death) above zero, shrunk to pinpricks below it; -1–1. */
  readonly dilate: number;
  /** Small eyes wandering apart instead of fixing on one point, 0–1. */
  readonly unfocus: number;
  /** Bristle length multiplier; above one they stand on end. */
  readonly bristle: number;
  /** Egg pulse phase, 0–1. */
  readonly eggPulse: number;
  /** How far the eggs have been shoved toward her tail, 0–1. */
  readonly eggShove: number;
  /** Ovipositor extrusion, 0–1. */
  readonly ovipositor: number;
  /** An egg crowning at, hanging from, or being expelled from the ovipositor's mouth. */
  readonly heldEgg: LayingEgg | null;
  /** An egg being squeezed down the abdomen under the hide: 0 none, then waist side to tail. */
  readonly birthLump: number;
  /** How wide the ovipositor's mouth gapes round a crowning egg, 0–1. */
  readonly ovipositorDilate: number;
  /** A string of slime still hanging from the mouth after an egg has gone, 0–1. */
  readonly afterbirth: number;
  readonly glob: SpitGlob | null;
  /** Dust thrown up by the foreleg strike, 0–1. */
  readonly impact: number;
  /** Floor cracked around embedded forelegs, 0–1. */
  readonly embed: number;
  /** The screech's spray of spittle off the open maw, 0–1. */
  readonly roar: number;
  /** Venom spray flung ahead of the mouth as the glob leaves, 0 none to 1 flown furthest. */
  readonly spray: number;
  /** Death: colour drained from her, 0–1. */
  readonly pallor: number;
  /** Death: the abdomen torn open, 0–1. */
  readonly rupture: number;
  /** Death: dead eggs and fluid spread over the floor behind her, 0–1. */
  readonly spill: number;
}

// ── Leg solving ──────────────────────────────────────────────────────────────

/** Keeps a solve off full extension, where the knee's bend direction is undefined. */
const REACH_SLACK = 0.995;
/** Keeps a solve off full fold, for the same reason. */
const FOLD_SLACK = 1.02;
/**
 * The interior angle at the ankle (tibia to metatarsus). Just short of
 * straight, so the lower leg arcs down to the floor rather than kinking.
 */
const ANKLE_INTERIOR_ANGLE = 2.75;
/** The withered leg's extra joint bends hard, and against the ankle. */
const WITHERED_KINK_INTERIOR_ANGLE = 2.1;

/**
 * Tip height at which a leg is painted over her body instead of under it. Above
 * a walking or tapping foot's lift: a stepping leg drawn over the carapace
 * crosses her face and the legs stop reading as rooted at its rim.
 */
const OVER_BODY_HEIGHT = 0.95;

function legRoot(desc: SpiderLegDesc, waist: P2, lift: number, cephScale: number): P3 {
  return {
    x: waist.x + desc.rootX * cephScale * CEPH_SIZE,
    y: waist.y + (CEPH_OFFSET + desc.rootY) * cephScale * CEPH_SIZE,
    h: BODY_HEIGHT * lift,
  };
}

/** Horizontal, perpendicular to a leg's run, pointing toward her front on either side. */
function forwardAcross(desc: SpiderLegDesc, run: P3): P3 {
  const planar = Math.hypot(run.x, run.y);
  if (planar < Number.EPSILON) return { x: 0, y: 1, h: 0 };
  const ux = run.x / planar;
  const uy = run.y / planar;
  return { x: -uy * desc.side, y: ux * desc.side, h: 0 };
}

/**
 * The direction a leg's joints bow toward: straight up out of the vertical
 * plane through root and foot, rolled toward her front by the leg's lean.
 */
function bendDirection(
  desc: SpiderLegDesc,
  along: P3,
  run: P3,
  roll: number,
  kneeOut: P3 | null,
): P3 {
  const across = forwardAcross(desc, run);
  const outward = normalise({ x: run.x, y: run.y, h: 0 }, { x: desc.side, y: 0, h: 0 });
  const preferred = kneeOut ?? UP;
  const up = normalise(perpendicularPart(preferred, along), outward);
  const lean = desc.kneeLean + roll;
  const leaned = add(scale(up, Math.cos(lean)), scale(across, Math.sin(lean)));
  return normalise(perpendicularPart(leaned, along), up);
}

/**
 * Bends a chain of `first` then `second` from `from` to `to`, whose distance is
 * already within reach, bowing the joint toward `bend` (or away, for `-1`).
 */
function placeJoint(from: P3, to: P3, first: number, second: number, bend: P3, bow: number): P3 {
  const span = distance3(from, to);
  const along = normalise(sub(to, from), UP);
  const across = normalise(perpendicularPart(bend, along), UP);
  const angle = triangleAngle(first, span, second);
  return add(
    from,
    add(scale(along, first * Math.cos(angle)), scale(across, bow * first * Math.sin(angle))),
  );
}

interface LegChain {
  readonly joints: P3[];
  readonly target: P3;
}

/**
 * Places a leg's joints for a root and a foot target, every segment at its own
 * length. The foot goes where it is asked if the leg reaches; otherwise it
 * stops at the leg's reach along the line to the target.
 */
function solveLegJoints(
  desc: SpiderLegDesc,
  root: P3,
  target: P3,
  stumpLift: number,
  roll: number,
  kneeOut: P3 | null,
  ankleAngle: number,
): LegChain {
  const run = sub(target, root);
  if (desc.kind === 'stump') {
    // Cut below the knee: a femur and a stub of tibia, the raw end held up off
    // the floor it can no longer reach. A single straight peg reads as a pipe.
    const [femur, stub] = desc.segments;
    const planar = normalise({ x: run.x, y: run.y, h: 0 }, { x: desc.side, y: 0, h: 0 });
    const reach = (femur + stub) * STUMP_REACH_SHARE;
    const end = add(
      add(root, scale(planar, reach)),
      scale(UP, STUMP_END_HEIGHT + stumpLift - root.h),
    );
    const clamped = add(
      root,
      scale(
        normalise(sub(end, root), planar),
        Math.min(distance3(root, end), (femur + stub) * REACH_SLACK),
      ),
    );
    const along = normalise(sub(clamped, root), planar);
    const knee = placeJoint(
      root,
      clamped,
      femur,
      stub,
      bendDirection(desc, along, run, roll, kneeOut),
      1,
    );
    return { joints: [root, knee, clamped], target: clamped };
  }

  const [femur, tibia, ...metatarsus] = desc.segments;
  const withered = desc.kind === 'withered';
  const lowerTail = withered
    ? spanAcross(metatarsus[0], metatarsus[1], WITHERED_KINK_INTERIOR_ANGLE)
    : metatarsus[0];
  const lower = spanAcross(tibia, lowerTail, ankleAngle);
  const reach = (femur + lower) * REACH_SLACK;
  const fold = Math.abs(femur - lower) * FOLD_SLACK;
  const along = normalise(run, { x: desc.side, y: 0, h: 0 });
  const span = Math.max(fold, Math.min(length3(run), reach));
  const foot = add(root, scale(along, span));
  const bend = bendDirection(desc, along, run, roll, kneeOut);

  const knee = placeJoint(root, foot, femur, lower, bend, 1);
  const ankle = placeJoint(knee, foot, tibia, lowerTail, bend, 1);
  if (!withered) return { joints: [root, knee, ankle, foot], target };
  // The extra joint bows the other way from the ankle: a limb bent backwards.
  const kink = placeJoint(ankle, foot, metatarsus[0], metatarsus[1], bend, -1);
  return { joints: [root, knee, ankle, kink, foot], target };
}

interface LegPlan {
  readonly foot: P3;
  readonly stumpLift: number;
  /** Extra roll of the leg's bending plane toward her front, radians, on top of its own lean. */
  readonly roll?: number;
  /**
   * Which way the knee bows, before the lean rolls it; straight up when absent.
   * A pose whose feet pass over their own roots needs a direction that does
   * not flip as they cross, or the knees snap from one side to the other.
   */
  readonly kneeOut?: P3;
  /** The interior angle at the ankle; nearly straight when absent. A dying leg curls at every joint. */
  readonly ankleAngle?: number;
}

type FootPlanner = (desc: SpiderLegDesc, index: number) => LegPlan;

function restFoot(desc: SpiderLegDesc): P3 {
  return { x: desc.restX, y: desc.restY, h: 0 };
}

/** A foot's x pushed out from, or drawn in toward, her midline by `factor`. */
function spreadFromMidline(x: number, factor: number): number {
  return BALANCE_X + (x - BALANCE_X) * factor;
}

const AT_REST: FootPlanner = (desc) => ({ foot: restFoot(desc), stumpLift: 0 });

function solveLegs(waist: P2, lift: number, cephScale: number, plan: FootPlanner): SolvedLeg[] {
  return SPIDER_LEGS.map((desc, index) => {
    const {
      foot,
      stumpLift,
      roll = 0,
      kneeOut = null,
      ankleAngle = ANKLE_INTERIOR_ANGLE,
    } = plan(desc, index);
    const root = legRoot(desc, waist, lift, cephScale);
    const { joints, target } = solveLegJoints(
      desc,
      root,
      foot,
      stumpLift,
      roll,
      kneeOut,
      ankleAngle,
    );
    const tip = joints[joints.length - 1];
    return { index, desc, joints, target, overBody: tip.h > OVER_BODY_HEIGHT };
  });
}

// ── Shared pose defaults ─────────────────────────────────────────────────────

const SMALL_EYE_COUNT = 6;
const OPEN_LIDS: readonly number[] = Array.from({ length: SMALL_EYE_COUNT }, () => 0);
const LOOK_AHEAD: P2 = { x: 0, y: 1 };
const REST_WAIST: P2 = { x: BALANCE_X, y: PEDICEL_Y };

const REST_ABDOMEN: AbdomenSolve = { angle: 0, scale: 1, swell: 1, deflate: 0 };

/** A pose with nothing moving: every row starts from this and edits it. */
function restingSolve(): SpiderSolve {
  return {
    waist: REST_WAIST,
    lift: 1,
    cephScale: 1,
    abdomen: REST_ABDOMEN,
    legs: solveLegs(REST_WAIST, 1, 1, AT_REST),
    maw: 0,
    mawGlow: 0,
    cheliceraSpread: 0,
    palp: 0,
    lids: OPEN_LIDS,
    centralLid: 0,
    look: LOOK_AHEAD,
    dilate: 0,
    unfocus: 0,
    bristle: 1,
    eggPulse: 0,
    eggShove: 0,
    ovipositor: 0,
    heldEgg: null,
    birthLump: 0,
    ovipositorDilate: 0,
    afterbirth: 0,
    glob: null,
    impact: 0,
    embed: 0,
    roar: 0,
    spray: 0,
    pallor: 0,
    rupture: 0,
    spill: 0,
  };
}

/** Re-solves the legs after a pose has moved the body or the feet. */
function withLegs(solve: SpiderSolve, plan: FootPlanner): SpiderSolve {
  return { ...solve, legs: solveLegs(solve.waist, solve.lift, solve.cephScale, plan) };
}

// ── Blinks ───────────────────────────────────────────────────────────────────

/**
 * Where in its loop each small eye blinks. Spread over eighths so an eight-frame
 * idle shuts a different eye on each frame it shuts one at all: the eyes read
 * as belonging to different animals, which is the point of them.
 */
const SMALL_EYE_BLINK_PHASES: readonly number[] = [0.0, 0.375, 0.75, 0.25, 0.625, 0.125];
const CENTRAL_EYE_BLINK_PHASE = 0.5;
/**
 * Half the width of a blink, in loop cycles. Under one sixteenth, so a blink
 * shuts one frame of a sixteen-frame walk fully and leaves its neighbours
 * almost open — a flicker on one frame reads as a blink; a lid drifting over
 * three reads as the eye going dull.
 */
const BLINK_HALF_WIDTH = 0.07;

/** How far apart two points on a loop are, the short way round, 0–½. */
function loopDistance(a: number, b: number): number {
  const wrapped = (((a - b) % 1) + 1) % 1;
  return Math.min(wrapped, 1 - wrapped);
}

function lidAt(cycle: number, phase: number): number {
  const distance = loopDistance(cycle, phase);
  return clamp01(1 - distance / BLINK_HALF_WIDTH);
}

function blinkLids(cycle: number): readonly number[] {
  return SMALL_EYE_BLINK_PHASES.map((phase) => lidAt(cycle, phase));
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * Every idle motion runs once per loop, or once per half loop for the forelegs
 * taking turns: an eight-frame idle gives each motion four frames or more per
 * cycle, the least that reads as motion rather than as a flicker.
 */
const IDLE_BREATH_SCALE = 0.05;
const IDLE_SAC_SWELL = 0.1;
/** She rises and settles on her legs once a loop: roots and knees ride up with her. */
const IDLE_BODY_RISE = 0.16;
const IDLE_BODY_SWAY = 0.07;
/** The heavy abdomen swings a beat behind the body. */
const IDLE_ABDOMEN_SWING = 0.2;
const IDLE_ABDOMEN_LAG = 0.25;
/** The forelegs take turns lifting to taste the air: how high, and how far forward. */
const IDLE_FORELEG_LIFT = 0.85;
const IDLE_FORELEG_REACH = 0.08;
/** The withered leg's twitch: where in the loop, how wide, how far it jerks. */
const IDLE_TWITCH_PHASE = 0.5;
const IDLE_TWITCH_HALF_WIDTH = 0.14;
const IDLE_TWITCH_LIFT = 0.35;
const IDLE_TWITCH_CURL = 0.2;
/** The central eye wanders a little around dead ahead while she waits. */
const IDLE_LOOK_WANDER = 0.55;

function idleSolve(cycle: number): SpiderSolve {
  const turn = cycle * Math.PI * 2;
  const breath = Math.sin(turn);
  const twitchDistance = loopDistance(cycle, IDLE_TWITCH_PHASE);
  const twitch = clamp01(1 - twitchDistance / IDLE_TWITCH_HALF_WIDTH);
  const waist = { x: BALANCE_X + Math.sin(turn) * IDLE_BODY_SWAY, y: PEDICEL_Y };
  const base: SpiderSolve = {
    ...restingSolve(),
    waist,
    lift: 1 + breath * IDLE_BODY_RISE,
    abdomen: {
      ...REST_ABDOMEN,
      angle: Math.sin(turn - IDLE_ABDOMEN_LAG * Math.PI * 2) * IDLE_ABDOMEN_SWING,
      scale: 1 + breath * IDLE_BREATH_SCALE,
      swell: 1 + breath * IDLE_SAC_SWELL,
    },
    lids: blinkLids(cycle),
    centralLid: lidAt(cycle, CENTRAL_EYE_BLINK_PHASE),
    look: { x: Math.sin(turn) * IDLE_LOOK_WANDER, y: Math.cos(turn) * IDLE_LOOK_WANDER },
    eggPulse: cycle,
    palp: Math.sin(turn),
  };
  return withLegs(base, (desc) => {
    const foot = restFoot(desc);
    if (desc.pair === 0) {
      // Left foreleg lifts over the first half of the loop, right over the second.
      const own = desc.side === LEFT ? cycle * 2 : cycle * 2 - 1;
      const raise = own >= 0 && own <= 1 ? hump(own) : 0;
      return {
        foot: { x: foot.x, y: foot.y + raise * IDLE_FORELEG_REACH, h: raise * IDLE_FORELEG_LIFT },
        stumpLift: 0,
      };
    }
    if (desc.kind !== 'withered') return { foot, stumpLift: 0 };
    return {
      foot: {
        x: spreadFromMidline(foot.x, 1 - twitch * IDLE_TWITCH_CURL),
        y: foot.y,
        h: twitch * IDLE_TWITCH_LIFT,
      },
      stumpLift: 0,
    };
  });
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * Ground covered in one full gait cycle (both tetrapods stepping once), in
 * tiles. Every foot slides back exactly this far during its stance, so a planted
 * foot moves at the body's own speed and never skates.
 */
export const WALK_STRIDE_TILES = 1.5;
/** Share of the cycle each tetrapod spends in the air. */
const SWING_SHARE = 0.5;
/**
 * How far a foot moves relative to the body in one stance. The body covers a
 * whole stride per cycle but a foot is planted for only its stance share of
 * it, so the foot slides back by that share of the stride, and swings forward
 * by the same.
 */
const STEP_TILES = WALK_STRIDE_TILES * (1 - SWING_SHARE);
/** High enough that the lifted foot visibly leaves its shadow at 32 px. */
const SWING_LIFT = 0.7;
/** A swinging foot arcs outward, so the legs visibly reach rather than slide. */
const SWING_OUTWARD = 0.08;
/** The withered leg is lifted higher and jerkier than the rest: it drags. */
const WITHERED_SWING_LIFT = 0.8;
/** The body rides up once per tetrapod step, twice a cycle. */
const WALK_RISE = 0.2;
/**
 * The same bob, seen from above: rising toward the camera, her carapace grows
 * and shrinks again, and the heavy abdomen swells with it a beat later. Twice
 * a cycle, so eight frames per bob: slow enough never to strobe, and big
 * enough — two pixels and more at a 32 px tile — to read as weight.
 */
const WALK_BOB_SCALE = 0.07;
const WALK_ABDOMEN_BOB_SCALE = 0.06;
const WALK_ABDOMEN_BOB_LAG = 0.08;
/** She rolls side to side once a cycle, onto each tetrapod in turn. */
const WALK_SWAY = 0.1;
/** She surges forward as each tetrapod pushes and drops back as it lands, twice a cycle. */
const WALK_SURGE = 0.06;
/** The limp: she drops toward the missing right rear leg when its tetrapod carries her. */
const LIMP_SAG = 0.12;
const LIMP_SWAY = 0.05;
const STUMP_SWING_LIFT = 0.35;
/** The abdomen swings once a cycle, a quarter cycle behind the body it hangs from. */
const WALK_ABDOMEN_SWING = 0.26;
const WALK_ABDOMEN_LAG = 0.25;

/** 0→1 within the swing (null when planted), and 0→1 within the stance. */
function gaitPhase(
  cycle: number,
  group: SpiderGaitGroup,
): { swing: number | null; stance: number } {
  const offset = group === 'a' ? 0 : SWING_SHARE;
  const local = (((cycle - offset) % 1) + 1) % 1;
  if (local < SWING_SHARE) return { swing: local / SWING_SHARE, stance: 0 };
  return { swing: null, stance: (local - SWING_SHARE) / (1 - SWING_SHARE) };
}

function walkSolve(cycle: number): SpiderSolve {
  const turn = cycle * Math.PI * 2;
  const stumpGroup = gaitPhase(cycle, 'a');
  // The stump's tetrapod is carried on three feet, so its stance is the limp.
  const limp = stumpGroup.swing === null ? hump(stumpGroup.stance) : 0;
  const bob = Math.cos(turn * 2);
  const abdomenBob = Math.cos((turn - WALK_ABDOMEN_BOB_LAG * Math.PI * 2) * 2);
  const waist = {
    x: BALANCE_X + limp * LIMP_SWAY + Math.sin(turn) * WALK_SWAY,
    y: PEDICEL_Y + Math.sin(turn * 2) * WALK_SURGE,
  };
  const base: SpiderSolve = {
    ...restingSolve(),
    waist,
    lift: 1 + bob * WALK_RISE - limp * LIMP_SAG,
    cephScale: 1 + bob * WALK_BOB_SCALE,
    abdomen: {
      ...REST_ABDOMEN,
      angle: Math.sin(turn - WALK_ABDOMEN_LAG * Math.PI * 2) * WALK_ABDOMEN_SWING,
      scale: 1 + abdomenBob * WALK_ABDOMEN_BOB_SCALE,
    },
    lids: blinkLids(cycle),
    centralLid: lidAt(cycle, CENTRAL_EYE_BLINK_PHASE),
    eggPulse: cycle,
    palp: Math.sin(turn * 2),
  };
  return withLegs(base, (desc) => {
    const phase = gaitPhase(cycle, desc.group);
    const rest = restFoot(desc);
    if (phase.swing === null) {
      return {
        foot: { x: rest.x, y: rest.y + STEP_TILES * (HALF - phase.stance), h: 0 },
        stumpLift: 0,
      };
    }
    const arc = hump(phase.swing);
    const lift = desc.kind === 'withered' ? WITHERED_SWING_LIFT : SWING_LIFT;
    return {
      foot: {
        x: rest.x + desc.side * arc * SWING_OUTWARD,
        y: rest.y + STEP_TILES * (phase.swing - HALF),
        h: arc * lift,
      },
      stumpLift: arc * STUMP_SWING_LIFT,
    };
  });
}

// ── Raised forelegs ─────────────────────────────────────────────────────────

/** A leg's full reach, root to foot, in its standing shape. */
function legReach(desc: SpiderLegDesc): number {
  const [femur, tibia, ...metatarsus] = desc.segments;
  const tail =
    desc.kind === 'withered'
      ? spanAcross(metatarsus[0], metatarsus[1], WITHERED_KINK_INTERIOR_ANGLE)
      : metatarsus[0];
  return (femur + spanAcross(tibia, tail, ANKLE_INTERIOR_ANGLE)) * REACH_SLACK;
}

/**
 * A raised foreleg is held nearly straight, a rigid spike: its tip is aimed
 * from its root along `aim` (x outward from her side, y forward, h up) at most
 * of the leg's reach. Aimed at a point close to its root instead, the leg
 * folds, its femur swings back over her face and it reads as a bent elbow.
 */
const RAISED_REACH_SHARE = 0.9;

function raisedTip(desc: SpiderLegDesc, root: P3, aim: P3): P3 {
  const direction = normalise({ x: aim.x * desc.side, y: aim.y, h: aim.h }, UP);
  return add(root, scale(direction, legReach(desc) * RAISED_REACH_SHARE));
}

/**
 * A raised foreleg drops the lean it stands with, so the spike bends straight
 * up in its own plane: leaned, a lifted foreleg's knee swings in across her
 * face.
 */
function raisedForelegBend(desc: SpiderLegDesc, raise: number): Pick<LegPlan, 'roll'> {
  if (desc.pair !== 0 || raise <= 0) return {};
  return { roll: -desc.kneeLean * raise };
}

// ── Slam ─────────────────────────────────────────────────────────────────────

/**
 * The last share of the lock spent driving the forelegs down.
 *
 * The downswing belongs to the lock rather than the strike so that the strike's
 * first frame — the frame damage is dealt on — is already the contact pose.
 * About three frames of a thirty-frame lock: fast enough to read as a hammer,
 * long enough that one sampled frame catches the legs mid-fall.
 */
export const SLAM_DOWNSWING_LOCK_SHARE = 0.1;
/**
 * Reared, she stands up on her back legs: the carapace climbs toward the
 * camera and grows, the abdomen tips down toward the floor and shrinks behind
 * it, and the waist rocks back over the rear legs.
 */
const SLAM_REAR_LIFT = 1.1;
const SLAM_REAR_BACK = 0.24;
const SLAM_CEPH_RISE = 0.24;
const SLAM_ABDOMEN_SINK = 0.2;
/**
 * The raised forelegs, relative to their resting feet: lifted high, flung a
 * little wider and drawn back toward her head — the threat posture of a
 * rearing spider, forelegs up in a V over her bared fangs. Wide rather than
 * crossed, so they frame her face instead of hiding it, and short of their
 * resting reach, because perspective carries a raised tip further out.
 */
const SLAM_RAISE_AIM: P3 = { x: 0.3, y: 0.42, h: 1 };
/** Legs II lift with the forelegs: a rearing spider shows both front pairs. */
const SLAM_SECOND_PAIR_LIFT = 0.35;
const SLAM_SECOND_PAIR_BACK = 0.15;
/** Where the tips land: pulled in toward her line of attack, inside the cone ahead. */
const SLAM_CONTACT_INWARD = 0.45;
const SLAM_CONTACT_BACK = 0.1;
/** The rear legs spread and brace to carry her whole weight. */
const SLAM_REAR_PLANT = 0.14;
const SLAM_SHIVER = 0.05;
/** Shiver cycles across the lock: fast, but under half a cycle per sampled frame. */
const SLAM_SHIVER_CYCLES = 1.5;
const SLAM_LUNGE = 0.16;
/** The dust has half settled by the end of the strike hold. */
const SLAM_DUST_SETTLE = 0.5;
/** Lunging, she drops onto the legs she has driven in, head first. */
const SLAM_LUNGE_SINK = 0.35;
const SLAM_CEPH_DIP = 0.06;
const SLAM_PUPIL_DILATE = 0.5;
const SLAM_TUG = 0.07;
const SLAM_TUG_CYCLES = 2;
/** The share of the recovery she spends prying the legs back out. */
const SLAM_PRY_SHARE = 0.3;

function slamSolve(stage: SpiderAttackStage, p: number): SpiderSolve {
  let rear = 0;
  let raise = 0;
  let contact = 0;
  let shiver = 0;
  let lunge = 0;
  let impact = 0;
  let embed = 0;
  let tug = 0;
  if (stage === 'tell') {
    rear = easeInOut(p);
    raise = easeInOut(p);
  } else if (stage === 'lock') {
    const downStart = 1 - SLAM_DOWNSWING_LOCK_SHARE;
    const down = clamp01((p - downStart) / SLAM_DOWNSWING_LOCK_SHARE);
    rear = 1 - down;
    raise = 1 - down * down;
    contact = down;
    lunge = down;
    shiver = p < downStart ? Math.sin(p * Math.PI * 2 * SLAM_SHIVER_CYCLES) : 0;
  } else if (stage === 'strike') {
    contact = 1;
    lunge = 1;
    impact = 1 - p * SLAM_DUST_SETTLE;
    embed = 1;
  } else {
    const pry = ramp(p, 1 - SLAM_PRY_SHARE, 1);
    contact = 1 - pry;
    lunge = 1 - pry;
    embed = 1 - pry;
    tug = Math.abs(Math.sin(p * Math.PI * SLAM_TUG_CYCLES)) * (1 - pry);
  }
  const waist = {
    x: BALANCE_X,
    y: PEDICEL_Y - rear * SLAM_REAR_BACK + lunge * SLAM_LUNGE - tug * SLAM_TUG,
  };
  const base: SpiderSolve = {
    ...restingSolve(),
    waist,
    lift: 1 + rear * SLAM_REAR_LIFT - lunge * SLAM_LUNGE_SINK,
    cephScale: 1 + rear * SLAM_CEPH_RISE - lunge * SLAM_CEPH_DIP,
    abdomen: { ...REST_ABDOMEN, scale: 1 - rear * SLAM_ABDOMEN_SINK },
    dilate: rear * SLAM_PUPIL_DILATE,
    cheliceraSpread: rear,
    impact,
    embed,
    palp: shiver,
    bristle: 1 + rear * HALF,
  };
  return withLegs(base, (desc) => {
    const rest = restFoot(desc);
    if (desc.pair === 0) {
      const aloft = raisedTip(
        desc,
        legRoot(desc, waist, base.lift, base.cephScale),
        SLAM_RAISE_AIM,
      );
      const raised = { ...aloft, x: aloft.x + desc.side * shiver * SLAM_SHIVER };
      const landed = {
        x: spreadFromMidline(rest.x, 1 - SLAM_CONTACT_INWARD),
        y: rest.y - SLAM_CONTACT_BACK,
        h: 0,
      };
      const aloftX = lerp(rest.x, raised.x, raise);
      const aloftY = lerp(rest.y, raised.y, raise);
      return {
        foot: {
          x: lerp(aloftX, landed.x, contact),
          y: lerp(aloftY, landed.y, contact),
          h: raised.h * raise,
        },
        stumpLift: 0,
        ...raisedForelegBend(desc, raise),
      };
    }
    if (desc.pair === 1) {
      return {
        foot: {
          x: rest.x,
          y: rest.y - rear * SLAM_SECOND_PAIR_BACK,
          h: rear * SLAM_SECOND_PAIR_LIFT,
        },
        stumpLift: 0,
      };
    }
    return {
      foot: {
        x: spreadFromMidline(rest.x, 1 + SLAM_REAR_PLANT * rear),
        y: rest.y - SLAM_REAR_PLANT * rear,
        h: 0,
      },
      stumpLift: rear * STUMP_SWING_LIFT,
    };
  });
}

// ── Screech ──────────────────────────────────────────────────────────────────

/** Legs splay flat: feet pushed out from the body, knees dropping toward the floor. */
const SCREECH_SPLAY = 0.07;
const SCREECH_BUCKLE = 0.06;
const SCREECH_INFLATE = 0.09;
const SCREECH_BRISTLE_RAISE = 1.3;
/** The maw is most of the way open by the end of the tell and all the way at the burst. */
const SCREECH_TELL_MAW = 0.78;
const SCREECH_LOCK_MAW = 0.9;
const SCREECH_TREMBLE = 0.035;
/**
 * One and a half shakes across the lock, so three sampled lock frames land on
 * alternating sides rather than repeating one.
 */
const SCREECH_TREMBLE_CYCLES = 1.5;
const SCREECH_BURST_FLATTEN = 0.1;
/** She rears to scream: head up and back, forelegs flung up and wide. */
const SCREECH_REAR_BACK = 0.12;
const SCREECH_REAR_LIFT = 0.5;
const SCREECH_HEAD_RISE = 0.1;
const SCREECH_FORELEG_AIM: P3 = { x: 0.7, y: 0.15, h: 0.8 };
const SCREECH_DAZED_MAW = 0.32;
const SCREECH_DAZED_SINK = 0.12;
const SCREECH_DAZED_DROOP = 0.07;
/**
 * Dazed, her pupils shrink to pinpricks and every eye rolls its own way: wide
 * and vacant reads as stunned, where drooping lids read as sleepy.
 */
const SCREECH_DAZED_PUPILS = -0.6;
/** Dazed, the central eye rolls off to one side and up, away from her target. */
const DAZED_LOOK: P2 = { x: 0.8, y: -0.5 };
/** When in the tell the maw starts to split, and the throat starts to glow. */
const SCREECH_MAW_SPLITS_AT = 0.2;
const SCREECH_GLOW_KINDLES_AT = 0.6;
const SCREECH_TELL_GLOW = 0.4;
const SCREECH_LOCK_GLOW = 0.85;
const SCREECH_BURST_DEFLATE = 0.6;
const SCREECH_ROAR_FADE = 0.4;
const SCREECH_SAC_SWELL = 0.1;
/** Recovery: legs pulled back in over its first share, senses back over its last. */
const SCREECH_UNSPLAY_BY = 0.4;
const SCREECH_COMES_TO_AT = 0.6;
/** Dazed legs tremble; once per half of the recovery, so each shake spans several frames. */
const SCREECH_DAZED_SHAKE = 0.05;
const SCREECH_DAZED_SHAKE_CYCLES = 1;

function screechSolve(stage: SpiderAttackStage, p: number): SpiderSolve {
  let splay = 0;
  let inflate = 0;
  let maw = 0;
  let glow = 0;
  let tremble = 0;
  let roar = 0;
  let dazed = 0;
  let flatten = 0;
  let rear = 0;
  if (stage === 'tell') {
    const e = easeInOut(p);
    rear = e;
    splay = e;
    inflate = e;
    maw = SCREECH_TELL_MAW * ramp(p, SCREECH_MAW_SPLITS_AT, 1);
    glow = ramp(p, SCREECH_GLOW_KINDLES_AT, 1) * SCREECH_TELL_GLOW;
  } else if (stage === 'lock') {
    splay = 1;
    inflate = 1;
    maw = lerp(SCREECH_TELL_MAW, SCREECH_LOCK_MAW, p);
    glow = lerp(SCREECH_TELL_GLOW, SCREECH_LOCK_GLOW, p);
    rear = 1;
    tremble = Math.sin(p * Math.PI * 2 * SCREECH_TREMBLE_CYCLES);
  } else if (stage === 'strike') {
    splay = 1;
    inflate = 1 - p * SCREECH_BURST_DEFLATE;
    maw = 1;
    glow = 1;
    roar = 1 - p * SCREECH_ROAR_FADE;
    flatten = 1;
    rear = 1 - p;
  } else {
    const back = ramp(p, SCREECH_COMES_TO_AT, 1);
    dazed = 1 - back;
    splay = 1 - ramp(p, 0, SCREECH_UNSPLAY_BY);
    inflate = 0;
    maw = lerp(SCREECH_DAZED_MAW, 0, back);
    tremble = Math.sin(p * Math.PI * 2 * SCREECH_DAZED_SHAKE_CYCLES) * dazed;
  }
  const trembleX = tremble * (stage === 'recovery' ? SCREECH_DAZED_SHAKE : SCREECH_TREMBLE);
  const waist = {
    x: BALANCE_X + trembleX,
    y: PEDICEL_Y + dazed * SCREECH_DAZED_DROOP - rear * SCREECH_REAR_BACK,
  };
  const base: SpiderSolve = {
    ...restingSolve(),
    waist,
    lift:
      1 + rear * SCREECH_REAR_LIFT - flatten * SCREECH_BURST_FLATTEN - dazed * SCREECH_DAZED_SINK,
    cephScale: 1 + rear * SCREECH_HEAD_RISE,
    abdomen: {
      ...REST_ABDOMEN,
      scale: 1 + inflate * SCREECH_INFLATE,
      swell: 1 + inflate * SCREECH_SAC_SWELL,
    },
    maw,
    mawGlow: glow,
    bristle: 1 + (stage === 'recovery' ? 0 : inflate + flatten) * SCREECH_BRISTLE_RAISE * HALF,
    dilate: stage === 'recovery' ? SCREECH_DAZED_PUPILS * dazed : Math.max(inflate, flatten),
    unfocus: dazed,
    look: dazed > 0 ? { x: DAZED_LOOK.x * dazed, y: lerp(1, DAZED_LOOK.y, dazed) } : LOOK_AHEAD,
    roar,
    cheliceraSpread: maw,
  };
  return withLegs(base, (desc) => {
    const rest = restFoot(desc);
    const out = 1 + splay * SCREECH_SPLAY - dazed * SCREECH_BUCKLE;
    // Rearing to scream, she throws her forelegs up and wide: the opposite of
    // the slam's, which rise to come down in front of her.
    const forelegs = desc.pair === 0 ? rear : 0;
    const planted = {
      x: spreadFromMidline(rest.x, out),
      y: CEPH_REST_Y + (rest.y - CEPH_REST_Y) * out,
      h: 0,
    };
    const flung =
      forelegs > 0
        ? raisedTip(desc, legRoot(desc, waist, base.lift, base.cephScale), SCREECH_FORELEG_AIM)
        : planted;
    return {
      foot: {
        x: lerp(planted.x, flung.x, forelegs),
        y: lerp(planted.y, flung.y, forelegs),
        h: lerp(planted.h, flung.h, forelegs),
      },
      stumpLift: splay * STUMP_SWING_LIFT * HALF,
      ...raisedForelegBend(desc, forelegs),
    };
  });
}

// ── Spit ─────────────────────────────────────────────────────────────────────

const SPIT_REAR_BACK = 0.22;
const SPIT_REAR_LIFT = 0.45;
const SPIT_CEPH_RISE = 0.09;
const SPIT_ABDOMEN_TUCK = 0.07;
const SPIT_FORELEG_LIFT = 0.4;
/** The glob's full radius, and where it sits while gathering: between the fangs. */
export const SPIT_GLOB_RADIUS = 0.28;
/** The glob gathers between the fangs, short of their tips. */
const SPIT_GLOB_GATHER_REACH = 0.12;
const SPIT_GLOB_GATHER_Y = CEPH_HALF_LENGTH + SPIT_GLOB_GATHER_REACH;
/** The glob starts to show this far into the tell. */
const SPIT_GATHER_STARTS_AT = 0.15;
const SPIT_PUPIL_DILATE = 0.4;
const SPIT_LUNGE = 0.1;
const SPIT_RECOIL = 0.1;
/** How far the venom spray has flown on the release frame itself. */
const SPIT_SPRAY_START = 0.3;
/** The share of the strike hold the glob is still drawn leaving the mouth. */
const SPIT_GLOB_VISIBLE_SHARE = 0.5;

function spitSolve(stage: SpiderAttackStage, p: number): SpiderSolve {
  let rear = 0;
  let gather = 0;
  let glob: SpitGlob | null = null;
  let lunge = 0;
  let recoil = 0;
  let spread = 0;
  let spray = 0;
  if (stage === 'tell') {
    rear = easeInOut(p);
    gather = ramp(p, SPIT_GATHER_STARTS_AT, 1);
    spread = rear;
  } else if (stage === 'lock') {
    rear = 1;
    gather = 1;
    spread = 1;
  } else if (stage === 'strike') {
    lunge = 1 - p;
    spread = 1;
    spray = SPIT_SPRAY_START + (1 - SPIT_SPRAY_START) * p;
    if (p < SPIT_GLOB_VISIBLE_SHARE) {
      glob = { x: 0, y: FANG_TIP_Y, radius: SPIT_GLOB_RADIUS, fling: 1 };
    }
  } else {
    recoil = hump(p);
    spread = 1 - p;
  }
  if (gather > 0) {
    glob = { x: 0, y: SPIT_GLOB_GATHER_Y, radius: SPIT_GLOB_RADIUS * gather, fling: 0 };
  }
  const waist = {
    x: BALANCE_X,
    y: PEDICEL_Y - rear * SPIT_REAR_BACK + lunge * SPIT_LUNGE - recoil * SPIT_RECOIL,
  };
  const base: SpiderSolve = {
    ...restingSolve(),
    waist,
    lift: 1 + rear * SPIT_REAR_LIFT,
    cephScale: 1 + rear * SPIT_CEPH_RISE,
    abdomen: { ...REST_ABDOMEN, scale: 1 - rear * SPIT_ABDOMEN_TUCK },
    glob,
    spray,
    cheliceraSpread: spread,
    dilate: rear * SPIT_PUPIL_DILATE,
    palp: rear,
  };
  return withLegs(base, (desc) => {
    const rest = restFoot(desc);
    if (desc.pair === 0) {
      return {
        foot: { ...rest, h: rear * SPIT_FORELEG_LIFT },
        stumpLift: 0,
        ...raisedForelegBend(desc, rear),
      };
    }
    return { foot: rest, stumpLift: 0 };
  });
}

/**
 * The glob and the mouth's front edge for a pose, in the figure frame.
 *
 * The release frame must show the glob sitting on the mouth's edge: that is the
 * frame the projectile takes over from, so anywhere else and the glob visibly
 * jumps when it leaves.
 */
export function spiderGlobAtMouth(
  pose: GrotesqueSpiderPose,
): { readonly glob: P2; readonly radius: number; readonly mouthEdge: P2 } | null {
  const solve = solveSpiderPose(pose);
  if (solve.glob === null) return null;
  return {
    glob: cephToFigure(solve, solve.glob.x, solve.glob.y),
    radius: solve.glob.radius * cephDrawScale(solve),
    mouthEdge: cephToFigure(solve, 0, FANG_TIP_Y),
  };
}

// ── Lay ──────────────────────────────────────────────────────────────────────

const LAY_TURN = 0.24;
const LAY_SWELL = 0.28;
const LAY_TAIL_TUCK = 0.1;
/** The laid egg is the same size as the egg left on the floor. */
export const LAY_EGG_RADIUS = SPIDER_EGG_RADIUS_TILES;
const LAY_DEFLATE_SCALE = 0.1;
/**
 * The sac only sags a little: shrunk further, its ring of staples crowds into a
 * spiky disc that reads as a sea urchin rather than an emptied pouch.
 */
const LAY_DEFLATE_SWELL = 0.1;
const LAY_REAR_SPREAD = 0.12;
/** She squats to lay: the body drops toward the floor over the rear legs. */
const LAY_SQUAT = 0.25;
/** The ovipositor extrudes across this stretch of the tell. */
const LAY_OVIPOSITOR_FROM = 0.2;
const LAY_OVIPOSITOR_OUT_BY = 0.45;
/**
 * The tell squeezes the first egg down the abdomen, crowns it, and expels it
 * over its last stretch, so the egg has left the art by the strike's first
 * tick — the tick the creature puts the real egg on the floor.
 */
const LAY_TELL_LUMP_FROM = 0.05;
const LAY_TELL_LUMP_TO = 0.4;
const LAY_TELL_CROWN_FROM = 0.45;
const LAY_TELL_CROWN_BY = 0.72;
const LAY_TELL_EXPEL_FROM = 0.78;
/**
 * One egg's window, as shares of it: the window opens on the tick the previous
 * egg lands, which the creature owns from then on — the art shows only a
 * strand of slime left at the mouth. The next egg is squeezed down, crowns,
 * and is expelled before the window closes, so it too is gone from the art
 * on the tick it lands.
 */
const LAY_DROP_LUMP_FROM = 0.05;
const LAY_DROP_LUMP_TO = 0.5;
const LAY_DROP_CROWN_FROM = 0.45;
const LAY_DROP_CROWN_BY = 0.7;
const LAY_DROP_EXPEL_FROM = 0.75;
/** How long the strand of slime hangs from the mouth after an egg leaves. */
const LAY_AFTERBIRTH_FADE_BY = 0.4;
/** The sac squeezes behind each lump as it is pushed along. */
const LAY_SQUEEZE = 0.3;
/**
 * Where an expelled egg falls, in tiles: a little further back, and off to the
 * side her abdomen has turned toward. It rolls off the end of the ovipositor
 * sideways rather than being shot straight back, which keeps it on the floor
 * just behind her instead of out past the reach of her cell.
 */
const LAY_EXPEL_REACH = 0.08;
const LAY_EXPEL_ASIDE = 0.28;
/**
 * A crowning or held egg sits most of the way out of the mouth, by this share
 * of its radius, with only its base still in it: the ovipositor between it and
 * her tail is what shows it is being laid from there, and an egg centred on
 * the mouth is hidden under the tube's end.
 */
const LAY_HELD_REACH = 0.75;
/** An egg's size as it first crowns at the ovipositor, against its laid size. */
const LAY_EGG_CROWNING_SIZE = 0.65;
/** Recovery: she turns back, begins to refill, and withdraws the ovipositor. */
const LAY_UNTURN_FROM = 0.3;
const LAY_REFILL_FROM = 0.7;
const LAY_REFILL = 0.3;
const LAY_RETRACT_BY = 0.35;
/** The mouth gapes widest as an egg crowns and closes half-way round the egg it holds. */
const HALF_DILATE_RELAX = 0.5;

/** How far the ovipositor extrudes past the abdomen's tail, fully out. */
export const OVIPOSITOR_LENGTH = 0.14;
/** The ovipositor hangs below her body, halfway to the floor. */
const OVIPOSITOR_HEIGHT_SHARE = 0.5;

/** A point `along` tiles down the abdomen's axis from the waist, in the figure frame. */
export function alongAbdomen(solve: SpiderSolve, along: number): P2 {
  return {
    x: solve.waist.x + Math.sin(solve.abdomen.angle) * along,
    y: solve.waist.y - Math.cos(solve.abdomen.angle) * along,
  };
}

/** The abdomen's centre, along its axis from the waist. */
export function abdomenCentreDistance(solve: SpiderSolve): number {
  return PEDICEL_GAP + ABDOMEN_HALF_LENGTH * solve.abdomen.scale;
}

/** The distance from the waist to the abdomen's tail, along its axis. */
export function abdomenTailDistance(solve: SpiderSolve): number {
  return PEDICEL_GAP + 2 * ABDOMEN_HALF_LENGTH * solve.abdomen.scale;
}

/** Where the ovipositor's mouth sits for a solve, in the figure frame. */
export function ovipositorTip(solve: SpiderSolve): P3 {
  const at = alongAbdomen(solve, abdomenTailDistance(solve) + solve.ovipositor * OVIPOSITOR_LENGTH);
  return { x: at.x, y: at.y, h: BODY_HEIGHT * solve.lift * OVIPOSITOR_HEIGHT_SHARE };
}

/**
 * An egg at the ovipositor's mouth: `crown` 0 just showing to 1 fully out and
 * hanging, then `expel` 0→1 pushing it back off the mouth and down to the floor.
 */
function eggAtMouth(solve: SpiderSolve, crown: number, expel: number): LayingEgg {
  const tip = ovipositorTip(solve);
  const outX = Math.sin(solve.abdomen.angle);
  const outY = -Math.cos(solve.abdomen.angle);
  const radius = LAY_EGG_RADIUS * lerp(LAY_EGG_CROWNING_SIZE, 1, crown);
  const reach = radius * LAY_HELD_REACH + expel * LAY_EXPEL_REACH;
  const turnSide = solve.abdomen.angle < 0 ? -1 : 1;
  const aside = expel * LAY_EXPEL_ASIDE * turnSide;
  return {
    at: {
      x: tip.x + outX * reach - outY * aside,
      y: tip.y + outY * reach + outX * aside,
      h: tip.h * (1 - expel),
    },
    radius,
    dropped: expel,
  };
}

interface EggPassage {
  /** The lump under the hide, 0 none. */
  readonly lump: number;
  /** The egg at the mouth, -1 not yet crowning. */
  readonly crown: number;
  /** The egg leaving, -1 not yet. */
  readonly expel: number;
}

/** One egg's passage from sac to floor across a stretch of the lay, `p` 0→1 through it. */
function eggPassage(
  p: number,
  lump: readonly [number, number],
  crown: readonly [number, number],
  expelFrom: number,
): EggPassage {
  return {
    lump: ramp(p, lump[0], lump[1]),
    crown: p >= crown[0] ? easeOut(ramp(p, crown[0], crown[1])) : -1,
    expel: p >= expelFrom ? (p - expelFrom) / (1 - expelFrom) : -1,
  };
}

function laySolve(stage: SpiderAttackStage, p: number): SpiderSolve {
  let turn = 0;
  let swell = 0;
  let ovi = 0;
  let shove = 0;
  let deflate = 0;
  let spread = 0;
  let afterbirth = 0;
  let passage: EggPassage = { lump: 0, crown: -1, expel: -1 };
  if (stage === 'tell' || stage === 'lock') {
    const e = easeInOut(p);
    turn = e;
    swell = e;
    shove = p;
    ovi = easeOut(ramp(p, LAY_OVIPOSITOR_FROM, LAY_OVIPOSITOR_OUT_BY));
    spread = e;
    passage = eggPassage(
      p,
      [LAY_TELL_LUMP_FROM, LAY_TELL_LUMP_TO],
      [LAY_TELL_CROWN_FROM, LAY_TELL_CROWN_BY],
      LAY_TELL_EXPEL_FROM,
    );
  } else if (stage === 'strike') {
    turn = 1;
    passage = eggPassage(
      p,
      [LAY_DROP_LUMP_FROM, LAY_DROP_LUMP_TO],
      [LAY_DROP_CROWN_FROM, LAY_DROP_CROWN_BY],
      LAY_DROP_EXPEL_FROM,
    );
    swell = 1 - hump(passage.lump) * LAY_SQUEEZE;
    shove = 1 + p;
    ovi = 1;
    spread = 1;
    afterbirth = 1 - ramp(p, 0, LAY_AFTERBIRTH_FADE_BY);
  } else {
    turn = 1 - ramp(p, LAY_UNTURN_FROM, 1);
    deflate = 1 - ramp(p, LAY_REFILL_FROM, 1) * LAY_REFILL;
    ovi = 1 - ramp(p, 0, LAY_RETRACT_BY);
    spread = 1 - p;
    afterbirth = 1 - ramp(p, 0, LAY_AFTERBIRTH_FADE_BY);
  }
  // A lump that has reached the tail is the egg crowning; it stops showing
  // under the hide the moment it is out.
  const lumpShown = passage.lump > 0 && passage.crown < 0 ? passage.lump : 0;
  const abdomen: AbdomenSolve = {
    angle: turn * LAY_TURN,
    scale: 1 - turn * LAY_TAIL_TUCK - deflate * LAY_DEFLATE_SCALE,
    swell: 1 + swell * LAY_SWELL - deflate * LAY_DEFLATE_SWELL,
    deflate,
  };
  const partial: SpiderSolve = {
    ...restingSolve(),
    lift: 1 - spread * LAY_SQUAT,
    abdomen,
    ovipositor: ovi,
    eggShove: shove % 1,
    eggPulse: shove,
    birthLump: lumpShown,
    afterbirth,
    ovipositorDilate: passage.crown >= 0 ? 1 - passage.crown * HALF_DILATE_RELAX : 0,
  };
  const withEgg: SpiderSolve = {
    ...partial,
    heldEgg:
      passage.crown >= 0 ? eggAtMouth(partial, passage.crown, Math.max(0, passage.expel)) : null,
  };
  return withLegs(withEgg, (desc) => {
    const rest = restFoot(desc);
    if (desc.pair < 2) return { foot: rest, stumpLift: 0 };
    return {
      foot: { x: spreadFromMidline(rest.x, 1 + spread * LAY_REAR_SPREAD), y: rest.y, h: 0 },
      stumpLift: spread * STUMP_SWING_LIFT,
    };
  });
}

// ── Death ────────────────────────────────────────────────────────────────────

/**
 * A dead spider's legs curl up and in. Each tip is drawn in just past its own
 * root toward the carapace centre and lifted above it, so the solver folds the
 * leg with its knee thrown straight out along the line the leg stood on and
 * the lower leg hooked back in over her. Every leg stays in its own sector, so
 * the eight read as eight bent legs; aimed at a shared point, they cross in a
 * hatch.
 */
const DEATH_TIP_INWARD = 0.2;
const DEATH_TIP_HEIGHT = 1.25;
/**
 * The tips rise ahead of drawing in, reaching full height this many times
 * sooner than they reach their roots: a tip drawn in low passes too close to
 * its own root for the leg to fold that tight.
 */
const DEATH_LIFT_LEAD = 1.7;
/**
 * How far along that curl the legs stop. Drawn all the way in, each leg
 * folds flat on itself and reads from above as a straight spoke; stopped
 * part-way, every leg is still visibly bent at the knee and hooked at the
 * ankle, bunched in round her.
 */
const DEATH_LEG_CURL_EXTENT = 0.55;
/**
 * Dead, every leg's bending plane is set to this small lean, whatever its
 * living lean: enough to open each fold into a visible hook, little enough to
 * keep the knee on the leg's own line out from her.
 */
const DEATH_LEAN = 0.7;
/** Dead, the ankle folds this tight, so the lower leg hooks in rather than running straight back. */
const DEATH_ANKLE_ANGLE = 1.5;
/**
 * How far a dying leg's knee turns from bowing up toward bowing straight out
 * from her, by the end of the curl. Steered out rather than left to bow up,
 * the knees swing out smoothly as the feet pass over their roots instead of
 * snapping across them.
 */
const DEATH_KNEE_OUT = 0.85;
/** Dead, the central eye stays half open and glazed: a shut eye loses her face. */
const DEATH_CENTRAL_LID = 0.45;
/** She drops onto her belly, but keeps her size: a corpse, not a shrunken one. */
const DEATH_SINK = 0.35;
const DEATH_MAW = 0.25;
/** When the legs have finished curling, and the sac tears and spills. */
const DEATH_CURLED_BY = 0.7;
const DEATH_RUPTURE_FROM = 0.3;
const DEATH_RUPTURED_BY = 0.75;
const DEATH_SPILL_FROM = 0.4;
const DEATH_SAC_COLLAPSE = 0.2;
const DEATH_WRINKLE = 0.6;
const DEATH_BRISTLE_DROOP = 0.4;
const DEATH_STUMP_DROP = 0.6;
/** The central eye rolls back and away. */
const DEATH_LOOK: P2 = { x: -0.8, y: -0.6 };
const DEATH_LIDS: readonly number[] = [0.7, 0.2, 1, 0.55, 0.85, 0.35];

function deathSolve(progress: number): SpiderSolve {
  const curl = easeInOut(ramp(progress, 0, DEATH_CURLED_BY));
  const rupture = ramp(progress, DEATH_RUPTURE_FROM, DEATH_RUPTURED_BY);
  const spill = ramp(progress, DEATH_SPILL_FROM, 1);
  const base: SpiderSolve = {
    ...restingSolve(),
    lift: 1 - curl * DEATH_SINK,
    abdomen: {
      ...REST_ABDOMEN,
      swell: 1 - rupture * DEATH_SAC_COLLAPSE,
      deflate: rupture * DEATH_WRINKLE,
    },
    maw: curl * DEATH_MAW,
    lids: DEATH_LIDS.map((lid) => lid * curl),
    centralLid: curl * DEATH_CENTRAL_LID,
    look: { x: DEATH_LOOK.x * curl, y: lerp(LOOK_AHEAD.y, DEATH_LOOK.y, curl) },
    dilate: curl,
    unfocus: curl,
    bristle: 1 - curl * DEATH_BRISTLE_DROOP,
    rupture,
    spill,
    pallor: curl,
  };
  const centre = cephToFigure(base, 0, 0);
  const legCurl = curl * DEATH_LEG_CURL_EXTENT;
  return withLegs(base, (desc) => {
    const rest = restFoot(desc);
    const root = legRoot(desc, base.waist, base.lift, base.cephScale);
    const inward = Math.max(Math.hypot(centre.x - root.x, centre.y - root.y), Number.EPSILON);
    const radial: P3 = { x: (root.x - centre.x) / inward, y: (root.y - centre.y) / inward, h: 0 };
    const curled = {
      x: root.x + ((centre.x - root.x) / inward) * DEATH_TIP_INWARD,
      y: root.y + ((centre.y - root.y) / inward) * DEATH_TIP_INWARD,
      h: DEATH_TIP_HEIGHT,
    };
    return {
      foot: {
        x: lerp(rest.x, curled.x, legCurl),
        y: lerp(rest.y, curled.y, legCurl),
        h: curled.h * Math.min(1, legCurl * DEATH_LIFT_LEAD),
      },
      stumpLift: -curl * STUMP_END_HEIGHT * DEATH_STUMP_DROP,
      roll: (Math.sign(desc.kneeLean) * DEATH_LEAN - desc.kneeLean) * legCurl,
      ankleAngle: lerp(ANKLE_INTERIOR_ANGLE, DEATH_ANKLE_ANGLE, legCurl),
      kneeOut: normalise(
        add(scale(UP, 1 - legCurl * DEATH_KNEE_OUT), scale(radial, legCurl * DEATH_KNEE_OUT)),
        UP,
      ),
    };
  });
}

// ── Public solve and measurements ────────────────────────────────────────────

/** Solves a pose into everything the painter draws. */
export function solveSpiderPose(pose: GrotesqueSpiderPose): SpiderSolve {
  switch (pose.row) {
    case 'idle':
      return idleSolve(pose.cycle);
    case 'walk':
      return walkSolve(pose.cycle);
    case 'death':
      return deathSolve(clamp01(pose.progress));
    case 'attack_slam':
      return slamSolve(pose.stage, clamp01(pose.stageProgress));
    case 'attack_screech':
      return screechSolve(pose.stage, clamp01(pose.stageProgress));
    case 'attack_spit':
      return spitSolve(pose.stage, clamp01(pose.stageProgress));
    case 'attack_lay':
      return laySolve(pose.stage, clamp01(pose.stageProgress));
  }
}

/** How much larger than authored the carapace is drawn for a solve. */
export function cephDrawScale(solve: SpiderSolve): number {
  return solve.cephScale * CEPH_SIZE;
}

/** A carapace-local point in the figure frame, for a solve. */
export function cephToFigure(solve: SpiderSolve, x: number, y: number): P2 {
  return {
    x: solve.waist.x + x * cephDrawScale(solve),
    y: solve.waist.y + (CEPH_OFFSET + y) * cephDrawScale(solve),
  };
}

/**
 * Where a leg's tip is painted for a pose, in tiles from the pivot, and how
 * high it is off the floor.
 *
 * `height` is the ground-contact measure: zero is a foot on the floor. The
 * stump's tip is its cap, which never reaches the floor.
 */
export function getSpiderLegTip(
  pose: GrotesqueSpiderPose,
  legIndex: number,
): { readonly x: number; readonly y: number; readonly height: number } {
  const leg = solveSpiderPose(pose).legs[legIndex];
  const tip = leg.joints[leg.joints.length - 1];
  const at = project(tip);
  return { x: at.x, y: at.y, height: tip.h };
}

/** How far the second maw is split open for a pose, 0 sealed to 1 fully open. */
export function spiderMawOpen(pose: GrotesqueSpiderPose): number {
  return solveSpiderPose(pose).maw;
}
