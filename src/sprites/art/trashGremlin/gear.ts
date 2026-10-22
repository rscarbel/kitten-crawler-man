/**
 * What the Trash Gremlin carries: a dented round bin lid strapped to its back
 * like a shell, a lumpy sack of junk bulging out from under it, and a string of
 * tin cans dangling off the sack.
 *
 * The lid is a disc in body space, projected into each view: head-on from
 * behind it is the whole round shield, edge-on a dome on the hunched back, and
 * from the front a rim standing out round the shoulders. One description in
 * three dimensions is what keeps those three the same lid.
 */

import { type Pt, clamp01, rgba } from '../carlArt';
import { BIN_BAG, BIN_BAG_SHEEN, RUST, STEEL, STRAP, STRING, TIN } from './palette';
import {
  type Ctx,
  type Form,
  type Trace,
  convexHull,
  form,
  hash1,
  strokeCurve,
  traceEllipse,
  tracePolygon,
} from './paint';
import { LID_DOME, LID_RADIUS, TORSO_LENGTH } from './proportions';
import {
  type GremlinPose,
  type GremlinView,
  type Skeleton,
  type V3,
  add,
  nearness,
  normalize,
  offset,
  project,
  pt,
  scale,
  v3,
} from './rig';

// ── The lid ──────────────────────────────────────────────────────────────────

/** Where the lid's centre rides: most of the way up the spine and out off the back. */
const LID_ALONG = 0.8;
const LID_OUT = 0.17;
const LID_RIM_STEPS = 36;
/** A dent flattens one stretch of the rim. */
const RIM_DENT_AT = 2.3;
const RIM_DENT_DEPTH = 0.07;
const RIM_DENT_WIDTH = 0.55;
const RIDGES = [0.74, 0.46] as const;
const RIDGE_WIDTH = 0.022;
const RIDGE_ALPHA = 0.6;
const RIDGE_LIGHT_ALPHA = 0.55;
const HANDLE_HALF = 0.09;
const HANDLE_RISE = 0.05;
const HANDLE_RADIUS = 0.03;
const DENTS: readonly { readonly angle: number; readonly reach: number; readonly r: number }[] = [
  { angle: 0.9, reach: 0.55, r: 0.08 },
  { angle: 3.8, reach: 0.68, r: 0.06 },
];
const DENT_ALPHA = 0.45;
const RUST_SPOTS = 5;
const RUST_ALPHA = 0.6;
const LID_SHADE_SIZE = LID_RADIUS * 1.2;
/** Edge-on the lid is a thin lens, and shading sized for the disc would swallow it. */
const LID_EDGE_ON_SHADE_SIZE = LID_DOME * 0.5;

interface LidFrame {
  readonly centre: V3;
  /** The disc's two in-plane axes and its outward normal; the dome bulges along the normal. */
  readonly u: V3;
  readonly v: V3;
  readonly normal: V3;
}

/**
 * Edge-on a lid strapped flat to the back is a thin pale lens, and a thin pale
 * lens reads as a blade. The profile cheats it about half of the way round to
 * the camera, so the dome, its ridges and its handle show.
 */
const LID_PROFILE_TURN = 0.8;

/**
 * Head-on, a hunched back turns its top toward the camera and the torso is
 * drawn standing as tall as its own depth; what rides on the back rises with
 * that surface. Left on the foreshortened spine, the lid sinks onto the rump.
 */
const HEAD_ON_BACK_RISE = 0.3;

function headOnRise(pose: GremlinPose, view: GremlinView): number {
  return view === 'side' ? 0 : HEAD_ON_BACK_RISE * Math.sin(Math.max(0, pose.hunch));
}

export function lidFrame(sk: Skeleton, pose: GremlinPose, view: GremlinView = 'back'): LidFrame {
  const base = offset(sk.pelvis, sk.spine, TORSO_LENGTH * LID_ALONG);
  const lift = pose.canLift * LID_JOSTLE + headOnRise(pose, view);
  const centre = add(offset(base, sk.back, LID_OUT), v3(0, -lift, 0));
  if (view !== 'side') return { centre, u: sk.right, v: sk.spine, normal: sk.back };
  const turn = LID_PROFILE_TURN;
  return {
    centre,
    u: add(scale(sk.right, Math.cos(turn)), scale(sk.back, -Math.sin(turn))),
    v: sk.spine,
    normal: add(scale(sk.back, Math.cos(turn)), scale(sk.right, Math.sin(turn))),
  };
}

const LID_JOSTLE = 0.3;

function rimRadiusAt(angle: number): number {
  const distance = Math.abs(((angle - RIM_DENT_AT + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const dent = clamp01(1 - distance / RIM_DENT_WIDTH);
  return LID_RADIUS * (1 - RIM_DENT_DEPTH * dent * dent);
}

function lidDiscPoint(lid: LidFrame, angle: number, reach: number, lift: number): V3 {
  const r = rimRadiusAt(angle) * reach;
  return v3(
    lid.centre.x +
      lid.u.x * Math.cos(angle) * r +
      lid.v.x * Math.sin(angle) * r +
      lid.normal.x * lift,
    lid.centre.y +
      lid.u.y * Math.cos(angle) * r +
      lid.v.y * Math.sin(angle) * r +
      lid.normal.y * lift,
    lid.centre.z +
      lid.u.z * Math.cos(angle) * r +
      lid.v.z * Math.sin(angle) * r +
      lid.normal.z * lift,
  );
}

/** The dome's height over the disc at a share of the radius out from its centre. */
function domeLift(reach: number): number {
  return LID_DOME * (1 - reach * reach);
}

function lidRing(lid: LidFrame, view: GremlinView, reach: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < LID_RIM_STEPS; i++) {
    const angle = (i / LID_RIM_STEPS) * Math.PI * 2;
    points.push(project(lidDiscPoint(lid, angle, reach, domeLift(reach)), view));
  }
  return points;
}

/** Rings sampled across the dome, rim to apex, for the lid's outline. */
const LID_HULL_RINGS = [1, 0.75, 0.5, 0.25, 0] as const;

/** The lid's silhouette: the hull of its rim and its dome, which is right from any side. */
function lidSilhouette(lid: LidFrame, view: GremlinView): Pt[] {
  const points: Pt[] = [];
  for (const reach of LID_HULL_RINGS) points.push(...lidRing(lid, view, reach));
  return convexHull(points);
}

/** Whether the lid's outer face, with its ridges and handle, is turned to the camera. */
function lidFacesCamera(lid: LidFrame, view: GremlinView): boolean {
  return nearness(add(lid.centre, lid.normal), view) > nearness(lid.centre, view);
}

export function lidForm(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form {
  const lid = lidFrame(sk, pose, view);
  const outer = lidFacesCamera(lid, view);
  const shadeSize = view === 'side' ? LID_EDGE_ON_SHADE_SIZE : LID_SHADE_SIZE;
  return form(tracePolygon(lidSilhouette(lid, view)), STEEL, shadeSize, (ctx) => {
    ctx.lineCap = 'round';
    const rim = lidRing(lid, view, 1);
    ctx.strokeStyle = rgba(STEEL.light, RIDGE_LIGHT_ALPHA);
    ctx.lineWidth = RIDGE_WIDTH;
    ctx.beginPath();
    tracePolygon(rim.map((p) => pt(p.x + RIDGE_WIDTH * 0.6, p.y + RIDGE_WIDTH * 0.6)))(ctx);
    ctx.stroke();
    if (!outer) return;
    for (const reach of RIDGES) {
      const ring = lidRing(lid, view, reach);
      ctx.strokeStyle = rgba(STEEL.deep, RIDGE_ALPHA);
      ctx.lineWidth = RIDGE_WIDTH;
      ctx.beginPath();
      tracePolygon(ring)(ctx);
      ctx.stroke();
      ctx.strokeStyle = rgba(STEEL.light, RIDGE_LIGHT_ALPHA);
      ctx.lineWidth = RIDGE_WIDTH * 0.6;
      ctx.beginPath();
      tracePolygon(ring.map((p) => pt(p.x - RIDGE_WIDTH * 0.7, p.y - RIDGE_WIDTH * 0.7)))(ctx);
      ctx.stroke();
    }
    for (const dent of DENTS) {
      const c = project(lidDiscPoint(lid, dent.angle, dent.reach, domeLift(dent.reach)), view);
      ctx.fillStyle = rgba(STEEL.deep, DENT_ALPHA);
      ctx.beginPath();
      traceEllipse(
        pt(c.x + dent.r * 0.25, c.y + dent.r * 0.25),
        dent.r,
        dent.r * 0.7,
        dent.angle,
      )(ctx);
      ctx.fill();
      ctx.fillStyle = rgba(STEEL.light, DENT_ALPHA);
      ctx.beginPath();
      traceEllipse(
        pt(c.x - dent.r * 0.35, c.y - dent.r * 0.3),
        dent.r * 0.55,
        dent.r * 0.3,
        dent.angle,
      )(ctx);
      ctx.fill();
    }
    for (let i = 0; i < RUST_SPOTS; i++) {
      const angle = hash1(i + RUST_SEED) * Math.PI * 2;
      const reach = 0.3 + hash1(i + RUST_SEED * 2) * 0.65;
      const c = project(lidDiscPoint(lid, angle, reach, domeLift(reach)), view);
      ctx.fillStyle = rgba(RUST, RUST_ALPHA);
      ctx.beginPath();
      ctx.arc(c.x, c.y, RUST_RADIUS * (0.5 + hash1(i + RUST_SEED * 3)), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

const RUST_SEED = 41;
const RUST_RADIUS = 0.025;

/** The handle on the lid's crown, a bar across the dome. */
export function lidHandleForm(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form | null {
  const lid = lidFrame(sk, pose, view);
  if (!lidFacesCamera(lid, view) && view !== 'side') return null;
  const apex = offset(lid.centre, lid.normal, LID_DOME + HANDLE_RISE);
  const a = project(offset(apex, lid.u, -HANDLE_HALF), view);
  const b = project(offset(apex, lid.u, HANDLE_HALF), view);
  const c = project(apex, view);
  const trace =
    Math.hypot(b.x - a.x, b.y - a.y) < HANDLE_RADIUS
      ? traceEllipse(c, HANDLE_RADIUS * 1.3, HANDLE_RADIUS * 1.1)
      : tracePolygon([
          pt(a.x, a.y - HANDLE_RADIUS),
          pt(b.x, b.y - HANDLE_RADIUS),
          pt(b.x, b.y + HANDLE_RADIUS),
          pt(a.x, a.y + HANDLE_RADIUS),
        ]);
  return form(trace, STEEL, HANDLE_RADIUS * 2);
}

// ── Straps ───────────────────────────────────────────────────────────────────

const STRAP_WIDTH = 0.045;
const STRAP_EDGE = 0.016;

/** The two straps over the shoulders, from the top of the lid to under each arm. */
export function paintStraps(ctx: Ctx, sk: Skeleton, pose: GremlinPose, view: GremlinView): void {
  const lid = lidFrame(sk, pose, view);
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const lidTop = lidDiscPoint(lid, Math.PI / 2 + side * STRAP_SPLAY, STRAP_LID_REACH, 0);
    const shoulder = offset(sk.chest, sk.right, side * STRAP_ACROSS);
    const chestFront = offset(
      offset(sk.pelvis, sk.spine, TORSO_LENGTH * STRAP_FRONT_ALONG),
      sk.back,
      -STRAP_FRONT_OUT,
    );
    const underArm = offset(chestFront, sk.right, side * STRAP_UNDERARM);
    const path = [lidTop, shoulder, underArm].map((p) => project(p, view));
    ctx.strokeStyle = STRAP.deep;
    ctx.lineWidth = STRAP_WIDTH + STRAP_EDGE * 2;
    strokeCurve(ctx, path);
    ctx.strokeStyle = STRAP.mid;
    ctx.lineWidth = STRAP_WIDTH;
    strokeCurve(ctx, path);
  }
  ctx.restore();
}

const STRAP_SPLAY = 0.5;
/** The straps are riveted in from the lid's rim. */
const STRAP_LID_REACH = 0.85;
const STRAP_ACROSS = 0.15;
const STRAP_FRONT_ALONG = 0.6;
const STRAP_FRONT_OUT = 0.2;
const STRAP_UNDERARM = 0.21;

// ── The sack ─────────────────────────────────────────────────────────────────

/** The sack's lumps, in (across, along the spine, out of the back) from the pelvis, with radii. */
const SACK_LUMPS: readonly {
  readonly x: number;
  readonly along: number;
  readonly out: number;
  readonly r: number;
}[] = [
  { x: -0.2, along: 0.12, out: 0.32, r: 0.22 },
  { x: 0.2, along: 0.08, out: 0.33, r: 0.21 },
  { x: 0.0, along: 0.26, out: 0.36, r: 0.23 },
  { x: 0.2, along: 0.3, out: 0.22, r: 0.12 },
  { x: -0.21, along: 0.33, out: 0.2, r: 0.11 },
];
const LUMP_SQUASH = 0.9;
const SHEEN_ALPHA = 0.7;
const SHEEN_WIDTH = 0.018;
const SHEEN_REACH = 0.62;
/** The streak runs round the upper left of each lump, toward the light. */
const SHEEN_FROM = Math.PI * 1.05;
const SHEEN_TO = Math.PI * 1.45;

function sackLumpCentre(
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
  lump: (typeof SACK_LUMPS)[number],
): V3 {
  const base = offset(
    offset(offset(sk.pelvis, sk.right, lump.x), sk.spine, TORSO_LENGTH * lump.along),
    sk.back,
    lump.out,
  );
  return v3(base.x, base.y - pose.canLift * SACK_JOSTLE - headOnRise(pose, view), base.z);
}

const SACK_JOSTLE = 0.6;

export function sackForms(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form[] {
  return [...SACK_LUMPS]
    .map((lump) => ({ lump, centre: sackLumpCentre(sk, pose, view, lump) }))
    .sort((a, b) => nearness(a.centre, view) - nearness(b.centre, view))
    .map(({ lump, centre }) => {
      const c = project(centre, view);
      return form(traceEllipse(c, lump.r, lump.r * LUMP_SQUASH), BIN_BAG, lump.r * 2, (ctx) => {
        // Plastic shines in thin curved streaks where it is stretched over
        // whatever is inside.
        ctx.strokeStyle = rgba(BIN_BAG_SHEEN, SHEEN_ALPHA);
        ctx.lineWidth = SHEEN_WIDTH;
        ctx.beginPath();
        ctx.arc(c.x, c.y, lump.r * SHEEN_REACH, SHEEN_FROM, SHEEN_TO);
        ctx.stroke();
      });
    });
}

// ── Cans ─────────────────────────────────────────────────────────────────────

/**
 * The cans hang off the sack's right side, out past the hip: hung in front of
 * the leg, a striped string of them reads as a sock.
 */
const CAN_ANCHOR = { x: 0.34, along: 0.22, out: 0.3 } as const;
const CAN_SPACING = 0.2;
const CAN_COUNT = 3;
const CAN_RX = 0.065;
const CAN_RY = 0.08;
const STRING_WIDTH = 0.012;
/** Each can down the string swings a little further than the one above it. */
const CAN_SWING_GROWTH = 0.35;
const CAN_TILT = 0.5;
const CAN_MOUTH_SHARE = 0.85;
const CAN_RIM_RY = 0.024;

/** A can seen side-on: a tilted rectangle, its open top painted on as a dark ellipse. */
function traceCan(can: CanPlacement): Trace {
  return (ctx) => {
    const cos = Math.cos(can.tilt);
    const sin = Math.sin(can.tilt);
    const at = (x: number, y: number): Pt =>
      pt(can.c.x + x * cos - y * sin, can.c.y + x * sin + y * cos);
    const corners = [
      at(-CAN_RX, -CAN_RY),
      at(CAN_RX, -CAN_RY),
      at(CAN_RX, CAN_RY),
      at(-CAN_RX, CAN_RY),
    ];
    tracePolygon(corners)(ctx);
  };
}

interface CanPlacement {
  readonly c: Pt;
  readonly tilt: number;
  readonly depth: number;
}

function canPlacements(
  sk: Skeleton,
  pose: GremlinPose,
  view: GremlinView,
): { anchor: Pt; cans: CanPlacement[] } {
  const anchor3 = v3(
    sk.pelvis.x + CAN_ANCHOR.x,
    sk.pelvis.y - TORSO_LENGTH * CAN_ANCHOR.along - pose.canLift,
    sk.pelvis.z - CAN_ANCHOR.out,
  );
  const cans: CanPlacement[] = [];
  let at = anchor3;
  for (let i = 0; i < CAN_COUNT; i++) {
    const swing = pose.canSwing * (1 + i * CAN_SWING_GROWTH);
    // Each can hangs off the one above by its own loop of string, so the
    // string zig-zags and the cans hang crooked: hung straight in a column
    // they read as one striped stick.
    const zig = i % 2 === 0 ? 1 : -1;
    const dir = normalize(v3(zig * CAN_ZIGZAG, Math.cos(swing), Math.sin(swing)));
    at = offset(at, dir, CAN_SPACING);
    cans.push({
      c: project(at, view),
      tilt: swing * CAN_TILT + zig * CAN_CROOKED + (hash1(i + CAN_SEED) - HALF) * CAN_TILT_JITTER,
      depth: nearness(at, view),
    });
  }
  return { anchor: project(anchor3, view), cans };
}

const CAN_SEED = 59;
const CAN_ZIGZAG = 0.45;
const CAN_CROOKED = 0.4;
const CAN_TILT_JITTER = 0.3;
const HALF = 0.5;

export function paintCanString(ctx: Ctx, sk: Skeleton, pose: GremlinPose, view: GremlinView): void {
  const { anchor, cans } = canPlacements(sk, pose, view);
  ctx.save();
  ctx.strokeStyle = STRING;
  ctx.lineWidth = STRING_WIDTH;
  ctx.lineCap = 'round';
  strokeCurve(ctx, [anchor, ...cans.map((can) => can.c)]);
  ctx.restore();
}

export function canForms(sk: Skeleton, pose: GremlinPose, view: GremlinView): Form[] {
  const { cans } = canPlacements(sk, pose, view);
  return cans.map((can) =>
    form(traceCan(can), TIN, CAN_RX * 2, (ctx) => {
      ctx.save();
      ctx.translate(can.c.x, can.c.y);
      ctx.rotate(can.tilt);
      // The open top, dark inside: what turns a pale block into a can.
      ctx.fillStyle = TIN.deep;
      ctx.beginPath();
      ctx.ellipse(0, -CAN_RY + CAN_RIM_RY, CAN_RX * CAN_MOUTH_SHARE, CAN_RIM_RY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }),
  );
}

export function canDepth(sk: Skeleton, pose: GremlinPose, view: GremlinView): number {
  const { cans } = canPlacements(sk, pose, view);
  return cans.reduce((sum, can) => sum + can.depth, 0) / cans.length;
}
