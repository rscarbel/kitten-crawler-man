/**
 * Draws the Hoarder boss sprite at tile top-left (sx, sy) with tile size ts.
 * Extracted from TheHoarder so it can be reused for boss intro portraits.
 */
export function drawHoarderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  isEnraged = false,
  facingX = 0,
  facingY = 1,
  vomitFlash = 0,
): void {
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.5;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.92, ts * 0.55, ts * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Purple mumu dress
  ctx.fillStyle = isEnraged ? '#6b21a8' : '#7c3aed';
  // Main dress body (wide trapezoid)
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.52, sy + ts * 0.38);
  ctx.lineTo(cx + ts * 0.52, sy + ts * 0.38);
  ctx.lineTo(cx + ts * 0.62, sy + ts * 0.9);
  ctx.lineTo(cx - ts * 0.62, sy + ts * 0.9);
  ctx.closePath();
  ctx.fill();

  // Dress highlight
  ctx.fillStyle = isEnraged ? '#7c3aed' : '#8b5cf6';
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.3, sy + ts * 0.38);
  ctx.lineTo(cx + ts * 0.1, sy + ts * 0.38);
  ctx.lineTo(cx + ts * 0.2, sy + ts * 0.7);
  ctx.lineTo(cx - ts * 0.4, sy + ts * 0.7);
  ctx.closePath();
  ctx.fill();

  // Body / skin
  const skinColor = '#d4956a';
  const skinDark = '#b87850';

  // Large belly bulge (lower body, round)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.55, ts * 0.42, ts * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper torso / chest
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.3, ts * 0.35, ts * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.28, ts * 0.32, ts * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.1, ts * 0.3, ts * 0.27, 0, 0, Math.PI * 2);
  ctx.fill();

  // Double chin
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.26, ts * 0.25, ts * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, sy + ts * 0.24, ts * 0.22, ts * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair — messy bun
  ctx.fillStyle = '#3d1f0a';
  ctx.beginPath();
  ctx.ellipse(cx, sy - ts * 0.08, ts * 0.22, ts * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(cx + i * ts * 0.07, sy - ts * 0.17, ts * 0.06, ts * 0.08, i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Face
  const eyeOffX = ts * 0.1;
  const eyeY = sy + ts * 0.07;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(cx - eyeOffX, eyeY, ts * 0.07, ts * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + eyeOffX, eyeY, ts * 0.07, ts * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = isEnraged ? '#ef4444' : '#1a0a00';
  ctx.beginPath();
  ctx.ellipse(
    cx - eyeOffX + facingX * ts * 0.02,
    eyeY + facingY * ts * 0.01,
    ts * 0.035,
    ts * 0.04,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + eyeOffX + facingX * ts * 0.02,
    eyeY + facingY * ts * 0.01,
    ts * 0.035,
    ts * 0.04,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Mouth — open frown
  ctx.strokeStyle = '#7a3010';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, sy + ts * 0.17, ts * 0.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Vomit glow effect
  if (vomitFlash > 0) {
    const alpha = Math.min(1, vomitFlash / 20);
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#7fff00';
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI * 0.3 + i * 0.18;
      const len = ts * (0.3 + i * 0.12);
      ctx.beginPath();
      ctx.ellipse(
        cx + facingX * len + Math.cos(angle) * ts * 0.1,
        sy + ts * 0.18 + facingY * len + Math.sin(angle) * ts * 0.1,
        ts * 0.07,
        ts * 0.05,
        angle,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  // Arms — short stubby
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.42, sy + ts * 0.32, ts * 0.12, ts * 0.08, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.42, sy + ts * 0.32, ts * 0.12, ts * 0.08, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Enrage indicator
  if (isEnraged) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(Date.now() / 200);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * 0.68, ts * 0.68, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
