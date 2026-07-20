/** Body proportions (fractions of tile size). */
const LION_BODY_RX = 0.26;
const LION_BODY_RY = 0.18;
const LION_BODY_Y_OFFSET = 0.12;
const LION_HEAD_R = 0.15;
const LION_HEAD_Y_OFFSET = -0.1;
const LION_HEAD_X_OFFSET = 0.2;

/** Fungal mane — a ring of irregular mold-green blobs. */
const LION_MANE_BLOB_COUNT = 10;
const LION_MANE_R = 0.22;
const LION_MANE_BLOB_R_MIN = 0.05;
const LION_MANE_BLOB_R_MAX = 0.08;

/** Legs. */
const LION_LEG_WIDTH = 0.07;
const LION_LEG_HEIGHT = 0.16;
const LION_LEG_X_OFFSET = 0.16;
const LION_LEG_Y_OFFSET = 0.22;
const LION_LEG_SWING_AMP = 0.09;

/** Eyes and jaw. */
const LION_EYE_R = 0.035;
const LION_EYE_X_OFFSET = 0.06;
const LION_EYE_Y_OFFSET = -0.02;
const LION_EYE_GLOW_RADIUS = 5;
const LION_ATTACK_LUNGE = 0.1;

/** Poison aura pulse ring. */
const AURA_RING_ALPHA_BASE = 0.12;
const AURA_RING_ALPHA_PULSE = 0.08;
const AURA_RING_PULSE_SPEED = 0.15;

/**
 * Draw a Mold Lion — a mutated lion bruiser whose mane has become a mass of
 * pulsating fungal growths that emit a poison aura.
 *
 * @param attackAnim 0–1 progress through the bite lunge (0 = idle/walk).
 * @param auraRadiusPx radius of the poison aura in screen pixels, 0 to hide it.
 */
export function drawMoldLionSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
  auraRadiusPx = 0,
  auraPhase = 0,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  if (auraRadiusPx > 0) {
    const pulse =
      AURA_RING_ALPHA_BASE + Math.sin(auraPhase * AURA_RING_PULSE_SPEED) * AURA_RING_ALPHA_PULSE;
    ctx.save();
    ctx.fillStyle = `rgba(120, 200, 60, ${Math.max(0, pulse)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, auraRadiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const lunge = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) * LION_ATTACK_LUNGE * s : 0;

  // Legs
  ctx.fillStyle = '#5a6b3a';
  const legSwing = isMoving ? swayPhase * LION_LEG_SWING_AMP * s : 0;
  ctx.fillRect(
    -LION_LEG_X_OFFSET * s - LION_LEG_WIDTH * s * 0.5,
    LION_LEG_Y_OFFSET * s + legSwing,
    LION_LEG_WIDTH * s,
    LION_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    LION_LEG_X_OFFSET * s - LION_LEG_WIDTH * s * 0.5,
    LION_LEG_Y_OFFSET * s - legSwing,
    LION_LEG_WIDTH * s,
    LION_LEG_HEIGHT * s,
  );

  // Body
  ctx.fillStyle = '#7a8a4a';
  ctx.beginPath();
  ctx.ellipse(lunge, LION_BODY_Y_OFFSET * s, LION_BODY_RX * s, LION_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fungal mane — irregular mold-green blobs, gently pulsing
  const headX = lunge + LION_HEAD_X_OFFSET * s;
  const headY = LION_HEAD_Y_OFFSET * s;
  for (let i = 0; i < LION_MANE_BLOB_COUNT; i++) {
    const a = (i / LION_MANE_BLOB_COUNT) * Math.PI * 2;
    const wobble = Math.sin(auraPhase * 0.1 + i) * 0.15 + 1;
    const bx = headX + Math.cos(a) * LION_MANE_R * s * wobble;
    const by = headY + Math.sin(a) * LION_MANE_R * s * wobble;
    const r = (LION_MANE_BLOB_R_MIN + (i % 3) * 0.01) * s;
    ctx.fillStyle = i % 2 === 0 ? '#4a6b2a' : '#6a8a3a';
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(r, LION_MANE_BLOB_R_MIN * s * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5a7a3a';
  ctx.beginPath();
  ctx.arc(headX, headY, LION_MANE_BLOB_R_MAX * s * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#8a9a5a';
  ctx.beginPath();
  ctx.arc(headX, headY, LION_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Glowing toxic eyes
  ctx.save();
  ctx.shadowColor = '#c8f850';
  ctx.shadowBlur = LION_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#d8ff70';
  ctx.beginPath();
  ctx.arc(
    headX + LION_EYE_X_OFFSET * s,
    headY + LION_EYE_Y_OFFSET * s,
    LION_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
