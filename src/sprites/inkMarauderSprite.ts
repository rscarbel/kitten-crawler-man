/** Frames of the coalescing swirl before the beast has full form. */
export const INK_EMERGE_FRAMES = 30;

/** Beast proportions (fractions of tile size). */
const INK_BODY_RX = 0.22;
const INK_BODY_RY = 0.13;
const INK_BODY_Y = 0.1;
const INK_HEAD_R = 0.11;
const INK_HEAD_X = 0.2;
const INK_HEAD_Y = -0.02;
const INK_LEG_WIDTH = 0.045;
const INK_LEG_HEIGHT = 0.12;
const INK_LEG_X = 0.13;
const INK_LEG_Y = 0.2;
const INK_TAIL_LENGTH = 0.28;
const INK_EAR_LENGTH = 0.08;
const INK_EYE_R = 0.03;
const INK_BOB_AMP = 0.02;
const INK_BOB_SPEED = 0.1;

/** Coalescing swirl during the emerge animation. */
const SWIRL_ARM_COUNT = 4;
const SWIRL_MAX_R = 0.42;
const SWIRL_SPEED = 0.3;

/** Ink wisps bleeding off the beast as it fades. */
const WISP_COUNT = 3;
const WISP_RISE = 0.3;

const INK_BLACK = '#10141f';
const INK_LINE = '#2e3a56';
const INK_GLOW = '#8ae0d0';

/**
 * Draw an Ink Marauder — one of Signet's tattoos torn from her skin and
 * given fangs: a sleek ink-black beast outlined in thick tattoo line-work.
 * It coalesces from swirling ink when summoned and bleeds away into wisps
 * as its lifespan ends.
 *
 * @param age frames since summoning — drives the emerge swirl and idle bob.
 * @param lifeFraction 1 at spawn, fading toward 0 as its lifespan ends.
 */
export function drawInkMarauderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  age = 0,
  lifeFraction = 1,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2 + Math.sin(age * INK_BOB_SPEED) * INK_BOB_AMP * s;
  const emerging = age < INK_EMERGE_FRAMES;
  const formProgress = emerging ? age / INK_EMERGE_FRAMES : 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, lifeFraction));

  // Coalescing ink swirl — line-work spiralling inward as the beast forms
  if (emerging) {
    ctx.strokeStyle = INK_LINE;
    ctx.lineWidth = Math.max(1, s * 0.02);
    for (let i = 0; i < SWIRL_ARM_COUNT; i++) {
      const baseAngle = age * SWIRL_SPEED + (i / SWIRL_ARM_COUNT) * Math.PI * 2;
      const radius = SWIRL_MAX_R * s * (1 - formProgress);
      ctx.beginPath();
      ctx.arc(cx, cy, radius + s * 0.04 * i, baseAngle, baseAngle + Math.PI * 0.6);
      ctx.stroke();
    }
  }

  // The beast itself scales in with the emerge
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(formProgress, formProgress);
  ctx.globalAlpha *= formProgress;

  // Tail — a single thick tattoo stroke curling behind
  ctx.strokeStyle = INK_LINE;
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-INK_BODY_RX * s, INK_BODY_Y * s);
  ctx.quadraticCurveTo(
    -(INK_BODY_RX + INK_TAIL_LENGTH * 0.7) * s,
    (INK_BODY_Y - 0.12) * s + Math.sin(age * INK_BOB_SPEED * 1.4) * 0.04 * s,
    -(INK_BODY_RX + INK_TAIL_LENGTH) * s,
    (INK_BODY_Y - 0.02) * s,
  );
  ctx.stroke();

  // Legs
  ctx.fillStyle = INK_BLACK;
  const legStride = Math.sin(age * 0.25) * 0.03 * s;
  ctx.fillRect(-INK_LEG_X * s, INK_LEG_Y * s + legStride, INK_LEG_WIDTH * s, INK_LEG_HEIGHT * s);
  ctx.fillRect(INK_LEG_X * s, INK_LEG_Y * s - legStride, INK_LEG_WIDTH * s, INK_LEG_HEIGHT * s);

  // Body — solid ink with a thick tattoo outline
  ctx.beginPath();
  ctx.ellipse(0, INK_BODY_Y * s, INK_BODY_RX * s, INK_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK_LINE;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.stroke();

  // Head with pricked ink ears
  ctx.fillStyle = INK_BLACK;
  ctx.beginPath();
  ctx.arc(INK_HEAD_X * s, INK_HEAD_Y * s, INK_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo((INK_HEAD_X - 0.05) * s, (INK_HEAD_Y - INK_HEAD_R * 0.7) * s);
  ctx.lineTo((INK_HEAD_X - 0.02) * s, (INK_HEAD_Y - INK_HEAD_R * 0.7 - INK_EAR_LENGTH) * s);
  ctx.lineTo((INK_HEAD_X + 0.03) * s, (INK_HEAD_Y - INK_HEAD_R * 0.6) * s);
  ctx.closePath();
  ctx.fill();

  // Glowing summoner's-mark eye
  ctx.save();
  ctx.shadowColor = INK_GLOW;
  ctx.shadowBlur = 5;
  ctx.fillStyle = INK_GLOW;
  ctx.beginPath();
  ctx.arc((INK_HEAD_X + 0.04) * s, INK_HEAD_Y * s, INK_EYE_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();

  // Ink wisps bleeding upward as the beast dissipates
  if (lifeFraction < 1) {
    ctx.fillStyle = INK_LINE;
    for (let i = 0; i < WISP_COUNT; i++) {
      const progress = ((age * 0.02 + i / WISP_COUNT) % 1) * (1 - lifeFraction);
      ctx.globalAlpha = Math.max(0, lifeFraction * (1 - progress));
      ctx.beginPath();
      ctx.arc(
        cx + Math.sin(age * 0.1 + i * 2) * 0.08 * s,
        cy - progress * WISP_RISE * s,
        s * 0.025,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  ctx.restore();
}
