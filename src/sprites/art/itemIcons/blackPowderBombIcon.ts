import type { Rect } from '../../../ui/core/geom';
import {
  FULL_TURN,
  glint,
  hairlineWidth,
  ICON_OUTLINE,
  litFill,
  MEDIUM_DETAIL,
  outlineWidth,
  paintForm,
  paintIconArt,
  tone,
  withShapeClip,
} from './iconPaint';

/**
 * The Black Powder Bomb: a cast-iron sphere with a short neck and a twisted
 * hemp fuse. The round silhouette and the cord curling off the top are what
 * read at slot size; the shading is what makes it iron rather than a black
 * ball.
 *
 * The sphere is lit from the upper left. Its lit side is the sphere's own
 * outline shifted toward the light, so the terminator is one curved line
 * across the form, darkened where the turn away from the light is sharpest,
 * never a set of rings around a centre. Light bounced off the floor rims the
 * lower edge faintly.
 */

const SPHERE_X = 0.44;
const SPHERE_Y = 0.6;
const SPHERE_RADIUS = 0.31;

const IRON = '#30343a';
const IRON_SHADOW = tone(IRON, -0.55);
const IRON_LIT = tone(IRON, 0.22);
/** The line where the form turns from the light, darker than the shadow beside it. */
const TERMINATOR_INK = tone(IRON, -0.78);
const TERMINATOR_WIDTH_SCALE = 2.2;
/** Floor light bounced onto the underside: cool, faint and confined to a thin rim. */
const REFLECTED_LIGHT = '#6f7c8c';
const REFLECTED_ALPHA = 0.55;

/** How far the lit lens is pushed toward the light, per unit radius. */
const LIT_SHIFT_X = -0.26;
const LIT_SHIFT_Y = -0.32;
/** How far the reflected rim's cut-out is pushed toward the light, per unit radius; small, so the rim stays thin. */
const RIM_SHIFT_X = -0.07;
const RIM_SHIFT_Y = -0.12;

/** The casting seam runs round the equator, seen from a little above, so its front half dips below the centre. */
const SEAM_TILT_RY = 0.26;
const SEAM_DROP = 0.02;
const SEAM_INK = tone(IRON, -0.7);
const SEAM_RIDGE = tone(IRON, 0.12);
/** The ridge's highlight sits this far under the seam line, per unit radius. */
const SEAM_RIDGE_OFFSET = 0.045;

/** A tight specular: small, hard-edged, high on the lit side. */
const SPECULAR_X = -0.42;
const SPECULAR_Y = -0.46;
const SPECULAR_RX = 0.14;
const SPECULAR_RY = 0.09;
const SPECULAR_TILT = -Math.PI / 4;
const SPECULAR_INK = '#d9e1ea';
const SPECULAR_GLINT_RADIUS = 0.07;

/** The neck leans toward the upper right, the way the fuse falls. */
const NECK_LEAN = Math.PI / 6;
/** Where the neck leaves the sphere, as a share of its radius from the centre; inside the rim so the sphere overlaps its foot. */
const NECK_ROOT_SHARE = 0.86;
const NECK_WIDTH = 0.12;
const NECK_LENGTH = 0.12;
const NECK_LIP_WIDTH = 0.16;
const NECK_LIP_HEIGHT = 0.04;
const NECK_IRON = '#4a4f57';

const FUSE_CORD = '#b9965c';
const FUSE_TWIST_INK = tone(FUSE_CORD, -0.5);
const FUSE_TWIST_LIGHT = tone(FUSE_CORD, 0.35);
const FUSE_WIDTH = 0.055;
/** The cord's curve from the neck's mouth, in the neck's frame: up, then bending right and over. */
const FUSE_CONTROL: readonly [number, number] = [0.02, -0.15];
const FUSE_END: readonly [number, number] = [0.17, -0.2];
const FUSE_TWISTS = 6;
/** Half the length of each twist's slant, across the cord. */
const TWIST_HALF = 0.03;
const FRAY_STRANDS = 3;
const FRAY_LENGTH = 0.04;
const FRAY_SPREAD = 0.5;

function traceSphere(ctx: CanvasRenderingContext2D, dx = 0, dy = 0): void {
  ctx.beginPath();
  ctx.arc(SPHERE_X + dx, SPHERE_Y + dy, SPHERE_RADIUS, 0, FULL_TURN);
}

function quadraticPoint(
  start: readonly [number, number],
  control: readonly [number, number],
  end: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  return [
    u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
    u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
  ];
}

function quadraticTangent(
  start: readonly [number, number],
  control: readonly [number, number],
  end: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  return [
    2 * u * (control[0] - start[0]) + 2 * t * (end[0] - control[0]),
    2 * u * (control[1] - start[1]) + 2 * t * (end[1] - control[1]),
  ];
}

/** The neck and fuse, painted in the neck's own frame: origin at its root, -Y up the neck. */
function paintNeckAndFuse(ctx: CanvasRenderingContext2D, px: number): void {
  const rootDistance = SPHERE_RADIUS * NECK_ROOT_SHARE;
  ctx.save();
  ctx.translate(
    SPHERE_X + Math.sin(NECK_LEAN) * rootDistance,
    SPHERE_Y - Math.cos(NECK_LEAN) * rootDistance,
  );
  ctx.rotate(NECK_LEAN);

  const mouthY = -NECK_LENGTH - NECK_LIP_HEIGHT;
  const fuseStart: readonly [number, number] = [0, mouthY];
  const fuseControl: readonly [number, number] = [FUSE_CONTROL[0], mouthY + FUSE_CONTROL[1]];
  const fuseEnd: readonly [number, number] = [FUSE_END[0], mouthY + FUSE_END[1]];
  const traceCord = (): void => {
    ctx.beginPath();
    ctx.moveTo(fuseStart[0], fuseStart[1]);
    ctx.quadraticCurveTo(fuseControl[0], fuseControl[1], fuseEnd[0], fuseEnd[1]);
  };
  traceCord();
  ctx.strokeStyle = ICON_OUTLINE;
  ctx.lineWidth = FUSE_WIDTH + outlineWidth(px) * 2;
  ctx.stroke();
  ctx.strokeStyle = FUSE_CORD;
  ctx.lineWidth = FUSE_WIDTH;
  ctx.stroke();

  // A twisted cord reads by its slanted strands: a dark groove and a lit
  // strand beside it, crossing the cord at the same angle all the way up.
  for (let twist = 1; twist <= FUSE_TWISTS; twist++) {
    const t = twist / (FUSE_TWISTS + 1);
    const [x, y] = quadraticPoint(fuseStart, fuseControl, fuseEnd, t);
    const [tx, ty] = quadraticTangent(fuseStart, fuseControl, fuseEnd, t);
    const length = Math.hypot(tx, ty) || 1;
    const alongX = tx / length;
    const alongY = ty / length;
    const acrossX = -alongY;
    const acrossY = alongX;
    const slantX = (acrossX + alongX) * TWIST_HALF;
    const slantY = (acrossY + alongY) * TWIST_HALF;
    ctx.lineWidth = hairlineWidth(px);
    ctx.strokeStyle = FUSE_TWIST_INK;
    ctx.beginPath();
    ctx.moveTo(x - slantX, y - slantY);
    ctx.lineTo(x + slantX, y + slantY);
    ctx.stroke();
    const strandOffset = TWIST_HALF * MEDIUM_DETAIL;
    ctx.strokeStyle = FUSE_TWIST_LIGHT;
    ctx.beginPath();
    ctx.moveTo(x - slantX - alongX * strandOffset, y - slantY - alongY * strandOffset);
    ctx.lineTo(x + slantX - alongX * strandOffset, y + slantY - alongY * strandOffset);
    ctx.stroke();
  }

  const [endTx, endTy] = quadraticTangent(fuseStart, fuseControl, fuseEnd, 1);
  const endAngle = Math.atan2(endTy, endTx);
  ctx.strokeStyle = FUSE_TWIST_INK;
  ctx.lineWidth = hairlineWidth(px);
  for (let strand = 0; strand < FRAY_STRANDS; strand++) {
    const spread = (strand / (FRAY_STRANDS - 1) - 1 / 2) * FRAY_SPREAD;
    ctx.beginPath();
    ctx.moveTo(fuseEnd[0], fuseEnd[1]);
    ctx.lineTo(
      fuseEnd[0] + Math.cos(endAngle + spread) * FRAY_LENGTH,
      fuseEnd[1] + Math.sin(endAngle + spread) * FRAY_LENGTH,
    );
    ctx.stroke();
  }

  const neckHalf = NECK_WIDTH / 2;
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.rect(-neckHalf, -NECK_LENGTH, NECK_WIDTH, NECK_LENGTH);
    },
    litFill(ctx, NECK_IRON, [-neckHalf, 0], [neckHalf, 0]),
  );
  const lipHalf = NECK_LIP_WIDTH / 2;
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.rect(-lipHalf, -NECK_LENGTH - NECK_LIP_HEIGHT, NECK_LIP_WIDTH, NECK_LIP_HEIGHT);
    },
    litFill(ctx, NECK_IRON, [-lipHalf, 0], [lipHalf, 0]),
  );
  ctx.restore();
}

function paintSphere(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(ctx, px, () => traceSphere(ctx), IRON_SHADOW);
  const litDx = LIT_SHIFT_X * SPHERE_RADIUS;
  const litDy = LIT_SHIFT_Y * SPHERE_RADIUS;
  withShapeClip(
    ctx,
    () => traceSphere(ctx),
    () => {
      traceSphere(ctx, litDx, litDy);
      ctx.fillStyle = litFill(
        ctx,
        IRON,
        [SPHERE_X - SPHERE_RADIUS, SPHERE_Y - SPHERE_RADIUS],
        [SPHERE_X + SPHERE_RADIUS, SPHERE_Y + SPHERE_RADIUS],
      );
      ctx.fill();
      ctx.strokeStyle = TERMINATOR_INK;
      ctx.lineWidth = hairlineWidth(px) * TERMINATOR_WIDTH_SCALE;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(SPHERE_X, SPHERE_Y, SPHERE_RADIUS, 0, FULL_TURN);
      ctx.arc(
        SPHERE_X + RIM_SHIFT_X * SPHERE_RADIUS,
        SPHERE_Y + RIM_SHIFT_Y * SPHERE_RADIUS,
        SPHERE_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.globalAlpha = REFLECTED_ALPHA;
      ctx.fillStyle = REFLECTED_LIGHT;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;

      const seamY = SPHERE_Y + SEAM_DROP;
      const seamRy = SPHERE_RADIUS * SEAM_TILT_RY;
      ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
      ctx.strokeStyle = SEAM_INK;
      ctx.beginPath();
      ctx.ellipse(SPHERE_X, seamY, SPHERE_RADIUS, seamRy, 0, 0, Math.PI);
      ctx.stroke();
      ctx.lineWidth = hairlineWidth(px);
      ctx.strokeStyle = SEAM_RIDGE;
      ctx.beginPath();
      ctx.ellipse(
        SPHERE_X,
        seamY + SPHERE_RADIUS * SEAM_RIDGE_OFFSET,
        SPHERE_RADIUS,
        seamRy,
        0,
        0,
        Math.PI,
      );
      ctx.stroke();

      const specX = SPHERE_X + SPECULAR_X * SPHERE_RADIUS;
      const specY = SPHERE_Y + SPECULAR_Y * SPHERE_RADIUS;
      ctx.fillStyle = IRON_LIT;
      ctx.beginPath();
      ctx.ellipse(
        specX,
        specY,
        SPECULAR_RX * SPHERE_RADIUS * 2,
        SPECULAR_RY * SPHERE_RADIUS * 2,
        SPECULAR_TILT,
        0,
        FULL_TURN,
      );
      ctx.fill();
      ctx.fillStyle = SPECULAR_INK;
      ctx.beginPath();
      ctx.ellipse(
        specX,
        specY,
        SPECULAR_RX * SPHERE_RADIUS,
        SPECULAR_RY * SPHERE_RADIUS,
        SPECULAR_TILT,
        0,
        FULL_TURN,
      );
      ctx.fill();
      glint(ctx, specX, specY, SPECULAR_GLINT_RADIUS);
    },
  );
}

/** Paints the Black Powder Bomb into `rect`'s icon square. */
export function drawBlackPowderBombIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    paintNeckAndFuse(art, px);
    paintSphere(art, px);
  });
}
