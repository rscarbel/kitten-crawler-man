/**
 * Procedural drawing functions for the Grotesque Spider spit attack effects:
 *   drawSpitProjectile   — viscous olive-green glob in flight (8-frame wobble loop)
 *   drawSpitTrapSplat    — initial landing splat expanding on ground (8 frames, 0→1)
 *   drawSpitTrapIdle     — sticky puddle sitting on the ground (8-frame loop)
 *
 * All three are centred on (cx, cy) so callers can position them freely.
 * The projectile is designed to be drawn with drawSpriteKey opts.rotation set
 * to the flight angle — its +x axis points in the leading direction.
 */

const TWO_PI = Math.PI * 2;

// ── Spit projectile ───────────────────────────────────────────────────────────

// Projectile animation constants
const PROJECTILE_FRAME_COUNT = 8;
const PROJECTILE_MAIN_GLOB_X_RATIO = 0.345;
const PROJECTILE_MAIN_GLOB_X_WOBBLE = 0.038;
const PROJECTILE_MAIN_GLOB_Y_RATIO = 0.275;
const PROJECTILE_MAIN_GLOB_Y_WOBBLE = 0.03;
const PROJECTILE_GLOB_ALPHA = 0.9;
const PROJECTILE_HIGHLIGHT_ALPHA = 0.65;
const PROJECTILE_SHADOW_ALPHA = 0.42;
const PROJECTILE_SPECULAR_ALPHA = 0.52;
const PROJECTILE_SPECULAR_X_RATIO = 0.32;
const PROJECTILE_SPECULAR_Y_RATIO = 0.36;
const PROJECTILE_SPECULAR_W_RATIO = 0.27;
const PROJECTILE_SPECULAR_H_RATIO = 0.2;
const PROJECTILE_SPECULAR_ANGLE = -0.35;
const PROJECTILE_HIGHLIGHT_OFFSET_X = 0.065;
const PROJECTILE_HIGHLIGHT_OFFSET_Y = 0.038;
const PROJECTILE_HIGHLIGHT_W_RATIO = 0.74;
const PROJECTILE_HIGHLIGHT_H_RATIO = 0.78;
const PROJECTILE_HIGHLIGHT_ANGLE = -0.28;
const PROJECTILE_SHADOW_OFFSET_X = 0.055;
const PROJECTILE_SHADOW_OFFSET_Y = 0.03;
const PROJECTILE_SHADOW_W_RATIO = 0.44;
const PROJECTILE_SHADOW_H_RATIO = 0.46;
const PROJECTILE_SHADOW_ANGLE = 0.18;
const PROJECTILE_TRAIL_COUNT = 3;
const PROJECTILE_TRAIL_SPACING = 0.065;
const PROJECTILE_TRAIL_BASE_LEN = 0.52;
const PROJECTILE_TRAIL_LEN_INCREMENT = 0.14;
const PROJECTILE_TRAIL_DROOP_AMOUNT = 0.06;
const PROJECTILE_TRAIL_DROOP_FREQ = 1.1;
const PROJECTILE_TRAIL_BASE_WIDTH = 0.07;
const PROJECTILE_TRAIL_WIDTH_DECREMENT = 0.018;
const PROJECTILE_TRAIL_ATTACH_X = 0.3;
const PROJECTILE_TRAIL_CP_X_RATIO = 0.45;
const PROJECTILE_TRAIL_CP_Y_RATIO = 0.55;
const PROJECTILE_TRAIL_END_Y_RATIO = 0.8;
const PROJECTILE_TRAIL_END_Y_DROOP_FACTOR = 0.5;
const PROJECTILE_DROP_OFFSET_Y = 0.038;
const PROJECTILE_DROP_WOBBLE_FREQ = 1.3;
const PROJECTILE_DROP_RADIUS = 0.058;
const PROJECTILE_DROP_TRAIL_RATIO = 1.28;
const PROJECTILE_DROP_ALPHA = 0.62;

/**
 * Draw the in-flight spit glob centred on (cx, cy).
 * @param frame  0–7 animation frame (drives wobble deformation)
 * @param ts     tile size the sprite was designed for (matches manifest tileScale)
 */
export function drawSpitProjectile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  const wobble = (frame / PROJECTILE_FRAME_COUNT) * TWO_PI;

  // Three trailing slime strings — drawn first so the blob sits on top
  ctx.save();
  ctx.lineCap = 'round';
  const trailColors: readonly string[] = [
    'rgba(52,66,7,0.52)',
    'rgba(44,58,5,0.40)',
    'rgba(60,76,9,0.36)',
  ];
  for (let i = 0; i < PROJECTILE_TRAIL_COUNT; i++) {
    const yOff = (i - 1) * ts * PROJECTILE_TRAIL_SPACING;
    const trailLen = ts * (PROJECTILE_TRAIL_BASE_LEN + i * PROJECTILE_TRAIL_LEN_INCREMENT);
    const droopAmt =
      ts * PROJECTILE_TRAIL_DROOP_AMOUNT * Math.sin(wobble + i * PROJECTILE_TRAIL_DROOP_FREQ);
    ctx.strokeStyle = trailColors[i];
    ctx.lineWidth = ts * (PROJECTILE_TRAIL_BASE_WIDTH - i * PROJECTILE_TRAIL_WIDTH_DECREMENT);
    ctx.beginPath();
    ctx.moveTo(cx - ts * PROJECTILE_TRAIL_ATTACH_X, cy + yOff);
    ctx.quadraticCurveTo(
      cx - ts * PROJECTILE_TRAIL_ATTACH_X - trailLen * PROJECTILE_TRAIL_CP_X_RATIO + droopAmt,
      cy + yOff * PROJECTILE_TRAIL_CP_Y_RATIO + droopAmt,
      cx - ts * PROJECTILE_TRAIL_ATTACH_X - trailLen,
      cy +
        yOff * PROJECTILE_TRAIL_END_Y_RATIO +
        droopAmt * (1 + i * PROJECTILE_TRAIL_END_Y_DROOP_FACTOR),
    );
    ctx.stroke();
  }
  ctx.restore();

  // Main glob body — two overlapping ellipses for an irregular feel
  const rx = ts * (PROJECTILE_MAIN_GLOB_X_RATIO + Math.sin(wobble) * PROJECTILE_MAIN_GLOB_X_WOBBLE);
  const ry = ts * (PROJECTILE_MAIN_GLOB_Y_RATIO - Math.cos(wobble) * PROJECTILE_MAIN_GLOB_Y_WOBBLE);

  ctx.save();
  ctx.globalAlpha = PROJECTILE_GLOB_ALPHA;
  ctx.fillStyle = '#4a5e0a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = PROJECTILE_HIGHLIGHT_ALPHA;
  ctx.fillStyle = '#607010';
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * PROJECTILE_HIGHLIGHT_OFFSET_X,
    cy - ts * PROJECTILE_HIGHLIGHT_OFFSET_Y,
    rx * PROJECTILE_HIGHLIGHT_W_RATIO,
    ry * PROJECTILE_HIGHLIGHT_H_RATIO,
    PROJECTILE_HIGHLIGHT_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Sickly inner shadow
  ctx.globalAlpha = PROJECTILE_SHADOW_ALPHA;
  ctx.fillStyle = '#38480a';
  ctx.beginPath();
  ctx.ellipse(
    cx + ts * PROJECTILE_SHADOW_OFFSET_X,
    cy + ts * PROJECTILE_SHADOW_OFFSET_Y,
    rx * PROJECTILE_SHADOW_W_RATIO,
    ry * PROJECTILE_SHADOW_H_RATIO,
    PROJECTILE_SHADOW_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Specular highlight
  ctx.globalAlpha = PROJECTILE_SPECULAR_ALPHA;
  ctx.fillStyle = 'rgba(160,200,40,0.55)';
  ctx.beginPath();
  ctx.ellipse(
    cx - rx * PROJECTILE_SPECULAR_X_RATIO,
    cy - ry * PROJECTILE_SPECULAR_Y_RATIO,
    rx * PROJECTILE_SPECULAR_W_RATIO,
    ry * PROJECTILE_SPECULAR_H_RATIO,
    PROJECTILE_SPECULAR_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.restore();

  // Small trailing droplet
  const dropX =
    cx - rx * PROJECTILE_DROP_TRAIL_RATIO + Math.sin(wobble) * ts * PROJECTILE_DROP_OFFSET_Y;
  const dropY = cy + ts * PROJECTILE_DROP_OFFSET_Y * Math.cos(wobble * PROJECTILE_DROP_WOBBLE_FREQ);
  ctx.save();
  ctx.globalAlpha = PROJECTILE_DROP_ALPHA;
  ctx.fillStyle = '#4a5e08';
  ctx.beginPath();
  ctx.arc(dropX, dropY, ts * PROJECTILE_DROP_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Web strand data for the idle trap ────────────────────────────────────────

interface WebStrand {
  readonly aAngle: number;
  readonly bAngle: number;
  readonly rA: number;
  readonly rB: number;
  readonly phase: number;
}

// Web strand generation constants
const WEB_STRAND_COUNT = 8;
const WEB_HASH1_MULT = 137;
const WEB_HASH1_ADD = 11;
const WEB_HASH1_MOD = 97;
const WEB_HASH2_MULT = 73;
const WEB_HASH2_ADD = 29;
const WEB_HASH2_MOD = 89;
const WEB_ANGLE_A_SPREAD = 0.45;
const WEB_ANGLE_B_OFFSET = 0.62; // fraction of PI offset for B end
const WEB_ANGLE_B_SPREAD = 0.85;
const WEB_RA_BASE = 0.7;
const WEB_RA_INCREMENT = 0.1;
const WEB_RA_MOD = 3;
const WEB_RB_BASE = 0.65;
const WEB_RB_INCREMENT = 0.08;
const WEB_RB_MOD = 4;

function buildWebStrands(): readonly WebStrand[] {
  const out: WebStrand[] = [];
  for (let i = 0; i < WEB_STRAND_COUNT; i++) {
    const h1 = (i * WEB_HASH1_MULT + WEB_HASH1_ADD) % WEB_HASH1_MOD;
    const h2 = (i * WEB_HASH2_MULT + WEB_HASH2_ADD) % WEB_HASH2_MOD;
    out.push({
      aAngle: (i / WEB_STRAND_COUNT) * TWO_PI + (h1 / WEB_HASH1_MOD) * WEB_ANGLE_A_SPREAD,
      bAngle:
        (i / WEB_STRAND_COUNT) * TWO_PI +
        Math.PI * WEB_ANGLE_B_OFFSET +
        (h2 / WEB_HASH2_MOD) * WEB_ANGLE_B_SPREAD,
      rA: WEB_RA_BASE + (h1 % WEB_RA_MOD) * WEB_RA_INCREMENT,
      rB: WEB_RB_BASE + (h2 % WEB_RB_MOD) * WEB_RB_INCREMENT,
      phase: (i / WEB_STRAND_COUNT) * TWO_PI,
    });
  }
  return out;
}

const WEB_STRANDS = buildWebStrands();

// ── Spit trap: splat landing animation ───────────────────────────────────────

// Splat animation constants
const SPLAT_FRAME_MAX = 7;
const SPLAT_MAX_RADIUS_RATIO = 1.48;
const SPLAT_INITIAL_R_FRACTION = 0.07;
const SPLAT_GROW_FRACTION = 0.93;
const SPLAT_DROP_BASE_COUNT = 7;
const SPLAT_DROP_FRAME_MULT = 1.5;
const SPLAT_DROP_ANGLE_SPREAD = 0.18;
const SPLAT_DROP_DIST_BASE = 0.55;
const SPLAT_DROP_DIST_MOD = 4;
const SPLAT_DROP_DIST_INCREMENT = 0.12;
const SPLAT_DROP_DIST_SCALE_BASE = 0.5;
const SPLAT_DROP_RADIUS_BASE = 0.052;
const SPLAT_DROP_RADIUS_DECREMENT = 0.011;
const SPLAT_DROP_RADIUS_MOD = 3;
const SPLAT_DROP_SHRINK_FACTOR = 0.55;
const SPLAT_DROP_MIN_RADIUS = 0.5;
const SPLAT_OUTER_RING_ALPHA_SCALE = 0.45;
const SPLAT_OUTER_RING_W_RATIO = 1.08;
const SPLAT_OUTER_RING_H_RATIO = 0.74;
const SPLAT_PUDDLE_ALPHA_BASE = 0.28;
const SPLAT_PUDDLE_ALPHA_SCALE = 0.45;
const SPLAT_PUDDLE_W_RATIO = 1.06;
const SPLAT_PUDDLE_H_RATIO = 0.72;
const SPLAT_BRIGHT_ALPHA_BASE = 0.48;
const SPLAT_BRIGHT_ALPHA_SCALE = 0.22;
const SPLAT_BRIGHT_W_RATIO = 0.82;
const SPLAT_BRIGHT_H_RATIO = 0.58;
const SPLAT_BRIGHT_OFFSET_X = 0.06;
const SPLAT_BRIGHT_OFFSET_Y = 0.04;
const SPLAT_BRIGHT_ANGLE = -0.1;
const SPLAT_GLEAM_THRESHOLD = 0.5;
const SPLAT_GLEAM_ALPHA_SCALE = 0.22;
const SPLAT_GLEAM_OFFSET_X = 0.22;
const SPLAT_GLEAM_OFFSET_Y = 0.26;
const SPLAT_GLEAM_W_RATIO = 0.28;
const SPLAT_GLEAM_H_RATIO = 0.18;
const SPLAT_GLEAM_ANGLE = -0.25;

/**
 * Draw the spit landing splat.
 * @param frame  0–7, where 0 = impact and 7 = fully spread
 * @param ts     tile size matching the manifest tileScale
 */
export function drawSpitTrapSplat(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  const progress = frame / SPLAT_FRAME_MAX;
  const maxR = ts * SPLAT_MAX_RADIUS_RATIO;
  const r = maxR * (SPLAT_INITIAL_R_FRACTION + progress * SPLAT_GROW_FRACTION);

  ctx.save();

  // Radial splash droplets — fly outward then shrink
  const dropCount = SPLAT_DROP_BASE_COUNT + Math.floor(frame * SPLAT_DROP_FRAME_MULT);
  ctx.fillStyle = 'rgba(66,84,10,0.55)';
  for (let i = 0; i < dropCount; i++) {
    const angle = (i / dropCount) * TWO_PI + (i % SPLAT_DROP_RADIUS_MOD) * SPLAT_DROP_ANGLE_SPREAD;
    const distFrac = SPLAT_DROP_DIST_BASE + (i % SPLAT_DROP_DIST_MOD) * SPLAT_DROP_DIST_INCREMENT;
    const dist =
      r * distFrac * (SPLAT_DROP_DIST_SCALE_BASE + progress * SPLAT_DROP_DIST_SCALE_BASE);
    const dropR =
      ts *
      (SPLAT_DROP_RADIUS_BASE - (i % SPLAT_DROP_RADIUS_MOD) * SPLAT_DROP_RADIUS_DECREMENT) *
      (1 - progress * SPLAT_DROP_SHRINK_FACTOR);
    if (dropR > SPLAT_DROP_MIN_RADIUS) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, dropR, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Thin outer splash ring
  ctx.globalAlpha = (1 - progress) * SPLAT_OUTER_RING_ALPHA_SCALE;
  ctx.strokeStyle = '#506010';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * SPLAT_OUTER_RING_W_RATIO, r * SPLAT_OUTER_RING_H_RATIO, 0, 0, TWO_PI);
  ctx.stroke();

  // Main puddle (building up)
  ctx.globalAlpha = SPLAT_PUDDLE_ALPHA_BASE + progress * SPLAT_PUDDLE_ALPHA_SCALE;
  ctx.fillStyle = '#384808';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * SPLAT_PUDDLE_W_RATIO, r * SPLAT_PUDDLE_H_RATIO, 0, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = SPLAT_BRIGHT_ALPHA_BASE + progress * SPLAT_BRIGHT_ALPHA_SCALE;
  ctx.fillStyle = '#4c6010';
  ctx.beginPath();
  ctx.ellipse(
    cx - r * SPLAT_BRIGHT_OFFSET_X,
    cy - r * SPLAT_BRIGHT_OFFSET_Y,
    r * SPLAT_BRIGHT_W_RATIO,
    r * SPLAT_BRIGHT_H_RATIO,
    SPLAT_BRIGHT_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Wet gleam appears as puddle settles
  if (progress > SPLAT_GLEAM_THRESHOLD) {
    ctx.globalAlpha = (progress - SPLAT_GLEAM_THRESHOLD) * 2 * SPLAT_GLEAM_ALPHA_SCALE;
    ctx.fillStyle = 'rgba(140,180,20,0.4)';
    ctx.beginPath();
    ctx.ellipse(
      cx - r * SPLAT_GLEAM_OFFSET_X,
      cy - r * SPLAT_GLEAM_OFFSET_Y,
      r * SPLAT_GLEAM_W_RATIO,
      r * SPLAT_GLEAM_H_RATIO,
      SPLAT_GLEAM_ANGLE,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.restore();
}

// ── Spit trap: idle sticky puddle ────────────────────────────────────────────

// Idle trap constants
const IDLE_FRAME_COUNT = 8;
const IDLE_BREATHE_FREQ = 2.1;
const IDLE_BREATHE_AMPLITUDE = 0.014;
const IDLE_RADIUS_X_RATIO = 1.48;
const IDLE_RADIUS_Y_RATIO = 1.04;
const IDLE_GLOW_ALPHA = 0.16;
const IDLE_GLOW_EXPAND = 1.14;
const IDLE_BASE_ALPHA = 0.74;
const IDLE_BRIGHT_ALPHA = 0.56;
const IDLE_BRIGHT_OFFSET_X = 0.07;
const IDLE_BRIGHT_OFFSET_Y = 0.04;
const IDLE_BRIGHT_W_RATIO = 0.8;
const IDLE_BRIGHT_H_RATIO = 0.76;
const IDLE_BRIGHT_ANGLE = -0.12;
const IDLE_GLEAM_ALPHA = 0.24;
const IDLE_GLEAM_OFFSET_X = 0.21;
const IDLE_GLEAM_OFFSET_Y = 0.24;
const IDLE_GLEAM_W_RATIO = 0.34;
const IDLE_GLEAM_H_RATIO = 0.26;
const IDLE_GLEAM_ANGLE = -0.18;
const IDLE_STRAND_ALPHA = 0.38;
const IDLE_STRAND_SWAY_AMPLITUDE = 0.045;
const IDLE_STRAND_SWAY2_FREQ = 0.7;
const IDLE_STRAND_SWAY2_AMPLITUDE = 0.028;
const IDLE_BUBBLE1_CYCLE_FREQ = 1.4;
const IDLE_BUBBLE1_CYCLE_OFFSET = 0.8;
const IDLE_BUBBLE1_MIN_ALPHA = 0.05;
const IDLE_BUBBLE1_RADIUS_RATIO = 0.095;
const IDLE_BUBBLE1_OFFSET_X = 0.32;
const IDLE_BUBBLE1_OFFSET_Y = 0.12;
const IDLE_BUBBLE1_STROKE_ALPHA = 0.62;
const IDLE_BUBBLE1_FILL_ALPHA = 0.38;
const IDLE_BUBBLE1_HIGHLIGHT_RATIO = 0.32;
const IDLE_BUBBLE1_HIGHLIGHT_SIZE = 0.24;
const IDLE_BUBBLE2_CYCLE_FREQ = 1.1;
const IDLE_BUBBLE2_CYCLE_OFFSET = 3.8;
const IDLE_BUBBLE2_MIN_ALPHA = 0.05;
const IDLE_BUBBLE2_RADIUS_RATIO = 0.058;
const IDLE_BUBBLE2_OFFSET_X = 0.38;
const IDLE_BUBBLE2_OFFSET_Y = 0.18;
const IDLE_BUBBLE2_STROKE_ALPHA = 0.48;

/**
 * Draw the idle sticky puddle trap.
 * @param frame  0–7 loop frame
 * @param ts     tile size matching the manifest tileScale
 */
export function drawSpitTrapIdle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  frame: number,
): void {
  const time = (frame / IDLE_FRAME_COUNT) * TWO_PI;
  const breathe = Math.sin(time * IDLE_BREATHE_FREQ) * IDLE_BREATHE_AMPLITUDE;
  const rx = ts * IDLE_RADIUS_X_RATIO * (1 + breathe);
  const ry = ts * IDLE_RADIUS_Y_RATIO * (1 + breathe);

  ctx.save();

  // Soft outer glow — signals the sticky zone
  ctx.globalAlpha = IDLE_GLOW_ALPHA;
  ctx.fillStyle = '#6a9014';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * IDLE_GLOW_EXPAND, ry * IDLE_GLOW_EXPAND, 0, 0, TWO_PI);
  ctx.fill();

  // Base puddle
  ctx.globalAlpha = IDLE_BASE_ALPHA;
  ctx.fillStyle = '#384808';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  // Secondary brighter layer
  ctx.globalAlpha = IDLE_BRIGHT_ALPHA;
  ctx.fillStyle = '#4c6010';
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * IDLE_BRIGHT_OFFSET_X,
    cy - ts * IDLE_BRIGHT_OFFSET_Y,
    rx * IDLE_BRIGHT_W_RATIO,
    ry * IDLE_BRIGHT_H_RATIO,
    IDLE_BRIGHT_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Wet surface highlight
  ctx.globalAlpha = IDLE_GLEAM_ALPHA;
  ctx.fillStyle = 'rgba(140,180,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(
    cx - rx * IDLE_GLEAM_OFFSET_X,
    cy - ry * IDLE_GLEAM_OFFSET_Y,
    rx * IDLE_GLEAM_W_RATIO,
    ry * IDLE_GLEAM_H_RATIO,
    IDLE_GLEAM_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Web / sticky strands crossing the puddle
  ctx.globalAlpha = IDLE_STRAND_ALPHA;
  ctx.strokeStyle = '#6a8812';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const strand of WEB_STRANDS) {
    const sway = Math.sin(time + strand.phase) * ts * IDLE_STRAND_SWAY_AMPLITUDE;
    const sway2 =
      Math.cos(time * IDLE_STRAND_SWAY2_FREQ + strand.phase) * ts * IDLE_STRAND_SWAY2_AMPLITUDE;
    const ax = cx + Math.cos(strand.aAngle) * rx * strand.rA;
    const ay = cy + Math.sin(strand.aAngle) * ry * strand.rA;
    const bx = cx + Math.cos(strand.bAngle) * rx * strand.rB;
    const by = cy + Math.sin(strand.bAngle) * ry * strand.rB;
    const cpx = (ax + bx) / 2 + sway;
    const cpy = (ay + by) / 2 + sway2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cpx, cpy, bx, by);
    ctx.stroke();
  }

  // Slow bubble: emerges, grows, and pops over the loop
  const bubbleCycle =
    ((time * IDLE_BUBBLE1_CYCLE_FREQ + IDLE_BUBBLE1_CYCLE_OFFSET) % TWO_PI) / TWO_PI;
  const bubbleAlpha = Math.sin(bubbleCycle * Math.PI);
  if (bubbleAlpha > IDLE_BUBBLE1_MIN_ALPHA) {
    const bubbleR = ts * IDLE_BUBBLE1_RADIUS_RATIO * bubbleAlpha;
    const bx = cx + ts * IDLE_BUBBLE1_OFFSET_X;
    const by = cy - ts * IDLE_BUBBLE1_OFFSET_Y;
    ctx.globalAlpha = bubbleAlpha * IDLE_BUBBLE1_STROKE_ALPHA;
    ctx.strokeStyle = '#8aaa18';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(bx, by, bubbleR, 0, TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = bubbleAlpha * IDLE_BUBBLE1_FILL_ALPHA;
    ctx.fillStyle = '#aace24';
    ctx.beginPath();
    ctx.arc(
      bx - bubbleR * IDLE_BUBBLE1_HIGHLIGHT_RATIO,
      by - bubbleR * IDLE_BUBBLE1_HIGHLIGHT_RATIO,
      bubbleR * IDLE_BUBBLE1_HIGHLIGHT_SIZE,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // Second smaller bubble, offset phase
  const bubble2Cycle =
    ((time * IDLE_BUBBLE2_CYCLE_FREQ + IDLE_BUBBLE2_CYCLE_OFFSET) % TWO_PI) / TWO_PI;
  const bubble2Alpha = Math.sin(bubble2Cycle * Math.PI);
  if (bubble2Alpha > IDLE_BUBBLE2_MIN_ALPHA) {
    const bubbleR2 = ts * IDLE_BUBBLE2_RADIUS_RATIO * bubble2Alpha;
    ctx.globalAlpha = bubble2Alpha * IDLE_BUBBLE2_STROKE_ALPHA;
    ctx.strokeStyle = '#7a9a14';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(cx - ts * IDLE_BUBBLE2_OFFSET_X, cy + ts * IDLE_BUBBLE2_OFFSET_Y, bubbleR2, 0, TWO_PI);
    ctx.stroke();
  }

  ctx.restore();
}
