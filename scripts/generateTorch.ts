/**
 * Generates torch.png — 6-frame animation strip, each frame 64×128 px.
 * Run: tsx scripts/generateTorch.ts
 *
 * Layout (tileY=64, tileScale=64 → at ts=32 the sprite is drawn 32px above
 * the tile top and fills the full tile below):
 *   rows 0–63   = flame, torch cup, top of shaft  (above tile boundary)
 *   rows 64–127 = lower shaft, stone footing       (within the tile)
 *
 * Transparent background — overlays cleanly on any floor tile.
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
const FRAMES  = 6;

const canvas = createCanvas(FRAME_W * FRAMES, FRAME_H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.clearRect(0, 0, canvas.width, canvas.height);

// ─── Per-frame flicker parameters ────────────────────────────────────────────
// Each frame is a snapshot of a slightly different flicker state.
// flicker: –1 … +1, drives flame size and glow intensity.
const flickerValues = [-0.6, 0.4, 0.9, 0.1, -0.3, 0.7];

// ─── Draw one torch frame ─────────────────────────────────────────────────────

function drawFrame(ox: number, flicker: number): void {
  const cx = ox + FRAME_W / 2;   // horizontal centre of this frame

  // ── Shaft ──
  // Long iron pole — runs from the footing at the bottom up past the torch cup.
  // Shaft occupies x ∈ [cx-2, cx+2], y ∈ [20, 112].
  const shaftX  = cx - 2;
  const shaftTop  = 20;   // top of shaft (inside torch cup area)
  const shaftBot  = 112;  // bottom of visible shaft (above footing)
  const shaftH  = shaftBot - shaftTop;

  // Drop shadow for shaft
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(shaftX + 1, shaftTop, 5, shaftH);

  // Shaft body — dark wrought iron
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(shaftX, shaftTop, 5, shaftH);

  // Shaft left-edge sheen
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(shaftX, shaftTop, 2, shaftH);

  // ── Stone footing ──
  // Small stone block at the very base so it looks floor-anchored.
  const footW = 14;
  const footH = 10;
  const footX = Math.floor(cx - footW / 2);
  const footY = 118;

  // Footing shadow
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(footX + 2, footY + 3, footW, footH);

  // Footing body
  ctx.fillStyle = '#787878';
  ctx.fillRect(footX, footY, footW, footH);
  // Footing top highlight
  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(footX, footY, footW, 2);
  // Footing right shadow
  ctx.fillStyle = '#505050';
  ctx.fillRect(footX + footW - 2, footY + 2, 2, footH - 2);

  // ── Torch cup (bracket / head) ──
  // Sits atop the shaft at the tile boundary (y ≈ 58–72).
  const cupCX = cx;
  const cupCY = 64;   // near the tile-top boundary
  const cupW  = 10;
  const cupH  = 9;
  const cupX  = Math.floor(cupCX - cupW / 2);
  const cupY  = Math.floor(cupCY - cupH / 2) + 2;

  // Cup shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cupX + 1, cupY + 2, cupW + 2, cupH);

  // Cup body — dark bronze/iron
  ctx.fillStyle = '#2a2010';
  ctx.fillRect(cupX, cupY, cupW, cupH);
  // Cup top rim highlight
  ctx.fillStyle = '#4e4030';
  ctx.fillRect(cupX, cupY, cupW, 2);
  // Cup side brackets (small flanges)
  ctx.fillStyle = '#1e1808';
  ctx.fillRect(cupX - 3, cupY + 1, 4, cupH - 3);
  ctx.fillRect(cupX + cupW - 1, cupY + 1, 4, cupH - 3);
  // Bracket highlight
  ctx.fillStyle = '#3a3020';
  ctx.fillRect(cupX - 3, cupY + 1, 1, cupH - 3);
  ctx.fillRect(cupX + cupW - 1, cupY + 1, 1, cupH - 3);

  // ── Warm glow bloom ──
  // Soft orange halo centred above the cup.
  const glowCX = cx;
  const glowCY = 34 - flicker * 3;
  const glowR  = 22 + flicker * 3;
  const glowA  = 0.18 + flicker * 0.06;

  ctx.fillStyle = `rgba(255,140,20,${glowA})`;
  ctx.beginPath();
  ctx.arc(glowCX, glowCY, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255,180,60,${glowA * 0.9})`;
  ctx.beginPath();
  ctx.arc(glowCX, glowCY, glowR * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // ── Flame ──
  // Outer flame body — tall orange teardrop.
  const flameBaseY = cupY;
  const flameH  = 32 + flicker * 5;
  const flameW  = 10 + flicker * 2;
  const flameTipY = flameBaseY - flameH;

  ctx.fillStyle = `rgba(255,100,10,${0.88 + flicker * 0.08})`;
  ctx.beginPath();
  ctx.moveTo(cx, flameTipY);
  ctx.bezierCurveTo(
    cx + flameW,  flameTipY + flameH * 0.3,
    cx + flameW * 0.8,  flameBaseY - 4,
    cx, flameBaseY,
  );
  ctx.bezierCurveTo(
    cx - flameW * 0.8,  flameBaseY - 4,
    cx - flameW,  flameTipY + flameH * 0.3,
    cx, flameTipY,
  );
  ctx.fill();

  // Mid flame — brighter yellow-orange.
  const midH = flameH * 0.65;
  const midW = flameW * 0.55;
  ctx.fillStyle = `rgba(255,210,50,${0.85 + flicker * 0.1})`;
  ctx.beginPath();
  ctx.moveTo(cx, flameTipY + 4);
  ctx.bezierCurveTo(
    cx + midW, flameTipY + 4 + midH * 0.35,
    cx + midW * 0.7, flameBaseY - 8,
    cx, flameBaseY - 4,
  );
  ctx.bezierCurveTo(
    cx - midW * 0.7, flameBaseY - 8,
    cx - midW, flameTipY + 4 + midH * 0.35,
    cx, flameTipY + 4,
  );
  ctx.fill();

  // Hot white core.
  ctx.fillStyle = `rgba(255,255,220,${0.80 + flicker * 0.15})`;
  ctx.beginPath();
  ctx.arc(cx, flameTipY + flameH * 0.38, flameW * 0.25, 0, Math.PI * 2);
  ctx.fill();

  // ── Smoke wisps (rising above the flame) ──
  const smokeY = flameTipY - 4;
  const smokeWobble = flicker * 2.5;

  ctx.fillStyle = `rgba(160,160,160,${0.20 + flicker * 0.06})`;
  ctx.beginPath();
  ctx.arc(cx + smokeWobble, smokeY - 6, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(130,130,130,${0.12 + flicker * 0.04})`;
  ctx.beginPath();
  ctx.arc(cx + smokeWobble * 0.6, smokeY - 14, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(110,110,110,0.07)';
  ctx.beginPath();
  ctx.arc(cx + smokeWobble * 0.3, smokeY - 22, 5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Render all frames ────────────────────────────────────────────────────────

for (let f = 0; f < FRAMES; f++) {
  drawFrame(f * FRAME_W, flickerValues[f]);
}

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'torch.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${canvas.width}×${FRAME_H} px, ${FRAMES} frames)`);
