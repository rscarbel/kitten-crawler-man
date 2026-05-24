/**
 * Grotesque Spider sprite — the most terrifying creature in the game.
 *
 * A massive, grotesque spider-form entity: misshapen fused body, stringy black
 * hair cascading in dozens of individual strands, asymmetric scattered eyes,
 * inward-toothed gaping maw. Inspired by the Mind Flayer (Stranger Things S3).
 *
 * Visual footprint: ~3×3 tiles. Collision footprint: 1 tile (centred on sx,sy).
 *
 * States:
 *   idle          — slow breathing pulse, hair sways, eyes blink independently
 *   walk          — legs creep in desynchronised erratic gait, hair streams behind
 *   attack_slam   — foreleg pair rears and crashes down  (stateProgress 0→1)
 *   attack_screech— maw splits impossibly wide, hair radiates outward (stateProgress 0→1)
 */

const TWO_PI = Math.PI * 2;

export type GrotesqueSpiderState =
  | 'idle'
  | 'walk'
  | 'attack_slam'
  | 'attack_screech'
  | 'attack_spit';

// ── Hair strand descriptors (48 strands, deterministic) ──────────────────────

interface HairStrand {
  readonly ax: number; // horizontal attach offset from head-centre (×ts)
  readonly ay: number; // vertical attach offset from head-top (×ts)
  readonly len: number; // total strand length (×ts)
  readonly phase: number; // sway phase
  readonly freq: number; // sway frequency (rad/s)
  readonly thick: number; // base line thickness (px)
  readonly bend: number; // lateral resting bias (signed)
}

// Hair strand generation constants
const HAIR_STRAND_COUNT = 48;
const HAIR_H1_MULT = 137;
const HAIR_H1_ADD = 11;
const HAIR_H1_MOD = 97;
const HAIR_H2_MULT = 73;
const HAIR_H2_ADD = 29;
const HAIR_H2_MOD = 89;
const HAIR_H3_MULT = 41;
const HAIR_H3_ADD = 53;
const HAIR_H3_MOD = 79;
const HAIR_H4_MULT = 97;
const HAIR_H4_ADD = 7;
const HAIR_H4_MOD = 61;
const HAIR_H5_MULT = 19;
const HAIR_H5_ADD = 83;
const HAIR_H5_MOD = 53;
const HAIR_NORMALIZE_CENTER = 0.5;
const HAIR_AX_SPREAD = 0.95;
const HAIR_AY_BIAS = 0.2;
const HAIR_AY_SPREAD = 0.28;
const HAIR_LEN_BASE = 0.9;
const HAIR_LEN_RANGE = 2.4;
const HAIR_FREQ_BASE = 0.45;
const HAIR_FREQ_RANGE = 1.9;
const HAIR_THICK_BASE = 1.0;
const HAIR_THICK_MOD = 5;
const HAIR_THICK_INCREMENT = 0.45;
const HAIR_BEND_MOD = 7;
const HAIR_BEND_SPREAD = 0.55;

function buildHairStrands(): readonly HairStrand[] {
  const out: HairStrand[] = [];
  for (let i = 0; i < HAIR_STRAND_COUNT; i++) {
    const h1 = (i * HAIR_H1_MULT + HAIR_H1_ADD) % HAIR_H1_MOD;
    const h2 = (i * HAIR_H2_MULT + HAIR_H2_ADD) % HAIR_H2_MOD;
    const h3 = (i * HAIR_H3_MULT + HAIR_H3_ADD) % HAIR_H3_MOD;
    const h4 = (i * HAIR_H4_MULT + HAIR_H4_ADD) % HAIR_H4_MOD;
    const h5 = (i * HAIR_H5_MULT + HAIR_H5_ADD) % HAIR_H5_MOD;
    out.push({
      ax: (h1 / HAIR_H1_MOD - HAIR_NORMALIZE_CENTER) * HAIR_AX_SPREAD,
      ay: (h2 / HAIR_H2_MOD - HAIR_AY_BIAS) * HAIR_AY_SPREAD,
      len: HAIR_LEN_BASE + (h3 / HAIR_H3_MOD) * HAIR_LEN_RANGE,
      phase: (h4 / HAIR_H4_MOD) * TWO_PI,
      freq: HAIR_FREQ_BASE + (h5 / HAIR_H5_MOD) * HAIR_FREQ_RANGE,
      thick: HAIR_THICK_BASE + (h1 % HAIR_THICK_MOD) * HAIR_THICK_INCREMENT,
      bend: ((h2 % HAIR_BEND_MOD) / HAIR_BEND_MOD - HAIR_NORMALIZE_CENTER) * HAIR_BEND_SPREAD,
    });
  }
  return out;
}

const HAIR_STRANDS = buildHairStrands();

// ── Eye descriptors (7 eyes — scattered, never aligned, wrong sizes) ─────────

interface EyeDesc {
  readonly bx: number; // x from body centre (×ts)
  readonly by: number; // y from body centre (×ts)
  readonly r: number; // radius (×ts)
  readonly blinkPhase: number;
  readonly slit: boolean; // slit pupil (true) or round (false)
  readonly bloodshot: boolean;
}

const EYES: readonly EyeDesc[] = [
  { bx: -0.29, by: -0.38, r: 0.115, blinkPhase: 0.0, slit: false, bloodshot: true },
  { bx: 0.21, by: -0.44, r: 0.082, blinkPhase: 2.1, slit: true, bloodshot: false },
  { bx: -0.07, by: -0.53, r: 0.052, blinkPhase: 4.3, slit: false, bloodshot: false },
  { bx: 0.38, by: -0.27, r: 0.068, blinkPhase: 1.1, slit: true, bloodshot: true },
  { bx: -0.43, by: -0.21, r: 0.088, blinkPhase: 3.7, slit: false, bloodshot: false },
  { bx: 0.11, by: -0.31, r: 0.038, blinkPhase: 5.2, slit: true, bloodshot: false },
  { bx: -0.19, by: -0.2, r: 0.033, blinkPhase: 0.9, slit: false, bloodshot: true },
];

// ── Leg descriptors (8 legs — asymmetric length and angle) ───────────────────

interface LegDesc {
  readonly ax: number; // attach point x from body centre (×ts)
  readonly ay: number; // attach point y from body centre (×ts)
  readonly rx: number; // resting tip x from body centre (×ts)
  readonly ry: number; // resting tip y from body centre (×ts)
  readonly phase: number; // step phase offset
  readonly freq: number; // step frequency — irrational values = desync
  readonly kOut: number; // knee outward direction (+1 right / -1 left)
}

const LEGS: readonly LegDesc[] = [
  // Left side, front → back
  { ax: -0.42, ay: -0.06, rx: -1.55, ry: -0.65, phase: 0.0, freq: 2.1, kOut: -1 },
  { ax: -0.48, ay: 0.1, rx: -1.65, ry: 0.25, phase: 1.4, freq: 1.83, kOut: -1 },
  { ax: -0.44, ay: 0.28, rx: -1.38, ry: 0.92, phase: 2.9, freq: 2.37, kOut: -1 },
  { ax: -0.3, ay: 0.4, rx: -0.82, ry: 1.52, phase: 0.7, freq: 1.62, kOut: -1 },
  // Right side, front → back (intentionally different lengths)
  { ax: 0.38, ay: -0.09, rx: 1.48, ry: -0.52, phase: 3.14, freq: 2.04, kOut: 1 },
  { ax: 0.5, ay: 0.07, rx: 1.72, ry: 0.32, phase: 4.55, freq: 1.91, kOut: 1 },
  { ax: 0.46, ay: 0.25, rx: 1.54, ry: 0.87, phase: 0.3, freq: 2.28, kOut: 1 },
  { ax: 0.27, ay: 0.43, rx: 0.92, ry: 1.57, phase: 1.85, freq: 1.74, kOut: 1 },
];

// ── Hair drawing ──────────────────────────────────────────────────────────────

// Hair rendering constants
const HAIR_HEAD_CY_OFFSET = 0.44;
const HAIR_WIND_X_SCALE = 0.22;
const HAIR_WIND_Y_SCALE = 0.14;
const HAIR_SWAY_AMPLITUDE = 0.07;
const HAIR_SWAY2_FREQ_RATIO = 0.63;
const HAIR_SWAY2_AMPLITUDE = 0.04;
const HAIR_SCREECH_SPLAY_SCALE = 1.6;
const HAIR_SCREECH_SPLAY_LEN_RATIO = 0.4;
const HAIR_WIND_STRAND_X_RATIO = 0.35;
const HAIR_END_Y_RATIO = 0.75;
const HAIR_WIND_STRAND_Y_RATIO = 0.18;
const HAIR_CP_BEND_RATIO = 0.5;
const HAIR_CP_WIND_X_RATIO = 0.2;
const HAIR_CP_Y_RATIO = 0.38;
const HAIR_CP_WIND_Y_RATIO = 0.12;
const HAIR_COLOR_STEP = 2;
const HAIR_COLOR_MOD = 5;

function drawHair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  movingX: number,
  movingY: number,
): void {
  const headCy = cy - ts * HAIR_HEAD_CY_OFFSET;

  ctx.save();
  ctx.lineCap = 'round';

  for (let i = 0; i < HAIR_STRANDS.length; i++) {
    const s = HAIR_STRANDS[i];

    const ax = cx + s.ax * ts;
    const ay = headCy + s.ay * ts;
    const strandLen = s.len * ts;

    // Wind: hair streams opposite to movement direction
    const windX = -movingX * ts * HAIR_WIND_X_SCALE;
    const windY = -movingY * ts * HAIR_WIND_Y_SCALE;

    // Per-strand oscillation
    const sway = Math.sin(time * s.freq + s.phase) * ts * HAIR_SWAY_AMPLITUDE;
    const sway2 =
      Math.cos(time * s.freq * HAIR_SWAY2_FREQ_RATIO + s.phase) * ts * HAIR_SWAY2_AMPLITUDE;

    // Screech: hair radiates outward from centre
    let splayX = 0;
    let splayY = 0;
    if (state === 'attack_screech') {
      const splay = Math.sin(stateProgress * Math.PI);
      splayX = s.ax * ts * splay * HAIR_SCREECH_SPLAY_SCALE;
      splayY = -(strandLen * HAIR_SCREECH_SPLAY_LEN_RATIO) * splay;
    }

    // End point of strand
    const ex = ax + s.bend * ts + windX * s.len * HAIR_WIND_STRAND_X_RATIO + sway + splayX;
    const ey =
      ay + strandLen * HAIR_END_Y_RATIO + windY * s.len * HAIR_WIND_STRAND_Y_RATIO + splayY;

    // Bezier control point (midway with secondary sway)
    const cpx = ax + s.bend * ts * HAIR_CP_BEND_RATIO + windX * HAIR_CP_WIND_X_RATIO + sway2;
    const cpy = ay + strandLen * HAIR_CP_Y_RATIO + windY * HAIR_CP_WIND_Y_RATIO;

    // Almost-pure-black with very slight per-strand variation
    const v = HAIR_COLOR_STEP + (i % HAIR_COLOR_MOD) * HAIR_COLOR_STEP;
    ctx.strokeStyle = `rgb(${v},${v - 1},${v})`;
    ctx.lineWidth = s.thick;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Leg drawing ───────────────────────────────────────────────────────────────

// Leg rendering constants
const LEG_SEG1_RATIO = 0.66;
const LEG_SEG2_RATIO = 0.72;
const LEG_MIN_DIST = 0.001;
const LEG_HALF_DIST = 0.5;
const LEG_TOTAL_LEN_RATIO = 0.5;
const LEG_BASE_THICK_RATIO = 0.065;
const LEG_UPPER_THICK_MULT = 2.0;
const LEG_LOWER_THICK_MULT = 1.35;
const LEG_KNEE_RADIUS_MULT = 1.3;
const LEG_CLAW_COUNT = 3;
const LEG_CLAW_SPREAD = 0.38;
const LEG_CLAW_LENGTH = 0.13;
const LEG_FOOT_THICK_MULT = 0.85;

function drawLeg(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  ts: number,
  kOut: number,
): void {
  const seg1 = ts * LEG_SEG1_RATIO;
  const seg2 = ts * LEG_SEG2_RATIO;

  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < LEG_MIN_DIST) return;

  const halfDist = dist * LEG_HALF_DIST;
  const totalLen = (seg1 + seg2) * LEG_TOTAL_LEN_RATIO;
  const h = Math.sqrt(Math.max(0, totalLen * totalLen - halfDist * halfDist));

  const mx = (ax + tx) * LEG_HALF_DIST;
  const my = (ay + ty) * LEG_HALF_DIST;
  const px = (-dy / dist) * kOut;
  const py = (dx / dist) * kOut;

  const kx = mx + px * h;
  const ky = my + py * h;

  const baseThick = ts * LEG_BASE_THICK_RATIO;

  // Upper segment
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(kx, ky);
  ctx.strokeStyle = '#1a0a12';
  ctx.lineWidth = baseThick * LEG_UPPER_THICK_MULT;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Lower segment — slightly thinner, darker
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = '#120608';
  ctx.lineWidth = baseThick * LEG_LOWER_THICK_MULT;
  ctx.stroke();

  // Knee joint nub
  ctx.fillStyle = '#2a1020';
  ctx.beginPath();
  ctx.arc(kx, ky, baseThick * LEG_KNEE_RADIUS_MULT, 0, TWO_PI);
  ctx.fill();

  // Claw at foot — three barbs
  const footAngle = Math.atan2(ty - ky, tx - kx);
  ctx.strokeStyle = '#080408';
  ctx.lineWidth = baseThick * LEG_FOOT_THICK_MULT;
  for (let c = 0; c < LEG_CLAW_COUNT; c++) {
    const ca = footAngle + (c - 1) * LEG_CLAW_SPREAD;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ca) * ts * LEG_CLAW_LENGTH, ty + Math.sin(ca) * ts * LEG_CLAW_LENGTH);
    ctx.stroke();
  }
}

// Leg tip calculation constants
const LEG_IDLE_SWAY_FREQ_SCALE = 0.25;
const LEG_IDLE_SWAY_AMPLITUDE = 0.035;
const LEG_WALK_TIME_SCALE = 3;
const LEG_WALK_LIFT_THRESHOLD = 0.25;
const LEG_WALK_LIFT_RANGE = 0.75;
const LEG_WALK_LIFT_AMPLITUDE = 0.22;
const LEG_WALK_STEP_X_SCALE = 0.45;
const LEG_WALK_STEP_Y_SCALE = 0.25;
const LEG_SLAM_WINDUP_THRESHOLD = 0.55;
const LEG_SLAM_WINDUP_REMAIN = 0.45;
const LEG_SLAM_STEP_X_SCALE = 0.2;
const LEG_SLAM_LIFT_AMPLITUDE = 1.35;
const LEG_SLAM_QUARTER_CIRCLE = 0.5; // π × 0.5 = quarter-circle arc for smooth ease

function getLegTip(
  cx: number,
  cy: number,
  ts: number,
  leg: LegDesc,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  movingX: number,
  movingY: number,
): { tx: number; ty: number } {
  const restX = cx + leg.rx * ts;
  const restY = cy + leg.ry * ts;

  if (state === 'idle') {
    const idleSway =
      Math.sin(time * leg.freq * LEG_IDLE_SWAY_FREQ_SCALE + leg.phase) *
      ts *
      LEG_IDLE_SWAY_AMPLITUDE;
    return { tx: restX + idleSway, ty: restY };
  }

  if (state === 'walk') {
    const walkTime = time * LEG_WALK_TIME_SCALE;
    const cycle = Math.sin(walkTime * leg.freq + leg.phase);
    if (cycle > LEG_WALK_LIFT_THRESHOLD) {
      const liftT = (cycle - LEG_WALK_LIFT_THRESHOLD) / LEG_WALK_LIFT_RANGE;
      const lift = Math.sin(liftT * Math.PI) * ts * LEG_WALK_LIFT_AMPLITUDE;
      return {
        tx: restX + movingX * ts * LEG_WALK_STEP_X_SCALE * liftT,
        ty: restY + movingY * ts * LEG_WALK_STEP_Y_SCALE * liftT - lift,
      };
    }
    return { tx: restX, ty: restY };
  }

  if (state === 'attack_slam') {
    // Front legs (|ax| < 0.5 and ry < 0) rear up then slam
    if (leg.ry < 0) {
      const lift =
        stateProgress < LEG_SLAM_WINDUP_THRESHOLD
          ? Math.sin(
              (stateProgress / LEG_SLAM_WINDUP_THRESHOLD) * Math.PI * LEG_SLAM_QUARTER_CIRCLE,
            )
          : 1.0 -
            Math.sin(
              ((stateProgress - LEG_SLAM_WINDUP_THRESHOLD) / LEG_SLAM_WINDUP_REMAIN) *
                Math.PI *
                LEG_SLAM_QUARTER_CIRCLE,
            );
      return {
        tx: restX + leg.kOut * ts * LEG_SLAM_STEP_X_SCALE * stateProgress,
        ty: restY - ts * LEG_SLAM_LIFT_AMPLITUDE * lift,
      };
    }
    return { tx: restX, ty: restY };
  }

  return { tx: restX, ty: restY };
}

// ── Body drawing ──────────────────────────────────────────────────────────────

// Body rendering constants
const BODY_BREATHE_FREQ = 0.82;
const BODY_BREATHE_AMPLITUDE = 0.026;
const BODY_SCREAM_BULGE_SCALE = 0.22;
const BODY_SHADOW_ALPHA = 0.38;
const BODY_SHADOW_OFFSET_X = 0.06;
const BODY_SHADOW_OFFSET_Y = 0.46;
const BODY_SHADOW_RX_RATIO = 1.15;
const BODY_SHADOW_RY_RATIO = 0.19;
const BODY_CENTER_OFFSET_Y = 0.05;
const BODY_RX_BASE = 0.74;
const BODY_RY_BASE = 0.6;
const BODY_SCREAM_XY_SCALE = 0.28;
const BODY_LEFT_LUMP_X = 0.48;
const BODY_LEFT_LUMP_Y = 0.26;
const BODY_LEFT_LUMP_RX = 0.43;
const BODY_LEFT_LUMP_RY = 0.37;
const BODY_LEFT_LUMP_ANGLE = -0.28;
const BODY_RIGHT_PROT_X = 0.36;
const BODY_RIGHT_PROT_Y = 0.1;
const BODY_RIGHT_PROT_RX = 0.34;
const BODY_RIGHT_PROT_RY = 0.46;
const BODY_RIGHT_PROT_ANGLE = 0.22;
const BODY_ABDOMEN_X = 0.09;
const BODY_ABDOMEN_Y = 0.23;
const BODY_ABDOMEN_RX = 0.53;
const BODY_ABDOMEN_RY = 0.34;
const BODY_ABDOMEN_ANGLE = 0.14;
const BODY_HEAD_OFFSET_X = 0.05;
const BODY_HEAD_OFFSET_Y = 0.46;
const BODY_HEAD_RX = 0.4;
const BODY_HEAD_RY = 0.27;
const BODY_TEAR_INNER_X_RATIO = 0.22;
const BODY_TEAR_INNER_Y_RATIO = 0.28;
const BODY_TEAR_INNER_W_RATIO = 0.52;
const BODY_TEAR_INNER_H_RATIO = 0.4;

// Flesh tear geometry: [offsetX, offsetY, halfWidth, halfHeight, angle] — all in body-centre ×ts units
const BODY_TEARS: readonly (readonly [number, number, number, number, number])[] = [
  [-0.26, -0.05, 0.21, 0.077, 0.3],
  [0.19, -0.16, 0.13, 0.055, -0.22],
  [-0.05, 0.19, 0.11, 0.048, 0.78],
  [0.29, 0.09, 0.087, 0.038, -0.5],
] as const;

// Vein geometry: [x1, y1, cpx, cpy, x2, y2] — all in body-centre ×ts units
const BODY_VEINS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-0.31, -0.09, 0.09, -0.4, -0.16, 0.16],
  [0.14, -0.01, -0.11, -0.31, 0.19, -0.21],
  [-0.1, 0.21, 0.19, 0.1, -0.22, -0.1],
] as const;
const BODY_VEIN_ALPHA_BASE = 0.12;
const BODY_VEIN_ALPHA_AMP = 0.07;
const BODY_VEIN_PULSE_FREQ = 2.05;
const BODY_SLAM_FLASH_START = 0.82;
const BODY_SLAM_FLASH_RANGE = 0.18;
const BODY_SLAM_FLASH_ALPHA = 0.55;
const BODY_SLAM_FLASH_OFFSET_Y = 0.3;
const BODY_SLAM_FLASH_RX = 1.45;
const BODY_SLAM_FLASH_RY = 0.7;

function drawBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const breathe = Math.sin(time * BODY_BREATHE_FREQ) * BODY_BREATHE_AMPLITUDE;
  const screamBulge =
    state === 'attack_screech' ? Math.sin(stateProgress * Math.PI) * BODY_SCREAM_BULGE_SCALE : 0;

  // Ground shadow
  ctx.save();
  ctx.globalAlpha = BODY_SHADOW_ALPHA;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(
    cx + ts * BODY_SHADOW_OFFSET_X,
    cy + ts * BODY_SHADOW_OFFSET_Y,
    ts * BODY_SHADOW_RX_RATIO,
    ts * BODY_SHADOW_RY_RATIO,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

  // Main body mass
  ctx.fillStyle = '#12070e';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - ts * BODY_CENTER_OFFSET_Y,
    ts * (BODY_RX_BASE + breathe + screamBulge * BODY_SCREAM_XY_SCALE),
    ts * (BODY_RY_BASE + breathe + screamBulge * BODY_SCREAM_XY_SCALE),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Asymmetric left shoulder lump
  ctx.fillStyle = '#1b0b15';
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * BODY_LEFT_LUMP_X,
    cy - ts * BODY_LEFT_LUMP_Y,
    ts * BODY_LEFT_LUMP_RX,
    ts * BODY_LEFT_LUMP_RY,
    BODY_LEFT_LUMP_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Smaller right side protrusion — different shape
  ctx.fillStyle = '#170910';
  ctx.beginPath();
  ctx.ellipse(
    cx + ts * BODY_RIGHT_PROT_X,
    cy - ts * BODY_RIGHT_PROT_Y,
    ts * BODY_RIGHT_PROT_RX,
    ts * BODY_RIGHT_PROT_RY,
    BODY_RIGHT_PROT_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Lower abdomen — another fused mass
  ctx.fillStyle = '#1e0c18';
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * BODY_ABDOMEN_X,
    cy + ts * BODY_ABDOMEN_Y,
    ts * BODY_ABDOMEN_RX,
    ts * BODY_ABDOMEN_RY,
    BODY_ABDOMEN_ANGLE,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Head region connector
  ctx.fillStyle = '#100609';
  ctx.beginPath();
  ctx.ellipse(
    cx + ts * BODY_HEAD_OFFSET_X,
    cy - ts * BODY_HEAD_OFFSET_Y,
    ts * BODY_HEAD_RX,
    ts * BODY_HEAD_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Flesh tears — exposed sickly interior
  for (const [ox, oy, ew, eh, angle] of BODY_TEARS) {
    ctx.fillStyle = '#4a1530';
    ctx.beginPath();
    ctx.ellipse(cx + ox * ts, cy + oy * ts, ew * ts, eh * ts, angle, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#7a2040';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox * ts - ts * ew * BODY_TEAR_INNER_X_RATIO,
      cy + oy * ts - ts * eh * BODY_TEAR_INNER_Y_RATIO,
      ew * ts * BODY_TEAR_INNER_W_RATIO,
      eh * ts * BODY_TEAR_INNER_H_RATIO,
      angle,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // Bioluminescent veins — sickly green-grey glow
  ctx.save();
  ctx.globalAlpha =
    BODY_VEIN_ALPHA_BASE + BODY_VEIN_ALPHA_AMP * Math.sin(time * BODY_VEIN_PULSE_FREQ);
  ctx.strokeStyle = '#1e3612';
  ctx.lineWidth = 1.4;
  for (const [x1, y1, cpx, cpy, x2, y2] of BODY_VEINS) {
    ctx.beginPath();
    ctx.moveTo(cx + x1 * ts, cy + y1 * ts);
    ctx.quadraticCurveTo(cx + cpx * ts, cy + cpy * ts, cx + x2 * ts, cy + y2 * ts);
    ctx.stroke();
  }
  ctx.restore();

  // Slam: white impact flash at the end
  if (state === 'attack_slam' && stateProgress > BODY_SLAM_FLASH_START) {
    const flashAlpha =
      ((stateProgress - BODY_SLAM_FLASH_START) / BODY_SLAM_FLASH_RANGE) * BODY_SLAM_FLASH_ALPHA;
    ctx.save();
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + ts * BODY_SLAM_FLASH_OFFSET_Y,
      ts * BODY_SLAM_FLASH_RX,
      ts * BODY_SLAM_FLASH_RY,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }
}

// ── Eyes drawing ──────────────────────────────────────────────────────────────

// Eye rendering constants
const EYE_BLINK_FREQ = 0.38;
const EYE_BLINK_THRESHOLD = 0.93;
const EYE_BLINK_RANGE = 0.07;
const EYE_SCREAM_OPEN_SCALE = 0.32;
const EYE_BLOODSHOT_ALPHA = 0.52;
const EYE_BLOODSHOT_VEIN_COUNT = 5;
const EYE_BLOODSHOT_INNER_RATIO = 0.42;
const EYE_BLOODSHOT_OUTER_RATIO = 0.87;
const EYE_BLOODSHOT_SPREAD = 0.28;
const EYE_BLINK_HALF = 0.5;
const EYE_SLIT_PUPIL_RATIO = 0.16;
const EYE_ROUND_PUPIL_BASE = 0.44;
const EYE_PUPIL_TRACK_RATIO = 0.22;
const EYE_SLIT_HEIGHT_RATIO = 0.56;
const EYE_SCREAM_PUPIL_SHRINK = 0.28;
const EYE_SPECULAR_ALPHA = 0.62;
const EYE_SPECULAR_OFFSET_X = 0.26;
const EYE_SPECULAR_OFFSET_Y = 0.23;
const EYE_SPECULAR_RADIUS = 0.19;
const EYE_LID_OFFSET_RATIO = 0.5;
const EYE_LID_W_RATIO = 1.05;

function drawEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  showEyes: boolean,
): void {
  if (!showEyes) return;

  const scream = state === 'attack_screech' ? stateProgress : 0;

  for (const eye of EYES) {
    const ex = cx + eye.bx * ts;
    const ey = cy + eye.by * ts;
    const er = eye.r * ts;

    // Independent blink: closed for ~0.1 s every few seconds
    const blinkRaw = Math.sin(time * EYE_BLINK_FREQ + eye.blinkPhase);
    const blinkAmt =
      blinkRaw > EYE_BLINK_THRESHOLD ? (blinkRaw - EYE_BLINK_THRESHOLD) / EYE_BLINK_RANGE : 0;

    // Sclera — yellow-white; bloodshot tinted
    ctx.fillStyle = eye.bloodshot ? '#e8d8b0' : '#d2c8a4';
    ctx.beginPath();
    ctx.ellipse(
      ex,
      ey,
      er,
      er * (1 - blinkAmt * EYE_BLINK_THRESHOLD) * (1 + scream * EYE_SCREAM_OPEN_SCALE),
      0,
      0,
      TWO_PI,
    );
    ctx.fill();

    // Bloodshot veins
    if (eye.bloodshot) {
      ctx.save();
      ctx.globalAlpha = EYE_BLOODSHOT_ALPHA;
      ctx.strokeStyle = '#cc1818';
      ctx.lineWidth = 0.7;
      for (let v = 0; v < EYE_BLOODSHOT_VEIN_COUNT; v++) {
        const va = (v / EYE_BLOODSHOT_VEIN_COUNT) * TWO_PI + eye.blinkPhase;
        ctx.beginPath();
        ctx.moveTo(
          ex + Math.cos(va) * er * EYE_BLOODSHOT_INNER_RATIO,
          ey + Math.sin(va) * er * EYE_BLOODSHOT_INNER_RATIO,
        );
        ctx.lineTo(
          ex + Math.cos(va + EYE_BLOODSHOT_SPREAD) * er * EYE_BLOODSHOT_OUTER_RATIO,
          ey + Math.sin(va + EYE_BLOODSHOT_SPREAD) * er * EYE_BLOODSHOT_OUTER_RATIO,
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    if (blinkAmt < EYE_BLINK_HALF) {
      // Pupil — tracks facing dir; shrinks to pinpoint during screech
      const pupilR = eye.slit
        ? er * EYE_SLIT_PUPIL_RATIO
        : er * (EYE_ROUND_PUPIL_BASE - scream * EYE_SCREAM_PUPIL_SHRINK);
      const pupilX = ex + facingX * er * EYE_PUPIL_TRACK_RATIO;
      const pupilY = ey + facingY * er * EYE_PUPIL_TRACK_RATIO;

      ctx.fillStyle = '#040204';
      if (eye.slit) {
        ctx.beginPath();
        ctx.ellipse(pupilX, pupilY, pupilR, er * EYE_SLIT_HEIGHT_RATIO, 0, 0, TWO_PI);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(pupilX, pupilY, pupilR, 0, TWO_PI);
        ctx.fill();
      }

      // Specular glint
      ctx.fillStyle = `rgba(255,255,255,${EYE_SPECULAR_ALPHA})`;
      ctx.beginPath();
      ctx.arc(
        ex - er * EYE_SPECULAR_OFFSET_X,
        ey - er * EYE_SPECULAR_OFFSET_Y,
        er * EYE_SPECULAR_RADIUS,
        0,
        TWO_PI,
      );
      ctx.fill();
    }

    // Eyelid close
    if (blinkAmt > 0) {
      ctx.fillStyle = '#12070e';
      ctx.beginPath();
      ctx.ellipse(
        ex,
        ey - er * (1 - blinkAmt) * EYE_LID_OFFSET_RATIO,
        er * EYE_LID_W_RATIO,
        er * blinkAmt,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        ex,
        ey + er * (1 - blinkAmt) * EYE_LID_OFFSET_RATIO,
        er * EYE_LID_W_RATIO,
        er * blinkAmt,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }
}

// ── Maw drawing ───────────────────────────────────────────────────────────────

// Maw rendering constants
const MAW_OFFSET_X = 0.04;
const MAW_OFFSET_Y = 0.12;
const MAW_BREATHE_BASE = 0.055;
const MAW_BREATHE_FREQ = 0.78;
const MAW_BREATHE_AMP = 0.022;
const MAW_SCREECH_OPEN_MAX = 0.82;
const MAW_SCREECH_WINDUP = 0.5;
const MAW_SCREECH_WINDUP_SCALE = 2.0;
const MAW_SCREECH_CLOSE_SCALE = 0.5;
const MAW_SLAM_OPEN_SCALE = 0.28;
const MAW_SPIT_WINDUP_END = 0.58;
const MAW_SPIT_OPEN_SCALE = 0.22;
const MAW_WIDTH_BASE = 0.46;
const MAW_WIDTH_OPEN_SCALE = 0.28;
const MAW_SCREECH_GLOW_THRESH = 0.08;
const MAW_SCREECH_GLOW_ALPHA_SCALE = 2.0;
const MAW_SCREECH_GLOW_RADIUS = 0.8;
const MAW_SCREECH_GLOW_MID_STOP = 0.5; // midpoint color stop in radial gradient
const MAW_SCREECH_INNER_RATIO = 0.9;
const MAW_OPEN_TOOTH_THRESH = 0.04;
const MAW_OUTER_TOOTH_COUNT = 14;
const MAW_OUTER_TOOTH_SCALE_THRESH = 0.1;
const MAW_OUTER_TOOTH_PLACEMENT = 0.88;
const MAW_OUTER_TOOTH_BASE_LEN = 0.055;
const MAW_OUTER_TOOTH_LEN_MOD = 3;
const MAW_OUTER_TOOTH_LEN_INCREMENT = 0.018;
const MAW_OUTER_TOOTH_SIDE_ANGLE = 0.21;
const MAW_OUTER_TOOTH_TIP_MULT = 1.55;
const MAW_INNER_TOOTH_COUNT = 9;
const MAW_INNER_TOOTH_PLACEMENT = 0.52;
const MAW_INNER_TOOTH_LEN = 0.042;
const MAW_INNER_TOOTH_SIDE_ANGLE = 0.26;
const MAW_INNER_TOOTH_TIP_MULT = 1.4;
const MAW_SPIT_WINDUP_FADE_START = 0.08;
const MAW_SPIT_WINDUP_FADE_RANGE = 0.28;
const MAW_SPIT_RELEASE_END = 0.42;
const MAW_SPIT_RELEASE_FADE = 0.5;
const MAW_SPIT_GLOB_ALPHA = 0.9;
const MAW_SPIT_GLOB_RADIUS = 0.28;
const MAW_SPIT_GLOB_OFFSET_X = 0.04;
const MAW_SPIT_GLOB_OFFSET_Y = 0.07;
const MAW_SPIT_GLOB_W_RATIO = 1.18;
const MAW_SPIT_GLOB_H_RATIO = 0.9;
const MAW_SPIT_HIGHLIGHT_ALPHA = 0.62;
const MAW_SPIT_HIGHLIGHT_X = 0.22;
const MAW_SPIT_HIGHLIGHT_Y = 0.26;
const MAW_SPIT_HIGHLIGHT_W = 0.6;
const MAW_SPIT_HIGHLIGHT_H = 0.46;
const MAW_SPIT_GLOSS_ALPHA = 0.48;
const MAW_SPIT_GLOSS_X = 0.3;
const MAW_SPIT_GLOSS_Y = 0.3;
const MAW_SPIT_GLOSS_W = 0.28;
const MAW_SPIT_GLOSS_H = 0.2;
const MAW_SPIT_DRIP_COUNT = 4;
const MAW_SPIT_DRIP_OFFSET = 1.3;
const MAW_SPIT_DRIP_INNER = 0.78;
const MAW_SPIT_DRIP_OUTER = 1.48;
const MAW_SPIT_DRIP_ALPHA = 0.52;
const MAW_SPIT_GLOB_MIN_ALPHA = 0.01;

function drawMaw(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  visible: boolean,
): void {
  if (!visible) return;

  const mawCx = cx - ts * MAW_OFFSET_X;
  const mawCy = cy + ts * MAW_OFFSET_Y;

  // Base open: slight breathing
  let openAmt = MAW_BREATHE_BASE + Math.sin(time * MAW_BREATHE_FREQ) * MAW_BREATHE_AMP;
  if (state === 'attack_screech') {
    openAmt =
      stateProgress < MAW_SCREECH_WINDUP
        ? MAW_BREATHE_BASE + stateProgress * MAW_SCREECH_WINDUP_SCALE * MAW_SCREECH_OPEN_MAX
        : MAW_BREATHE_BASE +
          MAW_SCREECH_OPEN_MAX -
          (stateProgress - MAW_SCREECH_WINDUP) * MAW_SCREECH_CLOSE_SCALE;
  } else if (state === 'attack_slam') {
    openAmt += stateProgress * MAW_SLAM_OPEN_SCALE;
  } else if (state === 'attack_spit') {
    // Maw opens during wind-up to gather the glob
    const windupT = Math.min(stateProgress / MAW_SPIT_WINDUP_END, 1.0);
    openAmt += windupT * MAW_SPIT_OPEN_SCALE;
  }

  const mawW = ts * (MAW_WIDTH_BASE + openAmt * MAW_WIDTH_OPEN_SCALE);
  const mawH = ts * openAmt;

  // Throat void
  ctx.fillStyle = '#060003';
  ctx.beginPath();
  ctx.ellipse(mawCx, mawCy, mawW, mawH, 0, 0, TWO_PI);
  ctx.fill();

  // Inner glow during screech
  if (state === 'attack_screech' && stateProgress > MAW_SCREECH_GLOW_THRESH) {
    ctx.save();
    ctx.globalAlpha =
      Math.min(stateProgress * MAW_SCREECH_GLOW_ALPHA_SCALE, 1.0) * MAW_SPIT_DRIP_ALPHA;
    const grad = ctx.createRadialGradient(
      mawCx,
      mawCy,
      0,
      mawCx,
      mawCy,
      mawW * MAW_SCREECH_GLOW_RADIUS,
    );
    grad.addColorStop(0, '#ff1020');
    grad.addColorStop(MAW_SCREECH_GLOW_MID_STOP, '#8b0012');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(
      mawCx,
      mawCy,
      mawW * MAW_SCREECH_INNER_RATIO,
      mawH * MAW_SCREECH_INNER_RATIO,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }

  if (openAmt > MAW_OPEN_TOOTH_THRESH) {
    // Outer teeth row — inward-curving
    const outerCount = MAW_OUTER_TOOTH_COUNT;
    const toothScale = Math.min(openAmt / MAW_OUTER_TOOTH_SCALE_THRESH, 1.0);
    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * TWO_PI;
      const ex = mawCx + Math.cos(angle) * mawW * MAW_OUTER_TOOTH_PLACEMENT;
      const ey = mawCy + Math.sin(angle) * mawH * MAW_OUTER_TOOTH_PLACEMENT;
      const tLen =
        ts *
        (MAW_OUTER_TOOTH_BASE_LEN + (i % MAW_OUTER_TOOTH_LEN_MOD) * MAW_OUTER_TOOTH_LEN_INCREMENT) *
        toothScale;
      const inward = angle + Math.PI;

      ctx.fillStyle = '#c4bca4';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex + Math.cos(angle - MAW_OUTER_TOOTH_SIDE_ANGLE) * tLen,
        ey + Math.sin(angle - MAW_OUTER_TOOTH_SIDE_ANGLE) * tLen,
      );
      ctx.lineTo(
        ex + Math.cos(inward) * tLen * MAW_OUTER_TOOTH_TIP_MULT,
        ey + Math.sin(inward) * tLen * MAW_OUTER_TOOTH_TIP_MULT,
      );
      ctx.lineTo(
        ex + Math.cos(angle + MAW_OUTER_TOOTH_SIDE_ANGLE) * tLen,
        ey + Math.sin(angle + MAW_OUTER_TOOTH_SIDE_ANGLE) * tLen,
      );
      ctx.closePath();
      ctx.fill();
    }

    // Inner secondary teeth row
    const innerCount = MAW_INNER_TOOTH_COUNT;
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * TWO_PI + Math.PI / innerCount;
      const ex = mawCx + Math.cos(angle) * mawW * MAW_INNER_TOOTH_PLACEMENT;
      const ey = mawCy + Math.sin(angle) * mawH * MAW_INNER_TOOTH_PLACEMENT;
      const tLen = ts * MAW_INNER_TOOTH_LEN * toothScale;
      const inward = angle + Math.PI;

      ctx.fillStyle = '#9e9684';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex + Math.cos(angle - MAW_INNER_TOOTH_SIDE_ANGLE) * tLen,
        ey + Math.sin(angle - MAW_INNER_TOOTH_SIDE_ANGLE) * tLen,
      );
      ctx.lineTo(
        ex + Math.cos(inward) * tLen * MAW_INNER_TOOTH_TIP_MULT,
        ey + Math.sin(inward) * tLen * MAW_INNER_TOOTH_TIP_MULT,
      );
      ctx.lineTo(
        ex + Math.cos(angle + MAW_INNER_TOOTH_SIDE_ANGLE) * tLen,
        ey + Math.sin(angle + MAW_INNER_TOOTH_SIDE_ANGLE) * tLen,
      );
      ctx.closePath();
      ctx.fill();
    }
  }

  // Spit glob: viscous olive-green ball that grows at the maw during wind-up
  // and vanishes abruptly at the moment of release.
  if (state === 'attack_spit') {
    const windupT = Math.min(stateProgress / MAW_SPIT_WINDUP_END, 1.0);
    const releaseT = Math.max((stateProgress - MAW_SPIT_WINDUP_END) / MAW_SPIT_RELEASE_END, 0.0);
    if (windupT > MAW_SPIT_WINDUP_FADE_START) {
      const fadeIn = Math.min(
        (windupT - MAW_SPIT_WINDUP_FADE_START) / MAW_SPIT_WINDUP_FADE_RANGE,
        1.0,
      );
      const fadeOut = releaseT > 0 ? 1.0 - Math.min(releaseT / MAW_SPIT_RELEASE_FADE, 1.0) : 1.0;
      const globAlpha = fadeIn * fadeOut;
      if (globAlpha > MAW_SPIT_GLOB_MIN_ALPHA) {
        const globR = ts * MAW_SPIT_GLOB_RADIUS * windupT;
        const globCx = mawCx + ts * MAW_SPIT_GLOB_OFFSET_X;
        const globCy = mawCy - ts * MAW_SPIT_GLOB_OFFSET_Y;
        ctx.save();
        ctx.globalAlpha = globAlpha * MAW_SPIT_GLOB_ALPHA;
        ctx.fillStyle = '#485c0a';
        ctx.beginPath();
        ctx.ellipse(
          globCx,
          globCy,
          globR * MAW_SPIT_GLOB_W_RATIO,
          globR * MAW_SPIT_GLOB_H_RATIO,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
        ctx.globalAlpha = globAlpha * MAW_SPIT_HIGHLIGHT_ALPHA;
        ctx.fillStyle = '#60780e';
        ctx.beginPath();
        ctx.ellipse(
          globCx - globR * MAW_SPIT_HIGHLIGHT_X,
          globCy - globR * MAW_SPIT_HIGHLIGHT_Y,
          globR * MAW_SPIT_HIGHLIGHT_W,
          globR * MAW_SPIT_HIGHLIGHT_H,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
        ctx.globalAlpha = globAlpha * MAW_SPIT_GLOSS_ALPHA;
        ctx.fillStyle = 'rgba(140,180,20,0.6)';
        ctx.beginPath();
        ctx.ellipse(
          globCx - globR * MAW_SPIT_GLOSS_X,
          globCy - globR * MAW_SPIT_GLOSS_Y,
          globR * MAW_SPIT_GLOSS_W,
          globR * MAW_SPIT_GLOSS_H,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
        ctx.strokeStyle = 'rgba(52,68,6,0.55)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.globalAlpha = globAlpha * MAW_SPIT_DRIP_ALPHA;
        for (let d = 0; d < MAW_SPIT_DRIP_COUNT; d++) {
          const da = (d / MAW_SPIT_DRIP_COUNT) * TWO_PI + MAW_SPIT_DRIP_OFFSET;
          ctx.beginPath();
          ctx.moveTo(
            globCx + Math.cos(da) * globR * MAW_SPIT_DRIP_INNER,
            globCy + Math.sin(da) * globR * MAW_SPIT_DRIP_INNER,
          );
          ctx.lineTo(
            globCx + Math.cos(da) * globR * MAW_SPIT_DRIP_OUTER,
            globCy + Math.sin(da) * globR * MAW_SPIT_DRIP_OUTER,
          );
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
}

// ── Back-view spine ridge ─────────────────────────────────────────────────────

// Back ridge constants
const RIDGE_OFFSET_X = 0.06;
const RIDGE_TOP_OFFSET = 0.52;
const RIDGE_BOT_OFFSET = 0.35;
const RIDGE_KNOB_COUNT = 7;
const RIDGE_KNOB_RADIUS_BASE = 0.055;
const RIDGE_KNOB_TAPER = 0.018;
const RIDGE_PULSE_FREQ = 1.4;
const RIDGE_PULSE_STEP = 0.8;
const RIDGE_PULSE_AMP = 0.008;
const RIDGE_ELLIPSE_W_RATIO = 1.4;
const RIDGE_ELLIPSE_ANGLE = 0.2;
const RIDGE_HIGHLIGHT_X_RATIO = 0.2;
const RIDGE_HIGHLIGHT_Y_RATIO = 0.3;
const RIDGE_HIGHLIGHT_RADIUS = 0.5;

function drawBackRidge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
): void {
  // A row of vertebrae-like knobs along the back
  const ridgeX = cx + ts * RIDGE_OFFSET_X;
  const ridgeTop = cy - ts * RIDGE_TOP_OFFSET;
  const ridgeBot = cy + ts * RIDGE_BOT_OFFSET;
  const count = RIDGE_KNOB_COUNT;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const ry = ridgeTop + (ridgeBot - ridgeTop) * t;
    const knobR = ts * (RIDGE_KNOB_RADIUS_BASE - t * RIDGE_KNOB_TAPER);
    const pulse = Math.sin(time * RIDGE_PULSE_FREQ + i * RIDGE_PULSE_STEP) * ts * RIDGE_PULSE_AMP;

    ctx.fillStyle = '#2a1220';
    ctx.beginPath();
    ctx.ellipse(
      ridgeX + pulse,
      ry,
      knobR * RIDGE_ELLIPSE_W_RATIO,
      knobR,
      RIDGE_ELLIPSE_ANGLE,
      0,
      TWO_PI,
    );
    ctx.fill();

    ctx.fillStyle = '#3a1a28';
    ctx.beginPath();
    ctx.arc(
      ridgeX + pulse - knobR * RIDGE_HIGHLIGHT_X_RATIO,
      ry - knobR * RIDGE_HIGHLIGHT_Y_RATIO,
      knobR * RIDGE_HIGHLIGHT_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

// Main sprite constants
const SPRITE_CENTER_RATIO = 0.5;
const SPRITE_FACING_UP_Y_THRESHOLD = -0.3;
const SPRITE_FACING_LEFT_X_THRESHOLD = -0.1;
const SPRITE_SPIT_WINDUP_END = 0.58;
const SPRITE_SPIT_RELEASE_END = 0.42;
const SPRITE_SPIT_LEAN_RELEASE_AMP = 0.07;
const SPRITE_SPIT_LEAN_WINDUP_AMP = 0.09;
const SPRITE_SPIT_LEAN_WINDUP_FREQ = 0.5;
const SPRITE_SCREECH_RING_START = 0.3;
const SPRITE_SCREECH_RING_RANGE = 0.7;
const SPRITE_SCREECH_RING_ALPHA_SCALE = 0.5;
const SPRITE_SCREECH_RING_RADIUS_SCALE = 1.6;
const SPRITE_SCREECH_RING_OFFSET_Y = 0.1;

// Leg index constants (matching positions in LEGS array)
const LEG_IDX_LEFT_MID_BACK = 3;
const LEG_IDX_LEFT_REAR = 6; // these are out-of-order due to left/right asymmetry
const LEG_IDX_LEFT_FAR_REAR = 7;
const LEG_IDX_RIGHT_MID = 4;
const LEG_IDX_RIGHT_MID_BACK = 5;

// Back legs to draw behind body (indices 2,3 = left mid/back; 6,7 = right back)
const BACK_LEG_INDICES = [
  2,
  LEG_IDX_LEFT_MID_BACK,
  LEG_IDX_LEFT_REAR,
  LEG_IDX_LEFT_FAR_REAR,
] as const;
// Front legs to draw in front of body (indices 0,1 = left front; 4,5 = right front/mid)
const FRONT_LEG_INDICES = [0, 1, LEG_IDX_RIGHT_MID, LEG_IDX_RIGHT_MID_BACK] as const;

/**
 * Draw the Grotesque Spider.
 *
 * @param sx            Tile top-left x (screen coords)
 * @param sy            Tile top-left y (screen coords)
 * @param ts            Tile size in pixels
 * @param time          Monotonic time in seconds (performance.now() / 1000)
 * @param facingX       Normalised horizontal facing (-1 left, 0, +1 right)
 * @param facingY       Normalised vertical facing   (-1 up,   0, +1 down)
 * @param state         Animation state
 * @param stateProgress 0–1 progress within the current attack state; ignored for idle/walk
 */
export function drawGrotesqueSpiderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState = 'idle',
  stateProgress = 0,
): void {
  const cx = sx + ts * SPRITE_CENTER_RATIO;
  const cy = sy + ts * SPRITE_CENTER_RATIO;

  // Facing classification
  const absX = Math.abs(facingX);
  const absY = Math.abs(facingY);
  const movingUp = facingY < SPRITE_FACING_UP_Y_THRESHOLD && absY > absX;
  const facingLeft = facingX < SPRITE_FACING_LEFT_X_THRESHOLD;

  // For horizontal or downward: mirror the sprite rather than redraw
  const needsFlip = facingLeft;

  // Spit: lean back during wind-up, briefly lunge forward at release
  let spitLeanY = 0;
  if (state === 'attack_spit') {
    const windupT = Math.min(stateProgress / SPRITE_SPIT_WINDUP_END, 1.0);
    const releaseT = Math.max(
      (stateProgress - SPRITE_SPIT_WINDUP_END) / SPRITE_SPIT_RELEASE_END,
      0.0,
    );
    spitLeanY =
      releaseT > 0
        ? ts * SPRITE_SPIT_LEAN_RELEASE_AMP * Math.sin(releaseT * Math.PI)
        : -ts *
          SPRITE_SPIT_LEAN_WINDUP_AMP *
          Math.sin(windupT * Math.PI * SPRITE_SPIT_LEAN_WINDUP_FREQ);
  }

  if (needsFlip) {
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  if (spitLeanY !== 0) {
    ctx.save();
    ctx.translate(0, spitLeanY);
  }

  // In flipped coordinate space: treat as facing right
  const drawFacingX = needsFlip ? Math.abs(facingX) : facingX;
  const movX = state === 'walk' ? (needsFlip ? 1 : facingX) : 0;
  const movY = state === 'walk' ? facingY : 0;

  // ── 1. Hair behind body ──
  drawHair(ctx, cx, cy, ts, time, state, stateProgress, movX, movY);

  // ── 2. Back legs (drawn behind body) ──
  for (const i of BACK_LEG_INDICES) {
    const leg = LEGS[i];
    const { tx, ty } = getLegTip(cx, cy, ts, leg, time, state, stateProgress, movX, movY);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }

  // ── 3. Body ──
  drawBody(ctx, cx, cy, ts, time, state, stateProgress);

  // For back view: show spine ridge instead of face features
  if (movingUp) {
    drawBackRidge(ctx, cx, cy, ts, time);
  }

  // ── 4. Front legs (in front of body) ──
  for (const i of FRONT_LEG_INDICES) {
    const leg = LEGS[i];
    const { tx, ty } = getLegTip(cx, cy, ts, leg, time, state, stateProgress, movX, movY);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }

  // ── 5. Eyes (hidden when facing away) ──
  drawEyes(ctx, cx, cy, ts, time, drawFacingX, facingY, state, stateProgress, !movingUp);

  // ── 6. Maw (hidden on back view) ──
  drawMaw(ctx, cx, cy, ts, time, state, stateProgress, !movingUp);

  // ── 7. Screech shockwave ring ──
  if (state === 'attack_screech' && stateProgress > SPRITE_SCREECH_RING_START) {
    const ringProgress = (stateProgress - SPRITE_SCREECH_RING_START) / SPRITE_SCREECH_RING_RANGE;
    ctx.save();
    ctx.globalAlpha = (1 - ringProgress) * SPRITE_SCREECH_RING_ALPHA_SCALE;
    ctx.strokeStyle = '#600010';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy - ts * SPRITE_SCREECH_RING_OFFSET_Y,
      ts * SPRITE_SCREECH_RING_RADIUS_SCALE * ringProgress,
      0,
      TWO_PI,
    );
    ctx.stroke();
    ctx.restore();
  }

  if (spitLeanY !== 0) ctx.restore();
  if (needsFlip) ctx.restore();
}
