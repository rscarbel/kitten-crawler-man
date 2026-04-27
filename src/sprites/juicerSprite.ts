import { drawDumbbellHeld } from './gymEquipmentSprite';

/**
 * Draw the Juicer boss sprite — a giant muscular bipedal lizard in black shorts.
 *
 * @param ctx       Canvas rendering context
 * @param sx        Screen X (top-left of tile)
 * @param sy        Screen Y (top-left of tile)
 * @param s         Tile size in pixels (32px)
 * @param walkFrame Continuous frame counter for walk animation
 * @param isMoving  True when the mob is actively moving
 * @param throwAnim 0–1 normalized throw wind-up/release animation
 * @param facingX   Horizontal facing direction (-1, 0, 1)
 * @param facingY   Vertical facing direction (-1, 0, 1)
 * @param isEnraged True when HP < 40%
 * @param heldDumbbell True when carrying a dumbbell to throw
 */
export function drawJuicerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  throwAnim = 0,
  facingX = 0,
  facingY = 1,
  isEnraged = false,
  heldDumbbell = false,
): void {
  // Juicer renders at 1.6× the standard tile size so he looks imposing.
  // Sprite is centred on the tile centre.
  const scale = 1.6;
  const cs = s * scale;
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.5;

  // Animation values
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.05 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.06 : 0;
  const armSwing = isMoving ? -Math.sin(walkFrame) * cs * 0.04 : 0;
  const tailSway = Math.sin(walkFrame * 0.7) * cs * 0.1;

  const skinColor = '#3a8a3a';
  const skinDark = '#2a6a2a';
  const skinLight = '#5aaa5a';
  const scaleColor = '#245a24';
  const bellyColor = '#c8b87a';
  const shortsColor = '#1a1a1a';
  const shortsHighlight = '#2e2e2e';
  const eyeWhite = '#fff';
  const pupilColor = isEnraged ? '#f97316' : '#1a3a1a';

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, sy + s * 0.97, cs * 0.45, cs * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail (behind body, drawn first)
  const tailBase = {
    x: cx - facingX * cs * 0.25,
    y: cy + cs * 0.1 + bodyBob,
  };
  const tailTip = {
    x: tailBase.x - facingX * cs * 0.4 + tailSway,
    y: tailBase.y + cs * 0.35,
  };
  ctx.strokeStyle = skinColor;
  ctx.lineWidth = cs * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tailBase.x, tailBase.y);
  ctx.quadraticCurveTo(
    tailBase.x - facingX * cs * 0.1 + tailSway * 0.5,
    tailBase.y + cs * 0.2,
    tailTip.x,
    tailTip.y,
  );
  ctx.stroke();
  // Tail tip (thinner)
  ctx.lineWidth = cs * 0.07;
  ctx.strokeStyle = skinDark;
  ctx.beginPath();
  ctx.moveTo(tailTip.x, tailTip.y);
  ctx.lineTo(tailTip.x - facingX * cs * 0.12 + tailSway * 0.3, tailTip.y + cs * 0.18);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Legs
  const legY = cy + cs * 0.12 + bodyBob;
  const legW = cs * 0.2;
  const legH = cs * 0.34;

  // Left leg
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx - cs * 0.27 - legW * 0.5, legY - legSwing * 0.5, legW, legH, cs * 0.06)
    : ctx.fillRect(cx - cs * 0.27 - legW * 0.5, legY - legSwing * 0.5, legW, legH);
  ctx.fill();
  // Left foot
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(
    cx - cs * 0.27 + facingX * cs * 0.06,
    legY + legH - legSwing * 0.5,
    legW * 0.7,
    legW * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Right leg
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(cx + cs * 0.07 - legW * 0.5, legY + legSwing * 0.5, legW, legH, cs * 0.06)
    : ctx.fillRect(cx + cs * 0.07 - legW * 0.5, legY + legSwing * 0.5, legW, legH);
  ctx.fill();
  // Right foot
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(
    cx + cs * 0.07 + facingX * cs * 0.06,
    legY + legH + legSwing * 0.5,
    legW * 0.7,
    legW * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Shorts
  const shortsY = cy + cs * 0.04 + bodyBob;
  ctx.fillStyle = shortsColor;
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.4, shortsY);
  ctx.lineTo(cx + cs * 0.4, shortsY);
  ctx.lineTo(cx + cs * 0.38, shortsY + cs * 0.28);
  ctx.lineTo(cx - cs * 0.38, shortsY + cs * 0.28);
  ctx.closePath();
  ctx.fill();
  // Shorts waistband
  ctx.fillStyle = shortsHighlight;
  ctx.fillRect(cx - cs * 0.41, shortsY - cs * 0.02, cs * 0.82, cs * 0.06);
  // Shorts center seam
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, shortsY);
  ctx.lineTo(cx, shortsY + cs * 0.28);
  ctx.stroke();

  // Torso (barrel chest)
  const torsoY = cy - cs * 0.08 + bodyBob;
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, torsoY, cs * 0.42, cs * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Scale pattern on torso (darker ellipses)
  ctx.fillStyle = scaleColor;
  for (let row = 0; row < 3; row++) {
    for (let col = -1; col <= 1; col++) {
      const scx = cx + col * cs * 0.13 + (row % 2 === 0 ? 0 : cs * 0.065);
      const scy = torsoY - cs * 0.14 + row * cs * 0.12;
      ctx.beginPath();
      ctx.ellipse(scx, scy, cs * 0.055, cs * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Belly (front, pale)
  ctx.fillStyle = bellyColor;
  ctx.beginPath();
  ctx.ellipse(
    cx + facingX * cs * 0.04,
    torsoY + cs * 0.06,
    cs * 0.18,
    cs * 0.22,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Pectoral muscles (two bulges)
  ctx.fillStyle = skinLight;
  ctx.beginPath();
  ctx.ellipse(cx - cs * 0.14, torsoY - cs * 0.06, cs * 0.14, cs * 0.1, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.14, torsoY - cs * 0.06, cs * 0.14, cs * 0.1, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Arms
  // Arm positions — throw arm raised based on throwAnim
  const leftArmX = cx - cs * 0.48;
  const leftArmY = torsoY + armSwing;
  const rightArmX = cx + cs * 0.48;
  // Right arm is the throw arm; raise it during throwAnim
  const throwRaise = throwAnim > 0 ? -Math.sin(throwAnim * Math.PI) * cs * 0.3 : 0;
  const rightArmY = torsoY - armSwing + throwRaise;

  // Upper arm (big ellipses for muscular look)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(leftArmX, leftArmY, cs * 0.14, cs * 0.2, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(rightArmX, rightArmY, cs * 0.14, cs * 0.2, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Forearm
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(leftArmX - cs * 0.04, leftArmY + cs * 0.2, cs * 0.1, cs * 0.15, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    rightArmX + cs * 0.04,
    rightArmY + cs * 0.2,
    cs * 0.1,
    cs * 0.15,
    0.1,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Hand / claws (small fist)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(leftArmX - cs * 0.06, leftArmY + cs * 0.35, cs * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightArmX + cs * 0.06, rightArmY + cs * 0.35, cs * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Claws (three small lines)
  ctx.strokeStyle = '#1a4a1a';
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(rightArmX + cs * 0.06 + i * cs * 0.05, rightArmY + cs * 0.35);
    ctx.lineTo(rightArmX + cs * 0.06 + i * cs * 0.06, rightArmY + cs * 0.43);
    ctx.stroke();
  }

  // Bicep "pump" vein lines
  ctx.strokeStyle = skinDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftArmX - cs * 0.04, leftArmY - cs * 0.06);
  ctx.bezierCurveTo(
    leftArmX - cs * 0.1,
    leftArmY,
    leftArmX - cs * 0.08,
    leftArmY + cs * 0.08,
    leftArmX,
    leftArmY + cs * 0.12,
  );
  ctx.stroke();

  // Head
  const headY = cy - cs * 0.38 + bodyBob;
  const headX = cx + facingX * cs * 0.08;

  // Neck
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(cx, headY + cs * 0.14, cs * 0.16, cs * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head base (rounded rectangle-ish)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(headX, headY, cs * 0.28, cs * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lizard crest / frill (spiky ridge on top of head)
  ctx.fillStyle = scaleColor;
  for (let i = -2; i <= 2; i++) {
    const spineX = headX + i * cs * 0.07;
    const spineBaseY = headY - cs * 0.14;
    const spineH = cs * (0.1 + Math.abs(i) * 0.02);
    ctx.beginPath();
    ctx.moveTo(spineX - cs * 0.025, spineBaseY);
    ctx.lineTo(spineX + cs * 0.025, spineBaseY);
    ctx.lineTo(spineX, spineBaseY - spineH);
    ctx.closePath();
    ctx.fill();
  }

  // Snout (elongated, facing direction)
  ctx.fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(
    headX + facingX * cs * 0.2,
    headY + cs * 0.06,
    cs * 0.16,
    cs * 0.1,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(
    headX + facingX * cs * 0.2,
    headY + cs * 0.04,
    cs * 0.13,
    cs * 0.08,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Nostrils
  ctx.fillStyle = '#1a3a1a';
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.27, headY + cs * 0.03, cs * 0.015, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.27, headY + cs * 0.06, cs * 0.015, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyeOffX = cs * 0.1;
  const eyeY = headY - cs * 0.04;
  if (facingY > 0.5) {
    // Facing away — no eyes visible
  } else {
    ctx.fillStyle = eyeWhite;
    ctx.beginPath();
    ctx.ellipse(headX - eyeOffX, eyeY, cs * 0.075, cs * 0.065, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headX + eyeOffX, eyeY, cs * 0.075, cs * 0.065, 0, 0, Math.PI * 2);
    ctx.fill();

    // Slit pupils (vertical slits like a reptile)
    ctx.fillStyle = pupilColor;
    ctx.beginPath();
    ctx.ellipse(
      headX - eyeOffX + facingX * cs * 0.02,
      eyeY,
      cs * 0.02,
      cs * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      headX + eyeOffX + facingX * cs * 0.02,
      eyeY,
      cs * 0.02,
      cs * 0.05,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Eyebrow ridges (heavy brow for mean look)
    ctx.strokeStyle = scaleColor;
    ctx.lineWidth = cs * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX - eyeOffX - cs * 0.065, eyeY - cs * 0.055);
    ctx.lineTo(headX - eyeOffX + cs * 0.045, eyeY - cs * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX + eyeOffX - cs * 0.045, eyeY - cs * 0.07);
    ctx.lineTo(headX + eyeOffX + cs * 0.065, eyeY - cs * 0.055);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Teeth / jaw line
  ctx.strokeStyle = '#c8b87a';
  ctx.lineWidth = cs * 0.02;
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.18, headY + cs * 0.06, cs * 0.1, 0.15, Math.PI - 0.15);
  ctx.stroke();

  // Held dumbbell (on right hand)
  if (heldDumbbell) {
    const handX = rightArmX + cs * 0.06;
    const handY = rightArmY + cs * 0.35;
    drawDumbbellHeld(ctx, handX, handY, s, throwAnim);
  }

  // Enrage glow
  if (isEnraged) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(Date.now() / 180);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + bodyBob * 0.5, cs * 0.55, cs * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Render the thrown dumbbell projectile as it flies through the air.
 * Also draws a motion-blur trail.
 */
export function drawThrownDumbbell(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  camX: number,
  camY: number,
  s: number,
  vx: number,
  vy: number,
): void {
  const sx = wx - camX;
  const sy = wy - camY;

  // Motion trail
  const speed = Math.hypot(vx, vy);
  if (speed > 0.5) {
    const nx = vx / speed;
    const ny = vy / speed;
    for (let i = 1; i <= 4; i++) {
      const tx = sx - nx * i * s * 0.14;
      const ty = sy - ny * i * s * 0.14;
      ctx.save();
      ctx.globalAlpha = (0.15 * (5 - i)) / 4;
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(tx, ty, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Rotating dumbbell (spin by time)
  const angle = Date.now() * 0.015;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  drawDumbbellHeld(ctx, 0, 0, s * 0.8, 0.5);
  ctx.restore();
}

/**
 * Render a speech bubble with the Juicer's taunt above his head.
 */
export function drawJuicerSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  text: string,
  pulse: number,
): void {
  const scale = 1.6;
  const cs = s * scale;
  const cx = sx + s * 0.5;
  const bubbleY = sy - cs * 0.35;

  ctx.save();
  ctx.font = 'bold 9px monospace';
  const textWidth = ctx.measureText(text).width;
  const padX = 8;
  const bw = textWidth + padX * 2;
  const bh = 18;
  const bx = cx - bw * 0.5;
  const by = bubbleY - bh - 2;

  const alpha = 0.85 + 0.1 * Math.sin(pulse * 0.1);
  ctx.globalAlpha = alpha;

  // Bubble background
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 5) : ctx.fillRect(bx, by, bw, bh);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 5) : ctx.strokeRect(bx, by, bw, bh);
  ctx.stroke();

  // Tail pointing down toward head
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh);
  ctx.lineTo(cx + 4, by + bh);
  ctx.lineTo(cx, bubbleY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.moveTo(cx + 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by + bh * 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.restore();
}
