/**
 * Generates brazier.png — 4-frame animation strip, each frame 64×128 px.
 * Run: tsx scripts/generateBrazier.ts
 *
 * Layout (tileY=64, tileScale=64 → at ts=32 the sprite is drawn 32px above
 * the tile top and fills the full tile below):
 *   rows  0–63  = fire / flame column above the tile boundary
 *   rows 64–127 = iron brazier tripod + bowl within the tile
 *
 * The brazier has three iron legs splayed outward, a wide bowl filled with
 * glowing coals, and an animated flame/ember column rising from the bowl.
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const FRAME_W = 64;
const FRAME_H = 128;
const FRAMES  = 4;

const canvas = createCanvas(FRAME_W * FRAMES, FRAME_H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.clearRect(0, 0, canvas.width, canvas.height);

// ─── Flame flicker parameters per frame ──────────────────────────────────────

const flickerValues = [-0.5, 0.6, -0.1, 0.9];

// ─── Draw one frame ──────────────────────────────────────────────────────────

function drawFrame(ox: number, flicker: number): void {
  const cx = ox + FRAME_W / 2;

  // ── Bowl geometry ──
  const bowlCX  = cx;
  const bowlCY  = 96;          // centre of bowl, well within the tile area
  const bowlRX  = 16;          // half-width of bowl opening
  const bowlRY  = 5;           // perspective flattening
  const bowlH   = 10;          // depth of bowl below rim

  // ── Tripod leg geometry (3 legs splayed to left, right, back) ──
  const legW  = 4;
  const legLen = 22;

  // Leg endpoints (spread at 120° intervals, one pointing forward)
  const legAngles = [Math.PI / 2 + Math.PI * 2 / 3, Math.PI / 2, Math.PI / 2 - Math.PI * 2 / 3];
  // Bottom of each leg = floor anchor
  const legBotY = 122;

  // ─── Drop shadows ────────────────────────────────────────────────────────────

  // Bowl shadow (flat ellipse)
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(bowlCX + 3, bowlCY + bowlH + 5, bowlRX + 2, bowlRY + 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─── Legs ───────────────────────────────────────────────────────────────────

  for (let i = 0; i < 3; i++) {
    const angle = legAngles[i];
    const lx = bowlCX + Math.cos(angle) * (bowlRX - 2);
    const ly = bowlCY + bowlRY;
    const footX = bowlCX + Math.cos(angle) * legLen;
    const footY = legBotY;

    // Leg shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(lx + 2, ly + 1);
    ctx.lineTo(footX + 2, footY + 1);
    ctx.lineWidth = legW;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.stroke();

    // Leg body — dark forged iron
    const legGrad = ctx.createLinearGradient(lx - legW, 0, lx + legW, 0);
    legGrad.addColorStop(0,   '#3a3a3a');
    legGrad.addColorStop(0.3, '#606060');
    legGrad.addColorStop(0.7, '#484848');
    legGrad.addColorStop(1,   '#1e1e1e');
    ctx.strokeStyle = legGrad;
    ctx.lineWidth = legW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(footX, footY);
    ctx.stroke();

    // Leg highlight (left edge sheen)
    ctx.strokeStyle = 'rgba(140,140,140,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx - 1, ly);
    ctx.lineTo(footX - 1, footY);
    ctx.stroke();

    // Foot splay (slightly widened base)
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(footX, footY, 5, 3, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#505050';
    ctx.beginPath();
    ctx.ellipse(footX - 1, footY - 1, 3, 2, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Bowl ───────────────────────────────────────────────────────────────────

  // Bowl outer rim top face (ellipse — the rim lip seen from above)
  ctx.fillStyle = '#404040';
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY, bowlRX + 3, bowlRY + 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rim highlight
  ctx.fillStyle = '#787878';
  ctx.beginPath();
  ctx.ellipse(bowlCX - 3, bowlCY - 2, bowlRX * 0.55, bowlRY * 0.7, -0.3, Math.PI * 1.1, Math.PI * 1.85);
  ctx.stroke();

  // Bowl interior (dark coal bed)
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY, bowlRX, bowlRY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bowl outer side (curved wall below rim)
  ctx.fillStyle = '#303030';
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY + 2, bowlRX + 1, bowlRY + 2, 0, 0, Math.PI);
  ctx.ellipse(bowlCX, bowlCY + bowlH, bowlRX - 3, bowlRY + 1, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#282828';
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY + bowlH, bowlRX - 3, bowlRY + 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─── Glowing coals ──────────────────────────────────────────────────────────

  // Orange coal glow filling the bowl
  const coalGlow = flicker * 0.1;
  ctx.fillStyle = `rgba(200,80,10,${0.80 + coalGlow})`;
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY, bowlRX - 1, bowlRY - 1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bright ember spots (deterministic per frame)
  const embers = [
    { dx: -6, dy: 0 }, { dx: 4, dy: -1 }, { dx: -1, dy: 2 }, { dx: 6, dy: 1 },
  ];
  for (let e = 0; e < embers.length; e++) {
    const em = embers[e];
    const alpha = 0.6 + ((e + Math.abs(flicker)) % 0.4);
    ctx.fillStyle = `rgba(255,180,30,${alpha})`;
    ctx.beginPath();
    ctx.arc(bowlCX + em.dx, bowlCY + em.dy, 1.5 + Math.abs(flicker), 0, Math.PI * 2);
    ctx.fill();
  }

  // Central bright core
  ctx.fillStyle = `rgba(255,240,160,${0.70 + flicker * 0.15})`;
  ctx.beginPath();
  ctx.ellipse(bowlCX, bowlCY, bowlRX * 0.38, bowlRY * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ─── Warm glow bloom ────────────────────────────────────────────────────────

  const glowCY = 55 + flicker * 3;
  const glowR  = 18 + flicker * 4;
  ctx.fillStyle = `rgba(255,120,10,${0.15 + flicker * 0.04})`;
  ctx.beginPath();
  ctx.arc(cx, glowCY, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255,160,40,${0.12 + flicker * 0.03})`;
  ctx.beginPath();
  ctx.arc(cx, glowCY, glowR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // ─── Flames ─────────────────────────────────────────────────────────────────

  const flameBaseY = bowlCY;
  const flameH = 48 + flicker * 7;
  const flameW = 13 + flicker * 2.5;
  const flameTipY = flameBaseY - flameH;

  // Outer flame — wide orange
  ctx.fillStyle = `rgba(255,90,10,${0.82 + flicker * 0.08})`;
  ctx.beginPath();
  ctx.moveTo(cx, flameTipY);
  ctx.bezierCurveTo(
    cx + flameW,        flameTipY + flameH * 0.28,
    cx + flameW * 0.85, flameBaseY - 5,
    cx,                 flameBaseY,
  );
  ctx.bezierCurveTo(
    cx - flameW * 0.85, flameBaseY - 5,
    cx - flameW,        flameTipY + flameH * 0.28,
    cx,                 flameTipY,
  );
  ctx.fill();

  // Middle flame — yellow-orange
  const midH = flameH * 0.62;
  const midW = flameW * 0.60;
  ctx.fillStyle = `rgba(255,195,30,${0.80 + flicker * 0.10})`;
  ctx.beginPath();
  ctx.moveTo(cx, flameTipY + 5);
  ctx.bezierCurveTo(
    cx + midW,        flameTipY + 5 + midH * 0.32,
    cx + midW * 0.7,  flameBaseY - 9,
    cx,               flameBaseY - 4,
  );
  ctx.bezierCurveTo(
    cx - midW * 0.7,  flameBaseY - 9,
    cx - midW,        flameTipY + 5 + midH * 0.32,
    cx,               flameTipY + 5,
  );
  ctx.fill();

  // Left secondary lick (slightly offset)
  const lickOffset = flicker * 4;
  const lickW = flameW * 0.40;
  const lickH = flameH * 0.50;
  ctx.fillStyle = `rgba(255,140,20,${0.55 + flicker * 0.08})`;
  ctx.beginPath();
  ctx.moveTo(cx - 5 + lickOffset, flameTipY + flameH * 0.18);
  ctx.bezierCurveTo(
    cx - 5 + lickOffset + lickW, flameTipY + flameH * 0.18 + lickH * 0.3,
    cx - 5 + lickOffset + lickW * 0.6, flameBaseY - 7,
    cx - 3, flameBaseY - 2,
  );
  ctx.bezierCurveTo(
    cx - 3 - lickW * 0.4, flameBaseY - 7,
    cx - 5 + lickOffset - lickW * 0.5, flameTipY + flameH * 0.18 + lickH * 0.3,
    cx - 5 + lickOffset, flameTipY + flameH * 0.18,
  );
  ctx.fill();

  // White-hot core
  ctx.fillStyle = `rgba(255,255,220,${0.75 + flicker * 0.15})`;
  ctx.beginPath();
  ctx.arc(cx, flameTipY + flameH * 0.35, flameW * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // ─── Embers / sparks floating upward ────────────────────────────────────────

  const sparkPositions = [
    { x: cx - 8, y: flameTipY - 5 },
    { x: cx + 6, y: flameTipY - 12 },
    { x: cx + 2, y: flameTipY - 20 },
    { x: cx - 4, y: flameTipY - 18 },
  ];
  for (let i = 0; i < sparkPositions.length; i++) {
    const sp = sparkPositions[i];
    const salpha = (0.30 + Math.abs(flicker) * 0.15) * (1 - i * 0.15);
    ctx.fillStyle = `rgba(255,160,30,${salpha})`;
    ctx.beginPath();
    ctx.arc(sp.x + flicker * (i % 2 === 0 ? 2 : -2), sp.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smoke wisps
  ctx.fillStyle = `rgba(120,120,120,${0.12 + flicker * 0.04})`;
  ctx.beginPath();
  ctx.arc(cx + flicker * 2, flameTipY - 8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(90,90,90,0.07)';
  ctx.beginPath();
  ctx.arc(cx + flicker * 1.5, flameTipY - 18, 5.5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Render all frames ────────────────────────────────────────────────────────

for (let f = 0; f < FRAMES; f++) {
  drawFrame(f * FRAME_W, flickerValues[f]);
}

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'brazier.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${canvas.width}×${FRAME_H} px, ${FRAMES} frames)`);
