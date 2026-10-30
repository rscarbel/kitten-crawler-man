import { PaintedCellCache } from './paintedCellCache';

/** Head geometry (fractions of tile size). */
const RAVELING_HEAD_R = 0.2;

/** Dangling viscera below the head. */
const RAVELING_ENTRAIL_COUNT = 8;
const RAVELING_ENTRAIL_LENGTH = 0.5;
const RAVELING_ENTRAIL_MIN_LENGTH_FRACTION = 0.45;
const RAVELING_ENTRAIL_MAX_WIDTH = 0.045;
const RAVELING_ENTRAIL_MIN_WIDTH = 0.02;
const RAVELING_ENTRAIL_SPREAD = 0.24;
const RAVELING_ENTRAIL_SWAY_AMP = 0.1;
/** Extra sideways splay applied to the viscera during an attack. */
const RAVELING_ENTRAIL_FLARE = 0.18;
const RAVELING_ENTRAIL_COLORS = ['#7a1622', '#5a0e14', '#a03040'] as const;

/** Organ sac hanging from the severed neck — the viscera's anchor. */
const RAVELING_SAC_Y = 0.26;
const RAVELING_SAC_RX = 0.13;
const RAVELING_SAC_RY = 0.1;
const RAVELING_LUNG_OFFSET_X = 0.1;
const RAVELING_LUNG_RX = 0.07;
const RAVELING_LUNG_RY = 0.09;
const RAVELING_INTESTINE_R = 0.07;
const RAVELING_INTESTINE_Y = 0.38;

/** Float bob + glow. */
const RAVELING_BOB_AMP = 0.06;
/**
 * How far the float phase turns each frame: one bob a little under a second.
 * A caller that counts frames converts through {@link ravelingFloatPhase}; a raw
 * frame count passed as the phase bobs ten times a second and reads as jitter.
 */
export const RAVELING_FLOAT_RADIANS_PER_FRAME = 0.12;

/** The float phase a raveling has reached after `frames` frames of drifting. */
export function ravelingFloatPhase(frames: number): number {
  return frames * RAVELING_FLOAT_RADIANS_PER_FRAME;
}
const RAVELING_GLOW_RADIUS = 10;
/** The halo disc round the head, as a multiple of the head's radius. */
const RAVELING_HALO_SCALE = 1.4;
const RAVELING_EYE_GLOW_RADIUS = 6;
/**
 * Room round a glow cell for its blur, as a multiple of the blur radius: a
 * Gaussian shadow is all but gone by twice its nominal radius.
 */
const GLOW_CELL_BLUR_REACH = 2;
/** Halo and eye cells for a sizes or two, each calm and provoked. */
const RAVELING_GLOW_CELL_LIMIT = 16;
const RAVELING_EYE_R = 0.035;
const RAVELING_EYE_X_OFFSET = 0.08;
const RAVELING_EYE_Y_OFFSET = -0.02;
/** The far eye sits this share of the near eye's offset across the face, on the other side. */
const RAVELING_FAR_EYE_OFFSET_SCALE = 0.3;

/** Attack pose — forward lunge with a gaping jaw. */
const RAVELING_LUNGE_DISTANCE = 0.3;
const RAVELING_MOUTH_X = 0.12;
const RAVELING_MOUTH_Y = 0.07;
const RAVELING_MOUTH_CLOSED_RX = 0.05;
const RAVELING_MOUTH_CLOSED_RY = 0.012;
const RAVELING_MOUTH_GAPE_RY = 0.08;
const RAVELING_FANG_LENGTH = 0.04;

const glowCells = new PaintedCellCache(RAVELING_GLOW_CELL_LIMIT);

/** How a raveling's glows are drawn: blitted from baked cells, or blurred live. */
type GlowMode = 'cached' | 'live';

/**
 * Fills a disc with a blurred shadow round it, at (x, y). Baked once per size
 * and colour by default: `shadowBlur` is among the most expensive Canvas2D
 * operations, and a siege wave brings several ravelings at once.
 */
function drawGlowDisc(
  ctx: CanvasRenderingContext2D,
  mode: GlowMode,
  x: number,
  y: number,
  radius: number,
  blur: number,
  shadowColor: string,
  fill: string,
): void {
  const paint = (target: CanvasRenderingContext2D, cx: number, cy: number): void => {
    target.save();
    target.shadowColor = shadowColor;
    target.shadowBlur = blur;
    target.fillStyle = fill;
    target.beginPath();
    target.arc(cx, cy, radius, 0, Math.PI * 2);
    target.fill();
    target.restore();
  };
  if (mode === 'live') {
    paint(ctx, x, y);
    return;
  }
  const reach = radius + blur * GLOW_CELL_BLUR_REACH;
  const box = { left: -reach, top: -reach, width: reach * 2, height: reach * 2 };
  const key = `${radius}|${blur}|${shadowColor}|${fill}`;
  const drawn = glowCells.draw(ctx, key, x, y, box, false, (cellCtx) => paint(cellCtx, 0, 0));
  if (!drawn) paint(ctx, x, y);
}

/**
 * Draw a raveling — a disembodied flying female head trailing an organ sac and
 * dangling entrails, one of Taloncrest's ruins-monsters. Bobs and drifts
 * erratically, only viscera hanging below the severed neck.
 *
 * @param floatPhase continuously increasing phase (radians) driving bob + entrail sway.
 * @param isAggressive true once the raveling has been provoked — brightens the glow.
 * @param attackAnim 0..1 progress through the bite lunge; 0 when idle.
 */
export function drawRavelingSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  floatPhase = 0,
  isAggressive = false,
  facingX = 1,
  attackAnim = 0,
): void {
  paintRaveling(ctx, 'cached', sx, sy, s, floatPhase, isAggressive, facingX, attackAnim);
}

/**
 * {@link drawRavelingSprite} with every glow blurred live rather than blitted,
 * for a vector export, where a baked cell would come out as a bitmap.
 */
export function paintRavelingSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  floatPhase = 0,
  isAggressive = false,
  facingX = 1,
  attackAnim = 0,
): void {
  paintRaveling(ctx, 'live', sx, sy, s, floatPhase, isAggressive, facingX, attackAnim);
}

function paintRaveling(
  ctx: CanvasRenderingContext2D,
  glow: GlowMode,
  sx: number,
  sy: number,
  s: number,
  floatPhase: number,
  isAggressive: boolean,
  facingX: number,
  attackAnim: number,
): void {
  const cx = sx + s / 2;
  const bob = Math.sin(floatPhase) * RAVELING_BOB_AMP * s;
  const cy = sy + s / 2 + bob;
  const attackEase = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) : 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);
  ctx.translate(attackEase * RAVELING_LUNGE_DISTANCE * s, 0);

  drawGlowDisc(
    ctx,
    glow,
    0,
    0,
    RAVELING_HEAD_R * s * RAVELING_HALO_SCALE,
    RAVELING_GLOW_RADIUS,
    isAggressive ? '#ff3020' : '#aa2a40',
    isAggressive ? 'rgba(255,60,40,0.18)' : 'rgba(170,40,60,0.14)',
  );

  // Dangling entrails — gnarled two-segment curves growing from the organ
  // sac, each with its own seeded length, width, colour, and sway rhythm.
  const sacY = RAVELING_SAC_Y * s;
  ctx.lineCap = 'round';
  for (let i = 0; i < RAVELING_ENTRAIL_COUNT; i++) {
    const t = i / (RAVELING_ENTRAIL_COUNT - 1);
    const baseX = (t - 0.5) * RAVELING_ENTRAIL_SPREAD * s;
    const lengthFraction =
      RAVELING_ENTRAIL_MIN_LENGTH_FRACTION +
      (1 - RAVELING_ENTRAIL_MIN_LENGTH_FRACTION) * (((i * 5 + 3) % 7) / 6);
    const len = RAVELING_ENTRAIL_LENGTH * s * lengthFraction;
    const sway = Math.sin(floatPhase * 1.6 + i * 1.3) * RAVELING_ENTRAIL_SWAY_AMP * s;
    // Attack: the whole mass splays outward as the head whips forward.
    const flare = attackEase * (t - 0.5) * RAVELING_ENTRAIL_FLARE * s * 2;
    const width =
      (RAVELING_ENTRAIL_MIN_WIDTH +
        (RAVELING_ENTRAIL_MAX_WIDTH - RAVELING_ENTRAIL_MIN_WIDTH) * (((i * 3 + 1) % 5) / 4)) *
      s;

    ctx.strokeStyle = RAVELING_ENTRAIL_COLORS[i % RAVELING_ENTRAIL_COLORS.length];
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(baseX, sacY);
    // Alternating control points give each strand a kinked, ropey path
    // instead of a straight leg-like drop.
    ctx.quadraticCurveTo(
      baseX - sway + flare,
      sacY + len * 0.4,
      baseX + sway * 0.6,
      sacY + len * 0.65,
    );
    ctx.quadraticCurveTo(
      baseX + sway * 1.6 + flare,
      sacY + len * 0.85,
      baseX + sway + flare * 1.5,
      sacY + len,
    );
    ctx.stroke();

    // Glistening highlight dot partway down every other strand
    if (i % 2 === 0) {
      ctx.fillStyle = '#c05868';
      ctx.beginPath();
      ctx.arc(baseX + sway * 0.6, sacY + len * 0.6, width * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = '#b04858';
  ctx.lineWidth = RAVELING_ENTRAIL_MAX_WIDTH * s;
  ctx.beginPath();
  ctx.arc(
    Math.sin(floatPhase * 1.3) * RAVELING_ENTRAIL_SWAY_AMP * s * 0.5,
    RAVELING_INTESTINE_Y * s,
    RAVELING_INTESTINE_R * s,
    0,
    Math.PI * 1.5,
  );
  ctx.stroke();

  // Organ sac: lungs behind, heart in front, hanging from the severed neck
  ctx.fillStyle = '#a03040';
  ctx.beginPath();
  ctx.ellipse(
    -RAVELING_LUNG_OFFSET_X * s,
    sacY,
    RAVELING_LUNG_RX * s,
    RAVELING_LUNG_RY * s,
    0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    RAVELING_LUNG_OFFSET_X * s,
    sacY,
    RAVELING_LUNG_RX * s,
    RAVELING_LUNG_RY * s,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#8a1420';
  ctx.beginPath();
  ctx.ellipse(0, sacY, RAVELING_SAC_RX * s, RAVELING_SAC_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c04050';
  ctx.beginPath();
  ctx.ellipse(
    -RAVELING_SAC_RX * s * 0.3,
    sacY - RAVELING_SAC_RY * s * 0.3,
    RAVELING_SAC_RX * s * 0.35,
    RAVELING_SAC_RY * s * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = '#7a5a58';
  ctx.beginPath();
  ctx.arc(0, 0, RAVELING_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3c3a';
  ctx.beginPath();
  ctx.arc(RAVELING_HEAD_R * s * 0.25, 0, RAVELING_HEAD_R * s * 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Mouth — a thin line at rest, a gaping fanged maw mid-lunge
  const mouthX = RAVELING_MOUTH_X * s;
  const mouthY = RAVELING_MOUTH_Y * s;
  const mouthRy = RAVELING_MOUTH_CLOSED_RY * s + attackEase * RAVELING_MOUTH_GAPE_RY * s;
  ctx.fillStyle = '#2a0508';
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, RAVELING_MOUTH_CLOSED_RX * s, mouthRy, 0, 0, Math.PI * 2);
  ctx.fill();
  if (attackEase > 0.3) {
    ctx.fillStyle = '#e8e2d4';
    const fang = RAVELING_FANG_LENGTH * s * attackEase;
    ctx.beginPath();
    ctx.moveTo(mouthX - RAVELING_MOUTH_CLOSED_RX * s * 0.6, mouthY - mouthRy);
    ctx.lineTo(mouthX - RAVELING_MOUTH_CLOSED_RX * s * 0.3, mouthY - mouthRy + fang);
    ctx.lineTo(mouthX, mouthY - mouthRy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mouthX + RAVELING_MOUTH_CLOSED_RX * s * 0.1, mouthY - mouthRy);
    ctx.lineTo(mouthX + RAVELING_MOUTH_CLOSED_RX * s * 0.4, mouthY - mouthRy + fang);
    ctx.lineTo(mouthX + RAVELING_MOUTH_CLOSED_RX * s * 0.7, mouthY - mouthRy);
    ctx.closePath();
    ctx.fill();
  }

  const eyeShadow = isAggressive ? '#ff5030' : '#ff8060';
  const eyeFill = isAggressive ? '#ffcc44' : '#ffaa66';
  const eyeY = RAVELING_EYE_Y_OFFSET * s;
  const eyeR = RAVELING_EYE_R * s;
  const nearEyeX = RAVELING_EYE_X_OFFSET * s;
  const farEyeX = -RAVELING_EYE_X_OFFSET * s * RAVELING_FAR_EYE_OFFSET_SCALE;
  drawGlowDisc(ctx, glow, nearEyeX, eyeY, eyeR, RAVELING_EYE_GLOW_RADIUS, eyeShadow, eyeFill);
  drawGlowDisc(ctx, glow, farEyeX, eyeY, eyeR, RAVELING_EYE_GLOW_RADIUS, eyeShadow, eyeFill);

  ctx.restore();
}
