/**
 * Sprite functions for gym equipment items:
 *   - Dumbbell  (floor world, inventory icon, held-by-Juicer)
 *   - Bench press (floor world, inventory icon)
 *   - Treadmill   (floor world, inventory icon)
 */

// Dumbbell

export function drawDumbbellFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.62;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.18, s * 0.32, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bar (horizontal rod)
  ctx.fillStyle = '#888';
  ctx.fillRect(cx - s * 0.3, cy - s * 0.045, s * 0.6, s * 0.09);

  // Left weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.3, cy, s * 0.09, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  // Left weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.3, cy, s * 0.055, s * 0.115, 0, 0, Math.PI * 2);
  ctx.fill();
  // Left weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx - s * 0.3, cy, s * 0.02, 0, Math.PI * 2);
  ctx.fill();

  // Right weight plate (outer)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.3, cy, s * 0.09, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  // Right weight plate (inner rim highlight)
  ctx.fillStyle = '#666';
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.3, cy, s * 0.055, s * 0.115, 0, 0, Math.PI * 2);
  ctx.fill();
  // Right weight plate hole
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx + s * 0.3, cy, s * 0.02, 0, Math.PI * 2);
  ctx.fill();

  // Bar shine
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(cx - s * 0.22, cy - s * 0.04, s * 0.44, s * 0.03);
}

export function drawDumbbellInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * 0.5;
  const cy = y + size * 0.5;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.28, size * 0.3, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bar
  ctx.fillStyle = '#999';
  ctx.fillRect(cx - size * 0.3, cy - size * 0.04, size * 0.6, size * 0.08);

  // Left weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.28, cy, size * 0.08, size * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.28, cy, size * 0.05, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Right weight
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.28, cy, size * 0.08, size * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.28, cy, size * 0.05, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Dumbbell held by Juicer — rendered at hand position with throw-anim rotation.
 * `cx, cy` = world position of the hand. `throwAnim` 0→1 swings the arm forward.
 */
export function drawDumbbellHeld(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  throwAnim: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  // Rotate: pull back at 0, swing forward at 1
  const angle = -0.8 + throwAnim * 1.6;
  ctx.rotate(angle);

  const barLen = s * 0.55;
  ctx.fillStyle = '#999';
  ctx.fillRect(-barLen * 0.5, -s * 0.04, barLen, s * 0.08);

  // Plates
  for (const sign of [-1, 1]) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(sign * barLen * 0.47, 0, s * 0.07, s * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.ellipse(sign * barLen * 0.47, 0, s * 0.04, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Bench Press

export function drawBenchPressFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.55;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.38, s * 0.65, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base frame legs (4 contact points)
  ctx.fillStyle = '#3a3a3a';
  const legW = s * 0.08;
  const legH = s * 0.2;
  // Front-left
  ctx.fillRect(cx - s * 0.55, cy + s * 0.12, legW, legH);
  // Front-right
  ctx.fillRect(cx + s * 0.47, cy + s * 0.12, legW, legH);
  // Back-left
  ctx.fillRect(cx - s * 0.55, cy - s * 0.18, legW, legH * 0.7);
  // Back-right
  ctx.fillRect(cx + s * 0.47, cy - s * 0.18, legW, legH * 0.7);

  // Main frame bar (horizontal)
  ctx.fillStyle = '#555';
  ctx.fillRect(cx - s * 0.58, cy, s * 1.16, s * 0.12);
  // Frame shine
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(cx - s * 0.58, cy, s * 1.16, s * 0.03);

  // Upright supports (at one end for barbell rest)
  ctx.fillStyle = '#666';
  ctx.fillRect(cx - s * 0.52, cy - s * 0.6, s * 0.08, s * 0.62);
  ctx.fillRect(cx + s * 0.44, cy - s * 0.6, s * 0.08, s * 0.62);

  // Barbell rest (J-hooks)
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.arc(cx - s * 0.48, cy - s * 0.6, s * 0.07, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.48, cy - s * 0.6, s * 0.07, Math.PI, 0);
  ctx.fill();

  // Barbell on rest
  ctx.fillStyle = '#888';
  ctx.fillRect(cx - s * 0.8, cy - s * 0.72, s * 1.6, s * 0.1);
  // Weight plates on barbell
  for (const ox of [-s * 0.72, -s * 0.62, s * 0.54, s * 0.64]) {
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy - s * 0.67, s * 0.055, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a5a5a';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy - s * 0.67, s * 0.03, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Padded bench seat
  ctx.fillStyle = '#8B0000';
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - s * 0.42, cy - s * 0.05, s * 0.84, s * 0.22, s * 0.05)
    : ctx.fillRect(cx - s * 0.42, cy - s * 0.05, s * 0.84, s * 0.22);
  ctx.fill();
  // Padding highlight
  ctx.fillStyle = '#a00000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.05, s * 0.35, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBenchPressInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * 0.5;
  const cy = y + size * 0.52;

  // Frame
  ctx.fillStyle = '#555';
  ctx.fillRect(cx - size * 0.45, cy - size * 0.05, size * 0.9, size * 0.1);

  // Uprights
  ctx.fillStyle = '#666';
  ctx.fillRect(cx - size * 0.4, cy - size * 0.45, size * 0.06, size * 0.42);
  ctx.fillRect(cx + size * 0.34, cy - size * 0.45, size * 0.06, size * 0.42);

  // Barbell
  ctx.fillStyle = '#888';
  ctx.fillRect(cx - size * 0.48, cy - size * 0.45, size * 0.96, size * 0.07);

  // Weight plates
  for (const ox of [-size * 0.44, size * 0.38]) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy - size * 0.42, size * 0.04, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Seat
  ctx.fillStyle = '#8B0000';
  ctx.fillRect(cx - size * 0.32, cy - size * 0.05, size * 0.64, size * 0.16);
}

// Treadmill

export function drawTreadmillFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.58;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.35, s * 0.6, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base frame / deck
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  // Trapezoidal deck (slightly wider at front)
  ctx.moveTo(cx - s * 0.56, cy + s * 0.08);
  ctx.lineTo(cx + s * 0.56, cy + s * 0.08);
  ctx.lineTo(cx + s * 0.48, cy - s * 0.15);
  ctx.lineTo(cx - s * 0.48, cy - s * 0.15);
  ctx.closePath();
  ctx.fill();

  // Belt (dark rubber conveyor)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - s * 0.44, cy - s * 0.13, s * 0.88, s * 0.18);
  // Belt stripes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * s * 0.12, cy - s * 0.13);
    ctx.lineTo(cx + i * s * 0.12, cy + s * 0.05);
    ctx.stroke();
  }

  // Front roller (semicircle)
  ctx.fillStyle = '#444';
  ctx.beginPath();
  ctx.arc(cx + s * 0.44, cy - s * 0.04, s * 0.1, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  // Back roller
  ctx.beginPath();
  ctx.arc(cx - s * 0.44, cy - s * 0.04, s * 0.1, Math.PI / 2, -Math.PI / 2);
  ctx.fill();

  // Support legs
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(cx - s * 0.54, cy + s * 0.08, s * 0.12, s * 0.22);
  ctx.fillRect(cx + s * 0.42, cy + s * 0.08, s * 0.12, s * 0.22);

  // Handlebar uprights
  ctx.strokeStyle = '#666';
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, cy - s * 0.13);
  ctx.lineTo(cx - s * 0.28, cy - s * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.28, cy - s * 0.13);
  ctx.lineTo(cx + s * 0.28, cy - s * 0.72);
  ctx.stroke();

  // Handlebar (horizontal crossbar)
  ctx.strokeStyle = '#777';
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, cy - s * 0.72);
  ctx.lineTo(cx + s * 0.28, cy - s * 0.72);
  ctx.stroke();

  // Console/screen (small rect at top)
  ctx.fillStyle = '#1a2a2a';
  ctx.fillRect(cx - s * 0.16, cy - s * 0.85, s * 0.32, s * 0.18);
  // Screen glow
  ctx.fillStyle = '#0a4040';
  ctx.fillRect(cx - s * 0.12, cy - s * 0.82, s * 0.24, s * 0.12);
  // Screen display (simple dots for numbers)
  ctx.fillStyle = '#00cc88';
  ctx.fillRect(cx - s * 0.07, cy - s * 0.79, s * 0.04, s * 0.06);
  ctx.fillRect(cx + s * 0.03, cy - s * 0.79, s * 0.04, s * 0.06);

  ctx.lineCap = 'butt';
}

export function drawTreadmillInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size * 0.5;
  const cy = y + size * 0.58;

  // Deck
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(cx - size * 0.4, cy - size * 0.1, size * 0.8, size * 0.18);

  // Belt
  ctx.fillStyle = '#111';
  ctx.fillRect(cx - size * 0.35, cy - size * 0.08, size * 0.7, size * 0.14);

  // Uprights
  ctx.strokeStyle = '#666';
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.22, cy - size * 0.1);
  ctx.lineTo(cx - size * 0.22, cy - size * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.22, cy - size * 0.1);
  ctx.lineTo(cx + size * 0.22, cy - size * 0.5);
  ctx.stroke();

  // Crossbar
  ctx.strokeStyle = '#777';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.22, cy - size * 0.5);
  ctx.lineTo(cx + size * 0.22, cy - size * 0.5);
  ctx.stroke();

  // Screen
  ctx.fillStyle = '#0a3a3a';
  ctx.fillRect(cx - size * 0.12, cy - size * 0.62, size * 0.24, size * 0.14);
  ctx.fillStyle = '#00aa66';
  ctx.fillRect(cx - size * 0.08, cy - size * 0.59, size * 0.16, size * 0.08);

  ctx.lineCap = 'butt';
}
