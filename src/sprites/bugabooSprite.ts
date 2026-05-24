/**
 * Draws a Bugaboo — enormous bear-shaped body with no neck, huge owl-like eyes,
 * comically skinny legs, absurdly thin arms, obsidian-colored hair.
 * Both terrifying and cartoonish. Reusable for NPCs and enemies alike.
 */

const WALK_BOB_FREQ = 0.25;
const WALK_BOB_AMPLITUDE = 0.03;
const WALK_ARM_SWING_AMPLITUDE = 0.22;
const WALK_LEG_AMPLITUDE = 0.04;

const FLIP_CENTER_X = 0.5;

const LEG_LEFT_BASE_X = 0.38;
const LEG_RIGHT_BASE_X = 0.62;
const LEG_BASE_Y = 0.82;
const LEG_SHUIFLE_SCALE = 0.5;
const LEG_LEFT_END_X = 0.35;
const LEG_RIGHT_END_X = 0.65;
const LEG_END_Y = 0.97;
const LEG_LINEWIDTH = 0.045;
const FOOT_Y = 0.98;
const FOOT_RX = 0.04;
const FOOT_RY = 0.02;

const ARM_LEFT_SHOULDER_X = 0.14;
const ARM_RIGHT_SHOULDER_X = 0.86;
const ARM_SHOULDER_Y = 0.4;
const ARM_LEFT_END_X = 0.1;
const ARM_RIGHT_END_X = 0.9;
const ARM_END_Y = 0.88;
const ARM_SWING_SCALE = 0.6;
const ARM_CTRL_Y_ATTACK_SCALE = 0.22;
const ARM_CTRL_Y_IDLE = 0.65;
const ARM_LINEWIDTH = 0.035;
const ARM_SCRATCH_LIFT_SCALE = 0.54;
const CLAW_R = 0.03;

const BODY_CENTER_X = 0.5;
const BODY_CENTER_Y = 0.52;
const BODY_RX = 0.36;
const BODY_RY = 0.38;

const HEAD_CENTER_X = 0.5;
const HEAD_CENTER_Y = 0.24;
const HEAD_RX = 0.26;
const HEAD_RY = 0.22;

const EAR_LEFT_X = 0.28;
const EAR_RIGHT_X = 0.72;
const EAR_Y = 0.08;
const EAR_R_OUTER = 0.07;
const EAR_R_INNER = 0.04;

const HAIR_LINEWIDTH = 0.015;
const HAIR_TUFT_DX = 0.02;
const HAIR_TUFT_DY = 0.04;
const HAIR_TUFT_DX2 = 0.015;
const HAIR_TUFT_DY2 = 0.035;

const EYE_LEFT_X = 0.36;
const EYE_RIGHT_X = 0.64;
const EYE_Y = 0.24;
const EYE_RX = 0.1;
const EYE_RY = 0.11;
const EYE_OUTLINE_LINEWIDTH = 0.018;
const EYE_IRIS_Y = 0.25;
const EYE_IRIS_R = 0.065;
const EYE_PUPIL_Y = 0.25;
const EYE_PUPIL_R = 0.035;
const EYE_GLOW_ALPHA = 0.15;
const EYE_GLOW_R = 0.12;
const EYE_HIGHLIGHT_LEFT_X = 0.35;
const EYE_HIGHLIGHT_RIGHT_X = 0.63;
const EYE_HIGHLIGHT_Y = 0.235;
const EYE_HIGHLIGHT_R = 0.012;

const NOSE_X = 0.5;
const NOSE_Y = 0.36;
const NOSE_RX = 0.035;
const NOSE_RY = 0.025;

const MOUTH_LEFT_X = 0.42;
const MOUTH_CTRL_X = 0.5;
const MOUTH_RIGHT_X = 0.58;
const MOUTH_Y = 0.39;
const MOUTH_CTRL_Y = 0.42;
const MOUTH_LINEWIDTH = 0.014;

// Hair tuft positions (relative x, relative y within tile)
const TUFT_0_X = 0.3;
const TUFT_0_Y = 0.3;
const TUFT_1_X = 0.5;
const TUFT_1_Y = 0.2;
const TUFT_2_X = 0.7;
const TUFT_2_Y = 0.3;
const TUFT_3_X = 0.25;
const TUFT_3_Y = 0.5;
const TUFT_4_X = 0.45;
const TUFT_4_Y = 0.45;
const TUFT_5_X = 0.65;
const TUFT_5_Y = 0.48;
const TUFT_6_X = 0.75;
const TUFT_6_Y = 0.5;
const TUFT_7_X = 0.3;
const TUFT_7_Y = 0.65;
const TUFT_8_X = 0.5;
const TUFT_8_Y = 0.7;
const TUFT_9_X = 0.7;
const TUFT_9_Y = 0.65;
const TUFT_10_X = 0.35;
const TUFT_10_Y = 0.15;
const TUFT_11_X = 0.65;
const TUFT_11_Y = 0.15;
const TUFT_12_X = 0.4;
const TUFT_12_Y = 0.6;
const TUFT_13_X = 0.6;
const TUFT_13_Y = 0.58;

const HAIR_TUFTS: ReadonlyArray<readonly [number, number]> = [
  [TUFT_0_X, TUFT_0_Y],
  [TUFT_1_X, TUFT_1_Y],
  [TUFT_2_X, TUFT_2_Y],
  [TUFT_3_X, TUFT_3_Y],
  [TUFT_4_X, TUFT_4_Y],
  [TUFT_5_X, TUFT_5_Y],
  [TUFT_6_X, TUFT_6_Y],
  [TUFT_7_X, TUFT_7_Y],
  [TUFT_8_X, TUFT_8_Y],
  [TUFT_9_X, TUFT_9_Y],
  [TUFT_10_X, TUFT_10_Y],
  [TUFT_11_X, TUFT_11_Y],
  [TUFT_12_X, TUFT_12_Y],
  [TUFT_13_X, TUFT_13_Y],
];

const SCRATCH_CLAW_MIN = 0.055;
const SCRATCH_CLAW_RANGE = 0.055;
const SCRATCH_SPREAD_ANGLE = 0.4;
const SCRATCH_LINEWIDTH = 0.017;
const SCRATCH_ALPHA_SCALE = 0.92;

export function drawBugabooSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
  attackAnim = 0,
) {
  const bob = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * s * WALK_BOB_AMPLITUDE : 0;
  const armSwing = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * WALK_ARM_SWING_AMPLITUDE : 0;
  const legShuffle = isWalking ? Math.sin(walkTime * WALK_BOB_FREQ) * s * WALK_LEG_AMPLITUDE : 0;
  const scratchLift = attackAnim * s * ARM_SCRATCH_LIFT_SCALE;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * FLIP_CENTER_X, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * FLIP_CENTER_X), 0);
  }

  const bsy = sy + bob;

  // === COMICALLY SKINNY LEGS (behind body) ===
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = s * LEG_LINEWIDTH;
  ctx.lineCap = 'round';
  // Left leg
  ctx.beginPath();
  ctx.moveTo(sx + s * LEG_LEFT_BASE_X, bsy + s * LEG_BASE_Y);
  ctx.lineTo(sx + s * LEG_LEFT_END_X - legShuffle * LEG_SHUIFLE_SCALE, bsy + s * LEG_END_Y);
  ctx.stroke();
  // Right leg
  ctx.beginPath();
  ctx.moveTo(sx + s * LEG_RIGHT_BASE_X, bsy + s * LEG_BASE_Y);
  ctx.lineTo(sx + s * LEG_RIGHT_END_X + legShuffle * LEG_SHUIFLE_SCALE, bsy + s * LEG_END_Y);
  ctx.stroke();
  // Tiny feet
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * LEG_LEFT_END_X - legShuffle * LEG_SHUIFLE_SCALE,
    bsy + s * FOOT_Y,
    s * FOOT_RX,
    s * FOOT_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * LEG_RIGHT_END_X + legShuffle * LEG_SHUIFLE_SCALE,
    bsy + s * FOOT_Y,
    s * FOOT_RX,
    s * FOOT_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // === ABSURDLY THIN ARMS (behind body, long and dangling) ===
  const leftArmEndX = sx + s * ARM_LEFT_END_X;
  const leftArmEndY = bsy + s * ARM_END_Y + armSwing * s * ARM_SWING_SCALE - scratchLift;
  const rightArmEndX = sx + s * ARM_RIGHT_END_X;
  const rightArmEndY = bsy + s * ARM_END_Y - armSwing * s * ARM_SWING_SCALE - scratchLift;
  const armCtrlY =
    attackAnim > 0
      ? bsy + s * (ARM_SWING_SCALE - attackAnim * ARM_CTRL_Y_ATTACK_SCALE)
      : bsy + s * ARM_CTRL_Y_IDLE;
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = s * ARM_LINEWIDTH;
  ctx.lineCap = 'round';
  // Left arm
  ctx.beginPath();
  ctx.moveTo(sx + s * ARM_LEFT_SHOULDER_X, bsy + s * ARM_SHOULDER_Y);
  ctx.quadraticCurveTo(
    sx + s * ARM_LEFT_END_X - ARM_LEFT_SHOULDER_X + ARM_LEFT_END_X,
    armCtrlY,
    leftArmEndX,
    leftArmEndY,
  );
  ctx.stroke();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(sx + s * ARM_RIGHT_SHOULDER_X, bsy + s * ARM_SHOULDER_Y);
  ctx.quadraticCurveTo(
    sx + s * ARM_RIGHT_END_X + (ARM_RIGHT_SHOULDER_X - ARM_RIGHT_END_X),
    armCtrlY,
    rightArmEndX,
    rightArmEndY,
  );
  ctx.stroke();
  // Tiny claw-hands
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.arc(leftArmEndX, leftArmEndY, s * CLAW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightArmEndX, rightArmEndY, s * CLAW_R, 0, Math.PI * 2);
  ctx.fill();

  // === MASSIVE BEAR-SHAPED BODY (no neck, head merges into torso) ===
  // Main body (large oval)
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * BODY_CENTER_X,
    bsy + s * BODY_CENTER_Y,
    s * BODY_RX,
    s * BODY_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Head (merges directly into body — no neck)
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * HEAD_CENTER_X,
    bsy + s * HEAD_CENTER_Y,
    s * HEAD_RX,
    s * HEAD_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Small rounded ears (bear-like)
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.arc(sx + s * EAR_LEFT_X, bsy + s * EAR_Y, s * EAR_R_OUTER, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EAR_RIGHT_X, bsy + s * EAR_Y, s * EAR_R_OUTER, 0, Math.PI * 2);
  ctx.fill();
  // Inner ears
  ctx.fillStyle = '#2a2a4e';
  ctx.beginPath();
  ctx.arc(sx + s * EAR_LEFT_X, bsy + s * EAR_Y, s * EAR_R_INNER, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EAR_RIGHT_X, bsy + s * EAR_Y, s * EAR_R_INNER, 0, Math.PI * 2);
  ctx.fill();

  // === SHAGGY HAIR TEXTURE (short strokes across body) ===
  ctx.save();
  ctx.strokeStyle = '#2a2a3e';
  ctx.lineWidth = s * HAIR_LINEWIDTH;
  ctx.lineCap = 'round';
  for (const [tx, ty] of HAIR_TUFTS) {
    const ttx = sx + s * tx;
    const tty = bsy + s * ty;
    ctx.beginPath();
    ctx.moveTo(ttx, tty);
    ctx.lineTo(ttx + s * HAIR_TUFT_DX, tty - s * HAIR_TUFT_DY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ttx + s * HAIR_TUFT_DX2, tty);
    ctx.lineTo(ttx + s * HAIR_TUFT_DX + s * HAIR_TUFT_DX2, tty - s * HAIR_TUFT_DY2);
    ctx.stroke();
  }
  ctx.restore();

  // === ENORMOUS OWL-LIKE EYES ===
  // Eye whites (large)
  ctx.fillStyle = '#e8e8d0';
  ctx.beginPath();
  ctx.ellipse(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_RX, s * EYE_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_RX, s * EYE_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye outline (dark ring)
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = s * EYE_OUTLINE_LINEWIDTH;
  ctx.beginPath();
  ctx.ellipse(sx + s * EYE_LEFT_X, bsy + s * EYE_Y, s * EYE_RX, s * EYE_RY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(sx + s * EYE_RIGHT_X, bsy + s * EYE_Y, s * EYE_RX, s * EYE_RY, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Iris (amber/yellow)
  ctx.fillStyle = '#d4a820';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_IRIS_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_IRIS_Y, s * EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();

  // Pupils (large, dark)
  ctx.fillStyle = '#0a0a1a';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_PUPIL_Y, s * EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_PUPIL_Y, s * EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();

  // Eye glow (subtle amber)
  ctx.save();
  ctx.globalAlpha = EYE_GLOW_ALPHA;
  ctx.fillStyle = '#d4a820';
  ctx.beginPath();
  ctx.arc(sx + s * EYE_LEFT_X, bsy + s * EYE_IRIS_Y, s * EYE_GLOW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * EYE_RIGHT_X, bsy + s * EYE_IRIS_Y, s * EYE_GLOW_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pupil highlights (small white dot)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(
    sx + s * EYE_HIGHLIGHT_LEFT_X,
    bsy + s * EYE_HIGHLIGHT_Y,
    s * EYE_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    sx + s * EYE_HIGHLIGHT_RIGHT_X,
    bsy + s * EYE_HIGHLIGHT_Y,
    s * EYE_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // === SMALL NOSE / SNOUT ===
  ctx.fillStyle = '#2a2a4e';
  ctx.beginPath();
  ctx.ellipse(sx + s * NOSE_X, bsy + s * NOSE_Y, s * NOSE_RX, s * NOSE_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // === SUBTLE MOUTH (slightly unsettling) ===
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = s * MOUTH_LINEWIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * MOUTH_LEFT_X, bsy + s * MOUTH_Y);
  ctx.quadraticCurveTo(
    sx + s * MOUTH_CTRL_X,
    bsy + s * MOUTH_CTRL_Y,
    sx + s * MOUTH_RIGHT_X,
    bsy + s * MOUTH_Y,
  );
  ctx.stroke();

  // === SCRATCH ATTACK — claws fan out from each raised hand ===
  if (attackAnim > 0) {
    ctx.save();
    ctx.globalAlpha = attackAnim * SCRATCH_ALPHA_SCALE;
    ctx.strokeStyle = '#3a3a5e';
    ctx.lineWidth = s * SCRATCH_LINEWIDTH;
    ctx.lineCap = 'round';
    const clawLen = s * (SCRATCH_CLAW_MIN + attackAnim * SCRATCH_CLAW_RANGE);
    // Three claws per hand, fanning downward/inward from each claw tip
    for (let c = -1; c <= 1; c++) {
      const angle = Math.PI * FLIP_CENTER_X + c * SCRATCH_SPREAD_ANGLE;
      ctx.beginPath();
      ctx.moveTo(leftArmEndX, leftArmEndY);
      ctx.lineTo(leftArmEndX + Math.cos(angle) * clawLen, leftArmEndY + Math.sin(angle) * clawLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightArmEndX, rightArmEndY);
      ctx.lineTo(
        rightArmEndX + Math.cos(angle) * clawLen,
        rightArmEndY + Math.sin(angle) * clawLen,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // undo facing flip
}
