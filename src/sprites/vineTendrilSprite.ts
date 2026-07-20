/** Stalk geometry (fractions of tile size). */
const TENDRIL_SEGMENT_COUNT = 5;
const TENDRIL_HEIGHT = 0.6;
const TENDRIL_BASE_WIDTH = 0.16;
const TENDRIL_TIP_WIDTH = 0.06;
const TENDRIL_SWAY_AMP = 0.1;

/** Thorns along the stalk. */
const TENDRIL_THORN_COUNT = 4;
const TENDRIL_THORN_LEN = 0.06;

/** Bulb "eye" near the tip. */
const TENDRIL_BULB_R = 0.06;
const TENDRIL_BULB_GLOW_RADIUS = 6;

/**
 * Draw a vine tendril — one of Ringmaster Grimaldi's destructible root
 * sub-entities, writhing and sustaining the resurrection of his performers
 * while alive.
 *
 * @param swayPhase animation accumulator, incremented each frame by the caller.
 */
export function drawVineTendrilSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  swayPhase = 0,
  healthFraction = 1,
): void {
  const baseX = sx + s / 2;
  const baseY = sy + s * 0.85;

  ctx.save();

  ctx.strokeStyle = '#2a5a1a';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  const points: Array<{ x: number; y: number }> = [{ x: baseX, y: baseY }];
  for (let i = 1; i <= TENDRIL_SEGMENT_COUNT; i++) {
    const t = i / TENDRIL_SEGMENT_COUNT;
    const sway = Math.sin(swayPhase + t * 2) * TENDRIL_SWAY_AMP * s * t;
    const px = baseX + sway;
    const py = baseY - t * TENDRIL_HEIGHT * s;
    points.push({ x: px, y: py });
  }
  for (let i = 0; i < points.length; i++) {
    const t = i / TENDRIL_SEGMENT_COUNT;
    const width = (TENDRIL_BASE_WIDTH + (TENDRIL_TIP_WIDTH - TENDRIL_BASE_WIDTH) * t) * s;
    ctx.lineWidth = width;
    ctx.strokeStyle = healthFraction < 1 ? '#4a6a2a' : '#2a5a1a';
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
  }

  // Thorns
  ctx.strokeStyle = '#1a3a0a';
  ctx.lineWidth = Math.max(1, s * 0.015);
  for (let i = 0; i < TENDRIL_THORN_COUNT; i++) {
    const idx = 1 + Math.floor((i / TENDRIL_THORN_COUNT) * (points.length - 1));
    const p = points[idx];
    const side = i % 2 === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + side * TENDRIL_THORN_LEN * s, p.y - TENDRIL_THORN_LEN * s * 0.4);
    ctx.stroke();
  }

  // Glowing bulb near the tip
  const tip = points[points.length - 1];
  ctx.save();
  ctx.shadowColor = '#8ae050';
  ctx.shadowBlur = TENDRIL_BULB_GLOW_RADIUS;
  ctx.fillStyle = '#a8f070';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, TENDRIL_BULB_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
