/**
 * The Trash Gremlin's body below the neck: the hunched torso with its small pot
 * belly, the bowed legs and big three-toed feet, the long stringy arms and
 * their oversized knuckly hands, and the long naked tail.
 *
 * Every part is built here as a list of forms in screen space for one view;
 * `trashGremlinArt.ts` decides which slab each list is painted in and in what
 * order.
 */

import { type Pt, clamp01, lerp, rgba } from '../bipedArt';
import { BELLY, BELLY_MOTTLE, BRUISE, CLAW, CLAW_GLINT, HIDE, type Ramp } from './palette';
import {
  type Ctx,
  type Form,
  smoothSpanHandles,
  form,
  hash1,
  traceEllipse,
  traceSmooth,
  traceTaper,
} from './paint';
import {
  ANKLE_RADIUS,
  CLAW_LENGTH,
  ELBOW_RADIUS,
  HAND_LENGTH,
  HEEL_LENGTH,
  KNEE_RADIUS,
  NECK_RADIUS,
  TAIL_LENGTH,
  TAIL_ROOT_RADIUS,
  TAIL_TIP_RADIUS,
  THIGH_ROOT_RADIUS,
  TOE_LENGTH,
  TOE_RADIUS,
  UPPER_ARM_ROOT_RADIUS,
  WRIST_RADIUS,
} from './proportions';
import {
  type Chain,
  type GremlinPose,
  type GremlinView,
  type Skeleton,
  type V3,
  ankleOf,
  buildSkeleton,
  offset,
  project,
  pt,
  v3,
} from './rig';

// ── Torso ────────────────────────────────────────────────────────────────────

/**
 * The torso as stations up the spine: how far each side of the outline stands
 * off it. Head-on the two sides are the half-width; edge-on they are the front
 * (belly) and the back. Between them they make a skinny ribcage over a small
 * round pot belly, with a hump of shoulder where the lid rides.
 */
interface Station {
  /** Share of the way from pelvis (0) to chest (1); past either end runs on along the spine. */
  readonly at: number;
  readonly half: number;
  readonly front: number;
  readonly back: number;
  /** How much of this station swells with the breath. */
  readonly breathes: number;
}

const STATIONS: readonly Station[] = [
  { at: -0.13, half: 0.15, front: 0.09, back: 0.12, breathes: 0 },
  { at: 0.02, half: 0.235, front: 0.17, back: 0.15, breathes: 0.2 },
  { at: 0.22, half: 0.28, front: 0.27, back: 0.13, breathes: 1 },
  { at: 0.44, half: 0.25, front: 0.22, back: 0.13, breathes: 0.8 },
  { at: 0.66, half: 0.2, front: 0.15, back: 0.16, breathes: 0.4 },
  { at: 0.88, half: 0.245, front: 0.12, back: 0.17, breathes: 0.1 },
  { at: 1.03, half: 0.16, front: 0.09, back: 0.12, breathes: 0 },
  { at: 1.1, half: 0.1, front: 0.07, back: 0.08, breathes: 0 },
  { at: 1.15, half: 0.05, front: 0.035, back: 0.04, breathes: 0 },
];

/** How deep the torso is, back to belly, where a hunch turns it to the camera. */
const HEAD_ON_TORSO_DEPTH = 0.3;
/** A full breath widens the belly by this share. */
const BREATH_SWELL = 0.06;
/** Edge-on the hunched back rounds out behind the straight line of the spine. */
const HUNCH_BOW = 0.16;

interface SpineCurve {
  readonly at: (t: number) => Pt;
  readonly normalAt: (t: number) => Pt;
}

function spineCurve(sk: Skeleton, pose: GremlinPose, view: GremlinView): SpineCurve {
  const p0 = project(sk.pelvis, view);
  const chest = project(sk.chest, view);
  // Head-on, a spine pitched toward or away from the camera foreshortens, but
  // the body round it does not vanish: the hunched back still stands as tall as
  // its own depth. Without this the stations bunch up and the outline corners.
  const depthRise = view === 'side' ? 0 : HEAD_ON_TORSO_DEPTH * Math.abs(Math.sin(pose.hunch));
  const p2 = pt(chest.x, chest.y - depthRise);
  const mid = pt((p0.x + p2.x) / 2, (p0.y + p2.y) / 2);
  const backScreen = project(offset(sk.pelvis, sk.back, 1), view);
  const backDir = pt(backScreen.x - p0.x, backScreen.y - p0.y);
  const bow = view === 'side' ? HUNCH_BOW * Math.sin(Math.max(0, pose.hunch)) : 0;
  const p1 = pt(mid.x + backDir.x * bow, mid.y + backDir.y * bow);
  const bezier = (t: number): Pt => {
    const u = 1 - t;
    return pt(
      u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    );
  };
  const tangent = (t: number): Pt => {
    const c = clamp01(t);
    const u = 1 - c;
    return pt(
      2 * u * (p1.x - p0.x) + 2 * c * (p2.x - p1.x),
      2 * u * (p1.y - p0.y) + 2 * c * (p2.y - p1.y),
    );
  };
  return {
    at: (t) => {
      if (t >= 0 && t <= 1) return bezier(t);
      const end = t < 0 ? 0 : 1;
      const base = bezier(end);
      const dir = tangent(end);
      return pt(base.x + dir.x * (t - end), base.y + dir.y * (t - end));
    },
    normalAt: (t) => {
      const dir = tangent(t);
      const len = Math.hypot(dir.x, dir.y) || 1;
      return pt(-dir.y / len, dir.x / len);
    },
  };
}

/** The torso's outline points, right side up the spine then left side down. */
function torsoOutline(sk: Skeleton, pose: GremlinPose, view: GremlinView): Pt[] {
  const curve = spineCurve(sk, pose, view);
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (const station of STATIONS) {
    const swell = 1 + station.breathes * BREATH_SWELL * pose.breath;
    const centre = curve.at(station.at);
    const normal = curve.normalAt(station.at);
    const plus = view === 'side' ? station.front : station.half;
    const minus = view === 'side' ? station.back : station.half;
    right.push(pt(centre.x + normal.x * plus * swell, centre.y + normal.y * plus * swell));
    left.push(pt(centre.x - normal.x * minus * swell, centre.y - normal.y * minus * swell));
  }
  return [...right, ...left.reverse()];
}

const CURVE_SAMPLES_PER_SPAN = 12;

/** A point on the Bézier span the smooth trace draws between `p1` and `p2`. */
function smoothSpanPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const { c1, c2 } = smoothSpanHandles(p0, p1, p2, p3);
  const u = 1 - t;
  return pt(
    u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
    u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
  );
}

/**
 * The tightest turn the torso's painted outline takes on this pose, and where:
 * sampled off the same spline the painter strokes, so a corner the eye would
 * see is a corner this finds.
 */
export function torsoOutlineCurvature(
  pose: GremlinPose,
  view: GremlinView,
): { radius: number; y: number } {
  const outline = torsoOutline(buildSkeleton(pose), pose, view);
  const n = outline.length;
  const dense: Pt[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < CURVE_SAMPLES_PER_SPAN; k++) {
      dense.push(
        smoothSpanPoint(
          outline[(i - 1 + n) % n],
          outline[i],
          outline[(i + 1) % n],
          outline[(i + 2) % n],
          k / CURVE_SAMPLES_PER_SPAN,
        ),
      );
    }
  }
  let radius = Infinity;
  let y = 0;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[(i - 1 + dense.length) % dense.length];
    const b = dense[i];
    const c = dense[(i + 1) % dense.length];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 < CURVATURE_DEGENERATE) continue;
    const circumradius = (ab * bc * ca) / (2 * area2);
    if (circumradius < radius) {
      radius = circumradius;
      y = b.y;
    }
  }
  return { radius, y };
}

const CURVATURE_DEGENERATE = 1e-12;

/** Where the pale belly sits on the spine, and how big it is against the torso. */
const BELLY_AT = 0.26;
const BELLY_RX = 0.14;
const BELLY_RY = 0.2;
const BELLY_SIDE_FORWARD = 0.13;
const BELLY_SIDE_RX = 0.15;
const MOTTLE_COUNT = 7;
const MOTTLE_RADIUS = 0.034;
const MOTTLE_ALPHA = 0.75;
const RIB_ALPHA = 0.35;
const RIB_WIDTH = 0.016;
const RIB_ROWS = [0.6, 0.7, 0.8] as const;
const RIB_SPAN = 0.15;
const BRUISE_ALPHA = 0.45;
const SPINE_KNOB_COUNT = 5;
const SPINE_KNOB_RADIUS = 0.022;
/** The knobs of the spine run from just above the pelvis to just below the neck. */
const SPINE_KNOBS_FROM = 0.15;
const SPINE_KNOBS_TO = 0.95;
/** The belly's lit patch: upper left of the belly, so the light reads as a curve. */
const BELLY_LIGHT_SHIFT_X = 0.25;
const BELLY_LIGHT_SHIFT_Y = 0.3;
const BELLY_LIGHT_RX = 0.7;
const BELLY_LIGHT_RY = 0.55;
/** Below this share of its height down the belly turns under, into shadow. */
const BELLY_UNDERSIDE_FROM = 0.55;
const MOTTLE_SEED_ANGLE = 1;
const MOTTLE_SEED_REACH = 11;
const MOTTLE_SEED_SIZE = 21;
/** Mottles stay inside this share of the belly so none is clipped to a sliver. */
const MOTTLE_REACH = 0.8;
const MOTTLE_SIZE_MIN = 0.6;
const MOTTLE_SIZE_SPREAD = 0.8;
/** Each rib starts this far out from the breastbone and arcs over and down. */
const RIB_START = 0.07;
const RIB_ARCH = 0.03;
const RIB_DIP = 0.01;
const RIB_CONTROL_SHARE = 0.6;
/** One bruise on the figure's left shoulder, where the strap rubs. */
const BRUISE_AT = 0.92;
const BRUISE_ACROSS = 0.13;
const BRUISE_DROP = 0.02;
const BRUISE_RX = 0.06;
const BRUISE_RY = 0.04;
const BRUISE_TURN = 0.4;

function paintSpineKnobs(ctx: Ctx, curve: SpineCurve): void {
  ctx.fillStyle = HIDE.dark;
  for (let i = 0; i < SPINE_KNOB_COUNT; i++) {
    const c = curve.at(lerp(SPINE_KNOBS_FROM, SPINE_KNOBS_TO, i / (SPINE_KNOB_COUNT - 1)));
    ctx.beginPath();
    ctx.arc(c.x, c.y, SPINE_KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBelly(ctx: Ctx, curve: SpineCurve, pose: GremlinPose, view: GremlinView): void {
  const centre = curve.at(BELLY_AT);
  const normal = curve.normalAt(BELLY_AT);
  const swell = 1 + BREATH_SWELL * pose.breath;
  const rotation = Math.atan2(normal.y, normal.x);
  const bellyCentre =
    view === 'side'
      ? pt(centre.x + normal.x * BELLY_SIDE_FORWARD, centre.y + normal.y * BELLY_SIDE_FORWARD)
      : centre;
  const rx = (view === 'side' ? BELLY_SIDE_RX : BELLY_RX) * swell;
  const ry = BELLY_RY * swell;
  const bellyTrace = traceEllipse(bellyCentre, rx, ry, rotation);
  ctx.save();
  ctx.beginPath();
  bellyTrace(ctx);
  ctx.clip();
  ctx.fillStyle = BELLY.mid;
  ctx.beginPath();
  bellyTrace(ctx);
  ctx.fill();
  ctx.fillStyle = BELLY.light;
  ctx.beginPath();
  traceEllipse(
    pt(bellyCentre.x - rx * BELLY_LIGHT_SHIFT_X, bellyCentre.y - ry * BELLY_LIGHT_SHIFT_Y),
    rx * BELLY_LIGHT_RX,
    ry * BELLY_LIGHT_RY,
    rotation,
  )(ctx);
  ctx.fill();
  ctx.fillStyle = BELLY.dark;
  ctx.fillRect(bellyCentre.x - rx, bellyCentre.y + ry * BELLY_UNDERSIDE_FROM, rx * 2, ry);
  ctx.fillStyle = rgba(BELLY_MOTTLE, MOTTLE_ALPHA);
  for (let i = 0; i < MOTTLE_COUNT; i++) {
    const angle = hash1(i + MOTTLE_SEED_ANGLE) * Math.PI * 2;
    const reach = Math.sqrt(hash1(i + MOTTLE_SEED_REACH)) * MOTTLE_REACH;
    ctx.beginPath();
    ctx.arc(
      bellyCentre.x + Math.cos(angle) * rx * reach,
      bellyCentre.y + Math.sin(angle) * ry * reach,
      MOTTLE_RADIUS * (MOTTLE_SIZE_MIN + hash1(i + MOTTLE_SEED_SIZE) * MOTTLE_SIZE_SPREAD),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function paintRibsAndBruise(ctx: Ctx, curve: SpineCurve): void {
  ctx.strokeStyle = rgba(HIDE.deep, RIB_ALPHA);
  ctx.lineWidth = RIB_WIDTH;
  for (const at of RIB_ROWS) {
    const c = curve.at(at);
    const n = curve.normalAt(at);
    for (const side of [-1, 1]) {
      const out = (reach: number): Pt => pt(c.x + n.x * side * reach, c.y + n.y * side * reach);
      const from = out(RIB_START);
      const control = out(RIB_START + RIB_SPAN * RIB_CONTROL_SHARE);
      const to = out(RIB_START + RIB_SPAN);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - RIB_DIP);
      ctx.quadraticCurveTo(control.x, control.y - RIB_ARCH, to.x, to.y + RIB_DIP);
      ctx.stroke();
    }
  }
  const shoulder = curve.at(BRUISE_AT);
  ctx.fillStyle = rgba(BRUISE, BRUISE_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    shoulder.x + BRUISE_ACROSS,
    shoulder.y + BRUISE_DROP,
    BRUISE_RX,
    BRUISE_RY,
    BRUISE_TURN,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function torsoDetail(sk: Skeleton, pose: GremlinPose, view: GremlinView): (ctx: Ctx) => void {
  const curve = spineCurve(sk, pose, view);
  return (ctx) => {
    if (view === 'back') {
      paintSpineKnobs(ctx, curve);
      return;
    }
    paintBelly(ctx, curve, pose, view);
    if (view === 'front') paintRibsAndBruise(ctx, curve);
  };
}

/** Thickness the torso is shaded at: the width of the belly. */
const TORSO_SHADE_SIZE = 0.5;

export function torsoForms(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form[] {
  const outline = torsoOutline(sk, pose, view);
  return [form(traceSmooth(outline), HIDE, TORSO_SHADE_SIZE, torsoDetail(sk, pose, view))];
}

export function neckForm(sk: Skeleton, view: GremlinView): Form {
  const base = project(sk.neckBase, view);
  const top = project(sk.head, view);
  return form(traceTaper(base, top, NECK_RADIUS, NECK_RADIUS * 0.9), HIDE, NECK_RADIUS * 2);
}

// ── Legs and feet ────────────────────────────────────────────────────────────

/** The thigh narrows hard into a knobbly knee: these legs are bone with skin on. */
const THIGH_END_RADIUS = KNEE_RADIUS * 0.82;
const KNEE_KNOB = KNEE_RADIUS * 1.08;
const SHIN_TOP_RADIUS = KNEE_RADIUS * 0.85;

export function legForms(chain: Chain, view: GremlinView, ramp: Ramp): Form[] {
  const hip = project(chain.root, view);
  const knee = project(chain.joint, view);
  const ankle = project(chain.end, view);
  return [
    form(traceTaper(hip, knee, THIGH_ROOT_RADIUS, THIGH_END_RADIUS), ramp, THIGH_ROOT_RADIUS * 2),
    form(traceTaper(knee, ankle, SHIN_TOP_RADIUS, ANKLE_RADIUS), ramp, KNEE_RADIUS * 2),
    form(traceEllipse(knee, KNEE_KNOB, KNEE_KNOB * 0.9), ramp, KNEE_KNOB * 2),
  ];
}

/** Each foot's toes fan out this far either side of its middle toe. */
const TOE_SPLAY = 0.5;
/** And the whole foot turns out from straight ahead. */
const FOOT_TURNOUT = 0.2;
const SIDE_TOE_SHARE = 0.8;
const TOE_TIP_SHARE = 0.62;
const BALL_RADIUS = 0.06;
const HEEL_RADIUS = 0.045;
/** How far ahead of the ankle the ball of the foot is. */
const BALL_AHEAD = 0.05;

interface FootGeometry {
  readonly ball: Pt;
  readonly heel: Pt;
  readonly ankle: Pt;
  readonly toes: readonly {
    readonly root: Pt;
    readonly tip: Pt;
    readonly clawTip: Pt;
    readonly depth: number;
  }[];
}

function footGeometry(sole: V3, pitch: number, side: number, view: GremlinView): FootGeometry {
  const ankle3 = ankleOf(sole);
  // Every round part of the foot rests on the sole line rather than being
  // centred on it, so nothing but the claws' points reaches the floor.
  const ball3 = v3(sole.x, sole.y - BALL_RADIUS, sole.z + BALL_AHEAD);
  const heel3 = v3(sole.x, sole.y - HEEL_RADIUS, sole.z - HEEL_LENGTH);
  const toeBase = v3(sole.x, sole.y - TOE_RADIUS, sole.z + BALL_AHEAD);
  const toes = [-1, 0, 1].map((k) => {
    const heading = side * FOOT_TURNOUT + k * side * TOE_SPLAY;
    const reach = TOE_LENGTH * (k === 0 ? 1 : SIDE_TOE_SHARE);
    const dir = v3(Math.sin(heading), Math.sin(pitch), Math.cos(heading));
    const root3 = offset(toeBase, dir, BALL_RADIUS * 0.5);
    const tip3 = offset(toeBase, dir, reach);
    const claw3 = v3(
      tip3.x + dir.x * CLAW_LENGTH,
      tip3.y + TOE_RADIUS * TOE_TIP_SHARE,
      tip3.z + dir.z * CLAW_LENGTH,
    );
    return {
      root: project(root3, view),
      tip: project(tip3, view),
      clawTip: project(claw3, view),
      depth: view === 'back' ? -tip3.z : view === 'front' ? tip3.z : tip3.x,
    };
  });
  return {
    ball: project(ball3, view),
    heel: project(heel3, view),
    ankle: project(ankle3, view),
    toes,
  };
}

export function footForms(
  sole: V3,
  pitch: number,
  side: number,
  view: GremlinView,
  ramp: Ramp,
): Form[] {
  const foot = footGeometry(sole, pitch, side, view);
  const forms: Form[] = [
    form(traceTaper(foot.ankle, foot.ball, ANKLE_RADIUS * 1.1, BALL_RADIUS), ramp, BALL_RADIUS * 2),
    form(traceEllipse(foot.heel, HEEL_RADIUS, HEEL_RADIUS * 0.8), ramp, HEEL_RADIUS * 2),
  ];
  const ordered = [...foot.toes].sort((a, b) => a.depth - b.depth);
  for (const toe of ordered) {
    forms.push(
      form(
        traceTaper(toe.root, toe.tip, TOE_RADIUS, TOE_RADIUS * TOE_TIP_SHARE),
        ramp,
        TOE_RADIUS * 2,
      ),
    );
  }
  return forms;
}

/** The black claws on a foot, drawn over its own slab so they stay black. */
export function paintFootClaws(
  ctx: Ctx,
  sole: V3,
  pitch: number,
  side: number,
  view: GremlinView,
): void {
  const foot = footGeometry(sole, pitch, side, view);
  for (const toe of foot.toes) paintClaw(ctx, toe.tip, toe.clawTip, TOE_RADIUS * TOE_TIP_SHARE);
}

function paintClaw(ctx: Ctx, base: Pt, tip: Pt, baseRadius: number): void {
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const r = baseRadius * CLAW_BASE_SHARE;
  ctx.beginPath();
  ctx.moveTo(base.x + nx * r, base.y + ny * r);
  ctx.quadraticCurveTo(
    base.x + dx * 0.6 + nx * r * 0.6,
    base.y + dy * 0.6 + ny * r * 0.6,
    tip.x,
    tip.y,
  );
  ctx.lineTo(base.x - nx * r, base.y - ny * r);
  ctx.closePath();
  ctx.fillStyle = CLAW;
  ctx.fill();
  ctx.strokeStyle = CLAW;
  ctx.lineWidth = CLAW_EDGE;
  ctx.stroke();
  ctx.strokeStyle = CLAW_GLINT;
  ctx.lineWidth = CLAW_GLINT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(base.x + nx * r * 0.3 + dx * 0.2, base.y + ny * r * 0.3 + dy * 0.2);
  ctx.lineTo(base.x + dx * 0.6, base.y + dy * 0.6);
  ctx.stroke();
}

const CLAW_BASE_SHARE = 1.05;
const CLAW_EDGE = 0.012;
const CLAW_GLINT_WIDTH = 0.008;

// ── Arms and hands ───────────────────────────────────────────────────────────

const UPPER_ARM_END_RADIUS = ELBOW_RADIUS * 0.85;
const ELBOW_KNOB = ELBOW_RADIUS * 1.15;
const FOREARM_TOP_RADIUS = ELBOW_RADIUS * 0.95;

export function armForms(chain: Chain, view: GremlinView, ramp: Ramp): Form[] {
  const shoulder = project(chain.root, view);
  const elbow = project(chain.joint, view);
  const wrist = project(chain.end, view);
  return [
    form(
      traceTaper(shoulder, elbow, UPPER_ARM_ROOT_RADIUS, UPPER_ARM_END_RADIUS),
      ramp,
      UPPER_ARM_ROOT_RADIUS * 2,
    ),
    form(traceTaper(elbow, wrist, FOREARM_TOP_RADIUS, WRIST_RADIUS), ramp, ELBOW_RADIUS * 2),
    form(traceEllipse(elbow, ELBOW_KNOB, ELBOW_KNOB), ramp, ELBOW_KNOB * 2),
  ];
}

/**
 * A hand does not take the full angle of its forearm — a hand aligned outright
 * waves as the arm swings. It sits between the line of the whole arm and the
 * forearm's own.
 */
const HAND_FOLLOW_FOREARM = 0.4;

const PALM_LENGTH = HAND_LENGTH * 0.42;
const PALM_WIDTH = HAND_LENGTH * 0.85;
const FINGER_LENGTH = HAND_LENGTH * 0.5;
const FINGER_RADIUS = HAND_LENGTH * 0.11;
const FINGER_SPREAD = HAND_LENGTH * 0.27;
const FINGER_FAN = 0.24;
const KNUCKLE_RADIUS = HAND_LENGTH * 0.13;
const THUMB_LENGTH = HAND_LENGTH * 0.34;
const THUMB_ANGLE = 1.0;
const FIST_RADIUS = HAND_LENGTH * 0.44;
const FIST_KNUCKLE_RADIUS = HAND_LENGTH * 0.135;
/** How far a curling finger shortens toward the palm. */
const FINGER_CURL = 0.6;
const FIST_THRESHOLD = 0.65;
const HAND_CLAW_LENGTH = HAND_LENGTH * 0.18;

interface HandGeometry {
  readonly forms: Form[];
  readonly claws: readonly { readonly base: Pt; readonly tip: Pt }[];
}

function handGeometry(
  chain: Chain,
  fist: number,
  thumbSide: number,
  view: GremlinView,
  ramp: Ramp,
): HandGeometry {
  const shoulder = project(chain.root, view);
  const elbow = project(chain.joint, view);
  const wrist = project(chain.end, view);
  const forearmAngle = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  const armAngle = Math.atan2(wrist.y - shoulder.y, wrist.x - shoulder.x);
  const angle = armAngle + angleDelta(armAngle, forearmAngle) * HAND_FOLLOW_FOREARM;
  const d = pt(Math.cos(angle), Math.sin(angle));
  const n = pt(-d.y * thumbSide, d.x * thumbSide);
  const forms: Form[] = [];
  const claws: { base: Pt; tip: Pt }[] = [];

  if (fist >= FIST_THRESHOLD) {
    const centre = pt(wrist.x + d.x * FIST_RADIUS * 0.9, wrist.y + d.y * FIST_RADIUS * 0.9);
    forms.push(
      form(traceEllipse(centre, FIST_RADIUS, FIST_RADIUS * 0.92, angle), ramp, FIST_RADIUS * 2),
    );
    for (const k of [-1, 0, 1]) {
      const knuckle = pt(
        centre.x + d.x * FIST_RADIUS * 0.7 + n.x * k * FINGER_SPREAD,
        centre.y + d.y * FIST_RADIUS * 0.7 + n.y * k * FINGER_SPREAD,
      );
      forms.push(
        form(
          traceEllipse(knuckle, FIST_KNUCKLE_RADIUS, FIST_KNUCKLE_RADIUS),
          ramp,
          FIST_KNUCKLE_RADIUS * 2,
        ),
      );
    }
    const thumb = pt(centre.x - n.x * FIST_RADIUS * 0.75, centre.y - n.y * FIST_RADIUS * 0.75);
    forms.push(
      form(traceEllipse(thumb, FINGER_RADIUS * 1.15, FINGER_RADIUS), ramp, FINGER_RADIUS * 2),
    );
    return { forms, claws };
  }

  const curl = clamp01(fist / FIST_THRESHOLD);
  const palmCentre = pt(wrist.x + d.x * PALM_LENGTH * 0.7, wrist.y + d.y * PALM_LENGTH * 0.7);
  forms.push(form(traceEllipse(palmCentre, PALM_LENGTH, PALM_WIDTH / 2, angle), ramp, PALM_WIDTH));
  const thumbAngle = angle - thumbSide * THUMB_ANGLE * (1 - curl * 0.4);
  const thumbRoot = pt(
    palmCentre.x - n.x * PALM_WIDTH * 0.35,
    palmCentre.y - n.y * PALM_WIDTH * 0.35,
  );
  const thumbTip = pt(
    thumbRoot.x + Math.cos(thumbAngle) * THUMB_LENGTH,
    thumbRoot.y + Math.sin(thumbAngle) * THUMB_LENGTH,
  );
  forms.push(
    form(
      traceTaper(thumbRoot, thumbTip, FINGER_RADIUS * 1.1, FINGER_RADIUS * 0.8),
      ramp,
      FINGER_RADIUS * 2,
    ),
  );
  for (const k of [-1, 0, 1]) {
    const fingerAngle = angle + k * FINGER_FAN * (1 - curl * 0.5);
    const root = pt(
      palmCentre.x + d.x * PALM_LENGTH * 0.75 + n.x * k * FINGER_SPREAD,
      palmCentre.y + d.y * PALM_LENGTH * 0.75 + n.y * k * FINGER_SPREAD,
    );
    const reach = FINGER_LENGTH * (k === 0 ? 1 : 0.88) * (1 - curl * FINGER_CURL);
    const tip = pt(root.x + Math.cos(fingerAngle) * reach, root.y + Math.sin(fingerAngle) * reach);
    forms.push(
      form(traceTaper(root, tip, FINGER_RADIUS, FINGER_RADIUS * 0.8), ramp, FINGER_RADIUS * 2),
    );
    forms.push(form(traceEllipse(root, KNUCKLE_RADIUS, KNUCKLE_RADIUS), ramp, KNUCKLE_RADIUS * 2));
    claws.push({
      base: tip,
      tip: pt(
        tip.x + Math.cos(fingerAngle) * HAND_CLAW_LENGTH,
        tip.y + Math.sin(fingerAngle) * HAND_CLAW_LENGTH,
      ),
    });
  }
  return { forms, claws };
}

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function handForms(
  chain: Chain,
  fist: number,
  thumbSide: number,
  view: GremlinView,
  ramp: Ramp,
): Form[] {
  return handGeometry(chain, fist, thumbSide, view, ramp).forms;
}

export function paintHandClaws(
  ctx: Ctx,
  chain: Chain,
  fist: number,
  thumbSide: number,
  view: GremlinView,
): void {
  for (const claw of handGeometry(chain, fist, thumbSide, view, HIDE).claws) {
    paintClaw(ctx, claw.base, claw.tip, FINGER_RADIUS * 0.8);
  }
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_SEGMENTS = 18;
/** Where the tail leaves the body: behind the pelvis and a little below it. */
const TAIL_ROOT_BACK = 0.12;
const TAIL_ROOT_DROP = 0.06;
/** The share of its length it takes to droop from the rump to the floor. */
const TAIL_DROOP_SHARE = 0.3;
const TAIL_FLOOR_Y = -0.03;
/** The turn it makes along the floor, sweeping round toward the figure's right. */
const TAIL_SWEEP = 2.0;
const TAIL_CURL_TURN = 2.6;
const TAIL_TIP_LIFT = 0.16;
const TAIL_TIP_FROM = 0.7;

/** The tail's centreline, root to tip, in body space. */
function tailPath(sk: Skeleton, pose: GremlinPose): V3[] {
  const root = v3(sk.pelvis.x, sk.pelvis.y + TAIL_ROOT_DROP, sk.pelvis.z - TAIL_ROOT_BACK);
  const points: V3[] = [root];
  const segment = TAIL_LENGTH / TAIL_SEGMENTS;
  let x = root.x;
  let z = root.z;
  for (let i = 1; i <= TAIL_SEGMENTS; i++) {
    const s = i / TAIL_SEGMENTS;
    const curlShare = clamp01((s - TAIL_TIP_FROM) / (1 - TAIL_TIP_FROM));
    const heading =
      Math.PI +
      TAIL_SWEEP * s +
      pose.tailSwing +
      pose.tailCurl * TAIL_CURL_TURN * curlShare * curlShare;
    const droop = clamp01(s / TAIL_DROOP_SHARE);
    const horizontal = segment * (0.35 + 0.65 * droop);
    x += Math.sin(heading) * horizontal * -1;
    z += Math.cos(heading) * horizontal;
    const sag = lerp(root.y, TAIL_FLOOR_Y, Math.sin((droop * Math.PI) / 2));
    const lift = TAIL_TIP_LIFT * pose.tailCurl * curlShare * curlShare;
    points.push(v3(x, sag - lift, z));
  }
  return points;
}

export function tailForm(sk: Skeleton, pose: GremlinPose, view: GremlinView, ramp: Ramp): Form {
  return taperedPathForm(
    tailPath(sk, pose).map((p) => project(p, view)),
    TAIL_ROOT_RADIUS,
    TAIL_TIP_RADIUS,
    ramp,
  );
}

/** A tube along a screen-space path, tapering from root to tip, as one form. */
export function taperedPathForm(
  path: readonly Pt[],
  rootRadius: number,
  tipRadius: number,
  ramp: Ramp,
): Form {
  const left: Pt[] = [];
  const right: Pt[] = [];
  path.forEach((p, i) => {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const radius = lerp(rootRadius, tipRadius, i / (path.length - 1));
    left.push(pt(p.x - (dy / len) * radius, p.y + (dx / len) * radius));
    right.push(pt(p.x + (dy / len) * radius, p.y - (dx / len) * radius));
  });
  return form(traceSmooth([...left, ...right.reverse()]), ramp, rootRadius * 2);
}
