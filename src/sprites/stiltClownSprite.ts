/** Stilt-leg geometry (fractions of tile size). Stilts make the clown read as unnaturally tall. */
const STILT_LEG_WIDTH = 0.05;
const STILT_LEG_HEIGHT = 0.5;
const STILT_LEG_X_OFFSET = 0.1;
const STILT_LEG_Y_OFFSET = 0.05;
const STILT_LEG_SWING_AMP = 0.05;
const STILT_FOOT_R = 0.05;

/** Torso and ruff collar. */
const CLOWN_BODY_RX = 0.16;
const CLOWN_BODY_RY = 0.22;
const CLOWN_BODY_Y_OFFSET = -0.28;
const CLOWN_RUFF_R = 0.13;
const CLOWN_RUFF_Y_OFFSET = -0.42;
const CLOWN_RUFF_SPIKES = 8;

/** Head and face. */
const CLOWN_HEAD_R = 0.11;
const CLOWN_HEAD_Y_OFFSET = -0.56;
const CLOWN_NOSE_R = 0.03;
const CLOWN_NOSE_Y_OFFSET = 0.01;
const CLOWN_EYE_R = 0.025;
const CLOWN_EYE_X_OFFSET = 0.045;
const CLOWN_EYE_Y_OFFSET = -0.02;
const CLOWN_EYE_GLOW_RADIUS = 4;

/** Long-reach arm — extends far on the lunging strike. */
const CLOWN_ARM_WIDTH = 0.045;
const CLOWN_ARM_BASE_LENGTH = 0.22;
const CLOWN_ARM_LUNGE_LENGTH = 0.4;
const CLOWN_ARM_Y_OFFSET = -0.3;

/**
 * Draw a Stilt Clown — a "Slender Man dressed as a clown" horror, unnaturally
 * tall on long stilt legs, with a telegraphed long-reach lunging strike.
 *
 * @param windupProgress 0–1 progress through the pre-strike telegraph.
 * @param lungeProgress 0–1 progress through the arm's forward strike.
 */
export function drawStiltClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  windupProgress = 0,
  lungeProgress = 0,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s * 0.75;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;

  // Stilt legs — long, spindly, alternating stalk sway
  ctx.strokeStyle = '#2a2422';
  ctx.lineWidth = STILT_LEG_WIDTH * s;
  ctx.lineCap = 'round';
  const legSwing = isMoving ? swayPhase * STILT_LEG_SWING_AMP * s : 0;
  for (const side of [-1, 1] as const) {
    const hipX = side * STILT_LEG_X_OFFSET * s;
    const hipY = STILT_LEG_Y_OFFSET * s;
    const footX = hipX + (side > 0 ? legSwing : -legSwing);
    const footY = hipY + STILT_LEG_HEIGHT * s;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(footX, footY);
    ctx.stroke();
    ctx.fillStyle = '#4a1010';
    ctx.beginPath();
    ctx.arc(footX, footY, STILT_FOOT_R * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Torso — striped purple/black
  ctx.fillStyle = '#4a1a5a';
  ctx.beginPath();
  ctx.ellipse(0, CLOWN_BODY_Y_OFFSET * s, CLOWN_BODY_RX * s, CLOWN_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a0a3a';
  ctx.beginPath();
  ctx.ellipse(
    CLOWN_BODY_RX * s * 0.3,
    CLOWN_BODY_Y_OFFSET * s,
    CLOWN_BODY_RX * s * 0.55,
    CLOWN_BODY_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Long-reach arm — extends dramatically during the lunge
  const armLength =
    (CLOWN_ARM_BASE_LENGTH + lungeProgress * (CLOWN_ARM_LUNGE_LENGTH - CLOWN_ARM_BASE_LENGTH)) * s;
  const armAngle = -windupProgress * 0.3 + lungeProgress * 0.15;
  ctx.save();
  ctx.translate(0, CLOWN_ARM_Y_OFFSET * s);
  ctx.rotate(armAngle);
  ctx.strokeStyle = '#4a1a5a';
  ctx.lineWidth = CLOWN_ARM_WIDTH * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(armLength, armLength * 0.15);
  ctx.stroke();
  ctx.fillStyle = '#e8d8c0';
  ctx.beginPath();
  ctx.arc(armLength, armLength * 0.15, CLOWN_ARM_WIDTH * s * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ruff collar
  ctx.fillStyle = '#c0a0d0';
  for (let i = 0; i < CLOWN_RUFF_SPIKES; i++) {
    const a = (i / CLOWN_RUFF_SPIKES) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      Math.cos(a) * CLOWN_RUFF_R * s,
      CLOWN_RUFF_Y_OFFSET * s + Math.sin(a) * CLOWN_RUFF_R * s * 0.5,
      CLOWN_RUFF_R * s * 0.22,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Head — deathly pale
  ctx.fillStyle = '#e8d8c0';
  ctx.beginPath();
  ctx.arc(0, CLOWN_HEAD_Y_OFFSET * s, CLOWN_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Red nose
  ctx.fillStyle = '#c81010';
  ctx.beginPath();
  ctx.arc(0, CLOWN_HEAD_Y_OFFSET * s + CLOWN_NOSE_Y_OFFSET * s, CLOWN_NOSE_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Hollow glowing eyes
  ctx.save();
  ctx.shadowColor = '#ff2020';
  ctx.shadowBlur = CLOWN_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#ff3030';
  ctx.beginPath();
  ctx.arc(
    -CLOWN_EYE_X_OFFSET * s,
    CLOWN_HEAD_Y_OFFSET * s + CLOWN_EYE_Y_OFFSET * s,
    CLOWN_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    CLOWN_EYE_X_OFFSET * s,
    CLOWN_HEAD_Y_OFFSET * s + CLOWN_EYE_Y_OFFSET * s,
    CLOWN_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
