/**
 * Draw the Tuskling enemy sprite — a stocky, bipedal orc/hog hybrid.
 * Wide muscular body, pig snout, upward-curving tusks, and a curly tail.
 *
 * @param ctx           Canvas rendering context
 * @param sx            Screen X (top-left of tile)
 * @param sy            Screen Y (top-left of tile)
 * @param s             Tile size in pixels (32px)
 * @param walkFrame     Continuous frame counter for walk animation
 * @param isMoving      True when actively moving
 * @param chargeWindup  0–1 charge windup amount (0 = idle, 1 = fully wound up / about to charge)
 * @param facingX       Horizontal facing direction component
 * @param facingY       Vertical facing direction component
 */
export function drawTusklingSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  chargeWindup = 0,
  facingX = 0,
  facingY = 1,
): void {
  const cs = s * 1.1;
  const cx = sx + s * 0.5;

  // Animation
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.04 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.09 : 0;
  const armSway = isMoving ? -Math.sin(walkFrame) * cs * 0.04 : 0;
  // Charge windup: head lunges forward (down in screen space), body hunches
  const windupLunge = chargeWindup * cs * 0.09;
  const windupStamp = Math.sin(walkFrame * 2.5) * chargeWindup * cs * 0.06;

  // Colours — muted grey-green orcish skin with pink hog undertones
  const skinBase = '#7b8c6a';
  const skinDark = '#5a6a4e';
  const skinLight = '#96a882';
  const snoutCol = '#c4907a';
  const snoutDark = '#a87060';
  const tuskCol = '#e8dfa0';
  const tuskTip = '#c8c070';
  const eyeWhite = '#d8c8b0';
  const pupilCol = '#1a0a00';
  const earCol = '#c4907a';
  const earInner = '#e8b8a8';
  const tailCol = '#96a882';
  const bellyCol = '#c4a898';

  // Layout (ground-up)
  const ground = sy + s * 0.96 + bodyBob;
  const legH = cs * 0.22;
  const bodyH = cs * 0.31;
  const headH = cs * 0.36;

  const legBottomY = ground;
  const bodyBottomY = ground - legH;
  const bodyTopY = bodyBottomY - bodyH;
  const headBottomY = bodyTopY + cs * 0.06;
  const headTopY = headBottomY - headH;
  const bodyCy = (bodyTopY + bodyBottomY) * 0.5;
  const headCy = (headTopY + headBottomY) * 0.5 + windupLunge;

  ctx.save();

  // Horizontal flip for left-facing
  const flipped = facingX < -0.3;
  if (flipped) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + cs * 0.05, cs * 0.38, cs * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // Curly pig tail (behind body, drawn first)
  ctx.strokeStyle = tailCol;
  ctx.lineWidth = cs * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Start at back of body, curl upward-right
  const tailX = cx - cs * 0.22;
  const tailY = bodyBottomY - cs * 0.06;
  ctx.moveTo(tailX, tailY);
  ctx.bezierCurveTo(
    tailX - cs * 0.18,
    tailY - cs * 0.08,
    tailX - cs * 0.22,
    tailY - cs * 0.2,
    tailX - cs * 0.1,
    tailY - cs * 0.22,
  );
  ctx.stroke();
  // Curl end
  ctx.beginPath();
  ctx.arc(tailX - cs * 0.1, tailY - cs * 0.22, cs * 0.05, 0, Math.PI * 1.5);
  ctx.stroke();

  // Legs — short and thick
  ctx.fillStyle = skinDark;
  // Left leg (stamp animation during windup)
  ctx.beginPath();
  ctx.ellipse(
    cx - cs * 0.19 - legSwing * 0.5,
    bodyBottomY + legH * 0.5 - windupStamp * 0.5,
    cs * 0.12,
    legH * 0.6,
    legSwing * 0.2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Right leg
  ctx.beginPath();
  ctx.ellipse(
    cx + cs * 0.19 + legSwing * 0.5,
    bodyBottomY + legH * 0.5 + windupStamp * 0.5,
    cs * 0.12,
    legH * 0.6,
    -legSwing * 0.2,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Hooves
  ctx.fillStyle = '#3a3028';
  ctx.beginPath();
  ctx.ellipse(
    cx - cs * 0.19 - legSwing * 0.5,
    legBottomY - windupStamp * 0.5,
    cs * 0.13,
    cs * 0.055,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + cs * 0.19 + legSwing * 0.5,
    legBottomY + windupStamp * 0.5,
    cs * 0.13,
    cs * 0.055,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Body — wide and barrel-chested
  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, cs * 0.33, cs * 0.215, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly (paler, hog-pink)
  ctx.fillStyle = bellyCol;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy + cs * 0.03, cs * 0.16, cs * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body muscle lines (orcish bulk)
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.025;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.06, bodyTopY + cs * 0.04);
  ctx.quadraticCurveTo(cx - cs * 0.1, bodyCy, cx - cs * 0.06, bodyBottomY - cs * 0.04);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + cs * 0.06, bodyTopY + cs * 0.04);
  ctx.quadraticCurveTo(cx + cs * 0.1, bodyCy, cx + cs * 0.06, bodyBottomY - cs * 0.04);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Arms — thick and muscular
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.135;
  ctx.lineCap = 'round';
  // Left arm (swings forward during charge windup)
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.29, bodyCy - cs * 0.05);
  ctx.lineTo(
    cx - cs * 0.42 + armSway - windupLunge * 0.3,
    bodyCy + cs * 0.14 - armSway * 0.3 + windupLunge * 0.4,
  );
  ctx.stroke();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + cs * 0.29, bodyCy - cs * 0.05);
  ctx.lineTo(
    cx + cs * 0.42 - armSway + windupLunge * 0.3,
    bodyCy + cs * 0.14 + armSway * 0.3 + windupLunge * 0.4,
  );
  ctx.stroke();

  // Knuckles
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.arc(
    cx - cs * 0.42 + armSway - windupLunge * 0.3,
    bodyCy + cs * 0.14 - armSway * 0.3 + windupLunge * 0.4,
    cs * 0.075,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    cx + cs * 0.42 - armSway + windupLunge * 0.3,
    bodyCy + cs * 0.14 + armSway * 0.3 + windupLunge * 0.4,
    cs * 0.075,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Head
  const headWR = cs * 0.29;
  const headHR = cs * 0.225;

  ctx.fillStyle = skinBase;
  ctx.beginPath();
  ctx.ellipse(cx, headCy, headWR, headHR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head top highlight
  ctx.fillStyle = skinLight;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headHR * 0.35, headWR * 0.6, headHR * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pig ears — rounded, floppy
  const earY = headCy - headHR * 0.55;
  // Left ear
  ctx.fillStyle = earCol;
  ctx.beginPath();
  ctx.ellipse(cx - headWR * 0.78, earY, cs * 0.11, cs * 0.09, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = earInner;
  ctx.beginPath();
  ctx.ellipse(cx - headWR * 0.78, earY + cs * 0.01, cs * 0.065, cs * 0.055, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Right ear
  ctx.fillStyle = earCol;
  ctx.beginPath();
  ctx.ellipse(cx + headWR * 0.78, earY, cs * 0.11, cs * 0.09, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = earInner;
  ctx.beginPath();
  ctx.ellipse(cx + headWR * 0.78, earY + cs * 0.01, cs * 0.065, cs * 0.055, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Snout — protruding pig nose
  const snoutCy = headCy + headHR * 0.28;
  ctx.fillStyle = snoutCol;
  ctx.beginPath();
  ctx.ellipse(cx, snoutCy, headWR * 0.5, headHR * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  // Snout outline
  ctx.strokeStyle = snoutDark;
  ctx.lineWidth = cs * 0.02;
  ctx.beginPath();
  ctx.ellipse(cx, snoutCy, headWR * 0.5, headHR * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Nostrils
  ctx.fillStyle = snoutDark;
  ctx.beginPath();
  ctx.ellipse(
    cx - headWR * 0.18,
    snoutCy + cs * 0.005,
    cs * 0.055,
    cs * 0.04,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + headWR * 0.18, snoutCy + cs * 0.005, cs * 0.055, cs * 0.04, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Tusks — curving upward from sides of snout
  ctx.strokeStyle = tuskCol;
  ctx.lineWidth = cs * 0.07;
  ctx.lineCap = 'round';
  // Left tusk
  ctx.beginPath();
  ctx.moveTo(cx - headWR * 0.32, snoutCy + headHR * 0.12);
  ctx.quadraticCurveTo(cx - headWR * 0.52, snoutCy, cx - headWR * 0.46, snoutCy - headHR * 0.36);
  ctx.stroke();
  // Left tusk tip
  ctx.strokeStyle = tuskTip;
  ctx.lineWidth = cs * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx - headWR * 0.46, snoutCy - headHR * 0.28);
  ctx.lineTo(cx - headWR * 0.44, snoutCy - headHR * 0.4);
  ctx.stroke();

  // Right tusk
  ctx.strokeStyle = tuskCol;
  ctx.lineWidth = cs * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx + headWR * 0.32, snoutCy + headHR * 0.12);
  ctx.quadraticCurveTo(cx + headWR * 0.52, snoutCy, cx + headWR * 0.46, snoutCy - headHR * 0.36);
  ctx.stroke();
  // Right tusk tip
  ctx.strokeStyle = tuskTip;
  ctx.lineWidth = cs * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx + headWR * 0.46, snoutCy - headHR * 0.28);
  ctx.lineTo(cx + headWR * 0.44, snoutCy - headHR * 0.4);
  ctx.stroke();

  // Eyes — small, beady, set above the snout
  const eyeY = headCy - headHR * 0.12;
  const eyeSpX = headWR * 0.38;
  const eyeR = cs * 0.072;

  ctx.fillStyle = eyeWhite;
  ctx.beginPath();
  ctx.arc(cx - eyeSpX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSpX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Pupils — small, dark, forward-looking
  ctx.fillStyle = pupilCol;
  ctx.beginPath();
  ctx.arc(cx - eyeSpX + eyeR * 0.2, eyeY + eyeR * 0.1, eyeR * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeSpX + eyeR * 0.2, eyeY + eyeR * 0.1, eyeR * 0.52, 0, Math.PI * 2);
  ctx.fill();

  // Angry brow ridges — thick and furrowed
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = cs * 0.055;
  ctx.lineCap = 'round';
  // Left brow — angled inward and down toward nose (angry)
  ctx.beginPath();
  ctx.moveTo(cx - eyeSpX - eyeR * 1.2, eyeY - eyeR * 1.0);
  ctx.lineTo(cx - eyeSpX + eyeR * 0.4, eyeY - eyeR * 1.35);
  ctx.stroke();
  // Right brow
  ctx.beginPath();
  ctx.moveTo(cx + eyeSpX - eyeR * 0.4, eyeY - eyeR * 1.35);
  ctx.lineTo(cx + eyeSpX + eyeR * 1.2, eyeY - eyeR * 1.0);
  ctx.stroke();

  // Charge windup visual: snort particles
  if (chargeWindup > 0.3) {
    const snortAlpha = (chargeWindup - 0.3) / 0.7;
    ctx.globalAlpha = snortAlpha * 0.7;
    ctx.fillStyle = '#d0c0b0';
    const puffT = (performance.now() / 300) % 1;
    const puffOff = puffT * cs * 0.28;
    // Left nostril puff
    ctx.beginPath();
    ctx.arc(
      cx - headWR * 0.18 - puffOff * 0.4,
      snoutCy - puffOff,
      cs * 0.05 * (1 - puffT * 0.5),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // Right nostril puff
    ctx.beginPath();
    ctx.arc(
      cx + headWR * 0.18 + puffOff * 0.4,
      snoutCy - puffOff,
      cs * 0.05 * (1 - puffT * 0.5),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
