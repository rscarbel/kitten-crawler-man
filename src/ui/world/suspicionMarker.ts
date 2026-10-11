/**
 * The glyph over a prison guard that has seen something: a yellow `?` that
 * swells as its suspicion rises, and a red `!` once it has seen enough. Drawn
 * in the caller's camera-relative pixels, above the prison's darkness.
 */

import { worldPalette } from '../theme/worldInk';
import { worldText } from './worldText';

/** How tall the glyph is at the first flicker of suspicion and at full, in pixels. */
const GLYPH_MIN_SIZE_PX = 11;
const GLYPH_MAX_SIZE_PX = 19;
const ALARM_SIZE_PX = 21;
/** The badge behind the glyph, as a share of the glyph's size. */
const BADGE_RADIUS_SHARE = 0.62;
const BADGE_EDGE_WIDTH_PX = 1.5;
const GLYPH_OUTLINE_WIDTH_PX = 3;
const GLOW_BLUR_PX = 10;
/** The badge floats this far above the point handed in, as a share of its radius. */
const BADGE_LIFT_SHARE = 1.1;
/** The alarm `!` pulses once every this many milliseconds. */
const ALARM_PULSE_PERIOD_MS = 240;
const ALARM_PULSE_SWELL = 0.12;
/** Below this suspicion nothing is drawn. */
const MIN_VISIBLE_SUSPICION = 0.001;
const FULL_TURN = Math.PI * 2;

export interface SuspicionMarkerOptions {
  /** Where the marker's foot sits: the top of the guard's art, centred, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  /** The guard's suspicion, 0 to 1. */
  readonly suspicion: number;
  /** Whether it has seen enough: the capture is starting. */
  readonly alarmed: boolean;
  /** Milliseconds, for the alarm's pulse. */
  readonly nowMs: number;
}

/** Paints one guard's suspicion marker; nothing while its suspicion is zero. */
export function drawSuspicionMarker(
  ctx: CanvasRenderingContext2D,
  opts: SuspicionMarkerOptions,
): void {
  if (!opts.alarmed && opts.suspicion < MIN_VISIBLE_SUSPICION) return;
  const ink = worldPalette.prison;
  const pulse = opts.alarmed
    ? 1 + ALARM_PULSE_SWELL * Math.sin((opts.nowMs / ALARM_PULSE_PERIOD_MS) * FULL_TURN)
    : 1;
  const size = opts.alarmed
    ? ALARM_SIZE_PX * pulse
    : GLYPH_MIN_SIZE_PX +
      (GLYPH_MAX_SIZE_PX - GLYPH_MIN_SIZE_PX) * Math.min(1, Math.max(0, opts.suspicion));
  const radius = size * BADGE_RADIUS_SHARE;
  const centreY = opts.y - radius * BADGE_LIFT_SHARE;
  const color = opts.alarmed ? ink.alarm : ink.suspicion;

  ctx.save();
  ctx.fillStyle = ink.badge;
  ctx.strokeStyle = ink.badgeEdge;
  ctx.lineWidth = BADGE_EDGE_WIDTH_PX;
  ctx.beginPath();
  ctx.arc(opts.x, centreY, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  worldText(ctx, opts.alarmed ? '!' : '?', {
    x: opts.x,
    y: centreY,
    size,
    bold: true,
    color,
    outline: true,
    outlineWidth: GLYPH_OUTLINE_WIDTH_PX,
    glow: color,
    glowBlur: GLOW_BLUR_PX,
    align: 'center',
    baseline: 'middle',
  });
}
