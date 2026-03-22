/**
 * Draws the Krakaren Clone boss sprite — a massive immobile octopus monster
 * with a beaked mouth, clusters of eyes, and pink tentacles covered in
 * human-shaped mouths with bright red lips.
 *
 * The boss is ~20 ft tall (occupies ~3×3 tiles visually) but collision stays
 * within a single tile.
 */

const TWO_PI = Math.PI * 2;

/** Per-tentacle persistent data for idle sway. */
interface TentacleDesc {
  baseAngle: number; // radial angle from body centre
  length: number; // 0–1 multiplier of max tentacle reach
  phase: number; // animation phase offset
  mouthCount: number; // how many mouths on this tentacle
}

const TENTACLE_COUNT = 10;

/** Pre-generated tentacle descriptors (deterministic per instance via seed). */
function buildTentacles(): TentacleDesc[] {
  const out: TentacleDesc[] = [];
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    out.push({
      baseAngle: (i / TENTACLE_COUNT) * TWO_PI + (i % 2 === 0 ? 0.15 : -0.15),
      length: 0.7 + (((i * 7 + 3) % 11) / 11) * 0.3,
      phase: i * 1.3,
      mouthCount: 3 + (i % 3),
    });
  }
  return out;
}

const TENTACLES = buildTentacles();

/**
 * Draw a single tentacle as a segmented curve.
 * Returns the tip position for slam indicator use.
 */
function drawTentacle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  desc: TentacleDesc,
  time: number,
  attackTentacle: number, // index of tentacle doing melee swing, -1 if none
  tentacleIndex: number,
  attackProgress: number, // 0–1 for swing animation
): { tipX: number; tipY: number } {
  const reach = ts * 2.8 * desc.length;
  const segments = 8;
  const segLen = reach / segments;

  // Melee attack: the attacking tentacle sweeps forward rapidly
  let swingOffset = 0;
  if (attackTentacle === tentacleIndex && attackProgress > 0) {
    swingOffset = Math.sin(attackProgress * Math.PI) * 1.2;
  }

  const sway = Math.sin(time * 1.5 + desc.phase) * 0.15 + swingOffset;
  let angle = desc.baseAngle + sway;
  let px = cx;
  let py = cy;

  ctx.save();
  ctx.lineCap = 'round';

  for (let s = 0; s < segments; s++) {
    const t = s / segments;
    const thickness = ts * (0.22 - t * 0.18);
    const curlAmount = Math.sin(time * 2.0 + desc.phase + s * 0.7) * 0.12 * (1 + t);
    angle += curlAmount;

    const nx = px + Math.cos(angle) * segLen;
    const ny = py + Math.sin(angle) * segLen;

    // Tentacle body — pink gradient darker at base
    const pinkR = 220 + Math.floor(t * 35);
    const pinkG = 120 + Math.floor(t * 30);
    const pinkB = 140 + Math.floor(t * 20);
    ctx.strokeStyle = `rgb(${pinkR},${pinkG},${pinkB})`;
    ctx.lineWidth = thickness * 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    // Sucker-like mouths along the tentacle
    if (s > 1 && s <= desc.mouthCount + 1) {
      const mx = (px + nx) / 2;
      const my = (py + ny) / 2;
      const mouthSize = thickness * 0.9;

      // Red lips — oval
      ctx.fillStyle = '#e01030';
      ctx.beginPath();
      ctx.ellipse(mx, my, mouthSize * 1.2, mouthSize * 0.7, angle, 0, TWO_PI);
      ctx.fill();

      // Dark mouth interior
      ctx.fillStyle = '#2a0008';
      ctx.beginPath();
      ctx.ellipse(mx, my, mouthSize * 0.7, mouthSize * 0.35, angle, 0, TWO_PI);
      ctx.fill();

      // Upper lip highlight
      ctx.fillStyle = '#ff4060';
      ctx.beginPath();
      ctx.ellipse(
        mx - Math.sin(angle) * mouthSize * 0.15,
        my + Math.cos(angle) * mouthSize * 0.15,
        mouthSize * 0.9,
        mouthSize * 0.2,
        angle,
        Math.PI,
        TWO_PI,
      );
      ctx.fill();
    }

    px = nx;
    py = ny;
  }

  ctx.restore();
  return { tipX: px, tipY: py };
}

/**
 * Draw the central body — bulbous mantle with beak and eye clusters.
 */
function drawBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  isEnraged: boolean,
  facingX: number,
  facingY: number,
): void {
  // Mantle — large bulbous top
  const mantleH = ts * 1.3;
  const mantleW = ts * 1.0;
  const mantleY = cy - ts * 0.6;

  // Shadow under body
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ts * 0.3, ts * 1.1, ts * 0.2, 0, 0, TWO_PI);
  ctx.fill();

  // Body base (where tentacles connect)
  ctx.fillStyle = isEnraged ? '#c04068' : '#d87090';
  ctx.beginPath();
  ctx.ellipse(cx, cy, ts * 0.85, ts * 0.55, 0, 0, TWO_PI);
  ctx.fill();

  // Mantle dome
  const pulse = Math.sin(time * 1.2) * 0.04;
  ctx.fillStyle = isEnraged ? '#a83058' : '#cc6888';
  ctx.beginPath();
  ctx.ellipse(cx, mantleY, mantleW * (1 + pulse), mantleH * (1 + pulse), 0, 0, TWO_PI);
  ctx.fill();

  // Mantle highlight
  ctx.fillStyle = isEnraged ? '#d0506a' : '#e89aa8';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.15, mantleY - ts * 0.25, mantleW * 0.45, mantleH * 0.5, -0.3, 0, TWO_PI);
  ctx.fill();

  // Eye clusters (3 groups of 2-3 eyes)
  const eyeGroups = [
    { ox: -0.3, oy: -0.5, count: 3 },
    { ox: 0.25, oy: -0.4, count: 2 },
    { ox: 0.0, oy: -0.85, count: 3 },
  ];

  for (const eg of eyeGroups) {
    for (let i = 0; i < eg.count; i++) {
      const ex = cx + eg.ox * ts + (i - eg.count / 2) * ts * 0.14;
      const ey = mantleY + eg.oy * ts + Math.sin(i * 2.1) * ts * 0.05;
      const er = ts * 0.08;

      // Eyeball
      ctx.fillStyle = '#e8e0c0';
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, TWO_PI);
      ctx.fill();

      // Pupil — tracks facing direction
      ctx.fillStyle = isEnraged ? '#ff2020' : '#1a1a00';
      ctx.beginPath();
      ctx.arc(ex + facingX * er * 0.35, ey + facingY * er * 0.35, er * 0.5, 0, TWO_PI);
      ctx.fill();

      // Eye glint
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(ex - er * 0.2, ey - er * 0.25, er * 0.2, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Beak (parrot-like, at the body centre)
  const beakY = cy + ts * 0.05;
  const beakOpen = 0.08 + Math.sin(time * 3) * 0.04;

  // Upper beak
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.15, beakY);
  ctx.quadraticCurveTo(cx, beakY - ts * 0.18, cx + ts * 0.15, beakY);
  ctx.quadraticCurveTo(cx, beakY + ts * beakOpen, cx - ts * 0.15, beakY);
  ctx.fill();

  // Lower beak
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.12, beakY + ts * 0.02);
  ctx.quadraticCurveTo(cx, beakY + ts * 0.16, cx + ts * 0.12, beakY + ts * 0.02);
  ctx.quadraticCurveTo(cx, beakY + ts * beakOpen + ts * 0.02, cx - ts * 0.12, beakY + ts * 0.02);
  ctx.fill();

  // Enrage glow
  if (isEnraged) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 4);
    ctx.strokeStyle = '#ff2020';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy - ts * 0.2, ts * 1.3, ts * 1.5, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Draw the slam shadow warning on the ground.
 */
export function drawSlamShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  progress: number, // 0–1 how close to impact
): void {
  const radius = ts * 1.5;
  const alpha = 0.15 + progress * 0.5;
  const pulseScale = 1 + Math.sin(progress * Math.PI * 6) * 0.08;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Outer warning ring
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2 + progress * 2;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale, 0, TWO_PI);
  ctx.stroke();

  // Inner dark shadow
  ctx.fillStyle = '#200000';
  ctx.beginPath();
  ctx.arc(x, y, radius * progress * 0.8, 0, TWO_PI);
  ctx.fill();

  // Red fill
  ctx.fillStyle = '#ff0000';
  ctx.globalAlpha = alpha * 0.4;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale, 0, TWO_PI);
  ctx.fill();

  ctx.restore();
}

/**
 * Draw the slam impact effect.
 */
export function drawSlamImpact(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  progress: number, // 0–1 (0 = just hit, 1 = fading)
): void {
  const radius = ts * 1.5 + progress * ts * 1.5;
  const alpha = (1 - progress) * 0.8;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Shockwave ring
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = 4 * (1 - progress);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.stroke();

  // Debris particles (cracks in the floor)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * TWO_PI;
    const dist = radius * 0.6 * (0.5 + progress * 0.5);
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    ctx.fillStyle = '#8a7060';
    ctx.fillRect(px - 2, py - 2, 4, 4);
  }

  ctx.restore();
}

/**
 * Main sprite draw function for the Krakaren Clone.
 */
export function drawKrakarenSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  time: number,
  isEnraged: boolean,
  facingX: number,
  facingY: number,
  attackTentacle: number, // -1 if no melee attack, else tentacle index
  attackProgress: number, // 0–1 for melee swing
): void {
  // Centre of the boss (body occupies ~1 tile but visuals extend 3×3)
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.5;

  // Draw tentacles behind body first (back half)
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const desc = TENTACLES[i];
    if (desc.baseAngle > Math.PI * 0.25 && desc.baseAngle < Math.PI * 1.75) {
      drawTentacle(ctx, cx, cy, ts, desc, time, attackTentacle, i, attackProgress);
    }
  }

  // Draw body
  drawBody(ctx, cx, cy, ts, time, isEnraged, facingX, facingY);

  // Draw tentacles in front (front half)
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const desc = TENTACLES[i];
    if (!(desc.baseAngle > Math.PI * 0.25 && desc.baseAngle < Math.PI * 1.75)) {
      drawTentacle(ctx, cx, cy, ts, desc, time, attackTentacle, i, attackProgress);
    }
  }
}
