const ICON_PULSE_FREQUENCY = 6;
const ICON_PULSE_AMPLITUDE = 0.3;
const ICON_PULSE_BASE = 1.0;
const ICON_GLOW_ALPHA = 0.6;
const ICON_GLOW_BASE_RADIUS = 0.5;
const ICON_GLOW_ANIMATION_RANGE = 24;
const ICON_GLOW_SINE_FREQUENCY = 8;
const ICON_GLOW_SINE_AMPLITUDE = 0.5;

/**
 * Renders an icon with the shared power-up pulse + glow ring animation used by
 * AbilityLevelUpDialog and RewardGrantedDialog.
 *
 * @param iconPulse - Progress through the power-up phase (0 → 1).
 * @param isPowerUp - True while the power_up phase is active.
 * @param drawIcon  - Called inside the transform to draw the icon itself.
 */
export function drawPowerUpIcon(
  ctx: CanvasRenderingContext2D,
  iconX: number,
  iconY: number,
  iconSize: number,
  iconPulse: number,
  isPowerUp: boolean,
  drawIcon: () => void,
): void {
  const pulse = isPowerUp
    ? Math.sin(iconPulse * Math.PI * ICON_PULSE_FREQUENCY) * ICON_PULSE_AMPLITUDE + ICON_PULSE_BASE
    : ICON_PULSE_BASE;

  ctx.save();
  ctx.translate(iconX + iconSize / 2, iconY + iconSize / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-(iconX + iconSize / 2), -(iconY + iconSize / 2));

  if (isPowerUp) {
    const glowAlpha = iconPulse * ICON_GLOW_ALPHA;
    const glowRadius = iconSize * ICON_GLOW_BASE_RADIUS + iconPulse * ICON_GLOW_ANIMATION_RANGE;
    ctx.globalAlpha =
      glowAlpha *
      (ICON_GLOW_SINE_AMPLITUDE +
        ICON_GLOW_SINE_AMPLITUDE * Math.sin(iconPulse * Math.PI * ICON_GLOW_SINE_FREQUENCY));
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, glowRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawIcon();
  ctx.restore();
}

/** Breaks `text` into lines that fit within `maxWidth` at the current ctx font. */
export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}
