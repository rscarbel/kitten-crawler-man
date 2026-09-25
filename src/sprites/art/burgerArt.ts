/**
 * A hamburger lying on the ground, in the game's 3/4 view: bottom bun, patty,
 * a cheese slice with drips, a lettuce frill and a sesame-topped dome, stacked
 * as short cylinders so the top of the bun is seen from above and the layers
 * from the side.
 *
 * It is drawn at under half a tile, where a layer is two or three pixels tall,
 * so the read comes from the colour bands and their order — tan, brown,
 * yellow, green, tan — rather than from detail. Everything is a fraction of
 * the cell it is painted into, and the palette is the bag icon's own.
 *
 * {@link groundBurgerSprite} bakes it once; {@link paintBurgerInCell} is the
 * painter the bake and the art gate share.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { HAMBURGER_PALETTE as PALETTE } from '../../ui/icons/foodIcons';

const FULL_CIRCLE = Math.PI * 2;
const HALF = 0.5;

/** Half the burger's width, as a fraction of its cell. */
const HALF_WIDTH = 0.42;
/** The burger's full width as a fraction of its cell, for sizing the cell to a wanted width. */
export const BURGER_WIDTH_OF_CELL = HALF_WIDTH * 2;
/** How flat the 3/4 view squashes a round layer seen from above. */
const TOP_ELLIPSE_RATIO = 0.34;

/**
 * The burger's lowest point — the front of the bottom bun's rim — as a
 * fraction down the cell. It is where a caller stands the burger on the ground.
 */
export const BURGER_BASE_Y = 0.92;
const BOTTOM_BUN_HEIGHT = 0.13;
const PATTY_HEIGHT = 0.1;
const CHEESE_HEIGHT = 0.07;
const LETTUCE_HEIGHT = 0.04;
/** The top bun's dome rises this far above its rim. */
const DOME_HEIGHT = 0.3;

/** Each filling's half-width relative to the bun's, so each layer's edge peeks out. */
const PATTY_WIDTH_SCALE = 1.04;
const CHEESE_WIDTH_SCALE = 1.0;
const LETTUCE_WIDTH_SCALE = 1.06;
const BOTTOM_BUN_WIDTH_SCALE = 0.96;

const CHEESE_DRIPS = 3;
/** How far a drip hangs below the cheese, as a fraction of the cell. */
const CHEESE_DRIP_DEPTH = 0.08;
/** Each drip's half-width as a fraction of the cell. */
const CHEESE_DRIP_HALF_WIDTH = 0.055;
/** The drips sit on the front arc, spread across this fraction of the half-width. */
const CHEESE_DRIP_SPREAD = 0.62;

const LETTUCE_FRILLS = 7;
/** How far each lettuce frill scallop droops, as a fraction of the cell. */
const LETTUCE_FRILL_DEPTH = 0.035;

/** The dome's highlight: a soft lit patch up and left, where the light comes from. */
const HIGHLIGHT_X = -0.14;
const HIGHLIGHT_Y = -0.15;
const HIGHLIGHT_RX = 0.12;
const HIGHLIGHT_RY = 0.06;
const HIGHLIGHT_COLOR = 'rgba(255, 236, 190, 0.55)';

/** Sesame seeds as offsets from the dome's centre, in cell fractions. */
const SESAME_SEEDS: ReadonlyArray<readonly [number, number]> = [
  [-0.18, -0.12],
  [-0.02, -0.2],
  [0.14, -0.13],
  [0.05, -0.06],
  [-0.1, -0.03],
  [0.22, -0.04],
];
const SESAME_RX = 0.03;
const SESAME_RY = 0.018;

const OUTLINE_WIDTH_FRACTION = 0.035;
const MIN_OUTLINE_WIDTH = 1;

/**
 * One layer of the stack: a short upright cylinder whose side shows from
 * `top` down to `bottom` and whose rim curves toward the viewer.
 */
function drawPuck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  halfWidth: number,
  fill: string,
  outline: string,
  lineWidth: number,
): void {
  const ry = halfWidth * TOP_ELLIPSE_RATIO;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, top);
  ctx.lineTo(cx - halfWidth, bottom);
  ctx.ellipse(cx, bottom, halfWidth, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + halfWidth, top);
  ctx.ellipse(cx, top, halfWidth, ry, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * Paints the ground burger into the `size`-pixel square at `x`,`y`. Clipped to
 * that square, so nothing it draws can land in a neighbour's cell.
 */
export function paintBurgerInCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  const cx = x + size * HALF;
  const bunHalf = size * HALF_WIDTH;
  const lineWidth = Math.max(MIN_OUTLINE_WIDTH, size * OUTLINE_WIDTH_FRACTION);

  const bottomBunHalf = bunHalf * BOTTOM_BUN_WIDTH_SCALE;
  // The side band ends where the rim's front arc begins, one rim-radius above the ground point.
  const bunBottom = y + size * BURGER_BASE_Y - bottomBunHalf * TOP_ELLIPSE_RATIO;
  const bunTop = bunBottom - size * BOTTOM_BUN_HEIGHT;
  const pattyTop = bunTop - size * PATTY_HEIGHT;
  const cheeseTop = pattyTop - size * CHEESE_HEIGHT;
  const lettuceTop = cheeseTop - size * LETTUCE_HEIGHT;

  drawPuck(ctx, cx, bunTop, bunBottom, bottomBunHalf, PALETTE.bunShade, PALETTE.outline, lineWidth);
  drawPuck(
    ctx,
    cx,
    pattyTop,
    bunTop,
    bunHalf * PATTY_WIDTH_SCALE,
    PALETTE.patty,
    PALETTE.pattyShade,
    lineWidth,
  );
  drawCheese(ctx, cx, cheeseTop, pattyTop, bunHalf * CHEESE_WIDTH_SCALE, size, lineWidth);
  drawLettuce(ctx, cx, lettuceTop, cheeseTop, bunHalf * LETTUCE_WIDTH_SCALE, size, lineWidth);
  drawDome(ctx, cx, lettuceTop, bunHalf, size, lineWidth);

  ctx.restore();
}

function drawCheese(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  halfWidth: number,
  size: number,
  lineWidth: number,
): void {
  drawPuck(ctx, cx, top, bottom, halfWidth, PALETTE.cheese, PALETTE.cheeseShade, lineWidth);
  const rimRy = halfWidth * TOP_ELLIPSE_RATIO;
  const dripHalf = size * CHEESE_DRIP_HALF_WIDTH;
  const dripDepth = size * CHEESE_DRIP_DEPTH;
  ctx.fillStyle = PALETTE.cheese;
  for (let drip = 0; drip < CHEESE_DRIPS; drip++) {
    // -1 at the left drip to +1 at the right.
    const spreadT = (drip / (CHEESE_DRIPS - 1)) * 2 - 1;
    const dx = spreadT * halfWidth * CHEESE_DRIP_SPREAD;
    // Rides the rim's front arc so each drip hangs from the edge nearest the viewer.
    const rimY = bottom + rimRy * Math.sqrt(Math.max(0, 1 - (dx / halfWidth) ** 2));
    ctx.beginPath();
    ctx.moveTo(cx + dx - dripHalf, rimY - dripHalf);
    ctx.lineTo(cx + dx + dripHalf, rimY - dripHalf);
    ctx.lineTo(cx + dx, rimY + dripDepth);
    ctx.closePath();
    ctx.fill();
  }
}

function drawLettuce(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  halfWidth: number,
  size: number,
  lineWidth: number,
): void {
  drawPuck(ctx, cx, top, bottom, halfWidth, PALETTE.lettuce, PALETTE.lettuceShade, lineWidth);
  // Scallops along the front rim, so the band reads as a frilled leaf rather
  // than a green ring.
  const rimRy = halfWidth * TOP_ELLIPSE_RATIO;
  const frillDepth = size * LETTUCE_FRILL_DEPTH;
  const frillRadius = halfWidth / LETTUCE_FRILLS;
  ctx.fillStyle = PALETTE.lettuce;
  for (let frill = 0; frill < LETTUCE_FRILLS; frill++) {
    const dx = -halfWidth + frillRadius * (frill * 2 + 1);
    const rimY = bottom + rimRy * Math.sqrt(Math.max(0, 1 - (dx / halfWidth) ** 2));
    ctx.beginPath();
    ctx.ellipse(cx + dx, rimY, frillRadius, frillDepth, 0, 0, Math.PI);
    ctx.fill();
  }
}

function traceDome(
  ctx: CanvasRenderingContext2D,
  cx: number,
  rim: number,
  halfWidth: number,
  domeTop: number,
): void {
  const rimRy = halfWidth * TOP_ELLIPSE_RATIO;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, rim);
  ctx.ellipse(cx, rim, halfWidth, rimRy, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(cx + halfWidth, domeTop, cx - halfWidth, domeTop, cx - halfWidth, rim);
  ctx.closePath();
}

function drawDome(
  ctx: CanvasRenderingContext2D,
  cx: number,
  rim: number,
  halfWidth: number,
  size: number,
  lineWidth: number,
): void {
  const domeTop = rim - size * DOME_HEIGHT;
  traceDome(ctx, cx, rim, halfWidth, domeTop);
  ctx.fillStyle = PALETTE.bun;
  ctx.fill();

  // Seeds and the highlight stay on the bun: a lit patch spilling past the
  // dome's edge reads as a stray pixel at the size this is shown.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = HIGHLIGHT_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    cx + size * HIGHLIGHT_X,
    rim + size * HIGHLIGHT_Y,
    size * HIGHLIGHT_RX,
    size * HIGHLIGHT_RY,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
  ctx.fillStyle = PALETTE.sesame;
  for (const [fx, fy] of SESAME_SEEDS) {
    ctx.beginPath();
    ctx.ellipse(
      cx + size * fx,
      rim + size * fy,
      size * SESAME_RX,
      size * SESAME_RY,
      0,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
  ctx.restore();

  traceDome(ctx, cx, rim, halfWidth, domeTop);
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * The resolution the ground burger is baked at: four times the size it is
 * drawn, so the downscale averages its layers into clean bands instead of
 * dropping whole rows of them.
 */
export const GROUND_BURGER_BAKE_PX = 64;

let bakedBurger: CanvasSurface | null = null;

/** The ground burger, baked once at {@link GROUND_BURGER_BAKE_PX} and reused. */
export function groundBurgerSprite(): CanvasSurface {
  if (bakedBurger !== null) return bakedBurger;
  const surface = allocCanvas(GROUND_BURGER_BAKE_PX, GROUND_BURGER_BAKE_PX);
  paintBurgerInCell(surfaceContext(surface), 0, 0, GROUND_BURGER_BAKE_PX);
  bakedBurger = surface;
  return surface;
}
