/** Body proportions (fractions of tile size) — bigger and broader than the rank-and-file clowns. */
const TERROR_BODY_RX = 0.3;
const TERROR_BODY_RY = 0.34;
const TERROR_BODY_Y_OFFSET = 0.08;
const TERROR_HEAD_R = 0.18;
const TERROR_HEAD_Y_OFFSET = -0.32;

/** Wild hair tufts. */
const TERROR_HAIR_TUFT_COUNT = 7;
const TERROR_HAIR_R = 0.05;
const TERROR_HAIR_SPAN = 0.16;
const TERROR_HAIR_Y_OFFSET = -0.44;

/** Face. */
const TERROR_NOSE_R = 0.05;
const TERROR_NOSE_Y_OFFSET = 0.01;
const TERROR_EYE_R = 0.035;
const TERROR_EYE_X_OFFSET = 0.07;
const TERROR_EYE_Y_OFFSET = -0.03;
const TERROR_EYE_GLOW_RADIUS = 6;
const TERROR_GRIN_RX = 0.09;
const TERROR_GRIN_RY = 0.05;
const TERROR_GRIN_Y_OFFSET = 0.08;

/** Oversized mallet. */
const MALLET_HANDLE_LENGTH = 0.34;
const MALLET_HANDLE_WIDTH = 0.045;
const MALLET_HEAD_W = 0.16;
const MALLET_HEAD_H = 0.1;
const MALLET_Y_OFFSET = -0.1;
const MALLET_WINDUP_ANGLE = -1.4;
const MALLET_SWING_ANGLE = 1.6;

/** Legs. */
const TERROR_LEG_WIDTH = 0.09;
const TERROR_LEG_HEIGHT = 0.2;
const TERROR_LEG_X_OFFSET = 0.14;
const TERROR_LEG_Y_OFFSET = 0.3;
const TERROR_LEG_SWING_AMP = 0.06;

/**
 * Draw Terror the Clown — Grimaldi's largest and most feared performer, a
 * hulking mini-boss guarding the big top with an oversized mallet.
 *
 * @param windupProgress 0–1 progress through the mallet windup telegraph.
 * @param swingProgress 0–1 progress through the mallet swing itself.
 * @param enraged true once Terror drops below half health — brighter, faster tell.
 */
export function drawTerrorTheClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  windupProgress = 0,
  swingProgress = 0,
  facingX = 1,
  enraged = false,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;

  // Legs
  ctx.fillStyle = '#1a1a1a';
  const legSwing = isMoving ? swayPhase * TERROR_LEG_SWING_AMP * s : 0;
  ctx.fillRect(
    -TERROR_LEG_X_OFFSET * s - TERROR_LEG_WIDTH * s * 0.5,
    TERROR_LEG_Y_OFFSET * s + legSwing,
    TERROR_LEG_WIDTH * s,
    TERROR_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    TERROR_LEG_X_OFFSET * s - TERROR_LEG_WIDTH * s * 0.5,
    TERROR_LEG_Y_OFFSET * s - legSwing,
    TERROR_LEG_WIDTH * s,
    TERROR_LEG_HEIGHT * s,
  );

  // Torso — broad, dark purple with black trim
  ctx.fillStyle = enraged ? '#6a1a2a' : '#3a1a3a';
  ctx.beginPath();
  ctx.ellipse(
    0,
    TERROR_BODY_Y_OFFSET * s,
    TERROR_BODY_RX * s,
    TERROR_BODY_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();

  // Oversized mallet — windup pulls back, swing arcs forward
  const mallet = -windupProgress * MALLET_WINDUP_ANGLE + swingProgress * MALLET_SWING_ANGLE;
  ctx.save();
  ctx.translate(TERROR_BODY_RX * s * 0.6, MALLET_Y_OFFSET * s);
  ctx.rotate(mallet);
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = MALLET_HANDLE_WIDTH * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(MALLET_HANDLE_LENGTH * s, 0);
  ctx.stroke();
  ctx.fillStyle = '#8a1010';
  ctx.fillRect(
    MALLET_HANDLE_LENGTH * s - MALLET_HEAD_W * s * 0.3,
    -MALLET_HEAD_H * s * 0.5,
    MALLET_HEAD_W * s,
    MALLET_HEAD_H * s,
  );
  ctx.restore();

  // Head
  const headY = TERROR_HEAD_Y_OFFSET * s;
  ctx.fillStyle = '#e0d0b8';
  ctx.beginPath();
  ctx.arc(0, headY, TERROR_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Wild hair tufts
  ctx.fillStyle = enraged ? '#3a8a2a' : '#2a6a1a';
  for (let i = 0; i < TERROR_HAIR_TUFT_COUNT; i++) {
    const t = i / (TERROR_HAIR_TUFT_COUNT - 1) - 0.5;
    const hx = t * TERROR_HAIR_SPAN * 2 * s;
    const hy = TERROR_HAIR_Y_OFFSET * s - Math.abs(t) * s * 0.05;
    ctx.beginPath();
    ctx.arc(hx, hy, TERROR_HAIR_R * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Red nose
  ctx.fillStyle = '#c81010';
  ctx.beginPath();
  ctx.arc(0, headY + TERROR_NOSE_Y_OFFSET * s, TERROR_NOSE_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Manic grin
  ctx.fillStyle = '#8a1010';
  ctx.beginPath();
  ctx.ellipse(
    0,
    headY + TERROR_GRIN_Y_OFFSET * s,
    TERROR_GRIN_RX * s,
    TERROR_GRIN_RY * s,
    0,
    0,
    Math.PI,
  );
  ctx.fill();

  // Eyes — brighter and faster-pulsing once enraged
  ctx.save();
  ctx.shadowColor = enraged ? '#ff6020' : '#ff2020';
  ctx.shadowBlur = TERROR_EYE_GLOW_RADIUS;
  ctx.fillStyle = enraged ? '#ff8040' : '#ff3030';
  ctx.beginPath();
  ctx.arc(
    -TERROR_EYE_X_OFFSET * s,
    headY + TERROR_EYE_Y_OFFSET * s,
    TERROR_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    TERROR_EYE_X_OFFSET * s,
    headY + TERROR_EYE_Y_OFFSET * s,
    TERROR_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
