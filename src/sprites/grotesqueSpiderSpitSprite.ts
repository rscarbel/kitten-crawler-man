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
  const wobble = (frame / 8) * TWO_PI;

  // Three trailing slime strings — drawn first so the blob sits on top
  ctx.save();
  ctx.lineCap = 'round';
  const trailColors: readonly string[] = [
    'rgba(52,66,7,0.52)',
    'rgba(44,58,5,0.40)',
    'rgba(60,76,9,0.36)',
  ];
  for (let i = 0; i < 3; i++) {
    const yOff = (i - 1) * ts * 0.065;
    const trailLen = ts * (0.52 + i * 0.14);
    const droopAmt = ts * 0.06 * Math.sin(wobble + i * 1.1);
    ctx.strokeStyle = trailColors[i];
    ctx.lineWidth = ts * (0.07 - i * 0.018);
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.3, cy + yOff);
    ctx.quadraticCurveTo(
      cx - ts * 0.3 - trailLen * 0.45 + droopAmt,
      cy + yOff * 0.55 + droopAmt,
      cx - ts * 0.3 - trailLen,
      cy + yOff * 0.8 + droopAmt * (1 + i * 0.5),
    );
    ctx.stroke();
  }
  ctx.restore();

  // Main glob body — two overlapping ellipses for an irregular feel
  const rx = ts * (0.345 + Math.sin(wobble) * 0.038);
  const ry = ts * (0.275 - Math.cos(wobble) * 0.03);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#4a5e0a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#607010';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.065, cy - ts * 0.038, rx * 0.74, ry * 0.78, -0.28, 0, TWO_PI);
  ctx.fill();

  // Sickly inner shadow
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#38480a';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.055, cy + ts * 0.03, rx * 0.44, ry * 0.46, 0.18, 0, TWO_PI);
  ctx.fill();

  // Specular highlight
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = 'rgba(160,200,40,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.32, cy - ry * 0.36, rx * 0.27, ry * 0.2, -0.35, 0, TWO_PI);
  ctx.fill();

  ctx.restore();

  // Small trailing droplet
  const dropX = cx - rx * 1.28 + Math.sin(wobble) * ts * 0.03;
  const dropY = cy + ts * 0.038 * Math.cos(wobble * 1.3);
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#4a5e08';
  ctx.beginPath();
  ctx.arc(dropX, dropY, ts * 0.058, 0, TWO_PI);
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

function buildWebStrands(): readonly WebStrand[] {
  const out: WebStrand[] = [];
  for (let i = 0; i < 8; i++) {
    const h1 = (i * 137 + 11) % 97;
    const h2 = (i * 73 + 29) % 89;
    out.push({
      aAngle: (i / 8) * TWO_PI + (h1 / 97) * 0.45,
      bAngle: (i / 8) * TWO_PI + Math.PI * 0.62 + (h2 / 89) * 0.85,
      rA: 0.7 + (h1 % 3) * 0.1,
      rB: 0.65 + (h2 % 4) * 0.08,
      phase: (i / 8) * TWO_PI,
    });
  }
  return out;
}

const WEB_STRANDS = buildWebStrands();

// ── Spit trap: splat landing animation ───────────────────────────────────────

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
  const progress = frame / 7;
  const maxR = ts * 1.48;
  const r = maxR * (0.07 + progress * 0.93);

  ctx.save();

  // Radial splash droplets — fly outward then shrink
  const dropCount = 7 + Math.floor(frame * 1.5);
  ctx.fillStyle = 'rgba(66,84,10,0.55)';
  for (let i = 0; i < dropCount; i++) {
    const angle = (i / dropCount) * TWO_PI + (i % 3) * 0.18;
    const distFrac = 0.55 + (i % 4) * 0.12;
    const dist = r * distFrac * (0.5 + progress * 0.5);
    const dropR = ts * (0.052 - (i % 3) * 0.011) * (1 - progress * 0.55);
    if (dropR > 0.5) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, dropR, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Thin outer splash ring
  ctx.globalAlpha = (1 - progress) * 0.45;
  ctx.strokeStyle = '#506010';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.08, r * 0.74, 0, 0, TWO_PI);
  ctx.stroke();

  // Main puddle (building up)
  ctx.globalAlpha = 0.28 + progress * 0.45;
  ctx.fillStyle = '#384808';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.06, r * 0.72, 0, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = 0.48 + progress * 0.22;
  ctx.fillStyle = '#4c6010';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.06, cy - r * 0.04, r * 0.82, r * 0.58, -0.1, 0, TWO_PI);
  ctx.fill();

  // Wet gleam appears as puddle settles
  if (progress > 0.5) {
    ctx.globalAlpha = (progress - 0.5) * 2 * 0.22;
    ctx.fillStyle = 'rgba(140,180,20,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.22, cy - r * 0.26, r * 0.28, r * 0.18, -0.25, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
}

// ── Spit trap: idle sticky puddle ────────────────────────────────────────────

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
  const time = (frame / 8) * TWO_PI;
  const breathe = Math.sin(time * 2.1) * 0.014;
  const rx = ts * 1.48 * (1 + breathe);
  const ry = ts * 1.04 * (1 + breathe);

  ctx.save();

  // Soft outer glow — signals the sticky zone
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#6a9014';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.14, ry * 1.14, 0, 0, TWO_PI);
  ctx.fill();

  // Base puddle
  ctx.globalAlpha = 0.74;
  ctx.fillStyle = '#384808';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  // Secondary brighter layer
  ctx.globalAlpha = 0.56;
  ctx.fillStyle = '#4c6010';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.07, cy - ts * 0.04, rx * 0.8, ry * 0.76, -0.12, 0, TWO_PI);
  ctx.fill();

  // Wet surface highlight
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = 'rgba(140,180,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.21, cy - ry * 0.24, rx * 0.34, ry * 0.26, -0.18, 0, TWO_PI);
  ctx.fill();

  // Web / sticky strands crossing the puddle
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = '#6a8812';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const strand of WEB_STRANDS) {
    const sway = Math.sin(time + strand.phase) * ts * 0.045;
    const sway2 = Math.cos(time * 0.7 + strand.phase) * ts * 0.028;
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
  const bubbleCycle = ((time * 1.4 + 0.8) % TWO_PI) / TWO_PI; // 0→1 per bubble cycle
  const bubbleAlpha = Math.sin(bubbleCycle * Math.PI);
  if (bubbleAlpha > 0.05) {
    const bubbleR = ts * 0.095 * bubbleAlpha;
    const bx = cx + ts * 0.32;
    const by = cy - ts * 0.12;
    ctx.globalAlpha = bubbleAlpha * 0.62;
    ctx.strokeStyle = '#8aaa18';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(bx, by, bubbleR, 0, TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = bubbleAlpha * 0.38;
    ctx.fillStyle = '#aace24';
    ctx.beginPath();
    ctx.arc(bx - bubbleR * 0.32, by - bubbleR * 0.32, bubbleR * 0.24, 0, TWO_PI);
    ctx.fill();
  }

  // Second smaller bubble, offset phase
  const bubble2Cycle = ((time * 1.1 + 3.8) % TWO_PI) / TWO_PI;
  const bubble2Alpha = Math.sin(bubble2Cycle * Math.PI);
  if (bubble2Alpha > 0.05) {
    const bubbleR2 = ts * 0.058 * bubble2Alpha;
    ctx.globalAlpha = bubble2Alpha * 0.48;
    ctx.strokeStyle = '#7a9a14';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(cx - ts * 0.38, cy + ts * 0.18, bubbleR2, 0, TWO_PI);
    ctx.stroke();
  }

  ctx.restore();
}
