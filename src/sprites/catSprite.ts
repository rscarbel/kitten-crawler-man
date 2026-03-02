export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  distTraveled: number;
  maxDist: number;
  state: 'flying' | 'exploding';
  explodeTimer: number;
  hit: boolean;
}

export function drawCatSprite(ctx: CanvasRenderingContext2D, sx: number, sy: number, s: number) {
  // Tail (drawn first so body covers the base)
  ctx.strokeStyle = '#c47a15';
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.75, sy + s * 0.62);
  ctx.quadraticCurveTo(sx + s * 1.08, sy + s * 0.5, sx + s * 0.95, sy + s * 0.3);
  ctx.stroke();
  // Dark band on tail
  ctx.strokeStyle = '#1a0f00';
  ctx.lineWidth = s * 0.04;
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.88, sy + s * 0.44);
  ctx.quadraticCurveTo(sx + s * 1.0, sy + s * 0.38, sx + s * 0.95, sy + s * 0.3);
  ctx.stroke();

  // Body — tortoiseshell: base orange, clipped patches
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, sy + s * 0.62, s * 0.28, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c47a15';
  ctx.fill();
  ctx.clip();
  // Dark patch upper-left
  ctx.fillStyle = '#1a0f00';
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.35, sy + s * 0.56, s * 0.13, s * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Dark patch lower-right
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.64, sy + s * 0.68, s * 0.1, s * 0.09, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Cream patch mid-right
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#f0c060';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.57, sy + s * 0.58, s * 0.1, s * 0.08, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Head — tortoiseshell: base orange, clipped patches
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.34, s * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = '#c47a15';
  ctx.fill();
  ctx.clip();
  // Dark patch left side of face
  ctx.fillStyle = '#1a0f00';
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.41, sy + s * 0.33, s * 0.1, s * 0.14, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Cream patch forehead-right
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#f0c060';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.57, sy + s * 0.28, s * 0.07, s * 0.08, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ears (left) — dark tortoiseshell
  ctx.fillStyle = '#1a0f00';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.32, sy + s * 0.2);
  ctx.lineTo(sx + s * 0.22, sy + s * 0.06);
  ctx.lineTo(sx + s * 0.44, sy + s * 0.17);
  ctx.fill();

  // Ears (right) — orange
  ctx.fillStyle = '#c47a15';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.68, sy + s * 0.2);
  ctx.lineTo(sx + s * 0.78, sy + s * 0.06);
  ctx.lineTo(sx + s * 0.56, sy + s * 0.17);
  ctx.fill();

  // Eyes (green)
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, sy + s * 0.32, s * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, sy + s * 0.32, s * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, sy + s * 0.32, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, sy + s * 0.32, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
}

export function drawMissiles(
  ctx: CanvasRenderingContext2D,
  missiles: Missile[],
  camX: number,
  camY: number,
  s: number,
  EXPLODE_FRAMES: number,
) {
  for (const m of missiles) {
    const mx = m.x - camX;
    const my = m.y - camY;

    if (m.state === 'flying') {
      // Purple trailing glow
      const speed = Math.hypot(m.vx, m.vy);
      const trailLen = Math.min(m.distTraveled, s * 0.9);
      if (trailLen > 2 && speed > 0) {
        const tx = mx - (m.vx / speed) * trailLen;
        const ty = my - (m.vy / speed) * trailLen;
        const trailGrad = ctx.createLinearGradient(mx, my, tx, ty);
        trailGrad.addColorStop(0, 'rgba(180, 100, 255, 0.75)');
        trailGrad.addColorStop(1, 'rgba(180, 100, 255, 0)');
        ctx.save();
        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = s * 0.09;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.restore();
      }

      // Outer glow
      const grad = ctx.createRadialGradient(mx, my, 0, mx, my, s * 0.32);
      grad.addColorStop(0, 'rgba(230, 190, 255, 0.9)');
      grad.addColorStop(0.5, 'rgba(150, 70, 240, 0.55)');
      grad.addColorStop(1, 'rgba(80, 0, 180, 0)');
      ctx.beginPath();
      ctx.arc(mx, my, s * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Bright core
      ctx.fillStyle = '#f0e0ff';
      ctx.beginPath();
      ctx.arc(mx, my, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Explosion
      const t = 1 - m.explodeTimer / EXPLODE_FRAMES; // 0→1
      const radius = t * s * 1.1;
      const alpha = 1 - t;

      ctx.save();

      // Shockwave ring
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = '#d8b4fe';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Filled area
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.arc(mx, my, radius * 0.75, 0, Math.PI * 2);
      ctx.fill();

      // Spark rays (early in explosion)
      if (t < 0.55) {
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = '#f3e8ff';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          const r1 = radius * 0.3;
          const r2 = radius * 0.75;
          ctx.beginPath();
          ctx.moveTo(mx + Math.cos(angle) * r1, my + Math.sin(angle) * r1);
          ctx.lineTo(mx + Math.cos(angle) * r2, my + Math.sin(angle) * r2);
          ctx.stroke();
        }
      }

      // Bright core
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(radius * 0.28, 2), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }
}
