import type { Rect } from '../ui/core/geom';
import { iconSquare } from '../ui/icons/iconSquare';

/**
 * All procedural drawing functions for Goblin Dynamite:
 *  - In-world floor sprite (with fuse countdown)
 *  - Inventory icon
 *
 * The blast itself is painted by `dynamiteExplosion.ts`.
 */

const FLOOR_CX_OFFSET = 0.5;
const FLOOR_CY_OFFSET = 0.55;
const FLOOR_BODY_WIDTH = 0.18;
const FLOOR_BODY_HEIGHT = 0.44;
const HALO_FUSE_THRESHOLD = 0.4;
const HALO_PULSE_FREQ = 0.012;
const HALO_RADIUS = 0.36;
const BAND_UPPER_Y = 0.15;
const BAND_LOWER_Y = 0.12;
const BAND_THICKNESS_SCALE = 0.025;
const LABEL_STRIPE_HEIGHT = 0.05;
const LABEL_STRIPE_Y_OFFSET = 0.025;
const FUSE_CTRL_X_OFFSET = 0.1;
const FUSE_CTRL_Y_OFFSET = 0.12;
const FUSE_END_X_OFFSET = 0.06;
const FUSE_END_Y_OFFSET = 0.22;
const FUSE_LINEWIDTH = 0.03;
const SPARK_FAST_BLINK_INTERVAL = 80;
const SPARK_SLOW_BLINK_INTERVAL = 160;
const SPARK_FAST_FUSE_THRESHOLD = 0.07;
const SPARK_DISAPPEAR_THRESHOLD = 0.2;
const SPARK_GLOW_R = 0.07;
const SPARK_CORE_R = 0.035;
const SPARK_CENTER_R = 0.015;

const ICON_CX_OFFSET = 0.5;
const ICON_CY_OFFSET = 0.58;
const ICON_BODY_WIDTH = 0.22;
const ICON_BODY_HEIGHT = 0.48;
const ICON_BAND_UPPER_Y = 0.15;
const ICON_BAND_LOWER_Y = 0.1;
const ICON_BAND_THICKNESS = 0.028;
const ICON_HIGHLIGHT_Y = 0.22;
const ICON_HIGHLIGHT_WIDTH = 0.4;
const ICON_HIGHLIGHT_HEIGHT = 0.38;
const ICON_FUSE_CTRL_X = 0.09;
const ICON_FUSE_CTRL_Y = 0.08;
const ICON_FUSE_END_X = 0.05;
const ICON_FUSE_END_Y = 0.18;
const ICON_FUSE_LINEWIDTH = 0.03;
const ICON_SPARK_R = 0.04;
const ICON_SPARK_CENTER_R = 0.02;

// Throw path preview overlay constants
const THROW_PATH_DOT_RADIUS = 2.5;
const THROW_PATH_DOT_SPACING = 12;
const THROW_PATH_DOT_ALPHA = 0.3;
/** Slow enough to read as a golf-simulator style drift rather than a scroll. */
const THROW_PATH_MARCH_SPEED = 6;
const THROW_PATH_IMPACT_BASE_RADIUS = 11;
const THROW_PATH_IMPACT_PULSE_AMP = 3;
/** Hz — a slow breathing pulse. */
const THROW_PATH_IMPACT_PULSE_FREQ = 0.7;
const THROW_PATH_IMPACT_ALPHA = 0.4;
const THROW_PATH_IMPACT_LINE_WIDTH = 1.5;
const THROW_PATH_IMPACT_CENTER_RADIUS = 3;
const THROW_PATH_MIN_SEGMENT_LEN = 0.001;

// In-world floor/flying sprite

/**
 * Draws a dynamite stick at the given screen position.
 * @param sx      Screen X (top-left of tile)
 * @param sy      Screen Y (top-left of tile)
 * @param s       Tile size in pixels
 * @param fuseFrames Frames remaining on the fuse
 * @param fuseTotal  Total fuse frames (for computing ratio)
 */
export function drawDynamiteFloorSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  fuseFrames: number,
  fuseTotal: number,
): void {
  ctx.save();

  const cx = sx + s * FLOOR_CX_OFFSET;
  const cy = sy + s * FLOOR_CY_OFFSET;
  const bw = s * FLOOR_BODY_WIDTH;
  const bh = s * FLOOR_BODY_HEIGHT;

  const fuseRatio = fuseFrames / fuseTotal;
  if (fuseRatio < HALO_FUSE_THRESHOLD) {
    const pulse = Math.sin(Date.now() * HALO_PULSE_FREQ) * FLOOR_CX_OFFSET + FLOOR_CX_OFFSET;
    const haloAlpha =
      (1 - fuseRatio / HALO_FUSE_THRESHOLD) *
      FLOOR_CY_OFFSET *
      (FLOOR_CX_OFFSET + pulse * FLOOR_CX_OFFSET);
    ctx.beginPath();
    ctx.arc(cx, cy, s * HALO_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 68, 68, ${haloAlpha})`;
    ctx.fill();
  }

  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * BAND_UPPER_Y, bw, s * BAND_THICKNESS_SCALE);
  ctx.fillRect(cx - bw / 2, cy + bh * BAND_LOWER_Y, bw, s * BAND_THICKNESS_SCALE);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx - bw / 2 + 1, cy - s * LABEL_STRIPE_Y_OFFSET, bw - 2, s * LABEL_STRIPE_HEIGHT);

  ctx.strokeStyle = '#6b3a1f';
  ctx.lineWidth = s * FUSE_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - bh / 2);
  ctx.quadraticCurveTo(
    cx + s * FUSE_CTRL_X_OFFSET,
    cy - bh / 2 - s * FUSE_CTRL_Y_OFFSET,
    cx + s * FUSE_END_X_OFFSET,
    cy - bh / 2 - s * FUSE_END_Y_OFFSET,
  );
  ctx.stroke();

  // Fuse tip spark — blinks faster as fuse runs low
  const sparkVisible =
    fuseRatio > SPARK_DISAPPEAR_THRESHOLD
      ? true
      : Math.floor(
          Date.now() /
            (fuseRatio < SPARK_FAST_FUSE_THRESHOLD
              ? SPARK_FAST_BLINK_INTERVAL
              : SPARK_SLOW_BLINK_INTERVAL),
        ) %
          2 ===
        0;

  if (sparkVisible) {
    const sparkX = cx + s * FUSE_END_X_OFFSET;
    const sparkY = cy - bh / 2 - s * FUSE_END_Y_OFFSET;
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_GLOW_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 140, 0, 0.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_CORE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdd00';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_CENTER_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  ctx.restore();
}

// Inventory icon

/**
 * Draws a compact dynamite stick icon for the inventory/hotbar slot.
 */
export function drawDynamiteInventoryIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  ctx.save();

  const cx = x + size * ICON_CX_OFFSET;
  const cy = y + size * ICON_CY_OFFSET;
  const bw = size * ICON_BODY_WIDTH;
  const bh = size * ICON_BODY_HEIGHT;

  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * ICON_BAND_UPPER_Y, bw, size * ICON_BAND_THICKNESS);
  ctx.fillRect(cx - bw / 2, cy + bh * ICON_BAND_LOWER_Y, bw, size * ICON_BAND_THICKNESS);

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(
    cx - bw / 2 + 1,
    cy - bh * ICON_HIGHLIGHT_Y,
    bw * ICON_HIGHLIGHT_WIDTH,
    bh * ICON_HIGHLIGHT_HEIGHT,
  );

  ctx.strokeStyle = '#6b3a1f';
  ctx.lineWidth = size * ICON_FUSE_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - bh / 2);
  ctx.quadraticCurveTo(
    cx + size * ICON_FUSE_CTRL_X,
    cy - bh / 2 - size * ICON_FUSE_CTRL_Y,
    cx + size * ICON_FUSE_END_X,
    cy - bh / 2 - size * ICON_FUSE_END_Y,
  );
  ctx.stroke();

  const sparkX = cx + size * ICON_FUSE_END_X;
  const sparkY = cy - bh / 2 - size * ICON_FUSE_END_Y;
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, size * ICON_SPARK_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffaa00';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, size * ICON_SPARK_CENTER_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}

// Throw path preview overlay

type PathPoint = { x: number; y: number };

function getPositionAtDistance(
  points: PathPoint[],
  cumDists: number[],
  targetDist: number,
): PathPoint {
  if (targetDist <= 0) return points[0];
  const last = points.length - 1;
  const totalLen = cumDists[last];
  if (targetDist >= totalLen) return points[last];

  for (let i = 1; i <= last; i++) {
    if (cumDists[i] >= targetDist) {
      const segLen = cumDists[i] - cumDists[i - 1];
      if (segLen < THROW_PATH_MIN_SEGMENT_LEN) return points[i - 1];
      const t = (targetDist - cumDists[i - 1]) / segLen;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
  }
  return points[last];
}

/**
 * Draws the throw-path overlay in golf-simulator style: a slowly drifting red dotted
 * line along the predicted trajectory, with a pulsing target circle at the impact point.
 */
export function drawDynamiteThrowPath(
  ctx: CanvasRenderingContext2D,
  screenPoints: PathPoint[],
): void {
  if (screenPoints.length < 2) return;

  const cumDists: number[] = [0];
  for (let i = 1; i < screenPoints.length; i++) {
    const dx = screenPoints[i].x - screenPoints[i - 1].x;
    const dy = screenPoints[i].y - screenPoints[i - 1].y;
    cumDists.push(cumDists[i - 1] + Math.hypot(dx, dy));
  }
  const totalLength = cumDists[cumDists.length - 1];
  if (totalLength < 1) return;

  ctx.save();

  const nowSec = performance.now() / 1000;

  // Slowly drifting dot offset — barely perceptible movement
  const marchOffset = (nowSec * THROW_PATH_MARCH_SPEED) % THROW_PATH_DOT_SPACING;

  let dist = marchOffset;
  while (dist < totalLength) {
    const pos = getPositionAtDistance(screenPoints, cumDists, dist);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, THROW_PATH_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 40, 40, ${THROW_PATH_DOT_ALPHA})`;
    ctx.fill();
    dist += THROW_PATH_DOT_SPACING;
  }

  const impact = screenPoints[screenPoints.length - 1];
  const pulse = Math.sin(nowSec * THROW_PATH_IMPACT_PULSE_FREQ * Math.PI * 2);
  const impactRadius = THROW_PATH_IMPACT_BASE_RADIUS + pulse * THROW_PATH_IMPACT_PULSE_AMP;

  ctx.beginPath();
  ctx.arc(impact.x, impact.y, impactRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(220, 40, 40, ${THROW_PATH_IMPACT_ALPHA})`;
  ctx.lineWidth = THROW_PATH_IMPACT_LINE_WIDTH;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(impact.x, impact.y, THROW_PATH_IMPACT_CENTER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220, 40, 40, ${THROW_PATH_IMPACT_ALPHA * 0.8})`;
  ctx.fill();

  ctx.restore();
}
