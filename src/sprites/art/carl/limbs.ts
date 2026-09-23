/**
 * Carl's arms, hands and legs: the anatomical contour of every bare limb
 * segment, the muscle forms painted inside it, the shoved-up sleeve, and the
 * hand hung off the wrist. The bare foot at the end of a leg is `feet.ts`.
 *
 * He is pantsless and his sleeves are shoved up, so his legs and forearms are
 * where the figure says "strong". Every segment is a real silhouette — quad
 * sweep, teardrop, calf belly, forearm mass — rather than a capsule, and each
 * carries about three forms plus one crease, pushed hard in value so the
 * definition survives the 32 px tile.
 */

import { drawFoot, type FootAccents } from './feet';
import { angleBetween, HALF_PI, lerpAngle, mixPt, pt } from './geometry';
import { FEATURE_LINE_WIDTH, shadeForm } from './paint';
import { LIGHT, type Ramp, receded, SKIN } from './palette';
import { drawSleeve } from './sleeve';
import {
  ANKLE_WIDTH,
  CALF_AT,
  CALF_WIDTH,
  ELBOW_WIDTH,
  FOREARM_BELLY_WIDTH,
  FOREARM_LENGTH,
  KNEE_WIDTH,
  PROFILE_THIGH_DEPTH,
  THIGH_WIDTH,
  UPPER_ARM_WIDTH,
  WRIST_WIDTH,
} from './proportions';
import { type BoneChain, type HandShape, type ViewSpec } from './rig';
import { clamp01, lerp, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse, withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

// ── Contours ─────────────────────────────────────────────────────────────────

/** A point on a limb's outline: how far along the bone, and its half-width there. */
type Station = readonly [along: number, half: number];

/**
 * One bone's silhouette as two lists of stations, one per side of the bone.
 * `plus` is the side the bone's left-hand normal points to (`-dy, dx`).
 */
interface Contour {
  readonly plus: readonly Station[];
  readonly minus: readonly Station[];
}

/** A bone's own frame: points placed by distance along it and signed offset across it. */
interface BoneFrame {
  readonly length: number;
  readonly angle: number;
  /** Figure-space point `along` (0 root – 1 tip) and `across` units off the bone toward `plus`. */
  at(along: number, across: number): Pt;
}

function boneFrame(from: Pt, to: Pt): BoneFrame {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const nx = length > 0 ? -dy / length : 0;
  const ny = length > 0 ? dx / length : 0;
  return {
    length,
    angle: Math.atan2(dy, dx),
    at: (along, across) => ({
      x: from.x + dx * along + nx * across,
      y: from.y + dy * along + ny * across,
    }),
  };
}

/**
 * Traces a contour as one closed path with a round cap at each end. Between
 * stations the outline runs through the midpoints on quadratic curves, so the
 * stations shape it without putting a corner at any of them.
 */
function traceContour(ctx: Ctx, bone: BoneFrame, contour: Contour): void {
  const plusSide = contour.plus.map(([along, half]) => bone.at(along, half));
  const minusSide = contour.minus.map(([along, half]) => bone.at(along, -half));
  const normal = bone.angle + HALF_PI;

  ctx.beginPath();
  smoothThrough(ctx, plusSide, true);
  capEnd(ctx, bone, 1, lastOf(contour.plus), lastOf(contour.minus), normal);
  smoothThrough(ctx, [...minusSide].reverse(), false);
  capEnd(ctx, bone, 0, contour.minus[0], contour.plus[0], normal + Math.PI);
  ctx.closePath();
}

function lastOf(stations: readonly Station[]): Station {
  return stations[stations.length - 1];
}

function smoothThrough(ctx: Ctx, points: readonly Pt[], start: boolean): void {
  if (points.length === 0) return;
  if (start) ctx.moveTo(points[0].x, points[0].y);
  else ctx.lineTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1];
    const mid = mixPt(points[i], next, 0.5);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

/**
 * A round cap across the bone at `along`, from the side the path is on to the
 * other one. Its centre slides toward the wider side, so a cap still meets
 * both outlines when the two sides end at different half-widths.
 */
function capEnd(
  ctx: Ctx,
  bone: BoneFrame,
  along: number,
  arriving: Station,
  leaving: Station,
  startAngle: number,
): void {
  const arrivingHalf = arriving[1];
  const leavingHalf = leaving[1];
  const radius = (arrivingHalf + leavingHalf) / 2;
  // The path arrives on the side `startAngle` points to, so the centre shifts that way.
  const shift = (arrivingHalf - leavingHalf) / 2;
  const centre = bone.at(along, along === 1 ? shift : -shift);
  ctx.arc(centre.x, centre.y, radius, startAngle, startAngle - Math.PI, true);
}

/**
 * Which side of a bone faces outward (head-on: away from the body's
 * centreline) or forward (profile: toward +X, where he faces), as a sign on the
 * bone's `plus` normal.
 *
 * In profile the front of a limb is always its `minus` side: a leg or arm
 * hanging down points +Y, and rotating that a quarter turn toward the face
 * gives +X. The rule holds as the limb swings — a thigh raised level shows its
 * quad on top, a shin kicked back shows its front underneath.
 */
/** Edge-on a limb's front is always on the bone's `minus` side: he faces +X. */
const PROFILE_OUTER_SIGN = -1;

function outerSign(bone: BoneFrame, profile: boolean, outward: number): number {
  if (profile) return PROFILE_OUTER_SIGN;
  const normalX = -Math.sin(bone.angle);
  return normalX * outward >= 0 ? 1 : -1;
}

/** A contour from an outer (or front) side and an inner (or back) side. */
function sided(outer: readonly Station[], inner: readonly Station[], sign: number): Contour {
  return sign > 0 ? { plus: outer, minus: inner } : { plus: inner, minus: outer };
}

/**
 * The line a contour is shaded along, and its half-width. A segment whose two
 * sides bulge unequally — a calf swelling behind a straight shin — has its
 * middle off the bone, and a gradient centred on the bone would put the whole
 * visible limb on one side of the terminator. The axis runs down the
 * contour's own middle instead, at its widest half-width.
 */
function contourAxis(bone: BoneFrame, contour: Contour): { from: Pt; to: Pt; halfWidth: number } {
  const stations = Math.min(contour.plus.length, contour.minus.length);
  let offset = 0;
  let halfWidth = 0;
  for (let i = 0; i < stations; i++) {
    const plusHalf = contour.plus[i][1];
    const minusHalf = contour.minus[i][1];
    offset += (plusHalf - minusHalf) / 2 / stations;
    halfWidth = Math.max(halfWidth, (plusHalf + minusHalf) / 2);
  }
  return { from: bone.at(0, offset), to: bone.at(1, offset), halfWidth };
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/** The widths a leg is drawn from, root to tip. */
interface LegShape {
  readonly thigh: number;
  readonly knee: number;
  readonly calf: number;
  readonly ankle: number;
  /** Where the calf is widest, 0 at the knee and 1 at the ankle. */
  readonly calfAt: number;
}

const LEG_SHAPE: LegShape = {
  thigh: THIGH_WIDTH,
  knee: KNEE_WIDTH,
  calf: CALF_WIDTH,
  ankle: ANKLE_WIDTH,
  calfAt: CALF_AT,
};

/**
 * A leg swung toward the camera, drawn from the front. Everything below the
 * knee is nearer the viewer than the thigh is, so it reads *larger*, not
 * smaller: the knee stops pinching and the shin and ankle gain a little. The
 * calf's widest point also slides down the shin, because a shin tipped toward
 * the viewer projects its swell closer to the foot.
 */
const NEAR_CALF_GAIN = 1.16;
/**
 * The knee grows toward the camera too, but stays a knee: widened to the
 * thigh's full width, the end of a leg pointed at the viewer is one round
 * disc as broad as the hips, which at the tile reads as a ball held over the
 * shorts rather than a knee with a shin hanging from it.
 */
const NEAR_KNEE_GAIN = 1.45;
const NEAR_ANKLE_GAIN = 1.14;
const NEAR_CALF_AT = 0.5;
const NEAR_LEG_SHAPE: LegShape = {
  thigh: THIGH_WIDTH,
  knee: KNEE_WIDTH * NEAR_KNEE_GAIN,
  calf: CALF_WIDTH * NEAR_CALF_GAIN,
  ankle: ANKLE_WIDTH * NEAR_ANKLE_GAIN,
  calfAt: NEAR_CALF_AT,
};

/**
 * Edge-on the calf shows its belly as the thigh shows its depth
 * (`PROFILE_THIGH_DEPTH`): drawn at the head-on widths, his legs read as
 * sticks under the jacket.
 */
const PROFILE_CALF_DEPTH = 1.2;

function profileLegShape(shape: LegShape): LegShape {
  return {
    ...shape,
    thigh: shape.thigh * PROFILE_THIGH_DEPTH,
    calf: shape.calf * PROFILE_CALF_DEPTH,
  };
}

function legShapeFor(nearness: number): LegShape {
  const t = clamp01(nearness);
  if (t <= 0) return LEG_SHAPE;
  return {
    thigh: lerp(LEG_SHAPE.thigh, NEAR_LEG_SHAPE.thigh, t),
    knee: lerp(LEG_SHAPE.knee, NEAR_LEG_SHAPE.knee, t),
    calf: lerp(LEG_SHAPE.calf, NEAR_LEG_SHAPE.calf, t),
    ankle: lerp(LEG_SHAPE.ankle, NEAR_LEG_SHAPE.ankle, t),
    calfAt: lerp(LEG_SHAPE.calfAt, NEAR_LEG_SHAPE.calfAt, t),
  };
}

/**
 * The outer quad (vastus lateralis) sweeps out past the hip's width a little
 * below the boxer hem, so the sweep is what the bare thigh shows first.
 */
const QUAD_SWEEP_AT = 0.55;
const QUAD_SWEEP = 1.35;
/** Where the outer thigh has come back in to the knee's side. */
const OUTER_KNEE_AT = 0.86;
const OUTER_KNEE_SWELL = 1.3;
/** The inner thigh runs in from the groin, then the teardrop bulges above the knee. */
const INNER_THIGH_AT = 0.4;
const INNER_THIGH = 0.86;
const TEARDROP_AT = 0.8;
const TEARDROP = 0.82;
/** The inner line cuts in hard under the teardrop: that step is what makes it a teardrop. */
const UNDER_TEARDROP_AT = 0.95;
const UNDER_TEARDROP = 1.02;
/**
 * Head-on the inner knee — the broad medial condyle — stays nearly as wide as
 * the leg above and below it; the pinch that makes the knee is on the outer
 * side. Pinched inside too, the gap between his legs swells into a diamond at
 * the knees a few pixels across, which the silhouette outline fills solid and
 * which then reads as a dark spot floating between his knees.
 */
const INNER_KNEE = 1.3;

/** Profile: the quad in front, the hamstring behind it swelling higher up. */
const PROFILE_THIGH_ROOT = 0.75;
const PROFILE_QUAD_AT = 0.4;
const PROFILE_QUAD = 1.15;
const PROFILE_KNEE_FRONT_AT = 0.86;
const PROFILE_KNEE_FRONT = 1.2;
const HAMSTRING_AT = 0.25;
const HAMSTRING = 1.05;
const HAMSTRING_TENDON_AT = 0.72;
const HAMSTRING_TENDON = 0.78;

function thighContour(shape: LegShape, profile: boolean, sign: number): Contour {
  const { thigh, knee } = shape;
  if (profile) {
    return sided(
      [
        [0, thigh * PROFILE_THIGH_ROOT],
        [PROFILE_QUAD_AT, thigh * PROFILE_QUAD],
        [PROFILE_KNEE_FRONT_AT, knee * PROFILE_KNEE_FRONT],
        [1, knee],
      ],
      [
        [0, thigh * PROFILE_THIGH_ROOT],
        [HAMSTRING_AT, thigh * HAMSTRING],
        [HAMSTRING_TENDON_AT, thigh * HAMSTRING_TENDON],
        [1, knee],
      ],
      sign,
    );
  }
  return sided(
    [
      [0, thigh],
      [QUAD_SWEEP_AT, thigh * QUAD_SWEEP],
      [OUTER_KNEE_AT, knee * OUTER_KNEE_SWELL],
      [1, knee],
    ],
    [
      [0, thigh],
      [INNER_THIGH_AT, thigh * INNER_THIGH],
      [TEARDROP_AT, thigh * TEARDROP],
      [UNDER_TEARDROP_AT, knee * UNDER_TEARDROP * INNER_KNEE],
      [1, knee * INNER_KNEE],
    ],
    sign,
  );
}

/**
 * Head-on the calf bulges further on the inside than the outside — the medial
 * head of the gastrocnemius is the bigger and lower of the two — then both
 * lines taper through the Achilles to a slim ankle, where the inner
 * malleolus sits higher than the outer.
 */
const OUTER_CALF_LEAD = 0.8;
const OUTER_CALF = 1.3;
const INNER_CALF_LAG = 1.1;
const INNER_CALF = 1.14;
const CALF_TAPER_AT = 0.62;
const CALF_TAPER = 0.68;
const OUTER_MALLEOLUS_AT = 0.9;
const INNER_MALLEOLUS_AT = 0.85;
const MALLEOLUS_SWELL = 1.1;

/** Profile: a near-straight shin in front, the gastrocnemius belly high behind. */
const TIBIA_TOP = 1.08;
const TIBIA_AT = 0.25;
const TIBIA = 0.8;
const TIBIA_LOW_AT = 0.75;
const GASTROC_BELLY = 1.35;
const GASTROC_FALL_AT = 0.5;
const GASTROC_FALL = 0.95;
/** The Achilles is narrower than the ankle below it, where the heel bone swells. */
const ACHILLES_AT = 0.8;
const ACHILLES = 0.9;

function calfContour(shape: LegShape, profile: boolean, sign: number): Contour {
  const { knee, calf, ankle, calfAt } = shape;
  if (profile) {
    return sided(
      [
        [0, knee * TIBIA_TOP],
        [TIBIA_AT, knee * TIBIA],
        [TIBIA_LOW_AT, ankle * MALLEOLUS_SWELL],
        [1, ankle],
      ],
      [
        [0, knee],
        [calfAt, calf * GASTROC_BELLY],
        [GASTROC_FALL_AT, calf * GASTROC_FALL],
        [ACHILLES_AT, ankle * ACHILLES],
        [1, ankle],
      ],
      sign,
    );
  }
  return sided(
    [
      [0, knee],
      [calfAt * OUTER_CALF_LEAD, calf * OUTER_CALF],
      [CALF_TAPER_AT, calf * CALF_TAPER],
      [OUTER_MALLEOLUS_AT, ankle * MALLEOLUS_SWELL],
      [1, ankle],
    ],
    [
      [0, knee * INNER_KNEE],
      [calfAt * INNER_CALF_LAG, calf * INNER_CALF],
      [CALF_TAPER_AT, calf * CALF_TAPER],
      [INNER_MALLEOLUS_AT, ankle * MALLEOLUS_SWELL],
      [1, ankle],
    ],
    sign,
  );
}

/**
 * Bare limbs put the terminator on the bone rather than past it. At the 32 px
 * tile a shin or forearm is four or five pixels across and the silhouette
 * outline takes the outer pixel on each side, so a terminator out toward the
 * shadow edge lands under the outline and the limb shows only its lit half —
 * a flat, pale stick. On the bone, the shadow half keeps pixels of its own.
 */
const BARE_LIMB_TERMINATOR = 0.5;
/**
 * The forearm is the narrowest bare limb, four pixels at the tile where it
 * swings clear of the body, and its brachioradialis highlight rides the lit
 * half: with the terminator on the bone both interior pixels land in light.
 * Set toward the lit side, one of them turns.
 */
const FOREARM_TERMINATOR = 0.5;

// ── Muscle forms ─────────────────────────────────────────────────────────────

/**
 * One muscle form inside a limb segment, painted as a soft patch in the
 * bone's frame.
 *
 * A top-lit muscle belly reads as a bulge because its upper face turns up to
 * the key and its underside turns away: a light patch on the belly, a shadow
 * patch where it rolls under, and a dark valley between two bellies. That
 * variation *along* the limb is what the across-the-limb terminator in
 * `shadeForm` cannot give, and it is what makes a lit column into a thigh.
 * Grooves are soft valleys, never stroked lines — a line down a leg reads as a
 * seam, and one across the knee reads as a doll's joint.
 */
interface MuscleForm {
  /** Along the bone, 0 at the root, 1 at the tip. */
  readonly at: number;
  /** Across the bone, in shares of the segment's reference half-width; + is outer (head-on) or front (profile). */
  readonly across: number;
  /** Radius along the bone, in shares of the bone's length. */
  readonly along: number;
  /** Radius across the bone, in shares of the segment's reference half-width. */
  readonly width: number;
  readonly tone: 'light' | 'mid' | 'shadow' | 'dark';
  readonly alpha: number;
}

/** Head-on front: the quad and teardrop over the knee. */
const THIGH_FRONT_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0.55, across: 0.25, along: 0.2, width: 0.55, alpha: 0.55 },
  { tone: 'dark', at: 0.68, across: -0.12, along: 0.12, width: 0.18, alpha: 0.5 },
  { tone: 'light', at: 0.74, across: -0.5, along: 0.2, width: 0.32, alpha: 0.55 },
  { tone: 'shadow', at: 0.95, across: -0.45, along: 0.07, width: 0.45, alpha: 0.6 },
];
/**
 * Head-on front: kneecap, the inner calf head, the tibia's lit crest. The
 * ankle bones are carried by the silhouette's malleolus bumps alone: a lit dot
 * a pixel wide does not survive the tile.
 */
const SHIN_FRONT_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0, across: 0.05, along: 0.08, width: 0.34, alpha: 0.5 },
  { tone: 'shadow', at: 0.1, across: 0.05, along: 0.04, width: 0.35, alpha: 0.55 },
  { tone: 'light', at: 0.26, across: -0.55, along: 0.14, width: 0.35, alpha: 0.6 },
  { tone: 'shadow', at: 0.5, across: -0.55, along: 0.1, width: 0.35, alpha: 0.5 },
  { tone: 'light', at: 0.5, across: -0.1, along: 0.3, width: 0.12, alpha: 0.65 },
];
/** From behind: the hamstrings, the split between them, the knee pit. */
const THIGH_BACK_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0.5, across: 0, along: 0.2, width: 0.6, alpha: 0.45 },
  { tone: 'dark', at: 0.75, across: 0, along: 0.15, width: 0.12, alpha: 0.5 },
  { tone: 'shadow', at: 0.97, across: 0, along: 0.05, width: 0.5, alpha: 0.6 },
];
/** From behind: the calf's two heads, the split between them, the belly rolling under. */
const SHIN_BACK_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0.28, across: 0.45, along: 0.22, width: 0.26, alpha: 0.4 },
  { tone: 'light', at: 0.28, across: -0.45, along: 0.22, width: 0.26, alpha: 0.4 },
  { tone: 'dark', at: 0.3, across: 0, along: 0.12, width: 0.1, alpha: 0.55 },
  { tone: 'shadow', at: 0.52, across: 0, along: 0.1, width: 0.7, alpha: 0.45 },
];
/** Profile: quad in front, hamstring behind, the groove between. */
const THIGH_SIDE_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0.5, across: 0.35, along: 0.2, width: 0.45, alpha: 0.55 },
  { tone: 'light', at: 0.35, across: -0.55, along: 0.15, width: 0.3, alpha: 0.4 },
  { tone: 'dark', at: 0.6, across: -0.25, along: 0.25, width: 0.12, alpha: 0.5 },
  { tone: 'shadow', at: 0.9, across: 0.45, along: 0.07, width: 0.35, alpha: 0.5 },
];
/**
 * Profile: kneecap on the front edge, calf belly behind.
 * The tibia crest faces forward, away from the key, so edge-on it is only a
 * mid-tone ridge in the shin's shadow — lit, it would flatten the shadow side
 * the calf needs to read round at the tile.
 */
const SHIN_SIDE_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0, across: 0.6, along: 0.07, width: 0.3, alpha: 0.8 },
  { tone: 'shadow', at: 0.1, across: 0.55, along: 0.04, width: 0.3, alpha: 0.55 },
  { tone: 'light', at: 0.25, across: -0.45, along: 0.13, width: 0.38, alpha: 0.6 },
  { tone: 'shadow', at: 0.5, across: -0.55, along: 0.09, width: 0.4, alpha: 0.55 },
  { tone: 'mid', at: 0.5, across: 0.62, along: 0.28, width: 0.12, alpha: 0.45 },
];

function paintForms(
  ctx: Ctx,
  bone: BoneFrame,
  reference: number,
  sign: number,
  forms: readonly MuscleForm[],
  flesh: Ramp,
): void {
  for (const muscle of forms) {
    const centre = bone.at(muscle.at, muscle.across * reference * sign);
    fillSoftEllipse(
      ctx,
      centre.x,
      centre.y,
      bone.length * muscle.along,
      reference * muscle.width,
      flesh[muscle.tone],
      muscle.alpha,
      bone.angle,
    );
  }
}

function legForms(view: ViewSpec): { thigh: readonly MuscleForm[]; shin: readonly MuscleForm[] } {
  if (view.profile) return { thigh: THIGH_SIDE_FORMS, shin: SHIN_SIDE_FORMS };
  if (view.showsBack) return { thigh: THIGH_BACK_FORMS, shin: SHIN_BACK_FORMS };
  return { thigh: THIGH_FRONT_FORMS, shin: SHIN_FRONT_FORMS };
}

/**
 * Which part of a leg to paint. A knee driven at the camera is nearer than
 * the shorts the thigh disappears into, so the figure paints that leg in two
 * passes: the thigh under the boxers, the knee, shin and foot over them.
 */
export type LegSegments = 'whole' | 'thigh' | 'lower';

/**
 * Paints a bare leg: thigh and shin as two anatomical silhouettes, each shaded
 * along its own bone, with its muscle forms laid in its clip. The lower
 * segment is its own form so the knee pinches and the calf swells back out
 * below it — drawn as one taper a leg is a traffic cone.
 */
function drawBareLeg(
  ctx: Ctx,
  chain: BoneChain,
  shape: LegShape,
  view: ViewSpec,
  outward: number,
  segments: LegSegments,
): void {
  const flesh = SKIN;
  const forms = legForms(view);
  const thighBone = boneFrame(chain.root, chain.joint);
  const shinBone = boneFrame(chain.joint, chain.end);
  const thighSign = outerSign(thighBone, view.profile, outward);
  const shinSign = outerSign(shinBone, view.profile, outward);
  const thighShape = thighContour(shape, view.profile, thighSign);
  const shinShape = calfContour(shape, view.profile, shinSign);
  const traceThigh = (): void => traceContour(ctx, thighBone, thighShape);
  const traceShin = (): void => traceContour(ctx, shinBone, shinShape);

  if (segments !== 'lower') {
    const thighAxis = contourAxis(thighBone, thighShape);
    shadeForm(
      ctx,
      traceThigh,
      thighAxis,
      flesh,
      {
        halfWidth: thighAxis.halfWidth,
        terminator: BARE_LIMB_TERMINATOR,
      },
      () => {
        paintForms(ctx, thighBone, shape.thigh, thighSign, forms.thigh, flesh);
      },
    );
  }
  if (segments === 'thigh') return;
  const shinAxis = contourAxis(shinBone, shinShape);
  shadeForm(
    ctx,
    traceShin,
    shinAxis,
    flesh,
    {
      halfWidth: shinAxis.halfWidth,
      terminator: BARE_LIMB_TERMINATOR,
    },
    () => {
      paintForms(ctx, shinBone, shape.calf, shinSign, forms.shin, flesh);
    },
  );
}

const KNEECAP_ALONG = 0.06;
/** The kneecap's highlight sits toward the key, as a share of the shin's half-width. */
const KNEECAP_TOWARD_LIGHT = 0.25;
const KNEECAP_RX = 0.85;
const KNEECAP_RY = 0.7;
const KNEECAP_ALPHA = 0.95;
const KNEECAP_CORE = 0.5;
const UNDER_KNEE_ALONG = 0.3;
const UNDER_KNEE_RX = 1.05;
const UNDER_KNEE_RY = 0.45;
const UNDER_KNEE_ALPHA = 0.7;
/** The shin plane darkens from under the knee and eases off toward the ankle, where the floor's bounce reaches it. */
const SHIN_PLANE_FROM = 0.22;
const SHIN_PLANE_PEAK = 0.5;
const SHIN_PLANE_TO = 1;
const SHIN_PLANE_ALPHA = 0.6;
const SHIN_PLANE_ANKLE_ALPHA = 0.3;

/**
 * A knee driven at the camera — a chambered stomp, a front kick, a knee
 * strike — is drawn head-on as a knee high over the shorts with the shin
 * hanging from it, and shaded like any standing shin that is one even flesh
 * tone, which at the tile is a pink blob over the boxers. Three value steps
 * give it the structure of a leg coming at the viewer: the kneecap, the part
 * nearest the camera, catches the key as the brightest skin on the figure; the
 * shin under it faces down and away from the light and drops into a darker
 * plane; and just under the kneecap a pocket of shade parts the two, so the
 * knee reads as a round end rather than as the top of a longer shin.
 *
 * `strength` (0–1) is how squarely the thigh points at the camera.
 */
export function paintKneeAtCamera(
  ctx: Ctx,
  chain: BoneChain,
  view: ViewSpec,
  outward: number,
  nearness: number,
  strength: number,
): void {
  const amount = clamp01(strength);
  if (amount <= 0) return;
  const shinBone = boneFrame(chain.joint, chain.end);
  const shinSign = outerSign(shinBone, view.profile, outward);
  const shinShape = calfContour(legShapeFor(nearness), view.profile, shinSign);
  const { halfWidth } = contourAxis(shinBone, shinShape);
  const across = { x: -Math.sin(shinBone.angle), y: Math.cos(shinBone.angle) };
  const towardLight = across.x * LIGHT.x + across.y * LIGHT.y >= 0 ? 1 : -1;
  withClip(
    ctx,
    () => traceContour(ctx, shinBone, shinShape),
    () => {
      const planeFrom = shinBone.at(SHIN_PLANE_FROM, 0);
      const planeTo = shinBone.at(SHIN_PLANE_TO, 0);
      const plane = ctx.createLinearGradient(planeFrom.x, planeFrom.y, planeTo.x, planeTo.y);
      const peakStop = (SHIN_PLANE_PEAK - SHIN_PLANE_FROM) / (SHIN_PLANE_TO - SHIN_PLANE_FROM);
      plane.addColorStop(0, rgba(SKIN.dark, 0));
      plane.addColorStop(peakStop, rgba(SKIN.dark, SHIN_PLANE_ALPHA * amount));
      plane.addColorStop(1, rgba(SKIN.dark, SHIN_PLANE_ANKLE_ALPHA * amount));
      ctx.fillStyle = plane;
      traceContour(ctx, shinBone, shinShape);
      ctx.fill();

      const underKnee = shinBone.at(UNDER_KNEE_ALONG, 0);
      fillSoftEllipse(
        ctx,
        underKnee.x,
        underKnee.y,
        halfWidth * UNDER_KNEE_RY,
        halfWidth * UNDER_KNEE_RX,
        SKIN.shadow,
        UNDER_KNEE_ALPHA * amount,
        shinBone.angle,
      );
      const kneecap = shinBone.at(KNEECAP_ALONG, towardLight * halfWidth * KNEECAP_TOWARD_LIGHT);
      fillSoftEllipse(
        ctx,
        kneecap.x,
        kneecap.y,
        halfWidth * KNEECAP_RY,
        halfWidth * KNEECAP_RX,
        SKIN.rim,
        KNEECAP_ALPHA * amount,
        shinBone.angle,
        KNEECAP_CORE,
      );
    },
  );
}

// ── Arms ─────────────────────────────────────────────────────────────────────

/** The widths an arm is drawn from, root to tip. */
interface ArmShape {
  readonly upper: number;
  readonly elbow: number;
  readonly belly: number;
  readonly wrist: number;
}

const ARM_SHAPE: ArmShape = {
  upper: UPPER_ARM_WIDTH,
  elbow: ELBOW_WIDTH,
  belly: FOREARM_BELLY_WIDTH,
  wrist: WRIST_WIDTH,
};

/**
 * Edge-on the arm is the only part of him with any depth to show, and the
 * forearm is what the shoved-up sleeves are there to display, so it is drawn
 * heavier than the head-on arm: a forearm is deeper front to back (thumb side
 * to little-finger side) than it is across.
 */
const PROFILE_ARM_GIRTH = 1.15;
/**
 * The upper arm edge-on is the sleeve hanging over the side of the chest, and
 * drawn at the forearm's girth, cap and all, it covers nearly the whole depth
 * of the torso — a pauldron, with no chest in front of it or back behind it.
 * Slimmer than head-on, the chest shows past it on both sides.
 */
const PROFILE_UPPER_ARM_GIRTH = 0.85;

function armShapeFor(profile: boolean): ArmShape {
  if (!profile) return ARM_SHAPE;
  return {
    upper: ARM_SHAPE.upper * PROFILE_UPPER_ARM_GIRTH,
    elbow: ARM_SHAPE.elbow * PROFILE_ARM_GIRTH,
    belly: ARM_SHAPE.belly * PROFILE_ARM_GIRTH,
    wrist: ARM_SHAPE.wrist * PROFILE_ARM_GIRTH,
  };
}

/**
 * The forearm's outer (thumb) side carries the brachioradialis and wrist
 * extensors: a mass bunched just below the elbow that runs out to tendon by
 * mid-forearm. The inner side is the flexors, lower and softer. Both taper to a
 * wrist that stays thick.
 */
const BRACHIORADIALIS_AT = 0.3;
const BRACHIORADIALIS = 1.08;
const EXTENSOR_TAPER_AT = 0.6;
const EXTENSOR_TAPER = 0.8;
const FLEXOR_AT = 0.36;
const FLEXOR = 1.18;
const FLEXOR_TAPER_AT = 0.72;
const FLEXOR_TAPER = 1.45;

function forearmContour(shape: ArmShape, sign: number): Contour {
  return sided(
    [
      [0, shape.elbow],
      [BRACHIORADIALIS_AT, shape.belly * BRACHIORADIALIS],
      [EXTENSOR_TAPER_AT, shape.belly * EXTENSOR_TAPER],
      [1, shape.wrist],
    ],
    [
      [0, shape.elbow],
      [FLEXOR_AT, shape.belly * FLEXOR],
      [FLEXOR_TAPER_AT, shape.wrist * FLEXOR_TAPER],
      [1, shape.wrist],
    ],
    sign,
  );
}

/** A bare limb segment, as the gates measure across it. */
export type BareSegment = 'thigh' | 'calf' | 'forearm';

function halfWidthAt(stations: readonly Station[], along: number): number {
  const next = stations.findIndex(([at]) => at >= along);
  if (next <= 0) return stations[Math.max(next, 0)][1];
  const [fromAt, fromHalf] = stations[next - 1];
  const [toAt, toHalf] = stations[next];
  return lerp(fromHalf, toHalf, (along - fromAt) / (toAt - fromAt));
}

/**
 * How far a bare segment's modelled silhouette reaches either side of its
 * bone, `along` it (0 at its root, 1 at its tip), in figure units, as a leg
 * not swung toward the camera is drawn. `plus` is the side the bone's
 * left-hand normal (`-dy, dx`) points to. Everything inside these is that limb
 * and nothing laid beside it, which is what a gate measuring the limb's own
 * shading has to confine itself to.
 *
 * Edge-on which side is which is fixed: the front of the limb is always on
 * `minus`. Head-on it turns on which leg or arm it is and which way the bone
 * points, so both edges are given as the narrower of the two sides.
 */
export function bareSegmentEdges(
  segment: BareSegment,
  along: number,
  profile: boolean,
): { readonly plus: number; readonly minus: number } {
  const legShape = profile ? profileLegShape(LEG_SHAPE) : LEG_SHAPE;
  // Head-on both edges come out as the narrower side, so the side chosen here is moot.
  const sign = profile ? PROFILE_OUTER_SIGN : 1;
  const contours: Record<BareSegment, () => Contour> = {
    thigh: () => thighContour(legShape, profile, sign),
    calf: () => calfContour(legShape, profile, sign),
    forearm: () => forearmContour(armShapeFor(profile), sign),
  };
  const contour = contours[segment]();
  const plus = halfWidthAt(contour.plus, along);
  const minus = halfWidthAt(contour.minus, along);
  if (profile) return { plus, minus };
  const narrower = Math.min(plus, minus);
  return { plus: narrower, minus: narrower };
}

/**
 * The brachioradialis and extensors as one lit mass high on the outer
 * forearm, the flexors as a softer one on the inner side, the valley between
 * them running toward the middle of the wrist.
 */
const FOREARM_FORMS: readonly MuscleForm[] = [
  { tone: 'light', at: 0.42, across: 0.4, along: 0.2, width: 0.45, alpha: 0.75 },
  { tone: 'dark', at: 0.58, across: -0.05, along: 0.18, width: 0.12, alpha: 0.5 },
  { tone: 'light', at: 0.55, across: -0.55, along: 0.12, width: 0.3, alpha: 0.4 },
];

/**
 * Paints an arm: the forearm's anatomical silhouette and muscle, then the
 * jacket's shoved-up sleeve over the upper arm and elbow, which throws its
 * cuff shadow onto the forearm.
 */
function drawSleevedArm(
  ctx: Ctx,
  chain: BoneChain,
  shape: ArmShape,
  shade: number,
  profile: boolean,
  outward: number,
): void {
  const flesh = receded(SKIN, shade);
  const forearmBone = boneFrame(chain.joint, chain.end);
  const sign = outerSign(forearmBone, profile, outward);
  const forearm = forearmContour(shape, sign);
  const traceForearm = (): void => traceContour(ctx, forearmBone, forearm);

  const forearmAxis = contourAxis(forearmBone, forearm);
  shadeForm(
    ctx,
    traceForearm,
    forearmAxis,
    flesh,
    {
      halfWidth: forearmAxis.halfWidth,
      terminator: FOREARM_TERMINATOR,
    },
    () => {
      paintForms(ctx, forearmBone, shape.belly, sign, FOREARM_FORMS, flesh);
    },
  );

  drawSleeve(ctx, {
    chain,
    upperHalf: shape.upper,
    elbowHalf: shape.elbow,
    forearmHalf: shape.belly,
    flesh,
    traceForearm,
    shade,
  });
}

function traceCapsuleBetween(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  traceContour(ctx, boneFrame(a, b), {
    plus: [
      [0, wa],
      [1, wb],
    ],
    minus: [
      [0, wa],
      [1, wb],
    ],
  });
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * A hand is derived from its forearm, never from the head: this figure's head
 * is deliberately oversized, and a face-length hand would be most of a
 * forearm long. Real hands run about 0.7 of the forearm; he gets a little
 * under that, because at the tile a hand this long already reads as big and
 * any longer the arm reads as ending in a paddle.
 */
const HAND_LENGTH = FOREARM_LENGTH * 0.58;
/**
 * Across the knuckles an open hand is about half as wide as it is long; this
 * one is broader, because a big, heavy hand is part of the build and at the
 * tile a hand only reads as big through its width. It also has to clear the
 * wrist by a pixel either side at the tile: a hand no wider than the thick
 * wrist it hangs from continues the forearm's taper, and the bare arm below
 * the cuff reads as one cone — a sleeve's lit end — instead of forearm then
 * hand.
 */
const HAND_WIDTH = HAND_LENGTH * 0.84;
/**
 * A fist is the palm plus the rolled fingers: shorter than the hand, and at
 * least a fifth wider than the thick wrist it closes over — a fist no wider
 * than its wrist reads as the arm ending in a stump.
 */
const FIST_LENGTH = HAND_LENGTH * 0.62;
const FIST_WIDTH = WRIST_WIDTH * 2 * 1.4;
/** The heel of the hand, where it leaves the wrist, is narrower than the knuckles. */
const PALM_HEEL = 0.78;
/** Where the knuckles sit along an open hand; past them the fingers narrow to the tip. */
const KNUCKLES_AT = 0.5;
const FINGER_TIP_WIDTH = 0.72;
/** The front of a fist is squared off with rounded corners, not a dome. */
const FIST_CORNER = 0.25;

/** Finger splits at the tip of an open hand; four fingers, three gaps. */
const FINGER_GAPS = 3;
const FINGER_SPLIT_DEPTH = 0.28;
const FINGER_SPREAD = 0.6;
/** Knuckle notches on the leading edge of a fist. */
const KNUCKLE_NOTCH_DEPTH = 0.14;
const KNUCKLE_ALPHA = 0.8;
/** The knuckle ridge: the row of bone across the back of a fist that catches the key. */
const KNUCKLE_RIDGE_AT = 0.72;
const KNUCKLE_RIDGE_ALONG_RADIUS = 0.13;
const KNUCKLE_RIDGE_ACROSS_RADIUS = 0.9;
const KNUCKLE_RIDGE_ALPHA = 0.8;
/** A relaxed hand's knuckles still catch some light: the fingers curl, they do not flatten. */
const KNUCKLE_RIDGE_MIN_SHOWN = 0.5;
/** The band across the heel of the hand, just past the wrist. */
const WRIST_TURN_AT = 0.06;
const WRIST_TURN_ALONG_RADIUS = 0.2;
const WRIST_TURN_ACROSS_RADIUS = 1.1;
const WRIST_TURN_ALPHA = 0.85;

/**
 * The thumb, in shares of the hand's length and half-width. Relaxed it lies
 * along the palm's inner edge; in a fist it crosses the front of the curled
 * fingers; round a haft it locks over the knuckles; open it splays away.
 */
interface ThumbPlacement {
  readonly baseAt: number;
  readonly baseAcross: number;
  readonly tipAt: number;
  readonly tipAcross: number;
}

const RELAXED_THUMB: ThumbPlacement = {
  baseAt: 0.18,
  baseAcross: 0.8,
  tipAt: 0.55,
  tipAcross: 1.05,
};
const FIST_THUMB: ThumbPlacement = { baseAt: 0.3, baseAcross: 0.95, tipAt: 0.82, tipAcross: 0.1 };
const GRIP_THUMB: ThumbPlacement = { baseAt: 0.35, baseAcross: 0.95, tipAt: 0.95, tipAcross: 0.35 };
const OPEN_THUMB: ThumbPlacement = { baseAt: 0.15, baseAcross: 0.8, tipAt: 0.42, tipAcross: 1.75 };
/** The thumb's thickness against the hand's half-width, root and tip. */
const THUMB_ROOT_WIDTH = 0.36;
const THUMB_TIP_WIDTH = 0.28;
/**
 * A fist's thumb is shaded a step back from the fingers it lies across, so it
 * reads as a separate digit over them rather than a lump on the fist.
 */
const THUMB_OVER_FIST_SHADE = 0.25;

/** A gripped haft runs across the fist through the curled fingers, just behind the knuckles. */
const GRIP_BORE_AT = 0.62;

interface HandForm {
  readonly length: number;
  readonly halfWidth: number;
  /** 0 an open hand's fingers, 1 a fist's rolled knuckles. */
  readonly closed: number;
  readonly thumb: ThumbPlacement;
}

function mixThumb(a: ThumbPlacement, b: ThumbPlacement, t: number): ThumbPlacement {
  return {
    baseAt: lerp(a.baseAt, b.baseAt, t),
    baseAcross: lerp(a.baseAcross, b.baseAcross, t),
    tipAt: lerp(a.tipAt, b.tipAt, t),
    tipAcross: lerp(a.tipAcross, b.tipAcross, t),
  };
}

function handForm(fist: number, shape: HandShape): HandForm {
  if (shape === 'open') {
    return { length: HAND_LENGTH, halfWidth: HAND_WIDTH / 2, closed: 0, thumb: OPEN_THUMB };
  }
  if (shape === 'grip') {
    return { length: FIST_LENGTH, halfWidth: FIST_WIDTH / 2, closed: 1, thumb: GRIP_THUMB };
  }
  const closed = clamp01(fist);
  return {
    length: lerp(HAND_LENGTH, FIST_LENGTH, closed),
    halfWidth: lerp(HAND_WIDTH, FIST_WIDTH, closed) / 2,
    closed,
    thumb: mixThumb(RELAXED_THUMB, FIST_THUMB, closed),
  };
}

/** How far a hand reaches past its wrist, from open (0) to a closed fist (1). */
export function handLength(fist: number, shape: HandShape = 'relaxed'): number {
  return handForm(fist, shape).length;
}

/** Half a hand's width across the knuckles, from open (0) to a closed fist (1). */
export function handHalfWidth(fist: number, shape: HandShape = 'relaxed'): number {
  return handForm(fist, shape).halfWidth;
}

/**
 * Where a hand in the `'grip'` shape holds a haft, for a prop painter to run
 * one through it.
 *
 * - `centre` is the middle of the bore through the curled fingers, in figure
 *   units, on the wrist-to-knuckle line just behind the knuckles.
 * - `haftAngle` is the direction the haft runs through the fist, in radians:
 *   straight across the hand, so a hammer held in a hanging arm points
 *   forward, and one held in a raised fist lies level.
 *
 * Paint the prop over the torso but *before* the arm: the fist is painted
 * over the haft, so the handle reads as held rather than as a stick laid over
 * a hand.
 */
export function handGrip(chain: BoneChain): { centre: Pt; haftAngle: number } {
  const angle = wristAngle(chain);
  const reach = FIST_LENGTH * GRIP_BORE_AT;
  return {
    centre: { x: chain.end.x + Math.cos(angle) * reach, y: chain.end.y + Math.sin(angle) * reach },
    haftAngle: angle + HALF_PI,
  };
}

/**
 * The hand's silhouette in its own frame (wrist at the origin, fingers toward
 * +X): the heel of the palm off the wrist, widening to the knuckles, then
 * either the fingers running on to a rounded tip or, closing, the fist's
 * squared front.
 */
function traceHand(ctx: Ctx, form: HandForm): void {
  const { length, halfWidth, closed } = form;
  const heel = halfWidth * PALM_HEEL;
  const knucklesAt = lerp(length * KNUCKLES_AT, length * (1 - FIST_CORNER), closed);
  const tipHalf = lerp(halfWidth * FINGER_TIP_WIDTH, halfWidth, closed);
  // An open hand's fingertips round off across their whole width; a fist's
  // front only at its corners.
  const corner = Math.min(tipHalf, lerp(tipHalf, length * FIST_CORNER, closed));
  ctx.beginPath();
  ctx.moveTo(0, -heel);
  ctx.quadraticCurveTo(knucklesAt * PALM_CURVE_AT, -halfWidth, knucklesAt, -halfWidth);
  ctx.lineTo(length - corner, -tipHalf);
  ctx.quadraticCurveTo(length, -tipHalf, length, -tipHalf + corner);
  ctx.lineTo(length, tipHalf - corner);
  ctx.quadraticCurveTo(length, tipHalf, length - corner, tipHalf);
  ctx.lineTo(knucklesAt, halfWidth);
  ctx.quadraticCurveTo(knucklesAt * PALM_CURVE_AT, halfWidth, 0, heel);
  ctx.closePath();
}

/** The palm swells out to the knuckles over the first half of its run from the wrist. */
const PALM_CURVE_AT = 0.5;

/**
 * A hand hanging off the wrist at `at`, along the arm's direction, in one of
 * the shapes {@link HandShape} names. The hand is drawn *past* the wrist
 * rather than centred on it — centred, the arm ends in a cork.
 *
 * Built from three forms — palm/fist block, thumb, knuckle ridge — and one set
 * of marks: finger splits on an open hand, knuckle notches on a closed one.
 */
function drawHand(
  ctx: Ctx,
  at: Pt,
  angle: number,
  fist: number,
  shape: HandShape,
  shade: number,
  thumbSide: number,
): void {
  const flesh = receded(SKIN, shade);
  const form = handForm(fist, shape);
  const { length, halfWidth, closed, thumb } = form;
  const shading = { frameRotation: angle };

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);

  const thumbBase = pt(length * thumb.baseAt, halfWidth * thumb.baseAcross * thumbSide);
  const thumbTip = pt(length * thumb.tipAt, halfWidth * thumb.tipAcross * thumbSide);
  const thumbRoot = halfWidth * THUMB_ROOT_WIDTH;
  const thumbEnd = halfWidth * THUMB_TIP_WIDTH;
  const traceThumb = (): void => traceCapsuleBetween(ctx, thumbBase, thumbTip, thumbRoot, thumbEnd);
  // Open or relaxed, the thumb hangs off the side under the palm; closed, it
  // crosses in front of the curled fingers and is painted over them.
  const thumbOver = closed > THUMB_OVER_THRESHOLD;
  if (!thumbOver) {
    shadeForm(ctx, traceThumb, { from: thumbBase, to: thumbTip }, flesh, {
      halfWidth: thumbRoot,
      ...shading,
    });
  }

  const traceBlock = (): void => traceHand(ctx, form);
  shadeForm(
    ctx,
    traceBlock,
    { from: pt(0, 0), to: pt(length, 0) },
    flesh,
    {
      halfWidth,
      ...shading,
    },
    () => {
      fillSoftEllipse(
        ctx,
        length * KNUCKLE_RIDGE_AT,
        0,
        length * KNUCKLE_RIDGE_ALONG_RADIUS,
        halfWidth * KNUCKLE_RIDGE_ACROSS_RADIUS,
        flesh.light,
        KNUCKLE_RIDGE_ALPHA * Math.max(closed, KNUCKLE_RIDGE_MIN_SHOWN),
      );
      // The heel of the hand turns in under the wrist: a darker band where the
      // hand leaves the forearm, so the fist reads as its own block at the end
      // of the arm rather than as the forearm swelling into a club.
      fillSoftEllipse(
        ctx,
        length * WRIST_TURN_AT,
        0,
        length * WRIST_TURN_ALONG_RADIUS,
        halfWidth * WRIST_TURN_ACROSS_RADIUS,
        flesh.shadow,
        WRIST_TURN_ALPHA,
      );
      ctx.strokeStyle = flesh.deep;
      ctx.lineWidth = FEATURE_LINE_WIDTH;
      ctx.globalAlpha *= KNUCKLE_ALPHA;
      const markDepth = lerp(FINGER_SPLIT_DEPTH, KNUCKLE_NOTCH_DEPTH, closed);
      ctx.beginPath();
      for (let i = 1; i <= FINGER_GAPS; i++) {
        const across = lerp(-halfWidth, halfWidth, i / (FINGER_GAPS + 1)) * FINGER_SPREAD * 2;
        ctx.moveTo(length * (1 - markDepth), across);
        ctx.lineTo(length, across);
      }
      ctx.stroke();
    },
  );

  if (thumbOver) {
    shadeForm(
      ctx,
      traceThumb,
      { from: thumbBase, to: thumbTip },
      receded(flesh, THUMB_OVER_FIST_SHADE),
      {
        halfWidth: thumbRoot,
        ...shading,
      },
    );
  }
  ctx.restore();
}

/** Past half-closed the thumb has swung in front of the fingers. */
const THUMB_OVER_THRESHOLD = 0.5;

/**
 * A hand does not take the full angle of its forearm. The wrist holds it close
 * to the line of the arm as a whole, which is why a walking figure's hands read
 * as rigid while the forearm swings under them — following the forearm outright
 * gives him waving hands, which nobody walks with. On a straight limb the two
 * directions coincide, so a punch is unaffected.
 */
export function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerpAngle(alongArm, alongForearm, WRIST_FOLLOW);
}

const WRIST_FOLLOW = 0.3;

/**
 * `thumbSide` is +1 for the figure's right hand and −1 for its left; it is
 * also which way that arm's outer side faces head-on. `shape` is the hand's
 * {@link HandShape}; `'relaxed'` closes by `fist`.
 */
export function drawArm(
  ctx: Ctx,
  chain: BoneChain,
  fist: number,
  shade: number,
  thumbSide: number,
  profile: boolean,
  shape: HandShape = 'relaxed',
): void {
  drawSleevedArm(ctx, chain, armShapeFor(profile), shade, profile, thumbSide);
  drawHand(ctx, chain.end, wristAngle(chain), fist, shape, shade, thumbSide);
}

/**
 * `outward` is +1 for the figure's right leg and −1 for its left.
 *
 * No depth shade, in any view: bare skin reads as one colour or as two
 * different ones, with no subtle middle, and a darkened far leg just looks like
 * his legs are painted differently. Edge-on the outline separates them.
 */
export function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  pitch: number,
  view: ViewSpec,
  outward: number,
  nearness: number,
  footScale = 1,
  segments: LegSegments = 'whole',
  accents?: FootAccents,
  point = 0,
): void {
  const shape = legShapeFor(nearness);
  const drawnShape = view.profile ? profileLegShape(shape) : shape;
  drawBareLeg(ctx, chain, drawnShape, view, outward, segments);
  if (segments === 'thigh') return;
  ctx.save();
  ctx.translate(chain.end.x, chain.end.y);
  ctx.scale(footScale, footScale);
  drawFoot(ctx, pt(0, 0), pitch, view, outward, UNSHADED, accents, point);
  ctx.restore();
}

/** Painted at its own ramp, with nothing mixed toward the outline. */
export const UNSHADED = 0;
