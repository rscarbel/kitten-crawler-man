/**
 * Angel's head and hair, head-on and from behind: the face, the ears, the
 * fringe, the two locks framing her face, and the fall of hair at her nape.
 *
 * Her hair is cut to one length, at the tops of her shoulders: it frames the
 * face and ends well above the bust, so nothing of it is drawn on her chest.
 */

import { fillSoftEllipse, withClip } from '../softShade';
import {
  HEAD_CENTER_Y,
  HEAD_RADIUS_X,
  HEAD_RADIUS_Y,
  JAW_Y,
  SHOULDER_Y,
  HAIR_CROWN_RISE_SHARE,
} from './proportions';
import {
  EYE_WHITE,
  HAIR_DARK,
  HAIR_SHEEN,
  IRIS_COLOR,
  LIP_COLOR,
  LIP_SEAM_COLOR,
  LIP_SHEEN_COLOR,
  LIP_UPPER_COLOR,
  PUPIL_COLOR,
  SKIN_BASE,
  SKIN_CREASE,
  SKIN_HALF,
  SKIN_LIT,
  SKIN_SHADE,
} from './palette';
import { SIDES, type BodySide } from './skeleton';
import { traceSmooth } from './paint';

/** From behind, the hair caps the skull close to its own size; any fuller and the head reads as a helmet. */
const BACK_OF_HEAD_WIDTH_FRACTION = 1.04;
const BACK_OF_HEAD_HEIGHT_FRACTION = 1.02;
const CHEEK_SHADE_ALPHA = 0.28;

/* ── Hair ──────────────────────────────────────────────────────────────── */

/** The one length every fall of her hair ends at: the tops of her shoulders. */
export const HAIR_HEM_Y = SHOULDER_Y + 0.014;

const HAIR_STRAND_WIDTH = 0.004;

const FRINGE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.15;
const CROWN_SIDE_SHARE = 1.14;
const CROWN_SIDE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.05;
const CROWN_SWELL_SHARE = 1.3;
const CROWN_RISE = HEAD_RADIUS_Y * HAIR_CROWN_RISE_SHARE;
const FRINGE_EDGE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.24;
/** Across the brow from her right to her left: (share of the head's half-width, drop below the fringe line). */
const FRINGE_EDGE: ReadonlyArray<readonly [number, number]> = [
  [0.98, -0.004],
  [0.82, 0.004],
  [0.64, -0.002],
  [0.45, 0.005],
  [0.24, -0.001],
  [0.04, 0.004],
  [-0.18, -0.002],
  [-0.4, 0.005],
  [-0.6, -0.001],
  [-0.8, 0.004],
  [-0.98, -0.004],
];
const CROWN_SHEEN_SHARE = 0.78;
const CROWN_SHEEN_FROM = Math.PI * 1.18;
const CROWN_SHEEN_TO = Math.PI * 1.5;

/* ── Skull ─────────────────────────────────────────────────────────────── */

/**
 * The face is not the head ellipse: an ellipse has the same width at the jaw as
 * at the cheekbone, which reads as a doll. Hers is a natural adult oval —
 * rounded through the cranium, widest at the cheekbone, the jaw holding most of
 * that width down to the mouth before it turns in to a soft chin.
 */
const HEAD_CROWN_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y;
const CHIN_Y = JAW_Y;
const CHEEKBONE_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.08;
const JAW_CORNER_X = HEAD_RADIUS_X * 0.84;
const JAW_CORNER_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.52;
const CHIN_HALF_WIDTH = HEAD_RADIUS_X * 0.36;
/** Where the jawline stops running in and the chin itself rounds off. */
const CHIN_SHOULDER_Y = CHIN_Y - HEAD_RADIUS_Y * 0.12;
/** Carries the cranium a little past the eye line before it turns down. */
const TEMPLE_CONTROL_X = HEAD_RADIUS_X * 1.04;
const CRANIUM_CONTROL_RISE = HEAD_RADIUS_Y * 0.45;
const CHEEK_TO_JAW_CONTROL_DROP = HEAD_RADIUS_Y * 0.26;
const CHIN_ROUND_CONTROL_FRACTION = 0.85;

/**
 * She is lit from her left (screen right), so every shadow on the face falls on
 * the same side and the light never contradicts itself between features.
 */
const FACE_SHADOW_SIDE = -1;
const TEMPLE_SHADE_X = HEAD_RADIUS_X * 0.6;
const TEMPLE_SHADE_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.1;
const TEMPLE_SHADE_RADIUS_X = HEAD_RADIUS_X * 0.42;
const TEMPLE_SHADE_RADIUS_Y = HEAD_RADIUS_Y * 0.5;

/** The hollow under each cheekbone; what gives the taper somewhere to start. */
const CHEEK_HOLLOW_X = HEAD_RADIUS_X * 0.66;
const CHEEK_HOLLOW_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.34;
const CHEEK_HOLLOW_RADIUS_X = 0.012;
const CHEEK_HOLLOW_RADIUS_Y = 0.016;
const CHEEK_HOLLOW_ALPHA = 0.16;

const JAW_SHADE_Y = CHIN_Y - 0.006;
const JAW_SHADE_RADIUS_X = CHIN_HALF_WIDTH * 1.8;
const JAW_SHADE_RADIUS_Y = 0.01;
const JAW_SHADE_ALPHA = 0.22;

/* ── Head details ──────────────────────────────────────────────────────── */

/** A human ear, at the height from the brow to the base of the nose, its rim just outside the skull. */
const EAR_X = HEAD_RADIUS_X * 0.96;
const EAR_Y = HEAD_CENTER_Y + 0.008;
const EAR_RADIUS_X = 0.011;
const EAR_RADIUS_Y = 0.02;
const EAR_HOLLOW_RADIUS_X = 0.005;
const EAR_HOLLOW_RADIUS_Y = 0.011;
const EAR_HOLLOW_ALPHA = 0.55;

const EYE_X = 0.027;
const EYE_Y = HEAD_CENTER_Y - 0.004;
const EYE_RADIUS_X = 0.0135;
const EYE_RADIUS_Y = 0.0095;
/** Outer corner lifted a little above the inner one. */
const EYE_OUTER_CORNER_RISE = 0.0025;
const EYE_LID_CONTROL_RISE = 1.45;
/** The iris fills most of the opening's height; the whites show at either side of it. */
const IRIS_RADIUS = 0.0072;
const PUPIL_RADIUS = 0.0034;
const EYE_CATCHLIGHT_OFFSET = 0.0024;
const EYE_CATCHLIGHT_RADIUS = 0.0018;
/** Heavier at the outer corner and carried past it as a flick. */
const LASH_LINE_WIDTH = 0.0026;
const LASH_FLICK_LENGTH = 0.005;
const LASH_FLICK_RISE = 0.0035;

/** High, thin and arched. */
const BROW_INNER_X = 0.016;
const BROW_OUTER_X = 0.042;
const BROW_Y = EYE_Y - 0.026;
const BROW_ARCH_RISE = 0.006;
/** The arch peaks past the middle of the brow, nearer the outer end. */
const BROW_ARCH_X_FRACTION = 0.62;
const BROW_LINE_WIDTH = 0.0026;
const BROW_ALPHA = 0.6;

/**
 * At this size a drawn nose becomes a smudge, so hers is built out of the
 * light instead — a shadow down one side of the bridge, a lit tip, and two
 * nostril marks small enough to read as punctuation.
 */
const NOSE_TIP_Y = HEAD_CENTER_Y + 0.024;
const NOSE_HALF_WIDTH = 0.009;
const NOSE_BRIDGE_TOP_Y = EYE_Y + 0.004;
const NOSE_BRIDGE_SHADE_RADIUS_X = 0.005;
const NOSE_BRIDGE_SHADE_ALPHA = 0.3;
const NOSE_TIP_SHADE_Y = NOSE_TIP_Y + 0.0045;
const NOSE_TIP_SHADE_RADIUS_X = 0.011;
const NOSE_TIP_SHADE_RADIUS_Y = 0.005;
const NOSE_TIP_SHADE_ALPHA = 0.45;
const NOSE_TIP_HIGHLIGHT_Y = NOSE_TIP_Y - 0.005;
const NOSE_TIP_HIGHLIGHT_RADIUS = 0.0065;
const NOSE_TIP_HIGHLIGHT_ALPHA = 0.85;
const NOSTRIL_X = NOSE_HALF_WIDTH * 0.8;
const NOSTRIL_RADIUS_X = 0.0034;
const NOSTRIL_RADIUS_Y = 0.0022;
const NOSTRIL_ALPHA = 0.7;

/**
 * Two lips with a seam between them, not a single stroke: at her size a
 * hairline in a skin tone simply is not there — the mouth has to be a shape
 * holding its own colour.
 */
const MOUTH_Y = HEAD_CENTER_Y + 0.044;
const MOUTH_HALF_WIDTH = 0.016;
const UPPER_LIP_HEIGHT = 0.0075;
const LOWER_LIP_HEIGHT = 0.0115;
/** The peaks of the cupid's bow, either side of the philtrum dip. */
const CUPIDS_BOW_X = 0.0055;
const CUPIDS_BOW_DIP = 0.35;
const LIP_PEAK_CONTROL_FRACTION = 0.55;
const LIP_SEAM_DROP = 0.0018;
const LIP_SEAM_LINE_WIDTH = 0.0026;
const LOWER_LIP_SHEEN_Y_FRACTION = 0.55;
const LOWER_LIP_SHEEN_RADIUS_X = 0.008;
const LOWER_LIP_SHEEN_RADIUS_Y = 0.0032;
const LOWER_LIP_SHEEN_ALPHA = 0.5;
/** The shadow the lower lip throws onto the chin, which sets it forward. */
const CHIN_SHADOW_Y = MOUTH_Y + LOWER_LIP_HEIGHT + 0.005;
const CHIN_SHADOW_RADIUS_X = 0.011;
const CHIN_SHADOW_RADIUS_Y = 0.004;
const CHIN_SHADOW_ALPHA = 0.35;

/** Shares of the eye's lash flick at which its curve bends. */
const LASH_FLICK_CONTROL_ALONG = 0.6;
const LASH_FLICK_CONTROL_RISE = 0.4;
/** The bridge's shade sits off-centre on the shadow side; the tip's highlight on the lit side. */
const NOSE_BRIDGE_SHADE_OFFSET_SHARE = 0.55;
const NOSE_TIP_HIGHLIGHT_OFFSET_SHARE = 0.3;
/** How far out the lower lip keeps its full height before rounding into the corners. */
const LOWER_LIP_FULLNESS_SHARE = 0.62;

/** Sheen strands on the back of the head, as shares of the skull's radii. */
const BACK_SHEEN_ROOT_ACROSS = 0.25;
const BACK_SHEEN_ROOT_RISE = 0.6;
const BACK_SHEEN_BOW_ACROSS = 0.7;
const BACK_SHEEN_END_ACROSS = 0.45;

/**
 * Head-on, the hair that falls behind her: it hugs the sides of the head and
 * the neck and ends at the tops of her shoulders, so all that shows of it is
 * a dark mass either side of the neck. Carried wider than the shoulders it
 * frames her like a jacket collar.
 */
const BEHIND_HAIR_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.072, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.6],
  [0.08, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.3],
  [0.078, JAW_Y],
  [0.08, HAIR_HEM_Y - 0.012],
  [0.06, HAIR_HEM_Y],
  [0.03, HAIR_HEM_Y - 0.004],
];

export function drawBackHair(ctx: CanvasRenderingContext2D, sway: number): void {
  const count = BEHIND_HAIR_POINTS.length;
  const points = [
    ...BEHIND_HAIR_POINTS.map(([x, y], i) => ({ x: x + (sway * i) / count, y })),
    ...[...BEHIND_HAIR_POINTS]
      .reverse()
      .map(([x, y], i) => ({ x: -x + (sway * (count - 1 - i)) / count, y })),
  ];
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, points, true);
  ctx.fill();
}

/**
 * The two locks framing her face head-on: each leaves the crown at the temple,
 * falls past the cheek and the jaw — clear of the face — and ends on the top of
 * her shoulder in a few uneven points. Its inner edge follows the face and then
 * the neck, so the face reads framed rather than curtained.
 */
const LOCK_OUTER: ReadonlyArray<readonly [number, number]> = [
  [HEAD_RADIUS_X * 1.12, CROWN_SIDE_Y],
  [HEAD_RADIUS_X * 1.2, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.4],
  [HEAD_RADIUS_X * 1.24, JAW_Y],
  [0.088, HAIR_HEM_Y - 0.016],
];
/** The hem, outside in: (across, how far short of full length). */
const LOCK_HEM: ReadonlyArray<readonly [number, number]> = [
  [0.086, 0.006],
  [0.074, 0],
  [0.062, 0.008],
  [0.052, 0.002],
];
const LOCK_INNER: ReadonlyArray<readonly [number, number]> = [
  [0.044, JAW_Y + 0.004],
  [HEAD_RADIUS_X * 0.86, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.38],
  [HEAD_RADIUS_X * 0.9, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.1],
];
/** How much of the hair's sway and lift each part of a lock takes: none at the root, all of it at the hem. */
const LOCK_SWAY_SHARES = [0, 0.3, 0.6, 0.85] as const;
const LOCK_SHEEN_ACROSS = 1.08;
const LOCK_SHEEN_END_SHORT = 0.02;

export function drawFaceLocks(ctx: CanvasRenderingContext2D, sway: number, lift: number): void {
  for (const side of SIDES) {
    const outer = LOCK_OUTER.map(([x, y], i) => ({
      x: side * x + sway * LOCK_SWAY_SHARES[i],
      y: y - lift * LOCK_SWAY_SHARES[i],
    }));
    const hem = LOCK_HEM.map(([x, short]) => ({
      x: side * x + sway,
      y: HAIR_HEM_Y - short - lift,
    }));
    const inner = LOCK_INNER.map(([x, y], i) => ({
      x: side * x + sway * (1 - (i + 1) / LOCK_INNER.length),
      y,
    }));
    ctx.fillStyle = HAIR_DARK;
    ctx.beginPath();
    traceSmooth(ctx, [...outer, ...hem, ...inner], true);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * HEAD_RADIUS_X * LOCK_SHEEN_ACROSS, HEAD_CENTER_Y);
    ctx.quadraticCurveTo(
      side * HEAD_RADIUS_X * LOCK_OUTER[1][0] * LOCK_SHEEN_ACROSS,
      JAW_Y,
      side * LOCK_HEM[1][0] + sway,
      HAIR_HEM_Y - LOCK_SHEEN_END_SHORT - lift,
    );
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * From behind, the fall of hair at her nape: a sheet that leaves the skull,
 * hugs the nape, spreads a little over the tops of the shoulders and ends in
 * locks of uneven length — shortest at the sides. A sheet with a square
 * outline reads as a hood.
 */
const CURTAIN_SIDE: ReadonlyArray<readonly [number, number]> = [
  [0.062, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.2],
  [0.054, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.95],
  [0.074, SHOULDER_Y - 0.01],
];
/** The hem across her back, outside in: (share of the hem's half-width, how far short of full length). */
const CURTAIN_HEM: ReadonlyArray<readonly [number, number]> = [
  [0.95, 0.014],
  [0.72, 0.004],
  [0.47, 0.009],
  [0.23, 0.002],
  [0, 0.006],
];
const CURTAIN_HEM_HALF_WIDTH = 0.074;
const CURTAIN_STRANDS: ReadonlyArray<number> = [-0.6, -0.25, 0.15, 0.5];
/** Sheen strands leave the crown inside the skull's width and bow out over the shoulders. */
const CURTAIN_STRAND_ROOT_SHARE = 0.6;
const CURTAIN_STRAND_BOW = 1.1;
const CURTAIN_STRAND_END_SHORT = 0.016;

export function drawBackCurtain(ctx: CanvasRenderingContext2D, sway: number, lift: number): void {
  const side = (sign: number): Array<{ x: number; y: number }> =>
    CURTAIN_SIDE.map(([x, y], i) => ({ x: sign * x + (sway * i) / CURTAIN_SIDE.length, y }));
  const hem = (sign: number): Array<{ x: number; y: number }> =>
    CURTAIN_HEM.map(([across, short]) => ({
      x: sign * across * CURTAIN_HEM_HALF_WIDTH + sway,
      y: HAIR_HEM_Y - short - lift,
    }));
  const right = [...side(1), ...hem(1)];
  const left = [...hem(-1).reverse(), ...side(-1).reverse()];
  const points = [...right, ...left.slice(1)];
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, points, true);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  ctx.lineCap = 'round';
  for (const across of CURTAIN_STRANDS) {
    ctx.beginPath();
    ctx.moveTo(across * HEAD_RADIUS_X * CURTAIN_STRAND_ROOT_SHARE, HEAD_CENTER_Y);
    ctx.quadraticCurveTo(
      across * CURTAIN_HEM_HALF_WIDTH * CURTAIN_STRAND_BOW,
      SHOULDER_Y,
      across * CURTAIN_HEM_HALF_WIDTH + sway,
      HAIR_HEM_Y - CURTAIN_STRAND_END_SHORT - lift,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Crown down one side of the face to the point of the chin. */
function traceFaceSideDown(ctx: CanvasRenderingContext2D, side: BodySide): void {
  ctx.bezierCurveTo(
    side * TEMPLE_CONTROL_X,
    HEAD_CROWN_Y,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y - CRANIUM_CONTROL_RISE,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y,
  );
  ctx.bezierCurveTo(
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y + CHEEK_TO_JAW_CONTROL_DROP,
    side * JAW_CORNER_X,
    JAW_CORNER_Y,
    side * CHIN_HALF_WIDTH,
    CHIN_SHOULDER_Y,
  );
  ctx.quadraticCurveTo(side * CHIN_HALF_WIDTH * CHIN_ROUND_CONTROL_FRACTION, CHIN_Y, 0, CHIN_Y);
}

/** The same profile walked the other way, to close the outline at the crown. */
function traceFaceSideUp(ctx: CanvasRenderingContext2D, side: BodySide): void {
  ctx.quadraticCurveTo(
    side * CHIN_HALF_WIDTH * CHIN_ROUND_CONTROL_FRACTION,
    CHIN_Y,
    side * CHIN_HALF_WIDTH,
    CHIN_SHOULDER_Y,
  );
  ctx.bezierCurveTo(
    side * JAW_CORNER_X,
    JAW_CORNER_Y,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y + CHEEK_TO_JAW_CONTROL_DROP,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y,
  );
  ctx.bezierCurveTo(
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y - CRANIUM_CONTROL_RISE,
    side * TEMPLE_CONTROL_X,
    HEAD_CROWN_Y,
    0,
    HEAD_CROWN_Y,
  );
}

function pathFace(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, HEAD_CROWN_Y);
  traceFaceSideDown(ctx, 1);
  traceFaceSideUp(ctx, -1);
  ctx.closePath();
}

/**
 * Modelling only — no drawn line anywhere on it. A face this small is carried
 * by where the light stops: the shaded side, the hollow under each cheekbone,
 * and the shadow the jaw casts on the neck.
 */
function shadeFace(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    FACE_SHADOW_SIDE * TEMPLE_SHADE_X,
    TEMPLE_SHADE_Y,
    TEMPLE_SHADE_RADIUS_X,
    TEMPLE_SHADE_RADIUS_Y,
    SKIN_SHADE,
    CHEEK_SHADE_ALPHA,
  );

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * CHEEK_HOLLOW_X,
      CHEEK_HOLLOW_Y,
      CHEEK_HOLLOW_RADIUS_X,
      CHEEK_HOLLOW_RADIUS_Y,
      SKIN_SHADE,
      CHEEK_HOLLOW_ALPHA,
    );
  }

  fillSoftEllipse(
    ctx,
    0,
    JAW_SHADE_Y,
    JAW_SHADE_RADIUS_X,
    JAW_SHADE_RADIUS_Y,
    SKIN_SHADE,
    JAW_SHADE_ALPHA,
  );
}

function drawEars(ctx: CanvasRenderingContext2D): void {
  for (const side of SIDES) {
    ctx.fillStyle = SKIN_BASE;
    ctx.beginPath();
    ctx.ellipse(side * EAR_X, EAR_Y, EAR_RADIUS_X, EAR_RADIUS_Y, 0, 0, Math.PI * 2);
    ctx.fill();
    fillSoftEllipse(
      ctx,
      side * EAR_X,
      EAR_Y,
      EAR_HOLLOW_RADIUS_X,
      EAR_HOLLOW_RADIUS_Y,
      SKIN_HALF,
      EAR_HOLLOW_ALPHA,
    );
  }
}

function drawBrows(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = HAIR_DARK;
  ctx.globalAlpha *= BROW_ALPHA;
  ctx.lineWidth = BROW_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of SIDES) {
    const archX = BROW_INNER_X + (BROW_OUTER_X - BROW_INNER_X) * BROW_ARCH_X_FRACTION;
    ctx.beginPath();
    ctx.moveTo(side * BROW_INNER_X, BROW_Y);
    ctx.quadraticCurveTo(side * archX, BROW_Y - BROW_ARCH_RISE, side * BROW_OUTER_X, BROW_Y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The almond outline of one eye, inner corner low and outer corner lifted. */
function pathEye(ctx: CanvasRenderingContext2D, side: BodySide): void {
  const innerX = side * (EYE_X - EYE_RADIUS_X);
  const outerX = side * (EYE_X + EYE_RADIUS_X);
  const outerY = EYE_Y - EYE_OUTER_CORNER_RISE;
  ctx.beginPath();
  ctx.moveTo(innerX, EYE_Y);
  ctx.quadraticCurveTo(side * EYE_X, EYE_Y - EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, outerX, outerY);
  ctx.quadraticCurveTo(side * EYE_X, EYE_Y + EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, innerX, EYE_Y);
  ctx.closePath();
}

function drawEyes(ctx: CanvasRenderingContext2D): void {
  for (const side of SIDES) {
    ctx.save();
    pathEye(ctx, side);
    ctx.fillStyle = EYE_WHITE;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = IRIS_COLOR;
    ctx.beginPath();
    ctx.arc(side * EYE_X, EYE_Y, IRIS_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PUPIL_COLOR;
    ctx.beginPath();
    ctx.arc(side * EYE_X, EYE_Y, PUPIL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = EYE_WHITE;
    ctx.beginPath();
    ctx.arc(
      side * EYE_X - EYE_CATCHLIGHT_OFFSET,
      EYE_Y - EYE_CATCHLIGHT_OFFSET,
      EYE_CATCHLIGHT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = HAIR_DARK;
  ctx.lineWidth = LASH_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of SIDES) {
    const innerX = side * (EYE_X - EYE_RADIUS_X);
    const outerX = side * (EYE_X + EYE_RADIUS_X);
    const outerY = EYE_Y - EYE_OUTER_CORNER_RISE;
    ctx.beginPath();
    ctx.moveTo(innerX, EYE_Y);
    ctx.quadraticCurveTo(side * EYE_X, EYE_Y - EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, outerX, outerY);
    ctx.quadraticCurveTo(
      outerX + side * LASH_FLICK_LENGTH * LASH_FLICK_CONTROL_ALONG,
      outerY - LASH_FLICK_RISE * LASH_FLICK_CONTROL_RISE,
      outerX + side * LASH_FLICK_LENGTH,
      outerY - LASH_FLICK_RISE,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawNose(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    FACE_SHADOW_SIDE * NOSE_HALF_WIDTH * NOSE_BRIDGE_SHADE_OFFSET_SHARE,
    (NOSE_BRIDGE_TOP_Y + NOSE_TIP_Y) / 2,
    NOSE_BRIDGE_SHADE_RADIUS_X,
    (NOSE_TIP_Y - NOSE_BRIDGE_TOP_Y) / 2,
    SKIN_SHADE,
    NOSE_BRIDGE_SHADE_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    0,
    NOSE_TIP_SHADE_Y,
    NOSE_TIP_SHADE_RADIUS_X,
    NOSE_TIP_SHADE_RADIUS_Y,
    SKIN_SHADE,
    NOSE_TIP_SHADE_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    -FACE_SHADOW_SIDE * NOSE_HALF_WIDTH * NOSE_TIP_HIGHLIGHT_OFFSET_SHARE,
    NOSE_TIP_HIGHLIGHT_Y,
    NOSE_TIP_HIGHLIGHT_RADIUS,
    NOSE_TIP_HIGHLIGHT_RADIUS,
    SKIN_LIT,
    NOSE_TIP_HIGHLIGHT_ALPHA,
  );
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * NOSTRIL_X,
      NOSE_TIP_Y,
      NOSTRIL_RADIUS_X,
      NOSTRIL_RADIUS_Y,
      SKIN_CREASE,
      NOSTRIL_ALPHA,
    );
  }
}

/**
 * The seam where the lips meet, continued from the current point across to the
 * far corner. Both lip shapes and the line drawn over them trace the same
 * curve, so no sliver of skin can open along the join.
 */
function pathLipSeam(ctx: CanvasRenderingContext2D, towardX: number): void {
  ctx.quadraticCurveTo(0, MOUTH_Y + LIP_SEAM_DROP, towardX, MOUTH_Y);
}

function drawMouth(ctx: CanvasRenderingContext2D): void {
  const peakY = MOUTH_Y - UPPER_LIP_HEIGHT;
  const bowDipY = MOUTH_Y - UPPER_LIP_HEIGHT * CUPIDS_BOW_DIP;
  const peakControlX = MOUTH_HALF_WIDTH * LIP_PEAK_CONTROL_FRACTION;

  ctx.fillStyle = LIP_UPPER_COLOR;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  ctx.quadraticCurveTo(-peakControlX, peakY, -CUPIDS_BOW_X, peakY);
  ctx.quadraticCurveTo(0, bowDipY, CUPIDS_BOW_X, peakY);
  ctx.quadraticCurveTo(peakControlX, peakY, MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, -MOUTH_HALF_WIDTH);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = LIP_COLOR;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, MOUTH_HALF_WIDTH);
  ctx.quadraticCurveTo(
    MOUTH_HALF_WIDTH * LOWER_LIP_FULLNESS_SHARE,
    MOUTH_Y + LOWER_LIP_HEIGHT,
    0,
    MOUTH_Y + LOWER_LIP_HEIGHT,
  );
  ctx.quadraticCurveTo(
    -MOUTH_HALF_WIDTH * LOWER_LIP_FULLNESS_SHARE,
    MOUTH_Y + LOWER_LIP_HEIGHT,
    -MOUTH_HALF_WIDTH,
    MOUTH_Y,
  );
  ctx.closePath();
  ctx.fill();

  fillSoftEllipse(
    ctx,
    0,
    MOUTH_Y + LOWER_LIP_HEIGHT * LOWER_LIP_SHEEN_Y_FRACTION,
    LOWER_LIP_SHEEN_RADIUS_X,
    LOWER_LIP_SHEEN_RADIUS_Y,
    LIP_SHEEN_COLOR,
    LOWER_LIP_SHEEN_ALPHA,
  );

  ctx.strokeStyle = LIP_SEAM_COLOR;
  ctx.lineWidth = LIP_SEAM_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, MOUTH_HALF_WIDTH);
  ctx.stroke();

  fillSoftEllipse(
    ctx,
    0,
    CHIN_SHADOW_Y,
    CHIN_SHADOW_RADIUS_X,
    CHIN_SHADOW_RADIUS_Y,
    SKIN_SHADE,
    CHIN_SHADOW_ALPHA,
  );
}

/** The hair framing each side of the face, from the crown down past the cheek and back up inside it. */
const SIDE_HAIR_TOP_RISE = 0.75;
const SIDE_HAIR_OUTER_BOW = 1.15;
const SIDE_HAIR_BOTTOM_DROP = 0.5;
const SIDE_HAIR_INNER_BOW = 0.95;
const SIDE_HAIR_INNER_END_ACROSS = 0.45;
const SIDE_HAIR_INNER_END_RISE = 0.55;

/** The head head-on (`facingAway` false) or from behind, in the head's own frame. */
export function drawHead(ctx: CanvasRenderingContext2D, facingAway: boolean): void {
  drawEars(ctx);

  // From behind the skull is all hair; filling the face there leaves a rim of
  // skin round the crown.
  if (!facingAway) {
    pathFace(ctx);
    ctx.fillStyle = SKIN_LIT;
    ctx.fill();
    withClip(
      ctx,
      () => pathFace(ctx),
      () => shadeFace(ctx),
    );
  }

  ctx.fillStyle = HAIR_DARK;
  if (facingAway) {
    // The back of the head is all hair, so the whole skull is capped.
    ctx.beginPath();
    ctx.ellipse(
      0,
      HEAD_CENTER_Y,
      HEAD_RADIUS_X * BACK_OF_HEAD_WIDTH_FRACTION,
      HEAD_RADIUS_Y * BACK_OF_HEAD_HEIGHT_FRACTION,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.moveTo(
        side * HEAD_RADIUS_X * BACK_SHEEN_ROOT_ACROSS,
        HEAD_CENTER_Y - HEAD_RADIUS_Y * BACK_SHEEN_ROOT_RISE,
      );
      ctx.quadraticCurveTo(
        side * HEAD_RADIUS_X * BACK_SHEEN_BOW_ACROSS,
        HEAD_CENTER_Y,
        side * HEAD_RADIUS_X * BACK_SHEEN_END_ACROSS,
        HEAD_CENTER_Y + HEAD_RADIUS_Y,
      );
      ctx.stroke();
    }
    return;
  }

  // The crown, and a blunt fringe whose lower edge breaks into shallow points
  // so it reads as hair cut across the brow rather than a hat's brim.
  ctx.beginPath();
  ctx.moveTo(-HEAD_RADIUS_X * CROWN_SIDE_SHARE, CROWN_SIDE_Y);
  ctx.bezierCurveTo(
    -HEAD_RADIUS_X * CROWN_SWELL_SHARE,
    HEAD_CROWN_Y - CROWN_RISE,
    HEAD_RADIUS_X * CROWN_SWELL_SHARE,
    HEAD_CROWN_Y - CROWN_RISE,
    HEAD_RADIUS_X * CROWN_SIDE_SHARE,
    CROWN_SIDE_Y,
  );
  for (const [across, drop] of FRINGE_EDGE)
    ctx.lineTo(HEAD_RADIUS_X * across, FRINGE_EDGE_Y + drop);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    0,
    HEAD_CENTER_Y,
    HEAD_RADIUS_X * CROWN_SHEEN_SHARE,
    HEAD_RADIUS_Y * CROWN_SHEEN_SHARE,
    0,
    CROWN_SHEEN_FROM,
    CROWN_SHEEN_TO,
  );
  ctx.stroke();
  ctx.restore();
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(0, HEAD_CENTER_Y - HEAD_RADIUS_Y * SIDE_HAIR_TOP_RISE);
    ctx.quadraticCurveTo(
      side * HEAD_RADIUS_X * SIDE_HAIR_OUTER_BOW,
      FRINGE_Y,
      side * HEAD_RADIUS_X,
      HEAD_CENTER_Y + HEAD_RADIUS_Y * SIDE_HAIR_BOTTOM_DROP,
    );
    ctx.quadraticCurveTo(
      side * HEAD_RADIUS_X * SIDE_HAIR_INNER_BOW,
      FRINGE_Y,
      side * HEAD_RADIUS_X * SIDE_HAIR_INNER_END_ACROSS,
      HEAD_CENTER_Y - HEAD_RADIUS_Y * SIDE_HAIR_INNER_END_RISE,
    );
    ctx.closePath();
    ctx.fill();
  }

  drawBrows(ctx);
  drawEyes(ctx);
  drawNose(ctx);
  drawMouth(ctx);
}
