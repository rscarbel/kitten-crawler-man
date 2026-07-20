/** Overall figure proportions (fractions of tile size, centred coordinates). */
const SIGNET_HEAD_R = 0.11;
const SIGNET_HEAD_Y = -0.28;
const SIGNET_NECK_WIDTH = 0.035;
const SIGNET_SHOULDER_Y = -0.16;
/** Extremely thin silhouette — narrow shoulders and waist. */
const SIGNET_SHOULDER_HALF_WIDTH = 0.08;
const SIGNET_WAIST_HALF_WIDTH = 0.055;
const SIGNET_WAIST_Y = 0.02;

/** Long gown falling from waist to ankle. */
const SIGNET_GOWN_HEM_HALF_WIDTH = 0.15;
const SIGNET_GOWN_HEM_Y = 0.42;
const SIGNET_GOWN_RUFFLE_COUNT = 4;
const SIGNET_GOWN_RUFFLE_R = 0.038;
/** Idle sway of the gown hem while walking. */
const SIGNET_GOWN_SWAY_AMP = 0.03;

/** Shoes peeking out under the hem. */
const SIGNET_FOOT_W = 0.05;
const SIGNET_FOOT_H = 0.03;
const SIGNET_FOOT_X = 0.05;

/** Arms — thin pale lines from the shoulders. */
const SIGNET_ARM_WIDTH = 0.035;
const SIGNET_ARM_LENGTH = 0.2;
/** Resting angle keeps the arms slightly away from the gown. */
const SIGNET_ARM_REST_ANGLE = 0.25;
const SIGNET_SUMMON_RAISE_ANGLE = 2.4;

/** Long dark hair — behind the figure, falling to the waist. */
const SIGNET_HAIR_HALF_WIDTH = 0.13;
const SIGNET_HAIR_BOTTOM_Y = 0.1;

/** Long pointed high-elf ears. */
const SIGNET_EAR_LENGTH = 0.13;
const SIGNET_EAR_HALF_HEIGHT = 0.03;

/** Short horns on the forehead. */
const SIGNET_HORN_X = 0.05;
const SIGNET_HORN_BASE_HALF_WIDTH = 0.02;
const SIGNET_HORN_LENGTH = 0.07;

/** Face. */
const SIGNET_EYE_R = 0.02;
const SIGNET_EYE_X = 0.045;
const SIGNET_EYE_Y_OFFSET = -0.01;
const SIGNET_EYE_GLOW_RADIUS = 3;
const SIGNET_FANG_Y_OFFSET = 0.055;
const SIGNET_FANG_LENGTH = 0.025;
const SIGNET_FANG_X = 0.025;

/** Living tattoos — thick dark line-work that drifts under the skin. */
const SIGNET_TATTOO_LINE_WIDTH = 0.018;
const SIGNET_ARM_TATTOO_COUNT = 2;
const SIGNET_COLLAR_TATTOO_Y = -0.13;
const SIGNET_TATTOO_DRIFT_AMP = 0.015;
const SIGNET_TATTOO_DRIFT_SPEED = 0.9;

/** Naiad shimmer — a faint blue sheen pulsing across the skin. */
const SIGNET_SHIMMER_ALPHA = 0.14;
const SIGNET_SHIMMER_PULSE_SPEED = 1.7;

/** Ink droplets streaming off the raised arms while summoning. */
const SIGNET_INK_DROP_COUNT = 4;
const SIGNET_INK_DROP_R = 0.02;
const SIGNET_INK_RISE = 0.3;

const MS_PER_SECOND = 1000;

/** Overhead elite marker geometry. */
const ELITE_MARKER_RADIUS = 0.14;
const ELITE_MARKER_CROSS_ARM = 0.08;
const ELITE_MARKER_Y_OFFSET = -0.62;
const ELITE_MARKER_BOB_AMP = 0.03;
const ELITE_MARKER_BOB_SPEED = 2.2;

const SKIN_COLOR = '#eef4ff';
const SKIN_SHADE = '#d3ddf2';
const HAIR_COLOR = '#141020';
const GOWN_COLOR = '#232a40';
const GOWN_TRIM = '#3c4666';
const TATTOO_COLOR = '#1a2030';
const TATTOO_GLOW = '#8ae0d0';
const HORN_COLOR = '#2a2230';

/**
 * Draw the Dungeon's elite mark — a black cross in a white circle — floating
 * above an elite NPC's head.
 */
export function drawEliteMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const timeSec = performance.now() / MS_PER_SECOND;
  const cx = sx + s / 2;
  const cy =
    sy +
    ELITE_MARKER_Y_OFFSET * s +
    Math.sin(timeSec * ELITE_MARKER_BOB_SPEED) * ELITE_MARKER_BOB_AMP * s;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, ELITE_MARKER_RADIUS * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx - ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.lineTo(cx + ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.moveTo(cx, cy - ELITE_MARKER_CROSS_ARM * s);
  ctx.lineTo(cx, cy + ELITE_MARKER_CROSS_ARM * s);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw Tsarina Signet — a strikingly thin half-naiad, half-high-elf woman:
 * luminescent white skin with a blue shimmer, long pointed ears, short
 * horns, fangs, a dark gown, and thick-lined living tattoos that drift
 * under her skin.
 *
 * @param summonAnim 0–1 progress through the summoning gesture (0 = idle/walk).
 */
export function drawSignetSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  summonAnim = 0,
  facingX = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const timeSec = performance.now() / MS_PER_SECOND;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const gownSway = swayPhase * SIGNET_GOWN_SWAY_AMP * s;
  const summonEase = summonAnim > 0 ? Math.sin(summonAnim * Math.PI) : 0;

  // Long hair — drawn first so it falls behind the gown and shoulders
  ctx.fillStyle = HAIR_COLOR;
  ctx.beginPath();
  ctx.moveTo(-SIGNET_HAIR_HALF_WIDTH * s * 0.5, SIGNET_HEAD_Y * s - SIGNET_HEAD_R * s * 0.8);
  ctx.quadraticCurveTo(
    -SIGNET_HAIR_HALF_WIDTH * s * 1.4,
    SIGNET_SHOULDER_Y * s,
    -SIGNET_HAIR_HALF_WIDTH * s + gownSway,
    SIGNET_HAIR_BOTTOM_Y * s,
  );
  ctx.lineTo(SIGNET_HAIR_HALF_WIDTH * s * 0.4, SIGNET_HAIR_BOTTOM_Y * s);
  ctx.quadraticCurveTo(
    SIGNET_HAIR_HALF_WIDTH * s * 0.6,
    SIGNET_SHOULDER_Y * s,
    SIGNET_HAIR_HALF_WIDTH * s * 0.5,
    SIGNET_HEAD_Y * s - SIGNET_HEAD_R * s * 0.8,
  );
  ctx.closePath();
  ctx.fill();

  // Shoes under the hem
  ctx.fillStyle = HORN_COLOR;
  ctx.fillRect(
    -SIGNET_FOOT_X * s - SIGNET_FOOT_W * s * 0.5,
    SIGNET_GOWN_HEM_Y * s,
    SIGNET_FOOT_W * s,
    SIGNET_FOOT_H * s,
  );
  ctx.fillRect(
    SIGNET_FOOT_X * s - SIGNET_FOOT_W * s * 0.5,
    SIGNET_GOWN_HEM_Y * s,
    SIGNET_FOOT_W * s,
    SIGNET_FOOT_H * s,
  );

  // Gown — a narrow trapezoid from the waist flaring gently to the hem
  ctx.fillStyle = GOWN_COLOR;
  ctx.beginPath();
  ctx.moveTo(-SIGNET_WAIST_HALF_WIDTH * s, SIGNET_WAIST_Y * s);
  ctx.lineTo(SIGNET_WAIST_HALF_WIDTH * s, SIGNET_WAIST_Y * s);
  ctx.lineTo(SIGNET_GOWN_HEM_HALF_WIDTH * s + gownSway, SIGNET_GOWN_HEM_Y * s);
  ctx.lineTo(-SIGNET_GOWN_HEM_HALF_WIDTH * s + gownSway, SIGNET_GOWN_HEM_Y * s);
  ctx.closePath();
  ctx.fill();

  // Scalloped hem ruffle
  ctx.strokeStyle = GOWN_TRIM;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  for (let i = 0; i < SIGNET_GOWN_RUFFLE_COUNT; i++) {
    const t = (i + 0.5) / SIGNET_GOWN_RUFFLE_COUNT - 0.5;
    const rx = t * 2 * SIGNET_GOWN_HEM_HALF_WIDTH * s + gownSway;
    ctx.arc(rx, SIGNET_GOWN_HEM_Y * s, SIGNET_GOWN_RUFFLE_R * s, 0, Math.PI, false);
  }
  ctx.stroke();

  // Bodice — bare pale shoulders narrowing to the waist
  ctx.fillStyle = SKIN_COLOR;
  ctx.beginPath();
  ctx.moveTo(-SIGNET_SHOULDER_HALF_WIDTH * s, SIGNET_SHOULDER_Y * s);
  ctx.lineTo(SIGNET_SHOULDER_HALF_WIDTH * s, SIGNET_SHOULDER_Y * s);
  ctx.lineTo(SIGNET_WAIST_HALF_WIDTH * s, SIGNET_WAIST_Y * s);
  ctx.lineTo(-SIGNET_WAIST_HALF_WIDTH * s, SIGNET_WAIST_Y * s);
  ctx.closePath();
  ctx.fill();

  // Collarbone tattoo — a thick drifting line across the chest
  const collarDrift = Math.sin(timeSec * SIGNET_TATTOO_DRIFT_SPEED) * SIGNET_TATTOO_DRIFT_AMP * s;
  ctx.strokeStyle = summonEase > 0 ? TATTOO_GLOW : TATTOO_COLOR;
  ctx.lineWidth = Math.max(1, SIGNET_TATTOO_LINE_WIDTH * s);
  ctx.beginPath();
  ctx.moveTo(-SIGNET_SHOULDER_HALF_WIDTH * s * 0.8, SIGNET_COLLAR_TATTOO_Y * s);
  ctx.quadraticCurveTo(
    collarDrift,
    SIGNET_COLLAR_TATTOO_Y * s + s * 0.03,
    SIGNET_SHOULDER_HALF_WIDTH * s * 0.8,
    SIGNET_COLLAR_TATTOO_Y * s,
  );
  ctx.stroke();

  // Arms — both raised while summoning, resting at the sides otherwise
  for (const side of [-1, 1]) {
    const restAngle = side * SIGNET_ARM_REST_ANGLE;
    const raisedAngle = side * SIGNET_SUMMON_RAISE_ANGLE;
    const angle = restAngle + (raisedAngle - restAngle) * summonEase;
    ctx.save();
    ctx.translate(side * SIGNET_SHOULDER_HALF_WIDTH * s * 0.9, SIGNET_SHOULDER_Y * s);
    ctx.rotate(angle);
    ctx.strokeStyle = SKIN_COLOR;
    ctx.lineWidth = SIGNET_ARM_WIDTH * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, SIGNET_ARM_LENGTH * s);
    ctx.stroke();

    // Forearm tattoos drifting along the arm
    ctx.strokeStyle = summonEase > 0 ? TATTOO_GLOW : TATTOO_COLOR;
    ctx.lineWidth = Math.max(1, SIGNET_TATTOO_LINE_WIDTH * s);
    for (let i = 0; i < SIGNET_ARM_TATTOO_COUNT; i++) {
      const armT = 0.35 + i * 0.3;
      const drift =
        Math.sin(timeSec * SIGNET_TATTOO_DRIFT_SPEED + i + side) * SIGNET_TATTOO_DRIFT_AMP * s;
      ctx.beginPath();
      ctx.moveTo(-SIGNET_ARM_WIDTH * s * 0.6, SIGNET_ARM_LENGTH * s * armT + drift);
      ctx.quadraticCurveTo(
        0,
        SIGNET_ARM_LENGTH * s * armT + drift + s * 0.015,
        SIGNET_ARM_WIDTH * s * 0.6,
        SIGNET_ARM_LENGTH * s * armT + drift,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Ink droplets streaming upward off the raised arms during a summon
  if (summonEase > 0) {
    ctx.fillStyle = TATTOO_COLOR;
    for (let i = 0; i < SIGNET_INK_DROP_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const progress = (summonAnim + i / SIGNET_INK_DROP_COUNT) % 1;
      const dropX = side * (SIGNET_SHOULDER_HALF_WIDTH + 0.12) * s;
      const dropY =
        SIGNET_SHOULDER_Y * s - SIGNET_ARM_LENGTH * s * 0.8 - progress * SIGNET_INK_RISE * s;
      ctx.globalAlpha = 1 - progress;
      ctx.beginPath();
      ctx.arc(dropX, dropY, SIGNET_INK_DROP_R * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Head
  const headY = SIGNET_HEAD_Y * s;
  ctx.fillStyle = SKIN_COLOR;
  ctx.fillRect(
    -SIGNET_NECK_WIDTH * s,
    headY + SIGNET_HEAD_R * s * 0.5,
    SIGNET_NECK_WIDTH * s * 2,
    SIGNET_HEAD_R * s,
  );
  ctx.beginPath();
  ctx.arc(0, headY, SIGNET_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();
  // Soft cheek shading keeps the face from washing out at full luminescence
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.arc(
    -SIGNET_HEAD_R * s * 0.35,
    headY + SIGNET_HEAD_R * s * 0.3,
    SIGNET_HEAD_R * s * 0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Long pointed ears — both sides, prominently horizontal
  ctx.fillStyle = SKIN_COLOR;
  for (const side of [-1, 1]) {
    const earRootX = side * SIGNET_HEAD_R * s * 0.85;
    ctx.beginPath();
    ctx.moveTo(earRootX, headY - SIGNET_EAR_HALF_HEIGHT * s);
    ctx.lineTo(earRootX + side * SIGNET_EAR_LENGTH * s, headY - SIGNET_EAR_HALF_HEIGHT * s * 2);
    ctx.lineTo(earRootX, headY + SIGNET_EAR_HALF_HEIGHT * s);
    ctx.closePath();
    ctx.fill();
  }

  // Short horns on the forehead
  ctx.fillStyle = HORN_COLOR;
  for (const side of [-1, 1]) {
    const hornX = side * SIGNET_HORN_X * s;
    ctx.beginPath();
    ctx.moveTo(hornX - SIGNET_HORN_BASE_HALF_WIDTH * s, headY - SIGNET_HEAD_R * s * 0.8);
    ctx.lineTo(hornX + SIGNET_HORN_BASE_HALF_WIDTH * s, headY - SIGNET_HEAD_R * s * 0.8);
    ctx.lineTo(
      hornX + side * SIGNET_HORN_BASE_HALF_WIDTH * s,
      headY - SIGNET_HEAD_R * s * 0.8 - SIGNET_HORN_LENGTH * s,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Hair crown over the top of the head
  ctx.fillStyle = HAIR_COLOR;
  ctx.beginPath();
  ctx.arc(0, headY, SIGNET_HEAD_R * s, Math.PI * 1.05, Math.PI * 1.95);
  ctx.quadraticCurveTo(
    SIGNET_HEAD_R * s * 0.4,
    headY - SIGNET_HEAD_R * s * 0.5,
    0,
    headY - SIGNET_HEAD_R * s * 0.2,
  );
  ctx.closePath();
  ctx.fill();

  // Two glowing eyes
  ctx.save();
  ctx.shadowColor = TATTOO_GLOW;
  ctx.shadowBlur = SIGNET_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#c0f0e0';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      side * SIGNET_EYE_X * s,
      headY + SIGNET_EYE_Y_OFFSET * s,
      SIGNET_EYE_R * s,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();

  // Sharpened fangs at the mouth line
  ctx.fillStyle = '#ffffff';
  for (const side of [-1, 1]) {
    const fangX = side * SIGNET_FANG_X * s;
    ctx.beginPath();
    ctx.moveTo(fangX - SIGNET_FANG_LENGTH * s * 0.4, headY + SIGNET_FANG_Y_OFFSET * s);
    ctx.lineTo(fangX + SIGNET_FANG_LENGTH * s * 0.4, headY + SIGNET_FANG_Y_OFFSET * s);
    ctx.lineTo(fangX, headY + SIGNET_FANG_Y_OFFSET * s + SIGNET_FANG_LENGTH * s);
    ctx.closePath();
    ctx.fill();
  }

  // Naiad shimmer — faint pulsing blue sheen over the whole figure
  const shimmer =
    SIGNET_SHIMMER_ALPHA * (0.6 + 0.4 * Math.sin(timeSec * SIGNET_SHIMMER_PULSE_SPEED));
  ctx.fillStyle = `rgba(127,184,255,${shimmer.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(
    0,
    (SIGNET_HEAD_Y + SIGNET_GOWN_HEM_Y) * 0.5 * s,
    SIGNET_GOWN_HEM_HALF_WIDTH * s,
    (SIGNET_GOWN_HEM_Y - SIGNET_HEAD_Y) * 0.55 * s,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}
