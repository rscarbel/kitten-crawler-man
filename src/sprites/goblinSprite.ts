export type GoblinWeapon = 'club' | 'hammer';

export function drawGoblinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  weapon: GoblinWeapon,
  skinColor: string,
  eyeColor: string,
) {
  // Feet
  ctx.fillStyle = '#2d1b00';
  ctx.fillRect(sx + s * 0.28, sy + s * 0.86, s * 0.17, s * 0.07);
  ctx.fillRect(sx + s * 0.53, sy + s * 0.86, s * 0.17, s * 0.07);

  // Legs (dark brown trousers)
  ctx.fillStyle = '#5c3a1e';
  ctx.fillRect(sx + s * 0.3,  sy + s * 0.68, s * 0.15, s * 0.2);
  ctx.fillRect(sx + s * 0.53, sy + s * 0.68, s * 0.15, s * 0.2);

  // Body
  ctx.fillStyle = skinColor;
  ctx.fillRect(sx + s * 0.27, sy + s * 0.44, s * 0.46, s * 0.26);

  // Left arm (stubby, no weapon)
  ctx.fillRect(sx + s * 0.13, sy + s * 0.46, s * 0.14, s * 0.12);

  // Right arm (holding weapon)
  ctx.fillRect(sx + s * 0.73, sy + s * 0.46, s * 0.14, s * 0.12);

  // Weapon at end of right arm
  drawWeapon(ctx, sx + s * 0.87, sy + s * 0.5, s, weapon);

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.30, s * 0.17, 0, Math.PI * 2);
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

  // Snout bump
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.335, s * 0.072, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(sx + s * 0.463, sy + s * 0.343, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.537, sy + s * 0.343, s * 0.018, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = eyeColor;
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
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  s: number,
  weapon: GoblinWeapon,
) {
  ctx.save();

  if (weapon === 'club') {
    // Handle — diagonal stick angled up-right
    ctx.strokeStyle = '#7c4a1e';
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + s * 0.22, wy - s * 0.26);
    ctx.stroke();

    // Knobby club head
    ctx.fillStyle = '#5c3010';
    ctx.beginPath();
    ctx.arc(wx + s * 0.22, wy - s * 0.26, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a1e08';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Highlight knob on head
    ctx.fillStyle = '#8b5030';
    ctx.beginPath();
    ctx.arc(wx + s * 0.18, wy - s * 0.30, s * 0.058, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Handle
    ctx.strokeStyle = '#7c4a1e';
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    const tipX = wx + s * 0.18;
    const tipY = wy - s * 0.34;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Hammer head — grey rectangle perpendicular to handle
    const angle = Math.atan2(tipY - wy, tipX - wx) - Math.PI / 2;
    ctx.translate(tipX, tipY);
    ctx.rotate(angle);

    ctx.fillStyle = '#64748b';
    ctx.fillRect(-s * 0.18, -s * 0.06, s * 0.36, s * 0.12);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-s * 0.18, -s * 0.06, s * 0.36, s * 0.12);

    // Metal sheen highlight
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-s * 0.15, -s * 0.05, s * 0.11, s * 0.04);
  }

  ctx.restore();
}
