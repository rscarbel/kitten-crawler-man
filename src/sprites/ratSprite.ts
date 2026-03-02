/**
 * Draws a front-facing rat sprite into a tile-sized bounding box (sx, sy, s×s).
 * @param attackAnim  0–1 normalised bite lunge progress (peaks at 0.5). Pass 0 when idle.
 */
export function drawRatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
) {
  const bodyBob  = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.025 : 0;
  const legSwing = isMoving ?  Math.sin(walkFrame) * s * 0.04 : 0;
  // Head lurches forward during bite
  const biteLunge = Math.sin(attackAnim * Math.PI) * s * 0.06;

  // ── Tail (drawn behind body) ────────────────────────────────────────────
  const tailWave = isMoving ? Math.sin(walkFrame * 1.6) * s * 0.07 : 0;
  ctx.save();
  ctx.strokeStyle = '#606060';
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.5, sy + s * 0.80 + bodyBob);
  ctx.bezierCurveTo(
    sx + s * 0.65, sy + s * 0.94 + bodyBob,
    sx + s * 0.82 + tailWave, sy + s * 0.90 + bodyBob,
    sx + s * 0.94, sy + s * 0.78 + bodyBob,
  );
  ctx.stroke();
  ctx.restore();

  // ── Hind feet ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#c0a080';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.33, sy + s * 0.88 + bodyBob + legSwing * 0.5,
    s * 0.08, s * 0.042, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.65, sy + s * 0.88 + bodyBob - legSwing * 0.5,
    s * 0.08, s * 0.042, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Legs ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#808080';
  ctx.fillRect(sx + s * 0.30, sy + s * 0.72 + bodyBob + legSwing, s * 0.10, s * 0.17);
  ctx.fillRect(sx + s * 0.58, sy + s * 0.72 + bodyBob - legSwing, s * 0.10, s * 0.17);

  // ── Body ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#8c8c8c';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.50, sy + s * 0.60 + bodyBob, s * 0.23, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Front arms ──────────────────────────────────────────────────────────
  const armSwing = isMoving ? -Math.sin(walkFrame) * s * 0.02 : 0;
  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(sx + s * 0.18, sy + s * 0.55 + bodyBob + armSwing, s * 0.10, s * 0.10);
  ctx.fillRect(sx + s * 0.72, sy + s * 0.55 + bodyBob - armSwing, s * 0.10, s * 0.10);

  // ── Round ears ──────────────────────────────────────────────────────────
  ctx.fillStyle = '#b08888';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.34, sy + s * 0.22 + bodyBob, s * 0.085, s * 0.075, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.66, sy + s * 0.22 + bodyBob, s * 0.085, s * 0.075,  0.25, 0, Math.PI * 2);
  ctx.fill();
  // Inner ear
  ctx.fillStyle = '#d49898';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.34, sy + s * 0.22 + bodyBob, s * 0.052, s * 0.046, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.66, sy + s * 0.22 + bodyBob, s * 0.052, s * 0.046,  0.25, 0, Math.PI * 2);
  ctx.fill();

  // ── Head ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#949494';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.50, sy + s * 0.33 + bodyBob + biteLunge,
    s * 0.165, s * 0.148, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Snout (pointy) ──────────────────────────────────────────────────────
  ctx.fillStyle = '#a89898';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.50, sy + s * 0.43 + bodyBob + biteLunge,
    s * 0.09, s * 0.068, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#d07080';
  ctx.beginPath();
  ctx.arc(sx + s * 0.50, sy + s * 0.482 + bodyBob + biteLunge, s * 0.026, 0, Math.PI * 2);
  ctx.fill();

  // ── Whiskers ────────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = 'rgba(220,220,220,0.85)';
  ctx.lineWidth = 0.7;
  const wy = sy + s * 0.445 + bodyBob + biteLunge;
  const wx = sx + s * 0.50;
  ctx.beginPath(); ctx.moveTo(wx - s * 0.07, wy - s * 0.005); ctx.lineTo(wx - s * 0.26, wy - s * 0.025); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wx - s * 0.07, wy + s * 0.012); ctx.lineTo(wx - s * 0.26, wy + s * 0.032); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wx + s * 0.07, wy - s * 0.005); ctx.lineTo(wx + s * 0.26, wy - s * 0.025); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wx + s * 0.07, wy + s * 0.012); ctx.lineTo(wx + s * 0.26, wy + s * 0.032); ctx.stroke();
  ctx.restore();

  // ── Eyes (beady red) ────────────────────────────────────────────────────
  ctx.fillStyle = '#cc1122';
  ctx.beginPath();
  ctx.arc(sx + s * 0.40, sy + s * 0.295 + bodyBob + biteLunge, s * 0.034, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.60, sy + s * 0.295 + bodyBob + biteLunge, s * 0.034, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(sx + s * 0.40, sy + s * 0.295 + bodyBob + biteLunge, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.60, sy + s * 0.295 + bodyBob + biteLunge, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
}
