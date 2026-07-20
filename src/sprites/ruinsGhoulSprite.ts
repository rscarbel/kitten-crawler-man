/** Body proportions (fractions of tile size). */
const GHOUL_BODY_RX = 0.24;
const GHOUL_BODY_RY = 0.3;
const GHOUL_BODY_Y_OFFSET = 0.12;
const GHOUL_HEAD_R = 0.16;
const GHOUL_HEAD_Y_OFFSET = -0.28;
const GHOUL_HEAD_HUNCH_X = 0.08;

/** Limb geometry. */
const GHOUL_LEG_WIDTH = 0.09;
const GHOUL_LEG_HEIGHT = 0.22;
const GHOUL_LEG_X_OFFSET = 0.1;
const GHOUL_LEG_Y_OFFSET = 0.3;
const GHOUL_ARM_WIDTH = 0.08;
const GHOUL_ARM_HEIGHT = 0.26;
const GHOUL_ARM_X_OFFSET = 0.22;
const GHOUL_ARM_Y_OFFSET = 0.06;

/** Walk sway amplitude (fraction of tile size). */
const GHOUL_LEG_SWING_AMP = 0.08;

/** Attack lunge — arm swings forward and body leans in. */
const GHOUL_ATTACK_ARM_SWING = 0.7;
const GHOUL_ATTACK_LEAN = 0.06;

/** Eye glow. */
const GHOUL_EYE_R = 0.03;
const GHOUL_EYE_X_OFFSET = 0.06;
const GHOUL_EYE_Y_OFFSET = -0.02;
const GHOUL_EYE_GLOW_RADIUS = 5;

/**
 * Draw a ruins ghoul — a hunched, decayed shambler with dangling arms and
 * sickly glowing eyes, native to the Over City's monster-filled ruins.
 *
 * @param attackAnim 0–1 progress through the bite/claw swing (0 = idle/walk).
 */
export function drawRuinsGhoulSprite(
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
  const lean = attackAnim > 0 ? GHOUL_ATTACK_LEAN * s : 0;

  // Legs — alternating swing while moving
  ctx.fillStyle = '#3a3e30';
  const legSwing = isMoving ? swayPhase * GHOUL_LEG_SWING_AMP * s : 0;
  ctx.fillRect(
    -GHOUL_LEG_X_OFFSET * s - GHOUL_LEG_WIDTH * s * 0.5,
    GHOUL_LEG_Y_OFFSET * s + legSwing,
    GHOUL_LEG_WIDTH * s,
    GHOUL_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    GHOUL_LEG_X_OFFSET * s - GHOUL_LEG_WIDTH * s * 0.5,
    GHOUL_LEG_Y_OFFSET * s - legSwing,
    GHOUL_LEG_WIDTH * s,
    GHOUL_LEG_HEIGHT * s,
  );

  // Torso — tattered, hunched, sickly grey-green
  ctx.fillStyle = '#5c6b4e';
  ctx.beginPath();
  ctx.ellipse(
    lean,
    GHOUL_BODY_Y_OFFSET * s,
    GHOUL_BODY_RX * s,
    GHOUL_BODY_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#485840';
  ctx.beginPath();
  ctx.ellipse(
    lean + GHOUL_BODY_RX * s * 0.3,
    GHOUL_BODY_Y_OFFSET * s,
    GHOUL_BODY_RX * s * 0.6,
    GHOUL_BODY_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Trailing arm (back) — always dangling
  ctx.fillStyle = '#4a5640';
  ctx.fillRect(
    -GHOUL_ARM_X_OFFSET * s,
    GHOUL_ARM_Y_OFFSET * s,
    GHOUL_ARM_WIDTH * s,
    GHOUL_ARM_HEIGHT * s,
  );

  // Lead arm — swings forward on attack, otherwise dangles with a light sway
  const armSwing =
    attackAnim > 0
      ? GHOUL_ATTACK_ARM_SWING * Math.sin(attackAnim * Math.PI)
      : swayPhase * GHOUL_LEG_SWING_AMP;
  ctx.save();
  ctx.translate(GHOUL_ARM_X_OFFSET * s, GHOUL_ARM_Y_OFFSET * s);
  ctx.rotate(armSwing);
  ctx.fillStyle = '#5c6b4e';
  ctx.fillRect(-GHOUL_ARM_WIDTH * s * 0.5, 0, GHOUL_ARM_WIDTH * s, GHOUL_ARM_HEIGHT * s);
  ctx.restore();

  // Head — gaunt and hunched forward
  const headX = lean + GHOUL_HEAD_HUNCH_X * s;
  const headY = GHOUL_HEAD_Y_OFFSET * s;
  ctx.fillStyle = '#6a7a5c';
  ctx.beginPath();
  ctx.arc(headX, headY, GHOUL_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Glowing sickly eyes
  ctx.save();
  ctx.shadowColor = '#c8e850';
  ctx.shadowBlur = GHOUL_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#d8f860';
  ctx.beginPath();
  ctx.arc(
    headX + GHOUL_EYE_X_OFFSET * s,
    headY + GHOUL_EYE_Y_OFFSET * s,
    GHOUL_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
