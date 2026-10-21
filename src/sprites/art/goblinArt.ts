/**
 * Drawing engine for the dungeon's goblins.
 *
 * A goblin is a small, mean, big-headed scavenger: a bulbous skull carried
 * forward of its hips, two huge pointed ears standing out sideways, a long
 * hooked nose, glowing eyes under a heavy brow and a grin with fangs in it,
 * on skinny limbs with oversized hands and big flat feet. At the 32-px tile
 * size players actually see, the ears, the head and the weapon carry the
 * silhouette, so all three are built big enough to break it.
 *
 * The figure is posed by *targets*, not joint angles: a pose says where the
 * feet and hands are and {@link solveTwoBone} finds the knee and elbow. That is
 * the single reason limbs stay welded to the body across a swing — posing each
 * segment independently lets an arm float free of the body it is attached to.
 *
 * Coordinates are tile units: 1.0 is one dungeon tile. The origin is the point
 * between the feet, +X is the direction the goblin faces and -Y is up. The
 * caller translates to the ground point and scales by one tile, so a sheet can
 * be baked at any resolution.
 *
 * No part draws its own outline. The parts are composed on a surface of the
 * painter's own (`figureCompose.ts`), and the hard dark line, the lit rim and
 * the shadows one part casts on another are derived from the finished
 * silhouette: drawn per part, every arm over the chest gets an ink ring and
 * the goblin reads as a paper doll while its outer edge stays soft against the
 * floor.
 *
 * Glow and soft shadow are radial gradients, never `shadowBlur` — blur is
 * measured in device pixels and would not survive the caller's scale.
 */

import { addCapsule } from './carl/paint';
import {
  blitLayer,
  crossOffsets,
  dilationOffsets,
  inFigureSpace,
  laySlab,
  lightRim,
  makeLayer,
  withComposeLayers,
  clear,
  layerBounds,
  occludeAround,
  outlineInto,
  pixelStep,
  scratchPx,
  type InkReach,
} from './figureCompose';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

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
 * A starved limb is a thin bone between knobbly ends, so every segment narrows
 * to a waist at its middle and swells again at both joints. The knee and the
 * elbow are the widest part of a goblin's limb — the knobs are what say "bony"
 * where an even tube says "noodle".
 */
const LIMB_WAIST_FRACTION = 0.62;
/** The joint end of a segment, relative to its root. */
const LIMB_JOINT_FRACTION = 1.04;
/** The wrist/ankle end, which is the narrowest part of the whole limb. */
const LIMB_TIP_FRACTION = 0.7;
/**
 * The core shadow runs down the side of each segment turned away from the key,
 * as a copy of the segment pushed that way by this share of its width and
 * clipped to it: the terminator then follows the limb's own axis.
 */
const LIMB_SHADE_SHIFT = 0.55;
/** Sheen runs down the light-facing edge of each near segment. */
const LIMB_SHEEN_FRACTION = 0.2;
const LIMB_SHEEN_OFFSET = 0.5;

export interface LimbPaint {
  readonly fill: string;
  /** The core shadow down the side of the limb turned away from the key. */
  readonly shade: string;
  /** Null on far limbs; the missing highlight is the depth cue. */
  readonly sheen: string | null;
}

interface SegmentRadii {
  readonly root: number;
  readonly waist: number;
  readonly end: number;
}

/** Adds one segment, root → waist → end, to the current path. */
function addSegment(ctx: Ctx, from: Pt, to: Pt, radii: SegmentRadii): void {
  const middle = mixPt(from, to, 0.5);
  addCapsule(ctx, from, middle, radii.root, radii.waist);
  addCapsule(ctx, middle, to, radii.waist, radii.end);
}

function traceLimb(ctx: Ctx, chain: BoneChain, upper: SegmentRadii, lower: SegmentRadii): void {
  ctx.beginPath();
  addSegment(ctx, chain.anchor, chain.joint, upper);
  addSegment(ctx, chain.joint, chain.end, lower);
}

/** Draw a solved chain as one continuous tapered, shaded limb. */
export function drawLimb(ctx: Ctx, chain: BoneChain, rootWidth: number, paint: LimbPaint): void {
  const rootRadius = rootWidth / 2;
  const jointRadius = rootRadius * LIMB_JOINT_FRACTION;
  const upper: SegmentRadii = {
    root: rootRadius,
    waist: rootRadius * LIMB_WAIST_FRACTION,
    end: jointRadius,
  };
  const lower: SegmentRadii = {
    root: jointRadius,
    waist: jointRadius * LIMB_WAIST_FRACTION,
    end: rootRadius * LIMB_TIP_FRACTION,
  };

  ctx.fillStyle = paint.fill;
  traceLimb(ctx, chain, upper, lower);
  ctx.fill();

  const shift = rootWidth * LIMB_SHADE_SHIFT;
  const shaded = (at: Pt): Pt => offset(at, -LIGHT.x * shift, -LIGHT.y * shift);
  const shadedChain: BoneChain = {
    anchor: shaded(chain.anchor),
    joint: shaded(chain.joint),
    end: shaded(chain.end),
  };
  withClip(
    ctx,
    () => traceLimb(ctx, chain, upper, lower),
    () => {
      ctx.fillStyle = paint.shade;
      traceLimb(ctx, shadedChain, upper, lower);
      ctx.fill();
    },
  );

  if (paint.sheen === null) return;
  const sheenShift = rootWidth * LIMB_SHEEN_OFFSET;
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * sheenShift, LIGHT.y * sheenShift);
  ctx.fillStyle = paint.sheen;
  ctx.beginPath();
  addCapsule(
    ctx,
    lit(mixPt(chain.anchor, chain.joint, 0.15)),
    lit(mixPt(chain.anchor, chain.joint, 0.8)),
    upper.waist * LIMB_SHEEN_FRACTION * 2,
    upper.waist * LIMB_SHEEN_FRACTION * 1.6,
  );
  ctx.fill();
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
  /** The glowing almond of the eye. */
  readonly eye: string;
  /** The paler, hotter core at the eye's centre. */
  readonly eyeCore: string;
  /** The dark socket the glowing eye sits in. */
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
   * The archer's whole design job is to be pickable out of a crowd. Walking and
   * idling, with the bow hanging along the body, a quiver with no shafts showing
   * reads as "hunched creature with a tail". Shafts standing proud of the
   * shoulder are the one cue that survives a 32-px pure-black silhouette on
   * every frame of every row.
   */
  readonly quiver: boolean;
  /** A peaked cloth cap whose brim juts past the brow. */
  readonly flatCap: boolean;
  /**
   * Denim overalls with a tool belt, in place of the loincloth.
   *
   * The trouser legs stop at mid-shin so the bare goblin feet still show: a
   * fully clothed leg reads as a small human, and the feet are part of what
   * says "goblin" once the ears are half under a cap.
   */
  readonly overalls: boolean;
  /**
   * A plunger slung across the back, rubber cup standing over the far shoulder.
   *
   * The cup above the shoulder line is the one plumbing cue that survives a
   * 32-px silhouette on every frame; the wrench in the hand can be read as any
   * club until the jaw is seen.
   */
  readonly plunger: boolean;
}

export interface GoblinStyle {
  readonly palette: GoblinPalette;
  readonly proportions: GoblinProportions;
  readonly gear: GoblinGear;
  /** Permanent forward hunch, before any per-frame lean. */
  readonly spineLean: number;
  /** Notches torn out of each ear; near and far ears are cut differently. */
  readonly earNotches: number;
  /** Clothing painted by another module, composed inside the figure like the built-in gear. */
  readonly outfit?: GoblinOutfit;
}

/**
 * Clothing a module outside the rig paints onto the goblin, at the same points
 * in the draw order the built-in gear uses, so it shares the figure's outline,
 * rim and cast shadows instead of reading as a sticker laid over it.
 */
export interface GoblinOutfit {
  /** Inside the torso's clip, in spine space: hip at the origin, shoulders at `-torsoLength`. */
  readonly torso?: (ctx: Ctx, style: GoblinStyle) => void;
  /** Over the hips in spine space, outside the torso's clip, in place of the loincloth. */
  readonly hips?: (ctx: Ctx, style: GoblinStyle) => void;
  /** Over one solved leg, after the bare leg is painted. */
  readonly leg?: (ctx: Ctx, chain: BoneChain, style: GoblinStyle, near: boolean) => void;
  /** Headwear in head space (+X forward), over the face and under the near ear. */
  readonly head?: (ctx: Ctx, style: GoblinStyle) => void;
  /**
   * Over the finished torso and hips in spine space, outside the torso's clip:
   * straps and anything strapped to them that stands proud of the body.
   */
  readonly overTorso?: (ctx: Ctx, style: GoblinStyle) => void;
  /**
   * Carried on the back, in figure space from the top of the spine, behind the
   * body: drawn there it is overlapped by the torso, as a quiver is.
   */
  readonly back?: (ctx: Ctx, spineTop: Pt, lean: number, style: GoblinStyle) => void;
  /**
   * Over one solved arm, after the bare arm is painted, at that arm's drawn
   * width; `wristAngle` is the way the fist on its end is turned.
   */
  readonly arm?: (
    ctx: Ctx,
    chain: BoneChain,
    width: number,
    wristAngle: number,
    style: GoblinStyle,
    near: boolean,
  ) => void;
}

/**
 * How much of the leg's length an upright stance would use up. Only the figure's
 * nominal height is measured at it, so the draw scale every archetype is sized
 * by does not shrink when the stance crouches.
 */
const UPRIGHT_LEG_EXTENSION = 0.93;

/**
 * How much of the leg's length the goblin's own stance uses up.
 *
 * Well short of the upright figure's: a goblin never stands up straight, and a
 * leg solved near full reach reads as a lanky human however hunched the back
 * is. At this extension the knees carry a clear forward bend in every row, and
 * every foot target is still comfortably inside the leg's reach.
 */
const CROUCHED_LEG_EXTENSION = 0.8;

/**
 * Forward hunch every pose carries on top of its style's, in the spine only.
 *
 * The head is not tipped with it: the face and ears were drawn level at the
 * style's own hunch, so the extra bend is taken up at the neck and the goblin
 * keeps looking ahead rather than at its feet.
 */
export const CROUCH_HUNCH = deg(8);

/**
 * Hip height for a planted stance, measured to the ground the figure stands on.
 *
 * Foot targets in a {@link GoblinPose} are ground-level, but the ankle rides one
 * foot-height above them (see {@link ankleTarget}), so the leg only ever has to
 * span `(thigh + shin) * CROUCHED_LEG_EXTENSION`. Folding the foot into this
 * height *without* that lift would put every target outside the leg's reach and
 * the IK would quietly replace the authored gait with an arc at max reach —
 * which no automated check catches, only a picture.
 */
export function groundedHipHeight(p: GoblinProportions): number {
  return (p.thighLength + p.shinLength) * CROUCHED_LEG_EXTENSION + p.footHeight;
}

/** Height of the shoulder line above the ground in the goblin's crouched stance. */
export function shoulderHeight(p: GoblinProportions): number {
  return groundedHipHeight(p) + p.torsoLength;
}

/**
 * Sole-to-skull-top height of the build stood upright, which is what each
 * archetype's draw scale is tuned against. The crouch is drawn shorter.
 */
export function figureHeight(p: GoblinProportions): number {
  const uprightHip = (p.thighLength + p.shinLength) * UPRIGHT_LEG_EXTENSION + p.footHeight;
  return uprightHip + p.torsoLength + p.neckLength + p.headRadius * 2;
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
  /** Ears lag the head; this is their extra droop, in radians. */
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
  /**
   * Absolute angle of whatever the far hand holds, when it holds something of
   * its own. Absent follows the far forearm, turned forward at the wrist.
   */
  readonly offHandAngle?: number;
  /**
   * Paint the far arm, and whatever it holds, over the body rather than behind
   * it, for a far arm raised and thrust out ahead of the chest or cradling
   * something against the belly.
   */
  readonly offHandInFront?: boolean;
  /**
   * Paint the near arm and what it holds under the head instead of over it,
   * for an arm drawn back behind the skull: a goblin's head sits forward of
   * its shoulder, so an arm wound back over the top of it crosses the face.
   */
  readonly nearArmUnderHead?: boolean;
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
export function farArmSpan(p: GoblinProportions): number {
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
  /** Total spine tilt: the style's permanent hunch, the crouch, and this frame's lean. */
  readonly lean: number;
}

/** Arms hang from just inside the shoulder line, not off its very edge. */
const ARM_INSET_FRACTION = 0.86;
const HIP_INSET_FRACTION = 0.62;

/** How far each hip joint sits either side of the pelvis centre, in tile units. */
export function hipJointOffset(p: GoblinProportions): number {
  return p.hipHalfWidth * HIP_INSET_FRACTION;
}
/** Shoulders sit slightly below the top of the torso silhouette. */
const SHOULDER_DROP_FRACTION = 0.26;

/** Offset from the hip to a point `length` up the leaning spine. */
function spineOffset(length: number, lean: number): Pt {
  return rotatePt({ x: 0, y: -length }, lean);
}

export function buildSkeleton(style: GoblinStyle, pose: GoblinPose): Skeleton {
  const p = style.proportions;
  const lean = style.spineLean + CROUCH_HUNCH + pose.lean;
  const torso = p.torsoLength * pose.torsoSquash;

  const hip: Pt = { x: pose.sway, y: -groundedHipHeight(p) + pose.bob };
  const spineTop = offset(hip, spineOffset(torso, lean).x, spineOffset(torso, lean).y);
  const shoulderDrop = p.shoulderHalfWidth * SHOULDER_DROP_FRACTION;

  const nearShoulder = offset(spineTop, p.shoulderHalfWidth * ARM_INSET_FRACTION, shoulderDrop);
  const farShoulder = offset(spineTop, -p.shoulderHalfWidth * ARM_INSET_FRACTION, shoulderDrop);
  const nearHip = offset(hip, hipJointOffset(p), 0);
  const farHip = offset(hip, -hipJointOffset(p), 0);

  const headOffset = spineOffset(torso + p.neckLength + p.headRadius, lean);
  const headCentre = offset(hip, headOffset.x + pose.headLead, headOffset.y);

  return {
    hip,
    spineTop,
    nearShoulder,
    farShoulder,
    headCentre,
    headAngle: lean - CROUCH_HUNCH + pose.headTilt,
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

/**
 * A tight, dark pool under the feet. A wide soft halo reads as a smudge on the
 * floor round a small figure; a tight dark one pins the soles to the ground.
 * Both alphas together stay under the gates' solid-ink threshold, so the
 * anchor gate measures the soles and never the shadow under them.
 */
const SHADOW_INNER_ALPHA = 0.5;
const SHADOW_CORE_STOP = 0.45;
const SHADOW_HEIGHT_FRACTION = 0.24;
/** The pool's half-width, as a share of the stance plus a foot's length. */
const SHADOW_SPAN_FRACTION = 0.95;
/** A planted foot presses a darker patch of its own into the pool. */
const FOOT_CONTACT_ALPHA = 0.4;
const FOOT_CONTACT_HEIGHT = 0.035;
/** The planted foot's patch reaches this share of the foot's length either side of it. */
const FOOT_CONTACT_SPAN = 0.7;
/** A foot this close to the floor, in tile units, counts as planted. */
const FOOT_PLANTED_LIFT = 0.015;
/** A lifted figure's pool shrinks and fades by this much per tile of lift. */
const SHADOW_LIFT_FADE = 2.4;
const SHADOW_TONE = '#0b1006';

function drawSoftPool(ctx: Ctx, x: number, radius: number, height: number, alpha: number): void {
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(radius, height);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(SHADOW_TONE, alpha));
  gradient.addColorStop(SHADOW_CORE_STOP, rgba(SHADOW_TONE, alpha));
  gradient.addColorStop(1, rgba(SHADOW_TONE, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();
}

function drawGroundShadow(ctx: Ctx, style: GoblinStyle, pose: GoblinPose): void {
  const p = style.proportions;
  const lift = Math.max(0, -Math.max(pose.nearFoot.y, pose.farFoot.y));
  const fade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  const centre = (pose.nearFoot.x + pose.farFoot.x) / 2;
  const halfStance = Math.abs(pose.nearFoot.x - pose.farFoot.x) / 2;
  const radius = (halfStance + p.footLength) * SHADOW_SPAN_FRACTION;
  drawSoftPool(ctx, centre, radius, radius * SHADOW_HEIGHT_FRACTION, SHADOW_INNER_ALPHA * fade);
  for (const foot of [pose.nearFoot, pose.farFoot]) {
    if (-foot.y > FOOT_PLANTED_LIFT) continue;
    const heelToToe = p.footLength * (1 - 2 * FOOT_HEEL_FRACTION);
    drawSoftPool(
      ctx,
      foot.x + heelToToe / 2,
      p.footLength * FOOT_CONTACT_SPAN,
      FOOT_CONTACT_HEIGHT,
      FOOT_CONTACT_ALPHA,
    );
  }
}

// ── Extremities ──────────────────────────────────────────────────────────────

/** Three toes, not four — a fourth turns the foot into a paddle at 32 px. */
const TOE_COUNT = 3;
const FOOT_HEEL_FRACTION = 0.24;
/** Feet stay flatter than the shin they hang off; a full follow reads broken. */
const FOOT_ANGLE_FOLLOW = 0.22;
const SHIN_UPRIGHT = Math.PI / 2;

/** How high a foot is lifted, in tile units, before it tips with its shin in full. */
const FOOT_TILT_FULL_LIFT = 0.05;

/**
 * A foot's tilt off flat: a share of how far its shin leans off upright, faded
 * in as the foot leaves the floor. A planted sole lies flat however far the
 * crouch leans the shin, and a swinging leg tips its toes with the shin.
 */
function footAngle(leg: BoneChain, foot: Pt): number {
  const lifted = clamp01(-foot.y / FOOT_TILT_FULL_LIFT);
  return (segmentAngle(leg.joint, leg.end) - SHIN_UPRIGHT) * FOOT_ANGLE_FOLLOW * lifted;
}
/** How far the toes splay apart along the sole, as a share of the foot's length. */
const TOE_SPREAD = 0.3;
const TOE_RADIUS = 0.13;
/** The instep rises this many foot-heights over the sole: a flat, low foot. */
const ARCH_RISE = 1.6;
const CLAW_LENGTH = 1.1;
/**
 * The foot's profile, each entry a share of the heel's reach behind the ankle,
 * the toe's reach in front of it, the foot's height or the arch's rise.
 */
const FOOT_SHAPE = {
  /** The top of the heel, in foot-heights above the ankle line. */
  heelTop: 0.4,
  /** The heel's round bulges back past the heel point. */
  heelBulge: 1.15,
  /** Where the sole flattens out from under the heel. */
  soleFromHeel: 0.4,
  /** Where the flat sole ends, under the toes. */
  soleToToe: 0.82,
  /** The control point that rounds the toes up off the sole. */
  toeRoundX: 0.95,
  toeRoundY: 0.2,
  /** The front of the instep, and its height as a share of the arch's rise. */
  instepX: 0.62,
  instepRise: 0.45,
  /** The control point the instep curves back to the heel through. */
  archX: 0.15,
  /** The dark sole band reaches this many foot-heights up from the sole. */
  soleShadeDepth: 0.55,
} as const;
/** The sole shade's rectangle is oversized this many times so it covers the tilted foot. */
const FOOT_SHADE_COVER = 2;
/** The rearmost toe's radius, as a share of the front toe's. */
const BACK_TOE_SCALE = 0.78;
/** Where the front toe sits along the toe's reach. */
const FRONT_TOE_AT = 0.86;
/** The toes behind the front one sit this far from the foot's tone toward its shadow. */
const BACK_TOE_SHADE = 0.35;
/** A toe's claw, in toe radii from the toe's centre. */
const TOE_CLAW = { rootX: 0.55, rootRise: 0.45, tipDrop: 0.35, heelX: 0.6, heelDrop: 0.7 } as const;

/**
 * A big, flat, splayed goblin foot in profile: a long low sole, a bony heel,
 * and three fat toes fanned along the front with a claw on each. The size is
 * the point — oversized feet are a third of what says "goblin" below the waist.
 * Drawn in ankle-local space, where the ground is `footHeight` below the origin.
 */
function drawFoot(ctx: Ctx, ankle: Pt, angle: number, style: GoblinStyle, near: boolean): void {
  const { footLength, footHeight } = style.proportions;
  const skin = style.palette.skin;
  const heel = -footLength * FOOT_HEEL_FRACTION;
  const toe = footLength * (1 - FOOT_HEEL_FRACTION);
  const sole = footHeight;
  const fill = near ? skin.mid : farLimbTone(skin);

  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  ctx.rotate(angle);

  const heelTopY = -footHeight * FOOT_SHAPE.heelTop;
  const traceFoot = (): void => {
    ctx.beginPath();
    ctx.moveTo(heel, heelTopY);
    ctx.quadraticCurveTo(heel * FOOT_SHAPE.heelBulge, sole, heel * FOOT_SHAPE.soleFromHeel, sole);
    ctx.lineTo(toe * FOOT_SHAPE.soleToToe, sole);
    ctx.quadraticCurveTo(
      toe * FOOT_SHAPE.toeRoundX,
      sole * FOOT_SHAPE.toeRoundY,
      toe * FOOT_SHAPE.instepX,
      -footHeight * ARCH_RISE * FOOT_SHAPE.instepRise,
    );
    ctx.quadraticCurveTo(toe * FOOT_SHAPE.archX, -footHeight * ARCH_RISE, heel, heelTopY);
    ctx.closePath();
  };
  ctx.fillStyle = fill;
  traceFoot();
  ctx.fill();
  withClip(ctx, traceFoot, () => {
    ctx.fillStyle = skin.dark;
    ctx.fillRect(
      heel * FOOT_SHADE_COVER,
      sole - footHeight * FOOT_SHAPE.soleShadeDepth,
      footLength * FOOT_SHADE_COVER,
      footHeight * FOOT_SHADE_COVER,
    );
  });

  // Toes fan forward along the front of the sole, each a fat bump of its own
  // with a pale claw past it; their undersides sit *on* the sole line, since a
  // toe hanging below it reads as a castor and lifts the goblin off the floor.
  for (let i = TOE_COUNT - 1; i >= 0; i--) {
    const t = i / (TOE_COUNT - 1);
    const toeR = footLength * TOE_RADIUS * lerp(1, BACK_TOE_SCALE, t);
    const toeX = toe * (FRONT_TOE_AT - t * TOE_SPREAD) + toeR;
    const toeY = sole - toeR;
    ctx.fillStyle = i === 0 ? fill : mix(fill, skin.dark, BACK_TOE_SHADE);
    ctx.beginPath();
    ctx.arc(toeX, toeY, toeR, 0, FULL_CIRCLE);
    ctx.fill();
    ctx.fillStyle = style.palette.bone.light;
    ctx.beginPath();
    ctx.moveTo(toeX + toeR * TOE_CLAW.rootX, toeY - toeR * TOE_CLAW.rootRise);
    ctx.lineTo(toeX + toeR * (1 + CLAW_LENGTH), toeY + toeR * TOE_CLAW.tipDrop);
    ctx.lineTo(toeX + toeR * TOE_CLAW.heelX, toeY + toeR * TOE_CLAW.heelDrop);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** Three fingers plus a thumb; a fourth finger reads as a mitten at 32 px. */
const FINGER_COUNT = 3;
const FINGER_LENGTH_FRACTION = 1.15;
const FINGER_WIDTH_FRACTION = 0.36;
const THUMB_LENGTH_FRACTION = 1.0;
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
const KNUCKLE_FRACTION = 0.78;
/** The long, bony goblin fingers end in a pale claw. */
const FINGER_CLAW_FRACTION = 0.5;
/** Fingers sit this far from the palm's tone toward its shadow, so they read over it. */
const FINGER_SHADE = 0.3;
/** How wide the fingers fan, from a closed grip to an open hand. */
const FINGER_FAN_CLOSED = deg(30);
const FINGER_FAN_OPEN = deg(62);
/** A curled finger reaches this share of its open length. */
const FINGER_CURLED_REACH = 0.72;
/** How far a closed grip hooks the outer finger segment back toward the palm. */
const FINGER_CURL = deg(82);
/** Each finger is two equal segments, so a curl bends instead of kinking. */
const FINGER_SEGMENT_SHARE = 0.5;
/** A finger's width at its middle joint and at its tip, as a share of its root. */
const FINGER_JOINT_TAPER = 0.9;
const FINGER_TIP_TAPER = 0.62;
/** A hand any more closed than this hides its claws inside the fist. */
const CLAWS_SHOW_OPENNESS = 0.1;
/** A claw's width at its root and at its point, as a share of the finger's root. */
const CLAW_ROOT_TAPER = 0.45;
const CLAW_TIP_TAPER = 0.12;

/**
 * An oversized, long-fingered goblin hand.
 *
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
  const palmTone = near ? skin.mid : farLimbTone(skin);
  const fingerTone = mix(palmTone, skin.dark, FINGER_SHADE);
  const open = clamp01(openness);

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);

  ctx.fillStyle = palmTone;
  ctx.beginPath();
  ctx.arc(0, 0, r * PALM_FRACTION, 0, FULL_CIRCLE);
  ctx.fill();

  // A curled grip hooks the fingers back toward the palm; an open hand throws
  // them straight out. Two segments each, so a curl bends instead of kinking.
  const spreadArc = lerp(FINGER_FAN_CLOSED, FINGER_FAN_OPEN, open);
  const reach = r * FINGER_LENGTH_FRACTION * lerp(FINGER_CURLED_REACH, 1, open);
  const curl = lerp(FINGER_CURL, 0, open);
  // The thumb tucks in as the hand closes. Thrown out to the side on a fist
  // wrapped round a haft, it reads as a stray sixth finger stuck to the weapon
  // rather than as part of the hand.
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
    const midJoint = along(knuckle, fan, length * FINGER_SEGMENT_SHARE);
    const tip = along(midJoint, fan + curl, length * FINGER_SEGMENT_SHARE);
    const rootW = r * FINGER_WIDTH_FRACTION * thickness;
    const jointW = rootW * FINGER_JOINT_TAPER;
    fillCapsule(ctx, knuckle, midJoint, rootW, jointW, fingerTone);
    fillCapsule(ctx, midJoint, tip, jointW, rootW * FINGER_TIP_TAPER, fingerTone);
    if (open > CLAWS_SHOW_OPENNESS) {
      const claw = along(tip, fan + curl, rootW * FINGER_CLAW_FRACTION * 2);
      fillCapsule(
        ctx,
        tip,
        claw,
        rootW * CLAW_ROOT_TAPER,
        rootW * CLAW_TIP_TAPER,
        style.palette.bone.light,
      );
    }
  }

  ctx.restore();
}

// ── Torso ────────────────────────────────────────────────────────────────────

const RIB_COUNT = 2;
const RIB_ALPHA = 0.3;
const LOINCLOTH_DROP = 0.36;
/**
 * The belly's front curve, in shares of the belly bulge: the control past the
 * shoulder, the fullest point past the hip, and where it tucks back in at the hip.
 */
const BELLY_SHOULDER_BULGE = 0.4;
const BELLY_FULLEST_BULGE = 2.2;
const BELLY_HIP_BULGE = 1.2;
/** The back's lower control bows half as far as the upper one. */
const LOWER_BACK_BOW_SHARE = 0.5;

/**
 * The torso's key-light gradient, lit back to shadowed gut, as stops and the
 * alpha of the tone at each.
 */
const TORSO_SHADING = {
  litAlpha: 0.7,
  midStop: 0.45,
  shadowStop: 0.62,
  shadowAlpha: 0.55,
  coreAlpha: 0.95,
} as const;
/** The shading rectangle, in torso lengths above and past the torso, so it covers any squash. */
const TORSO_SHADE_TOP = 1.2;
const TORSO_SHADE_HEIGHT = 1.6;
/** The shading rectangle reaches this many half-spans either side of the hips. */
const TORSO_SHADE_REACH = 2;

/** The core shadow under the belly, in shares of the hip half-width and torso length. */
const BELLY_SHADOW = {
  alpha: 0.8,
  hipShare: 0.6,
  drop: 0.16,
  height: 0.2,
} as const;

/** The two rib lines, in shares of the shoulder half-width and the torso length. */
const RIB_LINE = {
  width: 0.04,
  backX: 0.6,
  sagX: 0.1,
  sag: 0.07,
  frontX: 0.7,
  frontRise: 0.02,
} as const;

/** The loincloth wrap, in shares of the torso length and hip half-width. */
const LOINCLOTH = {
  /** The wrap's top edge, up from the hip. */
  top: 0.26,
  /** How far the hem hangs below the hip, past the loincloth's own drop. */
  hang: 0.16,
  /** The front and back edges, past the hip half-width. */
  hipReach: 1.2,
  frontBulge: 1.3,
  /** The front flap's lower corner, in shares of the front and the hem. */
  flapCornerX: 0.86,
  flapCornerY: 0.7,
  /** The torn hem runs back to this share of the back edge. */
  hemBack: 0.82,
  /** The shallow tears hang this share of the deep ones. */
  shallowTear: 0.55,
  /** The hem rises to this share of its depth at the back. */
  hemBackDepth: 0.45,
  /** Where the back edge meets the hem. */
  backCorner: 0.32,
} as const;
/** The loincloth's lit back panel and shadowed front, as shares of its width. */
const LOINCLOTH_LIT_ALPHA = 0.5;
const LOINCLOTH_LIT_SHARE = 0.35;
const LOINCLOTH_SHADE_ALPHA = 0.7;
const LOINCLOTH_SHADE_FROM = 0.25;
/** The rope belt and its knot, in torso lengths. */
const BELT = {
  height: 0.07,
  highlightInset: 0.012,
  highlightHeight: 0.025,
  knotX: 0.42,
  knotDrop: 0.035,
  knotRadius: 0.05,
} as const;

/**
 * Torso silhouette in spine space: the hip sits at the origin and the shoulders
 * at -torsoLength, so the caller can rotate the whole path by the body lean.
 * Narrow sloping shoulders over a pot belly that sags forward of the hips.
 */
function traceTorso(ctx: Ctx, p: GoblinProportions): void {
  const hipHalf = p.hipHalfWidth;
  const shoulderHalf = p.shoulderHalfWidth;
  const bulge = p.bellyBulge;
  const top = -p.torsoLength;
  const WAIST_HEIGHT = 0.38;
  const CHEST_HEIGHT = 0.8;
  const SHOULDER_ROUND = 0.34;
  const CROTCH_ROUND = 0.34;
  /** The belly's lowest, fullest point, as a share of the torso up from the hip. */
  const BELLY_LOW = 0.32;

  ctx.beginPath();
  const SPINE_BOW = 0.22;
  ctx.moveTo(-hipHalf, 0);
  ctx.bezierCurveTo(
    -hipHalf - p.torsoLength * SPINE_BOW * LOWER_BACK_BOW_SHARE,
    top * WAIST_HEIGHT,
    -shoulderHalf - p.torsoLength * SPINE_BOW,
    top * CHEST_HEIGHT,
    -shoulderHalf,
    top,
  );
  ctx.quadraticCurveTo(0, top - p.shoulderHalfWidth * SHOULDER_ROUND, shoulderHalf, top);
  ctx.bezierCurveTo(
    shoulderHalf + bulge * BELLY_SHOULDER_BULGE,
    top * CHEST_HEIGHT,
    hipHalf + bulge * BELLY_FULLEST_BULGE,
    top * BELLY_LOW,
    hipHalf + bulge * BELLY_HIP_BULGE,
    0,
  );
  ctx.quadraticCurveTo(0, p.hipHalfWidth * CROTCH_ROUND, -hipHalf, 0);
  ctx.closePath();
}

function drawTorso(ctx: Ctx, style: GoblinStyle, squash: number): void {
  drawTorsoAndHips(ctx, style, squash);
  const overTorso = style.outfit?.overTorso;
  if (overTorso === undefined) return;
  ctx.save();
  ctx.scale(1, squash);
  overTorso(ctx, style);
  ctx.restore();
}

function drawTorsoAndHips(ctx: Ctx, style: GoblinStyle, squash: number): void {
  const p = style.proportions;
  const { skin, cloth } = style.palette;
  const top = -p.torsoLength;
  const halfSpan = p.hipHalfWidth + p.bellyBulge * BELLY_FULLEST_BULGE;

  ctx.save();
  ctx.scale(1, squash);

  ctx.fillStyle = skin.mid;
  traceTorso(ctx, p);
  ctx.fill();

  ctx.save();
  traceTorso(ctx, p);
  ctx.clip();

  // The key comes from the upper left, so the lit side of a figure facing +X is
  // its back and shoulders; the underside of the gut falls into core shadow.
  const shading = ctx.createLinearGradient(-p.shoulderHalfWidth, top, halfSpan, 0);
  shading.addColorStop(0, rgba(skin.light, TORSO_SHADING.litAlpha));
  shading.addColorStop(TORSO_SHADING.midStop, rgba(skin.mid, 0));
  shading.addColorStop(TORSO_SHADING.shadowStop, rgba(skin.dark, TORSO_SHADING.shadowAlpha));
  shading.addColorStop(1, rgba(skin.dark, TORSO_SHADING.coreAlpha));
  ctx.fillStyle = shading;
  ctx.fillRect(
    -halfSpan * TORSO_SHADE_REACH,
    top * TORSO_SHADE_TOP,
    halfSpan * TORSO_SHADE_REACH * 2,
    -top * TORSO_SHADE_HEIGHT,
  );

  // The belly's round underside: a crescent of core shadow under the bulge, so
  // the gut reads as a ball hung off the front rather than as a flat lozenge.
  const BELLY_CENTRE_Y = 0.3;
  ctx.fillStyle = rgba(skin.dark, BELLY_SHADOW.alpha);
  ctx.beginPath();
  ctx.ellipse(
    p.hipHalfWidth * BELLY_SHADOW.hipShare + p.bellyBulge,
    top * BELLY_CENTRE_Y + p.torsoLength * BELLY_SHADOW.drop,
    p.hipHalfWidth + p.bellyBulge,
    p.torsoLength * BELLY_SHADOW.height,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.strokeStyle = rgba(skin.shadow, RIB_ALPHA);
  ctx.lineWidth = p.torsoLength * RIB_LINE.width;
  ctx.lineCap = 'round';
  for (let i = 0; i < RIB_COUNT; i++) {
    const RIB_TOP_FRACTION = 0.7;
    const RIB_SPACING = 0.13;
    const ribY = top * (RIB_TOP_FRACTION - i * RIB_SPACING);
    ctx.beginPath();
    ctx.moveTo(-p.shoulderHalfWidth * RIB_LINE.backX, ribY);
    ctx.quadraticCurveTo(
      p.hipHalfWidth * RIB_LINE.sagX,
      ribY + p.torsoLength * RIB_LINE.sag,
      p.shoulderHalfWidth * RIB_LINE.frontX,
      ribY - p.torsoLength * RIB_LINE.frontRise,
    );
    ctx.stroke();
  }

  if (style.gear.overalls) drawOverallsBib(ctx, style);
  style.outfit?.torso?.(ctx, style);
  ctx.restore();

  if (style.gear.overalls) {
    drawOverallsSeat(ctx, style);
    ctx.restore();
    return;
  }
  const outfitHips = style.outfit?.hips;
  if (outfitHips !== undefined) {
    outfitHips(ctx, style);
    ctx.restore();
    return;
  }

  // The rag loincloth is the goblin's warm accent: a rust red that parts the
  // figure from a green floor by hue where green skin cannot.
  const wrapTop = -p.torsoLength * LOINCLOTH.top;
  const wrapBottom = p.hipHalfWidth * LOINCLOTH_DROP + p.torsoLength * LOINCLOTH.hang;
  const front = p.hipHalfWidth * LOINCLOTH.hipReach + p.bellyBulge * LOINCLOTH.frontBulge;
  const back = -p.hipHalfWidth * LOINCLOTH.hipReach;
  /** The long front flap hangs well past the short back one; nothing matches. */
  const FRONT_HANG = 2.6;
  const TEAR_COUNT = 4;

  const traceWrap = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, wrapTop);
    ctx.lineTo(front, wrapTop);
    ctx.lineTo(front * LOINCLOTH.flapCornerX, wrapBottom * LOINCLOTH.flapCornerY);
    // A torn hem: alternating points across the bottom of the front flap.
    for (let i = 0; i <= TEAR_COUNT; i++) {
      const t = i / TEAR_COUNT;
      const x = lerp(front * LOINCLOTH.flapCornerX, back * LOINCLOTH.hemBack, t);
      const deep = i % 2 === 0 ? FRONT_HANG : FRONT_HANG * LOINCLOTH.shallowTear;
      ctx.lineTo(x, wrapBottom * lerp(deep, LOINCLOTH.hemBackDepth, t));
    }
    ctx.lineTo(back, wrapBottom * LOINCLOTH.backCorner);
    ctx.closePath();
  };

  ctx.fillStyle = cloth.light;
  traceWrap();
  ctx.fill();

  withClip(ctx, traceWrap, () => {
    const panelHeight = wrapBottom * FRONT_HANG * 2;
    ctx.fillStyle = rgba(cloth.rim, LOINCLOTH_LIT_ALPHA);
    ctx.fillRect(back, wrapTop, (front - back) * LOINCLOTH_LIT_SHARE, panelHeight);
    ctx.fillStyle = rgba(cloth.dark, LOINCLOTH_SHADE_ALPHA);
    ctx.fillRect(front * LOINCLOTH_SHADE_FROM, wrapTop, front, panelHeight);
    // The rope belt, knotted off to one side.
    ctx.fillStyle = style.palette.leather.dark;
    ctx.fillRect(back, wrapTop, front - back, p.torsoLength * BELT.height);
    ctx.fillStyle = style.palette.leather.light;
    ctx.fillRect(
      back,
      wrapTop + p.torsoLength * BELT.highlightInset,
      front - back,
      p.torsoLength * BELT.highlightHeight,
    );
  });

  ctx.fillStyle = style.palette.leather.light;
  ctx.beginPath();
  ctx.arc(
    front * BELT.knotX,
    wrapTop + p.torsoLength * BELT.knotDrop,
    p.torsoLength * BELT.knotRadius,
    0,
    FULL_CIRCLE,
  );
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
  const { iron, leather } = style.palette;
  const RUST = 0.25;
  const plate = mix(iron.mid, leather.mid, RUST);
  const plateSheen = iron.rim;
  const halfWidth = p.armWidth * PAULDRON_WIDTH_FRACTION * 0.5;
  const height = p.armWidth * PAULDRON_HEIGHT_FRACTION;

  ctx.save();
  ctx.translate(shoulder.x, shoulder.y);
  ctx.rotate(lean);

  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.ellipse(0, 0, halfWidth, height * 0.62, 0, Math.PI, FULL_CIRCLE);
  ctx.lineTo(halfWidth * 0.92, height * 0.4);
  ctx.lineTo(-halfWidth * 0.92, height * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(plateSheen, 0.7);
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

  fillCapsule(ctx, a, b, width * 0.58, width * 0.52, leather.mid);
  fillCapsule(ctx, a, b, width * 0.3, width * 0.26, leather.light);
  const RIVET_POSITIONS: readonly number[] = [0.3, 0.72];
  for (const at of RIVET_POSITIONS) {
    const rivet = mixPt(a, b, at);
    ctx.fillStyle = mix(iron.dark, leather.light, RIVET_TONE_MIX);
    ctx.beginPath();
    ctx.arc(rivet.x, rivet.y, width * 0.11, 0, FULL_CIRCLE);
    ctx.fill();
  }
}

/** Bands of cord binding the wrap, and the stud riveted through its middle. */
const SHIN_WRAP_BANDS = 3;
const SHIN_WRAP_STUD = 0.16;

/**
 * A leather shin wrap on the near leg, bound with cord and studded with one
 * iron rivet. Leather rather than plate: a grey greave on a green shin reads
 * at 32 px as a bare bone leg.
 */
function drawGreave(ctx: Ctx, chain: BoneChain, style: GoblinStyle): void {
  const { iron, leather } = style.palette;
  const width = style.proportions.legWidth;
  const GREAVE_START = 0.22;
  const GREAVE_END = 0.82;
  const a = mixPt(chain.joint, chain.end, GREAVE_START);
  const b = mixPt(chain.joint, chain.end, GREAVE_END);

  fillCapsule(ctx, a, b, width * 0.62, width * 0.54, leather.mid);
  const sheenA = offset(a, LIGHT.x * width * 0.18, LIGHT.y * width * 0.18);
  const sheenB = offset(b, LIGHT.x * width * 0.18, LIGHT.y * width * 0.18);
  fillCapsule(ctx, sheenA, sheenB, width * 0.14, width * 0.1, rgba(leather.rim, 0.7));
  for (let i = 0; i < SHIN_WRAP_BANDS; i++) {
    const band = mixPt(a, b, (i + 0.5) / SHIN_WRAP_BANDS);
    fillCapsule(
      ctx,
      offset(band, -width * 0.55, -width * 0.12),
      offset(band, width * 0.55, width * 0.12),
      width * 0.07,
      width * 0.07,
      leather.dark,
    );
  }
  const stud = mixPt(a, b, 0.5);
  ctx.fillStyle = iron.rim;
  ctx.beginPath();
  ctx.arc(stud.x, stud.y, width * SHIN_WRAP_STUD, 0, FULL_CIRCLE);
  ctx.fill();
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
    ctx.fillStyle = i % 2 === 0 ? bone.light : bone.mid;
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
/**
 * Lean of the whole bundle off vertical — back and up, never down.
 *
 * A quiver laid back along the spine reads as a tail; standing it up near
 * vertical is what turns the same object into ammunition.
 */
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
  const { leather, wood, bone, cloth } = style.palette;
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
    ctx.fillStyle = wood.light;
    ctx.fillRect(-shaftHalf * 1.5, -reach, shaftHalf * 3, reach);
    // Fletching: a wedge at the very top, which is the part that has to survive
    // as a distinct bump on the silhouette.
    ctx.fillStyle = i % 2 === 0 ? bone.rim : cloth.light;
    ctx.beginPath();
    ctx.moveTo(0, -reach - shaftHalf);
    ctx.lineTo(-shaftHalf * 3.6, -reach + overhang * 0.3);
    ctx.lineTo(shaftHalf * 3.6, -reach + overhang * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const traceTube = (): void => {
    ctx.beginPath();
    ctx.moveTo(-halfWidth, 0);
    ctx.lineTo(halfWidth, 0);
    ctx.lineTo(halfWidth * 0.7, length);
    ctx.lineTo(-halfWidth * 0.7, length);
    ctx.closePath();
  };
  ctx.fillStyle = leather.light;
  traceTube();
  ctx.fill();
  ctx.fillStyle = rgba(leather.rim, 0.6);
  ctx.fillRect(-halfWidth, 0, halfWidth * 0.55, length);
  ctx.fillStyle = rgba(leather.shadow, 0.5);
  ctx.fillRect(halfWidth * 0.3, 0, halfWidth * 0.5, length);
  // Two binding straps, so the tube is not a plain trapezoid.
  ctx.fillStyle = leather.shadow;
  ctx.fillRect(-halfWidth, length * 0.22, halfWidth * 2, length * 0.08);
  ctx.fillRect(-halfWidth * 0.85, length * 0.66, halfWidth * 1.7, length * 0.08);

  ctx.restore();
}

// ── Workwear ─────────────────────────────────────────────────────────────────
//
// The plumber's kit. Dressed in tradesman's colours rather than the scavenged
// rag-and-rust the hostile goblins wear, so a player reads him as the one goblin
// in the room who is not there to fight.

const DENIM: Ramp = {
  shadow: '#121a2c',
  dark: '#203050',
  mid: '#33497a',
  light: '#4c67a2',
  rim: '#7d97cc',
};

const CAP_CLOTH: Ramp = {
  shadow: '#3a100c',
  dark: '#631b14',
  mid: '#902a1f',
  light: '#b9402e',
  rim: '#e0715a',
};

const PLUNGER_RUBBER: Ramp = {
  shadow: '#3d1606',
  dark: '#6e290c',
  mid: '#a83f12',
  light: '#d9631f',
  rim: '#f39a52',
};

const BRASS = '#c9a24a';

/** Where the bib's top edge sits, as a fraction of the torso up from the hip. */
const BIB_TOP = 0.9;
/** Where the bib meets the trousers, as a fraction of the torso up from the hip. */
const BIB_WAIST = 0.24;
/** The bib's two side edges, in shoulder half-widths; biased forward for the three-quarter view. */
const BIB_BACK_EDGE = -0.85;
const BIB_FRONT_EDGE = 0.86;
/** Where each strap crosses the top of the shoulder, in shoulder half-widths. */
const STRAP_BACK_SHOULDER = -0.66;
const STRAP_FRONT_SHOULDER = 0.5;
/** Strap width, as a fraction of the torso length. */
const STRAP_WIDTH = 0.085;
const BIB_BUTTON_RADIUS = 0.04;
/** How far below the strap's foot its button sits, in strap widths. */
const BIB_BUTTON_DROP = 0.6;
/** The bib pocket, as fractions of the bib's own width and height. */
const BIB_POCKET_INSET = 0.28;
const BIB_POCKET_DEPTH = 0.5;
/** How far below the bib's top edge the pocket opens, as a fraction of the torso. */
const BIB_POCKET_MOUTH_DROP = 0.08;
const BIB_POCKET_SEAM_WIDTH = 0.03;
const BIB_POCKET_SEAM_ALPHA = 0.85;
/** How far the area painted under the clip reaches past the torso, so the clip alone shapes it. */
const CLIP_OVERREACH = 3;
/**
 * Where the bib's shading gradient ends, as a fraction of the overreach: just
 * past the belly, so the shadow side is the belly that faces away from the key.
 */
const BIB_SHADE_REACH = 0.2;
const DENIM_LIT_ALPHA = 0.35;
const DENIM_SHADED_ALPHA = 0.7;
/** The midpoint of a three-stop lit → clear → shadowed gradient. */
const SHADE_MIDPOINT = 0.5;

/** The overalls' bib and straps, painted inside the torso's clip in spine space. */
function drawOverallsBib(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const top = -p.torsoLength;
  const bibTop = top * BIB_TOP;
  const waist = top * BIB_WAIST;
  const back = p.shoulderHalfWidth * BIB_BACK_EDGE;
  const front = p.shoulderHalfWidth * BIB_FRONT_EDGE;
  const reach = p.torsoLength * CLIP_OVERREACH;

  // The bib's front runs on past the belly and the torso's clip ends it: a
  // pot belly bulging out round the side of a bib reads as bare skin.
  const traceDenim = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, bibTop);
    ctx.lineTo(reach, bibTop);
    ctx.lineTo(reach, waist);
    ctx.lineTo(reach, waist);
    ctx.lineTo(reach, reach);
    ctx.lineTo(-reach, reach);
    ctx.lineTo(-reach, waist);
    ctx.lineTo(back, waist);
    ctx.closePath();
  };

  const strapWidth = p.torsoLength * STRAP_WIDTH;
  const straps: ReadonlyArray<readonly [Pt, Pt]> = [
    [pt(back + strapWidth, bibTop), pt(p.shoulderHalfWidth * STRAP_BACK_SHOULDER, top)],
    [pt(front - strapWidth, bibTop), pt(p.shoulderHalfWidth * STRAP_FRONT_SHOULDER, top)],
  ];
  ctx.lineCap = 'round';
  ctx.fillStyle = DENIM.mid;
  traceDenim();
  ctx.fill();

  ctx.strokeStyle = DENIM.light;
  ctx.lineWidth = strapWidth;
  for (const [foot, over] of straps) {
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(over.x, over.y * CLIP_OVERREACH);
    ctx.stroke();
  }

  const shading = ctx.createLinearGradient(back, bibTop, reach * BIB_SHADE_REACH, 0);
  shading.addColorStop(0, rgba(DENIM.rim, DENIM_LIT_ALPHA));
  shading.addColorStop(SHADE_MIDPOINT, rgba(DENIM.mid, 0));
  shading.addColorStop(1, rgba(DENIM.shadow, DENIM_SHADED_ALPHA));
  ctx.fillStyle = shading;
  traceDenim();
  ctx.fill();

  const pocketLeft = lerp(back, front, BIB_POCKET_INSET);
  const pocketRight = lerp(front, back, BIB_POCKET_INSET);
  const pocketBottom = lerp(bibTop, waist, BIB_POCKET_DEPTH);
  const pocketMouth = bibTop - top * BIB_POCKET_MOUTH_DROP;
  ctx.strokeStyle = rgba(DENIM.shadow, BIB_POCKET_SEAM_ALPHA);
  ctx.lineWidth = p.torsoLength * BIB_POCKET_SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(pocketLeft, pocketMouth);
  ctx.lineTo(pocketLeft, pocketBottom);
  ctx.lineTo(pocketRight, pocketBottom);
  ctx.lineTo(pocketRight, pocketMouth);
  ctx.stroke();

  ctx.fillStyle = BRASS;
  for (const [foot] of straps) {
    ctx.beginPath();
    ctx.arc(
      foot.x,
      foot.y + strapWidth * BIB_BUTTON_DROP,
      p.torsoLength * BIB_BUTTON_RADIUS,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
}

/** How far below the hip joint the trouser seat hangs, in hip half-widths. */
const SEAT_DROP = 0.5;
/** How far the seat's sides stand out past the hips, in hip half-widths. */
const SEAT_HIP_FLARE = 1.08;
/** How much of the belly's bulge the seat's front wraps round. */
const SEAT_BELLY_WRAP = 1.2;
/** Where the seat's sides start curving in toward the crotch, as a fraction of its drop. */
const SEAT_SIDE_CURVE = 0.6;
/** How far in from each side the seat's hem meets the legs. */
const SEAT_FRONT_HEM_INSET = 0.7;
const SEAT_BACK_HEM_INSET = 0.8;
/** How far the crotch sags below the hem's two corners, as a multiple of the drop. */
const SEAT_CROTCH_SAG = 1.25;
/** Where the seat's shadowed front starts, as a fraction of its front edge. */
const SEAT_SHADOW_START = 0.15;
const SEAT_SHADOW_ALPHA = 0.55;
const TOOL_BELT_HEIGHT = 0.075;
/** The pouch hung off the belt on the front hip, as fractions of the torso. */
const POUCH_WIDTH = 0.26;
const POUCH_DEPTH = 0.3;
const POUCH_FRONT_SHIFT = 0.42;
/** The pouch's flap, as a fraction of its depth. */
const POUCH_FLAP_DEPTH = 0.3;
const BUCKLE_SIZE = 0.085;
/** Where the buckle sits, as a fraction of the way out to the seat's back edge. */
const BUCKLE_BACK_SHIFT = 0.3;

/** The trousers' seat and the tool belt over the waist, in spine space. */
function drawOverallsSeat(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const { leather } = style.palette;
  const top = -p.torsoLength;
  const waist = top * BIB_WAIST;
  const front = p.hipHalfWidth * SEAT_HIP_FLARE + p.bellyBulge * SEAT_BELLY_WRAP;
  const back = -p.hipHalfWidth * SEAT_HIP_FLARE;
  const seat = p.hipHalfWidth * SEAT_DROP;

  const traceSeat = (): void => {
    ctx.beginPath();
    ctx.moveTo(back, waist);
    ctx.lineTo(front, waist);
    ctx.quadraticCurveTo(front, seat * SEAT_SIDE_CURVE, front * SEAT_FRONT_HEM_INSET, seat);
    ctx.quadraticCurveTo(0, seat * SEAT_CROTCH_SAG, back * SEAT_BACK_HEM_INSET, seat);
    ctx.quadraticCurveTo(back, seat * SEAT_SIDE_CURVE, back, waist);
    ctx.closePath();
  };
  ctx.fillStyle = DENIM.mid;
  traceSeat();
  ctx.fill();
  ctx.save();
  traceSeat();
  ctx.clip();
  ctx.fillStyle = rgba(DENIM.shadow, SEAT_SHADOW_ALPHA);
  ctx.fillRect(front * SEAT_SHADOW_START, waist, front, seat * 2);
  ctx.restore();

  const beltHeight = p.torsoLength * TOOL_BELT_HEIGHT;
  ctx.fillStyle = leather.mid;
  ctx.fillRect(back, waist - beltHeight / 2, front - back, beltHeight);

  const pouchWidth = p.torsoLength * POUCH_WIDTH;
  const pouchLeft = front * POUCH_FRONT_SHIFT;
  const pouchDepth = p.torsoLength * POUCH_DEPTH;
  ctx.fillStyle = leather.light;
  ctx.fillRect(pouchLeft, waist, pouchWidth, pouchDepth);
  ctx.fillStyle = leather.dark;
  ctx.fillRect(pouchLeft, waist, pouchWidth, pouchDepth * POUCH_FLAP_DEPTH);

  const buckle = p.torsoLength * BUCKLE_SIZE;
  ctx.fillStyle = BRASS;
  ctx.fillRect(back * BUCKLE_BACK_SHIFT - buckle / 2, waist - buckle / 2, buckle, buckle);
}

/** Trouser legs are wider than the starved leg inside them. */
const TROUSER_WIDTH = 1.9;
/** Where along the shin the hem sits; below it the bare goblin leg shows. */
const TROUSER_HEM = 0.92;
/** The rolled cuff, as the last part of the shin the trousers cover. */
const TROUSER_CUFF_START = 0.72;
/** Half-widths at the knee and at the cuff's top, as fractions of the half-width at the hip. */
const TROUSER_KNEE_TAPER = 0.9;
const TROUSER_CUFF_TAPER = 0.95;
/** The near leg's crease highlight: offset, span along the thigh, widths and strength. */
const TROUSER_SHEEN_OFFSET = 0.55;
const TROUSER_SHEEN_FROM = 0.2;
const TROUSER_SHEEN_TO = 0.85;
const TROUSER_SHEEN_ROOT_WIDTH = 0.22;
const TROUSER_SHEEN_END_WIDTH = 0.18;
const TROUSER_SHEEN_ALPHA = 0.4;

/** One denim trouser leg over a solved leg chain, from the hip to mid-shin. */
function drawTrouserLeg(ctx: Ctx, chain: BoneChain, style: GoblinStyle, near: boolean): void {
  const width = style.proportions.legWidth * TROUSER_WIDTH;
  const half = width / 2;
  const knee = half * TROUSER_KNEE_TAPER;
  const cuffTop = half * TROUSER_CUFF_TAPER;
  const hem = mixPt(chain.joint, chain.end, TROUSER_HEM);
  const cuff = mixPt(chain.joint, chain.end, TROUSER_CUFF_START);
  const fill = near ? DENIM.mid : mix(DENIM.dark, DENIM.mid, FAR_LIMB_SHARE);
  const cuffFill = near ? DENIM.light : DENIM.mid;
  fillCapsule(ctx, chain.anchor, chain.joint, half, knee, fill);
  fillCapsule(ctx, chain.joint, cuff, knee, cuffTop, fill);
  fillCapsule(ctx, cuff, hem, cuffTop, half, cuffFill);
  if (!near) return;
  const shift = half * TROUSER_SHEEN_OFFSET;
  const lit = (at: Pt): Pt => offset(at, LIGHT.x * shift, LIGHT.y * shift);
  fillCapsule(
    ctx,
    lit(mixPt(chain.anchor, chain.joint, TROUSER_SHEEN_FROM)),
    lit(mixPt(chain.anchor, chain.joint, TROUSER_SHEEN_TO)),
    half * TROUSER_SHEEN_ROOT_WIDTH,
    half * TROUSER_SHEEN_END_WIDTH,
    rgba(DENIM.rim, TROUSER_SHEEN_ALPHA),
  );
}

const CAP_BUTTON_RADIUS = 0.09;

/**
 * The cap's points in head units: X in head half-widths, Y in head radii, with
 * +X forward and -Y up. The crown sits a little over the skull's own top and
 * slopes forward onto a brim that juts past the brow but clears the eyes.
 */
const CAP = {
  backOfBand: pt(-1.0, -0.28),
  backOfCrownControl: pt(-1.1, -0.92),
  crownRiseControl: pt(-0.55, -1.24),
  crownTop: pt(0.12, -1.18),
  crownSlopeControl: pt(0.78, -1.1),
  brimRoot: pt(1.02, -0.66),
  brimTip: pt(1.46, -0.52),
  brimLipControl: pt(1.52, -0.4),
  brimUnderside: pt(1.34, -0.38),
  bandFront: pt(0.66, -0.42),
  bandControl: pt(-0.2, -0.44),
  button: pt(0.05, -1.16),
  seamStart: pt(-0.2, -1.2),
  seamControl: pt(0.55, -0.95),
  seamEnd: pt(0.95, -0.62),
  brimShadeFront: pt(1.4, -0.4),
  brimShadeBottom: -0.3,
  shadingFrom: pt(-1, -1.2),
  shadingTo: pt(1, -0.3),
  shadingBoxCorner: pt(-1.2, -1.3),
  shadingBoxSize: pt(2.8, 1.1),
} as const;

/** The shadow the brim throws across the brow: centre and radii in head units. */
const BRIM_SHADOW = { centre: pt(0.55, -0.3), radii: pt(0.5, 0.12), alpha: 0.55 } as const;
const CAP_LIT_ALPHA = 0.55;
const CAP_SHADED_ALPHA = 0.6;
const CAP_SEAM_ALPHA = 0.7;
const CAP_SEAM_WIDTH = 0.05;

/** The flat cap, in head-local space with +X forward. */
function drawFlatCap(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const { skin } = style.palette;
  const at = (point: Pt): Pt => pt(rx * point.x, r * point.y);

  const traceCap = (): void => {
    const band = at(CAP.backOfBand);
    const backControl = at(CAP.backOfCrownControl);
    const riseControl = at(CAP.crownRiseControl);
    const crownTop = at(CAP.crownTop);
    const slopeControl = at(CAP.crownSlopeControl);
    const brimRoot = at(CAP.brimRoot);
    const brimTip = at(CAP.brimTip);
    const lipControl = at(CAP.brimLipControl);
    const underside = at(CAP.brimUnderside);
    const bandFront = at(CAP.bandFront);
    const bandControl = at(CAP.bandControl);
    ctx.beginPath();
    ctx.moveTo(band.x, band.y);
    ctx.bezierCurveTo(
      backControl.x,
      backControl.y,
      riseControl.x,
      riseControl.y,
      crownTop.x,
      crownTop.y,
    );
    ctx.quadraticCurveTo(slopeControl.x, slopeControl.y, brimRoot.x, brimRoot.y);
    ctx.lineTo(brimTip.x, brimTip.y);
    ctx.quadraticCurveTo(lipControl.x, lipControl.y, underside.x, underside.y);
    ctx.lineTo(bandFront.x, bandFront.y);
    ctx.quadraticCurveTo(bandControl.x, bandControl.y, band.x, band.y);
    ctx.closePath();
  };

  const shadowCentre = at(BRIM_SHADOW.centre);
  const shadowRadii = at(BRIM_SHADOW.radii);
  ctx.fillStyle = rgba(skin.shadow, BRIM_SHADOW.alpha);
  ctx.beginPath();
  ctx.ellipse(shadowCentre.x, shadowCentre.y, shadowRadii.x, shadowRadii.y, 0, 0, FULL_CIRCLE);
  ctx.fill();

  ctx.fillStyle = CAP_CLOTH.mid;
  traceCap();
  ctx.fill();

  ctx.save();
  traceCap();
  ctx.clip();
  const shadingFrom = at(CAP.shadingFrom);
  const shadingTo = at(CAP.shadingTo);
  const shading = ctx.createLinearGradient(shadingFrom.x, shadingFrom.y, shadingTo.x, shadingTo.y);
  shading.addColorStop(0, rgba(CAP_CLOTH.rim, CAP_LIT_ALPHA));
  shading.addColorStop(SHADE_MIDPOINT, rgba(CAP_CLOTH.mid, 0));
  shading.addColorStop(1, rgba(CAP_CLOTH.shadow, CAP_SHADED_ALPHA));
  ctx.fillStyle = shading;
  const boxCorner = at(CAP.shadingBoxCorner);
  const boxSize = at(CAP.shadingBoxSize);
  ctx.fillRect(boxCorner.x, boxCorner.y, boxSize.x, boxSize.y);

  const bandFront = at(CAP.bandFront);
  const brimShadeFront = at(CAP.brimShadeFront);
  const brimShadeBottom = r * CAP.brimShadeBottom;
  ctx.fillStyle = CAP_CLOTH.dark;
  ctx.beginPath();
  ctx.moveTo(bandFront.x, bandFront.y);
  ctx.lineTo(brimShadeFront.x, brimShadeFront.y);
  ctx.lineTo(brimShadeFront.x, brimShadeBottom);
  ctx.lineTo(bandFront.x, brimShadeBottom);
  ctx.closePath();
  ctx.fill();

  const seamStart = at(CAP.seamStart);
  const seamControl = at(CAP.seamControl);
  const seamEnd = at(CAP.seamEnd);
  ctx.strokeStyle = rgba(CAP_CLOTH.shadow, CAP_SEAM_ALPHA);
  ctx.lineWidth = r * CAP_SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(seamStart.x, seamStart.y);
  ctx.quadraticCurveTo(seamControl.x, seamControl.y, seamEnd.x, seamEnd.y);
  ctx.stroke();
  ctx.restore();

  const button = at(CAP.button);
  ctx.fillStyle = CAP_CLOTH.light;
  ctx.beginPath();
  ctx.arc(button.x, button.y, r * CAP_BUTTON_RADIUS, 0, FULL_CIRCLE);
  ctx.fill();
}

/** Handle length and where it is strapped, in tile units and torso fractions. */
const PLUNGER_HANDLE_LENGTH = 0.62;
const PLUNGER_HANDLE_HALF_WIDTH = 0.026;
const PLUNGER_HANDLE_SHADE_ALPHA = 0.6;
/** How much of the handle hangs below the strap point at the shoulders. */
const PLUNGER_HANG = 0.3;
/** How far behind the spine the handle rides, in shoulder half-widths. */
const PLUNGER_BACK_OFFSET = 1.05;
/** Lean of the handle off vertical, back over the shoulder. */
const PLUNGER_TILT = deg(-34);
const PLUNGER_CUP_HALF_WIDTH = 0.15;
const PLUNGER_CUP_DEPTH = 0.15;
/** Where the cup's flanks start rounding toward the handle, as a fraction of its depth. */
const PLUNGER_CUP_FLANK = 0.7;
/** How wide the cup's neck is where it grips the handle, in handle half-widths. */
const PLUNGER_CUP_NECK = 3;
/** How far the cup's base sinks over the handle's end, as a fraction of its depth. */
const PLUNGER_CUP_BASE_OVERLAP = 0.25;
/** The lit and shadowed bands down the cup, as fractions of its half-width. */
const PLUNGER_CUP_LIT_WIDTH = 0.6;
const PLUNGER_CUP_SHADE_START = 0.35;
/** Each band runs past the cup's base so the clip alone ends it. */
const PLUNGER_CUP_BAND_REACH = 1.5;
const PLUNGER_CUP_LIT_ALPHA = 0.55;
const PLUNGER_CUP_SHADE_ALPHA = 0.5;
/** The hollow seen in the cup's mouth: its width and its foreshortened height. */
const PLUNGER_MOUTH_WIDTH = 0.86;
const PLUNGER_MOUTH_HEIGHT = 0.22;

/** The plunger, drawn behind the torso so the body overlaps its handle. */
function drawPlunger(ctx: Ctx, spineTop: Pt, lean: number, style: GoblinStyle): void {
  const p = style.proportions;
  const { wood } = style.palette;
  const below = PLUNGER_HANDLE_LENGTH * PLUNGER_HANG;
  const above = PLUNGER_HANDLE_LENGTH - below;
  const half = PLUNGER_HANDLE_HALF_WIDTH;

  ctx.save();
  ctx.translate(spineTop.x - p.shoulderHalfWidth * PLUNGER_BACK_OFFSET, spineTop.y);
  ctx.rotate(lean + PLUNGER_TILT);

  ctx.fillStyle = wood.light;
  ctx.fillRect(-half, -above, half * 2, PLUNGER_HANDLE_LENGTH);
  ctx.fillStyle = rgba(wood.shadow, PLUNGER_HANDLE_SHADE_ALPHA);
  ctx.fillRect(0, -above, half, PLUNGER_HANDLE_LENGTH);

  const cupHalf = PLUNGER_CUP_HALF_WIDTH;
  const rimY = -above - PLUNGER_CUP_DEPTH;
  const flankY = rimY + PLUNGER_CUP_DEPTH * PLUNGER_CUP_FLANK;
  const neck = half * PLUNGER_CUP_NECK;
  const baseY = -above + PLUNGER_CUP_DEPTH * PLUNGER_CUP_BASE_OVERLAP;
  const traceCup = (): void => {
    ctx.beginPath();
    ctx.moveTo(-cupHalf, rimY);
    ctx.lineTo(cupHalf, rimY);
    ctx.bezierCurveTo(cupHalf, flankY, neck, -above, 0, baseY);
    ctx.bezierCurveTo(-neck, -above, -cupHalf, flankY, -cupHalf, rimY);
    ctx.closePath();
  };
  ctx.fillStyle = PLUNGER_RUBBER.mid;
  traceCup();
  ctx.fill();
  ctx.save();
  traceCup();
  ctx.clip();
  const bandLength = PLUNGER_CUP_DEPTH * PLUNGER_CUP_BAND_REACH;
  ctx.fillStyle = rgba(PLUNGER_RUBBER.rim, PLUNGER_CUP_LIT_ALPHA);
  ctx.fillRect(-cupHalf, rimY, cupHalf * PLUNGER_CUP_LIT_WIDTH, bandLength);
  ctx.fillStyle = rgba(PLUNGER_RUBBER.shadow, PLUNGER_CUP_SHADE_ALPHA);
  ctx.fillRect(cupHalf * PLUNGER_CUP_SHADE_START, rimY, cupHalf, bandLength);
  ctx.restore();
  ctx.fillStyle = PLUNGER_RUBBER.shadow;
  ctx.beginPath();
  ctx.ellipse(
    0,
    rimY,
    cupHalf * PLUNGER_MOUTH_WIDTH,
    PLUNGER_CUP_DEPTH * PLUNGER_MOUTH_HEIGHT,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.restore();
}

// ── Head ─────────────────────────────────────────────────────────────────────
//
// Face layout as fractions of the head radius (X fractions of the half-width),
// in head-local space with +X forward. The head is turned partly toward the
// camera: the face sits on the forward half of a big round skull, the far eye
// is foreshortened toward the brow's edge, and the far ear shows over the
// forehead as well as the near ear behind the skull.

/** More than two bites and a small ear stops reading as one shape. */
const MAX_EAR_NOTCHES = 2;

/**
 * Where the near ear meets the skull, and the direction it points: out to the
 * back and up, a little above horizontal. Each ear is a long leaf as wide as
 * the head and standing clear of it — two points either side of a ball is the
 * one goblin read no other creature here shares.
 */
const NEAR_EAR_BASE = { x: -0.66, y: -0.12 } as const;
const NEAR_EAR_LIFT = deg(22);
/**
 * The far ear stands out over the far side of the skull, toward the face and
 * up, behind the brow; turned partly away, it is drawn shorter.
 */
const FAR_EAR_BASE = { x: 0.5, y: -0.5 } as const;
const FAR_EAR_LIFT = deg(18);
const FAR_EAR_LENGTH = 0.72;
/**
 * The ears hold their angle on the screen whatever the goblin's permanent
 * hunch is: tipped forward with the head, a 20° ear on a 20° hunch would point
 * straight up at the back and flat along the brow at the front.
 */
const EAR_HUNCH_COUNTER = 1;
/** The ear's root, as a share of the head radius either side of its spine. */
const EAR_ROOT_HALF_HEIGHT = 0.36;
/** How far the leaf bellies below its spine before tapering to the point. */
const EAR_BELLY = 1.25;
/** The point droops off the spine by this much, so the ear hangs a little. */
const EAR_TIP_DROOP = deg(8);

/** The near eye — big — and the far eye, foreshortened toward the brow edge. */
const EYE_NEAR = { x: 0.3, y: -0.1, rx: 0.22, ry: 0.13 } as const;
/** The near eye's centre in head space: x in head widths and y in head radii, +X forward. */
export const GOBLIN_NEAR_EYE: Pt = { x: EYE_NEAR.x, y: EYE_NEAR.y };
const EYE_FAR = { x: 0.76, y: -0.12, rx: 0.15, ry: 0.11 } as const;
/** The dark hollow each eye sits in, as a multiple of the eye's own radii. */
const EYE_SOCKET_SCALE = 1.55;
/** A glow halo past the eye, so it reads as lit from inside. */
const EYE_GLOW_SCALE = 2.2;
const EYE_GLOW_ALPHA = 0.35;
/** The hot core of the eye, as a share of its radius. */
const EYE_CORE_FRACTION = 0.5;
/** A blink below this openness paints the shut lid only. */
const EYE_SHUT = 0.2;
/** The socket tips down toward the nose with the scowl. */
const EYE_SOCKET_TILT = deg(-8);
/**
 * The almond, in eye radii: its back corner below centre, its front corner
 * raised, and how far the upper and lower lids bow at full open.
 */
const EYE_ALMOND = {
  backCornerDrop: 0.2,
  upperLidBow: 1.3,
  frontCornerRise: 0.5,
  lowerLidBow: 1.5,
} as const;

const BROW_Y = -0.3;
const MOUTH_Y = 0.5;
const MOUTH_BACK_X = 0.02;
const MOUTH_FRONT_X = 0.98;
const MOUTH_LINE_WIDTH = 0.1;
const MOUTH_OPEN_HEIGHT = 0.34;
/**
 * The grin's shape off `MOUTH_Y`, in head radii: the back corner kinked up, the
 * front corner level with it, and the lip line sagging below both.
 */
const MOUTH_BACK_RISE = 0.14;
const MOUTH_FRONT_RISE = 0.04;
const MOUTH_SAG = 0.08;
/** Where along the head's width the grin's curves bow, at its middle. */
const MOUTH_BOW_X = 0.5;
/** The upper lip lifts this share of the gape: the jaw drops, the lip barely moves. */
const UPPER_LIP_GAPE_SHARE = 0.4;
/** A fang's root is sunk this far below the lip, in head radii, so it grows out of it. */
const FANG_ROOT_SINK = 0.03;
/** A fang's point leans forward of its root's centre by this share of its width. */
const FANG_POINT_LEAN = 0.15;
/** The two lower fangs standing up out of the underbite: centre, width and height. */
const FANGS: ReadonlyArray<{ readonly x: number; readonly w: number; readonly h: number }> = [
  { x: 0.5, w: 0.19, h: 0.32 },
  { x: 0.82, w: 0.15, h: 0.26 },
];

/**
 * Trace the goblin skull in head-local space: origin at centre, +X forward.
 *
 * A big round cranium bulging up and back, a heavy brow shelf, and a long
 * lower face that juts forward into an underbite — the jaw, not the cranium, is
 * where the face's mass is.
 */
/**
 * The skull's outline, x in head widths and y in head radii, walked from the
 * nape over the crown, down the brow and face, and back along the jaw.
 */
const SKULL = {
  nape: { x: -0.5, y: 0.78 },
  backOfSkull: { x: -1.08, y: 0.48 },
  crownBack: { x: -1.06, y: -0.88 },
  crown: { x: -0.05, y: -1.0 },
  crownFront: { x: 0.55, y: -1.04 },
  forehead: { x: 0.92, y: -0.7 },
  browShelf: { x: 0.96, y: -0.3 },
  browOverhang: { x: 1.04, y: -0.18 },
  eyeNotch: { x: 0.86, y: -0.04 },
  cheek: { x: 0.88, y: 0.25 },
  upperJaw: { x: 0.94, y: 0.5 },
  underbite: { x: 0.98, y: 0.82 },
  chin: { x: 0.62, y: 0.86 },
  jawline: { x: 0.1, y: 0.98 },
} as const;

/** The skull's outline in head space, for headwear and face paint that must stay on the face. */
export function traceSkull(ctx: Ctx, p: GoblinProportions): void {
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const at = (point: { readonly x: number; readonly y: number }): Pt =>
    pt(rx * point.x, r * point.y);
  const nape = at(SKULL.nape);
  const backOfSkull = at(SKULL.backOfSkull);
  const crownBack = at(SKULL.crownBack);
  const crown = at(SKULL.crown);
  const crownFront = at(SKULL.crownFront);
  const forehead = at(SKULL.forehead);
  const browShelf = at(SKULL.browShelf);
  const browOverhang = at(SKULL.browOverhang);
  const eyeNotch = at(SKULL.eyeNotch);
  const cheek = at(SKULL.cheek);
  const upperJaw = at(SKULL.upperJaw);
  const underbite = at(SKULL.underbite);
  const chin = at(SKULL.chin);
  const jawline = at(SKULL.jawline);

  ctx.beginPath();
  ctx.moveTo(nape.x, nape.y);
  ctx.bezierCurveTo(backOfSkull.x, backOfSkull.y, crownBack.x, crownBack.y, crown.x, crown.y);
  ctx.bezierCurveTo(crownFront.x, crownFront.y, forehead.x, forehead.y, browShelf.x, browShelf.y);
  ctx.quadraticCurveTo(browOverhang.x, browOverhang.y, eyeNotch.x, eyeNotch.y);
  ctx.quadraticCurveTo(cheek.x, cheek.y, upperJaw.x, upperJaw.y);
  ctx.quadraticCurveTo(underbite.x, underbite.y, chin.x, chin.y);
  ctx.quadraticCurveTo(jawline.x, jawline.y, nape.x, nape.y);
  ctx.closePath();
}

/** The ear's geometry, in head-local space. */
interface EarShape {
  readonly base: Pt;
  readonly tip: Pt;
  readonly angle: number;
  readonly halfHeight: number;
}

function earShape(style: GoblinStyle, near: boolean, lag: number): EarShape {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const hunch = style.spineLean * EAR_HUNCH_COUNTER;
  const anchor = near ? NEAR_EAR_BASE : FAR_EAR_BASE;
  const base = pt(rx * anchor.x, r * anchor.y);
  // Back is toward -X: the near ear points along 180° lifted up, the far ear
  // along 0° lifted up. A lag droops both, toward the back of the head.
  const angle = near
    ? Math.PI + NEAR_EAR_LIFT - hunch - lag
    : -FAR_EAR_LIFT - hunch + lag * FAR_EAR_LENGTH;
  const length = p.earLength * (near ? 1 : FAR_EAR_LENGTH);
  const droop = near ? -EAR_TIP_DROOP : EAR_TIP_DROOP;
  return {
    base,
    tip: along(base, angle + droop, length),
    angle,
    halfHeight: r * EAR_ROOT_HALF_HEIGHT * (near ? 1 : FAR_EAR_LENGTH),
  };
}

/**
 * Where an ear meets the skull and where its point is, in head-local space.
 * Exported for the gates, which walk the rig out along each ear and look for
 * ink standing clear of the skull there.
 */
export function goblinEarSpine(
  style: GoblinStyle,
  near: boolean,
  lag: number,
): { readonly base: Pt; readonly tip: Pt } {
  const { base, tip } = earShape(style, near, lag);
  return { base, tip };
}

/**
 * One ear: a long pointed leaf, fat at the root and tapering to a fine point,
 * with a notch torn out of its upper edge and a dark hollow inside.
 * `lag` swings the whole ear down; the walk trails it behind the head, which
 * is the cheapest bit of overlapping action on the whole figure.
 */
function drawEar(ctx: Ctx, style: GoblinStyle, lag: number, near: boolean): void {
  const skin = style.palette.skin;
  const shape = earShape(style, near, lag);
  const { base, tip, angle, halfHeight } = shape;
  const acrossX = -Math.sin(angle);
  const acrossY = Math.cos(angle);
  // Lift is measured on the "top" side of the leaf, whichever way it points.
  const topSign = near ? 1 : -1;
  /** A point `t` along the ear's spine, `lift` half-heights to its upper side. */
  const onEar = (t: number, lift: number): Pt => {
    const spine = mixPt(base, tip, t);
    const width = halfHeight * (1 - t) * lift * topSign;
    return { x: spine.x + acrossX * width, y: spine.y + acrossY * width };
  };
  const notches = Math.min(style.earNotches, MAX_EAR_NOTCHES);
  const NOTCH_AT = [0.45, 0.66] as const;
  const NOTCH_DEPTH = 0.55;
  /** A notch's half-width along the ear's spine. */
  const NOTCH_HALF_WIDTH = 0.05;
  /** The upper edge swells past the spine's width between notches, then near the tip. */
  const RIDGE_SWELL = 1.15;
  const TIP_RIDGE_SWELL = 1.05;
  /** Where along the spine the leaf's belly is fullest. */
  const BELLY_AT = 0.4;

  const traceEar = (): void => {
    ctx.beginPath();
    const root = onEar(0, 1);
    ctx.moveTo(root.x, root.y);
    let from = 0;
    for (let i = 0; i < notches; i++) {
      const at = NOTCH_AT[i];
      const before = onEar(at - NOTCH_HALF_WIDTH, 1);
      const floorOfNotch = onEar(at, 1 - NOTCH_DEPTH);
      const after = onEar(at + NOTCH_HALF_WIDTH, 1);
      const ridge = onEar((from + at) / 2, RIDGE_SWELL);
      ctx.quadraticCurveTo(ridge.x, ridge.y, before.x, before.y);
      ctx.lineTo(floorOfNotch.x, floorOfNotch.y);
      ctx.lineTo(after.x, after.y);
      from = at + NOTCH_HALF_WIDTH;
    }
    const lastRidge = onEar((from + 1) / 2, TIP_RIDGE_SWELL);
    ctx.quadraticCurveTo(lastRidge.x, lastRidge.y, tip.x, tip.y);
    const belly = onEar(BELLY_AT, -EAR_BELLY);
    const underRoot = onEar(0, -1);
    ctx.quadraticCurveTo(belly.x, belly.y, underRoot.x, underRoot.y);
    ctx.closePath();
  };

  ctx.fillStyle = near ? skin.mid : farLimbTone(skin);
  traceEar();
  ctx.fill();

  withClip(ctx, traceEar, () => {
    // The hollow of the ear: a long dark scoop with a warm flush in its depth,
    // so the leaf reads as a cupped ear rather than as a blade.
    const hollow = (): void => {
      const start = onEar(EAR_HOLLOW.start.t, EAR_HOLLOW.start.lift);
      const outer = onEar(EAR_HOLLOW.outer.t, EAR_HOLLOW.outer.lift);
      const end = onEar(EAR_HOLLOW.end.t, EAR_HOLLOW.end.lift);
      const inner = onEar(EAR_HOLLOW.inner.t, EAR_HOLLOW.inner.lift);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(outer.x, outer.y, end.x, end.y);
      ctx.quadraticCurveTo(inner.x, inner.y, start.x, start.y);
      ctx.closePath();
    };
    ctx.fillStyle = skin.dark;
    hollow();
    ctx.fill();
    ctx.fillStyle = rgba(EAR_FLUSH, near ? EAR_FLUSH_ALPHA : EAR_FLUSH_ALPHA / 2);
    hollow();
    ctx.fill();
  });
}

const EAR_FLUSH = '#c0604a';
const EAR_FLUSH_ALPHA = 0.45;
/**
 * The ear's hollow: its root, the deep outer curve, its far end and the inner
 * curve back, each `t` along the spine and `lift` half-heights above it.
 */
const EAR_HOLLOW = {
  start: { t: 0.06, lift: 0.1 },
  outer: { t: 0.42, lift: -0.85 },
  end: { t: 0.82, lift: -0.05 },
  inner: { t: 0.4, lift: 0.35 },
} as const;

function drawEye(
  ctx: Ctx,
  eye: { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number },
  r: number,
  rx: number,
  openness: number,
  style: GoblinStyle,
): void {
  const { sclera, eye: eyeTone, eyeCore } = style.palette;
  const x = rx * eye.x;
  const y = r * eye.y;
  const radiusX = r * eye.rx;
  const radiusY = r * eye.ry;
  const open = clamp01(openness);

  ctx.fillStyle = sclera;
  ctx.beginPath();
  ctx.ellipse(
    x,
    y,
    radiusX * EYE_SOCKET_SCALE,
    radiusY * EYE_SOCKET_SCALE,
    EYE_SOCKET_TILT,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  if (open < EYE_SHUT) return;

  const glow = ctx.createRadialGradient(x, y, 0, x, y, radiusX * EYE_GLOW_SCALE);
  glow.addColorStop(0, rgba(eyeTone, EYE_GLOW_ALPHA * open));
  glow.addColorStop(1, rgba(eyeTone, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radiusX * EYE_GLOW_SCALE, 0, FULL_CIRCLE);
  ctx.fill();

  // A slanted almond, its upper lid cut flat by the brow: an angry eye.
  const traceAlmond = (scale: number): void => {
    ctx.beginPath();
    const backCornerY = y + radiusY * EYE_ALMOND.backCornerDrop * scale;
    ctx.moveTo(x - radiusX * scale, backCornerY);
    ctx.quadraticCurveTo(
      x,
      y - radiusY * EYE_ALMOND.upperLidBow * open * scale,
      x + radiusX * scale,
      y - radiusY * EYE_ALMOND.frontCornerRise * scale,
    );
    ctx.quadraticCurveTo(
      x,
      y + radiusY * EYE_ALMOND.lowerLidBow * open * scale,
      x - radiusX * scale,
      backCornerY,
    );
    ctx.closePath();
  };
  ctx.fillStyle = eyeTone;
  traceAlmond(1);
  ctx.fill();
  ctx.fillStyle = eyeCore;
  traceAlmond(EYE_CORE_FRACTION);
  ctx.fill();
}

/**
 * A wide, crooked grin with two fangs standing up out of an underbite.
 *
 * The grin runs most of the way across the lower face and kinks up at the
 * back, so the mouth reads at 32 px as a slash; the fangs are big enough to
 * survive as two pale pixels. Symmetric rows of teeth read as a jack-o'-lantern.
 */
function drawMouth(ctx: Ctx, style: GoblinStyle, mouthOpen: number): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const { mouthInner, toothEnamel, outline } = style.palette;
  const open = clamp01(mouthOpen);
  const back = pt(rx * MOUTH_BACK_X, r * (MOUTH_Y - MOUTH_BACK_RISE));
  const front = pt(rx * MOUTH_FRONT_X, r * (MOUTH_Y - MOUTH_FRONT_RISE));
  const sag = r * (MOUTH_Y + MOUTH_SAG);
  const gape = r * MOUTH_OPEN_HEIGHT * open;
  const bowX = rx * MOUTH_BOW_X;
  const upperLipY = sag - gape * UPPER_LIP_GAPE_SHARE;

  ctx.fillStyle = mouthInner;
  ctx.beginPath();
  ctx.moveTo(back.x, back.y);
  ctx.quadraticCurveTo(bowX, sag + gape, front.x, front.y);
  ctx.quadraticCurveTo(bowX, upperLipY, back.x, back.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = outline;
  ctx.lineWidth = r * MOUTH_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(back.x, back.y);
  ctx.quadraticCurveTo(bowX, upperLipY, front.x, front.y);
  ctx.stroke();

  // The lower lip line the fangs stand on.
  const lipAt = (x: number): number => {
    const t = (x / rx - MOUTH_BACK_X) / (MOUTH_FRONT_X - MOUTH_BACK_X);
    return lerp(back.y, front.y, t) + (sag + gape - lerp(back.y, front.y, t)) * 2 * t * (1 - t);
  };
  ctx.fillStyle = toothEnamel;
  for (const fang of FANGS) {
    const cx = rx * fang.x;
    const baseY = lipAt(cx);
    const rootY = baseY + r * FANG_ROOT_SINK;
    const halfWidth = (r * fang.w) / 2;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, rootY);
    ctx.lineTo(cx + halfWidth, rootY);
    ctx.lineTo(cx + r * fang.w * FANG_POINT_LEAN, baseY - r * fang.h);
    ctx.closePath();
    ctx.fill();
  }
}

/** How far below the eyes the hooked tip droops, in head radii: past the upper lip. */
const NOSE_TIP_DROP = 0.42;
/**
 * The nose, x in head widths and y in head radii. `tipX` is where the face
 * plane ends; the nose's own projection is added past it.
 */
const NOSE = {
  root: { x: 0.55, y: -0.22 },
  tipX: 0.98,
  /** The septum sits this share of the way from the tip back to `septumBackX`. */
  septumBackX: 0.7,
  septumShare: 0.45,
  septumY: 0.3,
} as const;
/** The nose outline, in head radii unless a key says head widths (`…X`). */
const NOSE_OUTLINE = {
  bridgeTop: 0.08,
  bridgeX: 0.95,
  bridgeY: -0.3,
  overTip: 0.1,
  overTipY: -0.05,
  hookDrop: 0.14,
  /** The hook's control point sits just behind the tip, as a share of its x. */
  hookBack: 0.99,
  underX: 0.74,
  underY: 0.14,
  nostrilWingX: 0.58,
  nostrilWingY: 0.16,
  cheekX: 0.44,
  cheekY: 0.02,
  rootUnder: 0.04,
} as const;
/** The dark underside of the hook, in the same units as {@link NOSE_OUTLINE}. */
const NOSE_UNDERSIDE = {
  backX: 0.5,
  topY: 0.06,
  curveX: 0.8,
  curveY: 0.18,
  tipRise: 0.04,
  bottomY: 0.3,
} as const;
/** The lit bridge, in the same units as {@link NOSE_OUTLINE}. */
const NOSE_HIGHLIGHT = {
  rootTop: 0.06,
  bridgeX: 0.9,
  bridgeY: -0.2,
  /** The highlight stops short of the tip, as shares of its x. */
  tipNear: 0.97,
  tipRise: 0.1,
  tipFar: 0.9,
  tipFarRise: 0.06,
  returnX: 0.82,
  returnY: -0.12,
  rootUnder: 0.02,
} as const;
/** The one nostril, in head radii, and where it sits between tip and septum. */
const NOSTRIL = {
  towardSeptum: 0.55,
  rise: 0.05,
  rx: 0.07,
  ry: 0.03,
  tilt: deg(24),
} as const;

/** The hooked nose's outline in head space, for face paint that must stay on the nose. */
export function traceNose(ctx: Ctx, p: GoblinProportions): void {
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const root = pt(rx * NOSE.root.x, r * NOSE.root.y);
  const tipX = rx * NOSE.tipX + p.noseProjection;
  const tipY = r * NOSE_TIP_DROP;
  const septum = pt(lerp(tipX, rx * NOSE.septumBackX, NOSE.septumShare), r * NOSE.septumY);
  const o = NOSE_OUTLINE;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y - r * o.bridgeTop);
  // Bridge: convex, bulging forward and down to the tip.
  ctx.bezierCurveTo(
    rx * o.bridgeX,
    r * o.bridgeY,
    tipX + r * o.overTip,
    r * o.overTipY,
    tipX,
    tipY,
  );
  // The tip hooks down, then the underside scoops back under it.
  ctx.quadraticCurveTo(tipX * o.hookBack, tipY + r * o.hookDrop, septum.x, septum.y);
  ctx.quadraticCurveTo(rx * o.underX, r * o.underY, rx * o.nostrilWingX, r * o.nostrilWingY);
  ctx.quadraticCurveTo(rx * o.cheekX, r * o.cheekY, root.x, root.y + r * o.rootUnder);
  ctx.closePath();
}

/**
 * The long hooked nose, projecting well past the face so it breaks the head's
 * silhouette as a third point between the two ears.
 *
 * A hook is a convex bridge over a *concave* underside meeting at a downturned
 * tip. Drawn as a plain wedge, the head reads as a bird's.
 */
function drawNose(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const skin = style.palette.skin;
  const root = pt(rx * NOSE.root.x, r * NOSE.root.y);
  const tipX = rx * NOSE.tipX + p.noseProjection;
  const tipY = r * NOSE_TIP_DROP;
  const septum = pt(lerp(tipX, rx * NOSE.septumBackX, NOSE.septumShare), r * NOSE.septumY);

  const traceNoseShape = (): void => {
    traceNose(ctx, p);
  };

  ctx.fillStyle = skin.mid;
  traceNoseShape();
  ctx.fill();

  withClip(ctx, traceNoseShape, () => {
    // The underside of a hook is the darkest part of the face.
    const u = NOSE_UNDERSIDE;
    ctx.fillStyle = skin.dark;
    ctx.beginPath();
    ctx.moveTo(rx * u.backX, r * u.topY);
    ctx.quadraticCurveTo(rx * u.curveX, r * u.curveY, tipX, tipY - r * u.tipRise);
    ctx.lineTo(tipX, tipY + r * u.bottomY);
    ctx.lineTo(rx * u.backX, r * u.bottomY);
    ctx.closePath();
    ctx.fill();

    const h = NOSE_HIGHLIGHT;
    ctx.fillStyle = skin.light;
    ctx.beginPath();
    ctx.moveTo(root.x, root.y - r * h.rootTop);
    ctx.quadraticCurveTo(rx * h.bridgeX, r * h.bridgeY, tipX * h.tipNear, tipY - r * h.tipRise);
    ctx.lineTo(tipX * h.tipFar, tipY - r * h.tipFarRise);
    ctx.quadraticCurveTo(rx * h.returnX, r * h.returnY, root.x, root.y + r * h.rootUnder);
    ctx.closePath();
    ctx.fill();
  });

  // One nostril, which stops the tip reading as a rounded knob.
  ctx.fillStyle = style.palette.outline;
  ctx.beginPath();
  ctx.ellipse(
    lerp(tipX, septum.x, NOSTRIL.towardSeptum),
    septum.y - r * NOSTRIL.rise,
    r * NOSTRIL.rx,
    r * NOSTRIL.ry,
    NOSTRIL.tilt,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

/**
 * The rag hood: a scrap of rust-red cloth knotted over the cranium. It stops
 * short of the ears — they poke out under its edge — because a hood that
 * swallows the ears swallows the goblin.
 */
/**
 * The hood's outline, x in head widths and y in head radii: down the back of
 * the skull, over the crown to the brow, and back along its lower edge.
 */
const HOOD = {
  backHem: { x: -1.06, y: 0.22 },
  backOfSkull: { x: -1.14, y: -0.82 },
  crownBack: { x: -0.4, y: -1.14 },
  crown: { x: 0.12, y: -1.08 },
  crownFront: { x: 0.62, y: -1.02 },
  forehead: { x: 0.92, y: -0.72 },
  brow: { x: 0.98, y: -0.42 },
  browHem: { x: 0.7, y: -0.5 },
  hemFront: { x: 0.3, y: -0.62 },
  hemBack: { x: -0.3, y: -0.5 },
  aboveEar: { x: -0.62, y: -0.08 },
  behindEar: { x: -0.8, y: 0.28 },
} as const;
/** The lit fold across the crown, in head widths and radii. */
const HOOD_FOLD = { alpha: 0.75, x: -0.35, y: -0.85, rx: 0.5, ry: 0.22, tilt: deg(-15) } as const;
/** The front of the hood falls into shadow from this share of the head's width. */
const HOOD_SHADOW_ALPHA = 0.7;
const HOOD_SHADOW_FROM = 0.35;
/** The shadow rectangle's top, in head radii above centre, so it covers the crown. */
const HOOD_SHADOW_TOP = 1.2;

function drawHood(ctx: Ctx, style: GoblinStyle): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const { cloth } = style.palette;
  const at = (point: { readonly x: number; readonly y: number }): Pt =>
    pt(rx * point.x, r * point.y);
  const backHem = at(HOOD.backHem);
  const backOfSkull = at(HOOD.backOfSkull);
  const crownBack = at(HOOD.crownBack);
  const crown = at(HOOD.crown);
  const crownFront = at(HOOD.crownFront);
  const forehead = at(HOOD.forehead);
  const brow = at(HOOD.brow);
  const browHem = at(HOOD.browHem);
  const hemFront = at(HOOD.hemFront);
  const hemBack = at(HOOD.hemBack);
  const aboveEar = at(HOOD.aboveEar);
  const behindEar = at(HOOD.behindEar);

  const traceHood = (): void => {
    ctx.beginPath();
    ctx.moveTo(backHem.x, backHem.y);
    ctx.bezierCurveTo(backOfSkull.x, backOfSkull.y, crownBack.x, crownBack.y, crown.x, crown.y);
    ctx.bezierCurveTo(crownFront.x, crownFront.y, forehead.x, forehead.y, brow.x, brow.y);
    ctx.lineTo(browHem.x, browHem.y);
    ctx.bezierCurveTo(hemFront.x, hemFront.y, hemBack.x, hemBack.y, aboveEar.x, aboveEar.y);
    ctx.lineTo(behindEar.x, behindEar.y);
    ctx.closePath();
  };
  ctx.fillStyle = cloth.mid;
  traceHood();
  ctx.fill();
  withClip(ctx, traceHood, () => {
    ctx.fillStyle = rgba(cloth.light, HOOD_FOLD.alpha);
    ctx.beginPath();
    ctx.ellipse(
      rx * HOOD_FOLD.x,
      r * HOOD_FOLD.y,
      rx * HOOD_FOLD.rx,
      r * HOOD_FOLD.ry,
      HOOD_FOLD.tilt,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
    ctx.fillStyle = rgba(cloth.shadow, HOOD_SHADOW_ALPHA);
    ctx.fillRect(rx * HOOD_SHADOW_FROM, -r * HOOD_SHADOW_TOP, rx, r * HOOD_SHADOW_TOP);
  });
}

/** The face's key-light gradient, from the lit crown to the shadowed jaw. */
const FACE_SHADING = {
  fromX: -0.6,
  toX: 0.7,
  litAlpha: 0.8,
  midStop: 0.42,
  shadowStop: 0.7,
  shadowAlpha: 0.6,
  coreAlpha: 0.95,
} as const;
/** The shading rectangle's half-size, in head widths and radii: past the whole skull. */
const FACE_SHADE_REACH = 1.2;
/** The cheekbone's shadow over the lower face, in head widths and radii. */
const CHEEK_SHADOW = { alpha: 0.6, x: 0.35, y: 0.42, rx: 0.5, ry: 0.26, tilt: deg(-10) } as const;
/**
 * The brow ridge off `BROW_Y`, in head widths (`…X`) and radii: its back end
 * high, its front end low over the nose, and the scowl crease along its foot.
 */
const BROW = {
  backX: -0.05,
  backRise: 0.16,
  frontX: 1.0,
  frontDrop: 0.02,
  topX: 0.45,
  topRise: 0.26,
  underX: 0.55,
  underDrop: 0.22,
  backDepth: 0.1,
} as const;
const BROW_CREASE = {
  backX: 0.1,
  backRise: 0.02,
  midX: 0.5,
  midDrop: 0.02,
  frontX: 0.62,
  frontDrop: 0.14,
} as const;

/** Draw the head in head-local space: origin at its centre, +X is forward. */
function drawHead(ctx: Ctx, style: GoblinStyle, pose: GoblinPose): void {
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const skin = style.palette.skin;
  const headwear = style.gear.hood || style.gear.flatCap || style.outfit?.head !== undefined;

  ctx.save();
  drawEar(ctx, style, pose.earLag, false);
  if (!headwear) drawEar(ctx, style, pose.earLag, true);

  ctx.fillStyle = skin.mid;
  traceSkull(ctx, p);
  ctx.fill();

  withClip(
    ctx,
    () => traceSkull(ctx, p),
    () => {
      const shade = FACE_SHADING;
      const faceShading = ctx.createLinearGradient(rx * shade.fromX, -r, rx * shade.toX, r);
      faceShading.addColorStop(0, rgba(skin.light, shade.litAlpha));
      faceShading.addColorStop(shade.midStop, rgba(skin.mid, 0));
      faceShading.addColorStop(shade.shadowStop, rgba(skin.dark, shade.shadowAlpha));
      faceShading.addColorStop(1, rgba(skin.dark, shade.coreAlpha));
      ctx.fillStyle = faceShading;
      ctx.fillRect(
        -rx * FACE_SHADE_REACH,
        -r * FACE_SHADE_REACH,
        rx * FACE_SHADE_REACH * 2,
        r * FACE_SHADE_REACH * 2,
      );

      // The cheekbone throws the long lower face into shadow under it.
      ctx.fillStyle = rgba(skin.dark, CHEEK_SHADOW.alpha);
      ctx.beginPath();
      ctx.ellipse(
        rx * CHEEK_SHADOW.x,
        r * CHEEK_SHADOW.y,
        rx * CHEEK_SHADOW.rx,
        r * CHEEK_SHADOW.ry,
        CHEEK_SHADOW.tilt,
        0,
        FULL_CIRCLE,
      );
      ctx.fill();

      drawEye(ctx, EYE_FAR, r, rx, pose.eyeOpen, style);
      drawEye(ctx, EYE_NEAR, r, rx, pose.eyeOpen, style);

      // A heavy brow ridge shelving over the eyes, lit along its top and
      // knotted into a scowl that slopes down toward the nose.
      const browBack = pt(rx * BROW.backX, r * (BROW_Y - BROW.backRise));
      const browFront = pt(rx * BROW.frontX, r * (BROW_Y + BROW.frontDrop));
      const traceBrow = (): void => {
        ctx.beginPath();
        ctx.moveTo(browBack.x, browBack.y);
        ctx.quadraticCurveTo(rx * BROW.topX, r * (BROW_Y - BROW.topRise), browFront.x, browFront.y);
        ctx.quadraticCurveTo(
          rx * BROW.underX,
          r * (BROW_Y + BROW.underDrop),
          browBack.x,
          browBack.y + r * BROW.backDepth,
        );
        ctx.closePath();
      };
      ctx.fillStyle = skin.light;
      traceBrow();
      ctx.fill();
      ctx.strokeStyle = style.palette.outline;
      ctx.lineWidth = r * MOUTH_LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const crease = BROW_CREASE;
      ctx.moveTo(rx * crease.backX, r * (BROW_Y - crease.backRise));
      ctx.quadraticCurveTo(
        rx * crease.midX,
        r * (BROW_Y + crease.midDrop),
        rx * crease.frontX,
        r * (BROW_Y + crease.frontDrop),
      );
      ctx.stroke();

      drawMouth(ctx, style, pose.mouthOpen);
    },
  );

  drawNose(ctx, style);
  if (style.gear.hood) drawHood(ctx, style);
  if (style.gear.flatCap) drawFlatCap(ctx, style);
  style.outfit?.head?.(ctx, style);
  // Under a hood or a cap the near ear comes out from under the cloth.
  if (headwear) drawEar(ctx, style, pose.earLag, true);
  ctx.restore();
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Far limbs sit this share of the way from `mid` down to `dark`: far enough to
 * read as further from the camera, never so far that a far leg sinks into the
 * floor and the goblin looks one-legged.
 */
const FAR_LIMB_SHARE = 0.4;

function farLimbTone(skin: Ramp): string {
  return mix(skin.mid, skin.dark, FAR_LIMB_SHARE);
}

/** How much narrower the free far arm is than the weapon arm. */
const FAR_ARM_SCALE = 0.82;
/** A far hand brought across onto a haft is less foreshortened, but not by much. */
const FAR_ARM_ON_HAFT_SCALE = 0.86;
const NECK_WIDTH_FRACTION = 0.36;
/** The neck's top end, as a share of the head radius below the head's centre: inside the skull. */
const NECK_INTO_HEAD = 0.6;
/** The neck narrows to this share of its root width where it meets the skull. */
const NECK_TAPER = 0.82;
/** The lit sheen down the near limbs. */
const LIMB_SHEEN_ALPHA = 0.7;

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

/** The silhouette line: one screen pixel at the 32 px tile. */
const OUTLINE_PX = 2;
const OUTLINE_SAMPLES = 8;
/**
 * The goblin is drawn in profile, where the slivers of floor between a hanging
 * arm, the loincloth and the legs are a few pixels across: inked shut they
 * read as one dark separation, while left open they show the floor through a
 * speckle of unoutlined antialiased edges.
 */
const OUTLINE_CLOSES_GAPS = false;
/** How far a part's shadow falls on whatever is behind it, in cell pixels. */
const CAST_DROP_PX = 2;
const CAST_SHADOW_ALPHA = 0.55;
/**
 * A cool blue-black: a shadow falling on green skin reads cooler than the lit
 * skin round it, and on the plumber's denim it stays blue instead of greening.
 */
const CAST_SHADOW_TONE = '#0e1c26';
/** The contact band all round the front arm where it lies over the body. */
const OCCLUSION_PX = 1;
const OCCLUSION_ALPHA = 0.3;
/** The lit rim along the silhouette's edges turned toward the key light. */
const RIM_PX = 2;
const RIM_ALPHA = 0.7;
/**
 * How far past the skeleton's joints the composing surface reaches: the feet,
 * the ears, the nose and the hands all paint past the joint they hang off.
 */
const LAYER_MARGIN = 0.5;
/** Margin round a held weapon's reach, past its tip and its widest head. */
const PROP_MARGIN = 0.3;

/** The direction a cast shadow falls: straight away from the key light. */
const SHADOW_FALL: Pt = { x: -LIGHT.x, y: -LIGHT.y };

function inkReaches(
  style: GoblinStyle,
  skeleton: Skeleton,
  prop: GoblinProp | undefined,
  offHandProp: GoblinProp | undefined,
): InkReach[] {
  const p = style.proportions;
  const headReach = p.headRadius + p.earLength + p.noseProjection;
  const joints = [
    skeleton.hip,
    skeleton.spineTop,
    skeleton.nearArm.joint,
    skeleton.nearArm.end,
    skeleton.farArm.joint,
    skeleton.farArm.end,
    skeleton.nearLeg.joint,
    skeleton.nearLeg.end,
    skeleton.farLeg.joint,
    skeleton.farLeg.end,
  ];
  const head = skeleton.headCentre;
  const reaches: InkReach[] = [
    { points: joints, margin: LAYER_MARGIN },
    {
      points: [offset(head, -headReach, -headReach), offset(head, headReach, headReach)],
      margin: 0,
    },
  ];
  if (prop !== undefined) {
    const span = prop.tipDistance + PROP_MARGIN;
    const hand = skeleton.nearArm.end;
    reaches.push({ points: [offset(hand, -span, -span), offset(hand, span, span)], margin: 0 });
  }
  if (offHandProp !== undefined) {
    const span = offHandProp.tipDistance + PROP_MARGIN;
    const hand = skeleton.farArm.end;
    reaches.push({ points: [offset(hand, -span, -span), offset(hand, span, span)], margin: 0 });
  }
  return reaches;
}

/**
 * The angle a prop held in the far hand is painted at: the pose's own
 * `offHandAngle`, or the far forearm turned forward at the wrist as a free hand
 * is. Exported so a prop's anchor (a lamp's lens) can be located off the rig
 * without painting.
 */
export function offHandWristAngle(skeleton: Skeleton, pose: GoblinPose): number {
  return (
    pose.offHandAngle ??
    segmentAngle(skeleton.farArm.joint, skeleton.farArm.end) + WRIST_FORWARD_TURN
  );
}

/**
 * Light painted over the finished figure in figure space: a flame, a spark, a
 * wisp of smoke. Composed into the figure it would be outlined and rimmed like
 * a solid part, and a glow with a dark ink ring round it reads as a sticker.
 */
export type GoblinOverlay = (ctx: Ctx, skeleton: Skeleton) => void;

/**
 * Draw one goblin frame. `originX`/`originY` is the point between the feet and
 * `unit` is the pixel size of one tile; the figure always faces +X, so callers
 * mirror it at runtime rather than baking a second facing.
 *
 * `offHandProp` is a one-handed prop closed in the far hand, for a goblin
 * carrying something in each hand; it is ignored while `prop` is two-handed.
 */
export function drawGoblin(
  ctx: Ctx,
  originX: number,
  originY: number,
  unit: number,
  style: GoblinStyle,
  pose: GoblinPose,
  prop?: GoblinProp,
  offHandProp?: GoblinProp,
  overlay?: GoblinOverlay,
): void {
  const skeleton = buildSkeleton(style, pose);

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  try {
    drawGroundShadow(ctx, style, pose);
    withComposeLayers(() => composeGoblin(ctx, unit, style, pose, skeleton, prop, offHandProp));
    overlay?.(ctx, skeleton);
  } finally {
    ctx.restore();
  }
}

/**
 * The figure as three slabs, back to front, composed on a surface of its own.
 * Each slab casts a shadow on everything laid before it: the body over the far
 * limbs, and the front arm with its weapon over the body.
 */
function composeGoblin(
  ctx: Ctx,
  unit: number,
  style: GoblinStyle,
  pose: GoblinPose,
  skeleton: Skeleton,
  prop: GoblinProp | undefined,
  offHandProp: GoblinProp | undefined,
): void {
  const p = style.proportions;
  const { skin } = style.palette;

  const nearPaint: LimbPaint = {
    fill: skin.mid,
    shade: skin.dark,
    sheen: rgba(skin.light, LIMB_SHEEN_ALPHA),
  };
  const farPaint: LimbPaint = {
    fill: farLimbTone(skin),
    shade: mix(skin.dark, skin.shadow, FAR_LIMB_SHARE),
    sheen: null,
  };

  const nearWristAngle =
    pose.weaponAngle ??
    segmentAngle(skeleton.nearArm.joint, skeleton.nearArm.end) + pose.wristTwist;
  const paintProp = (layer: Ctx): void => {
    if (prop === undefined) return;
    prop.paint(layer, skeleton.nearArm.end, nearWristAngle);
  };

  const twoHanded =
    prop !== undefined && (prop.offGripDistance !== null || prop.offHandCloses === true);
  const heldOffHand = twoHanded ? undefined : offHandProp;
  const bounds = layerBounds(ctx, inkReaches(style, skeleton, prop, heldOffHand));
  // `unit` is how many cell pixels one figure unit spans, whatever density the
  // cell itself is being painted at.
  const px = (cellPx: number): number => scratchPx(bounds, cellPx, unit);
  const body = makeLayer(bounds);
  const part = makeLayer(bounds);
  const scratch = makeLayer(bounds);
  const farArmInFront = twoHanded || pose.offHandInFront === true;
  const farWristAngle = twoHanded ? nearWristAngle : offHandWristAngle(skeleton, pose);
  // The far arm is further from the camera, so it is drawn narrower — without
  // this the free arm reads as the same mass as the weapon arm and the figure
  // looks slab-sided. A hand brought across the body onto a two-handed haft is
  // much less foreshortened than one hanging at the far hip, so it keeps most
  // of its width.
  const farArmScale = twoHanded ? FAR_ARM_ON_HAFT_SCALE : FAR_ARM_SCALE;
  const farStyle: GoblinStyle = {
    ...style,
    proportions: { ...p, handRadius: p.handRadius * farArmScale },
  };
  const paintFarArm = (layer: Ctx): void => {
    drawLimb(layer, skeleton.farArm, p.armWidth * farArmScale, farPaint);
    style.outfit?.arm?.(
      layer,
      skeleton.farArm,
      p.armWidth * farArmScale,
      farWristAngle,
      style,
      false,
    );
    if (style.gear.bracer) drawBracer(layer, skeleton.farArm, style, farArmScale);
    heldOffHand?.paint(layer, skeleton.farArm.end, farWristAngle);
    drawHand(
      layer,
      skeleton.farArm.end,
      farWristAngle,
      farStyle,
      false,
      twoHanded || heldOffHand !== undefined ? CLOSED_GRIP : OPEN_HAND,
    );
  };

  const rearSlab = (layer: Ctx): void => {
    if (!farArmInFront) paintFarArm(layer);
    drawLimb(layer, skeleton.farLeg, p.legWidth, farPaint);
    if (style.gear.overalls) drawTrouserLeg(layer, skeleton.farLeg, style, false);
    style.outfit?.leg?.(layer, skeleton.farLeg, style, false);
    drawFoot(layer, skeleton.farLeg.end, footAngle(skeleton.farLeg, pose.farFoot), style, false);
    if (pose.propBehind) paintProp(layer);
    // Behind the torso: it is on the creature's back, and painting it in front
    // would put a leather tube across its chest.
    if (style.gear.quiver) drawQuiver(layer, skeleton.spineTop, skeleton.lean, style);
    if (style.gear.plunger) drawPlunger(layer, skeleton.spineTop, skeleton.lean, style);
    style.outfit?.back?.(layer, skeleton.spineTop, skeleton.lean, style);
  };

  const bodySlab = (layer: Ctx): void => {
    layer.save();
    layer.translate(skeleton.hip.x, skeleton.hip.y);
    layer.rotate(skeleton.lean);
    drawTorso(layer, style, pose.torsoSquash);
    layer.restore();

    drawLimb(layer, skeleton.nearLeg, p.legWidth, nearPaint);
    if (style.gear.overalls) drawTrouserLeg(layer, skeleton.nearLeg, style, true);
    style.outfit?.leg?.(layer, skeleton.nearLeg, style, true);
    if (style.gear.greave) drawGreave(layer, skeleton.nearLeg, style);
    drawFoot(layer, skeleton.nearLeg.end, footAngle(skeleton.nearLeg, pose.nearFoot), style, true);
    if (pose.nearArmUnderHead === true) paintNearArm(layer);

    fillCapsule(
      layer,
      skeleton.spineTop,
      offset(skeleton.headCentre, 0, p.headRadius * NECK_INTO_HEAD),
      p.headRadius * NECK_WIDTH_FRACTION,
      p.headRadius * NECK_WIDTH_FRACTION * NECK_TAPER,
      skin.dark,
    );
    if (style.gear.necklace) drawNecklace(layer, skeleton.spineTop, skeleton.lean, style);

    layer.save();
    layer.translate(skeleton.headCentre.x, skeleton.headCentre.y);
    layer.rotate(skeleton.headAngle);
    drawHead(layer, style, pose);
    layer.restore();
  };

  // The gripping fist goes on top of whatever it is gripping. A haft is wider
  // than a goblin's fist, so painting the weapon over the hand buries it, and on
  // the overhead frames — where the haft crosses the whole body — the figure
  // ends up swinging something nobody is holding.
  const paintNearArm = (layer: Ctx): void => {
    drawLimb(layer, skeleton.nearArm, p.armWidth, nearPaint);
    style.outfit?.arm?.(layer, skeleton.nearArm, p.armWidth, nearWristAngle, style, true);
    if (style.gear.pauldron) drawPauldron(layer, skeleton.nearShoulder, skeleton.lean, style);
    if (!pose.propBehind) paintProp(layer);
    drawHand(
      layer,
      skeleton.nearArm.end,
      nearWristAngle,
      style,
      true,
      prop === undefined ? OPEN_HAND : CLOSED_GRIP,
    );
  };

  const frontSlab = (layer: Ctx): void => {
    if (farArmInFront) paintFarArm(layer);
    if (pose.nearArmUnderHead !== true) paintNearArm(layer);
  };

  const cast = pixelStep(SHADOW_FALL, px(CAST_DROP_PX));
  const castTone = rgba(CAST_SHADOW_TONE, CAST_SHADOW_ALPHA);
  inFigureSpace(body, bounds, rearSlab);
  clear(part);
  inFigureSpace(part, bounds, bodySlab);
  laySlab(body, part, scratch, cast, castTone);
  clear(part);
  inFigureSpace(part, bounds, frontSlab);
  occludeAround(
    body,
    part,
    scratch,
    crossOffsets(px(OCCLUSION_PX)),
    rgba(CAST_SHADOW_TONE, OCCLUSION_ALPHA),
  );
  laySlab(body, part, scratch, cast, castTone);

  lightRim(body, scratch, pixelStep(LIGHT, px(RIM_PX)), rgba(skin.rim, RIM_ALPHA));
  outlineInto(
    part,
    body,
    scratch,
    dilationOffsets(px(OUTLINE_PX), OUTLINE_SAMPLES),
    style.palette.outline,
    style.palette.outline,
    OUTLINE_CLOSES_GAPS,
  );
  blitLayer(ctx, part, bounds);
}

/** A hand wrapped round a haft. */
const CLOSED_GRIP = 0;
/** A free hand: a loose curl, not a splay. Fully open reads as jazz hands. */
const OPEN_HAND = 0.16;
/** Hands turn forward off the forearm line rather than dangling down it. */
const WRIST_FORWARD_TURN = deg(-46);

// ── The five archetypes ──────────────────────────────────────────────────────
//
// One skin for every goblin: archetypes are told apart by build, gear and
// weapon, never by colour. A skin per archetype, each tuned to stand off one
// floor, is camouflage on another.
//
// Every build is ~2.7 heads tall: the head is over a third of the figure's
// height. That is the goblin proportion — a big skull on a small, stooped
// body — and it is set by the head radius against the torso and legs, never by
// deriving limbs from the head. Leg and arm bones keep the lengths the
// choreography's strides and reaches were authored against.
//
// These tables author *shape*; {@link ARCHETYPE_SCALE} sets the height the
// figure is drawn at, so tuning the bulk of one archetype can never quietly
// change how tall it stands next to the player.

/** Sole-to-skull height each archetype stands at in play, in tile units. */
const ARCHETYPE_HEIGHTS: Record<GoblinArmedArchetype, number> = {
  sword: 0.94,
  axe: 1.0,
  mace: 0.97,
  warhammer: 1.03,
  /**
   * The tallest of the five, and the only one that is *thin*.
   *
   * An archer has to be identifiable before its bow is drawn, because the whole
   * point of it is that the player picks it out of a mixed room and goes for it
   * first. Height plus a narrow build is the one silhouette cue that survives
   * the bow being held along the body at rest.
   */
  bow: 1.05,
};

/**
 * The five builds that share one set of rows: a walk, an idle, a fidget, a light
 * and a heavy attack, and a flinch.
 */
export type GoblinArmedArchetype = 'sword' | 'axe' | 'mace' | 'warhammer' | 'bow';

/**
 * The two builds that throw explosives. They have rows of their own (a run, a
 * light, an aim and a throw) and no melee rows, so they are dressed in
 * `goblinBomberArt.ts` and choreographed in `goblinBomberFigure.ts`.
 */
export type GoblinBomberArchetype = 'dynamite' | 'black_powder';

/** Every hostile goblin build painted on this rig. */
export type GoblinArchetype = GoblinArmedArchetype | GoblinBomberArchetype;

export const GOBLIN_ARMED_ARCHETYPES: readonly GoblinArmedArchetype[] = [
  'sword',
  'axe',
  'mace',
  'warhammer',
  'bow',
] as const;

export const GOBLIN_BOMBER_ARCHETYPES: readonly GoblinBomberArchetype[] = [
  'dynamite',
  'black_powder',
] as const;

export const GOBLIN_ARCHETYPES: readonly GoblinArchetype[] = [
  ...GOBLIN_ARMED_ARCHETYPES,
  ...GOBLIN_BOMBER_ARCHETYPES,
];

/**
 * Bright goblin green, hue-shifted: the shadows cool toward blue-green, the
 * lit planes warm toward yellow-green.
 *
 * Bright on purpose. Every floor the goblins stand on runs L* 45–63, and a
 * skin at L* 25–50 sits under all of them — camouflage, worst on the grass. `mid` is the lit plane every form is filled with (L* ≈ 67), `dark` the
 * core shadow (L* ≈ 40), and `rim` the pale yellow-green the silhouette's lit
 * edge is painted in (L* ≈ 93). The value range inside the figure is what lets
 * a face and a fist survive 32 px; the hard dark outline separates the figure
 * from the floor whatever the floor's value.
 */
const GOBLIN_SKIN: Ramp = {
  shadow: '#173a22',
  dark: '#2e6a2c',
  mid: '#6cb43a',
  light: '#93d24e',
  rim: '#d8f59a',
};

/**
 * The rag: loincloth, hood and bindings. Rust red, because it is the goblin's
 * one warm accent — on a green floor, green skin separates by value alone,
 * and a patch of red-brown separates by hue as well.
 */
const CLOTH: Ramp = {
  shadow: '#3d140c',
  dark: '#6e2414',
  mid: '#a8401f',
  light: '#cf6a32',
  rim: '#ec9a5a',
};

const LEATHER: Ramp = {
  shadow: '#2a1a10',
  dark: '#4a2e1a',
  mid: '#6f4826',
  light: '#946634',
  rim: '#b98a4e',
};

/**
 * Scavenged iron, kept bright: the weapon is the archetype's identity, so its
 * steel has to stand off every floor — a pale edge over a dark spine.
 */
const IRON: Ramp = {
  shadow: '#2a3038',
  dark: '#4f5965',
  mid: '#8a96a3',
  light: '#b9c4cf',
  rim: '#eef4f8',
};

const BONE: Ramp = {
  shadow: '#6d654f',
  dark: '#918766',
  mid: '#b8ad88',
  light: '#e2dabb',
  rim: '#f6f1de',
};

/** Raw tan wood, light enough that a haft or a bow stave is not floor-coloured. */
const WOOD: Ramp = {
  shadow: '#3d2814',
  dark: '#6b4826',
  mid: '#9a6e3d',
  light: '#c49a5e',
  rim: '#e6c58c',
};

/**
 * The silhouette line: a green-black, hue-shifted toward the skin rather than
 * neutral, and dark enough (L* ≈ 7) to part the figure from every floor.
 */
const GOBLIN_OUTLINE = '#0d160a';
/** The eyes glow: a hot yellow almond with a paler core, in a dark socket. */
const GOBLIN_EYE = '#ffd23a';
const GOBLIN_EYE_CORE = '#fff4b0';
const GOBLIN_SOCKET = '#10180a';
const GOBLIN_TOOTH = '#f4efd8';
const GOBLIN_MOUTH_INNER = '#4a1010';

/** The palette every goblin shares; a build that dresses differently overrides a ramp of it. */
export function goblinPalette(): GoblinPalette {
  return {
    skin: GOBLIN_SKIN,
    cloth: CLOTH,
    leather: LEATHER,
    iron: IRON,
    bone: BONE,
    wood: WOOD,
    eye: GOBLIN_EYE,
    eyeCore: GOBLIN_EYE_CORE,
    sclera: GOBLIN_SOCKET,
    toothEnamel: GOBLIN_TOOTH,
    mouthInner: GOBLIN_MOUTH_INNER,
    outline: GOBLIN_OUTLINE,
  };
}

/** No looted plate and no workwear: the base a build switches its own gear on over. */
export const NO_GEAR: GoblinGear = {
  pauldron: false,
  bracer: false,
  greave: false,
  necklace: false,
  hood: false,
  quiver: false,
  flatCap: false,
  overalls: false,
  plunger: false,
};

const SWORD_BUILD: GoblinProportions = {
  thighLength: 0.29,
  shinLength: 0.27,
  footHeight: 0.05,
  torsoLength: 0.27,
  neckLength: 0.02,
  headRadius: 0.25,
  headWidthFactor: 1.0,
  shoulderHalfWidth: 0.17,
  hipHalfWidth: 0.13,
  bellyBulge: 0.07,
  upperArmLength: 0.36,
  forearmLength: 0.4,
  legWidth: 0.105,
  armWidth: 0.085,
  handRadius: 0.1,
  footLength: 0.34,
  earLength: 0.42,
  noseProjection: 0.16,
};

/** A rag and a tooth necklace: the sword goblin is the bare-skinned one. */
const SWORD_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: SWORD_BUILD,
  gear: { ...NO_GEAR, bracer: true, necklace: true },
  spineLean: deg(14),
  earNotches: 2,
};

const AXE_BUILD: GoblinProportions = {
  thighLength: 0.3,
  shinLength: 0.28,
  footHeight: 0.06,
  torsoLength: 0.31,
  neckLength: 0.02,
  headRadius: 0.27,
  headWidthFactor: 1.04,
  shoulderHalfWidth: 0.21,
  hipHalfWidth: 0.16,
  bellyBulge: 0.08,
  upperArmLength: 0.37,
  forearmLength: 0.46,
  legWidth: 0.13,
  armWidth: 0.105,
  handRadius: 0.11,
  footLength: 0.36,
  earLength: 0.4,
  noseProjection: 0.15,
};

const AXE_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: AXE_BUILD,
  gear: { ...NO_GEAR, pauldron: true, greave: true },
  spineLean: deg(16),
  earNotches: 2,
};

/**
 * Short, pot-bellied and hooded: the rag hood over its skull and the flanged
 * head of the mace are what name it at 32 px; its ears are the shortest in
 * the set and poke out under the hood's edge.
 */
const MACE_BUILD: GoblinProportions = {
  thighLength: 0.27,
  shinLength: 0.26,
  footHeight: 0.06,
  torsoLength: 0.3,
  neckLength: 0.02,
  headRadius: 0.265,
  headWidthFactor: 1.0,
  shoulderHalfWidth: 0.195,
  hipHalfWidth: 0.15,
  bellyBulge: 0.1,
  upperArmLength: 0.38,
  forearmLength: 0.42,
  legWidth: 0.115,
  armWidth: 0.095,
  handRadius: 0.105,
  footLength: 0.34,
  earLength: 0.34,
  noseProjection: 0.17,
};

const MACE_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: MACE_BUILD,
  gear: { ...NO_GEAR, bracer: true, hood: true },
  spineLean: deg(18),
  earNotches: 1,
};

const WARHAMMER_BUILD: GoblinProportions = {
  thighLength: 0.35,
  shinLength: 0.33,
  footHeight: 0.07,
  torsoLength: 0.36,
  neckLength: 0.03,
  headRadius: 0.3,
  headWidthFactor: 1.04,
  shoulderHalfWidth: 0.27,
  hipHalfWidth: 0.18,
  bellyBulge: 0.08,
  upperArmLength: 0.47,
  forearmLength: 0.51,
  legWidth: 0.17,
  armWidth: 0.14,
  handRadius: 0.13,
  footLength: 0.42,
  earLength: 0.4,
  noseProjection: 0.17,
};

/** The heavy: every scrap of plate the others did not get. */
const WARHAMMER_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: WARHAMMER_BUILD,
  gear: { ...NO_GEAR, pauldron: true, bracer: true, greave: true, necklace: true },
  spineLean: deg(22),
  earNotches: 2,
};

/**
 * Long-limbed and narrow: the longest arms in the set on the narrowest
 * shoulders, because a bow is drawn with the whole span of both arms and a
 * stocky archer cannot reach full draw without the rig clamping the arm.
 *
 * The ears are the longest of the five. With the bow held along the body at
 * rest there is no weapon shape to name it by, so the ears and the quiver's
 * fletchings carry the identity on every non-shooting frame.
 */
const BOW_BUILD: GoblinProportions = {
  thighLength: 0.33,
  shinLength: 0.32,
  footHeight: 0.05,
  torsoLength: 0.34,
  neckLength: 0.03,
  headRadius: 0.27,
  headWidthFactor: 0.96,
  shoulderHalfWidth: 0.18,
  hipHalfWidth: 0.11,
  bellyBulge: 0.03,
  upperArmLength: 0.46,
  forearmLength: 0.5,
  // Legs a good deal thicker than the arms, and not only for looks: the gore
  // sheet cuts a limb straight off these numbers, and at equal widths the
  // severed arm and the severed leg render as the same 16-px blob.
  legWidth: 0.115,
  armWidth: 0.08,
  handRadius: 0.11,
  footLength: 0.4,
  earLength: 0.48,
  noseProjection: 0.15,
};

const BOW_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: BOW_BUILD,
  // A hood, a bracer and a quiver, and nothing heavy: an archer that has looted
  // plate is an archer that cannot draw. The quiver is not decoration — it is
  // what makes the walk and idle silhouettes say "archer" at all.
  // The greave is load-bearing in a way that has nothing to do with armour: the
  // gore sheet cuts limbs off the same proportions, and with this archer's long
  // arms its severed arm and severed leg render as the same 16-px blob without
  // it. A shin guard is what makes the leg nameable on the floor.
  gear: { ...NO_GEAR, bracer: true, greave: true, hood: true, quiver: true },
  spineLean: deg(10),
  earNotches: 2,
};

export const GOBLIN_STYLES: Record<GoblinArmedArchetype, GoblinStyle> = {
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
export const ARCHETYPE_SCALE: Record<GoblinArmedArchetype, number> = {
  sword: ARCHETYPE_HEIGHTS.sword / figureHeight(SWORD_BUILD),
  axe: ARCHETYPE_HEIGHTS.axe / figureHeight(AXE_BUILD),
  mace: ARCHETYPE_HEIGHTS.mace / figureHeight(MACE_BUILD),
  warhammer: ARCHETYPE_HEIGHTS.warhammer / figureHeight(WARHAMMER_BUILD),
  bow: ARCHETYPE_HEIGHTS.bow / figureHeight(BOW_BUILD),
};

const PLUMBER_BUILD: GoblinProportions = {
  thighLength: 0.28,
  shinLength: 0.27,
  footHeight: 0.06,
  torsoLength: 0.38,
  neckLength: 0.02,
  headRadius: 0.26,
  headWidthFactor: 1.02,
  shoulderHalfWidth: 0.2,
  hipHalfWidth: 0.16,
  bellyBulge: 0.14,
  upperArmLength: 0.36,
  forearmLength: 0.42,
  legWidth: 0.11,
  armWidth: 0.095,
  handRadius: 0.105,
  footLength: 0.34,
  earLength: 0.42,
  noseProjection: 0.16,
};

/**
 * The bathroom plumber: a stocky goblin with a tradesman's gut, in a cap,
 * overalls and tool belt, with a plunger slung across his back.
 *
 * Not one of the {@link GoblinArchetype}s. Those are the hostile builds a floor
 * spawns and every per-archetype table in the choreography is exhaustive over
 * them; the plumber borrows one archetype's movement and is drawn through his
 * own figure.
 */
export const GOBLIN_PLUMBER_STYLE: GoblinStyle = {
  palette: goblinPalette(),
  proportions: PLUMBER_BUILD,
  gear: { ...NO_GEAR, flatCap: true, overalls: true, plunger: true },
  spineLean: deg(12),
  earNotches: 1,
};

/** Sole-to-skull height the plumber stands at in play, in tile units. */
const PLUMBER_HEIGHT = 0.97;

/** The plumber's equivalent of {@link ARCHETYPE_SCALE}. */
export const GOBLIN_PLUMBER_SCALE = PLUMBER_HEIGHT / figureHeight(PLUMBER_BUILD);
