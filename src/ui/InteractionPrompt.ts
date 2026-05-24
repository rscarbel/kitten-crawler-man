import { platform } from '../core/Platform';

// InteractionPrompt layout constants
const BOB_PERIOD = 400;
const BOB_AMPLITUDE = 2;
const KEY_PADDING = 10;
const KEY_HEIGHT = 16;
const LABEL_GAP = 4;
const KEY_RADIUS = 3;
const LABEL_Y_OFFSET = 12;
const LABEL_X_OFFSET = 4;
const KEY_CENTER_X = 0.5;
const KEY_CENTER_Y = 0.5;
const KEY_CENTER_Y_OFFSET = 0.5;
const HALF_DIVISOR = 0.5;
const HIGHLIGHT_OFFSET_X = 1;
const HIGHLIGHT_OFFSET_Y = 2;
const HIGHLIGHT_LINE_OFFSET = 1;

/**
 * Draws a floating interaction prompt above an object in world-space.
 *
 * Renders a small rounded "SPACE" key icon (or "TAP" on mobile) with an
 * optional action label, bobbing gently to draw the player's eye.
 *
 * @param ctx      Canvas context (world-space, already camera-offset)
 * @param sx       Screen-x of the object's top-left corner
 * @param sy       Screen-y of the object's top-left corner
 * @param objW     Width of the object in pixels (prompt is centered above it)
 * @param label    Optional action label shown to the right of the key, e.g. "Sleep"
 * @param keyOverride  Optional key text override (default: "SPACE" / "TAP")
 */
export function drawInteractionPrompt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  objW: number,
  label?: string,
  keyOverride?: string,
): void {
  const keyText = keyOverride ?? (platform.isMobile ? 'TAP' : 'SPACE');
  const bob = Math.sin(performance.now() / BOB_PERIOD) * BOB_AMPLITUDE;

  ctx.save();
  ctx.font = 'bold 9px monospace';

  const keyMetrics = ctx.measureText(keyText);
  const keyW = keyMetrics.width + KEY_PADDING;
  const keyH = KEY_HEIGHT;

  let totalW = keyW;
  let labelW = 0;
  if (label) {
    labelW = ctx.measureText(label).width;
    totalW += LABEL_GAP + labelW;
  }

  const cx = sx + objW * HALF_DIVISOR;
  const baseY = sy - LABEL_Y_OFFSET + bob;
  const x0 = cx - totalW * HALF_DIVISOR;

  // Key cap background
  const r = KEY_RADIUS;
  const kx = x0;
  const ky = baseY - keyH;
  ctx.beginPath();
  ctx.moveTo(kx + r, ky);
  ctx.lineTo(kx + keyW - r, ky);
  ctx.arcTo(kx + keyW, ky, kx + keyW, ky + r, r);
  ctx.lineTo(kx + keyW, ky + keyH - r);
  ctx.arcTo(kx + keyW, ky + keyH, kx + keyW - r, ky + keyH, r);
  ctx.lineTo(kx + r, ky + keyH);
  ctx.arcTo(kx, ky + keyH, kx, ky + keyH - r, r);
  ctx.lineTo(kx, ky + r);
  ctx.arcTo(kx, ky, kx + r, ky, r);
  ctx.closePath();

  // Fill + border to look like a keyboard key
  ctx.fillStyle = 'rgba(30, 30, 30, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inner highlight (top edge of key cap)
  ctx.beginPath();
  ctx.moveTo(kx + r + HIGHLIGHT_OFFSET_X, ky + HIGHLIGHT_OFFSET_Y);
  ctx.lineTo(kx + keyW - r - HIGHLIGHT_LINE_OFFSET, ky + HIGHLIGHT_OFFSET_Y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Key text
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(keyText, kx + keyW * KEY_CENTER_X, ky + keyH * KEY_CENTER_Y + KEY_CENTER_Y_OFFSET);

  // Label
  if (label) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(
      label,
      kx + keyW + LABEL_X_OFFSET,
      ky + keyH * KEY_CENTER_Y + KEY_CENTER_Y_OFFSET,
    );
    ctx.fillStyle = '#f0e8d0';
    ctx.fillText(label, kx + keyW + LABEL_X_OFFSET, ky + keyH * KEY_CENTER_Y + KEY_CENTER_Y_OFFSET);
  }

  ctx.restore();
}
