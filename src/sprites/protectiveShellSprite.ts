export type ShellVariant = 'standard' | 'full_power';

function shellColors(variant: ShellVariant) {
  if (variant === 'full_power') {
    return { outer: '#fbbf24', main: '#ff8c00', fill: '#fd7c0a' };
  }
  return { outer: '#93c5fd', main: '#3b82f6', fill: '#60a5fa' };
}

function drawShellCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  s: number,
  colors: { outer: string; main: string; fill: string },
  pulse: number,
  alpha: number,
): void {
  const lineW = Math.max(2, s * 0.09);
  const glowStep = Math.max(4, s * 0.15);

  ctx.save();

  // Outer glow rings (4 → 1, increasingly bright inward)
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = alpha * 0.06 * i;
    ctx.strokeStyle = colors.outer;
    ctx.lineWidth = i * lineW;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx + i * glowStep, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Main border (pulsing)
  const pulseFactor = 0.7 + 0.3 * Math.sin(pulse * Math.PI * 2);
  ctx.globalAlpha = alpha * pulseFactor;
  ctx.strokeStyle = colors.main;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();

  // Interior fill (very translucent)
  ctx.globalAlpha = alpha * 0.06;
  ctx.fillStyle = colors.fill;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Pulsing active shell.
 * @param phase 0→1 drives one full pulse cycle.
 */
export function drawProtectiveShellActive(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  variant: ShellVariant,
  phase: number,
): void {
  drawShellCircle(ctx, cx, cy, s * 5, s, shellColors(variant), phase, 1.0);
}

/**
 * Shell expanding into existence.
 * @param expandT 0=tiny, 1=full size + full alpha.
 */
export function drawProtectiveShellAppear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  variant: ShellVariant,
  expandT: number,
): void {
  const radiusPx = s * 5 * (0.1 + expandT * 0.9);
  drawShellCircle(ctx, cx, cy, radiusPx, s, shellColors(variant), 0, expandT);
}

/**
 * Shell fading out (standard blue).
 * @param fadeT 0=fully visible, 1=gone.
 */
export function drawProtectiveShellExpire(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  fadeT: number,
): void {
  drawShellCircle(ctx, cx, cy, s * 5, s, shellColors('standard'), 0, 1 - fadeT);
}

/**
 * Cat personal mini-shield (purple, 2-tile radius, L14+).
 * @param phase 0→1 drives one full pulse cycle.
 */
export function drawProtectiveShellMini(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  phase: number,
): void {
  const radiusPx = s * 2;
  const lineW = Math.max(1.5, s * 0.06);
  const pulse = 0.6 + 0.4 * Math.sin(phase * Math.PI * 2);

  ctx.save();

  // Outer glow
  ctx.globalAlpha = pulse * 0.25;
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = lineW * 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx + lineW * 2, 0, Math.PI * 2);
  ctx.stroke();

  // Main border
  ctx.globalAlpha = pulse * 0.8;
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();

  // Interior fill
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#c4b5fd';
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Orange shockwave expanding ring (L15 shell expiry).
 * Starts at 2.5-tile radius, expands to 7-tile radius, fades as it grows.
 * @param expandT 0=start, 1=max radius / fully faded.
 */
export function drawProtectiveShellShockwave(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  expandT: number,
): void {
  const startRadius = s * 2.5;
  const maxRadius = s * 7;
  const currentRadius = startRadius + (maxRadius - startRadius) * expandT;
  const alpha = (1 - expandT) * 0.9;
  const lineW = Math.max(2, s * 0.09);

  ctx.save();

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff8c00';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, currentRadius * 0.85, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
