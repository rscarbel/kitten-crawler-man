/**
 * Draws a Rat Kin — a standing rat-human with optional walk animation.
 * Reusable for NPCs and enemies alike.
 * @param walkTime  Global timer used to derive animation phase.
 * @param isWalking Whether the character is currently walking (enables leg/arm swing).
 * @param facingX   +1 faces right, -1 faces left.
 */

const WALK_BOB_FREQ = 0.25;
const WALK_BOB_AMPLITUDE = 0.03;
const WALK_ARM_SWING_AMPLITUDE = 0.18;
const WALK_HEM_AMPLITUDE = 0.02;

const FLIP_CENTER_X = 0.5;

const TAIL_BASE_X = 0.5;
const TAIL_BASE_Y = 0.88;
const TAIL_CTRL_X = 0.76;
const TAIL_CTRL_Y = 0.95;
const TAIL_END_X = 0.84;
const TAIL_END_Y = 0.76;
const TAIL_LINEWIDTH = 0.03;

const ROBE_X = 0.2;
const ROBE_Y = 0.38;
const ROBE_WIDTH = 0.6;
const ROBE_HEIGHT = 0.55;
const ROBE_HEM_X = 0.2;
const ROBE_HEM_Y = 0.88;
const ROBE_HEM_HEIGHT = 0.05;
const ROBE_HEM_WALK_X = 0.2;
const ROBE_HEM_WALK_Y = 0.83;
const ROBE_HEM_WALK_CENTER_X = 0.5;
const ROBE_HEM_WALK_CENTER_Y = 0.93;

const ARM_LEFT_X = 0.06;
const ARM_RIGHT_X = 0.8;
const ARM_WIDTH = 0.14;
const ARM_HEIGHT = 0.3;
const ARM_Y_BASE = 0.4;
const ARM_SWING_SCALE = 0.5;

const PAW_LEFT_X = 0.1;
const PAW_RIGHT_X = 0.9;
const PAW_Y_OFFSET = 0.32;
const PAW_R = 0.07;

const NECK_X = 0.43;
const NECK_Y = 0.34;
const NECK_WIDTH = 0.14;
const NECK_HEIGHT = 0.07;

const EAR_LEFT_X = 0.31;
const EAR_RIGHT_X = 0.69;
const EAR_Y = 0.16;
const EAR_RX = 0.1;
const EAR_RY = 0.12;
const EAR_LEFT_ANGLE = -0.25;
const EAR_RIGHT_ANGLE = 0.25;
const EAR_INNER_RX = 0.065;
const EAR_INNER_RY = 0.078;

const HEAD_X = 0.5;
const HEAD_Y = 0.27;
const HEAD_RX = 0.19;
const HEAD_RY = 0.17;

const SNOUT_X = 0.5;
const SNOUT_Y = 0.375;
const SNOUT_RX = 0.09;
const SNOUT_RY = 0.065;

const NOSE_X = 0.5;
const NOSE_Y = 0.42;
const NOSE_R = 0.024;

const WHISKER_Y = 0.375; // shared y reference for snout
const WHISKER_LEFT_TIP_X = 0.2;
const WHISKER_RIGHT_TIP_X = 0.8;
const WHISKER_BASE_LEFT_X = 0.42;
const WHISKER_BASE_RIGHT_X = 0.58;
const WHISKER_UPPER_DROOP = 0.018;
const WHISKER_LOWER_RAISE = 0.014;
const WHISKER_LOWER_TIP_RAISE = 0.036;

const EYE_LEFT_X = 0.41;
const EYE_RIGHT_X = 0.59;
const EYE_Y = 0.255;
const EYE_IRIS_R = 0.032;
const EYE_PUPIL_R = 0.016;

const COLLAR_LEFT_X = 0.38;
const COLLAR_CENTER_X = 0.5;
const COLLAR_RIGHT_X = 0.62;
const COLLAR_TOP_Y = 0.4;
const COLLAR_BOTTOM_Y = 0.52;

export function drawRatKinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
) {
  // Body bob when walking
  const bob = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * s * WALK_BOB_AMPLITUDE : 0;
  // Arm swing angle when walking
  const armSwing = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * WALK_ARM_SWING_AMPLITUDE : 0;
  // Robe hem sway
  const hemSway = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * s * WALK_HEM_AMPLITUDE : 0;

  // Flip canvas for left-facing direction
  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * FLIP_CENTER_X, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * FLIP_CENTER_X), 0);
  }

  const bsy = sy + bob; // bobbed y origin

  // Tail (behind robe, thin curved line)
  ctx.save();
  ctx.strokeStyle = '#a08868';
  ctx.lineWidth = s * TAIL_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * TAIL_BASE_X, bsy + s * TAIL_BASE_Y);
  ctx.quadraticCurveTo(
    sx + s * TAIL_CTRL_X,
    bsy + s * TAIL_CTRL_Y,
    sx + s * TAIL_END_X,
    bsy + s * TAIL_END_Y,
  );
  ctx.stroke();
  ctx.restore();

  // Robe (dark brown-grey) with slight hem sway
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(
    sx + s * ROBE_X,
    bsy + s * ROBE_Y,
    s * ROBE_WIDTH,
    s * ROBE_HEIGHT + Math.abs(hemSway),
  );
  // Hem left edge sways
  if (isWalking) {
    ctx.fillStyle = '#2e2a26';
    ctx.beginPath();
    ctx.moveTo(sx + s * ROBE_HEM_WALK_X, bsy + s * ROBE_HEM_WALK_Y);
    ctx.lineTo(sx + s * ROBE_HEM_WALK_X + hemSway, bsy + s * ROBE_HEM_WALK_CENTER_Y);
    ctx.lineTo(sx + s * ROBE_HEM_WALK_CENTER_X, bsy + s * ROBE_HEM_WALK_CENTER_Y);
    ctx.fill();
  }

  // Robe hem detail (slightly lighter at base)
  ctx.fillStyle = '#3a3530';
  ctx.fillRect(sx + s * ROBE_HEM_X, bsy + s * ROBE_HEM_Y, s * ROBE_WIDTH, s * ROBE_HEM_HEIGHT);

  // Sleeves / arms (swing during walk)
  const leftArmY = bsy + s * ARM_Y_BASE + armSwing * s * ARM_SWING_SCALE;
  const rightArmY = bsy + s * ARM_Y_BASE - armSwing * s * ARM_SWING_SCALE;
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(sx + s * ARM_LEFT_X, leftArmY, s * ARM_WIDTH, s * ARM_HEIGHT);
  ctx.fillRect(sx + s * ARM_RIGHT_X, rightArmY, s * ARM_WIDTH, s * ARM_HEIGHT);

  // Paw-hands (small, fur-coloured)
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.arc(sx + s * PAW_LEFT_X, leftArmY + s * PAW_Y_OFFSET, s * PAW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * PAW_RIGHT_X, rightArmY + s * PAW_Y_OFFSET, s * PAW_R, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#a89888';
  ctx.fillRect(sx + s * NECK_X, bsy + s * NECK_Y, s * NECK_WIDTH, s * NECK_HEIGHT);

  // Rat ears (large, rounded, behind head)
  ctx.fillStyle = '#c8a898';
  // Left ear
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EAR_LEFT_X,
    bsy + s * EAR_Y,
    s * EAR_RX,
    s * EAR_RY,
    EAR_LEFT_ANGLE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right ear
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EAR_RIGHT_X,
    bsy + s * EAR_Y,
    s * EAR_RX,
    s * EAR_RY,
    EAR_RIGHT_ANGLE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Inner ear (pink)
  ctx.fillStyle = '#e8b8a8';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EAR_LEFT_X,
    bsy + s * EAR_Y,
    s * EAR_INNER_RX,
    s * EAR_INNER_RY,
    EAR_LEFT_ANGLE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EAR_RIGHT_X,
    bsy + s * EAR_Y,
    s * EAR_INNER_RX,
    s * EAR_INNER_RY,
    EAR_RIGHT_ANGLE,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Head (round, fur-coloured)
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.ellipse(sx + s * HEAD_X, bsy + s * HEAD_Y, s * HEAD_RX, s * HEAD_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Snout (elongated rat muzzle)
  ctx.fillStyle = '#c8b4a4';
  ctx.beginPath();
  ctx.ellipse(sx + s * SNOUT_X, bsy + s * SNOUT_Y, s * SNOUT_RX, s * SNOUT_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose (pink)
  ctx.fillStyle = '#d07080';
  ctx.beginPath();
  ctx.arc(sx + s * NOSE_X, bsy + s * NOSE_Y, s * NOSE_R, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers
  ctx.save();
  ctx.strokeStyle = 'rgba(230,225,210,0.8)';
  ctx.lineWidth = 0.6;
  const wy = bsy + s * WHISKER_Y;
  // Left whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * WHISKER_BASE_LEFT_X, wy);
  ctx.lineTo(sx + s * WHISKER_LEFT_TIP_X, wy - s * WHISKER_UPPER_DROOP);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WHISKER_BASE_LEFT_X, wy + s * WHISKER_LOWER_RAISE);
  ctx.lineTo(sx + s * WHISKER_LEFT_TIP_X, wy + s * WHISKER_LOWER_TIP_RAISE);
  ctx.stroke();
  // Right whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * WHISKER_BASE_RIGHT_X, wy);
  ctx.lineTo(sx + s * WHISKER_RIGHT_TIP_X, wy - s * WHISKER_UPPER_DROOP);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WHISKER_BASE_RIGHT_X, wy + s * WHISKER_LOWER_RAISE);
  ctx.lineTo(sx + s * WHISKER_RIGHT_TIP_X, wy + s * WHISKER_LOWER_TIP_RAISE);
  ctx.stroke();
  ctx.restore();

  // Eyes (amber/warm brown, not red like enemy rats)
  ctx.fillStyle = '#b86820';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();

  // Robe lapel / collar detail
  ctx.fillStyle = '#4a4440';
  ctx.beginPath();
  ctx.moveTo(sx + s * COLLAR_LEFT_X, bsy + s * COLLAR_TOP_Y);
  ctx.lineTo(sx + s * COLLAR_CENTER_X, bsy + s * COLLAR_BOTTOM_Y);
  ctx.lineTo(sx + s * COLLAR_RIGHT_X, bsy + s * COLLAR_TOP_Y);
  ctx.fill();

  ctx.restore(); // undo facing flip
}
