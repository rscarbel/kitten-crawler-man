/**
 * Dr. Ignatius Moult, the spider lab's scientist: the painter.
 *
 * A rig of his own rather than Carl's or the person genome's. Carl's rig fixes
 * a stature and a carriage — square shoulders, upright spine, a big head on a
 * short neck — that are exactly what this figure must not share, and the
 * genome paints a face that dissolves under a pixel at the tile. Everything
 * that makes him read at 32 px is a silhouette decision made here: he is tall
 * and narrow, the spine curls forward so the head hangs ahead of the chest,
 * the shoulders slope away from a jutting neck, a lab coat hangs plumb from
 * that stoop to below the knees, and two bright lens discs sit across most of
 * a small bald head.
 *
 * Coordinates are figure units with the origin between his feet and +Y down,
 * so heights are negative. In profile he faces +X with his right side toward
 * the camera. Head-on his right side is on the viewer's left; from behind it
 * is on the right. The choreography (`scientistFigure.ts`) writes one
 * {@link ScientistPose} per frame and knows nothing about paint.
 *
 * The outline is the silhouette only: every part is traced once in the
 * outline colour, widened, and the parts are then painted over it, so where
 * one part crosses another the boundary is a change of value and never a line
 * of ink.
 */

import type { CardinalView } from '../facingView';
import { clamp01, lerp, mix, rgba, type Pt } from './carlArt';
import { withClip } from './softShade';
import type { RemainsColors } from './spiderLabArt';

type Ctx = CanvasRenderingContext2D;

export type Side = 'left' | 'right';
export const SIDES: readonly Side[] = ['left', 'right'];

export function pt(x: number, y: number): Pt {
  return { x, y };
}

function add(a: Pt, b: Pt): Pt {
  return pt(a.x + b.x, a.y + b.y);
}

function sub(a: Pt, b: Pt): Pt {
  return pt(a.x - b.x, a.y - b.y);
}

function scale(a: Pt, k: number): Pt {
  return pt(a.x * k, a.y * k);
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

function length(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

const DEGENERATE_LENGTH = 1e-6;

function normalise(a: Pt): Pt {
  const len = length(a);
  return len < DEGENERATE_LENGTH ? pt(0, 1) : pt(a.x / len, a.y / len);
}

/** A unit vector `angle` radians off straight up, tipped toward +X. */
function upAt(angle: number): Pt {
  return pt(Math.sin(angle), -Math.cos(angle));
}

/** A unit vector `angle` radians off straight down, tipped toward +X. */
function downAt(angle: number): Pt {
  return pt(Math.sin(angle), Math.cos(angle));
}

const MIDWAY = 0.5;

/** A vertex as shares of two extents: whatever pair its table's owner scales it by. */
type Share = readonly [number, number];

/** `share` placed off `origin`, its two shares taken of `extentX` and `extentY`. */
function placeShare(share: Share, origin: Pt, extentX: number, extentY: number): Pt {
  return pt(origin.x + extentX * share[0], origin.y + extentY * share[1]);
}

function placeShares(table: readonly Share[], origin: Pt, extentX: number, extentY: number): Pt[] {
  return table.map((share) => placeShare(share, origin, extentX, extentY));
}

const HAND_ORIGIN = pt(0, 0);

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * One material, lit to shadow. Shadows cool and saturate rather than greying
 * toward black: a ramp mixed toward black reads as dirt at the tile.
 */
interface Ramp {
  readonly light: string;
  readonly base: string;
  readonly shadow: string;
  readonly deep: string;
}

/**
 * The coat is off-white with cool blue-grey shadows, a step below pure white
 * so the lenses — the brightest thing on him — stay brighter than it.
 */
const COAT: Ramp = { light: '#f3f2ea', base: '#dedfd8', shadow: '#aab3bb', deep: '#7d8794' };
/** A deep brown: warm in the light, a cooler umber in the shadow. */
const SKIN: Ramp = { light: '#7e5136', base: '#553422', shadow: '#3b2317', deep: '#26150c' };
/**
 * The sheen on his bald dome. Paler and a touch cooler than the lit skin, so
 * at the tile it reads as light on a scalp rather than as a lighter patch of
 * skin.
 */
const SKIN_SHINE = '#cdb8ad';
/**
 * A broad sheen across the top of the dome under the crisp highlight. Without
 * it the scalp is the same flat value as the face and reads at the tile as a
 * cap of dark hair rather than as bare skin catching the light.
 */
const SKIN_SHEEN = '#80604e';
const SHEEN_ALPHA = 0.85;
const SHEEN_SCALE = 2.1;
/** The sheen sits nearer the crown's middle than the highlight it carries. */
const SHEEN_CENTRE_SHARE = 0.4;
const SHEEN_DROP_SHARE = 0.92;
/**
 * Aged white-grey, darker than the coat so the ring of coils stands off its
 * collar, and far paler than his skin so it reads against it at the tile.
 */
const HAIR: Ramp = { light: '#f1eee9', base: '#d9d5cf', shadow: '#a7a29b', deep: '#77726c' };
/** Blue nitrile, the one saturated colour on him, so his hands read at any distance. */
const GLOVE: Ramp = { light: '#8fc6ec', base: '#4f93d0', shadow: '#2f62a0', deep: '#1f3f73' };
/** A brown tweed, warm against the coat's cool shadow. */
const TROUSERS: Ramp = { light: '#8a7863', base: '#6b5a49', shadow: '#4b3d35', deep: '#33292a' };
const SOCK: Ramp = { light: '#4a4656', base: '#2f2c38', shadow: '#1f1d28', deep: '#15131c' };
const SHOE: Ramp = { light: '#7b6556', base: '#4b3a31', shadow: '#2f2422', deep: '#1d1617' };
const SHIRT: Ramp = { light: '#c9d8e2', base: '#9fb5c6', shadow: '#738aa0', deep: '#566a80' };
const TIE: Ramp = { light: '#9c4046', base: '#7a2b33', shadow: '#561d27', deep: '#3d1420' };

/** The silhouette line: a warm dark plum rather than black, so it frames rather than cuts. */
const SILHOUETTE = '#2a1f2c';
/** Genuine dark marks only — pupils, mouth, nostril, glasses frames. */
const INK = '#1b1820';
const LENS = '#e9f5fa';
const LENS_EDGE = '#b9d4e0';
const GLINT = '#ffffff';
const FRAME_RIM = '#26232b';
/** Grey stubble on dark skin is lighter than the skin it grows from. */
const STUBBLE = '#dedad4';
const STAIN_YELLOW = '#c8b57a';
const STAIN_BROWN = '#9c826c';
const LANYARD = '#c6452f';
const BADGE = '#f4f6f4';
const BADGE_BAND = '#3f7cc4';
const PEN_COLOURS: readonly string[] = ['#2c4fa3', '#b3282d', '#222026'];
const BUTTON = '#c8cbc6';

/**
 * His colours, for the remains her spit leaves of him. Read from the same
 * ramps that paint him, so the coat in the pool is his coat.
 */
export function scientistRemainsColors(): RemainsColors {
  return {
    skin: SKIN.base,
    hair: HAIR.base,
    coat: COAT.base,
    trousers: TROUSERS.base,
  };
}

// ── Proportions ──────────────────────────────────────────────────────────────

/** Ankle above the floor. */
export const ANKLE_HEIGHT = 0.085;
/** Long thin legs: together they are over half his standing height. */
export const THIGH_LENGTH = 0.71;
export const SHIN_LENGTH = 0.72;
/**
 * Slack so a fully reached leg is not locked dead straight. Tiny, because a
 * joint's sideways travel grows as the square root of the slack.
 */
export const JOINT_SLACK = 0.0004;
export const LEG_MAX_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;
/**
 * He never quite straightens his knees: an old man stands with them soft,
 * which is also what gives the walk its headroom.
 */
const STANDING_LEG_EXTENSION = 0.972;
export const STANDING_HIP_HEIGHT = ANKLE_HEIGHT + LEG_MAX_REACH * STANDING_LEG_EXTENSION;

/** The spine in three links, hip to the base of the neck. */
const PELVIS_TO_WAIST = 0.24;
const WAIST_TO_CHEST = 0.3;
const CHEST_TO_NECK = 0.29;
const NECK_LENGTH = 0.2;
/** Where the skull's centre sits off the top of the neck, along the head's own up. */
const HEAD_ABOVE_NECK = 0.13;
const HEAD_AHEAD_OF_NECK = 0.035;

/**
 * A small head for his height — seven heads tall, against Carl's five and a
 * half — and narrower than it is tall. The glasses span nearly all of it.
 */
export const HEAD_RX = 0.2;
export const HEAD_RY = 0.262;
/** Front to back, nose excluded. */
const HEAD_DEPTH_RX = 0.228;

export const UPPER_ARM_LENGTH = 0.45;
export const FOREARM_LENGTH = 0.41;
/** Derived from the forearm, never from the head. */
const HAND_TO_FOREARM = 0.42;
const HAND_WIDTH_TO_LENGTH = 0.66;
const HAND_LENGTH = FOREARM_LENGTH * HAND_TO_FOREARM;
const HAND_WIDTH = HAND_LENGTH * HAND_WIDTH_TO_LENGTH;

/** Head-on, the arms root this far either side of the neck, and this far below it. */
const ARM_ROOT_HALF = 0.18;
/**
 * Head-on the neck's jut is depth, which the picture cannot show as width, so
 * it is drawn as what the eye sees of it: the head sunk low between the
 * shoulders, no neck showing. From behind it sinks further, below the crest
 * of the hunched back, so only the dome and the hair round it show over it.
 */
const FRONT_HEAD_SINK = 0.09;
const BACK_HEAD_SINK = 0.07;
/**
 * The shoulders slope steeply off the neck. Level shoulders are Carl's; a
 * slope this steep is most of what says "old" from across a room.
 */
const SHOULDER_SLOPE = 0.12;
const LEG_ROOT_HALF = 0.085;
/**
 * In profile the hip joint sits ahead of the base of the spine. Rooted on the
 * spine itself, his legs come out of the back edge of the coat and the coat
 * reads as floating in front of his hips.
 */
export const PROFILE_HIP_JOINT_AHEAD = 0.06;
/** Head-on, a foot ahead of the hip draws this share of its lead as screen height. */
export const HEAD_ON_FLOOR_FORESHORTENING = 0.15;

/** The coat's hem height: well below the knees, so it swings with every step. */
const HEM_HEIGHT = 0.63;
/** Trouser legs stop short over the socks. */
const TROUSER_HEM_HEIGHT = 0.24;

const OUTLINE_WIDTH = 0.045;

// ── Pose ─────────────────────────────────────────────────────────────────────

export type HandShape = 'relaxed' | 'fist' | 'open' | 'point' | 'pinch';

/** One arm. Joint angles by default; a target when set, solved with the elbow toward `pole`. */
export interface ArmPose {
  /**
   * The upper arm's angle off hanging straight down. In profile positive
   * swings it forward; head-on, positive swings it out away from the body.
   */
  upper: number;
  /** The elbow's bend: in profile it folds the forearm forward, head-on inward across him. */
  bend: number;
  /** A segment pointed at the camera can only be drawn shorter. */
  upperScale: number;
  foreScale: number;
  /** A hand target, overriding the angles. */
  target: Pt | null;
  /** Which way the elbow breaks when the arm is placed by its target. */
  pole: Pt;
  /**
   * Head-on, how much of a target-placed elbow's bend is depth rather than
   * width, 0–1. An arm folded to his belly bends toward the camera, and solved
   * flat it throws the elbow out sideways into an akimbo.
   */
  foreshorten: number;
  hand: HandShape;
  /** The hand's turn off the forearm's line, radians. */
  handTurn: number;
  /** Painted behind the torso, for the whole row. */
  behind: boolean;
  /**
   * From behind, the forearm and hand are in front of him and hidden by his
   * back while the upper arm still shows at his side.
   */
  foreBehind: boolean;
  /** Painted over the head, for an arm raised in front of his face. */
  overHead: boolean;
}

export interface FootPose {
  /**
   * In profile, the ankle's x in figure space; head-on, how far ahead of the
   * hip it is, which draws as a little screen height.
   */
  ahead: number;
  /** The ankle above the floor. */
  height: number;
  /** The sole's tilt: negative lifts the toe, positive the heel. */
  pitch: number;
  planted: boolean;
}

export interface ScientistPose {
  view: CardinalView;
  /** The hip centre. In profile x is forward; head-on x is sideways sway. */
  hip: Pt;
  /** The three spine links' forward tips, cumulative from the pelvis up. */
  lean: number;
  hunch: number;
  upperBack: number;
  /** The neck off vertical, tipped forward. */
  neck: number;
  /** The skull's own tilt; positive drops the chin. */
  headPitch: number;
  /** −1 to 1: the face turned toward his left (head-on: toward the viewer's right). */
  headTurn: number;
  /** Head-on, the body rolling sideways about the hip. */
  roll: number;
  /** Shoulders hunched up toward the ears, 0–1. */
  shrug: number;
  arms: Record<Side, ArmPose>;
  feet: Record<Side, FootPose>;
  /** Pupils inside the lenses, −1 to 1 each way. */
  gaze: Pt;
  blink: number;
  /** 0 shut, 1 a round open mouth. */
  mouth: number;
  /** 0 level brows, 1 raised and knotted in the middle with worry. */
  worry: number;
  /** The hem's swing, in figure units: forward in profile, sideways head-on. */
  hemSwing: number;
  /** 0 hanging, 1 the coat streaming out behind a run. */
  flare: number;
  /** The badge on its lanyard swinging off plumb, in figure units. */
  badgeSwing: number;
}

/** The arm hangs a little forward of plumb and soft at the elbow: nothing on him is straight. */
const REST_UPPER = 0.06;
const REST_BEND = 0.24;
const REST_FACING_UPPER = 0.1;
const REST_FACING_BEND = 0.12;

export function restingArm(view: CardinalView): ArmPose {
  const facing = view !== 'side';
  return {
    upper: facing ? REST_FACING_UPPER : REST_UPPER,
    bend: facing ? REST_FACING_BEND : REST_BEND,
    upperScale: 1,
    foreScale: 1,
    target: null,
    pole: facing ? pt(0, 1) : pt(-1, 0),
    foreshorten: 0,
    foreBehind: false,
    hand: 'relaxed',
    handTurn: 0,
    behind: false,
    overHead: false,
  };
}

/** His standing stance: feet a little apart, the left a touch ahead in profile. */
const STANCE_FOOT_SPREAD = 0.09;
const STANCE_FOOT_HALF = 0.07;

/** The stoop he never comes out of. */
export const REST_LEAN = 0.2;
export const REST_HUNCH = 0.16;
export const REST_UPPER_BACK = 0.36;
export const REST_NECK = 0.98;
/** The head tips back against the neck so his face looks ahead, not at the floor. */
export const REST_HEAD_PITCH = -0.58;
/**
 * His rump sits behind his feet: with the head carried that far forward, the
 * hips have to go back for him to stand over his feet at all.
 */
export const REST_HIP_BACK = -0.07;
/** Even at rest his brows sit a little knotted. */
const REST_WORRY = 0.35;

export function restingPose(view: CardinalView): ScientistPose {
  const side = view === 'side';
  return {
    view,
    hip: pt(side ? REST_HIP_BACK : 0, -STANDING_HIP_HEIGHT),
    lean: REST_LEAN,
    hunch: REST_HUNCH,
    upperBack: REST_UPPER_BACK,
    neck: REST_NECK,
    headPitch: REST_HEAD_PITCH,
    headTurn: 0,
    roll: 0,
    shrug: 0,
    arms: { left: restingArm(view), right: restingArm(view) },
    feet: {
      left: {
        ahead: side ? STANCE_FOOT_HALF : 0,
        height: ANKLE_HEIGHT,
        pitch: 0,
        planted: true,
      },
      right: {
        ahead: side ? -STANCE_FOOT_HALF : 0,
        height: ANKLE_HEIGHT,
        pitch: 0,
        planted: true,
      },
    },
    gaze: pt(0, 0),
    blink: 0,
    mouth: 0,
    worry: REST_WORRY,
    hemSwing: 0,
    flare: 0,
    badgeSwing: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface Chain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
  /** Whether the target was past the chain's reach and the limb was clamped straight. */
  readonly clamped: boolean;
}

/**
 * Places a two-segment limb so its end lands on `target`, the joint breaking
 * toward `pole`. Head-on legs pass `foreshorten` 1: a knee pointed at the
 * camera hinges away from it, so in the picture it lies on the hip→ankle line.
 */
export function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  pole: Pt,
  foreshorten = 0,
): Chain {
  const toTarget = sub(target, root);
  const reach = upper + lower - JOINT_SLACK;
  const rawDistance = length(toTarget);
  const clamped = rawDistance > reach;
  const distance = Math.max(Math.min(rawDistance, reach), DEGENERATE_LENGTH);
  const u = normalise(toTarget);
  const end = add(root, scale(u, distance));
  const along = Math.max(
    -upper,
    Math.min(upper, (distance * distance + upper * upper - lower * lower) / (2 * distance)),
  );
  const offset = Math.sqrt(Math.max(0, upper * upper - along * along)) * (1 - clamp01(foreshorten));
  const perpendicular = pt(-u.y, u.x);
  const toward = perpendicular.x * pole.x + perpendicular.y * pole.y >= 0 ? 1 : -1;
  const joint = add(add(root, scale(u, along)), scale(perpendicular, offset * toward));
  return { root, joint, end, clamped };
}

export interface ScientistSkeleton {
  readonly view: CardinalView;
  readonly hip: Pt;
  readonly waist: Pt;
  readonly chest: Pt;
  readonly neckBase: Pt;
  readonly neckTop: Pt;
  readonly head: Pt;
  /** Directions of each spine link, for laying the torso's depth off them in profile. */
  readonly lowerDir: Pt;
  readonly midDir: Pt;
  readonly upperDir: Pt;
  /** The skull's rotation in the picture: profile only. */
  readonly headAngle: number;
  readonly shoulders: Record<Side, Pt>;
  readonly arms: Record<Side, Chain>;
  readonly legs: Record<Side, Chain>;
}

/** Head-on, which way on screen each of his sides lies. */
function screenSide(view: CardinalView, side: Side): number {
  const right = view === 'front' ? -1 : 1;
  return side === 'right' ? right : -right;
}

/** A spine link head-on: its forward tip is depth the camera cannot see, so only its height shows. */
function facingLink(angle: number, roll: number, linkLength: number): Pt {
  return pt(Math.sin(roll) * linkLength, -Math.cos(angle) * linkLength);
}

/** In profile, the shoulder joint sits a little behind and below the base of the neck. */
const PROFILE_SHOULDER_BACK = -0.035;
const PROFILE_SHOULDER_DROP = 0.085;
/** How far a full shrug lifts the shoulders toward his ears. */
const SHRUG_LIFT = 0.07;
/** Head-on, a foot's lateral place either side of the centreline. */
export const FOOT_SPREAD = STANCE_FOOT_SPREAD;

/** Where a foot's ankle draws, in figure space, for the pose's view. */
export function ankleOf(pose: ScientistPose, side: Side): Pt {
  const foot = pose.feet[side];
  if (pose.view === 'side') return pt(foot.ahead, -foot.height);
  const depthSign = pose.view === 'front' ? 1 : -1;
  const lateral = screenSide(pose.view, side) * FOOT_SPREAD;
  return pt(lateral, -foot.height + foot.ahead * HEAD_ON_FLOOR_FORESHORTENING * depthSign);
}

function armChain(view: CardinalView, side: Side, root: Pt, arm: ArmPose): Chain {
  const upperLength = UPPER_ARM_LENGTH * arm.upperScale;
  const foreLength = FOREARM_LENGTH * arm.foreScale;
  if (arm.target !== null) {
    return solveTwoBone(root, arm.target, upperLength, foreLength, arm.pole, arm.foreshorten);
  }
  const outward = view === 'side' ? 1 : screenSide(view, side);
  const fold = view === 'side' ? 1 : -1;
  const upperDir = downAt(arm.upper);
  const elbow = add(root, pt(upperDir.x * outward * upperLength, upperDir.y * upperLength));
  const foreDir = downAt(arm.upper + fold * arm.bend);
  const wrist = add(elbow, pt(foreDir.x * outward * foreLength, foreDir.y * foreLength));
  return { root, joint: elbow, end: wrist, clamped: false };
}

export function buildSkeleton(pose: ScientistPose): ScientistSkeleton {
  const { view } = pose;
  const side = view === 'side';
  const lowerAngle = pose.lean;
  const midAngle = lowerAngle + pose.hunch;
  const upperAngle = midAngle + pose.upperBack;
  const link = (angle: number, linkLength: number): Pt =>
    side ? scale(upAt(angle), linkLength) : facingLink(angle, pose.roll, linkLength);
  const hip = pose.hip;
  const waist = add(hip, link(lowerAngle, PELVIS_TO_WAIST));
  const chest = add(waist, link(midAngle, WAIST_TO_CHEST));
  const neckBase = add(chest, link(upperAngle, CHEST_TO_NECK));
  const neckTop = add(neckBase, link(pose.neck, NECK_LENGTH));
  const headAngle = pose.neck + pose.headPitch;
  const headOffset = side
    ? scale(upAt(headAngle), HEAD_ABOVE_NECK)
    : pt(
        0,
        -HEAD_ABOVE_NECK * Math.cos(headAngle) +
          (view === 'front' ? FRONT_HEAD_SINK : BACK_HEAD_SINK),
      );
  const aheadOffset = side
    ? scale(pt(Math.cos(headAngle), Math.sin(headAngle)), HEAD_AHEAD_OF_NECK)
    : pt(0, 0);
  const head = add(add(neckTop, headOffset), aheadOffset);

  const shrug = pose.shrug * SHRUG_LIFT;
  const shoulderFor = (s: Side): Pt => {
    if (side) return add(neckBase, pt(PROFILE_SHOULDER_BACK, PROFILE_SHOULDER_DROP - shrug));
    return add(neckBase, pt(screenSide(view, s) * ARM_ROOT_HALF, SHOULDER_SLOPE - shrug));
  };
  const shoulders = { left: shoulderFor('left'), right: shoulderFor('right') };
  const arms = {
    left: armChain(view, 'left', shoulders.left, pose.arms.left),
    right: armChain(view, 'right', shoulders.right, pose.arms.right),
  };
  const legFor = (s: Side): Chain => {
    const root = side
      ? add(hip, pt(PROFILE_HIP_JOINT_AHEAD, 0))
      : add(hip, pt(screenSide(view, s) * LEG_ROOT_HALF, 0));
    const pole = side ? pt(1, 0) : pt(screenSide(view, s), 0);
    return solveTwoBone(root, ankleOf(pose, s), THIGH_LENGTH, SHIN_LENGTH, pole, side ? 0 : 1);
  };
  return {
    view,
    hip,
    waist,
    chest,
    neckBase,
    neckTop,
    head,
    lowerDir: upAt(lowerAngle),
    midDir: upAt(midAngle),
    upperDir: upAt(upperAngle),
    headAngle,
    shoulders,
    arms,
    legs: { left: legFor('left'), right: legFor('right') },
  };
}

// ── Paint primitives ─────────────────────────────────────────────────────────

/** One part: a path traced for the silhouette pass, and the paint laid inside it. */
interface Part {
  readonly trace: (ctx: Ctx) => void;
  readonly paint: (ctx: Ctx) => void;
}

/** A shape filled flat in one colour. */
function flatPart(trace: (ctx: Ctx) => void, colour: string): Part {
  return {
    trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = colour;
      ctx.fill();
    },
  };
}

/**
 * Where the lit band ends and the terminator falls, as shares of the way
 * across a form from its lit edge to its shadow edge. Hard steps, not a soft
 * gradient: at 32 px a smooth falloff reads as airbrush, and a terminator that
 * runs along the form's own axis is what says it is round.
 */
const LIT_SHARE = 0.22;
const TERMINATOR_SHARE = 0.62;
const DEEP_SHARE = 0.9;

function bandedGradient(ctx: Ctx, from: Pt, to: Pt, ramp: Ramp): CanvasGradient {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, ramp.light);
  gradient.addColorStop(LIT_SHARE, ramp.light);
  gradient.addColorStop(LIT_SHARE, ramp.base);
  gradient.addColorStop(TERMINATOR_SHARE, ramp.base);
  gradient.addColorStop(TERMINATOR_SHARE, ramp.shadow);
  gradient.addColorStop(DEEP_SHARE, ramp.shadow);
  gradient.addColorStop(DEEP_SHARE, ramp.deep);
  gradient.addColorStop(1, ramp.deep);
  return gradient;
}

/**
 * The key light comes from the upper left of the screen in every view, so a
 * form's lit edge is whichever of its two sides faces it.
 */
const LIGHT_RISE = 0.7;
const LIGHT: Pt = normalise(pt(-1, -LIGHT_RISE));

/** A form lit across its width: `axisFrom`→`axisTo` runs down its length, `halfWidth` either side. */
function bandedPart(
  trace: (ctx: Ctx) => void,
  axisFrom: Pt,
  axisTo: Pt,
  halfWidth: number,
  ramp: Ramp,
): Part {
  return {
    trace,
    paint: (ctx) => {
      const axis = normalise(sub(axisTo, axisFrom));
      let across = pt(-axis.y, axis.x);
      if (across.x * LIGHT.x + across.y * LIGHT.y < 0) across = scale(across, -1);
      const mid = lerpPt(axisFrom, axisTo, MIDWAY);
      const lit = add(mid, scale(across, halfWidth));
      const dark = add(mid, scale(across, -halfWidth));
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = bandedGradient(ctx, lit, dark, ramp);
      ctx.fill();
    },
  };
}

/** A tapered limb segment, its two ends capped round. */
function traceLimb(ctx: Ctx, from: Pt, to: Pt, halfFrom: number, halfTo: number): void {
  const axis = normalise(sub(to, from));
  const n = pt(-axis.y, axis.x);
  const angle = Math.atan2(axis.y, axis.x);
  ctx.moveTo(from.x + n.x * halfFrom, from.y + n.y * halfFrom);
  ctx.lineTo(to.x + n.x * halfTo, to.y + n.y * halfTo);
  ctx.arc(to.x, to.y, halfTo, angle + Math.PI / 2, angle - Math.PI / 2, true);
  ctx.lineTo(from.x - n.x * halfFrom, from.y - n.y * halfFrom);
  ctx.arc(from.x, from.y, halfFrom, angle - Math.PI / 2, angle + Math.PI / 2, true);
  ctx.closePath();
}

function limbPart(from: Pt, to: Pt, halfFrom: number, halfTo: number, ramp: Ramp): Part {
  return bandedPart(
    (ctx) => traceLimb(ctx, from, to, halfFrom, halfTo),
    from,
    to,
    Math.max(halfFrom, halfTo),
    ramp,
  );
}

function tracePolygon(ctx: Ctx, points: readonly Pt[]): void {
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

/** A closed curve through `points`, smoothed by running quadratics between their midpoints. */
function traceSmooth(ctx: Ctx, points: readonly Pt[]): void {
  const n = points.length;
  const start = lerpPt(points[n - 1], points[0], MIDWAY);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const next = points[(i + 1) % n];
    const mid = lerpPt(p, next, MIDWAY);
    ctx.quadraticCurveTo(p.x, p.y, mid.x, mid.y);
  }
  ctx.closePath();
}

function traceEllipse(ctx: Ctx, c: Pt, rx: number, ry: number, rotation = 0): void {
  ctx.ellipse(
    c.x,
    c.y,
    Math.max(rx, DEGENERATE_LENGTH),
    Math.max(ry, DEGENERATE_LENGTH),
    rotation,
    0,
    Math.PI * 2,
  );
}

function strokeLine(ctx: Ctx, from: Pt, to: Pt, width: number, colour: string): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.stroke();
}

function fillEllipse(ctx: Ctx, c: Pt, rx: number, ry: number, colour: string, rotation = 0): void {
  ctx.beginPath();
  traceEllipse(ctx, c, rx, ry, rotation);
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * The shadow side of a round form, as the form minus itself slid toward the
 * light: the terminator then follows the form's own contour rather than
 * sitting on a circle round its centre.
 */
function shadeOffset(ctx: Ctx, trace: () => void, shift: number, colour: string): void {
  const traceFresh = (): void => {
    ctx.beginPath();
    trace();
  };
  withClip(ctx, traceFresh, () => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.rect(-SURFACE_HALF, -SURFACE_HALF, SURFACE_HALF * 2, SURFACE_HALF * 2);
    ctx.save();
    ctx.translate(LIGHT.x * shift, LIGHT.y * shift);
    trace();
    ctx.restore();
    ctx.fill('evenodd');
  });
}

/** Large enough to cover the whole figure from anywhere inside it. */
const SURFACE_HALF = 4;

// ── Legs and feet ────────────────────────────────────────────────────────────

const THIGH_HALF = 0.078;
const KNEE_HALF = 0.064;
/** The bony knee stands proud of the trouser leg: thin legs, knobbly knees. */
const KNEE_KNOB = 0.074;
const CALF_HALF = 0.062;
const TROUSER_HEM_HALF = 0.06;
const SOCK_HALF = 0.04;

const SHOE_HEEL_BACK = 0.065;
const SHOE_TOE_AHEAD = 0.2;
const SHOE_HEIGHT = 0.095;
const SHOE_SOLE = 0.022;
const SHOE_FACING_HALF = 0.052;
const SHOE_FACING_HEIGHT = 0.09;
/** The toe cap, scuffed lighter where it has kicked a thousand bench legs. */
const SCUFF_ALPHA = 0.55;
/** In profile, the instep's crest and the toe's rounded nose, as shares of the shoe's length and height. */
const SHOE_INSTEP_AHEAD_SHARE = 0.55;
const SHOE_INSTEP_HEIGHT_SHARE = 0.7;
const SHOE_TOE_HEIGHT_SHARE = 0.35;
const SCUFF_AHEAD_SHARE = 0.75;
const SCUFF_HEIGHT_SHARE = 0.4;
const SCUFF_RX_SHARE = 0.18;
const SCUFF_RY_SHARE = 0.22;
/** Head-on, the shoe rises this share of its height above the ankle and narrows across the instep. */
const SHOE_FACING_TOP_SHARE = 0.4;
const SHOE_FACING_TOP_TAPER = 0.8;
const FACING_SCUFF_INSET_SHARE = 0.25;
const FACING_SCUFF_RISE_SHARE = 0.45;
const FACING_SCUFF_RX_SHARE = 0.45;
const FACING_SCUFF_RY_SHARE = 0.2;

function legParts(skel: ScientistSkeleton, pose: ScientistPose, side: Side, far: boolean): Part[] {
  const chain = skel.legs[side];
  const trousers = far ? receded(TROUSERS) : TROUSERS;
  const socks = far ? receded(SOCK) : SOCK;
  const parts: Part[] = [];
  const ankle = chain.end;
  const shinUp = normalise(sub(chain.joint, ankle));
  const trouserEnd = add(ankle, scale(shinUp, TROUSER_HEM_HEIGHT - ANKLE_HEIGHT));
  parts.push(limbPart(ankle, trouserEnd, SOCK_HALF, SOCK_HALF, socks));
  parts.push(limbPart(chain.root, chain.joint, THIGH_HALF, KNEE_HALF, trousers));
  parts.push(limbPart(chain.joint, trouserEnd, CALF_HALF, TROUSER_HEM_HALF, trousers));
  parts.push(
    bandedPart(
      (ctx) => traceEllipse(ctx, chain.joint, KNEE_KNOB, KNEE_KNOB),
      add(chain.joint, pt(0, -KNEE_KNOB)),
      add(chain.joint, pt(0, KNEE_KNOB)),
      KNEE_KNOB,
      trousers,
    ),
  );
  parts.push(footPart(skel.view, ankle, pose.feet[side], far));
  return parts;
}

/** How far each step of a far-side limb's ramp is pushed toward the next darker one. */
const RECEDED_SHARE = 0.35;

function receded(ramp: Ramp): Ramp {
  return {
    light: mix(ramp.light, ramp.shadow, RECEDED_SHARE),
    base: mix(ramp.base, ramp.shadow, RECEDED_SHARE),
    shadow: mix(ramp.shadow, ramp.deep, RECEDED_SHARE),
    deep: ramp.deep,
  };
}

function footPart(view: CardinalView, ankle: Pt, foot: FootPose, far: boolean): Part {
  const shoe = far ? receded(SHOE) : SHOE;
  if (view === 'side') {
    const c = Math.cos(foot.pitch);
    const s = Math.sin(foot.pitch);
    const local = (x: number, y: number): Pt => add(ankle, pt(x * c - y * s, x * s + y * c));
    const groundY = ANKLE_HEIGHT;
    const outline: Pt[] = [
      local(-SHOE_HEEL_BACK, groundY),
      local(-SHOE_HEEL_BACK, groundY - SHOE_HEIGHT),
      local(0, groundY - SHOE_HEIGHT - SHOE_SOLE),
      local(
        SHOE_TOE_AHEAD * SHOE_INSTEP_AHEAD_SHARE,
        groundY - SHOE_HEIGHT * SHOE_INSTEP_HEIGHT_SHARE,
      ),
      local(SHOE_TOE_AHEAD, groundY - SHOE_HEIGHT * SHOE_TOE_HEIGHT_SHARE),
      local(SHOE_TOE_AHEAD, groundY),
    ];
    const toe = local(
      SHOE_TOE_AHEAD * SCUFF_AHEAD_SHARE,
      groundY - SHOE_HEIGHT * SCUFF_HEIGHT_SHARE,
    );
    return {
      trace: (ctx) => traceSmooth(ctx, outline),
      paint: (ctx) => {
        ctx.beginPath();
        traceSmooth(ctx, outline);
        ctx.fillStyle = bandedGradient(
          ctx,
          local(0, groundY - SHOE_HEIGHT),
          local(0, groundY),
          shoe,
        );
        ctx.fill();
        fillEllipse(
          ctx,
          toe,
          SHOE_TOE_AHEAD * SCUFF_RX_SHARE,
          SHOE_HEIGHT * SCUFF_RY_SHARE,
          rgba(shoe.light, SCUFF_ALPHA),
        );
        strokeLine(
          ctx,
          local(-SHOE_HEEL_BACK, groundY),
          local(SHOE_TOE_AHEAD, groundY),
          SHOE_SOLE,
          shoe.deep,
        );
      },
    };
  }
  const top = ankle.y - SHOE_FACING_HEIGHT * SHOE_FACING_TOP_SHARE;
  const bottom = ankle.y + ANKLE_HEIGHT;
  const outline: Pt[] = [
    pt(ankle.x - SHOE_FACING_HALF * SHOE_FACING_TOP_TAPER, top),
    pt(ankle.x + SHOE_FACING_HALF * SHOE_FACING_TOP_TAPER, top),
    pt(ankle.x + SHOE_FACING_HALF, bottom - SHOE_SOLE),
    pt(ankle.x + SHOE_FACING_HALF, bottom),
    pt(ankle.x - SHOE_FACING_HALF, bottom),
    pt(ankle.x - SHOE_FACING_HALF, bottom - SHOE_SOLE),
  ];
  return {
    trace: (ctx) => traceSmooth(ctx, outline),
    paint: (ctx) => {
      ctx.beginPath();
      traceSmooth(ctx, outline);
      ctx.fillStyle = bandedGradient(
        ctx,
        pt(ankle.x - SHOE_FACING_HALF, top),
        pt(ankle.x + SHOE_FACING_HALF, bottom),
        shoe,
      );
      ctx.fill();
      if (view === 'front') {
        fillEllipse(
          ctx,
          pt(
            ankle.x - SHOE_FACING_HALF * FACING_SCUFF_INSET_SHARE,
            bottom - SHOE_FACING_HEIGHT * FACING_SCUFF_RISE_SHARE,
          ),
          SHOE_FACING_HALF * FACING_SCUFF_RX_SHARE,
          SHOE_FACING_HEIGHT * FACING_SCUFF_RY_SHARE,
          rgba(shoe.light, SCUFF_ALPHA),
        );
      }
    },
  };
}

// ── Arms and hands ───────────────────────────────────────────────────────────

/** The coat's sleeves are cut loose: wide at the shoulder, still roomy at the cuff. */
const SLEEVE_ROOT_HALF = 0.072;
const SLEEVE_ELBOW_HALF = 0.062;
const SLEEVE_CUFF_HALF = 0.056;
/** The cuff band, back from the wrist along the forearm. */
const CUFF_DEPTH = 0.06;
const WRIST_HALF = 0.032;

type ArmSegment = 'whole' | 'upper' | 'fore';

function armParts(
  skel: ScientistSkeleton,
  pose: ScientistPose,
  side: Side,
  far: boolean,
  segment: ArmSegment = 'whole',
): Part[] {
  const chain = skel.arms[side];
  const coat = far ? receded(COAT) : COAT;
  const glove = far ? receded(GLOVE) : GLOVE;
  const arm = pose.arms[side];
  const foreAxis = normalise(sub(chain.end, chain.joint));
  const cuffStart = sub(chain.end, scale(foreAxis, CUFF_DEPTH));
  const upper = limbPart(chain.root, chain.joint, SLEEVE_ROOT_HALF, SLEEVE_ELBOW_HALF, coat);
  if (segment === 'upper') return [upper];
  const parts: Part[] = [
    handPart(chain, arm, glove, skel.view, side),
    limbPart(
      chain.end,
      add(chain.end, scale(foreAxis, -CUFF_DEPTH)),
      WRIST_HALF,
      WRIST_HALF,
      glove,
    ),
  ];
  if (segment === 'whole') parts.push(upper);
  parts.push(limbPart(chain.joint, chain.end, SLEEVE_ELBOW_HALF, SLEEVE_CUFF_HALF, coat));
  parts.push({
    trace: () => undefined,
    paint: (ctx) => {
      strokeLine(
        ctx,
        add(cuffStart, scale(pt(-foreAxis.y, foreAxis.x), SLEEVE_CUFF_HALF * CUFF_LINE_SHARE)),
        add(cuffStart, scale(pt(foreAxis.y, -foreAxis.x), SLEEVE_CUFF_HALF * CUFF_LINE_SHARE)),
        CUFF_LINE,
        coat.shadow,
      );
    },
  });
  return parts;
}

const CUFF_LINE = 0.018;
/** The cuff's seam stops just inside the sleeve's edge. */
const CUFF_LINE_SHARE = 0.9;

/**
 * A gloved hand in the forearm's own frame: +X along the fingers, +Y to the
 * thumb's side. Fingers are a silhouette, not strokes: at the tile a hand is
 * four pixels, and separate digits read as stitching.
 */
function handPart(chain: Chain, arm: ArmPose, glove: Ramp, view: CardinalView, side: Side): Part {
  const axis = normalise(sub(chain.end, chain.joint));
  const angle = Math.atan2(axis.y, axis.x) + arm.handTurn;
  const thumbSide = view === 'side' ? -1 : screenSide(view, side) * (view === 'front' ? 1 : -1);
  const trace = (ctx: Ctx): void => {
    ctx.save();
    ctx.translate(chain.end.x, chain.end.y);
    ctx.rotate(angle);
    traceHand(ctx, arm.hand, thumbSide);
    ctx.restore();
  };
  return {
    trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = glove.base;
      ctx.fill();
      shadeOffset(ctx, () => trace(ctx), HAND_WIDTH * HAND_SHADE_SHARE, glove.shadow);
    },
  };
}

const HAND_SHADE_SHARE = 0.35;

/** Hand outlines: shares of the hand's length along the fingers, and of its half-width toward the thumb. */
const FIST_OUTLINE: readonly Share[] = [
  [-0.1, -0.9],
  [0.55, -1],
  [0.66, 0],
  [0.55, 1],
  [-0.1, 0.9],
];
const POINTING_FIST_OUTLINE: readonly Share[] = [
  [-0.1, -0.9],
  [0.5, -1],
  [0.6, 0],
  [0.5, 1],
  [-0.1, 0.9],
];
const OPEN_HAND_OUTLINE: readonly Share[] = [
  [-0.05, -0.95],
  [0.5, -1.15],
  [1.05, -0.75],
  [1.12, 0],
  [1.05, 0.75],
  [0.5, 1.15],
  [-0.05, 0.95],
];
const RELAXED_HAND_OUTLINE: readonly Share[] = [
  [-0.05, -0.9],
  [0.55, -1],
  [0.92, -0.45],
  [0.95, 0.3],
  [0.6, 0.95],
  [-0.05, 0.9],
];
/** The fingertips meeting the thumb in a pinch: a knot off the fist on the thumb's side. */
const PINCH_KNOT = { start: [0.5, 0.2], centre: [0.68, 0.3], rx: 0.18, ry: 0.3 } as const;
/** The pointing finger, off the side away from the thumb, from its knuckle to its tip. */
const POINTING_FINGER = {
  root: [0.4, 0.45],
  tip: [1.15, 0.45],
  rootHalf: 0.32,
  tipHalf: 0.26,
} as const;
/** The open hand's thumb, splayed out from the palm. */
const OPEN_THUMB = {
  start: [0.25, 1],
  root: [0.2, 0.7],
  tip: [0.55, 1.7],
  rootHalf: 0.3,
  tipHalf: 0.24,
} as const;

function traceHand(ctx: Ctx, shape: HandShape, thumbSide: number): void {
  const half = HAND_WIDTH / 2;
  const l = HAND_LENGTH;
  const t = thumbSide;
  const outline = (table: readonly Share[]): Pt[] => placeShares(table, HAND_ORIGIN, l, half);
  switch (shape) {
    case 'fist':
    case 'pinch': {
      traceSmooth(ctx, outline(FIST_OUTLINE));
      if (shape === 'pinch') {
        ctx.moveTo(l * PINCH_KNOT.start[0], t * half * PINCH_KNOT.start[1]);
        traceEllipse(
          ctx,
          pt(l * PINCH_KNOT.centre[0], t * half * PINCH_KNOT.centre[1]),
          l * PINCH_KNOT.rx,
          half * PINCH_KNOT.ry,
        );
      }
      return;
    }
    case 'point': {
      traceSmooth(ctx, outline(POINTING_FIST_OUTLINE));
      const finger = POINTING_FINGER;
      ctx.moveTo(l * finger.root[0], -t * half * finger.root[1]);
      traceLimb(
        ctx,
        pt(l * finger.root[0], -t * half * finger.root[1]),
        pt(l * finger.tip[0], -t * half * finger.tip[1]),
        half * finger.rootHalf,
        half * finger.tipHalf,
      );
      return;
    }
    case 'open': {
      traceSmooth(ctx, outline(OPEN_HAND_OUTLINE));
      const thumb = OPEN_THUMB;
      ctx.moveTo(l * thumb.start[0], t * half * thumb.start[1]);
      traceLimb(
        ctx,
        pt(l * thumb.root[0], t * half * thumb.root[1]),
        pt(l * thumb.tip[0], t * half * thumb.tip[1]),
        half * thumb.rootHalf,
        half * thumb.tipHalf,
      );
      return;
    }
    case 'relaxed': {
      traceSmooth(ctx, outline(RELAXED_HAND_OUTLINE));
      return;
    }
  }
}

// ── Torso and coat ───────────────────────────────────────────────────────────

/**
 * The torso's depth either side of the spine in profile, at each node: the
 * chest is shallow, the paunch pushes the coat out at the waist, and the upper
 * back rounds out into the hump of the stoop.
 */
const NECK_FRONT = 0.07;
const NECK_BACK = 0.12;
const CHEST_FRONT = 0.14;
const CHEST_BACK = 0.155;
const WAIST_FRONT = 0.2;
const WAIST_BACK = 0.115;
const HIP_FRONT = 0.15;
const HIP_BACK = 0.16;
/** The coat hangs this far off the body before it falls plumb to the hem. */
const COAT_EASE = 0.02;
/** The hem clears the knee ahead and the calf behind by this much. */
const HEM_KNEE_CLEARANCE = 0.06;
/** How far back a full run streams the hem, and how far it lifts it. */
const FLARE_BACK = 0.34;
const FLARE_LIFT = 0.16;

/** A point `depth` off a spine node, forward (+) or back (−) of its link's direction. */
function offSpine(node: Pt, dir: Pt, depth: number): Pt {
  return add(node, scale(pt(-dir.y, dir.x), depth));
}

function sideCoat(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const { hip, waist, chest, neckBase, lowerDir, midDir, upperDir } = skel;
  const neckFront = offSpine(neckBase, upperDir, NECK_FRONT);
  const neckBack = offSpine(neckBase, upperDir, -NECK_BACK);
  const chestFront = offSpine(chest, midDir, CHEST_FRONT + COAT_EASE);
  const chestBack = offSpine(chest, upperDir, -CHEST_BACK - COAT_EASE);
  const waistFront = offSpine(waist, lowerDir, WAIST_FRONT + COAT_EASE);
  const waistBack = offSpine(waist, lowerDir, -WAIST_BACK - COAT_EASE);
  const hipBack = offSpine(hip, lowerDir, -HIP_BACK - COAT_EASE);
  const hipFront = offSpine(hip, lowerDir, HIP_FRONT);

  const knees = [skel.legs.left.joint, skel.legs.right.joint];
  const frontmostKnee = Math.max(...knees.map((k) => k.x));
  const backmostKnee = Math.min(...knees.map((k) => k.x));
  const flareBack = pose.flare * FLARE_BACK;
  const hemY = -HEM_HEIGHT;
  const hemLift = pose.flare * FLARE_LIFT;
  const hemFrontX =
    Math.max(waistFront.x, frontmostKnee + HEM_KNEE_CLEARANCE) +
    pose.hemSwing -
    flareBack * HEM_FRONT_FLARE_SHARE;
  const hemBackX =
    Math.min(hipBack.x - COAT_EASE, backmostKnee - HEM_KNEE_CLEARANCE) + pose.hemSwing - flareBack;
  const hemFront = pt(hemFrontX, hemY - hemLift * HEM_FRONT_LIFT_SHARE);
  const hemBack = pt(hemBackX, hemY - hemLift);
  const hemMid = pt(
    lerp(hemBackX, hemFrontX, MIDWAY),
    hemY - hemLift * HEM_MID_LIFT_SHARE + HEM_SAG,
  );

  const outline: Pt[] = [
    neckBack,
    chestBack,
    waistBack,
    hipBack,
    lerpPt(hipBack, hemBack, COAT_BACK_FALL_SHARE),
    hemBack,
    hemMid,
    hemFront,
    lerpPt(waistFront, hemFront, COAT_FRONT_FALL_SHARE),
    waistFront,
    chestFront,
    neckFront,
  ];
  const trace = (ctx: Ctx): void => traceSmooth(ctx, outline);
  const top = neckBase;
  const bottom = pt(hip.x, hemY);
  const coat = bandedPart(trace, top, bottom, Math.abs(hemFrontX - hemBackX) / 2, COAT);
  const details: Part = {
    trace: () => undefined,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          // The front edge of the coat, where it overlaps itself over his belly.
          strokeLine(
            ctx,
            chestFront,
            add(lerpPt(waistFront, hemFront, MIDWAY), pt(-COAT_FRONT_INSET, 0)),
            FOLD_WIDTH,
            COAT.shadow,
          );
          strokeLine(
            ctx,
            lerpPt(hipBack, hipFront, SIDE_FOLD_ROOT_SHARE),
            lerpPt(hemBack, hemMid, SIDE_FOLD_HEM_SHARE),
            FOLD_WIDTH,
            COAT.shadow,
          );
          const pocketTop = lerpPt(hipBack, hipFront, SIDE_POCKET_SHARE);
          const pocket = add(pocketTop, pt(0, POCKET_DROP));
          ctx.beginPath();
          ctx.rect(
            pocket.x - POCKET_HALF,
            pocket.y - POCKET_HALF * POCKET_MOUTH_SHARE,
            POCKET_HALF * 2,
            POCKET_HALF * POCKET_DEPTH_SHARE,
          );
          ctx.strokeStyle = COAT.shadow;
          ctx.lineWidth = SEAM_WIDTH;
          ctx.stroke();
          paintStain(
            ctx,
            add(lerpPt(waistBack, waistFront, SIDE_STAIN_SHARE), pt(0, STAIN_DROP)),
            STAIN_SIZE,
            STAIN_YELLOW,
          );
          paintStain(
            ctx,
            lerpPt(hemMid, hemFront, SIDE_HEM_STAIN_SHARE),
            STAIN_SIZE * SMALL_STAIN_SHARE,
            STAIN_BROWN,
          );
        },
      );
      const collarOutline: Pt[] = [
        add(neckBack, pt(0, COLLAR_RISE)),
        add(neckBack, pt(COLLAR_DEPTH * COLLAR_BACK_ROLL_SHARE, -COLLAR_RISE)),
        add(
          neckFront,
          pt(-COLLAR_DEPTH * COLLAR_FRONT_ROLL_SHARE, -COLLAR_RISE * COLLAR_FRONT_RISE_SHARE),
        ),
        add(neckFront, pt(COLLAR_DEPTH * COLLAR_FRONT_ROLL_SHARE, COLLAR_DEPTH)),
        add(lerpPt(neckBack, neckFront, MIDWAY), pt(0, COLLAR_DEPTH)),
      ];
      ctx.beginPath();
      traceSmooth(ctx, collarOutline);
      ctx.fillStyle = COAT.light;
      ctx.fill();
      strokeLine(
        ctx,
        add(neckFront, pt(0, COLLAR_DEPTH)),
        lerpPt(chestFront, waistFront, PLACKET_END_SHARE),
        SEAM_WIDTH,
        COAT.shadow,
      );
      const pocketAt = lerpPt(chest, chestFront, SIDE_PEN_POCKET_SHARE);
      PEN_COLOURS.forEach((colour, i) => {
        const x = pocketAt.x - PEN_SPACING * i * PROFILE_PEN_SPACING_SHARE;
        strokeLine(ctx, pt(x, pocketAt.y), pt(x, pocketAt.y - PEN_RISE), PEN_WIDTH, colour);
      });
    },
  };
  return [coat, details];
}

/** The hem's middle sits a touch lower than its two ends, as cloth does. */
const HEM_SAG = 0.02;
const COAT_FRONT_INSET = 0.03;
const FOLD_WIDTH = 0.022;
const SEAM_WIDTH = 0.016;
const POCKET_HALF = 0.06;
const POCKET_DROP = 0.06;
const STAIN_SIZE = 0.05;
const STAIN_DROP = 0.04;
const COLLAR_RISE = 0.05;
const COLLAR_DEPTH = 0.06;
const PEN_SPACING = 0.035;
const PEN_RISE = 0.055;
const PEN_WIDTH = 0.026;
/** In profile the front of the hem streams back half as far as its back, and lifts less. */
const HEM_FRONT_FLARE_SHARE = 0.5;
const HEM_FRONT_LIFT_SHARE = 0.4;
const HEM_MID_LIFT_SHARE = 0.55;
/** Where the coat's back and front edges break from the body to fall to the hem. */
const COAT_BACK_FALL_SHARE = 0.55;
const COAT_FRONT_FALL_SHARE = 0.45;
const SIDE_FOLD_ROOT_SHARE = 0.35;
const SIDE_FOLD_HEM_SHARE = 0.55;
const SIDE_POCKET_SHARE = 0.42;
const POCKET_MOUTH_SHARE = 0.4;
const POCKET_DEPTH_SHARE = 1.4;
const SIDE_STAIN_SHARE = 0.62;
const SIDE_HEM_STAIN_SHARE = 0.3;
const SMALL_STAIN_SHARE = 0.7;
const COLLAR_BACK_ROLL_SHARE = 0.3;
const COLLAR_FRONT_ROLL_SHARE = 0.2;
const COLLAR_FRONT_RISE_SHARE = 0.4;
const PLACKET_END_SHARE = 0.3;
const SIDE_PEN_POCKET_SHARE = 0.72;
/** In profile the pens overlap, foreshortened to half their spacing head-on. */
const PROFILE_PEN_SPACING_SHARE = 0.5;

/** An irregular blot, deterministic in its own position so every frame paints the same one. */
function paintStain(ctx: Ctx, c: Pt, size: number, colour: string): void {
  ctx.beginPath();
  traceSmooth(ctx, placeShares(STAIN_OUTLINE, c, size, size));
  ctx.fillStyle = rgba(colour, STAIN_ALPHA);
  ctx.fill();
}

const STAIN_ALPHA = 0.7;
/** The blot's outline, in shares of its size. */
const STAIN_OUTLINE: readonly Share[] = [
  [-1, -0.3],
  [-0.2, -0.7],
  [0.8, -0.45],
  [0.6, 0.5],
  [-0.4, 0.6],
];

/**
 * Head-on half-widths of the coat at each node. Narrow sloping shoulders, a
 * shallow chest, the paunch pushing it out at the waist, and the skirt
 * falling away in an A from the hips — the shoulders are never the widest
 * thing on him, which is the opposite of Carl's V.
 */
const FACING_COLLAR_HALF = 0.1;
const FACING_SHOULDER_HALF = 0.205;
const FACING_CHEST_HALF = 0.21;
const FACING_WAIST_HALF = 0.225;
const FACING_HIP_HALF = 0.225;
const FACING_HEM_HALF = 0.335;
const FLARE_FACING_WIDEN = 0.12;
/** How much of a foot's lead and lift reaches the hem corner above it, head-on. */
const HEM_KNEE_PUSH = 0.18;
const HEM_LIFT_SHARE = 0.6;
/** Head-on a run's flare shows mostly as width, so the hem lifts less than it does in profile. */
const FACING_FLARE_LIFT_SHARE = 0.4;

function facingCoatOutline(
  skel: ScientistSkeleton,
  pose: ScientistPose,
): {
  outline: Pt[];
  hemY: number;
  hemHalf: number;
  centre: number;
} {
  const { hip, waist, chest, neckBase } = skel;
  const centre = hip.x;
  const hemY = -HEM_HEIGHT - pose.flare * FLARE_LIFT * FACING_FLARE_LIFT_SHARE;
  const swing = pose.hemSwing;
  const hemHalf = FACING_HEM_HALF + pose.flare * FLARE_FACING_WIDEN;
  /** The hem corner over a stepping leg rides up on its knee. */
  const hemLift = (screen: number): number => {
    const side = SIDES.find((s) => screenSide(skel.view, s) === screen) ?? 'left';
    const foot = pose.feet[side];
    return (
      Math.max(0, foot.ahead) * HEM_KNEE_PUSH +
      Math.max(0, foot.height - ANKLE_HEIGHT) * HEM_LIFT_SHARE
    );
  };
  const shoulderY = neckBase.y + SHOULDER_SLOPE - pose.shrug * SHRUG_LIFT;
  const nx = neckBase.x;
  const outline: Pt[] = [
    pt(nx - FACING_COLLAR_HALF, neckBase.y),
    pt(nx - FACING_SHOULDER_HALF, shoulderY),
    pt(nx - FACING_SHOULDER_HALF, shoulderY),
    pt(chest.x - FACING_CHEST_HALF, chest.y),
    pt(waist.x - FACING_WAIST_HALF, waist.y),
    pt(centre - FACING_HIP_HALF, hip.y),
    pt(centre + swing - hemHalf, hemY - hemLift(-1)),
    pt(centre + swing - hemHalf, hemY - hemLift(-1)),
    pt(centre + swing, hemY + HEM_SAG),
    pt(centre + swing + hemHalf, hemY - hemLift(1)),
    pt(centre + swing + hemHalf, hemY - hemLift(1)),
    pt(centre + FACING_HIP_HALF, hip.y),
    pt(waist.x + FACING_WAIST_HALF, waist.y),
    pt(chest.x + FACING_CHEST_HALF, chest.y),
    pt(nx + FACING_SHOULDER_HALF, shoulderY),
    pt(nx + FACING_SHOULDER_HALF, shoulderY),
    pt(nx + FACING_COLLAR_HALF, neckBase.y),
  ];
  return { outline, hemY, hemHalf, centre };
}

/**
 * The outline is smoothed, but its shoulder points and hem corners are listed
 * twice: a repeated point pins the curve to a corner there, and a coat with
 * rounded hem corners reads as a sleeping bag.
 */
function traceCoatFacing(ctx: Ctx, outline: readonly Pt[]): void {
  traceSmooth(ctx, outline);
}

function frontCoat(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const { outline, hemY, hemHalf, centre } = facingCoatOutline(skel, pose);
  const trace = (ctx: Ctx): void => traceCoatFacing(ctx, outline);
  const coat = bandedPart(trace, pt(centre, skel.neckBase.y), pt(centre, hemY), hemHalf, COAT);
  const { neckBase, chest, waist } = skel;
  const vBottom = lerpPt(chest, waist, V_DEPTH);
  // His left breast is on the viewer's right head-on.
  const pocketSide = screenSide('front', 'left');
  const details: Part = {
    trace: () => undefined,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          const shirt: Pt[] = [
            pt(neckBase.x - FACING_COLLAR_HALF * SHIRT_COLLAR_SHARE, neckBase.y - COLLAR_RISE),
            pt(neckBase.x + FACING_COLLAR_HALF * SHIRT_COLLAR_SHARE, neckBase.y - COLLAR_RISE),
            vBottom,
          ];
          ctx.beginPath();
          tracePolygon(ctx, shirt);
          ctx.fillStyle = SHIRT.base;
          ctx.fill();
          const tieTop = pt(neckBase.x, neckBase.y);
          ctx.beginPath();
          tracePolygon(ctx, [
            pt(tieTop.x - TIE_HALF, tieTop.y),
            pt(tieTop.x + TIE_HALF, tieTop.y),
            pt(vBottom.x + TIE_HALF * TIE_BLADE_SHARE, vBottom.y - TIE_HALF),
            pt(vBottom.x, vBottom.y + TIE_HALF),
            pt(vBottom.x - TIE_HALF * TIE_BLADE_SHARE, vBottom.y - TIE_HALF),
          ]);
          ctx.fillStyle = TIE.base;
          ctx.fill();
          for (const s of [-1, 1]) {
            strokeLine(
              ctx,
              pt(neckBase.x + s * FACING_COLLAR_HALF * LAPEL_ROOT_SHARE, neckBase.y - COLLAR_RISE),
              vBottom,
              LAPEL_WIDTH,
              COAT.shadow,
            );
          }
          const closureTop = vBottom;
          const parting = pt(
            lerp(waist.x, centre, MIDWAY),
            lerp(waist.y, skel.hip.y, PARTING_DROP_SHARE),
          );
          strokeLine(ctx, closureTop, parting, SEAM_WIDTH, COAT.shadow);
          for (let i = 0; i < BUTTONS; i++) {
            const at = lerpPt(closureTop, parting, (i + BUTTON_SLOT_CENTRE) / BUTTONS);
            fillEllipse(ctx, add(at, pt(BUTTON_OFFSET, 0)), BUTTON_RADIUS, BUTTON_RADIUS, BUTTON);
          }
          const hemCentre = pt(centre + pose.hemSwing, hemY + HEM_SAG);
          ctx.beginPath();
          tracePolygon(ctx, [
            parting,
            add(hemCentre, pt(SKIRT_PARTING_HALF, PARTING_OVERRUN)),
            add(hemCentre, pt(-SKIRT_PARTING_HALF, PARTING_OVERRUN)),
          ]);
          ctx.fillStyle = TROUSERS.shadow;
          ctx.fill();
          strokeLine(
            ctx,
            parting,
            add(hemCentre, pt(-SKIRT_PARTING_HALF, 0)),
            SEAM_WIDTH,
            COAT.shadow,
          );
          for (const s of [-1, 1]) {
            const at = pt(
              centre + s * FACING_HIP_HALF * HIP_POCKET_SHARE,
              skel.hip.y + POCKET_DROP,
            );
            strokeLine(
              ctx,
              add(at, pt(-POCKET_HALF * HIP_POCKET_MOUTH_SHARE, 0)),
              add(at, pt(POCKET_HALF * HIP_POCKET_MOUTH_SHARE, 0)),
              POCKET_SEAM_WIDTH,
              COAT.shadow,
            );
          }
          const pocket = pt(
            chest.x + pocketSide * FACING_CHEST_HALF * BREAST_POCKET_SHARE,
            chest.y + BREAST_POCKET_DROP,
          );
          strokeLine(
            ctx,
            add(pocket, pt(-POCKET_HALF * BREAST_POCKET_MOUTH_SHARE, 0)),
            add(pocket, pt(POCKET_HALF * BREAST_POCKET_MOUTH_SHARE, 0)),
            POCKET_SEAM_WIDTH,
            COAT.shadow,
          );
          PEN_COLOURS.forEach((colour, i) => {
            const x = pocket.x + (i - 1) * PEN_SPACING;
            strokeLine(ctx, pt(x, pocket.y), pt(x, pocket.y - PEN_RISE), PEN_WIDTH, colour);
          });
          paintStain(
            ctx,
            pt(
              centre - pocketSide * FACING_WAIST_HALF * FRONT_STAIN_SHARE,
              waist.y + STAIN_DROP * FRONT_STAIN_DROPS,
            ),
            STAIN_SIZE,
            STAIN_YELLOW,
          );
          paintStain(
            ctx,
            pt(
              centre + pocketSide * FACING_HEM_HALF * HEM_STAIN_SHARE,
              hemY - STAIN_SIZE * HEM_STAIN_RISE,
            ),
            STAIN_SIZE * SMALL_STAIN_SHARE,
            STAIN_BROWN,
          );
        },
      );
      // The lanyard round his neck and the badge it carries, hanging plumb
      // from the stoop rather than lying on his chest.
      const badge = pt(
        neckBase.x - pocketSide * BADGE_OFFSET + pose.badgeSwing,
        vBottom.y + BADGE_DROP,
      );
      for (const s of [-1, 1]) {
        strokeLine(
          ctx,
          pt(
            neckBase.x + s * FACING_COLLAR_HALF * LANYARD_ROOT_SHARE,
            neckBase.y - COLLAR_RISE * LANYARD_ROOT_RISE_SHARE,
          ),
          add(badge, pt(s * BADGE_HALF * LANYARD_CLIP_SHARE, -BADGE_HALF)),
          LANYARD_WIDTH,
          LANYARD,
        );
      }
      paintBadge(ctx, badge);
    },
  };
  return [coat, details];
}

const V_DEPTH = 0.15;
const TIE_HALF = 0.024;
const LAPEL_WIDTH = 0.02;
const BUTTONS = 3;
const BUTTON_RADIUS = 0.016;
const BUTTON_OFFSET = 0.018;
const SKIRT_PARTING_HALF = 0.07;
/** The parting runs past the hem so no sliver of coat closes it off. */
const PARTING_OVERRUN = 0.04;
const BREAST_POCKET_DROP = 0.03;
const BADGE_OFFSET = 0.02;
const BADGE_DROP = 0.07;
const BADGE_HALF = 0.05;
const LANYARD_WIDTH = 0.016;
const SHIRT_COLLAR_SHARE = 0.9;
/** The tie's blade flares a little wider than its knot. */
const TIE_BLADE_SHARE = 1.2;
const LAPEL_ROOT_SHARE = 1.1;
const PARTING_DROP_SHARE = 0.6;
/** Each button sits in the middle of its share of the closure. */
const BUTTON_SLOT_CENTRE = 0.5;
const HIP_POCKET_SHARE = 0.55;
const HIP_POCKET_MOUTH_SHARE = 0.8;
const BREAST_POCKET_SHARE = 0.52;
const BREAST_POCKET_MOUTH_SHARE = 0.75;
const POCKET_SEAM_SHARE = 1.4;
const POCKET_SEAM_WIDTH = SEAM_WIDTH * POCKET_SEAM_SHARE;
const FRONT_STAIN_SHARE = 0.45;
const FRONT_STAIN_DROPS = 2;
const HEM_STAIN_SHARE = 0.5;
/** The hem's stain sits this many stain sizes above the hem. */
const HEM_STAIN_RISE = 2;
const LANYARD_ROOT_SHARE = 0.7;
const LANYARD_ROOT_RISE_SHARE = 0.5;
const LANYARD_CLIP_SHARE = 0.4;
/** The badge card's half-width, its width and its coloured band, as shares of its half-height. */
const BADGE_HALF_WIDTH_SHARE = 0.7;
const BADGE_WIDTH_SHARE = 1.4;
const BADGE_BAND_SHARE = 0.7;

function paintBadge(ctx: Ctx, c: Pt): void {
  ctx.beginPath();
  ctx.rect(
    c.x - BADGE_HALF * BADGE_HALF_WIDTH_SHARE,
    c.y - BADGE_HALF,
    BADGE_HALF * BADGE_WIDTH_SHARE,
    BADGE_HALF * 2,
  );
  ctx.fillStyle = BADGE;
  ctx.fill();
  ctx.beginPath();
  ctx.rect(
    c.x - BADGE_HALF * BADGE_HALF_WIDTH_SHARE,
    c.y - BADGE_HALF,
    BADGE_HALF * BADGE_WIDTH_SHARE,
    BADGE_HALF * BADGE_BAND_SHARE,
  );
  ctx.fillStyle = BADGE_BAND;
  ctx.fill();
}

function backCoat(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const { outline, hemY, hemHalf, centre } = facingCoatOutline(skel, pose);
  const hump = humpOutline(skel);
  const trace = (ctx: Ctx): void => {
    traceCoatFacing(ctx, outline);
    traceSmooth(ctx, hump);
  };
  const coat = bandedPart(trace, pt(centre, skel.neckBase.y), pt(centre, hemY), hemHalf, COAT);
  const details: Part = {
    trace: () => undefined,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          const hemCentre = pt(centre + pose.hemSwing, hemY + HEM_SAG);
          const seamTop = pt(skel.neckBase.x, skel.neckBase.y);
          const ventTop = pt(
            lerp(skel.hip.x, hemCentre.x, VENT_TOP_SHARE),
            lerp(skel.hip.y, hemY, VENT_TOP_SHARE),
          );
          strokeLine(ctx, seamTop, ventTop, SEAM_WIDTH, COAT.shadow);
          ctx.beginPath();
          tracePolygon(ctx, [
            ventTop,
            add(hemCentre, pt(VENT_HALF, PARTING_OVERRUN)),
            add(hemCentre, pt(-VENT_HALF * VENT_LAP_SHARE, PARTING_OVERRUN)),
          ]);
          ctx.fillStyle = COAT.shadow;
          ctx.fill();
          const beltY = lerp(skel.waist.y, skel.hip.y, BELT_DROP_SHARE);
          ctx.beginPath();
          ctx.rect(centre - BELT_HALF, beltY - BELT_HEIGHT / 2, BELT_HALF * 2, BELT_HEIGHT);
          ctx.fillStyle = COAT.light;
          ctx.fill();
          strokeLine(
            ctx,
            pt(centre - BELT_HALF, beltY + BELT_HEIGHT / 2),
            pt(centre + BELT_HALF, beltY + BELT_HEIGHT / 2),
            SEAM_WIDTH,
            COAT.shadow,
          );
          // The upper back rounding over into the stoop: shadowed below its crest.
          const crest = humpCrest(skel);
          fillEllipse(
            ctx,
            pt(crest.x, crest.y + HUMP_SHADE_DROP),
            FACING_SHOULDER_HALF * HUMP_SHADE_WIDTH_SHARE,
            HUMP_SHADE_RY,
            rgba(COAT.shadow, HUMP_SHADE_ALPHA),
          );
          paintStain(
            ctx,
            pt(
              centre + FACING_HIP_HALF * BACK_STAIN_SHARE,
              skel.hip.y + STAIN_DROP * BACK_STAIN_DROPS,
            ),
            STAIN_SIZE * BACK_STAIN_SIZE_SHARE,
            STAIN_YELLOW,
          );
        },
      );
    },
  };
  return [coat, details];
}

const VENT_HALF = 0.05;
const BELT_HALF = 0.13;
const BELT_HEIGHT = 0.045;
const HUMP_SHADE_DROP = 0.13;
const HUMP_SHADE_RY = 0.05;
const HUMP_SHADE_ALPHA = 0.55;
const HUMP_SHADE_WIDTH_SHARE = 0.85;
/** The back vent opens this share of the way from the hip to the hem, its far edge lapped over. */
const VENT_TOP_SHARE = 0.4;
const VENT_LAP_SHARE = 0.3;
const BELT_DROP_SHARE = 0.3;
const BACK_STAIN_SHARE = 0.5;
const BACK_STAIN_DROPS = 3;
const BACK_STAIN_SIZE_SHARE = 0.8;

/**
 * The crest of the upper back: the highest point of the stoop, behind the
 * neck. Laid off the same spine geometry the profile draws, so head-on and
 * from behind the hump stands exactly as high as it does side-on.
 */
function humpCrest(skel: ScientistSkeleton): Pt {
  const upperAngle = Math.atan2(skel.upperDir.x, -skel.upperDir.y);
  const profileUp = upAt(upperAngle);
  const backPoint = add(skel.neckBase, scale(pt(-profileUp.y, profileUp.x), -NECK_BACK));
  return pt(skel.neckBase.x, Math.min(backPoint.y, skel.neckBase.y) - HUMP_COAT_EASE);
}

const HUMP_COAT_EASE = 0.025;
const HUMP_HALF = 0.2;
/** The hump's foot sits partway down the shoulders' slope; its shoulders round over a quarter of the way down. */
const HUMP_BASE_SLOPE_SHARE = 0.6;
const HUMP_SHOULDER_SHARE = 0.7;
const HUMP_SHOULDER_DROP_SHARE = 0.25;

function humpOutline(skel: ScientistSkeleton): Pt[] {
  const crest = humpCrest(skel);
  const base = skel.neckBase.y + SHOULDER_SLOPE * HUMP_BASE_SLOPE_SHARE;
  const shoulderY = crest.y + (base - crest.y) * HUMP_SHOULDER_DROP_SHARE;
  return [
    pt(crest.x - HUMP_HALF, base),
    pt(crest.x - HUMP_HALF * HUMP_SHOULDER_SHARE, shoulderY),
    pt(crest.x, crest.y),
    pt(crest.x + HUMP_HALF * HUMP_SHOULDER_SHARE, shoulderY),
    pt(crest.x + HUMP_HALF, base),
  ];
}

/** Head-on, the hump shows over his shoulders behind the dropped head. */
function frontHump(skel: ScientistSkeleton): Part {
  const outline = humpOutline(skel);
  const trace = (ctx: Ctx): void => traceSmooth(ctx, outline);
  return flatPart(trace, COAT.shadow);
}

// ── Head ─────────────────────────────────────────────────────────────────────

const LENS_RADIUS = 0.068;
const LENS_SPACING = 0.1;
const LENS_Y = 0.005;
const FRAME_WIDTH = 0.02;
const FRAME_HALF_WIDTH = FRAME_WIDTH / 2;
const PUPIL_RADIUS = 0.031;
const PUPIL_TRAVEL = 0.026;
const GLINT_RADIUS = 0.017;
const BROW_Y = -0.085;
const BROW_HALF = 0.045;
const BROW_THICK = 0.026;
const BROW_WORRY_LIFT = 0.03;
const NOSE_TIP_Y = 0.115;
const NOSE_HALF = 0.024;
const MOUTH_Y = 0.15;
const MOUTH_HALF = 0.035;
const EAR_Y = 0.02;
const EAR_RX = 0.035;
const EAR_RY = 0.055;
/** Close-cropped: the coils stand barely off the skull. */
const TUFT_REACH = 0.065;
/** How far a full head turn slides the face across the skull. */
const FACE_TURN_TRAVEL = 0.05;
const DOME_SHINE_ALPHA = 0.9;
/** The skull's own shadow, slid off it by this share of its half-width. */
const SKULL_SHADE_SHARE = 0.7;
/** The ears sit just inside the skull's widest point. */
const EAR_SET_SHARE = 0.98;
const EAR_SHADE_SHARE = 0.6;

/** A highlight on the bald dome: its centre and radii in head radii, and its tilt in radians. */
interface DomeShine {
  readonly at: Share;
  readonly rx: number;
  readonly ry: number;
  readonly tilt: number;
}

/** The skull head-on and from behind, in head radii. */
const HEAD_FRONT_OUTLINE: readonly Share[] = [
  [0, -1.02],
  [0.95, -0.72],
  [1.02, 0.1],
  [0.78, 0.72],
  [0.3, 1.04],
  [-0.3, 1.04],
  [-0.78, 0.72],
  [-1.02, 0.1],
  [-0.95, -0.72],
];

function headFrontOutline(c: Pt): Pt[] {
  return placeShares(HEAD_FRONT_OUTLINE, c, HEAD_RX, HEAD_RY);
}

/** Where a tuft roots on the skull, in head radii: above and below the ear. */
const TUFT_ROOT_UPPER: Share = [0.88, -0.4];
const TUFT_ROOT_LOWER: Share = [0.95, 0.24];
/** The tuft's broken outer edge: shares of its reach past the skull, and heights in head radii. */
const TUFT_OUTER_EDGE: readonly Share[] = [
  [0.5, -0.42],
  [1, -0.3],
  [0.7, -0.16],
  [1, -0.02],
  [0.7, 0.1],
  [0.9, 0.2],
];

/** The ring of short grey coils above and behind each ear, its edge scalloped by the coils. */
function tuftOutline(c: Pt, side: number, reach: number): Pt[] {
  const x = (k: number): number => c.x + side * k;
  const root = (share: Share): Pt => pt(x(HEAD_RX * share[0]), c.y + HEAD_RY * share[1]);
  return [
    root(TUFT_ROOT_UPPER),
    ...TUFT_OUTER_EDGE.map(([out, y]) => pt(x(HEAD_RX + reach * out), c.y + HEAD_RY * y)),
    root(TUFT_ROOT_LOWER),
  ];
}

function headFront(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const turn = pose.headTurn;
  const pitchDrop = Math.sin(pose.headPitch - REST_HEAD_PITCH) * HEAD_RY * HEAD_PITCH_DROP_SHARE;
  const c = skel.head;
  const face = pt(c.x + turn * FACE_TURN_TRAVEL, c.y + pitchDrop);
  const outline = headFrontOutline(c);
  const traceSkull = (ctx: Ctx): void => traceSmooth(ctx, outline);
  const parts: Part[] = [];
  parts.push({
    trace: traceSkull,
    paint: (ctx) => {
      ctx.beginPath();
      traceSkull(ctx);
      ctx.fillStyle = SKIN.base;
      ctx.fill();
      shadeOffset(ctx, () => traceSkull(ctx), HEAD_RX * SKULL_SHADE_SHARE, SKIN.shadow);
      paintDomeShine(ctx, c, FRONT_DOME_SHINE);
      paintFace(ctx, face, pose, traceSkull);
    },
  });
  for (const s of [-1, 1]) {
    const reach = TUFT_REACH * (1 - turn * s * TUFT_TURN_SHARE);
    const outlineTuft = tuftOutline(pt(c.x, c.y + pitchDrop * TUFT_PITCH_FOLLOW), s, reach);
    parts.push(hairPart((ctx) => traceSmooth(ctx, outlineTuft), outlineTuft));
  }
  for (const s of [-1, 1]) {
    const ear = pt(
      c.x + s * (HEAD_RX * FRONT_EAR_SET_SHARE - turn * s * EAR_TURN_TUCK),
      c.y + EAR_Y + pitchDrop * EAR_PITCH_FOLLOW,
    );
    parts.push(flatPartShaded((ctx) => traceEllipse(ctx, ear, EAR_RX, EAR_RY), SKIN));
  }
  return parts;
}

/**
 * Head-on the ears sit over the ring of hair, a little proud of the skull:
 * with the lenses across his face they are most of the skin that shows.
 */
const FRONT_EAR_SET_SHARE = 1.04;
const EAR_TURN_TUCK = 0.03;
const TUFT_TURN_SHARE = 0.35;
/** How far a nod moves the face down the skull, and how much of that the ears and tufts follow. */
const HEAD_PITCH_DROP_SHARE = 0.5;
const EAR_PITCH_FOLLOW = 0.5;
const TUFT_PITCH_FOLLOW = 0.3;
const FRONT_DOME_SHINE: DomeShine = { at: [-0.3, -0.68], rx: 0.3, ry: 0.13, tilt: -0.4 };
const BACK_DOME_SHINE: DomeShine = { at: [-0.28, -0.62], rx: 0.32, ry: 0.14, tilt: -0.3 };

function paintDomeShine(ctx: Ctx, c: Pt, shine: DomeShine): void {
  fillEllipse(
    ctx,
    placeShare([shine.at[0] * SHEEN_CENTRE_SHARE, shine.at[1]], c, HEAD_RX, HEAD_RY),
    HEAD_RX * shine.rx * SHEEN_SCALE,
    HEAD_RY * shine.ry * SHEEN_SCALE,
    rgba(SKIN_SHEEN, SHEEN_ALPHA),
    shine.tilt,
  );
  fillEllipse(
    ctx,
    placeShare(shine.at, c, HEAD_RX, HEAD_RY),
    HEAD_RX * shine.rx,
    HEAD_RY * shine.ry,
    rgba(SKIN_SHINE, DOME_SHINE_ALPHA),
    shine.tilt,
  );
}

function flatPartShaded(trace: (ctx: Ctx) => void, ramp: Ramp): Part {
  return {
    trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = ramp.base;
      ctx.fill();
      shadeOffset(ctx, () => trace(ctx), EAR_RX * EAR_SHADE_SHARE, ramp.shadow);
    },
  };
}

function hairPart(trace: (ctx: Ctx) => void, outline: readonly Pt[]): Part {
  const ys = outline.map((p) => p.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const xs = outline.map((p) => p.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  return {
    trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = bandedGradient(ctx, pt(mid, top), pt(mid, bottom), HAIR);
      ctx.fill();
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => paintCoils(ctx, Math.min(...xs), top, Math.max(...xs), bottom),
      );
    },
  };
}

/** Tight coils: a staggered grid of small dark knots, each with a lit fleck up and left of it. */
const COIL_SPACING = 0.028;
const COIL_RADIUS = 0.011;
const COIL_FLECK_RADIUS = 0.006;
const COIL_FLECK_OFFSET = 0.008;

function paintCoils(ctx: Ctx, left: number, top: number, right: number, bottom: number): void {
  const knots: Pt[] = [];
  for (let row = 0, y = top; y <= bottom + COIL_SPACING; row++, y += COIL_SPACING) {
    const stagger = row % 2 === 0 ? 0 : COIL_SPACING / 2;
    for (let x = left - stagger; x <= right + COIL_SPACING; x += COIL_SPACING) knots.push(pt(x, y));
  }
  ctx.beginPath();
  for (const k of knots) {
    ctx.moveTo(k.x + COIL_RADIUS, k.y);
    ctx.arc(k.x, k.y, COIL_RADIUS, 0, Math.PI * 2);
  }
  ctx.fillStyle = HAIR.shadow;
  ctx.fill();
  ctx.beginPath();
  for (const k of knots) {
    const fleck = add(k, pt(-COIL_FLECK_OFFSET, -COIL_FLECK_OFFSET));
    ctx.moveTo(fleck.x + COIL_FLECK_RADIUS, fleck.y);
    ctx.arc(fleck.x, fleck.y, COIL_FLECK_RADIUS, 0, Math.PI * 2);
  }
  ctx.fillStyle = HAIR.light;
  ctx.fill();
}

/**
 * The face, head-on: brows, glasses, nose, stubble and mouth, all clipped to
 * the skull. The glasses carry it. Two bright discs, each three pixels across
 * at the tile, with a dark pupil and a glint, are the eyes; everything else is
 * one or two pixels of value and only has to not fight them.
 */
function paintFace(ctx: Ctx, face: Pt, pose: ScientistPose, traceSkull: (ctx: Ctx) => void): void {
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceSkull(ctx);
    },
    () => {
      ctx.beginPath();
      traceSmooth(ctx, placeShares(FRONT_STUBBLE_OUTLINE, face, HEAD_RX, HEAD_RY));
      ctx.fillStyle = rgba(STUBBLE, STUBBLE_ALPHA);
      ctx.fill();
      const bridge = pt(face.x, face.y + LENS_Y);
      const tip = pt(face.x + pose.headTurn * NOSE_TURN_LEAD, face.y + NOSE_TIP_Y);
      ctx.beginPath();
      traceSmooth(ctx, [
        ...placeShares(FRONT_NOSE_BRIDGE, bridge, NOSE_HALF, NOSE_HALF),
        ...placeShares(FRONT_NOSE_TIP, tip, NOSE_HALF, NOSE_HALF),
      ]);
      ctx.fillStyle = SKIN.light;
      ctx.fill();
      strokeLine(
        ctx,
        placeShare(FRONT_NOSE_SHADE_FROM, bridge, NOSE_HALF, NOSE_HALF),
        placeShare(FRONT_NOSE_SHADE_TO, tip, NOSE_HALF, NOSE_HALF),
        NOSE_SHADE_WIDTH,
        SKIN.shadow,
      );
      fillEllipse(
        ctx,
        pt(tip.x, tip.y + NOSE_HALF * FRONT_NOSTRIL.drop),
        NOSE_HALF * FRONT_NOSTRIL.rx,
        NOSE_HALF * FRONT_NOSTRIL.ry,
        SKIN.deep,
      );
      const mouth = pt(
        face.x + pose.headTurn * NOSE_TURN_LEAD * MOUTH_TURN_LEAD_SHARE,
        face.y + MOUTH_Y,
      );
      if (pose.mouth > MOUTH_OPEN_AT) {
        fillEllipse(
          ctx,
          mouth,
          MOUTH_HALF * lerp(OPEN_MOUTH_NARROWEST, OPEN_MOUTH_WIDEST, pose.mouth),
          MOUTH_HALF * pose.mouth * OPEN_MOUTH_HEIGHT_SHARE,
          INK,
        );
      } else {
        strokeLine(
          ctx,
          pt(mouth.x - MOUTH_HALF, mouth.y),
          pt(mouth.x + MOUTH_HALF, mouth.y + MOUTH_FROWN),
          MOUTH_LINE,
          SKIN.deep,
        );
      }
    },
  );
  // The glasses stand off the face, so they are not clipped to it.
  for (const s of [-1, 1]) {
    const lens = pt(face.x + s * LENS_SPACING, face.y + LENS_Y);
    paintLens(ctx, lens, LENS_RADIUS, LENS_RADIUS, pose);
    const inner = pt(
      lens.x - s * BROW_HALF * BROW_INNER_SHARE,
      face.y + BROW_Y - pose.worry * BROW_WORRY_LIFT,
    );
    const outer = pt(lens.x + s * BROW_HALF * BROW_OUTER_SHARE, face.y + BROW_Y + BROW_DROOP);
    ctx.beginPath();
    traceLimb(
      ctx,
      inner,
      outer,
      BROW_THICK * BROW_INNER_THICK_SHARE,
      BROW_THICK * BROW_OUTER_THICK_SHARE,
    );
    ctx.fillStyle = HAIR.base;
    ctx.fill();
  }
  strokeLine(
    ctx,
    pt(face.x - LENS_SPACING + LENS_RADIUS, face.y + LENS_Y),
    pt(face.x + LENS_SPACING - LENS_RADIUS, face.y + LENS_Y),
    FRAME_WIDTH,
    FRAME_RIM,
  );
}

const STUBBLE_ALPHA = 0.4;
const NOSE_TURN_LEAD = 0.035;
const NOSE_SHADE_WIDTH = 0.014;
const MOUTH_OPEN_AT = 0.15;
const MOUTH_FROWN = 0.012;
const MOUTH_LINE = 0.016;
const BROW_DROOP = 0.01;
/** The stubbled jaw head-on, in head radii off the face's centre. */
const FRONT_STUBBLE_OUTLINE: readonly Share[] = [
  [-0.95, 0.2],
  [-0.4, 0.45],
  [0, 0.55],
  [0.4, 0.45],
  [0.95, 0.2],
  [1, 1.2],
  [-1, 1.2],
];
/** The nose head-on, in nose half-widths: across the bridge, then round the tip. */
const FRONT_NOSE_BRIDGE: readonly Share[] = [
  [-0.5, 0],
  [0.5, 0],
];
const FRONT_NOSE_TIP: readonly Share[] = [
  [1, -0.6],
  [0.4, 0.7],
  [-0.6, 0.6],
  [-0.9, -0.6],
];
const FRONT_NOSE_SHADE_FROM: Share = [0.3, 1];
const FRONT_NOSE_SHADE_TO: Share = [0.8, -0.3];
const FRONT_NOSTRIL = { drop: 0.75, rx: 0.75, ry: 0.3 } as const;
/** The mouth follows the nose's lead on a turn, but only halfway. */
const MOUTH_TURN_LEAD_SHARE = 0.5;
/** An open mouth widens as it opens, and stands a little less tall than it is wide. */
const OPEN_MOUTH_NARROWEST = 0.6;
const OPEN_MOUTH_WIDEST = 0.85;
const OPEN_MOUTH_HEIGHT_SHARE = 0.7;
/** A brow runs from inside its lens out past it, thickening toward the temple. */
const BROW_INNER_SHARE = 0.8;
const BROW_OUTER_SHARE = 1.1;
const BROW_INNER_THICK_SHARE = 0.55;
const BROW_OUTER_THICK_SHARE = 0.7;

function paintLens(ctx: Ctx, c: Pt, rx: number, ry: number, pose: ScientistPose): void {
  fillEllipse(ctx, c, rx + FRAME_HALF_WIDTH, ry + FRAME_HALF_WIDTH, FRAME_RIM);
  fillEllipse(ctx, c, rx - FRAME_HALF_WIDTH, ry - FRAME_HALF_WIDTH, LENS);
  fillEllipse(
    ctx,
    placeShare(LENS_EDGE_TINT.at, c, rx, ry),
    rx * LENS_EDGE_TINT.rx,
    ry * LENS_EDGE_TINT.ry,
    LENS_EDGE,
  );
  const pupil = pt(
    c.x + pose.gaze.x * PUPIL_TRAVEL * (rx / LENS_RADIUS),
    c.y + pose.gaze.y * PUPIL_TRAVEL,
  );
  if (pose.blink > BLINK_SHUT_AT) {
    strokeLine(
      ctx,
      pt(pupil.x - rx * SHUT_LID_SHARE, pupil.y),
      pt(pupil.x + rx * SHUT_LID_SHARE, pupil.y),
      PUPIL_RADIUS * SHUT_LID_WIDTH_SHARE,
      SKIN.deep,
    );
  } else {
    fillEllipse(ctx, pupil, Math.min(PUPIL_RADIUS, rx * PUPIL_FIT_SHARE), PUPIL_RADIUS, INK);
  }
  fillEllipse(
    ctx,
    placeShare(GLINT_AT, c, rx, ry),
    Math.min(GLINT_RADIUS, rx * GLINT_FIT_SHARE),
    GLINT_RADIUS,
    GLINT,
  );
}

const BLINK_SHUT_AT = 0.5;
/** The far rim of the lens, where the light through it pools, in shares of the lens's radii. */
const LENS_EDGE_TINT = { at: [0.25, 0.3], rx: 0.55, ry: 0.4 } as const;
const SHUT_LID_SHARE = 0.6;
const SHUT_LID_WIDTH_SHARE = 0.8;
/** An edge-on lens squeezes the pupil and the glint to fit inside it. */
const PUPIL_FIT_SHARE = 0.8;
const GLINT_FIT_SHARE = 0.5;
const GLINT_AT: Share = [-0.42, -0.42];

/** Profile head: skull, beak, the near lens edge-on, tufts behind the ear. */
const PROFILE_NOSE_REACH = 0.15;
const PROFILE_NOSE_DROP = 0.11;
const PROFILE_LENS_RX = 0.032;
const PROFILE_LENS_FORWARD = 0.155;
const PROFILE_EAR_BACK = -0.035;

function headSide(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const c = skel.head;
  const angle = skel.headAngle;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  /** A point in the head's own frame (+X toward the face, +Y toward the chin), placed in figure space. */
  const at = (x: number, y: number): Pt => pt(c.x + x * cs - y * sn, c.y + x * sn + y * cs);
  const atShare = (share: Share): Pt => at(HEAD_DEPTH_RX * share[0], HEAD_RY * share[1]);
  const noseAt = ([reach, drop]: Share): Pt =>
    at(
      HEAD_DEPTH_RX * PROFILE_NOSE_ROOT[0] + PROFILE_NOSE_REACH * reach,
      HEAD_RY * PROFILE_NOSE_ROOT[1] + PROFILE_NOSE_DROP * drop,
    );
  const skull = PROFILE_SKULL_OUTLINE.map(atShare);
  const nose: Pt[] = [
    atShare(PROFILE_NOSE_BRIDGE),
    ...PROFILE_NOSE_RIDGE.map(noseAt),
    atShare(PROFILE_NOSE_BASE),
  ];
  const traceSkull = (ctx: Ctx): void => {
    traceSmooth(ctx, skull);
    traceSmooth(ctx, nose);
  };
  const tuft: Pt[] = [
    ...PROFILE_TUFT_ROOT_UPPER.map(atShare),
    ...PROFILE_TUFT_OUTER_EDGE.map(([out, y]) =>
      at(-HEAD_DEPTH_RX - TUFT_REACH * out, HEAD_RY * y),
    ),
    ...PROFILE_TUFT_ROOT_LOWER.map(atShare),
  ];
  const ear = at(PROFILE_EAR_BACK, EAR_Y);
  const lens = at(PROFILE_LENS_FORWARD, LENS_Y);
  return [
    {
      trace: traceSkull,
      paint: (ctx) => {
        ctx.beginPath();
        traceSkull(ctx);
        ctx.fillStyle = SKIN.base;
        ctx.fill();
        shadeOffset(ctx, () => traceSmooth(ctx, skull), HEAD_RX * SKULL_SHADE_SHARE, SKIN.shadow);
        ctx.beginPath();
        traceSmooth(ctx, nose);
        ctx.fillStyle = SKIN.base;
        ctx.fill();
        shadeOffset(
          ctx,
          () => traceSmooth(ctx, nose),
          NOSE_HALF * PROFILE_NOSE_SHADE_SHARE,
          SKIN.shadow,
        );
        fillEllipse(
          ctx,
          atShare([PROFILE_DOME_SHINE.at[0], PROFILE_DOME_SHINE.at[1] * SHEEN_DROP_SHARE]),
          HEAD_DEPTH_RX * PROFILE_DOME_SHINE.rx * SHEEN_SCALE,
          HEAD_RY * PROFILE_DOME_SHINE.ry * SHEEN_SCALE,
          rgba(SKIN_SHEEN, SHEEN_ALPHA),
          angle,
        );
        fillEllipse(
          ctx,
          atShare(PROFILE_DOME_SHINE.at),
          HEAD_DEPTH_RX * PROFILE_DOME_SHINE.rx,
          HEAD_RY * PROFILE_DOME_SHINE.ry,
          rgba(SKIN_SHINE, DOME_SHINE_ALPHA),
          angle,
        );
        withClip(
          ctx,
          () => {
            ctx.beginPath();
            traceSkull(ctx);
          },
          () => {
            ctx.beginPath();
            traceSmooth(ctx, PROFILE_STUBBLE_OUTLINE.map(atShare));
            ctx.fillStyle = rgba(STUBBLE, STUBBLE_ALPHA);
            ctx.fill();
            const mouthAt = (share: Share): Pt =>
              at(HEAD_DEPTH_RX * share[0], MOUTH_Y + HEAD_RY * share[1]);
            const mouth = mouthAt(PROFILE_MOUTH_FRONT);
            if (pose.mouth > MOUTH_OPEN_AT) {
              fillEllipse(
                ctx,
                mouth,
                MOUTH_HALF * PROFILE_OPEN_MOUTH_WIDTH_SHARE,
                MOUTH_HALF * pose.mouth * PROFILE_OPEN_MOUTH_HEIGHT_SHARE,
                INK,
              );
            } else {
              strokeLine(ctx, mouth, mouthAt(PROFILE_MOUTH_CORNER), MOUTH_LINE, SKIN.deep);
            }
            fillEllipse(
              ctx,
              noseAt(PROFILE_NOSTRIL.at),
              NOSE_HALF * PROFILE_NOSTRIL.rx,
              NOSE_HALF * PROFILE_NOSTRIL.ry,
              SKIN.deep,
              angle,
            );
          },
        );
        ctx.beginPath();
        traceEllipse(ctx, ear, EAR_RX * PROFILE_EAR_WIDTH_SHARE, EAR_RY, angle);
        ctx.fillStyle = SKIN.base;
        ctx.fill();
        fillEllipse(
          ctx,
          add(ear, pt(EAR_RX * PROFILE_EAR_HOLLOW.ahead, 0)),
          EAR_RX * PROFILE_EAR_HOLLOW.rx,
          EAR_RY * PROFILE_EAR_HOLLOW.ry,
          SKIN.shadow,
          angle,
        );
      },
    },
    hairPart((ctx) => traceSmooth(ctx, tuft), tuft),
    {
      trace: () => undefined,
      paint: (ctx) => {
        strokeLine(
          ctx,
          lens,
          add(ear, pt(EAR_RX * PROFILE_ARM_EAR_AHEAD * cs, -EAR_RY * PROFILE_ARM_EAR_RISE)),
          FRAME_WIDTH,
          FRAME_RIM,
        );
        paintLens(ctx, lens, PROFILE_LENS_RX, LENS_RADIUS, {
          ...pose,
          gaze: pt(PROFILE_GAZE_FORWARD, pose.gaze.y),
        });
        const browInner = at(
          PROFILE_LENS_FORWARD + LENS_RADIUS * PROFILE_BROW_INNER_AHEAD,
          BROW_Y - pose.worry * BROW_WORRY_LIFT,
        );
        const browOuter = at(
          PROFILE_LENS_FORWARD - BROW_HALF * PROFILE_BROW_LENGTH,
          BROW_Y - BROW_DROOP,
        );
        ctx.beginPath();
        traceLimb(
          ctx,
          browOuter,
          browInner,
          BROW_THICK * PROFILE_BROW_OUTER_THICK_SHARE,
          BROW_THICK * PROFILE_BROW_INNER_THICK_SHARE,
        );
        ctx.fillStyle = HAIR.base;
        ctx.fill();
      },
    },
  ];
}

/** In profile his pupil sits at the front of the edge-on lens, looking where he faces. */
const PROFILE_GAZE_FORWARD = 0.35;
const PROFILE_BROW_LENGTH = 0.7;
const PROFILE_BROW_INNER_AHEAD = 0.2;
const PROFILE_BROW_OUTER_THICK_SHARE = 0.5;
const PROFILE_BROW_INNER_THICK_SHARE = 0.75;

/** The skull in profile: shares of its depth toward the face, and of its height toward the chin. */
const PROFILE_SKULL_OUTLINE: readonly Share[] = [
  [-0.2, -1.03],
  [0.62, -0.82],
  [0.95, -0.25],
  [0.93, 0.35],
  [0.8, 0.9],
  [0.3, 1.05],
  [-0.35, 0.62],
  [-0.95, 0.2],
  [-0.98, -0.45],
  [-0.65, -0.9],
];
/** Where the nose leaves the brow and where it meets the lip, in head radii. */
const PROFILE_NOSE_BRIDGE: Share = [0.8, -0.05];
const PROFILE_NOSE_BASE: Share = [0.85, 0.55];
/** The nose's root, in head radii, that its ridge and nostril are laid off. */
const PROFILE_NOSE_ROOT: Share = [0.85, 0.2];
/** The ridge and the hooked tip, in shares of the nose's reach and drop off its root. */
const PROFILE_NOSE_RIDGE: readonly Share[] = [
  [0.6, 0],
  [1, 0.9],
  [0.55, 1.05],
];
const PROFILE_NOSTRIL = { at: [0.5, 0.95], rx: 0.7, ry: 0.35 } as const;
const PROFILE_NOSE_SHADE_SHARE = 0.8;
/** The tuft's roots on the skull, in head radii, either side of its outer edge. */
const PROFILE_TUFT_ROOT_UPPER: readonly Share[] = [
  [0.05, -0.22],
  [-0.7, -0.42],
];
const PROFILE_TUFT_ROOT_LOWER: readonly Share[] = [
  [-0.55, 0.58],
  [0.1, 0.36],
];
/** The tuft's broken edge behind the skull: shares of its reach past the back, and heights in head radii. */
const PROFILE_TUFT_OUTER_EDGE: readonly Share[] = [
  [0.35, -0.42],
  [0.85, -0.3],
  [0.55, -0.15],
  [0.95, 0],
  [0.6, 0.15],
  [0.9, 0.3],
  [0.45, 0.46],
];
const PROFILE_DOME_SHINE = { at: [0.05, -0.72], rx: 0.32, ry: 0.14 } as const;
const PROFILE_STUBBLE_OUTLINE: readonly Share[] = [
  [0.1, 0.25],
  [1.3, 0.45],
  [1.2, 1.3],
  [-0.4, 0.9],
];
/** The mouth's front and its corner, in head radii, the height measured off the mouth line. */
const PROFILE_MOUTH_FRONT: Share = [0.86, 0.08];
const PROFILE_MOUTH_CORNER: Share = [0.62, 0.1];
const PROFILE_OPEN_MOUTH_WIDTH_SHARE = 0.55;
const PROFILE_OPEN_MOUTH_HEIGHT_SHARE = 0.6;
const PROFILE_EAR_WIDTH_SHARE = 1.1;
const PROFILE_EAR_HOLLOW = { ahead: 0.25, rx: 0.45, ry: 0.55 } as const;
/** The glasses' arm meets the ear at its top front. */
const PROFILE_ARM_EAR_AHEAD = 0.5;
const PROFILE_ARM_EAR_RISE = 0.6;

/** From behind: the bald dome, the ring of grey coils round the back, ears and the glasses' arms. */
function headBack(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const c = skel.head;
  const outline = headFrontOutline(c);
  const traceSkull = (ctx: Ctx): void => traceSmooth(ctx, outline);
  const turn = pose.headTurn;
  const parts: Part[] = [];
  for (const s of [-1, 1]) {
    const ear = pt(c.x + s * HEAD_RX * EAR_SET_SHARE, c.y + EAR_Y);
    parts.push(flatPartShaded((ctx) => traceEllipse(ctx, ear, EAR_RX, EAR_RY), SKIN));
  }
  // A glance over the shoulder from behind shows the tip of his nose and the
  // rim of one lens past the side of his head.
  const glanceSide = turn >= 0 ? screenSide('back', 'left') : screenSide('back', 'right');
  const glance = Math.abs(turn);
  if (glance > GLANCE_SHOWS_AT) {
    const reach = (glance - GLANCE_SHOWS_AT) / (1 - GLANCE_SHOWS_AT);
    const noseTip = pt(
      c.x + glanceSide * (HEAD_RX + PROFILE_NOSE_REACH * reach * GLANCE_NOSE_REACH_SHARE),
      c.y + NOSE_TIP_Y * GLANCE_NOSE_TIP_DROP_SHARE,
    );
    const glanceNoseAt = (share: Share): Pt =>
      pt(c.x + glanceSide * HEAD_RX * share[0], c.y + NOSE_TIP_Y * share[1]);
    parts.push(
      flatPart((ctx) => {
        traceSmooth(ctx, [
          glanceNoseAt(GLANCE_NOSE_BRIDGE),
          noseTip,
          glanceNoseAt(GLANCE_NOSE_BASE),
        ]);
      }, SKIN.base),
    );
    parts.push({
      trace: () => undefined,
      paint: (ctx) => {
        const rim = pt(
          c.x +
            glanceSide *
              (HEAD_RX * GLANCE_RIM_SET_SHARE + LENS_RADIUS * GLANCE_RIM_REACH_SHARE * reach),
          c.y + LENS_Y,
        );
        fillEllipse(
          ctx,
          rim,
          PROFILE_LENS_RX * reach + FRAME_WIDTH,
          LENS_RADIUS * GLANCE_RIM_HEIGHT_SHARE,
          FRAME_RIM,
        );
        fillEllipse(
          ctx,
          rim,
          PROFILE_LENS_RX * reach,
          LENS_RADIUS * GLANCE_LENS_HEIGHT_SHARE,
          LENS,
        );
      },
    });
  }
  parts.push({
    trace: traceSkull,
    paint: (ctx) => {
      ctx.beginPath();
      traceSkull(ctx);
      ctx.fillStyle = SKIN.base;
      ctx.fill();
      shadeOffset(ctx, () => traceSkull(ctx), HEAD_RX * SKULL_SHADE_SHARE, SKIN.shadow);
      paintDomeShine(ctx, c, BACK_DOME_SHINE);
      for (const s of [-1, 1]) {
        strokeLine(
          ctx,
          pt(c.x + s * HEAD_RX * EAR_SET_SHARE, c.y + LENS_Y - EAR_RY * BACK_ARM_RISE_SHARE),
          pt(c.x + s * HEAD_RX * BACK_ARM_TUCK_SHARE, c.y + EAR_Y + EAR_RY * BACK_ARM_DROP_SHARE),
          FRAME_WIDTH,
          FRAME_RIM,
        );
      }
    },
  });
  const horseshoe = BACK_HAIR_OUTLINE.map(([edge, x, y]) =>
    pt(
      edge === 0 ? c.x + HEAD_RX * x : c.x + edge * HEAD_RX + edge * TUFT_REACH * x,
      c.y + HEAD_RY * y,
    ),
  );
  parts.push(hairPart((ctx) => traceSmooth(ctx, horseshoe), horseshoe));
  return parts;
}

const GLANCE_SHOWS_AT = 0.35;
/** Glancing back, the nose and the near lens's rim show past the side of the skull. */
const GLANCE_NOSE_REACH_SHARE = 0.8;
const GLANCE_NOSE_TIP_DROP_SHARE = 0.8;
/** The glancing nose's bridge and base, in head radii across and nose-tip drops down. */
const GLANCE_NOSE_BRIDGE: Share = [0.8, 0.1];
const GLANCE_NOSE_BASE: Share = [0.85, 1.05];
const GLANCE_RIM_SET_SHARE = 0.95;
const GLANCE_RIM_REACH_SHARE = 0.35;
const GLANCE_RIM_HEIGHT_SHARE = 0.9;
const GLANCE_LENS_HEIGHT_SHARE = 0.8;
/** From behind, the glasses' arms run from the temple down and in to the top of each ear. */
const BACK_ARM_RISE_SHARE = 0.2;
const BACK_ARM_TUCK_SHARE = 0.9;
const BACK_ARM_DROP_SHARE = 0.8;

/**
 * One vertex of the hair round the back of his head, as `[edge, x, y]`. With
 * `edge` 0, `x` is in head radii off the centre; with `edge` ±1 it is in
 * shares of the tuft's reach past that side of the skull. `y` is in head radii.
 */
type BackHairVertex = readonly [edge: -1 | 0 | 1, x: number, y: number];

/**
 * The receding ring of grey coils round the back of the bald dome, from ear
 * to ear under it, its top edge scalloped by the coils.
 */
const BACK_HAIR_OUTLINE: readonly BackHairVertex[] = [
  [-1, 0.4, -0.25],
  [0, -0.85, -0.18],
  [0, -0.62, 0.02],
  [0, -0.4, 0.12],
  [0, -0.16, 0.2],
  [0, 0.08, 0.16],
  [0, 0.32, 0.22],
  [0, 0.55, 0.1],
  [0, 0.8, -0.08],
  [1, 0.4, -0.25],
  [1, 1, -0.1],
  [1, 0.7, 0.05],
  [1, 0.9, 0.2],
  [1, 0.5, 0.34],
  [0, 0.6, 0.8],
  [0, 0, 0.9],
  [0, -0.6, 0.8],
  [-1, 0.5, 0.34],
  [-1, 0.9, 0.2],
  [-1, 0.7, 0.05],
  [-1, 1, -0.1],
];

/** The neck: thin and wattled, jutting forward off the stoop. */
const NECK_HALF = 0.055;
const NECK_ROOT_FLARE = 1.2;

function neckPart(skel: ScientistSkeleton): Part {
  return limbPart(skel.neckBase, skel.neckTop, NECK_HALF * NECK_ROOT_FLARE, NECK_HALF, SKIN);
}

// ── Composition ──────────────────────────────────────────────────────────────

function paintParts(ctx: Ctx, parts: readonly Part[]): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = SILHOUETTE;
  ctx.strokeStyle = SILHOUETTE;
  ctx.lineWidth = OUTLINE_WIDTH * 2;
  for (const part of parts) {
    ctx.beginPath();
    part.trace(ctx);
    ctx.fill();
    ctx.stroke();
  }
  for (const part of parts) part.paint(ctx);
}

function sideParts(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const near: Side = 'right';
  const far: Side = 'left';
  const parts: Part[] = [];
  parts.push(...armParts(skel, pose, far, true));
  parts.push(...legParts(skel, pose, far, true));
  parts.push(...legParts(skel, pose, near, false));
  parts.push(neckPart(skel));
  parts.push(...sideCoat(skel, pose));
  parts.push(...sideBadge(skel, pose));
  parts.push(...headSide(skel, pose));
  if (!pose.arms[near].behind) parts.push(...armParts(skel, pose, near, false));
  return parts;
}

/** In profile the badge is edge-on: a quarter as wide as it is tall. */
const SIDE_BADGE_HALF_WIDTH_SHARE = 0.25;
const SIDE_BADGE_WIDTH_SHARE = 0.5;
const SIDE_BADGE_HANG_SHARE = 0.3;
const SIDE_BADGE_DROPS = 2;

/** In profile the badge dangles plumb off the stooped neck, out in front of his belly. */
function sideBadge(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const neckFront = offSpine(skel.neckBase, skel.upperDir, NECK_FRONT);
  const chestFront = offSpine(skel.chest, skel.midDir, CHEST_FRONT + COAT_EASE);
  const hangX =
    Math.max(neckFront.x, chestFront.x) + BADGE_HALF * SIDE_BADGE_HANG_SHARE + pose.badgeSwing;
  const badge = pt(hangX, chestFront.y + BADGE_DROP * SIDE_BADGE_DROPS);
  return [
    {
      trace: () => undefined,
      paint: (ctx) => {
        strokeLine(ctx, neckFront, add(badge, pt(0, -BADGE_HALF)), LANYARD_WIDTH, LANYARD);
        ctx.beginPath();
        ctx.rect(
          badge.x - BADGE_HALF * SIDE_BADGE_HALF_WIDTH_SHARE,
          badge.y - BADGE_HALF,
          BADGE_HALF * SIDE_BADGE_WIDTH_SHARE,
          BADGE_HALF * 2,
        );
        ctx.fillStyle = BADGE;
        ctx.fill();
      },
    },
  ];
}

function facingParts(skel: ScientistSkeleton, pose: ScientistPose): Part[] {
  const front = skel.view === 'front';
  const parts: Part[] = [];
  const back = skel.view === 'back';
  const splitArm = (s: Side): boolean => back && pose.arms[s].foreBehind && !pose.arms[s].behind;
  const behindArms = SIDES.filter((s) => pose.arms[s].behind);
  const frontArms = SIDES.filter((s) => !pose.arms[s].behind && !pose.arms[s].overHead);
  const overArms = SIDES.filter((s) => !pose.arms[s].behind && pose.arms[s].overHead);
  for (const s of behindArms) parts.push(...armParts(skel, pose, s, true));
  for (const s of SIDES.filter(splitArm)) parts.push(...armParts(skel, pose, s, true, 'fore'));
  for (const s of SIDES) parts.push(...legParts(skel, pose, s, false));
  if (front) {
    parts.push(frontHump(skel));
    parts.push(...frontCoat(skel, pose));
    parts.push(...headFront(skel, pose));
  } else {
    parts.push(neckPart(skel));
    parts.push(...headBack(skel, pose));
    parts.push(...backCoat(skel, pose));
  }
  for (const s of frontArms) {
    parts.push(...armParts(skel, pose, s, false, splitArm(s) ? 'upper' : 'whole'));
  }
  for (const s of overArms) parts.push(...armParts(skel, pose, s, false));
  return parts;
}

/** Paints one pose, in figure units. The caller sets the transform that places and scales it. */
export function drawScientistPose(ctx: Ctx, pose: ScientistPose): void {
  const skel = buildSkeleton(pose);
  const parts = pose.view === 'side' ? sideParts(skel, pose) : facingParts(skel, pose);
  ctx.save();
  try {
    paintParts(ctx, parts);
  } finally {
    ctx.restore();
  }
}
