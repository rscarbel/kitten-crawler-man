/**
 * The Build button's icon: a hammer and a saw crossed over a small plank.
 *
 * Painted in code at whatever size the button is, like the Journal's compass
 * rose. The plank is drawn first and low so the two tools cross over it and
 * the three read as one "carpentry" glyph at 24 px, where a lone hammer would
 * read as the attack icon.
 */

const OUTLINE = '#1c1712';
const PLANK = '#b0824a';
const PLANK_GRAIN = '#7c5630';
const HANDLE = '#8a5a2e';
const STEEL = '#cbd5e1';
const STEEL_DARK = '#64748b';

/** Everything below is in fractions of the icon's size, from its top-left. */
const PLANK_X = 0.1;
const PLANK_Y = 0.66;
const PLANK_W = 0.8;
const PLANK_H = 0.2;
const PLANK_RADIUS = 0.04;
const TOOL_LENGTH = 0.78;
/** The tools cross at right angles, each leaning 45° off upright. */
const TOOL_CROSS_ANGLE_DEGREES = 45;
const DEGREES_PER_HALF_TURN = 180;
const TOOL_CROSS_ANGLE = (TOOL_CROSS_ANGLE_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
const HANDLE_WIDTH = 0.1;
const HANDLE_SHARE = 0.55;
const HAMMER_HEAD_W = 0.34;
const HAMMER_HEAD_H = 0.15;
const SAW_BLADE_WIDTH = 0.2;
const SAW_TEETH = 6;
const SAW_TOOTH_DEPTH = 0.05;
const OUTLINE_WIDTH = 0.04;
const HALF = 0.5;
const GRAIN_WIDTH_SHARE = 0.6;
const GRAIN_INSET = 0.08;
/** The tools cross a little above the icon's middle, clear of the plank. */
const TOOLS_CENTRE_Y = 0.46;
const SAW_HANDLE_SHARE = 0.8;
/** The saw's blade narrows toward its tip. */
const SAW_TIP_TAPER = 0.33;
const SAW_GRIP_HALF_WIDTH = 0.6;
const HAMMER_HANDLE_SHARE = 0.95;
/** The claw's notch and how far the claw curls down past the head. */
const CLAW_NOTCH = 0.15;
const CLAW_REACH = 1.4;

export function drawConstructionIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH);

    ctx.fillStyle = PLANK;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.roundRect(
      x + size * PLANK_X,
      y + size * PLANK_Y,
      size * PLANK_W,
      size * PLANK_H,
      size * PLANK_RADIUS,
    );
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = PLANK_GRAIN;
    ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH * GRAIN_WIDTH_SHARE);
    ctx.beginPath();
    ctx.moveTo(x + size * (PLANK_X + GRAIN_INSET), y + size * (PLANK_Y + PLANK_H * HALF));
    ctx.lineTo(x + size * (PLANK_X + PLANK_W - GRAIN_INSET), y + size * (PLANK_Y + PLANK_H * HALF));
    ctx.stroke();

    const centreX = x + size / 2;
    const centreY = y + size * TOOLS_CENTRE_Y;
    drawSaw(ctx, centreX, centreY, size);
    drawHammer(ctx, centreX, centreY, size);
  } finally {
    ctx.restore();
  }
}

/** The saw, leaning from bottom-left to top-right: handle low, toothed blade up. */
function drawSaw(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(TOOL_CROSS_ANGLE);
  const half = (TOOL_LENGTH * size) / 2;
  const handleLength = TOOL_LENGTH * size * (1 - HANDLE_SHARE) * SAW_HANDLE_SHARE;
  const bladeTop = -half;
  const bladeBottom = half - handleLength;
  const bladeWidth = SAW_BLADE_WIDTH * size;
  ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH);
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = STEEL;
  ctx.beginPath();
  ctx.moveTo(-bladeWidth / 2, bladeBottom);
  ctx.lineTo(-bladeWidth * SAW_TIP_TAPER, bladeTop);
  ctx.lineTo(bladeWidth / 2, bladeTop);
  ctx.lineTo(bladeWidth / 2, bladeBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = STEEL_DARK;
  const toothStep = (bladeBottom - bladeTop) / SAW_TEETH;
  for (let tooth = 0; tooth < SAW_TEETH; tooth++) {
    const ty = bladeTop + tooth * toothStep;
    ctx.beginPath();
    ctx.moveTo(bladeWidth / 2, ty);
    ctx.lineTo(bladeWidth / 2 + SAW_TOOTH_DEPTH * size, ty + toothStep / 2);
    ctx.lineTo(bladeWidth / 2, ty + toothStep);
    ctx.fill();
  }
  ctx.fillStyle = HANDLE;
  ctx.beginPath();
  ctx.roundRect(
    -bladeWidth * SAW_GRIP_HALF_WIDTH,
    bladeBottom,
    bladeWidth * SAW_GRIP_HALF_WIDTH * 2,
    handleLength,
    size * PLANK_RADIUS,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The hammer, leaning the other way over the saw: handle low right, head top left. */
function drawHammer(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-TOOL_CROSS_ANGLE);
  const half = (TOOL_LENGTH * size) / 2;
  const handleWidth = HANDLE_WIDTH * size;
  ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH);
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = HANDLE;
  ctx.beginPath();
  ctx.roundRect(
    -handleWidth / 2,
    -half + HAMMER_HEAD_H * size * HALF,
    handleWidth,
    TOOL_LENGTH * size * HAMMER_HANDLE_SHARE,
    handleWidth / 2,
  );
  ctx.fill();
  ctx.stroke();
  const headW = HAMMER_HEAD_W * size;
  const headH = HAMMER_HEAD_H * size;
  ctx.fillStyle = STEEL;
  ctx.beginPath();
  ctx.moveTo(-headW / 2, -half);
  ctx.lineTo(headW / 2, -half);
  ctx.lineTo(headW / 2, -half + headH);
  ctx.lineTo(-headW / 2 + headW * CLAW_NOTCH, -half + headH);
  ctx.lineTo(-headW / 2, -half + headH * CLAW_REACH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
