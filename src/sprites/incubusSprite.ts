/**
 * Draws an Incubus — dusky gray skin, devil horns, forked tail, bat wings, tuxedo.
 * Reusable for NPCs and enemies alike.
 */
export function drawIncubusSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
) {
  const bob = isWalking ? Math.sin(walkTime * 0.25) * s * 0.03 : 0;
  const armSwing = isWalking ? Math.sin(walkTime * 0.25) * 0.18 : 0;
  const wingFlap = isWalking ? Math.sin(walkTime * 0.18) * s * 0.04 : 0;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * 0.5), 0);
  }

  const bsy = sy + bob;

  // === BAT WINGS (drawn first, behind body) ===
  const wingFlapL = -wingFlap;
  const wingFlapR = wingFlap;

  // Left wing membrane
  ctx.fillStyle = '#241020';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.22, bsy + s * 0.42); // shoulder
  ctx.lineTo(sx - s * 0.32, bsy + s * 0.04 + wingFlapL); // top tip
  ctx.lineTo(sx - s * 0.42, bsy + s * 0.48 + wingFlapL); // outer bottom
  ctx.lineTo(sx - s * 0.08, bsy + s * 0.72); // inner bottom
  ctx.closePath();
  ctx.fill();
  // Left wing finger bones
  ctx.strokeStyle = '#3a1830';
  ctx.lineWidth = s * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.22, bsy + s * 0.43);
  ctx.lineTo(sx - s * 0.32, bsy + s * 0.04 + wingFlapL);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.18, bsy + s * 0.44);
  ctx.lineTo(sx - s * 0.38, bsy + s * 0.36 + wingFlapL);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.15, bsy + s * 0.46);
  ctx.lineTo(sx - s * 0.35, bsy + s * 0.58 + wingFlapL * 0.5);
  ctx.stroke();

  // Right wing membrane
  ctx.fillStyle = '#241020';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.78, bsy + s * 0.42);
  ctx.lineTo(sx + s * 1.32, bsy + s * 0.04 + wingFlapR);
  ctx.lineTo(sx + s * 1.42, bsy + s * 0.48 + wingFlapR);
  ctx.lineTo(sx + s * 1.08, bsy + s * 0.72);
  ctx.closePath();
  ctx.fill();
  // Right wing finger bones
  ctx.strokeStyle = '#3a1830';
  ctx.lineWidth = s * 0.018;
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.78, bsy + s * 0.43);
  ctx.lineTo(sx + s * 1.32, bsy + s * 0.04 + wingFlapR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.82, bsy + s * 0.44);
  ctx.lineTo(sx + s * 1.38, bsy + s * 0.36 + wingFlapR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.85, bsy + s * 0.46);
  ctx.lineTo(sx + s * 1.35, bsy + s * 0.58 + wingFlapR * 0.5);
  ctx.stroke();

  // === FORKED TAIL ===
  ctx.strokeStyle = '#8b1a1a';
  ctx.lineWidth = s * 0.038;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.52, bsy + s * 0.88);
  ctx.quadraticCurveTo(sx + s * 0.68, bsy + s * 1.05, sx + s * 0.82, bsy + s * 0.78);
  ctx.stroke();
  // Fork prongs
  ctx.lineWidth = s * 0.022;
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.82, bsy + s * 0.78);
  ctx.lineTo(sx + s * 0.94, bsy + s * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.82, bsy + s * 0.78);
  ctx.lineTo(sx + s * 0.88, bsy + s * 0.65);
  ctx.stroke();

  // === TUXEDO BODY ===
  // Black jacket
  ctx.fillStyle = '#111111';
  ctx.fillRect(sx + s * 0.2, bsy + s * 0.38, s * 0.6, s * 0.55);
  // White shirt front
  ctx.fillStyle = '#ebebeb';
  ctx.fillRect(sx + s * 0.42, bsy + s * 0.38, s * 0.16, s * 0.44);
  // Shirt studs
  ctx.fillStyle = '#b8b8b8';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(sx + s * 0.5, bsy + s * 0.46 + i * s * 0.1, s * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }
  // Left lapel
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, bsy + s * 0.38);
  ctx.lineTo(sx + s * 0.2, bsy + s * 0.41);
  ctx.lineTo(sx + s * 0.42, bsy + s * 0.57);
  ctx.fill();
  // Right lapel
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.58, bsy + s * 0.38);
  ctx.lineTo(sx + s * 0.8, bsy + s * 0.41);
  ctx.lineTo(sx + s * 0.58, bsy + s * 0.57);
  ctx.fill();
  // Hem
  ctx.fillRect(sx + s * 0.2, bsy + s * 0.88, s * 0.6, s * 0.05);

  // === SLEEVES / ARMS ===
  const leftArmY = bsy + s * 0.4 + armSwing * s * 0.5;
  const rightArmY = bsy + s * 0.4 - armSwing * s * 0.5;
  ctx.fillStyle = '#111111';
  ctx.fillRect(sx + s * 0.06, leftArmY, s * 0.14, s * 0.3);
  ctx.fillRect(sx + s * 0.8, rightArmY, s * 0.14, s * 0.3);
  // White cuffs
  ctx.fillStyle = '#ebebeb';
  ctx.fillRect(sx + s * 0.07, leftArmY + s * 0.24, s * 0.12, s * 0.065);
  ctx.fillRect(sx + s * 0.81, rightArmY + s * 0.24, s * 0.12, s * 0.065);
  // Hands (dusky gray)
  ctx.fillStyle = '#7a7a8e';
  ctx.beginPath();
  ctx.arc(sx + s * 0.1, leftArmY + s * 0.33, s * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.9, rightArmY + s * 0.33, s * 0.065, 0, Math.PI * 2);
  ctx.fill();

  // === NECK ===
  ctx.fillStyle = '#7a7a8e';
  ctx.fillRect(sx + s * 0.43, bsy + s * 0.34, s * 0.14, s * 0.07);

  // === BOW TIE ===
  ctx.fillStyle = '#8b0000';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.5, bsy + s * 0.41);
  ctx.lineTo(sx + s * 0.36, bsy + s * 0.375);
  ctx.lineTo(sx + s * 0.36, bsy + s * 0.445);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.5, bsy + s * 0.41);
  ctx.lineTo(sx + s * 0.64, bsy + s * 0.375);
  ctx.lineTo(sx + s * 0.64, bsy + s * 0.445);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6a0000';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, bsy + s * 0.41, s * 0.023, 0, Math.PI * 2);
  ctx.fill();

  // === DEVIL HORNS (drawn before head so head overlaps base) ===
  ctx.fillStyle = '#6b0000';
  // Left horn
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.34, bsy + s * 0.17);
  ctx.lineTo(sx + s * 0.26, bsy - s * 0.06);
  ctx.lineTo(sx + s * 0.41, bsy + s * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.36, bsy + s * 0.16);
  ctx.lineTo(sx + s * 0.29, bsy - s * 0.03);
  ctx.lineTo(sx + s * 0.41, bsy + s * 0.14);
  ctx.closePath();
  ctx.fill();
  // Right horn
  ctx.fillStyle = '#6b0000';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.66, bsy + s * 0.17);
  ctx.lineTo(sx + s * 0.74, bsy - s * 0.06);
  ctx.lineTo(sx + s * 0.59, bsy + s * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.64, bsy + s * 0.16);
  ctx.lineTo(sx + s * 0.71, bsy - s * 0.03);
  ctx.lineTo(sx + s * 0.59, bsy + s * 0.14);
  ctx.closePath();
  ctx.fill();

  // === HEAD (round, dusky gray) ===
  ctx.fillStyle = '#7a7a8e';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.27, s * 0.19, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  // === EYES (glowing red with slit pupils) ===
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, bsy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, bsy + s * 0.255, s * 0.032, 0, Math.PI * 2);
  ctx.fill();
  // Slit pupils
  ctx.fillStyle = '#1a0000';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.41, bsy + s * 0.255, s * 0.009, s * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.59, bsy + s * 0.255, s * 0.009, s * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eye glow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ff4400';
  ctx.beginPath();
  ctx.arc(sx + s * 0.41, bsy + s * 0.255, s * 0.052, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.59, bsy + s * 0.255, s * 0.052, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // === NOSE ===
  ctx.fillStyle = '#6a6a7e';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.31, s * 0.036, s * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();

  // === SMIRK ===
  ctx.strokeStyle = '#4a3545';
  ctx.lineWidth = s * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.43, bsy + s * 0.35);
  ctx.quadraticCurveTo(sx + s * 0.52, bsy + s * 0.375, sx + s * 0.6, bsy + s * 0.34);
  ctx.stroke();

  ctx.restore(); // undo facing flip
}
