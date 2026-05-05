/**
 * Regenerates the sky_fowl_body.png walk row (row 0, 8 frames) with a
 * proper 8-frame biped gait cycle, then rewrites the pants_mask walk row
 * to match the new thigh positions.
 *
 * All other rows (idle, peck, aggressive) are preserved from the existing PNGs.
 *
 * Run with:  node scripts/generate-sky-fowl.mjs
 */

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'fs';

const FW = 96;     // frame width (px)
const FH = 128;    // frame height (px)
const COLS = 8;    // walk row has 8 frames
const TOTAL_W = FW * COLS;   // 768
const TOTAL_H = FH * 4;      // 512  (walk, idle, peck, aggressive)
const WALK_ROW = 0;

// ─── colour palette ──────────────────────────────────────────────────────────
const C = {
  shadow:     'rgba(0,0,0,0.22)',
  body:       '#7a5530',
  bodyDark:   '#4a3015',
  bodyLight:  '#a07840',
  belly:      '#d4b878',
  leg:        '#c8a030',
  legScale:   '#9a7820',
  talon:      '#2a1a08',
  beakUpper:  '#e0a418',
  beakHook:   '#b07800',
  eyeWhite:   '#fff5d0',
  eyeIris:    '#e89010',
  eyePupil:   '#140800',
  eyeGlow:    'rgba(255,255,255,0.65)',
  browDark:   '#4a3015',
  tailDark:   '#4a3015',
  tailLight:  '#a07840',
};

// ─── geometry helpers ─────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Compute one foot's position for a given gait phase [0,1).
 *
 *  [0, 0.5) → STANCE: foot slides from front to back on the ground.
 *  [0.5, 1) → SWING:  foot lifts in an arc back to front.
 *
 * @param {number} p       Gait phase for this foot [0,1)
 * @param {number} cx      Body centre X in frame
 * @param {number} groundY Ground Y in frame
 * @param {number} stride  Max foot X offset from cx
 * @param {number} lift    Max foot lift height during swing
 */
function footPos(p, cx, groundY, stride, lift) {
  p = ((p % 1) + 1) % 1;
  if (p < 0.5) {
    // Stance: cosine slide from +stride → -stride
    const t = p * 2;          // 0→1
    return {
      x: cx + stride * Math.cos(t * Math.PI),
      y: groundY,
      lifted: false,
    };
  } else {
    // Swing: arc from -stride → +stride with a sine lift
    const t = (p - 0.5) * 2; // 0→1
    return {
      x: cx - stride * Math.cos(t * Math.PI),
      y: groundY - lift * Math.sin(t * Math.PI),
      lifted: true,
    };
  }
}

/**
 * Knee (visible ankle) position for a bird leg.
 * Bird tarsometatarsus goes from knee downward; the knee bends backward.
 */
function kneePos(hipX, hipY, foot, kneeDropY) {
  // Put the knee between hip and foot horizontally (bias toward hip side),
  // with a backward (negative-X relative to stride direction) offset for
  // the characteristic bird-leg backward bend.
  const midX = lerp(hipX, foot.x, 0.45);
  const kneeY = hipY + kneeDropY;
  // When foot is lifted, knee rises a bit and bends more prominently
  const riseY = foot.lifted ? -5 : 0;
  return { x: midX, y: kneeY + riseY };
}

// ─── per-frame drawing ────────────────────────────────────────────────────────

/**
 * Draw one complete sky-fowl body frame into ctx at pixel origin (ox, oy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasRenderingContext2D} mctx  pants-mask canvas (or null)
 * @param {number} ox   left edge of this frame in the canvas
 * @param {number} oy   top edge of this frame in the canvas
 * @param {object} opts
 *   walkPhase  [0,1)   – gait cycle position (only used for walk row)
 *   isIdle     boolean
 *   peckAmt    [0,1]   – head-forward lunge amount
 *   isAgg      boolean – aggressive (red eye)
 */
function drawFrame(ctx, mctx, ox, oy, { walkPhase = 0, isIdle = false, peckAmt = 0, isAgg = false } = {}) {
  const cx = ox + FW / 2;    // 48 from left edge of frame

  // Vertical layout (absolute y in canvas).
  // groundY/bodyCy/bodyRy/kneeDrop/liftH are scaled down to match the idle/peck/aggressive rows.
  // Horizontal dims (bodyRx, hip offsets, stride) are kept at original values to preserve width.
  const groundY  = oy + 76;
  const bodyCy   = oy + 44;
  const bodyRx   = 16;
  const bodyRy   = 8;

  // Leg attachment points (hips)
  const hipLX = cx - 7;
  const hipRX = cx + 7;
  const hipY  = bodyCy + bodyRy - 1;   // ≈ oy + 51

  // Gait parameters
  const stride   = 11;   // half-stride (px) — horizontal, not scaled
  const liftH    = 11;   // foot arc height (px)
  const kneeDrop = 17;   // knee is this far below hip — matches idle/peck/aggressive rows

  // For non-walk rows, feet are in neutral standing position
  let lFoot, rFoot;
  if (isIdle || isAgg) {
    lFoot = { x: cx - 7, y: groundY, lifted: false };
    rFoot = { x: cx + 7, y: groundY, lifted: false };
  } else if (peckAmt > 0) {
    // Feet planted during peck
    lFoot = { x: cx - 7, y: groundY, lifted: false };
    rFoot = { x: cx + 9, y: groundY, lifted: false };
  } else {
    // Walk: alternating gait, right leads left by half-cycle
    const rightPhase = walkPhase;
    const leftPhase  = (walkPhase + 0.5) % 1;
    rFoot = footPos(rightPhase, cx, groundY, stride, liftH);
    lFoot = footPos(leftPhase,  cx, groundY, stride, liftH);
  }

  const lKnee = kneePos(hipLX, hipY, lFoot, kneeDrop);
  const rKnee = kneePos(hipRX, hipY, rFoot, kneeDrop);

  // Slight body bob during walk (lower when both feet near centre)
  const bobY = (!isIdle && !isAgg && peckAmt === 0)
    ? -Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 1.5
    : 0;

  // Head lunge during peck
  const peckOffX = peckAmt * 6;

  // ── shadow ──
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 3, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── tail feathers (behind body) ──
  const tailSwayX = isIdle ? 0 : Math.sin(walkPhase * Math.PI * 2) * 2;
  const tailBaseY = bodyCy + bodyRy + bobY;
  for (let i = -1; i <= 1; i++) {
    const angle = i * 0.28 + tailSwayX * 0.04;
    ctx.fillStyle = C.tailDark;
    ctx.beginPath();
    ctx.ellipse(cx - 4 + i * 6 + tailSwayX, tailBaseY + 4, 4, 7, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.tailLight;
    ctx.beginPath();
    ctx.ellipse(cx - 4 + i * 6 + tailSwayX, tailBaseY + 3, 1.5, 4, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── BACK LEG (whichever is further back in X — drawn first) ──
  // Draw the leg that is behind first so the front leg renders on top.
  const drawLeg = (hipX, knee, foot, isMask) => {
    const c = isMask ? { thigh: '#ffffff', tarsus: '#ffffff', scale: '#ffffff', talon: '#ffffff' }
                     : { thigh: C.leg, tarsus: C.leg, scale: C.legScale, talon: C.talon };
    // Thigh (hip → knee) — covered by pants
    ctx.lineCap = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = c.thigh;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY + bobY);
    ctx.lineTo(knee.x, knee.y + bobY);
    ctx.stroke();

    if (!isMask) {
      // Tarsus (knee → foot) — bare, scaled
      ctx.lineWidth = 4;
      ctx.strokeStyle = c.tarsus;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y + bobY);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();

      // Scale notches on tarsus
      ctx.strokeStyle = c.scale;
      ctx.lineWidth = 1.2;
      for (let s = 1; s <= 2; s++) {
        const t = s / 3;
        const px = lerp(knee.x, foot.x, t);
        const py = lerp(knee.y + bobY, foot.y, t);
        ctx.beginPath();
        ctx.moveTo(px - 3, py);
        ctx.lineTo(px + 3, py);
        ctx.stroke();
      }

      // Three forward talons + one rear talon
      ctx.strokeStyle = c.talon;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let t = -1; t <= 1; t++) {
        ctx.beginPath();
        ctx.moveTo(foot.x, foot.y);
        ctx.quadraticCurveTo(foot.x + 3 + t * 1, foot.y + 1, foot.x + 5 + t * 2, foot.y + 3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.quadraticCurveTo(foot.x - 2, foot.y + 1, foot.x - 4, foot.y + 2);
      ctx.stroke();
    }
  };

  // Which leg is further back (smaller X when facing right)?
  const lIsBack = lFoot.x <= rFoot.x;
  const [backHipX, backKnee, backFoot] = lIsBack
    ? [hipLX, lKnee, lFoot]
    : [hipRX, rKnee, rFoot];
  const [frontHipX, frontKnee, frontFoot] = lIsBack
    ? [hipRX, rKnee, rFoot]
    : [hipLX, lKnee, lFoot];

  drawLeg(backHipX, backKnee, backFoot, false);

  // ── body ellipse ──
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy + bobY, bodyRx, bodyRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly (lighter front)
  ctx.fillStyle = C.belly;
  ctx.beginPath();
  ctx.ellipse(cx + 2, bodyCy + bobY + 1, bodyRx * 0.55, bodyRy * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── folded wings (sides of body) ──
  for (const [side, angle] of [[-1, -0.3], [1, 0.3]]) {
    const wingX = cx + side * (bodyRx - 2);
    const wingY = bodyCy + bobY + 1;
    ctx.fillStyle = C.bodyDark;
    ctx.beginPath();
    ctx.ellipse(wingX, wingY, 6, bodyRy * 0.75, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.bodyLight;
    ctx.beginPath();
    ctx.ellipse(wingX, wingY, 2.5, bodyRy * 0.48, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── FRONT LEG (drawn over body) ──
  drawLeg(frontHipX, frontKnee, frontFoot, false);

  // ── neck ──
  const neckCy = bodyCy + bobY - bodyRy - 3;
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.ellipse(cx + 1, neckCy, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── head ──
  const headR = 10;
  const headCy = neckCy - headR * 0.6;
  const headCx = cx + 1 + peckOffX;

  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // Cap (dark top of head)
  ctx.fillStyle = C.bodyDark;
  ctx.beginPath();
  ctx.ellipse(headCx - 1, headCy - headR * 0.3, headR * 0.85, headR * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Crest feather
  ctx.strokeStyle = C.bodyDark;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(headCx, headCy - headR * 0.9);
  ctx.quadraticCurveTo(headCx + 2, headCy - headR * 1.35, headCx + 4, headCy - headR * 1.25);
  ctx.stroke();

  // ── eye ──
  const eyeX = headCx + headR * 0.32;
  const eyeY = headCy - headR * 0.18;
  const eyeR = headR * 0.27;

  ctx.fillStyle = C.eyeWhite;
  ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = C.eyeIris;
  ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR * 0.72, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = C.eyePupil;
  ctx.beginPath(); ctx.arc(eyeX + eyeR * 0.06, eyeY + eyeR * 0.06, eyeR * 0.36, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = C.eyeGlow;
  ctx.beginPath(); ctx.arc(eyeX - eyeR * 0.18, eyeY - eyeR * 0.2, eyeR * 0.2, 0, Math.PI * 2); ctx.fill();

  // Aggressive: red eye ring
  if (isAgg) {
    ctx.strokeStyle = 'rgba(210,40,40,0.80)';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR * 1.3, 0, Math.PI * 2); ctx.stroke();
  }

  // Brow
  ctx.strokeStyle = C.browDark;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (isAgg) {
    ctx.moveTo(eyeX - eyeR, eyeY - eyeR * 0.95);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.4);
  } else {
    ctx.moveTo(eyeX - eyeR, eyeY - eyeR * 1.15);
    ctx.lineTo(eyeX + eyeR * 0.55, eyeY - eyeR * 1.1);
  }
  ctx.stroke();

  // ── beak ──
  const bx = headCx + headR * 0.68;
  const by = headCy + headR * 0.05;
  const jawOpen = peckAmt * headR * 0.12 + (isAgg ? headR * 0.06 : 0);

  ctx.fillStyle = C.beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by - headR * 0.15);
  ctx.quadraticCurveTo(bx + headR * 0.7, by + headR * 0.05, bx + headR * 0.5, by + headR * 0.35);
  ctx.lineTo(bx, by + headR * 0.2);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = C.beakHook;
  ctx.beginPath();
  ctx.moveTo(bx + headR * 0.44, by + headR * 0.3);
  ctx.quadraticCurveTo(bx + headR * 0.68, by + headR * 0.38, bx + headR * 0.52, by + headR * 0.52);
  ctx.lineTo(bx + headR * 0.3, by + headR * 0.42);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = C.beakUpper;
  ctx.beginPath();
  ctx.moveTo(bx, by + headR * 0.2 + jawOpen);
  ctx.quadraticCurveTo(bx + headR * 0.45, by + headR * 0.3 + jawOpen, bx + headR * 0.42, by + headR * 0.4 + jawOpen);
  ctx.lineTo(bx, by + headR * 0.32 + jawOpen);
  ctx.closePath(); ctx.fill();

  // ── pants mask (thigh only, white-on-transparent) ──
  if (mctx) {
    const maskThigh = (hx, knee) => {
      mctx.lineCap = 'round';
      mctx.lineWidth = 6;
      mctx.strokeStyle = '#ffffff';
      mctx.beginPath();
      mctx.moveTo(hx, hipY + bobY);
      mctx.lineTo(knee.x, knee.y + bobY);
      mctx.stroke();
    };
    maskThigh(backHipX, backKnee);
    maskThigh(frontHipX, frontKnee);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load existing PNGs so we can preserve non-walk rows.
  const existingBody = await loadImage('src/images/npcs/sky_fowl_body.png');
  const existingMask = await loadImage('src/images/npcs/sky_fowl_pants_mask.png');

  // Body canvas
  const bodyCanvas = createCanvas(TOTAL_W, TOTAL_H);
  const bctx = bodyCanvas.getContext('2d');

  // Mask canvas (white-on-transparent)
  const maskCanvas = createCanvas(TOTAL_W, TOTAL_H);
  const mctx = maskCanvas.getContext('2d');

  // ── Copy rows 1-3 (idle, peck, aggressive) from existing PNGs ──
  bctx.drawImage(existingBody, 0, FH, TOTAL_W, FH * 3, 0, FH, TOTAL_W, FH * 3);
  mctx.drawImage(existingMask, 0, FH, TOTAL_W, FH * 3, 0, FH, TOTAL_W, FH * 3);

  // ── Regenerate walk row (row 0) with proper gait cycle ──
  for (let i = 0; i < 8; i++) {
    const phase = i / 8;
    const ox = i * FW;
    const oy = WALK_ROW * FH;  // 0

    drawFrame(bctx, mctx, ox, oy, { walkPhase: phase });
  }

  writeFileSync('src/images/npcs/sky_fowl_body.png',       bodyCanvas.toBuffer('image/png'));
  writeFileSync('src/images/npcs/sky_fowl_pants_mask.png', maskCanvas.toBuffer('image/png'));

  console.log('Written sky_fowl_body.png and sky_fowl_pants_mask.png (walk row regenerated).');
}

main().catch(console.error);
