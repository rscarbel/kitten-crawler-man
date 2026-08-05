/**
 * Drawing engine for the dungeon's goblins.
 *
 * A goblin is a small, wiry, mean scavenger — undernourished, permanently
 * hunched, wearing whatever it stripped off something it killed. At the 32-px
 * tile size players actually see, only two features survive: the swept-back
 * notched ears and the weapon. Everything in here is built so those two carry
 * the silhouette and the rest reads as a believable body behind them.
 *
 * The figure is posed by *targets*, not joint angles: a pose says where the
 * feet and hands are and {@link solveTwoBone} finds the knee and elbow. That is
 * the single reason limbs stay welded to the body across a swing — posing each
 * segment independently is what made the previous goblins' arms float.
 *
 * Coordinates are tile units: 1.0 is one dungeon tile. The origin is the point
 * between the feet, +X is the direction the goblin faces and -Y is up. The
 * caller translates to the ground point and scales by one tile, so a sheet can
 * be baked at any resolution.
 *
 * Colour is a set of five-stop ramps under one {@link LIGHT} vector rather than
 * a bag of flat hex strings, because the old art's single saturated green with
 * one darker green is the largest single reason it looked cheap.
 *
 * Glow and soft shadow are radial gradients, never `shadowBlur` — blur is
 * measured in device pixels and would not survive the caller's scale.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

const FULL_CIRCLE = Math.PI * 2;

/** Exported for the weapon painters, which trace their own arcs. */
export const FULL_CIRCLE_ANGLE = FULL_CIRCLE;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smooth 0→1 ease used for weight shifts, windups and recoveries. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Fast start, slow finish — for a limb that is thrown and then settles. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Slow start, fast finish — for a limb winding up before it is thrown. */
export function easeIn(t: number): number {
  const c = clamp01(t);
  return c * c;
}

/** 0 → 1 → 0 over the unit interval; the shape of every animation beat. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function offset(base: Pt, dx: number, dy: number): Pt {
  return { x: base.x + dx, y: base.y + dy };
}

export function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function rotatePt(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** A point `distance` from `from` along `angle`. */
export function along(from: Pt, angle: number, distance: number): Pt {
  return { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance };
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segmentAngle(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Colour ───────────────────────────────────────────────────────────────────
// Every ramp runs shadow → dark → mid → light → rim under an upper-left key.
// Nothing is drawn in pure black; a ramp's `shadow` entry is its own outline.

export interface Ramp {
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.slice(1);
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

/** Blends two hex colours; `t` of 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${channel(lerp(ca.r, cb.r, t))}${channel(lerp(ca.g, cb.g, t))}${channel(lerp(ca.b, cb.b, t))}`;
}

/** A hex colour re-expressed with an alpha. */
export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/**
 * Sample a ramp continuously: 0 is its shadow, 1 its rim. Painters that need a
 * tone between two named stops ask for it here rather than inventing a hex.
 */
export function tone(r: Ramp, t: number): string {
  const stops = [r.shadow, r.dark, r.mid, r.light, r.rim];
  const lastIndex = stops.length - 1;
  const scaled = clamp01(t) * lastIndex;
  const low = Math.min(lastIndex - 1, Math.floor(scaled));
  return mix(stops[low], stops[low + 1], scaled - low);
}

/** Unit vector the key light arrives from, in figure space. Upper-left. */
export const LIGHT: Pt = { x: -0.6222, y: -0.7828 };

/** Ramp position a surface facing `normal` sits at, before any local tinting. */
export function lambert(normal: Pt): number {
  const length = Math.hypot(normal.x, normal.y);
  if (length === 0) return AMBIENT_LEVEL;
  const facing = (normal.x * LIGHT.x + normal.y * LIGHT.y) / length;
  return clamp01(AMBIENT_LEVEL + facing * DIRECTIONAL_RANGE);
}

/** Ramp level a surface turned away from the key still receives. */
const AMBIENT_LEVEL = 0.42;
/** How far the key light can push a surface off {@link AMBIENT_LEVEL}. */
const DIRECTIONAL_RANGE = 0.42;

/**
 * A tiny deterministic pseudo-random source. Every blemish on a goblin's hide
 * has to land in the same place on every bake, or two review rounds cannot be
 * compared — which rules out `Math.random`.
 */
export function seededNoise(seed: number): () => number {
  const MULTIPLIER = 1664525;
  const INCREMENT = 1013904223;
  const MODULUS = 4294967296;
  let state = Math.floor(seed) % MODULUS;
  return () => {
    state = (state * MULTIPLIER + INCREMENT) % MODULUS;
    return state / MODULUS;
  };
}

// ── Two-bone inverse kinematics ──────────────────────────────────────────────

/**
 * Keeps a solved chain from locking dead straight, which reads as a broken limb
 * and lets the joint flip sides unpredictably between frames.
 */
const IK_REACH_MARGIN = 0.985;
/** Matching floor on how far the target may fold back toward the anchor. */
const IK_FOLD_MARGIN = 1.08;
/** Absolute floor on the solved span, as a fraction of the limb's full length. */
const IK_MIN_SPAN = 0.05;

export interface BoneChain {
  readonly anchor: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/**
 * Solve a two-segment limb so its end lands on (or as near as it can reach to)
 * `target`.
 *
 * @param bendSign +1 puts the joint on the +X side of the anchor→target line
 *   (a knee for a figure facing +X), -1 puts it on the -X side (an elbow).
 */
export function solveTwoBone(
  anchor: Pt,
  target: Pt,
  upperLength: number,
  lowerLength: number,
  bendSign: number,
): BoneChain {
  const maxReach = (upperLength + lowerLength) * IK_REACH_MARGIN;
  // Floored, because equal-length bones give a zero minimum reach, and a target
  // sitting exactly on the anchor then divides zero by zero: the law of cosines
  // returns NaN and the limb disappears without a trace.
  const foldedReach = Math.abs(upperLength - lowerLength) * IK_FOLD_MARGIN;
  const minReach = Math.max(foldedReach, (upperLength + lowerLength) * IK_MIN_SPAN);
  const rawSpan = distance(anchor, target);
  const span = Math.min(maxReach, Math.max(minReach, rawSpan));

  const toTarget = Math.atan2(target.y - anchor.y, target.x - anchor.x);
  const cosJointAngle =
    (upperLength * upperLength + span * span - lowerLength * lowerLength) /
    (2 * upperLength * span);
  const jointAngle = Math.acos(Math.min(1, Math.max(-1, cosJointAngle)));
  const upperAngle = toTarget - bendSign * jointAngle;

  return {
    anchor,
    joint: along(anchor, upperAngle, upperLength),
    end: along(anchor, toTarget, span),
  };
}

// ── Limb rendering ───────────────────────────────────────────────────────────

/**
 * A tapered capsule: a quad between the two end circles plus the circles
 * themselves. Drawing the joint caps as full discs is what guarantees adjacent
 * segments stay visually welded no matter how sharply the limb bends.
 */
export function fillCapsule(
  ctx: Ctx,
  a: Pt,
  b: Pt,
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

/**
 * A starved limb is a thin bone between wide ends, so every segment narrows to a
 * waist at its middle and widens again at both joints.
 *
 * The first cut instead drew a constant-width capsule with an oversized disc at
 * the joint, and because that disc stuck out past the capsule it carried a ring
 * of its own outline — four ball joints per limb, which read as an artist's
 * mannequin. Shaping the bone rather than bolting on a knuckle cannot produce
 * that failure: the joint here is never wider than the segment that meets it.
 */
const LIMB_WAIST_FRACTION = 0.66;
/** The joint end of a segment, relative to its root. */
const LIMB_JOINT_FRACTION = 0.94;
/** The wrist/ankle end, which is the narrowest part of the whole limb. */
const LIMB_TIP_FRACTION = 0.72;
/** Dark silhouette drawn under every limb, as a fraction of the limb width. */
const LIMB_OUTLINE_FRACTION = 0.13;
/** Sheen runs down the light-facing edge of each near segment. */
const LIMB_SHEEN_FRACTION = 0.17;
const LIMB_SHEEN_OFFSET = 0.62;

export interface LimbPaint {
  readonly fill: string;
  readonly outline: string;
  /** Null on far limbs; the missing highlight is the depth cue. */
  readonly sheen: string | null;
}

/** One segment, drawn root → waist → end so the bone has a visible taper. */
function fillSegment(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  rootRadius: number,
  endRadius: number,
  waistRadius: number,
  color: string,
): void {
  const middle = mixPt(from, to, 0.5);
  fillCapsule(ctx, from, middle, rootRadius, waistRadius, color);
  fillCapsule(ctx, middle, to, waistRadius, endRadius, color);
}

/** Draw a solved chain as one continuous outlined, tapered, shaded limb. */
export function drawLimb(ctx: Ctx, chain: BoneChain, rootWidth: number, paint: LimbPaint): void {
  const rootRadius = rootWidth / 2;
  const jointRadius = rootRadius * LIMB_JOINT_FRACTION;
  const tipRadius = rootRadius * LIMB_TIP_FRACTION;
  const upperWaist = rootRadius * LIMB_WAIST_FRACTION;
  const lowerWaist = jointRadius * LIMB_WAIST_FRACTION;
  const growth = rootWidth * LIMB_OUTLINE_FRACTION;

  fillSegment(
    ctx,
    chain.anchor,
    chain.joint,
    rootRadius + growth,
    jointRadius + growth,
    upperWaist + growth,
    paint.outline,
  );
  fillSegment(
    ctx,
    chain.joint,
    chain.end,
    jointRadius + growth,
    tipRadius + growth,
    lowerWaist + growth,
    paint.outline,
  );

  fillSegment(ctx, chain.anchor, chain.joint, rootRadius, jointRadius, upperWaist, paint.fill);
  fillSegment(ctx, chain.joint, chain.end, jointRadius, tipRadius, lowerWaist, paint.fill);

  if (paint.sheen === null) return;
  const shift = rootWidth * LIMB_SHEEN_OFFSET;
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * shift, LIGHT.y * shift);
  fillCapsule(
    ctx,
    lit(mixPt(chain.anchor, chain.joint, 0.15)),
    lit(mixPt(chain.anchor, chain.joint, 0.8)),
    upperWaist * LIMB_SHEEN_FRACTION * 2,
    upperWaist * LIMB_SHEEN_FRACTION * 1.6,
    paint.sheen,
  );
}

// ── Style description ────────────────────────────────────────────────────────

export interface GoblinPalette {
  readonly skin: Ramp;
  /** The filthy wrap round the hips and any rag binding. */
  readonly cloth: Ramp;
  readonly leather: Ramp;
  /** Scavenged, pitted plate — pauldron, bracer, greave, weapon heads. */
  readonly iron: Ramp;
  /** Necklace teeth, and every bone that shows through a wound. */
  readonly bone: Ramp;
  readonly wood: Ramp;
  readonly eye: string;
  /** Amber sits in a dark sclera; the socket rim is darker still. */
  readonly sclera: string;
  readonly toothEnamel: string;
  readonly mouthInner: string;
  readonly outline: string;
}

/**
 * Skeleton lengths in tile units. Hip height is derived from the leg bones by
 * {@link groundedHipHeight} so the feet always reach the floor.
 */
export interface GoblinProportions {
  readonly torsoLength: number;
  readonly shoulderHalfWidth: number;
  readonly hipHalfWidth: number;
  /** Forward bulge of the gut; the mace goblin's is what leads its walk. */
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
  readonly footLength: number;
  readonly footHeight: number;
  readonly earLength: number;
  /** How far the hooked nose projects past the face plane. */
  readonly noseProjection: number;
}

/** Which piece of mismatched scavenged plate this goblin managed to loot. */
export interface GoblinGear {
  readonly pauldron: boolean;
  readonly bracer: boolean;
  readonly greave: boolean;
  readonly necklace: boolean;
  /** Rag hood pulled over the skull, leaving the ears out. */
  readonly hood: boolean;
  /**
   * Arrow quiver slung across the back.
   *
   * The archer's whole design job is to be pickable out of a crowd, and a blind
   * silhouette review found it failing at exactly that: walking and idling, with
   * the bow hanging along the body, it read as "hunched creature with a tail".
   * Shafts standing proud of the shoulder are the one cue that survives a 32-px
   * pure-black silhouette on every frame of every row.
   */
  readonly quiver: boolean;
}

export interface GoblinStyle {
  readonly palette: GoblinPalette;
  readonly proportions: GoblinProportions;
  readonly gear: GoblinGear;
  /** Permanent forward hunch, before any per-frame lean. */
  readonly spineLean: number;
  /** Notches torn out of each ear; near and far ears are cut differently. */
  readonly earNotches: number;
}

/**
 * How much of the leg's length a planted stance uses up. Short of 1 so the knee
 * keeps a visible bend — a leg solved dead straight reads as broken and lets
 * the knee flip sides between frames.
 */
const STANDING_LEG_EXTENSION = 0.93;

/**
 * Hip height for a planted stance, measured to the ground the figure stands on.
 *
 * Foot targets in a {@link GoblinPose} are ground-level, but the ankle rides one
 * foot-height above them (see {@link ankleTarget}), so the leg only ever has to
 * span `(thigh + shin) * STANDING_LEG_EXTENSION`. Folding the foot into this
 * height *without* that lift would put every target outside the leg's reach and
 * the IK would quietly replace the authored gait with an arc at max reach —
 * which no automated check catches, only a picture.
 */
export function groundedHipHeight(p: GoblinProportions): number {
  return (p.thighLength + p.shinLength) * STANDING_LEG_EXTENSION + p.footHeight;
}

/** Height of the shoulder line above the ground in a standing pose. */
export function shoulderHeight(p: GoblinProportions): number {
  return groundedHipHeight(p) + p.torsoLength;
}

/** Sole-to-skull-top height, tuned separately per archetype below. */
export function figureHeight(p: GoblinProportions): number {
  return shoulderHeight(p) + p.neckLength + p.headRadius * 2;
}

/** Where the ankle goes for a foot planted at `target`. */
function ankleTarget(target: Pt, p: GoblinProportions): Pt {
  return offset(target, 0, -p.footHeight);
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** How wide a hand may open; 0 is a closed fist, 1 is fingers fully splayed. */
export type GripOpenness = number;

/**
 * A single animation frame. Foot and hand targets are in the same ground space
 * as the figure (origin between the feet, -Y up); the rig solves the knees and
 * elbows to reach them.
 */
export interface GoblinPose {
  /** Vertical travel of the whole body; negative lifts the figure. */
  readonly bob: number;
  /** Horizontal pelvis shift — the weight transfer of a stride. */
  readonly sway: number;
  /** Spine tilt in radians on top of the style's permanent hunch. */
  readonly lean: number;
  readonly nearFoot: Pt;
  readonly farFoot: Pt;
  readonly nearHand: Pt;
  readonly farHand: Pt;
  /** Extra rotation applied to whatever the near hand is holding. */
  readonly wristTwist: number;
  /**
   * Absolute angle of the held weapon, overriding the forearm direction.
   *
   * Choreography that has to put the *off* hand on a two-handed haft needs to
   * know the weapon's angle before the rig has solved the near arm, and a
   * derived wrist angle is only knowable afterwards. Setting this breaks that
   * circle: the pose states the angle, computes the off-hand grip from it, and
   * the rig obeys instead of deriving. Null follows the forearm plus
   * `wristTwist`, which is what every unarmed and resting pose wants.
   */
  readonly weaponAngle: number | null;
  readonly headTilt: number;
  /** Forward push of the head beyond the spine, for leading with the face. */
  readonly headLead: number;
  /** Ears lag the head; this is their extra swept-back droop, in radians. */
  readonly earLag: number;
  readonly mouthOpen: number;
  /** 0 fully closes the eyes — a blink — and 1 is a wide aggressive stare. */
  readonly eyeOpen: number;
  /** Vertical scale of the torso, for breathing and impact squash. */
  readonly torsoSquash: number;
  /**
   * Draw whatever the goblin is holding behind the body instead of in front of
   * it — a mace at the back of its whirl passes behind the figure, and drawing
   * it in front would paint the head over the goblin's own face.
   */
  readonly propBehind: boolean;
  /** Which way the knee bends; flipped when a leg crosses behind the body. */
  readonly nearKneeSign: number;
  readonly farKneeSign: number;
}

/** How much of the arm's length is used up when it hangs slack at the side. */
const ARM_HANG_EXTENSION = 0.88;

/**
 * How long the far arm is drawn relative to the weapon arm.
 *
 * This is foreshortening, not anatomy: in the three-quarter view the free arm
 * swings away from the camera, and drawing it at its true length hangs the free
 * hand somewhere past the knee, which reads as an ape rather than a goblin.
 */
const FAR_ARM_LENGTH_SCALE = 0.72;

/** Shoulder-to-fingertip span of the far arm, after foreshortening. */
function farArmSpan(p: GoblinProportions): number {
  return (p.upperArmLength + p.forearmLength) * FAR_ARM_LENGTH_SCALE;
}
const STANCE_HALF_WIDTH_FRACTION = 1.15;
/** Hands rest clear of the hips so both arms stay readable against the body. */
const HAND_CLEARANCE_FRACTION = 1.9;
/**
 * The free hand hangs much closer in than the weapon hand.
 *
 * Same foreshortening argument as {@link FAR_ARM_LENGTH_SCALE}: the far arm is
 * angled away from the camera, so it should read as *nearer the body*, not held
 * out at the same distance as the arm holding a weapon. At the shared clearance
 * it stood off the hip like the goblin was carrying a bucket in each hand.
 */
const FAR_HAND_CLEARANCE_FRACTION = 0.95;
const RESTING_EYE_OPEN = 0.85;
const KNEE_BEND_FORWARD = 1;
const ELBOW_BEND_BACK = -1;

/** A relaxed standing pose; animations spread from this by overriding fields. */
export function restingPose(style: GoblinStyle): GoblinPose {
  const p = style.proportions;
  const stance = p.hipHalfWidth * STANCE_HALF_WIDTH_FRACTION;
  const armLength = p.upperArmLength + p.forearmLength;
  const handY = -shoulderHeight(p) + armLength * ARM_HANG_EXTENSION;
  const farHandY = -shoulderHeight(p) + farArmSpan(p) * ARM_HANG_EXTENSION;
  const handX = p.hipHalfWidth + p.armWidth * HAND_CLEARANCE_FRACTION;
  const farHandX = p.hipHalfWidth + p.armWidth * FAR_HAND_CLEARANCE_FRACTION;
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    nearFoot: { x: stance, y: 0 },
    farFoot: { x: -stance, y: 0 },
    nearHand: { x: handX, y: handY },
    farHand: { x: -farHandX, y: farHandY },
    wristTwist: 0,
    weaponAngle: null,
    headTilt: 0,
    headLead: 0,
    earLag: 0,
    mouthOpen: 0,
    eyeOpen: RESTING_EYE_OPEN,
    torsoSquash: 1,
    propBehind: false,
    nearKneeSign: KNEE_BEND_FORWARD,
    farKneeSign: KNEE_BEND_FORWARD,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * Every joint the painters and the automated pose gates need, resolved once per
 * frame. Built as a named struct rather than computed inline inside the master
 * draw so the generator can assert against it without re-deriving anything.
 */
export interface Skeleton {
  readonly hip: Pt;
  readonly spineTop: Pt;
  readonly nearShoulder: Pt;
  readonly farShoulder: Pt;
  readonly headCentre: Pt;
  readonly headAngle: number;
  readonly nearLeg: BoneChain;
  readonly farLeg: BoneChain;
  readonly nearArm: BoneChain;
  readonly farArm: BoneChain;
  /** Total spine tilt: the style's permanent hunch plus this frame's lean. */
  readonly lean: number;
}

/** Arms hang from just inside the shoulder line, not off its very edge. */
const ARM_INSET_FRACTION = 0.86;
const HIP_INSET_FRACTION = 0.62;
/** Shoulders sit slightly below the top of the torso silhouette. */
const SHOULDER_DROP_FRACTION = 0.26;

/** Offset from the hip to a point `length` up the leaning spine. */
function spineOffset(length: number, lean: number): Pt {
  return rotatePt({ x: 0, y: -length }, lean);
}

export function buildSkeleton(style: GoblinStyle, pose: GoblinPose): Skeleton {
  const p = style.proportions;
  const lean = style.spineLean + pose.lean;
  const torso = p.torsoLength * pose.torsoSquash;

  const hip: Pt = { x: pose.sway, y: -groundedHipHeight(p) + pose.bob };
  const spineTop = offset(hip, spineOffset(torso, lean).x, spineOffset(torso, lean).y);
  const shoulderDrop = p.shoulderHalfWidth * SHOULDER_DROP_FRACTION;

  const nearShoulder = offset(spineTop, p.shoulderHalfWidth * ARM_INSET_FRACTION, shoulderDrop);
  const farShoulder = offset(spineTop, -p.shoulderHalfWidth * ARM_INSET_FRACTION, shoulderDrop);
  const nearHip = offset(hip, p.hipHalfWidth * HIP_INSET_FRACTION, 0);
  const farHip = offset(hip, -p.hipHalfWidth * HIP_INSET_FRACTION, 0);

  const headOffset = spineOffset(torso + p.neckLength + p.headRadius, lean);
  const headCentre = offset(hip, headOffset.x + pose.headLead, headOffset.y);

  return {
    hip,
    spineTop,
    nearShoulder,
    farShoulder,
    headCentre,
    headAngle: lean + pose.headTilt,
    nearLeg: solveTwoBone(
      nearHip,
      ankleTarget(pose.nearFoot, p),
      p.thighLength,
      p.shinLength,
      pose.nearKneeSign,
    ),
    farLeg: solveTwoBone(
      farHip,
      ankleTarget(pose.farFoot, p),
      p.thighLength,
      p.shinLength,
      pose.farKneeSign,
    ),
    nearArm: solveTwoBone(
      nearShoulder,
      pose.nearHand,
      p.upperArmLength,
      p.forearmLength,
      ELBOW_BEND_BACK,
    ),
    farArm: solveTwoBone(
      farShoulder,
      pose.farHand,
      p.upperArmLength * FAR_ARM_LENGTH_SCALE,
      p.forearmLength * FAR_ARM_LENGTH_SCALE,
      ELBOW_BEND_BACK,
    ),
    lean,
  };
}

// ── Ground shadow ────────────────────────────────────────────────────────────

const SHADOW_INNER_ALPHA = 0.46;
const SHADOW_HEIGHT_FRACTION = 0.26;
const SHADOW_RADIUS_FRACTION = 1.6;

function drawGroundShadow(ctx: Ctx, radius: number): void {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, `rgba(0,0,0,${SHADOW_INNER_ALPHA})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.scale(1, SHADOW_HEIGHT_FRACTION);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();
}

// ── Extremities ──────────────────────────────────────────────────────────────

/** Three toes, not four — a fourth turns the foot into a paddle at 32 px. */
const TOE_COUNT = 3;
const FOOT_HEEL_FRACTION = 0.28;
/** A near foot sits below the key light, so it stays under the body's own `mid`. */
const NEAR_FOOT_LIFT = 0.75;
/** Feet stay flatter than the shin they hang off; a full follow reads broken. */
const FOOT_ANGLE_FOLLOW = 0.22;

/**
 * A splayed scavenger's foot, seen in profile: flat sole, high arch, and three
 * toes staggered along the front so they read as toes rather than as one lump.
 * Drawn in ankle-local space, where the ground is `footHeight` below the origin.
 */
function drawFoot(ctx: Ctx, ankle: Pt, angle: number, style: GoblinStyle, near: boolean): void {
  const { footLength, footHeight } = style.proportions;
  const skin = style.palette.skin;
  const heel = -footLength * FOOT_HEEL_FRACTION;
  const toe = footLength * (1 - FOOT_HEEL_FRACTION);
  const sole = footHeight;
  const ARCH_RISE = 1.5;
  const TOE_RADIUS = 0.16;

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(angle);

  const traceSole = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(heel - grow, -footHeight * 0.2);
    ctx.quadraticCurveTo(heel - grow, sole + grow, heel * 0.35, sole + grow);
    ctx.lineTo(toe * 0.9, sole + grow);
    ctx.quadraticCurveTo(toe + grow, sole * 0.4, toe * 0.72, -footHeight * ARCH_RISE * 0.35 - grow);
    ctx.quadraticCurveTo(
      toe * 0.2,
      -footHeight * ARCH_RISE * 0.6 - grow,
      heel - grow,
      -footHeight * 0.2,
    );
    ctx.closePath();
  };

  ctx.fillStyle = style.palette.outline;
  traceSole(footHeight * 0.22);
  ctx.fill();

  // The far foot takes the same lift off `dark` as every other far limb. At
  // plain `dark` it sat a whole step deeper than the shin above it, and the two
  // read as separate objects rather than one leg.
  ctx.fillStyle = near
    ? mix(skin.dark, skin.mid, NEAR_FOOT_LIFT)
    : mix(skin.dark, skin.mid, FAR_LIMB_LIFT);
  traceSole(0);
  ctx.fill();

  // The instep catches the key light; without it the foot is a flat paddle.
  if (near) {
    ctx.fillStyle = rgba(skin.light, 0.24);
    ctx.beginPath();
    ctx.moveTo(heel * 0.5, -footHeight * 0.5);
    ctx.quadraticCurveTo(
      toe * 0.35,
      -footHeight * ARCH_RISE * 0.55,
      toe * 0.68,
      -footHeight * 0.25,
    );
    ctx.lineTo(toe * 0.6, footHeight * 0.15);
    ctx.quadraticCurveTo(toe * 0.2, -footHeight * 0.15, heel * 0.5, -footHeight * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  // Toes stagger forward and down along the front of the foot, so the profile
  // shows three bumps instead of one ball.
  const toeTone = near ? skin.mid : skin.dark;
  for (let i = 0; i < TOE_COUNT; i++) {
    const t = i / (TOE_COUNT - 1);
    const toeR = footLength * TOE_RADIUS * lerp(1, 0.7, t);
    const toeX = toe * lerp(0.98, 0.7, t);
    // Every toe's underside sits *on* the sole line, never below it: a toe that
    // hangs past the sole reads as a castor and lifts the whole figure off the
    // floor.
    const toeY = sole - toeR;
    ctx.fillStyle = toeTone;
    ctx.beginPath();
    ctx.arc(toeX, toeY, toeR, 0, FULL_CIRCLE);
    ctx.fill();
    ctx.strokeStyle = rgba(skin.shadow, 0.55);
    ctx.lineWidth = footHeight * 0.09;
    ctx.beginPath();
    ctx.arc(toeX, toeY, toeR, deg(-150), deg(-30));
    ctx.stroke();
    // A claw on the leading toe: the cheapest thing that stops a bare foot
    // reading as a slipper.
    if (i === 0) {
      ctx.fillStyle = style.palette.bone.dark;
      ctx.beginPath();
      ctx.moveTo(toeX + toeR * 0.5, toeY - toeR * 0.5);
      ctx.lineTo(toeX + toeR * 1.5, toeY + toeR * 0.1);
      ctx.lineTo(toeX + toeR * 0.55, toeY + toeR * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Three fingers plus a thumb; a fourth finger reads as a mitten at 32 px. */
const FINGER_COUNT = 3;
const FINGER_LENGTH_FRACTION = 1.05;
const FINGER_WIDTH_FRACTION = 0.34;
const THUMB_LENGTH_FRACTION = 1.05;
/** Where the thumb sits on an open hand: well out to the side of the palm. */
const THUMB_OPEN_FAN = deg(-104);
/** …and on a closed fist: folded in almost against the fingers. */
const THUMB_TUCKED_FAN = deg(-26);
/** A tucked thumb is also mostly buried in the fist, so it is drawn shorter. */
const THUMB_TUCKED_FRACTION = 0.58;
/** The thumb is the stubbiest digit, so it is drawn thicker than the fingers. */
const THUMB_THICKNESS_FACTOR = 1.18;
const PALM_FRACTION = 0.95;
/** Fingers fan from just outside the palm, not from its centre. */
const KNUCKLE_FRACTION = 0.82;

/**
 * `openness` 0 curls the fingers into a grip around whatever the hand holds; 1
 * splays them. The far hand of a two-handed weapon and the near hand of every
 * armed pose want 0, an empty balance hand wants ~0.75.
 *
 * Fingers are painted *over* the palm. Painting the palm last — the obvious
 * order, since the palm is the root — hides every finger inside the disc and
 * turns the hand into a mitten with three toes stuck on it.
 */
function drawHand(
  ctx: Ctx,
  at: Pt,
  angle: number,
  style: GoblinStyle,
  near: boolean,
  openness: GripOpenness,
): void {
  const r = style.proportions.handRadius;
  const skin = style.palette.skin;
  const palmTone = near ? skin.mid : mix(skin.dark, skin.mid, FAR_LIMB_LIFT);
  const fingerTone = near ? mix(skin.dark, skin.mid, 0.7) : skin.dark;
  const open = clamp01(openness);

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);

  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.arc(0, 0, r * PALM_FRACTION * 1.22, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = palmTone;
  ctx.beginPath();
  ctx.arc(0, 0, r * PALM_FRACTION, 0, FULL_CIRCLE);
  ctx.fill();

  // A curled grip hooks the fingers back toward the palm; an open hand throws
  // them straight out. Two segments each, so a curl bends instead of kinking.
  const spreadArc = lerp(deg(26), deg(58), open);
  const reach = r * FINGER_LENGTH_FRACTION * lerp(0.7, 1, open);
  const curl = lerp(deg(78), 0, open);
  // The thumb tucks in as the hand closes. Thrown out to the side on a fist
  // wrapped round a haft — which is what it used to do, because only the fingers
  // read `open` — it reads as a stray sixth finger stuck to the weapon rather
  // than as part of the hand.
  const thumbFan = lerp(THUMB_TUCKED_FAN, THUMB_OPEN_FAN, open);
  const thumbLength = r * THUMB_LENGTH_FRACTION * lerp(THUMB_TUCKED_FRACTION, 1, open);
  const digits: ReadonlyArray<readonly [number, number, number]> = [
    ...Array.from({ length: FINGER_COUNT }, (unused, i): readonly [number, number, number] => [
      (i / (FINGER_COUNT - 1) - 0.5) * spreadArc,
      reach,
      1,
    ]),
    [thumbFan, thumbLength, THUMB_THICKNESS_FACTOR],
  ];

  for (const [fan, length, thickness] of digits) {
    const knuckle = along(pt(0, 0), fan, r * KNUCKLE_FRACTION);
    const midJoint = along(knuckle, fan, length * 0.5);
    const tip = along(midJoint, fan + curl, length * 0.5);
    const rootW = r * FINGER_WIDTH_FRACTION * thickness;
    fillCapsule(ctx, knuckle, midJoint, rootW * 1.4, rootW * 1.25, style.palette.outline);
    fillCapsule(ctx, midJoint, tip, rootW * 1.25, rootW * 1.05, style.palette.outline);
    fillCapsule(ctx, knuckle, midJoint, rootW, rootW * 0.88, fingerTone);
    fillCapsule(ctx, midJoint, tip, rootW * 0.88, rootW * 0.7, fingerTone);
  }

  ctx.restore();
}

// ── Torso ────────────────────────────────────────────────────────────────────

const TORSO_OUTLINE_GROWTH = 0.028;
const RIB_COUNT = 3;
const RIB_ALPHA = 0.34;
const LOINCLOTH_DROP = 0.36;

/**
 * Torso silhouette in spine space: the hip sits at the origin and the shoulders
 * at -torsoLength, so the caller can rotate the whole path by the body lean.
 */
function traceTorso(ctx: Ctx, p: GoblinProportions, grow: number): void {
  const hipHalf = p.hipHalfWidth + grow;
  const shoulderHalf = p.shoulderHalfWidth + grow;
  const bulge = p.bellyBulge;
  const top = -p.torsoLength;
  const WAIST_HEIGHT = 0.38;
  const CHEST_HEIGHT = 0.8;
  const SHOULDER_ROUND = 0.34;
  const CROTCH_ROUND = 0.34;

  ctx.beginPath();
  const SPINE_BOW = 0.22;
  ctx.moveTo(-hipHalf, 0);
  ctx.bezierCurveTo(
    -hipHalf - p.torsoLength * SPINE_BOW * 0.5,
    top * WAIST_HEIGHT,
    -shoulderHalf - p.torsoLength * SPINE_BOW,
    top * CHEST_HEIGHT,
    -shoulderHalf,
    top,
  );
  ctx.quadraticCurveTo(0, top - p.shoulderHalfWidth * SHOULDER_ROUND, shoulderHalf, top);
  ctx.bezierCurveTo(
    shoulderHalf + bulge * 0.5,
    top * CHEST_HEIGHT,
    hipHalf + bulge * 1.5,
    top * WAIST_HEIGHT * 0.55,
    hipHalf + bulge * 1.1,
    0,
  );
  ctx.quadraticCurveTo(0, p.hipHalfWidth * CROTCH_ROUND, -hipHalf, 0);
  ctx.closePath();
}

/** Speckle seed. Fixed, so the hide's blemishes land identically on every bake. */
const HIDE_SPECKLE_SEED = 20260802;
const HIDE_SPECKLE_COUNT = 26;
const HIDE_SPECKLE_ALPHA = 0.16;

function drawTorso(ctx: Ctx, style: GoblinStyle, squash: number): void {
  const p = style.proportions;
  const { skin, cloth, outline } = style.palette;
  const top = -p.torsoLength;
  const halfSpan = p.hipHalfWidth + p.bellyBulge;

  ctx.save();
  ctx.scale(1, squash);

  ctx.fillStyle = outline;
  traceTorso(ctx, p, TORSO_OUTLINE_GROWTH);
  ctx.fill();

  traceTorso(ctx, p, 0);
  ctx.fillStyle = skin.mid;
  ctx.fill();

  ctx.save();
  traceTorso(ctx, p, 0);
  ctx.clip();

  // The key comes from the upper left, so the lit side of a figure facing +X is
  // its far side; the belly that leads the walk falls into shadow.
  const shading = ctx.createLinearGradient(-p.shoulderHalfWidth, top, halfSpan, 0);
  shading.addColorStop(0, rgba(skin.light, 0.55));
  shading.addColorStop(0.42, 'rgba(0,0,0,0)');
  shading.addColorStop(1, rgba(skin.shadow, 0.6));
  ctx.fillStyle = shading;
  ctx.fillRect(-halfSpan * 2, top * 1.2, halfSpan * 4, -top * 1.6);

  // Collarbone, pectoral shelf and gut. Without these the torso is a smooth
  // lozenge and the whole upper body reads as a head with arms bolted to it.
  const COLLAR_Y = 0.86;
  const PECTORAL_Y = 0.62;
  ctx.strokeStyle = rgba(skin.shadow, 0.5);
  ctx.lineWidth = p.torsoLength * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-p.shoulderHalfWidth * 0.82, top * COLLAR_Y);
  ctx.quadraticCurveTo(0, top * (COLLAR_Y - 0.1), p.shoulderHalfWidth * 0.78, top * COLLAR_Y);
  ctx.stroke();

  ctx.fillStyle = rgba(skin.light, 0.3);
  ctx.beginPath();
  ctx.moveTo(-p.shoulderHalfWidth * 0.7, top * (COLLAR_Y - 0.06));
  ctx.quadraticCurveTo(
    0,
    top * (PECTORAL_Y + 0.14),
    p.shoulderHalfWidth * 0.68,
    top * (COLLAR_Y - 0.06),
  );
  ctx.quadraticCurveTo(
    0,
    top * (PECTORAL_Y - 0.06),
    -p.shoulderHalfWidth * 0.7,
    top * (COLLAR_Y - 0.06),
  );
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(skin.shadow, RIB_ALPHA);
  ctx.lineWidth = p.torsoLength * 0.035;
  for (let i = 0; i < RIB_COUNT; i++) {
    const RIB_TOP_FRACTION = 0.52;
    const RIB_SPACING = 0.11;
    const ribY = top * (RIB_TOP_FRACTION - i * RIB_SPACING);
    const RIB_SHORTENING = 0.18;
    const span = 1 - i * RIB_SHORTENING;
    ctx.beginPath();
    ctx.moveTo(-p.shoulderHalfWidth * 0.66 * span, ribY - p.torsoLength * 0.02);
    ctx.quadraticCurveTo(
      p.hipHalfWidth * 0.1,
      ribY + p.torsoLength * (0.05 + i * 0.02),
      (p.hipHalfWidth * 0.92 + p.bellyBulge * 0.7) * span,
      ribY - p.torsoLength * 0.01,
    );
    ctx.stroke();
  }

  // A mottled hide. Flat fills are the second-biggest reason the old goblin
  // looked cheap, after the palette.
  const speckle = seededNoise(HIDE_SPECKLE_SEED);
  for (let i = 0; i < HIDE_SPECKLE_COUNT; i++) {
    const sx = lerp(-p.shoulderHalfWidth, halfSpan, speckle());
    const sy = lerp(top, p.hipHalfWidth * 0.3, speckle());
    const size = p.torsoLength * lerp(0.018, 0.05, speckle());
    ctx.fillStyle = rgba(speckle() > 0.5 ? skin.shadow : skin.light, HIDE_SPECKLE_ALPHA);
    ctx.beginPath();
    ctx.ellipse(sx, sy, size, size * 0.72, 0, 0, FULL_CIRCLE);
    ctx.fill();
  }
  ctx.restore();

  // The wrap sits over the hips and hangs below the torso path, so it is drawn
  // after the clip is released.
  const wrapTop = -p.torsoLength * 0.22;
  const wrapBottom = p.hipHalfWidth * LOINCLOTH_DROP + p.torsoLength * 0.1;
  const front = p.hipHalfWidth * 1.1 + p.bellyBulge * 0.6;
  const back = -p.hipHalfWidth * 1.08;
  /** The long front flap hangs well past the short back one; nothing matches. */
  const FRONT_HANG = 2.1;
  const TEAR_COUNT = 4;

  const traceWrap = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(back - grow, wrapTop - grow);
    ctx.lineTo(front + grow, wrapTop - grow);
    ctx.lineTo(front * 0.86, wrapBottom * 0.7);
    // A torn hem: alternating points across the bottom of the front flap.
    for (let i = 0; i <= TEAR_COUNT; i++) {
      const t = i / TEAR_COUNT;
      const x = lerp(front * 0.86, back * 0.82, t);
      const deep = i % 2 === 0 ? FRONT_HANG : FRONT_HANG * 0.55;
      ctx.lineTo(x, wrapBottom * lerp(deep, 0.45, t) + grow);
    }
    ctx.lineTo(back - grow, wrapBottom * 0.32);
    ctx.closePath();
  };

  ctx.fillStyle = outline;
  traceWrap(TORSO_OUTLINE_GROWTH);
  ctx.fill();
  ctx.fillStyle = cloth.mid;
  traceWrap(0);
  ctx.fill();

  ctx.save();
  traceWrap(0);
  ctx.clip();
  ctx.fillStyle = rgba(cloth.shadow, 0.6);
  ctx.fillRect(front * 0.1, wrapTop, front, wrapBottom * FRONT_HANG * 2);
  // The rope belt, knotted off to one side.
  ctx.fillStyle = outline;
  ctx.fillRect(back, wrapTop + p.torsoLength * 0.02, front - back, p.torsoLength * 0.055);
  ctx.fillStyle = style.palette.leather.mid;
  ctx.fillRect(back, wrapTop + p.torsoLength * 0.03, front - back, p.torsoLength * 0.035);
  ctx.restore();

  ctx.fillStyle = style.palette.leather.dark;
  ctx.beginPath();
  ctx.arc(front * 0.42, wrapTop + p.torsoLength * 0.048, p.torsoLength * 0.05, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.restore();
}

// ── Gear ─────────────────────────────────────────────────────────────────────

const PAULDRON_WIDTH_FRACTION = 1.85;
const PAULDRON_HEIGHT_FRACTION = 0.82;
const PAULDRON_STUD_COUNT = 3;

/** One scavenged shoulder plate, strapped on over the near shoulder only. */
function drawPauldron(ctx: Ctx, shoulder: Pt, lean: number, style: GoblinStyle): void {
  const p = style.proportions;
  const { iron, leather, outline } = style.palette;
  const RUST = 0.42;
  const plate = mix(iron.dark, leather.dark, RUST);
  const plateSheen = mix(iron.light, leather.light, RUST);
  const halfWidth = p.armWidth * PAULDRON_WIDTH_FRACTION * 0.5;
  const height = p.armWidth * PAULDRON_HEIGHT_FRACTION;

  ctx.save();
  ctx.translate(shoulder.x, shoulder.y);
  ctx.rotate(lean);

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, halfWidth * 1.12, height * 0.72, 0, Math.PI, FULL_CIRCLE);
  ctx.lineTo(halfWidth * 1.05, height * 0.5);
  ctx.lineTo(-halfWidth * 1.05, height * 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.ellipse(0, 0, halfWidth, height * 0.62, 0, Math.PI, FULL_CIRCLE);
  ctx.lineTo(halfWidth * 0.92, height * 0.4);
  ctx.lineTo(-halfWidth * 0.92, height * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(plateSheen, 0.45);
  ctx.beginPath();
  ctx.ellipse(
    -halfWidth * 0.34,
    -height * 0.2,
    halfWidth * 0.36,
    height * 0.18,
    deg(-20),
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.fillStyle = rgba(iron.shadow, 0.7);
  for (let i = 0; i < PAULDRON_STUD_COUNT; i++) {
    const t = (i + 0.5) / PAULDRON_STUD_COUNT;
    ctx.beginPath();
    ctx.arc(
      lerp(-halfWidth * 0.7, halfWidth * 0.7, t),
      height * 0.24,
      halfWidth * 0.1,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }

  ctx.fillStyle = leather.dark;
  ctx.fillRect(-halfWidth * 0.95, height * 0.4, halfWidth * 1.9, height * 0.16);

  ctx.restore();
}

/** A single strapped forearm bracer — on the far arm, so nothing matches. */
function drawBracer(ctx: Ctx, chain: BoneChain, style: GoblinStyle, widthScale = 1): void {
  const { leather, iron } = style.palette;
  const RIVET_TONE_MIX = 0.5;
  const width = style.proportions.armWidth * widthScale;
  const BRACER_START = 0.3;
  const BRACER_END = 0.85;
  const a = mixPt(chain.joint, chain.end, BRACER_START);
  const b = mixPt(chain.joint, chain.end, BRACER_END);

  fillCapsule(ctx, a, b, width * 0.62, width * 0.56, style.palette.outline);
  fillCapsule(ctx, a, b, width * 0.54, width * 0.48, leather.dark);
  const RIVET_POSITIONS: readonly number[] = [0.3, 0.72];
  for (const at of RIVET_POSITIONS) {
    const rivet = mixPt(a, b, at);
    ctx.fillStyle = mix(iron.dark, leather.light, RIVET_TONE_MIX);
    ctx.beginPath();
    ctx.arc(rivet.x, rivet.y, width * 0.11, 0, FULL_CIRCLE);
    ctx.fill();
  }
}

/** A single shin greave, on the near leg. Rusted, because nothing here is kept. */
function drawGreave(ctx: Ctx, chain: BoneChain, style: GoblinStyle): void {
  const { iron, leather, outline } = style.palette;
  const RUST = 0.42;
  const plate = mix(iron.dark, leather.dark, RUST);
  const plateSheen = mix(iron.light, leather.light, RUST);
  const width = style.proportions.legWidth;
  const GREAVE_START = 0.22;
  const GREAVE_END = 0.82;
  const a = mixPt(chain.joint, chain.end, GREAVE_START);
  const b = mixPt(chain.joint, chain.end, GREAVE_END);

  fillCapsule(ctx, a, b, width * 0.66, width * 0.58, outline);
  fillCapsule(ctx, a, b, width * 0.58, width * 0.5, plate);
  const sheenA = offset(a, LIGHT.x * width * 0.18, LIGHT.y * width * 0.18);
  const sheenB = offset(b, LIGHT.x * width * 0.18, LIGHT.y * width * 0.18);
  fillCapsule(ctx, sheenA, sheenB, width * 0.12, width * 0.09, rgba(plateSheen, 0.34));
}

const NECKLACE_TOOTH_COUNT = 3;

/** A few teeth on a thong — the one piece of jewellery, hung off-centre. */
function drawNecklace(ctx: Ctx, spineTop: Pt, lean: number, style: GoblinStyle): void {
  const p = style.proportions;
  const { bone, leather } = style.palette;
  const spanHalf = p.shoulderHalfWidth * 0.62;
  const drop = p.torsoLength * 0.2;

  ctx.save();
  ctx.translate(spineTop.x, spineTop.y);
  ctx.rotate(lean);

  ctx.strokeStyle = leather.dark;
  ctx.lineWidth = p.torsoLength * 0.03;
  ctx.beginPath();
  ctx.moveTo(-spanHalf, 0);
  ctx.quadraticCurveTo(0, drop * 1.5, spanHalf, 0);
  ctx.stroke();

  const TOOTH_LENGTH = 0.24;
  for (let i = 0; i < NECKLACE_TOOTH_COUNT; i++) {
    const t = (i + 1) / (NECKLACE_TOOTH_COUNT + 1);
    const x = lerp(-spanHalf, spanHalf, t);
    const y = drop * 1.5 * (1 - (2 * t - 1) * (2 * t - 1)) * 0.75;
    ctx.fillStyle = i % 2 === 0 ? bone.shadow : bone.dark;
    ctx.beginPath();
    ctx.moveTo(x - drop * 0.11, y);
    ctx.lineTo(x + drop * 0.11, y);
    ctx.lineTo(x, y + drop * TOOTH_LENGTH * 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** Shafts standing out of the quiver's mouth. Three reads as a bundle; two reads as a mistake. */
const QUIVER_ARROW_COUNT = 3;
/** How far the quiver's mouth sits behind the spine, in shoulder half-widths. */
const QUIVER_BACK_OFFSET = 1.15;
/** Quiver length and width, as fractions of the torso. */
const QUIVER_LENGTH_FRACTION = 0.66;
const QUIVER_HALF_WIDTH_FRACTION = 0.17;
/** How far a shaft stands past the quiver's mouth, as a fraction of its length. */
const QUIVER_SHAFT_OVERHANG = 0.85;
/** Lean of the whole bundle off vertical — back and up, never down. */
// Near vertical. At 28° the tube lay back along the spine and two blind reviews
// named it a tail; standing it up is what turns the same object into ammunition.
const QUIVER_TILT = deg(10);
/** Centres the shaft fan on the quiver's mouth. */
const QUIVER_SPREAD_CENTRE = 0.5;

/**
 * The quiver, drawn behind the torso so the body overlaps it.
 *
 * Angled back and *up*. A quiver hanging down the back is the shape that read as
 * a tail; the fletchings clearing the shoulder line are what make the same
 * object read as ammunition.
 */
function drawQuiver(ctx: Ctx, spineTop: Pt, lean: number, style: GoblinStyle): void {
  const p = style.proportions;
  const { leather, wood, bone, outline } = style.palette;
  const length = p.torsoLength * QUIVER_LENGTH_FRACTION;
  const halfWidth = p.torsoLength * QUIVER_HALF_WIDTH_FRACTION;
  const overhang = length * QUIVER_SHAFT_OVERHANG;

  ctx.save();
  ctx.translate(spineTop.x - p.shoulderHalfWidth * QUIVER_BACK_OFFSET, spineTop.y);
  ctx.rotate(lean + QUIVER_TILT);

  // Shafts first, so the tube's mouth covers where they enter it.
  for (let i = 0; i < QUIVER_ARROW_COUNT; i++) {
    const spread = (i / (QUIVER_ARROW_COUNT - 1) - QUIVER_SPREAD_CENTRE) * halfWidth * 1.7;
    const reach = overhang * lerp(0.78, 1, i / (QUIVER_ARROW_COUNT - 1));
    const shaftHalf = halfWidth * 0.16;
    ctx.save();
    ctx.translate(spread, 0);
    ctx.fillStyle = outline;
    ctx.fillRect(-shaftHalf * 2, -reach, shaftHalf * 4, reach);
    ctx.fillStyle = wood.light;
    ctx.fillRect(-shaftHalf, -reach, shaftHalf * 2, reach);
    // Fletching: a wedge at the very top, which is the part that has to survive
    // as a distinct bump on the silhouette.
    ctx.fillStyle = outline;
    ctx.beginPath();
    ctx.moveTo(0, -reach - shaftHalf);
    ctx.lineTo(-shaftHalf * 4, -reach + overhang * 0.3);
    ctx.lineTo(shaftHalf * 4, -reach + overhang * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? bone.light : bone.mid;
    ctx.beginPath();
    ctx.moveTo(0, -reach);
    ctx.lineTo(-shaftHalf * 2.6, -reach + overhang * 0.26);
    ctx.lineTo(shaftHalf * 2.6, -reach + overhang * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const traceTube = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(-halfWidth - grow, -grow);
    ctx.lineTo(halfWidth + grow, -grow);
    ctx.lineTo(halfWidth * 0.7 + grow, length + grow);
    ctx.lineTo(-halfWidth * 0.7 - grow, length + grow);
    ctx.closePath();
  };
  ctx.fillStyle = outline;
  traceTube(p.torsoLength * 0.02);
  ctx.fill();
  ctx.fillStyle = leather.mid;
  traceTube(0);
  ctx.fill();
  ctx.fillStyle = rgba(leather.light, 0.6);
  ctx.fillRect(-halfWidth, 0, halfWidth * 0.55, length);
  ctx.fillStyle = rgba(leather.shadow, 0.5);
  ctx.fillRect(halfWidth * 0.3, 0, halfWidth * 0.5, length);
  // Two binding straps, so the tube is not a plain trapezoid.
  ctx.fillStyle = leather.shadow;
  ctx.fillRect(-halfWidth, length * 0.22, halfWidth * 2, length * 0.08);
  ctx.fillRect(-halfWidth * 0.85, length * 0.66, halfWidth * 1.7, length * 0.08);

  ctx.restore();
}

// ── Head ─────────────────────────────────────────────────────────────────────
//
// Face layout as fractions of the head radius (X fractions of the half-width).
// The head is seen three-quarters on, so features are pushed toward the facing
// side and the far eye is smaller and closer to the centre.

/** More than three bites and the ear stops reading as one shape. */
const MAX_EAR_NOTCHES = 3;
const EYE_NEAR_X = 0.48;
const EYE_FAR_X = -0.26;
const EYE_Y = -0.16;
const EYE_RADIUS = 0.105;
const FAR_EYE_SCALE = 0.78;
const PUPIL_FRACTION = 0.52;
const BROW_THICKNESS = 0.17;
const BROW_LENGTH = 0.5;
const MOUTH_X = 0.44;
const MOUTH_Y = 0.46;
const MOUTH_HALF_WIDTH = 0.36;
const MOUTH_OPEN_HEIGHT = 0.3;

/** Trace the goblin skull in head-local space: origin at centre, +X forward. */
function traceSkull(ctx: Ctx, p: GoblinProportions): void {
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;

  ctx.beginPath();
  ctx.moveTo(-rx * 0.98, r * 0.04);
  ctx.bezierCurveTo(-rx * 1.02, -r * 0.72, -rx * 0.42, -r * 1.05, rx * 0.16, -r * 0.98);
  ctx.bezierCurveTo(rx * 0.62, -r * 0.92, rx * 0.86, -r * 0.62, rx * 0.9, -r * 0.3);
  ctx.quadraticCurveTo(rx * 0.82, -r * 0.06, rx * 0.72, r * 0.12);
  ctx.quadraticCurveTo(rx * 0.66, r * 0.34, rx * 0.94, r * 0.52);
  ctx.quadraticCurveTo(rx * 0.86, r * 0.86, rx * 0.3, r * 0.94);
  ctx.bezierCurveTo(-rx * 0.24, r * 1.0, -rx * 0.78, r * 0.7, -rx * 0.98, r * 0.04);
  ctx.closePath();
}

/**
 * One ear: a long swept-back cone with notches bitten out of its upper edge.
 * `droop` swings the whole ear down; the walk lags it behind the head, which is
 * the cheapest bit of overlapping action on the whole figure.
 */
function drawEar(
  ctx: Ctx,
  style: GoblinStyle,
  droop: number,
  near: boolean,
  notchSeed: number,
): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const skin = style.palette.skin;
  /** Attachment point on the skull, in head-local space. */
  const EAR_BASE_X = -0.72;
  const EAR_BASE_Y = -0.22;
  /**
   * Back and down. Angles run *toward* 180° as they flatten, so the head's own
   * lean (8–20°) adds to this — 158° on a 20° hunch comes out 2° below
   * horizontal, which reads as a blade through the skull rather than as an ear.
   */
  const EAR_SWEEP = deg(148);
  /** The tip curls further down still, so the ear hangs instead of pointing. */
  const EAR_TIP_DROOP = deg(-22);
  const EAR_BASE_HALF_HEIGHT = 0.3;
  const EAR_OUTLINE_GROWTH = 1.18;
  const INNER_REACH = 0.72;
  /** How far a torn notch bites into the ear, as a fraction of its half-height. */
  const NOTCH_DEPTH = 0.36;
  const NOTCH_SPAN = 0.44;
  const NOTCH_FIRST = 0.24;

  const base = pt(rx * EAR_BASE_X, r * EAR_BASE_Y);
  const angle = EAR_SWEEP + droop;
  const tip = along(base, angle + EAR_TIP_DROOP, p.earLength);
  const halfHeight = r * EAR_BASE_HALF_HEIGHT;
  const acrossX = -Math.sin(angle);
  const acrossY = Math.cos(angle);
  /** A point `t` along the ear's spine, `lift` half-heights off it. */
  const onEar = (t: number, lift: number): Pt => {
    const spine = mixPt(base, tip, t);
    const width = halfHeight * (1 - t * 0.86);
    return { x: spine.x + acrossX * width * lift, y: spine.y + acrossY * width * lift };
  };

  /** Where each notch sits along the ear, and how deep it bites. */
  const notches = Array.from(
    { length: Math.min(style.earNotches, MAX_EAR_NOTCHES) },
    (unused, i) => ({
      at: NOTCH_FIRST + ((i * 0.31 + notchSeed * 0.17) % NOTCH_SPAN),
      depth: NOTCH_DEPTH * (0.7 + ((i + notchSeed) % 3) * 0.22),
    }),
  ).sort((a, b) => a.at - b.at);

  /**
   * The notches are cut into the traced path rather than painted over it. The
   * first cut painted them as dark blobs on top, which read as rivets and left
   * the silhouette perfectly smooth — so the one feature the ear was supposed to
   * contribute at 32 px contributed nothing.
   */
  const traceEar = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(base.x + acrossX * halfHeight * grow, base.y + acrossY * halfHeight * grow);
    let previous = 0;
    for (const notch of notches) {
      const ridge = onEar((previous + notch.at) / 2, 1.28 * grow);
      const rim = onEar(notch.at - 0.05, 1.2 * grow);
      const floorOfNotch = onEar(notch.at, (1.2 - notch.depth) * grow);
      const farRim = onEar(notch.at + 0.05, 1.2 * grow);
      ctx.quadraticCurveTo(ridge.x, ridge.y, rim.x, rim.y);
      ctx.lineTo(floorOfNotch.x, floorOfNotch.y);
      ctx.lineTo(farRim.x, farRim.y);
      previous = notch.at + 0.05;
    }
    const lastRidge = onEar((previous + 1) / 2, 1.2 * grow);
    ctx.quadraticCurveTo(lastRidge.x, lastRidge.y, tip.x, tip.y);
    ctx.quadraticCurveTo(
      onEar(0.45, -1.1 * grow).x,
      onEar(0.45, -1.1 * grow).y,
      base.x - acrossX * halfHeight * grow,
      base.y - acrossY * halfHeight * grow,
    );
    ctx.closePath();
  };

  ctx.save();
  ctx.fillStyle = style.palette.outline;
  traceEar(EAR_OUTLINE_GROWTH);
  ctx.fill();

  // A dark wedge where the ear meets the skull. Without it the two merge into a
  // single swept lump at 32 px and read as a hood rather than as an ear.
  const rootShade = onEar(0.16, 0);
  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.ellipse(
    rootShade.x,
    rootShade.y,
    halfHeight * 0.55,
    halfHeight * 1.15,
    angle,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.fillStyle = near ? skin.mid : skin.dark;
  traceEar(1);
  ctx.fill();

  if (near) {
    ctx.save();
    traceEar(1);
    ctx.clip();
    // The hollow of the ear, one shade down — without it a long ear is a spike.
    ctx.fillStyle = rgba(skin.shadow, 0.5);
    ctx.beginPath();
    ctx.moveTo(onEar(0.06, 0.35).x, onEar(0.06, 0.35).y);
    ctx.quadraticCurveTo(
      onEar(0.42, 0.85).x,
      onEar(0.42, 0.85).y,
      onEar(INNER_REACH, 0.1).x,
      onEar(INNER_REACH, 0.1).y,
    );
    ctx.quadraticCurveTo(
      onEar(0.4, -0.2).x,
      onEar(0.4, -0.2).y,
      onEar(0.06, 0.35).x,
      onEar(0.06, 0.35).y,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawEye(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  scale: number,
  openness: number,
  style: GoblinStyle,
): void {
  const { eye, sclera, outline } = style.palette;
  const radius = r * EYE_RADIUS * scale;
  const open = clamp01(openness);

  const SOCKET_RX = 2.1;
  const SOCKET_RY = 1.8;
  ctx.fillStyle = sclera;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    radius * SOCKET_RX,
    radius * SOCKET_RY * Math.max(open, 0.1),
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  if (open < 0.2) return;

  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * open, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    radius * PUPIL_FRACTION,
    radius * PUPIL_FRACTION * open * 1.6,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

/**
 * A lipless slot with two asymmetric fangs.
 *
 * An even row of rectangular teeth is a jack-o'-lantern grin and was the single
 * cutest thing on the first cut of this figure. Two teeth breaking an otherwise
 * dark line reads as a mouth that bites.
 */
function drawMouth(ctx: Ctx, style: GoblinStyle, mouthOpen: number): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const { mouthInner, toothEnamel, outline } = style.palette;
  const cx = rx * MOUTH_X;
  const cy = r * MOUTH_Y;
  const halfWidth = rx * MOUTH_HALF_WIDTH;
  const open = clamp01(mouthOpen);
  const height = r * lerp(0.035, MOUTH_OPEN_HEIGHT, open);

  const traceSlot = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, cy - height * 0.2);
    ctx.quadraticCurveTo(
      cx - halfWidth * 0.1,
      cy + height * 1.7,
      cx + halfWidth,
      cy - height * 0.6,
    );
    ctx.quadraticCurveTo(cx, cy - height * 1.1, cx - halfWidth, cy - height * 0.2);
    ctx.closePath();
  };

  ctx.fillStyle = open > 0.15 ? mouthInner : outline;
  traceSlot();
  ctx.fill();

  ctx.save();
  traceSlot();
  ctx.clip();
  ctx.fillStyle = toothEnamel;
  // Deliberately mismatched: one long lower fang forward, one short upper one
  // set back. Symmetry here is what made the first cut read as a grin.
  const HANGING_FANG_X = 0.3;
  const HANGING_FANG_WIDTH = 0.28;
  const SNAGGLE_X = -0.5;
  const SNAGGLE_WIDTH = 0.2;
  ctx.beginPath();
  ctx.moveTo(cx + halfWidth * HANGING_FANG_X, cy - height * 1.5);
  ctx.lineTo(cx + halfWidth * (HANGING_FANG_X + HANGING_FANG_WIDTH), cy - height * 1.5);
  ctx.lineTo(cx + halfWidth * (HANGING_FANG_X + HANGING_FANG_WIDTH * 0.35), cy + height * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + halfWidth * SNAGGLE_X, cy + height * 1.5);
  ctx.lineTo(cx + halfWidth * (SNAGGLE_X + SNAGGLE_WIDTH), cy + height * 1.5);
  ctx.lineTo(cx + halfWidth * (SNAGGLE_X + SNAGGLE_WIDTH * 0.6), cy - height * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // The lower lip line: a lit edge under the slot, so the mouth sits in a jaw
  // rather than floating on the cheek.
  ctx.strokeStyle = rgba(style.palette.skin.light, 0.4);
  ctx.lineWidth = r * 0.035;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth * 0.9, cy + height * 0.6);
  ctx.quadraticCurveTo(cx, cy + height * 2.1, cx + halfWidth * 0.94, cy + height * 0.1);
  ctx.stroke();
}

/**
 * The hooked nose, drawn over the face so its overhang breaks the skull line.
 *
 * A hook is a convex bridge over a *concave* underside meeting at a downturned
 * tip. Drawn as a plain wedge instead — which is what the first cut did — the
 * head reads as a bird's, and no amount of ear tuning fixes that.
 */
function drawNose(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const skin = style.palette.skin;
  const bridgeX = rx * 0.5;
  const bridgeY = -r * 0.36;
  const tipX = rx * 0.72 + p.noseProjection;
  const tipY = r * 0.18;
  /** How far the underside scoops back in toward the face beneath the tip. */
  const SEPTUM_INSET = 0.38;
  const septumX = lerp(tipX, rx * 0.44, SEPTUM_INSET);
  const septumY = r * 0.3;

  const traceNose = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(bridgeX - grow, bridgeY - grow);
    // Bridge: convex, bulging forward as it drops.
    ctx.bezierCurveTo(rx * 0.78 + grow, -r * 0.24, tipX + grow, -r * 0.06, tipX + grow, tipY);
    // Tip turns down and then the underside scoops back under it.
    ctx.quadraticCurveTo(tipX * 0.98 + grow, tipY + r * 0.16 + grow, septumX, septumY + grow);
    // Concave run back to the cheek, which is what makes it a hook.
    ctx.quadraticCurveTo(rx * 0.56, r * 0.16, rx * 0.42 - grow, r * 0.02);
    ctx.quadraticCurveTo(rx * 0.4 - grow, -r * 0.18, bridgeX - grow, bridgeY - grow);
    ctx.closePath();
  };

  ctx.fillStyle = style.palette.outline;
  traceNose(0.005);
  ctx.fill();

  ctx.fillStyle = skin.mid;
  traceNose(0);
  ctx.fill();

  ctx.save();
  traceNose(0);
  ctx.clip();
  // The underside of a hook is always the darkest part of the face.
  ctx.fillStyle = rgba(skin.shadow, 0.65);
  ctx.beginPath();
  ctx.moveTo(rx * 0.4, r * 0.02);
  ctx.quadraticCurveTo(rx * 0.62, r * 0.26, tipX, tipY);
  ctx.lineTo(tipX, tipY + r * 0.3);
  ctx.lineTo(rx * 0.4, r * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(skin.light, 0.5);
  ctx.beginPath();
  ctx.moveTo(bridgeX, bridgeY);
  ctx.quadraticCurveTo(rx * 0.76, -r * 0.24, tipX * 0.98, tipY - r * 0.08);
  ctx.lineTo(tipX * 0.9, tipY - r * 0.02);
  ctx.quadraticCurveTo(rx * 0.7, -r * 0.18, bridgeX, bridgeY + r * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // A single nostril slit under the hook. One is enough at this size, and it is
  // what stops the tip reading as a rounded knob.
  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.ellipse(
    lerp(tipX, septumX, 0.5),
    septumY - r * 0.04,
    r * 0.06,
    r * 0.018,
    deg(28),
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

/** The rag hood, pulled back off the ears. */
function drawHood(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const { cloth, outline } = style.palette;

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.moveTo(-rx * 1.04, r * 0.06);
  ctx.bezierCurveTo(-rx * 1.1, -r * 0.8, -rx * 0.4, -r * 1.16, rx * 0.2, -r * 1.06);
  ctx.bezierCurveTo(rx * 0.68, -r * 0.98, rx * 0.94, -r * 0.66, rx * 0.94, -r * 0.32);
  ctx.lineTo(rx * 0.6, -r * 0.42);
  ctx.bezierCurveTo(rx * 0.4, -r * 0.8, -rx * 0.4, -r * 0.86, -rx * 0.74, -r * 0.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = cloth.mid;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.98, r * 0.02);
  ctx.bezierCurveTo(-rx * 1.04, -r * 0.78, -rx * 0.38, -r * 1.1, rx * 0.18, -r * 1.0);
  ctx.bezierCurveTo(rx * 0.64, -r * 0.92, rx * 0.88, -r * 0.64, rx * 0.88, -r * 0.36);
  ctx.lineTo(rx * 0.58, -r * 0.46);
  ctx.bezierCurveTo(rx * 0.38, -r * 0.82, -rx * 0.38, -r * 0.88, -rx * 0.7, -r * 0.24);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(cloth.shadow, 0.5);
  ctx.beginPath();
  ctx.moveTo(rx * 0.1, -r * 1.0);
  ctx.quadraticCurveTo(rx * 0.8, -r * 0.86, rx * 0.88, -r * 0.36);
  ctx.lineTo(rx * 0.58, -r * 0.46);
  ctx.quadraticCurveTo(rx * 0.5, -r * 0.84, rx * 0.05, -r * 0.94);
  ctx.closePath();
  ctx.fill();
}

/** Draw the head in head-local space: origin at its centre, +X is forward. */
function drawHead(ctx: Ctx, style: GoblinStyle, pose: GoblinPose): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const skin = style.palette.skin;

  const FAR_EAR_DROOP = deg(10);
  const FAR_EAR_NOTCH_SEED = 1;
  const NEAR_EAR_NOTCH_SEED = 0;

  ctx.save();
  ctx.save();
  ctx.translate(rx * 0.06, -r * 0.05);
  drawEar(ctx, style, pose.earLag + FAR_EAR_DROOP, false, FAR_EAR_NOTCH_SEED);
  ctx.restore();
  drawEar(ctx, style, pose.earLag, true, NEAR_EAR_NOTCH_SEED);

  ctx.fillStyle = style.palette.outline;
  ctx.save();
  ctx.scale(1.04, 1.04);
  traceSkull(ctx, p);
  ctx.fill();
  ctx.restore();

  traceSkull(ctx, p);
  ctx.fillStyle = skin.mid;
  ctx.fill();

  ctx.save();
  traceSkull(ctx, p);
  ctx.clip();

  const faceShading = ctx.createLinearGradient(-rx, -r, rx, r);
  faceShading.addColorStop(0, rgba(skin.light, 0.6));
  faceShading.addColorStop(0.45, 'rgba(0,0,0,0)');
  faceShading.addColorStop(1, rgba(skin.shadow, 0.5));
  ctx.fillStyle = faceShading;
  ctx.fillRect(-rx * 1.2, -r * 1.2, rx * 2.4, r * 2.4);

  // A heavy brow ridge is most of what stops the face reading as cute: it puts
  // the eyes in shadow and gives the skull a hard horizontal above them.
  const browY = r * EYE_Y - r * BROW_THICKNESS * 1.2;
  ctx.fillStyle = rgba(skin.shadow, 0.5);
  ctx.beginPath();
  ctx.moveTo(-rx * 0.34, browY - r * BROW_THICKNESS * 0.4);
  ctx.quadraticCurveTo(
    rx * 0.3,
    browY - r * BROW_THICKNESS * 1.5,
    rx * 0.9,
    browY - r * BROW_THICKNESS * 0.6,
  );
  ctx.quadraticCurveTo(
    rx * 0.82,
    browY + r * BROW_THICKNESS * 1.1,
    rx * 0.52,
    browY + r * BROW_THICKNESS * 0.9,
  );
  ctx.quadraticCurveTo(
    rx * 0.1,
    browY + r * BROW_THICKNESS * 0.4,
    -rx * 0.3,
    browY + r * BROW_THICKNESS * 0.3,
  );
  ctx.closePath();
  ctx.fill();

  // A hard lit edge along the top of the ridge is what turns a shadow into bone.
  ctx.strokeStyle = rgba(skin.light, 0.5);
  ctx.lineWidth = r * 0.045;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.3, browY - r * BROW_THICKNESS * 0.5);
  ctx.quadraticCurveTo(
    rx * 0.3,
    browY - r * BROW_THICKNESS * 1.6,
    rx * 0.88,
    browY - r * BROW_THICKNESS * 0.7,
  );
  ctx.stroke();

  const nearEyeX = rx * EYE_NEAR_X;
  const farEyeX = rx * EYE_FAR_X;
  const eyeY = r * EYE_Y;
  drawEye(ctx, farEyeX, eyeY, r, FAR_EYE_SCALE, pose.eyeOpen * FAR_EYE_SCALE, style);
  drawEye(ctx, nearEyeX, eyeY, r, 1, pose.eyeOpen, style);

  ctx.strokeStyle = style.palette.outline;
  ctx.lineWidth = r * 0.055;
  ctx.lineCap = 'round';
  for (const [eyeX, browScale] of [
    [nearEyeX, 1],
    [farEyeX, FAR_EYE_SCALE],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(eyeX - rx * BROW_LENGTH * 0.4 * browScale, eyeY - r * 0.24 * browScale);
    ctx.lineTo(eyeX + rx * BROW_LENGTH * 0.5 * browScale, eyeY - r * 0.15 * browScale);
    ctx.stroke();
  }

  // A sunken cheek under the near eye finishes the undernourished read.
  ctx.fillStyle = rgba(skin.shadow, 0.35);
  ctx.beginPath();
  ctx.ellipse(rx * 0.34, r * 0.24, rx * 0.24, r * 0.2, deg(-15), 0, FULL_CIRCLE);
  ctx.fill();

  drawMouth(ctx, style, pose.mouthOpen);
  ctx.restore();

  drawNose(ctx, style);
  if (style.gear.hood) drawHood(ctx, style);
  ctx.restore();
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Far limbs sit between `dark` and `mid`: at `dark` they merge with the outline,
 * and against the darker floor palettes at 32 px the far leg disappears
 * altogether and the goblin looks one-legged. The depth cue that survives the
 * lift is the missing sheen, not the fill.
 */
const FAR_LIMB_LIFT = 0.55;
/** How much narrower the free far arm is than the weapon arm. */
const FAR_ARM_SCALE = 0.82;
/** A far hand brought across onto a haft is less foreshortened, but not by much. */
const FAR_ARM_ON_HAFT_SCALE = 0.86;
/** The far limb's missing highlight is the depth cue; `null` is the whole point. */
const NECK_WIDTH_FRACTION = 0.46;

/** Occlusion where a limb enters the body. Limbs without it look glued on. */
const SOCKET_SHADE_ALPHA = 0.34;
const SOCKET_SHADE_GROWTH = 0.72;

function drawSocketShade(ctx: Ctx, at: Pt, limbWidth: number, skin: Ramp): void {
  const radius = limbWidth * SOCKET_SHADE_GROWTH;
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  gradient.addColorStop(0, rgba(skin.shadow, SOCKET_SHADE_ALPHA));
  gradient.addColorStop(1, rgba(skin.shadow, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_CIRCLE);
  ctx.fill();
}

/**
 * Anything the goblin carries, drawn in figure space with the origin at the
 * gripping hand and +X down the weapon's own axis.
 *
 * Every weapon here is rigid but one. The bow's shape changes frame to frame,
 * and it learns this frame's draw from `goblinWeapons.setBowDraw`, published by
 * the choreography immediately before the figure is painted — not through this
 * signature, because the draw is a property of the *weapon* and putting it on
 * `GoblinPose` would give every other archetype a field it can only leave at
 * zero.
 */
export type PropPainter = (ctx: Ctx, hand: Pt, wristAngle: number) => void;

/** A weapon, plus the geometry the arc gates and the choreography need. */
export interface GoblinProp {
  readonly paint: PropPainter;
  /**
   * The off hand is closed on this weapon and crosses in front of the body,
   * even though it is not gripping a point on the weapon's own axis.
   *
   * Exists for the bow: its draw hand holds the string at the cheek, which is
   * neither a free hand nor a point along the stave, and it has to be painted
   * after the torso like any other hand brought across the chest — a draw hand
   * painted before the body vanishes behind it and the goblin appears to be
   * shooting a bow nobody is drawing.
   */
  readonly offHandCloses?: boolean;
  /** Distance from the grip hand to the business end, in tile units. */
  readonly tipDistance: number;
  /** Where the off hand grips a two-handed weapon, or null for one-handed. */
  readonly offGripDistance: number | null;
  /**
   * How far the head hangs off the weapon's own axis, in tile units.
   *
   * A sword's tip *is* its lowest point, but an axe bit drops a fifth of a tile
   * below the haft it is socketed to. Ground clearance measured to the tip alone
   * therefore lifts a sword correctly and still parks an axe head in among the
   * feet, where it fuses with them into one wedge — three silhouette reviews
   * running named the axe goblin as a shovel because of it.
   */
  readonly headHalfHeight: number;
}

/**
 * Draw one goblin frame. `originX`/`originY` is the point between the feet and
 * `unit` is the pixel size of one tile; the figure always faces +X, so callers
 * mirror it at runtime rather than baking a second facing.
 */
export function drawGoblin(
  ctx: Ctx,
  originX: number,
  originY: number,
  unit: number,
  style: GoblinStyle,
  pose: GoblinPose,
  prop?: GoblinProp,
): void {
  const p = style.proportions;
  const { skin, outline } = style.palette;
  const skeleton = buildSkeleton(style, pose);

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);

  drawGroundShadow(ctx, p.shoulderHalfWidth * SHADOW_RADIUS_FRACTION);

  const nearPaint: LimbPaint = {
    fill: skin.mid,
    outline,
    sheen: rgba(skin.rim, 0.2),
  };
  const farPaint: LimbPaint = {
    fill: mix(skin.dark, skin.mid, FAR_LIMB_LIFT),
    outline,
    sheen: null,
  };

  const nearWristAngle =
    pose.weaponAngle ??
    segmentAngle(skeleton.nearArm.joint, skeleton.nearArm.end) + pose.wristTwist;
  const paintProp = (): void => {
    if (prop === undefined) return;
    prop.paint(ctx, skeleton.nearArm.end, nearWristAngle);
  };

  const twoHanded =
    prop !== undefined && (prop.offGripDistance !== null || prop.offHandCloses === true);
  // The far arm is further from the camera in a three-quarter view, so it is
  // drawn narrower — without this the free arm reads as the same mass as the
  // weapon arm and the figure looks slab-sided. A hand brought across the body
  // onto a two-handed haft is much less foreshortened than one hanging at the
  // far hip, so it keeps most of its width.
  const farArmScale = twoHanded ? FAR_ARM_ON_HAFT_SCALE : FAR_ARM_SCALE;
  const farStyle: GoblinStyle = {
    ...style,
    proportions: { ...p, handRadius: p.handRadius * farArmScale },
  };
  const paintFarArm = (): void => {
    // Far paint even on a haft: the off arm crosses in front of the torso, and
    // painting it at near value merges it with the weapon arm and the haft into
    // one unreadable mass. The darker ramp is what separates the two arms.
    drawLimb(ctx, skeleton.farArm, p.armWidth * farArmScale, farPaint);
    if (style.gear.bracer) drawBracer(ctx, skeleton.farArm, style, farArmScale);
    drawHand(
      ctx,
      skeleton.farArm.end,
      twoHanded
        ? nearWristAngle
        : segmentAngle(skeleton.farArm.joint, skeleton.farArm.end) + WRIST_FORWARD_TURN,
      farStyle,
      !twoHanded,
      twoHanded ? CLOSED_GRIP : OPEN_HAND,
    );
  };
  if (!twoHanded) paintFarArm();

  drawLimb(ctx, skeleton.farLeg, p.legWidth, farPaint);
  drawFoot(
    ctx,
    skeleton.farLeg.end,
    segmentAngle(skeleton.farLeg.joint, skeleton.farLeg.end) * FOOT_ANGLE_FOLLOW,
    style,
    false,
  );

  if (pose.propBehind) paintProp();

  // Behind the torso: it is on the creature's back, and painting it in front
  // would put a leather tube across its chest.
  if (style.gear.quiver) drawQuiver(ctx, skeleton.spineTop, skeleton.lean, style);

  ctx.save();
  ctx.translate(skeleton.hip.x, skeleton.hip.y);
  ctx.rotate(skeleton.lean);
  drawTorso(ctx, style, pose.torsoSquash);
  ctx.restore();

  drawSocketShade(ctx, skeleton.farShoulder, p.armWidth, skin);
  drawSocketShade(ctx, skeleton.nearShoulder, p.armWidth, skin);

  drawLimb(ctx, skeleton.nearLeg, p.legWidth, nearPaint);
  if (style.gear.greave) drawGreave(ctx, skeleton.nearLeg, style);
  drawFoot(
    ctx,
    skeleton.nearLeg.end,
    segmentAngle(skeleton.nearLeg.joint, skeleton.nearLeg.end) * FOOT_ANGLE_FOLLOW,
    style,
    true,
  );

  fillCapsule(
    ctx,
    skeleton.spineTop,
    offset(skeleton.headCentre, 0, p.headRadius * 0.82),
    p.headRadius * NECK_WIDTH_FRACTION,
    p.headRadius * NECK_WIDTH_FRACTION * 0.82,
    skin.dark,
  );

  if (style.gear.necklace) drawNecklace(ctx, skeleton.spineTop, skeleton.lean, style);

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  ctx.rotate(skeleton.headAngle);
  drawHead(ctx, style, pose);
  ctx.restore();

  if (twoHanded) paintFarArm();
  drawLimb(ctx, skeleton.nearArm, p.armWidth, nearPaint);
  if (style.gear.pauldron) drawPauldron(ctx, skeleton.nearShoulder, skeleton.lean, style);

  // The gripping fist goes on top of whatever it is gripping. A haft is wider
  // than a goblin's fist, so painting the weapon over the hand buries it, and on
  // the overhead frames — where the haft crosses the whole body — the figure
  // ends up swinging something nobody is holding. The haft still passes in front
  // of the face, which is where a weapon held up in front of the chest belongs;
  // it is only the hand that has to come back over it.
  if (!pose.propBehind) paintProp();
  drawHand(
    ctx,
    skeleton.nearArm.end,
    nearWristAngle,
    style,
    true,
    prop === undefined ? OPEN_HAND : CLOSED_GRIP,
  );

  ctx.restore();
}

/** A hand wrapped round a haft. */
const CLOSED_GRIP = 0;
/** A free hand: a loose curl, not a splay. Fully open reads as jazz hands. */
const OPEN_HAND = 0.16;
/** Hands turn forward off the forearm line rather than dangling down it. */
const WRIST_FORWARD_TURN = deg(-46);

// ── The four archetypes ──────────────────────────────────────────────────────
//
// The height spread and the ear-length spread (0.36 → 0.24, before scaling)
// are what make the four read as different creatures in a 32-px silhouette;
// do not collapse either.
//
// Goblins are small: the tallest of them stands a little over half of Carl's
// 2.03 tiles. These tables author *shape* — how a gut sits against a shoulder
// line — and {@link ARCHETYPE_SCALE} sets the height the figure is drawn at, so
// tuning the bulk of one archetype can never quietly change how tall it stands
// next to the player.

/** Sole-to-skull height each archetype stands at in play, in tile units. */
const ARCHETYPE_HEIGHTS: Record<GoblinArchetype, number> = {
  sword: 0.76,
  axe: 0.84,
  mace: 0.8,
  warhammer: 0.86,
  /**
   * The tallest of the five, and the only one that is *thin*.
   *
   * The other four are identified by weapon and ear length; an archer has to be
   * identifiable before its bow is drawn, because the whole point of it is that
   * the player picks it out of a mixed room and goes for it first. Height plus a
   * narrow build is the one silhouette cue that survives the bow being held
   * along the body at rest.
   */
  bow: 0.88,
};

export type GoblinArchetype = 'sword' | 'axe' | 'mace' | 'warhammer' | 'bow';

export const GOBLIN_ARCHETYPES: readonly GoblinArchetype[] = [
  'sword',
  'axe',
  'mace',
  'warhammer',
  'bow',
] as const;

/** Filthy rag: the loincloth, the hood and every binding. */
const CLOTH: Ramp = {
  shadow: '#2a2620',
  dark: '#3f382c',
  mid: '#574d3b',
  light: '#6f6349',
  rim: '#8a7c5e',
};

const LEATHER: Ramp = {
  shadow: '#241a12',
  dark: '#3a2a1b',
  mid: '#543c26',
  light: '#6d4f31',
  rim: '#8b6742',
};

/** Pitted, scavenged plate — never polished, because none of it was earned. */
const IRON: Ramp = {
  shadow: '#1e2126',
  dark: '#333940',
  mid: '#4e565f',
  light: '#737d87',
  rim: '#a8b2bb',
};

const BONE: Ramp = {
  shadow: '#6d654f',
  dark: '#918766',
  mid: '#b8ad88',
  light: '#d8cfae',
  rim: '#eee7cd',
};

const WOOD: Ramp = {
  shadow: '#2b1f14',
  dark: '#43301d',
  mid: '#5e452a',
  light: '#7a5c39',
  rim: '#9a7a4f',
};

const GOBLIN_OUTLINE = '#14110e';
const GOBLIN_EYE = '#e8a33a';
const GOBLIN_SCLERA = '#1a1410';
const GOBLIN_TOOTH = '#d9d2b4';
const GOBLIN_MOUTH_INNER = '#40161a';

function goblinPalette(skin: Ramp): GoblinPalette {
  return {
    skin,
    cloth: CLOTH,
    leather: LEATHER,
    iron: IRON,
    bone: BONE,
    wood: WOOD,
    eye: GOBLIN_EYE,
    sclera: GOBLIN_SCLERA,
    toothEnamel: GOBLIN_TOOTH,
    mouthInner: GOBLIN_MOUTH_INNER,
    outline: GOBLIN_OUTLINE,
  };
}

/**
 * Skin `mid` luminances are spread 94–128, and every ramp spans from roughly a
 * third of its `mid` at `shadow` to nearly double at `rim`.
 *
 * The span is the point. An earlier pass chased separation from the floor by
 * dropping the whole set to luminance 66, which bought the contrast and turned
 * the goblins into dark silhouettes — at 32 px with the renderer's 0.5×
 * downscale there was nothing inside the outline to see. Contrast *within* the
 * figure is what makes a face and a fist survive that downscale, and a narrow
 * ramp has none to give however dark you push it.
 *
 * The spread matters as much as the values. Floors run 101 through 185, so there
 * is no single luminance that clears all of them — setting the four archetypes
 * to one value simply picks a floor for all four to disappear against at once,
 * which is what happened when they were briefly levelled at 104 and every one of
 * them landed within three points of grass. Spread out, no single floor can take
 * more than one of them, and the dark outline carries the rest.
 *
 * Do not flatten these ramps to buy luminance contrast back — that trade has
 * been made once and it produced four dark silhouettes with nothing legible
 * inside them.
 */
const SWORD_SKIN: Ramp = {
  shadow: '#20261c',
  dark: '#394432',
  mid: '#596a4f',
  light: '#7b936d',
  rim: '#a6c693',
};

const AXE_SKIN: Ramp = {
  shadow: '#282c17',
  dark: '#474e29',
  mid: '#6f7a41',
  light: '#98a859',
  rim: '#cee378',
};

const MACE_SKIN: Ramp = {
  shadow: '#392e13',
  dark: '#665122',
  mid: '#9f7f35',
  light: '#dcaf49',
  rim: '#ffeb63',
};

const WARHAMMER_SKIN: Ramp = {
  shadow: '#19241e',
  dark: '#2c3f35',
  mid: '#456352',
  light: '#5f8872',
  rim: '#81b899',
};

/**
 * A vivid spring green — the archer separates from the other four by *chroma and
 * value*, not by hue. The others are a desaturated olive, a yellow-green, a cold
 * teal and a gold; this is the only one that is both bright and fully saturated,
 * so it is still the figure the eye lands on first in a mixed pack.
 *
 * The span from `shadow` to `rim` is close to the widest in the set on purpose.
 * An earlier cold-blue pass sat every tone under the darkest floor, which bought
 * separation from the ground and left nothing legible *inside* the silhouette at
 * 32 px — a face and a fist need internal contrast more than the outline needs
 * to win against the floor, and the near-black `shadow` plus the pale `rim` give
 * the figure both.
 */
const BOW_SKIN: Ramp = {
  shadow: '#0d2515',
  dark: '#1e5230',
  mid: '#3f9e57',
  light: '#6ec97f',
  rim: '#b6f0bd',
};

const SWORD_BUILD: GoblinProportions = {
  thighLength: 0.29,
  shinLength: 0.27,
  footHeight: 0.05,
  torsoLength: 0.34,
  neckLength: 0.06,
  headRadius: 0.175,
  headWidthFactor: 0.98,
  shoulderHalfWidth: 0.175,
  hipHalfWidth: 0.13,
  bellyBulge: 0.01,
  upperArmLength: 0.36,
  forearmLength: 0.4,
  legWidth: 0.12,
  armWidth: 0.1,
  handRadius: 0.075,
  footLength: 0.25,
  earLength: 0.36,
  noseProjection: 0.1,
};

const SWORD_STYLE: GoblinStyle = {
  palette: goblinPalette(SWORD_SKIN),
  proportions: SWORD_BUILD,
  gear: {
    pauldron: false,
    bracer: true,
    greave: false,
    necklace: true,
    hood: false,
    quiver: false,
  },
  spineLean: deg(8),
  // Three, not four: `MAX_EAR_NOTCHES` clamps past that anyway, and a fourth
  // bite cuts the ear into separate shards rather than nicking one edge.
  earNotches: 3,
};

const AXE_BUILD: GoblinProportions = {
  thighLength: 0.3,
  shinLength: 0.28,
  footHeight: 0.06,
  torsoLength: 0.39,
  neckLength: 0.06,
  headRadius: 0.2,
  headWidthFactor: 1.06,
  shoulderHalfWidth: 0.21,
  hipHalfWidth: 0.16,
  bellyBulge: 0.04,
  upperArmLength: 0.37,
  forearmLength: 0.46,
  legWidth: 0.155,
  armWidth: 0.125,
  handRadius: 0.085,
  footLength: 0.26,
  earLength: 0.3,
  noseProjection: 0.09,
};

const AXE_STYLE: GoblinStyle = {
  palette: goblinPalette(AXE_SKIN),
  proportions: AXE_BUILD,
  gear: {
    pauldron: true,
    bracer: false,
    greave: true,
    necklace: false,
    hood: false,
    quiver: false,
  },
  spineLean: deg(12),
  earNotches: 3,
};

/**
 * Short and wiry, not heavy. This one was originally pot-bellied, and it was cut
 * twice on Ryan's note that it still read as fat — it is now the *shortest* of
 * the four rather than the widest, and carries barely more bulk than the sword
 * goblin. What identifies it at 32 px is no longer its mass: it is the shortest
 * ears in the set (0.24) and the flanged head of the mace.
 */
const MACE_BUILD: GoblinProportions = {
  thighLength: 0.27,
  shinLength: 0.26,
  footHeight: 0.06,
  torsoLength: 0.38,
  neckLength: 0.06,
  headRadius: 0.205,
  headWidthFactor: 1.0,
  shoulderHalfWidth: 0.195,
  hipHalfWidth: 0.145,
  bellyBulge: 0.04,
  upperArmLength: 0.38,
  forearmLength: 0.42,
  legWidth: 0.135,
  armWidth: 0.112,
  handRadius: 0.082,
  footLength: 0.26,
  earLength: 0.24,
  noseProjection: 0.12,
};

const MACE_STYLE: GoblinStyle = {
  palette: goblinPalette(MACE_SKIN),
  proportions: MACE_BUILD,
  gear: {
    pauldron: false,
    bracer: true,
    greave: false,
    necklace: false,
    hood: true,
    quiver: false,
  },
  spineLean: deg(16),
  earNotches: 2,
};

const WARHAMMER_BUILD: GoblinProportions = {
  thighLength: 0.35,
  shinLength: 0.33,
  footHeight: 0.07,
  torsoLength: 0.45,
  neckLength: 0.07,
  headRadius: 0.23,
  headWidthFactor: 1.04,
  shoulderHalfWidth: 0.29,
  hipHalfWidth: 0.175,
  bellyBulge: 0.03,
  upperArmLength: 0.47,
  forearmLength: 0.51,
  legWidth: 0.21,
  armWidth: 0.17,
  handRadius: 0.105,
  footLength: 0.33,
  earLength: 0.26,
  noseProjection: 0.11,
};

const WARHAMMER_STYLE: GoblinStyle = {
  palette: goblinPalette(WARHAMMER_SKIN),
  proportions: WARHAMMER_BUILD,
  gear: { pauldron: true, bracer: true, greave: true, necklace: true, hood: false, quiver: false },
  spineLean: deg(20),
  earNotches: 3,
};

/**
 * Long-limbed and narrow: the longest arms in the set on the narrowest
 * shoulders, because a bow is drawn with the whole span of both arms and a
 * stocky archer cannot reach full draw without the rig clamping the arm.
 *
 * The ears are the longest of the five (0.38). With the bow held along the body
 * at rest there is no weapon shape to name it by, so the ears carry the whole
 * identity on every non-shooting frame.
 */
const BOW_BUILD: GoblinProportions = {
  thighLength: 0.33,
  shinLength: 0.32,
  footHeight: 0.05,
  // Long torso on narrow hips, and shoulders nearly twice the hips' width. Lean
  // is not the same as *tubular*: at equal shoulder and hip width the figure had
  // no chest for a bow arm to hang off, and a blind review read the whole thing
  // as a pipe. Wide-and-flat is also the shape nothing else in the goblin set
  // has — the other four are wide *and* thick.
  torsoLength: 0.45,
  neckLength: 0.07,
  headRadius: 0.175,
  headWidthFactor: 0.95,
  shoulderHalfWidth: 0.19,
  hipHalfWidth: 0.115,
  bellyBulge: 0.0,
  upperArmLength: 0.46,
  forearmLength: 0.5,
  // Legs a good deal thicker than the arms, and not only for looks: the gore
  // sheet cuts a limb straight off these numbers, and at 0.115 against 0.1 the
  // severed arm and the severed leg were the same 16-px blob (gate G9c).
  legWidth: 0.135,
  armWidth: 0.09,
  handRadius: 0.092,
  footLength: 0.34,
  earLength: 0.38,
  noseProjection: 0.085,
};

const BOW_STYLE: GoblinStyle = {
  palette: goblinPalette(BOW_SKIN),
  proportions: BOW_BUILD,
  // A hood, a bracer and a quiver, and nothing heavy: an archer that has looted
  // plate is an archer that cannot draw. The quiver is not decoration — it is
  // what makes the walk and idle silhouettes say "archer" at all.
  // The greave is load-bearing in a way that has nothing to do with armour: the
  // gore sheet cuts limbs off the same proportions, and with this archer's long
  // arms its severed arm and severed leg came out as the same 16-px blob (gate
  // G9c). A shin guard is what makes the leg nameable on the floor.
  gear: { pauldron: false, bracer: true, greave: true, necklace: false, hood: true, quiver: true },
  spineLean: deg(4),
  earNotches: 2,
};

export const GOBLIN_STYLES: Record<GoblinArchetype, GoblinStyle> = {
  sword: SWORD_STYLE,
  axe: AXE_STYLE,
  mace: MACE_STYLE,
  warhammer: WARHAMMER_STYLE,
  bow: BOW_STYLE,
};

/**
 * How much of its authored size each archetype is actually drawn at.
 *
 * The rig, the choreography, the weapon tables and the gore pieces are all
 * authored in the same tile units, and plenty of that authoring is absolute —
 * a follow-through that pulls the free hand 0.14 tiles across the chest, an
 * outline grown 0.014 tiles wide. Shrinking the anatomy alone would leave every
 * one of those numbers at its old size and quietly redraw the animation; the
 * arc gates catch it, but only after the fact.
 *
 * So the figure is authored at one size and *drawn* at another: the bake
 * multiplies its tile unit by this, which scales pose, weapon and gore together
 * and leaves every ratio the gates measure exactly where it was.
 */
export const ARCHETYPE_SCALE: Record<GoblinArchetype, number> = {
  sword: ARCHETYPE_HEIGHTS.sword / figureHeight(SWORD_BUILD),
  axe: ARCHETYPE_HEIGHTS.axe / figureHeight(AXE_BUILD),
  mace: ARCHETYPE_HEIGHTS.mace / figureHeight(MACE_BUILD),
  warhammer: ARCHETYPE_HEIGHTS.warhammer / figureHeight(WARHAMMER_BUILD),
  bow: ARCHETYPE_HEIGHTS.bow / figureHeight(BOW_BUILD),
};
