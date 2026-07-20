/** Body proportions (fractions of tile size). */
const FAT_BODY_RX = 0.32;
const FAT_BODY_RY = 0.3;
const FAT_BODY_Y_OFFSET = 0.1;
const FAT_STRIPE_COUNT = 3;
const FAT_STRIPE_WIDTH = 0.05;

/** Head and face. */
const FAT_HEAD_R = 0.16;
const FAT_HEAD_Y_OFFSET = -0.26;
const FAT_NOSE_R = 0.045;
const FAT_NOSE_Y_OFFSET = 0.01;
const FAT_EYE_R = 0.03;
const FAT_EYE_X_OFFSET = 0.06;
const FAT_EYE_Y_OFFSET = -0.02;
const FAT_EYE_GLOW_RADIUS = 4;
const FAT_MOUTH_R = 0.06;
const FAT_MOUTH_Y_OFFSET = 0.07;

/** Oversized shoes. */
const FAT_SHOE_RX = 0.13;
const FAT_SHOE_RY = 0.06;
const FAT_SHOE_X_OFFSET = 0.2;
const FAT_SHOE_Y_OFFSET = 0.36;
const FAT_SHOE_SWING_AMP = 0.04;

/** Arms — short, swing forward on the heavy slam attack. */
const FAT_ARM_WIDTH = 0.09;
const FAT_ARM_HEIGHT = 0.2;
const FAT_ARM_X_OFFSET = 0.3;
const FAT_ARM_Y_OFFSET = -0.02;
const FAT_ATTACK_ARM_SWING = 1.1;

/**
 * Draw a Fat Clown — a tanky, slow corrupted circus performer in a striped
 * costume, with a heavy shoulder-slam attack.
 *
 * @param attackAnim 0–1 progress through the slam swing (0 = idle/walk).
 */
export function drawFatClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const shoeSwing = isMoving ? swayPhase * FAT_SHOE_SWING_AMP * s : 0;

  // Oversized shoes
  ctx.fillStyle = '#c8b030';
  ctx.beginPath();
  ctx.ellipse(
    -FAT_SHOE_X_OFFSET * s,
    FAT_SHOE_Y_OFFSET * s + shoeSwing,
    FAT_SHOE_RX * s,
    FAT_SHOE_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    FAT_SHOE_X_OFFSET * s,
    FAT_SHOE_Y_OFFSET * s - shoeSwing,
    FAT_SHOE_RX * s,
    FAT_SHOE_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Round striped torso
  ctx.fillStyle = '#c02030';
  ctx.beginPath();
  ctx.ellipse(0, FAT_BODY_Y_OFFSET * s, FAT_BODY_RX * s, FAT_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, FAT_BODY_Y_OFFSET * s, FAT_BODY_RX * s, FAT_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#f0e0c0';
  for (let i = -FAT_STRIPE_COUNT; i <= FAT_STRIPE_COUNT; i++) {
    const stripeX = i * FAT_STRIPE_WIDTH * s * 2;
    ctx.fillRect(
      stripeX - (FAT_STRIPE_WIDTH * s) / 2,
      (FAT_BODY_Y_OFFSET - FAT_BODY_RY) * s,
      FAT_STRIPE_WIDTH * s,
      FAT_BODY_RY * 2 * s,
    );
  }
  ctx.restore();

  // Arms — swing on the slam attack
  const armSwing = attackAnim > 0 ? FAT_ATTACK_ARM_SWING * Math.sin(attackAnim * Math.PI) : 0;
  ctx.save();
  ctx.translate(FAT_ARM_X_OFFSET * s, FAT_ARM_Y_OFFSET * s);
  ctx.rotate(armSwing);
  ctx.fillStyle = '#c02030';
  ctx.fillRect(-FAT_ARM_WIDTH * s * 0.5, 0, FAT_ARM_WIDTH * s, FAT_ARM_HEIGHT * s);
  ctx.restore();
  ctx.fillStyle = '#c02030';
  ctx.fillRect(
    -FAT_ARM_X_OFFSET * s - FAT_ARM_WIDTH * s * 0.5,
    FAT_ARM_Y_OFFSET * s,
    FAT_ARM_WIDTH * s,
    FAT_ARM_HEIGHT * s,
  );

  // Head
  const headY = FAT_HEAD_Y_OFFSET * s;
  ctx.fillStyle = '#e8d8c0';
  ctx.beginPath();
  ctx.arc(0, headY, FAT_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Red nose
  ctx.fillStyle = '#c81010';
  ctx.beginPath();
  ctx.arc(0, headY + FAT_NOSE_Y_OFFSET * s, FAT_NOSE_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Wide grinning mouth
  ctx.strokeStyle = '#8a1010';
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.arc(0, headY + FAT_MOUTH_Y_OFFSET * s, FAT_MOUTH_R * s, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Hollow glowing eyes
  ctx.save();
  ctx.shadowColor = '#ff2020';
  ctx.shadowBlur = FAT_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#ff3030';
  ctx.beginPath();
  ctx.arc(-FAT_EYE_X_OFFSET * s, headY + FAT_EYE_Y_OFFSET * s, FAT_EYE_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(FAT_EYE_X_OFFSET * s, headY + FAT_EYE_Y_OFFSET * s, FAT_EYE_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
