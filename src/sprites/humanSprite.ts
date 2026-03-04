/** Draws a tiny heart shape centred at (cx, cy) with approximate radius r. */
function drawTinyHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.bezierCurveTo(
    cx - r * 1.8,
    cy + r * 0.4,
    cx - r * 1.8,
    cy - r * 0.6,
    cx,
    cy - r * 0.2,
  );
  ctx.bezierCurveTo(
    cx + r * 1.8,
    cy - r * 0.6,
    cx + r * 1.8,
    cy + r * 0.4,
    cx,
    cy + r,
  );
  ctx.fill();
}

export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  isKicking: boolean,
  walkFrame = 0,
  isMoving = false,
  facingY = 0,
) {
  const facingAway = facingY < -0.5;

  // Body bob — bounces up slightly twice per stride cycle
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.04 : 0;

  // Leg offsets — left and right swing in opposite phases
  const legSwing = isMoving ? Math.sin(walkFrame) * s * 0.05 : 0;

  // Bare legs (skin tone, no shoes)
  ctx.fillStyle = '#fcd5ae';
  // Left leg
  ctx.fillRect(
    sx + s * 0.27,
    sy + s * 0.72 + bodyBob + legSwing,
    s * 0.18,
    s * 0.24 - legSwing,
  );
  if (!isKicking) {
    // Right leg
    ctx.fillRect(
      sx + s * 0.55,
      sy + s * 0.72 + bodyBob - legSwing,
      s * 0.18,
      s * 0.24 + legSwing,
    );
  }

  // Arm swing (opposite to legs)
  const armSwing = isMoving ? -Math.sin(walkFrame) * s * 0.03 : 0;

  // Black jacket (upper body)
  ctx.fillStyle = '#111827';
  ctx.fillRect(sx + s * 0.22, sy + s * 0.38 + bodyBob, s * 0.56, s * 0.26);

  // White boxer shorts (lower body / hip area)
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(sx + s * 0.22, sy + s * 0.64 + bodyBob, s * 0.56, s * 0.14);

  // Boxer waistband (slightly darker strip at top)
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(sx + s * 0.22, sy + s * 0.64 + bodyBob, s * 0.56, s * 0.025);

  // Red hearts on boxers (front view only)
  if (!facingAway) {
    ctx.fillStyle = '#ef4444';
    drawTinyHeart(ctx, sx + s * 0.38, sy + s * 0.72 + bodyBob, s * 0.05);
    drawTinyHeart(ctx, sx + s * 0.62, sy + s * 0.72 + bodyBob, s * 0.05);
  }

  // Jacket arms (black)
  ctx.fillStyle = '#111827';
  // Left arm
  ctx.fillRect(
    sx + s * 0.07,
    sy + s * 0.4 + bodyBob + armSwing,
    s * 0.15,
    s * 0.22,
  );
  // Right arm
  ctx.fillRect(
    sx + s * 0.78,
    sy + s * 0.4 + bodyBob - armSwing,
    s * 0.15,
    s * 0.22,
  );

  // Head (skin tone)
  ctx.fillStyle = '#fcd5ae';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.24 + bodyBob, s * 0.2, 0, Math.PI * 2);
  ctx.fill();

  if (facingAway) {
    // Back of head — dark hair covering the top half
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.arc(
      sx + s * 0.5,
      sy + s * 0.22 + bodyBob,
      s * 0.17,
      Math.PI,
      Math.PI * 2,
    );
    ctx.fill();
    // Collar visible at the back of the neck
    ctx.fillStyle = '#111827';
    ctx.fillRect(sx + s * 0.38, sy + s * 0.37 + bodyBob, s * 0.24, s * 0.05);
  } else {
    // Brown hair cap — always visible when facing camera (all non-away directions)
    {
      const hcx = sx + s * 0.5;
      const hcy = sy + s * 0.24 + bodyBob;
      ctx.fillStyle = '#7b4520';
      ctx.beginPath();
      if (facingY > 0.5) {
        // Facing down: tighter arc so the hair crown stays well above the eyes
        ctx.arc(
          hcx,
          hcy,
          s * 0.21,
          Math.PI * (7.5 / 6),
          Math.PI * (10.5 / 6),
          false,
        );
      } else {
        // Sideways / neutral / slight up: standard hair cap
        ctx.arc(
          hcx,
          hcy,
          s * 0.21,
          Math.PI * (7 / 6),
          Math.PI * (11 / 6),
          false,
        );
      }
      // closePath draws a chord from arc-end back to arc-start, forming a clean cap
      // (no pie-slice line to centre that would dip into the face)
      ctx.closePath();
      ctx.fill();
    }

    // Eyes (front view only)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(sx + s * 0.42, sy + s * 0.22 + bodyBob, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + s * 0.58, sy + s * 0.22 + bodyBob, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawHumanAttack(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  attackPhase: 'punch' | 'kick',
  attackTimer: number,
  ATTACK_FRAMES: number,
  facingX: number,
  facingY: number,
) {
  const t = 1 - attackTimer / ATTACK_FRAMES; // 0→1
  const ext = Math.sin(t * Math.PI); // peaks at t=0.5

  // Arm socket origin — always at shoulder height.
  // When facing sideways the socket is on the forward shoulder;
  // when facing up/down it's offset to the right arm socket so the fist
  // doesn't appear to come from the belly or the back of the head.
  const armOffsetX = Math.abs(facingX) > 0.2 ? facingX * s * 0.28 : s * 0.2;
  const armOriginX = sx + s * 0.5 + armOffsetX;
  const armOriginY = sy + s * 0.42;

  ctx.save();

  if (attackPhase === 'punch') {
    const reach = s * 0.55;
    const fistX = armOriginX + facingX * reach * ext;
    const fistY = armOriginY + facingY * reach * ext;

    // Motion trail
    if (ext > 0.05) {
      ctx.globalAlpha = ext * 0.4;
      ctx.strokeStyle = '#fcd5ae';
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(armOriginX, armOriginY);
      ctx.lineTo(fistX, fistY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Fist
    ctx.fillStyle = '#fcd5ae';
    ctx.beginPath();
    ctx.arc(fistX, fistY, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c47a3a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Impact burst near peak
    if (ext > 0.75) {
      const intensity = (ext - 0.75) / 0.25;
      ctx.globalAlpha = intensity * 0.9;
      ctx.strokeStyle = '#fffde7';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const r1 = s * 0.09;
        const r2 = r1 + s * 0.14 * intensity;
        ctx.beginPath();
        ctx.moveTo(fistX + Math.cos(angle) * r1, fistY + Math.sin(angle) * r1);
        ctx.lineTo(fistX + Math.cos(angle) * r2, fistY + Math.sin(angle) * r2);
        ctx.stroke();
      }
    }
  } else {
    // Kick — bare leg swings from right hip in facing direction.
    // When facing up the foot would travel through the body, so redirect sideways.
    const kickFacingX = facingY < -0.5 ? (facingX >= 0 ? 1 : -1) : facingX;
    const kickFacingY = facingY < -0.5 ? 0 : facingY;

    const hipX = sx + s * 0.55;
    const hipY = sy + s * 0.78;
    const reach = s * 0.55;
    const footX = hipX + kickFacingX * reach * ext;
    const footY = hipY + kickFacingY * reach * ext;

    // Leg line from hip (skin tone — bare leg)
    ctx.strokeStyle = '#fcd5ae';
    ctx.lineWidth = s * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(footX, footY);
    ctx.stroke();

    // Bare foot (skin tone ellipse)
    const footAngle = Math.atan2(kickFacingY, kickFacingX);
    ctx.fillStyle = '#fcd5ae';
    ctx.beginPath();
    ctx.ellipse(footX, footY, s * 0.18, s * 0.09, footAngle, 0, Math.PI * 2);
    ctx.fill();

    // Dust cloud at peak
    if (ext > 0.65) {
      const dustAmt = (ext - 0.65) / 0.35;
      ctx.globalAlpha = dustAmt * 0.5;
      ctx.fillStyle = '#c4a77d';
      for (let i = 0; i < 3; i++) {
        const angle = footAngle + (i - 1) * 0.8;
        const dist = s * 0.28 * dustAmt;
        ctx.beginPath();
        ctx.arc(
          footX + Math.cos(angle) * dist,
          footY + Math.sin(angle) * dist,
          s * 0.09,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  ctx.restore();
}
