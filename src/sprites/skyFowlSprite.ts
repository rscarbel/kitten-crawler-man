/**
 * Draw a Sky Fowl — a sentient bipedal hawk-like NPC that wanders the overworld town.
 * They wear randomly-colored clothes (vest, pants, optional hat) and have hawk features:
 * hooked beak, amber eyes, folded wings, taloned feet.
 *
 * @param ctx         Canvas rendering context
 * @param sx          Screen X (top-left of tile)
 * @param sy          Screen Y (top-left of tile)
 * @param s           Tile size in pixels (32px)
 * @param walkFrame   Continuous frame counter for walk animation
 * @param isMoving    True when actively walking
 * @param isAggressive True when the fowl has been attacked and is fighting back
 * @param facingX     Horizontal facing component (used for L/R flip)
 * @param facingY     Vertical facing component
 * @param cloth       Clothing color palette for this fowl instance
 * @param peckAmt     0–1 head-lunge for peck animation
 */

export interface SkyFowlClothColors {
  vest: string;
  pants: string;
  trim: string;
  hat: string | null;
}

/** Eight distinct clothing palettes — picked randomly per-instance. */
export const SKY_FOWL_PALETTES: SkyFowlClothColors[] = [
  { vest: '#2e5c8a', pants: '#1a2a3a', trim: '#f0c060', hat: '#1a4050' }, // blue + gold
  { vest: '#6b2d2d', pants: '#3a1a1a', trim: '#c8a060', hat: '#8a3020' }, // burgundy + bronze
  { vest: '#2d6b3a', pants: '#1a3a1a', trim: '#e8d090', hat: null }, // forest green
  { vest: '#7a6020', pants: '#4a3a1a', trim: '#a8d080', hat: '#6a5010' }, // mustard + olive
  { vest: '#5a2d7a', pants: '#2a1a3a', trim: '#f0a0d0', hat: '#6a3090' }, // purple + pink
  { vest: '#1a4a4a', pants: '#0a2a2a', trim: '#80d0d0', hat: null }, // teal
  { vest: '#8a4020', pants: '#3a2010', trim: '#e0c060', hat: '#6a3010' }, // burnt orange + gold
  { vest: '#4a4a2a', pants: '#2a2a10', trim: '#a0c050', hat: null }, // olive drab
];

export function drawSkyFowlSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  isAggressive = false,
  facingX = 0,
  facingY = 1,
  cloth: SkyFowlClothColors,
  peckAmt = 0,
): void {
  const cs = s * 1.08;
  const cx = sx + s * 0.5;

  // ── Animation values ────────────────────────────────────────────────────────
  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.042 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.065 : 0;
  const wingFlutter = isMoving ? Math.sin(walkFrame * 0.9) * cs * 0.018 : 0;
  const tailSway = Math.sin(walkFrame * 0.65) * cs * 0.038;

  // ── Feather / body colours ───────────────────────────────────────────────────
  const fBase = '#7a5530'; // medium hawk brown body
  const fDark = '#4a3015'; // dark wing bars / cap
  const fLight = '#a07840'; // lighter feather highlights
  const belly = '#d4b878'; // pale cream/tan belly
  const legCol = '#c8a030'; // scaled tarsus
  const talonCol = '#2a1a08'; // dark horn talons
  const beakUpper = '#e0a418';
  const beakHook = '#b07800';
  const eyeAmber = '#e89010';
  const eyePupil = '#140800';

  // ── Layout — measure from ground upward ─────────────────────────────────────
  const ground = sy + s * 0.95 + bodyBob;
  const thighH = cs * 0.22; // upper leg (covered by pants)
  const tarsusH = cs * 0.13; // lower leg (bare, scaly)
  const bodyH = cs * 0.27;
  const bodyW = cs * 0.24;
  const headR = cs * 0.17;

  const footY = ground;
  const ankleY = footY - tarsusH;
  const hipY = ankleY - thighH;
  const bodyBottomY = hipY + cs * 0.05;
  const bodyTopY = bodyBottomY - bodyH;
  const bodyCy = (bodyBottomY + bodyTopY) * 0.5;
  const headCy = bodyTopY - headR * 0.75 + bodyBob * 0.3;

  // Peck lunge: head shifts forward
  const peckOffsetX = peckAmt * cs * 0.1;

  ctx.save();

  // ── Horizontal flip for left-facing ─────────────────────────────────────────
  const flipped = facingX < -0.3;
  if (flipped) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // ── Ground shadow ────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + cs * 0.035, cs * 0.28, cs * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Tail feathers (behind body, drawn first so body covers base) ─────────────
  ctx.fillStyle = fDark;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.ellipse(
      cx - cs * 0.06 + i * cs * 0.09 + tailSway * 0.6,
      bodyBottomY + cs * 0.09,
      cs * 0.055,
      cs * 0.13,
      i * 0.28 + tailSway * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Tail highlight
  ctx.fillStyle = fLight;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.ellipse(
      cx - cs * 0.06 + i * cs * 0.09 + tailSway * 0.6,
      bodyBottomY + cs * 0.07,
      cs * 0.022,
      cs * 0.07,
      i * 0.28 + tailSway * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // ── Legs ─────────────────────────────────────────────────────────────────────
  // Leg positions (swing opposite for walking gait)
  const leftHipX = cx - cs * 0.115 - legSwing * 0.7;
  const rightHipX = cx + cs * 0.115 + legSwing * 0.7;
  // Ankle slightly forward of hip (Z-bend bird silhouette)
  const leftAnkleX = leftHipX + cs * 0.04 + legSwing * 0.3;
  const rightAnkleX = rightHipX + cs * 0.04 - legSwing * 0.3;
  // Foot: tarsus goes back down from ankle
  const leftFootX = leftAnkleX - cs * 0.03;
  const rightFootX = rightAnkleX - cs * 0.03;

  // Pants (thigh)
  ctx.lineCap = 'round';
  ctx.lineWidth = cs * 0.115;
  ctx.strokeStyle = cloth.pants;
  ctx.beginPath();
  ctx.moveTo(leftHipX, hipY);
  ctx.lineTo(leftAnkleX, ankleY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rightHipX, hipY);
  ctx.lineTo(rightAnkleX, ankleY);
  ctx.stroke();

  // Tarsus (bare scaled leg)
  ctx.lineWidth = cs * 0.075;
  ctx.strokeStyle = legCol;
  ctx.beginPath();
  ctx.moveTo(leftAnkleX, ankleY);
  ctx.lineTo(leftFootX, footY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rightAnkleX, ankleY);
  ctx.lineTo(rightFootX, footY);
  ctx.stroke();

  // Scale texture on tarsus
  ctx.strokeStyle = '#9a7820';
  ctx.lineWidth = cs * 0.018;
  for (let f = 0; f < 2; f++) {
    const fx = f === 0 ? leftFootX : rightFootX;
    const ax = f === 0 ? leftAnkleX : rightAnkleX;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      const px = ax + (fx - ax) * t;
      const py = ankleY + (footY - ankleY) * t;
      ctx.beginPath();
      ctx.moveTo(px - cs * 0.04, py);
      ctx.lineTo(px + cs * 0.04, py);
      ctx.stroke();
    }
  }

  // ── Talons ───────────────────────────────────────────────────────────────────
  ctx.strokeStyle = talonCol;
  ctx.lineWidth = cs * 0.04;
  ctx.lineCap = 'round';
  for (const [fx, fy] of [
    [leftFootX, footY],
    [rightFootX, footY],
  ] as [number, number][]) {
    // Three forward talons
    for (let t = -1; t <= 1; t++) {
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(
        fx + cs * 0.06 + t * cs * 0.03,
        fy + cs * 0.03,
        fx + cs * 0.1 + t * cs * 0.04,
        fy + cs * 0.055,
      );
      ctx.stroke();
    }
    // One rear talon
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx - cs * 0.04, fy + cs * 0.02, fx - cs * 0.07, fy + cs * 0.05);
    ctx.stroke();
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  ctx.fillStyle = fBase;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, bodyW, bodyH * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly (lighter front)
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.045, bodyCy + cs * 0.025, bodyW * 0.52, bodyH * 0.37, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Vest ─────────────────────────────────────────────────────────────────────
  ctx.fillStyle = cloth.vest;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.04, bodyCy, bodyW * 0.49, bodyH * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Vest collar V-shape
  ctx.strokeStyle = cloth.trim;
  ctx.lineWidth = cs * 0.024;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.04, bodyCy - bodyH * 0.28);
  ctx.lineTo(cx + cs * 0.04, bodyCy - bodyH * 0.06);
  ctx.lineTo(cx + cs * 0.1, bodyCy - bodyH * 0.28);
  ctx.stroke();

  // Vest buttons
  ctx.fillStyle = cloth.trim;
  for (let b = 0; b < 3; b++) {
    ctx.beginPath();
    ctx.arc(cx + cs * 0.04, bodyCy - cs * 0.055 + b * cs * 0.072, cs * 0.017, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Folded wings (sides of body) ─────────────────────────────────────────────
  // Left wing
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(
    cx - bodyW * 0.86 + wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.095,
    bodyH * 0.38,
    -0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = fLight;
  ctx.beginPath();
  ctx.ellipse(
    cx - bodyW * 0.86 + wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.04,
    bodyH * 0.24,
    -0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Right wing
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(
    cx + bodyW * 0.86 - wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.095,
    bodyH * 0.38,
    0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = fLight;
  ctx.beginPath();
  ctx.ellipse(
    cx + bodyW * 0.86 - wingFlutter,
    bodyCy + cs * 0.02,
    cs * 0.04,
    bodyH * 0.24,
    0.28,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // ── Neck ─────────────────────────────────────────────────────────────────────
  ctx.fillStyle = fBase;
  const neckCy = bodyTopY + (headCy - bodyTopY) * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.02, neckCy, cs * 0.09, cs * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Head ─────────────────────────────────────────────────────────────────────
  const hx = cx + peckOffsetX; // lunge forward when pecking
  ctx.fillStyle = fBase;
  ctx.beginPath();
  ctx.arc(hx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // Cap feathers (dark top of head)
  ctx.fillStyle = fDark;
  ctx.beginPath();
  ctx.ellipse(hx - cs * 0.015, headCy - headR * 0.3, headR * 0.82, headR * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small crest feather on top
  ctx.strokeStyle = fDark;
  ctx.lineWidth = cs * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - cs * 0.01, headCy - headR * 0.88);
  ctx.quadraticCurveTo(hx + cs * 0.04, headCy - headR * 1.28, hx + cs * 0.07, headCy - headR * 1.2);
  ctx.stroke();

  // ── Hat (optional) ────────────────────────────────────────────────────────────
  if (cloth.hat) {
    const brimY = headCy - headR * 0.58;
    const crownH = headR * 0.58;

    // Hat crown (box shape)
    ctx.fillStyle = cloth.hat;
    ctx.beginPath();
    ctx.rect(hx - headR * 0.68, brimY - crownH, headR * 1.36, crownH);
    ctx.fill();
    // Crown top ellipse
    ctx.beginPath();
    ctx.ellipse(hx, brimY - crownH, headR * 0.68, headR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Brim ellipse
    ctx.beginPath();
    ctx.ellipse(hx, brimY, headR * 1.08, headR * 0.21, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hat band (trim color)
    ctx.fillStyle = cloth.trim;
    ctx.fillRect(hx - headR * 0.68, brimY - headR * 0.34, headR * 1.36, headR * 0.17);
  }

  // ── Beak ─────────────────────────────────────────────────────────────────────
  // Upper mandible — curved hook
  const bx = hx + headR * 0.68;
  const by = headCy + headR * 0.05;

  ctx.fillStyle = beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by - headR * 0.15);
  ctx.quadraticCurveTo(bx + headR * 0.7, by + headR * 0.05, bx + headR * 0.5, by + headR * 0.35);
  ctx.lineTo(bx, by + headR * 0.2);
  ctx.closePath();
  ctx.fill();

  // Hook tip (darker)
  ctx.fillStyle = beakHook;
  ctx.beginPath();
  ctx.moveTo(bx + headR * 0.44, by + headR * 0.3);
  ctx.quadraticCurveTo(bx + headR * 0.68, by + headR * 0.38, bx + headR * 0.52, by + headR * 0.52);
  ctx.lineTo(bx + headR * 0.3, by + headR * 0.42);
  ctx.closePath();
  ctx.fill();

  // Lower mandible (smaller, opens slightly when aggressive or pecking)
  const jawOpen = peckAmt * headR * 0.12 + (isAggressive ? headR * 0.06 : 0);
  ctx.fillStyle = beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by + headR * 0.2 + jawOpen);
  ctx.quadraticCurveTo(
    bx + headR * 0.45,
    by + headR * 0.3 + jawOpen,
    bx + headR * 0.42,
    by + headR * 0.4 + jawOpen,
  );
  ctx.lineTo(bx, by + headR * 0.32 + jawOpen);
  ctx.closePath();
  ctx.fill();

  // ── Eye ───────────────────────────────────────────────────────────────────────
  const eyeX = hx + headR * 0.3;
  const eyeY = headCy - headR * 0.18;
  const eyeR = headR * 0.27;

  // Sclera
  ctx.fillStyle = '#fff5d0';
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Iris
  ctx.fillStyle = eyeAmber;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = eyePupil;
  ctx.beginPath();
  ctx.arc(eyeX + eyeR * 0.06, eyeY + eyeR * 0.06, eyeR * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.arc(eyeX - eyeR * 0.18, eyeY - eyeR * 0.2, eyeR * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Brow ridge (expressive — flat when neutral, angled inward when aggressive)
  ctx.strokeStyle = fDark;
  ctx.lineWidth = cs * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (isAggressive) {
    // Furrowed brow — inner end drops lower
    ctx.moveTo(eyeX - eyeR * 1.0, eyeY - eyeR * 0.95);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.35);
  } else {
    // Neutral / curious brow — slight upward curve
    ctx.moveTo(eyeX - eyeR * 1.0, eyeY - eyeR * 1.15);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.1);
  }
  ctx.stroke();

  // Aggressive red eye ring
  if (isAggressive) {
    ctx.strokeStyle = 'rgba(210,40,40,0.72)';
    ctx.lineWidth = cs * 0.032;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR * 1.28, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
