/**
 * All procedural drawing functions for Goblin Dynamite:
 *  - In-world floor sprite (with fuse countdown)
 *  - Inventory icon
 *  - Explosion animation
 *  - Throw charge bar
 */

// In-world floor/flying sprite

/**
 * Draws a dynamite stick at the given screen position.
 * @param sx      Screen X (top-left of tile)
 * @param sy      Screen Y (top-left of tile)
 * @param s       Tile size in pixels
 * @param fuseFrames Frames remaining on the fuse
 * @param fuseTotal  Total fuse frames (for computing ratio)
 */
export function drawDynamiteFloorSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  fuseFrames: number,
  fuseTotal: number,
): void {
  ctx.save();

  const cx = sx + s * 0.5;
  const cy = sy + s * 0.55;
  const bw = s * 0.18; // body width
  const bh = s * 0.44; // body height

  // Pulsing red halo when fuse < 40% (120 frames)
  const fuseRatio = fuseFrames / fuseTotal;
  if (fuseRatio < 0.4) {
    const pulse = Math.sin(Date.now() * 0.012) * 0.5 + 0.5;
    const haloAlpha = (1 - fuseRatio / 0.4) * 0.55 * (0.5 + pulse * 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 68, 68, ${haloAlpha})`;
    ctx.fill();
  }

  // Body
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  // Black bands
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * 0.15, bw, s * 0.025);
  ctx.fillRect(cx - bw / 2, cy + bh * 0.12, bw, s * 0.025);

  // Label stripe (white stripe at center)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx - bw / 2 + 1, cy - s * 0.025, bw - 2, s * 0.05);

  // Fuse rope (curved line from top)
  ctx.strokeStyle = '#6b3a1f';
  ctx.lineWidth = s * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - bh / 2);
  ctx.quadraticCurveTo(cx + s * 0.1, cy - bh / 2 - s * 0.12, cx + s * 0.06, cy - bh / 2 - s * 0.22);
  ctx.stroke();

  // Fuse tip spark — blinks faster as fuse runs low
  const sparkVisible =
    fuseRatio > 0.2 ? true : Math.floor(Date.now() / (fuseRatio < 0.07 ? 80 : 160)) % 2 === 0;

  if (sparkVisible) {
    const sparkX = cx + s * 0.06;
    const sparkY = cy - bh / 2 - s * 0.22;
    // Glow
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 140, 0, 0.45)';
    ctx.fill();
    // Core spark
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdd00';
    ctx.fill();
    // Tiny bright center
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, s * 0.015, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  ctx.restore();
}

// Explosion animation

/**
 * Draws the dynamite explosion animation.
 * @param sx           Screen X of explosion center
 * @param sy           Screen Y of explosion center
 * @param s            Tile size (for scale reference)
 * @param timer        Frames remaining in animation
 * @param totalFrames  Total animation frames (e.g. 45)
 * @param explosionRadius  Radius of the AoE in pixels
 */
export function drawDynamiteExplosion(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  timer: number,
  totalFrames: number,
  explosionRadius: number,
): void {
  ctx.save();

  const t = 1 - timer / totalFrames; // 0 = just started, 1 = finished

  // 1. Shockwave ring — expands fast, fades early
  if (t < 0.55) {
    const ringProgress = t / 0.55;
    const ringR = explosionRadius * ringProgress;
    const ringAlpha = 1 - ringProgress;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${ringAlpha * 0.85})`;
    ctx.lineWidth = s * 0.06 * (1 - ringProgress * 0.5);
    ctx.stroke();
  }

  // 2. Fire fill — grows then shrinks
  const fireR = explosionRadius * 0.75 * Math.sin(t * Math.PI);
  const fireAlpha = Math.max(0, 1 - t * 1.3);
  if (fireR > 0 && fireAlpha > 0) {
    const fireGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, fireR);
    fireGrad.addColorStop(0, `rgba(255, 255, 200, ${fireAlpha})`);
    fireGrad.addColorStop(0.3, `rgba(255, 160, 0, ${fireAlpha})`);
    fireGrad.addColorStop(0.7, `rgba(220, 60, 0, ${fireAlpha * 0.85})`);
    fireGrad.addColorStop(1, `rgba(100, 20, 0, 0)`);
    ctx.beginPath();
    ctx.arc(sx, sy, fireR, 0, Math.PI * 2);
    ctx.fillStyle = fireGrad;
    ctx.fill();
  }

  // 3. Hot bright core — early, shrinks fast
  if (t < 0.35) {
    const coreT = t / 0.35;
    const coreR = explosionRadius * 0.25 * (1 - coreT);
    const coreAlpha = 1 - coreT;
    ctx.beginPath();
    ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${coreAlpha * 0.9})`;
    ctx.fill();
  }

  // 4. Spark rays — 12 lines, early phase only
  if (t < 0.45) {
    const sparkT = t / 0.45;
    const sparkLen = explosionRadius * 0.9 * sparkT;
    const sparkAlpha = 1 - sparkT;
    ctx.strokeStyle = `rgba(255, 220, 50, ${sparkAlpha})`;
    ctx.lineWidth = s * 0.04;
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const startR = explosionRadius * 0.15;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * startR, sy + Math.sin(angle) * startR);
      ctx.lineTo(
        sx + Math.cos(angle) * (startR + sparkLen),
        sy + Math.sin(angle) * (startR + sparkLen),
      );
      ctx.stroke();
    }
    // 6 shorter secondary sparks at offset angles
    ctx.lineWidth = s * 0.025;
    ctx.strokeStyle = `rgba(255, 140, 0, ${sparkAlpha * 0.7})`;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const startR = explosionRadius * 0.1;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(angle) * startR, sy + Math.sin(angle) * startR);
      ctx.lineTo(
        sx + Math.cos(angle) * (startR + sparkLen * 0.6),
        sy + Math.sin(angle) * (startR + sparkLen * 0.6),
      );
      ctx.stroke();
    }
  }

  // 5. Smoke puffs — 6 dark ellipses, appear later and fade out
  if (t > 0.3) {
    const smokeT = (t - 0.3) / 0.7;
    const smokeAlpha = Math.max(0, (1 - smokeT) * 0.65);
    const puffPositions = [
      { dx: -0.4, dy: -0.5 },
      { dx: 0.4, dy: -0.5 },
      { dx: -0.55, dy: 0.1 },
      { dx: 0.55, dy: 0.1 },
      { dx: -0.2, dy: 0.5 },
      { dx: 0.2, dy: 0.5 },
    ];
    for (const pos of puffPositions) {
      const puffR = explosionRadius * 0.32 * (0.6 + smokeT * 0.8);
      const puffX = sx + pos.dx * explosionRadius * (0.5 + smokeT * 0.5);
      const puffY = sy + pos.dy * explosionRadius * (0.5 + smokeT * 0.5);
      ctx.beginPath();
      ctx.ellipse(puffX, puffY, puffR, puffR * 0.75, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 50, 50, ${smokeAlpha})`;
      ctx.fill();
    }
  }

  ctx.restore();
}

// Inventory icon

/**
 * Draws a compact dynamite stick icon for the inventory/hotbar slot.
 */
export function drawDynamiteInventoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();

  const cx = x + size * 0.5;
  const cy = y + size * 0.58;
  const bw = size * 0.22;
  const bh = size * 0.48;

  // Body
  ctx.fillStyle = '#cc1a1a';
  ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);

  // Bands
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - bw / 2, cy - bh * 0.15, bw, size * 0.028);
  ctx.fillRect(cx - bw / 2, cy + bh * 0.1, bw, size * 0.028);

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(cx - bw / 2 + 1, cy - bh * 0.22, bw * 0.4, bh * 0.38);

  // Fuse
  ctx.strokeStyle = '#6b3a1f';
  ctx.lineWidth = size * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - bh / 2);
  ctx.quadraticCurveTo(
    cx + size * 0.09,
    cy - bh / 2 - size * 0.08,
    cx + size * 0.05,
    cy - bh / 2 - size * 0.18,
  );
  ctx.stroke();

  // Spark tip
  const sparkX = cx + size * 0.05;
  const sparkY = cy - bh / 2 - size * 0.18;
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, size * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = '#ffaa00';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, size * 0.02, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}

// Throw charge bar

/**
 * Draws the throw-charge bar at the bottom center of the screen.
 * @param canvasW       Canvas width
 * @param canvasH       Canvas height
 * @param ratio         Charge ratio 0–1 (1 = max throw)
 * @param chargeFrames  Raw frames held (for danger flash detection)
 * @param dangerFrames  Frame count at which the bar turns red/flashing
 */
export function drawDynamiteChargeBar(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  ratio: number,
  chargeFrames: number,
  dangerFrames: number,
): void {
  ctx.save();

  const barW = 20;
  const barH = 150;
  const barX = canvasW - barW - 16;
  const barY = (canvasH - barH) / 2;

  const isDanger = chargeFrames >= dangerFrames;
  // Flash every 8 frames when in danger
  const flashOn = !isDanger || Math.floor(chargeFrames / 8) % 2 === 0;

  // Labels above bar
  ctx.fillStyle = isDanger ? '#ef4444' : '#e2e8f0';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  const labelX = barX + barW / 2;
  if (isDanger) {
    ctx.fillText('⚠', labelX, barY - 18);
    ctx.fillText('DANGER', labelX, barY - 6);
  } else {
    ctx.fillText('THROW', labelX, barY - 14);
    ctx.fillText('POWER', labelX, barY - 2);
  }

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  ctx.strokeStyle = isDanger ? '#ef4444' : '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX - 2, barY - 2, barW + 4, barH + 4);

  // Fill — grows from bottom upward
  if (flashOn) {
    const fillH = Math.ceil(barH * ratio);
    ctx.fillStyle = isDanger ? '#ef4444' : ratio > 0.85 ? '#facc15' : '#4ade80';
    ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
  }

  // Tick marks at 25%, 50%, 75% (horizontal lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (const pct of [0.25, 0.5, 0.75]) {
    const ty = barY + barH * (1 - pct);
    ctx.beginPath();
    ctx.moveTo(barX, ty);
    ctx.lineTo(barX + barW, ty);
    ctx.stroke();
  }

  ctx.restore();
}
