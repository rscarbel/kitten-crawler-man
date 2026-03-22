import { drawRatKinSprite } from './ratKinSprite';
import { drawIncubusSprite } from './incubusSprite';
import { drawBugabooSprite } from './bugabooSprite';

/**
 * Dispatcher: picks the correct Mordecai variant sprite for the given level ID.
 * Level 3 (overworld) gets the demon tuxedo variant; level 2 gets the Bugaboo; others use rat-NPC.
 */
export function drawMordecaiForLevel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime: number,
  isWalking: boolean,
  facingX: number,
  levelId: string,
) {
  if (levelId === 'level3') {
    drawIncubusSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  } else if (levelId === 'level2') {
    drawBugabooSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  } else {
    drawRatKinSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  }
}

/**
 * Draws a speech-bubble icon above Mordecai when the player is nearby.
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pulse: number,
) {
  const alpha = 0.7 + Math.sin(pulse * 0.12) * 0.3;
  ctx.save();
  ctx.globalAlpha = alpha;

  const bx = sx + s * 0.18;
  const by = sy - s * 0.52;
  const bw = s * 0.64;
  const bh = s * 0.35;
  const r = s * 0.06;

  // Bubble body (rounded rect)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r + s * 0.1, by + bh);
  // Tail pointing down-left
  ctx.lineTo(bx + s * 0.12, by + bh + s * 0.15);
  ctx.lineTo(bx + r + s * 0.22, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();

  // "..." dots
  ctx.fillStyle = '#334155';
  const dotY = by + bh * 0.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(bx + bw * 0.28 + i * bw * 0.22, dotY, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
