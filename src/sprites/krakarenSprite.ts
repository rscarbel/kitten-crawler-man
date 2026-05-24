/**
 * Draws the Krakaren Clone boss sprite — a massive immobile octopus monster
 * with a beaked mouth, clusters of eyes, and pink tentacles covered in
 * human-shaped mouths with bright red lips.
 *
 * The boss is ~20 ft tall (occupies ~3×3 tiles visually) but collision stays
 * within a single tile.
 */

const TWO_PI = Math.PI * 2;

const TENTACLE_COUNT = 10;
const TENTACLE_REACH_SCALE = 2.8;
const TENTACLE_SEGMENTS = 8;
const TENTACLE_PHASE_STRIDE = 7;
const TENTACLE_PHASE_MOD = 11;
const TENTACLE_MOUTH_COUNT_MOD = 3;
const TENTACLE_LENGTH_BASE = 0.7;
const TENTACLE_LENGTH_RANGE = 0.3;
const TENTACLE_PHASE_STEP = 1.3;
const TENTACLE_ANGLE_OFFSET_POS = 0.15;
const TENTACLE_ANGLE_OFFSET_NEG = -0.15;
const TENTACLE_SWAY_FREQ = 1.5;
const TENTACLE_SWAY_AMPLITUDE = 0.15;
const TENTACLE_CURL_FREQ = 2.0;
const TENTACLE_CURL_AMPLITUDE = 0.12;
const TENTACLE_CURL_SEGMENT_SCALE = 0.7;
const TENTACLE_THICKNESS_BASE = 0.22;
const TENTACLE_THICKNESS_TAPER = 0.18;
const TENTACLE_PINK_R_BASE = 220;
const TENTACLE_PINK_G_BASE = 120;
const TENTACLE_PINK_B_BASE = 140;
const TENTACLE_PINK_R_RANGE = 35;
const TENTACLE_PINK_G_RANGE = 30;
const TENTACLE_PINK_B_RANGE = 20;
const TENTACLE_LINEWIDTH_SCALE = 2;
const TENTACLE_MOUTH_START_SEGMENT = 1; // first mouth starts after segment 1
const TENTACLE_SWING_AMPLITUDE = 1.2;

const MOUTH_OUTER_LIP_RX = 1.2;
const MOUTH_OUTER_LIP_RY = 0.7;
const MOUTH_INNER_RX = 0.7;
const MOUTH_INNER_RY = 0.35;
const MOUTH_HIGHLIGHT_RX = 0.9;
const MOUTH_HIGHLIGHT_RY = 0.2;
const MOUTH_HIGHLIGHT_OFFSET = 0.15;

const BODY_MANTLE_HEIGHT_SCALE = 1.3;
const BODY_MANTLE_WIDTH_SCALE = 1.0;
const BODY_MANTLE_Y_OFFSET = 0.6;
const BODY_SHADOW_Y_OFFSET = 0.3;
const BODY_SHADOW_RX = 1.1;
const BODY_SHADOW_RY = 0.2;
const BODY_BASE_RX = 0.85;
const BODY_BASE_RY = 0.55;
const BODY_PULSE_FREQ = 1.2;
const BODY_PULSE_AMPLITUDE = 0.04;
const BODY_HIGHLIGHT_X_OFFSET = 0.15;
const BODY_HIGHLIGHT_Y_OFFSET = 0.25;
const BODY_HIGHLIGHT_RX_SCALE = 0.45;
const BODY_HIGHLIGHT_RY_SCALE = 0.5;
const BODY_HIGHLIGHT_ANGLE = -0.3;

const EYE_STEP = 0.14;
const EYE_SWAY_FREQ = 2.1;
const EYE_SWAY_AMPLITUDE = 0.05;
const EYE_R = 0.08;
const EYE_PUPIL_SCALE = 0.5;
const EYE_PUPIL_TRACK = 0.35;
const EYE_GLINT_OFFSET_X = 0.2;
const EYE_GLINT_OFFSET_Y = 0.25;
const EYE_GLINT_SCALE = 0.2;

const BEAK_Y_OFFSET = 0.05;
const BEAK_OPEN_BASE = 0.08;
const BEAK_OPEN_FREQ = 3;
const BEAK_OPEN_AMPLITUDE = 0.04;
const BEAK_WIDTH_HALF = 0.15;
const BEAK_UPPER_HEIGHT = 0.18;
const BEAK_LOWER_MARGIN = 0.02;
const BEAK_LOWER_WIDTH = 0.12;
const BEAK_LOWER_HEIGHT = 0.16;

const ENRAGE_GLOW_BASE_ALPHA = 0.25;
const ENRAGE_GLOW_PULSE_AMPLITUDE = 0.15;
const ENRAGE_GLOW_FREQ = 4;
const ENRAGE_GLOW_LINEWIDTH = 3;
const ENRAGE_GLOW_RX = 1.3;
const ENRAGE_GLOW_RY = 1.5;
const ENRAGE_GLOW_Y_OFFSET = 0.2;

const SLAM_RADIUS_SCALE = 1.5;
const SLAM_ALPHA_BASE = 0.15;
const SLAM_ALPHA_SCALE = 0.5;
const SLAM_PULSE_FREQ = 6;
const SLAM_PULSE_AMPLITUDE = 0.08;
const SLAM_INNER_SHADOW_SCALE = 0.8;
const SLAM_RED_ALPHA_SCALE = 0.4;
const SLAM_IMPACT_RADIUS_GROW = 1.5;
const SLAM_IMPACT_ALPHA = 0.8;
const SLAM_IMPACT_LINEWIDTH_BASE = 4;
const SLAM_IMPACT_DEBRIS_COUNT = 8;
const SLAM_IMPACT_DEBRIS_SPREAD = 0.6;
const SLAM_IMPACT_DEBRIS_SPREAD_GROW = 0.5;
const SLAM_IMPACT_DEBRIS_SIZE = 4;
const SLAM_IMPACT_DEBRIS_HALF = 2;

const SPRITE_CENTER_X = 0.5;
const SPRITE_CENTER_Y = 0.5;

const TENTACLE_FRONT_ANGLE_MIN = 0.25;
const TENTACLE_FRONT_ANGLE_MAX = 1.75;

const EYE_GROUP_LEFT_OX = -0.3;
const EYE_GROUP_LEFT_OY = -0.5;
const EYE_GROUP_MID_OX = 0.25;
const EYE_GROUP_MID_OY = -0.4;
const EYE_GROUP_TOP_OX = 0.0;
const EYE_GROUP_TOP_OY = -0.85;
const EYE_GROUP_COUNT_LARGE = 3;
const EYE_GROUP_COUNT_SMALL = 2;

/** Per-tentacle persistent data for idle sway. */
interface TentacleDesc {
  baseAngle: number; // radial angle from body centre
  length: number; // 0–1 multiplier of max tentacle reach
  phase: number; // animation phase offset
  mouthCount: number; // how many mouths on this tentacle
}

/** Pre-generated tentacle descriptors (deterministic per instance via seed). */
function buildTentacles(): TentacleDesc[] {
  const out: TentacleDesc[] = [];
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    out.push({
      baseAngle:
        (i / TENTACLE_COUNT) * TWO_PI +
        (i % 2 === 0 ? TENTACLE_ANGLE_OFFSET_POS : TENTACLE_ANGLE_OFFSET_NEG),
      length:
        TENTACLE_LENGTH_BASE +
        (((i * TENTACLE_PHASE_STRIDE + TENTACLE_MOUTH_COUNT_MOD) % TENTACLE_PHASE_MOD) /
          TENTACLE_PHASE_MOD) *
          TENTACLE_LENGTH_RANGE,
      phase: i * TENTACLE_PHASE_STEP,
      mouthCount: TENTACLE_MOUTH_COUNT_MOD + (i % TENTACLE_MOUTH_COUNT_MOD),
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
  const reach = ts * TENTACLE_REACH_SCALE * desc.length;
  const segments = TENTACLE_SEGMENTS;
  const segLen = reach / segments;

  // Melee attack: the attacking tentacle sweeps forward rapidly
  let swingOffset = 0;
  if (attackTentacle === tentacleIndex && attackProgress > 0) {
    swingOffset = Math.sin(attackProgress * Math.PI) * TENTACLE_SWING_AMPLITUDE;
  }

  const sway =
    Math.sin(time * TENTACLE_SWAY_FREQ + desc.phase) * TENTACLE_SWAY_AMPLITUDE + swingOffset;
  let angle = desc.baseAngle + sway;
  let px = cx;
  let py = cy;

  ctx.save();
  ctx.lineCap = 'round';

  for (let s = 0; s < segments; s++) {
    const t = s / segments;
    const thickness = ts * (TENTACLE_THICKNESS_BASE - t * TENTACLE_THICKNESS_TAPER);
    const curlAmount =
      Math.sin(time * TENTACLE_CURL_FREQ + desc.phase + s * TENTACLE_CURL_SEGMENT_SCALE) *
      TENTACLE_CURL_AMPLITUDE *
      (1 + t);
    angle += curlAmount;

    const nx = px + Math.cos(angle) * segLen;
    const ny = py + Math.sin(angle) * segLen;

    // Tentacle body — pink gradient darker at base
    const pinkR = TENTACLE_PINK_R_BASE + Math.floor(t * TENTACLE_PINK_R_RANGE);
    const pinkG = TENTACLE_PINK_G_BASE + Math.floor(t * TENTACLE_PINK_G_RANGE);
    const pinkB = TENTACLE_PINK_B_BASE + Math.floor(t * TENTACLE_PINK_B_RANGE);
    ctx.strokeStyle = `rgb(${pinkR},${pinkG},${pinkB})`;
    ctx.lineWidth = thickness * TENTACLE_LINEWIDTH_SCALE;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    // Sucker-like mouths along the tentacle
    if (s > TENTACLE_MOUTH_START_SEGMENT && s <= desc.mouthCount + TENTACLE_MOUTH_START_SEGMENT) {
      const mx = (px + nx) / 2;
      const my = (py + ny) / 2;
      const mouthSize = thickness * BODY_BASE_RX;

      // Red lips — oval
      ctx.fillStyle = '#e01030';
      ctx.beginPath();
      ctx.ellipse(
        mx,
        my,
        mouthSize * MOUTH_OUTER_LIP_RX,
        mouthSize * MOUTH_OUTER_LIP_RY,
        angle,
        0,
        TWO_PI,
      );
      ctx.fill();

      // Dark mouth interior
      ctx.fillStyle = '#2a0008';
      ctx.beginPath();
      ctx.ellipse(mx, my, mouthSize * MOUTH_INNER_RX, mouthSize * MOUTH_INNER_RY, angle, 0, TWO_PI);
      ctx.fill();

      // Upper lip highlight
      ctx.fillStyle = '#ff4060';
      ctx.beginPath();
      ctx.ellipse(
        mx - Math.sin(angle) * mouthSize * MOUTH_HIGHLIGHT_OFFSET,
        my + Math.cos(angle) * mouthSize * MOUTH_HIGHLIGHT_OFFSET,
        mouthSize * MOUTH_HIGHLIGHT_RX,
        mouthSize * MOUTH_HIGHLIGHT_RY,
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
  const mantleH = ts * BODY_MANTLE_HEIGHT_SCALE;
  const mantleW = ts * BODY_MANTLE_WIDTH_SCALE;
  const mantleY = cy - ts * BODY_MANTLE_Y_OFFSET;

  // Shadow under body
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + ts * BODY_SHADOW_Y_OFFSET,
    ts * BODY_SHADOW_RX,
    ts * BODY_SHADOW_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Body base (where tentacles connect)
  ctx.fillStyle = isEnraged ? '#c04068' : '#d87090';
  ctx.beginPath();
  ctx.ellipse(cx, cy, ts * BODY_BASE_RX, ts * BODY_BASE_RY, 0, 0, TWO_PI);
  ctx.fill();

  // Mantle dome
  const pulse = Math.sin(time * BODY_PULSE_FREQ) * BODY_PULSE_AMPLITUDE;
  ctx.fillStyle = isEnraged ? '#a83058' : '#cc6888';
  ctx.beginPath();
  ctx.ellipse(cx, mantleY, mantleW * (1 + pulse), mantleH * (1 + pulse), 0, 0, TWO_PI);
  ctx.fill();

  // Mantle highlight
  ctx.fillStyle = isEnraged ? '#d0506a' : '#e89aa8';
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * BODY_HIGHLIGHT_X_OFFSET,
    mantleY - ts * BODY_HIGHLIGHT_Y_OFFSET,
    mantleW * BODY_HIGHLIGHT_RX_SCALE,
    mantleH * BODY_HIGHLIGHT_RY_SCALE,
    BODY_HIGHLIGHT_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Eye clusters (3 groups of 2-3 eyes)
  const eyeGroups = [
    { ox: EYE_GROUP_LEFT_OX, oy: EYE_GROUP_LEFT_OY, count: EYE_GROUP_COUNT_LARGE },
    { ox: EYE_GROUP_MID_OX, oy: EYE_GROUP_MID_OY, count: EYE_GROUP_COUNT_SMALL },
    { ox: EYE_GROUP_TOP_OX, oy: EYE_GROUP_TOP_OY, count: EYE_GROUP_COUNT_LARGE },
  ];

  for (const eg of eyeGroups) {
    for (let i = 0; i < eg.count; i++) {
      const ex = cx + eg.ox * ts + (i - eg.count / 2) * ts * EYE_STEP;
      const ey = mantleY + eg.oy * ts + Math.sin(i * EYE_SWAY_FREQ) * ts * EYE_SWAY_AMPLITUDE;
      const er = ts * EYE_R;

      // Eyeball
      ctx.fillStyle = '#e8e0c0';
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, TWO_PI);
      ctx.fill();

      // Pupil — tracks facing direction
      ctx.fillStyle = isEnraged ? '#ff2020' : '#1a1a00';
      ctx.beginPath();
      ctx.arc(
        ex + facingX * er * EYE_PUPIL_TRACK,
        ey + facingY * er * EYE_PUPIL_TRACK,
        er * EYE_PUPIL_SCALE,
        0,
        TWO_PI,
      );
      ctx.fill();

      // Eye glint
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(
        ex - er * EYE_GLINT_OFFSET_X,
        ey - er * EYE_GLINT_OFFSET_Y,
        er * EYE_GLINT_SCALE,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }

  // Beak (parrot-like, at the body centre)
  const beakY = cy + ts * BEAK_Y_OFFSET;
  const beakOpen = BEAK_OPEN_BASE + Math.sin(time * BEAK_OPEN_FREQ) * BEAK_OPEN_AMPLITUDE;

  // Upper beak
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.moveTo(cx - ts * BEAK_WIDTH_HALF, beakY);
  ctx.quadraticCurveTo(cx, beakY - ts * BEAK_UPPER_HEIGHT, cx + ts * BEAK_WIDTH_HALF, beakY);
  ctx.quadraticCurveTo(cx, beakY + ts * beakOpen, cx - ts * BEAK_WIDTH_HALF, beakY);
  ctx.fill();

  // Lower beak
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath();
  ctx.moveTo(cx - ts * BEAK_LOWER_WIDTH, beakY + ts * BEAK_LOWER_MARGIN);
  ctx.quadraticCurveTo(
    cx,
    beakY + ts * BEAK_LOWER_HEIGHT,
    cx + ts * BEAK_LOWER_WIDTH,
    beakY + ts * BEAK_LOWER_MARGIN,
  );
  ctx.quadraticCurveTo(
    cx,
    beakY + ts * beakOpen + ts * BEAK_LOWER_MARGIN,
    cx - ts * BEAK_LOWER_WIDTH,
    beakY + ts * BEAK_LOWER_MARGIN,
  );
  ctx.fill();

  // Enrage glow
  if (isEnraged) {
    ctx.save();
    ctx.globalAlpha =
      ENRAGE_GLOW_BASE_ALPHA + ENRAGE_GLOW_PULSE_AMPLITUDE * Math.sin(time * ENRAGE_GLOW_FREQ);
    ctx.strokeStyle = '#ff2020';
    ctx.lineWidth = ENRAGE_GLOW_LINEWIDTH;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy - ts * ENRAGE_GLOW_Y_OFFSET,
      ts * ENRAGE_GLOW_RX,
      ts * ENRAGE_GLOW_RY,
      0,
      0,
      TWO_PI,
    );
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
  const radius = ts * SLAM_RADIUS_SCALE;
  const alpha = SLAM_ALPHA_BASE + progress * SLAM_ALPHA_SCALE;
  const pulseScale = 1 + Math.sin(progress * Math.PI * SLAM_PULSE_FREQ) * SLAM_PULSE_AMPLITUDE;

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
  ctx.arc(x, y, radius * progress * SLAM_INNER_SHADOW_SCALE, 0, TWO_PI);
  ctx.fill();

  // Red fill
  ctx.fillStyle = '#ff0000';
  ctx.globalAlpha = alpha * SLAM_RED_ALPHA_SCALE;
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
  const radius = ts * SLAM_RADIUS_SCALE + progress * ts * SLAM_IMPACT_RADIUS_GROW;
  const alpha = (1 - progress) * SLAM_IMPACT_ALPHA;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Shockwave ring
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = SLAM_IMPACT_LINEWIDTH_BASE * (1 - progress);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.stroke();

  // Debris particles (cracks in the floor)
  for (let i = 0; i < SLAM_IMPACT_DEBRIS_COUNT; i++) {
    const angle = (i / SLAM_IMPACT_DEBRIS_COUNT) * TWO_PI;
    const dist =
      radius *
      SLAM_IMPACT_DEBRIS_SPREAD *
      (SLAM_ALPHA_SCALE + progress * SLAM_IMPACT_DEBRIS_SPREAD_GROW);
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    ctx.fillStyle = '#8a7060';
    ctx.fillRect(
      px - SLAM_IMPACT_DEBRIS_HALF,
      py - SLAM_IMPACT_DEBRIS_HALF,
      SLAM_IMPACT_DEBRIS_SIZE,
      SLAM_IMPACT_DEBRIS_SIZE,
    );
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
  const cx = sx + ts * SPRITE_CENTER_X;
  const cy = sy + ts * SPRITE_CENTER_Y;

  // Draw tentacles behind body first (back half)
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const desc = TENTACLES[i];
    if (
      desc.baseAngle > Math.PI * TENTACLE_FRONT_ANGLE_MIN &&
      desc.baseAngle < Math.PI * TENTACLE_FRONT_ANGLE_MAX
    ) {
      drawTentacle(ctx, cx, cy, ts, desc, time, attackTentacle, i, attackProgress);
    }
  }

  // Draw body
  drawBody(ctx, cx, cy, ts, time, isEnraged, facingX, facingY);

  // Draw tentacles in front (front half)
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const desc = TENTACLES[i];
    if (
      !(
        desc.baseAngle > Math.PI * TENTACLE_FRONT_ANGLE_MIN &&
        desc.baseAngle < Math.PI * TENTACLE_FRONT_ANGLE_MAX
      )
    ) {
      drawTentacle(ctx, cx, cy, ts, desc, time, attackTentacle, i, attackProgress);
    }
  }
}
