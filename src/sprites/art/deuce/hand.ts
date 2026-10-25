/**
 * Deuce's hands — a card mechanic's hands, which are the point of him.
 *
 * A hand is painted in its own frame: the wrist at the origin, the fingers
 * running out along +x, the thumb on +y. The caller places that frame with a
 * position, an angle, a length and the side the thumb is on, so a left hand is
 * a right hand mirrored rather than a second drawing.
 *
 * Each finger is three phalanges that flex at three joints. A hand is viewed
 * from above its back or its palm, so a flexed segment turns *out of* the
 * picture plane: it is foreshortened by the cosine of its total flexion, and
 * once past a right angle it folds back under (back view) or over (palm view)
 * the segment before it. That is what makes a fist, a grip or a relaxed rest
 * read as fingers curling round something instead of sticks splayed flat.
 */

import { mix, type Pt } from '../bipedArt';
import {
  type Ctx,
  type Trace,
  devicePixel,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceCapsule,
  traceSmoothLoop,
} from './paint';
import { PALM, type Ramp, SKIN } from './palette';

/** Index, middle, ring, little: 0 straight, 1 a closed curl. */
export type FingerCurls = readonly [number, number, number, number];

export interface HandPose {
  /** Which face of the hand is toward the viewer. */
  view: 'back' | 'palm';
  curls: FingerCurls;
  /** 0 fingers together, 1 spread as wide as a relaxed hand goes. */
  spread: number;
  /** In-plane angle of the thumb from the hand's axis, toward the thumb side, in radians. */
  thumbOut: number;
  /** Bend of the thumb's last joint back toward the fingers, in radians. */
  thumbBend: number;
}

export interface HandPlacement {
  wrist: Pt;
  /** Direction the hand points, wrist to knuckles, in radians. */
  angle: number;
  /** Wrist to middle fingertip, in the caller's units. */
  length: number;
  /** +1 puts the thumb on the left of the pointing direction (screen space), −1 on the right. */
  thumbSide: 1 | -1;
}

/**
 * Which parts to paint. A grip is painted in two passes around the thing
 * gripped: the palm under a card and the curled fingertips over its edge.
 */
export type HandLayer = 'all' | 'body' | 'fingertips';

interface FingerSpec {
  base: Pt;
  length: number;
  radius: number;
  /** In-plane fan angle at full spread. */
  splay: number;
}

const FINGERS: readonly FingerSpec[] = [
  { base: pt(0.46, 0.15), length: 0.42, radius: 0.058, splay: 0.16 },
  { base: pt(0.5, 0.05), length: 0.47, radius: 0.06, splay: 0.02 },
  { base: pt(0.48, -0.055), length: 0.44, radius: 0.056, splay: -0.12 },
  { base: pt(0.43, -0.15), length: 0.34, radius: 0.049, splay: -0.28 },
];
/** Proximal, middle and distal phalanx as shares of a finger's length. */
const PHALANX_SHARES: readonly [number, number, number] = [0.46, 0.3, 0.24];
/** Flexion of the knuckle, middle and end joints at a full curl, in radians. */
const JOINT_FLEX_AT_FULL_CURL: readonly [number, number, number] = [0.55, 1.6, 0.95];
/** A fingertip is a little narrower than the finger's root. */
const FINGERTIP_TAPER = 0.82;
/** Fingers converge slightly when held together, as real ones do. */
const CLOSED_FAN = 0.35;

/** Where the thumb's metacarpal leaves the wrist and where its knuckle sits. */
const THUMB_ROOT = pt(0.06, 0.15);
const THUMB_KNUCKLE = pt(0.27, 0.27);
const THUMB_PROXIMAL = 0.2;
const THUMB_DISTAL = 0.17;
const THUMB_ROOT_RADIUS = 0.085;
const THUMB_RADIUS = 0.066;
const THUMB_TIP_RADIUS = 0.056;

/** Palm outline: wrist, thenar mound, the knuckle ridge, the heel on the little-finger side. */
const PALM_OUTLINE: readonly Pt[] = [
  pt(-0.02, 0.15),
  pt(0.14, 0.23),
  pt(0.3, 0.24),
  pt(0.5, 0.2),
  pt(0.55, 0.05),
  pt(0.53, -0.08),
  pt(0.46, -0.2),
  pt(0.22, -0.21),
  pt(-0.02, -0.16),
];

/** Below this foreshortening a phalanx is end-on: its back is seen as a dark edge. */
const END_ON_COSINE = 0.55;
/**
 * A nail shows while the last phalanx faces the viewer (back view), or once it
 * has folded right back over the palm and shows its back (palm view, a grip).
 */
const NAIL_VISIBLE_COSINE = 0.35;
const NAIL_TINT = '#f2cdb8';
/** The nail covers this much of the last phalanx, set back from the tip by its own half. */
const NAIL_LENGTH_OF_PHALANX = 0.62;
const NAIL_SET_BACK = 0.55;
const NAIL_WIDTH_OF_FINGER = 0.62;
/** Each phalanx narrows a little toward its far joint. */
const PHALANX_TAPER = 0.94;

/** Tendons are a whisper of shade; any darker and the hand reads as a striped glove. */
const TENDON_DEPTH = 0.3;
/** Tendons run from partway up the back of the hand to just short of each knuckle. */
const TENDON_START_X = 0.2;
const TENDON_START_SPREAD = 0.6;
const TENDON_END_SET_BACK = 0.04;
const TENDON_END_SPREAD = 0.92;
/** A knuckle's lit bump: brighter the more its finger is curled. */
const KNUCKLE_SET_BACK = 0.01;
const KNUCKLE_HALF_LENGTH = 0.035;
const KNUCKLE_WIDTH_OF_FINGER = 0.7;
const KNUCKLE_MIN_LIGHT = 0.4;

/** The palm's three main creases, in hand units. */
const PALM_CREASES: ReadonlyArray<readonly Pt[]> = [
  [pt(0.43, -0.17), pt(0.4, -0.02), pt(0.44, 0.16)],
  [pt(0.36, 0.2), pt(0.3, 0.02), pt(0.36, -0.14)],
  [pt(0.34, 0.22), pt(0.16, 0.12), pt(0.02, 0.1)],
];

/** Shadow and highlight crescent widths as fractions of a part's radius. */
const PART_SHADOW = 0.5;
const PART_HIGHLIGHT = 0.22;
const PALM_SHADING = { shadow: 0.05, highlight: 0.025 } as const;
const OUTLINE_PIXELS = 2;
const SIMPLE_OUTLINE_PIXELS = 1;
/**
 * At a few pixels a finger is thinner than its own outline and the hand turns
 * into a dark scribble; the simple hand thickens its digits until they merge
 * into one skin mass with the thumb standing off it.
 */
const SIMPLE_DIGIT_THICKEN = 1.6;
const SEPARATION_PIXELS = 1;
const CREASE_PIXELS = 1;
/** The simple hand's one knuckle line, from the index knuckle to the little one. */
const SIMPLE_KNUCKLE_PIXELS = 1.2;

/**
 * How much of a hand to draw. `simple` is the hand on the club floor, a few
 * pixels across: no digit rims, tendons or creases (they turn it to mud), just
 * the silhouette, one crescent per form and a lit knuckle line.
 */
export type HandDetail = 'full' | 'simple';

export interface HandPaintOptions {
  layer?: HandLayer;
  /** Moves the thumb into the fingertip layer, for a grip where the thumb lies over the thing held. */
  thumbWithFingertips?: boolean;
  detail?: HandDetail;
}

interface Segment {
  a: Pt;
  b: Pt;
  ra: number;
  rb: number;
  /** Cosine of the segment's total flexion: 1 flat in the picture, below 0 folded back. */
  facing: number;
  /** 0 proximal, 1 middle, 2 distal. */
  index: number;
}

const DISTAL = PHALANX_SHARES.length - 1;

function fingerSegments(finger: FingerSpec, curl: number, spread: number): Segment[] {
  const fan = finger.splay * (CLOSED_FAN + (1 - CLOSED_FAN) * spread);
  const dir = pt(Math.cos(fan), Math.sin(fan));
  const segments: Segment[] = [];
  let at = finger.base;
  let flex = 0;
  let radius = finger.radius;
  for (let index = 0; index < PHALANX_SHARES.length; index++) {
    flex += JOINT_FLEX_AT_FULL_CURL[index] * curl;
    const facing = Math.cos(flex);
    const length = finger.length * PHALANX_SHARES[index] * facing;
    const end = pt(at.x + dir.x * length, at.y + dir.y * length);
    const endRadius = radius * (index === DISTAL ? FINGERTIP_TAPER : PHALANX_TAPER);
    segments.push({ a: at, b: end, ra: radius, rb: endRadius, facing, index });
    at = end;
    radius = endRadius;
  }
  return segments;
}

function thumbSegments(pose: HandPose): Segment[] {
  const out = pose.thumbOut;
  const proximalDir = pt(Math.cos(out), Math.sin(out));
  const tipAngle = out - pose.thumbBend;
  const distalDir = pt(Math.cos(tipAngle), Math.sin(tipAngle));
  const ipJoint = pt(
    THUMB_KNUCKLE.x + proximalDir.x * THUMB_PROXIMAL,
    THUMB_KNUCKLE.y + proximalDir.y * THUMB_PROXIMAL,
  );
  const tip = pt(ipJoint.x + distalDir.x * THUMB_DISTAL, ipJoint.y + distalDir.y * THUMB_DISTAL);
  return [
    {
      a: THUMB_ROOT,
      b: THUMB_KNUCKLE,
      ra: THUMB_ROOT_RADIUS,
      rb: THUMB_RADIUS,
      facing: 1,
      index: 0,
    },
    { a: THUMB_KNUCKLE, b: ipJoint, ra: THUMB_RADIUS, rb: THUMB_RADIUS, facing: 1, index: 1 },
    { a: ipJoint, b: tip, ra: THUMB_RADIUS, rb: THUMB_TIP_RADIUS, facing: 1, index: DISTAL },
  ];
}

function segmentTrace(segment: Segment): Trace {
  return (ctx) => traceCapsule(ctx, segment.a, segment.b, segment.ra, segment.rb);
}

/** The value ramp a phalanx is painted from: an end-on segment shows its darker edge. */
function segmentRamp(view: HandPose['view'], facing: number): Ramp {
  const surface = view === 'palm' && facing > -END_ON_COSINE ? PALM : SKIN;
  if (Math.abs(facing) >= END_ON_COSINE) return surface;
  return { light: surface.base, base: surface.shade, shade: surface.deep, deep: surface.deep };
}

function paintSegment(
  ctx: Ctx,
  segment: Segment,
  view: HandPose['view'],
  detail: HandDetail,
): void {
  const trace = segmentTrace(segment);
  const radius = Math.max(segment.ra, segment.rb);
  if (detail === 'full') {
    // A thin darker rim on every digit is what separates it from its neighbour;
    // without it four touching fingers merge into one paddle.
    ctx.strokeStyle = SKIN.deep;
    ctx.lineWidth = devicePixel(ctx) * SEPARATION_PIXELS;
    ctx.beginPath();
    trace(ctx);
    ctx.stroke();
  }
  paintForm(ctx, trace, segmentRamp(view, segment.facing), {
    shadow: radius * PART_SHADOW,
    highlight: radius * PART_HIGHLIGHT,
  });
}

function nailShows(segment: Segment, view: HandPose['view']): boolean {
  if (segment.index !== DISTAL) return false;
  return view === 'back'
    ? segment.facing >= NAIL_VISIBLE_COSINE
    : segment.facing <= -NAIL_VISIBLE_COSINE;
}

function paintNail(ctx: Ctx, segment: Segment): void {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const nailLength = length * NAIL_LENGTH_OF_PHALANX;
  const centre = pt(
    segment.b.x - ux * nailLength * NAIL_SET_BACK,
    segment.b.y - uy * nailLength * NAIL_SET_BACK,
  );
  ctx.fillStyle = NAIL_TINT;
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    nailLength / 2,
    segment.rb * NAIL_WIDTH_OF_FINGER,
    Math.atan2(uy, ux),
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function paintKnuckle(ctx: Ctx, finger: FingerSpec, curl: number): void {
  // A curled finger raises its knuckle into a hard, lit bump.
  const knuckleLight = SKIN.light ?? SKIN.base;
  ctx.fillStyle = mix(SKIN.base, knuckleLight, KNUCKLE_MIN_LIGHT + curl * (1 - KNUCKLE_MIN_LIGHT));
  ctx.beginPath();
  ctx.ellipse(
    finger.base.x - KNUCKLE_SET_BACK,
    finger.base.y,
    KNUCKLE_HALF_LENGTH,
    finger.radius * KNUCKLE_WIDTH_OF_FINGER,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** The ridge of the knuckles and the tendons fanning to them: an old hand's back. */
function paintBackDetail(ctx: Ctx, curls: FingerCurls, detail: HandDetail): void {
  if (detail === 'simple') {
    strokeLine(
      ctx,
      FINGERS.map((finger) => pt(finger.base.x - KNUCKLE_SET_BACK, finger.base.y)),
      SKIN.light ?? SKIN.base,
      SIMPLE_KNUCKLE_PIXELS,
      true,
    );
    return;
  }
  FINGERS.forEach((finger, i) => {
    const tendonEnd = pt(finger.base.x - TENDON_END_SET_BACK, finger.base.y * TENDON_END_SPREAD);
    const tendonStart = pt(TENDON_START_X, finger.base.y * TENDON_START_SPREAD);
    strokeLine(
      ctx,
      [tendonStart, tendonEnd],
      mix(SKIN.base, SKIN.shade, TENDON_DEPTH),
      CREASE_PIXELS,
    );
    paintKnuckle(ctx, finger, curls[i]);
  });
}

/** The palm's creases — the cue that says "palm" before any finger does. */
function paintPalmDetail(ctx: Ctx, detail: HandDetail): void {
  if (detail === 'simple') return;
  for (const crease of PALM_CREASES) strokeLine(ctx, crease, PALM.shade, CREASE_PIXELS, true);
}

const tracePalm: Trace = (c) => traceSmoothLoop(c, PALM_OUTLINE);

function paintPalmShape(ctx: Ctx, pose: HandPose, detail: HandDetail): void {
  const ramp = pose.view === 'palm' ? PALM : SKIN;
  paintForm(ctx, tracePalm, ramp, PALM_SHADING);
  if (pose.view === 'back') paintBackDetail(ctx, pose.curls, detail);
  else paintPalmDetail(ctx, detail);
}

/** Paints one hand, or one layer of it around something it holds. */
export function paintHand(
  ctx: Ctx,
  placement: HandPlacement,
  pose: HandPose,
  options: HandPaintOptions = {},
): void {
  const layer = options.layer ?? 'all';
  const thumbWithFingertips = options.thumbWithFingertips ?? false;
  const detail = options.detail ?? 'full';
  const thicken = (segment: Segment): Segment =>
    detail === 'simple'
      ? { ...segment, ra: segment.ra * SIMPLE_DIGIT_THICKEN, rb: segment.rb * SIMPLE_DIGIT_THICKEN }
      : segment;
  const fingers = FINGERS.map((finger, i) =>
    fingerSegments(finger, pose.curls[i], pose.spread).map(thicken),
  );
  const thumb = thumbSegments(pose).map(thicken);
  const wantsBody = layer !== 'fingertips';
  const wantsTips = layer !== 'body';
  const drawsThumb = thumbWithFingertips ? wantsTips : wantsBody;

  const bodySegments = fingers.map((segments) => segments.filter((s) => s.index === 0));
  const tipSegments = fingers.map((segments) => segments.filter((s) => s.index > 0));

  ctx.save();
  ctx.translate(placement.wrist.x, placement.wrist.y);
  ctx.rotate(placement.angle);
  // Local +y is the thumb side. In screen space with y down, the left of the
  // pointing direction is −y, so a thumb on the left needs the frame flipped.
  ctx.scale(placement.length, placement.length * -placement.thumbSide);

  const outlineParts: Trace[] = [];
  if (wantsBody) {
    outlineParts.push(tracePalm);
    bodySegments.flat().forEach((s) => outlineParts.push(segmentTrace(s)));
  }
  if (wantsTips) tipSegments.flat().forEach((s) => outlineParts.push(segmentTrace(s)));
  if (drawsThumb) thumb.forEach((s) => outlineParts.push(segmentTrace(s)));
  const outlinePixels = detail === 'simple' ? SIMPLE_OUTLINE_PIXELS : OUTLINE_PIXELS;
  outlineParts.forEach((trace) => outlineTrace(ctx, trace, outlinePixels));

  // On the back of a hand the thumb hangs a little below the palm's plane, so
  // the palm overlaps its root; on the palm side its pad lies over the palm.
  const thumbUnderPalm = pose.view === 'back';
  const paintThumb = (): void => thumb.forEach((s) => paintSegment(ctx, s, pose.view, detail));
  if (drawsThumb && thumbUnderPalm && !thumbWithFingertips) paintThumb();
  if (wantsBody) paintPalmShape(ctx, pose, detail);

  // Fingers are painted from the little finger inward so each overlaps the one
  // further from the thumb. Within a finger, the back view paints distal first
  // (a curled tip tucks under its knuckle) and the palm view proximal first (a
  // curled tip comes over the palm, toward the viewer).
  for (let f = FINGERS.length - 1; f >= 0; f--) {
    const ordered = pose.view === 'back' ? [...fingers[f]].reverse() : fingers[f];
    for (const segment of ordered) {
      const isBody = segment.index === 0;
      if (isBody ? !wantsBody : !wantsTips) continue;
      paintSegment(ctx, segment, pose.view, detail);
      if (detail === 'full' && nailShows(segment, pose.view)) paintNail(ctx, segment);
    }
  }
  if (drawsThumb && (!thumbUnderPalm || thumbWithFingertips)) paintThumb();
  if (drawsThumb && detail === 'full' && pose.view === 'back') paintNail(ctx, thumb[DISTAL]);
  ctx.restore();
}

/** A hand resting palm-down on the felt: fingers relaxed into a soft curve. */
export const RESTING_HAND: HandPose = {
  view: 'back',
  curls: [0.22, 0.26, 0.3, 0.36],
  spread: 0.25,
  thumbOut: 0.42,
  thumbBend: 0.1,
};
