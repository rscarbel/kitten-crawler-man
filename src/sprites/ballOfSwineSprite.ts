/**
 * Sprite for the Ball of Swine — a rolling mass of body parts.
 * @param orbitAngle - current orbit angle (radians), drives rotation animation
 * @param isStopped  - true when the boss is stunned and vulnerable
 * @param isBursting - true during the death burst animation
 * @param burstProgress - 0→1 burst progress
 */
export function drawBallOfSwineSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  orbitAngle: number,
  isStopped: boolean,
  isBursting: boolean,
  burstProgress: number,
): void {
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.5;
  const r = ts * 0.82; // overall ball radius

  ctx.save();
  ctx.translate(cx, cy);

  if (isBursting) {
    // Burst: expand and fade
    const scale = 1 + burstProgress * 1.8;
    ctx.scale(scale, scale);
    ctx.globalAlpha = 1 - burstProgress;
  }

  // Rotate the whole sprite based on orbit angle (spins as it moves)
  ctx.rotate(orbitAngle * 2.5);

  // --- Outer glow when stopped ---
  if (isStopped) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(orbitAngle * 8);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = ts * 0.18;
    ctx.beginPath();
    ctx.arc(0, 0, r + ts * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- Main fleshy mass ---
  const bodyColor = isStopped ? '#c97c5a' : '#7a2a3a';
  const bodyDark = isStopped ? '#8a4a2a' : '#4a0f1a';
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, isStopped ? '#e8a070' : '#9e3a4a');
  grad.addColorStop(0.6, bodyColor);
  grad.addColorStop(1, bodyDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // --- Body part silhouettes around the circumference ---
  // 6 evenly spaced limb/face protrusions
  const limbCount = 6;
  for (let i = 0; i < limbCount; i++) {
    const angle = (i / limbCount) * Math.PI * 2;
    const lx = Math.cos(angle) * r * 0.68;
    const ly = Math.sin(angle) * r * 0.68;

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle + Math.PI * 0.5);

    if (i % 3 === 0) {
      // Stubby hand/fist
      ctx.fillStyle = isStopped ? '#d4865a' : '#8c2030';
      ctx.beginPath();
      ctx.ellipse(0, 0, ts * 0.14, ts * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Knuckle lines
      ctx.strokeStyle = isStopped ? '#a05030' : '#5a1020';
      ctx.lineWidth = 1;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * ts * 0.04, -ts * 0.06);
        ctx.lineTo(k * ts * 0.04, ts * 0.06);
        ctx.stroke();
      }
    } else if (i % 3 === 1) {
      // Stubby foot/hoof
      ctx.fillStyle = isStopped ? '#b06040' : '#6a1828';
      ctx.beginPath();
      ctx.ellipse(0, 0, ts * 0.12, ts * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hoof split
      ctx.strokeStyle = isStopped ? '#804030' : '#3a0810';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -ts * 0.1);
      ctx.lineTo(0, ts * 0.1);
      ctx.stroke();
    } else {
      // Small face/snout
      ctx.fillStyle = isStopped ? '#e8986a' : '#a83848';
      ctx.beginPath();
      ctx.arc(0, 0, ts * 0.13, 0, Math.PI * 2);
      ctx.fill();
      // Tiny eyes
      ctx.fillStyle = '#1a0808';
      ctx.beginPath();
      ctx.arc(-ts * 0.05, -ts * 0.04, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ts * 0.05, -ts * 0.04, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // --- Central glowing eye ---
  const eyePulse = 0.7 + 0.3 * Math.sin(orbitAngle * 6);
  const eyeColor = isStopped ? '#fde68a' : '#ff2244';
  ctx.save();
  ctx.globalAlpha = eyePulse;
  // Eye glow
  const eyeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, ts * 0.22);
  eyeGrad.addColorStop(0, eyeColor);
  eyeGrad.addColorStop(0.5, isStopped ? '#f59e0b' : '#991122');
  eyeGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = eyeGrad;
  ctx.beginPath();
  ctx.arc(0, 0, ts * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Pupil slit
  ctx.fillStyle = '#0a0005';
  ctx.beginPath();
  ctx.ellipse(0, 0, ts * 0.04, ts * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- Dripping bits (tendrils at edges) ---
  if (!isStopped) {
    ctx.strokeStyle = 'rgba(120, 20, 40, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + orbitAngle * 1.3;
      const bx = Math.cos(a) * r;
      const by = Math.sin(a) * r;
      const len = ts * (0.12 + 0.08 * Math.sin(orbitAngle * 3 + i));
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Renders the "STOPPED — VULNERABLE" warning text above the ball. */
export function drawBallOfSwineStoppedWarning(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  stoppedFraction: number, // 0 = just stopped, 1 = about to resume
): void {
  const cx = sx + ts * 0.5;
  const topY = sy - ts * 0.3;
  const pulse = 0.8 + 0.2 * Math.sin(Date.now() * 0.008);

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.font = `bold ${Math.floor(ts * 0.32)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fde68a';
  ctx.fillText('VULNERABLE', cx, topY);

  // Timer bar below text
  const barW = ts * 1.4;
  const barH = 5;
  const barX = cx - barW * 0.5;
  const barY = topY + 4;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#374151';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = stoppedFraction < 0.5 ? '#4ade80' : '#f59e0b';
  ctx.fillRect(barX, barY, barW * (1 - stoppedFraction), barH);
  ctx.restore();
}
