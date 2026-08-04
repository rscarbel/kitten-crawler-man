/**
 * Drawing engine for Grimaldi's corrupted circus performers — the Fat Clown,
 * the Stilt Clown, Terror the Clown and the Evil Clown.
 *
 * Three viewpoints share the one rig (see {@link ClownView}). The skeleton is
 * identical in all three — a head-on figure's "near" limb is simply its right
 * one — so only the head painter, the depth shading and the way a spine lean
 * foreshortens differ. The troupe's original three clowns predate the views and
 * bake as `'profile'`, which is the default and is bit-for-bit what they were.
 *
 * All three share one skeletal rig so their silhouettes read as members of the
 * same troupe: a pelvis, a leaning spine, a head on a neck, and four two-bone
 * limbs solved by inverse kinematics from foot/hand targets. Solving the limbs
 * from targets rather than from raw joint angles is what keeps hands and feet
 * where the animation wants them while the elbow and knee stay attached — the
 * previous hand-drawn clowns posed each segment independently, which is why
 * their limbs floated away from the body.
 *
 * Everything here works in *tile units*: 1.0 is one dungeon tile. The caller
 * scales into pixels once, so a sheet can be regenerated at any resolution.
 * The figure stands on the origin: (0, 0) is the point between its feet, +X is
 * the direction it faces and -Y is up.
 *
 * Glow is painted with radial gradients rather than `shadowBlur` because shadow
 * blur is measured in device pixels and would not survive the caller's scale.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

export interface Point {
  readonly x: number;
  readonly y: number;
}

const FULL_CIRCLE = Math.PI * 2;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0→1 ease used for weight shifts and one-shot swings. */
export function easeInOut(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Fast start, slow finish — used where a limb is thrown and then settles. */
export function easeOut(t: number): number {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) * (1 - clamped);
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotatePoint(p: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function offset(base: Point, dx: number, dy: number): Point {
  return { x: base.x + dx, y: base.y + dy };
}

// ── Two-bone inverse kinematics ──────────────────────────────────────────────

/**
 * Keeps a solved chain from locking dead straight, which reads as a broken
 * limb and makes the joint direction flip unpredictably between frames.
 */
const IK_REACH_MARGIN = 0.995;
/** Matching floor on how far the target may fold back toward the anchor. */
const IK_FOLD_MARGIN = 1.05;

interface BoneChain {
  readonly anchor: Point;
  readonly joint: Point;
  readonly end: Point;
}

/**
 * Solve a two-segment limb so its end lands on (or as near as it can reach to)
 * `target`.
 *
 * @param bendSign +1 puts the joint on the +X side of the anchor→target line
 *   (a knee for a figure facing +X), -1 puts it on the -X side (an elbow).
 */
function solveTwoBone(
  anchor: Point,
  target: Point,
  upperLength: number,
  lowerLength: number,
  bendSign: number,
): BoneChain {
  const maxReach = (upperLength + lowerLength) * IK_REACH_MARGIN;
  const minReach = Math.abs(upperLength - lowerLength) * IK_FOLD_MARGIN;
  const rawSpan = distance(anchor, target);
  const span = Math.min(maxReach, Math.max(minReach, rawSpan));

  const toTarget = Math.atan2(target.y - anchor.y, target.x - anchor.x);
  const cosJointAngle =
    (upperLength * upperLength + span * span - lowerLength * lowerLength) /
    (2 * upperLength * span);
  const jointAngle = Math.acos(Math.min(1, Math.max(-1, cosJointAngle)));
  const upperAngle = toTarget - bendSign * jointAngle;

  const joint = {
    x: anchor.x + Math.cos(upperAngle) * upperLength,
    y: anchor.y + Math.sin(upperAngle) * upperLength,
  };
  const end = {
    x: anchor.x + Math.cos(toTarget) * span,
    y: anchor.y + Math.sin(toTarget) * span,
  };
  return { anchor, joint, end };
}

/** Direction the limb's lower segment points, for orienting a hand or foot. */
function segmentAngle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Limb rendering ───────────────────────────────────────────────────────────

/**
 * A tapered capsule: a quad between the two end circles plus the circles
 * themselves. Drawing the joint caps as full discs is what guarantees adjacent
 * segments stay visually welded no matter how sharply the limb bends.
 */
function fillCapsule(
  ctx: Ctx,
  a: Point,
  b: Point,
  radiusA: number,
  radiusB: number,
  color: string,
): void {
  const angle = segmentAngle(a, b);
  const normalX = -Math.sin(angle);
  const normalY = Math.cos(angle);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x + normalX * radiusA, a.y + normalY * radiusA);
  ctx.lineTo(b.x + normalX * radiusB, b.y + normalY * radiusB);
  ctx.lineTo(b.x - normalX * radiusB, b.y - normalY * radiusB);
  ctx.lineTo(a.x - normalX * radiusA, a.y - normalY * radiusA);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(a.x, a.y, radiusA, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(b.x, b.y, radiusB, 0, FULL_CIRCLE);
  ctx.fill();
}

/** Limbs taper toward the wrist/ankle by this fraction of their root width. */
const LIMB_TAPER = 0.78;
/** Dark silhouette drawn under every limb, as a fraction of the limb width. */
const LIMB_OUTLINE_FRACTION = 0.16;
/** Sheen runs down the upper-left of each segment at this fraction of width. */
const LIMB_SHEEN_FRACTION = 0.3;
const LIMB_SHEEN_OFFSET = 0.22;

interface LimbPaint {
  readonly fill: string;
  readonly outline: string;
  readonly sheen: string | null;
}

/**
 * Draw a solved chain as one continuous outlined, tapered, shaded limb.
 *
 * `lowerPaint` repaints the segment past the joint, which is how a stilt clown
 * gets suit-coloured thighs on bare wooden poles.
 */
function drawLimb(
  ctx: Ctx,
  chain: BoneChain,
  rootWidth: number,
  paint: LimbPaint,
  lowerPaint: LimbPaint = paint,
): void {
  const rootRadius = rootWidth / 2;
  const jointRadius = rootRadius * LIMB_TAPER;
  const endRadius = jointRadius * LIMB_TAPER;
  const outlineGrowth = rootWidth * LIMB_OUTLINE_FRACTION;

  fillCapsule(
    ctx,
    chain.anchor,
    chain.joint,
    rootRadius + outlineGrowth,
    jointRadius + outlineGrowth,
    paint.outline,
  );
  fillCapsule(
    ctx,
    chain.joint,
    chain.end,
    jointRadius + outlineGrowth,
    endRadius + outlineGrowth,
    paint.outline,
  );

  fillCapsule(ctx, chain.anchor, chain.joint, rootRadius, jointRadius, paint.fill);
  fillCapsule(ctx, chain.joint, chain.end, jointRadius, endRadius, lowerPaint.fill);

  if (paint.sheen === null) return;
  const sheenShift = rootWidth * LIMB_SHEEN_OFFSET;
  const sheenA = offset(chain.anchor, -sheenShift, 0);
  const sheenB = offset(chain.joint, -sheenShift, 0);
  fillCapsule(
    ctx,
    sheenA,
    sheenB,
    rootRadius * LIMB_SHEEN_FRACTION,
    jointRadius * LIMB_SHEEN_FRACTION,
    paint.sheen,
  );
}

// ── Style description ────────────────────────────────────────────────────────

export interface ClownPalette {
  readonly suitLight: string;
  readonly suitMid: string;
  readonly suitDark: string;
  readonly suitTrim: string;
  readonly suitFar: string;
  /** Translucent sheen laid along the top edge of each near limb. */
  readonly limbSheen: string;
  readonly accent: string;
  readonly ruff: string;
  readonly ruffShade: string;
  readonly skin: string;
  readonly skinShade: string;
  readonly paint: string;
  readonly paintShade: string;
  readonly paintMark: string;
  readonly mouthFill: string;
  readonly mouthDark: string;
  readonly teeth: string;
  readonly hair: string;
  readonly hairShade: string;
  readonly shoe: string;
  readonly shoeDark: string;
  readonly nose: string;
  readonly noseHighlight: string;
  readonly eyeCore: string;
  readonly eyeGlow: string;
  readonly outline: string;
}

/**
 * Skeleton lengths in tile units. Hip height is derived from the leg bones by
 * {@link groundedHipHeight} so the feet always reach the floor.
 */
export interface ClownProportions {
  readonly torsoLength: number;
  readonly shoulderHalfWidth: number;
  readonly hipHalfWidth: number;
  readonly bellyBulge: number;
  readonly neckLength: number;
  readonly headRadius: number;
  readonly headWidthFactor: number;
  readonly thighLength: number;
  readonly shinLength: number;
  readonly upperArmLength: number;
  readonly forearmLength: number;
  readonly legWidth: number;
  readonly armWidth: number;
  readonly handRadius: number;
  readonly shoeLength: number;
  readonly shoeHeight: number;
}

export type HairStyle = 'tufts' | 'stringy' | 'mane' | 'lank';
export type MouthStyle = 'grin' | 'stitched' | 'fanged' | 'rictus';
export type FacePaintStyle = 'rouge' | 'tears' | 'slashes' | 'sockets';
export type SuitPattern = 'stripes' | 'harlequin' | 'motley';
export type FootStyle = 'shoes' | 'stilts';
export type HatStyle = 'none' | 'cone';

/**
 * Which way the figure is turned relative to the camera.
 *
 * `'profile'` is the original three-quarter view every clown was drawn in: the
 * body faces +X and the runtime mirrors the sheet for the other heading.
 * `'toward'` and `'away'` are head-on, and are never mirrored at runtime — a
 * flipped front view puts the figure's left hand on its right side every time
 * it changes heading.
 */
export type ClownView = 'profile' | 'toward' | 'away';

export interface ClownStyle {
  readonly palette: ClownPalette;
  readonly proportions: ClownProportions;
  readonly hair: HairStyle;
  readonly mouth: MouthStyle;
  readonly facePaint: FacePaintStyle;
  readonly pattern: SuitPattern;
  readonly feet: FootStyle;
  readonly hat: HatStyle;
  /** Radius of the ruff collar; 0 draws no collar. */
  readonly ruffRadius: number;
  /** Pompom buttons running down the front of the suit. */
  readonly pompomCount: number;
  /**
   * How far up the neck the ruff sits, as a fraction of the neck's length.
   * 0 leaves it on the shoulders (the default, and where a short-necked clown
   * wants it); 1 pushes it up under the jaw, which is the only place it reads
   * as a collar rather than as a platter on a long neck.
   */
  readonly ruffRise?: number;
  /** Optional per-style tweaks to the shared face layout; omit for the default. */
  readonly face?: ClownFaceTuning;
}

/**
 * Deviations from the shared face layout, as multiples of the default.
 *
 * The layout constants below are tuned for a clown whose head is a prop; a
 * figure meant to be frightening needs a smaller nose and larger eyes on the
 * same skull. Every field is optional and every default is 1 or 0, so a style
 * that omits this is drawn exactly as it was before the hook existed.
 */
export interface ClownFaceTuning {
  readonly eyeScale?: number;
  readonly noseScale?: number;
  /** Extra drop of the mouth down the face, in head radii. */
  readonly mouthDrop?: number;
}

const DEFAULT_FACE_TUNING: Required<ClownFaceTuning> = {
  eyeScale: 1,
  noseScale: 1,
  mouthDrop: 0,
};

function faceTuningOf(style: ClownStyle): Required<ClownFaceTuning> {
  return { ...DEFAULT_FACE_TUNING, ...style.face };
}

/**
 * How much of the leg's length a planted stance uses up. Short of 1 so the
 * knee keeps a visible bend — a leg solved dead straight reads as broken and
 * lets the knee flip sides between frames.
 */
const STANDING_LEG_EXTENSION = 0.94;

/**
 * Hip height for a planted stance, measured to the ground the figure stands on.
 *
 * The foot targets in a {@link ClownPose} are ground-level, but the ankle rides
 * one shoe-height above them (see {@link ankleTarget}), so the leg only ever has
 * to span `(thigh + shin) * STANDING_LEG_EXTENSION`. Folding the shoe into this
 * height without that lift would put every foot target outside the leg's reach,
 * and the IK would quietly replace the authored gait with an arc at max reach.
 */
export function groundedHipHeight(proportions: ClownProportions): number {
  return (
    (proportions.thighLength + proportions.shinLength) * STANDING_LEG_EXTENSION +
    proportions.shoeHeight
  );
}

/** Where the ankle goes for a foot planted at `target`. */
function ankleTarget(target: Point, proportions: ClownProportions): Point {
  return offset(target, 0, -proportions.shoeHeight);
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * A single animation frame. Foot and hand targets are in the same ground space
 * as the figure (origin between the feet, -Y up); the rig solves the knees and
 * elbows to reach them.
 */
export interface ClownPose {
  /** Vertical travel of the whole body; negative lifts the figure. */
  readonly bob: number;
  /** Horizontal pelvis shift, the weight transfer of a stride. */
  readonly sway: number;
  /** Spine tilt in radians; positive leans into the facing direction. */
  readonly lean: number;
  readonly nearFoot: Point;
  readonly farFoot: Point;
  readonly nearHand: Point;
  readonly farHand: Point;
  /** Extra rotation applied to whatever the near hand is holding. */
  readonly wristTwist: number;
  readonly headTilt: number;
  /** Forward push of the head beyond the spine, for leading with the face. */
  readonly headLead: number;
  readonly mouthOpen: number;
  /** 0 dims the eyes to embers, 1 is the full aggressive burn. */
  readonly eyeGlow: number;
  /** Vertical scale of the torso, for breathing and impact squash. */
  readonly torsoSquash: number;
  /**
   * Draw whatever the clown is holding behind the body instead of in front of
   * it — a mallet hauled back over the shoulder passes behind the head, and
   * drawing it in front would paint it over the face.
   */
  readonly propBehind: boolean;
}

/** Height of the shoulder line above the ground in a standing pose. */
export function shoulderHeight(proportions: ClownProportions): number {
  return groundedHipHeight(proportions) + proportions.torsoLength;
}

/** How much of the arm's length is used up when it hangs slack at the side. */
const ARM_HANG_EXTENSION = 0.9;
const STANCE_HALF_WIDTH_FRACTION = 0.5;
/** Hands rest clear of the hips so both arms stay readable against the body. */
const HAND_CLEARANCE_FRACTION = 0.7;
const RESTING_EYE_GLOW = 0.5;

/** A relaxed standing pose; animations spread from this by overriding fields. */
export function restingPose(style: ClownStyle): ClownPose {
  const { proportions } = style;
  const stance = proportions.hipHalfWidth * STANCE_HALF_WIDTH_FRACTION;
  const armLength = proportions.upperArmLength + proportions.forearmLength;
  const handY = -shoulderHeight(proportions) + armLength * ARM_HANG_EXTENSION;
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    nearFoot: { x: stance, y: 0 },
    farFoot: { x: -stance, y: 0 },
    nearHand: {
      x: proportions.hipHalfWidth + proportions.armWidth * HAND_CLEARANCE_FRACTION,
      y: handY,
    },
    farHand: {
      x: -(proportions.hipHalfWidth + proportions.armWidth * HAND_CLEARANCE_FRACTION),
      y: handY,
    },
    wristTwist: 0,
    headTilt: 0,
    headLead: 0,
    mouthOpen: 0,
    eyeGlow: RESTING_EYE_GLOW,
    torsoSquash: 1,
    propBehind: false,
  };
}

// ── Body parts ───────────────────────────────────────────────────────────────

const SHADOW_INNER = 'rgba(0,0,0,0.5)';
const SHADOW_OUTER = 'rgba(0,0,0,0)';
const SHADOW_HEIGHT_FRACTION = 0.28;

function drawGroundShadow(ctx: Ctx, radius: number): void {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, SHADOW_INNER);
  gradient.addColorStop(1, SHADOW_OUTER);
  ctx.save();
  ctx.scale(1, SHADOW_HEIGHT_FRACTION);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();
}

/** Oversized clown shoe, drawn from the ankle with the toe leading. */
const SHOE_HEEL_FRACTION = 0.3;
const SHOE_TOE_LIFT = 0.35;
const SHOE_SPAT_FRACTION = 0.5;

function drawShoe(ctx: Ctx, ankle: Point, angle: number, style: ClownStyle): void {
  const { shoeLength, shoeHeight } = style.proportions;
  const heel = -shoeLength * SHOE_HEEL_FRACTION;
  const toe = shoeLength * (1 - SHOE_HEEL_FRACTION);

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(angle);

  ctx.fillStyle = style.palette.shoeDark;
  ctx.beginPath();
  ctx.moveTo(heel, 0);
  ctx.quadraticCurveTo(heel, shoeHeight, heel + toe * SHOE_TOE_LIFT, shoeHeight);
  ctx.lineTo(toe, shoeHeight);
  ctx.quadraticCurveTo(toe * 1.05, shoeHeight * 0.2, toe * 0.72, -shoeHeight * SHOE_TOE_LIFT);
  ctx.quadraticCurveTo(toe * 0.3, -shoeHeight * 0.55, heel, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = style.palette.shoe;
  ctx.beginPath();
  ctx.moveTo(heel * 0.8, shoeHeight * 0.1);
  ctx.quadraticCurveTo(toe * 0.4, -shoeHeight * SHOE_SPAT_FRACTION, toe * 0.72, -shoeHeight * 0.05);
  ctx.quadraticCurveTo(toe * 0.5, shoeHeight * 0.5, heel * 0.8, shoeHeight * 0.1);
  ctx.closePath();
  ctx.fill();

  // A lighter welt along the sole reads as "shoe" rather than "shadow" once the
  // sprite is down at tile size.
  const SOLE_INSET = 0.9;
  const SOLE_HEIGHT = 0.18;
  ctx.fillStyle = style.palette.suitTrim;
  ctx.fillRect(
    heel * SOLE_INSET,
    shoeHeight * 0.7,
    (toe - heel) * SOLE_INSET,
    shoeHeight * SOLE_HEIGHT,
  );

  ctx.fillStyle = style.palette.accent;
  ctx.beginPath();
  ctx.arc(heel * 0.2, -shoeHeight * 0.3, shoeHeight * 0.26, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.restore();
}

/**
 * The same shoe seen end-on: a wide splayed blob rather than a long wedge.
 *
 * Rotating the profile shoe by a right angle was the obvious alternative and is
 * wrong — it draws a long shoe running *down* the screen, which reads as an
 * enormous foot dangling in the air instead of one pointing at the camera.
 */
const HEADON_SHOE_WIDTH_FRACTION = 0.66;
const HEADON_SHOE_HEIGHT_FRACTION = 1.5;
const HEADON_SHOE_SOLE_FRACTION = 0.26;
const HEADON_TOECAP_WIDTH = 0.62;
const HEADON_TOECAP_HEIGHT = 0.5;

function drawShoeHeadOn(ctx: Ctx, ankle: Point, style: ClownStyle, view: ClownView): void {
  const { shoeLength, shoeHeight } = style.proportions;
  const halfWidth = shoeLength * HEADON_SHOE_WIDTH_FRACTION * 0.5;
  const height = shoeHeight * HEADON_SHOE_HEIGHT_FRACTION;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);

  ctx.fillStyle = style.palette.shoeDark;
  ctx.beginPath();
  ctx.ellipse(0, height * 0.35, halfWidth, height * 0.85, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = style.palette.suitTrim;
  ctx.fillRect(-halfWidth, height * 0.85, halfWidth * 2, height * HEADON_SHOE_SOLE_FRACTION);

  // Only the front of a shoe has a cap and a pompom; the heel is a plain lump.
  if (view === 'toward') {
    ctx.fillStyle = style.palette.shoe;
    ctx.beginPath();
    ctx.ellipse(
      0,
      height * 0.2,
      halfWidth * HEADON_TOECAP_WIDTH,
      height * HEADON_TOECAP_HEIGHT,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();

    ctx.fillStyle = style.palette.accent;
    ctx.beginPath();
    ctx.arc(0, -height * 0.35, shoeHeight * 0.26, 0, FULL_CIRCLE);
    ctx.fill();
  }

  ctx.restore();
}

/** Wooden stilt tip: a peg on a wedge foot, strapped to the shin. */
const STILT_PEG_WIDTH = 0.055;
const STILT_FOOT_WIDTH = 0.16;
/**
 * Height of the stilt's wedge, as a multiple of `shoeHeight`. Derived rather
 * than given its own number because `ankleTarget` lifts the ankle by exactly
 * `shoeHeight`: an independent constant here would let the peg drift off the
 * floor the moment either value was tuned.
 */
const STILT_FOOT_HEIGHT_FRACTION = 1.2;
const STILT_STRAP_HEIGHT_FRACTION = 2.2;

function drawStiltFoot(ctx: Ctx, ankle: Point, angle: number, style: ClownStyle): void {
  const footHeight = style.proportions.shoeHeight * STILT_FOOT_HEIGHT_FRACTION;
  const footTop = -footHeight * 0.2;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(angle);

  ctx.fillStyle = style.palette.shoeDark;
  ctx.fillRect(-STILT_FOOT_WIDTH / 2, footTop, STILT_FOOT_WIDTH, footHeight);
  ctx.fillStyle = style.palette.shoe;
  ctx.fillRect(-STILT_FOOT_WIDTH / 2, footTop, STILT_FOOT_WIDTH, footHeight * 0.4);
  ctx.fillStyle = style.palette.suitTrim;
  ctx.fillRect(
    -STILT_PEG_WIDTH,
    -footHeight * STILT_STRAP_HEIGHT_FRACTION,
    STILT_PEG_WIDTH * 2,
    footHeight,
  );

  ctx.restore();
}

const HAND_KNUCKLE_COUNT = 3;
const HAND_KNUCKLE_FRACTION = 0.42;

function drawHand(ctx: Ctx, at: Point, angle: number, style: ClownStyle): void {
  const { handRadius } = style.proportions;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);

  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.arc(0, 0, handRadius * 1.12, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = style.palette.paint;
  ctx.beginPath();
  ctx.arc(0, 0, handRadius, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = style.palette.paintShade;
  for (let i = 0; i < HAND_KNUCKLE_COUNT; i++) {
    const spread = (i / (HAND_KNUCKLE_COUNT - 1) - 0.5) * handRadius * 1.4;
    ctx.beginPath();
    ctx.arc(handRadius * 0.55, spread, handRadius * HAND_KNUCKLE_FRACTION, 0, FULL_CIRCLE);
    ctx.fill();
  }
  ctx.restore();
}

const TORSO_HIGHLIGHT = 'rgba(255,240,220,0.16)';
const TORSO_SHADE = 'rgba(0,0,0,0.34)';
const TORSO_TRANSPARENT = 'rgba(0,0,0,0)';
const TORSO_OUTLINE_GROWTH = 0.035;
const STRIPE_COUNT = 7;
const HARLEQUIN_COLUMNS = 4;
const HARLEQUIN_ROWS = 5;

/**
 * Torso silhouette in spine space: the hip sits at the origin and the shoulders
 * at -torsoLength, so the caller can rotate the whole path by the body lean.
 */
function traceTorso(ctx: Ctx, proportions: ClownProportions, grow: number): void {
  const hipHalf = proportions.hipHalfWidth + grow;
  const shoulderHalf = proportions.shoulderHalfWidth + grow;
  const bulge = proportions.bellyBulge;
  const top = -proportions.torsoLength;
  const HIP_ROUND = 0.35;
  const WAIST_HEIGHT = 0.4;
  const CHEST_HEIGHT = 0.78;

  ctx.beginPath();
  ctx.moveTo(-hipHalf, 0);
  ctx.bezierCurveTo(
    -hipHalf - bulge,
    top * WAIST_HEIGHT,
    -shoulderHalf - bulge * 0.35,
    top * CHEST_HEIGHT,
    -shoulderHalf,
    top,
  );
  ctx.quadraticCurveTo(0, top - proportions.shoulderHalfWidth * HIP_ROUND, shoulderHalf, top);
  ctx.bezierCurveTo(
    shoulderHalf + bulge * 0.35,
    top * CHEST_HEIGHT,
    hipHalf + bulge,
    top * WAIST_HEIGHT,
    hipHalf,
    0,
  );
  ctx.quadraticCurveTo(0, proportions.hipHalfWidth * HIP_ROUND, -hipHalf, 0);
  ctx.closePath();
}

function paintSuitPattern(ctx: Ctx, style: ClownStyle): void {
  const { proportions, palette } = style;
  const top = -proportions.torsoLength;
  const halfSpan = proportions.hipHalfWidth + proportions.bellyBulge;

  switch (style.pattern) {
    case 'stripes': {
      const stripeWidth = (halfSpan * 2) / STRIPE_COUNT;
      ctx.fillStyle = palette.suitLight;
      for (let i = 0; i < STRIPE_COUNT; i += 2) {
        ctx.fillRect(-halfSpan + i * stripeWidth, top, stripeWidth, -top);
      }
      return;
    }
    case 'harlequin': {
      const cellW = (halfSpan * 2) / HARLEQUIN_COLUMNS;
      const cellH = -top / HARLEQUIN_ROWS;
      ctx.fillStyle = palette.suitLight;
      for (let row = 0; row < HARLEQUIN_ROWS; row++) {
        for (let col = -HARLEQUIN_COLUMNS; col <= HARLEQUIN_COLUMNS; col++) {
          if ((row + col) % 2 !== 0) continue;
          const cx = col * cellW * 0.5;
          const cy = top + (row + 0.5) * cellH;
          ctx.beginPath();
          ctx.moveTo(cx, cy - cellH * 0.5);
          ctx.lineTo(cx + cellW * 0.5, cy);
          ctx.lineTo(cx, cy + cellH * 0.5);
          ctx.lineTo(cx - cellW * 0.5, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
      return;
    }
    case 'motley': {
      const PLACKET_HALF_WIDTH = 0.1;
      ctx.fillStyle = palette.suitLight;
      ctx.fillRect(0, top, halfSpan, -top);
      ctx.fillStyle = palette.suitDark;
      ctx.fillRect(-halfSpan * PLACKET_HALF_WIDTH, top, halfSpan * PLACKET_HALF_WIDTH * 2, -top);
      return;
    }
  }
}

function drawTorso(ctx: Ctx, style: ClownStyle, squash: number, headOn = false): void {
  const { proportions, palette } = style;
  const top = -proportions.torsoLength;

  ctx.save();
  ctx.scale(1, squash);

  ctx.fillStyle = palette.outline;
  traceTorso(ctx, proportions, TORSO_OUTLINE_GROWTH);
  ctx.fill();

  traceTorso(ctx, proportions, 0);
  ctx.fillStyle = palette.suitMid;
  ctx.fill();

  ctx.save();
  traceTorso(ctx, proportions, 0);
  ctx.clip();
  paintSuitPattern(ctx, style);

  // A profile chest is lit from the front and shaded toward its back edge; a
  // head-on chest is a barrel, brightest down the middle and falling off to
  // both sides.
  const shading = headOn
    ? ctx.createLinearGradient(-halfSpanOf(style), 0, halfSpanOf(style), 0)
    : ctx.createLinearGradient(-proportions.shoulderHalfWidth, top, halfSpanOf(style), 0);
  if (headOn) {
    shading.addColorStop(0, TORSO_SHADE);
    shading.addColorStop(0.38, TORSO_HIGHLIGHT);
    shading.addColorStop(0.62, TORSO_TRANSPARENT);
    shading.addColorStop(1, TORSO_SHADE);
  } else {
    shading.addColorStop(0, TORSO_HIGHLIGHT);
    shading.addColorStop(0.45, TORSO_TRANSPARENT);
    shading.addColorStop(1, TORSO_SHADE);
  }
  ctx.fillStyle = shading;
  ctx.fillRect(-halfSpanOf(style), top, halfSpanOf(style) * 2, -top);
  ctx.restore();

  const pompomRadius = proportions.shoulderHalfWidth * 0.2;
  // The button placket runs down the middle of a head-on chest; in profile it is
  // pushed toward the facing edge where it can actually be seen.
  const pompomX = headOn ? 0 : proportions.hipHalfWidth * 0.42;
  ctx.fillStyle = palette.accent;
  for (let i = 0; i < style.pompomCount; i++) {
    const t = (i + 1) / (style.pompomCount + 1);
    ctx.beginPath();
    ctx.arc(pompomX, top * (1 - t), pompomRadius, 0, FULL_CIRCLE);
    ctx.fill();
  }

  ctx.restore();
}

function halfSpanOf(style: ClownStyle): number {
  return style.proportions.hipHalfWidth + style.proportions.bellyBulge;
}

const RUFF_LOBE_COUNT = 9;
const RUFF_LOBE_FRACTION = 0.42;
const RUFF_SQUASH = 0.55;

function drawRuff(ctx: Ctx, radius: number, palette: ClownPalette): void {
  ctx.save();
  ctx.scale(1, RUFF_SQUASH);
  for (let i = 0; i < RUFF_LOBE_COUNT; i++) {
    const angle = (i / RUFF_LOBE_COUNT) * FULL_CIRCLE;
    const lobeX = Math.cos(angle) * radius;
    const lobeY = Math.sin(angle) * radius;
    ctx.fillStyle = Math.sin(angle) < 0 ? palette.ruffShade : palette.ruff;
    ctx.beginPath();
    ctx.arc(lobeX, lobeY, radius * RUFF_LOBE_FRACTION, 0, FULL_CIRCLE);
    ctx.fill();
  }
  ctx.fillStyle = palette.ruffShade;
  ctx.beginPath();
  ctx.arc(0, 0, radius * RUFF_LOBE_FRACTION, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * Face layout, as fractions of the head radius (X fractions are of the head's
 * half-width). The head is seen three-quarters on, so every feature is pushed
 * toward the facing side and the far eye is smaller and closer to the centre.
 */
const FACE_FORWARD_SHIFT = 0.12;
const BROW_WIDTH = 0.11;
const BROW_RISE = 0.34;
const BROW_LENGTH = 0.34;
const EYE_SOCKET_RX = 0.3;
const EYE_SOCKET_RY = 0.4;
const EYE_NEAR_X = 0.42;
const EYE_FAR_X = -0.18;
const EYE_Y = -0.18;
const FAR_EYE_SCALE = 0.8;
const SCLERA_FRACTION = 0.72;
const PUPIL_FRACTION = 0.36;
const EYE_GLOW_FRACTION = 2.1;
const NOSE_FRACTION = 0.27;
const NOSE_X = 0.46;
const NOSE_Y = 0.1;
const MOUTH_X = 0.18;
const MOUTH_Y = 0.44;
const MOUTH_HALF_WIDTH = 0.68;
const MOUTH_BASE_HEIGHT = 0.11;
const MOUTH_OPEN_HEIGHT = 0.32;
/** The painted lip makeup, drawn as a halo around the mouth opening. */
const LIP_PAINT_GROWTH = 1.35;
const TOOTH_COUNT = 5;
const CHEEK_X = 0.5;
const CHEEK_Y = 0.24;
const CHEEK_RADIUS = 0.24;
const TEAR_STRIPE_HALF_WIDTH = 0.13;
const SLASH_LENGTH = 0.55;
const SLASH_WIDTH = 0.13;

function drawHair(ctx: Ctx, style: ClownStyle): void {
  const r = style.proportions.headRadius;
  const { palette } = style;

  switch (style.hair) {
    case 'tufts': {
      const TUFT_PER_SIDE = 4;
      const TUFT_RADIUS = 0.33;
      for (const side of [-1, 1] as const) {
        for (let i = 0; i < TUFT_PER_SIDE; i++) {
          const t = i / (TUFT_PER_SIDE - 1);
          const angle = lerp(deg(150), deg(215), t) * (side > 0 ? -1 : 1);
          const px = Math.cos(angle) * r * 1.02;
          const py = Math.sin(angle) * r * 1.02;
          ctx.fillStyle = i % 2 === 0 ? palette.hair : palette.hairShade;
          ctx.beginPath();
          ctx.arc(px, py, r * TUFT_RADIUS, 0, FULL_CIRCLE);
          ctx.fill();
        }
      }
      return;
    }
    case 'stringy': {
      const STRAND_COUNT = 7;
      const STRAND_LENGTH = 1.5;
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.1;
      for (let i = 0; i < STRAND_COUNT; i++) {
        const t = i / (STRAND_COUNT - 1);
        const startAngle = lerp(deg(190), deg(350), t);
        const sx = Math.cos(startAngle) * r * 0.95;
        const sy = Math.sin(startAngle) * r * 0.95;
        const sway = Math.sin(t * Math.PI * 2) * r * 0.35;
        ctx.strokeStyle = i % 2 === 0 ? palette.hair : palette.hairShade;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + sway, sy + r * 0.8, sx + sway * 0.4, sy + r * STRAND_LENGTH);
        ctx.stroke();
      }
      return;
    }
    case 'lank': {
      // Wet, heavy hanks that hang past the jaw rather than standing out from
      // the skull: the clown silhouette without any of its bounce.
      const HANK_COUNT = 11;
      const HANK_ARC_START = deg(150);
      const HANK_ARC_END = deg(390);
      const HANK_DROP = 1.9;
      const HANK_WIDTH = 0.22;
      const HANK_DROOP_SPREAD = 0.45;
      for (let i = 0; i < HANK_COUNT; i++) {
        const t = i / (HANK_COUNT - 1);
        const angle = lerp(HANK_ARC_START, HANK_ARC_END, t);
        const rootX = Math.cos(angle) * r * 0.98;
        const rootY = Math.sin(angle) * r * 0.98;
        // Hanks nearest the crown fall furthest; the ones already low barely move.
        const drop = r * HANK_DROP * (0.35 + 0.65 * Math.abs(Math.cos(angle)));
        const drift = Math.cos(angle) * r * HANK_DROOP_SPREAD;
        ctx.fillStyle = i % 2 === 0 ? palette.hair : palette.hairShade;
        ctx.beginPath();
        ctx.moveTo(rootX - r * HANK_WIDTH, rootY);
        ctx.quadraticCurveTo(
          rootX + drift - r * HANK_WIDTH,
          rootY + drop * 0.6,
          rootX + drift,
          rootY + drop,
        );
        ctx.quadraticCurveTo(
          rootX + drift + r * HANK_WIDTH,
          rootY + drop * 0.6,
          rootX + r * HANK_WIDTH,
          rootY,
        );
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    case 'mane': {
      const SPIKE_COUNT = 13;
      const SPIKE_LENGTH = 1.15;
      const SPIKE_HALF_WIDTH = deg(14);
      for (let i = 0; i < SPIKE_COUNT; i++) {
        const angle = lerp(deg(160), deg(380), i / (SPIKE_COUNT - 1));
        const reach = r * (1 + SPIKE_LENGTH * (0.7 + 0.3 * Math.sin(i * 2.1)));
        ctx.fillStyle = i % 2 === 0 ? palette.hair : palette.hairShade;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle - SPIKE_HALF_WIDTH) * r, Math.sin(angle - SPIKE_HALF_WIDTH) * r);
        ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        ctx.lineTo(Math.cos(angle + SPIKE_HALF_WIDTH) * r, Math.sin(angle + SPIKE_HALF_WIDTH) * r);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
  }
}

/** Traces the mouth opening so both the lip makeup and the hole share a shape. */
function traceMouth(ctx: Ctx, cx: number, cy: number, halfWidth: number, height: number): void {
  const CORNER_LIFT = 0.9;
  const LOWER_LIP_DROP = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, cy - height * CORNER_LIFT);
  ctx.quadraticCurveTo(cx, cy + height * LOWER_LIP_DROP, cx + halfWidth, cy - height * CORNER_LIFT);
  ctx.quadraticCurveTo(cx, cy + height * 0.35, cx - halfWidth, cy - height * CORNER_LIFT);
  ctx.closePath();
}

/**
 * The mouth, at a caller-chosen centre and width.
 *
 * The profile head pushes it toward the facing side; a head-on head centres it.
 * Both go through here so a style's mouth is recognisably the same mouth from
 * every angle.
 */
function paintMouth(
  ctx: Ctx,
  style: ClownStyle,
  mouthOpen: number,
  cx: number,
  halfWidth: number,
): void {
  const r = style.proportions.headRadius;
  const { palette } = style;
  const cy = r * (MOUTH_Y + faceTuningOf(style).mouthDrop);
  const height = r * lerp(MOUTH_BASE_HEIGHT, MOUTH_OPEN_HEIGHT, clamp01(mouthOpen));

  if (style.mouth === 'rictus') {
    paintRictus(ctx, style, mouthOpen, cx, cy, halfWidth);
    return;
  }

  if (style.mouth === 'stitched') {
    const STITCH_COUNT = 7;
    const SEAM_WIDTH = 0.075;
    const STITCH_WIDTH = 0.05;
    const STITCH_HALF_LENGTH = 0.9;
    ctx.strokeStyle = palette.mouthFill;
    ctx.lineWidth = r * SEAM_WIDTH * LIP_PAINT_GROWTH * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, cy - height);
    ctx.quadraticCurveTo(cx, cy + height * 2.2, cx + halfWidth, cy - height);
    ctx.stroke();

    ctx.strokeStyle = palette.mouthDark;
    ctx.lineWidth = r * SEAM_WIDTH;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, cy - height);
    ctx.quadraticCurveTo(cx, cy + height * 2.2, cx + halfWidth, cy - height);
    ctx.stroke();

    ctx.lineWidth = r * STITCH_WIDTH;
    for (let i = 0; i < STITCH_COUNT; i++) {
      const t = (i + 0.5) / STITCH_COUNT;
      const stitchX = lerp(cx - halfWidth, cx + halfWidth, t);
      const stitchY = cy - height + Math.sin(t * Math.PI) * height * 2.2;
      ctx.beginPath();
      ctx.moveTo(stitchX, stitchY - height * STITCH_HALF_LENGTH);
      ctx.lineTo(stitchX, stitchY + height * STITCH_HALF_LENGTH);
      ctx.stroke();
    }
    return;
  }

  ctx.fillStyle = palette.mouthFill;
  traceMouth(ctx, cx, cy, halfWidth * LIP_PAINT_GROWTH, height * LIP_PAINT_GROWTH);
  ctx.fill();

  ctx.fillStyle = palette.mouthDark;
  traceMouth(ctx, cx, cy, halfWidth, height);
  ctx.fill();

  ctx.save();
  traceMouth(ctx, cx, cy, halfWidth, height);
  ctx.clip();
  ctx.fillStyle = palette.teeth;
  if (style.mouth === 'fanged') {
    const toothWidth = (halfWidth * 2) / TOOTH_COUNT;
    const FANG_DROP = 2.2;
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const toothX = cx - halfWidth + i * toothWidth;
      ctx.beginPath();
      ctx.moveTo(toothX, cy - height);
      ctx.lineTo(toothX + toothWidth, cy - height);
      ctx.lineTo(toothX + toothWidth * 0.5, cy + height * FANG_DROP);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const TEETH_BAND_HEIGHT = 0.8;
    ctx.fillRect(cx - halfWidth, cy - height, halfWidth * 2, height * TEETH_BAND_HEIGHT);
  }
  ctx.restore();
}

/** Profile-head mouth: shoved toward the facing side of the face. */
function drawMouth(ctx: Ctx, style: ClownStyle, mouthOpen: number): void {
  const r = style.proportions.headRadius;
  const rx = r * style.proportions.headWidthFactor;
  paintMouth(
    ctx,
    style,
    mouthOpen,
    rx * (FACE_FORWARD_SHIFT + MOUTH_X),
    rx * MOUTH_HALF_WIDTH,
  );
}

/**
 * A grin cut into the face rather than worn on it: the corners run up past the
 * cheekbones and the teeth are always showing, so the expression never changes
 * no matter what the animation is doing. `mouthOpen` only drops the jaw — the
 * grin itself is fixed, which is the whole point of the thing.
 */
/** The cut runs wider than any mouth belongs, so it overshoots the face's own. */
const RICTUS_WIDTH_GROWTH = 1.04;
const RICTUS_CORNER_RISE = 0.3;
const RICTUS_JAW_DROP = 0.82;
const RICTUS_CLOSED_DEPTH = 0.26;
const RICTUS_SCAR_WIDTH = 0.075;
const RICTUS_TOOTH_COUNT = 7;
/** Fraction of the gape each tooth occupies vertically, upper and lower rows. */
const RICTUS_TOOTH_DEPTH = 0.33;
const RICTUS_TOOTH_GAP = 0.12;

function traceRictus(
  ctx: Ctx,
  cx: number,
  cy: number,
  halfWidth: number,
  rise: number,
  depth: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, cy - rise);
  ctx.quadraticCurveTo(cx, cy + depth * 1.9, cx + halfWidth, cy - rise);
  ctx.quadraticCurveTo(cx, cy - rise * 0.55, cx - halfWidth, cy - rise);
  ctx.closePath();
}

function paintRictus(
  ctx: Ctx,
  style: ClownStyle,
  mouthOpen: number,
  cx: number,
  cy: number,
  nominalHalfWidth: number,
): void {
  const r = style.proportions.headRadius;
  const { palette } = style;
  const halfWidth = nominalHalfWidth * RICTUS_WIDTH_GROWTH;
  const rise = r * RICTUS_CORNER_RISE;
  const depth = r * lerp(RICTUS_CLOSED_DEPTH, RICTUS_JAW_DROP, clamp01(mouthOpen));

  ctx.fillStyle = palette.mouthFill;
  traceRictus(ctx, cx, cy, halfWidth * LIP_PAINT_GROWTH, rise * LIP_PAINT_GROWTH, depth);
  ctx.fill();

  ctx.fillStyle = palette.mouthDark;
  traceRictus(ctx, cx, cy, halfWidth, rise, depth);
  ctx.fill();

  ctx.save();
  traceRictus(ctx, cx, cy, halfWidth, rise, depth);
  ctx.clip();
  ctx.fillStyle = palette.teeth;
  const toothWidth = (halfWidth * 2) / RICTUS_TOOTH_COUNT;
  const gape = depth * 2 + rise;
  for (let i = 0; i < RICTUS_TOOTH_COUNT; i++) {
    const left = cx - halfWidth + i * toothWidth + toothWidth * RICTUS_TOOTH_GAP;
    const width = toothWidth * (1 - RICTUS_TOOTH_GAP * 2);
    // Upper teeth hang from the lip line, lower teeth stand off the jaw, and the
    // two rows never meet — a permanent gap is what makes it read as a wound.
    // Ragged rather than even: a row of identical rectangles reads as dentures,
    // and dentures are funny. The pattern is fixed so a re-bake is identical.
    const upperRagged = RICTUS_TOOTH_DEPTH * (i % 3 === 1 ? 0.55 : 1);
    const lowerRagged = RICTUS_TOOTH_DEPTH * (i % 2 === 0 ? 0.6 : 1);
    ctx.fillRect(left, cy - rise, width, gape * upperRagged);
    ctx.fillRect(left, cy + depth * 1.5 - gape * lowerRagged, width, gape * lowerRagged);
  }
  ctx.restore();

  // The slits carried on past the corners: the cut kept going.
  ctx.strokeStyle = palette.mouthDark;
  ctx.lineWidth = r * RICTUS_SCAR_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + halfWidth * side, cy - rise);
    ctx.lineTo(cx + halfWidth * side * 1.22, cy - rise * 1.7);
    ctx.stroke();
  }
}

function drawEye(
  ctx: Ctx,
  x: number,
  y: number,
  scale: number,
  glow: number,
  palette: ClownPalette,
): void {
  const socketRx = scale * EYE_SOCKET_RX;
  const socketRy = scale * EYE_SOCKET_RY;

  ctx.fillStyle = palette.paintMark;
  ctx.beginPath();
  ctx.ellipse(x, y, socketRx, socketRy, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = palette.teeth;
  ctx.beginPath();
  ctx.ellipse(x, y, socketRx * SCLERA_FRACTION, socketRy * SCLERA_FRACTION, 0, 0, FULL_CIRCLE);
  ctx.fill();

  const pupilRadius = socketRx * PUPIL_FRACTION;
  const glowRadius = pupilRadius * EYE_GLOW_FRACTION;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  gradient.addColorStop(0, palette.eyeCore);
  gradient.addColorStop(0.4, palette.eyeGlow);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  const GLOW_FLOOR_ALPHA = 0.45;
  ctx.save();
  ctx.globalAlpha = lerp(GLOW_FLOOR_ALPHA, 1, clamp01(glow));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = palette.eyeCore;
  ctx.beginPath();
  ctx.arc(x, y, pupilRadius, 0, FULL_CIRCLE);
  ctx.fill();
}

/** Greasepaint laid on before the eyes, so the eyes sit inside the marking. */
function drawFacePaint(ctx: Ctx, style: ClownStyle, nearEye: Point, farEye: Point): void {
  const r = style.proportions.headRadius;
  const rx = r * style.proportions.headWidthFactor;
  const { palette } = style;

  switch (style.facePaint) {
    case 'rouge': {
      ctx.fillStyle = palette.mouthFill;
      ctx.globalAlpha = 0.55;
      for (const side of [1, -1] as const) {
        ctx.beginPath();
        ctx.arc(
          rx * (FACE_FORWARD_SHIFT + CHEEK_X * side),
          r * CHEEK_Y,
          r * CHEEK_RADIUS,
          0,
          FULL_CIRCLE,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'tears': {
      ctx.fillStyle = palette.paintMark;
      for (const eye of [nearEye, farEye]) {
        ctx.fillRect(
          eye.x - r * TEAR_STRIPE_HALF_WIDTH,
          -r,
          r * TEAR_STRIPE_HALF_WIDTH * 2,
          r * 2 - (eye.y + r),
        );
      }
      return;
    }
    case 'sockets': {
      // Two hard black pits with the eyes burning at the bottom of them. A soft
      // radial was tried first and is wrong: the falloff greys out the whole
      // middle of the face, and at tile size the pits stop being holes at all.
      const SOCKET_RX = 0.27;
      const SOCKET_RY = 0.58;
      const SOCKET_DROP = 0.04;
      ctx.fillStyle = palette.paintMark;
      for (const eye of [nearEye, farEye]) {
        ctx.beginPath();
        ctx.ellipse(eye.x, eye.y + r * SOCKET_DROP, r * SOCKET_RX, r * SOCKET_RY, 0, 0, FULL_CIRCLE);
        ctx.fill();
      }
      return;
    }
    case 'slashes': {
      ctx.strokeStyle = palette.paintMark;
      ctx.lineWidth = r * SLASH_WIDTH;
      ctx.lineCap = 'round';
      for (const eye of [nearEye, farEye]) {
        ctx.beginPath();
        ctx.moveTo(eye.x - r * SLASH_LENGTH * 0.4, eye.y - r * SLASH_LENGTH);
        ctx.lineTo(eye.x + r * SLASH_LENGTH * 0.4, eye.y + r * SLASH_LENGTH);
        ctx.stroke();
      }
      return;
    }
  }
}

function drawHat(ctx: Ctx, style: ClownStyle): void {
  if (style.hat === 'none') return;
  const r = style.proportions.headRadius;
  const HAT_HEIGHT = 1.85;
  const HAT_HALF_WIDTH = 1.02;
  const HAT_BASE_Y = -0.5;
  const HAT_TIP_LEAN = -0.3;
  const HAT_BAND_HEIGHT = 0.22;
  const POMPOM_RADIUS = 0.24;

  const tipX = r * HAT_TIP_LEAN;
  const tipY = -r * HAT_HEIGHT;

  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.moveTo(-r * HAT_HALF_WIDTH, r * HAT_BASE_Y);
  ctx.quadraticCurveTo(0, r * (HAT_BASE_Y + HAT_BAND_HEIGHT), r * HAT_HALF_WIDTH, r * HAT_BASE_Y);
  ctx.quadraticCurveTo(r * 0.55, tipY * 0.55, tipX, tipY);
  ctx.quadraticCurveTo(-r * 0.35, tipY * 0.5, -r * HAT_HALF_WIDTH, r * HAT_BASE_Y);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = style.palette.suitDark;
  ctx.fillRect(-r * HAT_HALF_WIDTH, tipY, r * HAT_HALF_WIDTH * 2, -tipY + r);
  ctx.fillStyle = style.palette.suitLight;
  ctx.beginPath();
  ctx.moveTo(-r * HAT_HALF_WIDTH, r * HAT_BASE_Y);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + r * 0.3, tipY);
  ctx.lineTo(-r * HAT_HALF_WIDTH * 0.2, r * HAT_BASE_Y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = style.palette.ruff;
  ctx.fillRect(
    -r * HAT_HALF_WIDTH,
    r * (HAT_BASE_Y - HAT_BAND_HEIGHT * 0.5),
    r * HAT_HALF_WIDTH * 2,
    r * HAT_BAND_HEIGHT,
  );

  ctx.fillStyle = style.palette.accent;
  ctx.beginPath();
  ctx.arc(tipX, tipY, r * POMPOM_RADIUS, 0, FULL_CIRCLE);
  ctx.fill();
}

/** Draw the head in head-local space: origin at its centre, +X is forward. */
function drawHead(ctx: Ctx, style: ClownStyle, pose: ClownPose, view: ClownView): void {
  if (view === 'toward') {
    drawHeadToward(ctx, style, pose);
    return;
  }
  if (view === 'away') {
    drawHeadAway(ctx, style);
    return;
  }
  drawHeadProfile(ctx, style, pose);
}

/** Eye separation in a head-on face, as a fraction of the head's half-width. */
const EYE_TOWARD_X = 0.42;
/** How much of the skull's own width the shaded side of a head-on face covers. */
const HEADON_SHADE_WIDTH = 0.5;
const HEADON_SHADE_OFFSET = 0.95;

function drawHeadToward(ctx: Ctx, style: ClownStyle, pose: ClownPose): void {
  const { proportions, palette } = style;
  const r = proportions.headRadius;
  const rx = r * proportions.headWidthFactor;

  drawHair(ctx, style);

  ctx.fillStyle = palette.outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.06, r * 1.06, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = palette.paint;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  const rightEye: Point = { x: rx * EYE_TOWARD_X, y: r * EYE_Y };
  const leftEye: Point = { x: -rx * EYE_TOWARD_X, y: r * EYE_Y };

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.clip();

  ctx.fillStyle = palette.paintShade;
  ctx.beginPath();
  ctx.ellipse(-rx * HEADON_SHADE_OFFSET, 0, rx * HEADON_SHADE_WIDTH, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  drawFacePaint(ctx, style, rightEye, leftEye);
  ctx.restore();

  const eyeSize = r * faceTuningOf(style).eyeScale;
  drawEye(ctx, rightEye.x, rightEye.y, eyeSize, pose.eyeGlow, palette);
  drawEye(ctx, leftEye.x, leftEye.y, eyeSize, pose.eyeGlow, palette);

  if (style.facePaint !== 'sockets') {
    ctx.strokeStyle = palette.paintMark;
    ctx.lineWidth = r * BROW_WIDTH;
    ctx.lineCap = 'round';
    for (const side of [1, -1] as const) {
      const eye = side > 0 ? rightEye : leftEye;
      ctx.beginPath();
      // Both brows climb toward the centre of the face, which is what makes a
      // symmetric head-on stare read as a glare instead of a blank.
      ctx.moveTo(eye.x + rx * BROW_LENGTH * side, eye.y - r * BROW_RISE * 0.45);
      ctx.lineTo(eye.x - rx * BROW_LENGTH * side, eye.y - r * BROW_RISE);
      ctx.stroke();
    }
  }

  paintMouth(ctx, style, pose.mouthOpen, 0, rx * MOUTH_HALF_WIDTH);
  paintNose(ctx, style, 0);

  drawHat(ctx, style);
}

/** The nose ball, at a caller-chosen horizontal position on the face. */
function paintNose(ctx: Ctx, style: ClownStyle, cx: number): void {
  const r = style.proportions.headRadius;
  const { palette } = style;
  const noseRadius = r * NOSE_FRACTION * faceTuningOf(style).noseScale;
  const noseY = r * NOSE_Y;
  const gradient = ctx.createRadialGradient(
    cx - noseRadius * 0.35,
    noseY - noseRadius * 0.35,
    noseRadius * 0.1,
    cx,
    noseY,
    noseRadius,
  );
  gradient.addColorStop(0, palette.noseHighlight);
  gradient.addColorStop(1, palette.nose);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, noseY, noseRadius, 0, FULL_CIRCLE);
  ctx.fill();
}

/**
 * The back of the head: a bare painted dome under the hair, with no features at
 * all. Deliberately empty — a face peeking round from behind is the single most
 * common way a four-view figure gives itself away.
 */
function drawHeadAway(ctx: Ctx, style: ClownStyle): void {
  const { proportions, palette } = style;
  const r = proportions.headRadius;
  const rx = r * proportions.headWidthFactor;

  ctx.fillStyle = palette.outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.06, r * 1.06, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = palette.paint;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.clip();
  ctx.fillStyle = palette.paintShade;
  ctx.beginPath();
  ctx.ellipse(-rx * HEADON_SHADE_OFFSET, 0, rx * HEADON_SHADE_WIDTH, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  // Most of the back of a head is hair, not scalp. Without this cap the dome
  // stays a bare white disc and the hair beside it reads as a hood with a
  // pointed crown cut out of it.
  const SCALP_CAP_DROP = 0.34;
  const SCALP_CAP_HEIGHT = 1.15;
  ctx.fillStyle = palette.hair;
  ctx.beginPath();
  ctx.ellipse(0, -r * SCALP_CAP_DROP, rx, r * SCALP_CAP_HEIGHT, 0, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillStyle = palette.hairShade;
  ctx.beginPath();
  ctx.ellipse(
    -rx * HEADON_SHADE_OFFSET,
    -r * SCALP_CAP_DROP,
    rx * HEADON_SHADE_WIDTH,
    r * SCALP_CAP_HEIGHT,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
  ctx.restore();

  // Hanks last so they hang over the cap rather than behind it.
  drawHair(ctx, style);
  drawHat(ctx, style);
}

function drawHeadProfile(ctx: Ctx, style: ClownStyle, pose: ClownPose): void {
  const { proportions, palette } = style;
  const r = proportions.headRadius;
  const rx = r * proportions.headWidthFactor;

  drawHair(ctx, style);

  ctx.fillStyle = palette.outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.06, r * 1.06, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = palette.paint;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  const nearEye: Point = { x: rx * (FACE_FORWARD_SHIFT + EYE_NEAR_X), y: r * EYE_Y };
  const farEye: Point = { x: rx * (FACE_FORWARD_SHIFT + EYE_FAR_X), y: r * EYE_Y };

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, FULL_CIRCLE);
  ctx.clip();

  const SHADED_SIDE_OFFSET = 0.78;
  const SHADED_SIDE_WIDTH = 0.62;
  ctx.fillStyle = palette.paintShade;
  ctx.beginPath();
  ctx.ellipse(-rx * SHADED_SIDE_OFFSET, 0, rx * SHADED_SIDE_WIDTH, r, 0, 0, FULL_CIRCLE);
  ctx.fill();

  drawFacePaint(ctx, style, nearEye, farEye);
  ctx.restore();

  const eyeSize = r * faceTuningOf(style).eyeScale;
  drawEye(ctx, nearEye.x, nearEye.y, eyeSize, pose.eyeGlow, palette);
  drawEye(
    ctx,
    farEye.x,
    farEye.y,
    eyeSize * FAR_EYE_SCALE,
    pose.eyeGlow * FAR_EYE_SCALE,
    palette,
  );

  if (style.facePaint !== 'sockets') drawProfileBrows(ctx, style, nearEye, farEye);

  drawMouth(ctx, style, pose.mouthOpen);
  paintNose(ctx, style, rx * (FACE_FORWARD_SHIFT + NOSE_X));

  drawHat(ctx, style);
}

/**
 * A drawn brow over a hollow socket only reads as a raised eyebrow, which is an
 * expression — and the whole point of the socket is that there is no expression
 * there at all. So the socket styles get none.
 */
function drawProfileBrows(ctx: Ctx, style: ClownStyle, nearEye: Point, farEye: Point): void {
  const { proportions, palette } = style;
  const r = proportions.headRadius;
  const rx = r * proportions.headWidthFactor;
  ctx.strokeStyle = palette.paintMark;
  ctx.lineWidth = r * BROW_WIDTH;
  ctx.lineCap = 'round';
  for (const [eye, browScale] of [
    [nearEye, 1],
    [farEye, FAR_EYE_SCALE],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(eye.x - rx * BROW_LENGTH * browScale, eye.y - r * BROW_RISE * browScale);
    ctx.lineTo(eye.x + rx * BROW_LENGTH * browScale, eye.y - r * BROW_RISE * 0.45 * browScale);
    ctx.stroke();
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const FAR_LIMB_SHEEN = null;
const SHADOW_RADIUS_FRACTION = 1.5;
const NECK_WIDTH_FRACTION = 0.5;
const ARM_INSET_FRACTION = 0.85;
const HIP_INSET_FRACTION = 0.6;
const SHOULDER_DROP_FRACTION = 0.12;
const FOOT_ANGLE_FOLLOW = 0.15;

/** Anything the clown carries, drawn in figure space after the near arm. */
export type PropPainter = (ctx: Ctx, hand: Point, wristAngle: number) => void;

/**
 * Draw one clown frame. `originX`/`originY` is the point between the feet and
 * `unit` is the pixel size of one tile; the figure always faces +X, so callers
 * mirror it at runtime rather than drawing a second facing here.
 */
export function drawClown(
  ctx: Ctx,
  originX: number,
  originY: number,
  unit: number,
  style: ClownStyle,
  pose: ClownPose,
  drawProp?: PropPainter,
  view: ClownView = 'profile',
): void {
  const { proportions, palette } = style;
  const headOn = view !== 'profile';

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);

  drawGroundShadow(ctx, proportions.shoulderHalfWidth * SHADOW_RADIUS_FRACTION);

  const hip: Point = { x: pose.sway, y: -groundedHipHeight(proportions) + pose.bob };
  const spineTop = offset(
    hip,
    ...spineOffset(proportions.torsoLength * pose.torsoSquash, pose.lean, view),
  );
  const shoulderDrop = proportions.shoulderHalfWidth * SHOULDER_DROP_FRACTION;

  const nearShoulder = offset(
    spineTop,
    proportions.shoulderHalfWidth * ARM_INSET_FRACTION,
    shoulderDrop,
  );
  const farShoulder = offset(
    spineTop,
    -proportions.shoulderHalfWidth * ARM_INSET_FRACTION,
    shoulderDrop,
  );
  const nearHip = offset(hip, proportions.hipHalfWidth * HIP_INSET_FRACTION, 0);
  const farHip = offset(hip, -proportions.hipHalfWidth * HIP_INSET_FRACTION, 0);

  const nearLeg = solveTwoBone(
    nearHip,
    ankleTarget(pose.nearFoot, proportions),
    proportions.thighLength,
    proportions.shinLength,
    1,
  );
  const farLeg = solveTwoBone(
    farHip,
    ankleTarget(pose.farFoot, proportions),
    proportions.thighLength,
    proportions.shinLength,
    1,
  );
  const nearArm = solveTwoBone(
    nearShoulder,
    pose.nearHand,
    proportions.upperArmLength,
    proportions.forearmLength,
    -1,
  );
  const farArm = solveTwoBone(
    farShoulder,
    pose.farHand,
    proportions.upperArmLength,
    proportions.forearmLength,
    -1,
  );

  const nearPaint: LimbPaint = {
    fill: palette.suitMid,
    outline: palette.outline,
    sheen: palette.limbSheen,
  };
  // Head-on, neither limb is further from the camera than the other, so the
  // depth darkening that sells a profile would just look like one arm in shadow.
  const farPaint: LimbPaint = headOn
    ? nearPaint
    : {
        fill: palette.suitFar,
        outline: palette.outline,
        sheen: FAR_LIMB_SHEEN,
      };

  const paintProp = (): void => {
    if (drawProp === undefined) return;
    drawProp(ctx, nearArm.end, segmentAngle(nearArm.joint, nearArm.end) + pose.wristTwist);
  };

  drawLimbWithExtremity(ctx, farArm, proportions.armWidth, farPaint, style, 'hand', view);
  drawLimbWithExtremity(ctx, farLeg, proportions.legWidth, farPaint, style, 'foot', view);
  if (pose.propBehind) paintProp();

  ctx.save();
  ctx.translate(hip.x, hip.y);
  // A head-on spine leans toward or away from the camera, which is a
  // foreshortening rather than a rotation — rotating it would tip the figure
  // sideways every time it wound up an attack.
  if (!headOn) ctx.rotate(pose.lean);
  drawTorso(ctx, style, pose.torsoSquash * (headOn ? Math.cos(pose.lean) : 1), headOn);
  ctx.restore();

  drawLimbWithExtremity(ctx, nearLeg, proportions.legWidth, nearPaint, style, 'foot', view);

  const headCentre = offset(
    hip,
    ...spineOffset(
      proportions.torsoLength * pose.torsoSquash + proportions.neckLength + proportions.headRadius,
      pose.lean,
      view,
    ),
  );
  // Head-on, leading with the face pushes the head down the screen (toward the
  // camera) rather than sideways.
  const headAt = headOn
    ? offset(headCentre, 0, pose.headLead)
    : offset(headCentre, pose.headLead, 0);

  fillCapsule(
    ctx,
    spineTop,
    offset(headAt, 0, proportions.headRadius * 0.6),
    proportions.headRadius * NECK_WIDTH_FRACTION,
    proportions.headRadius * NECK_WIDTH_FRACTION * 0.8,
    palette.skin,
  );

  if (style.ruffRadius > 0) {
    ctx.save();
    const ruffLift = proportions.neckLength * (style.ruffRise ?? 0);
    ctx.translate(spineTop.x, spineTop.y - style.ruffRadius * RUFF_SQUASH * 0.4 - ruffLift);
    drawRuff(ctx, style.ruffRadius, palette);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(headAt.x, headAt.y);
  ctx.rotate(pose.headTilt + (headOn ? 0 : pose.lean));
  drawHead(ctx, style, pose, view);
  ctx.restore();

  drawLimbWithExtremity(ctx, nearArm, proportions.armWidth, nearPaint, style, 'hand', view);
  if (!pose.propBehind) paintProp();

  ctx.restore();
}

/**
 * Offset from the hip to a point `length` up the spine.
 *
 * A profile spine rotates by the lean; a head-on one only shortens by it, since
 * leaning toward the camera does not move the shoulders across the screen.
 */
function spineOffset(length: number, lean: number, view: ClownView): [number, number] {
  if (view !== 'profile') return [0, -length * Math.cos(lean)];
  const rotated = rotatePoint({ x: 0, y: -length }, lean);
  return [rotated.x, rotated.y];
}

function drawLimbWithExtremity(
  ctx: Ctx,
  chain: BoneChain,
  width: number,
  paint: LimbPaint,
  style: ClownStyle,
  extremity: 'hand' | 'foot',
  view: ClownView = 'profile',
): void {
  const walksOnStilts = extremity === 'foot' && style.feet === 'stilts';
  const woodPaint: LimbPaint = {
    fill: style.palette.shoe,
    outline: style.palette.outline,
    sheen: null,
  };
  drawLimb(ctx, chain, width, paint, walksOnStilts ? woodPaint : paint);
  const lowerAngle = segmentAngle(chain.joint, chain.end);
  if (extremity === 'hand') {
    drawHand(ctx, chain.end, lowerAngle, style);
    return;
  }
  const footAngle = lowerAngle * FOOT_ANGLE_FOLLOW;
  if (style.feet === 'stilts') {
    drawStiltFoot(ctx, chain.end, footAngle, style);
    return;
  }
  if (view !== 'profile') {
    drawShoeHeadOn(ctx, chain.end, style, view);
    return;
  }
  drawShoe(ctx, chain.end, footAngle, style);
}
