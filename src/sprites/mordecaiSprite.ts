/**
 * Draws Mordecai — a standing rat-human NPC with optional walk animation.
 * @param walkTime  Global timer used to derive animation phase.
 * @param isWalking Whether Mordecai is currently walking (enables leg/arm swing).
 * @param facingX   +1 faces right, -1 faces left.
 */
export function drawMordecaiSprite(
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
  ctx.quadraticCurveTo(
    sx + s * 0.76,
    bsy + s * 0.95,
    sx + s * 0.84,
    bsy + s * 0.76,
  );
  ctx.stroke();
  ctx.restore();

  // Robe (dark brown-grey) with slight hem sway
  ctx.fillStyle = '#2e2a26';
  ctx.fillRect(
    sx + s * 0.2,
    bsy + s * 0.38,
    s * 0.6,
    s * 0.55 + Math.abs(hemSway),
  );
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
  ctx.ellipse(
    sx + s * 0.31,
    bsy + s * 0.16,
    s * 0.1,
    s * 0.12,
    -0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right ear
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.69,
    bsy + s * 0.16,
    s * 0.1,
    s * 0.12,
    0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Inner ear (pink)
  ctx.fillStyle = '#e8b8a8';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.31,
    bsy + s * 0.16,
    s * 0.065,
    s * 0.078,
    -0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.69,
    bsy + s * 0.16,
    s * 0.065,
    s * 0.078,
    0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Head (round, fur-coloured)
  ctx.fillStyle = '#b8a898';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.5,
    bsy + s * 0.27,
    s * 0.19,
    s * 0.17,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Snout (elongated rat muzzle)
  ctx.fillStyle = '#c8b4a4';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.5,
    bsy + s * 0.375,
    s * 0.09,
    s * 0.065,
    0,
    0,
    Math.PI * 2,
  );
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

/**
 * Draws Mordecai as a demon NPC for floor 3 — dusky gray skin, devil horns,
 * forked tail, bat wings, tuxedo.
 */
export function drawDemonMordecaiSprite(
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
  ctx.quadraticCurveTo(
    sx + s * 0.68,
    bsy + s * 1.05,
    sx + s * 0.82,
    bsy + s * 0.78,
  );
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
    ctx.arc(
      sx + s * 0.5,
      bsy + s * 0.46 + i * s * 0.1,
      s * 0.014,
      0,
      Math.PI * 2,
    );
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
  ctx.ellipse(
    sx + s * 0.5,
    bsy + s * 0.27,
    s * 0.19,
    s * 0.17,
    0,
    0,
    Math.PI * 2,
  );
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
  ctx.ellipse(
    sx + s * 0.41,
    bsy + s * 0.255,
    s * 0.009,
    s * 0.022,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.59,
    bsy + s * 0.255,
    s * 0.009,
    s * 0.022,
    0,
    0,
    Math.PI * 2,
  );
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
  ctx.ellipse(
    sx + s * 0.5,
    bsy + s * 0.31,
    s * 0.036,
    s * 0.022,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // === SMIRK ===
  ctx.strokeStyle = '#4a3545';
  ctx.lineWidth = s * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.43, bsy + s * 0.35);
  ctx.quadraticCurveTo(
    sx + s * 0.52,
    bsy + s * 0.375,
    sx + s * 0.6,
    bsy + s * 0.34,
  );
  ctx.stroke();

  ctx.restore(); // undo facing flip
}

/**
 * Dispatcher: picks the correct Mordecai variant sprite for the given level ID.
 * Level 3 (overworld) gets the demon tuxedo variant; all others use the rat-NPC variant.
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
    drawDemonMordecaiSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  } else {
    drawMordecaiSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
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
