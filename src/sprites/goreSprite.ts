// Blood drop particles and floor puddles for the GoreSystem.
// All drawing functions use s = game tile scale (32).

const BLOOD_BRIGHT = '#ff4040';
const BLOOD_MID = '#cc0000';
const BLOOD_DARK = '#7a0000';
const BLOOD_DEEP = '#3a0000';

/**
 * Blood drop particle — round or teardrop shaped.
 *
 * @param sizeFrac  0 = smallest (r≈2 px), 1 = largest (r≈7 px)
 * @param elongation 0 = round circle, 1 = elongated teardrop with upward tail
 */
export function drawBloodDrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  sizeFrac: number,
  elongation: number,
): void {
  // Head radius scales from 2 to 7 game pixels
  const headR = 2 + sizeFrac * 5;
  // Shift head down for larger drops to keep tail within frame
  const headCY = cy + sizeFrac * 3;
  const headCX = cx;

  ctx.save();

  if (elongation < 0.05) {
    // Pure round drop
    ctx.beginPath();
    ctx.arc(headCX, headCY, headR, 0, Math.PI * 2);
  } else {
    // Teardrop: tail points upward
    const tailLen = headR * elongation * 1.2;
    const tipX = headCX;
    const tipY = headCY - headR - tailLen;
    const hw = headR * 0.92; // half-width at widest

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.bezierCurveTo(
      headCX + hw * 0.55,
      headCY - headR * 0.8,
      headCX + hw,
      headCY,
      headCX,
      headCY + headR * 0.9,
    );
    ctx.bezierCurveTo(headCX - hw, headCY, headCX - hw * 0.55, headCY - headR * 0.8, tipX, tipY);
  }

  const grad = ctx.createRadialGradient(
    headCX - headR * 0.25,
    headCY - headR * 0.25,
    0,
    headCX,
    headCY,
    headR * 1.4,
  );
  grad.addColorStop(0, BLOOD_BRIGHT);
  grad.addColorStop(0.4, BLOOD_MID);
  grad.addColorStop(1, BLOOD_DARK);
  ctx.fillStyle = grad;
  ctx.fill();

  // Specular highlight on larger drops
  if (headR >= 4) {
    ctx.beginPath();
    ctx.arc(headCX - headR * 0.28, headCY - headR * 0.28, headR * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 140, 140, 0.45)';
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Irregular blood puddle on the floor.
 *
 * @param variant 0–5 — different sizes and splatter patterns.
 */
export function drawBloodPuddle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  variant: number,
): void {
  const v = ((variant % 6) + 6) % 6;

  // rx, ry: horizontal/vertical radius in game pixels
  const RX = [10, 14, 17, 12, 18, 20][v];
  const RY = [7, 9, 11, 8, 12, 13][v];
  const SPOKES = [0, 3, 4, 5, 6, 8][v];
  const SPOKE_LEN = [0, 4, 3, 5, 4, 5][v];
  const phase = v * 1.7;

  // Organic blob via sinusoidal radius modulation
  const N = 24;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const noise =
      1 +
      0.1 * Math.sin(angle * 3 + phase) +
      0.07 * Math.cos(angle * 5 + phase * 1.4) +
      0.04 * Math.sin(angle * 7 + phase * 0.7);
    const px = cx + Math.cos(angle) * RX * noise;
    const py = cy + Math.sin(angle) * RY * noise;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx, cy - RY * 0.15, 0, cx, cy, Math.max(RX, RY) * 1.1);
  grad.addColorStop(0, BLOOD_DARK);
  grad.addColorStop(0.5, '#5a0000');
  grad.addColorStop(1, BLOOD_DEEP);
  ctx.fillStyle = grad;
  ctx.fill();

  // Drip spokes radiating out from the puddle rim
  if (SPOKES > 0) {
    for (let i = 0; i < SPOKES; i++) {
      const angle = (i / SPOKES) * Math.PI * 2 + phase * 0.3;
      const noise = 0.9 + 0.1 * Math.sin(v * 3.7 + i * 2.1);
      const rimX = cx + Math.cos(angle) * RX * noise * 0.85;
      const rimY = cy + Math.sin(angle) * RY * noise * 0.85;
      const tipX = cx + Math.cos(angle) * (RX * noise + SPOKE_LEN);
      const tipY = cy + Math.sin(angle) * (RY * noise * 0.75 + SPOKE_LEN * 0.7);

      // Connecting streak
      ctx.beginPath();
      ctx.moveTo(rimX, rimY);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = '#4a0000';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Small satellite drop at tip
      const tipR = 1.2 + (SPOKE_LEN / 5) * 0.6;
      ctx.beginPath();
      ctx.arc(tipX, tipY, tipR, 0, Math.PI * 2);
      ctx.fillStyle = '#5a0000';
      ctx.fill();
    }
  }

  ctx.restore();
}
