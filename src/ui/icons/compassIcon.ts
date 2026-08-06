/**
 * The Journal's compass rose — the HUD button that opens the Quest Journal.
 *
 * Baked once into an offscreen texture rather than stroked every frame. The
 * emblem is a dozen fills and strokes and it never changes, so paying for it on
 * each of sixty frames a second buys nothing; a single `drawImage` does.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';

/**
 * Texture resolution. Comfortably above the ~28px the button draws it at, so
 * the blit is always a downscale — an upscaled emblem would soften exactly the
 * needle tips that make it read as a compass.
 */
const COMPASS_TEXTURE_PX = 96;

// Geometry as fractions of the texture square.
const DIAL_RADIUS = 0.44;
const RIM_WIDTH = 0.06;
const INNER_RING_RADIUS = 0.36;
const INNER_RING_WIDTH = 0.02;
const NEEDLE_LENGTH = 0.34;
const NEEDLE_HALF_WIDTH = 0.09;
const MINOR_NEEDLE_SCALE = 0.62;
const HUB_RADIUS = 0.05;

const DIAL_FILL = '#0b2545';
const DIAL_EDGE_FILL = '#123a6b';
const RIM_COLOR = '#38bdf8';
const INNER_RING_COLOR = '#1d4ed8';
const NEEDLE_NORTH = '#e0f2fe';
const NEEDLE_SOUTH = '#2563eb';
const NEEDLE_MINOR = '#60a5fa';
const HUB_COLOR = '#bae6fd';

/** Quarter turns, so the four cardinal needles are one loop rather than four. */
const QUARTER_TURN = Math.PI / 2;
const CARDINAL_COUNT = 4;

let texture: CanvasSurface | null = null;

/**
 * One arm of the rose: a kite from the hub out to the tip, drawn in the
 * canvas's current rotation so the caller decides which way it points.
 */
function drawNeedle(
  ctx: CanvasRenderingContext2D,
  size: number,
  length: number,
  halfWidth: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * length);
  ctx.lineTo(-size * halfWidth, 0);
  ctx.lineTo(size * halfWidth, 0);
  ctx.closePath();
  ctx.fill();
}

function bake(): CanvasSurface {
  const size = COMPASS_TEXTURE_PX;
  const surface = allocCanvas(size, size);
  const ctx = surfaceContext(surface);
  const centre = size / 2;
  const radius = size * DIAL_RADIUS;

  ctx.translate(centre, centre);

  ctx.fillStyle = DIAL_EDGE_FILL;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = DIAL_FILL;
  ctx.beginPath();
  ctx.arc(0, 0, radius - size * RIM_WIDTH, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = RIM_COLOR;
  ctx.lineWidth = size * RIM_WIDTH;
  ctx.beginPath();
  ctx.arc(0, 0, radius - (size * RIM_WIDTH) / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = INNER_RING_COLOR;
  ctx.lineWidth = size * INNER_RING_WIDTH;
  ctx.beginPath();
  ctx.arc(0, 0, size * INNER_RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // The diagonals first, so the cardinal rose sits on top of them.
  for (let i = 0; i < CARDINAL_COUNT; i++) {
    ctx.save();
    ctx.rotate(i * QUARTER_TURN + QUARTER_TURN / 2);
    drawNeedle(
      ctx,
      size,
      NEEDLE_LENGTH * MINOR_NEEDLE_SCALE,
      NEEDLE_HALF_WIDTH * MINOR_NEEDLE_SCALE,
      NEEDLE_MINOR,
    );
    ctx.restore();
  }

  for (let i = 0; i < CARDINAL_COUNT; i++) {
    ctx.save();
    ctx.rotate(i * QUARTER_TURN);
    // Only the north arm is pale: a rose lit evenly on all four points has no
    // "up", which is the one thing a compass has to say at button size.
    drawNeedle(ctx, size, NEEDLE_LENGTH, NEEDLE_HALF_WIDTH, i === 0 ? NEEDLE_NORTH : NEEDLE_SOUTH);
    ctx.restore();
  }

  ctx.fillStyle = HUB_COLOR;
  ctx.beginPath();
  ctx.arc(0, 0, size * HUB_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  return surface;
}

/** Draws the compass rose into a square region of the screen. */
export function drawCompassIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  texture ??= bake();
  ctx.drawImage(texture, x, y, size, size);
}
