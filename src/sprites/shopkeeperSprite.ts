export function drawShopkeeper(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime: number,
  facingX: number,
): void {
  ctx.save();
  const bob = Math.sin(walkTime * 0.08) * s * 0.02;
  const bsy = sy + bob;
  const cx = sx + s * 0.5;

  if (facingX < 0) {
    ctx.translate(sx + s * 0.5, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(sx + s * 0.5), 0);
  }

  // Legs
  ctx.fillStyle = '#3d2a0e';
  ctx.fillRect(cx - s * 0.18, bsy + s * 0.78, s * 0.14, s * 0.18);
  ctx.fillRect(cx + s * 0.04, bsy + s * 0.78, s * 0.14, s * 0.18);

  // Body coat (warm brown)
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(cx - s * 0.23, bsy + s * 0.36, s * 0.46, s * 0.46);

  // Apron (cream)
  ctx.fillStyle = '#e4d8b0';
  ctx.fillRect(cx - s * 0.13, bsy + s * 0.38, s * 0.26, s * 0.4);

  // Arms
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(cx - s * 0.34, bsy + s * 0.38, s * 0.11, s * 0.28);
  ctx.fillRect(cx + s * 0.23, bsy + s * 0.38, s * 0.11, s * 0.28);

  // Hands
  ctx.fillStyle = '#c89068';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.285, bsy + s * 0.68, s * 0.07, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.285, bsy + s * 0.68, s * 0.07, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#c89068';
  ctx.fillRect(cx - s * 0.07, bsy + s * 0.24, s * 0.14, s * 0.13);

  // Head
  ctx.fillStyle = '#c89068';
  ctx.beginPath();
  ctx.ellipse(cx, bsy + s * 0.16, s * 0.15, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hat brim
  ctx.fillStyle = '#1e1208';
  ctx.fillRect(cx - s * 0.24, bsy + s * 0.04, s * 0.48, s * 0.05);

  // Hat crown
  ctx.fillRect(cx - s * 0.16, bsy - s * 0.1, s * 0.32, s * 0.15);

  // Hatband
  ctx.fillStyle = '#8b6914';
  ctx.fillRect(cx - s * 0.16, bsy + s * 0.03, s * 0.32, s * 0.03);

  // Eyes
  ctx.fillStyle = '#1a0e04';
  ctx.fillRect(cx - s * 0.08, bsy + s * 0.12, s * 0.04, s * 0.04);
  ctx.fillRect(cx + s * 0.04, bsy + s * 0.12, s * 0.04, s * 0.04);

  // Smile
  ctx.strokeStyle = '#7a4a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, bsy + s * 0.2, s * 0.06, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Apron pocket
  ctx.strokeStyle = '#c8b880';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - s * 0.08, bsy + s * 0.56, s * 0.16, s * 0.12);

  ctx.restore();
}
