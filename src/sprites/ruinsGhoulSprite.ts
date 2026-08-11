/**
 * A ruins ghoul: an emaciated, skull-headed corpse with a hunched spine, arms
 * that hang past its knees, and a hanging jaw.
 *
 * The palette is deliberately pale grey-lilac with amber eyes and a near-black
 * rim on every shape. The ghoul lives on the third floor's grass, and a
 * green-skinned creature at the grass's own hue is invisible there no matter how
 * well it is drawn — value and hue both have to leave the background, and the rim
 * is what holds the silhouette together at tile size once they do.
 */

const RIM = '#221b21';
const RIM_WIDTH = 0.022;

const FLESH_LIGHT = '#d3c7cb';
const FLESH_MID = '#a4949c';
const FLESH_SHADOW = '#786974';
const BONE = '#ece3d6';
const WOUND = '#742b36';
const SHROUD = '#7d6c49';
const SHROUD_SHADOW = '#584a31';
const SOCKET = '#241a20';
const EYE_GLOW = '#ffc63c';
const EYE_CORE = '#fff0b4';
const CONTACT_SHADOW = 'rgba(0, 0, 0, 0.34)';

/** Skeleton stations, as fractions of tile size. Negative y is up. */
const GROUND_Y = 0.46;
const HIP_Y = 0.03;
const HIP_HALF_WIDTH = 0.085;
const KNEE_Y = 0.25;
const CHEST_Y = -0.2;
const SHOULDER_Y = -0.27;
const SHOULDER_HALF_WIDTH = 0.15;
const NECK_Y = -0.35;
const HEAD_CENTRE_Y = -0.47;
const HEAD_R = 0.125;
/** The skull rides forward of the shoulders — the hunch is most of the read. */
const HEAD_FORWARD = 0.07;

const THIGH_WIDTH = 0.075;
const SHIN_WIDTH = 0.05;
const FOOT_LENGTH = 0.12;
const FOOT_HEIGHT = 0.035;
const UPPER_ARM_WIDTH = 0.062;
const FOREARM_WIDTH = 0.045;
const ELBOW_OUT = 0.055;
const HAND_Y = 0.28;
const CLAW_LENGTH = 0.075;
const CLAW_COUNT = 3;
const CLAW_SPREAD = 0.45;

const TORSO_TOP_HALF_WIDTH = 0.145;
const TORSO_WAIST_HALF_WIDTH = 0.085;
const HUMP_CENTRE_X = -0.09;
const HUMP_CENTRE_Y = -0.27;
const HUMP_RX = 0.095;
const HUMP_RY = 0.085;
const VERTEBRA_COUNT = 4;
const VERTEBRA_R = 0.016;

const RIB_COUNT = 3;
const RIB_TOP_Y = -0.15;
const RIB_SPACING = 0.055;
const RIB_INNER_X = 0.0;
const RIB_OUTER_X = 0.125;
const RIB_SAG = 0.028;
const RIB_WIDTH = 0.016;

const SHROUD_TOP_Y = -0.02;
const SHROUD_HEM_Y = 0.24;
const SHROUD_HALF_WIDTH = 0.125;
const SHROUD_TATTER_COUNT = 5;
const SHROUD_TATTER_DEPTH = 0.075;

const JAW_LENGTH = 0.1;
const JAW_HEIGHT = 0.045;
const JAW_HANG = 0.055;
const JAW_ATTACK_HANG = 0.045;
const TOOTH_COUNT = 3;
const TOOTH_HEIGHT = 0.03;

const NEAR_SOCKET_X = 0.055;
const FAR_SOCKET_X = -0.02;
const SOCKET_Y = -0.015;
const SOCKET_RX = 0.045;
const SOCKET_RY = 0.038;
const FAR_SOCKET_SCALE = 0.72;
const EYE_R = 0.018;
const EYE_GLOW_BLUR = 6;

const BROW_WIDTH = 0.02;

/** The nasal void: the single cue that reads "skull" rather than "helmet". */
const NOSE_X = 0.085;
const NOSE_Y = 0.035;
const NOSE_HALF_WIDTH = 0.022;
const NOSE_HEIGHT = 0.04;

const CONTACT_SHADOW_RX = 0.2;
const CONTACT_SHADOW_RY = 0.055;

/** Walk cycle. */
const LEG_SWING = 0.1;
const ARM_SWING = 0.07;
const BODY_BOB = 0.022;
const HEAD_LURCH = 0.018;

/**
 * Attack: the lead arm rakes across and the whole body pitches into it. The reach
 * is a hand position in tile fractions, not an angle — the claws have to land
 * about where the ghoul's attack range is, which is just over one tile.
 */
const ATTACK_REACH = 0.34;
const ATTACK_HAND_Y = -0.16;
const ATTACK_LEAN = 0.075;
const ATTACK_LUNGE_SHOULDER = 0.05;

/** A tapered limb segment, as a quad from a wide joint to a narrow one. */
function segmentPath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w1: number,
  w2: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.closePath();
}

/** Fill the current path and rim it, which is what keeps the shape legible at 32 px. */
function inkPath(ctx: CanvasRenderingContext2D, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = RIM;
  ctx.stroke();
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  s: number,
  hipX: number,
  swing: number,
  fill: string,
): void {
  const kneeX = hipX + swing * 0.5;
  const footX = hipX + swing;
  segmentPath(ctx, hipX * s, HIP_Y * s, kneeX * s, KNEE_Y * s, THIGH_WIDTH * s, SHIN_WIDTH * s);
  inkPath(ctx, fill);
  segmentPath(
    ctx,
    kneeX * s,
    KNEE_Y * s,
    footX * s,
    GROUND_Y * s,
    SHIN_WIDTH * s,
    SHIN_WIDTH * 0.8 * s,
  );
  inkPath(ctx, fill);
  ctx.beginPath();
  ctx.moveTo((footX - SHIN_WIDTH * 0.8) * s, GROUND_Y * s);
  ctx.lineTo((footX + FOOT_LENGTH) * s, GROUND_Y * s);
  ctx.lineTo((footX + FOOT_LENGTH * 0.7) * s, (GROUND_Y + FOOT_HEIGHT) * s);
  ctx.lineTo((footX - SHIN_WIDTH * 0.8) * s, (GROUND_Y + FOOT_HEIGHT) * s);
  ctx.closePath();
  inkPath(ctx, fill);
}

/** The hooked hand at the end of an arm — three long claws, splayed. */
function drawClaws(
  ctx: CanvasRenderingContext2D,
  s: number,
  handX: number,
  handY: number,
  reach: number,
): void {
  for (let i = 0; i < CLAW_COUNT; i++) {
    const spread = (i / (CLAW_COUNT - 1) - 0.5) * CLAW_SPREAD;
    const angle = reach + spread;
    ctx.beginPath();
    ctx.moveTo(handX * s, handY * s);
    ctx.lineTo(
      (handX + Math.sin(angle) * CLAW_LENGTH) * s,
      (handY + Math.cos(angle) * CLAW_LENGTH) * s,
    );
    ctx.strokeStyle = RIM;
    ctx.lineWidth = Math.max(1, RIM_WIDTH * s * 2.2);
    ctx.stroke();
    ctx.strokeStyle = BONE;
    ctx.lineWidth = Math.max(1, RIM_WIDTH * s * 1.1);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(1, RIM_WIDTH * s);
}

/**
 * One arm, posed by where its hand goes rather than by an angle.
 *
 * The elbow is derived from the shoulder and the hand and bowed outward, so a
 * hand placed anywhere in reach produces a plausible bend — a dangling arm on the
 * walk, a horizontal one mid-rake — without the caller doing any trigonometry.
 */
function drawArm(
  ctx: CanvasRenderingContext2D,
  s: number,
  shoulderX: number,
  shoulderY: number,
  handX: number,
  handY: number,
  fill: string,
): void {
  const elbowX = (shoulderX + handX) / 2 + ELBOW_OUT;
  const elbowY = (shoulderY + handY) / 2;
  segmentPath(
    ctx,
    shoulderX * s,
    shoulderY * s,
    elbowX * s,
    elbowY * s,
    UPPER_ARM_WIDTH * s,
    FOREARM_WIDTH * s,
  );
  inkPath(ctx, fill);
  segmentPath(
    ctx,
    elbowX * s,
    elbowY * s,
    handX * s,
    handY * s,
    FOREARM_WIDTH * s,
    FOREARM_WIDTH * 0.75 * s,
  );
  inkPath(ctx, fill);
  // Claws carry on along the forearm, so they point where the hand is going.
  drawClaws(ctx, s, handX, handY, Math.atan2(handX - elbowX, handY - elbowY));
}

/** Skull, hanging jaw and burning sockets — the part that says "ghoul". */
function drawSkull(
  ctx: CanvasRenderingContext2D,
  s: number,
  headX: number,
  headY: number,
  jawOpen: number,
): void {
  ctx.beginPath();
  ctx.ellipse(headX * s, headY * s, HEAD_R * s, HEAD_R * 1.05 * s, 0, 0, Math.PI * 2);
  inkPath(ctx, FLESH_LIGHT);

  const jawTopY = headY + HEAD_R * 0.55;
  const jawDrop = jawTopY + jawOpen;
  ctx.beginPath();
  ctx.moveTo((headX - HEAD_R * 0.5) * s, jawTopY * s);
  ctx.lineTo((headX + JAW_LENGTH) * s, (jawDrop - JAW_HEIGHT * 0.2) * s);
  ctx.lineTo((headX + JAW_LENGTH * 0.85) * s, (jawDrop + JAW_HEIGHT) * s);
  ctx.lineTo((headX - HEAD_R * 0.5) * s, (jawDrop + JAW_HEIGHT * 0.6) * s);
  ctx.closePath();
  inkPath(ctx, FLESH_MID);

  ctx.fillStyle = SOCKET;
  ctx.fillRect(
    (headX - HEAD_R * 0.45) * s,
    jawTopY * s,
    (JAW_LENGTH + HEAD_R * 0.45) * s,
    Math.max(1, jawOpen * s),
  );

  ctx.fillStyle = BONE;
  const toothPitch = JAW_LENGTH / TOOTH_COUNT;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const tx = headX + i * toothPitch;
    // Upper and lower rows are offset from each other and leave gaps: an even
    // full-width row of teeth reads as a helmet grille rather than a jaw.
    ctx.fillRect(tx * s, jawTopY * s, toothPitch * 0.34 * s, TOOTH_HEIGHT * s);
    ctx.fillRect(
      (tx + toothPitch * 0.5) * s,
      (jawDrop - TOOTH_HEIGHT * 0.7) * s,
      toothPitch * 0.3 * s,
      TOOTH_HEIGHT * 0.7 * s,
    );
  }

  ctx.fillStyle = SOCKET;
  ctx.beginPath();
  ctx.moveTo((headX + NOSE_X) * s, (headY + NOSE_Y) * s);
  ctx.lineTo((headX + NOSE_X - NOSE_HALF_WIDTH) * s, (headY + NOSE_Y + NOSE_HEIGHT) * s);
  ctx.lineTo((headX + NOSE_X + NOSE_HALF_WIDTH) * s, (headY + NOSE_Y + NOSE_HEIGHT) * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = SOCKET;
  ctx.beginPath();
  ctx.ellipse(
    (headX + NEAR_SOCKET_X) * s,
    (headY + SOCKET_Y) * s,
    SOCKET_RX * s,
    SOCKET_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    (headX + FAR_SOCKET_X) * s,
    (headY + SOCKET_Y) * s,
    SOCKET_RX * FAR_SOCKET_SCALE * s,
    SOCKET_RY * FAR_SOCKET_SCALE * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.strokeStyle = FLESH_SHADOW;
  ctx.lineWidth = Math.max(1, BROW_WIDTH * s);
  ctx.beginPath();
  ctx.moveTo((headX + FAR_SOCKET_X - SOCKET_RX) * s, (headY + SOCKET_Y - SOCKET_RY) * s);
  ctx.lineTo((headX + NEAR_SOCKET_X + SOCKET_RX) * s, (headY + SOCKET_Y - SOCKET_RY * 1.3) * s);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, RIM_WIDTH * s);

  ctx.save();
  ctx.shadowColor = EYE_GLOW;
  ctx.shadowBlur = EYE_GLOW_BLUR;
  ctx.fillStyle = EYE_GLOW;
  for (const socketX of [NEAR_SOCKET_X, FAR_SOCKET_X]) {
    ctx.beginPath();
    ctx.arc((headX + socketX) * s, (headY + SOCKET_Y) * s, EYE_R * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = EYE_CORE;
  for (const socketX of [NEAR_SOCKET_X, FAR_SOCKET_X]) {
    ctx.beginPath();
    ctx.arc((headX + socketX) * s, (headY + SOCKET_Y) * s, EYE_R * 0.45 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The torn burial shroud still hanging off its hips. */
function drawShroud(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(-SHROUD_HALF_WIDTH * s, SHROUD_TOP_Y * s);
  ctx.lineTo(SHROUD_HALF_WIDTH * s, SHROUD_TOP_Y * s);
  // A sawtooth hem, alternating between the hem line and a notch above it. The
  // two must land on *different* x, or each tatter is a zero-width spike that
  // paints nothing and the shroud comes out a plain rectangle.
  const hemSteps = SHROUD_TATTER_COUNT * 2;
  for (let i = hemSteps; i >= 0; i--) {
    const t = i / hemSteps;
    const x = (t * 2 - 1) * SHROUD_HALF_WIDTH;
    const notch = i % 2 === 0 ? 0 : SHROUD_TATTER_DEPTH;
    ctx.lineTo(x * s, (SHROUD_HEM_Y - notch) * s);
  }
  ctx.closePath();
  inkPath(ctx, SHROUD);
  ctx.beginPath();
  ctx.moveTo(-SHROUD_HALF_WIDTH * s, SHROUD_TOP_Y * s);
  ctx.lineTo(-SHROUD_HALF_WIDTH * 0.35 * s, SHROUD_HEM_Y * s);
  ctx.lineTo(-SHROUD_HALF_WIDTH * s, SHROUD_HEM_Y * s);
  ctx.closePath();
  ctx.fillStyle = SHROUD_SHADOW;
  ctx.fill();
}

/** Starved ribcage with the wound its death left. */
function drawRibs(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.strokeStyle = FLESH_SHADOW;
  ctx.lineWidth = Math.max(1, RIB_WIDTH * s);
  for (let i = 0; i < RIB_COUNT; i++) {
    const y = RIB_TOP_Y + i * RIB_SPACING;
    ctx.beginPath();
    ctx.moveTo(RIB_INNER_X * s, y * s);
    ctx.quadraticCurveTo(
      RIB_OUTER_X * 0.6 * s,
      (y + RIB_SAG) * s,
      RIB_OUTER_X * s,
      (y + RIB_SAG * 0.4) * s,
    );
    ctx.stroke();
  }
  ctx.fillStyle = WOUND;
  ctx.beginPath();
  ctx.ellipse(
    RIB_OUTER_X * 0.35 * s,
    (RIB_TOP_Y + RIB_SPACING) * s,
    RIB_WIDTH * 1.6 * s,
    RIB_WIDTH * 2.4 * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.lineWidth = Math.max(1, RIM_WIDTH * s);
}

/**
 * Draw a ruins ghoul.
 *
 * @param attackAnim 0–1 progress through the claw rake (0 = idle/walk).
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

  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + (GROUND_Y + FOOT_HEIGHT) * s,
    CONTACT_SHADOW_RX * s,
    CONTACT_SHADOW_RY * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, RIM_WIDTH * s);

  const gait = isMoving ? Math.sin(walkFrame) : 0;
  const attackSwell = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) : 0;
  const lean = attackSwell * ATTACK_LEAN;
  const bob = isMoving ? Math.abs(gait) * BODY_BOB : 0;

  ctx.translate(0, bob * s);

  // Trailing leg and arm first, so the near side of the body overlaps them.
  drawLeg(ctx, s, -HIP_HALF_WIDTH, -gait * LEG_SWING, FLESH_SHADOW);
  const trailShoulderX = -SHOULDER_HALF_WIDTH * 0.4;
  drawArm(
    ctx,
    s,
    trailShoulderX,
    SHOULDER_Y,
    trailShoulderX + ELBOW_OUT * 0.5 + gait * ARM_SWING,
    HAND_Y,
    FLESH_SHADOW,
  );

  ctx.beginPath();
  ctx.ellipse(HUMP_CENTRE_X * s, HUMP_CENTRE_Y * s, HUMP_RX * s, HUMP_RY * s, 0, 0, Math.PI * 2);
  inkPath(ctx, FLESH_MID);
  ctx.fillStyle = FLESH_SHADOW;
  for (let i = 0; i < VERTEBRA_COUNT; i++) {
    const t = i / (VERTEBRA_COUNT - 1);
    ctx.beginPath();
    ctx.arc(
      (HUMP_CENTRE_X - HUMP_RX * 0.45) * s,
      (HUMP_CENTRE_Y - HUMP_RY * 0.5 + t * HUMP_RY * 1.4) * s,
      VERTEBRA_R * s,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo((-TORSO_TOP_HALF_WIDTH + lean) * s, CHEST_Y * s);
  ctx.lineTo((TORSO_TOP_HALF_WIDTH + lean) * s, CHEST_Y * s);
  ctx.lineTo(TORSO_WAIST_HALF_WIDTH * s, HIP_Y * s);
  ctx.lineTo(-TORSO_WAIST_HALF_WIDTH * s, HIP_Y * s);
  ctx.closePath();
  inkPath(ctx, FLESH_LIGHT);
  drawRibs(ctx, s);

  drawLeg(ctx, s, HIP_HALF_WIDTH, gait * LEG_SWING, FLESH_MID);
  drawShroud(ctx, s);

  segmentPath(
    ctx,
    lean * s,
    CHEST_Y * s,
    (HEAD_FORWARD + lean) * s,
    NECK_Y * s,
    UPPER_ARM_WIDTH * s,
    UPPER_ARM_WIDTH * 0.8 * s,
  );
  inkPath(ctx, FLESH_MID);

  const headLurch = isMoving ? gait * HEAD_LURCH : 0;
  drawSkull(
    ctx,
    s,
    HEAD_FORWARD + lean + headLurch,
    HEAD_CENTRE_Y,
    attackSwell > 0 ? JAW_HANG + attackSwell * JAW_ATTACK_HANG : JAW_HANG,
  );

  // Lead arm last: it passes in front of the body, and on a rake it swings out
  // ahead of the skull.
  const leadShoulderX = SHOULDER_HALF_WIDTH + attackSwell * ATTACK_LUNGE_SHOULDER;
  const dangleHandX = leadShoulderX + ELBOW_OUT * 0.5 - gait * ARM_SWING;
  const rakeHandX = leadShoulderX + ATTACK_REACH;
  drawArm(
    ctx,
    s,
    leadShoulderX,
    SHOULDER_Y,
    dangleHandX + (rakeHandX - dangleHandX) * attackSwell,
    HAND_Y + (ATTACK_HAND_Y - HAND_Y) * attackSwell,
    FLESH_LIGHT,
  );

  ctx.restore();
}
