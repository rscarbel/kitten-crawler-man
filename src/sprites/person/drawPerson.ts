/**
 * Renders a procedurally generated person over the jointed skeleton. Flesh and
 * cloth are painted onto the skeleton's joints (see `skeleton.ts`), so limbs
 * always meet at shoulders/hips/knees/elbows. Draw order depends on facing so
 * near limbs occlude the torso and far limbs sit behind it; the face and front
 * hair only render when the head faces the camera (`down`) or in profile, and
 * the back view (`up`) shows only the back of the head and any back-visible
 * hairstyle. `left` is drawn as a mirror of `right`.
 *
 * These are game-world figures, so raw canvas calls are appropriate here — the
 * `src/ui/*` helpers are for interface chrome, not sprites.
 */

import type { PersonAppearance } from './PersonAppearance';
import { shade, tint } from './color';
import { poseForMotion } from './gait';
import { buildSkeleton, type Facing, type Limb, type Point, type Skeleton } from './skeleton';

const TWO_PI = Math.PI * 2;

// Limb thicknesses as fractions of draw size, plus how much a heavy build adds.
const LEG_W_UPPER = 0.082;
const LEG_W_LOWER = 0.058;
const ARM_W_UPPER = 0.058;
const ARM_W_LOWER = 0.044;
const BUILD_LIMB_BONUS = 0.03;
const HAND_RADIUS = 0.032;
const FOOT_LEN = 0.12;
const FOOT_HEIGHT = 0.05;
const NECK_WIDTH = 0.052;

// Torso silhouette: rather than a flat shoulder-to-hip trapezoid (which reads as
// a wide box), the body curves in at the waist and the shoulder line lifts
// slightly at center for a trapezius slope, so the figure reads as a person.
const TORSO_MIN_SHOULDER_HALF = 0.07; // keeps an edge-on profile torso from vanishing
const TORSO_MIN_HIP_HALF = 0.055;
const TORSO_HIP_DRAW_FACTOR = 0.9; // draw hips a touch inside the leg roots so thighs read
const TORSO_WAIST_Y_FRAC = 0.55; // waist height between shoulders (0) and hips (1)
const TORSO_WAIST_PINCH = 0.8; // waist half-width as a fraction of the narrower of shoulder/hip
const TORSO_SHOULDER_RISE = 0.025; // how far the shoulder line lifts at center

/** Top styles whose sleeves cover the arms in the shirt color. */
const SLEEVED_TOPS: ReadonlySet<string> = new Set(['longsleeve', 'jacket', 'hoodie']);

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  app: PersonAppearance;
  s: number;
  facing: Facing;
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  width: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawLeg(dc: DrawContext, leg: Limb): void {
  const { ctx, app, s } = dc;
  const buildBonus = app.body.build * BUILD_LIMB_BONUS;
  const wUpper = (LEG_W_UPPER + buildBonus) * s;
  const wLower = (LEG_W_LOWER + buildBonus) * s;
  const covered = app.outfit.bottom === 'pants';
  const upperColor = app.outfit.bottomColor;
  const lowerColor = covered ? app.outfit.bottomColor : app.face.skin;

  strokeSegment(ctx, leg.root, leg.mid, wUpper, upperColor);
  strokeSegment(ctx, leg.mid, leg.end, wLower, lowerColor);
  drawFoot(dc, leg);
}

function drawFoot(dc: DrawContext, leg: Limb): void {
  const { ctx, app, s, facing } = dc;
  const forward = facing === 'right' ? 1 : facing === 'up' ? 0 : 0;
  const footLen = FOOT_LEN * s;
  const footH = FOOT_HEIGHT * s;
  ctx.fillStyle = app.outfit.shoes;
  ctx.beginPath();
  ctx.ellipse(leg.end.x + forward * footLen * 0.4, leg.end.y, footLen * 0.5, footH, 0, 0, TWO_PI);
  ctx.fill();
}

function drawArm(dc: DrawContext, arm: Limb): void {
  const { ctx, app, s } = dc;
  const buildBonus = app.body.build * BUILD_LIMB_BONUS;
  const wUpper = (ARM_W_UPPER + buildBonus) * s;
  const wLower = (ARM_W_LOWER + buildBonus) * s;
  const sleeved = SLEEVED_TOPS.has(app.outfit.top);
  const sleeveColor = app.outfit.topColor;

  strokeSegment(ctx, arm.root, arm.mid, wUpper, sleeved ? sleeveColor : app.face.skin);
  // Long sleeves reach the wrist; jackets/hoodies stop a touch short, tshirts show bare arm.
  const forearmColor = app.outfit.top === 'longsleeve' ? sleeveColor : app.face.skin;
  strokeSegment(ctx, arm.mid, arm.end, wLower, forearmColor);

  ctx.fillStyle = app.face.skin;
  ctx.beginPath();
  ctx.arc(arm.end.x, arm.end.y, HAND_RADIUS * s, 0, TWO_PI);
  ctx.fill();
}

function drawTorso(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app, s } = dc;
  const { shoulderCenter, hipCenter, shoulderHalf, hipHalf } = skel;
  const outfit = app.outfit;

  // Give a thin profile torso a little depth so the body doesn't vanish edge-on.
  const shHalf = Math.max(shoulderHalf, s * TORSO_MIN_SHOULDER_HALF);
  const hpHalf = Math.max(hipHalf * TORSO_HIP_DRAW_FACTOR, s * TORSO_MIN_HIP_HALF);

  const topY = shoulderCenter.y;
  const hipY = hipCenter.y;
  const waistHalf = Math.min(shHalf, hpHalf) * TORSO_WAIST_PINCH;
  const waistY = topY + (hipY - topY) * TORSO_WAIST_Y_FRAC;
  const sxc = shoulderCenter.x;
  const hxc = hipCenter.x;
  const waistX = sxc + (hxc - sxc) * TORSO_WAIST_Y_FRAC;

  // Curved sides pinch through the waist (single quadratic per side pulled toward
  // the narrower waist point); the top edge lifts at center for sloped shoulders.
  ctx.fillStyle = outfit.topColor;
  ctx.beginPath();
  ctx.moveTo(sxc - shHalf, topY);
  ctx.quadraticCurveTo(waistX - waistHalf, waistY, hxc - hpHalf, hipY);
  ctx.lineTo(hxc + hpHalf, hipY);
  ctx.quadraticCurveTo(waistX + waistHalf, waistY, sxc + shHalf, topY);
  ctx.quadraticCurveTo(sxc, topY - s * TORSO_SHOULDER_RISE, sxc - shHalf, topY);
  ctx.closePath();
  ctx.fill();

  if (dc.facing === 'up') return; // back of the shirt: no front detailing

  // Front detailing: vests/jackets/hoodies get a center seam; others a collar dab.
  const midX = (shoulderCenter.x + hipCenter.x) / 2;
  if (outfit.top === 'jacket' || outfit.top === 'hoodie' || outfit.top === 'vest') {
    strokeSegment(
      ctx,
      { x: shoulderCenter.x, y: shoulderCenter.y },
      { x: hipCenter.x, y: hipCenter.y },
      s * 0.012,
      shade(outfit.topColor, 0.3),
    );
  }
  ctx.fillStyle = outfit.topAccent;
  ctx.fillRect(midX - s * 0.02, shoulderCenter.y + s * 0.005, s * 0.04, s * 0.03);

  // A skirt flares a colored hem over the hips.
  if (outfit.bottom === 'skirt') {
    ctx.fillStyle = outfit.bottomColor;
    ctx.beginPath();
    ctx.moveTo(hipCenter.x - hpHalf, hipCenter.y - s * 0.02);
    ctx.lineTo(hipCenter.x + hpHalf, hipCenter.y - s * 0.02);
    ctx.lineTo(hipCenter.x + hpHalf * 1.5, hipCenter.y + s * 0.09);
    ctx.lineTo(hipCenter.x - hpHalf * 1.5, hipCenter.y + s * 0.09);
    ctx.closePath();
    ctx.fill();
  }
}

function drawNeck(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app, s } = dc;
  strokeSegment(ctx, skel.shoulderCenter, skel.headCenter, NECK_WIDTH * s, app.face.skin);
}

function headPath(
  ctx: CanvasRenderingContext2D,
  c: Point,
  rx: number,
  ry: number,
  jaw: number,
): void {
  ctx.beginPath();
  ctx.moveTo(c.x - rx, c.y - ry * 0.1);
  ctx.bezierCurveTo(c.x - rx, c.y - ry * 1.25, c.x + rx, c.y - ry * 1.25, c.x + rx, c.y - ry * 0.1);
  ctx.bezierCurveTo(
    c.x + rx,
    c.y + ry * 0.55,
    c.x + rx * jaw,
    c.y + ry * 1.05,
    c.x,
    c.y + ry * 1.15,
  );
  ctx.bezierCurveTo(
    c.x - rx * jaw,
    c.y + ry * 1.05,
    c.x - rx,
    c.y + ry * 0.55,
    c.x - rx,
    c.y - ry * 0.1,
  );
  ctx.closePath();
}

function drawEar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.5, r, 0, 0, TWO_PI);
  ctx.fill();
}

function drawFrontFace(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app } = dc;
  const c = skel.headCenter;
  const rx = skel.headRadiusX;
  const ry = skel.headRadiusY;
  const face = app.face;

  drawEar(ctx, c.x - rx * 0.98, c.y + ry * 0.05, rx * 0.28 * face.earSize, face.skinShadow);
  drawEar(ctx, c.x + rx * 0.98, c.y + ry * 0.05, rx * 0.28 * face.earSize, face.skinShadow);

  headPath(ctx, c, rx, ry, app.head.jawWidth);
  ctx.fillStyle = face.skin;
  ctx.fill();

  const eyeDX = face.eyeSpacing * rx * 2;
  const eyeY = c.y - ry * 0.05;
  const eyeR = rx * 0.17 * face.eyeSize;
  drawEye(ctx, c.x - eyeDX, eyeY, eyeR, face.eyeColor);
  drawEye(ctx, c.x + eyeDX, eyeY, eyeR, face.eyeColor);

  // Brows: short bars above the eyes, tilted by browAngle (inner ends lower = frown).
  const browY = eyeY - eyeR * 1.8;
  const browW = eyeR * 1.6;
  const browH = Math.max(1, rx * 0.05 * face.browThickness);
  drawBrow(ctx, c.x - eyeDX, browY, browW, browH, face.browAngle, 1, app.hair.color);
  drawBrow(ctx, c.x + eyeDX, browY, browW, browH, face.browAngle, -1, app.hair.color);

  // Nose: a shaded ridge down the centerline with nostril dots at the base.
  const noseTop = eyeY + eyeR * 0.6;
  const noseLen = ry * 0.5 * face.noseLength;
  const noseHalf = rx * 0.12 * face.noseSize;
  ctx.strokeStyle = face.skinShadow;
  ctx.lineWidth = Math.max(1, noseHalf * 0.6);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c.x, noseTop);
  ctx.lineTo(c.x - noseHalf * 0.4, noseTop + noseLen);
  ctx.stroke();
  ctx.fillStyle = shade(face.skin, 0.35);
  ctx.beginPath();
  ctx.arc(c.x - noseHalf, noseTop + noseLen, noseHalf * 0.4, 0, TWO_PI);
  ctx.arc(c.x + noseHalf, noseTop + noseLen, noseHalf * 0.4, 0, TWO_PI);
  ctx.fill();

  // Mouth.
  const mouthY = c.y + ry * 0.62;
  const mouthHalf = rx * 0.4 * face.mouthWidth;
  ctx.strokeStyle = shade(face.skin, 0.45);
  ctx.lineWidth = Math.max(1, rx * 0.06);
  ctx.beginPath();
  ctx.moveTo(c.x - mouthHalf, mouthY);
  ctx.quadraticCurveTo(c.x, mouthY + rx * 0.08, c.x + mouthHalf, mouthY);
  ctx.stroke();

  drawFacialHair(dc, skel);
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  iris: string,
): void {
  ctx.fillStyle = '#f4f0ea';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.72, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, TWO_PI);
  ctx.fill();
}

function drawBrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfW: number,
  h: number,
  angle: number,
  innerSign: number,
  color: string,
): void {
  const innerX = x + innerSign * halfW;
  const outerX = x - innerSign * halfW;
  ctx.strokeStyle = shade(color, 0.15);
  ctx.lineWidth = h;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(innerX, y + angle * halfW);
  ctx.lineTo(outerX, y - angle * halfW * 0.4);
  ctx.stroke();
}

function drawFacialHair(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app } = dc;
  if (app.hair.facial === 'none') return;
  const c = skel.headCenter;
  const rx = skel.headRadiusX;
  const ry = skel.headRadiusY;
  const color = app.hair.color;
  const jaw = app.head.jawWidth;

  if (app.hair.facial === 'stubble') {
    ctx.fillStyle = shade(color, 0.1);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(c.x - rx * jaw, c.y + ry * 0.5);
    ctx.quadraticCurveTo(c.x, c.y + ry * 1.3, c.x + rx * jaw, c.y + ry * 0.5);
    ctx.lineTo(c.x + rx * jaw, c.y + ry * 0.85);
    ctx.quadraticCurveTo(c.x, c.y + ry * 1.25, c.x - rx * jaw, c.y + ry * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  if (app.hair.facial === 'mustache') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + ry * 0.5, rx * 0.4, ry * 0.12, 0, 0, TWO_PI);
    ctx.fill();
    return;
  }
  // Goatee / full beard: a mass hanging off the chin, beard also up the jawline.
  const wide = app.hair.facial === 'beard';
  ctx.fillStyle = color;
  ctx.beginPath();
  if (wide) {
    ctx.moveTo(c.x - rx * 0.95, c.y + ry * 0.2);
    ctx.quadraticCurveTo(c.x - rx, c.y + ry * 1.2, c.x, c.y + ry * 1.5);
    ctx.quadraticCurveTo(c.x + rx, c.y + ry * 1.2, c.x + rx * 0.95, c.y + ry * 0.2);
    ctx.quadraticCurveTo(c.x, c.y + ry * 0.95, c.x - rx * 0.95, c.y + ry * 0.2);
  } else {
    ctx.moveTo(c.x - rx * 0.35, c.y + ry * 0.7);
    ctx.quadraticCurveTo(c.x, c.y + ry * 1.45, c.x + rx * 0.35, c.y + ry * 0.7);
    ctx.quadraticCurveTo(c.x, c.y + ry * 1.0, c.x - rx * 0.35, c.y + ry * 0.7);
  }
  ctx.closePath();
  ctx.fill();
}

/** Cranium-hugging cap most styles share; `coverage` sets how far down the sides it wraps. */
function drawHairCap(
  ctx: CanvasRenderingContext2D,
  c: Point,
  rx: number,
  ry: number,
  color: string,
  coverage: number,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(c.x - rx * 1.02, c.y + ry * coverage);
  ctx.bezierCurveTo(
    c.x - rx * 1.1,
    c.y - ry * 1.4,
    c.x + rx * 1.1,
    c.y - ry * 1.4,
    c.x + rx * 1.02,
    c.y + ry * coverage,
  );
  ctx.bezierCurveTo(
    c.x + rx * 0.7,
    c.y - ry * 0.2,
    c.x - rx * 0.7,
    c.y - ry * 0.2,
    c.x - rx * 1.02,
    c.y + ry * coverage,
  );
  ctx.closePath();
  ctx.fill();
}

function drawHair(dc: DrawContext, skel: Skeleton, isBack: boolean): void {
  const { ctx, app } = dc;
  const style = app.hair.style;
  if (style === 'bald') return;
  const c = skel.headCenter;
  const rx = skel.headRadiusX;
  const ry = skel.headRadiusY;
  const color = app.hair.color;

  // Long hair, afro, ponytail and buns read from the back, so paint their bulk
  // first (behind the head) when facing away or drawing the back layer.
  if (isBack) {
    drawBackHairMass(ctx, c, rx, ry, color, style);
  }

  switch (style) {
    case 'buzz':
      drawHairCap(ctx, c, rx, ry, shade(color, 0.1), 0.05);
      break;
    case 'short':
      drawHairCap(ctx, c, rx, ry, color, 0.15);
      break;
    case 'side_part':
      drawHairCap(ctx, c, rx, ry, color, 0.2);
      strokeSegment(
        ctx,
        { x: c.x - rx * 0.3, y: c.y - ry * 1.1 },
        { x: c.x - rx * 0.15, y: c.y - ry * 0.2 },
        rx * 0.06,
        shade(color, 0.35),
      );
      break;
    case 'messy':
      drawHairCap(ctx, c, rx, ry, color, 0.2);
      for (let i = -2; i <= 2; i += 1) {
        const tx = c.x + i * rx * 0.35;
        strokeSegment(
          ctx,
          { x: tx, y: c.y - ry * 1.0 },
          { x: tx + rx * 0.12, y: c.y - ry * 1.45 },
          rx * 0.09,
          color,
        );
      }
      break;
    case 'long':
      drawHairCap(ctx, c, rx, ry, color, 0.9);
      break;
    case 'afro':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y - ry * 0.35, rx * 1.5, 0, TWO_PI);
      ctx.fill();
      // Re-expose the face after the big blob (front only).
      if (!isBack && dc.facing !== 'up') {
        headPath(ctx, c, rx, ry, app.head.jawWidth);
        ctx.fillStyle = app.face.skin;
        ctx.fill();
      }
      break;
    case 'mohawk':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(c.x - rx * 0.16, c.y - ry * 0.2);
      ctx.lineTo(c.x - rx * 0.16, c.y - ry * 1.7);
      ctx.lineTo(c.x + rx * 0.16, c.y - ry * 1.7);
      ctx.lineTo(c.x + rx * 0.16, c.y - ry * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ponytail':
    case 'bun':
      drawHairCap(ctx, c, rx, ry, color, 0.15);
      break;
  }
}

function drawBackHairMass(
  ctx: CanvasRenderingContext2D,
  c: Point,
  rx: number,
  ry: number,
  color: string,
  style: string,
): void {
  ctx.fillStyle = color;
  if (style === 'long') {
    ctx.beginPath();
    ctx.moveTo(c.x - rx * 1.05, c.y - ry * 0.5);
    ctx.lineTo(c.x - rx * 0.95, c.y + ry * 2.4);
    ctx.lineTo(c.x + rx * 0.95, c.y + ry * 2.4);
    ctx.lineTo(c.x + rx * 1.05, c.y - ry * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (style === 'ponytail') {
    ctx.beginPath();
    ctx.moveTo(c.x - rx * 0.22, c.y - ry * 0.6);
    ctx.quadraticCurveTo(c.x - rx * 0.5, c.y + ry * 1.6, c.x - rx * 0.1, c.y + ry * 2.4);
    ctx.quadraticCurveTo(c.x + rx * 0.35, c.y + ry * 1.4, c.x + rx * 0.22, c.y - ry * 0.6);
    ctx.closePath();
    ctx.fill();
  } else if (style === 'bun') {
    ctx.beginPath();
    ctx.arc(c.x, c.y - ry * 1.35, rx * 0.5, 0, TWO_PI);
    ctx.fill();
  }
}

function drawHat(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app } = dc;
  const hat = app.outfit.hat;
  if (hat === 'none') return;
  const c = skel.headCenter;
  const rx = skel.headRadiusX;
  const ry = skel.headRadiusY;
  const color = app.outfit.hatColor;
  const brimForward = dc.facing === 'up' ? -1 : 1;

  ctx.fillStyle = color;
  if (hat === 'beanie') {
    ctx.beginPath();
    ctx.arc(c.x, c.y - ry * 0.55, rx * 1.05, Math.PI, TWO_PI);
    ctx.fill();
    ctx.fillStyle = tint(color, 0.2);
    ctx.fillRect(c.x - rx * 1.05, c.y - ry * 0.55, rx * 2.1, ry * 0.35);
    return;
  }
  // Cap / brimmed: a rounded crown plus a brim.
  ctx.beginPath();
  ctx.arc(c.x, c.y - ry * 0.6, rx * 1.0, Math.PI, TWO_PI);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.2);
  if (hat === 'cap') {
    ctx.beginPath();
    ctx.ellipse(c.x + brimForward * rx * 0.8, c.y - ry * 0.55, rx * 0.9, ry * 0.18, 0, 0, TWO_PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - ry * 0.5, rx * 1.6, ry * 0.28, 0, 0, TWO_PI);
    ctx.fill();
  }
}

function drawProfileHead(dc: DrawContext, skel: Skeleton): void {
  const { ctx, app } = dc;
  const c = skel.headCenter;
  const rx = skel.headRadiusX;
  const ry = skel.headRadiusY;
  const face = app.face;

  ctx.fillStyle = face.skin;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  // Nose bump protruding toward the camera-facing side (+x; mirrored for left).
  const noseHalf = rx * 0.14 * face.noseSize;
  ctx.fillStyle = face.skin;
  ctx.beginPath();
  ctx.moveTo(c.x + rx * 0.85, c.y - ry * 0.1);
  ctx.lineTo(c.x + rx + noseHalf * 3, c.y + ry * 0.15 * face.noseLength);
  ctx.lineTo(c.x + rx * 0.8, c.y + ry * 0.35);
  ctx.closePath();
  ctx.fill();

  const eyeR = rx * 0.16 * face.eyeSize;
  drawEye(ctx, c.x + rx * 0.4, c.y - ry * 0.05, eyeR, face.eyeColor);

  ctx.strokeStyle = shade(face.skin, 0.45);
  ctx.lineWidth = Math.max(1, rx * 0.06);
  ctx.beginPath();
  ctx.moveTo(c.x + rx * 0.35, c.y + ry * 0.6);
  ctx.lineTo(c.x + rx * 0.7, c.y + ry * 0.6);
  ctx.stroke();

  drawEar(ctx, c.x - rx * 0.5, c.y, rx * 0.3 * face.earSize, face.skinShadow);
  drawFacialHair(dc, skel);
  drawHair(dc, skel, false);
  drawHat(dc, skel);
}

function drawHead(dc: DrawContext, skel: Skeleton): void {
  if (dc.facing === 'left' || dc.facing === 'right') {
    drawProfileHead(dc, skel);
    return;
  }
  if (dc.facing === 'up') {
    // Back of the head: skin dome, then hair over it, no face.
    const c = skel.headCenter;
    dc.ctx.fillStyle = dc.app.face.skin;
    headPath(dc.ctx, c, skel.headRadiusX, skel.headRadiusY, dc.app.head.jawWidth);
    dc.ctx.fill();
    drawHair(dc, skel, true);
    drawHat(dc, skel);
    return;
  }
  drawFrontFace(dc, skel);
  drawHair(dc, skel, false);
  drawHat(dc, skel);
}

/**
 * Draws a full person at (sx, sy) sized `size` px, facing `facing`, at
 * animation `phase`. Set `moving` true to play the walk cycle, false to idle.
 */
export function drawPerson(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  size: number,
  appearance: PersonAppearance,
  phase: number,
  facing: Facing,
  moving: boolean,
): void {
  ctx.save();
  const cx = sx + size / 2;
  if (facing === 'left') {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  const drawFacing: Facing = facing === 'left' ? 'right' : facing;

  const pose = poseForMotion(appearance, drawFacing, phase, moving);
  const skel = buildSkeleton(appearance, pose, drawFacing, cx, sy, size);
  const dc: DrawContext = { ctx, app: appearance, s: size, facing: drawFacing };

  drawArm(dc, skel.farArm);
  drawLeg(dc, skel.farLeg);
  drawNeck(dc, skel);
  drawTorso(dc, skel);
  drawLeg(dc, skel.nearLeg);
  drawArm(dc, skel.nearArm);
  drawHead(dc, skel);

  ctx.restore();
}
