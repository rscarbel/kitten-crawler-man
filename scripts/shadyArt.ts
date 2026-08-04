/**
 * Shady — the hooded man who sells bounties beside the town notice board.
 *
 * The painter only. Proportions, palette and one `drawShady` over a single pose
 * type; the choreography lives in `generate-shady-sprite.ts`.
 *
 * He is deliberately the *simplest* biped in the project, and the simplification
 * is structural rather than lazy: a floor-length cloak means there is no gait to
 * get wrong, no foot slide, no knee that can hinge backwards. Everything the
 * figure has to say — furtive, hunched, faceless — it says with the hood, the
 * shoulder line and the hands.
 *
 * Coordinates are tile units with the origin between his feet and +Y running
 * down the screen, so heights are negative. The generator scales the whole
 * figure at bake time; nothing here knows about pixels.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

export interface Pt {
  x: number;
  y: number;
}

export function pt(x: number, y: number): Pt {
  return { x, y };
}

const DEGREES_PER_TURN = 180;
export function deg(degrees: number): number {
  return (degrees * Math.PI) / DEGREES_PER_TURN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smoothstep: zero slope at both ends, so a one-shot starts and stops softly. */
const SMOOTHSTEP_CUBIC_COEFF = 3;
const SMOOTHSTEP_QUADRATIC_COEFF = 2;
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (SMOOTHSTEP_CUBIC_COEFF - SMOOTHSTEP_QUADRATIC_COEFF * c);
}

/** 0 → 1 → 0 over the unit interval; the shape of a single beat. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** Remaps `value` from the range [start, end] onto [0, 1], clamped. */
export function ramp(value: number, start: number, end: number): number {
  if (end === start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * A muted, dusty range. Shady has to read as somebody who does not want to be
 * looked at, and against the town's warm stone a saturated cloak would be the
 * brightest thing in the plaza.
 */
/**
 * The cape reads lighter than the coat under it, not darker.
 *
 * Its top is the most sky-facing plane on the figure, so lighting it *below* the
 * vertical coat — which the first pass did — inverts the whole read and the cape
 * stops looking like it is on top of anything.
 */
const CLOAK_MID = '#6d6550';
const CLOAK_LIGHT = '#7d745c';
const CLOAK_DARK = '#544d3d';
const MANTLE_MID = '#7f7659';
const MANTLE_TOP = '#8a8164';
const MANTLE_DARK = '#645d47';
const HOOD_MID = '#8b8163';
const HOOD_LIGHT = '#9c9172';
/** The hood's front edge, in shadow where it turns into the opening. */
const HOOD_RIM = '#4a4433';
/**
 * The sleeves sit between the cape and the coat in value rather than below both.
 * At coat value minus a step they measured seven luminance points off the
 * background — the arms dissolved into the ground at the silhouette edge and
 * vanished outright at a 32px tile.
 */
const SLEEVE_MID = '#948a6c';
const SLEEVE_CUFF = '#776e53';
/**
 * The inside of the hood. Not merely dark — *flat*, with no shading and no
 * feature, because a hint of a face is worse than none: at 32px a highlight in
 * there reads as a pale blob and the figure stops being a mystery.
 */
const COWL_VOID = '#050507';
const WRAP_MID = '#a89272';
const WRAP_DARK = '#8a7659';
const BOOT_MID = '#6d6150';
const BOOT_DARK = '#4c4438';
const OUTLINE = '#1d1a14';
const BELT_MID = '#5d4a30';
const POUCH_MID = '#6e5a39';
/** The shadow under the hood, which the cowl's opening runs down into. */
const NECK_SHADOW = '#0b0a09';

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Standing height, crown of the hood to the ground. Shorter than Carl's 2.03
 * on purpose: he is hunched, and a bounty-giver who looms over the player reads
 * as a threat rather than as a hanger-on.
 */
export const FIGURE_HEIGHT = 1.78;

const GROUND_Y = 0;
/** Where the cloak stops and the boots show. Ankle-length, not floor-length. */
const HEM_Y = -0.14;
const HIP_Y = -0.82;
const WAIST_Y = -1.0;
export const SHOULDER_Y = -1.34;
/** Top of the shoulder cape, which sits a touch above the shoulder line. */
const MANTLE_TOP_Y = -1.4;
const MANTLE_HEM_Y = -1.11;
const HEAD_CENTRE_Y = -1.53;

/**
 * Broad enough that the hood reads as a head on a body rather than as the top
 * of a post. A blind review of the first bake named the figure a chess pawn: at
 * a hood 81% as wide as the shoulders, that is simply what the outline is.
 * The hood/shoulder ratio wants to be nearer 0.55.
 */
const SHOULDER_HALF = 0.35;
const CHEST_HALF = 0.31;
const WAIST_HALF = 0.24;
const HIP_HALF = 0.25;
/**
 * The cloak flares as it falls, but not far. A wide hem turns the silhouette
 * into a bell, and a bell on a hooded figure reads as a robed monk — the wrong
 * character entirely, and it also swallows the hands he works at his belt.
 */
const HEM_HALF = 0.355;
/**
 * The shoulder cape stops well short of the hem.
 *
 * It used to be the widest thing on him — wider than the coat below it — which
 * inverts a garment's natural flare and turns the silhouette into a mushroom
 * cap. A blind review named that shape a monk, which is the one character the
 * brief rules out.
 */
const MANTLE_HALF = 0.26;

export const UPPER_ARM_LENGTH = 0.3;
export const FOREARM_LENGTH = 0.27;
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;
/**
 * Arms root well inboard, under the cape.
 *
 * They used to root wide enough that the *sleeves* — not the cape — were the
 * widest thing on the figure, so the coat's hem was 11% narrower than his
 * shoulders and the silhouette stayed a mushroom however far the cape came in.
 * Pulling the roots in also closes the slit between sleeve and cape that was
 * letting the background through his armpit.
 */
const ARM_ROOT_HALF = 0.235;
/** The shoulder joint hangs below the shoulder line, where a deltoid would. */
export const SHOULDER_JOINT_DROP = 0.05;

const SLEEVE_UPPER_WIDTH = 0.066;
const SLEEVE_ELBOW_WIDTH = 0.055;
const SLEEVE_WRIST_WIDTH = 0.042;

/**
 * Derived from the forearm, never from the hood: a game figure's head is
 * deliberately oversized and any ratio hung off it inflates. Larger than the
 * anatomical fraction because the wraps are the one piece of skin-adjacent
 * detail on him, and at a 32px tile a correctly-sized hand is three pixels.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.55;
/**
 * As wide as the forearm it ends, not narrower. A hand at 0.7× its own sleeve
 * reads as a pebble stuck on the cuff — the blind review named them beads.
 */
const HAND_WIDTH = HAND_LENGTH * 1.0;

/**
 * The hood's outer shell. Taller than it is wide so the crown reads as a peak
 * rather than a helmet, and set forward of the head's centre because a hood
 * hangs off the back of the skull and juts past the brow.
 */
const HOOD_RX = 0.175;
const HOOD_RY = 0.175;
const HOOD_PEAK_LIFT = 0.05;

/**
 * The mouth of the cowl. Its size is the whole read: too small and he is
 * wearing a mask, too large and the void swallows the hood's own edge and the
 * silhouette loses its front.
 */
export const COWL_RX = 0.085;
export const COWL_RY = 0.105;
/** How far forward (down-screen) of the head centre the opening sits. */
export const COWL_FORWARD = 0.06;

const BOOT_HALF_WIDTH = 0.07;
const BOOT_SPREAD = 0.115;
const BOOT_HEIGHT = 0.13;

const OUTLINE_WIDTH = 0.016;

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * Every animation is written as edits to {@link restingPose}. Hands are IK
 * targets; everything else is a scalar the painter interprets.
 */
export interface ShadyPose {
  /** Whole-body vertical offset; negative lifts him. */
  bob: number;
  /** Hip shift along X — the weight-shift of somebody who will not stand still. */
  sway: number;
  /** Torso lean in radians; positive tips the shoulders toward +X. */
  lean: number;
  /** 0 stands as tall as he ever does, 1 sinks into a slouch. */
  slouch: number;
  /** Shoulder rotation about the spine, −1 to 1, seen head-on as a width shift. */
  twist: number;
  /**
   * Head turn, −1 to 1. Slides the cowl opening across the hood, which is the
   * only way a faceless figure can look at anything.
   */
  headTurn: number;
  headTilt: number;
  /**
   * How far the hood lags the body, −1 to 1. Cloth follows a frame behind the
   * shoulder it hangs from; without the lag the hood reads as rigid, like a
   * helmet screwed to the neck.
   */
  hoodLag: number;
  /** How far the cloak hem kicks out, −1 to 1. */
  hemSway: number;
  leftHand: Pt;
  rightHand: Pt;
  /** 0 open hand, 1 closed fist, per hand. */
  leftFist: number;
  rightFist: number;
  /**
   * Which side a hand is drawn on relative to the cloak. An arm reaching up
   * behind the hood has to pass *behind* the body or the sleeve paints over his
   * own chest.
   */
  leftHandBehind: boolean;
  rightHandBehind: boolean;
  /**
   * Which way an elbow breaks: +1 bows it away from the centreline, which is
   * what a hanging arm does. −1 folds it inward, which is what an arm reaching
   * across or up behind the head does.
   */
  leftElbowBreak: number;
  rightElbowBreak: number;
  /**
   * How much an arm is pointed at the camera rather than across it, 0 to 1. At
   * 1 the elbow is pulled onto the shoulder→wrist line and the arm is a
   * straight column that only gets shorter as the hand rises.
   *
   * Head-on there is nowhere for a bent elbow to *go* except backwards, which a
   * flat image cannot show — so an arm folded to hold something at the belt
   * solves into an elbow thrown a fifth of a tile out to the side, and the
   * figure stands with its arms akimbo. This is the same correction Carl's legs
   * need head-on, for the same reason.
   */
  leftArmForeshorten: number;
  rightArmForeshorten: number;
  /**
   * Draws an arm *after* the shoulder cape rather than under it.
   *
   * A hanging arm belongs under the cape, which is why that is the default. An
   * arm raised to the head does not: the cape is painted over the whole raised
   * limb and the figure appears to have deleted an arm, with only the hand
   * poking out past the hood as an unexplained nub on the outline.
   */
  leftArmOverMantle: boolean;
  rightArmOverMantle: boolean;
}

/** A relaxed arm reaches nearly its full length from the shoulder *joint*. */
const RESTING_HAND_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.97;
const RESTING_HAND_SPREAD = 0.245;

/**
 * A permanent cock of the hood and a dropped shoulder, present in *every* frame.
 *
 * A blind review measured the figure bilaterally symmetric to within a pixel and
 * called it out: a furtive man cannot be built out of a symmetric silhouette
 * plus a sway, because the symmetry is what the eye reads first and the sway is
 * what it reads last.
 */
const RESTING_HOOD_COCK = deg(4);
const RESTING_SHOULDER_TILT = deg(1.2);

export function restingPose(): ShadyPose {
  return {
    bob: 0,
    sway: 0,
    lean: RESTING_SHOULDER_TILT,
    slouch: 0.35,
    twist: 0,
    headTurn: 0,
    headTilt: RESTING_HOOD_COCK,
    hoodLag: 0,
    hemSway: 0,
    leftHand: pt(-RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    rightHand: pt(RESTING_HAND_SPREAD, SHOULDER_Y + RESTING_HAND_DROP),
    leftFist: 0.35,
    rightFist: 0.35,
    leftHandBehind: false,
    rightHandBehind: false,
    leftElbowBreak: 1,
    rightElbowBreak: 1,
    leftArmForeshorten: RESTING_ARM_FORESHORTEN,
    rightArmForeshorten: RESTING_ARM_FORESHORTEN,
    leftArmOverMantle: false,
    rightArmOverMantle: false,
  };
}

/**
 * A hooded man stands with his hands at his belt, which is a folded arm — and
 * head-on almost all of that fold is depth.
 */
const RESTING_ARM_FORESHORTEN = 0.5;

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

/**
 * Keeps a fully extended arm off a dead straight line. Tiny, because a joint's
 * sideways travel grows as the *square root* of the slack — a few percent here
 * puts a visible kink in an arm that should hang.
 */
const JOINT_SLACK = 0.0004;

/**
 * Places a two-segment limb so its end lands on `target`. `bendSign` picks the
 * side the joint pops out to: +1 bends toward +X of the root→target line.
 */
export function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  bendSign: number,
  foreshorten = 0,
): BoneChain {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const reach = upper + lower - JOINT_SLACK;
  const rawDist = Math.hypot(dx, dy);
  const dist = Math.min(rawDist, reach);
  const safeDist = Math.max(dist, 1e-4);
  const ux = (dx || 0) / (rawDist || 1);
  const uy = (dy || 1) / (rawDist || 1);
  const end = pt(root.x + ux * dist, root.y + uy * dist);

  // Law of cosines: how far along root→end the joint projects, and how far off it.
  const alongRaw = (safeDist * safeDist + upper * upper - lower * lower) / (2 * safeDist);
  const along = Math.max(-upper, Math.min(upper, alongRaw));
  const offset = Math.sqrt(Math.max(0, upper * upper - along * along));
  const flare = offset * (1 - clamp01(foreshorten));
  const joint = pt(
    root.x + ux * along - uy * flare * bendSign,
    root.y + uy * along + ux * flare * bendSign,
  );
  return { root, joint, end };
}

/** Every point the painter needs, already offset by the pose's body motion. */
export interface ShadySkeleton {
  hipCentre: Pt;
  shoulderCentre: Pt;
  headCentre: Pt;
  leftArm: BoneChain;
  rightArm: BoneChain;
  leftShoulder: Pt;
  rightShoulder: Pt;
  /** How much the whole figure has been compressed by its slouch, 0–1. */
  slouch: number;
}

/** Rotates `p` about `pivot` by `angle` radians. */
function rotateAbout(p: Pt, pivot: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return pt(pivot.x + dx * c - dy * s, pivot.y + dx * s + dy * c);
}

/** How far a full twist slides the shoulder line across, as a fraction of its half-width. */
const TWIST_SHOULDER_TRAVEL = 0.35;
/** Fraction of his standing height a full slouch takes off. */
const SLOUCH_COMPRESSION = 0.05;
/** How far a full slouch rounds the shoulders inward. */
const SLOUCH_SHOULDER_PULL = 0.03;

export function buildSkeleton(pose: ShadyPose): ShadySkeleton {
  const drop = pose.slouch * FIGURE_HEIGHT * SLOUCH_COMPRESSION;
  const lift = pose.bob;
  const hipCentre = pt(pose.sway, HIP_Y + lift + drop);
  const shoulderCentreFlat = pt(pose.sway, SHOULDER_Y + lift + drop);
  const shoulderCentre = rotateAbout(shoulderCentreFlat, hipCentre, pose.lean);
  const headFlat = pt(pose.sway, HEAD_CENTRE_Y + lift + drop);
  const headCentre = rotateAbout(headFlat, hipCentre, pose.lean);

  const rootHalf = ARM_ROOT_HALF - pose.slouch * SLOUCH_SHOULDER_PULL;
  const twistShift = pose.twist * ARM_ROOT_HALF * TWIST_SHOULDER_TRAVEL;
  const leftShoulder = rotateAbout(
    pt(
      shoulderCentre.x - rootHalf + twistShift,
      shoulderCentre.y + SHOULDER_JOINT_DROP + pose.slouch * SLOUCH_SHOULDER_PULL,
    ),
    shoulderCentre,
    pose.lean,
  );
  const rightShoulder = rotateAbout(
    pt(
      shoulderCentre.x + rootHalf + twistShift,
      shoulderCentre.y + SHOULDER_JOINT_DROP + pose.slouch * SLOUCH_SHOULDER_PULL,
    ),
    shoulderCentre,
    pose.lean,
  );

  return {
    hipCentre,
    shoulderCentre,
    headCentre,
    leftShoulder,
    rightShoulder,
    // The two bend signs are opposites because `solveTwoBone` works in the
    // limb's own frame: an elbow that bows away from the body's centreline is
    // +X of the shoulder→wrist line on the left arm and −X of it on the right.
    // Give both arms the same sign and they fold across the chest into an X.
    leftArm: solveTwoBone(
      leftShoulder,
      pt(pose.leftHand.x, pose.leftHand.y + lift + drop),
      UPPER_ARM_LENGTH,
      FOREARM_LENGTH,
      pose.leftElbowBreak,
      pose.leftArmForeshorten,
    ),
    rightArm: solveTwoBone(
      rightShoulder,
      pt(pose.rightHand.x, pose.rightHand.y + lift + drop),
      UPPER_ARM_LENGTH,
      FOREARM_LENGTH,
      -pose.rightElbowBreak,
      pose.rightArmForeshorten,
    ),
    slouch: pose.slouch,
  };
}

// ── Painting ─────────────────────────────────────────────────────────────────

function strokeAndFill(ctx: Ctx, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

/** The tapered-quad path both segment painters share. */
function taperedPath(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  halfFrom: number,
  halfTo: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(from.x + nx * halfFrom, from.y + ny * halfFrom);
  ctx.lineTo(to.x + nx * halfTo, to.y + ny * halfTo);
  ctx.lineTo(to.x - nx * halfTo, to.y - ny * halfTo);
  ctx.lineTo(from.x - nx * halfFrom, from.y - ny * halfFrom);
  ctx.closePath();
}

/** A segment with no outline of its own, for an interior joint. */
function fillOnlySegment(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  halfFrom: number,
  halfTo: number,
  fill: string,
): void {
  taperedPath(ctx, from, to, halfFrom, halfTo);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A limb segment drawn as a tapered quad, so a sleeve narrows toward the cuff. */
function taperedSegment(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  halfFrom: number,
  halfTo: number,
  fill: string,
): void {
  taperedPath(ctx, from, to, halfFrom, halfTo);
  strokeAndFill(ctx, fill);
}

/**
 * A wrapped hand: a rounded slab with a thumb that tucks as the fist closes.
 * Fingers are not drawn separately — at 32px separate strokes read as stitching
 * rather than as digits, and the silhouette is the whole read.
 */
const THUMB_LENGTH_RATIO = 0.5;
const THUMB_WIDTH_RATIO = 0.34;
/** How far the thumb swings in toward the palm at a full fist. */
const THUMB_TUCK = deg(55);
const HAND_CORNER_RATIO = 0.35;

function drawHand(ctx: Ctx, wrist: Pt, elbow: Pt, fist: number, mirror: number): void {
  const angle = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  ctx.save();
  ctx.translate(wrist.x, wrist.y);
  ctx.rotate(angle);

  const length = HAND_LENGTH * lerp(1, 0.86, fist);
  const half = (HAND_WIDTH * lerp(1, 1.18, fist)) / 2;
  const corner = length * HAND_CORNER_RATIO;

  ctx.beginPath();
  ctx.moveTo(0, -half);
  ctx.lineTo(length - corner, -half);
  ctx.quadraticCurveTo(length, -half, length, -half + corner);
  ctx.lineTo(length, half - corner);
  ctx.quadraticCurveTo(length, half, length - corner, half);
  ctx.lineTo(0, half);
  ctx.closePath();
  strokeAndFill(ctx, WRAP_MID);

  const thumbAngle = mirror * (deg(70) - THUMB_TUCK * fist);
  const thumbLength = length * THUMB_LENGTH_RATIO;
  const thumbHalf = (half * THUMB_WIDTH_RATIO * 2) / 2;
  ctx.save();
  ctx.translate(length * 0.25, mirror * half);
  ctx.rotate(thumbAngle);
  ctx.beginPath();
  ctx.moveTo(0, -thumbHalf);
  ctx.lineTo(thumbLength, -thumbHalf * 0.7);
  ctx.lineTo(thumbLength, thumbHalf * 0.7);
  ctx.lineTo(0, thumbHalf);
  ctx.closePath();
  strokeAndFill(ctx, WRAP_DARK);
  ctx.restore();

  ctx.restore();
}

/**
 * Both sleeve segments are painted a step darker than the cloak behind them.
 * At cloak value the arm has no edge but its outline, and a 1px outline is the
 * first thing to go at a 32px tile — the arms then vanish into the body and
 * only the hands read, floating.
 */
function drawArm(ctx: Ctx, arm: BoneChain, fist: number, mirror: number): void {
  // The upper arm is drawn without its own outline so the elbow is a bend in one
  // sleeve rather than a seam between two outlined blocks — a full closed
  // outline on every segment is what makes a limb read as a jointed mannequin.
  fillOnlySegment(ctx, arm.root, arm.joint, SLEEVE_UPPER_WIDTH, SLEEVE_ELBOW_WIDTH, SLEEVE_MID);
  taperedSegment(ctx, arm.joint, arm.end, SLEEVE_ELBOW_WIDTH, SLEEVE_WRIST_WIDTH, SLEEVE_CUFF);
  fillOnlySegment(ctx, arm.root, arm.joint, SLEEVE_UPPER_WIDTH, SLEEVE_ELBOW_WIDTH, SLEEVE_MID);
  drawHand(ctx, arm.end, arm.joint, fist, mirror);
}

/** The lit edge, as fractions of the coat's own half-widths at each height. */
const LIT_EDGE_OUTER_TOP = 0.96;
const LIT_EDGE_OUTER_WAIST = 0.97;
const LIT_EDGE_OUTER_HEM = 0.97;
const LIT_EDGE_INNER_HEM = 0.66;
const LIT_EDGE_INNER_WAIST = 0.76;
const LIT_EDGE_INNER_TOP = 0.8;

/** How far the hem's centre dips below its corners. */
const HEM_DIP = 0.035;
/** How far up from the hem a fold's own lower edge stops. */
const HEM_FOLD_INSET = 0.02;
/** How far off the centreline the single deep cloak fold falls. */
const FOLD_OFFSET = 0.12;

/** How much of the hem's sway reaches the waist — cloth pivots from the hips. */
const HEM_SWAY_AT_WAIST = 0.3;
const HEM_SWAY_TRAVEL = 0.045;

function drawCloak(ctx: Ctx, skel: ShadySkeleton, pose: ShadyPose): void {
  const hemShift = pose.hemSway * HEM_SWAY_TRAVEL;
  const waistShift = hemShift * HEM_SWAY_AT_WAIST;
  const sx = skel.shoulderCentre.x;
  const hx = skel.hipCentre.x;
  const yLift = skel.hipCentre.y - HIP_Y;

  const shoulderY = skel.shoulderCentre.y;
  const chestY = lerp(shoulderY, WAIST_Y + yLift, 0.4);
  const waistY = WAIST_Y + yLift;
  const hipY = skel.hipCentre.y;
  // Pinned to the floor, unlike every other height here, which ride the slouch
  // down. A coat hangs from the shoulders and pools at a fixed hem — letting it
  // descend with the body meant the talk row's deeper lean drove the hem *over
  // the boots* and four pixels below the ground line the other rows establish,
  // so his feet vanished and he sank into the tile the moment a dialog opened.
  const hemY = HEM_Y;

  ctx.beginPath();
  ctx.moveTo(sx - SHOULDER_HALF, shoulderY);
  ctx.lineTo(sx - CHEST_HALF, chestY);
  ctx.lineTo(hx - WAIST_HALF + waistShift, waistY);
  ctx.lineTo(hx - HIP_HALF + waistShift, hipY);
  // The hem is a shallow curve, not a straight line: a flat bottom edge on a
  // long garment reads as a bell, and a bell reads as a dress.
  ctx.quadraticCurveTo(hx - HEM_HALF + hemShift, lerp(hipY, hemY, 0.7), hx - HEM_HALF + hemShift, hemY);
  ctx.quadraticCurveTo(hx + hemShift, hemY + HEM_DIP, hx + HEM_HALF + hemShift, hemY);
  ctx.quadraticCurveTo(
    hx + HEM_HALF + hemShift,
    lerp(hipY, hemY, 0.7),
    hx + HIP_HALF + waistShift,
    hipY,
  );
  ctx.lineTo(hx + WAIST_HALF + waistShift, waistY);
  ctx.lineTo(sx + CHEST_HALF, chestY);
  ctx.lineTo(sx + SHOULDER_HALF, shoulderY);
  ctx.closePath();
  strokeAndFill(ctx, CLOAK_MID);

  // A single deep fold down one side. One fold reads as cloth; several at this
  // size read as corduroy.
  ctx.beginPath();
  ctx.moveTo(hx - FOLD_OFFSET + waistShift, waistY);
  ctx.quadraticCurveTo(
    hx - FOLD_OFFSET * 1.6 + hemShift,
    lerp(waistY, hemY, 0.6),
    hx - FOLD_OFFSET * 1.2 + hemShift,
    hemY - HEM_FOLD_INSET,
  );
  ctx.lineTo(hx - FOLD_OFFSET * 0.4 + hemShift, hemY - HEM_FOLD_INSET);
  ctx.quadraticCurveTo(
    hx - FOLD_OFFSET * 0.5 + hemShift,
    lerp(waistY, hemY, 0.5),
    hx - FOLD_OFFSET * 0.6 + waistShift,
    waistY,
  );
  ctx.closePath();
  ctx.fillStyle = CLOAK_DARK;
  ctx.fill();

  // A lit edge down the outer side, which stops the coat reading as a flat
  // cut-out. Kept off the centreline and widening as it falls: a rigid bright
  // stripe straight down his front is a bottle's highlight, and it was most of
  // why a 32px thumbnail of him read as a lantern.
  ctx.beginPath();
  ctx.moveTo(sx + CHEST_HALF * LIT_EDGE_OUTER_TOP, chestY);
  ctx.lineTo(hx + WAIST_HALF * LIT_EDGE_OUTER_WAIST + waistShift, waistY);
  ctx.lineTo(hx + HEM_HALF * LIT_EDGE_OUTER_HEM + hemShift, hemY - HEM_FOLD_INSET);
  ctx.lineTo(hx + HEM_HALF * LIT_EDGE_INNER_HEM + hemShift, hemY - HEM_FOLD_INSET);
  ctx.lineTo(hx + WAIST_HALF * LIT_EDGE_INNER_WAIST + waistShift, waistY);
  ctx.lineTo(sx + CHEST_HALF * LIT_EDGE_INNER_TOP, chestY);
  ctx.closePath();
  ctx.fillStyle = CLOAK_LIGHT;
  ctx.fill();
}

const BELT_HALF_HEIGHT = 0.022;
const POUCH_HALF_WIDTH = 0.045;
const POUCH_HEIGHT = 0.075;
/**
 * The pouch hangs off one hip; the buckle itself stays on the centreline. An
 * off-centre buckle over a symmetric belt and coat reads as a mistake rather
 * than as character.
 */
const POUCH_OFFSET_X = 0.14;
const BUCKLE_HALF_WIDTH = 0.035;
const POUCH_FLAP_HEIGHT = 0.028;
const BUCKLE_LIGHT = '#a08a52';

function drawBelt(ctx: Ctx, skel: ShadySkeleton): void {
  const y = WAIST_Y + (skel.hipCentre.y - HIP_Y);
  const x = skel.hipCentre.x;
  ctx.beginPath();
  ctx.rect(x - WAIST_HALF, y - BELT_HALF_HEIGHT, WAIST_HALF * 2, BELT_HALF_HEIGHT * 2);
  strokeAndFill(ctx, BELT_MID);

  // Bright enough to read as the buckle. Left at pouch value it disappeared and
  // the pouch on his hip became the only thing on the belt anyone could see,
  // which read as a buckle mounted a fifth of his waist off-centre.
  ctx.beginPath();
  ctx.rect(
    x - BUCKLE_HALF_WIDTH,
    y - BELT_HALF_HEIGHT,
    BUCKLE_HALF_WIDTH * 2,
    BELT_HALF_HEIGHT * 2,
  );
  strokeAndFill(ctx, BUCKLE_LIGHT);

  ctx.beginPath();
  ctx.rect(x + POUCH_OFFSET_X - POUCH_HALF_WIDTH, y, POUCH_HALF_WIDTH * 2, POUCH_HEIGHT);
  strokeAndFill(ctx, POUCH_MID);
  // A flap, so it commits to being a pouch rather than a misplaced fitting.
  ctx.beginPath();
  ctx.rect(
    x + POUCH_OFFSET_X - POUCH_HALF_WIDTH,
    y,
    POUCH_HALF_WIDTH * 2,
    POUCH_FLAP_HEIGHT,
  );
  strokeAndFill(ctx, BELT_MID);
}

/**
 * His boots, pinned to the ground.
 *
 * Deliberately *not* offset by the pose's sway: a weight shift moves the
 * pelvis over the feet, it does not slide the feet across the flagstones. The
 * first bake let them travel two pixels and the whole figure skated in place.
 */
function drawBoots(ctx: Ctx, skel: ShadySkeleton): void {
  // Pinned in Y as well as X. A slouch compresses the body over the feet; it
  // does not push the feet into the floor — and letting it do so sank him
  // through the bottom of his own frame the moment the talk row leaned in.
  const y = GROUND_Y;
  for (const spread of [-BOOT_SPREAD, BOOT_SPREAD]) {
    const x = spread;
    ctx.beginPath();
    ctx.rect(x - BOOT_HALF_WIDTH, y - BOOT_HEIGHT, BOOT_HALF_WIDTH * 2, BOOT_HEIGHT);
    strokeAndFill(ctx, spread < 0 ? BOOT_DARK : BOOT_MID);
  }
}

/**
 * How far down the cape's top edge falls before it reaches its full width.
 *
 * Generous, because the silhouette used to jump from 37px to 69px between two
 * adjacent rows — a hard T with no trapezius at all. The widening now spreads
 * over several rows.
 */
const MANTLE_SHOULDER_DROP = 0.19;
const MANTLE_HEM_DIP = 0.1;
const MANTLE_TRIM = 0.03;
/** How wide the collar is, as a fraction of the cape's own half-width. */
const MANTLE_COLLAR_FRACTION = 0.34;
/** How far below the collar the cape's outer points hang. */
const MANTLE_TIP_DROP = 0.16;
/** How far the cape draws in between its points and its hem. */
const MANTLE_HEM_FLARE = 0.7;
/** A shallow rise across the collar, so it is not a straight cut at the neck. */
const MANTLE_COLLAR_RISE = 0.02;
/** How far across the hem the darker trim band runs. */
const MANTLE_TRIM_SPAN = 0.6;
/** How far down its side the cape bulges, so its edge is not a straight cut. */
const MANTLE_SIDE_BULGE = 0.45;
/** The lit top plane: how wide it runs and how far down the cape it reaches. */
const MANTLE_TOP_SPAN = 0.88;
const MANTLE_TOP_DEPTH = 0.05;
const MANTLE_TOP_INSET = 0.012;
/** The centre seam and its two flanking folds, as fractions of the cape's half-width. */
const MANTLE_SEAM_OFFSETS: readonly number[] = [0, -0.5, 0.5];
const MANTLE_SEAM_WIDTH = 0.012;
const MANTLE_SEAM_TOP_GAP = 0.03;
const MANTLE_SEAM_SPLAY = 0.35;
/** How far down toward the hem a seam runs, as a fraction of the cape's height. */
const MANTLE_SEAM_REACH = 0.86;
/** How far the mantle's collar trails the body at full lag. */
const MANTLE_LAG_TRAVEL = 0.03;
/** How much of the cape's lag the whole garment takes, rather than its collar. */
const MANTLE_BODY_LAG_SHARE = 0.7;
/** How far the whole hood trails the body at full lag. */
const HOOD_LAG_TRAVEL = 0.045;
/** How far a full head-turn slides the cowl opening across the hood. */
const COWL_TURN_TRAVEL = 0.06;

/**
 * The shoulder cape. It is what makes the hood read as part of a garment rather
 * than as a bag over his head: without a mantle the hood's lower edge has
 * nothing to land on and floats above the shoulders.
 */
function drawMantle(ctx: Ctx, skel: ShadySkeleton, pose: ShadyPose): void {
  const lag = pose.hoodLag * MANTLE_LAG_TRAVEL;
  // The whole cape trails, not just its collar. Applying the lag to the control
  // points alone left the cape measuring dead in phase with the shoulders — a
  // rigid shell, when it is the one garment on him that is obviously cloth.
  const sx = skel.shoulderCentre.x + lag * MANTLE_BODY_LAG_SHARE;
  const topY = MANTLE_TOP_Y + (skel.hipCentre.y - HIP_Y);
  const hemY = MANTLE_HEM_Y + (skel.hipCentre.y - HIP_Y);

  // The outer ends sit well below the collar, so the top edge is two slopes
  // rather than one flat run. A level top on a cape this wide reads as a
  // countertop, and it was the second-largest reason the first bake named as an
  // obelisk.
  const collarHalf = MANTLE_HALF * MANTLE_COLLAR_FRACTION;
  const tipY = topY + MANTLE_TIP_DROP;
  ctx.beginPath();
  ctx.moveTo(sx - collarHalf + lag, topY);
  // Curved into the shoulder point rather than cornered at it: a straight run
  // out to the tip left a triangular spur at each upper corner that read as a
  // broken pixel, and detached outright when the arm swung away from it.
  ctx.quadraticCurveTo(sx - MANTLE_HALF + lag, topY + MANTLE_SHOULDER_DROP, sx - MANTLE_HALF, tipY);
  ctx.quadraticCurveTo(
    sx - MANTLE_HALF,
    lerp(tipY, hemY, MANTLE_SIDE_BULGE),
    sx - MANTLE_HALF * MANTLE_HEM_FLARE,
    hemY,
  );
  ctx.quadraticCurveTo(sx, hemY + MANTLE_HEM_DIP, sx + MANTLE_HALF * MANTLE_HEM_FLARE, hemY);
  ctx.quadraticCurveTo(
    sx + MANTLE_HALF,
    lerp(tipY, hemY, MANTLE_SIDE_BULGE),
    sx + MANTLE_HALF,
    tipY,
  );
  ctx.quadraticCurveTo(sx + MANTLE_HALF + lag, topY + MANTLE_SHOULDER_DROP, sx + collarHalf + lag, topY);
  ctx.quadraticCurveTo(sx + lag, topY - MANTLE_COLLAR_RISE, sx - collarHalf + lag, topY);
  ctx.closePath();
  strokeAndFill(ctx, MANTLE_MID);

  // The cape's own top plane. Without it the whole cape bakes at a single
  // luminance — one flat value across its entire area — and reads as a pancake
  // glued to his shoulders rather than as cloth lying over them.
  ctx.beginPath();
  ctx.moveTo(sx - collarHalf + lag, topY + MANTLE_TOP_INSET);
  ctx.quadraticCurveTo(
    sx - MANTLE_HALF * MANTLE_TOP_SPAN + lag,
    topY + MANTLE_SHOULDER_DROP,
    sx - MANTLE_HALF * MANTLE_TOP_SPAN,
    tipY - MANTLE_TOP_DEPTH,
  );
  ctx.lineTo(sx + MANTLE_HALF * MANTLE_TOP_SPAN, tipY - MANTLE_TOP_DEPTH);
  ctx.quadraticCurveTo(
    sx + MANTLE_HALF * MANTLE_TOP_SPAN + lag,
    topY + MANTLE_SHOULDER_DROP,
    sx + collarHalf + lag,
    topY + MANTLE_TOP_INSET,
  );
  ctx.closePath();
  ctx.fillStyle = MANTLE_TOP;
  ctx.fill();

  const trimHalf = MANTLE_HALF * MANTLE_TRIM_SPAN;
  ctx.beginPath();
  ctx.moveTo(sx - trimHalf, hemY + MANTLE_HEM_DIP * MANTLE_TRIM_SPAN);
  ctx.quadraticCurveTo(sx, hemY + MANTLE_HEM_DIP, sx + trimHalf, hemY + MANTLE_HEM_DIP * MANTLE_TRIM_SPAN);
  ctx.lineTo(sx + trimHalf, hemY + MANTLE_HEM_DIP * MANTLE_TRIM_SPAN - MANTLE_TRIM);
  ctx.quadraticCurveTo(
    sx,
    hemY + MANTLE_HEM_DIP - MANTLE_TRIM,
    sx - trimHalf,
    hemY + MANTLE_HEM_DIP * MANTLE_TRIM_SPAN - MANTLE_TRIM,
  );
  ctx.closePath();
  ctx.fillStyle = MANTLE_DARK;
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(sx - MANTLE_HALF * MANTLE_HEM_FLARE, hemY);
  ctx.quadraticCurveTo(sx, hemY + MANTLE_HEM_DIP, sx + MANTLE_HALF * MANTLE_HEM_FLARE, hemY);
  ctx.stroke();
  ctx.strokeStyle = '#00ffff';
  ctx.beginPath();
  ctx.moveTo(sx - MANTLE_HALF, hemY + MANTLE_HEM_DIP);
  ctx.lineTo(sx + MANTLE_HALF, hemY + MANTLE_HEM_DIP);
  ctx.stroke();
  ctx.restore();

  // A centre seam and one fold either side of it. Without them the lit plane
  // bakes as a single hard-edged pale ellipse across his chest, and at a 32px
  // tile that oval — not the hood, not the coat — is the shape the eye takes
  // first: a blind review read it as a bib, a carapace and a shield.
  ctx.strokeStyle = MANTLE_DARK;
  ctx.lineWidth = MANTLE_SEAM_WIDTH;
  ctx.setLineDash([]);
  const flareHalf = MANTLE_HALF * MANTLE_HEM_FLARE;
  for (const offset of MANTLE_SEAM_OFFSETS) {
    const seamX = sx + MANTLE_HALF * offset;
    const endX = seamX + MANTLE_HALF * offset * MANTLE_SEAM_SPLAY;
    // The hem is a quadratic that only reaches its full dip at the centre, so a
    // seam ending at a flat `hemY + dip` runs straight past the cape's own edge
    // and finishes on the coat at belt height. Ending on the curve — and short
    // of it — keeps every seam inside the cloth it is a seam in.
    const hemAtX = hemY + MANTLE_HEM_DIP * hemDipFactor(endX - sx, flareHalf);
    ctx.beginPath();
    ctx.moveTo(seamX, topY + MANTLE_TOP_INSET + MANTLE_SEAM_TOP_GAP);
    ctx.lineTo(endX, lerp(topY, hemAtX, MANTLE_SEAM_REACH));
    ctx.stroke();
  }
}

/**
 * How far the cape's hem has actually dropped at a given distance from its
 * centreline, as a fraction of `MANTLE_HEM_DIP`.
 *
 * The hem is a quadratic Bézier across the flare points with its control point
 * at the full dip — and a quadratic only ever reaches **half** its control
 * point's offset. Solving the curve (`x = f(2u−1)`, `y = dip·2u(1−u)`) gives
 * `2u(1−u) = (1 − t²) / 2`. Using `1 − t²` on its own overstates the drop by
 * exactly 2× everywhere, which puts anything meant to land on the hem below it.
 */
const BEZIER_PEAK_OF_CONTROL = 0.5;
function hemDipFactor(offsetFromCentre: number, flareHalf: number): number {
  if (flareHalf <= 0) return 0;
  const t = clamp01(Math.abs(offsetFromCentre) / flareHalf);
  return BEZIER_PEAK_OF_CONTROL * (1 - t * t);
}

/** How far down the hood's sides the jaw line sits, as a fraction of its radius. */
const HOOD_JAW_RATIO = 0.55;
/** The crown peak leans back rather than standing centred. */
const HOOD_PEAK_OFFSET = 0.06;
const HOOD_PEAK_TILT = 0.55;
const HOOD_BACK_RATIO = 0.6;
/** How far the hood's back drapes out over the shoulder before it lands. */
const HOOD_DRAPE_BULGE = 1.16;
/** The lit band down the crown, as fractions of the hood's own radii. */
const HOOD_BAND_INNER = 0.3;
const HOOD_BAND_OUTER = 0.86;
const HOOD_BAND_TOP = 0.72;
const HOOD_BAND_BOTTOM = 0.45;
/** How far the shadowed rim stands proud of the opening it surrounds. */
const COWL_RIM_SPREAD = 1.26;
/** How far up into the opening the neck shadow starts, so the two never gap. */
const NECK_SHADOW_OVERLAP = 0.55;
/** How far below the opening the neck shadow reaches, and how much it narrows. */
const NECK_SHADOW_DROP = 0.11;
const NECK_SHADOW_TAPER = 0.62;

/**
 * The hood and the void inside it.
 *
 * Painted as four shapes: the shell, one flat lit band, a shadowed inner rim,
 * and the void. Two properties are load-bearing and both came out of a blind
 * review of the first bake:
 *
 * - **The shading is banded, not a gradient.** The first hood was a smooth
 *   radial falloff with a specular hotspot at twice its own base value, and it
 *   read as a motorcycle helmet standing next to a shelf of baked pixel sheets.
 * - **The void opens downward.** A dark ellipse with cloth on all four sides is
 *   a black disc stuck on a shape — and, worse, the lit lip drawn back over its
 *   top turned into a forehead, which made the rest of the darkness a mouth.
 *   A real cowl is open at the bottom: the darkness runs off the hood's lower
 *   edge into the shadow at his neck, so the shape is a U and never a face.
 */
function drawHood(ctx: Ctx, skel: ShadySkeleton, pose: ShadyPose): void {
  const lag = pose.hoodLag * HOOD_LAG_TRAVEL;
  const cx = skel.headCentre.x + lag;
  const cy = skel.headCentre.y;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pose.headTilt);

  // Shell: a rounded crown that drapes back over the shoulder rather than
  // meeting it in a notch — the notch is what made the first bake a shark fin.
  ctx.beginPath();
  ctx.moveTo(-HOOD_RX, HOOD_RY * HOOD_JAW_RATIO);
  ctx.quadraticCurveTo(-HOOD_RX, -HOOD_RY, -HOOD_PEAK_OFFSET, -HOOD_RY - HOOD_PEAK_LIFT);
  ctx.quadraticCurveTo(
    HOOD_PEAK_OFFSET,
    -HOOD_RY - HOOD_PEAK_LIFT * HOOD_PEAK_TILT,
    HOOD_RX,
    -HOOD_RY * HOOD_BACK_RATIO,
  );
  ctx.quadraticCurveTo(HOOD_RX * HOOD_DRAPE_BULGE, HOOD_RY * HOOD_JAW_RATIO, HOOD_RX, HOOD_RY);
  ctx.lineTo(-HOOD_RX, HOOD_RY);
  ctx.closePath();
  strokeAndFill(ctx, HOOD_MID);

  // One flat lit band down the crown, on the same side as the cloak's lit edge.
  ctx.beginPath();
  ctx.moveTo(HOOD_RX * HOOD_BAND_INNER, -HOOD_RY * HOOD_BAND_TOP);
  ctx.quadraticCurveTo(
    HOOD_RX * HOOD_BAND_OUTER,
    -HOOD_RY * HOOD_BAND_TOP,
    HOOD_RX * HOOD_BAND_OUTER,
    HOOD_RY * HOOD_BAND_BOTTOM,
  );
  ctx.lineTo(HOOD_RX * HOOD_BAND_INNER, HOOD_RY * HOOD_BAND_BOTTOM);
  ctx.closePath();
  ctx.fillStyle = HOOD_LIGHT;
  ctx.fill();

  const openX = pose.headTurn * COWL_TURN_TRAVEL;

  // Shadowed rim, drawn under the void so the cloth turns into the opening
  // instead of ending at it. Under, never over: a lip painted on top of the
  // darkness is the forehead that a blind review read as a face.
  ctx.beginPath();
  ctx.ellipse(
    openX,
    COWL_FORWARD,
    COWL_RX * COWL_RIM_SPREAD,
    COWL_RY * COWL_RIM_SPREAD,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = HOOD_RIM;
  ctx.fill();

  // The void: an arch, closed across the top by the brow and running straight
  // off the hood's lower edge. Flat fill, no stroke, no gradient.
  ctx.beginPath();
  ctx.moveTo(openX - COWL_RX, COWL_FORWARD + COWL_RY);
  ctx.quadraticCurveTo(openX - COWL_RX, COWL_FORWARD - COWL_RY, openX, COWL_FORWARD - COWL_RY);
  ctx.quadraticCurveTo(openX + COWL_RX, COWL_FORWARD - COWL_RY, openX + COWL_RX, COWL_FORWARD + COWL_RY);
  ctx.closePath();
  ctx.fillStyle = COWL_VOID;
  ctx.fill();

  ctx.restore();

  // The shadow the opening runs down into, painted in world space so it is not
  // carried around by the hood's own tilt.
  ctx.beginPath();
  ctx.moveTo(cx - COWL_RX, cy + COWL_FORWARD + COWL_RY * NECK_SHADOW_OVERLAP);
  ctx.lineTo(cx + COWL_RX, cy + COWL_FORWARD + COWL_RY * NECK_SHADOW_OVERLAP);
  ctx.lineTo(cx + COWL_RX * NECK_SHADOW_TAPER, cy + COWL_FORWARD + NECK_SHADOW_DROP);
  ctx.lineTo(cx - COWL_RX * NECK_SHADOW_TAPER, cy + COWL_FORWARD + NECK_SHADOW_DROP);
  ctx.closePath();
  ctx.fillStyle = NECK_SHADOW;
  ctx.fill();
}

/**
 * Paints Shady, head-on. One view: he stands at a fixed spot facing the plaza
 * and never turns, so a profile and a back would be three times the art for
 * frames nothing can reach.
 */
export function drawShady(ctx: Ctx, pose: ShadyPose): void {
  const skel = buildSkeleton(pose);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Draw order is the depth order: anything flagged `behind` goes down before
  // the body, everything else over it.
  if (pose.leftHandBehind) drawArm(ctx, skel.leftArm, pose.leftFist, -1);
  if (pose.rightHandBehind) drawArm(ctx, skel.rightArm, pose.rightFist, 1);

  drawBoots(ctx, skel);
  drawCloak(ctx, skel, pose);
  drawBelt(ctx, skel);

  if (!pose.leftHandBehind && !pose.leftArmOverMantle) drawArm(ctx, skel.leftArm, pose.leftFist, -1);
  if (!pose.rightHandBehind && !pose.rightArmOverMantle)
    drawArm(ctx, skel.rightArm, pose.rightFist, 1);

  drawMantle(ctx, skel, pose);

  if (!pose.leftHandBehind && pose.leftArmOverMantle) drawArm(ctx, skel.leftArm, pose.leftFist, -1);
  if (!pose.rightHandBehind && pose.rightArmOverMantle)
    drawArm(ctx, skel.rightArm, pose.rightFist, 1);

  drawHood(ctx, skel, pose);
}

/**
 * Where the cowl's void sits for a given pose, in tile units. The bake gate
 * samples this region and asserts it is genuinely black — the one property of
 * this figure that the plan calls out as non-negotiable, and the one a later
 * palette tweak could quietly undo.
 */
/** Sampled a little low in the arch, where the opening is at its deepest. */
const COWL_SAMPLE_DROP = 0.3;
/**
 * The window is inset further vertically than horizontally because the arch
 * closes overhead: a window as tall as it is wide puts its upper corners
 * outside the opening entirely, and the gate then measures the hood's own rim
 * rather than the void it is meant to be watching.
 */
const COWL_SAMPLE_INSET_X = 0.55;
const COWL_SAMPLE_INSET_Y = 0.45;

export function cowlWindow(pose: ShadyPose): { cx: number; cy: number; rx: number; ry: number } {
  const skel = buildSkeleton(pose);
  const lag = pose.hoodLag * HOOD_LAG_TRAVEL;
  const openX = pose.headTurn * COWL_TURN_TRAVEL;
  // Sampled well inside the opening: its rim is antialiased against the hood,
  // and a sample on the rim measures the blend, not the void.
  return {
    cx: skel.headCentre.x + lag + openX,
    cy: skel.headCentre.y + COWL_FORWARD + COWL_RY * COWL_SAMPLE_DROP,
    rx: COWL_RX * COWL_SAMPLE_INSET_X,
    ry: COWL_RY * COWL_SAMPLE_INSET_Y,
  };
}


