/** Figure proportions (fractions of tile size, centred coordinates). */
const GG_HEAD_R = 0.13;
const GG_HEAD_Y = -0.2;
const GG_BODY_HALF_WIDTH = 0.12;
const GG_BODY_TOP_Y = -0.08;
const GG_BODY_BOTTOM_Y = 0.3;
/** Hunched posture — head sits forward of the body line. */
const GG_HUNCH_X = 0.04;

/** Patchy street coat. */
const GG_COAT_COLOR = '#5a4632';
const GG_COAT_PATCH_COLOR = '#43617a';
const GG_PATCH_W = 0.07;
const GG_PATCH_H = 0.06;
const GG_PATCH_X = -0.05;
const GG_PATCH_Y = 0.1;

/** Legs. */
const GG_LEG_WIDTH = 0.05;
const GG_LEG_HEIGHT = 0.14;
const GG_LEG_X = 0.06;
const GG_LEG_SWING_AMP = 0.05;

/** Arms clutch the coat closed. */
const GG_ARM_WIDTH = 0.04;
const GG_ARM_LENGTH = 0.16;

/** Big street-elf ears. */
const GG_EAR_LENGTH = 0.14;
const GG_EAR_HALF_HEIGHT = 0.035;

/** Nervous eyes. */
const GG_EYE_R = 0.025;
const GG_EYE_X = 0.05;
const GG_EYE_DART_AMP = 0.015;
const GG_EYE_DART_SPEED = 3.1;

const MS_PER_SECOND = 1000;

const SKIN_COLOR = '#c8b89a';
const SKIN_SHADE = '#a8987c';
const EYE_COLOR = '#2d2418';

/** Corpse prop proportions. */
const CORPSE_POOL_RX = 0.55;
const CORPSE_POOL_RY = 0.3;
const CORPSE_POOL_Y = 0.3;
const CORPSE_BODY_HALF_LEN = 0.32;
const CORPSE_BODY_HALF_WIDTH = 0.1;
const CORPSE_NECK_STUMP_R = 0.05;
const CORPSE_ARM_LENGTH = 0.18;

const POOL_COLOR = 'rgba(120, 16, 20, 0.75)';
const POOL_EDGE_COLOR = 'rgba(70, 8, 10, 0.85)';

/**
 * Draw GumGum — a small, hunched street elf clutching a patched coat, ears
 * too big for his head, eyes darting for the Watch. The Over City's most
 * ignorable resident, which is exactly why the cult picked his friends.
 */
export function drawGumGumSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const timeSec = performance.now() / MS_PER_SECOND;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const legSwing = isMoving ? Math.sin(walkFrame) * GG_LEG_SWING_AMP * s : 0;

  // Legs
  ctx.fillStyle = SKIN_SHADE;
  ctx.fillRect(
    -GG_LEG_X * s - GG_LEG_WIDTH * s * 0.5,
    GG_BODY_BOTTOM_Y * s + legSwing * 0.5,
    GG_LEG_WIDTH * s,
    GG_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    GG_LEG_X * s - GG_LEG_WIDTH * s * 0.5,
    GG_BODY_BOTTOM_Y * s - legSwing * 0.5,
    GG_LEG_WIDTH * s,
    GG_LEG_HEIGHT * s,
  );

  // Coat — a rounded hunched mass
  ctx.fillStyle = GG_COAT_COLOR;
  ctx.beginPath();
  ctx.moveTo(-GG_BODY_HALF_WIDTH * s, GG_BODY_BOTTOM_Y * s);
  ctx.quadraticCurveTo(
    (-GG_BODY_HALF_WIDTH - GG_HUNCH_X) * s,
    GG_BODY_TOP_Y * s,
    GG_HUNCH_X * s,
    (GG_BODY_TOP_Y - 0.06) * s,
  );
  ctx.quadraticCurveTo(
    (GG_BODY_HALF_WIDTH + GG_HUNCH_X) * s,
    GG_BODY_TOP_Y * s,
    GG_BODY_HALF_WIDTH * s,
    GG_BODY_BOTTOM_Y * s,
  );
  ctx.closePath();
  ctx.fill();

  // Mismatched patch sewn onto the coat
  ctx.fillStyle = GG_COAT_PATCH_COLOR;
  ctx.fillRect(GG_PATCH_X * s, GG_PATCH_Y * s, GG_PATCH_W * s, GG_PATCH_H * s);

  // Arms clutching the coat closed at the chest
  ctx.strokeStyle = SKIN_COLOR;
  ctx.lineWidth = GG_ARM_WIDTH * s;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * GG_BODY_HALF_WIDTH * s * 0.8, GG_BODY_TOP_Y * s + s * 0.04);
    ctx.lineTo(GG_HUNCH_X * s * side * 0.4, GG_BODY_TOP_Y * s + GG_ARM_LENGTH * s);
    ctx.stroke();
  }

  // Head — thrust forward of the hunched shoulders
  const headX = GG_HUNCH_X * s;
  const headY = GG_HEAD_Y * s;
  ctx.fillStyle = SKIN_COLOR;
  ctx.beginPath();
  ctx.arc(headX, headY, GG_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Oversized ears
  ctx.fillStyle = SKIN_COLOR;
  for (const side of [-1, 1]) {
    const earRootX = headX + side * GG_HEAD_R * s * 0.85;
    ctx.beginPath();
    ctx.moveTo(earRootX, headY - GG_EAR_HALF_HEIGHT * s);
    ctx.lineTo(earRootX + side * GG_EAR_LENGTH * s, headY - GG_EAR_HALF_HEIGHT * s * 3);
    ctx.lineTo(earRootX, headY + GG_EAR_HALF_HEIGHT * s);
    ctx.closePath();
    ctx.fill();
  }

  // Darting eyes
  const dart = Math.sin(timeSec * GG_EYE_DART_SPEED) * GG_EYE_DART_AMP * s;
  ctx.fillStyle = EYE_COLOR;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + side * GG_EYE_X * s + dart, headY, GG_EYE_R * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw GumGum's corpse — the murder-mystery's inciting prop: a small coated
 * body lying in a blood pool, ending at the shoulders.
 */
export function drawGumGumCorpse(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);

  // Blood pool
  ctx.fillStyle = POOL_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    0,
    CORPSE_POOL_Y * s * 0.5,
    CORPSE_POOL_RX * s,
    CORPSE_POOL_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = POOL_EDGE_COLOR;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();

  // Body lying on its side — coat mass, no head
  ctx.fillStyle = GG_COAT_COLOR;
  ctx.beginPath();
  ctx.ellipse(0, 0, CORPSE_BODY_HALF_LEN * s, CORPSE_BODY_HALF_WIDTH * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outflung arm
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = GG_ARM_WIDTH * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(CORPSE_BODY_HALF_LEN * s * 0.2, 0);
  ctx.lineTo(CORPSE_BODY_HALF_LEN * s * 0.5, CORPSE_ARM_LENGTH * s);
  ctx.stroke();

  // The neck stump where the head should be
  ctx.fillStyle = '#7a1014';
  ctx.beginPath();
  ctx.arc(-CORPSE_BODY_HALF_LEN * s, 0, CORPSE_NECK_STUMP_R * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
