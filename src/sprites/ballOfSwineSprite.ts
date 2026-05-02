import { drawText } from '../ui/TextBox';
import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';

export function drawBallOfSwineSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  orbitAngle: number,
  isStopped: boolean,
  isBursting: boolean,
  burstProgress: number,
): void {
  if (isBursting) {
    drawSpriteKey(ctx, 'ball_of_swine', 'burst', progressFrameIndex(burstProgress, 6), sx, sy, ts);
    return;
  }

  if (isStopped) {
    drawSpriteKey(
      ctx,
      'ball_of_swine',
      'stopped',
      timeFrameIndex(performance.now() / 1000, 4, 4),
      sx,
      sy,
      ts,
    );
    return;
  }

  drawSpriteKey(ctx, 'ball_of_swine', 'orbit', walkFrameIndex(orbitAngle, 8), sx, sy, ts);
}

/** Renders the "STOPPED — VULNERABLE" warning text above the ball. */
export function drawBallOfSwineStoppedWarning(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  stoppedFraction: number, // 0 = just stopped, 1 = about to resume
): void {
  const cx = sx + ts * 0.5;
  const topY = sy - ts * 0.3;
  const pulse = 0.8 + 0.2 * Math.sin(Date.now() * 0.008);
  const fontSize = Math.floor(ts * 0.32);

  ctx.save();
  drawText(ctx, 'VULNERABLE', {
    x: cx,
    y: topY - Math.round(fontSize * 0.8),
    size: fontSize,
    bold: true,
    font: 'monospace',
    color: '#fde68a',
    alpha: pulse,
    align: 'center',
  });

  // Timer bar below text
  const barW = ts * 1.4;
  const barH = 5;
  const barX = cx - barW * 0.5;
  const barY = topY + 4;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#374151';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = stoppedFraction < 0.5 ? '#4ade80' : '#f59e0b';
  ctx.fillRect(barX, barY, barW * (1 - stoppedFraction), barH);
  ctx.restore();
}
