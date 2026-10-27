/**
 * Angel in profile: torso, head and hair, facing +x (her right side to the
 * camera). Her limbs come from `legs.ts` and `arms.ts`, drawn either side of
 * this body by the entry point.
 *
 * The torso is a profile outline in rest coordinates — (forward, down) — carried
 * through the chest and pelvis frames the same way the head-on torso is, so
 * the lean of a run and the bob of a walk move it without a separate pose. Its
 * shape is what carries her figure from the side: the long curve of the back
 * into the small of it, the seat rounding out behind and tucking under into
 * the fold, the belly flat under a lifted bust in its cup.
 */

import { fillSoftEllipse, strokeSoftCrease, taperedCreaseGradient } from '../softShade';
import { clamp01, lerp } from '../bipedArt';
import { fillCrescent, traceSmooth, type Ctx } from './paint';
import {
  BRA_COLOR,
  BRA_SHADOW,
  BRA_SHEEN,
  BRA_TRIM,
  EYE_WHITE,
  HAIR_DARK,
  HAIR_SHEEN,
  IRIS_COLOR,
  LIP_COLOR,
  LIP_SEAM_COLOR,
  LIP_UPPER_COLOR,
  SKIN_BASE,
  SKIN_CREASE,
  SKIN_HALF,
  SKIN_HIGHLIGHT,
  SKIN_LIT,
  SKIN_SHADE,
  THONG_COLOR,
  THONG_SHEEN,
  THONG_TRIM,
} from './palette';
import {
  CROTCH_Y,
  HEAD_CENTER_Y,
  HIP_JOINT_Y,
  HIP_Y,
  NECK_TOP_Y,
  SHOULDER_Y,
  WAIST_Y,
  BUST_POINT_Y,
  RIBCAGE_Y,
} from './proportions';
import { placeInSection, type AngelSkeleton, type Pt2 } from './skeleton';

type ProfilePoint = readonly [forward: number, down: number];

/** How far below a point the torso's local slope is sampled. */
const FRAME_PROBE_STEP = 0.01;

/* ── Torso outline ─────────────────────────────────────────────────────── */

/** Down the front from the throat to the crotch. */
const FRONT_CONTOUR: ReadonlyArray<ProfilePoint> = [
  [0.012, NECK_TOP_Y - 0.026],
  [0.02, NECK_TOP_Y + 0.004],
  [0.024, SHOULDER_Y - 0.012],
  [0.036, SHOULDER_Y + 0.016],
  [0.05, -0.158],
  [0.07, -0.136],
  [0.084, BUST_POINT_Y],
  [0.08, -0.095],
  [0.064, -0.08],
  [0.05, RIBCAGE_Y - 0.004],
  [0.046, -0.035],
  [0.042, WAIST_Y],
  [0.046, 0.022],
  [0.05, 0.055],
  [0.046, 0.092],
  [0.034, 0.122],
  [0.014, CROTCH_Y],
  [-0.008, CROTCH_Y + 0.01],
];
/** Back up from under the seat to the nape. */
const BACK_CONTOUR: ReadonlyArray<ProfilePoint> = [
  [-0.038, CROTCH_Y + 0.026],
  [-0.054, CROTCH_Y + 0.018],
  [-0.064, 0.135],
  [-0.071, 0.108],
  [-0.067, 0.074],
  [-0.058, 0.04],
  [-0.05, 0.008],
  [-0.047, WAIST_Y + 0.006],
  [-0.049, -0.05],
  [-0.058, -0.11],
  [-0.058, -0.16],
  [-0.048, SHOULDER_Y],
  [-0.026, SHOULDER_Y - 0.024],
  [-0.024, NECK_TOP_Y - 0.012],
  [-0.016, NECK_TOP_Y - 0.03],
];

function profileFrame(skeleton: AngelSkeleton, forward: number, down: number): Pt2 {
  const share = Math.max(0, Math.min(1, (down - RIBCAGE_Y) / (HIP_Y - RIBCAGE_Y)));
  const blend = share * share * (3 - 2 * share);
  const onChest = placeInSection(skeleton.chest, WAIST_Y, { x: 0, y: down, z: forward });
  const onPelvis = placeInSection(skeleton.pelvis, HIP_JOINT_Y, { x: 0, y: down, z: forward });
  return { x: lerp(onChest.z, onPelvis.z, blend), y: lerp(onChest.y, onPelvis.y, blend) };
}

/**
 * The seat follows the near thigh: as the leg swings forward the cheek is drawn
 * taut and the fold under it shallows into the back of the thigh; swung back,
 * the fold deepens. Fixed, the seat's underside sticks out as a shelf every
 * time the leg comes through.
 */
const SEAT_STRETCH = 0.018;
const SEAT_STRETCH_TOP_Y = 0.09;

function hipFlexOf(skeleton: AngelSkeleton): number {
  const leg = skeleton.legs[1];
  return Math.atan2(leg.knee.z - leg.hip.z, leg.knee.y - leg.hip.y);
}

function torsoOutline(skeleton: AngelSkeleton): Pt2[] {
  const reach = Math.max(0, Math.sin(hipFlexOf(skeleton)));
  const stretched = BACK_CONTOUR.map(([f, d]): ProfilePoint => {
    const depth = clamp01((d - SEAT_STRETCH_TOP_Y) / (CROTCH_Y - SEAT_STRETCH_TOP_Y));
    return [f + SEAT_STRETCH * reach * depth, d];
  });
  return [...FRONT_CONTOUR, ...stretched].map(([f, d]) => profileFrame(skeleton, f, d));
}

/** Lay the context rigidly on the torso at a profile point. */
function onProfileAt(ctx: Ctx, skeleton: AngelSkeleton, forward: number, down: number): void {
  const here = profileFrame(skeleton, forward, down);
  const below = profileFrame(skeleton, forward, down + FRAME_PROBE_STEP);
  const angle = Math.atan2(-(below.x - here.x), below.y - here.y);
  ctx.translate(here.x, here.y);
  ctx.rotate(angle);
  ctx.translate(-forward, -down);
}

/* ── Torso shading ─────────────────────────────────────────────────────── */

const BREAST_CENTER: ProfilePoint = [0.06, -0.113];
const BREAST_TILT = -0.35;
const BREAST_RADIUS_X = 0.028;
const BREAST_RADIUS_Y = 0.033;
/** The underside turns away from the light above: its core shadow is the breast slid up and a little forward. */
const BREAST_SHADE_SLIDE: ProfilePoint = [0.006, -0.02];
const BREAST_SHADE_ALPHA = 0.8;
const BREAST_LIGHT: ProfilePoint = [BREAST_CENTER[0] + 0.006, BREAST_CENTER[1] - 0.01];
const BREAST_LIGHT_RADIUS = 0.022;
const BREAST_FOLD_CONTROL: ProfilePoint = [0.066, -0.076];
const FOLD_FADE_IN = 0.3;
const BREAST_FOLD_FADE_OUT = 0.7;
const SEAT_FOLD_FADE_OUT = 0.8;
const BREAST_LIGHT_ALPHA = 0.9;
const BREAST_FOLD_WIDTH = 0.0035;
const BREAST_FOLD_ALPHA = 0.7;
const BREAST_FOLD_FROM: ProfilePoint = [0.078, -0.09];
const BREAST_FOLD_TO: ProfilePoint = [0.048, -0.077];

const SEAT_CENTER: ProfilePoint = [-0.046, 0.104];
const SEAT_TILT = 0.25;
const SEAT_LIGHT: ProfilePoint = [-0.05, 0.088];
const SEAT_LIGHT_RADIUS_X = 0.024;
const SEAT_LIGHT_RADIUS_Y = 0.026;
const SEAT_LIGHT_ALPHA = 0.7;
/**
 * The cheek's core shadow: a soft mass low and behind, where it turns from the
 * light down into the fold. A crescent cut from an ellipse here leaves a hard
 * ring inside the silhouette that reads as a pasted-on disc.
 */
const SEAT_SHADE: ProfilePoint = [-0.058, 0.13];
const SEAT_SHADE_RADIUS_X = 0.022;
const SEAT_SHADE_RADIUS_Y = 0.018;
const SEAT_SHADE_ALPHA = 0.7;
const SEAT_FOLD_FROM: ProfilePoint = [-0.06, CROTCH_Y + 0.008];
const SEAT_FOLD_TO: ProfilePoint = [-0.034, CROTCH_Y + 0.02];
const SEAT_FOLD_CONTROL: ProfilePoint = [-0.056, CROTCH_Y + 0.02];
const SEAT_FOLD_WIDTH = 0.0035;
const SEAT_FOLD_ALPHA = 0.6;

const BELLY_LIGHT: ProfilePoint = [0.03, 0.03];
const BELLY_LIGHT_RADIUS_X = 0.02;
const BELLY_LIGHT_RADIUS_Y = 0.05;
const BELLY_LIGHT_ALPHA = 0.7;
const FLANK_LIGHT: ProfilePoint = [0.0, -0.06];
const FLANK_LIGHT_RADIUS_X = 0.03;
const FLANK_LIGHT_RADIUS_Y = 0.07;
const FLANK_LIGHT_ALPHA = 0.5;
const SMALL_OF_BACK: ProfilePoint = [-0.04, 0.02];
const SMALL_OF_BACK_RADIUS_X = 0.012;
const SMALL_OF_BACK_RADIUS_Y = 0.035;
const SMALL_OF_BACK_ALPHA = 0.35;

const TIGHT_LAYERS = [
  { widthScale: 2, alpha: 0.1 },
  { widthScale: 1.4, alpha: 0.22 },
  { widthScale: 1, alpha: 0.55 },
] as const;

/* ── Thong in profile ──────────────────────────────────────────────────── */

/** The band's centre line: in at the front, up over the hip crest, down a little at the back. */
const BAND_FRONT_END: ProfilePoint = [0.058, HIP_Y - 0.004];
const BAND_FRONT_CONTROL: ProfilePoint = [0.02, HIP_Y - 0.03];
const BAND_SIDE: ProfilePoint = [0.0, HIP_Y - 0.03];
const BAND_BACK_CONTROL: ProfilePoint = [-0.04, HIP_Y - 0.03];
const BAND_BACK_END: ProfilePoint = [-0.092, HIP_Y - 0.018];
const BAND_TRIM_WIDTH = 0.003;
const BAND_TRIM_ALPHA = 0.8;

/** One edge of the band, front to back, `offset` above (negative) or below its centre line. */
function traceBandEdge(ctx: Ctx, offset: number, start: boolean): void {
  if (start) ctx.moveTo(BAND_FRONT_END[0], BAND_FRONT_END[1] + offset);
  ctx.quadraticCurveTo(
    BAND_FRONT_CONTROL[0],
    BAND_FRONT_CONTROL[1] + offset,
    BAND_SIDE[0],
    BAND_SIDE[1] + offset,
  );
  ctx.quadraticCurveTo(
    BAND_BACK_CONTROL[0],
    BAND_BACK_CONTROL[1] + offset,
    BAND_BACK_END[0],
    BAND_BACK_END[1] + offset,
  );
}
const BAND_HALF_HEIGHT = 0.004;

/**
 * Seen from the side the front panel is a narrow wedge along the front of the
 * pelvis, from the band down to where her thighs close over it; the clip to
 * her body draws its front edge as her own contour.
 */
const PANEL_FRONT_X = 0.08;
const PANEL_TOP_Y = HIP_Y - 0.012;
const PANEL_BOTTOM_Y = CROTCH_Y + 0.012;
const PANEL_GUSSET: ProfilePoint = [0.006, CROTCH_Y + 0.004];
/** The leg opening curves up and back from the gusset to the band over the hip. */
const PANEL_OPENING_CONTROL: ProfilePoint = [0.03, HIP_Y + 0.05];
const PANEL_OPENING_TOP: ProfilePoint = [0.034, PANEL_TOP_Y];
const PANEL_SHEEN_FROM: ProfilePoint = [0.044, HIP_Y + 0.008];
const PANEL_SHEEN_TO: ProfilePoint = [0.036, CROTCH_Y - 0.026];
const PANEL_SHEEN_WIDTH = 0.004;
const PANEL_SHEEN_ALPHA = 0.6;

function drawProfileThong(ctx: Ctx): void {
  ctx.fillStyle = THONG_COLOR;
  ctx.beginPath();
  ctx.moveTo(PANEL_FRONT_X, PANEL_TOP_Y);
  ctx.lineTo(PANEL_FRONT_X, PANEL_BOTTOM_Y);
  ctx.lineTo(PANEL_GUSSET[0], PANEL_BOTTOM_Y);
  ctx.lineTo(PANEL_GUSSET[0], PANEL_GUSSET[1]);
  ctx.quadraticCurveTo(
    PANEL_OPENING_CONTROL[0],
    PANEL_OPENING_CONTROL[1],
    PANEL_OPENING_TOP[0],
    PANEL_OPENING_TOP[1],
  );
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha *= PANEL_SHEEN_ALPHA;
  ctx.strokeStyle = THONG_SHEEN;
  ctx.lineWidth = PANEL_SHEEN_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(PANEL_SHEEN_FROM[0], PANEL_SHEEN_FROM[1]);
  ctx.lineTo(PANEL_SHEEN_TO[0], PANEL_SHEEN_TO[1]);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = THONG_COLOR;
  ctx.beginPath();
  traceBandEdge(ctx, -BAND_HALF_HEIGHT, true);
  ctx.lineTo(BAND_BACK_END[0], BAND_BACK_END[1] + BAND_HALF_HEIGHT);
  ctx.quadraticCurveTo(
    BAND_BACK_CONTROL[0],
    BAND_BACK_CONTROL[1] + BAND_HALF_HEIGHT,
    BAND_SIDE[0],
    BAND_SIDE[1] + BAND_HALF_HEIGHT,
  );
  ctx.quadraticCurveTo(
    BAND_FRONT_CONTROL[0],
    BAND_FRONT_CONTROL[1] + BAND_HALF_HEIGHT,
    BAND_FRONT_END[0],
    BAND_FRONT_END[1] + BAND_HALF_HEIGHT,
  );
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = THONG_TRIM;
  ctx.lineWidth = BAND_TRIM_WIDTH;
  ctx.globalAlpha *= BAND_TRIM_ALPHA;
  ctx.beginPath();
  traceBandEdge(ctx, -BAND_HALF_HEIGHT, true);
  ctx.stroke();
  ctx.restore();
}

/**
 * The torso's fill and its own modelling in profile; its outline is shaded
 * with the legs as one silhouette afterwards. Returns that outline's trace.
 */
export function drawAngelProfileBody(ctx: Ctx, skeleton: AngelSkeleton): (target: Ctx) => void {
  const outline = torsoOutline(skeleton);
  const trace = (): void => traceSmooth(ctx, outline, true);
  ctx.save();
  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  trace();
  ctx.fill();
  ctx.clip();

  const at = (p: ProfilePoint, paint: () => void): void => {
    ctx.save();
    onProfileAt(ctx, skeleton, p[0], p[1]);
    paint();
    ctx.restore();
  };

  at(FLANK_LIGHT, () =>
    fillSoftEllipse(
      ctx,
      FLANK_LIGHT[0],
      FLANK_LIGHT[1],
      FLANK_LIGHT_RADIUS_X,
      FLANK_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      FLANK_LIGHT_ALPHA,
    ),
  );
  at(BELLY_LIGHT, () =>
    fillSoftEllipse(
      ctx,
      BELLY_LIGHT[0],
      BELLY_LIGHT[1],
      BELLY_LIGHT_RADIUS_X,
      BELLY_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      BELLY_LIGHT_ALPHA,
    ),
  );
  at(SMALL_OF_BACK, () =>
    fillSoftEllipse(
      ctx,
      SMALL_OF_BACK[0],
      SMALL_OF_BACK[1],
      SMALL_OF_BACK_RADIUS_X,
      SMALL_OF_BACK_RADIUS_Y,
      SKIN_SHADE,
      SMALL_OF_BACK_ALPHA,
    ),
  );

  at(BREAST_CENTER, () => {
    fillSoftEllipse(
      ctx,
      BREAST_LIGHT[0],
      BREAST_LIGHT[1],
      BREAST_LIGHT_RADIUS,
      BREAST_LIGHT_RADIUS,
      SKIN_HIGHLIGHT,
      BREAST_LIGHT_ALPHA,
      BREAST_TILT,
    );
    const pathBreast = (): void =>
      ctx.ellipse(
        BREAST_CENTER[0],
        BREAST_CENTER[1],
        BREAST_RADIUS_X,
        BREAST_RADIUS_Y,
        BREAST_TILT,
        0,
        Math.PI * 2,
      );
    ctx.save();
    ctx.beginPath();
    pathBreast();
    ctx.clip();
    fillCrescent(
      ctx,
      pathBreast,
      BREAST_SHADE_SLIDE[0],
      BREAST_SHADE_SLIDE[1],
      SKIN_SHADE,
      BREAST_SHADE_ALPHA,
    );
    ctx.restore();
    const fold = taperedCreaseGradient(
      ctx,
      BREAST_FOLD_FROM[0],
      BREAST_FOLD_FROM[1],
      BREAST_FOLD_TO[0],
      BREAST_FOLD_TO[1],
      SKIN_CREASE,
      FOLD_FADE_IN,
      BREAST_FOLD_FADE_OUT,
    );
    strokeSoftCrease(
      ctx,
      BREAST_FOLD_WIDTH,
      fold,
      () => {
        ctx.moveTo(BREAST_FOLD_FROM[0], BREAST_FOLD_FROM[1]);
        ctx.quadraticCurveTo(
          BREAST_FOLD_CONTROL[0],
          BREAST_FOLD_CONTROL[1],
          BREAST_FOLD_TO[0],
          BREAST_FOLD_TO[1],
        );
      },
      BREAST_FOLD_ALPHA,
      TIGHT_LAYERS,
    );
  });

  at(SEAT_CENTER, () => {
    fillSoftEllipse(
      ctx,
      SEAT_SHADE[0],
      SEAT_SHADE[1],
      SEAT_SHADE_RADIUS_X,
      SEAT_SHADE_RADIUS_Y,
      SKIN_SHADE,
      SEAT_SHADE_ALPHA,
      SEAT_TILT,
    );
    fillSoftEllipse(
      ctx,
      SEAT_LIGHT[0],
      SEAT_LIGHT[1],
      SEAT_LIGHT_RADIUS_X,
      SEAT_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      SEAT_LIGHT_ALPHA,
      SEAT_TILT,
    );
    const fold = taperedCreaseGradient(
      ctx,
      SEAT_FOLD_FROM[0],
      SEAT_FOLD_FROM[1],
      SEAT_FOLD_TO[0],
      SEAT_FOLD_TO[1],
      SKIN_CREASE,
      FOLD_FADE_IN,
      SEAT_FOLD_FADE_OUT,
    );
    strokeSoftCrease(
      ctx,
      SEAT_FOLD_WIDTH,
      fold,
      () => {
        ctx.moveTo(SEAT_FOLD_FROM[0], SEAT_FOLD_FROM[1]);
        ctx.quadraticCurveTo(
          SEAT_FOLD_CONTROL[0],
          SEAT_FOLD_CONTROL[1],
          SEAT_FOLD_TO[0],
          SEAT_FOLD_TO[1],
        );
      },
      SEAT_FOLD_ALPHA,
      TIGHT_LAYERS,
    );
  });

  ctx.restore();
  return (target: Ctx) => traceSmooth(target, outline, true);
}

/* ── Bra in profile ────────────────────────────────────────────────────── */

/**
 * The cup is the breast's own profile a little proud of it, cut across the top
 * by the neckline; the band runs back round the ribs under it, and the strap
 * climbs from the cup's top over the shoulder.
 */
const CUP_PROUD_SHARE = 1.1;
const CUP_NECKLINE_BACK: ProfilePoint = [0.034, -0.134];
const CUP_NECKLINE_FRONT: ProfilePoint = [0.094, -0.122];
const CUP_NECKLINE_SAG = 0.006;
const CUP_SHADOW_SLIDE: ProfilePoint = [0.004, -0.018];
const CUP_SHADOW_ALPHA = 0.9;
const CUP_SHEEN: ProfilePoint = [0.07, -0.118];
const CUP_SHEEN_RADIUS_X = 0.014;
const CUP_SHEEN_RADIUS_Y = 0.012;
const CUP_SHEEN_ALPHA = 0.85;
const BAND_FRONT: ProfilePoint = [0.075, -0.083];
const BAND_BACK: ProfilePoint = [-0.075, -0.1];
const BRA_BAND_WIDTH = 0.014;
const STRAP_FOOT: ProfilePoint = [0.04, -0.133];
/** The strap ends where it passes over the top of the shoulder; carried higher it runs up the neck. */
const STRAP_HEAD: ProfilePoint = [-0.012, SHOULDER_Y - 0.004];
const STRAP_WIDTH = 0.0065;
const CUP_TRIM_WIDTH = 0.004;

function drawProfileBra(ctx: Ctx): void {
  ctx.strokeStyle = BRA_COLOR;
  ctx.lineCap = 'butt';
  ctx.lineWidth = BRA_BAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(BAND_FRONT[0], BAND_FRONT[1]);
  ctx.lineTo(BAND_BACK[0], BAND_BACK[1]);
  ctx.stroke();
  ctx.lineWidth = STRAP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(STRAP_FOOT[0], STRAP_FOOT[1]);
  ctx.lineTo(STRAP_HEAD[0], STRAP_HEAD[1]);
  ctx.stroke();

  const pathCup = (): void =>
    ctx.ellipse(
      BREAST_CENTER[0],
      BREAST_CENTER[1],
      BREAST_RADIUS_X * CUP_PROUD_SHARE,
      BREAST_RADIUS_Y * CUP_PROUD_SHARE,
      BREAST_TILT,
      0,
      Math.PI * 2,
    );
  const neckline = (): void => {
    ctx.moveTo(CUP_NECKLINE_BACK[0], CUP_NECKLINE_BACK[1]);
    ctx.quadraticCurveTo(
      (CUP_NECKLINE_BACK[0] + CUP_NECKLINE_FRONT[0]) / 2,
      (CUP_NECKLINE_BACK[1] + CUP_NECKLINE_FRONT[1]) / 2 + CUP_NECKLINE_SAG,
      CUP_NECKLINE_FRONT[0],
      CUP_NECKLINE_FRONT[1],
    );
  };
  const below = 1;
  ctx.save();
  ctx.beginPath();
  neckline();
  ctx.lineTo(below, CUP_NECKLINE_FRONT[1]);
  ctx.lineTo(below, below);
  ctx.lineTo(-below, below);
  ctx.lineTo(-below, CUP_NECKLINE_BACK[1]);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  pathCup();
  ctx.fillStyle = BRA_COLOR;
  ctx.fill();
  ctx.clip();
  fillCrescent(
    ctx,
    pathCup,
    CUP_SHADOW_SLIDE[0],
    CUP_SHADOW_SLIDE[1],
    BRA_SHADOW,
    CUP_SHADOW_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    CUP_SHEEN[0],
    CUP_SHEEN[1],
    CUP_SHEEN_RADIUS_X,
    CUP_SHEEN_RADIUS_Y,
    BRA_SHEEN,
    CUP_SHEEN_ALPHA,
    BREAST_TILT,
  );
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  pathCup();
  ctx.clip();
  ctx.strokeStyle = BRA_TRIM;
  ctx.lineWidth = CUP_TRIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  neckline();
  ctx.stroke();
  ctx.restore();
}

/** The thong and the bra, laid on after the silhouette is shaded. */
export function drawAngelProfileDetails(ctx: Ctx, skeleton: AngelSkeleton): void {
  ctx.save();
  ctx.beginPath();
  traceSmooth(ctx, torsoOutline(skeleton), true);
  ctx.clip();
  ctx.save();
  onProfileAt(ctx, skeleton, BAND_SIDE[0], BAND_SIDE[1]);
  drawProfileThong(ctx);
  ctx.restore();
  ctx.save();
  onProfileAt(ctx, skeleton, BREAST_CENTER[0], BREAST_CENTER[1]);
  drawProfileBra(ctx);
  ctx.restore();
  ctx.restore();
}
/* ── Head ──────────────────────────────────────────────────────────────── */

/**
 * The face in profile, from the hairline down over the brow, the dip at the
 * bridge, the nose, the lips set back from it, and the chin; then the jaw runs
 * back under the ear to the neck.
 */
const FACE_POINTS: ReadonlyArray<ProfilePoint> = [
  [0.046, -0.368],
  [0.056, -0.346],
  [0.06, -0.332],
  [0.056, -0.32],
  [0.064, -0.308],
  [0.074, -0.296],
  [0.066, -0.29],
  [0.06, -0.286],
  [0.064, -0.279],
  [0.058, -0.273],
  [0.061, -0.267],
  [0.056, -0.258],
  [0.055, -0.247],
  [0.043, -0.239],
  [0.02, -0.242],
  [-0.006, -0.256],
  [-0.022, -0.276],
];
const SKULL_CENTER: ProfilePoint = [-0.008, HEAD_CENTER_Y - 0.01];
const SKULL_RADIUS_X = 0.066;
const SKULL_RADIUS_Y = 0.074;

const JAW_SHADOW: ProfilePoint = [0.006, -0.234];
const JAW_SHADOW_RADIUS_X = 0.024;
const JAW_SHADOW_RADIUS_Y = 0.01;
const JAW_SHADOW_ALPHA = 0.55;

const PROFILE_EYE: ProfilePoint = [0.046, -0.319];
const PROFILE_EYE_LENGTH = 0.018;
const PROFILE_EYE_HEIGHT = 0.0095;
/** In profile the iris shows as a narrow ellipse at the front of the opening. */
const PROFILE_IRIS_FORWARD = 0.003;
const PROFILE_IRIS_RADIUS_X = 0.0034;
const PROFILE_IRIS_RADIUS_Y = 0.0055;
const BROW_FROM: ProfilePoint = [0.032, -0.338];
const BROW_TO: ProfilePoint = [0.058, -0.338];
const LIP_CORNER: ProfilePoint = [0.05, -0.274];

/** A human ear just behind the jaw's hinge, from the brow's height to the nose's. */
const EAR_CENTER: ProfilePoint = [-0.02, -0.31];
const EAR_RADIUS_X = 0.012;
const EAR_RADIUS_Y = 0.02;
const EAR_TILT = -0.2;
const EAR_HOLLOW_RADIUS_X = 0.0055;
const EAR_HOLLOW_RADIUS_Y = 0.011;
const EAR_HOLLOW_FORWARD = 0.002;
const EAR_HOLLOW_ALPHA = 0.6;

/* ── Hair ──────────────────────────────────────────────────────────────── */

/** Where the head turns on the neck, and how far it is tipped from upright. */
export interface ProfileHeadPlacement {
  neck: Pt2;
  tilt: number;
}

export function profileHeadPlacement(skeleton: AngelSkeleton): ProfileHeadPlacement {
  return {
    neck: profileFrame(skeleton, 0, NECK_TOP_Y),
    tilt: skeleton.chest.pitch + skeleton.headPitch,
  };
}

function enterHeadFrame(ctx: Ctx, placement: ProfileHeadPlacement): void {
  ctx.translate(placement.neck.x, placement.neck.y);
  ctx.rotate(placement.tilt);
  ctx.translate(0, -NECK_TOP_Y);
}

/** How her hair hangs this frame: lag back along her heading, bounce, and swing about the crown. */
interface ProfileHair {
  trail: number;
  lift: number;
  swing: number;
}

/**
 * The fall of hair at the back of her head, cut at the tops of her shoulders:
 * (forward, down, how much of the trail each point takes). The crown stays put.
 */
const HAIR_SHEET_TOP: ReadonlyArray<readonly [number, number, number]> = [
  [0.02, -0.37, 0],
  [-0.03, -0.392, 0],
  [-0.07, -0.36, 0],
  [-0.08, -0.33, 0],
  [-0.078, -0.26, 0.3],
];
/** Back up the inside of the fall, behind the neck. */
const HAIR_SHEET_INNER: ReadonlyArray<ProfilePoint> = [
  [-0.016, -0.212],
  [-0.02, -0.27],
];
const HAIR_HEM_Y = SHOULDER_Y + 0.012;
const HAIR_HEM_FRONT_X = -0.014;
const HAIR_HEM_BACK_X = -0.076;
const HAIR_LOCK_COUNT = 4;
/** The hem's locks end at uneven lengths, by up to this much. */
const HAIR_HEM_RAGGEDNESS = 0.008;
const HAIR_HEM_RAGGED_STEP = 2.1;
/** The fall trails more toward its back edge and lifts more toward its tips. */
const HAIR_TRAIL_BASE_SHARE = 0.6;
const HAIR_LIFT_BASE_SHARE = 0.5;
const HAIR_SHEEN_STRANDS = 3;
const HAIR_SHEEN_ROOT_X = -0.03;
const HAIR_SHEEN_ROOT_SPACING = 0.012;
const HAIR_SHEEN_ROOT_Y = -0.36;
const HAIR_SHEEN_BOW_X = -0.074;
const HAIR_SHEEN_BOW_SPACING = 0.004;
const HAIR_SHEEN_BOW_Y = -0.27;
const HAIR_SHEEN_BOW_TRAIL = 0.4;
const HAIR_SHEEN_TIP_FORWARD = 0.004;
const HAIR_SHEEN_TIP_RISE = 0.016;
const HAIR_STRAND_WIDTH = 0.005;
/** The hair swings about the crown; the crown itself never moves. */
const HAIR_SWING_PIVOT: ProfilePoint = [-0.02, -0.37];
/** Swung this far forward the hair hangs past the face, and is drawn over it. */
export const HAIR_OVER_FACE_SWING = -0.6;

function swung(p: Pt2, swing: number): Pt2 {
  const [pivotX, pivotY] = HAIR_SWING_PIVOT;
  const share = clamp01((p.y - pivotY) / (HAIR_HEM_Y - pivotY));
  const angle = swing * share;
  const dx = p.x - pivotX;
  const dy = p.y - pivotY;
  return {
    x: pivotX + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pivotY + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function drawAngelProfileHair(
  ctx: Ctx,
  placement: ProfileHeadPlacement,
  hair: ProfileHair,
): void {
  const { trail, lift, swing } = hair;
  ctx.save();
  enterHeadFrame(ctx, placement);
  const hem: Pt2[] = [];
  for (let i = 0; i <= HAIR_LOCK_COUNT; i++) {
    const share = i / HAIR_LOCK_COUNT;
    hem.push(
      swung(
        {
          x:
            lerp(HAIR_HEM_FRONT_X, HAIR_HEM_BACK_X, share) -
            trail * (HAIR_TRAIL_BASE_SHARE + share * HAIR_TRAIL_BASE_SHARE),
          y:
            HAIR_HEM_Y -
            Math.abs(Math.sin(i * HAIR_HEM_RAGGED_STEP)) * HAIR_HEM_RAGGEDNESS -
            lift * (HAIR_LIFT_BASE_SHARE + share),
        },
        swing,
      ),
    );
  }
  const sheet: Pt2[] = [
    ...HAIR_SHEET_TOP.map(([x, y, trailShare]) => swung({ x: x - trail * trailShare, y }, swing)),
    ...hem.slice().reverse(),
    ...HAIR_SHEET_INNER.map((p) => swung(pt(p), swing)),
  ];
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, sheet, true);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < HAIR_SHEEN_STRANDS; i++) {
    const tip = hem[i + 1];
    const bow = swung(
      {
        x: HAIR_SHEEN_BOW_X - i * HAIR_SHEEN_BOW_SPACING - trail * HAIR_SHEEN_BOW_TRAIL,
        y: HAIR_SHEEN_BOW_Y,
      },
      swing,
    );
    ctx.beginPath();
    ctx.moveTo(HAIR_SHEEN_ROOT_X - i * HAIR_SHEEN_ROOT_SPACING, HAIR_SHEEN_ROOT_Y);
    ctx.quadraticCurveTo(bow.x, bow.y, tip.x + HAIR_SHEEN_TIP_FORWARD, tip.y - HAIR_SHEEN_TIP_RISE);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function pt(p: ProfilePoint): Pt2 {
  return { x: p[0], y: p[1] };
}

/** The face closes back to the skull through the cheek and the temple. */
const FACE_CLOSURE: ReadonlyArray<ProfilePoint> = [
  [-0.03, -0.3],
  [0.0, -0.36],
];
const CHEEK_SHADE: ProfilePoint = [0.036, -0.292];
const CHEEK_SHADE_RADIUS_X = 0.016;
const CHEEK_SHADE_RADIUS_Y = 0.012;
const CHEEK_SHADE_ALPHA = 0.16;
const BROW_LIGHT: ProfilePoint = [0.05, -0.34];
const BROW_LIGHT_RADIUS_X = 0.016;
const BROW_LIGHT_RADIUS_Y = 0.012;
const BROW_LIGHT_ALPHA = 0.8;
const UNDER_JAW: ProfilePoint = [0.03, -0.246];
const UNDER_JAW_RADIUS_X = 0.022;
const UNDER_JAW_RADIUS_Y = 0.006;
const UNDER_JAW_ALPHA = 0.25;

/** Upper lip: corner, over its curve, to its point; then down to where the lips meet. */
const UPPER_LIP_CONTROL: ProfilePoint = [0.062, -0.282];
const UPPER_LIP_POINT: ProfilePoint = [0.064, -0.279];
const UPPER_LIP_MEET: ProfilePoint = [0.06, -0.274];
const LOWER_LIP_MEET: ProfilePoint = [0.06, -0.273];
const LOWER_LIP_CONTROL: ProfilePoint = [0.063, -0.268];
const LOWER_LIP_END: ProfilePoint = [0.058, -0.264];
const LIP_SEAM_END: ProfilePoint = [0.06, -0.2735];
const LIP_SEAM_WIDTH = 0.0024;
const LIP_SEAM_TUCK = 0.002;

/** The almond of the eye, as shares of its length and height about its centre. */
const EYE_HALF_LENGTH_SHARE = 0.5;
const EYE_PEAK_SHARE = 0.2;
const EYE_LOWER_LID_SHARE = 0.6;
const EYE_OUTER_CORNER_DROP = 0.001;
const LASH_HALF_LENGTH_SHARE = 0.55;
const LASH_HEIGHT_SHARE = 1.1;
const LASH_INNER_RISE = 0.003;
const LASH_OUTER_RISE = 0.002;
const LASH_WIDTH = 0.0038;
const BROW_ARCH_X = 0.048;
const BROW_ARCH_RISE = 0.006;
const BROW_ALPHA = 0.6;

/** Crown cap over the skull with the fringe to the brow, front of the fringe round to the nape. */
const CROWN_POINTS: ReadonlyArray<ProfilePoint> = [
  [0.058, -0.336],
  [0.06, -0.37],
  [0.03, -0.394],
  [-0.03, -0.396],
  [-0.072, -0.36],
  [-0.078, -0.3],
  [-0.05, -0.27],
  [-0.03, -0.3],
  [-0.006, -0.332],
  [0.03, -0.34],
];
const CROWN_SHEEN_FROM: ProfilePoint = [0.04, -0.384];
const CROWN_SHEEN_CONTROL: ProfilePoint = [-0.02, -0.4];
const CROWN_SHEEN_TO: ProfilePoint = [-0.06, -0.35];
const CROWN_SHEEN_WIDTH = 0.005;

function drawFaceAndFeatures(ctx: Ctx): void {
  // The neck is part of the torso's outline; only the jaw's shadow falls across it here.
  fillSoftEllipse(
    ctx,
    JAW_SHADOW[0],
    JAW_SHADOW[1],
    JAW_SHADOW_RADIUS_X,
    JAW_SHADOW_RADIUS_Y,
    SKIN_SHADE,
    JAW_SHADOW_ALPHA,
  );

  const face = [...FACE_POINTS, ...FACE_CLOSURE].map(pt);
  const pathSkull = (): void => {
    ctx.ellipse(
      SKULL_CENTER[0],
      SKULL_CENTER[1],
      SKULL_RADIUS_X,
      SKULL_RADIUS_Y,
      0,
      0,
      Math.PI * 2,
    );
  };
  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  pathSkull();
  ctx.fill();
  ctx.beginPath();
  traceSmooth(ctx, face, true);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  traceSmooth(ctx, face, true);
  pathSkull();
  ctx.clip('nonzero');
  fillSoftEllipse(
    ctx,
    CHEEK_SHADE[0],
    CHEEK_SHADE[1],
    CHEEK_SHADE_RADIUS_X,
    CHEEK_SHADE_RADIUS_Y,
    SKIN_SHADE,
    CHEEK_SHADE_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    BROW_LIGHT[0],
    BROW_LIGHT[1],
    BROW_LIGHT_RADIUS_X,
    BROW_LIGHT_RADIUS_Y,
    SKIN_HIGHLIGHT,
    BROW_LIGHT_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    UNDER_JAW[0],
    UNDER_JAW[1],
    UNDER_JAW_RADIUS_X,
    UNDER_JAW_RADIUS_Y,
    SKIN_SHADE,
    UNDER_JAW_ALPHA,
  );
  ctx.restore();

  // Lips, set back from the nose and forward of the chin.
  ctx.fillStyle = LIP_UPPER_COLOR;
  ctx.beginPath();
  ctx.moveTo(LIP_CORNER[0], LIP_CORNER[1]);
  ctx.quadraticCurveTo(
    UPPER_LIP_CONTROL[0],
    UPPER_LIP_CONTROL[1],
    UPPER_LIP_POINT[0],
    UPPER_LIP_POINT[1],
  );
  ctx.lineTo(UPPER_LIP_MEET[0], UPPER_LIP_MEET[1]);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = LIP_COLOR;
  ctx.beginPath();
  ctx.moveTo(LIP_CORNER[0], LIP_CORNER[1]);
  ctx.lineTo(LOWER_LIP_MEET[0], LOWER_LIP_MEET[1]);
  ctx.quadraticCurveTo(
    LOWER_LIP_CONTROL[0],
    LOWER_LIP_CONTROL[1],
    LOWER_LIP_END[0],
    LOWER_LIP_END[1],
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LIP_SEAM_COLOR;
  ctx.lineWidth = LIP_SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(LIP_CORNER[0] - LIP_SEAM_TUCK, LIP_CORNER[1]);
  ctx.lineTo(LIP_SEAM_END[0], LIP_SEAM_END[1]);
  ctx.stroke();

  const [eyeX, eyeY] = PROFILE_EYE;
  const eyeHalf = PROFILE_EYE_LENGTH * EYE_HALF_LENGTH_SHARE;
  const eyePeakX = eyeX + PROFILE_EYE_LENGTH * EYE_PEAK_SHARE;
  ctx.save();
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.moveTo(eyeX - eyeHalf, eyeY);
  ctx.quadraticCurveTo(
    eyePeakX,
    eyeY - PROFILE_EYE_HEIGHT,
    eyeX + eyeHalf,
    eyeY + EYE_OUTER_CORNER_DROP,
  );
  ctx.quadraticCurveTo(eyeX, eyeY + PROFILE_EYE_HEIGHT * EYE_LOWER_LID_SHARE, eyeX - eyeHalf, eyeY);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = IRIS_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    eyeX + PROFILE_IRIS_FORWARD,
    eyeY,
    PROFILE_IRIS_RADIUS_X,
    PROFILE_IRIS_RADIUS_Y,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
  const lashHalf = PROFILE_EYE_LENGTH * LASH_HALF_LENGTH_SHARE;
  ctx.strokeStyle = HAIR_DARK;
  ctx.lineWidth = LASH_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(eyeX - lashHalf, eyeY - LASH_INNER_RISE);
  ctx.quadraticCurveTo(
    eyePeakX,
    eyeY - PROFILE_EYE_HEIGHT * LASH_HEIGHT_SHARE,
    eyeX + lashHalf,
    eyeY - LASH_OUTER_RISE,
  );
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha *= BROW_ALPHA;
  ctx.beginPath();
  ctx.moveTo(BROW_FROM[0], BROW_FROM[1]);
  ctx.quadraticCurveTo(BROW_ARCH_X, BROW_FROM[1] - BROW_ARCH_RISE, BROW_TO[0], BROW_TO[1]);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, CROWN_POINTS.map(pt), true);
  ctx.fill();
  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = CROWN_SHEEN_WIDTH;
  ctx.beginPath();
  ctx.moveTo(CROWN_SHEEN_FROM[0], CROWN_SHEEN_FROM[1]);
  ctx.quadraticCurveTo(
    CROWN_SHEEN_CONTROL[0],
    CROWN_SHEEN_CONTROL[1],
    CROWN_SHEEN_TO[0],
    CROWN_SHEEN_TO[1],
  );
  ctx.stroke();
}

function drawProfileEar(ctx: Ctx): void {
  ctx.fillStyle = SKIN_BASE;
  ctx.beginPath();
  ctx.ellipse(EAR_CENTER[0], EAR_CENTER[1], EAR_RADIUS_X, EAR_RADIUS_Y, EAR_TILT, 0, Math.PI * 2);
  ctx.fill();
  fillSoftEllipse(
    ctx,
    EAR_CENTER[0] + EAR_HOLLOW_FORWARD,
    EAR_CENTER[1],
    EAR_HOLLOW_RADIUS_X,
    EAR_HOLLOW_RADIUS_Y,
    SKIN_HALF,
    EAR_HOLLOW_ALPHA,
    EAR_TILT,
  );
}

/** Her head seen from her right, placed on the neck; the hair at the back of it is drawn separately. */
export function drawAngelProfileHead(ctx: Ctx, placement: ProfileHeadPlacement): void {
  ctx.save();
  enterHeadFrame(ctx, placement);
  drawFaceAndFeatures(ctx);
  drawProfileEar(ctx);
  ctx.restore();
}
