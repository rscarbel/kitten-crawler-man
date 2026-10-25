/**
 * Signet in profile: torso, head and hair, facing +x (her right side to the
 * camera). Her limbs come from `legs.ts` and `arms.ts`, drawn either side of
 * this body by the entry point.
 *
 * The torso is a profile outline in rest coordinates — (forward, down) — carried
 * through the chest and pelvis frames the same way the head-on torso is, so
 * the lean of a run and the bob of a walk move it without a separate pose. Its
 * shape is what carries her figure from the side: the long curve of the back
 * into the small of it, the seat rounding out behind and tucking under into
 * the fold, the belly flat under a lifted bust. The apex of the bust is under a
 * lock of hair that falls forward over her shoulder, as head-on.
 */

import { fillSoftEllipse, strokeSoftCrease, taperedCreaseGradient } from '../softShade';
import { clamp01, lerp, mix } from '../bipedArt';
import { fillCrescent, traceSmooth, type Ctx } from './paint';
import {
  EYE_CAST_COLOR,
  EYE_IDLE_COLOR,
  HAIR_DARK,
  HAIR_SHEEN,
  HORN_COLOR,
  HORN_LIT,
  LIP_COLOR,
  LIP_SEAM_COLOR,
  LIP_UPPER_COLOR,
  SKIN_BASE,
  SKIN_CREASE,
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
import { placeInSection, type Pt2, type SignetSkeleton } from './skeleton';
import { GLOW_REFERENCE_TILE_PX, type SignetDetail } from './tattoos';

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

function profileFrame(skeleton: SignetSkeleton, forward: number, down: number): Pt2 {
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

function hipFlexOf(skeleton: SignetSkeleton): number {
  const leg = skeleton.legs[1];
  return Math.atan2(leg.knee.z - leg.hip.z, leg.knee.y - leg.hip.y);
}

function torsoOutline(skeleton: SignetSkeleton): Pt2[] {
  const reach = Math.max(0, Math.sin(hipFlexOf(skeleton)));
  const stretched = BACK_CONTOUR.map(([f, d]): ProfilePoint => {
    const depth = clamp01((d - SEAT_STRETCH_TOP_Y) / (CROTCH_Y - SEAT_STRETCH_TOP_Y));
    return [f + SEAT_STRETCH * reach * depth, d];
  });
  return [...FRONT_CONTOUR, ...stretched].map(([f, d]) => profileFrame(skeleton, f, d));
}

/** Lay the context rigidly on the torso at a profile point. */
function onProfileAt(ctx: Ctx, skeleton: SignetSkeleton, forward: number, down: number): void {
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
export function drawSignetProfileBody(ctx: Ctx, skeleton: SignetSkeleton): (target: Ctx) => void {
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

/** The thong, laid on after the silhouette is shaded. */
export function drawSignetProfileDetails(ctx: Ctx, skeleton: SignetSkeleton): void {
  ctx.save();
  ctx.beginPath();
  traceSmooth(ctx, torsoOutline(skeleton), true);
  ctx.clip();
  onProfileAt(ctx, skeleton, BAND_SIDE[0], BAND_SIDE[1]);
  drawProfileThong(ctx);
  ctx.restore();
}

/* ── Head ──────────────────────────────────────────────────────────────── */

/**
 * The face in profile, from the hairline down over the brow, the dip at the
 * bridge, the nose, the lips set back from it, and the chin; then the jaw runs
 * back under the ear to the neck. Elven: a small straight nose, a delicate chin.
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
  [0.054, -0.259],
  [0.052, -0.248],
  [0.04, -0.242],
  [0.018, -0.246],
  [-0.006, -0.258],
  [-0.022, -0.276],
];
const SKULL_CENTER: ProfilePoint = [-0.008, HEAD_CENTER_Y - 0.01];
const SKULL_RADIUS_X = 0.066;
const SKULL_RADIUS_Y = 0.074;

const JAW_SHADOW: ProfilePoint = [0.006, -0.236];
const JAW_SHADOW_RADIUS_X = 0.024;
const JAW_SHADOW_RADIUS_Y = 0.01;
const JAW_SHADOW_ALPHA = 0.55;

const PROFILE_EYE: ProfilePoint = [0.046, -0.319];
const PROFILE_EYE_LENGTH = 0.014;
const PROFILE_EYE_HEIGHT = 0.008;
const EYE_GLOW_BLUR_IDLE_PX = 2;
const EYE_GLOW_BLUR_CAST_PX = 14;
const BROW_FROM: ProfilePoint = [0.032, -0.338];
const BROW_TO: ProfilePoint = [0.058, -0.338];
const LIP_CORNER: ProfilePoint = [0.05, -0.274];

/** The ear sweeps back and up from just behind the jaw's hinge. */
const EAR_ROOT: ProfilePoint = [-0.012, -0.31];
const EAR_TIP: ProfilePoint = [-0.082, -0.362];
const EAR_HALF_WIDTH = 0.016;

const HORN_BASE: ProfilePoint = [0.006, -0.386];
const HORN_TIP: ProfilePoint = [-0.012, -0.442];
const HORN_BASE_HALF_WIDTH = 0.013;
const FAR_HORN_OFFSET = -0.016;

/* ── Hair ──────────────────────────────────────────────────────────────── */

/** The fall of hair down her back, as a sheet with a ragged hem. */
const HAIR_BACK_TOP: ProfilePoint = [-0.07, -0.33];
const HAIR_HEM_Y = -0.034;
const HAIR_LOCK_COUNT = 4;
/** The lock that falls forward over her near shoulder and covers the bust's apex. */
const FRONT_LOCK_ROOT: ProfilePoint = [-0.03, -0.345];
const FRONT_LOCK_TIP: ProfilePoint = [0.084, -0.07];
const FRONT_LOCK_HALF_WIDTH = 0.02;
const FRONT_LOCK_TRAIL_SHARE = 0.3;
const HAIR_STRAND_WIDTH = 0.005;

function headFrame(ctx: Ctx, skeleton: SignetSkeleton): void {
  const neck = profileFrame(skeleton, 0, NECK_TOP_Y);
  const chestTilt = skeleton.chest.pitch;
  ctx.translate(neck.x, neck.y);
  ctx.rotate(chestTilt + skeleton.headPitch);
  ctx.translate(0, -NECK_TOP_Y);
}

/**
 * The sheet of hair down her back in profile: (forward, down, how much of the
 * run's trail each point takes). The crown stays put; the fall swings back.
 */
const HAIR_SHEET_TOP: ReadonlyArray<readonly [number, number, number]> = [
  [0.02, -0.37, 0],
  [-0.03, -0.392, 0],
  [-0.07, -0.36, 0],
  [HAIR_BACK_TOP[0] - 0.01, HAIR_BACK_TOP[1], 0],
  [-0.074, -0.24, 0.3],
  [-0.07, -0.15, 0.5],
];
/** Back up the inside of the fall, behind the neck. */
const HAIR_SHEET_INNER: ReadonlyArray<ProfilePoint> = [
  [-0.014, -0.16],
  [-0.02, -0.26],
];
const HAIR_HEM_FRONT_X = -0.012;
const HAIR_HEM_BACK_X = -0.072;
/** The hem's locks end at uneven lengths, by up to this much. */
const HAIR_HEM_RAGGEDNESS = 0.016;
const HAIR_HEM_RAGGED_STEP = 2.1;
/** The fall trails more toward its back edge and lifts more toward its tips. */
const HAIR_TRAIL_BASE_SHARE = 0.6;
const HAIR_LIFT_BASE_SHARE = 0.5;
const HAIR_HEM_DRIFT = 0.003;
const HAIR_HEM_DRIFT_SPEED = 0.9;
const HAIR_HEM_DRIFT_STEP = 1.7;
const HAIR_SHEEN_STRANDS = 3;
const HAIR_SHEEN_ROOT_X = -0.03;
const HAIR_SHEEN_ROOT_SPACING = 0.012;
const HAIR_SHEEN_ROOT_Y = -0.36;
const HAIR_SHEEN_BOW_X = -0.07;
const HAIR_SHEEN_BOW_SPACING = 0.004;
const HAIR_SHEEN_BOW_Y = -0.2;
const HAIR_SHEEN_BOW_TRAIL = 0.4;
const HAIR_SHEEN_TIP_FORWARD = 0.004;
const HAIR_SHEEN_TIP_RISE = 0.03;

export function drawSignetProfileHair(ctx: Ctx, skeleton: SignetSkeleton, timeSec: number): void {
  const trail = skeleton.hairTrail;
  const lift = skeleton.hairLift;
  ctx.save();
  headFrame(ctx, skeleton);
  const hem: Pt2[] = [];
  for (let i = 0; i <= HAIR_LOCK_COUNT; i++) {
    const share = i / HAIR_LOCK_COUNT;
    const drift =
      Math.sin(timeSec * HAIR_HEM_DRIFT_SPEED + i * HAIR_HEM_DRIFT_STEP) * HAIR_HEM_DRIFT;
    hem.push({
      x:
        lerp(HAIR_HEM_FRONT_X, HAIR_HEM_BACK_X, share) -
        trail * (HAIR_TRAIL_BASE_SHARE + share * HAIR_TRAIL_BASE_SHARE) +
        drift,
      y:
        HAIR_HEM_Y -
        Math.abs(Math.sin(i * HAIR_HEM_RAGGED_STEP)) * HAIR_HEM_RAGGEDNESS -
        lift * (HAIR_LIFT_BASE_SHARE + share),
    });
  }
  const sheet: Pt2[] = [
    ...HAIR_SHEET_TOP.map(([x, y, trailShare]) => ({ x: x - trail * trailShare, y })),
    ...hem.slice().reverse(),
    ...HAIR_SHEET_INNER.map(pt),
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
    ctx.beginPath();
    ctx.moveTo(HAIR_SHEEN_ROOT_X - i * HAIR_SHEEN_ROOT_SPACING, HAIR_SHEEN_ROOT_Y);
    ctx.quadraticCurveTo(
      HAIR_SHEEN_BOW_X - i * HAIR_SHEEN_BOW_SPACING - trail * HAIR_SHEEN_BOW_TRAIL,
      HAIR_SHEEN_BOW_Y,
      tip.x + HAIR_SHEEN_TIP_FORWARD,
      tip.y - HAIR_SHEEN_TIP_RISE,
    );
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function pt(p: ProfilePoint): Pt2 {
  return { x: p[0], y: p[1] };
}

/** Horns: how far the base's back corner dips, and how far each side bows out toward the tip. */
const HORN_BASE_DIP = 0.004;
const HORN_FRONT_BOW = 0.012;
const HORN_BACK_BOW = 0.012;
const HORN_BACK_BOW_DROP = 0.01;

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
const UNDER_JAW: ProfilePoint = [0.03, -0.248];
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
const LASH_WIDTH = 0.0026;
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
  [-0.024, -0.3],
  [-0.006, -0.332],
  [0.03, -0.34],
];
const CROWN_SHEEN_FROM: ProfilePoint = [0.04, -0.384];
const CROWN_SHEEN_CONTROL: ProfilePoint = [-0.02, -0.4];
const CROWN_SHEEN_TO: ProfilePoint = [-0.06, -0.35];

/**
 * The forward lock, down its back edge and up its front: (forward, down, how
 * much of the hair's sway each point takes). The root stays on the head.
 */
const FRONT_LOCK_BACK_EDGE: ReadonlyArray<readonly [number, number, number]> = [
  [-0.046, -0.27, 0.3],
  [-0.01, -0.205, 0.6],
  [0.05, -0.14, 1],
  [FRONT_LOCK_TIP[0] - 0.014, FRONT_LOCK_TIP[1] - 0.012, 1],
  [FRONT_LOCK_TIP[0], FRONT_LOCK_TIP[1], 1],
];
/**
 * The front edge lies against the bust and swings back less than the rest of
 * the lock; swung back with it, the breast's front edge peeks out past the
 * lock as a bright sliver.
 */
const FRONT_LOCK_FRONT_EDGE: ReadonlyArray<readonly [number, number, number]> = [
  [FRONT_LOCK_TIP[0] + 0.02, -0.11, 0.5],
  [0.074, -0.15, 0.45],
  [0.022, -0.222, 0.6],
  [-0.012, -0.28, 0.3],
];
const FRONT_LOCK_SHEEN_ROOT_DROP = 0.02;
const FRONT_LOCK_SHEEN_FIRST: readonly [number, number, number] = [0.0, -0.25, 0.4];
const FRONT_LOCK_SHEEN_SECOND: readonly [number, number, number] = [0.04, -0.17, 0.8];
const FRONT_LOCK_SHEEN_TIP_BACK = 0.004;
const FRONT_LOCK_SHEEN_TIP_RISE = 0.02;

/** Ear outline offsets from its root, lower edge out to the tip and back along the top. */
const EAR_LOWER_ROOT_FORWARD = 0.006;
const EAR_LOWER_CONTROL: ProfilePoint = [-0.03, 0.006];
const EAR_UPPER_CONTROL: ProfilePoint = [-0.026, -0.026];
const EAR_UPPER_ROOT_FORWARD = 0.004;
/** The fold of the rim, from just inside the root out toward the tip. */
const EAR_FOLD_FROM: ProfilePoint = [-0.004, 0.006];
const EAR_FOLD_CONTROL: ProfilePoint = [-0.03, -0.006];
const EAR_FOLD_TIP_INSET: ProfilePoint = [0.012, 0.008];
const EAR_FOLD_WIDTH = 0.004;
const CROWN_SHEEN_WIDTH = 0.005;

function swayed([x, y, share]: readonly [number, number, number], sway: number): Pt2 {
  return { x: x - sway * share, y };
}

export function drawSignetProfileHead(
  ctx: Ctx,
  skeleton: SignetSkeleton,
  castGlow: number,
  glowTileSizePx: number,
): void {
  ctx.save();
  headFrame(ctx, skeleton);

  // The far horn first, so the near one overlaps it.
  const hornMidY = (HORN_BASE[1] + HORN_TIP[1]) / 2;
  for (const offset of [FAR_HORN_OFFSET, 0]) {
    ctx.fillStyle = offset < 0 ? HORN_COLOR : HORN_LIT;
    ctx.beginPath();
    ctx.moveTo(HORN_BASE[0] + offset - HORN_BASE_HALF_WIDTH, HORN_BASE[1] + HORN_BASE_DIP);
    ctx.quadraticCurveTo(
      HORN_TIP[0] + offset + HORN_FRONT_BOW,
      hornMidY,
      HORN_TIP[0] + offset,
      HORN_TIP[1],
    );
    ctx.quadraticCurveTo(
      HORN_BASE[0] + offset + HORN_BACK_BOW,
      hornMidY + HORN_BACK_BOW_DROP,
      HORN_BASE[0] + offset + HORN_BASE_HALF_WIDTH,
      HORN_BASE[1],
    );
    ctx.closePath();
    ctx.fill();
  }

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

  // The eye seen from the side: a short almond with its glow.
  const [eyeX, eyeY] = PROFILE_EYE;
  const eyeHalf = PROFILE_EYE_LENGTH * EYE_HALF_LENGTH_SHARE;
  const eyePeakX = eyeX + PROFILE_EYE_LENGTH * EYE_PEAK_SHARE;
  ctx.save();
  ctx.shadowColor = castGlow > 0 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  ctx.shadowBlur =
    (EYE_GLOW_BLUR_IDLE_PX + (EYE_GLOW_BLUR_CAST_PX - EYE_GLOW_BLUR_IDLE_PX) * castGlow) *
    (glowTileSizePx / GLOW_REFERENCE_TILE_PX);
  ctx.fillStyle = mix(EYE_IDLE_COLOR, EYE_CAST_COLOR, castGlow);
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

  // The forward lock: tucked behind the ear, down past the jaw and forward over
  // the near shoulder, covering the bust's apex. The ear lies over it.
  const sway = skeleton.hairTrail * FRONT_LOCK_TRAIL_SHARE + skeleton.hairLift;
  const lock: Pt2[] = [
    { x: FRONT_LOCK_ROOT[0] - FRONT_LOCK_HALF_WIDTH, y: FRONT_LOCK_ROOT[1] },
    ...FRONT_LOCK_BACK_EDGE.map((p) => swayed(p, sway)),
    ...FRONT_LOCK_FRONT_EDGE.map((p) => swayed(p, sway)),
    { x: FRONT_LOCK_ROOT[0] + FRONT_LOCK_HALF_WIDTH, y: FRONT_LOCK_ROOT[1] },
  ];
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, lock, true);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  ctx.lineCap = 'round';
  const sheenFirst = swayed(FRONT_LOCK_SHEEN_FIRST, sway);
  const sheenSecond = swayed(FRONT_LOCK_SHEEN_SECOND, sway);
  ctx.beginPath();
  ctx.moveTo(FRONT_LOCK_ROOT[0], FRONT_LOCK_ROOT[1] + FRONT_LOCK_SHEEN_ROOT_DROP);
  ctx.bezierCurveTo(
    sheenFirst.x,
    sheenFirst.y,
    sheenSecond.x,
    sheenSecond.y,
    FRONT_LOCK_TIP[0] - FRONT_LOCK_SHEEN_TIP_BACK - sway,
    FRONT_LOCK_TIP[1] - FRONT_LOCK_SHEEN_TIP_RISE,
  );
  ctx.stroke();
  ctx.restore();

  // The pointed ear, through the hair.
  const [earX, earY] = EAR_ROOT;
  const [earTipX, earTipY] = EAR_TIP;
  ctx.fillStyle = SKIN_BASE;
  ctx.beginPath();
  ctx.moveTo(earX + EAR_LOWER_ROOT_FORWARD, earY + EAR_HALF_WIDTH);
  ctx.quadraticCurveTo(earX + EAR_LOWER_CONTROL[0], earY + EAR_LOWER_CONTROL[1], earTipX, earTipY);
  ctx.quadraticCurveTo(
    earX + EAR_UPPER_CONTROL[0],
    earY + EAR_UPPER_CONTROL[1],
    earX + EAR_UPPER_ROOT_FORWARD,
    earY - EAR_HALF_WIDTH,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = EAR_FOLD_WIDTH;
  ctx.beginPath();
  ctx.moveTo(earX + EAR_FOLD_FROM[0], earY + EAR_FOLD_FROM[1]);
  ctx.quadraticCurveTo(
    earX + EAR_FOLD_CONTROL[0],
    earY + EAR_FOLD_CONTROL[1],
    earTipX + EAR_FOLD_TIP_INSET[0],
    earTipY + EAR_FOLD_TIP_INSET[1],
  );
  ctx.stroke();

  ctx.restore();
}

/** Re-exported for the creature's eye-shine placement. */
export const PROFILE_EYE_FORWARD = PROFILE_EYE[0];
export const PROFILE_EYE_DOWN = PROFILE_EYE[1];
export type { SignetDetail };
