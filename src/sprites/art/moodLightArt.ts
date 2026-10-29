/**
 * The fixtures a boss room's mood lights hang from, painted live: a bare bulb
 * on a cord, a fluorescent strip on a wall face.
 *
 * Only each fixture's own emitter is painted bright; the light it throws on
 * the room is the lighting pass's glow, so the art and the pool agree.
 */

import { drawRadialGlow, type GlowStop } from '../radialGlow';

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

// ── Hanging bulb ────────────────────────────────────────────────────────────

/** How much cord shows above the bulb; it runs up out of the light into the dark of the ceiling. */
const BULB_CORD_PX = 44;
const BULB_CORD_WIDTH_PX = 1;
const BULB_CORD_COLOUR = 'rgba(28,22,18,0.95)';
/** The cord fades out at the top rather than ending on a cut. */
const BULB_CORD_FADE_COLOUR = 'rgba(28,22,18,0)';
const BULB_SOCKET_W_PX = 4;
const BULB_SOCKET_H_PX = 3;
const BULB_SOCKET_COLOUR = '#3b3530';
const BULB_SOCKET_LIT_COLOUR = '#6e655c';
const BULB_RADIUS_X_PX = 2.6;
const BULB_RADIUS_Y_PX = 3.2;
const BULB_GLASS_COLOUR = '#ffe6b0';
const BULB_CORE_RADIUS_PX = 1.3;
const BULB_CORE_COLOUR = '#fffaf0';
const BULB_HALO_RADIUS_PX = 11;
const BULB_HALO_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,230,170,0.55)' },
  { offset: 0.4, color: 'rgba(255,200,120,0.18)' },
  { offset: 1, color: 'rgba(255,180,90,0)' },
];

/**
 * A bare bulb hanging on its cord, its glass centred at `(x, y)` in screen
 * pixels. The cord rises straight up and fades out.
 */
export function drawHangingBulb(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  const socketTop = y - BULB_RADIUS_Y_PX - BULB_SOCKET_H_PX;
  const cordTop = socketTop - BULB_CORD_PX;
  const cord = ctx.createLinearGradient(x, cordTop, x, socketTop);
  cord.addColorStop(0, BULB_CORD_FADE_COLOUR);
  cord.addColorStop(1, BULB_CORD_COLOUR);
  ctx.fillStyle = cord;
  ctx.fillRect(x - BULB_CORD_WIDTH_PX * HALF, cordTop, BULB_CORD_WIDTH_PX, BULB_CORD_PX);

  ctx.fillStyle = BULB_SOCKET_COLOUR;
  ctx.fillRect(x - BULB_SOCKET_W_PX * HALF, socketTop, BULB_SOCKET_W_PX, BULB_SOCKET_H_PX);
  ctx.fillStyle = BULB_SOCKET_LIT_COLOUR;
  ctx.fillRect(x - BULB_SOCKET_W_PX * HALF, socketTop + BULB_SOCKET_H_PX - 1, BULB_SOCKET_W_PX, 1);

  ctx.globalCompositeOperation = 'lighter';
  drawRadialGlow(ctx, x, y, BULB_HALO_RADIUS_PX, BULB_HALO_STOPS);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = BULB_GLASS_COLOUR;
  ctx.beginPath();
  ctx.ellipse(x, y, BULB_RADIUS_X_PX, BULB_RADIUS_Y_PX, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = BULB_CORE_COLOUR;
  ctx.beginPath();
  ctx.arc(x, y, BULB_CORE_RADIUS_PX, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── Strip light ─────────────────────────────────────────────────────────────

const STRIP_HOUSING_H_PX = 5;
const STRIP_HOUSING_COLOUR = '#2e3238';
const STRIP_HOUSING_LIT_COLOUR = '#59606a';
/** The tube sits inside the housing with this much metal showing round it. */
const STRIP_TUBE_INSET_PX = 2;
const STRIP_TUBE_H_PX = 2;
const STRIP_TUBE_COLOUR = '#eef7ff';
/** The bracket at each end that holds the tube. */
const STRIP_CAP_W_PX = 2;
const STRIP_CAP_COLOUR = '#1c1f23';
const STRIP_HALO_SPREAD_PX = 5;
const STRIP_HALO_COLOUR = 'rgba(200,228,255,0.28)';
const STRIP_HALO_FADE_COLOUR = 'rgba(200,228,255,0)';

/**
 * A fluorescent strip fixed flat to a wall face, `widthPx` long, its top-left
 * corner at `(x, y)` in screen pixels.
 */
export function drawStripLight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  widthPx: number,
): void {
  ctx.save();
  ctx.fillStyle = STRIP_HOUSING_COLOUR;
  ctx.fillRect(x, y, widthPx, STRIP_HOUSING_H_PX);
  ctx.fillStyle = STRIP_HOUSING_LIT_COLOUR;
  ctx.fillRect(x, y, widthPx, 1);
  ctx.fillStyle = STRIP_CAP_COLOUR;
  ctx.fillRect(x, y, STRIP_CAP_W_PX, STRIP_HOUSING_H_PX);
  ctx.fillRect(x + widthPx - STRIP_CAP_W_PX, y, STRIP_CAP_W_PX, STRIP_HOUSING_H_PX);

  const tubeX = x + STRIP_TUBE_INSET_PX;
  const tubeY = y + (STRIP_HOUSING_H_PX - STRIP_TUBE_H_PX) * HALF;
  const tubeW = widthPx - STRIP_TUBE_INSET_PX * 2;
  ctx.globalCompositeOperation = 'lighter';
  const haloTop = tubeY - STRIP_HALO_SPREAD_PX;
  const haloH = STRIP_TUBE_H_PX + STRIP_HALO_SPREAD_PX * 2;
  const halo = ctx.createLinearGradient(0, haloTop, 0, haloTop + haloH);
  halo.addColorStop(0, STRIP_HALO_FADE_COLOUR);
  halo.addColorStop(HALF, STRIP_HALO_COLOUR);
  halo.addColorStop(1, STRIP_HALO_FADE_COLOUR);
  ctx.fillStyle = halo;
  ctx.fillRect(tubeX, haloTop, tubeW, haloH);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = STRIP_TUBE_COLOUR;
  ctx.fillRect(tubeX, tubeY, tubeW, STRIP_TUBE_H_PX);
  ctx.restore();
}
