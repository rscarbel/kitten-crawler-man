import { platform } from '../core/Platform';

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
  const bob = Math.sin(performance.now() / 400) * 2;

  ctx.save();
  ctx.font = 'bold 9px monospace';

  const keyMetrics = ctx.measureText(keyText);
  const keyW = keyMetrics.width + 10; // padding inside key cap
  const keyH = 16;

  let totalW = keyW;
  let labelW = 0;
  if (label) {
    labelW = ctx.measureText(label).width;
    totalW += 4 + labelW; // gap + label text
  }

  const cx = sx + objW * 0.5;
  const baseY = sy - 12 + bob;
  const x0 = cx - totalW * 0.5;

  // Key cap background
  const r = 3;
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
  ctx.moveTo(kx + r + 1, ky + 2);
  ctx.lineTo(kx + keyW - r - 1, ky + 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Key text
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(keyText, kx + keyW * 0.5, ky + keyH * 0.5 + 0.5);

  // Label
  if (label) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, kx + keyW + 4, ky + keyH * 0.5 + 0.5);
    ctx.fillStyle = '#f0e8d0';
    ctx.fillText(label, kx + keyW + 4, ky + keyH * 0.5 + 0.5);
  }

  ctx.restore();
}
