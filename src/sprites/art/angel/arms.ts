/**
 * Angel's arms and hands.
 *
 * An arm is an outline offset from shoulder, elbow and wrist: the deltoid caps
 * the shoulder and is the arm's widest point, the upper arm narrows to a slim
 * elbow, the forearm swells again just below it and tapers to a wrist barely
 * half the forearm's width. Hung beside a woman's wide hips the forearm angles
 * out from the elbow — the carrying angle the skeleton already solves for.
 *
 * Relaxed, the fingers lie together and curl a little; open, they fan with the
 * thumb set off to the side; on the pole they close into a fist round it.
 */

import { fillSoftEllipse } from '../softShade';
import { mix } from '../bipedArt';
import {
  fillCrescent,
  limbOutline,
  midpoint,
  angleOf,
  traceSmooth,
  type Ctx,
  type WidthKey,
} from './paint';
import {
  NAIL_COLOR,
  NAIL_SHEEN,
  SKIN_BASE,
  SKIN_HALF,
  SKIN_HIGHLIGHT,
  SKIN_LIT,
  SKIN_SHADE,
} from './palette';
import { project, type AngelArm, type BodySide, type Pt2 } from './skeleton';
import type { LimbPaint } from './legs';

/** The deltoid rounds up over the shoulder joint before the arm runs down. */
const SHOULDER_CAP_RISE = 0.014;
/** An arm raised straight overhead leaves no direction to cap from. */
const MIN_CAP_DIRECTION = 0.05;

const UPPER_OUTER: ReadonlyArray<WidthKey> = [
  [0, 0.017],
  [0.07, 0.028],
  [0.17, 0.031],
  [0.3, 0.029],
  [0.55, 0.023],
  [0.8, 0.02],
  [0.98, 0.016],
];
const UPPER_INNER: ReadonlyArray<WidthKey> = [
  [0, 0.004],
  [0.1, 0.016],
  [0.22, 0.019],
  [0.5, 0.02],
  [0.78, 0.017],
  [0.98, 0.015],
];
const FORE_OUTER: ReadonlyArray<WidthKey> = [
  [0.06, 0.0165],
  [0.26, 0.0192],
  [0.6, 0.0135],
  [0.96, 0.0105],
];
const FORE_INNER: ReadonlyArray<WidthKey> = [
  [0.06, 0.0152],
  [0.32, 0.0172],
  [0.66, 0.012],
  [0.96, 0.0098],
];
/** In profile the biceps swell forward and the triceps back; the forearm's flexors bulge in front just below the elbow. */
const SIDE_UPPER_FRONT: ReadonlyArray<WidthKey> = [
  [0, 0.026],
  [0.15, 0.028],
  [0.45, 0.023],
  [0.75, 0.02],
  [0.98, 0.016],
];
const SIDE_UPPER_BACK: ReadonlyArray<WidthKey> = [
  [0, 0.024],
  [0.2, 0.025],
  [0.5, 0.023],
  [0.8, 0.018],
  [0.98, 0.016],
];
const SIDE_FORE_FRONT: ReadonlyArray<WidthKey> = [
  [0.06, 0.018],
  [0.25, 0.0185],
  [0.65, 0.0125],
  [0.96, 0.0098],
];
const SIDE_FORE_BACK: ReadonlyArray<WidthKey> = [
  [0.06, 0.015],
  [0.3, 0.0155],
  [0.7, 0.012],
  [0.96, 0.0098],
];

const ARM_CORE_SLIDE_X = 0.01;
const ARM_CORE_SLIDE_Y = -0.003;
const ARM_CORE_ALPHA = 0.65;
const ARM_TURN_SLIDE_X = 0.014;
const ARM_TURN_ALPHA = 0.9;
const DELTOID_LIGHT_SHARE = 0.18;
/** The arm's lights sit a little toward the lit side of its axis. */
const ARM_LIGHT_OFFSET = 0.006;
const FOREARM_LIGHT_OFFSET_SHARE = 0.5;
const DELTOID_LIGHT_RADIUS_X = 0.016;
const DELTOID_LIGHT_RADIUS_Y = 0.022;
const DELTOID_LIGHT_ALPHA = 0.85;
const FOREARM_LIGHT_SHARE = 0.3;
const FOREARM_LIGHT_RADIUS_X = 0.01;
const FOREARM_LIGHT_RADIUS_Y = 0.03;
const FOREARM_LIGHT_ALPHA = 0.6;
const FAR_ARM_SHADE_ALPHA = 0.5;
const DEGENERATE_LENGTH = 1e-6;
const HAND_SLIDE_SHARE = 0.7;

/* ── Hands ─────────────────────────────────────────────────────────────── */

/**
 * The relaxed hand, authored along its own axis: (share of the hand's length
 * from the wrist, offset across in figure units). Positive offsets are the
 * palm side, the side the fingers curl toward and the thumb lies along — toward
 * her body head-on, forward in profile. The back of the hand runs straight
 * from the wrist over the knuckles; the fingers taper together to the tips.
 */
const HAND_BACK_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0, -0.0092],
  [0.18, -0.0114],
  [0.42, -0.0121],
  [0.6, -0.0108],
  [0.8, -0.0084],
  [0.95, -0.005],
  [1, -0.0015],
];
const HAND_PALM_EDGE: ReadonlyArray<readonly [number, number]> = [
  [1, 0.0018],
  [0.94, 0.0052],
  [0.78, 0.0078],
  [0.58, 0.0094],
  [0.42, 0.0108],
  [0.22, 0.011],
  [0, 0.0088],
];
const THUMB_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0.06, 0.0084],
  [0.28, 0.0146],
  [0.45, 0.0146],
  [0.52, 0.0118],
  [0.34, 0.0086],
];
/** Her hands are authored narrow; this keeps them in proportion to their length. */
const HAND_BREADTH_SCALE = 1.1;
/** Where the fingers leave the palm and bend. */
const KNUCKLE_SHARE = 0.5;
/** Relaxed, the fingers curl a little toward the palm. */
const RELAXED_CURL = 0.32;
/** The nail of the fingertip nearest the camera, as (share along, offset across). */
const RELAXED_NAIL_ROOT: readonly [number, number] = [0.93, -0.002];
const NAIL_LENGTH = 0.0075;
const NAIL_HALF_WIDTH = 0.0026;
const NAIL_SHEEN_SHARE = 0.45;
/** Past this, a hand is drawn open. */
const OPEN_HAND_THRESHOLD = 0.5;

function armPoints(
  lp: Pick<LimbPaint, 'view'>,
  arm: AngelArm,
): { shoulder: Pt2; elbow: Pt2; wrist: Pt2; tip: Pt2 } {
  return {
    shoulder: project(lp.view, arm.shoulder),
    elbow: project(lp.view, arm.elbow),
    wrist: project(lp.view, arm.wrist),
    tip: project(lp.view, arm.fingertip),
  };
}

function armOutline(lp: LimbPaint, side: BodySide, arm: AngelArm): Pt2[] {
  const { shoulder, elbow, wrist } = armPoints(lp, arm);
  const upperLength = Math.max(
    Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y),
    DEGENERATE_LENGTH,
  );
  // The deltoid caps the joint from above whatever the arm does. Run straight
  // back up the bone, a raised arm's cap would drop below the shoulder and
  // swell out of the armpit.
  const capX = -(elbow.x - shoulder.x) / upperLength;
  const capY = -(elbow.y - shoulder.y) / upperLength - 1;
  const capLength = Math.hypot(capX, capY);
  const capReach = capLength > MIN_CAP_DIRECTION ? SHOULDER_CAP_RISE / capLength : 0;
  const cap = { x: shoulder.x + capX * capReach, y: shoulder.y + capY * capReach };
  if (lp.view === 'side') {
    return limbOutline(
      [
        { from: cap, to: elbow, outer: SIDE_UPPER_FRONT, inner: SIDE_UPPER_BACK },
        { from: elbow, to: wrist, outer: SIDE_FORE_FRONT, inner: SIDE_FORE_BACK },
      ],
      -1,
    );
  }
  return limbOutline(
    [
      { from: cap, to: elbow, outer: UPPER_OUTER, inner: UPPER_INNER },
      { from: elbow, to: wrist, outer: FORE_OUTER, inner: FORE_INNER },
    ],
    -side,
  );
}

function rotate(v: Pt2, angle: number): Pt2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

interface HandFrame {
  /** Places an authored (share, offset) point; past the knuckles the fingers turn through `curl`. */
  at(share: number, offset: number, curl: number): Pt2;
  /** The direction the fingertips point, after the curl. */
  fingerAngle(curl: number): number;
}

function handFrame(wrist: Pt2, tip: Pt2, palmSign: number): HandFrame {
  const length = Math.max(Math.hypot(tip.x - wrist.x, tip.y - wrist.y), DEGENERATE_LENGTH);
  const dir = { x: (tip.x - wrist.x) / length, y: (tip.y - wrist.y) / length };
  const palm = { x: -dir.y * palmSign, y: dir.x * palmSign };
  const knuckle = {
    x: wrist.x + dir.x * length * KNUCKLE_SHARE,
    y: wrist.y + dir.y * length * KNUCKLE_SHARE,
  };
  // Turning from `dir` toward `palm` is a rotation of +palmSign in screen space.
  return {
    at(share, offset, curl) {
      const local = { x: length * share, y: offset * HAND_BREADTH_SCALE };
      if (share <= KNUCKLE_SHARE) {
        return {
          x: wrist.x + dir.x * local.x + palm.x * local.y,
          y: wrist.y + dir.y * local.x + palm.y * local.y,
        };
      }
      const past = rotate({ x: local.x - length * KNUCKLE_SHARE, y: local.y }, curl);
      return {
        x: knuckle.x + dir.x * past.x + palm.x * past.y,
        y: knuckle.y + dir.y * past.x + palm.y * past.y,
      };
    },
    fingerAngle(curl) {
      return Math.atan2(dir.y, dir.x) + curl * palmSign;
    },
  };
}

/** A natural nail lying along the finger, back from its tip: a lit oval with a glint. */
function drawNail(ctx: Ctx, tip: Pt2, angle: number): void {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const centre = { x: tip.x - (dir.x * NAIL_LENGTH) / 2, y: tip.y - (dir.y * NAIL_LENGTH) / 2 };
  ctx.fillStyle = NAIL_COLOR;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, NAIL_LENGTH / 2, NAIL_HALF_WIDTH, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NAIL_SHEEN;
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    (NAIL_LENGTH / 2) * NAIL_SHEEN_SHARE,
    NAIL_HALF_WIDTH * NAIL_SHEEN_SHARE,
    angle,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * The open hand: a palm, four fingers held loosely together and fanning a
 * little, and the thumb set off to the side.
 */
const OPEN_PALM_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0, -0.0092],
  [0.25, -0.0125],
  [0.52, -0.0138],
  [0.56, 0],
  [0.52, 0.0138],
  [0.25, 0.0128],
  [0, 0.0092],
];
/** Each finger: offset across the knuckles, fan angle, length, root half-width. */
const OPEN_FINGERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-0.0098, -0.2, 0.023, 0.0033],
  [-0.0033, -0.07, 0.029, 0.0036],
  [0.0033, 0.06, 0.028, 0.0036],
  [0.0098, 0.18, 0.024, 0.0032],
];
const OPEN_THUMB_ROOT: readonly [number, number] = [0.18, 0.0115];
const OPEN_THUMB_ANGLE = 0.75;
const OPEN_THUMB_LENGTH = 0.022;
const OPEN_THUMB_HALF_WIDTH = 0.0042;
const OPEN_KNUCKLE_SHARE = 0.5;
const FINGER_TIP_TAPER = 0.6;

function drawFinger(ctx: Ctx, root: Pt2, angle: number, length: number, halfWidth: number): Pt2 {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const tip = { x: root.x + dir.x * length, y: root.y + dir.y * length };
  const tipHalf = halfWidth * FINGER_TIP_TAPER;
  traceSmooth(
    ctx,
    [
      { x: root.x + normal.x * halfWidth, y: root.y + normal.y * halfWidth },
      { x: tip.x + normal.x * tipHalf, y: tip.y + normal.y * tipHalf },
      { x: tip.x + dir.x * tipHalf, y: tip.y + dir.y * tipHalf },
      { x: tip.x - normal.x * tipHalf, y: tip.y - normal.y * tipHalf },
      { x: root.x - normal.x * halfWidth, y: root.y - normal.y * halfWidth },
    ],
    true,
  );
  return tip;
}

function drawOpenHand(ctx: Ctx, wrist: Pt2, tip: Pt2, palmSign: number, shade: number): void {
  const frame = handFrame(wrist, tip, palmSign);
  const handAngle = frame.fingerAngle(0);
  const palm = OPEN_PALM_EDGE.map(([u, v]) => frame.at(u, v, 0));
  ctx.fillStyle = mix(SKIN_BASE, SKIN_SHADE, shade);
  const tips: Array<{ tip: Pt2; angle: number }> = [];
  ctx.beginPath();
  const [thumbU, thumbV] = OPEN_THUMB_ROOT;
  const thumbAngle = handAngle + OPEN_THUMB_ANGLE * palmSign;
  tips.push({
    tip: drawFinger(
      ctx,
      frame.at(thumbU, thumbV, 0),
      thumbAngle,
      OPEN_THUMB_LENGTH,
      OPEN_THUMB_HALF_WIDTH,
    ),
    angle: thumbAngle,
  });
  for (const [across, fan, length, halfWidth] of OPEN_FINGERS) {
    const angle = handAngle + fan * palmSign;
    tips.push({
      tip: drawFinger(ctx, frame.at(OPEN_KNUCKLE_SHARE, across, 0), angle, length, halfWidth),
      angle,
    });
  }
  traceSmooth(ctx, palm, true);
  ctx.fill();
  for (const { tip: fingertip, angle } of tips) drawNail(ctx, fingertip, angle);
}

function drawHand(lp: LimbPaint, side: BodySide, arm: AngelArm, shade: number): void {
  const { ctx } = lp;
  const { wrist, tip } = armPoints(lp, arm);
  const open = arm.open;

  if (arm.grip > GRIP_HAND_THRESHOLD) {
    drawGripHand(ctx, wrist, tip, shade);
    return;
  }
  if (open > OPEN_HAND_THRESHOLD) {
    drawOpenHand(ctx, wrist, tip, palmSignOf(lp, wrist, tip), shade);
    return;
  }

  const frame = handFrame(wrist, tip, palmSignOf(lp, wrist, tip));
  const curl = RELAXED_CURL;
  const toPoints = (edge: ReadonlyArray<readonly [number, number]>): Pt2[] =>
    edge.map(([u, v]) => frame.at(u, v, curl));
  const hand = [...toPoints(HAND_BACK_EDGE), ...toPoints(HAND_PALM_EDGE)];
  const thumb = toPoints(THUMB_EDGE);
  ctx.fillStyle = mix(SKIN_BASE, SKIN_SHADE, shade);
  ctx.beginPath();
  traceSmooth(ctx, thumb, true);
  ctx.fill();
  ctx.fillStyle = mix(SKIN_LIT, SKIN_SHADE, shade);
  ctx.beginPath();
  traceSmooth(ctx, hand, true);
  ctx.fill();
  ctx.save();
  ctx.clip();
  fillCrescent(
    ctx,
    () => traceSmooth(ctx, hand, true),
    ARM_CORE_SLIDE_X * HAND_SLIDE_SHARE,
    ARM_CORE_SLIDE_Y,
    SKIN_SHADE,
    ARM_CORE_ALPHA,
  );
  ctx.restore();
  const [nailU, nailV] = RELAXED_NAIL_ROOT;
  drawNail(ctx, frame.at(nailU, nailV, curl), frame.fingerAngle(curl));
}

/**
 * Which way the palm faces on screen: head-on, toward her body (her palms rest
 * against her thighs); in profile, forward, the way the thumb points.
 */
function palmSignOf(lp: LimbPaint, wrist: Pt2, tip: Pt2): number {
  const towardX = lp.view === 'side' || wrist.x < 0 ? 1 : -1;
  const across = -(tip.y - wrist.y) * towardX;
  return across >= 0 ? 1 : -1;
}

export function drawArm(lp: LimbPaint, side: BodySide, arm: AngelArm, far: boolean): void {
  const { ctx } = lp;
  const outline = armOutline(lp, side, arm);
  const trace = (): void => traceSmooth(ctx, outline, true);
  const { shoulder, elbow, wrist } = armPoints(lp, arm);

  ctx.save();
  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  trace();
  ctx.fill();
  ctx.save();
  ctx.clip();
  const deltoid = midpoint(shoulder, elbow, DELTOID_LIGHT_SHARE);
  const lightSide = lp.view === 'side' ? ARM_LIGHT_OFFSET : side * ARM_LIGHT_OFFSET;
  fillSoftEllipse(
    ctx,
    deltoid.x + lightSide,
    deltoid.y,
    DELTOID_LIGHT_RADIUS_X,
    DELTOID_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    DELTOID_LIGHT_ALPHA,
    angleOf(shoulder, elbow) - Math.PI / 2,
  );
  const forearm = midpoint(elbow, wrist, FOREARM_LIGHT_SHARE);
  fillSoftEllipse(
    ctx,
    forearm.x + lightSide * FOREARM_LIGHT_OFFSET_SHARE,
    forearm.y,
    FOREARM_LIGHT_RADIUS_X,
    FOREARM_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    FOREARM_LIGHT_ALPHA,
    angleOf(elbow, wrist) - Math.PI / 2,
  );
  // One band down the far side: two stacked bands on a limb this slim read as stripes.
  fillCrescent(ctx, trace, ARM_TURN_SLIDE_X, 0, SKIN_HALF, ARM_TURN_ALPHA);

  ctx.restore();

  if (far) {
    ctx.save();
    ctx.globalAlpha *= FAR_ARM_SHADE_ALPHA;
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath();
    trace();
    ctx.fill();
    ctx.restore();
  }

  drawHand(lp, side, arm, far ? FAR_ARM_SHADE_ALPHA : 0);
  ctx.restore();
}

/* ── The grip ──────────────────────────────────────────────────────────── */

/** Past this, a hand is drawn closed round the pole. */
const GRIP_HAND_THRESHOLD = 0.5;
/**
 * Where the pole passes through a closed hand, as a share of the hand's length
 * from the wrist. The choreography puts this point on the pole's axis.
 */
export const GRIP_CENTRE_SHARE = 0.55;
/** The fist is wider across the knuckles than the wrist it grows from, or it reads as a stump. */
const FIST_HALF_LENGTH = 0.019;
const FIST_HALF_WIDTH = 0.021;
/** Finger creases run across the fist, square to the pole they wrap. */
const FIST_CREASE_SPACING = 0.0085;
const FIST_CREASE_HALF_LENGTH = 0.016;
const FIST_CREASE_WIDTH = 0.0028;
const FIST_CREASE_ALPHA = 0.7;
const FIST_KNUCKLE_LIGHT_RADIUS = 0.009;
const FIST_KNUCKLE_LIGHT_ALPHA = 0.7;
const FIST_BACK_HALF_WIDTH = 0.0105;

/** Where a closed hand's fist sits on screen: where the pole passes through it. */
export function gripCentreOnScreen(lp: Pick<LimbPaint, 'view'>, arm: AngelArm): Pt2 {
  const { wrist, tip } = armPoints(lp, arm);
  return midpoint(wrist, tip, GRIP_CENTRE_SHARE);
}

/**
 * A fist closed round a vertical pole: the back of the hand running from the
 * wrist to the knuckles, then a rounded block of curled fingers wrapped across
 * the pole, their creases running across it. Drawn after the pole, so the
 * fingers close back over it.
 */
function drawGripHand(ctx: Ctx, wrist: Pt2, tip: Pt2, shade: number): void {
  const centre = midpoint(wrist, tip, GRIP_CENTRE_SHARE);
  const length = Math.max(Math.hypot(centre.x - wrist.x, centre.y - wrist.y), DEGENERATE_LENGTH);
  const normal = { x: -(centre.y - wrist.y) / length, y: (centre.x - wrist.x) / length };
  ctx.fillStyle = mix(SKIN_BASE, SKIN_SHADE, shade);
  ctx.beginPath();
  ctx.moveTo(wrist.x + normal.x * FIST_BACK_HALF_WIDTH, wrist.y + normal.y * FIST_BACK_HALF_WIDTH);
  ctx.lineTo(centre.x + normal.x * FIST_HALF_WIDTH, centre.y + normal.y * FIST_HALF_WIDTH);
  ctx.lineTo(centre.x - normal.x * FIST_HALF_WIDTH, centre.y - normal.y * FIST_HALF_WIDTH);
  ctx.lineTo(wrist.x - normal.x * FIST_BACK_HALF_WIDTH, wrist.y - normal.y * FIST_BACK_HALF_WIDTH);
  ctx.closePath();
  ctx.fill();
  drawFist(ctx, centre, shade);
}

/** The curled fingers of a closed hand, wrapped across a vertical pole at `centre`. */
function drawFist(ctx: Ctx, centre: Pt2, shade: number): void {
  ctx.fillStyle = mix(SKIN_LIT, SKIN_SHADE, shade);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, FIST_HALF_WIDTH, FIST_HALF_LENGTH, 0, 0, Math.PI * 2);
  ctx.fill();
  fillSoftEllipse(
    ctx,
    centre.x + ARM_LIGHT_OFFSET,
    centre.y - FIST_CREASE_SPACING,
    FIST_KNUCKLE_LIGHT_RADIUS,
    FIST_KNUCKLE_LIGHT_RADIUS,
    SKIN_HIGHLIGHT,
    FIST_KNUCKLE_LIGHT_ALPHA * (1 - shade),
  );
  ctx.save();
  ctx.globalAlpha *= FIST_CREASE_ALPHA;
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = FIST_CREASE_WIDTH;
  ctx.lineCap = 'round';
  for (const offset of [-FIST_CREASE_SPACING, 0, FIST_CREASE_SPACING]) {
    ctx.beginPath();
    ctx.moveTo(centre.x - FIST_CREASE_HALF_LENGTH, centre.y + offset);
    ctx.lineTo(centre.x + FIST_CREASE_HALF_LENGTH, centre.y + offset);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The fingers of a closed hand again, over a pole drawn in front of the body:
 * the hand under them was painted with the arm, behind the pole.
 */
export function drawGripOverPole(lp: LimbPaint, arm: AngelArm, far: boolean): void {
  if (arm.grip <= GRIP_HAND_THRESHOLD) return;
  drawFist(lp.ctx, gripCentreOnScreen(lp, arm), far ? FAR_ARM_SHADE_ALPHA : 0);
}
