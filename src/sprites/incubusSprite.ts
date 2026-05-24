/**
 * Draws an Incubus — dusky gray skin, devil horns, forked tail, bat wings, tuxedo.
 * Reusable for NPCs and enemies alike.
 */

const WALK_BOB_FREQ = 0.25;
const WALK_BOB_AMPLITUDE = 0.03;
const WALK_ARM_SWING_AMPLITUDE = 0.18;
const WALK_WING_FLAP_FREQ = 0.18;
const WALK_WING_FLAP_AMPLITUDE = 0.04;

const FLIP_CENTER_X = 0.5;

const WING_SHOULDER_L_X = 0.22;
const WING_SHOULDER_L_Y = 0.42;
const WING_TIP_L_X = 0.32;
const WING_TIP_L_Y = 0.04;
const WING_OUTER_BOTTOM_L_X = 0.42;
const WING_OUTER_BOTTOM_L_Y = 0.48;
const WING_INNER_BOTTOM_L_X = 0.08;
const WING_INNER_BOTTOM_L_Y = 0.72;
const WING_FINGER1_L_X = 0.22;
const WING_FINGER1_L_Y = 0.43;
const WING_FINGER2_L_X = 0.18;
const WING_FINGER2_L_Y = 0.44;
const WING_FINGER2_INNER_X = 0.38;
const WING_FINGER2_INNER_Y = 0.36;
const WING_FINGER3_L_X = 0.15;
const WING_FINGER3_L_Y = 0.46;
const WING_FINGER3_INNER_X = 0.35;
const WING_FINGER3_INNER_Y = 0.58;
const WING_FINGER3_FLAP_SCALE = 0.5;
const WING_SHOULDER_R_X = 0.78;
const WING_OUTER_BOTTOM_R_X = 1.42;
const WING_TIP_R_X = 1.32;
const WING_INNER_BOTTOM_R_X = 1.08;
const WING_FINGER1_R_X = 0.78;
const WING_FINGER2_R_X = 0.82;
const WING_FINGER2_R_INNER_X = 1.38;
const WING_FINGER3_R_X = 0.85;
const WING_FINGER3_R_INNER_X = 1.35;
const WING_LINEWIDTH = 0.018;

const TAIL_BASE_X = 0.52;
const TAIL_BASE_Y = 0.88;
const TAIL_CTRL_X = 0.68;
const TAIL_CTRL_Y = 1.05;
const TAIL_END_X = 0.82;
const TAIL_END_Y = 0.78;
const TAIL_FORK1_END_X = 0.94;
const TAIL_FORK1_END_Y = 0.68;
const TAIL_FORK2_END_X = 0.88;
const TAIL_FORK2_END_Y = 0.65;
const TAIL_LINEWIDTH_THICK = 0.038;
const TAIL_LINEWIDTH_PRONG = 0.022;

const JACKET_X = 0.2;
const JACKET_Y = 0.38;
const JACKET_WIDTH = 0.6;
const JACKET_HEIGHT = 0.55;
const SHIRT_X = 0.42;
const SHIRT_Y = 0.38;
const SHIRT_WIDTH = 0.16;
const SHIRT_HEIGHT = 0.44;
const SHIRT_STUD_X = 0.5;
const SHIRT_STUD_Y_START = 0.46;
const SHIRT_STUD_SPACING = 0.1;
const SHIRT_STUD_R = 0.014;
const SHIRT_STUD_COUNT = 3;
const LAPEL_TOP_X = 0.42;
const LAPEL_BOTTOM_X = 0.2;
const LAPEL_MID_X = 0.42;
const LAPEL_TOP_Y = 0.38;
const LAPEL_BOTTOM_Y = 0.41;
const LAPEL_BOTTOM_TIP_Y = 0.57;
const LAPEL_RIGHT_TOP_X = 0.58;
const LAPEL_RIGHT_BOTTOM_X = 0.8;
const JACKET_HEM_Y = 0.88;
const JACKET_HEM_HEIGHT = 0.05;

const ARM_LEFT_X = 0.06;
const ARM_RIGHT_X = 0.8;
const ARM_WIDTH = 0.14;
const ARM_HEIGHT = 0.3;
const ARM_Y_BASE = 0.4;
const ARM_SWING_SCALE = 0.5;
const CUFF_LEFT_X = 0.07;
const CUFF_RIGHT_X = 0.81;
const CUFF_WIDTH = 0.12;
const CUFF_HEIGHT = 0.065;
const CUFF_Y_OFFSET = 0.24;
const HAND_LEFT_X = 0.1;
const HAND_RIGHT_X = 0.9;
const HAND_Y_OFFSET = 0.33;
const HAND_R = 0.065;

const NECK_X = 0.43;
const NECK_Y = 0.34;
const NECK_WIDTH = 0.14;
const NECK_HEIGHT = 0.07;

const BOW_TIE_CENTER_X = 0.5;
const BOW_TIE_Y = 0.41;
const BOW_TIE_LEFT_X = 0.36;
const BOW_TIE_RIGHT_X = 0.64;
const BOW_TIE_TOP_Y = 0.375;
const BOW_TIE_BOTTOM_Y = 0.445;
const BOW_TIE_KNOT_R = 0.023;

const HORN_LEFT_BASE_X = 0.34;
const HORN_LEFT_TIP_X = 0.26;
const HORN_LEFT_BASE_Y = 0.17;
const HORN_LEFT_TIP_Y = 0.06;
const HORN_LEFT_SIDE_X = 0.41;
const HORN_LEFT_SIDE_Y = 0.14;
const HORN_LEFT_LIGHT_BASE_X = 0.36;
const HORN_LEFT_LIGHT_TIP_X = 0.29;
const HORN_LEFT_LIGHT_BASE_Y = 0.16;
const HORN_LEFT_LIGHT_TIP_Y = 0.03;
const HORN_RIGHT_BASE_X = 0.66;
const HORN_RIGHT_TIP_X = 0.74;
const HORN_RIGHT_BASE_Y = 0.17;
const HORN_RIGHT_TIP_Y = 0.06;
const HORN_RIGHT_SIDE_X = 0.59;
const HORN_RIGHT_SIDE_Y = 0.14;
const HORN_RIGHT_LIGHT_BASE_X = 0.64;
const HORN_RIGHT_LIGHT_TIP_X = 0.71;
const HORN_RIGHT_LIGHT_BASE_Y = 0.16;
const HORN_RIGHT_LIGHT_TIP_Y = 0.03;

const HEAD_X = 0.5;
const HEAD_Y = 0.27;
const HEAD_RX = 0.19;
const HEAD_RY = 0.17;

const EYE_LEFT_X = 0.41;
const EYE_RIGHT_X = 0.59;
const EYE_Y = 0.255;
const EYE_IRIS_R = 0.032;
const EYE_PUPIL_RX = 0.009;
const EYE_PUPIL_RY = 0.022;
const EYE_GLOW_R = 0.052;
const EYE_GLOW_ALPHA = 0.25;

const NOSE_X = 0.5;
const NOSE_Y = 0.31;
const NOSE_RX = 0.036;
const NOSE_RY = 0.022;

const SMIRK_LEFT_X = 0.43;
const SMIRK_CTRL_X = 0.52;
const SMIRK_RIGHT_X = 0.6;
const SMIRK_Y = 0.35;
const SMIRK_CTRL_Y = 0.375;
const SMIRK_END_Y = 0.34;
const SMIRK_LINEWIDTH = 0.018;

export function drawIncubusSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
) {
  const bob = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * s * WALK_BOB_AMPLITUDE : 0;
  const armSwing = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * WALK_ARM_SWING_AMPLITUDE : 0;
  const wingFlap = isWalking
    ? Math.sin(walkTime * WALK_WING_FLAP_FREQ) * s * WALK_WING_FLAP_AMPLITUDE
    : 0;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * FLIP_CENTER_X, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * FLIP_CENTER_X), 0);
  }

  const bsy = sy + bob;

  // === BAT WINGS (drawn first, behind body) ===
  const wingFlapL = -wingFlap;
  const wingFlapR = wingFlap;

  // Left wing membrane
  ctx.fillStyle = '#241020';
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_SHOULDER_L_X, bsy + s * WING_SHOULDER_L_Y); // shoulder
  ctx.lineTo(sx - s * WING_TIP_L_X, bsy + s * WING_TIP_L_Y + wingFlapL); // top tip
  ctx.lineTo(sx - s * WING_OUTER_BOTTOM_L_X, bsy + s * WING_OUTER_BOTTOM_L_Y + wingFlapL); // outer bottom
  ctx.lineTo(sx - s * WING_INNER_BOTTOM_L_X, bsy + s * WING_INNER_BOTTOM_L_Y); // inner bottom
  ctx.closePath();
  ctx.fill();
  // Left wing finger bones
  ctx.strokeStyle = '#3a1830';
  ctx.lineWidth = s * WING_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER1_L_X, bsy + s * WING_FINGER1_L_Y);
  ctx.lineTo(sx - s * WING_TIP_L_X, bsy + s * WING_TIP_L_Y + wingFlapL);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER2_L_X, bsy + s * WING_FINGER2_L_Y);
  ctx.lineTo(sx - s * WING_FINGER2_INNER_X, bsy + s * WING_FINGER2_INNER_Y + wingFlapL);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER3_L_X, bsy + s * WING_FINGER3_L_Y);
  ctx.lineTo(
    sx - s * WING_FINGER3_INNER_X,
    bsy + s * WING_FINGER3_INNER_Y + wingFlapL * WING_FINGER3_FLAP_SCALE,
  );
  ctx.stroke();

  // Right wing membrane
  ctx.fillStyle = '#241020';
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_SHOULDER_R_X, bsy + s * WING_SHOULDER_L_Y);
  ctx.lineTo(sx + s * WING_TIP_R_X, bsy + s * WING_TIP_L_Y + wingFlapR);
  ctx.lineTo(sx + s * WING_OUTER_BOTTOM_R_X, bsy + s * WING_OUTER_BOTTOM_L_Y + wingFlapR);
  ctx.lineTo(sx + s * WING_INNER_BOTTOM_R_X, bsy + s * WING_INNER_BOTTOM_L_Y);
  ctx.closePath();
  ctx.fill();
  // Right wing finger bones
  ctx.strokeStyle = '#3a1830';
  ctx.lineWidth = s * WING_LINEWIDTH;
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER1_R_X, bsy + s * WING_FINGER1_L_Y);
  ctx.lineTo(sx + s * WING_TIP_R_X, bsy + s * WING_TIP_L_Y + wingFlapR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER2_R_X, bsy + s * WING_FINGER2_L_Y);
  ctx.lineTo(sx + s * WING_FINGER2_R_INNER_X, bsy + s * WING_FINGER2_INNER_Y + wingFlapR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * WING_FINGER3_R_X, bsy + s * WING_FINGER3_L_Y);
  ctx.lineTo(
    sx + s * WING_FINGER3_R_INNER_X,
    bsy + s * WING_FINGER3_INNER_Y + wingFlapR * WING_FINGER3_FLAP_SCALE,
  );
  ctx.stroke();

  // === FORKED TAIL ===
  ctx.strokeStyle = '#8b1a1a';
  ctx.lineWidth = s * TAIL_LINEWIDTH_THICK;
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
  // Fork prongs
  ctx.lineWidth = s * TAIL_LINEWIDTH_PRONG;
  ctx.beginPath();
  ctx.moveTo(sx + s * TAIL_END_X, bsy + s * TAIL_END_Y);
  ctx.lineTo(sx + s * TAIL_FORK1_END_X, bsy + s * TAIL_FORK1_END_Y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * TAIL_END_X, bsy + s * TAIL_END_Y);
  ctx.lineTo(sx + s * TAIL_FORK2_END_X, bsy + s * TAIL_FORK2_END_Y);
  ctx.stroke();

  // === TUXEDO BODY ===
  // Black jacket
  ctx.fillStyle = '#111111';
  ctx.fillRect(sx + s * JACKET_X, bsy + s * JACKET_Y, s * JACKET_WIDTH, s * JACKET_HEIGHT);
  // White shirt front
  ctx.fillStyle = '#ebebeb';
  ctx.fillRect(sx + s * SHIRT_X, bsy + s * SHIRT_Y, s * SHIRT_WIDTH, s * SHIRT_HEIGHT);
  // Shirt studs
  ctx.fillStyle = '#b8b8b8';
  for (let i = 0; i < SHIRT_STUD_COUNT; i++) {
    ctx.beginPath();
    ctx.arc(
      sx + s * SHIRT_STUD_X,
      bsy + s * SHIRT_STUD_Y_START + i * s * SHIRT_STUD_SPACING,
      s * SHIRT_STUD_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Left lapel
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(sx + s * LAPEL_TOP_X, bsy + s * LAPEL_TOP_Y);
  ctx.lineTo(sx + s * LAPEL_BOTTOM_X, bsy + s * LAPEL_BOTTOM_Y);
  ctx.lineTo(sx + s * LAPEL_MID_X, bsy + s * LAPEL_BOTTOM_TIP_Y);
  ctx.fill();
  // Right lapel
  ctx.beginPath();
  ctx.moveTo(sx + s * LAPEL_RIGHT_TOP_X, bsy + s * LAPEL_TOP_Y);
  ctx.lineTo(sx + s * LAPEL_RIGHT_BOTTOM_X, bsy + s * LAPEL_BOTTOM_Y);
  ctx.lineTo(sx + s * LAPEL_RIGHT_TOP_X, bsy + s * LAPEL_BOTTOM_TIP_Y);
  ctx.fill();
  // Hem
  ctx.fillRect(sx + s * JACKET_X, bsy + s * JACKET_HEM_Y, s * JACKET_WIDTH, s * JACKET_HEM_HEIGHT);

  // === SLEEVES / ARMS ===
  const leftArmY = bsy + s * ARM_Y_BASE + armSwing * s * ARM_SWING_SCALE;
  const rightArmY = bsy + s * ARM_Y_BASE - armSwing * s * ARM_SWING_SCALE;
  ctx.fillStyle = '#111111';
  ctx.fillRect(sx + s * ARM_LEFT_X, leftArmY, s * ARM_WIDTH, s * ARM_HEIGHT);
  ctx.fillRect(sx + s * ARM_RIGHT_X, rightArmY, s * ARM_WIDTH, s * ARM_HEIGHT);
  // White cuffs
  ctx.fillStyle = '#ebebeb';
  ctx.fillRect(sx + s * CUFF_LEFT_X, leftArmY + s * CUFF_Y_OFFSET, s * CUFF_WIDTH, s * CUFF_HEIGHT);
  ctx.fillRect(
    sx + s * CUFF_RIGHT_X,
    rightArmY + s * CUFF_Y_OFFSET,
    s * CUFF_WIDTH,
    s * CUFF_HEIGHT,
  );
  // Hands (dusky gray)
  ctx.fillStyle = '#7a7a8e';
  ctx.beginPath();
  ctx.arc(sx + s * HAND_LEFT_X, leftArmY + s * HAND_Y_OFFSET, s * HAND_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * HAND_RIGHT_X, rightArmY + s * HAND_Y_OFFSET, s * HAND_R, 0, Math.PI * 2);
  ctx.fill();

  // === NECK ===
  ctx.fillStyle = '#7a7a8e';
  ctx.fillRect(sx + s * NECK_X, bsy + s * NECK_Y, s * NECK_WIDTH, s * NECK_HEIGHT);

  // === BOW TIE ===
  ctx.fillStyle = '#8b0000';
  ctx.beginPath();
  ctx.moveTo(sx + s * BOW_TIE_CENTER_X, bsy + s * BOW_TIE_Y);
  ctx.lineTo(sx + s * BOW_TIE_LEFT_X, bsy + s * BOW_TIE_TOP_Y);
  ctx.lineTo(sx + s * BOW_TIE_LEFT_X, bsy + s * BOW_TIE_BOTTOM_Y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx + s * BOW_TIE_CENTER_X, bsy + s * BOW_TIE_Y);
  ctx.lineTo(sx + s * BOW_TIE_RIGHT_X, bsy + s * BOW_TIE_TOP_Y);
  ctx.lineTo(sx + s * BOW_TIE_RIGHT_X, bsy + s * BOW_TIE_BOTTOM_Y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6a0000';
  ctx.beginPath();
  ctx.arc(sx + s * BOW_TIE_CENTER_X, bsy + s * BOW_TIE_Y, s * BOW_TIE_KNOT_R, 0, Math.PI * 2);
  ctx.fill();

  // === DEVIL HORNS (drawn before head so head overlaps base) ===
  ctx.fillStyle = '#6b0000';
  // Left horn
  ctx.beginPath();
  ctx.moveTo(sx + s * HORN_LEFT_BASE_X, bsy + s * HORN_LEFT_BASE_Y);
  ctx.lineTo(sx + s * HORN_LEFT_TIP_X, bsy - s * HORN_LEFT_TIP_Y);
  ctx.lineTo(sx + s * HORN_LEFT_SIDE_X, bsy + s * HORN_LEFT_SIDE_Y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath();
  ctx.moveTo(sx + s * HORN_LEFT_LIGHT_BASE_X, bsy + s * HORN_LEFT_LIGHT_BASE_Y);
  ctx.lineTo(sx + s * HORN_LEFT_LIGHT_TIP_X, bsy - s * HORN_LEFT_LIGHT_TIP_Y);
  ctx.lineTo(sx + s * HORN_LEFT_SIDE_X, bsy + s * HORN_LEFT_SIDE_Y);
  ctx.closePath();
  ctx.fill();
  // Right horn
  ctx.fillStyle = '#6b0000';
  ctx.beginPath();
  ctx.moveTo(sx + s * HORN_RIGHT_BASE_X, bsy + s * HORN_RIGHT_BASE_Y);
  ctx.lineTo(sx + s * HORN_RIGHT_TIP_X, bsy - s * HORN_RIGHT_TIP_Y);
  ctx.lineTo(sx + s * HORN_RIGHT_SIDE_X, bsy + s * HORN_RIGHT_SIDE_Y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath();
  ctx.moveTo(sx + s * HORN_RIGHT_LIGHT_BASE_X, bsy + s * HORN_RIGHT_LIGHT_BASE_Y);
  ctx.lineTo(sx + s * HORN_RIGHT_LIGHT_TIP_X, bsy - s * HORN_RIGHT_LIGHT_TIP_Y);
  ctx.lineTo(sx + s * HORN_RIGHT_SIDE_X, bsy + s * HORN_RIGHT_SIDE_Y);
  ctx.closePath();
  ctx.fill();

  // === HEAD (round, dusky gray) ===
  ctx.fillStyle = '#7a7a8e';
  ctx.beginPath();
  ctx.ellipse(sx + s * HEAD_X, bsy + s * HEAD_Y, s * HEAD_RX, s * HEAD_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // === EYES (glowing red with slit pupils) ===
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  // Slit pupils
  ctx.fillStyle = '#1a0000';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EYE_LEFT_X,
    bsy + s * EYE_Y,
    s * EYE_PUPIL_RX,
    s * EYE_PUPIL_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * EYE_RIGHT_X,
    bsy + s * EYE_Y,
    s * EYE_PUPIL_RX,
    s * EYE_PUPIL_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Eye glow
  ctx.save();
  ctx.globalAlpha = EYE_GLOW_ALPHA;
  ctx.fillStyle = '#ff4400';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_GLOW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_GLOW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // === NOSE ===
  ctx.fillStyle = '#6a6a7e';
  ctx.beginPath();
  ctx.ellipse(sx + s * NOSE_X, bsy + s * NOSE_Y, s * NOSE_RX, s * NOSE_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // === SMIRK ===
  ctx.strokeStyle = '#4a3545';
  ctx.lineWidth = s * SMIRK_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * SMIRK_LEFT_X, bsy + s * SMIRK_Y);
  ctx.quadraticCurveTo(
    sx + s * SMIRK_CTRL_X,
    bsy + s * SMIRK_CTRL_Y,
    sx + s * SMIRK_RIGHT_X,
    bsy + s * SMIRK_END_Y,
  );
  ctx.stroke();

  ctx.restore(); // undo facing flip
}
