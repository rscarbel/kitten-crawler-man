/**
 * Signet's head and hair, head-on and from behind: the face, the pointed ears
 * and horns, the fringe, the two chest locks, and the fall of hair down her
 * back.
 */

import { fillSoftEllipse, withClip } from '../softShade';
import { mix } from '../carlArt';
import {
  HEAD_CENTER_Y,
  HEAD_RADIUS_X,
  HEAD_RADIUS_Y,
  JAW_Y,
  SHOULDER_Y,
  BUST_POINT_X,
  BUST_POINT_Y,
  BUST_Y,
  HORN_LENGTH,
  HORN_BASE_Y_FRACTION,
} from './proportions';
import {
  EYE_CAST_COLOR,
  EYE_IDLE_COLOR,
  EYE_WHITE,
  HAIR_DARK,
  HAIR_SHEEN,
  HORN_COLOR,
  HORN_LIT,
  LIP_COLOR,
  LIP_SEAM_COLOR,
  LIP_SHEEN_COLOR,
  LIP_UPPER_COLOR,
  PUPIL_COLOR,
  SKIN_BASE,
  SKIN_CREASE,
  SKIN_LIT,
  SKIN_SHADE,
} from './palette';
import { GLOW_REFERENCE_TILE_PX } from './tattoos';
import { SIDES, type BodySide } from './skeleton';
import { traceSmooth } from './paint';

const FINE_LINE_WIDTH = 0.005;
const BACK_OF_HEAD_WIDTH_FRACTION = 1.2;
const BACK_OF_HEAD_HEIGHT_FRACTION = 1.1;
const CHEEK_SHADE_ALPHA = 0.28;

/* ── Hair ──────────────────────────────────────────────────────────────── */

/**
 * Her hair is cut to exactly one length everywhere: just past the bust, which
 * is the length the two front locks need to cover the bust points at every
 * frame and every pose. Nothing is drawn on the chest underneath them.
 */
const FRONT_LOCK_TOP_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.2;
const FRONT_LOCK_BOTTOM_Y = -0.058;
const FRONT_LOCK_CENTER_X = BUST_POINT_X * 1.15;
/**
 * Only wide enough to cover the apex it is centred on. Widened out, the pair of
 * them curtain the whole chest and the breasts stop reading at all — the point
 * of the locks is the nipples, not the bust.
 */
const FRONT_LOCK_HALF_WIDTH = 0.021;
/** How far the tapered tip of each lock runs past its bottom anchor. */
const FRONT_LOCK_TIP_LENGTH = 0.024;
const FRONT_LOCK_ROOT_HALF_WIDTH = 0.016;
/** The locks leave the head this far out across the skull, behind the ears. */
const FRONT_LOCK_ROOT_SHARE = 0.75;
/** How far in the lock's sides have drawn by the start of its points. */
const FRONT_LOCK_TAPER_SHARE = 0.9;
/** Each of the two points at the end sits this share of the half-width off centre. */
const FRONT_LOCK_TIP_SPREAD = 0.4;
/** The shorter point's length, and the notch between the points, as shares of the tip length. */
const FRONT_LOCK_SHORT_POINT_SHARE = 0.45;
const FRONT_LOCK_NOTCH_SHARE = -0.1;
const FRONT_LOCK_SHEEN_ALPHA = 0.8;
const FRONT_LOCK_SHEEN_INSET = 0.25;
const FRONT_LOCK_SHEEN_BOW = 0.004;
const FRONT_LOCK_SHEEN_ROOT_DROP = 0.02;
/** Half the break in the sheen where the lock turns over the apex. */
const FRONT_LOCK_SHEEN_GAP = 0.01;
const FRONT_LOCK_SHEEN_GLINT_SHIFT = 0.004;
const FRONT_LOCK_SHEEN_END_SHORT = 0.012;
/** Sideways drift of the lock tips; kept far smaller than the lock half-width. */
const FRONT_LOCK_DRIFT = 0.004;
const FRONT_LOCK_DRIFT_SPEED = 0.7;

/** The single length every fall of her hair ends at — the front locks' tips. */
const HAIR_LENGTH_Y = FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH;

const HAIR_STRAND_WIDTH = 0.004;

const FRINGE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.15;
const CROWN_SIDE_SHARE = 1.14;
const CROWN_SIDE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.05;
const CROWN_SWELL_SHARE = 1.3;
const CROWN_RISE = HEAD_RADIUS_Y * 0.32;
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
 * at the cheekbone, which is the single thing that makes a drawn head read as
 * male or as a doll. Hers runs wide and round through the cranium, holds its
 * width at the cheekbone, then falls away to a narrow rounded chin.
 */
const HEAD_CROWN_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y;
const CHIN_Y = JAW_Y;
const CHEEKBONE_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.08;
const JAW_CORNER_X = HEAD_RADIUS_X * 0.74;
const JAW_CORNER_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.46;
const CHIN_HALF_WIDTH = HEAD_RADIUS_X * 0.26;
/** Where the jawline stops running in and the chin itself rounds off. */
const CHIN_SHOULDER_Y = CHIN_Y - HEAD_RADIUS_Y * 0.1;
/** Carries the cranium out past the eye line before it turns down. */
const TEMPLE_CONTROL_X = HEAD_RADIUS_X * 1.14;
const CRANIUM_CONTROL_RISE = HEAD_RADIUS_Y * 0.45;
const CHEEK_TO_JAW_CONTROL_DROP = HEAD_RADIUS_Y * 0.22;
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

const EAR_LENGTH = 0.076;
const EAR_ROOT_HALF_HEIGHT = 0.022;
const EAR_TIP_RISE = 0.062;
/** Ears sit at eye level, not on top of the skull. */
const EAR_ROOT_Y = HEAD_CENTER_Y + 0.014;

const HORN_X = 0.036;
const HORN_BASE_HALF_WIDTH = 0.015;
const HORN_EDGE_WIDTH = 0.005;
const HORN_EDGE_INSET = 0.6;
/** How far up the skull the horns are rooted, as a fraction of its radius. */

const EYE_X = 0.027;
const EYE_Y = HEAD_CENTER_Y - 0.004;
const EYE_RADIUS_X = 0.0145;
const EYE_RADIUS_Y = 0.0105;
/** Outer corner lifted above the inner one, which is most of the almond. */
const EYE_OUTER_CORNER_RISE = 0.004;
const EYE_LID_CONTROL_RISE = 1.45;
/** Small and dark teal rather than black, so the eye reads as glowing pale blue with a pupil, not a dark bead. */
const PUPIL_RADIUS = 0.004;
const EYE_CATCHLIGHT_OFFSET = 0.0026;
const EYE_CATCHLIGHT_RADIUS = 0.0022;
/** Heavier at the outer corner and carried past it as a flick. */
const LASH_LINE_WIDTH = 0.0026;
const LASH_FLICK_LENGTH = 0.005;
const LASH_FLICK_RISE = 0.0035;
const EYE_GLOW_BLUR_IDLE_PX = 2;
const EYE_GLOW_BLUR_CAST_PX = 14;
/** The tile size the pixel blur radii above were chosen against. */

/** High, thin and arched — a heavy straight brow is the most masculine mark
 * that can be put on a face this stylised. */
const BROW_INNER_X = 0.016;
const BROW_OUTER_X = 0.042;
const BROW_Y = EYE_Y - 0.028;
const BROW_ARCH_RISE = 0.007;
/** The arch peaks past the middle of the brow, nearer the outer end. */
const BROW_ARCH_X_FRACTION = 0.62;
const BROW_LINE_WIDTH = 0.0026;
const BROW_ALPHA = 0.6;

/**
 * Slight but present: at this size a drawn nose becomes a smudge, so hers is
 * built out of the light instead — a shadow down one side of the bridge, a lit
 * tip, and two nostril marks small enough to read as punctuation.
 */
const NOSE_TIP_Y = HEAD_CENTER_Y + 0.023;
const NOSE_HALF_WIDTH = 0.0085;
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
 * Two lips with a seam between them, not a single stroke. The stroke was the
 * whole mouth before, and at her size a hairline in a skin tone simply is not
 * there — the mouth has to be a shape holding its own colour.
 */
const MOUTH_Y = HEAD_CENTER_Y + 0.042;
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

const FANG_X = 0.0095;
const FANG_HALF_WIDTH = 0.0038;
const FANG_LENGTH = 0.009;

/**
 * Head-on, the hair that falls behind her: it hugs the sides of the head and
 * the slope of the shoulders and hangs down her back out of sight, so all that
 * shows of it is a dark edge beside the neck and over each shoulder. Carried
 * wider than the shoulders it frames her like a sleeveless jacket.
 */
const BEHIND_HAIR_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.072, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.6],
  [0.078, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.3],
  [0.07, SHOULDER_Y - 0.026],
  [0.084, SHOULDER_Y - 0.004],
  [0.082, SHOULDER_Y + 0.05],
  [0.068, HAIR_LENGTH_Y - 0.03],
  [0.036, HAIR_LENGTH_Y - 0.01],
];

export function drawBackHair(ctx: CanvasRenderingContext2D, sway: number): void {
  const points = [
    ...BEHIND_HAIR_POINTS.map(([x, y], i) => ({
      x: x + (sway * i) / BEHIND_HAIR_POINTS.length,
      y,
    })),
    ...[...BEHIND_HAIR_POINTS].reverse().map(([x, y], i) => ({
      x: -x + (sway * (BEHIND_HAIR_POINTS.length - 1 - i)) / BEHIND_HAIR_POINTS.length,
      y,
    })),
  ];
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  traceSmooth(ctx, points, true);
  ctx.fill();
}

/**
 * The two chest locks. They start behind the ears, pass straight over the bust
 * apexes and end below the ribs, so the apexes are covered in every pose — the
 * locks are part of the silhouette, not a decoration that can drift off it.
 */
export function drawChestLocks(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  headRotation: number,
): void {
  const rootCos = Math.cos(headRotation);
  const rootSin = Math.sin(headRotation);
  /** Follows the head, which rotates about the body origin. */
  const rootPoint = (x: number): { x: number; y: number } => ({
    x: x * rootCos - FRONT_LOCK_TOP_Y * rootSin,
    y: x * rootSin + FRONT_LOCK_TOP_Y * rootCos,
  });

  ctx.fillStyle = HAIR_DARK;
  for (const side of SIDES) {
    const drift = Math.sin(timeSec * FRONT_LOCK_DRIFT_SPEED + side) * FRONT_LOCK_DRIFT;
    const rootX = side * (HEAD_RADIUS_X * FRONT_LOCK_ROOT_SHARE);
    const tipX = side * FRONT_LOCK_CENTER_X + drift;

    // The apex-height anchors are explicit path points rather than curve
    // controls, so the lock is provably `FRONT_LOCK_HALF_WIDTH` wide exactly
    // where it has to be — coverage cannot be lost to curve slack.
    const outerRoot = rootPoint(rootX - FRONT_LOCK_ROOT_HALF_WIDTH);
    const innerRoot = rootPoint(rootX + FRONT_LOCK_ROOT_HALF_WIDTH);
    const outerTipX = tipX - side * FRONT_LOCK_HALF_WIDTH * FRONT_LOCK_TIP_SPREAD;
    const innerTipX = tipX + side * FRONT_LOCK_HALF_WIDTH * FRONT_LOCK_TIP_SPREAD;

    ctx.beginPath();
    ctx.moveTo(outerRoot.x, outerRoot.y);
    ctx.quadraticCurveTo(
      rootX - FRONT_LOCK_HALF_WIDTH,
      BUST_Y,
      tipX - FRONT_LOCK_HALF_WIDTH,
      BUST_POINT_Y,
    );
    // The end splits into two uneven points, as a cut lock of straight hair
    // does; a single spike reads as a ribbon.
    ctx.quadraticCurveTo(
      tipX - FRONT_LOCK_HALF_WIDTH * FRONT_LOCK_TAPER_SHARE,
      FRONT_LOCK_BOTTOM_Y - FRONT_LOCK_TIP_LENGTH,
      side > 0 ? outerTipX : innerTipX,
      FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH * (side > 0 ? FRONT_LOCK_SHORT_POINT_SHARE : 1),
    );
    ctx.lineTo(tipX, FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH * FRONT_LOCK_NOTCH_SHARE);
    ctx.lineTo(
      side > 0 ? innerTipX : outerTipX,
      FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH * (side > 0 ? 1 : FRONT_LOCK_SHORT_POINT_SHARE),
    );
    ctx.quadraticCurveTo(
      tipX + FRONT_LOCK_HALF_WIDTH * FRONT_LOCK_TAPER_SHARE,
      FRONT_LOCK_BOTTOM_Y - FRONT_LOCK_TIP_LENGTH,
      tipX + FRONT_LOCK_HALF_WIDTH,
      BUST_POINT_Y,
    );
    ctx.quadraticCurveTo(rootX + FRONT_LOCK_HALF_WIDTH, BUST_Y, innerRoot.x, innerRoot.y);
    ctx.closePath();
    ctx.fill();

    // Sheen breaks where the lock rolls over the bust, so it is two strokes:
    // one down from the root, one short glint below the curve.
    ctx.save();
    ctx.globalAlpha *= FRONT_LOCK_SHEEN_ALPHA;
    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    ctx.lineCap = 'round';
    const strandRoot = rootPoint(rootX);
    const sheenX = tipX - side * FRONT_LOCK_HALF_WIDTH * FRONT_LOCK_SHEEN_INSET;
    ctx.beginPath();
    ctx.moveTo(strandRoot.x, strandRoot.y + FRONT_LOCK_SHEEN_ROOT_DROP);
    ctx.quadraticCurveTo(
      rootX - side * FRONT_LOCK_SHEEN_BOW,
      BUST_Y,
      sheenX,
      BUST_POINT_Y - FRONT_LOCK_SHEEN_GAP,
    );
    ctx.moveTo(sheenX + side * FRONT_LOCK_SHEEN_GLINT_SHIFT, BUST_POINT_Y + FRONT_LOCK_SHEEN_GAP);
    ctx.lineTo(
      sheenX + side * FRONT_LOCK_SHEEN_GLINT_SHIFT,
      FRONT_LOCK_BOTTOM_Y - FRONT_LOCK_SHEEN_END_SHORT,
    );
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * From behind, the fall of hair down her back: a sheet that leaves the skull,
 * hugs the nape, spreads a little over the tops of the shoulders and falls
 * straight, its sides tapering in, ending in locks of uneven length — shortest
 * at the sides. Drawn as one mass with a few strands of sheen; a sheet with a
 * square outline reads as a cape.
 */
const CURTAIN_SIDE: ReadonlyArray<readonly [number, number]> = [
  [0.066, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.2],
  [0.06, HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.95],
  [0.07, SHOULDER_Y - 0.012],
  [0.082, SHOULDER_Y + 0.016],
  [0.078, SHOULDER_Y + 0.07],
  [0.07, HAIR_LENGTH_Y - 0.034],
];
/** The hem across her back, outside in: (share of the hem's half-width, how far short of full length). */
const CURTAIN_HEM: ReadonlyArray<readonly [number, number]> = [
  [0.95, 0.03],
  [0.72, 0.011],
  [0.47, 0.004],
  [0.23, 0.009],
  [0, 0.002],
];
const CURTAIN_HEM_HALF_WIDTH = 0.068;
const CURTAIN_STRANDS: ReadonlyArray<number> = [-0.6, -0.25, 0.15, 0.5];
/** Sheen strands leave the crown inside the skull's width and bow out over the shoulders. */
const CURTAIN_STRAND_ROOT_SHARE = 0.6;
const CURTAIN_STRAND_BOW = 1.1;
const CURTAIN_STRAND_END_SHORT = 0.03;

export function drawBackCurtain(ctx: CanvasRenderingContext2D, sway = 0): void {
  const side = (sign: number): Array<{ x: number; y: number }> =>
    CURTAIN_SIDE.map(([x, y], i) => ({ x: sign * x + (sway * i) / CURTAIN_SIDE.length, y }));
  const hem = (sign: number): Array<{ x: number; y: number }> =>
    CURTAIN_HEM.map(([across, short]) => ({
      x: sign * across * CURTAIN_HEM_HALF_WIDTH + sway,
      y: HAIR_LENGTH_Y - short,
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
      HAIR_LENGTH_Y - CURTAIN_STRAND_END_SHORT,
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

function drawBrows(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = HAIR_DARK;
  ctx.globalAlpha = BROW_ALPHA;
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

function drawEyes(ctx: CanvasRenderingContext2D, castGlow: number, tileSizePx: number): void {
  ctx.save();
  ctx.shadowColor = castGlow > 0 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  ctx.shadowBlur =
    (EYE_GLOW_BLUR_IDLE_PX + (EYE_GLOW_BLUR_CAST_PX - EYE_GLOW_BLUR_IDLE_PX) * castGlow) *
    (tileSizePx / GLOW_REFERENCE_TILE_PX);
  ctx.fillStyle = mix(EYE_IDLE_COLOR, EYE_CAST_COLOR, castGlow);
  for (const side of SIDES) {
    pathEye(ctx, side);
    ctx.fill();
  }
  ctx.restore();

  if (castGlow < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - castGlow;
    ctx.fillStyle = PUPIL_COLOR;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(side * EYE_X, EYE_Y, PUPIL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = EYE_WHITE;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(
        side * EYE_X - EYE_CATCHLIGHT_OFFSET,
        EYE_Y - EYE_CATCHLIGHT_OFFSET,
        EYE_CATCHLIGHT_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
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

  ctx.fillStyle = EYE_WHITE;
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * FANG_X - FANG_HALF_WIDTH, MOUTH_Y);
    ctx.lineTo(side * FANG_X + FANG_HALF_WIDTH, MOUTH_Y);
    ctx.lineTo(side * FANG_X, MOUTH_Y + FANG_LENGTH);
    ctx.closePath();
    ctx.fill();
  }
}

/** Shares of the eye's lash flick at which its curve bends. */
const LASH_FLICK_CONTROL_ALONG = 0.6;
const LASH_FLICK_CONTROL_RISE = 0.4;
/** The bridge's shade sits off-centre on the shadow side; the tip's highlight on the lit side. */
const NOSE_BRIDGE_SHADE_OFFSET_SHARE = 0.55;
const NOSE_TIP_HIGHLIGHT_OFFSET_SHARE = 0.3;
/** How far out the lower lip keeps its full height before rounding into the corners. */
const LOWER_LIP_FULLNESS_SHARE = 0.62;

/** Ears: root across the skull, and the controls of the upper and lower edges and the inner hollow, as shares of the ear's length and rise. */
const EAR_ROOT_SHARE = 0.8;
const EAR_UPPER_CONTROL_ALONG = 0.6;
const EAR_UPPER_CONTROL_RISE = 0.6;
const EAR_LOWER_CONTROL_ALONG = 0.5;
const EAR_LOWER_CONTROL_DROP = 0.4;
const EAR_HOLLOW_START_ALONG = 0.15;
const EAR_HOLLOW_START_DROP = 0.3;
const EAR_HOLLOW_CONTROL_ALONG = 0.6;
const EAR_HOLLOW_CONTROL_RISE = 0.25;
const EAR_HOLLOW_END_ALONG = 0.85;
const EAR_HOLLOW_END_RISE = 0.8;

/** Sheen strands on the back of the head, as shares of the skull's radii. */
const BACK_SHEEN_ROOT_ACROSS = 0.25;
const BACK_SHEEN_ROOT_RISE = 0.6;
const BACK_SHEEN_BOW_ACROSS = 0.7;
const BACK_SHEEN_END_ACROSS = 0.45;

/** The hair framing each side of the face, from the crown down past the cheek and back up inside it. */
const SIDE_HAIR_TOP_RISE = 0.75;
const SIDE_HAIR_OUTER_BOW = 1.15;
const SIDE_HAIR_BOTTOM_DROP = 0.5;
const SIDE_HAIR_INNER_BOW = 0.95;
const SIDE_HAIR_INNER_END_ACROSS = 0.45;
const SIDE_HAIR_INNER_END_RISE = 0.55;

export function drawHead(
  ctx: CanvasRenderingContext2D,
  castGlow: number,
  tileSizePx: number,
  facingAway: boolean,
): void {
  ctx.fillStyle = SKIN_BASE;
  for (const side of SIDES) {
    const earRootX = side * HEAD_RADIUS_X * EAR_ROOT_SHARE;
    ctx.beginPath();
    ctx.moveTo(earRootX, EAR_ROOT_Y - EAR_ROOT_HALF_HEIGHT);
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * EAR_UPPER_CONTROL_ALONG,
      EAR_ROOT_Y - EAR_TIP_RISE * EAR_UPPER_CONTROL_RISE,
      earRootX + side * EAR_LENGTH,
      EAR_ROOT_Y - EAR_TIP_RISE,
    );
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * EAR_LOWER_CONTROL_ALONG,
      EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT * EAR_LOWER_CONTROL_DROP,
      earRootX,
      EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT,
    );
    ctx.closePath();
    ctx.fill();

    // A shaded inner hollow, or the ears read as flat white paddles
    ctx.save();
    ctx.strokeStyle = SKIN_SHADE;
    ctx.lineWidth = FINE_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(
      earRootX + side * EAR_LENGTH * EAR_HOLLOW_START_ALONG,
      EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT * EAR_HOLLOW_START_DROP,
    );
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * EAR_HOLLOW_CONTROL_ALONG,
      EAR_ROOT_Y - EAR_TIP_RISE * EAR_HOLLOW_CONTROL_RISE,
      earRootX + side * EAR_LENGTH * EAR_HOLLOW_END_ALONG,
      EAR_ROOT_Y - EAR_TIP_RISE * EAR_HOLLOW_END_RISE,
    );
    ctx.stroke();
    ctx.restore();
  }

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

  ctx.fillStyle = HORN_COLOR;
  for (const side of SIDES) {
    const hornBaseY = HEAD_CENTER_Y - HEAD_RADIUS_Y * HORN_BASE_Y_FRACTION;
    ctx.beginPath();
    ctx.moveTo(side * HORN_X - HORN_BASE_HALF_WIDTH, hornBaseY);
    ctx.lineTo(side * HORN_X + HORN_BASE_HALF_WIDTH, hornBaseY);
    ctx.lineTo(side * (HORN_X + HORN_BASE_HALF_WIDTH), hornBaseY - HORN_LENGTH);
    ctx.closePath();
    ctx.fill();
    // A lit edge up the horn's outer face keeps it apart from the black hair behind it.
    ctx.save();
    ctx.strokeStyle = HORN_LIT;
    ctx.lineWidth = HORN_EDGE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * (HORN_X + HORN_BASE_HALF_WIDTH * HORN_EDGE_INSET), hornBaseY);
    ctx.lineTo(side * (HORN_X + HORN_BASE_HALF_WIDTH), hornBaseY - HORN_LENGTH);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = HORN_COLOR;
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
  drawEyes(ctx, castGlow, tileSizePx);
  drawNose(ctx);
  drawMouth(ctx);
}
