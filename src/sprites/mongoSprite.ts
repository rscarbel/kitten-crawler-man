/**
 * Draw Mongo — a blue velociraptor with pink feathers on his head, arms,
 * and the tip of his tail.
 *
 * @param ctx        Canvas rendering context
 * @param sx         Screen X (top-left of tile)
 * @param sy         Screen Y (top-left of tile)
 * @param s          Base tile size in pixels (32px)
 * @param walkFrame  Continuous frame counter for walk animation
 * @param isMoving   True when actively moving
 * @param facingX    Horizontal facing direction component
 * @param facingY    Vertical facing direction component
 * @param attackAmt  0–1 bite animation progress
 * @param scale      Visual size multiplier (0.7 small, 1.0 medium, 1.5 large)
 */
export function drawMongoSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
  _facingY = 0,
  attackAmt = 0,
  scale = 1.0,
): void {
  const cs = s * scale;
  const cx = sx + s * 0.5;

  // Animation values
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * cs * 0.04 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.12 : 0;
  const armSway = isMoving ? -Math.sin(walkFrame) * cs * 0.04 : 0;
  const tailSway = Math.sin((isMoving ? walkFrame : Date.now() * 0.003) * 0.7) * cs * 0.08;

  // Bite lunge: head thrusts forward
  const biteLunge = attackAmt * cs * 0.14;

  // Colors — lighter blue body, pink feathers
  const bodyBlue = '#60a5fa';
  const bodyDark = '#3b82f6';
  const bodyLight = '#93c5fd';
  const bellyCol = '#bfdbfe';
  const featherPink = '#ec4899';
  const featherLight = '#f472b6';
  const clawCol = '#d4d4d4';
  const eyeCol = '#fbbf24';
  const pupilCol = '#1c1917';
  const toothCol = '#e5e5e5';

  // === HORIZONTAL RAPTOR LAYOUT ===
  // Body center is roughly at tile center, tilted forward
  const ground = sy + s * 0.96;
  const bodyCy = ground - cs * 0.42 + bodyBob; // body center height
  const bodyCx = cx - cs * 0.02; // body center slightly back to leave room for head

  ctx.save();

  // Flip for left-facing
  const flipped = facingX < -0.3;
  if (flipped) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // Shadow (wider for horizontal body)
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + cs * 0.03, cs * 0.38, cs * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // === TAIL === (extends back from body, held stiff and horizontal for balance)
  const tailBaseX = bodyCx - cs * 0.28;
  const tailBaseY = bodyCy + cs * 0.02;
  const tailMidX = tailBaseX - cs * 0.28 + tailSway * 0.4;
  const tailMidY = bodyCy + cs * 0.0;
  const tailEndX = tailBaseX - cs * 0.5 + tailSway;
  const tailEndY = bodyCy + cs * 0.04;

  ctx.strokeStyle = bodyDark;
  ctx.lineWidth = cs * 0.13;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tailBaseX, tailBaseY);
  ctx.quadraticCurveTo(tailMidX, tailMidY, tailEndX, tailEndY);
  ctx.stroke();
  // Thinner overlay for body color
  ctx.strokeStyle = bodyBlue;
  ctx.lineWidth = cs * 0.09;
  ctx.beginPath();
  ctx.moveTo(tailBaseX, tailBaseY);
  ctx.quadraticCurveTo(tailMidX, tailMidY, tailEndX, tailEndY);
  ctx.stroke();

  // Tail tip — pink feathers
  ctx.strokeStyle = featherPink;
  ctx.lineWidth = cs * 0.08;
  ctx.beginPath();
  ctx.moveTo(tailEndX + cs * 0.02, tailEndY);
  ctx.quadraticCurveTo(
    tailEndX - cs * 0.08 + tailSway * 0.3,
    tailEndY - cs * 0.04,
    tailEndX - cs * 0.14 + tailSway * 0.4,
    tailEndY + cs * 0.02,
  );
  ctx.stroke();
  // Extra feather wisps
  ctx.strokeStyle = featherLight;
  ctx.lineWidth = cs * 0.035;
  ctx.beginPath();
  ctx.moveTo(tailEndX, tailEndY - cs * 0.02);
  ctx.lineTo(tailEndX - cs * 0.1 + tailSway * 0.3, tailEndY - cs * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tailEndX, tailEndY + cs * 0.03);
  ctx.lineTo(tailEndX - cs * 0.1 + tailSway * 0.3, tailEndY + cs * 0.1);
  ctx.stroke();

  // === LEGS === (digitigrade, under the body)
  const drawLeg = (hipOffsetX: number, swing: number) => {
    const hipX = bodyCx + hipOffsetX;
    const hipY = bodyCy + cs * 0.1;
    // Upper leg (thigh) — angled back
    const kneeX = hipX + swing * 0.4 - cs * 0.02;
    const kneeY = hipY + cs * 0.2;
    // Lower leg (shin) — angled forward (digitigrade)
    const ankleX = kneeX + cs * 0.04 + swing * 0.2;
    const ankleY = ground - cs * 0.08;
    // Foot — flat forward
    const footX = ankleX + cs * 0.1;
    const footY = ground;

    // Upper leg
    ctx.strokeStyle = bodyDark;
    ctx.lineWidth = cs * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(kneeX, kneeY);
    ctx.stroke();

    // Lower leg
    ctx.strokeStyle = bodyBlue;
    ctx.lineWidth = cs * 0.08;
    ctx.beginPath();
    ctx.moveTo(kneeX, kneeY);
    ctx.lineTo(ankleX, ankleY);
    ctx.stroke();

    // Foot
    ctx.strokeStyle = bodyDark;
    ctx.lineWidth = cs * 0.05;
    ctx.beginPath();
    ctx.moveTo(ankleX, ankleY);
    ctx.lineTo(footX, footY);
    ctx.stroke();

    // Toe claws (3 toes forward)
    ctx.fillStyle = clawCol;
    for (let t = -1; t <= 1; t++) {
      ctx.beginPath();
      ctx.moveTo(footX, footY);
      ctx.lineTo(footX + cs * 0.06, footY - cs * 0.01 + t * cs * 0.03);
      ctx.lineTo(footX + cs * 0.04, footY - cs * 0.03 + t * cs * 0.02);
      ctx.closePath();
      ctx.fill();
    }

    // Raptor sickle claw (raised, iconic)
    ctx.fillStyle = '#b0b0b0';
    ctx.beginPath();
    ctx.moveTo(ankleX - cs * 0.01, ankleY);
    ctx.lineTo(ankleX + cs * 0.02, ankleY - cs * 0.09);
    ctx.lineTo(ankleX + cs * 0.05, ankleY - cs * 0.01);
    ctx.closePath();
    ctx.fill();
  };

  drawLeg(-cs * 0.08, -legSwing);
  drawLeg(cs * 0.1, legSwing);

  // === BODY === (horizontal elongated torso, tilted slightly forward)
  ctx.fillStyle = bodyBlue;
  ctx.beginPath();
  ctx.ellipse(bodyCx, bodyCy, cs * 0.3, cs * 0.16, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // Belly (lighter underside)
  ctx.fillStyle = bellyCol;
  ctx.beginPath();
  ctx.ellipse(bodyCx + cs * 0.04, bodyCy + cs * 0.06, cs * 0.18, cs * 0.07, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // === ARMS === (small raptor forelimbs, tucked near chest)
  const shoulderX = bodyCx + cs * 0.18;
  const shoulderY = bodyCy - cs * 0.02;
  const elbowX = shoulderX + cs * 0.06 + armSway;
  const elbowY = shoulderY + cs * 0.1;
  const handX = elbowX + cs * 0.02 + armSway * 0.5;
  const handY = elbowY + cs * 0.07 + attackAmt * cs * 0.06;

  // Arm
  ctx.strokeStyle = bodyDark;
  ctx.lineWidth = cs * 0.055;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // Clawed fingers
  ctx.fillStyle = clawCol;
  for (let c = 0; c < 2; c++) {
    const angle = 0.3 + c * 0.6;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + Math.cos(angle) * cs * 0.05, handY + Math.sin(angle) * cs * 0.05);
    ctx.lineTo(
      handX + Math.cos(angle + 0.3) * cs * 0.03,
      handY + Math.sin(angle + 0.3) * cs * 0.03,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Pink feathers on forearm
  ctx.strokeStyle = featherPink;
  ctx.lineWidth = cs * 0.03;
  for (let f = 0; f < 3; f++) {
    const t = 0.2 + f * 0.3;
    const fx = elbowX + (handX - elbowX) * t;
    const fy = elbowY + (handY - elbowY) * t;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + cs * 0.04, fy + cs * 0.06);
    ctx.stroke();
  }

  // === NECK === (curves forward and slightly up from front of body)
  const neckBaseX = bodyCx + cs * 0.22;
  const neckBaseY = bodyCy - cs * 0.06;
  const neckTopX = neckBaseX + cs * 0.14 + biteLunge * 0.4;
  const neckTopY = bodyCy - cs * 0.24 + bodyBob;

  ctx.strokeStyle = bodyBlue;
  ctx.lineWidth = cs * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(neckBaseX, neckBaseY);
  ctx.quadraticCurveTo(
    neckBaseX + cs * 0.16 + biteLunge * 0.2,
    neckBaseY - cs * 0.06,
    neckTopX,
    neckTopY,
  );
  ctx.stroke();

  // === HEAD === (elongated raptor skull, held forward)
  const headX = neckTopX + cs * 0.06 + biteLunge * 0.6;
  const headY = neckTopY - cs * 0.02;
  const headWR = cs * 0.18;
  const headHR = cs * 0.11;

  // Main head shape
  ctx.fillStyle = bodyBlue;
  ctx.beginPath();
  ctx.ellipse(headX, headY, headWR, headHR, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Snout (extends forward, narrower)
  ctx.fillStyle = bodyLight;
  ctx.beginPath();
  ctx.ellipse(
    headX + headWR * 0.75,
    headY + headHR * 0.15,
    headWR * 0.5,
    headHR * 0.55,
    0.1,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Mouth / jaw line
  const jawOpen = attackAmt * cs * 0.05;
  ctx.strokeStyle = bodyDark;
  ctx.lineWidth = cs * 0.02;
  ctx.beginPath();
  ctx.moveTo(headX + headWR * 0.2, headY + headHR * 0.5);
  ctx.lineTo(headX + headWR * 1.15, headY + headHR * 0.2 + jawOpen);
  ctx.stroke();

  // Teeth (visible during bite)
  if (attackAmt > 0.1) {
    ctx.fillStyle = toothCol;
    const teethY = headY + headHR * 0.35;
    for (let t = 0; t < 4; t++) {
      const tx = headX + headWR * 0.35 + t * cs * 0.035;
      ctx.beginPath();
      ctx.moveTo(tx - cs * 0.012, teethY);
      ctx.lineTo(tx, teethY + cs * 0.035 * attackAmt);
      ctx.lineTo(tx + cs * 0.012, teethY);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Eye
  const eyeX = headX + headWR * 0.1;
  const eyeY = headY - headHR * 0.35;
  const eyeR = cs * 0.05;

  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Slit pupil
  ctx.fillStyle = pupilCol;
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, eyeR * 0.28, eyeR * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // === HEAD FEATHERS (pink crest sweeping back from top of head) ===
  ctx.strokeStyle = featherPink;
  ctx.lineWidth = cs * 0.035;
  ctx.lineCap = 'round';
  const crestBaseX = headX - cs * 0.02;
  const crestBaseY = headY - headHR * 1.0;
  for (let f = 0; f < 5; f++) {
    const angle = -2.2 + f * 0.25; // sweep backward
    const len = cs * (0.08 + f * 0.02);
    const sway = Math.sin(Date.now() * 0.004 + f * 0.8) * cs * 0.012;
    ctx.beginPath();
    ctx.moveTo(crestBaseX + f * cs * 0.03, crestBaseY);
    ctx.lineTo(
      crestBaseX + f * cs * 0.03 + Math.cos(angle) * len + sway,
      crestBaseY + Math.sin(angle) * len,
    );
    ctx.stroke();
  }
  // Lighter highlights on crest
  ctx.strokeStyle = featherLight;
  ctx.lineWidth = cs * 0.02;
  for (let f = 0; f < 3; f++) {
    const angle = -2.1 + f * 0.3;
    const len = cs * (0.06 + f * 0.018);
    ctx.beginPath();
    ctx.moveTo(crestBaseX + cs * 0.015 + f * cs * 0.03, crestBaseY + cs * 0.008);
    ctx.lineTo(
      crestBaseX + cs * 0.015 + f * cs * 0.03 + Math.cos(angle) * len,
      crestBaseY + cs * 0.008 + Math.sin(angle) * len,
    );
    ctx.stroke();
  }

  // Nostril
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.ellipse(
    headX + headWR * 0.9,
    headY - headHR * 0.05,
    cs * 0.018,
    cs * 0.012,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}

/**
 * Draw the raptor icon for the Summon button (small, simplified).
 */
export function drawMongoIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const r = size * 0.4;

  // Raptor silhouette — horizontal predatory stance
  ctx.fillStyle = '#60a5fa';

  // Tail (extends back and slightly down from body)
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy - r * 0.05);
  ctx.quadraticCurveTo(cx - r * 0.65, cy + r * 0.0, cx - r * 0.9, cy + r * 0.15);
  ctx.stroke();

  // Tail feather tip (pink)
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.85, cy + r * 0.13);
  ctx.lineTo(cx - r * 1.0, cy + r * 0.18);
  ctx.stroke();
  // Extra feather wisps
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.88, cy + r * 0.1);
  ctx.lineTo(cx - r * 0.98, cy + r * 0.02);
  ctx.stroke();

  // Legs (digitigrade raptor stance)
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  // Back leg
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.15, cy + r * 0.15);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.45);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.65);
  ctx.stroke();
  // Front leg
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.15, cy + r * 0.15);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.45);
  ctx.lineTo(cx + r * 0.2, cy + r * 0.65);
  ctx.stroke();
  // Claws
  ctx.fillStyle = '#d4d4d4';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.1, cy + r * 0.65);
  ctx.lineTo(cx - r * 0.02, cy + r * 0.65);
  ctx.lineTo(cx - r * 0.06, cy + r * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.2, cy + r * 0.65);
  ctx.lineTo(cx + r * 0.3, cy + r * 0.65);
  ctx.lineTo(cx + r * 0.25, cy + r * 0.58);
  ctx.closePath();
  ctx.fill();

  // Body (horizontal elongated torso)
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.45, r * 0.25, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Belly highlight
  ctx.fillStyle = '#bfdbfe';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.05, cy + r * 0.06, r * 0.22, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small arms (raptor forelimbs with feathers)
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.2, cy - r * 0.05);
  ctx.lineTo(cx + r * 0.32, cy + r * 0.15);
  ctx.stroke();
  // Arm feathers (pink)
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.26, cy + r * 0.05);
  ctx.lineTo(cx + r * 0.38, cy + r * 0.12);
  ctx.stroke();

  // Neck (angled upward from body)
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = r * 0.15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.3, cy - r * 0.08);
  ctx.quadraticCurveTo(cx + r * 0.45, cy - r * 0.25, cx + r * 0.5, cy - r * 0.4);
  ctx.stroke();

  // Head (elongated raptor snout, not round like a bird)
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.55, cy - r * 0.45, r * 0.28, r * 0.16, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Snout / jaw (elongated forward)
  ctx.fillStyle = '#93c5fd';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.75, cy - r * 0.4, r * 0.15, r * 0.09, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Jaw line
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.6, cy - r * 0.35);
  ctx.lineTo(cx + r * 0.88, cy - r * 0.38);
  ctx.stroke();

  // Head crest feathers (pink)
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = r * 0.07;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.48 + i * r * 0.07, cy - r * 0.58);
    ctx.lineTo(cx + r * 0.44 + i * r * 0.06, cy - r * 0.78);
    ctx.stroke();
  }
  // Lighter feather highlights
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.52, cy - r * 0.6);
  ctx.lineTo(cx + r * 0.48, cy - r * 0.75);
  ctx.stroke();

  // Eye
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(cx + r * 0.55, cy - r * 0.5, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Slit pupil
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.55, cy - r * 0.5, r * 0.02, r * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
}
