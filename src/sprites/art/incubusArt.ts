/**
 * The Incubus's own anatomy and clothes, painted onto Carl's rig as
 * attachments (`CarlAttachments` in `carl/figure.ts`): devil horns, folded bat
 * wings, a forked tail, an open-necked shirt with a sash, trousers and boots.
 *
 * Everything here is in the rig's figure units — origin between the feet, +Y
 * down, one unit a little under half a tile — and hung off the solved
 * skeleton, so it follows the body wherever a pose puts it. Each form is
 * shaded with Carl's own recipe (`shadeForm`), so the parts light the same way
 * as the body they are attached to, and they are composed inside his figure
 * so the silhouette outline runs round them too.
 *
 * Silhouette carries the read at the 32 px tile: the horns are the two points
 * above the head, the wings the two peaks over the shoulders and the scalloped
 * edge by the hips, the tail the curl beside the legs. Interior detail is a
 * bonus at that size, never the thing the shape depends on.
 */

import { type CarlAttachments } from './carl/figure';
import { footSoleLandmarks, LEFT_FOOT_OUT, RIGHT_FOOT_OUT } from './carl/feet';
import { headAngle } from './carl/head';
import { addCapsule, crease, FIGURE_CREASE_LAYERS, shadeForm } from './carl/paint';
import {
  deriveGlossRamp,
  deriveRamp,
  type GlossRamp,
  type Ramp,
  receded,
  recededGloss,
  FAR_LIMB_SHADE,
} from './carl/palette';
import { type BoneChain, type CarlPose, type Skeleton, type ViewSpec } from './carl/rig';
import { WAIST_HALF } from './carl/proportions';
import { lerp, type Pt, rgba } from './carlArt';
import { strokeSoftCrease } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Warm dusky grey. The ramp leans mauve in the light and plum in the shadow:
 * a grey that leans green or blue reads as a corpse, and one with no hue at
 * all reads as stone. The lit steps stay warm so the face reads as living.
 */
export const INCUBUS_SKIN: Ramp = {
  deep: '#31202b',
  shadow: '#4c3844',
  dark: '#634f5a',
  mid: '#746069',
  base: '#8b787e',
  light: '#a99799',
  rim: '#cbb8b0',
};

/** Blue-black, slicked back: a dark mass the horns stand out of by value. */
export const INCUBUS_HAIR: Ramp = {
  deep: '#0d0a12',
  shadow: '#16111c',
  dark: '#1f1826',
  mid: '#272030',
  base: '#30283a',
  light: '#4a4458',
  rim: '#6b6a80',
};

/** A wine-red silk shirt: rich against the grey skin, and dark enough to make the gold sash sing. */
export const INCUBUS_SHIRT: GlossRamp = deriveGlossRamp('#7a1d36');

const SASH: GlossRamp = deriveGlossRamp('#c99a36');
const TROUSERS: GlossRamp = deriveGlossRamp('#2e2934');
const BOOTS: GlossRamp = deriveGlossRamp('#2a1c1e');
const WING_MEMBRANE: Ramp = deriveRamp('#58314b');
const WING_BONE: Ramp = deriveRamp('#8e7a84');

/**
 * Horn: near-black keratin at the root, polished to bone at the tip. The pale
 * tip is what separates each horn from the black hair it grows out of.
 */
const HORN: GlossRamp = {
  deep: '#150a0c',
  shadow: '#2a1215',
  dark: '#3d1a1c',
  mid: '#521f21',
  base: '#6a2a28',
  light: '#94453a',
  rim: '#c07a62',
  specular: '#f0d2b8',
};
const HORN_TIP = '#ecdcc0';
/** How far along the horn, root to tip, its pale tip starts to show. */
const HORN_TIP_START = 0.45;

// ── Motion ───────────────────────────────────────────────────────────────────

/**
 * What the choreography hands the attachments on one frame, beyond the pose:
 * the rig has no joints for a tail or wings.
 */
export interface IncubusMotion {
  /** Tail swing, −1 to 1, sideways from its rest curl. */
  readonly tailSway: number;
  /** How far the folded wings rise on the breath or the stride, 0 to 1. */
  readonly wingLift: number;
}

export const INCUBUS_AT_REST: IncubusMotion = { tailSway: 0, wingLift: 0 };

// ── Curves ───────────────────────────────────────────────────────────────────

/** Samples along a curve: enough that a tapered edge reads as smooth at a 3x review. */
const CURVE_SAMPLES = 14;

function quadPoint(a: Pt, control: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

function cubicPoint(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
    y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y,
  };
}

/**
 * Traces a tapered tube along `spine`, its half-width running from `rootHalf`
 * to `tipHalf`: one closed outline rather than a chain of capsules, so there
 * is no seam where two caps overlap.
 */
function traceTaper(ctx: Ctx, spine: readonly Pt[], rootHalf: number, tipHalf: number): void {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const last = spine.length - 1;
  spine.forEach((p, index) => {
    const before = spine[Math.max(0, index - 1)];
    const after = spine[Math.min(last, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const half = lerp(rootHalf, tipHalf, index / last);
    const nx = -dy / length;
    const ny = dx / length;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  });
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let index = right.length - 1; index >= 0; index--)
    ctx.lineTo(right[index].x, right[index].y);
  ctx.closePath();
}

function sampleQuad(a: Pt, control: Pt, b: Pt): Pt[] {
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_unused, i) =>
    quadPoint(a, control, b, i / CURVE_SAMPLES),
  );
}

function sampleCubic(a: Pt, c1: Pt, c2: Pt, b: Pt): Pt[] {
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_unused, i) =>
    cubicPoint(a, c1, c2, b, i / CURVE_SAMPLES),
  );
}

function offsetPt(p: Pt, dx: number, dy: number): Pt {
  return { x: p.x + dx, y: p.y + dy };
}

// ── Horns ────────────────────────────────────────────────────────────────────

/**
 * One horn in the head's own frame (origin at the head's centre, rotated with
 * it), as root, bend and tip. Head-on they leave the temples outward and hook
 * up; in profile they rise off the crown and sweep back. Sized well past what
 * a real skull would carry: at the 32 px tile a horn this long is five pixels,
 * and anything shorter is a bump in the hair.
 */
const HORN_HEAD_ON = {
  root: { x: 0.085, y: -0.12 },
  bend: { x: 0.27, y: -0.2 },
  tip: { x: 0.17, y: -0.42 },
} as const;
const HORN_PROFILE = {
  root: { x: 0.035, y: -0.13 },
  bend: { x: 0.06, y: -0.36 },
  tip: { x: -0.16, y: -0.4 },
} as const;
/** The far horn in profile, shifted up and forward so its tip clears the near one's. */
const FAR_HORN_SHIFT = { x: 0.045, y: -0.012 } as const;
const HORN_ROOT_HALF = 0.05;
const HORN_TIP_HALF = 0.004;
const HORN_SPECULAR = 0.7;
/** A ring or two round the base: the grooves that make it read as horn, not a tooth. */
const HORN_RING_AT = [0.18, 0.32] as const;
const HORN_RING_WIDTH = 0.006;
const HORN_RING_OPACITY = 0.7;

interface HornShape {
  readonly root: Pt;
  readonly bend: Pt;
  readonly tip: Pt;
}

function mirrored(shape: HornShape): HornShape {
  return {
    root: { x: -shape.root.x, y: shape.root.y },
    bend: { x: -shape.bend.x, y: shape.bend.y },
    tip: { x: -shape.tip.x, y: shape.tip.y },
  };
}

function shifted(shape: HornShape, by: Pt): HornShape {
  return {
    root: offsetPt(shape.root, by.x, by.y),
    bend: offsetPt(shape.bend, by.x, by.y),
    tip: offsetPt(shape.tip, by.x, by.y),
  };
}

function paintHorn(ctx: Ctx, shape: HornShape, ramp: GlossRamp): void {
  const spine = sampleQuad(shape.root, shape.bend, shape.tip);
  const trace = (): void => traceTaper(ctx, spine, HORN_ROOT_HALF, HORN_TIP_HALF);
  shadeForm(
    ctx,
    trace,
    { from: shape.root, to: shape.tip },
    ramp,
    { halfWidth: HORN_ROOT_HALF, specular: HORN_SPECULAR },
    () => {
      const tipGradient = ctx.createLinearGradient(
        shape.root.x,
        shape.root.y,
        shape.tip.x,
        shape.tip.y,
      );
      tipGradient.addColorStop(0, rgba(HORN_TIP, 0));
      tipGradient.addColorStop(HORN_TIP_START, rgba(HORN_TIP, 0));
      tipGradient.addColorStop(1, rgba(HORN_TIP, 1));
      ctx.fillStyle = tipGradient;
      ctx.fillRect(
        Math.min(shape.root.x, shape.tip.x, shape.bend.x) - HORN_ROOT_HALF,
        Math.min(shape.root.y, shape.tip.y, shape.bend.y) - HORN_ROOT_HALF,
        Math.abs(shape.tip.x - shape.root.x) + Math.abs(shape.bend.x) + HORN_ROOT_HALF * 2,
        Math.abs(shape.tip.y - shape.root.y) + HORN_ROOT_HALF * 2,
      );
      for (const at of HORN_RING_AT) {
        const index = Math.round(at * CURVE_SAMPLES);
        const p = spine[index];
        const next = spine[index + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const length = Math.hypot(dx, dy) || 1;
        const half = lerp(HORN_ROOT_HALF, HORN_TIP_HALF, at);
        const nx = (-dy / length) * half;
        const ny = (dx / length) * half;
        crease(
          ctx,
          () => {
            ctx.moveTo(p.x + nx, p.y + ny);
            ctx.lineTo(p.x - nx, p.y - ny);
          },
          HORN_RING_WIDTH,
          ramp,
          HORN_RING_OPACITY,
        );
      }
    },
  );
}

function hornShapes(view: ViewSpec): { far: HornShape[]; near: HornShape[] } {
  if (view.profile) {
    return { far: [shifted(HORN_PROFILE, FAR_HORN_SHIFT)], near: [HORN_PROFILE] };
  }
  return { far: [], near: [HORN_HEAD_ON, mirrored(HORN_HEAD_ON)] };
}

function inHeadFrame(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, paint: () => void): void {
  ctx.save();
  try {
    ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
    ctx.rotate(headAngle(pose));
    paint();
  } finally {
    ctx.restore();
  }
}

function drawHorns(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  const shapes = hornShapes(view);
  inHeadFrame(ctx, skeleton, pose, () => {
    for (const shape of shapes.far) paintHorn(ctx, shape, recededGloss(HORN, FAR_LIMB_SHADE));
    for (const shape of shapes.near) paintHorn(ctx, shape, HORN);
  });
}

// ── Wings ────────────────────────────────────────────────────────────────────

/**
 * A folded bat wing, relative to the shoulder centre, for the wing on the
 * figure's +X side. The wrist stands up past the shoulder as the peak; the
 * outer edge bulges past the hanging arm; the finger bones run down to a
 * scalloped trailing edge a little above the knee. `side` below mirrors it.
 */
const WING_HEAD_ON = {
  root: { x: 0.2, y: 0.1 },
  wrist: { x: 0.33, y: -0.4 },
  claw: { x: 0.25, y: -0.5 },
  outerBulge: { x: 0.62, y: -0.02 },
  tip: { x: 0.45, y: 0.86 },
  /** Where the finger bones end on the trailing edge, outermost first. */
  scallops: [
    { x: 0.33, y: 0.76 },
    { x: 0.21, y: 0.8 },
    { x: 0.1, y: 0.62 },
  ],
} as const;
/** In profile the wing lies against his back: the same wing turned edge-on, behind him (−X). */
const WING_PROFILE = {
  root: { x: -0.08, y: 0.08 },
  wrist: { x: -0.32, y: -0.38 },
  claw: { x: -0.22, y: -0.48 },
  outerBulge: { x: -0.46, y: 0.08 },
  tip: { x: -0.34, y: 0.86 },
  scallops: [
    { x: -0.26, y: 0.74 },
    { x: -0.17, y: 0.76 },
    { x: -0.08, y: 0.58 },
  ],
} as const;
/** The far wing edge-on: a little higher and further back, so its peak shows behind the near one. */
const FAR_WING_SHIFT = { x: 0.07, y: -0.05 } as const;
/** How far the wrist rises at full lift. Subtle: a folded wing settling, not a flap. */
const WING_LIFT_RISE = 0.035;
/** How much a scallop sags into its bay between two bones, as a share of the bay's width. */
const SCALLOP_SAG = 0.32;
const WING_BONE_ROOT_HALF = 0.024;
const WING_BONE_TIP_HALF = 0.008;
const WING_FINGER_WIDTH = 0.016;
const WING_FINGER_OPACITY = 0.9;
/** The fold's shadow is wider than the bone that makes it. */
const WING_FOLD_WIDTH_SHARE = 1.8;
const WING_CLAW_HALF = 0.022;
/** The membrane's shading axis runs down the wing; this is its half-width across. */
const WING_SHADE_HALF = 0.22;
const WING_MEMBRANE_CONTRAST = 0.85;

interface WingShape {
  readonly root: Pt;
  readonly wrist: Pt;
  readonly claw: Pt;
  readonly outerBulge: Pt;
  readonly tip: Pt;
  readonly scallops: readonly Pt[];
}

function wingAt(shape: WingShape, origin: Pt, side: number, lift: number): WingShape {
  const place = (p: Pt, rise = 0): Pt => ({
    x: origin.x + p.x * side,
    y: origin.y + p.y - rise,
  });
  const rise = lift * WING_LIFT_RISE;
  return {
    root: place(shape.root),
    wrist: place(shape.wrist, rise),
    claw: place(shape.claw, rise),
    outerBulge: place(shape.outerBulge, rise / 2),
    tip: place(shape.tip),
    scallops: shape.scallops.map((p) => place(p)),
  };
}

function traceWing(ctx: Ctx, wing: WingShape): void {
  ctx.beginPath();
  ctx.moveTo(wing.root.x, wing.root.y);
  ctx.lineTo(wing.wrist.x, wing.wrist.y);
  ctx.quadraticCurveTo(wing.outerBulge.x, wing.outerBulge.y, wing.tip.x, wing.tip.y);
  let previous = wing.tip;
  for (const scallop of wing.scallops) {
    const mid = { x: (previous.x + scallop.x) / 2, y: (previous.y + scallop.y) / 2 };
    const bay = Math.hypot(scallop.x - previous.x, scallop.y - previous.y);
    // The membrane between two bones sags up toward the wrist.
    ctx.quadraticCurveTo(mid.x, mid.y - bay * SCALLOP_SAG, scallop.x, scallop.y);
    previous = scallop;
  }
  ctx.closePath();
}

function paintWing(ctx: Ctx, wing: WingShape, membrane: Ramp, bone: Ramp): void {
  shadeForm(
    ctx,
    () => traceWing(ctx, wing),
    { from: wing.wrist, to: wing.tip },
    membrane,
    { halfWidth: WING_SHADE_HALF, contrast: WING_MEMBRANE_CONTRAST, softness: 2 },
    () => {
      // Each finger bone is a pale ridge with the membrane folding into
      // shadow along one side of it: the ridge alone reads as a painted line.
      for (const end of [wing.tip, ...wing.scallops]) {
        const traceFinger = (): void => {
          ctx.moveTo(wing.wrist.x, wing.wrist.y);
          ctx.lineTo(end.x, end.y);
        };
        crease(
          ctx,
          traceFinger,
          WING_FINGER_WIDTH * WING_FOLD_WIDTH_SHARE,
          membrane,
          WING_FINGER_OPACITY,
        );
        strokeSoftCrease(
          ctx,
          WING_FINGER_WIDTH,
          bone.light,
          traceFinger,
          WING_FINGER_OPACITY,
          FIGURE_CREASE_LAYERS,
        );
      }
    },
  );
  // The forearm: the one heavy bone, root to wrist, along the leading edge.
  const arm = [wing.root, wing.wrist];
  shadeForm(
    ctx,
    () => traceTaper(ctx, arm, WING_BONE_ROOT_HALF, WING_BONE_TIP_HALF * 2),
    {
      from: wing.root,
      to: wing.wrist,
    },
    bone,
    { halfWidth: WING_BONE_ROOT_HALF },
  );
  shadeForm(
    ctx,
    () => traceTaper(ctx, [wing.wrist, wing.claw], WING_CLAW_HALF, WING_BONE_TIP_HALF / 2),
    { from: wing.wrist, to: wing.claw },
    HORN,
    { halfWidth: WING_CLAW_HALF },
  );
}

/** The wings' root: between the shoulder blades, which ride the shoulder line. */
function wingOrigin(skeleton: Skeleton): Pt {
  return skeleton.shoulderCentre;
}

function headOnWings(skeleton: Skeleton, lift: number): WingShape[] {
  const origin = wingOrigin(skeleton);
  return [wingAt(WING_HEAD_ON, origin, -1, lift), wingAt(WING_HEAD_ON, origin, 1, lift)];
}

function profileWing(skeleton: Skeleton, lift: number, far: boolean): WingShape {
  const origin = wingOrigin(skeleton);
  const shift = far ? FAR_WING_SHIFT : { x: 0, y: 0 };
  return wingAt(WING_PROFILE, offsetPt(origin, shift.x, shift.y), 1, lift);
}

// ── Tail ─────────────────────────────────────────────────────────────────────

/**
 * The tail as a cubic from the base of the spine: it drops, swings out past
 * the legs and curls back up, so the fork at its end stands clear of every
 * other shape at knee height. Relative to the hip, for the tail swinging to
 * +X; `sway` bends the lower curve.
 */
const TAIL_HEAD_ON = {
  root: { x: 0.02, y: 0.02 },
  c1: { x: 0.12, y: 0.52 },
  c2: { x: 0.52, y: 0.78 },
  tip: { x: 0.52, y: 0.36 },
} as const;
const TAIL_PROFILE = {
  root: { x: -0.13, y: 0.0 },
  c1: { x: -0.38, y: 0.4 },
  c2: { x: -0.72, y: 0.74 },
  tip: { x: -0.66, y: 0.32 },
} as const;
const TAIL_ROOT_HALF = 0.036;
const TAIL_TIP_HALF = 0.016;
/** How far the tip wanders at full sway, in figure units. */
const TAIL_SWAY_REACH = 0.06;
/** The fork: two barbs splitting off the tip, each this long, this far apart. */
const FORK_LENGTH = 0.1;
const FORK_SPREAD = 0.62;
const FORK_ROOT_HALF = 0.026;
const FORK_TIP_HALF = 0.003;
/** How far back down the tail the fork's barbs start, so they grow out of it rather than off its end. */
const FORK_BACKSET = 0.02;
/** Where each barb's curve is pulled: turned further out than its end, and part way along it. */
const FORK_CURL_TURN = 1.3;
const FORK_CURL_REACH = 0.6;

interface TailCurve {
  readonly root: Pt;
  readonly c1: Pt;
  readonly c2: Pt;
  readonly tip: Pt;
}

function tailAt(shape: TailCurve, hip: Pt, side: number, sway: number): TailCurve {
  const place = (p: Pt, swing: number): Pt => ({
    x: hip.x + p.x * side + sway * TAIL_SWAY_REACH * swing * side,
    y: hip.y + p.y,
  });
  return {
    root: place(shape.root, 0),
    c1: place(shape.c1, 0),
    c2: place(shape.c2, 1),
    tip: place(shape.tip, 1),
  };
}

function paintTail(ctx: Ctx, tail: TailCurve, skin: Ramp): void {
  const spine = sampleCubic(tail.root, tail.c1, tail.c2, tail.tip);
  shadeForm(
    ctx,
    () => traceTaper(ctx, spine, TAIL_ROOT_HALF, TAIL_TIP_HALF),
    { from: tail.root, to: tail.tip },
    skin,
    { halfWidth: TAIL_ROOT_HALF },
  );
  const before = spine[spine.length - 2];
  const heading = Math.atan2(tail.tip.y - before.y, tail.tip.x - before.x);
  const base = {
    x: tail.tip.x - Math.cos(heading) * FORK_BACKSET,
    y: tail.tip.y - Math.sin(heading) * FORK_BACKSET,
  };
  for (const turn of [-FORK_SPREAD, FORK_SPREAD]) {
    const angle = heading + turn;
    const end = {
      x: base.x + Math.cos(angle) * FORK_LENGTH,
      y: base.y + Math.sin(angle) * FORK_LENGTH,
    };
    // Each barb curves back toward the other a little, like a pitchfork's tines.
    const control = {
      x: base.x + Math.cos(heading + turn * FORK_CURL_TURN) * FORK_LENGTH * FORK_CURL_REACH,
      y: base.y + Math.sin(heading + turn * FORK_CURL_TURN) * FORK_LENGTH * FORK_CURL_REACH,
    };
    const barb = sampleQuad(base, control, end);
    shadeForm(
      ctx,
      () => traceTaper(ctx, barb, FORK_ROOT_HALF, FORK_TIP_HALF),
      { from: base, to: end },
      HORN,
      { halfWidth: FORK_ROOT_HALF, specular: HORN_SPECULAR },
    );
  }
}

function tailFor(skeleton: Skeleton, view: ViewSpec, sway: number): TailCurve {
  if (view.profile) return tailAt(TAIL_PROFILE, skeleton.hip, 1, sway);
  // Head-on the tail comes round his right; from behind that is the same
  // side of the picture, since the front view is drawn mirrored.
  const side = view.mirrored ? -1 : 1;
  return tailAt(TAIL_HEAD_ON, skeleton.hip, side, sway);
}

// ── Shirt opening and sash ───────────────────────────────────────────────────

/** The open collar: a deep V of bare chest, from either side of the neck down the sternum. */
const COLLAR_HALF = 0.085;
const COLLAR_DROP = 0.02;
const V_DEPTH = 0.3;
/** How far the collar's points fold back out over the shoulders. */
const LAPEL_REACH = 0.07;
const LAPEL_DROP = 0.09;
const LAPEL_WIDTH = 0.018;
const LAPEL_OPACITY = 0.9;
/** The line under each pectoral, and the groove down the middle, as a share of the V's depth. */
const PEC_LINE_AT = 0.62;
const PEC_LINE_HALF = 0.07;
const PEC_LINE_WIDTH = 0.014;
const PEC_LINE_OPACITY = 0.55;
/** The sternum groove starts part way down to the pec line, below the collarbones. */
const STERNUM_START_SHARE = 0.5;
const CHEST_SHADE_HALF = 0.09;
/** In profile the opening is a sliver at the front of the chest. */
const PROFILE_V_FRONT = 0.12;
const PROFILE_V_BACKSET = 0.05;
/** Edge-on the V is foreshortened: less of its depth faces the camera. */
const PROFILE_V_DEPTH_SHARE = 0.7;

function paintChestOpening(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, skin: Ramp): void {
  if (view.showsBack) return;
  const neck = skeleton.shoulderCentre;
  if (view.profile) {
    const top = offsetPt(neck, PROFILE_V_FRONT, -COLLAR_DROP);
    const apex = offsetPt(
      neck,
      PROFILE_V_FRONT - PROFILE_V_BACKSET / 2,
      V_DEPTH * PROFILE_V_DEPTH_SHARE,
    );
    const back = offsetPt(neck, PROFILE_V_FRONT - PROFILE_V_BACKSET, -COLLAR_DROP);
    shadeForm(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(back.x, back.y);
        ctx.lineTo(top.x, top.y);
        ctx.lineTo(apex.x, apex.y);
        ctx.closePath();
      },
      { from: top, to: apex },
      skin,
      { halfWidth: PROFILE_V_BACKSET },
    );
    return;
  }
  const left = offsetPt(neck, -COLLAR_HALF, -COLLAR_DROP);
  const right = offsetPt(neck, COLLAR_HALF, -COLLAR_DROP);
  const apex = offsetPt(neck, 0, V_DEPTH);
  const traceV = (): void => {
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(neck.x, neck.y + COLLAR_DROP, right.x, right.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.closePath();
  };
  shadeForm(ctx, traceV, { from: neck, to: apex }, skin, { halfWidth: CHEST_SHADE_HALF }, () => {
    const lineY = neck.y + V_DEPTH * PEC_LINE_AT;
    crease(
      ctx,
      () => {
        ctx.moveTo(neck.x - PEC_LINE_HALF, lineY - PEC_LINE_WIDTH);
        ctx.quadraticCurveTo(neck.x - PEC_LINE_HALF / 2, lineY + PEC_LINE_WIDTH, neck.x, lineY);
        ctx.quadraticCurveTo(
          neck.x + PEC_LINE_HALF / 2,
          lineY + PEC_LINE_WIDTH,
          neck.x + PEC_LINE_HALF,
          lineY - PEC_LINE_WIDTH,
        );
        ctx.moveTo(neck.x, neck.y + V_DEPTH * PEC_LINE_AT * STERNUM_START_SHARE);
        ctx.lineTo(neck.x, apex.y);
      },
      PEC_LINE_WIDTH,
      skin,
      PEC_LINE_OPACITY,
    );
  });
  // The collar's edges fold back over the chest as two lit lapels.
  ctx.save();
  ctx.strokeStyle = rgba(INCUBUS_SHIRT.light, LAPEL_OPACITY);
  ctx.lineWidth = LAPEL_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [point, out] of [
    [left, -1],
    [right, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(point.x + out * LAPEL_REACH, point.y + LAPEL_DROP);
    ctx.lineTo(point.x, point.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.stroke();
  }
  ctx.restore();
}

const SASH_HALF_HEIGHT = 0.042;
/** The sash is tied a little wider than the waist: it sits on the shirt. */
const SASH_WAIST_WIDEN = 1.12;
/** How far the sash rides below the natural waist, onto the top of the hips. */
const SASH_DROP = 0.05;
/** How the band dips at the front, so it reads as wrapped round a body. */
const SASH_FRONT_DIP = 0.025;
/** The knot on his left hip and its two hanging ends. */
const SASH_KNOT_AT = 0.62;
const SASH_KNOT_RADIUS = 0.038;
const SASH_TAIL_LENGTHS = [0.26, 0.2] as const;
const SASH_TAIL_SPREAD = 0.05;
const SASH_TAIL_HALF = 0.026;
/** The hanging ends widen a little toward their hems, as loose cloth does. */
const SASH_TAIL_HEM_WIDEN = 1.2;
/** The knot sits on the band's lower half, where the ends drop from. */
const SASH_KNOT_DROP_SHARE = 0.4;
/** Sheen on silk: the band, and the knot, whose round bulge catches more. */
const SILK_SPECULAR = 0.5;
const SASH_KNOT_SPECULAR = 0.6;

function paintSash(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const centre = offsetPt(skeleton.waist, 0, SASH_DROP);
  const half = WAIST_HALF * view.girth * SASH_WAIST_WIDEN;
  const traceBand = (): void => {
    ctx.beginPath();
    ctx.moveTo(centre.x - half, centre.y - SASH_HALF_HEIGHT);
    ctx.quadraticCurveTo(
      centre.x,
      centre.y - SASH_HALF_HEIGHT + SASH_FRONT_DIP * 2,
      centre.x + half,
      centre.y - SASH_HALF_HEIGHT,
    );
    ctx.lineTo(centre.x + half, centre.y + SASH_HALF_HEIGHT);
    ctx.quadraticCurveTo(
      centre.x,
      centre.y + SASH_HALF_HEIGHT + SASH_FRONT_DIP * 2,
      centre.x - half,
      centre.y + SASH_HALF_HEIGHT,
    );
    ctx.closePath();
  };
  shadeForm(
    ctx,
    traceBand,
    { from: offsetPt(centre, -half, 0), to: offsetPt(centre, half, 0) },
    SASH,
    { halfWidth: SASH_HALF_HEIGHT, specular: SILK_SPECULAR },
  );
  // Tied on the hip: at the back edge in profile, on his left head-on.
  const knotSide = view.profile ? -1 : view.mirrored ? 1 : -1;
  const knot = offsetPt(
    centre,
    knotSide * half * SASH_KNOT_AT,
    SASH_HALF_HEIGHT * SASH_KNOT_DROP_SHARE,
  );
  SASH_TAIL_LENGTHS.forEach((length, index) => {
    const spread = (index === 0 ? -1 : 1) * SASH_TAIL_SPREAD;
    const end = offsetPt(knot, spread + knotSide * SASH_TAIL_SPREAD, length);
    shadeForm(
      ctx,
      () => traceTaper(ctx, [knot, end], SASH_TAIL_HALF, SASH_TAIL_HALF * SASH_TAIL_HEM_WIDEN),
      { from: knot, to: end },
      recededGloss(SASH, index * FAR_LIMB_SHADE),
      { halfWidth: SASH_TAIL_HALF },
    );
  });
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(knot.x, knot.y, SASH_KNOT_RADIUS, 0, Math.PI * 2);
    },
    { from: offsetPt(knot, 0, -SASH_KNOT_RADIUS), to: offsetPt(knot, 0, SASH_KNOT_RADIUS) },
    SASH,
    { halfWidth: SASH_KNOT_RADIUS, specular: SASH_KNOT_SPECULAR },
  );
}

// ── Trousers and boots ───────────────────────────────────────────────────────

/** Half-widths of a trouser leg, a little fuller than the bare leg they cover. */
const TROUSER_HIP_HALF = 0.16;
const TROUSER_KNEE_HALF = 0.095;
const TROUSER_CUFF_HALF = 0.078;
const TROUSER_CREASE_WIDTH = 0.012;
const TROUSER_CREASE_OPACITY = 0.45;
/** The trousers rise to the waist, well above the hip joint the leg hangs from. */
const TROUSER_RISE = 0.12;
/** Fine wool: barely a sheen. Polished boots: a hard one. */
const WOOL_SPECULAR = 0.25;
const POLISHED_LEATHER_SPECULAR = 0.8;
/** The fold behind the knee: its span either side of the joint, and how far it sags. */
const KNEE_FOLD_SPAN = 0.6;
const KNEE_FOLD_SAG = 0.5;

function paintTrouserLeg(ctx: Ctx, chain: BoneChain, ramp: GlossRamp): void {
  const top = offsetPt(chain.root, 0, -TROUSER_RISE);
  const traceLeg = (): void => {
    ctx.beginPath();
    addCapsule(ctx, top, chain.joint, TROUSER_HIP_HALF, TROUSER_KNEE_HALF);
    addCapsule(ctx, chain.joint, chain.end, TROUSER_KNEE_HALF, TROUSER_CUFF_HALF);
  };
  shadeForm(
    ctx,
    traceLeg,
    { from: top, to: chain.end },
    ramp,
    { halfWidth: TROUSER_HIP_HALF, specular: WOOL_SPECULAR },
    () =>
      crease(
        ctx,
        () => {
          ctx.moveTo(chain.joint.x - TROUSER_KNEE_HALF * KNEE_FOLD_SPAN, chain.joint.y);
          ctx.quadraticCurveTo(
            chain.joint.x,
            chain.joint.y + TROUSER_KNEE_HALF * KNEE_FOLD_SAG,
            chain.joint.x + TROUSER_KNEE_HALF * KNEE_FOLD_SPAN,
            chain.joint.y,
          );
        },
        TROUSER_CREASE_WIDTH,
        ramp,
        TROUSER_CREASE_OPACITY,
      ),
  );
}

const BOOT_TOE_HALF = 0.062;
const BOOT_HEEL_HALF = 0.068;
const BOOT_SHAFT_HALF = 0.07;
/** How far up the shin the boot's shaft reaches, under the trouser cuff. */
const BOOT_SHAFT_RISE = 0.08;

function paintBoot(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  point: number,
  ramp: GlossRamp,
): void {
  const { heel, toe } = footSoleLandmarks(chain.end, pitch, view, outward, point);
  const heelTop = offsetPt(heel, 0, -BOOT_HEEL_HALF);
  const toeTop = offsetPt(toe, 0, -BOOT_TOE_HALF);
  const shaftTop = offsetPt(chain.end, 0, -BOOT_SHAFT_RISE);
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, heelTop, toeTop, BOOT_HEEL_HALF, BOOT_TOE_HALF);
      addCapsule(ctx, shaftTop, chain.end, BOOT_SHAFT_HALF, BOOT_SHAFT_HALF);
    },
    { from: heelTop, to: toeTop },
    ramp,
    { halfWidth: BOOT_HEEL_HALF, specular: POLISHED_LEATHER_SPECULAR },
  );
}

/**
 * The seat of the trousers, waist to crotch, wide enough to swallow the rig's
 * flared boxer shorts: a leg tube alone leaves their hem showing either side
 * of the thigh.
 */
const SEAT_HALF = 0.24;
/** Edge-on the shorts' seat runs well behind the hip, over the buttocks. */
const SEAT_PROFILE_HALF = 0.25;
const SEAT_DROP_BELOW_HIP = 0.2;
const SEAT_HEM_TAPER = 0.85;

function paintSeat(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, ramp: GlossRamp): void {
  const half = view.profile ? SEAT_PROFILE_HALF : SEAT_HALF * view.girth;
  const top = skeleton.waist.y;
  const bottom = skeleton.hip.y + SEAT_DROP_BELOW_HIP;
  const centreX = skeleton.hip.x;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(centreX - half, top);
    ctx.lineTo(centreX + half, top);
    ctx.lineTo(centreX + half * SEAT_HEM_TAPER, bottom);
    ctx.lineTo(centreX - half * SEAT_HEM_TAPER, bottom);
    ctx.closePath();
  };
  shadeForm(ctx, trace, { from: { x: centreX, y: top }, to: { x: centreX, y: bottom } }, ramp, {
    halfWidth: half,
  });
}

function paintLegwear(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  paintSeat(ctx, skeleton, view, TROUSERS);
  // Edge-on his left leg is the far one and recedes; head-on neither does.
  const farShade = view.profile ? FAR_LIMB_SHADE : 0;
  const legs = [
    {
      chain: skeleton.leftLeg,
      shade: farShade,
      pitch: pose.leftFootPitch,
      outward: LEFT_FOOT_OUT,
      point: pose.leftFootPoint ?? 0,
    },
    {
      chain: skeleton.rightLeg,
      shade: 0,
      pitch: pose.rightFootPitch,
      outward: RIGHT_FOOT_OUT,
      point: pose.rightFootPoint ?? 0,
    },
  ];
  for (const leg of legs) {
    paintBoot(
      ctx,
      leg.chain,
      leg.pitch,
      view,
      leg.outward,
      leg.point,
      recededGloss(BOOTS, leg.shade),
    );
    paintTrouserLeg(ctx, leg.chain, recededGloss(TROUSERS, leg.shade));
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * How far past the skeleton his extras reach, for sizing the composing
 * surface: the wing peaks and bulges, the tail's curl and fork, the horn tips.
 */
function attachmentReach(skeleton: Skeleton, view: ViewSpec, motion: IncubusMotion): Pt[] {
  const wings = view.profile
    ? [profileWing(skeleton, motion.wingLift, false), profileWing(skeleton, motion.wingLift, true)]
    : headOnWings(skeleton, motion.wingLift);
  const tail = tailFor(skeleton, view, motion.tailSway);
  const head = skeleton.headCentre;
  const horns = view.profile
    ? [HORN_PROFILE, shifted(HORN_PROFILE, FAR_HORN_SHIFT)]
    : [HORN_HEAD_ON, mirrored(HORN_HEAD_ON)];
  return [
    ...wings.flatMap((w) => [w.wrist, w.claw, w.outerBulge, w.tip, ...w.scallops]),
    tail.c2,
    tail.tip,
    offsetPt(tail.tip, FORK_LENGTH, -FORK_LENGTH),
    offsetPt(tail.tip, -FORK_LENGTH, -FORK_LENGTH),
    ...horns.flatMap((h) => [h.tip, h.bend].map((p) => offsetPt(head, p.x, p.y))),
  ];
}

/**
 * The Incubus's attachments for one frame. Head-on and edge-on the wings and
 * tail hang behind him; from behind they lie over his back.
 */
export function incubusAttachments(motion: IncubusMotion): CarlAttachments {
  const skin = INCUBUS_SKIN;
  const wingsBehind = (ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void => {
    if (view.profile) {
      paintWing(
        ctx,
        profileWing(skeleton, motion.wingLift, true),
        receded(WING_MEMBRANE, FAR_LIMB_SHADE),
        receded(WING_BONE, FAR_LIMB_SHADE),
      );
      return;
    }
    for (const wing of headOnWings(skeleton, motion.wingLift)) {
      paintWing(ctx, wing, WING_MEMBRANE, WING_BONE);
    }
  };
  return {
    behind: (ctx, skeleton, view) => {
      if (view.showsBack) return;
      paintTail(ctx, tailFor(skeleton, view, motion.tailSway), receded(skin, FAR_LIMB_SHADE));
      wingsBehind(ctx, skeleton, view);
    },
    overLegs: (ctx, skeleton, view, pose) => paintLegwear(ctx, skeleton, view, pose),
    over: (ctx, skeleton, view, pose) => {
      paintChestOpening(ctx, skeleton, view, skin);
      paintSash(ctx, skeleton, view);
      if (view.showsBack) {
        for (const wing of headOnWings(skeleton, motion.wingLift)) {
          paintWing(ctx, wing, WING_MEMBRANE, WING_BONE);
        }
        paintTail(ctx, tailFor(skeleton, view, motion.tailSway), skin);
      } else if (view.profile) {
        paintWing(ctx, profileWing(skeleton, motion.wingLift, false), WING_MEMBRANE, WING_BONE);
      }
      drawHorns(ctx, skeleton, view, pose);
    },
    reach: (skeleton, view) => attachmentReach(skeleton, view, motion),
  };
}
