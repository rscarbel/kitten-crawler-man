export type GoblinWeapon = 'club' | 'hammer';

// Attack curve: 0 → +1.4 (overhead windup at t≈0.35) → -0.4 (past-neutral downswing) → 0
// Positive = weapon/arm raised (up on screen), negative = below resting position
function attackCurve(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.35) {
    return (t / 0.35) * 1.4;
  } else if (t < 0.62) {
    const p = (t - 0.35) / 0.27;
    return 1.4 - 1.8 * p; // 1.4 → -0.4
  } else {
    const p = (t - 0.62) / 0.38;
    return -0.4 + 0.4 * p; // -0.4 → 0
  }
}

// Weapon rotation angle (radians) during a swing.
// REST (-0.87) ≈ atan2(-0.26, 0.22) — upper-right, matching idle position.
// Windup sweeps 53° counterclockwise overhead; strike swings 120° clockwise down.
// Uses linear 0→1 progress (not a sin-modulated value) so each phase fires once.
function weaponAngleCurve(t: number): number {
  const REST = -0.87;
  if (t <= 0 || t >= 1) return REST;
  if (t < 0.35) {
    return REST - (t / 0.35) * 0.93; // -0.87 → -1.80 (sweep overhead, 53°)
  } else if (t < 0.62) {
    const p = (t - 0.35) / 0.27;
    return -1.8 + p * 2.1; // -1.80 → +0.30 (downswing, 120°)
  } else {
    const p = (t - 0.62) / 0.38;
    return 0.3 - p * 1.17; // +0.30 → -0.87 (recovery)
  }
}

function _drawWeapon(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  s: number,
  weapon: GoblinWeapon,
  weaponAngle: number,
): void {
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(weaponAngle);

  if (weapon === 'club') {
    // Handle
    ctx.strokeStyle = '#7c4a1e';
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.34, 0);
    ctx.stroke();

    // Club head
    ctx.fillStyle = '#5c3010';
    ctx.beginPath();
    ctx.arc(s * 0.34, 0, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a1e08';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Knob highlight
    ctx.fillStyle = '#8b5030';
    ctx.beginPath();
    ctx.arc(s * 0.3, -s * 0.05, s * 0.058, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Handle
    ctx.strokeStyle = '#7c4a1e';
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.38, 0);
    ctx.stroke();

    // Hammer head — perpendicular to handle (wide along Y, narrow along X)
    ctx.fillStyle = '#64748b';
    ctx.fillRect(s * 0.3, -s * 0.18, s * 0.12, s * 0.36);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s * 0.3, -s * 0.18, s * 0.12, s * 0.36);

    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(s * 0.31, -s * 0.15, s * 0.05, s * 0.11);
  }

  ctx.restore();
}

function _drawGoblinBody(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  skinColor: string,
  eyeColor: string,
  bodyBob: number,
  legSwing: number,
  armSwing: number,
  weaponRaise: number,
  attackAnim: number,
): void {
  // Feet
  ctx.fillStyle = '#2d1b00';
  ctx.fillRect(sx + s * 0.28, sy + s * 0.86 + bodyBob + legSwing, s * 0.17, s * 0.07);
  ctx.fillRect(sx + s * 0.53, sy + s * 0.86 + bodyBob - legSwing, s * 0.17, s * 0.07);

  // Legs
  ctx.fillStyle = '#5c3a1e';
  ctx.fillRect(sx + s * 0.3, sy + s * 0.68 + bodyBob + legSwing, s * 0.15, s * 0.2);
  ctx.fillRect(sx + s * 0.53, sy + s * 0.68 + bodyBob - legSwing, s * 0.15, s * 0.2);

  // Body
  ctx.fillStyle = skinColor;
  ctx.fillRect(sx + s * 0.27, sy + s * 0.44 + bodyBob, s * 0.46, s * 0.26);

  // Left arm — swings opposite to weapon arm during walk
  ctx.fillRect(sx + s * 0.13, sy + s * 0.46 + bodyBob + armSwing, s * 0.14, s * 0.12);

  // Right arm — raised during attack windup / swing
  ctx.fillRect(sx + s * 0.73, sy + s * 0.46 + bodyBob - weaponRaise - armSwing, s * 0.14, s * 0.12);

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.3 + bodyBob, s * 0.17, 0, Math.PI * 2);
  ctx.fill();

  // Big pointy left ear
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.34, sy + s * 0.26 + bodyBob);
  ctx.lineTo(sx + s * 0.17, sy + s * 0.11 + bodyBob);
  ctx.lineTo(sx + s * 0.39, sy + s * 0.19 + bodyBob);
  ctx.fill();

  // Big pointy right ear
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.66, sy + s * 0.26 + bodyBob);
  ctx.lineTo(sx + s * 0.83, sy + s * 0.11 + bodyBob);
  ctx.lineTo(sx + s * 0.61, sy + s * 0.19 + bodyBob);
  ctx.fill();

  // Snout bump
  ctx.beginPath();
  ctx.arc(sx + s * 0.5, sy + s * 0.335 + bodyBob, s * 0.072, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(sx + s * 0.463, sy + s * 0.343 + bodyBob, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.537, sy + s * 0.343 + bodyBob, s * 0.018, 0, Math.PI * 2);
  ctx.fill();

  // Eyes — squint during windup and strike
  const eyeSize = attackAnim > 0.2 ? s * 0.038 : s * 0.05;
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(sx + s * 0.415, sy + s * 0.275 + bodyBob, eyeSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.585, sy + s * 0.275 + bodyBob, eyeSize, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(sx + s * 0.415, sy + s * 0.275 + bodyBob, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + s * 0.585, sy + s * 0.275 + bodyBob, s * 0.022, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Full goblin sprite with weapon.
 * @param attackAnim 0–1 normalised swing progress (windup peaks at ~0.35, strike lands at ~0.62).
 */
export function drawGoblinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  weapon: GoblinWeapon,
  skinColor: string,
  eyeColor: string,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
): void {
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.035 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * s * 0.045 : 0;
  const armSwing = isMoving ? -Math.sin(walkFrame) * s * 0.025 : 0;
  const weaponRaise = attackCurve(attackAnim) * s * 0.14;
  const weaponAngle = weaponAngleCurve(attackAnim);

  _drawGoblinBody(
    ctx,
    sx,
    sy,
    s,
    skinColor,
    eyeColor,
    bodyBob,
    legSwing,
    armSwing,
    weaponRaise,
    attackAnim,
  );
  _drawWeapon(ctx, sx + s * 0.87, sy + s * 0.5 - weaponRaise + bodyBob, s, weapon, weaponAngle);
}

/** Goblin body without weapon — for use as a compositing base layer. */
export function drawGoblinBodyOnly(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  skinColor: string,
  eyeColor: string,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
): void {
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.035 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * s * 0.045 : 0;
  const armSwing = isMoving ? -Math.sin(walkFrame) * s * 0.025 : 0;
  const weaponRaise = attackCurve(attackAnim) * s * 0.14;

  _drawGoblinBody(
    ctx,
    sx,
    sy,
    s,
    skinColor,
    eyeColor,
    bodyBob,
    legSwing,
    armSwing,
    weaponRaise,
    attackAnim,
  );
}

/** Weapon only (no body) — pixel-aligned with drawGoblinBodyOnly for compositing. */
export function drawGoblinWeaponOnly(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  weapon: GoblinWeapon,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
): void {
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.035 : 0;
  const weaponRaise = attackCurve(attackAnim) * s * 0.14;
  const weaponAngle = weaponAngleCurve(attackAnim);

  _drawWeapon(ctx, sx + s * 0.87, sy + s * 0.5 - weaponRaise + bodyBob, s, weapon, weaponAngle);
}
