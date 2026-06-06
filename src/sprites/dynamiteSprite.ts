/**
 * All procedural drawing functions for Goblin Dynamite:
 *  - In-world floor sprite (with fuse countdown)
 *  - Inventory icon
 *  - Explosion animation
 *  - Throw charge bar
 */
import { drawText } from '../ui/TextBox';

const FLOOR_CX_OFFSET = 0.5;
const FLOOR_CY_OFFSET = 0.55;
const FLOOR_BODY_WIDTH = 0.18;
const FLOOR_BODY_HEIGHT = 0.44;
const HALO_FUSE_THRESHOLD = 0.4; // fuse ratio below which halo activates
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

const EXPLOSION_SHOCKWAVE_THRESHOLD = 0.55;
const EXPLOSION_RING_LINE_SCALE = 0.06;
const EXPLOSION_RING_SHRINK = 0.5;
const EXPLOSION_FIRE_SCALE = 0.75;
const EXPLOSION_FIRE_FADE = 1.3;
const EXPLOSION_CORE_THRESHOLD = 0.35;
const EXPLOSION_CORE_SCALE = 0.25;
const EXPLOSION_CORE_ALPHA = 0.9;
const EXPLOSION_SPARK_THRESHOLD = 0.45;
const EXPLOSION_SPARK_REACH = 0.9;
const EXPLOSION_SPARK_LINEWIDTH = 0.04;
const EXPLOSION_SPARK_COUNT = 12;
const EXPLOSION_SPARK_START_FRAC = 0.15;
const EXPLOSION_SECONDARY_SPARK_COUNT = 6;
const EXPLOSION_SECONDARY_LINEWIDTH = 0.025;
const EXPLOSION_SECONDARY_REACH_SCALE = 0.6;
const EXPLOSION_SECONDARY_ALPHA_SCALE = 0.7;
const EXPLOSION_SMOKE_THRESHOLD = 0.3;
const EXPLOSION_SMOKE_SCALE = 0.32;
const EXPLOSION_SMOKE_GROW = 0.8;
const EXPLOSION_SMOKE_ALPHA = 0.65;
const EXPLOSION_SMOKE_SQUASH = 0.75;
const EXPLOSION_PUFF_SPREAD_SCALE = 0.5;
const EXPLOSION_FIRE_GRADIENT_MID1 = 0.3;
const EXPLOSION_FIRE_GRADIENT_MID2 = 0.7;

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

const CHARGE_BAR_WIDTH = 20;
const CHARGE_BAR_HEIGHT = 150;
const CHARGE_BAR_RIGHT_MARGIN = 16;
const CHARGE_BAR_BORDER = 2;
const CHARGE_BAR_BORDER_TOTAL = 4;
const CHARGE_BAR_FLASH_DIVISOR = 8;
const CHARGE_BAR_LABEL_Y_DANGER_TOP = 26;
const CHARGE_BAR_LABEL_Y_DANGER_BOT = 14;
const CHARGE_BAR_LABEL_Y_THROW_TOP = 22;
const CHARGE_BAR_LABEL_Y_THROW_BOT = 10;
const CHARGE_BAR_HIGH_POWER_THRESHOLD = 0.85;
const CHARGE_BAR_TICK_QUARTER = 0.25;
const CHARGE_BAR_TICK_HALF = 0.5;
const CHARGE_BAR_TICK_THREE_QUARTER = 0.75;

// Throw path preview overlay constants
const THROW_PATH_DOT_RADIUS = 2.5;
const THROW_PATH_DOT_SPACING = 12; // pixels between dots along the path
const THROW_PATH_DOT_ALPHA = 0.3;
const THROW_PATH_MARCH_SPEED = 6; // px/sec — very slow drift for golf-simulator feel
const THROW_PATH_IMPACT_BASE_RADIUS = 11; // base radius of the impact ring
const THROW_PATH_IMPACT_PULSE_AMP = 3; // radius oscillation in pixels
const THROW_PATH_IMPACT_PULSE_FREQ = 0.7; // Hz — slow breathe
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
  const bw = s * FLOOR_BODY_WIDTH; // body width
  const bh = s * FLOOR_BODY_HEIGHT; // body height

  // Pulsing red halo when fuse < 40% (120 frames)
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

  // Body
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  // Black bands
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * BAND_UPPER_Y, bw, s * BAND_THICKNESS_SCALE);
  ctx.fillRect(cx - bw / 2, cy + bh * BAND_LOWER_Y, bw, s * BAND_THICKNESS_SCALE);

  // Label stripe (white stripe at center)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx - bw / 2 + 1, cy - s * LABEL_STRIPE_Y_OFFSET, bw - 2, s * LABEL_STRIPE_HEIGHT);

  // Fuse rope (curved line from top)
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
    // Glow
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_GLOW_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 140, 0, 0.45)';
    ctx.fill();
    // Core spark
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_CORE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdd00';
    ctx.fill();
    // Tiny bright center
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * SPARK_CENTER_R, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  ctx.restore();
}

// Explosion animation

/**
 * Draws the dynamite explosion animation.
 * @param sx           Screen X of explosion center
 * @param sy           Screen Y of explosion center
 * @param s            Tile size (for scale reference)
 * @param timer        Frames remaining in animation
 * @param totalFrames  Total animation frames (e.g. 45)
 * @param explosionRadius  Radius of the AoE in pixels
 */
export function drawDynamiteExplosion(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  timer: number,
  totalFrames: number,
  explosionRadius: number,
): void {
  ctx.save();

  const t = 1 - timer / totalFrames; // 0 = just started, 1 = finished

  // 1. Shockwave ring — expands fast, fades early
  if (t < EXPLOSION_SHOCKWAVE_THRESHOLD) {
    const ringProgress = t / EXPLOSION_SHOCKWAVE_THRESHOLD;
    const ringR = explosionRadius * ringProgress;
    const ringAlpha = 1 - ringProgress;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${ringAlpha * EXPLOSION_CORE_ALPHA})`;
    ctx.lineWidth = s * EXPLOSION_RING_LINE_SCALE * (1 - ringProgress * EXPLOSION_RING_SHRINK);
    ctx.stroke();
  }

  // 2. Fire fill — grows then shrinks
  const fireR = explosionRadius * EXPLOSION_FIRE_SCALE * Math.sin(t * Math.PI);
  const fireAlpha = Math.max(0, 1 - t * EXPLOSION_FIRE_FADE);
  if (fireR > 0 && fireAlpha > 0) {
    const fireGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, fireR);
    fireGrad.addColorStop(0, `rgba(255, 255, 200, ${fireAlpha})`);
    fireGrad.addColorStop(EXPLOSION_FIRE_GRADIENT_MID1, `rgba(255, 160, 0, ${fireAlpha})`);
    fireGrad.addColorStop(
      EXPLOSION_FIRE_GRADIENT_MID2,
      `rgba(220, 60, 0, ${fireAlpha * EXPLOSION_CORE_ALPHA})`,
    );
    fireGrad.addColorStop(1, `rgba(100, 20, 0, 0)`);
    ctx.beginPath();
    ctx.arc(sx, sy, fireR, 0, Math.PI * 2);
    ctx.fillStyle = fireGrad;
    ctx.fill();
  }

  // 3. Hot bright core — early, shrinks fast
  if (t < EXPLOSION_CORE_THRESHOLD) {
    const coreT = t / EXPLOSION_CORE_THRESHOLD;
    const coreR = explosionRadius * EXPLOSION_CORE_SCALE * (1 - coreT);
    const coreAlpha = 1 - coreT;
    ctx.beginPath();
    ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${coreAlpha * EXPLOSION_CORE_ALPHA})`;
    ctx.fill();
  }

  // 4. Spark rays — 12 lines, early phase only
  if (t < EXPLOSION_SPARK_THRESHOLD) {
    const sparkT = t / EXPLOSION_SPARK_THRESHOLD;
    const sparkLen = explosionRadius * EXPLOSION_SPARK_REACH * sparkT;
    const sparkAlpha = 1 - sparkT;
    ctx.strokeStyle = `rgba(255, 220, 50, ${sparkAlpha})`;
    ctx.lineWidth = s * EXPLOSION_SPARK_LINEWIDTH;
    ctx.lineCap = 'round';
    for (let i = 0; i < EXPLOSION_SPARK_COUNT; i++) {
      const angle = (i / EXPLOSION_SPARK_COUNT) * Math.PI * 2;
      const startR = explosionRadius * EXPLOSION_SPARK_START_FRAC;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * startR, sy + Math.sin(angle) * startR);
      ctx.lineTo(
        sx + Math.cos(angle) * (startR + sparkLen),
        sy + Math.sin(angle) * (startR + sparkLen),
      );
      ctx.stroke();
    }
    // 6 shorter secondary sparks at offset angles
    ctx.lineWidth = s * EXPLOSION_SECONDARY_LINEWIDTH;
    ctx.strokeStyle = `rgba(255, 140, 0, ${sparkAlpha * EXPLOSION_SECONDARY_ALPHA_SCALE})`;
    for (let i = 0; i < EXPLOSION_SECONDARY_SPARK_COUNT; i++) {
      const angle =
        (i / EXPLOSION_SECONDARY_SPARK_COUNT) * Math.PI * 2 +
        Math.PI / EXPLOSION_SECONDARY_SPARK_COUNT;
      const startR = (explosionRadius * CHARGE_BAR_TICK_QUARTER) / FLOOR_CX_OFFSET;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * startR, sy + Math.sin(angle) * startR);
      ctx.lineTo(
        sx + Math.cos(angle) * (startR + sparkLen * EXPLOSION_SECONDARY_REACH_SCALE),
        sy + Math.sin(angle) * (startR + sparkLen * EXPLOSION_SECONDARY_REACH_SCALE),
      );
      ctx.stroke();
    }
  }

  // 5. Smoke puffs — 6 dark ellipses, appear later and fade out
  if (t > EXPLOSION_SMOKE_THRESHOLD) {
    const smokeT = (t - EXPLOSION_SMOKE_THRESHOLD) / (1 - EXPLOSION_SMOKE_THRESHOLD);
    const smokeAlpha = Math.max(0, (1 - smokeT) * EXPLOSION_SMOKE_ALPHA);
    const puffPositions = [
      { dx: -0.4, dy: -FLOOR_CX_OFFSET },
      { dx: 0.4, dy: -FLOOR_CX_OFFSET },
      {
        dx: -EXPLOSION_SHOCKWAVE_THRESHOLD,
        dy: EXPLOSION_SMOKE_THRESHOLD / EXPLOSION_SMOKE_THRESHOLD,
      },
      {
        dx: EXPLOSION_SHOCKWAVE_THRESHOLD,
        dy: EXPLOSION_SMOKE_THRESHOLD / EXPLOSION_SMOKE_THRESHOLD,
      },
      { dx: -0.2, dy: FLOOR_CX_OFFSET },
      { dx: 0.2, dy: FLOOR_CX_OFFSET },
    ];
    for (const pos of puffPositions) {
      const puffR =
        explosionRadius *
        EXPLOSION_SMOKE_SCALE *
        (EXPLOSION_SECONDARY_REACH_SCALE + smokeT * EXPLOSION_SMOKE_GROW);
      const puffX =
        sx +
        pos.dx *
          explosionRadius *
          (EXPLOSION_PUFF_SPREAD_SCALE + smokeT * EXPLOSION_PUFF_SPREAD_SCALE);
      const puffY =
        sy +
        pos.dy *
          explosionRadius *
          (EXPLOSION_PUFF_SPREAD_SCALE + smokeT * EXPLOSION_PUFF_SPREAD_SCALE);
      ctx.beginPath();
      ctx.ellipse(puffX, puffY, puffR, puffR * EXPLOSION_SMOKE_SQUASH, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 50, 50, ${smokeAlpha})`;
      ctx.fill();
    }
  }

  ctx.restore();
}

// Inventory icon

/**
 * Draws a compact dynamite stick icon for the inventory/hotbar slot.
 */
export function drawDynamiteInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();

  const cx = x + size * ICON_CX_OFFSET;
  const cy = y + size * ICON_CY_OFFSET;
  const bw = size * ICON_BODY_WIDTH;
  const bh = size * ICON_BODY_HEIGHT;

  // Body
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  // Bands
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * ICON_BAND_UPPER_Y, bw, size * ICON_BAND_THICKNESS);
  ctx.fillRect(cx - bw / 2, cy + bh * ICON_BAND_LOWER_Y, bw, size * ICON_BAND_THICKNESS);

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(
    cx - bw / 2 + 1,
    cy - bh * ICON_HIGHLIGHT_Y,
    bw * ICON_HIGHLIGHT_WIDTH,
    bh * ICON_HIGHLIGHT_HEIGHT,
  );

  // Fuse
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

  // Spark tip
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

  // Uniform red dots along the entire path
  let dist = marchOffset;
  while (dist < totalLength) {
    const pos = getPositionAtDistance(screenPoints, cumDists, dist);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, THROW_PATH_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 40, 40, ${THROW_PATH_DOT_ALPHA})`;
    ctx.fill();
    dist += THROW_PATH_DOT_SPACING;
  }

  // Pulsing target ring at the impact (landing) point only
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

// Throw charge bar

/**
 * Draws the throw-charge bar at the bottom center of the screen.
 * @param canvasW       Canvas width
 * @param canvasH       Canvas height
 * @param ratio         Charge ratio 0–1 (1 = max throw)
 * @param chargeFrames  Raw frames held (for danger flash detection)
 * @param dangerFrames  Frame count at which the bar turns red/flashing
 */
export function drawDynamiteChargeBar(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  ratio: number,
  chargeFrames: number,
  dangerFrames: number,
): void {
  ctx.save();

  const barW = CHARGE_BAR_WIDTH;
  const barH = CHARGE_BAR_HEIGHT;
  const barX = canvasW - barW - CHARGE_BAR_RIGHT_MARGIN;
  const barY = (canvasH - barH) / 2;

  const isDanger = chargeFrames >= dangerFrames;
  // Flash every 8 frames when in danger
  const flashOn = !isDanger || Math.floor(chargeFrames / CHARGE_BAR_FLASH_DIVISOR) % 2 === 0;

  // Labels above bar — baseline_y converted to top_y: top = baseline - Math.round(size * 0.8)
  const labelX = barX + barW / 2;
  if (isDanger) {
    drawText(ctx, '⚠', {
      x: labelX,
      y: barY - CHARGE_BAR_LABEL_Y_DANGER_TOP,
      size: 10,
      bold: true,
      font: 'monospace',
      color: '#ef4444',
      align: 'center',
    });
    drawText(ctx, 'DANGER', {
      x: labelX,
      y: barY - CHARGE_BAR_LABEL_Y_DANGER_BOT,
      size: 10,
      bold: true,
      font: 'monospace',
      color: '#ef4444',
      align: 'center',
    });
  } else {
    drawText(ctx, 'THROW', {
      x: labelX,
      y: barY - CHARGE_BAR_LABEL_Y_THROW_TOP,
      size: 10,
      bold: true,
      font: 'monospace',
      color: '#e2e8f0',
      align: 'center',
    });
    drawText(ctx, 'POWER', {
      x: labelX,
      y: barY - CHARGE_BAR_LABEL_Y_THROW_BOT,
      size: 10,
      bold: true,
      font: 'monospace',
      color: '#e2e8f0',
      align: 'center',
    });
  }

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(
    barX - CHARGE_BAR_BORDER,
    barY - CHARGE_BAR_BORDER,
    barW + CHARGE_BAR_BORDER_TOTAL,
    barH + CHARGE_BAR_BORDER_TOTAL,
  );
  ctx.strokeStyle = isDanger ? '#ef4444' : '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    barX - CHARGE_BAR_BORDER,
    barY - CHARGE_BAR_BORDER,
    barW + CHARGE_BAR_BORDER_TOTAL,
    barH + CHARGE_BAR_BORDER_TOTAL,
  );

  // Fill — grows from bottom upward
  if (flashOn) {
    const fillH = Math.ceil(barH * ratio);
    ctx.fillStyle = isDanger
      ? '#ef4444'
      : ratio > CHARGE_BAR_HIGH_POWER_THRESHOLD
        ? '#facc15'
        : '#4ade80';
    ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
  }

  // Tick marks at 25%, 50%, 75% (horizontal lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (const pct of [
    CHARGE_BAR_TICK_QUARTER,
    CHARGE_BAR_TICK_HALF,
    CHARGE_BAR_TICK_THREE_QUARTER,
  ]) {
    const ty = barY + barH * (1 - pct);
    ctx.beginPath();
    ctx.moveTo(barX, ty);
    ctx.lineTo(barX + barW, ty);
    ctx.stroke();
  }

  ctx.restore();
}
