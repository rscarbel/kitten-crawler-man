export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  isKicking: boolean,
  walkFrame = 0,
  isMoving = false,
) {
  // Body bob — bounces up slightly twice per stride cycle
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.04 : 0;

  // Leg offsets — left and right swing in opposite phases
  const legSwing = isMoving ? Math.sin(walkFrame) * s * 0.05 : 0;

  // Legs — hide kicking leg during kick animation
  ctx.fillStyle = '#1e3a5f';
  // Left leg
  ctx.fillRect(sx + s * 0.27, sy + s * 0.72 + bodyBob + legSwing, s * 0.18, s * 0.24 - legSwing);
  if (!isKicking) {
    // Right leg
    ctx.fillRect(sx + s * 0.55, sy + s * 0.72 + bodyBob - legSwing, s * 0.18, s * 0.24 + legSwing);
  }

  // Arm swing (opposite to legs)
  const armSwing = isMoving ? -Math.sin(walkFrame) * s * 0.03 : 0;

  // Body (blue shirt)
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(sx + s * 0.22, sy + s * 0.38 + bodyBob, s * 0.56, s * 0.38);

  // Left arm
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(sx + s * 0.07, sy + s * 0.40 + bodyBob + armSwing, s * 0.15, s * 0.22);

  // Right arm
  ctx.fillRect(sx + s * 0.78, sy + s * 0.40 + bodyBob - armSwing, s * 0.15, s * 0.22);

  // Head (skin tone)
  ctx.fillStyle = '#fcd5ae';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.24 + bodyBob, s * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(sx + s * 0.42, sy + s * 0.22 + bodyBob, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.58, sy + s * 0.22 + bodyBob, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
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

  // Arm socket origin — at shoulder height (s*0.42 from top) and offset
  // toward the facing direction so the punch comes from the arm, not center mass.
  const armOriginX = sx + s * 0.5 + facingX * s * 0.22;
  const armOriginY = sy + s * 0.42 + facingY * s * 0.18;

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
    // Kick — boot swings from right hip in facing direction
    const hipX = sx + s * 0.55;
    const hipY = sy + s * 0.78;
    const reach = s * 0.55;
    const bootX = hipX + facingX * reach * ext;
    const bootY = hipY + facingY * reach * ext;

    // Leg line from hip
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = s * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(bootX, bootY);
    ctx.stroke();

    // Boot
    const bootAngle = Math.atan2(facingY, facingX);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(bootX, bootY, s * 0.2, s * 0.1, bootAngle, 0, Math.PI * 2);
    ctx.fill();

    // Dust cloud at peak
    if (ext > 0.65) {
      const dustAmt = (ext - 0.65) / 0.35;
      ctx.globalAlpha = dustAmt * 0.5;
      ctx.fillStyle = '#c4a77d';
      for (let i = 0; i < 3; i++) {
        const angle = bootAngle + (i - 1) * 0.8;
        const dist = s * 0.28 * dustAmt;
        ctx.beginPath();
        ctx.arc(
          bootX + Math.cos(angle) * dist,
          bootY + Math.sin(angle) * dist,
          s * 0.09, 0, Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  ctx.restore();
}
