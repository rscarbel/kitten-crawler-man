/**
 * Draws a llama sprite within a tileSize × tileSize box starting at (x, y).
 * All coordinates are proportional to tileSize so it scales cleanly.
 *
 * @param spitAnim  0–1 normalised spit-lunge progress (peaks at 0.5). Pass 0 when idle.
 */
export function drawLlamaSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  spitAnim = 0,
) {
  ctx.save();
  ctx.translate(x, y);

  const tan = '#c8a45a';
  const cream = '#e8d498';
  const dark = '#4a2e10';
  const hooves = '#2d1a06';

  // Body bob
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.03 : 0;

  // Spit lunge — head/neck extend forward (left) as the spit fires
  const headLunge = Math.sin(spitAnim * Math.PI) * s * 0.08;

  // Body
  ctx.fillStyle = tan;
  ctx.beginPath();
  ctx.ellipse(s * 0.55, s * 0.68 + bodyBob, s * 0.33, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fluffy chest patch
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.ellipse(s * 0.34, s * 0.62 + bodyBob, s * 0.1, s * 0.13, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = tan;
  ctx.beginPath();
  ctx.moveTo(s * 0.24 - headLunge, s * 0.52 + bodyBob);
  ctx.lineTo(s * 0.36 - headLunge, s * 0.52 + bodyBob);
  ctx.lineTo(s * 0.32 - headLunge, s * 0.22);
  ctx.lineTo(s * 0.2 - headLunge, s * 0.22);
  ctx.closePath();
  ctx.fill();

  // Head
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.ellipse(s * 0.25 - headLunge, s * 0.16, s * 0.13, s * 0.1, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // Snout — llamas have a distinctive long upper lip
  ctx.fillStyle = tan;
  ctx.beginPath();
  ctx.ellipse(s * 0.22 - headLunge, s * 0.22, s * 0.07, s * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(s * 0.18 - headLunge, s * 0.23, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.26 - headLunge, s * 0.23, s * 0.018, 0, Math.PI * 2);
  ctx.fill();

  // Ears (pointy banana ears)
  ctx.fillStyle = tan;
  // left ear
  ctx.beginPath();
  ctx.moveTo(s * 0.14 - headLunge, s * 0.09);
  ctx.lineTo(s * 0.1 - headLunge, s * 0.01);
  ctx.lineTo(s * 0.2 - headLunge, s * 0.07);
  ctx.closePath();
  ctx.fill();
  // right ear
  ctx.beginPath();
  ctx.moveTo(s * 0.3 - headLunge, s * 0.08);
  ctx.lineTo(s * 0.34 - headLunge, s * 0.01);
  ctx.lineTo(s * 0.38 - headLunge, s * 0.08);
  ctx.closePath();
  ctx.fill();

  // Ear inner (pink)
  ctx.fillStyle = '#e8a0a0';
  ctx.beginPath();
  ctx.moveTo(s * 0.155 - headLunge, s * 0.085);
  ctx.lineTo(s * 0.13 - headLunge, s * 0.04);
  ctx.lineTo(s * 0.19 - headLunge, s * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.31 - headLunge, s * 0.075);
  ctx.lineTo(s * 0.34 - headLunge, s * 0.03);
  ctx.lineTo(s * 0.365 - headLunge, s * 0.075);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(s * 0.31 - headLunge, s * 0.14, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
  // pupil highlight
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(s * 0.32 - headLunge, s * 0.133, s * 0.012, 0, Math.PI * 2);
  ctx.fill();

  // Tail (little nub)
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.ellipse(s * 0.86, s * 0.6 + bodyBob, s * 0.07, s * 0.05, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Legs — front and back pairs alternate phase
  const frontLegOff = isMoving ? Math.sin(walkFrame) * s * 0.045 : 0;
  const backLegOff = isMoving ? -Math.sin(walkFrame) * s * 0.045 : 0;

  ctx.fillStyle = tan;
  // front-left
  ctx.fillRect(
    s * 0.3,
    s * 0.82 + bodyBob + frontLegOff,
    s * 0.08,
    s * 0.15 - Math.abs(frontLegOff),
  );
  // front-right
  ctx.fillRect(
    s * 0.42,
    s * 0.82 + bodyBob - frontLegOff,
    s * 0.08,
    s * 0.15 - Math.abs(frontLegOff),
  );
  // back-left
  ctx.fillRect(
    s * 0.62,
    s * 0.82 + bodyBob + backLegOff,
    s * 0.08,
    s * 0.15 - Math.abs(backLegOff),
  );
  // back-right
  ctx.fillRect(
    s * 0.74,
    s * 0.82 + bodyBob - backLegOff,
    s * 0.08,
    s * 0.15 - Math.abs(backLegOff),
  );

  // Hooves
  ctx.fillStyle = hooves;
  ctx.fillRect(s * 0.3, s * 0.93 + bodyBob + frontLegOff, s * 0.08, s * 0.04);
  ctx.fillRect(s * 0.42, s * 0.93 + bodyBob - frontLegOff, s * 0.08, s * 0.04);
  ctx.fillRect(s * 0.62, s * 0.93 + bodyBob + backLegOff, s * 0.08, s * 0.04);
  ctx.fillRect(s * 0.74, s * 0.93 + bodyBob - backLegOff, s * 0.08, s * 0.04);

  ctx.restore();
}
