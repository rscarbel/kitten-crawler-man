/**
 * Angel's legs and feet, in every view.
 *
 * Each leg is an outline offset from its own projected joints, so whatever the
 * gait solve does — a knee folding through the swing, a foot rolling off its
 * toes — the silhouette follows without a separate pose to keep in step.
 *
 * The widths are where the anatomy lives. Head-on, the outer thigh sweeps out
 * under the hip and tapers to a narrow knee; the inner thigh is fuller at the
 * top and swells again just above the knee where the teardrop of the inner
 * quadriceps sits; the calf peaks high on the outside and low on the inside;
 * the ankle narrows under it, with the inner ankle bone higher than the outer.
 * In profile the quadriceps bow forward, the hamstrings and the calf bow back,
 * and the heel cord thins to almost nothing above the heel.
 */

import { fillSoftEllipse } from '../softShade';
import {
  limbEdges,
  limbOutline,
  traceSmooth,
  fillCrescent,
  type SilhouetteShade,
  midpoint,
  angleOf,
  type Ctx,
  type WidthKey,
} from './paint';
import { SKIN_BASE, SKIN_HALF, SKIN_HIGHLIGHT, SKIN_LIT, SKIN_SHADE } from './palette';
import { FOOT_Y, HEEL_TO_ANKLE, HEEL_TO_BALL, FOOT_LENGTH, ANKLE_HEIGHT } from './proportions';
import {
  project,
  type BodySide,
  type Pt2,
  type AngelLeg,
  type AngelView,
  type V3,
} from './skeleton';

export interface LimbPaint {
  ctx: Ctx;
  view: AngelView;
  /** The smallest modelling — ankle bones, the tendon under the kneecap — which is under a pixel any smaller. */
  fineModelling: boolean;
}

/* ── Head-on and from behind ───────────────────────────────────────────── */

/** The outline starts this far up the thigh's axis past the hip joint, under the pelvis. */
const THIGH_ROOT_EXTENSION = 0.035;
/** Guards a direction taken along a bone that has collapsed to a point. */
const MIN_AXIS_LENGTH = 1e-6;

/**
 * The thigh's top starts inside the pelvis, meets the hip line at the hip's
 * own width and swells on from there to its widest level with the crotch, so
 * the waist-to-knee contour is one rounded curve: a thigh wider than the hip
 * at the hip line leaves a corner where the two outlines cross.
 */
const THIGH_OUTER: ReadonlyArray<WidthKey> = [
  [0, 0.026],
  [0.08, 0.047],
  [0.18, 0.053],
  [0.3, 0.055],
  [0.5, 0.049],
  [0.7, 0.04],
  [0.86, 0.031],
  [0.96, 0.028],
];
/** Full at the top, where her inner thighs meet under the crotch before the gap between them opens. */
const THIGH_INNER: ReadonlyArray<WidthKey> = [
  [0, 0.064],
  [0.2, 0.06],
  [0.42, 0.049],
  [0.64, 0.035],
  [0.82, 0.03],
  [0.96, 0.025],
];
const SHIN_OUTER: ReadonlyArray<WidthKey> = [
  [0.07, 0.026],
  [0.26, 0.031],
  [0.46, 0.027],
  [0.7, 0.0185],
  [0.88, 0.0128],
  [0.97, 0.0142],
];
const SHIN_INNER: ReadonlyArray<WidthKey> = [
  [0.08, 0.025],
  [0.33, 0.031],
  [0.53, 0.027],
  [0.76, 0.0165],
  [0.86, 0.0122],
  [0.93, 0.0148],
];
/** The thigh runs on just past the knee to overlap the shin, and the shin starts just above it, under the thigh. */
const KNEE_CAP_OUTER: ReadonlyArray<WidthKey> = [[1.05, 0.022]];
const KNEE_CAP_INNER: ReadonlyArray<WidthKey> = [[1.05, 0.02]];
const SHIN_ROOT_OUTER: WidthKey = [-0.06, 0.024];
const SHIN_ROOT_INNER: WidthKey = [-0.06, 0.023];
/** A knee driven at the camera stops pinching in and widens toward the thigh's width. */
const KNEE_NEAR_WIDENING = 0.008;

/** The light comes from up and to the right; each leg's core shadow is the band its own shape leaves on the far side. */
const LEG_CORE_SLIDE_X = 0.007;
const LEG_HALF_SLIDE_X = 0.028;
const LEG_MID_SLIDE_X = 0.016;
const SILHOUETTE_SHADE_ALPHA = 0.7;

/**
 * Light from up and to the right, head-on and from behind: the far flank of the
 * whole figure turns into a half-tone and then a core shadow. Slid straight across, so the bands lie
 * along the sides of the silhouette and never along the undersides of the
 * seat or the groin, where the forms are modelled on their own.
 */
export const HEAD_ON_SILHOUETTE_SHADE: SilhouetteShade = {
  steps: [
    { slide: { x: LEG_CORE_SLIDE_X, y: 0 }, color: SKIN_SHADE },
    { slide: { x: LEG_MID_SLIDE_X, y: 0 }, color: SKIN_HALF },
    { slide: { x: LEG_HALF_SLIDE_X, y: 0 }, color: SKIN_BASE },
  ],
  alpha: SILHOUETTE_SHADE_ALPHA,
};

const THIGH_LIGHT_SHARE = 0.35;
const THIGH_LIGHT_OFFSET = 0.012;
const THIGH_LIGHT_RADIUS_X = 0.022;
const THIGH_LIGHT_RADIUS_Y = 0.05;
const THIGH_LIGHT_ALPHA = 0.85;

const INNER_THIGH_SHADE_SHARE = 0.12;
const INNER_THIGH_SHADE_INSET = 0.034;
const INNER_THIGH_SHADE_RADIUS_X = 0.02;
const INNER_THIGH_SHADE_RADIUS_Y = 0.045;
const INNER_THIGH_SHADE_ALPHA = 0.55;

const KNEECAP_RISE = 0.012;
const KNEECAP_RADIUS_X = 0.017;
const KNEECAP_RADIUS_Y = 0.016;
const KNEECAP_LIGHT_ALPHA = 0.9;
const KNEECAP_SHADE_DROP = 0.012;
const KNEECAP_SHADE_RADIUS_X = 0.014;
const KNEECAP_SHADE_RADIUS_Y = 0.008;
const KNEECAP_SHADE_ALPHA = 0.45;
/** The inner quadriceps' teardrop, just above and inside the knee. */
const TEARDROP_RISE = 0.032;
const TEARDROP_INSET = 0.012;
const TEARDROP_RADIUS_X = 0.012;
const TEARDROP_RADIUS_Y = 0.02;
const TEARDROP_ALPHA = 0.35;
const SHIN_LIGHT_SHARE = 0.35;
const SHIN_LIGHT_OFFSET = 0.006;
const SHIN_LIGHT_RADIUS_X = 0.009;
const SHIN_LIGHT_RADIUS_Y = 0.06;
const SHIN_LIGHT_ALPHA = 0.7;

/**
 * Back view: the soft hollow behind the knee. Drawn as a line it reads as a
 * seam cut across the leg; the hollow is a shallow dip between the tendons.
 */
const KNEE_PIT_DROP = 0.004;
const KNEE_PIT_RADIUS_X = 0.017;
const KNEE_PIT_RADIUS_Y = 0.009;
const KNEE_PIT_ALPHA = 0.5;
const CALF_LIGHT_SHARE = 0.27;
const CALF_LIGHT_RADIUS_X = 0.016;
const CALF_LIGHT_RADIUS_Y = 0.04;
const CALF_LIGHT_ALPHA = 0.6;

/** A leg behind the other one, head-on, steps down a little so the two never merge where they cross. */
const TRAILING_LEG_SHADE_ALPHA = 0.18;

/** A knee bent this far toward the camera is as wide as it gets. */
const KNEE_FLEX_FOR_FULL_WIDENING = Math.PI / 3;
/** Where along each bone a flexed knee's widening starts or stops. */
const KNEE_WIDENING_FROM_THIGH = 0.6;
const KNEE_WIDENING_TO_SHIN = 0.3;
const CALF_LIGHT_OUTSET = 0.008;
const KNEECAP_LIGHT_OFFSET = 0.003;

function kneeFlexOf(leg: AngelLeg): number {
  const thigh = { y: leg.knee.y - leg.hip.y, z: leg.knee.z - leg.hip.z };
  const shin = { y: leg.ankle.y - leg.knee.y, z: leg.ankle.z - leg.knee.z };
  const cross = thigh.z * shin.y - thigh.y * shin.z;
  const dot = thigh.y * shin.y + thigh.z * shin.z;
  return Math.abs(Math.atan2(cross, dot));
}

function widen(
  keys: ReadonlyArray<WidthKey>,
  from: number,
  amount: number,
  towardEnd: boolean,
): WidthKey[] {
  return keys.map(([share, width]) => {
    const near = towardEnd
      ? Math.max(0, (share - from) / (1 - from))
      : Math.max(0, 1 - share / from);
    return [share, width + amount * near] as const;
  });
}

interface LegShapes {
  /** Thigh down over the knee, and shin with the foot below it. */
  thigh: Pt2[];
  lower: Pt2[];
}

/**
 * A leg as two shapes overlapping at the knee. Straight, the two outlines run
 * into each other with one contour; folded — a running stride tucks the heel up
 * behind her — the shin turns away from the camera and passes behind the thigh
 * instead of folding the outline back across itself.
 */
function frontBackShapes(view: AngelView, side: BodySide, leg: AngelLeg): LegShapes {
  const hip = project(view, leg.hip);
  const knee = project(view, leg.knee);
  const ankle = project(view, leg.ankle);
  const axisLength = Math.max(Math.hypot(hip.x - knee.x, hip.y - knee.y), MIN_AXIS_LENGTH);
  const top = {
    x: hip.x + ((hip.x - knee.x) / axisLength) * THIGH_ROOT_EXTENSION,
    y: hip.y + ((hip.y - knee.y) / axisLength) * THIGH_ROOT_EXTENSION,
  };
  const nearness = Math.min(1, kneeFlexOf(leg) / KNEE_FLEX_FOR_FULL_WIDENING);
  const kneeWidening = KNEE_NEAR_WIDENING * nearness;
  // The outer edge is on her own side of the body: screen right for her right leg.
  const thigh = limbOutline(
    [
      {
        from: top,
        to: knee,
        outer: [
          ...widen(THIGH_OUTER, KNEE_WIDENING_FROM_THIGH, kneeWidening, true),
          ...KNEE_CAP_OUTER,
        ],
        inner: [
          ...widen(THIGH_INNER, KNEE_WIDENING_FROM_THIGH, kneeWidening, true),
          ...KNEE_CAP_INNER,
        ],
      },
    ],
    -side,
  );
  const { outer, inner } = limbEdges(
    [
      {
        from: knee,
        to: ankle,
        outer: [SHIN_ROOT_OUTER, ...widen(SHIN_OUTER, KNEE_WIDENING_TO_SHIN, kneeWidening, false)],
        inner: [SHIN_ROOT_INNER, ...widen(SHIN_INNER, KNEE_WIDENING_TO_SHIN, kneeWidening, false)],
      },
    ],
    -side,
  );
  return { thigh, lower: [...outer, ...footOutline(view, side, leg), ...inner.reverse()] };
}

/**
 * A leg's fill and its own modelling. Its outer edge is shaded with the torso
 * as one silhouette afterwards (see `shadeSilhouette`); the light band it keeps
 * of its own is what separates it from the other leg where they cross.
 * Returns its outline for that pass.
 */
export function drawLegFrontBack(
  lp: LimbPaint,
  side: BodySide,
  leg: AngelLeg,
  trailing: boolean,
): Pt2[][] {
  const { ctx, view } = lp;
  const { thigh, lower } = frontBackShapes(view, side, leg);
  const hip = project(view, leg.hip);
  const knee = project(view, leg.knee);
  const ankle = project(view, leg.ankle);
  const back = view === 'back';
  // Head-on the shin passes behind the thigh as it folds; from behind, in front of it.
  const ordered = back ? [thigh, lower] : [lower, thigh];
  const trace = (): void => {
    for (const shape of ordered) traceSmooth(ctx, shape, true);
  };

  ctx.save();
  ctx.fillStyle = SKIN_LIT;
  for (const shape of ordered) {
    ctx.beginPath();
    traceSmooth(ctx, shape, true);
    ctx.fill();
  }
  ctx.beginPath();
  trace();
  ctx.clip();

  const inward = -side;
  const thighLight = midpoint(hip, knee, THIGH_LIGHT_SHARE);
  fillSoftEllipse(
    ctx,
    thighLight.x + side * THIGH_LIGHT_OFFSET,
    thighLight.y,
    THIGH_LIGHT_RADIUS_X,
    THIGH_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    THIGH_LIGHT_ALPHA,
    angleOf(hip, knee) - Math.PI / 2,
  );
  const innerThigh = midpoint(hip, knee, INNER_THIGH_SHADE_SHARE);
  fillSoftEllipse(
    ctx,
    innerThigh.x + inward * INNER_THIGH_SHADE_INSET,
    innerThigh.y,
    INNER_THIGH_SHADE_RADIUS_X,
    INNER_THIGH_SHADE_RADIUS_Y,
    SKIN_SHADE,
    INNER_THIGH_SHADE_ALPHA,
  );

  if (back) {
    const calfLight = midpoint(knee, ankle, CALF_LIGHT_SHARE);
    fillSoftEllipse(
      ctx,
      calfLight.x + side * CALF_LIGHT_OUTSET,
      calfLight.y,
      CALF_LIGHT_RADIUS_X,
      CALF_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      CALF_LIGHT_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      knee.x,
      knee.y + KNEE_PIT_DROP,
      KNEE_PIT_RADIUS_X,
      KNEE_PIT_RADIUS_Y,
      SKIN_HALF,
      KNEE_PIT_ALPHA,
    );
  } else {
    fillSoftEllipse(
      ctx,
      knee.x + KNEECAP_LIGHT_OFFSET,
      knee.y - KNEECAP_RISE,
      KNEECAP_RADIUS_X,
      KNEECAP_RADIUS_Y,
      SKIN_HIGHLIGHT,
      KNEECAP_LIGHT_ALPHA,
    );
    if (lp.fineModelling) {
      fillSoftEllipse(
        ctx,
        knee.x,
        knee.y + KNEECAP_SHADE_DROP,
        KNEECAP_SHADE_RADIUS_X,
        KNEECAP_SHADE_RADIUS_Y,
        SKIN_SHADE,
        KNEECAP_SHADE_ALPHA,
      );
    }
    if (lp.fineModelling)
      fillSoftEllipse(
        ctx,
        knee.x + inward * TEARDROP_INSET,
        knee.y - TEARDROP_RISE,
        TEARDROP_RADIUS_X,
        TEARDROP_RADIUS_Y,
        SKIN_HALF,
        TEARDROP_ALPHA,
      );
    const shinLight = midpoint(knee, ankle, SHIN_LIGHT_SHARE);
    fillSoftEllipse(
      ctx,
      shinLight.x + SHIN_LIGHT_OFFSET,
      shinLight.y,
      SHIN_LIGHT_RADIUS_X,
      SHIN_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      SHIN_LIGHT_ALPHA,
      angleOf(knee, ankle) - Math.PI / 2,
    );
  }

  shadeFootFrontBack(ctx, view, side, leg, trace, lp.fineModelling);
  if (trailing) {
    ctx.save();
    ctx.globalAlpha *= TRAILING_LEG_SHADE_ALPHA * leg.swing;
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath();
    trace();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  return ordered;
}

/* ── Feet head-on and from behind ──────────────────────────────────────── */

/**
 * The floor is seen from above, so the top of a foot shows: its shape is drawn
 * with more of its length foreshortened into screen height than the stride is.
 */
const FOOT_TOP_DEPTH = 0.28;
/** Her feet point a little out from her heading. */
const FOOT_TURN_OUT = 0.02;
/**
 * The foot head-on, along its own axis from the ankle (0) to the tip of the big
 * toe (1), across in figure units with + toward her little toe. It widens from
 * a slim ankle over the instep to the ball, the little toes slope back from
 * the long big toe, and the inner edge keeps the hollow of the arch.
 */
const FRONT_FOOT_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.0158],
  [0.3, 0.0142],
  [0.55, 0.0215],
  [0.76, 0.0262],
  [0.88, 0.0232],
  [0.94, 0.0168],
  [0.985, 0.0092],
  [1.0, 0.0012],
  [1.008, -0.0072],
  [1.02, -0.0158],
  [0.98, -0.0242],
  [0.88, -0.0292],
  [0.66, -0.0262],
  [0.42, -0.0178],
  [0.18, -0.0168],
];
/** From behind: down the narrow heel cord to the rounded heel, with the forefoot showing past it either side. */
const BACK_HEEL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.0112],
  [0.62, 0.0158],
  [0.78, 0.0185],
  [0.9, 0.0205],
  [0.97, 0.015],
  [1.0, 0.007],
  [1.0, -0.007],
  [0.97, -0.0185],
  [0.9, -0.0255],
  [0.78, -0.0215],
  [0.64, -0.0168],
  [0.25, -0.0115],
];
/** With the heel up, from behind, the sole meets the floor a little above where a flat heel would. */
const FOREFOOT_PEEK_RISE = 0.006;
const SOLE_PITCH_GAIN = 3;
/** Where the front of the shin turns into the top of the foot: a soft fold across the ankle. */
const ANKLE_FOLD_HALF_WIDTH = 0.012;
const ANKLE_FOLD_RADIUS_Y = 0.005;
const ANKLE_FOLD_ALPHA = 0.4;
/** The ankle bones: the inner one sits higher than the outer. */
const MALLEOLUS_RADIUS = 0.006;
const MALLEOLUS_ALPHA = 0.7;
const INNER_MALLEOLUS_RISE = 0.01;
const OUTER_MALLEOLUS_RISE = 0.004;
const MALLEOLUS_OFFSET = 0.012;
const PROFILE_MALLEOLUS_STRETCH = 1.2;
/** With the heel this far up, from behind the sole faces the camera. */
const SOLE_SHOWS_PITCH = 0.15;

const INSTEP_LIGHT_SHARE = 0.45;
const INSTEP_LIGHT_RADIUS_X = 0.012;
const INSTEP_LIGHT_RADIUS_Y = 0.016;
const INSTEP_LIGHT_ALPHA = 0.85;
const INSTEP_LIGHT_OFFSET = 0.003;
const TOE_SHADE_RADIUS_X = 0.024;
const TOE_SHADE_RADIUS_Y = 0.012;
const TOE_SHADE_ALPHA = 0.45;
const SOLE_SLIDE = 0.005;
const SOLE_ALPHA = 0.5;
const HEEL_SHADE_RADIUS_X = 0.018;
const HEEL_SHADE_RADIUS_Y = 0.01;
const HEEL_SHADE_ALPHA = 0.4;

function footPointOnScreen(view: AngelView, leg: AngelLeg, p: V3): Pt2 {
  const ankle = project(view, leg.ankle);
  const towardCamera = view === 'front' ? 1 : -1;
  return {
    x: ankle.x + (p.x - leg.ankle.x),
    y: ankle.y + (p.y - leg.ankle.y) + (p.z - leg.ankle.z) * FOOT_TOP_DEPTH * towardCamera,
  };
}

/** Where a foot head-on ends, turned a little out: its axis runs from the ankle to here. */
function frontToeTip(side: BodySide, leg: AngelLeg): Pt2 {
  const toe = footPointOnScreen('front', leg, leg.toe);
  return { x: toe.x + side * FOOT_TURN_OUT, y: toe.y };
}

/** From behind the foot ends at the heel, or with the heel raised at the sole turned to the camera. */
function backHeelBottom(leg: AngelLeg): Pt2 {
  const ankle = project('back', leg.ankle);
  const heel = footPointOnScreen('back', leg, leg.heel);
  const heelUp = -leg.pitch > SOLE_SHOWS_PITCH;
  return heelUp
    ? { x: ankle.x, y: Math.max(heel.y, FOOT_Y - FOREFOOT_PEEK_RISE) }
    : { x: heel.x, y: Math.max(heel.y, FOOT_Y) };
}

/**
 * The foot continues the leg's own outline, so leg and foot are one silhouette
 * with one set of shading and no seam at the ankle.
 */
function footOutline(view: AngelView, side: BodySide, leg: AngelLeg): Pt2[] {
  const ankle = project(view, leg.ankle);
  const end = view === 'front' ? frontToeTip(side, leg) : backHeelBottom(leg);
  const points = view === 'front' ? FRONT_FOOT_POINTS : BACK_HEEL_POINTS;
  const length = Math.max(Math.hypot(end.x - ankle.x, end.y - ankle.y), MIN_AXIS_LENGTH);
  const axis = { x: (end.x - ankle.x) / length, y: (end.y - ankle.y) / length };
  // Across the axis toward her own side.
  const across = { x: axis.y * side, y: -axis.x * side };
  const outward = across.x * side >= 0 ? across : { x: -across.x, y: -across.y };
  return points.map(([along, out]) => ({
    x: ankle.x + axis.x * length * along + outward.x * out,
    y: ankle.y + axis.y * length * along + outward.y * out,
  }));
}

function shadeFootFrontBack(
  ctx: Ctx,
  view: AngelView,
  side: BodySide,
  leg: AngelLeg,
  trace: () => void,
  fine: boolean,
): void {
  const ankle = project(view, leg.ankle);
  if (view === 'front') {
    const toe = frontToeTip(side, leg);
    if (fine) {
      fillSoftEllipse(
        ctx,
        ankle.x - side * MALLEOLUS_OFFSET,
        ankle.y - INNER_MALLEOLUS_RISE,
        MALLEOLUS_RADIUS,
        MALLEOLUS_RADIUS,
        SKIN_HIGHLIGHT,
        MALLEOLUS_ALPHA,
      );
      fillSoftEllipse(
        ctx,
        ankle.x + side * MALLEOLUS_OFFSET,
        ankle.y - OUTER_MALLEOLUS_RISE,
        MALLEOLUS_RADIUS,
        MALLEOLUS_RADIUS,
        SKIN_HIGHLIGHT,
        MALLEOLUS_ALPHA,
      );
    }
    fillSoftEllipse(
      ctx,
      ankle.x,
      ankle.y + ANKLE_FOLD_RADIUS_Y,
      ANKLE_FOLD_HALF_WIDTH,
      ANKLE_FOLD_RADIUS_Y,
      SKIN_HALF,
      ANKLE_FOLD_ALPHA,
    );
    const instep = midpoint(ankle, toe, INSTEP_LIGHT_SHARE);
    fillSoftEllipse(
      ctx,
      instep.x + INSTEP_LIGHT_OFFSET,
      instep.y,
      INSTEP_LIGHT_RADIUS_X,
      INSTEP_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      INSTEP_LIGHT_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      toe.x,
      toe.y,
      TOE_SHADE_RADIUS_X,
      TOE_SHADE_RADIUS_Y,
      SKIN_HALF,
      TOE_SHADE_ALPHA,
    );
    if (leg.pitch > 0) {
      fillCrescent(
        ctx,
        trace,
        0,
        -SOLE_SLIDE,
        SKIN_SHADE,
        SOLE_ALPHA * Math.min(1, leg.pitch * SOLE_PITCH_GAIN),
      );
    }
    return;
  }
  const bottom = backHeelBottom(leg);
  const heelUp = -leg.pitch > SOLE_SHOWS_PITCH;
  fillSoftEllipse(
    ctx,
    bottom.x,
    bottom.y,
    HEEL_SHADE_RADIUS_X,
    HEEL_SHADE_RADIUS_Y,
    heelUp ? SKIN_SHADE : SKIN_HALF,
    HEEL_SHADE_ALPHA,
  );
}

/* ── Profile ───────────────────────────────────────────────────────────── */

const SIDE_THIGH_FRONT: ReadonlyArray<WidthKey> = [
  [0, 0.03],
  [0.2, 0.047],
  [0.32, 0.051],
  [0.58, 0.045],
  [0.84, 0.034],
  [0.98, 0.03],
];
const SIDE_THIGH_BACK: ReadonlyArray<WidthKey> = [
  [0, 0.03],
  [0.2, 0.05],
  [0.3, 0.052],
  [0.52, 0.045],
  [0.8, 0.033],
  [0.98, 0.026],
];
const SIDE_SHIN_FRONT: ReadonlyArray<WidthKey> = [
  [0.08, 0.025],
  [0.3, 0.021],
  [0.62, 0.0165],
  [0.88, 0.0128],
  [1.02, 0.014],
];
const SIDE_SHIN_BACK: ReadonlyArray<WidthKey> = [
  [0.08, 0.029],
  [0.28, 0.037],
  [0.5, 0.03],
  [0.74, 0.018],
  [0.9, 0.0105],
  [1.02, 0.012],
];
const SIDE_THIGH_ROOT_EXTENSION = 0.06;
/** The far leg sits in the body's shadow. */
const FAR_LIMB_SHADE_ALPHA = 0.5;
/** The light is up and in front of her, so a leg's back edge and undersides turn away. */
const SIDE_HALF_SLIDE_X = 0.02;
const SIDE_HALF_SLIDE_Y = -0.004;
const SIDE_CORE_SLIDE_X = 0.008;
const SIDE_CORE_SLIDE_Y = -0.0015;

/** In profile the light is up and ahead of her: her back and every underside turn away. */
export const PROFILE_SILHOUETTE_SHADE: SilhouetteShade = {
  steps: [
    { slide: { x: SIDE_CORE_SLIDE_X, y: SIDE_CORE_SLIDE_Y }, color: SKIN_SHADE },
    {
      slide: {
        x: (SIDE_CORE_SLIDE_X + SIDE_HALF_SLIDE_X) / 2,
        y: (SIDE_CORE_SLIDE_Y + SIDE_HALF_SLIDE_Y) / 2,
      },
      color: SKIN_HALF,
    },
    { slide: { x: SIDE_HALF_SLIDE_X, y: SIDE_HALF_SLIDE_Y }, color: SKIN_BASE },
  ],
  alpha: SILHOUETTE_SHADE_ALPHA,
};

const SIDE_KNEE_LIGHT_RADIUS = 0.016;
const SIDE_KNEE_LIGHT_FORWARD = 0.012;
const SIDE_KNEE_LIGHT_RISE = 0.006;
const SIDE_KNEE_LIGHT_ALPHA = 0.7;
const SIDE_THIGH_LIGHT_DROP = 0.07;
const SIDE_THIGH_LIGHT_FORWARD = 0.018;
const SIDE_THIGH_LIGHT_RADIUS_X = 0.02;
const SIDE_THIGH_LIGHT_RADIUS_Y = 0.06;
const SIDE_THIGH_LIGHT_ALPHA = 0.6;
const SIDE_SHIN_LIGHT_SHARE = 0.4;
const SIDE_SHIN_LIGHT_FORWARD = 0.01;
const SIDE_SHIN_LIGHT_RADIUS_X = 0.008;
const SIDE_SHIN_LIGHT_RADIUS_Y = 0.05;
const SIDE_SHIN_LIGHT_ALPHA = 0.6;

/** In profile the shin's edges stop short of the ankle, where the foot's own outline takes over. */
const SIDE_SHIN_EDGE_END = 0.86;

function sideLegOutline(leg: AngelLeg): Pt2[] {
  const hip = project('side', leg.hip);
  const knee = project('side', leg.knee);
  const ankle = project('side', leg.ankle);
  const axisLength = Math.max(Math.hypot(hip.x - knee.x, hip.y - knee.y), MIN_AXIS_LENGTH);
  const top = {
    x: hip.x + ((hip.x - knee.x) / axisLength) * SIDE_THIGH_ROOT_EXTENSION,
    y: hip.y + ((hip.y - knee.y) / axisLength) * SIDE_THIGH_ROOT_EXTENSION,
  };
  const { outer: front, inner: back } = limbEdges(
    [
      { from: top, to: knee, outer: SIDE_THIGH_FRONT, inner: SIDE_THIGH_BACK },
      {
        from: knee,
        to: ankle,
        outer: SIDE_SHIN_FRONT.filter(([share]) => share <= SIDE_SHIN_EDGE_END),
        inner: SIDE_SHIN_BACK.filter(([share]) => share <= SIDE_SHIN_EDGE_END),
      },
    ],
    -1,
  );
  return [...front, ...footProfile(leg), ...back.reverse()];
}

/**
 * The foot in profile, drawn round its own bones and over the bottom of the
 * shin: up the front of the ankle, down the instep to the toes, under the
 * toes and the ball, along a sole that lifts a little at the arch, round the
 * heel and up the thin heel cord. Points are (distance along the sole from the
 * heel, height above it); the toes hinge at the ball so they lie flat on the
 * floor as the heel rises.
 */
const FOOT_TOP_POINTS: ReadonlyArray<readonly [number, number]> = [
  [HEEL_TO_ANKLE + 0.012, ANKLE_HEIGHT - 0.002],
  [0.056, 0.03],
  [0.074, 0.021],
];
const TOE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0135],
  [0.022, 0.0095],
  [0.034, 0.006],
  [0.0365, 0.002],
  [0.03, 0.0],
];
const FOOT_SOLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [HEEL_TO_BALL - 0.004, 0],
  [0.062, 0.0028],
  [0.034, 0.0022],
  [0.01, 0.0],
  [-0.004, 0.006],
  [-0.006, 0.016],
  [0.003, 0.032],
];

function footProfile(leg: AngelLeg): Pt2[] {
  const heel = project('side', leg.heel);
  const ball = project('side', leg.ball);
  const toe = project('side', leg.toe);
  const along = Math.cos(leg.pitch);
  const rise = Math.sin(leg.pitch);
  const fromHeel = (f: number, u: number): Pt2 => ({
    x: heel.x + f * along - u * rise,
    y: heel.y - (f * rise + u * along),
  });
  const toePitch = Math.atan2(-(toe.y - ball.y), toe.x - ball.x);
  const toeAlong = Math.cos(toePitch);
  const toeRise = Math.sin(toePitch);
  const fromBall = (f: number, u: number): Pt2 => ({
    x: ball.x + f * toeAlong - u * toeRise,
    y: ball.y - (f * toeRise + u * toeAlong),
  });
  return [
    ...FOOT_TOP_POINTS.map(([f, u]) => fromHeel(f, u)),
    ...TOE_POINTS.map(([f, u]) => fromBall(f, u)),
    ...FOOT_SOLE_POINTS.map(([f, u]) => fromHeel(f, u)),
  ];
}

export function drawLegSide(lp: LimbPaint, side: BodySide, leg: AngelLeg, far: boolean): Pt2[] {
  const { ctx } = lp;
  const outline = sideLegOutline(leg);
  const trace = (): void => traceSmooth(ctx, outline, true);
  const knee = project('side', leg.knee);
  const hip = project('side', leg.hip);
  const ankle = project('side', leg.ankle);

  ctx.save();
  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  trace();
  ctx.fill();
  ctx.clip();
  const thighAngle = angleOf(hip, knee) - Math.PI / 2;
  fillSoftEllipse(
    ctx,
    knee.x + SIDE_KNEE_LIGHT_FORWARD,
    knee.y - SIDE_KNEE_LIGHT_RISE,
    SIDE_KNEE_LIGHT_RADIUS,
    SIDE_KNEE_LIGHT_RADIUS,
    SKIN_HIGHLIGHT,
    SIDE_KNEE_LIGHT_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    hip.x + SIDE_THIGH_LIGHT_FORWARD,
    hip.y + SIDE_THIGH_LIGHT_DROP,
    SIDE_THIGH_LIGHT_RADIUS_X,
    SIDE_THIGH_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    SIDE_THIGH_LIGHT_ALPHA,
    thighAngle,
  );
  const shinLight = midpoint(knee, ankle, SIDE_SHIN_LIGHT_SHARE);
  fillSoftEllipse(
    ctx,
    shinLight.x + SIDE_SHIN_LIGHT_FORWARD,
    shinLight.y,
    SIDE_SHIN_LIGHT_RADIUS_X,
    SIDE_SHIN_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    SIDE_SHIN_LIGHT_ALPHA,
    angleOf(knee, ankle) - Math.PI / 2,
  );
  if (lp.fineModelling) {
    fillSoftEllipse(
      ctx,
      ankle.x,
      ankle.y + OUTER_MALLEOLUS_RISE,
      MALLEOLUS_RADIUS * PROFILE_MALLEOLUS_STRETCH,
      MALLEOLUS_RADIUS,
      SKIN_HIGHLIGHT,
      MALLEOLUS_ALPHA,
    );
  }
  if (far) {
    // The far leg is the same leg a step into shadow: its form still shows
    // through, dimmed. A flat tone there reads as a cut-out.
    ctx.globalAlpha *= FAR_LIMB_SHADE_ALPHA;
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath();
    trace();
    ctx.fill();
  }
  ctx.restore();
  return outline;
}

/* ── Contact shadows ───────────────────────────────────────────────────── */

const CONTACT_SHADOW_COLOR = '#0a0d14';
const CONTACT_SHADOW_ALPHA = 0.32;
/** Gone by the time a foot is this high off the floor. */
const CONTACT_SHADOW_FADE_HEIGHT = 0.06;
const FRONT_SHADOW_RADIUS_X = 0.034;
const FRONT_SHADOW_RADIUS_Y = 0.012;
const SIDE_SHADOW_RADIUS_Y = 0.01;
const SIDE_SHADOW_MIN_SHARE = 0.55;
const SIDE_SHADOW_FOOT_SHARE = 0.6;

/** A soft dark patch on the floor under each foot, fading as it lifts. */
export function drawContactShadows(
  ctx: Ctx,
  view: AngelView,
  legs: Record<BodySide, AngelLeg>,
): void {
  for (const side of [-1, 1] as const) {
    const leg = legs[side];
    const height = FOOT_Y - Math.max(leg.heel.y, leg.ball.y);
    const strength = Math.max(0, 1 - height / CONTACT_SHADOW_FADE_HEIGHT);
    if (strength <= 0) continue;
    if (view === 'side') {
      const heel = project('side', { ...leg.heel, y: FOOT_Y });
      const toe = project('side', { ...leg.toe, y: FOOT_Y });
      fillSoftEllipse(
        ctx,
        (heel.x + toe.x) / 2,
        FOOT_Y,
        Math.max(
          FOOT_LENGTH * SIDE_SHADOW_MIN_SHARE,
          Math.abs(toe.x - heel.x) * SIDE_SHADOW_FOOT_SHARE,
        ),
        SIDE_SHADOW_RADIUS_Y,
        CONTACT_SHADOW_COLOR,
        CONTACT_SHADOW_ALPHA * strength,
      );
      continue;
    }
    const groundUnder = footPointOnScreen(view, leg, { ...leg.ball, y: FOOT_Y });
    fillSoftEllipse(
      ctx,
      groundUnder.x,
      groundUnder.y,
      FRONT_SHADOW_RADIUS_X,
      FRONT_SHADOW_RADIUS_Y,
      CONTACT_SHADOW_COLOR,
      CONTACT_SHADOW_ALPHA * strength,
    );
  }
}
