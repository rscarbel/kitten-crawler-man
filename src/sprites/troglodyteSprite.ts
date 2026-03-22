/**
 * Draw the Troglodyte enemy sprite — a squat, cave-dwelling humanoid lizard
 * with an enormous gaping mouth and a long forked tongue.
 *
 * @param ctx          Canvas rendering context
 * @param sx           Screen X (top-left of tile)
 * @param sy           Screen Y (top-left of tile)
 * @param s            Tile size in pixels (32px)
 * @param walkFrame    Continuous frame counter for walk animation
 * @param isMoving     True when actively moving
 * @param tongueExtend 0–1 tongue extension (0 = retracted, 1 = fully extended)
 * @param mouthOpenAmt 0–1 jaw-open amount (0 = barely open, 1 = wide for windup)
 * @param facingX      Horizontal facing direction component
 * @param facingY      Vertical facing direction component
 */
export function drawTroglodyteSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  tongueExtend = 0,
  mouthOpenAmt = 0,
  facingX = 0,
  facingY = 1,
): void {
  const cs = s * 1.15; // slightly larger than one tile
  const cx = sx + s * 0.5;

  // Animation values
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.045 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.07 : 0;
  const armSway = isMoving ? -Math.sin(walkFrame) * cs * 0.035 : 0;
  const tailSway = Math.sin(walkFrame * 0.6) * cs * 0.09;

  // Colours
  const skinBase = '#4f6838';
  const skinDark = '#394d28';
  const skinLight = '#607848';
  const bellyCol = '#7a6a40';
  const scaleSpot = '#2d3e1c';
  const mouthInner = '#7a0e0e';
  const gumCol = '#6a1818';
  const toothCol = '#d8d4b5';
  const tongueCol = '#d42860';
  const tongueTip = '#ff4d88';
  const eyeCol = '#d05000';
  const pupilCol = '#180800';

  // Layout: measure from ground upward
  const ground = sy + s * 0.94 + bodyBob;
  const legH = cs * 0.27;
  const bodyH = cs * 0.3;
  const headH = cs * 0.41;

  const legBottomY = ground;
  const bodyBottomY = ground - legH;
  const bodyTopY = bodyBottomY - bodyH;
  const headBottomY = bodyTopY + cs * 0.04;
  const headTopY = headBottomY - headH;
  const bodyCy = (bodyTopY + bodyBottomY) * 0.5;
  const headCy = (headTopY + headBottomY) * 0.5;

  ctx.save();

  // Horizontal flip for left-facing
  const flipped = facingX < -0.3;
  if (flipped) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + cs * 0.04, cs * 0.36, cs * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail (behind body, drawn first)
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.18, bodyBottomY + cs * 0.04);
  ctx.quadraticCurveTo(
    cx - cs * 0.38 + tailSway,
    bodyBottomY + cs * 0.12,
    cx - cs * 0.25 + tailSway,
    bodyBottomY + cs * 0.24,
  );
  ctx.stroke();

  // Legs
  ctx.fillStyle = skinDark;
  // Left leg
  ctx.beginPath();
  ctx.ellipse(
    cx - cs * 0.2 - legSwing * 0.55,
    bodyBottomY + legH * 0.55,
    cs * 0.1,
    legH * 0.55,
    legSwing * 0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right leg
  ctx.beginPath();
  ctx.ellipse(
    cx + cs * 0.2 + legSwing * 0.55,
    bodyBottomY + legH * 0.55,
    cs * 0.1,
    legH * 0.55,
    -legSwing * 0.25,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Feet
  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(
    cx - cs * 0.2 - legSwing * 0.55,
    legBottomY,
    cs * 0.15,
    cs * 0.065,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + cs * 0.2 + legSwing * 0.55,
    legBottomY,
    cs * 0.15,
    cs * 0.065,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Body
  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, cs * 0.28, cs * 0.185, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly stripe
  ctx.fillStyle = bellyCol;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy + cs * 0.02, cs * 0.14, cs * 0.115, 0, 0, Math.PI * 2);
  ctx.fill();

  // Scale spots on body
  ctx.fillStyle = scaleSpot;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx - cs * 0.13 + i * cs * 0.13, bodyCy - cs * 0.07, cs * 0.038, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Arms
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.115;
  ctx.lineCap = 'round';
  // Left arm
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.24, bodyCy - cs * 0.04);
  ctx.lineTo(cx - cs * 0.37 + armSway, bodyCy + cs * 0.12 - armSway * 0.4);
  ctx.stroke();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + cs * 0.24, bodyCy - cs * 0.04);
  ctx.lineTo(cx + cs * 0.37 - armSway, bodyCy + cs * 0.12 + armSway * 0.4);
  ctx.stroke();

  // Clawed hands
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.arc(cx - cs * 0.37 + armSway, bodyCy + cs * 0.12 - armSway * 0.4, cs * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + cs * 0.37 - armSway, bodyCy + cs * 0.12 + armSway * 0.4, cs * 0.065, 0, Math.PI * 2);
  ctx.fill();

  // Head
  const headWR = cs * 0.32; // wide head
  const headHR = cs * 0.235;

  // Head tilt back slightly during windup
  const headTiltY = mouthOpenAmt * cs * 0.035;

  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headTiltY, headWR, headHR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Scale pattern on head top
  ctx.fillStyle = scaleSpot;
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(
      cx - cs * 0.15 + i * cs * 0.1,
      headCy - headTiltY - headHR * 0.55,
      cs * 0.038,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Chin / lower jaw bulge (in skin light colour)
  ctx.fillStyle = skinLight;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    headCy - headTiltY + headHR * 0.5,
    headWR * 0.55,
    headHR * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // THE BIG MOUTH
  const mouthOpen = Math.max(0.07, mouthOpenAmt); // always at least slightly ajar
  const mouthCy = headCy - headTiltY + headHR * 0.2;
  const mouthHW = headWR * 0.88; // very wide
  const jawDrop = headHR * 0.55 * mouthOpen; // how far lower jaw descends

  // Mouth cavity
  ctx.fillStyle = mouthInner;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    mouthCy + jawDrop * 0.35,
    mouthHW * 0.88,
    jawDrop * 0.65 + cs * 0.015,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Gum line
  ctx.fillStyle = gumCol;
  ctx.beginPath();
  ctx.ellipse(cx, mouthCy, mouthHW * 0.8, cs * 0.03 + jawDrop * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper teeth
  if (mouthOpen > 0.1) {
    ctx.fillStyle = toothCol;
    const toothCount = 5;
    const toothH = cs * 0.065 * mouthOpen;
    for (let t = 0; t < toothCount; t++) {
      const tx = cx - mouthHW * 0.68 + (t + 0.5) * ((mouthHW * 1.36) / toothCount);
      ctx.beginPath();
      ctx.moveTo(tx - cs * 0.027, mouthCy);
      ctx.lineTo(tx, mouthCy + toothH);
      ctx.lineTo(tx + cs * 0.027, mouthCy);
      ctx.closePath();
      ctx.fill();
    }
    // Lower teeth (fewer, offset)
    const lowerToothH = cs * 0.055 * mouthOpen;
    const lowerBaseY = mouthCy + jawDrop * 0.95;
    for (let t = 0; t < 4; t++) {
      const tx = cx - mouthHW * 0.52 + (t + 0.5) * ((mouthHW * 1.04) / 4);
      ctx.beginPath();
      ctx.moveTo(tx - cs * 0.022, lowerBaseY);
      ctx.lineTo(tx, lowerBaseY - lowerToothH);
      ctx.lineTo(tx + cs * 0.022, lowerBaseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Lower jaw shape (drawn over teeth base)
  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(cx, mouthCy + jawDrop + cs * 0.015, mouthHW * 0.7, headHR * 0.185, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tongue
  const tongueOriginX = cx;
  const tongueOriginY = mouthCy + jawDrop * 0.35;

  if (tongueExtend <= 0.01) {
    // Tongue at rest — small curl inside mouth
    ctx.fillStyle = tongueCol;
    ctx.beginPath();
    ctx.ellipse(cx, mouthCy + jawDrop * 0.2 + cs * 0.01, cs * 0.1, cs * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Tongue shooting out in facing direction
    // When canvas is flipped (facingX was < -0.3), use +facingX to get local right
    const localFX = flipped ? -facingX : facingX;
    const localFY = facingY;
    const fLen = Math.hypot(localFX, localFY);
    const lfx = fLen > 0 ? localFX / fLen : 1;
    const lfy = fLen > 0 ? localFY / fLen : 0;

    const tongueLen = s * 2.9 * tongueExtend;
    const endX = tongueOriginX + lfx * tongueLen;
    const endY = tongueOriginY + lfy * tongueLen;

    // Tongue body — slightly sinuous
    const perpX = -lfy;
    const perpY = lfx;
    const midX = (tongueOriginX + endX) * 0.5 + perpX * cs * 0.06;
    const midY = (tongueOriginY + endY) * 0.5 + perpY * cs * 0.06;

    ctx.strokeStyle = tongueCol;
    ctx.lineWidth = cs * 0.075;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tongueOriginX, tongueOriginY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.stroke();

    // Forked tip
    const tipAngle = Math.atan2(endY - tongueOriginY, endX - tongueOriginX);
    const forkLen = cs * 0.15;
    ctx.strokeStyle = tongueTip;
    ctx.lineWidth = cs * 0.048;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX + Math.cos(tipAngle + 0.42) * forkLen,
      endY + Math.sin(tipAngle + 0.42) * forkLen,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX + Math.cos(tipAngle - 0.42) * forkLen,
      endY + Math.sin(tipAngle - 0.42) * forkLen,
    );
    ctx.stroke();
  }

  // Eyes — beady, near top of head
  const eyeY = headCy - headTiltY - headHR * 0.32;
  const eyeSpX = headWR * 0.44;
  const eyeR = cs * 0.082;

  // Eye base (orange-amber)
  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.arc(cx - eyeSpX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSpX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Vertical slit pupils
  ctx.fillStyle = pupilCol;
  ctx.beginPath();
  ctx.ellipse(cx - eyeSpX, eyeY, eyeR * 0.26, eyeR * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + eyeSpX, eyeY, eyeR * 0.26, eyeR * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  // Brow ridges (give a menacing look)
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - eyeSpX - eyeR * 1.1, eyeY - eyeR * 0.85);
  ctx.lineTo(cx - eyeSpX + eyeR * 0.5, eyeY - eyeR * 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + eyeSpX - eyeR * 0.5, eyeY - eyeR * 1.2);
  ctx.lineTo(cx + eyeSpX + eyeR * 1.1, eyeY - eyeR * 0.85);
  ctx.stroke();

  ctx.restore();
}
