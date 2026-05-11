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

function buildHairStrands(): readonly HairStrand[] {
  const out: HairStrand[] = [];
  for (let i = 0; i < 48; i++) {
    const h1 = (i * 137 + 11) % 97;
    const h2 = (i * 73 + 29) % 89;
    const h3 = (i * 41 + 53) % 79;
    const h4 = (i * 97 + 7) % 61;
    const h5 = (i * 19 + 83) % 53;
    out.push({
      ax: (h1 / 97 - 0.5) * 0.95,
      ay: (h2 / 89 - 0.2) * 0.28,
      len: 0.9 + (h3 / 79) * 2.4,
      phase: (h4 / 61) * TWO_PI,
      freq: 0.45 + (h5 / 53) * 1.9,
      thick: 1.0 + (h1 % 5) * 0.45,
      bend: ((h2 % 7) / 7 - 0.5) * 0.55,
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
  const headCy = cy - ts * 0.44;

  ctx.save();
  ctx.lineCap = 'round';

  for (let i = 0; i < HAIR_STRANDS.length; i++) {
    const s = HAIR_STRANDS[i];

    const ax = cx + s.ax * ts;
    const ay = headCy + s.ay * ts;
    const strandLen = s.len * ts;

    // Wind: hair streams opposite to movement direction
    const windX = -movingX * ts * 0.22;
    const windY = -movingY * ts * 0.14;

    // Per-strand oscillation
    const sway = Math.sin(time * s.freq + s.phase) * ts * 0.07;
    const sway2 = Math.cos(time * s.freq * 0.63 + s.phase) * ts * 0.04;

    // Screech: hair radiates outward from centre
    let splayX = 0;
    let splayY = 0;
    if (state === 'attack_screech') {
      const splay = Math.sin(stateProgress * Math.PI);
      splayX = s.ax * ts * splay * 1.6;
      splayY = -(strandLen * 0.4) * splay;
    }

    // End point of strand
    const ex = ax + s.bend * ts + windX * s.len * 0.35 + sway + splayX;
    const ey = ay + strandLen * 0.75 + windY * s.len * 0.18 + splayY;

    // Bezier control point (midway with secondary sway)
    const cpx = ax + s.bend * ts * 0.5 + windX * 0.2 + sway2;
    const cpy = ay + strandLen * 0.38 + windY * 0.12;

    // Almost-pure-black with very slight per-strand variation
    const v = 2 + (i % 5) * 2;
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

function drawLeg(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  ts: number,
  kOut: number,
): void {
  const seg1 = ts * 0.66;
  const seg2 = ts * 0.72;

  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;

  const halfDist = dist * 0.5;
  const totalLen = (seg1 + seg2) * 0.5;
  const h = Math.sqrt(Math.max(0, totalLen * totalLen - halfDist * halfDist));

  const mx = (ax + tx) * 0.5;
  const my = (ay + ty) * 0.5;
  const px = (-dy / dist) * kOut;
  const py = (dx / dist) * kOut;

  const kx = mx + px * h;
  const ky = my + py * h;

  const baseThick = ts * 0.065;

  // Upper segment
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(kx, ky);
  ctx.strokeStyle = '#1a0a12';
  ctx.lineWidth = baseThick * 2.0;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Lower segment — slightly thinner, darker
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = '#120608';
  ctx.lineWidth = baseThick * 1.35;
  ctx.stroke();

  // Knee joint nub
  ctx.fillStyle = '#2a1020';
  ctx.beginPath();
  ctx.arc(kx, ky, baseThick * 1.3, 0, TWO_PI);
  ctx.fill();

  // Claw at foot — three barbs
  const footAngle = Math.atan2(ty - ky, tx - kx);
  ctx.strokeStyle = '#080408';
  ctx.lineWidth = baseThick * 0.85;
  for (let c = 0; c < 3; c++) {
    const ca = footAngle + (c - 1) * 0.38;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ca) * ts * 0.13, ty + Math.sin(ca) * ts * 0.13);
    ctx.stroke();
  }
}

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
    const idleSway = Math.sin(time * leg.freq * 0.25 + leg.phase) * ts * 0.035;
    return { tx: restX + idleSway, ty: restY };
  }

  if (state === 'walk') {
    const cycle = Math.sin(time * leg.freq + leg.phase);
    if (cycle > 0.25) {
      const liftT = (cycle - 0.25) / 0.75;
      const lift = Math.sin(liftT * Math.PI) * ts * 0.22;
      return {
        tx: restX + movingX * ts * 0.45 * liftT,
        ty: restY + movingY * ts * 0.25 * liftT - lift,
      };
    }
    return { tx: restX, ty: restY };
  }

  if (state === 'attack_slam') {
    // Front legs (|ax| < 0.5 and ry < 0) rear up then slam
    if (leg.ry < 0) {
      const lift =
        stateProgress < 0.55
          ? Math.sin((stateProgress / 0.55) * Math.PI * 0.5)
          : 1.0 - Math.sin(((stateProgress - 0.55) / 0.45) * Math.PI * 0.5);
      return {
        tx: restX + leg.kOut * ts * 0.2 * stateProgress,
        ty: restY - ts * 1.35 * lift,
      };
    }
    return { tx: restX, ty: restY };
  }

  return { tx: restX, ty: restY };
}

// ── Body drawing ──────────────────────────────────────────────────────────────

function drawBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const breathe = Math.sin(time * 0.82) * 0.026;
  const screamBulge = state === 'attack_screech' ? Math.sin(stateProgress * Math.PI) * 0.22 : 0;

  // Ground shadow
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.06, cy + ts * 0.46, ts * 1.15, ts * 0.19, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // Main body mass
  ctx.fillStyle = '#12070e';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - ts * 0.05,
    ts * (0.74 + breathe + screamBulge * 0.28),
    ts * (0.6 + breathe + screamBulge * 0.28),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  // Asymmetric left shoulder lump
  ctx.fillStyle = '#1b0b15';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.48, cy - ts * 0.26, ts * 0.43, ts * 0.37, -0.28, 0, TWO_PI);
  ctx.fill();

  // Smaller right side protrusion — different shape
  ctx.fillStyle = '#170910';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.36, cy - ts * 0.1, ts * 0.34, ts * 0.46, 0.22, 0, TWO_PI);
  ctx.fill();

  // Lower abdomen — another fused mass
  ctx.fillStyle = '#1e0c18';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.09, cy + ts * 0.23, ts * 0.53, ts * 0.34, 0.14, 0, TWO_PI);
  ctx.fill();

  // Head region connector
  ctx.fillStyle = '#100609';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.05, cy - ts * 0.46, ts * 0.4, ts * 0.27, 0, 0, TWO_PI);
  ctx.fill();

  // Flesh tears — exposed sickly interior
  const tears: Array<readonly [number, number, number, number, number]> = [
    [-0.26, -0.05, 0.21, 0.077, 0.3] as const,
    [0.19, -0.16, 0.13, 0.055, -0.22] as const,
    [-0.05, 0.19, 0.11, 0.048, 0.78] as const,
    [0.29, 0.09, 0.087, 0.038, -0.5] as const,
  ];

  for (const [ox, oy, ew, eh, angle] of tears) {
    ctx.fillStyle = '#4a1530';
    ctx.beginPath();
    ctx.ellipse(cx + ox * ts, cy + oy * ts, ew * ts, eh * ts, angle, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#7a2040';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox * ts - ts * ew * 0.22,
      cy + oy * ts - ts * eh * 0.28,
      ew * ts * 0.52,
      eh * ts * 0.4,
      angle,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // Bioluminescent veins — sickly green-grey glow
  ctx.save();
  ctx.globalAlpha = 0.12 + 0.07 * Math.sin(time * 2.05);
  ctx.strokeStyle = '#1e3612';
  ctx.lineWidth = 1.4;
  const veins: Array<readonly [number, number, number, number, number, number]> = [
    [-0.31, -0.09, 0.09, -0.4, -0.16, 0.16] as const,
    [0.14, -0.01, -0.11, -0.31, 0.19, -0.21] as const,
    [-0.1, 0.21, 0.19, 0.1, -0.22, -0.1] as const,
  ];
  for (const [x1, y1, cpx, cpy, x2, y2] of veins) {
    ctx.beginPath();
    ctx.moveTo(cx + x1 * ts, cy + y1 * ts);
    ctx.quadraticCurveTo(cx + cpx * ts, cy + cpy * ts, cx + x2 * ts, cy + y2 * ts);
    ctx.stroke();
  }
  ctx.restore();

  // Slam: white impact flash at the end
  if (state === 'attack_slam' && stateProgress > 0.82) {
    const flashAlpha = ((stateProgress - 0.82) / 0.18) * 0.55;
    ctx.save();
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ts * 0.3, ts * 1.45, ts * 0.7, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

// ── Eyes drawing ──────────────────────────────────────────────────────────────

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
    const blinkRaw = Math.sin(time * 0.38 + eye.blinkPhase);
    const blinkAmt = blinkRaw > 0.93 ? (blinkRaw - 0.93) / 0.07 : 0;

    // Sclera — yellow-white; bloodshot tinted
    ctx.fillStyle = eye.bloodshot ? '#e8d8b0' : '#d2c8a4';
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * (1 - blinkAmt * 0.92) * (1 + scream * 0.32), 0, 0, TWO_PI);
    ctx.fill();

    // Bloodshot veins
    if (eye.bloodshot) {
      ctx.save();
      ctx.globalAlpha = 0.52;
      ctx.strokeStyle = '#cc1818';
      ctx.lineWidth = 0.7;
      for (let v = 0; v < 5; v++) {
        const va = (v / 5) * TWO_PI + eye.blinkPhase;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(va) * er * 0.42, ey + Math.sin(va) * er * 0.42);
        ctx.lineTo(ex + Math.cos(va + 0.28) * er * 0.87, ey + Math.sin(va + 0.28) * er * 0.87);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (blinkAmt < 0.5) {
      // Pupil — tracks facing dir; shrinks to pinpoint during screech
      const pupilR = eye.slit ? er * 0.16 : er * (0.44 - scream * 0.28);
      const pupilX = ex + facingX * er * 0.22;
      const pupilY = ey + facingY * er * 0.22;

      ctx.fillStyle = '#040204';
      if (eye.slit) {
        ctx.beginPath();
        ctx.ellipse(pupilX, pupilY, pupilR, er * 0.56, 0, 0, TWO_PI);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(pupilX, pupilY, pupilR, 0, TWO_PI);
        ctx.fill();
      }

      // Specular glint
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.arc(ex - er * 0.26, ey - er * 0.23, er * 0.19, 0, TWO_PI);
      ctx.fill();
    }

    // Eyelid close
    if (blinkAmt > 0) {
      ctx.fillStyle = '#12070e';
      ctx.beginPath();
      ctx.ellipse(ex, ey - er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ex, ey + er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// ── Maw drawing ───────────────────────────────────────────────────────────────

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

  const mawCx = cx - ts * 0.04;
  const mawCy = cy + ts * 0.12;

  // Base open: slight breathing
  let openAmt = 0.055 + Math.sin(time * 0.78) * 0.022;
  if (state === 'attack_screech') {
    openAmt =
      stateProgress < 0.5
        ? 0.055 + stateProgress * 2.0 * 0.82
        : 0.055 + 0.82 - (stateProgress - 0.5) * 0.5;
  } else if (state === 'attack_slam') {
    openAmt += stateProgress * 0.28;
  } else if (state === 'attack_spit') {
    // Maw opens during wind-up to gather the glob
    const windupT = Math.min(stateProgress / 0.58, 1.0);
    openAmt += windupT * 0.22;
  }

  const mawW = ts * (0.46 + openAmt * 0.28);
  const mawH = ts * openAmt;

  // Throat void
  ctx.fillStyle = '#060003';
  ctx.beginPath();
  ctx.ellipse(mawCx, mawCy, mawW, mawH, 0, 0, TWO_PI);
  ctx.fill();

  // Inner glow during screech
  if (state === 'attack_screech' && stateProgress > 0.08) {
    ctx.save();
    ctx.globalAlpha = Math.min(stateProgress * 2.0, 1.0) * 0.68;
    const grad = ctx.createRadialGradient(mawCx, mawCy, 0, mawCx, mawCy, mawW * 0.8);
    grad.addColorStop(0, '#ff1020');
    grad.addColorStop(0.5, '#8b0012');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(mawCx, mawCy, mawW * 0.9, mawH * 0.9, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  if (openAmt > 0.04) {
    // Outer teeth row — inward-curving
    const outerCount = 14;
    const toothScale = Math.min(openAmt / 0.1, 1.0);
    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * TWO_PI;
      const ex = mawCx + Math.cos(angle) * mawW * 0.88;
      const ey = mawCy + Math.sin(angle) * mawH * 0.88;
      const tLen = ts * (0.055 + (i % 3) * 0.018) * toothScale;
      const inward = angle + Math.PI;

      ctx.fillStyle = '#c4bca4';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.21) * tLen, ey + Math.sin(angle - 0.21) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.55, ey + Math.sin(inward) * tLen * 1.55);
      ctx.lineTo(ex + Math.cos(angle + 0.21) * tLen, ey + Math.sin(angle + 0.21) * tLen);
      ctx.closePath();
      ctx.fill();
    }

    // Inner secondary teeth row
    const innerCount = 9;
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * TWO_PI + Math.PI / innerCount;
      const ex = mawCx + Math.cos(angle) * mawW * 0.52;
      const ey = mawCy + Math.sin(angle) * mawH * 0.52;
      const tLen = ts * 0.042 * toothScale;
      const inward = angle + Math.PI;

      ctx.fillStyle = '#9e9684';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.26) * tLen, ey + Math.sin(angle - 0.26) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.4, ey + Math.sin(inward) * tLen * 1.4);
      ctx.lineTo(ex + Math.cos(angle + 0.26) * tLen, ey + Math.sin(angle + 0.26) * tLen);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Spit glob: viscous olive-green ball that grows at the maw during wind-up
  // and vanishes abruptly at the moment of release.
  if (state === 'attack_spit') {
    const windupT = Math.min(stateProgress / 0.58, 1.0);
    const releaseT = Math.max((stateProgress - 0.58) / 0.42, 0.0);
    if (windupT > 0.08) {
      const fadeIn = Math.min((windupT - 0.08) / 0.28, 1.0);
      const fadeOut = releaseT > 0 ? 1.0 - Math.min(releaseT / 0.5, 1.0) : 1.0;
      const globAlpha = fadeIn * fadeOut;
      if (globAlpha > 0.01) {
        const globR = ts * 0.28 * windupT;
        const globCx = mawCx + ts * 0.04;
        const globCy = mawCy - ts * 0.07;
        ctx.save();
        ctx.globalAlpha = globAlpha * 0.9;
        ctx.fillStyle = '#485c0a';
        ctx.beginPath();
        ctx.ellipse(globCx, globCy, globR * 1.18, globR * 0.9, 0, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = globAlpha * 0.62;
        ctx.fillStyle = '#60780e';
        ctx.beginPath();
        ctx.ellipse(
          globCx - globR * 0.22,
          globCy - globR * 0.26,
          globR * 0.6,
          globR * 0.46,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
        ctx.globalAlpha = globAlpha * 0.48;
        ctx.fillStyle = 'rgba(140,180,20,0.6)';
        ctx.beginPath();
        ctx.ellipse(
          globCx - globR * 0.3,
          globCy - globR * 0.3,
          globR * 0.28,
          globR * 0.2,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
        ctx.strokeStyle = 'rgba(52,68,6,0.55)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.globalAlpha = globAlpha * 0.52;
        for (let d = 0; d < 4; d++) {
          const da = (d / 4) * TWO_PI + 1.3;
          ctx.beginPath();
          ctx.moveTo(globCx + Math.cos(da) * globR * 0.78, globCy + Math.sin(da) * globR * 0.78);
          ctx.lineTo(globCx + Math.cos(da) * globR * 1.48, globCy + Math.sin(da) * globR * 1.48);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
}

// ── Back-view spine ridge ─────────────────────────────────────────────────────

function drawBackRidge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  time: number,
): void {
  // A row of vertebrae-like knobs along the back
  const ridgeX = cx + ts * 0.06;
  const ridgeTop = cy - ts * 0.52;
  const ridgeBot = cy + ts * 0.35;
  const count = 7;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const ry = ridgeTop + (ridgeBot - ridgeTop) * t;
    const knobR = ts * (0.055 - t * 0.018);
    const pulse = Math.sin(time * 1.4 + i * 0.8) * ts * 0.008;

    ctx.fillStyle = '#2a1220';
    ctx.beginPath();
    ctx.ellipse(ridgeX + pulse, ry, knobR * 1.4, knobR, 0.2, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#3a1a28';
    ctx.beginPath();
    ctx.arc(ridgeX + pulse - knobR * 0.2, ry - knobR * 0.3, knobR * 0.5, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Draw the Nightmare.
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
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.5;

  // Facing classification
  const absX = Math.abs(facingX);
  const absY = Math.abs(facingY);
  const movingUp = facingY < -0.3 && absY > absX;
  const facingLeft = facingX < -0.1;

  // For horizontal or downward: mirror the sprite rather than redraw
  const needsFlip = facingLeft;

  // Spit: lean back during wind-up, briefly lunge forward at release
  let spitLeanY = 0;
  if (state === 'attack_spit') {
    const windupT = Math.min(stateProgress / 0.58, 1.0);
    const releaseT = Math.max((stateProgress - 0.58) / 0.42, 0.0);
    spitLeanY =
      releaseT > 0
        ? ts * 0.07 * Math.sin(releaseT * Math.PI)
        : -ts * 0.09 * Math.sin(windupT * Math.PI * 0.5);
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
  for (const i of [2, 3, 6, 7]) {
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
  for (const i of [0, 1, 4, 5]) {
    const leg = LEGS[i];
    const { tx, ty } = getLegTip(cx, cy, ts, leg, time, state, stateProgress, movX, movY);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }

  // ── 5. Eyes (hidden when facing away) ──
  drawEyes(ctx, cx, cy, ts, time, drawFacingX, facingY, state, stateProgress, !movingUp);

  // ── 6. Maw (hidden on back view) ──
  drawMaw(ctx, cx, cy, ts, time, state, stateProgress, !movingUp);

  // ── 7. Screech shockwave ring ──
  if (state === 'attack_screech' && stateProgress > 0.3) {
    const ringProgress = (stateProgress - 0.3) / 0.7;
    ctx.save();
    ctx.globalAlpha = (1 - ringProgress) * 0.5;
    ctx.strokeStyle = '#600010';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - ts * 0.1, ts * 1.6 * ringProgress, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  if (spitLeanY !== 0) ctx.restore();
  if (needsFlip) ctx.restore();
}
