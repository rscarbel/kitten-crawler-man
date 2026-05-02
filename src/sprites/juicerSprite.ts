import { drawDumbbellHeld } from './gymEquipmentSprite';
import { drawText } from '../ui/TextBox';
import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

/**
 * Draw the Juicer boss sprite.
 *
 * @param throwAnim     0–1 throw animation progress (0 = not throwing).
 * @param heldDumbbell  Whether the Juicer is carrying a dumbbell (visual only).
 */
export function drawJuicerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame: number,
  isMoving: boolean,
  throwAnim: number,
  facingX: number,
  _facingY: number,
  isEnraged: boolean,
  _heldDumbbell: boolean,
): void {
  const flipX = facingX < 0;

  if (throwAnim > 0) {
    drawSpriteKey(ctx, 'juicer', 'throw', progressFrameIndex(throwAnim, 6), sx, sy, s, { flipX });
    return;
  }

  if (isMoving) {
    const state = isEnraged ? 'walk_enraged' : 'walk';
    drawSpriteKey(ctx, 'juicer', state, walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'juicer', isEnraged ? 'idle_enraged' : 'idle', 0, sx, sy, s, { flipX });
}

// ---------------------------------------------------------------------------
// Procedural helpers — no sprite sheet equivalent
// ---------------------------------------------------------------------------

export function drawThrownDumbbell(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  camX: number,
  camY: number,
  s: number,
  vx: number,
  vy: number,
): void {
  const sx = wx - camX;
  const sy = wy - camY;

  // Motion trail
  const speed = Math.hypot(vx, vy);
  if (speed > 0.5) {
    const nx = vx / speed;
    const ny = vy / speed;
    for (let i = 1; i <= 4; i++) {
      const tx = sx - nx * i * s * 0.14;
      const ty = sy - ny * i * s * 0.14;
      ctx.save();
      ctx.globalAlpha = (0.15 * (5 - i)) / 4;
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(tx, ty, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Rotating dumbbell (spin by time)
  const angle = Date.now() * 0.015;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  drawDumbbellHeld(ctx, 0, 0, s * 0.8, 0.5);
  ctx.restore();
}

/** Render a speech bubble with the Juicer's taunt above his head. */
export function drawJuicerSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  text: string,
  pulse: number,
): void {
  const scale = 1.6;
  const cs = s * scale;
  const cx = sx + s * 0.5;
  const bubbleY = sy - cs * 0.35;

  ctx.save();
  ctx.font = 'bold 9px monospace';
  const textWidth = ctx.measureText(text).width;
  const padX = 8;
  const bw = textWidth + padX * 2;
  const bh = 18;
  const bx = cx - bw * 0.5;
  const by = bubbleY - bh - 2;

  const alpha = 0.85 + 0.1 * Math.sin(pulse * 0.1);
  ctx.globalAlpha = alpha;

  // Bubble background
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 5);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 5);
  ctx.stroke();

  // Tail pointing down toward head
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh);
  ctx.lineTo(cx + 4, by + bh);
  ctx.lineTo(cx, bubbleY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.moveTo(cx + 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.stroke();

  drawText(ctx, text, {
    x: cx,
    y: by + bh * 0.5 - 9 / 2,
    size: 9,
    bold: true,
    font: 'monospace',
    color: '#1a1a1a',
    alpha,
    align: 'center',
  });

  ctx.restore();
}
