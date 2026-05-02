/** Draws a tiny heart shape centred at (cx, cy) with approximate radius r. */
function drawTinyHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.bezierCurveTo(cx - r * 1.8, cy + r * 0.4, cx - r * 1.8, cy - r * 0.6, cx, cy - r * 0.2);
  ctx.bezierCurveTo(cx + r * 1.8, cy - r * 0.6, cx + r * 1.8, cy + r * 0.4, cx, cy + r);
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

  // Leg offsets — whole leg+shoe block translates up/down, left and right in opposite phases
  const legSwing = isMoving ? Math.sin(walkFrame) * s * 0.05 : 0;
  const legTop = sy + s * 0.72 + bodyBob;
  const legH = s * 0.22;

  // Bare legs (skin tone)
  ctx.fillStyle = '#fcd5ae';
  ctx.fillRect(sx + s * 0.27, legTop + legSwing, s * 0.18, legH);
  if (!isKicking) {
    ctx.fillRect(sx + s * 0.55, legTop - legSwing, s * 0.18, legH);
  }

  // Shoes — follow the leg they belong to
  ctx.fillStyle = '#222222';
  ctx.fillRect(sx + s * 0.24, legTop + legH + legSwing, s * 0.22, s * 0.065);
  if (!isKicking) {
    ctx.fillRect(sx + s * 0.52, legTop + legH - legSwing, s * 0.22, s * 0.065);
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
  ctx.fillRect(sx + s * 0.07, sy + s * 0.4 + bodyBob + armSwing, s * 0.15, s * 0.22);
  // Right arm
  ctx.fillRect(sx + s * 0.78, sy + s * 0.4 + bodyBob - armSwing, s * 0.15, s * 0.22);

  // Head (skin tone)
  ctx.fillStyle = '#fcd5ae';
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.24 + bodyBob, s * 0.2, 0, Math.PI * 2);
  ctx.fill();

  if (facingAway) {
    // Back of head — dark hair covering the top half
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.arc(sx + s * 0.5, sy + s * 0.22 + bodyBob, s * 0.17, Math.PI, Math.PI * 2);
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
        ctx.arc(hcx, hcy, s * 0.21, Math.PI * (7.5 / 6), Math.PI * (10.5 / 6), false);
      } else {
        // Sideways / neutral / slight up: standard hair cap
        ctx.arc(hcx, hcy, s * 0.21, Math.PI * (7 / 6), Math.PI * (11 / 6), false);
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

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, -Math.PI / 2);
  ctx.closePath();
}

function drawFist(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  s: number,
): void {
  const fw = s * 0.18;
  const fh = s * 0.13;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // Knuckle block
  ctx.fillStyle = '#fcd5ae';
  drawRoundRect(ctx, -fw * 0.2, -fh * 0.5, fw, fh, s * 0.035);
  ctx.fill();
  ctx.strokeStyle = '#c47a3a';
  ctx.lineWidth = Math.max(0.8, s * 0.016);
  ctx.stroke();

  // Knuckle ridges
  ctx.strokeStyle = '#b86a2e';
  ctx.lineWidth = Math.max(0.6, s * 0.012);
  for (let i = 1; i <= 2; i++) {
    const kx = -fw * 0.2 + fw * (i / 3);
    ctx.beginPath();
    ctx.moveTo(kx, -fh * 0.42);
    ctx.lineTo(kx, fh * 0.32);
    ctx.stroke();
  }

  // Thumb bump (on top of fist, near the base)
  ctx.fillStyle = '#fcd5ae';
  ctx.beginPath();
  ctx.arc(-fw * 0.05, -fh * 0.58, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c47a3a';
  ctx.lineWidth = Math.max(0.6, s * 0.012);
  ctx.stroke();

  ctx.restore();
}

function drawKickShoe(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.fillStyle = '#222222';
  // Height s*0.18 covers the s*0.16 leg lineWidth; starts at -s*0.02 to overlap the flat butt end.
  drawRoundRect(ctx, -s * 0.02, -s * 0.09, s * 0.26, s * 0.18, s * 0.04);
  ctx.fill();

  ctx.restore();
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

  // Arm socket — forward shoulder when sideways; right arm socket (sx+s*0.78) when facing up/down.
  const armOffsetX = Math.abs(facingX) > 0.2 ? facingX * s * 0.28 : s * 0.28;
  const armOriginX = sx + s * 0.5 + armOffsetX;
  const armOriginY = sy + s * 0.42;

  ctx.save();

  if (attackPhase === 'punch') {
    const reach = s * 0.52;
    const fistX = armOriginX + facingX * reach * ext;
    const fistY = armOriginY + facingY * reach * ext;
    const fistAngle = Math.atan2(facingY, facingX);

    // Sleeve (black jacket arm)
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = s * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armOriginX, armOriginY);
    ctx.lineTo(fistX, fistY);
    ctx.stroke();

    // Knuckled fist
    drawFist(ctx, fistX, fistY, fistAngle, s);
  } else {
    // Kick — right leg swings from hip in facing direction.
    // When facing up the foot would travel through the body, so redirect sideways.
    const kickFacingX = facingY < -0.5 ? (facingX >= 0 ? 1 : -1) : facingX;
    const kickFacingY = facingY < -0.5 ? 0 : facingY;

    // Right leg centre: left edge sx+s*0.55, width s*0.18 → centre sx+s*0.64
    const hipX = sx + s * 0.64;
    const hipY = sy + s * 0.78;
    const reach = s * 0.52;
    const footX = hipX + kickFacingX * reach * ext;
    const footY = hipY + kickFacingY * reach * ext;
    const footAngle = Math.atan2(kickFacingY, kickFacingX);

    // Bare leg — butt cap at foot so the shoe covers the end cleanly
    ctx.strokeStyle = '#fcd5ae';
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(footX, footY);
    ctx.stroke();
    // Round join at the hip end only
    ctx.fillStyle = '#fcd5ae';
    ctx.beginPath();
    ctx.arc(hipX, hipY, s * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Dark shoe — tall enough (s*0.18) to cover the full leg width (s*0.16)
    drawKickShoe(ctx, footX, footY, footAngle, s);
  }

  ctx.restore();
}

/**
 * Punching arm only — black sleeve + knuckled fist — extending rightward (+X).
 * Pixel-aligned with drawHumanSprite at the same anchor for compositing.
 * t: 0→1 over the punch cycle; fist reaches full extension at t=0.5.
 */
export function drawHumanPunchArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  t: number,
): void {
  const ext = Math.sin(t * Math.PI);
  if (ext < 0.02) return;

  const shoulderX = sx + s * 0.78;
  const shoulderY = sy + s * 0.42;
  const fistX = shoulderX + s * 0.52 * ext;
  const fistY = shoulderY;

  ctx.save();

  // Sleeve
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = s * 0.15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(fistX, fistY);
  ctx.stroke();

  // Knuckled fist (facing right, angle=0)
  drawFist(ctx, fistX, fistY, 0, s);

  ctx.restore();
}

/**
 * Kicking leg only — bare leg + dark shoe — extending rightward (+X) with a slight upward arc.
 * Pixel-aligned with drawHumanSprite(isKicking=true) at the same anchor for compositing.
 * t: 0→1 over the kick cycle; foot reaches full extension at t=0.5.
 */
export function drawHumanKickLeg(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  t: number,
): void {
  const ext = Math.sin(t * Math.PI);
  if (ext < 0.02) return;

  const hipX = sx + s * 0.64; // right leg centre (left edge s*0.55 + half-width s*0.09)
  const hipY = sy + s * 0.78;
  const reach = s * 0.52;
  const footX = hipX + reach * ext;
  const footY = hipY - reach * 0.22 * ext; // slight upward arc
  const footAngle = Math.atan2(footY - hipY, footX - hipX);

  ctx.save();

  // Bare leg — butt cap at foot so the shoe covers the end cleanly
  ctx.strokeStyle = '#fcd5ae';
  ctx.lineWidth = s * 0.16;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(footX, footY);
  ctx.stroke();
  // Round join at the hip end only
  ctx.fillStyle = '#fcd5ae';
  ctx.beginPath();
  ctx.arc(hipX, hipY, s * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Dark shoe
  drawKickShoe(ctx, footX, footY, footAngle, s);

  ctx.restore();
}
