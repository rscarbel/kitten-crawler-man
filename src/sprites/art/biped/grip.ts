/**
 * A hand closed round a handle: the palm block, four finger bands and a thumb
 * wrapped round a cylinder the handle's thickness, solved in three dimensions
 * from the socket's axis and palm normal and drawn flat.
 *
 * Each band and the thumb is cut into short segments, and each segment's
 * outward normal decides which side of the handle it is on: facing the camera
 * it belongs to the front grip layer, drawn over the held item; facing away,
 * to the back layer, under it. The palm block is in front when the back of
 * the hand faces the camera. Nothing here is authored per frame — a wrist that
 * rolls from palm-out to knuckles-out moves the fingers from behind the haft
 * to in front of it on its own.
 */

import type { Vec3 } from '../../held/heldPaint';
import { LIGHT, type Ramp } from './palette';
import type { Pt } from '../bipedArt';

type Ctx = CanvasRenderingContext2D;

/** Which part of a grip to paint: what lies behind the handle, in front of it, or both. */
export type GripLayer = 'back' | 'front' | 'whole';

/** One short piece of a finger or the thumb, as drawn. */
interface GripSegment {
  readonly from: Pt;
  readonly to: Pt;
  /** Its outward normal's depth toward the camera, from −1 to 1; positive is in front of the handle. */
  readonly facing: number;
  /** How squarely the key light falls on it, 0 to 1. */
  readonly lit: number;
  readonly halfWidth: number;
}

/** A grip solved for one hand on one frame, ready to paint. */
export interface GripWrap {
  /** The handle's centre line where the hand closes on it, figure units. */
  readonly centre: Pt;
  /** Back of the hand toward the camera: the palm block sits over the handle. */
  readonly palmInFront: boolean;
  /** Each finger, pinky first: its segments from the palm out to the tip. */
  readonly fingers: readonly (readonly GripSegment[])[];
  /** The thumb, from the palm out to its tip. */
  readonly thumb: readonly GripSegment[];
  /**
   * Where the palm lies off the handle's centre line on screen, figure
   * units: nothing when the palm faces toward or away from the camera, out
   * to one side of the handle when the hand is seen on its edge.
   */
  readonly palmOffset: Pt;
}

/** What a grip is solved from. */
export interface GripSolveInput {
  /** The middle of the bore, figure units. */
  readonly centre: Pt;
  /** The handle's direction, butt to head, unit, camera space as drawn. */
  readonly axis: Vec3;
  /** The way the palm faces, camera space as drawn. */
  readonly palmNormal: Vec3;
  /** Wrist to knuckles on screen, radians. */
  readonly handAngle: number;
  /** The handle's half-thickness, figure units. */
  readonly handleRadius: number;
  /** How far the hand spans along the handle, figure units. */
  readonly handWidth: number;
}

const FINGERS = 4;
/** Each finger's half-thickness, as a share of the room one finger has along the handle. */
const FINGER_HALF_SHARE = 0.56;
/** Each finger's thickness against that, pinky first: the little finger is slight, the index full. */
const FINGER_GIRTH: readonly number[] = [0.8, 0.93, 1, 1.02];
/** The thumb is about a finger's thickness: any thicker and, seen palm-out, it hides the finger tips it lies across. */
const THUMB_HALF_SHARE = 0.5;
/**
 * How far round the handle each finger wraps, from the palm, in radians: past
 * three quarters of a turn, so seen palm-out the tips curl up over the
 * handle's front toward the palm rather than hanging under it. The middle and
 * ring fingers wrap furthest. Pinky first.
 */
const FINGER_WRAP: readonly number[] = [4.1, 4.4, 4.4, 4.2];
/** The fingers leave the palm a little before the handle's palm-side line. */
const FINGER_START = -0.25;
/**
 * The thumb wraps the other way round, over the wrist side, onto the front of
 * the handle and no further: carried round past the front it stands off the
 * handle as a long upright digit.
 */
const THUMB_WRAP = -2.2;
const THUMB_START = -0.1;
/**
 * The thumb winds along the handle as it wraps: it leaves the palm past the
 * index finger, toward the head, and lands across the index and middle
 * fingers, crossing them on a slant rather than standing up beside them. In shares of
 * the room one finger has, from the row's centre.
 */
const THUMB_ROOT_ALONG = 1.9;
const THUMB_TIP_ALONG = 0.9;
/**
 * How far the palm block moves off the handle toward the palm side, as a
 * share of the finger ring's radius: the heel of the hand stays on the
 * wrist, so only part of the palm's offset shows.
 */
const PALM_LIFT_SHARE = 0.5;
/**
 * The palm block is drawn over the handle unless the palm faces the camera
 * by more than this: seen on its edge a fist's heel covers the handle, and a
 * palm block dropped behind it there reads as the handle passing through a
 * flat paddle.
 */
const PALM_BEHIND_Z = 0.45;
/** Segments per radian of wrap: enough that no segment is longer than about a cell pixel. */
const SEGMENTS_PER_RADIAN = 3;
/** How far the key light stands toward the camera, against its on-screen direction. */
const LIGHT_TOWARD_CAMERA = 0.8;
/** A grip's lit values: brighter than this the lit tone, darker than the second the shadow. */
const LIT_THRESHOLD = 0.62;
const HALF_LIT_THRESHOLD = 0.3;
const SHADOW_THRESHOLD = 0.05;
/** The crease between neighbouring fingers is the band's own edge one step darker, this much wider. */
const CREASE_SHARE = 1.25;
/** Shorter than this a vector has no direction. */
const DEGENERATE = 1e-6;

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return v(a.x + b.x, a.y + b.y, a.z + b.z);
}

function scaled(a: Vec3, k: number): Vec3 {
  return v(a.x * k, a.y * k, a.z * k);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalised(a: Vec3, fallback: Vec3): Vec3 {
  const size = length(a);
  return size < DEGENERATE ? fallback : scaled(a, 1 / size);
}

/** `a` with its share along unit `along` taken out, unit. */
function perpendicular(a: Vec3, along: Vec3, fallback: Vec3): Vec3 {
  return normalised(add(a, scaled(along, -dot(a, along))), fallback);
}

const TOWARD_CAMERA = v(0, 0, 1);
const LIGHT_3D = normalised(v(LIGHT.x, LIGHT.y, LIGHT_TOWARD_CAMERA), TOWARD_CAMERA);

function arcSegments(
  centre: Vec3,
  palmSide: Vec3,
  around: Vec3,
  ringRadius: number,
  start: number,
  end: number,
  halfWidth: number,
  drift: Vec3 = v(0, 0, 0),
): GripSegment[] {
  const steps = Math.max(1, Math.ceil(Math.abs(end - start) * SEGMENTS_PER_RADIAN));
  const at = (angle: number): { point: Vec3; normal: Vec3 } => {
    const normal = add(scaled(palmSide, Math.cos(angle)), scaled(around, Math.sin(angle)));
    const wound = scaled(drift, (angle - start) / (end - start));
    return { point: add(add(centre, wound), scaled(normal, ringRadius)), normal };
  };
  const segments: GripSegment[] = [];
  for (let step = 0; step < steps; step++) {
    const a = at(start + ((end - start) * step) / steps);
    const b = at(start + ((end - start) * (step + 1)) / steps);
    const middle = normalised(add(a.normal, b.normal), a.normal);
    segments.push({
      from: { x: a.point.x, y: a.point.y },
      to: { x: b.point.x, y: b.point.y },
      facing: middle.z,
      lit: Math.max(0, dot(middle, LIGHT_3D)),
      halfWidth,
    });
  }
  return segments;
}

/**
 * Solves the fingers and thumb round a handle. The palm lies against the
 * handle on the side its normal points away from; the fingers leave it
 * toward the knuckles and wrap round, the thumb wraps the other way, over
 * the wrist side, and lands on the index finger. The index finger is the
 * one nearest the head.
 */
export function solveGrip(input: GripSolveInput): GripWrap {
  const axis = normalised(input.axis, v(1, 0, 0));
  const palmNormal = perpendicular(
    input.palmNormal,
    axis,
    perpendicular(TOWARD_CAMERA, axis, v(0, 1, 0)),
  );
  const palmSide = scaled(palmNormal, -1);
  const knuckles = v(Math.cos(input.handAngle), Math.sin(input.handAngle), 0);
  const aroundRaw = cross(axis, palmSide);
  const around = dot(aroundRaw, knuckles) < 0 ? scaled(aroundRaw, -1) : aroundRaw;
  const spacing = input.handWidth / FINGERS;
  const fingerHalf = spacing * FINGER_HALF_SHARE;
  const centre = v(input.centre.x, input.centre.y, 0);
  const fingers = FINGER_WRAP.map((wrap, finger) => {
    const along = (finger - (FINGERS - 1) / 2) * spacing;
    const half = fingerHalf * FINGER_GIRTH[finger];
    return arcSegments(
      add(centre, scaled(axis, along)),
      palmSide,
      around,
      input.handleRadius + half,
      FINGER_START,
      wrap,
      half,
    );
  });
  const thumbHalf = spacing * THUMB_HALF_SHARE;
  const thumbRoot = add(centre, scaled(axis, THUMB_ROOT_ALONG * spacing));
  const thumb = arcSegments(
    thumbRoot,
    palmSide,
    around,
    input.handleRadius + thumbHalf,
    THUMB_START,
    THUMB_WRAP,
    thumbHalf,
    scaled(axis, (THUMB_TIP_ALONG - THUMB_ROOT_ALONG) * spacing),
  );
  const palmLift = (input.handleRadius + fingerHalf) * PALM_LIFT_SHARE;
  return {
    centre: input.centre,
    palmInFront: palmSide.z > -PALM_BEHIND_Z,
    fingers,
    thumb,
    palmOffset: { x: palmSide.x * palmLift, y: palmSide.y * palmLift },
  };
}

function toneFor(segment: GripSegment, flesh: Ramp): string {
  if (segment.lit >= LIT_THRESHOLD) return flesh.light;
  if (segment.lit >= HALF_LIT_THRESHOLD) return flesh.base;
  if (segment.lit >= SHADOW_THRESHOLD) return flesh.mid;
  return flesh.dark;
}

function inLayer(segment: GripSegment, layer: GripLayer): boolean {
  if (layer === 'whole') return true;
  return layer === 'front' ? segment.facing > 0 : segment.facing <= 0;
}

function stroke(ctx: Ctx, segment: GripSegment, colour: string, widthShare: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = segment.halfWidth * 2 * widthShare;
  ctx.beginPath();
  ctx.moveTo(segment.from.x, segment.from.y);
  ctx.lineTo(segment.to.x, segment.to.y);
  ctx.stroke();
}

function meanFacing(segments: readonly GripSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.facing, 0) / segments.length;
}

/**
 * Paints the finger and thumb segments of `layer`, the finger farthest from
 * the camera first. Each band is laid as a crease one step darker and a little
 * wider, then its own tones over it, so neighbouring fingers part by a line
 * of shade rather than an ink outline.
 */
export function paintGripFingers(ctx: Ctx, wrap: GripWrap, layer: GripLayer, flesh: Ramp): void {
  const shownFingers = wrap.fingers
    .map((band) => band.filter((segment) => inLayer(segment, layer)))
    .filter((band) => band.length > 0)
    .sort((a, b) => meanFacing(a) - meanFacing(b));
  const shownThumb = wrap.thumb.filter((segment) => inLayer(segment, layer));
  // Behind the handle the thumb is the deepest thing; in front it closes over the fingers.
  const thumbFirst = layer === 'back';
  const bands =
    shownThumb.length === 0
      ? shownFingers
      : thumbFirst
        ? [shownThumb, ...shownFingers]
        : [...shownFingers, shownThumb];
  ctx.save();
  ctx.lineCap = 'round';
  for (const band of bands) {
    for (const segment of band) stroke(ctx, segment, flesh.shadow, CREASE_SHARE);
    for (const segment of band) stroke(ctx, segment, toneFor(segment, flesh), 1);
  }
  ctx.restore();
}
