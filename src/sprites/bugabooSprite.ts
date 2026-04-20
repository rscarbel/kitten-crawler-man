/**
 * Draws a Bugaboo — enormous bear-shaped body with no neck, huge owl-like eyes,
 * comically skinny legs, absurdly thin arms, obsidian-colored hair.
 * Both terrifying and cartoonish. Reusable for NPCs and enemies alike.
 */
export function drawBugabooSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime = 0,
  isWalking = false,
  facingX = 1,
  attackAnim = 0,
) {
  const bob = isWalking ? Math.sin(walkTime * 0.25) * s * 0.03 : 0;
  const armSwing = isWalking ? Math.sin(walkTime * 0.25) * 0.22 : 0;
  const legShuffle = isWalking ? Math.sin(walkTime * 0.25) * s * 0.04 : 0;
  const scratchLift = attackAnim * s * 0.54;

  ctx.save();
  if (facingX < 0) {
    ctx.translate(sx + s * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * 0.5), 0);
  }

  const bsy = sy + bob;

  // === COMICALLY SKINNY LEGS (behind body) ===
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = s * 0.045;
  ctx.lineCap = 'round';
  // Left leg
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.38, bsy + s * 0.82);
  ctx.lineTo(sx + s * 0.35 - legShuffle * 0.5, bsy + s * 0.97);
  ctx.stroke();
  // Right leg
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.62, bsy + s * 0.82);
  ctx.lineTo(sx + s * 0.65 + legShuffle * 0.5, bsy + s * 0.97);
  ctx.stroke();
  // Tiny feet
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.35 - legShuffle * 0.5,
    bsy + s * 0.98,
    s * 0.04,
    s * 0.02,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sx + s * 0.65 + legShuffle * 0.5,
    bsy + s * 0.98,
    s * 0.04,
    s * 0.02,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // === ABSURDLY THIN ARMS (behind body, long and dangling) ===
  const leftArmEndX = sx + s * 0.1;
  const leftArmEndY = bsy + s * 0.88 + armSwing * s * 0.6 - scratchLift;
  const rightArmEndX = sx + s * 0.9;
  const rightArmEndY = bsy + s * 0.88 - armSwing * s * 0.6 - scratchLift;
  const armCtrlY = attackAnim > 0 ? bsy + s * (0.6 - attackAnim * 0.22) : bsy + s * 0.65;
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = s * 0.035;
  ctx.lineCap = 'round';
  // Left arm
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.14, bsy + s * 0.4);
  ctx.quadraticCurveTo(sx + s * 0.06, armCtrlY, leftArmEndX, leftArmEndY);
  ctx.stroke();
  // Right arm
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.86, bsy + s * 0.4);
  ctx.quadraticCurveTo(sx + s * 0.94, armCtrlY, rightArmEndX, rightArmEndY);
  ctx.stroke();
  // Tiny claw-hands
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.arc(leftArmEndX, leftArmEndY, s * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightArmEndX, rightArmEndY, s * 0.03, 0, Math.PI * 2);
  ctx.fill();

  // === MASSIVE BEAR-SHAPED BODY (no neck, head merges into torso) ===
  // Main body (large oval)
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.52, s * 0.36, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head (merges directly into body — no neck)
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.24, s * 0.26, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small rounded ears (bear-like)
  ctx.fillStyle = '#12122a';
  ctx.beginPath();
  ctx.arc(sx + s * 0.28, bsy + s * 0.08, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.72, bsy + s * 0.08, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Inner ears
  ctx.fillStyle = '#2a2a4e';
  ctx.beginPath();
  ctx.arc(sx + s * 0.28, bsy + s * 0.08, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.72, bsy + s * 0.08, s * 0.04, 0, Math.PI * 2);
  ctx.fill();

  // === SHAGGY HAIR TEXTURE (short strokes across body) ===
  ctx.save();
  ctx.strokeStyle = '#2a2a3e';
  ctx.lineWidth = s * 0.015;
  ctx.lineCap = 'round';
  const tufts = [
    [0.3, 0.3],
    [0.5, 0.2],
    [0.7, 0.3],
    [0.25, 0.5],
    [0.45, 0.45],
    [0.65, 0.48],
    [0.75, 0.5],
    [0.3, 0.65],
    [0.5, 0.7],
    [0.7, 0.65],
    [0.35, 0.15],
    [0.65, 0.15],
    [0.4, 0.6],
    [0.6, 0.58],
  ];
  for (const [tx, ty] of tufts) {
    const ttx = sx + s * tx;
    const tty = bsy + s * ty;
    ctx.beginPath();
    ctx.moveTo(ttx, tty);
    ctx.lineTo(ttx + s * 0.02, tty - s * 0.04);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ttx + s * 0.015, tty);
    ctx.lineTo(ttx + s * 0.035, tty - s * 0.035);
    ctx.stroke();
  }
  ctx.restore();

  // === ENORMOUS OWL-LIKE EYES ===
  // Eye whites (large)
  ctx.fillStyle = '#e8e8d0';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.36, bsy + s * 0.24, s * 0.1, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.64, bsy + s * 0.24, s * 0.1, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye outline (dark ring)
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = s * 0.018;
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.36, bsy + s * 0.24, s * 0.1, s * 0.11, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.64, bsy + s * 0.24, s * 0.1, s * 0.11, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Iris (amber/yellow)
  ctx.fillStyle = '#d4a820';
  ctx.beginPath();
  ctx.arc(sx + s * 0.36, bsy + s * 0.25, s * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.64, bsy + s * 0.25, s * 0.065, 0, Math.PI * 2);
  ctx.fill();

  // Pupils (large, dark)
  ctx.fillStyle = '#0a0a1a';
  ctx.beginPath();
  ctx.arc(sx + s * 0.36, bsy + s * 0.25, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.64, bsy + s * 0.25, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // Eye glow (subtle amber)
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#d4a820';
  ctx.beginPath();
  ctx.arc(sx + s * 0.36, bsy + s * 0.25, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.64, bsy + s * 0.25, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pupil highlights (small white dot)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(sx + s * 0.35, bsy + s * 0.235, s * 0.012, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.63, bsy + s * 0.235, s * 0.012, 0, Math.PI * 2);
  ctx.fill();

  // === SMALL NOSE / SNOUT ===
  ctx.fillStyle = '#2a2a4e';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.5, bsy + s * 0.36, s * 0.035, s * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  // === SUBTLE MOUTH (slightly unsettling) ===
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = s * 0.014;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.42, bsy + s * 0.39);
  ctx.quadraticCurveTo(sx + s * 0.5, bsy + s * 0.42, sx + s * 0.58, bsy + s * 0.39);
  ctx.stroke();

  // === SCRATCH ATTACK — claws fan out from each raised hand ===
  if (attackAnim > 0) {
    ctx.save();
    ctx.globalAlpha = attackAnim * 0.92;
    ctx.strokeStyle = '#3a3a5e';
    ctx.lineWidth = s * 0.017;
    ctx.lineCap = 'round';
    const clawLen = s * (0.055 + attackAnim * 0.055);
    // Three claws per hand, fanning downward/inward from each claw tip
    for (let c = -1; c <= 1; c++) {
      const angle = Math.PI * 0.5 + c * 0.4;
      ctx.beginPath();
      ctx.moveTo(leftArmEndX, leftArmEndY);
      ctx.lineTo(leftArmEndX + Math.cos(angle) * clawLen, leftArmEndY + Math.sin(angle) * clawLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightArmEndX, rightArmEndY);
      ctx.lineTo(
        rightArmEndX + Math.cos(angle) * clawLen,
        rightArmEndY + Math.sin(angle) * clawLen,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // undo facing flip
}
