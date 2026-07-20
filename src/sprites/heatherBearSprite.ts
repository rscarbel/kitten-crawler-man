/** Overall scale — Heather reads larger than a tile. */
const BEAR_SCALE = 1.6;

/** Body geometry (fractions of scaled size, centred coordinates). */
const BEAR_BODY_RX = 0.34;
const BEAR_BODY_RY = 0.22;
const BEAR_BODY_Y = 0.08;
const BEAR_HUMP_RX = 0.18;
const BEAR_HUMP_RY = 0.13;
const BEAR_HUMP_X = -0.12;
const BEAR_HUMP_Y = -0.08;

/** Head — carried low and forward, weary. */
const BEAR_HEAD_R = 0.15;
const BEAR_HEAD_X = 0.3;
const BEAR_HEAD_Y = 0.02;
const BEAR_SNOUT_RX = 0.09;
const BEAR_SNOUT_RY = 0.06;
const BEAR_SNOUT_X_OFFSET = 0.12;
const BEAR_SNOUT_Y_OFFSET = 0.04;
const BEAR_EAR_R = 0.05;

/** Exposed skull patch across one side of the face. */
const BEAR_SKULL_R = 0.11;
const BEAR_SKULL_X_OFFSET = 0.04;
const BEAR_SKULL_Y_OFFSET = -0.04;
const BEAR_EYE_SOCKET_R = 0.035;

/** Legs. */
const BEAR_LEG_WIDTH = 0.09;
const BEAR_LEG_HEIGHT = 0.16;
const BEAR_LEG_Y = 0.24;
const BEAR_FRONT_LEG_X = 0.2;
const BEAR_BACK_LEG_X = -0.24;
const BEAR_LEG_SWING_AMP = 0.05;

/** White worms wriggling from the forepaws. */
const BEAR_WORM_COUNT = 3;
const BEAR_WORM_LENGTH = 0.09;
const BEAR_WORM_WIGGLE_AMP = 0.02;

/** Attack pose: rear up and swipe with the lead paw. */
const BEAR_REAR_LIFT = 0.14;
const BEAR_SWIPE_ARC = 1.4;
const BEAR_SWIPE_PAW_LENGTH = 0.26;
const BEAR_CLAW_COUNT = 3;
const BEAR_CLAW_LENGTH = 0.05;

const FUR_COLOR = '#6b4a2c';
const FUR_SHADE = '#54381f';
const FUR_LIGHT = '#7d5a38';
const BONE_COLOR = '#e8e2d4';
const WORM_COLOR = '#e8e4da';

/**
 * Draw Heather the Bear — the circus's beloved brown bear, transformed by
 * Scolopendra's poison: an exposed skull patch across one side of her face
 * and white parasite worms wriggling from her forepaws. She carries her
 * head low, weary.
 *
 * @param attackAnim 0..1 — 0–0.5 rears up, 0.5–1 brings the swipe down.
 */
export function drawHeatherBearSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
): void {
  const gs = s * BEAR_SCALE;
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const legSwing = swayPhase * BEAR_LEG_SWING_AMP * gs;
  // Rear up through the first half of the attack, hold height while the swipe lands.
  const rear = attackAnim > 0 ? Math.sin(Math.min(attackAnim, 0.5) * Math.PI) : 0;
  const bodyLift = rear * BEAR_REAR_LIFT * gs;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  // Legs
  ctx.fillStyle = FUR_SHADE;
  for (const [legX, swing] of [
    [BEAR_BACK_LEG_X, legSwing],
    [BEAR_FRONT_LEG_X, -legSwing],
  ] as const) {
    ctx.fillRect(
      legX * gs - BEAR_LEG_WIDTH * gs * 0.5,
      BEAR_LEG_Y * gs + swing,
      BEAR_LEG_WIDTH * gs,
      BEAR_LEG_HEIGHT * gs,
    );
  }

  // Worms wriggling out of the front paw
  ctx.strokeStyle = WORM_COLOR;
  ctx.lineWidth = Math.max(1, gs * 0.015);
  ctx.lineCap = 'round';
  for (let i = 0; i < BEAR_WORM_COUNT; i++) {
    const wormX = BEAR_FRONT_LEG_X * gs + (i - 1) * gs * 0.03;
    const wormY = (BEAR_LEG_Y + 0.14) * gs;
    const wiggle = Math.sin(walkFrame * 2 + i * 2.1) * BEAR_WORM_WIGGLE_AMP * gs;
    ctx.beginPath();
    ctx.moveTo(wormX, wormY);
    ctx.quadraticCurveTo(
      wormX + wiggle,
      wormY + BEAR_WORM_LENGTH * gs * 0.6,
      wormX + wiggle * 1.5,
      wormY + BEAR_WORM_LENGTH * gs,
    );
    ctx.stroke();
  }

  // Body — big shaggy mass with a shoulder hump
  ctx.fillStyle = FUR_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    0,
    BEAR_BODY_Y * gs - bodyLift,
    BEAR_BODY_RX * gs,
    BEAR_BODY_RY * gs,
    -rear * 0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = FUR_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    BEAR_HUMP_X * gs,
    BEAR_HUMP_Y * gs - bodyLift,
    BEAR_HUMP_RX * gs,
    BEAR_HUMP_RY * gs,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Swiping forepaw — raised with the rear, slashing down across the second half
  if (attackAnim > 0) {
    const swipeProgress = attackAnim > 0.5 ? (attackAnim - 0.5) * 2 : 0;
    const pawAngle = -BEAR_SWIPE_ARC * rear + swipeProgress * BEAR_SWIPE_ARC * 1.3;
    ctx.save();
    ctx.translate(BEAR_FRONT_LEG_X * gs, BEAR_BODY_Y * gs - bodyLift);
    ctx.rotate(pawAngle);
    ctx.strokeStyle = FUR_COLOR;
    ctx.lineWidth = BEAR_LEG_WIDTH * gs;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(BEAR_SWIPE_PAW_LENGTH * gs, 0);
    ctx.stroke();
    // Claws
    ctx.strokeStyle = BONE_COLOR;
    ctx.lineWidth = Math.max(1, gs * 0.015);
    for (let i = 0; i < BEAR_CLAW_COUNT; i++) {
      const clawY = (i - 1) * gs * 0.025;
      ctx.beginPath();
      ctx.moveTo(BEAR_SWIPE_PAW_LENGTH * gs, clawY);
      ctx.lineTo((BEAR_SWIPE_PAW_LENGTH + BEAR_CLAW_LENGTH) * gs, clawY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Head — low and forward; lifts as she rears
  const headX = BEAR_HEAD_X * gs;
  const headY = BEAR_HEAD_Y * gs - bodyLift * 1.4;
  ctx.fillStyle = FUR_COLOR;
  ctx.beginPath();
  ctx.arc(headX, headY, BEAR_HEAD_R * gs, 0, Math.PI * 2);
  ctx.fill();
  // Ear (far side hidden behind skull patch)
  ctx.beginPath();
  ctx.arc(
    headX - BEAR_HEAD_R * gs * 0.6,
    headY - BEAR_HEAD_R * gs * 0.7,
    BEAR_EAR_R * gs,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Snout
  ctx.fillStyle = FUR_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    headX + BEAR_SNOUT_X_OFFSET * gs,
    headY + BEAR_SNOUT_Y_OFFSET * gs,
    BEAR_SNOUT_RX * gs,
    BEAR_SNOUT_RY * gs,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Exposed skull patch — bone over the leading side of the face
  ctx.fillStyle = BONE_COLOR;
  ctx.beginPath();
  ctx.arc(
    headX + BEAR_SKULL_X_OFFSET * gs,
    headY + BEAR_SKULL_Y_OFFSET * gs,
    BEAR_SKULL_R * gs,
    -Math.PI * 0.6,
    Math.PI * 0.45,
  );
  ctx.closePath();
  ctx.fill();
  // Empty eye socket in the bone
  ctx.fillStyle = '#1a1410';
  ctx.beginPath();
  ctx.arc(
    headX + BEAR_SKULL_X_OFFSET * gs + BEAR_SKULL_R * gs * 0.3,
    headY + BEAR_SKULL_Y_OFFSET * gs,
    BEAR_EYE_SOCKET_R * gs,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Living eye on the fur side — small, dark, tired
  ctx.fillStyle = '#2a1c10';
  ctx.beginPath();
  ctx.arc(
    headX - BEAR_HEAD_R * gs * 0.3,
    headY - BEAR_HEAD_R * gs * 0.1,
    gs * 0.025,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}
