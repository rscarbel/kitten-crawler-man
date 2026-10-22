/**
 * The Trash Gremlin's head: a broad, flat skull with a wide lipless mouth of
 * needle teeth, two big round amber eyes, two enormous ragged bat ears standing
 * out sideways past its shoulders, a translucent acid sac under the jaw, and a
 * crown bent out of a can.
 *
 * The face is never a snout. In profile the face is a near-vertical plane with
 * the mouth running back along the jaw toward the ear: what the profile carries
 * is the width of the mouth, the ears and the sac, never a muzzle.
 */

import { type Pt, clamp01, lerp, rgba } from '../carlArt';
import {
  BRASS,
  TIN,
  TIN_LABEL,
  EAR_MEMBRANE,
  EAR_RIB,
  EYE_GLINT,
  EYE_IRIS,
  EYE_IRIS_DEEP,
  EYE_PUPIL,
  EYE_SOCKET,
  HIDE,
  MOUTH_INSIDE,
  NOSTRIL,
  OUTLINE,
  type Ramp,
  SAC_BRIGHT,
  SAC_CORE,
  SAC_DARK,
  SAC_MID,
  SAC_VEIN,
  SPRAY_BRIGHT,
  SPRAY_DARK,
  SPRAY_MID,
  TOOTH,
  TOOTH_SHADE,
} from './palette';
import {
  type Ctx,
  type Form,
  type Trace,
  form,
  glow,
  hash1,
  traceEllipse,
  tracePolygon,
  traceSmooth,
} from './paint';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from './proportions';
import {
  type EarPose,
  EAR_REST_LIFT,
  type GremlinPose,
  type GremlinView,
  type Skeleton,
  offset,
  project,
  pt,
} from './rig';

// ── The head's frame on screen ───────────────────────────────────────────────

export interface HeadFrame {
  readonly c: Pt;
  /** Screen images of one unit along the head's right, up and forward axes. */
  readonly right: Pt;
  readonly up: Pt;
  readonly forward: Pt;
  /** Unit screen directions for a head-on silhouette. */
  readonly rightUnit: Pt;
  readonly upUnit: Pt;
  /** How tall the head-on silhouette stands against its resting height, as it tips. */
  readonly heightScale: number;
  readonly view: GremlinView;
}

function unit(p: Pt, fallback: Pt): Pt {
  const len = Math.hypot(p.x, p.y);
  return len < UNIT_DEGENERATE ? fallback : pt(p.x / len, p.y / len);
}

const UNIT_DEGENERATE = 1e-4;
/**
 * A head thrown back shows its jaw and throat as well as its face, but drawn at
 * its full depth the flat skull turns into a tall box; it stretches this far
 * and no further.
 */
const HEAD_TIP_STRETCH_LIMIT = 1.06;

export function headFrame(sk: Skeleton, view: GremlinView): HeadFrame {
  const c = project(sk.head, view);
  const image = (dir: Skeleton['headUp']): Pt => {
    const p = project(offset(sk.head, dir, 1), view);
    return pt(p.x - c.x, p.y - c.y);
  };
  const right = image(sk.headRight);
  const up = image(sk.headUp);
  const forward = image(sk.headForward);
  const upUnit = unit(up, pt(0, -1));
  const rightUnit = view === 'front' ? pt(upUnit.y, -upUnit.x) : pt(-upUnit.y, upUnit.x);
  const tiltCos = clamp01(Math.abs(sk.headUp.y));
  const tiltSin = Math.sqrt(1 - tiltCos * tiltCos);
  const depthRatio = HEAD_DEPTH / HEAD_RY;
  const heightScale = Math.min(
    HEAD_TIP_STRETCH_LIMIT,
    Math.sqrt(tiltCos * tiltCos + depthRatio * depthRatio * tiltSin * tiltSin),
  );
  return { c, right, up, forward, rightUnit, upUnit, heightScale, view };
}

/** A point on the head, in its own units: right, up and forward of its centre. */
export function headPoint(frame: HeadFrame, r: number, u: number, f: number): Pt {
  return pt(
    frame.c.x + frame.right.x * r + frame.up.x * u + frame.forward.x * f,
    frame.c.y + frame.right.y * r + frame.up.y * u + frame.forward.y * f,
  );
}

/** A point on the head-on silhouette's plane, scaled for how far the head has tipped. */
function silhouettePoint(frame: HeadFrame, r: number, u: number): Pt {
  return pt(
    frame.c.x + frame.rightUnit.x * r + frame.upUnit.x * u * frame.heightScale,
    frame.c.y + frame.rightUnit.y * r + frame.upUnit.y * u * frame.heightScale,
  );
}

/** Depth of the face's surface at (r, u), for placing features on it. */
function faceDepth(r: number, u: number): number {
  const share = 1 - (r / HEAD_RX) ** 2 - (u / HEAD_RY) ** 2;
  return HEAD_DEPTH * Math.sqrt(Math.max(0, share));
}

// ── Silhouette ───────────────────────────────────────────────────────────────

/** The top of the skull is flattened: an exponent under 1 squares off the dome. */
const CROWN_FLATNESS = 0.6;
const SIDE_FULLNESS = 0.85;
const JAW_FULLNESS = 0.85;
/** The cheeks are widest a little below the eyes, where the mouth's corners are. */
const CHEEK_SWELL = 0.06;
const HEAD_OUTLINE_STEPS = 40;
/** How far the jaw drops at full gape, at the middle of the mouth. */
const JAW_DROP = HEAD_RY * 0.95;
/** The mouth's corners hinge rather than drop: they open by this share. */
const JAW_CORNER_SHARE = 0.35;
const MOUTH_U = -0.1;

function jawDropAt(r: number, jaw: number): number {
  const across = clamp01(Math.abs(r) / HEAD_RX);
  return jaw * JAW_DROP * lerp(1, JAW_CORNER_SHARE, across * across);
}

/** How far below the dropped lower lip the chin still runs. */
const CHIN_BELOW_LIP = 0.06;

/**
 * How far the dropped jaw carries the chin past the skull's own outline, along
 * the screen's down. Measured off where the lip actually is rather than off the
 * gape alone: a head thrown back carries its mouth up the face, and a chin
 * extended by the whole gape regardless leaves a blank box of jaw under it.
 */
function chinExtension(frame: HeadFrame, jaw: number): number {
  const lipU = mouthUpperU(0);
  const lip = headPoint(frame, 0, lipU, faceDepth(0, lipU));
  const lipBelowCentre = -(
    (lip.x - frame.c.x) * frame.upUnit.x +
    (lip.y - frame.c.y) * frame.upUnit.y
  );
  const chin = lipBelowCentre + jawDropAt(0, jaw) + CHIN_BELOW_LIP;
  return Math.max(0, chin - HEAD_RY * frame.heightScale);
}

function frontOutline(frame: HeadFrame, jaw: number): Pt[] {
  const points: Pt[] = [];
  const middleDrop = jawDropAt(0, jaw);
  const extension = chinExtension(frame, jaw) / frame.heightScale;
  for (let i = 0; i < HEAD_OUTLINE_STEPS; i++) {
    const angle = (i / HEAD_OUTLINE_STEPS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const upper = sin > 0;
    const r =
      HEAD_RX *
      Math.sign(cos) *
      Math.abs(cos) ** SIDE_FULLNESS *
      (1 + CHEEK_SWELL * (upper ? 0 : Math.abs(sin)));
    const u = upper
      ? HEAD_RY * Math.abs(sin) ** CROWN_FLATNESS
      : -HEAD_RY * Math.abs(sin) ** JAW_FULLNESS -
        (middleDrop > 0 ? (extension * jawDropAt(r, jaw)) / middleDrop : 0) * clamp01(-sin * 2);
    points.push(silhouettePoint(frame, r, u));
  }
  return points;
}

/**
 * The profile, as (forward, up) pairs from the nape round over the crown and
 * down the face. The face is a near-vertical plane: brow, a shallow dip at the
 * eye, a flat cheek, and the mouth's front edge directly under it.
 */
const PROFILE_SKULL: readonly (readonly [number, number])[] = [
  [-0.27, 0.0],
  [-0.26, 0.15],
  [-0.17, 0.26],
  [0.0, 0.29],
  [0.15, 0.27],
  [0.24, 0.21],
  [0.28, 0.13],
  [0.27, 0.06],
  [0.295, 0.0],
  [0.3, -0.07],
];

/** The lower jaw, from the mouth's front edge back to its angle under the ear. */
const PROFILE_JAW: readonly (readonly [number, number])[] = [
  [0.29, -0.13],
  [0.24, -0.22],
  [0.11, -0.255],
  [-0.04, -0.23],
  [-0.16, -0.14],
  [-0.25, -0.07],
];

/** Where the jaw hinges in profile, and how far it swings at full gape. */
const JAW_HINGE: Pt = pt(-0.12, -0.07);
const JAW_OPEN_ANGLE = 0.75;

function rotateAbout(p: Pt, pivot: Pt, angle: number): Pt {
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return pt(
    pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  );
}

/** A lower-jaw point in (forward, up), swung open about the hinge. */
function jawPoint(f: number, u: number, jaw: number): Pt {
  return rotateAbout(pt(f, u), JAW_HINGE, -jaw * JAW_OPEN_ANGLE);
}

function profileOutline(frame: HeadFrame, jaw: number): Pt[] {
  const skull = PROFILE_SKULL.map(([f, u]) => headPoint(frame, 0, u, f));
  const lower = PROFILE_JAW.map(([f, u]) => {
    const p = jawPoint(f, u, jaw);
    return headPoint(frame, 0, p.y, p.x);
  });
  return [...skull, ...lower];
}

const HEAD_SHADE_SIZE = HEAD_RX * 1.4;

function headTrace(sk: Skeleton, pose: GremlinPose, view: GremlinView): Trace {
  const frame = headFrame(sk, view);
  return traceSmooth(
    view === 'side' ? profileOutline(frame, pose.jaw) : frontOutline(frame, pose.jaw),
  );
}

export function headForm(sk: Skeleton, pose: GremlinPose, view: GremlinView, lit: boolean): Form {
  const frame = headFrame(sk, view);
  return form(headTrace(sk, pose, view), HIDE, HEAD_SHADE_SIZE, (ctx) => {
    if (view === 'front') paintFrontFace(ctx, frame, pose, lit);
    else if (view === 'side') paintProfileFace(ctx, frame, pose, lit);
    else paintBackOfHead(ctx, frame);
  });
}

// ── Face ─────────────────────────────────────────────────────────────────────

export const EYE_ACROSS = 0.155;
export const EYE_UP = 0.075;
const EYE_RADIUS = 0.088;
/** How far forward of the head's centre the eyes sit, on the face's surface. */
export const EYE_DEPTH = faceDepth(EYE_ACROSS, EYE_UP);
const SOCKET_GROW = 1.2;
const PUPIL_HALF_WIDTH = 0.017;
const PUPIL_HALF_HEIGHT = 0.068;
const GLINT_RADIUS = 0.022;
const GLINT_OFFSET = 0.4;
const IRIS_RING_ALPHA = 0.55;
const BROW_LIFT = 0.1;
const BROW_HALF_SPAN = 0.11;
const BROW_THICKNESS = 0.045;
const BROW_SCOWL_DROP = 0.05;
const BROW_SHADE_ALPHA = 0.55;
const NOSTRIL_ACROSS = 0.045;
const NOSTRIL_UP = -0.015;
const NOSTRIL_RX = 0.016;
const NOSTRIL_RY = 0.01;
/** Squashed head-on eyes never close below this share, so a tipped head keeps its eyes. */
const EYE_MIN_SQUASH = 0.45;

function paintEye(
  ctx: Ctx,
  c: Pt,
  rx: number,
  ry: number,
  rotation: number,
  blink: number,
  pupilAngle: number,
): void {
  ctx.fillStyle = EYE_SOCKET;
  ctx.beginPath();
  traceEllipse(c, rx * SOCKET_GROW, ry * SOCKET_GROW, rotation)(ctx);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  traceEllipse(c, rx, ry, rotation)(ctx);
  ctx.clip();
  ctx.fillStyle = EYE_IRIS;
  ctx.fillRect(c.x - rx * 2, c.y - ry * 2, rx * 4, ry * 4);
  ctx.strokeStyle = rgba(EYE_IRIS_DEEP, IRIS_RING_ALPHA);
  ctx.lineWidth = rx * 0.5;
  ctx.beginPath();
  traceEllipse(c, rx, ry, rotation)(ctx);
  ctx.stroke();
  ctx.fillStyle = EYE_PUPIL;
  ctx.beginPath();
  traceEllipse(
    c,
    PUPIL_HALF_WIDTH * (rx / EYE_RADIUS),
    PUPIL_HALF_HEIGHT * (ry / EYE_RADIUS),
    pupilAngle,
  )(ctx);
  ctx.fill();
  ctx.fillStyle = EYE_GLINT;
  ctx.beginPath();
  ctx.arc(
    c.x - rx * GLINT_OFFSET,
    c.y - ry * GLINT_OFFSET,
    GLINT_RADIUS * Math.min(1, rx / EYE_RADIUS + 0.3),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (blink > 0) {
    const lidLine = c.y - ry + ry * 2 * clamp01(blink);
    ctx.fillStyle = HIDE.dark;
    ctx.fillRect(c.x - rx * 2, c.y - ry * 2, rx * 4, lidLine - (c.y - ry * 2));
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = LID_EDGE;
    ctx.beginPath();
    ctx.moveTo(c.x - rx * 2, lidLine);
    ctx.lineTo(c.x + rx * 2, lidLine);
    ctx.stroke();
  }
  ctx.restore();
}

const LID_EDGE = 0.014;

/** The mouth's line, corner to corner, as (right, up) on the face. */
const MOUTH_HALF = 0.34;
const MOUTH_CORNER_UP = 0.035;
const MOUTH_SAG = 0.025;
const MOUTH_STEPS = 12;
const UPPER_TEETH = 9;
const LOWER_TEETH = 7;
const TOOTH_LENGTH = 0.06;
const TOOTH_HALF_WIDTH = 0.014;
/** Below this gape the mouth is drawn shut, a line with a few fangs over it. */
const MOUTH_SHUT = 0.08;
const MOUTH_LINE_WIDTH = 0.038;
/** A mouth lit by the sac glows inside when it is charged. */
const THROAT_GLOW_ALPHA = 0.7;
/** A severed head's throat still glows, dimmer: the sac is emptying. */
const SEVERED_GLOW_SHARE = 0.6;

function mouthUpperU(r: number): number {
  const across = r / MOUTH_HALF;
  return MOUTH_U + MOUTH_CORNER_UP * across * across - MOUTH_SAG * (1 - across * across);
}

function paintTooth(ctx: Ctx, root: Pt, dir: Pt, length: number, width: number): void {
  const nx = -dir.y;
  const ny = dir.x;
  ctx.beginPath();
  ctx.moveTo(root.x + nx * width, root.y + ny * width);
  ctx.lineTo(root.x + dir.x * length, root.y + dir.y * length);
  ctx.lineTo(root.x - nx * width, root.y - ny * width);
  ctx.closePath();
  ctx.fillStyle = TOOTH;
  ctx.fill();
  ctx.strokeStyle = TOOTH_SHADE;
  ctx.lineWidth = TOOTH_EDGE;
  ctx.stroke();
}

const TOOTH_EDGE = 0.006;

function paintFrontFace(ctx: Ctx, frame: HeadFrame, pose: GremlinPose, lit: boolean): void {
  const squash = Math.max(EYE_MIN_SQUASH, Math.abs(frame.up.y));
  const rotation =
    Math.atan2(frame.rightUnit.y, frame.rightUnit.x) + (frame.view === 'front' ? Math.PI : 0);
  const pupilAngle = Math.atan2(frame.upUnit.y, frame.upUnit.x) + Math.PI / 2;

  // The brow overhangs the top of each eye, so it is painted over them.
  for (const side of [-1, 1]) {
    const eye = headPoint(frame, side * EYE_ACROSS, EYE_UP, EYE_DEPTH);
    paintEye(ctx, eye, EYE_RADIUS, EYE_RADIUS * squash, rotation, pose.blink, pupilAngle);
    const inner = headPoint(
      frame,
      side * (EYE_ACROSS - BROW_HALF_SPAN),
      EYE_UP + BROW_LIFT - pose.scowl * BROW_SCOWL_DROP,
      faceDepth(0, EYE_UP),
    );
    const outer = headPoint(
      frame,
      side * (EYE_ACROSS + BROW_HALF_SPAN),
      EYE_UP + BROW_LIFT,
      faceDepth(EYE_ACROSS, EYE_UP),
    );
    ctx.strokeStyle = rgba(HIDE.deep, BROW_SHADE_ALPHA + pose.scowl * (1 - BROW_SHADE_ALPHA));
    ctx.lineWidth = BROW_THICKNESS;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }

  ctx.fillStyle = NOSTRIL;
  for (const side of [-1, 1]) {
    const nostril = headPoint(frame, side * NOSTRIL_ACROSS, NOSTRIL_UP, faceDepth(0, NOSTRIL_UP));
    ctx.beginPath();
    traceEllipse(nostril, NOSTRIL_RX, NOSTRIL_RY * squash, rotation)(ctx);
    ctx.fill();
  }

  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= MOUTH_STEPS; i++) {
    const r = lerp(-MOUTH_HALF, MOUTH_HALF, i / MOUTH_STEPS);
    const u = mouthUpperU(r);
    upper.push(headPoint(frame, r, u, faceDepth(r, u)));
    // The jaw drops down the screen whatever the head's tilt: a head thrown
    // back to shriek foreshortens its face, never the gape.
    const drop = jawDropAt(r, pose.jaw);
    const lip = upper[upper.length - 1];
    lower.push(pt(lip.x - frame.upUnit.x * drop, lip.y - frame.upUnit.y * drop));
  }
  const toothDown = unit(pt(-frame.up.x, -frame.up.y), pt(0, 1));
  if (pose.jaw < MOUTH_SHUT) {
    ctx.strokeStyle = MOUTH_INSIDE;
    ctx.lineWidth = MOUTH_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    upper.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    paintShutFangs(ctx, upper, toothDown);
    return;
  }
  ctx.fillStyle = MOUTH_INSIDE;
  tracePath(ctx, [...upper, ...[...lower].reverse()]);
  ctx.fill();
  if (pose.sacGlow > 0) {
    const throat = pt(
      (upper[MOUTH_STEPS / 2].x + lower[MOUTH_STEPS / 2].x) / 2,
      lower[MOUTH_STEPS / 2].y,
    );
    ctx.save();
    tracePath(ctx, [...upper, ...[...lower].reverse()]);
    ctx.clip();
    glow(
      ctx,
      throat,
      MOUTH_HALF * 0.9,
      SAC_BRIGHT,
      pose.sacGlow * THROAT_GLOW_ALPHA * (lit ? 1 : SEVERED_GLOW_SHARE),
    );
    ctx.restore();
  }
  paintTeethRow(ctx, upper, toothDown, UPPER_TEETH, 1, pose.jaw);
  paintTeethRow(ctx, lower, pt(-toothDown.x, -toothDown.y), LOWER_TEETH, 2, pose.jaw);
}

function tracePath(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  tracePolygon(points)(ctx);
}

function pointAlong(points: readonly Pt[], t: number): Pt {
  const scaled = clamp01(t) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(scaled));
  const k = scaled - i;
  return pt(lerp(points[i].x, points[i + 1].x, k), lerp(points[i].y, points[i + 1].y, k));
}

/** Uneven on purpose: needle teeth crowded and gapped, no two the same length. */
const TOOTH_JITTER = 0.35;
const TOOTH_LENGTH_SPREAD = 0.55;

function paintTeethRow(
  ctx: Ctx,
  line: readonly Pt[],
  dir: Pt,
  count: number,
  seed: number,
  jaw: number,
): void {
  const open = clamp01(jaw * 2);
  for (let i = 0; i < count; i++) {
    const jitter = (hash1(seed * TOOTH_SEED_STRIDE + i) - 0.5) * TOOTH_JITTER;
    const t = (i + 0.5 + jitter) / count;
    const root = pointAlong(line, lerp(TOOTH_ROW_INSET, 1 - TOOTH_ROW_INSET, t));
    const length =
      TOOTH_LENGTH *
      (1 - TOOTH_LENGTH_SPREAD * hash1(seed * TOOTH_SEED_STRIDE + i + TOOTH_LENGTH_SEED)) *
      (0.6 + 0.4 * open);
    paintTooth(ctx, root, dir, length, TOOTH_HALF_WIDTH);
  }
}

const TOOTH_SEED_STRIDE = 31;
const TOOTH_LENGTH_SEED = 7;
const TOOTH_ROW_INSET = 0.06;
/** With the mouth shut only the longest fangs show, over the line. */
const SHUT_FANG_SHARES = [0.14, 0.3, 0.47, 0.63, 0.82] as const;
const SHUT_FANG_LENGTH = 0.055;

function paintShutFangs(ctx: Ctx, line: readonly Pt[], down: Pt): void {
  SHUT_FANG_SHARES.forEach((share, i) => {
    const root = pointAlong(line, share);
    const dir = i === 1 ? pt(-down.x, -down.y) : down;
    const base = pt(
      root.x - dir.x * MOUTH_LINE_WIDTH * 0.4,
      root.y - dir.y * MOUTH_LINE_WIDTH * 0.4,
    );
    paintTooth(ctx, base, dir, SHUT_FANG_LENGTH, TOOTH_HALF_WIDTH);
  });
}

// ── Profile face ─────────────────────────────────────────────────────────────

export const PROFILE_EYE: Pt = pt(0.2, 0.08);
const PROFILE_EYE_RX = 0.06;
const PROFILE_EYE_RY = 0.09;
const PROFILE_BROW_FROM: Pt = pt(0.15, 0.17);
const PROFILE_BROW_TO: Pt = pt(0.275, 0.14);
const PROFILE_NOSTRIL: Pt = pt(0.285, 0.0);
const PROFILE_MOUTH_FRONT: Pt = pt(0.3, -0.085);
const PROFILE_MOUTH_BACK: Pt = pt(-0.07, -0.06);
const PROFILE_MOUTH_STEPS = 10;
const PROFILE_UPPER_TEETH = 7;
const PROFILE_LOWER_TEETH = 6;

function paintProfileFace(ctx: Ctx, frame: HeadFrame, pose: GremlinPose, lit: boolean): void {
  const eye = headPoint(frame, 0, PROFILE_EYE.y, PROFILE_EYE.x);
  const rotation = Math.atan2(frame.forward.y, frame.forward.x);
  const pupilAngle = rotation + Math.PI / 2;
  paintEye(ctx, eye, PROFILE_EYE_RX, PROFILE_EYE_RY, rotation, pose.blink, pupilAngle);
  const browFrom = headPoint(frame, 0, PROFILE_BROW_FROM.y, PROFILE_BROW_FROM.x);
  const browTo = headPoint(
    frame,
    0,
    PROFILE_BROW_TO.y - pose.scowl * BROW_SCOWL_DROP,
    PROFILE_BROW_TO.x,
  );
  ctx.strokeStyle = rgba(HIDE.deep, BROW_SHADE_ALPHA + pose.scowl * (1 - BROW_SHADE_ALPHA));
  ctx.lineWidth = BROW_THICKNESS;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(browFrom.x, browFrom.y);
  ctx.lineTo(browTo.x, browTo.y);
  ctx.stroke();

  const nostril = headPoint(frame, 0, PROFILE_NOSTRIL.y, PROFILE_NOSTRIL.x);
  ctx.fillStyle = NOSTRIL;
  ctx.beginPath();
  traceEllipse(nostril, NOSTRIL_RX * 0.8, NOSTRIL_RY, rotation)(ctx);
  ctx.fill();

  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= PROFILE_MOUTH_STEPS; i++) {
    const t = i / PROFILE_MOUTH_STEPS;
    const f = lerp(PROFILE_MOUTH_FRONT.x, PROFILE_MOUTH_BACK.x, t);
    const u =
      lerp(PROFILE_MOUTH_FRONT.y, PROFILE_MOUTH_BACK.y, t) -
      Math.sin(t * Math.PI) * MOUTH_SAG * 0.5;
    upper.push(headPoint(frame, 0, u, f));
    const dropped = jawPoint(f, u, pose.jaw);
    lower.push(headPoint(frame, 0, dropped.y, dropped.x));
  }
  const toothDown = unit(pt(-frame.up.x, -frame.up.y), pt(0, 1));
  if (pose.jaw < MOUTH_SHUT) {
    ctx.strokeStyle = MOUTH_INSIDE;
    ctx.lineWidth = MOUTH_LINE_WIDTH;
    ctx.beginPath();
    upper.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    paintShutFangs(ctx, upper, toothDown);
    return;
  }
  ctx.fillStyle = MOUTH_INSIDE;
  tracePath(ctx, [...upper, ...[...lower].reverse()]);
  ctx.fill();
  if (pose.sacGlow > 0) {
    ctx.save();
    tracePath(ctx, [...upper, ...[...lower].reverse()]);
    ctx.clip();
    glow(
      ctx,
      lower[PROFILE_MOUTH_STEPS - 2],
      MOUTH_HALF,
      SAC_BRIGHT,
      pose.sacGlow * THROAT_GLOW_ALPHA * (lit ? 1 : SEVERED_GLOW_SHARE),
    );
    ctx.restore();
  }
  const lowerUp = unit(pt(lower[0].x - lower[1].x, lower[0].y - lower[1].y), pt(1, 0));
  paintTeethRow(
    ctx,
    upper.slice(0, PROFILE_MOUTH_STEPS - 1),
    toothDown,
    PROFILE_UPPER_TEETH,
    3,
    pose.jaw,
  );
  paintTeethRow(
    ctx,
    lower.slice(0, PROFILE_MOUTH_STEPS - 1),
    pt(-lowerUp.y, lowerUp.x).y < 0 ? pt(-lowerUp.y, lowerUp.x) : pt(lowerUp.y, -lowerUp.x),
    PROFILE_LOWER_TEETH,
    4,
    pose.jaw,
  );
}

const BACK_SCAR_ALPHA = 0.45;

function paintBackOfHead(ctx: Ctx, frame: HeadFrame): void {
  ctx.strokeStyle = rgba(HIDE.deep, BACK_SCAR_ALPHA);
  ctx.lineWidth = BROW_THICKNESS * 0.5;
  ctx.lineCap = 'round';
  const from = silhouettePoint(frame, -0.08, 0.12);
  const to = silhouettePoint(frame, 0.12, -0.02);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(from.x + 0.06, from.y + 0.02, to.x, to.y);
  ctx.stroke();
}

// ── Ears ─────────────────────────────────────────────────────────────────────

/**
 * A bat's ear laid flat, in (along, across) from its root: a long leading edge
 * over the top and a ragged trailing edge underneath, scalloped between the
 * ribs that hold it out. `along` runs outward; `across` is up.
 */
const EAR_TOP: readonly (readonly [number, number])[] = [
  [0.0, 0.13],
  [0.2, 0.19],
  [0.42, 0.19],
  [0.6, 0.14],
  [0.74, 0.06],
];
/** The figure's left ear has a bite torn out of its leading edge. */
const EAR_TOP_TORN: readonly (readonly [number, number])[] = [
  [0.0, 0.13],
  [0.2, 0.19],
  [0.34, 0.19],
  [0.45, -0.03],
  [0.56, 0.15],
  [0.6, 0.14],
  [0.74, 0.06],
];
const EAR_BOTTOM: readonly (readonly [number, number])[] = [
  [0.6, -0.03],
  [0.55, 0.02],
  [0.46, -0.09],
  [0.38, -0.03],
  [0.3, -0.13],
  [0.2, -0.06],
  [0.1, -0.14],
  [0.0, -0.1],
];
/** The ribs run from the root out to the scallops' points. */
const EAR_RIB_TIPS: readonly (readonly [number, number])[] = [
  [0.7, 0.06],
  [0.46, -0.09],
  [0.3, -0.13],
];
const EAR_ROOT_ACROSS = 0.33;
const EAR_ROOT_UP = 0.06;
const MEMBRANE_INSET = 0.72;
const MEMBRANE_SHIFT_ALONG = 0.05;
const EAR_RIB_WIDTH = 0.016;
const EAR_FOLD_SHORTEN = 0.35;
const EAR_FOLD_NARROW = 0.3;
const EAR_SHADE_SIZE = 0.3;
/** Edge-on, the ears sweep back and up from the back of the skull, foreshortened. */
const PROFILE_EAR_ROOT: Pt = pt(-0.13, 0.12);
const PROFILE_EAR_RISE = 0.12;
const PROFILE_EAR_FOLLOWS_HEAD = 0.3;
const PROFILE_EAR_LENGTH = 1.0;
const PROFILE_FAR_EAR_ROOT: Pt = pt(-0.1, 0.1);
const PROFILE_FAR_EAR_RISE = -0.2;
const PROFILE_FAR_EAR_LENGTH = 1.1;

interface EarAxes {
  readonly root: Pt;
  readonly along: Pt;
  readonly across: Pt;
  readonly length: number;
}

/** Which ear, by the figure's own side: −1 its left (the torn one), +1 its right. */
type EarSide = -1 | 1;

function earAxes(frame: HeadFrame, side: EarSide, ear: EarPose, near: boolean): EarAxes {
  const lift = ear.lift;
  const shorten = 1 - ear.fold * EAR_FOLD_SHORTEN;
  if (frame.view === 'side') {
    const rootAt = near ? PROFILE_EAR_ROOT : PROFILE_FAR_EAR_ROOT;
    const rise = (near ? PROFILE_EAR_RISE : PROFILE_FAR_EAR_RISE) + (lift - EAR_REST_LIFT);
    const reach = (near ? PROFILE_EAR_LENGTH : PROFILE_FAR_EAR_LENGTH) * shorten;
    // Edge-on the ears are laid back from the screen's level, taking only a
    // share of the head's tilt: following it whole, a head bowed in the crouch
    // stands them straight up, and an upright ear in profile is a rat's.
    const headTilt = Math.atan2(frame.forward.y, frame.forward.x) * PROFILE_EAR_FOLLOWS_HEAD;
    const back = pt(-Math.cos(headTilt), -Math.sin(headTilt));
    const up = pt(Math.sin(headTilt), -Math.cos(headTilt));
    const along = pt(
      back.x * Math.cos(rise) + up.x * Math.sin(rise),
      back.y * Math.cos(rise) + up.y * Math.sin(rise),
    );
    const across = pt(
      up.x * Math.cos(rise) - back.x * Math.sin(rise),
      up.y * Math.cos(rise) - back.y * Math.sin(rise),
    );
    return { root: headPoint(frame, 0, rootAt.y, rootAt.x), along, across, length: reach };
  }
  const outward = pt(frame.rightUnit.x * side, frame.rightUnit.y * side);
  const up = frame.upUnit;
  const along = pt(
    outward.x * Math.cos(lift) + up.x * Math.sin(lift),
    outward.y * Math.cos(lift) + up.y * Math.sin(lift),
  );
  const across = pt(
    up.x * Math.cos(lift) - outward.x * Math.sin(lift),
    up.y * Math.cos(lift) - outward.y * Math.sin(lift),
  );
  const root = silhouettePoint(frame, side * EAR_ROOT_ACROSS, EAR_ROOT_UP);
  return { root, along, across, length: shorten };
}

function earPoint(axes: EarAxes, along: number, across: number, narrow: number): Pt {
  return pt(
    axes.root.x + axes.along.x * along * axes.length + axes.across.x * across * narrow,
    axes.root.y + axes.along.y * along * axes.length + axes.across.y * across * narrow,
  );
}

function earOutline(frame: HeadFrame, side: EarSide, ear: EarPose, near: boolean): Pt[] {
  const axes = earAxes(frame, side, ear, near);
  const narrow = 1 - ear.fold * EAR_FOLD_NARROW;
  const top = side === -1 ? EAR_TOP_TORN : EAR_TOP;
  return [...top, ...EAR_BOTTOM].map(([a, c]) => earPoint(axes, a, c, narrow));
}

/**
 * One ear as a form. Head-on its front shows the membrane and the ribs; from
 * behind it shows the hide of its back, ribs standing up as ridges.
 */
export function earForm(
  frame: HeadFrame,
  side: EarSide,
  ear: EarPose,
  near: boolean,
  ramp: Ramp,
): Form {
  const axes = earAxes(frame, side, ear, near);
  const narrow = 1 - ear.fold * EAR_FOLD_NARROW;
  const outline = earOutline(frame, side, ear, near);
  const showsMembrane = frame.view !== 'back';
  return form(tracePolygon(outline), ramp, EAR_SHADE_SIZE, (ctx) => {
    if (showsMembrane) {
      const inner = outline.map((p) => {
        const anchor = earPoint(axes, MEMBRANE_SHIFT_ALONG, 0, narrow);
        return pt(lerp(anchor.x, p.x, MEMBRANE_INSET), lerp(anchor.y, p.y, MEMBRANE_INSET));
      });
      ctx.fillStyle = near ? EAR_MEMBRANE.mid : EAR_MEMBRANE.dark;
      ctx.beginPath();
      tracePolygon(inner)(ctx);
      ctx.fill();
      ctx.fillStyle = rgba(EAR_MEMBRANE.light, near ? EAR_MEMBRANE_LIGHT_ALPHA : 0);
      ctx.beginPath();
      tracePolygon(
        inner.map((p) =>
          pt(p.x - axes.across.x * EAR_LIGHT_SHIFT, p.y - axes.across.y * EAR_LIGHT_SHIFT),
        ),
      )(ctx);
      ctx.fill();
    }
    ctx.strokeStyle = showsMembrane ? EAR_RIB : rgba(HIDE.deep, EAR_BACK_RIB_ALPHA);
    ctx.lineWidth = EAR_RIB_WIDTH;
    ctx.lineCap = 'round';
    for (const [a, c] of EAR_RIB_TIPS) {
      const from = earPoint(axes, 0.03, 0, narrow);
      const to = earPoint(axes, a * 0.95, c * 0.9, narrow);
      const bend = earPoint(axes, a * 0.5, c * 0.35 + 0.03, narrow);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(bend.x, bend.y, to.x, to.y);
      ctx.stroke();
    }
  });
}

const EAR_MEMBRANE_LIGHT_ALPHA = 0.5;
const EAR_LIGHT_SHIFT = -0.03;
const EAR_BACK_RIB_ALPHA = 0.6;

// ── Crown ────────────────────────────────────────────────────────────────────

/**
 * A crown bent out of a can: a short brass band sitting lopsided on the flat
 * crown of the skull, its points the ring-pulls of other cans pushed into the
 * rim. Points are what a crown is at 32 px, so they are tall and few.
 */
const CROWN_HALF_WIDTH = 0.15;
const CROWN_HEIGHT = 0.12;
const CROWN_ACROSS = 0.05;
const CROWN_SEAT = HEAD_RY * 0.9;
const CROWN_TILT = 0.24;
const CROWN_RIM_RY = 0.032;
/** Each ring-pull: where along the rim, how tall, and how far it leans. */
const CROWN_POINTS: readonly {
  readonly at: number;
  readonly height: number;
  readonly lean: number;
}[] = [
  { at: -0.8, height: 0.085, lean: -0.25 },
  { at: -0.27, height: 0.11, lean: -0.05 },
  { at: 0.27, height: 0.1, lean: 0.08 },
  { at: 0.8, height: 0.07, lean: 0.35 },
];
const RING_RADIUS = 0.032;
const RING_HOLE = 0.016;
const TAB_HALF_WIDTH = 0.024;
const CROWN_DENT_ALPHA = 0.55;

interface CrownAxes {
  readonly base: Pt;
  readonly up: Pt;
  readonly across: Pt;
}

function crownAxes(frame: HeadFrame): CrownAxes {
  const seat =
    frame.view === 'side'
      ? headPoint(frame, 0, CROWN_SEAT, CROWN_ACROSS)
      : silhouettePoint(frame, CROWN_ACROSS, CROWN_SEAT);
  const baseUp = frame.view === 'side' ? unit(frame.up, pt(0, -1)) : frame.upUnit;
  const tilt = frame.view === 'front' ? -CROWN_TILT : CROWN_TILT;
  const up = pt(
    baseUp.x * Math.cos(tilt) - baseUp.y * Math.sin(tilt),
    baseUp.x * Math.sin(tilt) + baseUp.y * Math.cos(tilt),
  );
  const across = pt(-up.y, up.x);
  return { base: seat, up, across };
}

function crownPoint(axes: CrownAxes, across: number, up: number): Pt {
  return pt(
    axes.base.x + axes.across.x * across + axes.up.x * up,
    axes.base.y + axes.across.y * across + axes.up.y * up,
  );
}

export function crownForms(frame: HeadFrame): Form[] {
  const axes = crownAxes(frame);
  const forms: Form[] = [];
  for (const point of CROWN_POINTS) {
    const tip = crownPoint(
      axes,
      point.at * CROWN_HALF_WIDTH + point.lean * point.height,
      CROWN_HEIGHT + point.height,
    );
    const tab = tracePolygon([
      crownPoint(axes, point.at * CROWN_HALF_WIDTH - TAB_HALF_WIDTH, CROWN_HEIGHT * 0.8),
      pt(
        tip.x - axes.across.x * TAB_HALF_WIDTH * 0.6,
        tip.y - axes.across.y * TAB_HALF_WIDTH * 0.6,
      ),
      pt(
        tip.x + axes.across.x * TAB_HALF_WIDTH * 0.6,
        tip.y + axes.across.y * TAB_HALF_WIDTH * 0.6,
      ),
      crownPoint(axes, point.at * CROWN_HALF_WIDTH + TAB_HALF_WIDTH, CROWN_HEIGHT * 0.8),
    ]);
    forms.push(form(tab, TIN, TAB_HALF_WIDTH * 2));
    forms.push(
      form(traceEllipse(tip, RING_RADIUS, RING_RADIUS), TIN, RING_RADIUS * 2, (ctx) => {
        ctx.fillStyle = OUTLINE;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, RING_HOLE, 0, Math.PI * 2);
        ctx.fill();
      }),
    );
  }
  const band = traceSmooth([
    crownPoint(axes, -CROWN_HALF_WIDTH, -CROWN_RIM_RY * 0.2),
    crownPoint(axes, 0, -CROWN_RIM_RY),
    crownPoint(axes, CROWN_HALF_WIDTH, -CROWN_RIM_RY * 0.2),
    crownPoint(axes, CROWN_HALF_WIDTH * 1.04, CROWN_HEIGHT * 0.5),
    crownPoint(axes, CROWN_HALF_WIDTH, CROWN_HEIGHT),
    crownPoint(axes, 0, CROWN_HEIGHT - CROWN_RIM_RY * 0.6),
    crownPoint(axes, -CROWN_HALF_WIDTH, CROWN_HEIGHT * 1.05),
    crownPoint(axes, -CROWN_HALF_WIDTH * 1.04, CROWN_HEIGHT * 0.5),
  ]);
  forms.push(
    form(band, BRASS, CROWN_HALF_WIDTH * 1.2, (ctx) => {
      const dentFrom = crownPoint(axes, CROWN_HALF_WIDTH * 0.15, CROWN_HEIGHT * 0.95);
      const dentTo = crownPoint(axes, CROWN_HALF_WIDTH * 0.45, CROWN_HEIGHT * 0.1);
      ctx.strokeStyle = rgba(BRASS.deep, CROWN_DENT_ALPHA);
      ctx.lineWidth = CROWN_DENT_WIDTH;
      ctx.beginPath();
      ctx.moveTo(dentFrom.x, dentFrom.y);
      ctx.lineTo(dentTo.x, dentTo.y);
      ctx.stroke();
      const labelFrom = crownPoint(axes, -CROWN_HALF_WIDTH * 1.1, CROWN_LABEL_AT);
      const labelTo = crownPoint(axes, CROWN_HALF_WIDTH * 1.1, CROWN_LABEL_AT);
      ctx.strokeStyle = TIN_LABEL;
      ctx.lineWidth = CROWN_LABEL_WIDTH;
      ctx.beginPath();
      ctx.moveTo(labelFrom.x, labelFrom.y);
      ctx.lineTo(labelTo.x, labelTo.y);
      ctx.stroke();
      ctx.lineWidth = CROWN_DENT_WIDTH;
      const rimFrom = crownPoint(axes, -CROWN_HALF_WIDTH, CROWN_HEIGHT * 0.78);
      const rimTo = crownPoint(axes, CROWN_HALF_WIDTH, CROWN_HEIGHT * 0.78);
      ctx.strokeStyle = rgba(BRASS.light, CROWN_RIM_ALPHA);
      ctx.beginPath();
      ctx.moveTo(rimFrom.x, rimFrom.y);
      ctx.lineTo(rimTo.x, rimTo.y);
      ctx.stroke();
    }),
  );
  return forms;
}

const CROWN_DENT_WIDTH = 0.014;
/** The can's own label, a band round its middle: what says it was a can. */
const CROWN_LABEL_AT = CROWN_HEIGHT * 0.4;
const CROWN_LABEL_WIDTH = 0.035;
const CROWN_RIM_ALPHA = 0.7;

// ── Throat sac ───────────────────────────────────────────────────────────────

const SAC_RX = 0.15;
const SAC_RY = 0.09;
const SAC_SWELL_RX = 0.1;
const SAC_HANG = 0.4;
const SAC_SWELL_RY = 0.1;
const SAC_BELOW = HEAD_RY * 1.05;
/**
 * Edge-on the sac is slung from the jaw's underside and overlaps it, so it
 * reads as part of the throat; hung below the jaw it floats like a medallion.
 */
const SAC_TUCK_UNDER_JAW = 0.35;
const SAC_FORWARD = 0.17;
const SAC_PROFILE_FORWARD = 0.1;
const SAC_ALPHA = 0.62;
const SAC_GLOW_ALPHA = 0.3;
const SAC_CORE_SHARE = 0.55;
const SAC_HALO = 2.3;
const SAC_HALO_ALPHA = 0.45;
const SAC_EDGE = 0.018;
const SAC_VEIN_WIDTH = 0.01;
const SAC_VEIN_ALPHA = 0.55;
/** How far the sac hangs with the jaw: it is slung from it. */
const SAC_FOLLOWS_JAW = 0.7;

interface SacPlacement {
  readonly c: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
}

function sacPlacement(frame: HeadFrame, pose: GremlinPose): SacPlacement {
  const rx = SAC_RX + SAC_SWELL_RX * pose.sac;
  const ry = SAC_RY + SAC_SWELL_RY * pose.sac;
  if (frame.view === 'side') {
    const jawUnder = jawPoint(SAC_PROFILE_FORWARD, -SAC_BELOW, pose.jaw);
    const c = headPoint(frame, 0, jawUnder.y + ry * SAC_TUCK_UNDER_JAW, jawUnder.x);
    return { c, rx, ry, rotation: Math.atan2(frame.forward.y, frame.forward.x) };
  }
  const drop = jawDropAt(0, pose.jaw) * SAC_FOLLOWS_JAW;
  // It swells up into the jaw as much as down onto the chest: grown from its
  // top edge it sinks onto the sternum and reads as a lamp worn on the chest.
  const c = headPoint(frame, 0, -SAC_BELOW - drop - SAC_RY * SAC_HANG, SAC_FORWARD);
  return { c, rx, ry, rotation: Math.atan2(frame.rightUnit.y, frame.rightUnit.x) };
}

/** The sac's glow on whatever is around it, laid before the sac itself. */
export function paintSacHalo(ctx: Ctx, frame: HeadFrame, pose: GremlinPose): void {
  const sac = sacPlacement(frame, pose);
  glow(ctx, sac.c, Math.max(sac.rx, sac.ry) * SAC_HALO, SAC_BRIGHT, pose.sacGlow * SAC_HALO_ALPHA);
}

/** The sac: translucent, lit from inside, its veins showing. */
export function paintSac(ctx: Ctx, frame: HeadFrame, pose: GremlinPose): void {
  const sac = sacPlacement(frame, pose);
  const glowAmount = clamp01(pose.sacGlow);
  const trace = traceEllipse(sac.c, sac.rx, sac.ry, sac.rotation);
  ctx.save();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  traceEllipse(sac.c, sac.rx + SAC_EDGE, sac.ry + SAC_EDGE, sac.rotation)(ctx);
  ctx.fill();
  ctx.fillStyle = rgba(SAC_DARK, 1);
  ctx.beginPath();
  trace(ctx);
  ctx.fill();
  ctx.fillStyle = rgba(SAC_MID, SAC_ALPHA + glowAmount * (1 - SAC_ALPHA));
  ctx.beginPath();
  traceEllipse(
    pt(sac.c.x, sac.c.y - sac.ry * 0.12),
    sac.rx * 0.88,
    sac.ry * 0.8,
    sac.rotation,
  )(ctx);
  ctx.fill();
  ctx.fillStyle = rgba(SAC_BRIGHT, SAC_GLOW_ALPHA + glowAmount * (1 - SAC_GLOW_ALPHA));
  ctx.beginPath();
  traceEllipse(
    pt(sac.c.x, sac.c.y + sac.ry * 0.1),
    sac.rx * SAC_CORE_SHARE,
    sac.ry * SAC_CORE_SHARE,
    sac.rotation,
  )(ctx);
  ctx.fill();
  ctx.beginPath();
  trace(ctx);
  ctx.clip();
  ctx.strokeStyle = rgba(SAC_VEIN, SAC_VEIN_ALPHA);
  ctx.lineWidth = SAC_VEIN_WIDTH;
  for (const k of [-0.55, 0.05, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(sac.c.x + sac.rx * k * 0.6, sac.c.y - sac.ry);
    ctx.quadraticCurveTo(
      sac.c.x + sac.rx * (k + 0.2),
      sac.c.y,
      sac.c.x + sac.rx * k,
      sac.c.y + sac.ry,
    );
    ctx.stroke();
  }
  ctx.fillStyle = rgba(SAC_CORE, glowAmount);
  ctx.beginPath();
  ctx.arc(
    sac.c.x - sac.rx * 0.35,
    sac.c.y - sac.ry * 0.35,
    Math.min(sac.rx, sac.ry) * 0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

// ── Spray ────────────────────────────────────────────────────────────────────

/** Edge-on the spray is thrown forward and down out of the mouth. */
const SPRAY_LENGTH = 0.7;
const SPRAY_DIP = 0.45;
const SPRAY_GAPE_SHARE_PROFILE = 0.4;
const SPRAY_GAPE_SHARE_FACING = 0.5;
const SPRAY_ROOT_HALF = 0.04;
const SPRAY_TIP_HALF = 0.12;
const SPRAY_GOBS = 5;
const SPRAY_GOB_RADIUS = 0.045;
const SPRAY_ALPHA = 0.92;

/**
 * Head-on the spray comes straight at the camera, so it is a burst: a ragged
 * splash in front of the mouth with gobs flying out of it. Drawn as a jet it
 * runs down the chest and reads as drool.
 */
const BURST_RADIUS = 0.2;
const BURST_LOBES = 9;
const BURST_RAGGED = 0.35;
const BURST_BELOW_MOUTH = 0.06;
const BURST_CORE_SHARE = 0.5;
const BURST_GOBS = 7;
const BURST_GOB_REACH = 1.7;
const BURST_GOB_SPREAD = 0.6;
const BURST_SEED = 29;

function paintSprayBurst(ctx: Ctx, mouth: Pt, amount: number): void {
  const c = pt(mouth.x, mouth.y + BURST_BELOW_MOUTH * amount);
  const radius = BURST_RADIUS * amount;
  const outline: Pt[] = [];
  for (let i = 0; i < BURST_LOBES * 2; i++) {
    const angle = (i / (BURST_LOBES * 2)) * Math.PI * 2;
    const reach = i % 2 === 0 ? 1 : 1 - BURST_RAGGED * (HALF + hash1(i + BURST_SEED) * HALF);
    outline.push(
      pt(c.x + Math.cos(angle) * radius * reach, c.y + Math.sin(angle) * radius * reach),
    );
  }
  const splash = traceSmooth(outline);
  ctx.fillStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
  ctx.strokeStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
  ctx.lineWidth = SAC_EDGE * 2;
  ctx.beginPath();
  splash(ctx);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgba(SPRAY_MID, SPRAY_ALPHA);
  ctx.beginPath();
  splash(ctx);
  ctx.fill();
  ctx.fillStyle = rgba(SPRAY_BRIGHT, SPRAY_ALPHA);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius * BURST_CORE_SHARE, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < BURST_GOBS; i++) {
    const angle = (i / BURST_GOBS) * Math.PI * 2 + hash1(i + BURST_SEED * 2) * BURST_GOB_SPREAD;
    const reach = radius * (BURST_GOB_REACH - hash1(i + BURST_SEED * 3) * BURST_GOB_SPREAD);
    const gob = pt(c.x + Math.cos(angle) * reach, c.y + Math.sin(angle) * reach);
    const gobRadius = SPRAY_GOB_RADIUS * amount * (HALF + hash1(i + BURST_SEED * 4) * HALF);
    ctx.fillStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
    ctx.beginPath();
    ctx.arc(gob.x, gob.y, gobRadius + SAC_EDGE, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(SPRAY_MID, SPRAY_ALPHA);
    ctx.beginPath();
    ctx.arc(gob.x, gob.y, gobRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

const HALF = 0.5;

export function paintSpray(ctx: Ctx, frame: HeadFrame, pose: GremlinPose): void {
  const amount = clamp01(pose.spew);
  if (amount <= 0 || frame.view === 'back') return;
  // The spray leaves from between the lips, partway down the gape.
  const mouth =
    frame.view === 'side'
      ? headPoint(
          frame,
          0,
          PROFILE_MOUTH_FRONT.y - JAW_DROP * pose.jaw * SPRAY_GAPE_SHARE_PROFILE,
          PROFILE_MOUTH_FRONT.x,
        )
      : headPoint(
          frame,
          0,
          MOUTH_U - jawDropAt(0, pose.jaw) * SPRAY_GAPE_SHARE_FACING,
          faceDepth(0, MOUTH_U),
        );
  if (frame.view === 'front') {
    ctx.save();
    paintSprayBurst(ctx, mouth, amount);
    ctx.restore();
    return;
  }
  const forward = unit(frame.forward, pt(1, 0));
  const dipped = pt(
    forward.x * Math.cos(SPRAY_DIP) - forward.y * Math.sin(SPRAY_DIP),
    forward.x * Math.sin(SPRAY_DIP) + forward.y * Math.cos(SPRAY_DIP),
  );
  const dir = unit(dipped, pt(1, 0));
  const length = SPRAY_LENGTH * amount;
  const tipHalf = SPRAY_TIP_HALF;
  const n = pt(-dir.y, dir.x);
  const tip = pt(mouth.x + dir.x * length, mouth.y + dir.y * length);
  const jet = traceSmooth([
    pt(mouth.x + n.x * SPRAY_ROOT_HALF, mouth.y + n.y * SPRAY_ROOT_HALF),
    pt(
      mouth.x + dir.x * length * 0.55 + n.x * tipHalf * 0.8,
      mouth.y + dir.y * length * 0.55 + n.y * tipHalf * 0.8,
    ),
    pt(tip.x + n.x * tipHalf, tip.y + n.y * tipHalf),
    pt(tip.x + dir.x * tipHalf * 0.6, tip.y + dir.y * tipHalf * 0.6),
    pt(tip.x - n.x * tipHalf, tip.y - n.y * tipHalf),
    pt(
      mouth.x + dir.x * length * 0.55 - n.x * tipHalf * 0.8,
      mouth.y + dir.y * length * 0.55 - n.y * tipHalf * 0.8,
    ),
    pt(mouth.x - n.x * SPRAY_ROOT_HALF, mouth.y - n.y * SPRAY_ROOT_HALF),
  ]);
  ctx.save();
  ctx.fillStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
  ctx.strokeStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
  ctx.lineWidth = SAC_EDGE * 2;
  ctx.beginPath();
  jet(ctx);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgba(SPRAY_MID, SPRAY_ALPHA);
  ctx.beginPath();
  jet(ctx);
  ctx.fill();
  ctx.fillStyle = rgba(SPRAY_BRIGHT, SPRAY_ALPHA);
  ctx.beginPath();
  traceEllipse(
    pt(
      mouth.x + dir.x * length * 0.5 - n.x * tipHalf * 0.2,
      mouth.y + dir.y * length * 0.5 - n.y * tipHalf * 0.2,
    ),
    length * 0.3,
    tipHalf * 0.35,
    Math.atan2(dir.y, dir.x),
  )(ctx);
  ctx.fill();
  for (let i = 0; i < SPRAY_GOBS; i++) {
    const t = 0.75 + hash1(i + SPRAY_GOB_SEED) * 0.45;
    const sideways = (hash1(i + SPRAY_GOB_SEED * 2) - 0.5) * tipHalf * 3.2;
    const c = pt(
      mouth.x + dir.x * length * t + n.x * sideways,
      mouth.y + dir.y * length * t + n.y * sideways,
    );
    const radius = SPRAY_GOB_RADIUS * (0.5 + hash1(i + SPRAY_GOB_SEED * 3) * 0.7) * amount;
    ctx.fillStyle = rgba(SPRAY_DARK, SPRAY_ALPHA);
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius + SAC_EDGE, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(SPRAY_MID, SPRAY_ALPHA);
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const SPRAY_GOB_SEED = 13;
