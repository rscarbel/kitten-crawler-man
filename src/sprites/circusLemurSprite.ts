/** Body proportions (fractions of tile size). */
const LEMUR_BODY_RX = 0.2;
const LEMUR_BODY_RY = 0.16;
const LEMUR_BODY_Y_OFFSET = 0.14;
const LEMUR_HEAD_R = 0.14;
const LEMUR_HEAD_Y_OFFSET = -0.08;
const LEMUR_HEAD_X_OFFSET = 0.14;

/** Ringed tail geometry. */
const LEMUR_TAIL_RING_COUNT = 5;
const LEMUR_TAIL_RING_R = 0.06;
const LEMUR_TAIL_START_X = -0.16;
const LEMUR_TAIL_CURL_AMP = 0.16;
const LEMUR_TAIL_CURL_FREQ = 2.4;

/** Ears and eyes. */
const LEMUR_EAR_R = 0.055;
const LEMUR_EAR_X_OFFSET = 0.09;
const LEMUR_EAR_Y_OFFSET = -0.11;
const LEMUR_EYE_R = 0.035;
const LEMUR_EYE_X_OFFSET = 0.05;
const LEMUR_EYE_Y_OFFSET = -0.03;
const LEMUR_EYE_GLOW_RADIUS = 4;

/** Legs — short and skittering. */
const LEMUR_LEG_WIDTH = 0.06;
const LEMUR_LEG_HEIGHT = 0.12;
const LEMUR_LEG_X_OFFSET = 0.14;
const LEMUR_LEG_Y_OFFSET = 0.2;
const LEMUR_LEG_SWING_AMP = 0.1;

/** Attack: quick forward nip. */
const LEMUR_ATTACK_LUNGE = 0.09;

/** Knife-throw pose. */
const LEMUR_ARM_LENGTH = 0.18;
const LEMUR_ARM_ROOT_X = 0.1;
const LEMUR_ARM_ROOT_Y = 0.04;
/** Arm sweeps from raised windup to forward release across the throw. */
const LEMUR_ARM_WINDUP_ANGLE = -Math.PI * 0.65;
const LEMUR_ARM_RELEASE_SWEEP = Math.PI * 0.55;
const KNIFE_BLADE_LENGTH = 0.22;
const KNIFE_BLADE_WIDTH = 0.045;
const KNIFE_GUARD_WIDTH = 0.1;

/**
 * Draw a Former Circus Lemur — a small, sickly-mutated swarmer with a long
 * ringed tail that skitters in packs and hurls knives from its old act.
 *
 * @param attackAnim 0–1 progress through the nip lunge (0 = idle/walk).
 * @param throwAnim 0–1 progress through the knife-throw windup/release.
 */
export function drawCircusLemurSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
  throwAnim = 0,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const lunge = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) * LEMUR_ATTACK_LUNGE * s : 0;

  // Ringed tail — curls behind the body
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = LEMUR_TAIL_RING_R * s * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < LEMUR_TAIL_RING_COUNT; i++) {
    const t = i / (LEMUR_TAIL_RING_COUNT - 1);
    const tx = LEMUR_TAIL_START_X * s - t * LEMUR_TAIL_RING_R * s * 6;
    const ty =
      LEMUR_BODY_Y_OFFSET * s +
      Math.sin(t * LEMUR_TAIL_CURL_FREQ + walkFrame) * LEMUR_TAIL_CURL_AMP * s;
    if (i === 0) ctx.moveTo(tx, ty);
    else ctx.lineTo(tx, ty);
  }
  ctx.stroke();
  ctx.fillStyle = '#3a2a10';
  for (let i = 0; i < LEMUR_TAIL_RING_COUNT; i += 2) {
    const t = i / (LEMUR_TAIL_RING_COUNT - 1);
    const tx = LEMUR_TAIL_START_X * s - t * LEMUR_TAIL_RING_R * s * 6;
    const ty =
      LEMUR_BODY_Y_OFFSET * s +
      Math.sin(t * LEMUR_TAIL_CURL_FREQ + walkFrame) * LEMUR_TAIL_CURL_AMP * s;
    ctx.beginPath();
    ctx.arc(tx, ty, LEMUR_TAIL_RING_R * s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legs — short, skittering
  ctx.fillStyle = '#6b5a3a';
  const legSwing = isMoving ? swayPhase * LEMUR_LEG_SWING_AMP * s : 0;
  ctx.fillRect(
    -LEMUR_LEG_X_OFFSET * s - LEMUR_LEG_WIDTH * s * 0.5,
    LEMUR_LEG_Y_OFFSET * s + legSwing,
    LEMUR_LEG_WIDTH * s,
    LEMUR_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    LEMUR_LEG_X_OFFSET * s - LEMUR_LEG_WIDTH * s * 0.5,
    LEMUR_LEG_Y_OFFSET * s - legSwing,
    LEMUR_LEG_WIDTH * s,
    LEMUR_LEG_HEIGHT * s,
  );

  // Body — mangy, sickly ochre fur
  ctx.fillStyle = '#9a8450';
  ctx.beginPath();
  ctx.ellipse(
    lunge,
    LEMUR_BODY_Y_OFFSET * s,
    LEMUR_BODY_RX * s,
    LEMUR_BODY_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Head
  const headX = lunge + LEMUR_HEAD_X_OFFSET * s;
  const headY = LEMUR_HEAD_Y_OFFSET * s;
  ctx.fillStyle = '#ab9560';
  ctx.beginPath();
  ctx.arc(headX, headY, LEMUR_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = '#7a6540';
  const earY = headY + LEMUR_EAR_Y_OFFSET * s;
  ctx.beginPath();
  ctx.arc(headX - LEMUR_EAR_X_OFFSET * s, earY, LEMUR_EAR_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX + LEMUR_EAR_X_OFFSET * s, earY, LEMUR_EAR_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Glowing feral eyes
  ctx.save();
  ctx.shadowColor = '#e8f050';
  ctx.shadowBlur = LEMUR_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#f0f870';
  ctx.beginPath();
  ctx.arc(
    headX + LEMUR_EYE_X_OFFSET * s,
    headY + LEMUR_EYE_Y_OFFSET * s,
    LEMUR_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Throwing arm — raised with a knife during windup, sweeping forward on release
  if (throwAnim > 0) {
    const armAngle = LEMUR_ARM_WINDUP_ANGLE + throwAnim * LEMUR_ARM_RELEASE_SWEEP;
    ctx.save();
    ctx.translate(lunge + LEMUR_ARM_ROOT_X * s, LEMUR_ARM_ROOT_Y * s);
    ctx.rotate(armAngle);
    ctx.strokeStyle = '#6b5a3a';
    ctx.lineWidth = LEMUR_LEG_WIDTH * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(LEMUR_ARM_LENGTH * s, 0);
    ctx.stroke();
    // Knife stays in the paw until the release half of the throw
    if (throwAnim < 0.5) {
      ctx.translate(LEMUR_ARM_LENGTH * s, 0);
      drawKnifeShape(ctx, s);
    }
    ctx.restore();
  }

  ctx.restore();
}

/** The knife shape shared by the paw-held windup pose and the projectile. */
function drawKnifeShape(ctx: CanvasRenderingContext2D, s: number): void {
  const blade = KNIFE_BLADE_LENGTH * s;
  ctx.fillStyle = '#c8ccd4';
  ctx.beginPath();
  ctx.moveTo(0, -KNIFE_BLADE_WIDTH * s);
  ctx.lineTo(blade, 0);
  ctx.lineTo(0, KNIFE_BLADE_WIDTH * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a2a10';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(0, -KNIFE_GUARD_WIDTH * s * 0.5);
  ctx.lineTo(0, KNIFE_GUARD_WIDTH * s * 0.5);
  ctx.stroke();
}

/** Draw a spinning thrown knife projectile centred at (x, y). */
export function drawThrownKnife(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rotation: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  drawKnifeShape(ctx, s);
  ctx.restore();
}
