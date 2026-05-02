import { drawSpriteKey, walkFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

export function drawBrindleGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  if (isMoving) {
    drawSpriteKey(ctx, 'brindle_grub', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s);
    return;
  }
  drawSpriteKey(ctx, 'brindle_grub', 'idle', 0, sx, sy, s);
}

export function drawCowTailedGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  if (isMoving) {
    drawSpriteKey(ctx, 'cow_tailed_grub', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s);
    return;
  }
  drawSpriteKey(ctx, 'cow_tailed_grub', 'idle', 0, sx, sy, s);
}

export function drawBrindledVespaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  _walkFrame = 0,
  _isMoving = false,
  facingX = 1,
): void {
  // Vespa uses separate left/right rows instead of flipX
  const state = facingX < 0 ? 'hover_left' : 'hover';
  drawSpriteKey(
    ctx,
    'brindled_vespa',
    state,
    timeFrameIndex(performance.now() / 1000, 8, 8),
    sx,
    sy,
    s,
  );
}

export function drawAcidSpit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hit: boolean,
): void {
  const t = performance.now() / 1000;
  const pulse = 1 + Math.sin(t * 12) * 0.15;

  if (hit) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#a8e040';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.save();
  const grd = ctx.createRadialGradient(sx, sy, 1, sx, sy, 8 * pulse);
  grd.addColorStop(0, 'rgba(180,240,60,0.55)');
  grd.addColorStop(1, 'rgba(80,180,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, sy, 8 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c8f050';
  ctx.beginPath();
  ctx.arc(sx, sy, 4 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,200,0.8)';
  ctx.beginPath();
  ctx.arc(sx - 1.2, sy - 1.4, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
