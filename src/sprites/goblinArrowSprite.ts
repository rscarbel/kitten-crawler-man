/**
 * The goblin archer's arrow, in flight and where it lands.
 *
 * Drawn at runtime rather than baked, and deliberately: a sheet for a shape this
 * small buys nothing a few lines of canvas cannot, and every sheet in this game
 * is preloaded at boot against a renderer footprint that is already the largest
 * thing about it. A rotating shaft is also the one case where a baked frame is
 * *worse* — it would either need a frame per heading or the same rotation
 * transform this does anyway.
 */

/** Overall length of the shaft, as a fraction of a tile. */
const SHAFT_LENGTH_TILES = 0.62;
const SHAFT_HALF_WIDTH_TILES = 0.028;
/** Iron head, measured back from the point. */
const HEAD_LENGTH_TILES = 0.15;
const HEAD_HALF_WIDTH_TILES = 0.055;
/** Fletching, measured forward from the nock. */
const FLETCH_LENGTH_TILES = 0.17;
const FLETCH_HALF_WIDTH_TILES = 0.07;
/** Where along the fletching its widest point sits, 0 at the nock and 1 at the tip. */
const FLETCH_BARB_FRACTION = 0.55;

const SHAFT_WOOD = '#7a5c39';
const SHAFT_SHADOW = '#43301d';
const HEAD_IRON = '#8b96a0';
const HEAD_EDGE = '#c3ccd4';
const FLETCH_LIGHT = '#6d4f31';
const FLETCH_DARK = '#3a2a1b';
const ARROW_OUTLINE = '#14110e';
const OUTLINE_GROWTH_TILES = 0.016;

/** How long a spent arrow lies on the ground before it fades out, in frames. */
export const SPENT_ARROW_FRAMES = 90;
/** Frames of that life spent fading, so it never simply blinks out. */
export const SPENT_ARROW_FADE_FRAMES = 30;

/**
 * Draws one arrow centred on (sx, sy), pointing along `headingRad`.
 *
 * @param alpha Fades a spent shaft out where it landed. 1 in flight.
 */
export function drawGoblinArrow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  headingRad: number,
  alpha = 1,
): void {
  const halfLength = (SHAFT_LENGTH_TILES * tileSize) / 2;
  const shaftHalfWidth = SHAFT_HALF_WIDTH_TILES * tileSize;
  const headLength = HEAD_LENGTH_TILES * tileSize;
  const headHalfWidth = HEAD_HALF_WIDTH_TILES * tileSize;
  const fletchLength = FLETCH_LENGTH_TILES * tileSize;
  const fletchHalfWidth = FLETCH_HALF_WIDTH_TILES * tileSize;
  const outline = OUTLINE_GROWTH_TILES * tileSize;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.rotate(headingRad);

  // Outline first and as one shape behind everything: at a 32-px tile the shaft
  // is two pixels, and without a dark edge it vanishes against any floor lighter
  // than the wood.
  ctx.fillStyle = ARROW_OUTLINE;
  ctx.fillRect(
    -halfLength - outline,
    -shaftHalfWidth - outline,
    halfLength * 2 + outline * 2,
    shaftHalfWidth * 2 + outline * 2,
  );
  ctx.fillStyle = SHAFT_WOOD;
  ctx.fillRect(-halfLength, -shaftHalfWidth, halfLength * 2, shaftHalfWidth * 2);
  ctx.fillStyle = SHAFT_SHADOW;
  ctx.fillRect(-halfLength, 0, halfLength * 2, shaftHalfWidth);

  const traceHead = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(halfLength + grow, 0);
    ctx.lineTo(halfLength - headLength, -headHalfWidth - grow);
    ctx.lineTo(halfLength - headLength, headHalfWidth + grow);
    ctx.closePath();
  };
  ctx.fillStyle = ARROW_OUTLINE;
  traceHead(outline);
  ctx.fill();
  ctx.fillStyle = HEAD_IRON;
  traceHead(0);
  ctx.fill();
  // A lit upper facet, so the head is a wedge rather than a grey triangle.
  ctx.fillStyle = HEAD_EDGE;
  ctx.beginPath();
  ctx.moveTo(halfLength, 0);
  ctx.lineTo(halfLength - headLength, -headHalfWidth);
  ctx.lineTo(halfLength - headLength, -headHalfWidth / 2);
  ctx.closePath();
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.fillStyle = ARROW_OUTLINE;
    ctx.beginPath();
    ctx.moveTo(-halfLength - outline, 0);
    ctx.lineTo(
      -halfLength + fletchLength * FLETCH_BARB_FRACTION,
      side * (fletchHalfWidth + outline),
    );
    ctx.lineTo(-halfLength + fletchLength, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = side < 0 ? FLETCH_LIGHT : FLETCH_DARK;
    ctx.beginPath();
    ctx.moveTo(-halfLength, 0);
    ctx.lineTo(-halfLength + fletchLength * FLETCH_BARB_FRACTION, side * fletchHalfWidth);
    ctx.lineTo(-halfLength + fletchLength - outline, 0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
