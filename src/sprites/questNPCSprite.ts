/**
 * Sprites for the defend-NPC quest:
 *  - Goblin mother in a pink dress
 *  - Yellow/green exclamation/question mark
 *  - Small goblin child
 *  - Wood pile pickup
 *  - Wood barrier (with damage states)
 */
import { drawText } from '../ui/TextBox';

// ── Goblin mother NPC constants ───────────────────────────────────────────────

const MS_TO_SECONDS = 1000;
const NPC_CENTER_X = 0.5;
const NPC_FLIP_TRANSLATE_Y = 0;

// Feet
const NPC_LEFT_FOOT_X = 0.3;
const NPC_RIGHT_FOOT_X = 0.55;
const NPC_FOOT_Y = 0.88;
const NPC_FOOT_W = 0.15;
const NPC_FOOT_H = 0.06;

// Dress trapezoid
const NPC_DRESS_TOP_Y = 0.44;
const NPC_DRESS_LEFT_TOP = 0.27;
const NPC_DRESS_RIGHT_TOP = 0.73;
const NPC_DRESS_LEFT_BOT = 0.22;
const NPC_DRESS_RIGHT_BOT = 0.78;
const NPC_DRESS_BOT_Y = 0.88;

// Dress ruffle
const NPC_RUFFLE_COUNT = 6;
const NPC_RUFFLE_START_X = 0.24;
const NPC_RUFFLE_SPACING = 0.093;
const NPC_RUFFLE_Y = 0.87;
const NPC_RUFFLE_RADIUS = 0.03;

// Belt
const NPC_BELT_X = 0.27;
const NPC_BELT_Y = 0.56;
const NPC_BELT_W = 0.46;
const NPC_BELT_H = 0.04;

// Arms
const NPC_LEFT_ARM_X = 0.15;
const NPC_RIGHT_ARM_X = 0.73;
const NPC_ARM_Y = 0.46;
const NPC_ARM_W = 0.12;
const NPC_ARM_H = 0.11;
const NPC_ARM_WAVE_FREQ = 8;

// Head
const NPC_HEAD_X = 0.5;
const NPC_HEAD_Y = 0.3;
const NPC_HEAD_R = 0.17;

// Ears
const NPC_LEFT_EAR_BASE_X = 0.34;
const NPC_LEFT_EAR_TIP_X = 0.17;
const NPC_LEFT_EAR_JOINT_X = 0.39;
const NPC_RIGHT_EAR_BASE_X = 0.66;
const NPC_RIGHT_EAR_TIP_X = 0.83;
const NPC_RIGHT_EAR_JOINT_X = 0.61;
const NPC_EAR_BASE_Y = 0.26;
const NPC_EAR_TIP_Y = 0.11;
const NPC_EAR_JOINT_Y = 0.19;

// Snout
const NPC_SNOUT_X = 0.5;
const NPC_SNOUT_Y = 0.335;
const NPC_SNOUT_R = 0.065;

// Nostrils
const NPC_LEFT_NOSTRIL_X = 0.463;
const NPC_RIGHT_NOSTRIL_X = 0.537;
const NPC_NOSTRIL_Y = 0.343;
const NPC_NOSTRIL_R = 0.016;

// Eyes
const NPC_LEFT_EYE_X = 0.415;
const NPC_RIGHT_EYE_X = 0.585;
const NPC_EYE_Y = 0.275;
const NPC_EYE_IRIS_R = 0.05;
const NPC_EYE_PUPIL_R = 0.022;

// Eye highlights
const NPC_LEFT_HIGHLIGHT_X = 0.405;
const NPC_RIGHT_HIGHLIGHT_X = 0.575;
const NPC_HIGHLIGHT_Y = 0.265;
const NPC_HIGHLIGHT_R = 0.01;

// Speech bubble
const NPC_BUBBLE_FADE_FRAMES = 15;
const NPC_BUBBLE_W = 0.92;
const NPC_BUBBLE_H = 0.28;
const NPC_BUBBLE_OFFSET_X = 0.04;
const NPC_BUBBLE_OFFSET_Y = 0.68;
const NPC_BUBBLE_CORNER_R = 0.07;
const NPC_BUBBLE_LINE_W = 0.03;
const NPC_BUBBLE_TAIL_LEFT = 0.62;
const NPC_BUBBLE_TAIL_MID = 0.5;
const NPC_BUBBLE_TAIL_RIGHT = 0.38;
const NPC_BUBBLE_TAIL_DROP = 0.2;
const NPC_BUBBLE_TEXT_SIZE_RATIO = 0.2;
const NPC_BUBBLE_TEXT_CENTER_X = 0.5;
const NPC_BUBBLE_TEXT_CENTER_Y = 0.5;

export function drawQuestNPCSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  facingX = 1,
  hurtTimer = 0,
) {
  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * NPC_CENTER_X, NPC_FLIP_TRANSLATE_Y);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * NPC_CENTER_X), NPC_FLIP_TRANSLATE_Y);
  }

  const skinColor = '#4f8a3e';

  // Feet — small shoes
  ctx.fillStyle = '#8b3a62';
  ctx.fillRect(sx + s * NPC_LEFT_FOOT_X, sy + s * NPC_FOOT_Y, s * NPC_FOOT_W, s * NPC_FOOT_H);
  ctx.fillRect(sx + s * NPC_RIGHT_FOOT_X, sy + s * NPC_FOOT_Y, s * NPC_FOOT_W, s * NPC_FOOT_H);

  // Pink dress (replaces legs + body)
  ctx.fillStyle = '#e879a0';
  ctx.beginPath();
  ctx.moveTo(sx + s * NPC_DRESS_LEFT_TOP, sy + s * NPC_DRESS_TOP_Y);
  ctx.lineTo(sx + s * NPC_DRESS_RIGHT_TOP, sy + s * NPC_DRESS_TOP_Y);
  ctx.lineTo(sx + s * NPC_DRESS_RIGHT_BOT, sy + s * NPC_DRESS_BOT_Y);
  ctx.lineTo(sx + s * NPC_DRESS_LEFT_BOT, sy + s * NPC_DRESS_BOT_Y);
  ctx.closePath();
  ctx.fill();

  // Dress hem ruffle
  ctx.strokeStyle = '#d4608a';
  ctx.lineWidth = s * NPC_FOOT_H;
  ctx.beginPath();
  for (let i = 0; i < NPC_RUFFLE_COUNT; i++) {
    const rx = sx + s * (NPC_RUFFLE_START_X + i * NPC_RUFFLE_SPACING);
    const ry = sy + s * NPC_RUFFLE_Y;
    ctx.arc(rx, ry, s * NPC_RUFFLE_RADIUS, 0, Math.PI, false);
  }
  ctx.stroke();

  // Dress belt/sash
  ctx.fillStyle = '#c44d7a';
  ctx.fillRect(sx + s * NPC_BELT_X, sy + s * NPC_BELT_Y, s * NPC_BELT_W, s * NPC_BELT_H);

  // Arms (skin) — wave frantically when hurt
  ctx.fillStyle = skinColor;
  if (hurtTimer > 0) {
    const wt = performance.now() / MS_TO_SECONDS;
    const leftLift = Math.abs(Math.sin(wt * NPC_ARM_WAVE_FREQ)) * s * NPC_RUFFLE_START_X;
    const rightLift = Math.abs(Math.sin(wt * NPC_ARM_WAVE_FREQ + Math.PI)) * s * NPC_RUFFLE_START_X;
    ctx.fillRect(
      sx + s * NPC_LEFT_ARM_X,
      sy + s * NPC_ARM_Y - leftLift,
      s * NPC_ARM_W,
      s * NPC_ARM_H,
    );
    ctx.fillRect(
      sx + s * NPC_RIGHT_ARM_X,
      sy + s * NPC_ARM_Y - rightLift,
      s * NPC_ARM_W,
      s * NPC_ARM_H,
    );
  } else {
    ctx.fillRect(sx + s * NPC_LEFT_ARM_X, sy + s * NPC_ARM_Y, s * NPC_ARM_W, s * NPC_ARM_H);
    ctx.fillRect(sx + s * NPC_RIGHT_ARM_X, sy + s * NPC_ARM_Y, s * NPC_ARM_W, s * NPC_ARM_H);
  }

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(sx + s * NPC_HEAD_X, sy + s * NPC_HEAD_Y, s * NPC_HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // Big pointy left ear
  ctx.beginPath();
  ctx.moveTo(sx + s * NPC_LEFT_EAR_BASE_X, sy + s * NPC_EAR_BASE_Y);
  ctx.lineTo(sx + s * NPC_LEFT_EAR_TIP_X, sy + s * NPC_EAR_TIP_Y);
  ctx.lineTo(sx + s * NPC_LEFT_EAR_JOINT_X, sy + s * NPC_EAR_JOINT_Y);
  ctx.fill();

  // Big pointy right ear
  ctx.beginPath();
  ctx.moveTo(sx + s * NPC_RIGHT_EAR_BASE_X, sy + s * NPC_EAR_BASE_Y);
  ctx.lineTo(sx + s * NPC_RIGHT_EAR_TIP_X, sy + s * NPC_EAR_TIP_Y);
  ctx.lineTo(sx + s * NPC_RIGHT_EAR_JOINT_X, sy + s * NPC_EAR_JOINT_Y);
  ctx.fill();

  // Snout
  ctx.beginPath();
  ctx.arc(sx + s * NPC_SNOUT_X, sy + s * NPC_SNOUT_Y, s * NPC_SNOUT_R, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(sx + s * NPC_LEFT_NOSTRIL_X, sy + s * NPC_NOSTRIL_Y, s * NPC_NOSTRIL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * NPC_RIGHT_NOSTRIL_X, sy + s * NPC_NOSTRIL_Y, s * NPC_NOSTRIL_R, 0, Math.PI * 2);
  ctx.fill();

  // Eyes — friendly, slightly larger
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(sx + s * NPC_LEFT_EYE_X, sy + s * NPC_EYE_Y, s * NPC_EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * NPC_RIGHT_EYE_X, sy + s * NPC_EYE_Y, s * NPC_EYE_IRIS_R, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(sx + s * NPC_LEFT_EYE_X, sy + s * NPC_EYE_Y, s * NPC_EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * NPC_RIGHT_EYE_X, sy + s * NPC_EYE_Y, s * NPC_EYE_PUPIL_R, 0, Math.PI * 2);
  ctx.fill();

  // Eye highlights
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(
    sx + s * NPC_LEFT_HIGHLIGHT_X,
    sy + s * NPC_HIGHLIGHT_Y,
    s * NPC_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    sx + s * NPC_RIGHT_HIGHLIGHT_X,
    sy + s * NPC_HIGHLIGHT_Y,
    s * NPC_HIGHLIGHT_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();

  // === "Help!!!" speech bubble — shown while hurt ===
  if (hurtTimer > 0) {
    const bubbleAlpha = Math.min(1, hurtTimer / NPC_BUBBLE_FADE_FRAMES);
    ctx.save();
    ctx.globalAlpha = bubbleAlpha;

    const bw = s * NPC_BUBBLE_W;
    const bh = s * NPC_BUBBLE_H;
    const bx = sx + s * NPC_BUBBLE_OFFSET_X;
    const by = sy - s * NPC_BUBBLE_OFFSET_Y;
    const r = s * NPC_BUBBLE_CORNER_R;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = s * NPC_BUBBLE_LINE_W;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_LEFT, by + bh);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_MID, by + bh + s * NPC_BUBBLE_TAIL_DROP);
    ctx.lineTo(bx + bw * NPC_BUBBLE_TAIL_RIGHT, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Text — midpoint y converted to top: drawText_y = mid - size/2
    const helpFontSize = Math.floor(s * NPC_BUBBLE_TEXT_SIZE_RATIO);
    drawText(ctx, 'Help!!!', {
      x: bx + bw * NPC_BUBBLE_TEXT_CENTER_X,
      y: by + bh * NPC_BUBBLE_TEXT_CENTER_Y - helpFontSize / 2,
      size: helpFontSize,
      bold: true,
      font: 'sans-serif',
      color: '#ef4444',
      alpha: bubbleAlpha,
      align: 'center',
    });

    ctx.restore();
  }
}

// ── Exclamation/question mark constants ──────────────────────────────────────

const EXCLAMATION_BOUNCE_FREQ = 3;
const EXCLAMATION_BOUNCE_AMP = 0.04;
const EXCLAMATION_CENTER_X = 0.5;
const EXCLAMATION_BASE_OFFSET_Y = 0.15;
const EXCLAMATION_FONT_SIZE_RATIO = 0.45;
const EXCLAMATION_OUTLINE_WIDTH = 3;
const EXCLAMATION_GLOW_BLUR = 8;

export function drawExclamationMark(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  color: string,
) {
  const t = performance.now() / MS_TO_SECONDS;
  const bounce = Math.sin(t * EXCLAMATION_BOUNCE_FREQ) * s * EXCLAMATION_BOUNCE_AMP;
  const cx = sx + s * EXCLAMATION_CENTER_X;
  const baseY = sy - s * EXCLAMATION_BASE_OFFSET_Y + bounce;
  const isQuestion = color === '#4ade80';

  const glyphFontSize = Math.floor(s * EXCLAMATION_FONT_SIZE_RATIO);
  const glyph = isQuestion ? '?' : '!';

  // Midpoint y converted to top: drawText_y = baseY - size/2
  // outline (black stroke) + glow in one pass
  ctx.save();
  drawText(ctx, glyph, {
    x: cx,
    y: baseY - glyphFontSize / 2,
    size: glyphFontSize,
    bold: true,
    font: 'monospace',
    color,
    align: 'center',
    outline: '#000',
    outlineWidth: EXCLAMATION_OUTLINE_WIDTH,
    glow: color,
    glowBlur: EXCLAMATION_GLOW_BLUR,
  });
  ctx.restore();
}

// ── Child goblin sprite constants ─────────────────────────────────────────────

const CHILD_SIZE_RATIO = 0.6;
const CHILD_OFFSET_X_RATIO = 0.5;
const CHILD_BOB_AMPLITUDE = 0.04;

// Child feet
const CHILD_LEFT_FOOT_X = 0.3;
const CHILD_RIGHT_FOOT_X = 0.56;
const CHILD_FOOT_Y = 0.88;
const CHILD_FOOT_W = 0.14;
const CHILD_FOOT_H = 0.06;

// Child tunic
const CHILD_TUNIC_X = 0.28;
const CHILD_TUNIC_Y = 0.48;
const CHILD_TUNIC_W = 0.44;
const CHILD_TUNIC_H = 0.4;

// Child arms
const CHILD_LEFT_ARM_X = 0.16;
const CHILD_RIGHT_ARM_X = 0.72;
const CHILD_ARM_Y = 0.5;
const CHILD_ARM_W = 0.12;
const CHILD_ARM_H = 0.1;

// Child head
const CHILD_HEAD_X = 0.5;
const CHILD_HEAD_Y = 0.32;
const CHILD_HEAD_R = 0.2;

// Child ears
const CHILD_LEFT_EAR_BASE_X = 0.32;
const CHILD_LEFT_EAR_TIP_X = 0.18;
const CHILD_LEFT_EAR_JOINT_X = 0.37;
const CHILD_RIGHT_EAR_BASE_X = 0.68;
const CHILD_RIGHT_EAR_TIP_X = 0.82;
const CHILD_RIGHT_EAR_JOINT_X = 0.63;
const CHILD_EAR_BASE_Y = 0.28;
const CHILD_EAR_TIP_Y = 0.14;
const CHILD_EAR_JOINT_Y = 0.21;

// Child eyes
const CHILD_LEFT_EYE_X = 0.4;
const CHILD_RIGHT_EYE_X = 0.6;
const CHILD_EYE_Y = 0.3;
const CHILD_EYE_IRIS_R = 0.06;
const CHILD_EYE_PUPIL_R = 0.025;

export function drawChildSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
) {
  // Child is ~60% the size of an adult goblin, drawn at center-bottom of tile
  const cs = s * CHILD_SIZE_RATIO;
  const ox = sx + (s - cs) * CHILD_OFFSET_X_RATIO;
  const oy = sy + s - cs;
  const bob = isMoving ? -Math.abs(Math.sin(walkFrame)) * cs * CHILD_BOB_AMPLITUDE : 0;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(ox + cs * CHILD_OFFSET_X_RATIO, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(ox + cs * CHILD_OFFSET_X_RATIO), 0);
  }

  const skinColor = '#5ca84e';

  // Tiny feet
  ctx.fillStyle = '#2d1b00';
  ctx.fillRect(
    ox + cs * CHILD_LEFT_FOOT_X,
    oy + cs * CHILD_FOOT_Y + bob,
    cs * CHILD_FOOT_W,
    cs * CHILD_FOOT_H,
  );
  ctx.fillRect(
    ox + cs * CHILD_RIGHT_FOOT_X,
    oy + cs * CHILD_FOOT_Y + bob,
    cs * CHILD_FOOT_W,
    cs * CHILD_FOOT_H,
  );

  // Simple tunic (blue)
  ctx.fillStyle = '#6488c8';
  ctx.fillRect(
    ox + cs * CHILD_TUNIC_X,
    oy + cs * CHILD_TUNIC_Y + bob,
    cs * CHILD_TUNIC_W,
    cs * CHILD_TUNIC_H,
  );

  // Arms
  ctx.fillStyle = skinColor;
  ctx.fillRect(
    ox + cs * CHILD_LEFT_ARM_X,
    oy + cs * CHILD_ARM_Y + bob,
    cs * CHILD_ARM_W,
    cs * CHILD_ARM_H,
  );
  ctx.fillRect(
    ox + cs * CHILD_RIGHT_ARM_X,
    oy + cs * CHILD_ARM_Y + bob,
    cs * CHILD_ARM_W,
    cs * CHILD_ARM_H,
  );

  // Head (proportionally bigger for a child)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(ox + cs * CHILD_HEAD_X, oy + cs * CHILD_HEAD_Y + bob, cs * CHILD_HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.moveTo(ox + cs * CHILD_LEFT_EAR_BASE_X, oy + cs * CHILD_EAR_BASE_Y + bob);
  ctx.lineTo(ox + cs * CHILD_LEFT_EAR_TIP_X, oy + cs * CHILD_EAR_TIP_Y + bob);
  ctx.lineTo(ox + cs * CHILD_LEFT_EAR_JOINT_X, oy + cs * CHILD_EAR_JOINT_Y + bob);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ox + cs * CHILD_RIGHT_EAR_BASE_X, oy + cs * CHILD_EAR_BASE_Y + bob);
  ctx.lineTo(ox + cs * CHILD_RIGHT_EAR_TIP_X, oy + cs * CHILD_EAR_TIP_Y + bob);
  ctx.lineTo(ox + cs * CHILD_RIGHT_EAR_JOINT_X, oy + cs * CHILD_EAR_JOINT_Y + bob);
  ctx.fill();

  // Eyes (big, cute)
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(
    ox + cs * CHILD_LEFT_EYE_X,
    oy + cs * CHILD_EYE_Y + bob,
    cs * CHILD_EYE_IRIS_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    ox + cs * CHILD_RIGHT_EYE_X,
    oy + cs * CHILD_EYE_Y + bob,
    cs * CHILD_EYE_IRIS_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(
    ox + cs * CHILD_LEFT_EYE_X,
    oy + cs * CHILD_EYE_Y + bob,
    cs * CHILD_EYE_PUPIL_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    ox + cs * CHILD_RIGHT_EYE_X,
    oy + cs * CHILD_EYE_Y + bob,
    cs * CHILD_EYE_PUPIL_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}

// ── Wood pile sprite constants ────────────────────────────────────────────────

const WOODPILE_GLOW_FREQ = 2.5;
const WOODPILE_GLOW_BASE = 0.15;
const WOODPILE_GLOW_AMP = 0.08;
const WOODPILE_GLOW_RING_X = 0.5;
const WOODPILE_GLOW_RING_Y = 0.55;
const WOODPILE_GLOW_RING_R = 0.4;
const WOODPILE_GLOW_LINE_W = 2;
const WOODPILE_BOTTOM_LOG_COUNT = 3;
const WOODPILE_BOTTOM_LOG_START = 0.15;
const WOODPILE_BOTTOM_LOG_SPACING = 0.22;
const WOODPILE_BOTTOM_LOG_Y = 0.65;
const WOODPILE_BOTTOM_LOG_W = 0.2;
const WOODPILE_BOTTOM_LOG_H = 0.12;
const WOODPILE_BOTTOM_GRAIN_X = 0.1;
const WOODPILE_BOTTOM_GRAIN_Y = 0.71;
const WOODPILE_BOTTOM_GRAIN_R = 0.04;
const WOODPILE_MID_LOG_COUNT = 2;
const WOODPILE_MID_LOG_START = 0.25;
const WOODPILE_MID_LOG_SPACING = 0.25;
const WOODPILE_MID_LOG_Y = 0.54;
const WOODPILE_MID_LOG_W = 0.2;
const WOODPILE_MID_LOG_H = 0.12;
const WOODPILE_MID_GRAIN_X = 0.1;
const WOODPILE_MID_GRAIN_Y = 0.6;
const WOODPILE_MID_GRAIN_R = 0.04;
const WOODPILE_TOP_LOG_X = 0.32;
const WOODPILE_TOP_LOG_Y = 0.44;
const WOODPILE_TOP_LOG_W = 0.22;
const WOODPILE_TOP_LOG_H = 0.11;
const WOODPILE_TOP_GRAIN_X = 0.43;
const WOODPILE_TOP_GRAIN_Y = 0.495;
const WOODPILE_TOP_GRAIN_R = 0.035;
const WOODPILE_TEXT_Y = 0.38;
const WOODPILE_TEXT_SIZE = 0.22;
const WOODPILE_TEXT_BASELINE_RATIO = 0.8; // canvas text baseline sits ~80% down from top
const WOODPILE_TEXT_OUTLINE_WIDTH = 3;
const WOODPILE_ARROW_BOUNCE_FREQ = 3.5;
const WOODPILE_ARROW_BOUNCE_AMP = 0.18;
const WOODPILE_ARROW_X = 0.5;
const WOODPILE_ARROW_OFFSET_Y = 0.22;
const WOODPILE_ARROW_W = 0.28;
const WOODPILE_ARROW_H = 0.22;
const WOODPILE_ARROW_LINE_W = 3;
const WOODPILE_ARROW_HALF = 0.5;
const WOODPILE_ARROW_NOTCH = 0.2;
const WOODPILE_ARROW_STEM = 0.55;

export function drawWoodPileSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  showArrow = true,
) {
  const t = performance.now() / MS_TO_SECONDS;
  const glow = WOODPILE_GLOW_BASE + WOODPILE_GLOW_AMP * Math.sin(t * WOODPILE_GLOW_FREQ);

  // Glow ring
  ctx.save();
  ctx.globalAlpha = glow;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = WOODPILE_GLOW_LINE_W;
  ctx.beginPath();
  ctx.arc(
    sx + s * WOODPILE_GLOW_RING_X,
    sy + s * WOODPILE_GLOW_RING_Y,
    s * WOODPILE_GLOW_RING_R,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();

  // Bottom layer of logs (3 horizontal)
  ctx.fillStyle = '#8b6914';
  for (let i = 0; i < WOODPILE_BOTTOM_LOG_COUNT; i++) {
    const lx = sx + s * WOODPILE_BOTTOM_LOG_START + i * s * WOODPILE_BOTTOM_LOG_SPACING;
    ctx.fillRect(
      lx,
      sy + s * WOODPILE_BOTTOM_LOG_Y,
      s * WOODPILE_BOTTOM_LOG_W,
      s * WOODPILE_BOTTOM_LOG_H,
    );
    // End grain circles
    ctx.fillStyle = '#a0782a';
    ctx.beginPath();
    ctx.arc(
      lx + s * WOODPILE_BOTTOM_GRAIN_X,
      sy + s * WOODPILE_BOTTOM_GRAIN_Y,
      s * WOODPILE_BOTTOM_GRAIN_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#8b6914';
  }

  // Top layer (2 logs, offset)
  ctx.fillStyle = '#9b7924';
  for (let i = 0; i < WOODPILE_MID_LOG_COUNT; i++) {
    const lx = sx + s * WOODPILE_MID_LOG_START + i * s * WOODPILE_MID_LOG_SPACING;
    ctx.fillRect(lx, sy + s * WOODPILE_MID_LOG_Y, s * WOODPILE_MID_LOG_W, s * WOODPILE_MID_LOG_H);
    ctx.fillStyle = '#b08d34';
    ctx.beginPath();
    ctx.arc(
      lx + s * WOODPILE_MID_GRAIN_X,
      sy + s * WOODPILE_MID_GRAIN_Y,
      s * WOODPILE_MID_GRAIN_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#9b7924';
  }

  // Top single log
  ctx.fillStyle = '#a8842e';
  ctx.fillRect(
    sx + s * WOODPILE_TOP_LOG_X,
    sy + s * WOODPILE_TOP_LOG_Y,
    s * WOODPILE_TOP_LOG_W,
    s * WOODPILE_TOP_LOG_H,
  );
  ctx.fillStyle = '#c0993e';
  ctx.beginPath();
  ctx.arc(
    sx + s * WOODPILE_TOP_GRAIN_X,
    sy + s * WOODPILE_TOP_GRAIN_Y,
    s * WOODPILE_TOP_GRAIN_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // "Boards" text — baseline_y converted to top: drawText_y = baseline - Math.round(size * 0.8)
  const woodFontSize = Math.floor(s * WOODPILE_TEXT_SIZE);
  drawText(ctx, 'WOOD', {
    x: sx + s * WOODPILE_ARROW_X,
    y: sy + s * WOODPILE_TEXT_Y - Math.round(woodFontSize * WOODPILE_TEXT_BASELINE_RATIO),
    size: woodFontSize,
    bold: true,
    font: 'monospace',
    color: '#fbbf24',
    align: 'center',
    outline: '#3a2500',
    outlineWidth: WOODPILE_TEXT_OUTLINE_WIDTH,
  });

  if (!showArrow) return;

  // Bouncing green pickup arrow
  const bounce = Math.abs(Math.sin(t * WOODPILE_ARROW_BOUNCE_FREQ)) * s * WOODPILE_ARROW_BOUNCE_AMP;
  const ax = sx + s * WOODPILE_ARROW_X;
  const ay = sy - s * WOODPILE_ARROW_OFFSET_Y - bounce;
  const aw = s * WOODPILE_ARROW_W;
  const ah = s * WOODPILE_ARROW_H;
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = WOODPILE_ARROW_LINE_W;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay + ah);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_HALF, ay);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_NOTCH, ay);
  ctx.lineTo(ax - aw * WOODPILE_ARROW_NOTCH, ay - ah * WOODPILE_ARROW_STEM);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_NOTCH, ay - ah * WOODPILE_ARROW_STEM);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_NOTCH, ay);
  ctx.lineTo(ax + aw * WOODPILE_ARROW_HALF, ay);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#4ade80';
  ctx.fill();
  ctx.restore();
}

//
// Damage stages (based on hpFraction):
//   1.0        — pristine boards, nailed cross-beam
//   0.75–1.0   — small hole punched through, a clawed hand reaches up and waves
//   0.5–0.75   — bigger hole, two huge owl-like eyes peer up from the dark below
//   0.25–0.5   — boards buckling outward, wide gaps, eyes + arm, nearly apart
//   0.0–0.25   — splintering apart, about to shatter

// ── Wood barrier sprite constants ─────────────────────────────────────────────

const BARRIER_VOID_INSET = 0.08;
const BARRIER_VOID_SIZE = 0.84;
const BARRIER_BUGABOO_ALPHA_BASE = 0.18;
const BARRIER_BUGABOO_ALPHA_SCALE = 0.22;
const BARRIER_BUGABOO_X = 0.5;
const BARRIER_BUGABOO_Y = 0.72;
const BARRIER_BUGABOO_RX = 0.28;
const BARRIER_BUGABOO_RY = 0.16;
const BARRIER_EYE_SPREAD_SCALE = 4;
const BARRIER_EYE_ALPHA_BASE = 0.5;
const BARRIER_EYE_Y_BASE = 0.52;
const BARRIER_EYE_Y_SHIFT = 0.06;
const BARRIER_EYE_SWAY_FREQ = 1.5;
const BARRIER_EYE_SWAY_AMP = 0.02;
const BARRIER_EYE_LEFT_X = 0.44;
const BARRIER_EYE_RIGHT_X = 0.56;
const BARRIER_EYE_SPREAD_OFFSET = 0.08;
const BARRIER_EYE_W_BASE = 0.065;
const BARRIER_EYE_W_SCALE = 0.025;
const BARRIER_EYE_H_BASE = 0.075;
const BARRIER_EYE_H_SCALE = 0.015;
const BARRIER_EYE_RING_W = 0.015;
const BARRIER_EYE_IRIS_RATIO = 0.62;
const BARRIER_EYE_PUPIL_RATIO = 0.3;
const BARRIER_EYE_PUPIL_OFFSET_Y = 0.01;
const BARRIER_EYE_GLOW_ALPHA = 0.18;
const BARRIER_EYE_GLOW_RADIUS = 1.5;
const BARRIER_ARM_ALPHA_BASE = 0.42;
const BARRIER_ARM_ALPHA_SCALE = 0.58;
const BARRIER_ARM_WAVE_FREQ = 3;
const BARRIER_ARM_WAVE_BASE = 0.025;
const BARRIER_ARM_WAVE_SCALE = 0.035;
const BARRIER_ARM_REACH_FREQ = 1.8;
const BARRIER_ARM_REACH_AMP = 0.03;
const BARRIER_ARM_X = 0.5;
const BARRIER_ARM_BASE_Y = 0.88;
const BARRIER_ARM_TOP_BASE = 0.5;
const BARRIER_ARM_TOP_SCALE = 0.24;
const BARRIER_ARM_THICK_BASE = 0.03;
const BARRIER_ARM_THICK_SCALE = 0.02;
const BARRIER_ARM_CP_RATIO = 0.3;
const BARRIER_ARM_MID_Y = 0.68;
const BARRIER_PALM_BASE = 0.025;
const BARRIER_PALM_SCALE = 0.015;
const BARRIER_FINGER_ANGLE = 0.45;
const BARRIER_FINGER_LENGTH = 0.055;
const BARRIER_FINGER_TIP_R = 0.01;
const BARRIER_FINGER_LINE_W = 0.018;
const BARRIER_PLANK_COUNT = 5;
const BARRIER_HEAVY_DMG_THRESHOLD = 0.5;
const BARRIER_HEAVY_BUCKLE_SCALE = 2;
const BARRIER_SHAKE_THRESHOLD = 0.6;
const BARRIER_SHAKE_FREQ = 12;
const BARRIER_SHAKE_AMP = 0.01;
const BARRIER_HOLE_THRESHOLD = 0.45;
const BARRIER_HOLE_DMG_START = 0.2;
const BARRIER_HOLE_BASE = 0.12;
const BARRIER_HOLE_SCALE = 0.15;
const BARRIER_HOLE_CENTER = 0.5;
const BARRIER_PLANK_TOP = 0.1;
const BARRIER_PLANK_BOT = 0.9;
const BARRIER_SPLINTER_COUNT = 3;
const BARRIER_SPLINTER_SPACING = 0.3;
const BARRIER_SPLINTER_START = 0.2;
const BARRIER_SPLINTER_DOWN = 0.03;
const BARRIER_SPLINTER_UP = 0.03;
const BARRIER_GRAIN_X_RATIO = 0.3;
const BARRIER_GRAIN_X2_RATIO = 0.4;
const BARRIER_GRAIN_TOP = 0.15;
const BARRIER_GRAIN_BOT = 0.85;
const BARRIER_FULL_PLANK_START = 0.1;
const BARRIER_FULL_PLANK_H = 0.8;
const BARRIER_BEAM_DMG_LIMIT = 0.85;
const BARRIER_BEAM_Y = 0.38;
const BARRIER_CRACKED_BEAM_START = 0.5;
const BARRIER_CRACKED_BEAM_GAP_SCALE = 0.3;
const BARRIER_CRACKED_LEFT_X = 0.05;
const BARRIER_CRACKED_MID_X = 0.53;
const BARRIER_CRACKED_HALF = 0.42;
const BARRIER_BEAM_H = 0.08;
const BARRIER_FULL_BEAM_X = 0.05;
const BARRIER_FULL_BEAM_W = 0.9;
const BARRIER_NAIL_Y_RATIO = 0.04;
const BARRIER_NAIL_R = 0.018;
const BARRIER_CRACK_ALPHA_BASE = 0.35;
const BARRIER_CRACK_ALPHA_SCALE = 0.2;
const BARRIER_CRACK_LINE_W = 1.5;
const BARRIER_CRACK_MIN = 2;
const BARRIER_CRACK_MAX = 8;
const BARRIER_CRACK_X_SCALE = 10;
const BARRIER_CRACK_X_HASH_MOD = 80;
const BARRIER_CRACK_X_HASH_MULT = 37;
const BARRIER_CRACK_X_BASE = 0.1;
const BARRIER_CRACK_X_RANGE = 0.8;
const BARRIER_CRACK_Y_HASH_MOD = 70;
const BARRIER_CRACK_Y_HASH_MULT = 53;
const BARRIER_CRACK_Y_BASE = 0.15;
const BARRIER_CRACK_Y_RANGE = 0.7;
const BARRIER_CRACK_SEG1_X = 0.05;
const BARRIER_CRACK_SEG1_Y = 0.08;
const BARRIER_CRACK_SEG2_X = 0.02;
const BARRIER_CRACK_SEG2_Y = 0.14;
const BARRIER_HEALTH_BAR_W = 0.8;
const BARRIER_HEALTH_BAR_H = 3;
const BARRIER_HEALTH_BAR_OFFSET_X = 0.1;
const BARRIER_HEALTH_BAR_OFFSET_Y = 0.02;
const BARRIER_HEALTH_HP_HIGH = 0.5;
const BARRIER_HEALTH_HP_LOW = 0.25;
const BARRIER_BUCKLE_EVEN_SCALE = 0.3;
const BARRIER_BUCKLE_ODD_SCALE = 1;
const BARRIER_TILT_SCALE = 0.08;

export function drawWoodBarrierSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  hpFraction: number,
) {
  const t = performance.now() / MS_TO_SECONDS;
  const dmg = 1 - hpFraction; // 0 = pristine, 1 = destroyed

  // ── Dark void below the boards (visible through holes) ──
  ctx.fillStyle = '#080810';
  ctx.fillRect(
    sx + s * BARRIER_VOID_INSET,
    sy + s * BARRIER_VOID_INSET,
    s * BARRIER_VOID_SIZE,
    s * BARRIER_VOID_SIZE,
  );

  // ── Bugaboo body silhouette (dark mass below boards, subtle at pristine) ──
  {
    const bodyAlpha = BARRIER_BUGABOO_ALPHA_BASE + dmg * BARRIER_BUGABOO_ALPHA_SCALE;
    ctx.save();
    ctx.globalAlpha = bodyAlpha;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.ellipse(
      sx + s * BARRIER_BUGABOO_X,
      sy + s * BARRIER_BUGABOO_Y,
      s * BARRIER_BUGABOO_RX,
      s * BARRIER_BUGABOO_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  // ── Eyes peeking up (visible from the start, narrow crack at pristine) ──
  {
    // At pristine both eyes sit within the center plank crack; they spread outward as boards break
    const eyeSpread = Math.min(1, dmg * BARRIER_EYE_SPREAD_SCALE);
    const eyeAlpha = BARRIER_EYE_ALPHA_BASE + dmg * BARRIER_EYE_ALPHA_BASE;
    const eyeY = sy + s * (BARRIER_EYE_Y_BASE - dmg * BARRIER_EYE_Y_SHIFT);
    const eyeShift = Math.sin(t * BARRIER_EYE_SWAY_FREQ) * s * BARRIER_EYE_SWAY_AMP;
    const leftEyeX =
      sx + s * (BARRIER_EYE_LEFT_X - eyeSpread * BARRIER_EYE_SPREAD_OFFSET) + eyeShift;
    const rightEyeX =
      sx + s * (BARRIER_EYE_RIGHT_X + eyeSpread * BARRIER_EYE_SPREAD_OFFSET) + eyeShift;
    const eyeW = s * (BARRIER_EYE_W_BASE + dmg * BARRIER_EYE_W_SCALE);
    const eyeH = s * (BARRIER_EYE_H_BASE + dmg * BARRIER_EYE_H_SCALE);

    ctx.save();
    ctx.globalAlpha = eyeAlpha;

    // Eye whites
    ctx.fillStyle = '#e8e8d0';
    ctx.beginPath();
    ctx.ellipse(leftEyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(rightEyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark ring outlines
    ctx.strokeStyle = '#0a0a1a';
    ctx.lineWidth = s * BARRIER_EYE_RING_W;
    ctx.beginPath();
    ctx.ellipse(leftEyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(rightEyeX, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Amber irises
    ctx.fillStyle = '#d4a820';
    ctx.beginPath();
    ctx.arc(
      leftEyeX,
      eyeY + s * BARRIER_EYE_PUPIL_OFFSET_Y,
      eyeW * BARRIER_EYE_IRIS_RATIO,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      rightEyeX,
      eyeY + s * BARRIER_EYE_PUPIL_OFFSET_Y,
      eyeW * BARRIER_EYE_IRIS_RATIO,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Dark pupils
    ctx.fillStyle = '#0a0a1a';
    ctx.beginPath();
    ctx.arc(
      leftEyeX,
      eyeY + s * BARRIER_EYE_PUPIL_OFFSET_Y,
      eyeW * BARRIER_EYE_PUPIL_RATIO,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      rightEyeX,
      eyeY + s * BARRIER_EYE_PUPIL_OFFSET_Y,
      eyeW * BARRIER_EYE_PUPIL_RATIO,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Amber glow (bleeds slightly through boards)
    ctx.globalAlpha = eyeAlpha * BARRIER_EYE_GLOW_ALPHA;
    ctx.fillStyle = '#d4a820';
    ctx.beginPath();
    ctx.arc(leftEyeX, eyeY, eyeW * BARRIER_EYE_GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightEyeX, eyeY, eyeW * BARRIER_EYE_GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ── Arm/hand reaching up through center crack (visible from the start) ──
  {
    const handAlpha = BARRIER_ARM_ALPHA_BASE + dmg * BARRIER_ARM_ALPHA_SCALE;
    const wave =
      Math.sin(t * BARRIER_ARM_WAVE_FREQ) *
      s *
      (BARRIER_ARM_WAVE_BASE + dmg * BARRIER_ARM_WAVE_SCALE);
    const reach = Math.sin(t * BARRIER_ARM_REACH_FREQ) * s * BARRIER_ARM_REACH_AMP;

    // Hand starts at center of tile (within center plank crack) and rises with damage
    const armCx = sx + s * BARRIER_ARM_X + wave;
    const armBaseY = sy + s * BARRIER_ARM_BASE_Y;
    const armTopY = sy + s * (BARRIER_ARM_TOP_BASE - dmg * BARRIER_ARM_TOP_SCALE) + reach;

    ctx.save();
    ctx.globalAlpha = handAlpha;

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = s * (BARRIER_ARM_THICK_BASE + dmg * BARRIER_ARM_THICK_SCALE);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armCx, armBaseY);
    ctx.quadraticCurveTo(
      armCx + wave * BARRIER_ARM_CP_RATIO,
      sy + s * BARRIER_ARM_MID_Y,
      armCx,
      armTopY,
    );
    ctx.stroke();

    // Palm
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(armCx, armTopY, s * (BARRIER_PALM_BASE + dmg * BARRIER_PALM_SCALE), 0, Math.PI * 2);
    ctx.fill();

    // Three clawed fingers
    ctx.strokeStyle = '#12122a';
    ctx.lineWidth = s * BARRIER_FINGER_LINE_W;
    for (let f = -1; f <= 1; f++) {
      const angle = -Math.PI / 2 + f * BARRIER_FINGER_ANGLE;
      const fx = armCx + Math.cos(angle) * s * BARRIER_FINGER_LENGTH;
      const fy = armTopY + Math.sin(angle) * s * BARRIER_FINGER_LENGTH;
      ctx.beginPath();
      ctx.moveTo(armCx, armTopY);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.fillStyle = '#2a2a4e';
      ctx.beginPath();
      ctx.arc(fx, fy, s * BARRIER_FINGER_TIP_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Boards (drawn ON TOP of the creature elements) ──
  const numPlanks = BARRIER_PLANK_COUNT;
  const plankW = s / numPlanks;

  // How much boards buckle/offset at high damage
  const buckle =
    dmg > BARRIER_HEAVY_DMG_THRESHOLD
      ? (dmg - BARRIER_HEAVY_DMG_THRESHOLD) * BARRIER_HEAVY_BUCKLE_SCALE
      : 0;
  const shake =
    dmg > BARRIER_SHAKE_THRESHOLD
      ? Math.sin(t * BARRIER_SHAKE_FREQ) * s * BARRIER_SHAKE_AMP * dmg
      : 0;

  for (let i = 0; i < numPlanks; i++) {
    const px = sx + i * plankW + shake;

    // At heavy damage, some planks are pushed outward / tilted
    const plankBuckle =
      buckle * (i === 1 || i === 3 ? BARRIER_BUCKLE_ODD_SCALE : BARRIER_BUCKLE_EVEN_SCALE);
    const offsetY = plankBuckle * s * BARRIER_NAIL_R * (i % 2 === 0 ? -1 : 1);
    const tiltAngle = plankBuckle * BARRIER_TILT_SCALE * (i % 2 === 0 ? 1 : -1);

    // Center plank always has a hole (tiny crack at pristine, grows with damage); sides join in later
    const hasHole = i === 2 || (dmg > BARRIER_HOLE_THRESHOLD && (i === 1 || i === 3));

    ctx.save();
    if (tiltAngle !== 0) {
      ctx.translate(px + plankW * WOODPILE_ARROW_HALF, sy + s * WOODPILE_ARROW_HALF);
      ctx.rotate(tiltAngle);
      ctx.translate(-(px + plankW * WOODPILE_ARROW_HALF), -(sy + s * WOODPILE_ARROW_HALF));
    }

    const shade = i % 2 === 0 ? '#8b6914' : '#9b7924';
    ctx.fillStyle = shade;

    if (hasHole) {
      // Center plank: starts with a narrow crack, grows; side planks use standard size
      const holeSize =
        i === 2
          ? s *
            Math.max(
              BARRIER_CRACK_ALPHA_BASE - BARRIER_CRACK_ALPHA_SCALE,
              BARRIER_HOLE_BASE + (dmg - BARRIER_HOLE_DMG_START) * BARRIER_HOLE_SCALE,
            )
          : s * (BARRIER_HOLE_BASE + dmg * BARRIER_HOLE_SCALE);
      const holeCy = sy + s * BARRIER_HOLE_CENTER;
      // Top half
      ctx.fillRect(
        px + 1,
        sy + s * BARRIER_PLANK_TOP + offsetY,
        plankW - 2,
        holeCy - holeSize / 2 - (sy + s * BARRIER_PLANK_TOP),
      );
      // Bottom half
      const botTop = holeCy + holeSize / 2;
      ctx.fillRect(px + 1, botTop + offsetY, plankW - 2, sy + s * BARRIER_PLANK_BOT - botTop);

      // Splintered edges around the hole
      ctx.strokeStyle = '#5c4a10';
      ctx.lineWidth = 1;
      for (let sp = 0; sp < BARRIER_SPLINTER_COUNT; sp++) {
        const spx = px + plankW * (BARRIER_SPLINTER_START + sp * BARRIER_SPLINTER_SPACING);
        const spy = holeCy - holeSize / 2 + offsetY;
        ctx.beginPath();
        ctx.moveTo(spx, spy);
        ctx.lineTo(spx + s * BARRIER_FINGER_TIP_R, spy + s * BARRIER_SPLINTER_DOWN);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(spx, holeCy + holeSize / 2 + offsetY);
        ctx.lineTo(
          spx - s * BARRIER_FINGER_TIP_R,
          holeCy + holeSize / 2 + offsetY - s * BARRIER_SPLINTER_UP,
        );
        ctx.stroke();
      }
    } else {
      // Full plank
      ctx.fillRect(
        px + 1,
        sy + s * BARRIER_FULL_PLANK_START + offsetY,
        plankW - 2,
        s * BARRIER_FULL_PLANK_H,
      );
    }

    // Wood grain lines
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + plankW * BARRIER_GRAIN_X_RATIO, sy + s * BARRIER_GRAIN_TOP + offsetY);
    ctx.lineTo(px + plankW * BARRIER_GRAIN_X2_RATIO, sy + s * BARRIER_GRAIN_BOT + offsetY);
    ctx.stroke();

    ctx.restore();
  }

  // ── Cross-beam (cracks at high damage) ──
  if (dmg < BARRIER_BEAM_DMG_LIMIT) {
    ctx.fillStyle = '#7a5c12';
    const beamY = sy + s * BARRIER_BEAM_Y + shake;
    if (dmg > BARRIER_CRACKED_BEAM_START) {
      // Cracked beam — two halves with a gap
      const gapW = s * (dmg - BARRIER_CRACKED_BEAM_START) * BARRIER_CRACKED_BEAM_GAP_SCALE;
      ctx.fillRect(
        sx + s * BARRIER_CRACKED_LEFT_X,
        beamY,
        s * BARRIER_CRACKED_HALF - gapW,
        s * BARRIER_BEAM_H,
      );
      ctx.fillRect(
        sx + s * BARRIER_CRACKED_MID_X + gapW,
        beamY,
        s * BARRIER_CRACKED_HALF - gapW,
        s * BARRIER_BEAM_H,
      );
    } else {
      ctx.fillRect(
        sx + s * BARRIER_FULL_BEAM_X,
        beamY,
        s * BARRIER_FULL_BEAM_W,
        s * BARRIER_BEAM_H,
      );
    }

    // Nails
    ctx.fillStyle = '#555';
    for (let i = 0; i < numPlanks; i++) {
      if (dmg > BARRIER_CRACKED_BEAM_START && i === 2) continue; // middle nail gone
      ctx.beginPath();
      ctx.arc(
        sx + i * plankW + plankW * WOODPILE_ARROW_HALF,
        beamY + s * BARRIER_NAIL_Y_RATIO,
        s * BARRIER_NAIL_R,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // ── Cracks on the remaining planks (always at least 2, from the pressure below) ──
  {
    ctx.save();
    ctx.strokeStyle = `rgba(0,0,0,${BARRIER_CRACK_ALPHA_BASE + dmg * BARRIER_CRACK_ALPHA_SCALE})`;
    ctx.lineWidth = BARRIER_CRACK_LINE_W;
    const numCracks = Math.max(
      BARRIER_CRACK_MIN,
      Math.min(BARRIER_CRACK_MAX, Math.floor(dmg * BARRIER_CRACK_X_SCALE) + BARRIER_CRACK_MIN),
    );
    for (let c = 0; c < numCracks; c++) {
      const cx =
        sx +
        s *
          (BARRIER_CRACK_X_BASE +
            (((c * BARRIER_CRACK_X_HASH_MULT) % BARRIER_CRACK_X_HASH_MOD) / 100) *
              BARRIER_CRACK_X_RANGE);
      const cy =
        sy +
        s *
          (BARRIER_CRACK_Y_BASE +
            (((c * BARRIER_CRACK_Y_HASH_MULT) % BARRIER_CRACK_Y_HASH_MOD) / 100) *
              BARRIER_CRACK_Y_RANGE);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + s * BARRIER_CRACK_SEG1_X, cy + s * BARRIER_CRACK_SEG1_Y);
      ctx.lineTo(cx + s * BARRIER_CRACK_SEG2_X, cy + s * BARRIER_CRACK_SEG2_Y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Health bar above barrier when damaged ──
  if (hpFraction < 1) {
    const barW = s * BARRIER_HEALTH_BAR_W;
    const barH = BARRIER_HEALTH_BAR_H;
    const barX = sx + s * BARRIER_HEALTH_BAR_OFFSET_X;
    const barY = sy + s * BARRIER_HEALTH_BAR_OFFSET_Y;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle =
      hpFraction > BARRIER_HEALTH_HP_HIGH
        ? '#4ade80'
        : hpFraction > BARRIER_HEALTH_HP_LOW
          ? '#facc15'
          : '#ef4444';
    ctx.fillRect(barX, barY, Math.ceil(barW * hpFraction), barH);
  }
}
