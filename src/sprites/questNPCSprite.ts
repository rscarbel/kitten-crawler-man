/**
 * Sprites for the defend-NPC quest:
 *  - Goblin mother in a pink dress
 *  - Yellow/green exclamation/question mark
 *  - Small goblin child
 *  - Wood pile pickup
 *  - Wood barrier (with damage states)
 */

// ── Goblin Mother (pink dress, no weapon) ─────────────────────────

export function drawQuestNPCSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  facingX = 1,
) {
  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * 0.5), 0);
  }

  const skinColor = '#4f8a3e';

  // Feet — small shoes
  ctx.fillStyle = '#8b3a62';
  ctx.fillRect(sx + s * 0.3, sy + s * 0.88, s * 0.15, s * 0.06);
  ctx.fillRect(sx + s * 0.55, sy + s * 0.88, s * 0.15, s * 0.06);

  // Pink dress (replaces legs + body)
  ctx.fillStyle = '#e879a0';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.27, sy + s * 0.44);
  ctx.lineTo(sx + s * 0.73, sy + s * 0.44);
  ctx.lineTo(sx + s * 0.78, sy + s * 0.88);
  ctx.lineTo(sx + s * 0.22, sy + s * 0.88);
  ctx.closePath();
  ctx.fill();

  // Dress hem ruffle
  ctx.strokeStyle = '#d4608a';
  ctx.lineWidth = s * 0.02;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const rx = sx + s * (0.24 + i * 0.093);
    const ry = sy + s * 0.87;
    ctx.arc(rx, ry, s * 0.03, 0, Math.PI, false);
  }
  ctx.stroke();

  // Dress belt/sash
  ctx.fillStyle = '#c44d7a';
  ctx.fillRect(sx + s * 0.27, sy + s * 0.56, s * 0.46, s * 0.04);

  // Arms (skin)
  ctx.fillStyle = skinColor;
  ctx.fillRect(sx + s * 0.15, sy + s * 0.46, s * 0.12, s * 0.11);
  ctx.fillRect(sx + s * 0.73, sy + s * 0.46, s * 0.12, s * 0.11);

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.3, s * 0.17, 0, Math.PI * 2);
  ctx.fill();

  // Big pointy left ear
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.34, sy + s * 0.26);
  ctx.lineTo(sx + s * 0.17, sy + s * 0.11);
  ctx.lineTo(sx + s * 0.39, sy + s * 0.19);
  ctx.fill();

  // Big pointy right ear
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.66, sy + s * 0.26);
  ctx.lineTo(sx + s * 0.83, sy + s * 0.11);
  ctx.lineTo(sx + s * 0.61, sy + s * 0.19);
  ctx.fill();

  // Snout
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.335, s * 0.065, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(sx + s * 0.463, sy + s * 0.343, s * 0.016, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.537, sy + s * 0.343, s * 0.016, 0, Math.PI * 2);
  ctx.fill();

  // Eyes — friendly, slightly larger
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(sx + s * 0.415, sy + s * 0.275, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.585, sy + s * 0.275, s * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(sx + s * 0.415, sy + s * 0.275, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.585, sy + s * 0.275, s * 0.022, 0, Math.PI * 2);
  ctx.fill();

  // Eye highlights
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sx + s * 0.405, sy + s * 0.265, s * 0.01, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.575, sy + s * 0.265, s * 0.01, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Exclamation / Question Mark ───────────────────────────────────

export function drawExclamationMark(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  color: string,
) {
  const t = performance.now() / 1000;
  const bounce = Math.sin(t * 3) * s * 0.04;
  const cx = sx + s * 0.5;
  const baseY = sy - s * 0.15 + bounce;
  const isQuestion = color === '#4ade80';

  ctx.save();
  ctx.font = `bold ${Math.floor(s * 0.45)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const glyph = isQuestion ? '?' : '!';

  // Black outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(glyph, cx, baseY);

  // Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(glyph, cx, baseY);

  // Second pass for brightness
  ctx.shadowBlur = 3;
  ctx.fillText(glyph, cx, baseY);

  ctx.restore();
}

// ── Small Goblin Child ────────────────────────────────────────────

export function drawChildSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
) {
  // Child is ~60% the size of an adult goblin, drawn at center-bottom of tile
  const cs = s * 0.6;
  const ox = sx + (s - cs) * 0.5;
  const oy = sy + s - cs;
  const bob = isMoving ? -Math.abs(Math.sin(walkFrame)) * cs * 0.04 : 0;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(ox + cs * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(ox + cs * 0.5), 0);
  }

  const skinColor = '#5ca84e';

  // Tiny feet
  ctx.fillStyle = '#2d1b00';
  ctx.fillRect(ox + cs * 0.3, oy + cs * 0.88 + bob, cs * 0.14, cs * 0.06);
  ctx.fillRect(ox + cs * 0.56, oy + cs * 0.88 + bob, cs * 0.14, cs * 0.06);

  // Simple tunic (blue)
  ctx.fillStyle = '#6488c8';
  ctx.fillRect(ox + cs * 0.28, oy + cs * 0.48 + bob, cs * 0.44, cs * 0.4);

  // Arms
  ctx.fillStyle = skinColor;
  ctx.fillRect(ox + cs * 0.16, oy + cs * 0.5 + bob, cs * 0.12, cs * 0.1);
  ctx.fillRect(ox + cs * 0.72, oy + cs * 0.5 + bob, cs * 0.12, cs * 0.1);

  // Head (proportionally bigger for a child)
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(ox + cs * 0.5, oy + cs * 0.32 + bob, cs * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.moveTo(ox + cs * 0.32, oy + cs * 0.28 + bob);
  ctx.lineTo(ox + cs * 0.18, oy + cs * 0.14 + bob);
  ctx.lineTo(ox + cs * 0.37, oy + cs * 0.21 + bob);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ox + cs * 0.68, oy + cs * 0.28 + bob);
  ctx.lineTo(ox + cs * 0.82, oy + cs * 0.14 + bob);
  ctx.lineTo(ox + cs * 0.63, oy + cs * 0.21 + bob);
  ctx.fill();

  // Eyes (big, cute)
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(ox + cs * 0.4, oy + cs * 0.3 + bob, cs * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ox + cs * 0.6, oy + cs * 0.3 + bob, cs * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(ox + cs * 0.4, oy + cs * 0.3 + bob, cs * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ox + cs * 0.6, oy + cs * 0.3 + bob, cs * 0.025, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Wood Pile (pickup) ────────────────────────────────────────────

export function drawWoodPileSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
) {
  const t = performance.now() / 1000;
  const glow = 0.15 + 0.08 * Math.sin(t * 2.5);

  // Glow ring
  ctx.save();
  ctx.globalAlpha = glow;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.55, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Bottom layer of logs (3 horizontal)
  ctx.fillStyle = '#8b6914';
  for (let i = 0; i < 3; i++) {
    const lx = sx + s * 0.15 + i * s * 0.22;
    ctx.fillRect(lx, sy + s * 0.65, s * 0.2, s * 0.12);
    // End grain circles
    ctx.fillStyle = '#a0782a';
    ctx.beginPath();
    ctx.arc(lx + s * 0.1, sy + s * 0.71, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b6914';
  }

  // Top layer (2 logs, offset)
  ctx.fillStyle = '#9b7924';
  for (let i = 0; i < 2; i++) {
    const lx = sx + s * 0.25 + i * s * 0.25;
    ctx.fillRect(lx, sy + s * 0.54, s * 0.2, s * 0.12);
    ctx.fillStyle = '#b08d34';
    ctx.beginPath();
    ctx.arc(lx + s * 0.1, sy + s * 0.6, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9b7924';
  }

  // Top single log
  ctx.fillStyle = '#a8842e';
  ctx.fillRect(sx + s * 0.32, sy + s * 0.44, s * 0.22, s * 0.11);
  ctx.fillStyle = '#c0993e';
  ctx.beginPath();
  ctx.arc(sx + s * 0.43, sy + s * 0.495, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // "Boards" text
  ctx.fillStyle = '#fbbf24';
  ctx.font = `bold ${Math.floor(s * 0.22)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('WOOD', sx + s * 0.5, sy + s * 0.38);
  ctx.textAlign = 'left';
}

// ── Wood Barrier ──────────────────────────────────────────────────
//
// Damage stages (based on hpFraction):
//   1.0        — pristine boards, nailed cross-beam
//   0.75–1.0   — small hole punched through, a clawed hand reaches up and waves
//   0.5–0.75   — bigger hole, two huge owl-like eyes peer up from the dark below
//   0.25–0.5   — boards buckling outward, wide gaps, eyes + arm, nearly apart
//   0.0–0.25   — splintering apart, about to shatter

export function drawWoodBarrierSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  hpFraction: number,
) {
  const t = performance.now() / 1000;
  const dmg = 1 - hpFraction; // 0 = pristine, 1 = destroyed

  // ── Dark void below the boards (visible through holes) ──
  ctx.fillStyle = '#080810';
  ctx.fillRect(sx + s * 0.08, sy + s * 0.08, s * 0.84, s * 0.84);

  // ── Stage 2+: Eyes peeking up from below (drawn under the boards) ──
  if (dmg > 0.35) {
    const eyeAlpha = Math.min(1, (dmg - 0.35) * 3);
    const eyeShift = Math.sin(t * 1.5) * s * 0.02; // subtle side-to-side
    ctx.save();
    ctx.globalAlpha = eyeAlpha;

    // Eye whites (enormous owl-like, same style as bugaboo)
    ctx.fillStyle = '#e8e8d0';
    ctx.beginPath();
    ctx.ellipse(sx + s * 0.36 + eyeShift, sy + s * 0.52, s * 0.08, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sx + s * 0.64 + eyeShift, sy + s * 0.52, s * 0.08, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark ring outlines
    ctx.strokeStyle = '#0a0a1a';
    ctx.lineWidth = s * 0.015;
    ctx.beginPath();
    ctx.ellipse(sx + s * 0.36 + eyeShift, sy + s * 0.52, s * 0.08, s * 0.09, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sx + s * 0.64 + eyeShift, sy + s * 0.52, s * 0.08, s * 0.09, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Amber irises
    ctx.fillStyle = '#d4a820';
    ctx.beginPath();
    ctx.arc(sx + s * 0.36 + eyeShift, sy + s * 0.53, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + s * 0.64 + eyeShift, sy + s * 0.53, s * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Dark pupils
    ctx.fillStyle = '#0a0a1a';
    ctx.beginPath();
    ctx.arc(sx + s * 0.36 + eyeShift, sy + s * 0.53, s * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + s * 0.64 + eyeShift, sy + s * 0.53, s * 0.025, 0, Math.PI * 2);
    ctx.fill();

    // Ambient glow
    ctx.globalAlpha = eyeAlpha * 0.12;
    ctx.fillStyle = '#d4a820';
    ctx.beginPath();
    ctx.arc(sx + s * 0.36 + eyeShift, sy + s * 0.53, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + s * 0.64 + eyeShift, sy + s * 0.53, s * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ── Stage 1+: Clawed hand reaching up through the hole ──
  if (dmg > 0.15) {
    const handAlpha = Math.min(1, (dmg - 0.15) * 3);
    const wave = Math.sin(t * 3) * s * 0.06; // waving motion
    const reach = Math.sin(t * 1.8) * s * 0.03; // reaching up/down

    ctx.save();
    ctx.globalAlpha = handAlpha;

    // Arm coming up from hole (obsidian-colored like bugaboo body)
    const armX = sx + s * 0.72;
    const armBaseY = sy + s * 0.7;
    const armTopY = sy + s * 0.25 + reach;

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = s * 0.04;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armX, armBaseY);
    ctx.quadraticCurveTo(armX + wave * 0.5, sy + s * 0.45, armX + wave, armTopY);
    ctx.stroke();

    // Tiny claw-hand at the top (3 pointed fingers splayed)
    const handCx = armX + wave;
    const handCy = armTopY;
    ctx.fillStyle = '#1a1a2e';

    // Palm
    ctx.beginPath();
    ctx.arc(handCx, handCy, s * 0.03, 0, Math.PI * 2);
    ctx.fill();

    // Three clawed fingers
    ctx.strokeStyle = '#12122a';
    ctx.lineWidth = s * 0.02;
    for (let f = -1; f <= 1; f++) {
      const angle = -Math.PI / 2 + f * 0.5;
      const fx = handCx + Math.cos(angle) * s * 0.06;
      const fy = handCy + Math.sin(angle) * s * 0.06;
      ctx.beginPath();
      ctx.moveTo(handCx, handCy);
      ctx.lineTo(fx, fy);
      ctx.stroke();

      // Claw tip
      ctx.fillStyle = '#2a2a4e';
      ctx.beginPath();
      ctx.arc(fx, fy, s * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Boards (drawn ON TOP of the creature elements) ──
  const numPlanks = 5;
  const plankW = s / numPlanks;

  // How much boards buckle/offset at high damage
  const buckle = dmg > 0.5 ? (dmg - 0.5) * 2 : 0; // 0–1 range for heavy damage
  const shake = dmg > 0.6 ? Math.sin(t * 12) * s * 0.01 * dmg : 0;

  for (let i = 0; i < numPlanks; i++) {
    const px = sx + i * plankW + shake;

    // At heavy damage, some planks are pushed outward / tilted
    const plankBuckle = buckle * (i === 1 || i === 3 ? 1 : 0.3);
    const offsetY = plankBuckle * s * 0.06 * (i % 2 === 0 ? -1 : 1);
    const tiltAngle = plankBuckle * 0.08 * (i % 2 === 0 ? 1 : -1);

    // At mid-high damage, some planks have gaps (hole in centre)
    const hasHole = dmg > 0.2 && (i === 2 || (dmg > 0.45 && (i === 1 || i === 3)));

    ctx.save();
    if (tiltAngle !== 0) {
      ctx.translate(px + plankW * 0.5, sy + s * 0.5);
      ctx.rotate(tiltAngle);
      ctx.translate(-(px + plankW * 0.5), -(sy + s * 0.5));
    }

    const shade = i % 2 === 0 ? '#8b6914' : '#9b7924';
    ctx.fillStyle = shade;

    if (hasHole) {
      // Draw plank in two halves with a gap
      const holeSize = s * (0.12 + dmg * 0.15);
      const holeCy = sy + s * 0.5;
      // Top half
      ctx.fillRect(
        px + 1,
        sy + s * 0.1 + offsetY,
        plankW - 2,
        holeCy - holeSize / 2 - (sy + s * 0.1),
      );
      // Bottom half
      const botTop = holeCy + holeSize / 2;
      ctx.fillRect(px + 1, botTop + offsetY, plankW - 2, sy + s * 0.9 - botTop);

      // Splintered edges around the hole
      ctx.strokeStyle = '#5c4a10';
      ctx.lineWidth = 1;
      for (let sp = 0; sp < 3; sp++) {
        const spx = px + plankW * (0.2 + sp * 0.3);
        const spy = holeCy - holeSize / 2 + offsetY;
        ctx.beginPath();
        ctx.moveTo(spx, spy);
        ctx.lineTo(spx + s * 0.01, spy + s * 0.03);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(spx, holeCy + holeSize / 2 + offsetY);
        ctx.lineTo(spx - s * 0.01, holeCy + holeSize / 2 + offsetY - s * 0.03);
        ctx.stroke();
      }
    } else {
      // Full plank
      ctx.fillRect(px + 1, sy + s * 0.1 + offsetY, plankW - 2, s * 0.8);
    }

    // Wood grain lines
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + plankW * 0.3, sy + s * 0.15 + offsetY);
    ctx.lineTo(px + plankW * 0.4, sy + s * 0.85 + offsetY);
    ctx.stroke();

    ctx.restore();
  }

  // ── Cross-beam (cracks at high damage) ──
  if (dmg < 0.85) {
    ctx.fillStyle = '#7a5c12';
    const beamY = sy + s * 0.38 + shake;
    if (dmg > 0.5) {
      // Cracked beam — two halves with a gap
      const gapW = s * (dmg - 0.5) * 0.3;
      ctx.fillRect(sx + s * 0.05, beamY, s * 0.42 - gapW, s * 0.08);
      ctx.fillRect(sx + s * 0.53 + gapW, beamY, s * 0.42 - gapW, s * 0.08);
    } else {
      ctx.fillRect(sx + s * 0.05, beamY, s * 0.9, s * 0.08);
    }

    // Nails
    ctx.fillStyle = '#555';
    for (let i = 0; i < numPlanks; i++) {
      if (dmg > 0.5 && i === 2) continue; // middle nail gone
      ctx.beginPath();
      ctx.arc(sx + i * plankW + plankW * 0.5, beamY + s * 0.04, s * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Cracks on the remaining planks ──
  if (dmg > 0.15) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    const numCracks = Math.min(8, Math.floor(dmg * 10));
    for (let c = 0; c < numCracks; c++) {
      // Deterministic-ish positions based on crack index
      const cx = sx + s * (0.1 + (((c * 37) % 80) / 100) * 0.8);
      const cy = sy + s * (0.15 + (((c * 53) % 70) / 100) * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + s * 0.05, cy + s * 0.08);
      ctx.lineTo(cx + s * 0.02, cy + s * 0.14);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Health bar above barrier when damaged ──
  if (hpFraction < 1) {
    const barW = s * 0.8;
    const barH = 3;
    const barX = sx + s * 0.1;
    const barY = sy + s * 0.02;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpFraction > 0.5 ? '#4ade80' : hpFraction > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillRect(barX, barY, Math.ceil(barW * hpFraction), barH);
  }
}
