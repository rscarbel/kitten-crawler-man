/**
 * The Eyes of Splatter as Donut wears them: round pink-lensed sunglasses
 * painted onto her head in each viewpoint.
 *
 * Coordinates are her head's own units, as `catArt.ts` paints the head: the
 * caller has already moved the origin to the head and applied its tilt and
 * turn, so the glasses ride every pose the head does.
 *
 * At her in-game size a lens is three or four screen pixels across, so the
 * rim is drawn heavy and the lens colour flat and saturated: anything subtler
 * disappears into her coat.
 */

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const FRAME_INK = '#1d0e21';
const LENS_LIGHT = '#ff9ccb';
const LENS_PINK = '#ec5fa4';
const LENS_DEEP = '#a12a66';
const GLINT_WHITE = '#ffffff';

/** Bigger than her eye, so the rim sits on the fur around it rather than on the eye itself. */
const LENS_RADIUS = 0.088;
const RIM_WIDTH = 0.024;
const TEMPLE_WIDTH = 0.02;
/** How far the bridge rises above the lens centres, as a share of a lens radius. */
const BRIDGE_RISE = 0.55;
/** Where the bridge leaves each rim, as a share of a lens radius in from the inner edge. */
const BRIDGE_INSET = 0.25;
/** The lit band covers the upper-left of a lens, the shaded band the lower-right. */
const LENS_LIGHT_UNTIL = 0.28;
const LENS_MID_UNTIL = 0.72;
const BAND_FEATHER = 0.02;

const GLINT_OFFSET = 0.38;
const GLINT_LENGTH = 0.5;
const GLINT_WAIST = 0.18;
const GLINT_ARMS = 4;
const GLINT_DOT_OFFSET = 0.42;
const GLINT_DOT_RADIUS = 0.12;

/** In profile the near lens is seen edge-on, so it narrows to this share of its width. */
const PROFILE_LENS_SQUASH = 0.5;
/** Tilts the profile lens back with the slope of her brow. */
const PROFILE_LENS_TILT = -0.18;

/** From behind, the temple arms show as short strokes where they hook over her ears. */
const BACK_ARM_LENGTH = 0.07;
const BACK_ARM_RISE = 0.025;
/** The sliver of each lens seen past her cheek from behind: outboard of the skull, edge-on. */
const BACK_LENS_PEEK = 0.02;
const BACK_LENS_DROP = 0.02;
const BACK_LENS_SQUASH = 0.3;

/** A lens's fill: hard bands from lit upper-left to shaded lower-right. */
function lensFill(ctx: Ctx, cx: number, cy: number, r: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gradient.addColorStop(0, LENS_LIGHT);
  gradient.addColorStop(LENS_LIGHT_UNTIL - BAND_FEATHER, LENS_LIGHT);
  gradient.addColorStop(LENS_LIGHT_UNTIL + BAND_FEATHER, LENS_PINK);
  gradient.addColorStop(LENS_MID_UNTIL - BAND_FEATHER, LENS_PINK);
  gradient.addColorStop(LENS_MID_UNTIL + BAND_FEATHER, LENS_DEEP);
  gradient.addColorStop(1, LENS_DEEP);
  return gradient;
}

function strokeArm(ctx: Ctx, fromX: number, fromY: number, toX: number, toY: number): void {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.strokeStyle = FRAME_INK;
  ctx.lineWidth = TEMPLE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintLens(ctx: Ctx, cx: number, cy: number, squash: number, tilt: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, LENS_RADIUS * squash, LENS_RADIUS, 0, 0, FULL_TURN);
  ctx.strokeStyle = FRAME_INK;
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  ctx.fillStyle = lensFill(ctx, 0, 0, LENS_RADIUS);
  ctx.fill();
  ctx.restore();
}

/** The small four-point sparkle that says glass, high on the lens toward the light. */
function paintGlint(ctx: Ctx, cx: number, cy: number): void {
  const x = cx - LENS_RADIUS * GLINT_OFFSET;
  const y = cy - LENS_RADIUS * GLINT_OFFSET;
  const reach = LENS_RADIUS * GLINT_LENGTH;
  ctx.beginPath();
  for (let arm = 0; arm < GLINT_ARMS * 2; arm++) {
    const angle = (arm / (GLINT_ARMS * 2)) * FULL_TURN;
    const r = arm % 2 === 0 ? reach : reach * GLINT_WAIST;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (arm === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = GLINT_WHITE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    cx + LENS_RADIUS * GLINT_DOT_OFFSET,
    cy + LENS_RADIUS * GLINT_DOT_OFFSET,
    LENS_RADIUS * GLINT_DOT_RADIUS,
    0,
    FULL_TURN,
  );
  ctx.fill();
}

/**
 * Face-on: both lenses over her eyes, the bridge across her brow, and the
 * temple arms running back to where her ears meet her skull.
 *
 * @param templeX how far out to either side the arms reach.
 * @param templeY the height they reach it at, above the lens centres.
 */
export function drawShadesFront(
  ctx: Ctx,
  leftEyeX: number,
  rightEyeX: number,
  eyeY: number,
  templeX: number,
  templeY: number,
): void {
  const centreX = (leftEyeX + rightEyeX) / 2;
  strokeArm(ctx, leftEyeX - LENS_RADIUS, eyeY, centreX - templeX, templeY);
  strokeArm(ctx, rightEyeX + LENS_RADIUS, eyeY, centreX + templeX, templeY);

  const bridgeLeft = leftEyeX + LENS_RADIUS * (1 - BRIDGE_INSET);
  const bridgeRight = rightEyeX - LENS_RADIUS * (1 - BRIDGE_INSET);
  const bridgeY = eyeY - LENS_RADIUS * BRIDGE_INSET;
  ctx.beginPath();
  ctx.moveTo(bridgeLeft, bridgeY);
  ctx.quadraticCurveTo(centreX, eyeY - LENS_RADIUS * BRIDGE_RISE * 2, bridgeRight, bridgeY);
  ctx.strokeStyle = FRAME_INK;
  ctx.lineWidth = TEMPLE_WIDTH;
  ctx.stroke();

  paintLens(ctx, leftEyeX, eyeY, 1, 0);
  paintLens(ctx, rightEyeX, eyeY, 1, 0);
  paintGlint(ctx, leftEyeX, eyeY);
}

/**
 * From behind: the arms where they hook over her ears, and the outer rim of
 * each lens peeking past her cheeks. The arms alone are black on a black-backed
 * cat and vanish; the pink edges are what say she still has them on.
 *
 * @param sideX how far out the arms show on either side of her skull.
 */
export function drawShadesBack(ctx: Ctx, centreX: number, sideX: number, armY: number): void {
  for (const side of [-1, 1]) {
    const outerX = centreX + side * sideX;
    paintLens(ctx, outerX + side * BACK_LENS_PEEK, armY + BACK_LENS_DROP, BACK_LENS_SQUASH, 0);
    strokeArm(ctx, outerX, armY, outerX - side * BACK_ARM_LENGTH, armY - BACK_ARM_RISE);
  }
}

/** In profile: the near lens over her eye, edge-on, and its arm back to her ear. */
export function drawShadesSide(
  ctx: Ctx,
  eyeX: number,
  eyeY: number,
  earX: number,
  earY: number,
): void {
  strokeArm(ctx, eyeX, eyeY - LENS_RADIUS * BRIDGE_INSET, earX, earY);
  paintLens(ctx, eyeX, eyeY, PROFILE_LENS_SQUASH, PROFILE_LENS_TILT);
  paintGlint(ctx, eyeX, eyeY);
}
