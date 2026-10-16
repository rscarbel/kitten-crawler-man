import { PaintedCellCache } from './paintedCellCache';

/** Head geometry (fractions of tile size). */
const KRASUE_HEAD_R = 0.2;

/** Dangling viscera below the head. */
const KRASUE_ENTRAIL_COUNT = 8;
const KRASUE_ENTRAIL_LENGTH = 0.5;
const KRASUE_ENTRAIL_MIN_LENGTH_FRACTION = 0.45;
const KRASUE_ENTRAIL_MAX_WIDTH = 0.045;
const KRASUE_ENTRAIL_MIN_WIDTH = 0.02;
const KRASUE_ENTRAIL_SPREAD = 0.24;
const KRASUE_ENTRAIL_SWAY_AMP = 0.1;
/** Extra sideways splay applied to the viscera during an attack. */
const KRASUE_ENTRAIL_FLARE = 0.18;
const KRASUE_ENTRAIL_COLORS = ['#7a1622', '#5a0e14', '#a03040'] as const;

/** Organ sac hanging from the severed neck — the viscera's anchor. */
const KRASUE_SAC_Y = 0.26;
const KRASUE_SAC_RX = 0.13;
const KRASUE_SAC_RY = 0.1;
const KRASUE_LUNG_OFFSET_X = 0.1;
const KRASUE_LUNG_RX = 0.07;
const KRASUE_LUNG_RY = 0.09;
const KRASUE_INTESTINE_R = 0.07;
const KRASUE_INTESTINE_Y = 0.38;

/** Float bob + glow. */
const KRASUE_BOB_AMP = 0.06;
const KRASUE_GLOW_RADIUS = 10;
/** The halo disc round the head, as a multiple of the head's radius. */
const KRASUE_HALO_SCALE = 1.4;
const KRASUE_EYE_GLOW_RADIUS = 6;
/**
 * Room round a glow cell for its blur, as a multiple of the blur radius: a
 * Gaussian shadow is all but gone by twice its nominal radius.
 */
const GLOW_CELL_BLUR_REACH = 2;
/** Halo and eye cells for a sizes or two, each calm and provoked. */
const KRASUE_GLOW_CELL_LIMIT = 16;
const KRASUE_EYE_R = 0.035;
const KRASUE_EYE_X_OFFSET = 0.08;
const KRASUE_EYE_Y_OFFSET = -0.02;
/** The far eye sits this share of the near eye's offset across the face, on the other side. */
const KRASUE_FAR_EYE_OFFSET_SCALE = 0.3;

/** Attack pose — forward lunge with a gaping jaw. */
const KRASUE_LUNGE_DISTANCE = 0.3;
const KRASUE_MOUTH_X = 0.12;
const KRASUE_MOUTH_Y = 0.07;
const KRASUE_MOUTH_CLOSED_RX = 0.05;
const KRASUE_MOUTH_CLOSED_RY = 0.012;
const KRASUE_MOUTH_GAPE_RY = 0.08;
const KRASUE_FANG_LENGTH = 0.04;

const glowCells = new PaintedCellCache(KRASUE_GLOW_CELL_LIMIT);

/** How a krasue's glows are drawn: blitted from baked cells, or blurred live. */
type GlowMode = 'cached' | 'live';

/**
 * Fills a disc with a blurred shadow round it, at (x, y). Baked once per size
 * and colour by default: `shadowBlur` is among the most expensive Canvas2D
 * operations, and a siege wave brings several krasue at once.
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
 * Draw a krasue — a disembodied flying female head trailing an organ sac and
 * dangling entrails, one of the Over City's ruins-monsters. Bobs and drifts
 * erratically, only viscera hanging below the severed neck.
 *
 * @param floatPhase continuously increasing phase (radians) driving bob + entrail sway.
 * @param isAggressive true once the krasue has been provoked — brightens the glow.
 * @param attackAnim 0..1 progress through the bite lunge; 0 when idle.
 */
export function drawKrasueSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  floatPhase = 0,
  isAggressive = false,
  facingX = 1,
  attackAnim = 0,
): void {
  paintKrasue(ctx, 'cached', sx, sy, s, floatPhase, isAggressive, facingX, attackAnim);
}

/**
 * {@link drawKrasueSprite} with every glow blurred live rather than blitted,
 * for a vector export, where a baked cell would come out as a bitmap.
 */
export function paintKrasueSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  floatPhase = 0,
  isAggressive = false,
  facingX = 1,
  attackAnim = 0,
): void {
  paintKrasue(ctx, 'live', sx, sy, s, floatPhase, isAggressive, facingX, attackAnim);
}

function paintKrasue(
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
  const bob = Math.sin(floatPhase) * KRASUE_BOB_AMP * s;
  const cy = sy + s / 2 + bob;
  const attackEase = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) : 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);
  ctx.translate(attackEase * KRASUE_LUNGE_DISTANCE * s, 0);

  drawGlowDisc(
    ctx,
    glow,
    0,
    0,
    KRASUE_HEAD_R * s * KRASUE_HALO_SCALE,
    KRASUE_GLOW_RADIUS,
    isAggressive ? '#ff3020' : '#aa2a40',
    isAggressive ? 'rgba(255,60,40,0.18)' : 'rgba(170,40,60,0.14)',
  );

  // Dangling entrails — gnarled two-segment curves growing from the organ
  // sac, each with its own seeded length, width, colour, and sway rhythm.
  const sacY = KRASUE_SAC_Y * s;
  ctx.lineCap = 'round';
  for (let i = 0; i < KRASUE_ENTRAIL_COUNT; i++) {
    const t = i / (KRASUE_ENTRAIL_COUNT - 1);
    const baseX = (t - 0.5) * KRASUE_ENTRAIL_SPREAD * s;
    const lengthFraction =
      KRASUE_ENTRAIL_MIN_LENGTH_FRACTION +
      (1 - KRASUE_ENTRAIL_MIN_LENGTH_FRACTION) * (((i * 5 + 3) % 7) / 6);
    const len = KRASUE_ENTRAIL_LENGTH * s * lengthFraction;
    const sway = Math.sin(floatPhase * 1.6 + i * 1.3) * KRASUE_ENTRAIL_SWAY_AMP * s;
    // Attack: the whole mass splays outward as the head whips forward.
    const flare = attackEase * (t - 0.5) * KRASUE_ENTRAIL_FLARE * s * 2;
    const width =
      (KRASUE_ENTRAIL_MIN_WIDTH +
        (KRASUE_ENTRAIL_MAX_WIDTH - KRASUE_ENTRAIL_MIN_WIDTH) * (((i * 3 + 1) % 5) / 4)) *
      s;

    ctx.strokeStyle = KRASUE_ENTRAIL_COLORS[i % KRASUE_ENTRAIL_COLORS.length];
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
  ctx.lineWidth = KRASUE_ENTRAIL_MAX_WIDTH * s;
  ctx.beginPath();
  ctx.arc(
    Math.sin(floatPhase * 1.3) * KRASUE_ENTRAIL_SWAY_AMP * s * 0.5,
    KRASUE_INTESTINE_Y * s,
    KRASUE_INTESTINE_R * s,
    0,
    Math.PI * 1.5,
  );
  ctx.stroke();

  // Organ sac: lungs behind, heart in front, hanging from the severed neck
  ctx.fillStyle = '#a03040';
  ctx.beginPath();
  ctx.ellipse(
    -KRASUE_LUNG_OFFSET_X * s,
    sacY,
    KRASUE_LUNG_RX * s,
    KRASUE_LUNG_RY * s,
    0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    KRASUE_LUNG_OFFSET_X * s,
    sacY,
    KRASUE_LUNG_RX * s,
    KRASUE_LUNG_RY * s,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#8a1420';
  ctx.beginPath();
  ctx.ellipse(0, sacY, KRASUE_SAC_RX * s, KRASUE_SAC_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c04050';
  ctx.beginPath();
  ctx.ellipse(
    -KRASUE_SAC_RX * s * 0.3,
    sacY - KRASUE_SAC_RY * s * 0.3,
    KRASUE_SAC_RX * s * 0.35,
    KRASUE_SAC_RY * s * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = '#7a5a58';
  ctx.beginPath();
  ctx.arc(0, 0, KRASUE_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3c3a';
  ctx.beginPath();
  ctx.arc(KRASUE_HEAD_R * s * 0.25, 0, KRASUE_HEAD_R * s * 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Mouth — a thin line at rest, a gaping fanged maw mid-lunge
  const mouthX = KRASUE_MOUTH_X * s;
  const mouthY = KRASUE_MOUTH_Y * s;
  const mouthRy = KRASUE_MOUTH_CLOSED_RY * s + attackEase * KRASUE_MOUTH_GAPE_RY * s;
  ctx.fillStyle = '#2a0508';
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY, KRASUE_MOUTH_CLOSED_RX * s, mouthRy, 0, 0, Math.PI * 2);
  ctx.fill();
  if (attackEase > 0.3) {
    ctx.fillStyle = '#e8e2d4';
    const fang = KRASUE_FANG_LENGTH * s * attackEase;
    ctx.beginPath();
    ctx.moveTo(mouthX - KRASUE_MOUTH_CLOSED_RX * s * 0.6, mouthY - mouthRy);
    ctx.lineTo(mouthX - KRASUE_MOUTH_CLOSED_RX * s * 0.3, mouthY - mouthRy + fang);
    ctx.lineTo(mouthX, mouthY - mouthRy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mouthX + KRASUE_MOUTH_CLOSED_RX * s * 0.1, mouthY - mouthRy);
    ctx.lineTo(mouthX + KRASUE_MOUTH_CLOSED_RX * s * 0.4, mouthY - mouthRy + fang);
    ctx.lineTo(mouthX + KRASUE_MOUTH_CLOSED_RX * s * 0.7, mouthY - mouthRy);
    ctx.closePath();
    ctx.fill();
  }

  const eyeShadow = isAggressive ? '#ff5030' : '#ff8060';
  const eyeFill = isAggressive ? '#ffcc44' : '#ffaa66';
  const eyeY = KRASUE_EYE_Y_OFFSET * s;
  const eyeR = KRASUE_EYE_R * s;
  const nearEyeX = KRASUE_EYE_X_OFFSET * s;
  const farEyeX = -KRASUE_EYE_X_OFFSET * s * KRASUE_FAR_EYE_OFFSET_SCALE;
  drawGlowDisc(ctx, glow, nearEyeX, eyeY, eyeR, KRASUE_EYE_GLOW_RADIUS, eyeShadow, eyeFill);
  drawGlowDisc(ctx, glow, farEyeX, eyeY, eyeR, KRASUE_EYE_GLOW_RADIUS, eyeShadow, eyeFill);

  ctx.restore();
}
