/**
 * The bandage shimmer Sella's treatment plays over each crawler: a pale
 * wrap of cloth circling the body and small green crosses drifting up off
 * it, swelling in and fading out over the treatment. Game-world effect art,
 * drawn in screen space around the crawler's centre.
 */

const FULL_TURN = Math.PI * 2;
/** Turns the wrap makes around the body over the whole treatment. */
const WRAP_TURNS = 2;
const WRAP_RADIUS_X = 13;
const WRAP_RADIUS_Y = 5;
/** The wrap climbs from the feet to the chest as it goes round. */
const WRAP_RISE_PX = 18;
const WRAP_BOTTOM_OFFSET_PX = 8;
const WRAP_ARC = 1.6;
const WRAP_WIDTH_PX = 3;
const WRAP_COLOR = 'rgba(245, 240, 225, ALPHA)';

const CROSS_COUNT = 4;
const CROSS_ARM_PX = 3;
const CROSS_THICKNESS_PX = 2;
const CROSS_SPREAD_PX = 11;
const CROSS_RISE_PX = 22;
const CROSS_COLOR = 'rgba(110, 231, 140, ALPHA)';

/** The fraction of the treatment spent fading in, and again fading out. */
const FADE_FRACTION = 0.2;
/** Enough decimals for a canvas alpha without writing out float noise. */
const ALPHA_DECIMALS = 3;

function withAlpha(template: string, alpha: number): string {
  return template.replace('ALPHA', alpha.toFixed(ALPHA_DECIMALS));
}

/** 0 → 1 → 0 over the treatment, easing in and out of its ends. */
function envelope(progress: number): number {
  const rising = Math.min(1, progress / FADE_FRACTION);
  const falling = Math.min(1, (1 - progress) / FADE_FRACTION);
  return Math.max(0, Math.min(rising, falling));
}

/**
 * @param centreX Screen x of the crawler's body centre.
 * @param centreY Screen y of the crawler's body centre.
 * @param progress How far through the treatment, 0 to 1.
 */
export function renderTreatmentShimmer(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  progress: number,
): void {
  const alpha = envelope(progress);
  if (alpha <= 0) return;
  ctx.save();

  const angle = progress * WRAP_TURNS * FULL_TURN;
  const wrapY = centreY + WRAP_BOTTOM_OFFSET_PX - progress * WRAP_RISE_PX;
  ctx.strokeStyle = withAlpha(WRAP_COLOR, alpha);
  ctx.lineWidth = WRAP_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(centreX, wrapY, WRAP_RADIUS_X, WRAP_RADIUS_Y, 0, angle, angle + WRAP_ARC);
  ctx.stroke();

  ctx.fillStyle = withAlpha(CROSS_COLOR, alpha);
  for (let index = 0; index < CROSS_COUNT; index++) {
    const phase = (progress + index / CROSS_COUNT) % 1;
    const sideways = Math.sin((index / CROSS_COUNT) * FULL_TURN) * CROSS_SPREAD_PX;
    const x = centreX + sideways;
    const y = centreY - phase * CROSS_RISE_PX;
    const arm = CROSS_ARM_PX;
    const half = CROSS_THICKNESS_PX / 2;
    ctx.fillRect(x - arm, y - half, arm * 2, CROSS_THICKNESS_PX);
    ctx.fillRect(x - half, y - arm, CROSS_THICKNESS_PX, arm * 2);
  }
  ctx.restore();
}
