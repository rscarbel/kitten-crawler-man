/**
 * Signet's tattoo flash, the naiad scales on her skin, and the level of detail
 * that decides whether either is drawn at all.
 */

import { mix } from '../bipedArt';
import { FIGURE_SCALE } from './proportions';
import { INK_COLOR, INK_GLOW_COLOR, INK_LIT_COLOR, SCALE_COLOR } from './palette';

const HALF_TURN = Math.PI;
const TILE_HALF_SPAN = 0.5;
const TILE_SPAN = 1;

/** Old-school flash: one heavy outline weight, no shading. */
const INK_LINE_WIDTH = 0.0058;
const INK_DETAIL_LINE_WIDTH = 0.0036;
const INK_ALPHA = 0.82;
const INK_GLOW_BLUR_PX = 4;
export const GLOW_REFERENCE_TILE_PX = 32;

/**
 * The tattoos swim under the skin rather than sitting still on it, so each
 * motif gets its own slow drift and roll, phase-offset by its index.
 */
const INK_DRIFT_AMPLITUDE = 0.011;
const INK_DRIFT_SPEED = 0.55;
const INK_ROLL_AMPLITUDE = 0.13;
const INK_ROLL_SPEED = 0.4;

/** A travelling highlight band that makes the skin look like it is rippling. */
const RIPPLE_BAND_HEIGHT = 0.06;
const RIPPLE_TRAVEL_SPEED = 0.22;
const RIPPLE_ALPHA = 0.2;

const SCALE_CELL = 0.026;
const SCALE_ALPHA = 0.06;
const SCALE_LINE_WIDTH_FRACTION = 0.12;
const SCALE_ARC_RADIUS_FRACTION = 0.45;
/** Each scale is the lower arc of a circle, giving the fish-scale overlap. */
const SCALE_ARC_START = HALF_TURN * 0.15;
const SCALE_ARC_END = HALF_TURN * 0.85;
/** Fraction of the patch, at each edge, over which the scales fade to nothing. */
const SCALE_PATCH_FADE_FRACTION = 0.32;

/* ── Level of detail ───────────────────────────────────────────────────── */

/**
 * Her fine passes are drawn only where they resolve.
 *
 * She is two tiles tall, which on a 32-pixel tile at the performance render
 * scale is sixty-four device pixels for a whole woman. Her tattoos are line
 * work a fiftieth of a tile wide and her scales are a cell a fortieth across:
 * at that size neither the line work nor even the large motifs resolve into
 * marks: they average into grey patches that read as dirt or bandages, and sit
 * on top of the shading. Muting them there is not a saving, it is the
 * difference between a figure and a smudge.
 *
 * Measured in *device* pixels, so the same rule answers correctly for the two
 * render-quality presets without knowing either exists: at the sharp scale she
 * is twice the pixels and gets her ink back.
 */
const INK_MIN_FIGURE_HEIGHT_PX = 100;
/** The scale cells and the ripple are finer still, and go one rung later. */
const SKIN_TEXTURE_MIN_FIGURE_HEIGHT_PX = 140;

export interface SignetDetail {
  /** Every motif, at its own line weight. */
  readonly ink: boolean;
  readonly skinTexture: boolean;
  /** The smallest modelling — ankle bones, the tendon under the kneecap — which is under a pixel any smaller. */
  readonly fineModelling: boolean;
}

/**
 * Her drawn height in device pixels. Read off the destination transform rather
 * than from the render-quality setting, so a review harness, an offscreen
 * composite and the game canvas are all answered by the same call.
 */
export function figureHeightPx(ctx: CanvasRenderingContext2D, tileSizePx: number): number {
  const transform = ctx.getTransform();
  const verticalScale = Math.abs(transform.d);
  const isPlainScale = transform.b === 0 && transform.c === 0 && verticalScale > 0;
  return tileSizePx * FIGURE_SCALE * (isPlainScale ? verticalScale : 1);
}

export function resolveDetail(heightPx: number): SignetDetail {
  return {
    ink: heightPx >= INK_MIN_FIGURE_HEIGHT_PX,
    skinTexture: heightPx >= SKIN_TEXTURE_MIN_FIGURE_HEIGHT_PX,
    fineModelling: heightPx >= SKIN_TEXTURE_MIN_FIGURE_HEIGHT_PX,
  };
}

/* ══ Tattoo flash ═══════════════════════════════════════════════════════ */

/**
 * Every motif is drawn inside a unit box spanning -0.5..0.5 on both axes, so a
 * single `size` places it anywhere on the body at any scale.
 */
export type TattooMotif = (ctx: CanvasRenderingContext2D) => void;

export function drawHammerheadSharkMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.5, 0);
  ctx.lineTo(-0.42, -0.14);
  ctx.lineTo(-0.34, 0);
  ctx.lineTo(-0.42, 0.14);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.34, -0.05);
  ctx.quadraticCurveTo(0.05, -0.2, 0.34, -0.06);
  ctx.lineTo(0.5, -0.22);
  ctx.lineTo(0.42, 0);
  ctx.lineTo(0.5, 0.22);
  ctx.lineTo(0.34, 0.06);
  ctx.quadraticCurveTo(0.05, 0.18, -0.34, 0.05);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -0.15);
  ctx.lineTo(0.08, -0.34);
  ctx.lineTo(0.14, -0.13);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.05, 0.12);
  ctx.lineTo(-0.12, 0.28);
  ctx.stroke();
}

export function drawOctopusMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, -0.22, 0.19, 0.24, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-0.08, -0.24, 0.045, 0, Math.PI * 2);
  ctx.arc(0.08, -0.24, 0.045, 0, Math.PI * 2);
  ctx.stroke();

  const TENTACLE_COUNT = 6;
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const spread = (i / (TENTACLE_COUNT - 1) - 0.5) * 2;
    const rootX = spread * 0.16;
    const curlX = spread * 0.46;
    const tipX = spread * 0.3;
    ctx.beginPath();
    ctx.moveTo(rootX, -0.02);
    ctx.bezierCurveTo(curlX, 0.16, curlX * 0.6, 0.36, tipX, 0.48);
    ctx.stroke();
  }
}

export function drawThreeHeadedOgreMotif(ctx: CanvasRenderingContext2D): void {
  const HEAD_RADIUS = 0.09;
  const HEAD_Y = -0.3;
  for (const headX of [-0.17, 0, 0.17]) {
    ctx.beginPath();
    ctx.arc(headX, HEAD_Y, HEAD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX - HEAD_RADIUS * 0.5, HEAD_Y + HEAD_RADIUS * 0.35);
    ctx.lineTo(headX + HEAD_RADIUS * 0.5, HEAD_Y + HEAD_RADIUS * 0.35);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.16);
  ctx.lineTo(0.24, -0.16);
  ctx.lineTo(0.16, 0.32);
  ctx.lineTo(-0.16, 0.32);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.12);
  ctx.lineTo(-0.4, 0.1);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0.24, -0.12);
  ctx.lineTo(0.42, -0.02);
  ctx.stroke();

  // The curved sword, swept up from the raised right fist
  ctx.beginPath();
  ctx.moveTo(0.34, -0.08);
  ctx.quadraticCurveTo(0.5, -0.3, 0.3, -0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.28, 0.02);
  ctx.lineTo(0.46, -0.08);
  ctx.stroke();
}

export function drawDragonMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.1, -0.42);
  ctx.bezierCurveTo(0.3, -0.24, -0.32, 0.02, 0.06, 0.2);
  ctx.bezierCurveTo(0.24, 0.32, 0.0, 0.42, -0.14, 0.48);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.1, -0.42);
  ctx.lineTo(-0.3, -0.46);
  ctx.lineTo(-0.16, -0.32);
  ctx.closePath();
  ctx.stroke();

  const SPINE_SPIKE_COUNT = 4;
  for (let i = 0; i < SPINE_SPIKE_COUNT; i++) {
    const t = i / SPINE_SPIKE_COUNT;
    const spikeY = -0.3 + t * 0.5;
    const spikeX = 0.12 - t * 0.3;
    ctx.beginPath();
    ctx.moveTo(spikeX, spikeY);
    ctx.lineTo(spikeX + 0.1, spikeY - 0.06);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(-0.02, -0.16);
  ctx.quadraticCurveTo(-0.36, -0.24, -0.3, 0.04);
  ctx.stroke();
}

export function drawEelLightningMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.46);
  ctx.bezierCurveTo(0.26, -0.26, -0.24, -0.02, 0.12, 0.18);
  ctx.bezierCurveTo(0.28, 0.3, 0.06, 0.38, -0.06, 0.46);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.06, -0.46);
  ctx.lineTo(-0.2, -0.4);
  ctx.lineTo(-0.06, -0.34);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.34);
  ctx.lineTo(-0.34, -0.2);
  ctx.lineTo(-0.24, -0.18);
  ctx.lineTo(-0.36, 0.02);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0.3, -0.06);
  ctx.lineTo(0.2, 0.06);
  ctx.lineTo(0.3, 0.08);
  ctx.lineTo(0.18, 0.24);
  ctx.stroke();
}

export function drawSmallFishMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.2, 0);
  ctx.quadraticCurveTo(0.05, -0.28, 0.34, 0);
  ctx.quadraticCurveTo(0.05, 0.28, -0.2, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.2, 0);
  ctx.lineTo(-0.44, -0.2);
  ctx.lineTo(-0.44, 0.2);
  ctx.closePath();
  ctx.stroke();
}

export interface TattooPlacement {
  x: number;
  y: number;
  /** Edge length of the motif's unit box once placed on the body. */
  size: number;
  /** Offsets this motif's drift and roll so no two move in lockstep. */
  phase: number;
  /** Base orientation, e.g. a shark turned to swim down a thigh. */
  rotation?: number;
  /** Thinner outline for motifs small enough that the heavy weight fills in. */
  detail?: boolean;
}

/**
 * Place a motif on the body with its own drift and roll, so the flash appears
 * to swim beneath the skin instead of being printed on it.
 */
export function stampTattoo(
  ctx: CanvasRenderingContext2D,
  lod: SignetDetail,
  motif: TattooMotif,
  timeSec: number,
  placement: TattooPlacement,
): void {
  if (!lod.ink) return;
  const { x, y, size, phase, rotation = 0, detail = false } = placement;
  const lineWidth = detail ? INK_DETAIL_LINE_WIDTH : INK_LINE_WIDTH;
  const driftX = Math.sin(timeSec * INK_DRIFT_SPEED + phase) * INK_DRIFT_AMPLITUDE;
  const driftY = Math.cos(timeSec * INK_DRIFT_SPEED * 0.8 + phase) * INK_DRIFT_AMPLITUDE * 0.6;
  const roll = Math.sin(timeSec * INK_ROLL_SPEED + phase) * INK_ROLL_AMPLITUDE;

  ctx.save();
  ctx.translate(x + driftX, y + driftY);
  ctx.rotate(rotation + roll);
  ctx.scale(size, size);
  // Undo the motif scaling so the flash keeps one constant outline weight,
  // which is what makes it read as old-school tattooing rather than sketching.
  ctx.lineWidth = lineWidth / size;
  motif(ctx);
  ctx.restore();
}

export function applyInkStyle(
  ctx: CanvasRenderingContext2D,
  castGlow: number,
  tileSizePx: number,
): void {
  ctx.strokeStyle = INK_COLOR;
  ctx.globalAlpha *= INK_ALPHA;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (castGlow > 0) {
    // The line itself stays dark: a pale glow colour on her pale skin erases
    // the flash entirely. The halo is what reads as the ink lighting up, and
    // both follow the glow so the ink cools off rather than snapping back.
    ctx.strokeStyle = mix(INK_COLOR, INK_LIT_COLOR, castGlow);
    ctx.shadowColor = INK_GLOW_COLOR;
    ctx.shadowBlur = castGlow * INK_GLOW_BLUR_PX * (tileSizePx / GLOW_REFERENCE_TILE_PX);
  }
}

/**
 * A patch is laid out on a grid, so at full strength its border is a straight
 * line of scales — a visible rectangle drawn across her waist and thighs. The
 * cells fade out over the outermost fraction of the patch instead.
 */
function scalePatchEdgeFade(position: number, span: number): number {
  const distanceFromNearestEdge = Math.min(position, span - position);
  return Math.min(1, distanceFromNearestEdge / (span * SCALE_PATCH_FADE_FRACTION));
}

export function drawScalePatch(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = SCALE_COLOR;
  ctx.lineWidth = SCALE_CELL * SCALE_LINE_WIDTH_FRACTION;
  const rows = Math.ceil(height / SCALE_CELL);
  const columns = Math.ceil(width / SCALE_CELL);
  for (let row = 0; row < rows; row++) {
    const rowOffset = row % 2 === 0 ? 0 : SCALE_CELL / 2;
    const rowFade = scalePatchEdgeFade(row * SCALE_CELL, height);
    for (let column = 0; column < columns; column++) {
      const columnFade = scalePatchEdgeFade(column * SCALE_CELL + rowOffset, width);
      ctx.globalAlpha = SCALE_ALPHA * rowFade * columnFade;
      const cellX = left + column * SCALE_CELL + rowOffset;
      const cellY = top + row * SCALE_CELL;
      ctx.beginPath();
      ctx.arc(cellX, cellY, SCALE_CELL * SCALE_ARC_RADIUS_FRACTION, SCALE_ARC_START, SCALE_ARC_END);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawSkinRipple(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  top: number,
  bottom: number,
): void {
  const span = bottom - top;
  const travel = (timeSec * RIPPLE_TRAVEL_SPEED) % 1;
  const bandCenterY = top + travel * span;
  const gradient = ctx.createLinearGradient(
    0,
    bandCenterY - RIPPLE_BAND_HEIGHT,
    0,
    bandCenterY + RIPPLE_BAND_HEIGHT,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, `rgba(255,255,255,${RIPPLE_ALPHA})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(
    -TILE_HALF_SPAN,
    bandCenterY - RIPPLE_BAND_HEIGHT,
    TILE_SPAN,
    RIPPLE_BAND_HEIGHT * 2,
  );
}
