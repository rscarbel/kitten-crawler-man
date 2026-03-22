/**
 * Sprites for the three-stage Brindle Grub lifecycle:
 *   Stage 1 — Brindle Grub: small pale segmented worm
 *   Stage 2 — Cow-Tailed Brindle Grub: larger, brindle-spotted, sharp tail
 *   Stage 3 — Brindled Vespa: hornet that spits acid globs
 */

// ---------------------------------------------------------------------------
// Stage 1 — Brindle Grub
// ---------------------------------------------------------------------------

export function drawBrindleGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.68;
  const w = s * 0.18; // segment half-width
  const bob = isMoving ? Math.sin(walkFrame * 0.25) * s * 0.04 : 0;

  const bodyCol = '#e8d9a0';
  const bodyDark = '#c2a96a';
  const brindleCol = '#8a6630';
  const eyeCol = '#1a1008';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.07, s * 0.22, s * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3 body segments drawn back-to-front
  const segOffsets = [-s * 0.19, 0, s * 0.17];
  // slight S-curve wiggle
  const wiggle = isMoving ? Math.sin(walkFrame * 0.3) * s * 0.04 : 0;
  for (let i = 2; i >= 0; i--) {
    const ox = segOffsets[i];
    const oy = i === 1 ? bob : i === 0 ? bob * 0.5 - wiggle * 0.4 : wiggle * 0.3;
    const radius = i === 2 ? w * 0.8 : i === 1 ? w : w * 0.9; // head slightly smaller

    ctx.fillStyle = bodyCol;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, radius, radius * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();

    // Brindle streak
    ctx.strokeStyle = brindleCol;
    ctx.lineWidth = s * 0.018;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(cx + ox - radius * 0.5, cy + oy - radius * 0.2);
    ctx.lineTo(cx + ox + radius * 0.35, cy + oy + radius * 0.25);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Segment outline
    ctx.strokeStyle = bodyDark;
    ctx.lineWidth = s * 0.022;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, radius, radius * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Head details — front segment (index 0)
  const hox = segOffsets[0];
  const hoy = bob * 0.5 - wiggle * 0.4;
  // Eyes
  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.arc(cx + hox - w * 0.38, cy + hoy - w * 0.32, s * 0.026, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + hox + w * 0.38, cy + hoy - w * 0.32, s * 0.026, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx + hox - w * 0.3, cy + hoy - w * 0.42, s * 0.009, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + hox + w * 0.46, cy + hoy - w * 0.42, s * 0.009, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Stage 2 — Cow-Tailed Brindle Grub
// ---------------------------------------------------------------------------

export function drawCowTailedGrubSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.64;
  const bob = isMoving ? Math.sin(walkFrame * 0.25) * s * 0.05 : 0;
  const wiggle = isMoving ? Math.sin(walkFrame * 0.28) * s * 0.05 : 0;

  const bodyCol = '#c9a04a';
  const bodyDark = '#8a6020';
  const bodyLight = '#e0c070';
  const brindleCol = '#4a2e08';
  const tailCol = '#7a3010';
  const eyeCol = '#1a0a00';
  const legCol = '#8a6020';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.11, s * 0.3, s * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail spike (drawn first, behind body)
  const tailBaseX = cx + s * 0.26;
  const tailBaseY = cy + bob * 0.3;
  const tailTipX = tailBaseX + s * 0.22;
  const tailTipY = tailBaseY - s * 0.12;
  ctx.strokeStyle = tailCol;
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tailBaseX, tailBaseY);
  ctx.quadraticCurveTo(tailBaseX + s * 0.1, tailBaseY + s * 0.06, tailTipX, tailTipY);
  ctx.stroke();
  // Spike tip
  ctx.fillStyle = tailCol;
  ctx.beginPath();
  ctx.moveTo(tailTipX, tailTipY);
  ctx.lineTo(tailTipX + s * 0.1, tailTipY + s * 0.03);
  ctx.lineTo(tailTipX - s * 0.02, tailTipY + s * 0.1);
  ctx.closePath();
  ctx.fill();

  // 4 segments
  const segOffsets = [-s * 0.22, -s * 0.06, s * 0.1, s * 0.23];
  const segScales = [0.95, 1.1, 1.0, 0.8];
  const w = s * 0.2;
  for (let i = 3; i >= 0; i--) {
    const ox = segOffsets[i];
    let oy = 0;
    if (i === 0) oy = -wiggle * 0.6 + bob * 0.5;
    else if (i === 1) oy = bob;
    else if (i === 2) oy = wiggle * 0.3 + bob * 0.6;
    else oy = bob * 0.3;

    const rw = w * segScales[i];
    const rh = rw * 0.72;

    // Body
    ctx.fillStyle = bodyCol;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
    // Light belly
    ctx.fillStyle = bodyLight;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy + rh * 0.28, rw * 0.6, rh * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Brindle spots
    ctx.fillStyle = brindleCol;
    ctx.globalAlpha = 0.45;
    for (let d = 0; d < 2; d++) {
      ctx.beginPath();
      ctx.ellipse(
        cx + ox + (d === 0 ? -rw * 0.28 : rw * 0.18),
        cy + oy - rh * 0.15,
        rw * 0.22,
        rh * 0.28,
        d === 0 ? -0.4 : 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Outline
    ctx.strokeStyle = bodyDark;
    ctx.lineWidth = s * 0.025;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rw, rh, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Stubby legs under segments 1 and 2
  ctx.strokeStyle = legCol;
  ctx.lineWidth = s * 0.04;
  ctx.lineCap = 'round';
  for (const legX of [cx + segOffsets[1], cx + segOffsets[2]]) {
    const lyBase = cy + bob + s * 0.1;
    ctx.beginPath();
    ctx.moveTo(legX - s * 0.12, lyBase - s * 0.04);
    ctx.lineTo(legX - s * 0.19, lyBase + s * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(legX + s * 0.12, lyBase - s * 0.04);
    ctx.lineTo(legX + s * 0.19, lyBase + s * 0.07);
    ctx.stroke();
  }

  // Head (front segment)
  const hox = segOffsets[0];
  const hoy = -wiggle * 0.6 + bob * 0.5;
  // Eyes
  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.arc(cx + hox - s * 0.12, cy + hoy - s * 0.1, s * 0.033, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + hox + s * 0.12, cy + hoy - s * 0.1, s * 0.033, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx + hox - s * 0.08, cy + hoy - s * 0.135, s * 0.01, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + hox + s * 0.16, cy + hoy - s * 0.135, s * 0.01, 0, Math.PI * 2);
  ctx.fill();
  // Mandible nubs
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.arc(cx + hox - s * 0.17, cy + hoy + s * 0.02, s * 0.028, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + hox + s * 0.17, cy + hoy + s * 0.02, s * 0.028, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Stage 3 — Brindled Vespa
// ---------------------------------------------------------------------------

export function drawBrindledVespaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
): void {
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.55;

  // Hover bob (always oscillates even when still)
  const hoverT = performance.now() / 1000;
  const hoverBob = Math.sin(hoverT * 4.5) * s * 0.04;
  void isMoving;
  void walkFrame;

  // Wing flutter phase
  const wingFlap = Math.sin(hoverT * 22) * 0.35; // fast flutter

  const thoraxCol = '#4a3010';
  const thoraxLight = '#6a4820';
  const abdYellow = '#d4a010';
  const abdBlack = '#1a1008';
  const abdBrindle = '#7a3808';
  const wingCol = 'rgba(200,160,60,0.38)';
  const wingEdge = 'rgba(160,110,20,0.6)';
  const eyeCol = '#3a1800';
  const eyeShine = 'rgba(80,200,80,0.85)'; // eerie green compound eye glow
  const mandibleCol = '#2a1808';
  const acidCol = '#a8e040';

  const bodyY = cy + hoverBob;

  ctx.save();
  // Flip for left-facing
  const flipped = facingX < -0.3;
  if (flipped) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.2, s * 0.28, s * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- Wings (behind body) ---
  const wingBaseX = cx;
  const wingBaseY = bodyY - s * 0.06;

  // Upper wings
  ctx.save();
  ctx.translate(wingBaseX, wingBaseY);
  ctx.rotate(-wingFlap);
  ctx.fillStyle = wingCol;
  ctx.strokeStyle = wingEdge;
  ctx.lineWidth = s * 0.018;
  // Right upper wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(s * 0.12, -s * 0.32, s * 0.38, -s * 0.28, s * 0.34, -s * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(wingBaseX, wingBaseY);
  ctx.rotate(wingFlap);
  ctx.fillStyle = wingCol;
  ctx.strokeStyle = wingEdge;
  ctx.lineWidth = s * 0.018;
  // Left upper wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-s * 0.12, -s * 0.32, -s * 0.38, -s * 0.28, -s * 0.34, -s * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Lower wings (smaller, angled down)
  ctx.save();
  ctx.translate(wingBaseX, wingBaseY + s * 0.1);
  ctx.rotate(-wingFlap * 0.7 - 0.15);
  ctx.fillStyle = 'rgba(190,150,40,0.28)';
  ctx.strokeStyle = wingEdge;
  ctx.lineWidth = s * 0.014;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(s * 0.1, -s * 0.18, s * 0.28, -s * 0.12, s * 0.22, s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(wingBaseX, wingBaseY + s * 0.1);
  ctx.rotate(wingFlap * 0.7 + 0.15);
  ctx.fillStyle = 'rgba(190,150,40,0.28)';
  ctx.strokeStyle = wingEdge;
  ctx.lineWidth = s * 0.014;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-s * 0.1, -s * 0.18, -s * 0.28, -s * 0.12, -s * 0.22, s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- Abdomen (striped, hangs behind thorax) ---
  const abdCx = cx + s * 0.1;
  const abdCy = bodyY + s * 0.14;
  const abdW = s * 0.17;
  const abdH = s * 0.28;

  // Abdomen base
  ctx.fillStyle = abdYellow;
  ctx.beginPath();
  ctx.ellipse(abdCx, abdCy, abdW, abdH, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Black stripes
  ctx.fillStyle = abdBlack;
  ctx.globalAlpha = 0.85;
  for (let b = 0; b < 3; b++) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      abdCx,
      abdCy - abdH * 0.3 + b * abdH * 0.28,
      abdW * 0.95,
      abdH * 0.1,
      0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Brindle patches
  ctx.fillStyle = abdBrindle;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(
    abdCx + abdW * 0.3,
    abdCy - abdH * 0.15,
    abdW * 0.38,
    abdH * 0.18,
    0.6,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    abdCx - abdW * 0.2,
    abdCy + abdH * 0.1,
    abdW * 0.3,
    abdH * 0.14,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  // Abdomen outline
  ctx.strokeStyle = abdBlack;
  ctx.lineWidth = s * 0.028;
  ctx.beginPath();
  ctx.ellipse(abdCx, abdCy, abdW, abdH, 0.3, 0, Math.PI * 2);
  ctx.stroke();

  // Stinger tip
  ctx.fillStyle = '#8a6020';
  ctx.beginPath();
  ctx.moveTo(abdCx + s * 0.18, abdCy + abdH * 0.8);
  ctx.lineTo(abdCx + s * 0.28, abdCy + abdH * 1.05);
  ctx.lineTo(abdCx + s * 0.06, abdCy + abdH * 0.88);
  ctx.closePath();
  ctx.fill();

  // --- Thorax ---
  ctx.fillStyle = thoraxCol;
  ctx.beginPath();
  ctx.ellipse(cx, bodyY, s * 0.22, s * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  // Thorax highlight
  ctx.fillStyle = thoraxLight;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.05, bodyY - s * 0.06, s * 0.12, s * 0.08, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = abdBlack;
  ctx.lineWidth = s * 0.025;
  ctx.beginPath();
  ctx.ellipse(cx, bodyY, s * 0.22, s * 0.19, 0, 0, Math.PI * 2);
  ctx.stroke();

  // --- Head ---
  const headCx = cx - s * 0.2;
  const headCy = bodyY - s * 0.05;
  ctx.fillStyle = thoraxCol;
  ctx.beginPath();
  ctx.ellipse(headCx, headCy, s * 0.17, s * 0.15, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = abdBlack;
  ctx.lineWidth = s * 0.022;
  ctx.beginPath();
  ctx.ellipse(headCx, headCy, s * 0.17, s * 0.15, -0.2, 0, Math.PI * 2);
  ctx.stroke();

  // Compound eyes
  ctx.fillStyle = eyeCol;
  ctx.beginPath();
  ctx.ellipse(headCx - s * 0.09, headCy - s * 0.06, s * 0.07, s * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Green glow on eyes
  ctx.fillStyle = eyeShine;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(headCx - s * 0.09, headCy - s * 0.06, s * 0.04, s * 0.065, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Mandibles
  ctx.strokeStyle = mandibleCol;
  ctx.lineWidth = s * 0.04;
  ctx.lineCap = 'round';
  // Upper mandible
  ctx.beginPath();
  ctx.moveTo(headCx - s * 0.16, headCy + s * 0.04);
  ctx.lineTo(headCx - s * 0.28, headCy + s * 0.0);
  ctx.stroke();
  // Lower mandible
  ctx.beginPath();
  ctx.moveTo(headCx - s * 0.16, headCy + s * 0.07);
  ctx.lineTo(headCx - s * 0.28, headCy + s * 0.12);
  ctx.stroke();

  // Acid drip from mandibles
  const acidPulse = (Math.sin(hoverT * 3.5) + 1) * 0.5; // 0–1
  if (acidPulse > 0.3) {
    ctx.fillStyle = acidCol;
    ctx.globalAlpha = acidPulse * 0.9;
    ctx.beginPath();
    ctx.arc(headCx - s * 0.3, headCy + s * 0.18, s * 0.03 * acidPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Antennae
  ctx.strokeStyle = thoraxLight;
  ctx.lineWidth = s * 0.022;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(headCx - s * 0.06, headCy - s * 0.12);
  ctx.quadraticCurveTo(headCx - s * 0.04, headCy - s * 0.3, headCx + s * 0.06, headCy - s * 0.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(headCx - s * 0.0, headCy - s * 0.11);
  ctx.quadraticCurveTo(headCx + s * 0.08, headCy - s * 0.27, headCx + s * 0.18, headCy - s * 0.32);
  ctx.stroke();
  // Antenna tips
  ctx.fillStyle = abdYellow;
  ctx.beginPath();
  ctx.arc(headCx + s * 0.06, headCy - s * 0.38, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headCx + s * 0.18, headCy - s * 0.32, s * 0.022, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Acid spit projectile
// ---------------------------------------------------------------------------

export function drawAcidSpit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hit: boolean,
): void {
  const t = performance.now() / 1000;
  const pulse = 1 + Math.sin(t * 12) * 0.15;

  if (hit) {
    // Splat on hit
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#a8e040';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.save();
  // Outer glow
  const grd = ctx.createRadialGradient(sx, sy, 1, sx, sy, 8 * pulse);
  grd.addColorStop(0, 'rgba(180,240,60,0.55)');
  grd.addColorStop(1, 'rgba(80,180,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, sy, 8 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // Core glob
  ctx.fillStyle = '#c8f050';
  ctx.beginPath();
  ctx.arc(sx, sy, 4 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,200,0.8)';
  ctx.beginPath();
  ctx.arc(sx - 1.2, sy - 1.4, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
