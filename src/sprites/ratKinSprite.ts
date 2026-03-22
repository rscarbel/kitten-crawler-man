/**
 * Draws a Rat Kin — a standing rat-human with optional walk animation.
 * Reusable for NPCs and enemies alike.
 * @param walkTime  Global timer used to derive animation phase.
 * @param isWalking Whether the character is currently walking (enables leg/arm swing).
 * @param facingX   +1 faces right, -1 faces left.
 */
export function drawRatKinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
) {
  // Body bob when walking
  const bob = isWalking ? Math.sin(walkTime * 0.25) * s * 0.03 : 0;
  // Arm swing angle when walking
  const armSwing = isWalking ? Math.sin(walkTime * 0.25) * 0.18 : 0;
  // Robe hem sway
  const hemSway = isWalking ? Math.sin(walkTime * 0.25) * s * 0.02 : 0;

  // Flip canvas for left-facing direction
  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * 0.5), 0);
  }

  const bsy = sy + bob; // bobbed y origin

  // Tail (behind robe, thin curved line)
  ctx.save();
  ctx.strokeStyle = '#a08868';
  ctx.lineWidth = s * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.5, bsy + s * 0.88);
  ctx.quadraticCurveTo(sx + s * 0.76, bsy + s * 0.95, sx + s * 0.84, bsy + s * 0.76);
  ctx.stroke();
  ctx.restore();

  // Robe (dark brown-grey) with slight hem sway
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(sx + s * 0.2, bsy + s * 0.38, s * 0.6, s * 0.55 + Math.abs(hemSway));
  // Hem left edge sways
  if (isWalking) {
    ctx.fillStyle = '#2e2a26';
    ctx.beginPath();
    ctx.moveTo(sx + s * 0.2, bsy + s * 0.83);
    ctx.lineTo(sx + s * 0.2 + hemSway, bsy + s * 0.93);
    ctx.lineTo(sx + s * 0.5, bsy + s * 0.93);
    ctx.fill();
  }

  // Robe hem detail (slightly lighter at base)
  ctx.fillStyle = '#3a3530';
  ctx.fillRect(sx + s * 0.2, bsy + s * 0.88, s * 0.6, s * 0.05);

  // Sleeves / arms (swing during walk)
  const leftArmY = bsy + s * 0.4 + armSwing * s * 0.5;
  const rightArmY = bsy + s * 0.4 - armSwing * s * 0.5;
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(sx + s * 0.06, leftArmY, s * 0.14, s * 0.3);
  ctx.fillRect(sx + s * 0.8, rightArmY, s * 0.14, s * 0.3);

  // Paw-hands (small, fur-coloured)
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.arc(sx + s * 0.1, leftArmY + s * 0.32, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.9, rightArmY + s * 0.32, s * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#a89888';
  ctx.fillRect(sx + s * 0.43, bsy + s * 0.34, s * 0.14, s * 0.07);

  // Rat ears (large, rounded, behind head)
  ctx.fillStyle = '#c8a898';
  // Left ear
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.31, bsy + s * 0.16, s * 0.1, s * 0.12, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // Right ear
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.69, bsy + s * 0.16, s * 0.1, s * 0.12, 0.25, 0, Math.PI * 2);
  ctx.fill();
  // Inner ear (pink)
  ctx.fillStyle = '#e8b8a8';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.31, bsy + s * 0.16, s * 0.065, s * 0.078, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.69, bsy + s * 0.16, s * 0.065, s * 0.078, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Head (round, fur-coloured)
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.27, s * 0.19, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Snout (elongated rat muzzle)
  ctx.fillStyle = '#c8b4a4';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.375, s * 0.09, s * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose (pink)
  ctx.fillStyle = '#d07080';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, bsy + s * 0.42, s * 0.024, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers
  ctx.save();
  ctx.strokeStyle = 'rgba(230,225,210,0.8)';
  ctx.lineWidth = 0.6;
  const wy = bsy + s * 0.375;
  // Left whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, wy);
  ctx.lineTo(sx + s * 0.2, wy - s * 0.018);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, wy + s * 0.014);
  ctx.lineTo(sx + s * 0.2, wy + s * 0.036);
  ctx.stroke();
  // Right whiskers
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.58, wy);
  ctx.lineTo(sx + s * 0.8, wy - s * 0.018);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.58, wy + s * 0.014);
  ctx.lineTo(sx + s * 0.8, wy + s * 0.036);
  ctx.stroke();
  ctx.restore();

  // Eyes (amber/warm brown, not red like enemy rats)
  ctx.fillStyle = '#b86820';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, bsy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, bsy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, bsy + s * 0.255, s * 0.016, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, bsy + s * 0.255, s * 0.016, 0, Math.PI * 2);
  ctx.fill();

  // Robe lapel / collar detail
  ctx.fillStyle = '#4a4440';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.38, bsy + s * 0.4);
  ctx.lineTo(sx + s * 0.5, bsy + s * 0.52);
  ctx.lineTo(sx + s * 0.62, bsy + s * 0.4);
  ctx.fill();

  ctx.restore(); // undo facing flip
}
