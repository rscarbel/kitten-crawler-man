/**
 * Draws Mordecai — a standing rat-human NPC.
 * Humanoid proportions with large rat ears, an elongated snout, fur colouring,
 * a dark robe, and a thin tail. Distinctly different from the crawling rat mobs.
 */
export function drawMordecaiSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
) {
  // ── Tail (behind robe, thin curved line) ─────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#a08868';
  ctx.lineWidth = s * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.5, sy + s * 0.88);
  ctx.quadraticCurveTo(
    sx + s * 0.76,
    sy + s * 0.95,
    sx + s * 0.84,
    sy + s * 0.76,
  );
  ctx.stroke();
  ctx.restore();

  // ── Robe (dark brown-grey) ───────────────────────────────────────────────
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(sx + s * 0.2, sy + s * 0.38, s * 0.6, s * 0.55);

  // Robe hem detail (slightly lighter at base)
  ctx.fillStyle = '#3a3530';
  ctx.fillRect(sx + s * 0.2, sy + s * 0.88, s * 0.6, s * 0.05);

  // ── Sleeves / arms ───────────────────────────────────────────────────────
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(sx + s * 0.06, sy + s * 0.4, s * 0.14, s * 0.3);
  ctx.fillRect(sx + s * 0.8, sy + s * 0.4, s * 0.14, s * 0.3);

  // ── Paw-hands (small, fur-coloured) ─────────────────────────────────────
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.arc(sx + s * 0.1, sy + s * 0.72, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.9, sy + s * 0.72, s * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // ── Neck ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#a89888';
  ctx.fillRect(sx + s * 0.43, sy + s * 0.34, s * 0.14, s * 0.07);

  // ── Rat ears (large, rounded, behind head) ───────────────────────────────
  ctx.fillStyle = '#c8a898';
  // Left ear
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.31,
    sy + s * 0.16,
    s * 0.1,
    s * 0.12,
    -0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right ear
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.69,
    sy + s * 0.16,
    s * 0.1,
    s * 0.12,
    0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Inner ear (pink)
  ctx.fillStyle = '#e8b8a8';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.31,
    sy + s * 0.16,
    s * 0.065,
    s * 0.078,
    -0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.69,
    sy + s * 0.16,
    s * 0.065,
    s * 0.078,
    0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // ── Head (round, fur-coloured) ───────────────────────────────────────────
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.5,
    sy + s * 0.27,
    s * 0.19,
    s * 0.17,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // ── Snout (elongated rat muzzle) ─────────────────────────────────────────
  ctx.fillStyle = '#c8b4a4';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.5,
    sy + s * 0.375,
    s * 0.09,
    s * 0.065,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Nose (pink)
  ctx.fillStyle = '#d07080';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.42, s * 0.024, 0, Math.PI * 2);
  ctx.fill();

  // ── Whiskers ─────────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = 'rgba(230,225,210,0.8)';
  ctx.lineWidth = 0.6;
  const wy = sy + s * 0.375;
  // Left whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, wy);
  ctx.lineTo(sx + s * 0.2, wy - s * 0.018);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, wy + s * 0.014);
  ctx.lineTo(sx + s * 0.2, wy + s * 0.036);
  ctx.stroke();
  // Right whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.58, wy);
  ctx.lineTo(sx + s * 0.8, wy - s * 0.018);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.58, wy + s * 0.014);
  ctx.lineTo(sx + s * 0.8, wy + s * 0.036);
  ctx.stroke();
  ctx.restore();

  // ── Eyes (amber/warm brown, not red like enemy rats) ─────────────────────
  ctx.fillStyle = '#b86820';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, sy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, sy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, sy + s * 0.255, s * 0.016, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, sy + s * 0.255, s * 0.016, 0, Math.PI * 2);
  ctx.fill();

  // ── Robe lapel / collar detail ────────────────────────────────────────────
  ctx.fillStyle = '#4a4440';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.38, sy + s * 0.4);
  ctx.lineTo(sx + s * 0.5, sy + s * 0.52);
  ctx.lineTo(sx + s * 0.62, sy + s * 0.4);
  ctx.fill();
}

/**
 * Draws a speech-bubble icon above Mordecai when the player is nearby.
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pulse: number,
) {
  const alpha = 0.7 + Math.sin(pulse * 0.12) * 0.3;
  ctx.save();
  ctx.globalAlpha = alpha;

  const bx = sx + s * 0.18;
  const by = sy - s * 0.52;
  const bw = s * 0.64;
  const bh = s * 0.35;
  const r = s * 0.06;

  // Bubble body (rounded rect)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r + s * 0.1, by + bh);
  // Tail pointing down-left
  ctx.lineTo(bx + s * 0.12, by + bh + s * 0.15);
  ctx.lineTo(bx + r + s * 0.22, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();

  // "..." dots
  ctx.fillStyle = '#334155';
  const dotY = by + bh * 0.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(bx + bw * 0.28 + i * bw * 0.22, dotY, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
