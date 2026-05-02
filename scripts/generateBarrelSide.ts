/**
 * Generates barrel_side.png — 64×64 single frame of a barrel lying on its side.
 * Run: tsx scripts/generateBarrelSide.ts
 *
 * Top-down perspective shows the circular end cap on the right, the cylindrical
 * body stretching left, wood staves running lengthwise, and iron band hoops.
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const W = 64;
const H = 64;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.clearRect(0, 0, W, H);

// ─── Geometry ────────────────────────────────────────────────────────────────

const barrelW = 48;  // length of barrel body (left-right)
const barrelH = 26;  // height of barrel body (top-down thickness)
const bx = 8;        // left edge of barrel
const by = Math.floor((H - barrelH) / 2);   // vertically centred
const bCX = bx + barrelW / 2;
const bCY = by + barrelH / 2;

// ─── Drop shadow ─────────────────────────────────────────────────────────────

ctx.fillStyle = 'rgba(0,0,0,0.28)';
ctx.beginPath();
ctx.ellipse(bCX + 3, bCY + 5, barrelW / 2 + 2, barrelH / 2 + 2, 0, 0, Math.PI * 2);
ctx.fill();

// ─── Barrel body (main cylinder top face) ────────────────────────────────────

// Fill the rectangle body with a gradient (dark at ends, bright in middle)
const bodyGrad = ctx.createLinearGradient(bx, 0, bx + barrelW, 0);
bodyGrad.addColorStop(0,    '#4a2808');
bodyGrad.addColorStop(0.15, '#8a5020');
bodyGrad.addColorStop(0.45, '#b06830');
bodyGrad.addColorStop(0.55, '#a86028');
bodyGrad.addColorStop(0.85, '#7a4418');
bodyGrad.addColorStop(1,    '#3e1e08');
ctx.fillStyle = bodyGrad;
ctx.fillRect(bx, by, barrelW, barrelH);

// ─── Bilge curve (barrel is wider in the middle) ─────────────────────────────
// Clip the top/bottom to give a slightly bulged silhouette
ctx.fillStyle = 'rgba(0,0,0,0)';
// Erase pixels outside the barrel silhouette using a clip mask approach
ctx.save();
ctx.beginPath();
// Build a barrel-shaped path: straight top/bottom lines with slight bulge
const bulge = 4;
ctx.moveTo(bx, by);
ctx.bezierCurveTo(bx + barrelW * 0.25, by - bulge, bx + barrelW * 0.75, by - bulge, bx + barrelW, by);
ctx.lineTo(bx + barrelW, by + barrelH);
ctx.bezierCurveTo(bx + barrelW * 0.75, by + barrelH + bulge, bx + barrelW * 0.25, by + barrelH + bulge, bx, by + barrelH);
ctx.closePath();
ctx.clip();

// Redraw body gradient inside clip
ctx.fillStyle = bodyGrad;
ctx.fillRect(bx - 2, by - bulge - 1, barrelW + 4, barrelH + bulge * 2 + 2);

// Wood stave lines (lengthwise, subtle)
ctx.strokeStyle = 'rgba(20,8,0,0.28)';
ctx.lineWidth = 1;
for (let s = 0; s < 5; s++) {
  const gy = by - bulge + Math.floor((s + 0.5) * (barrelH + bulge * 2) / 5);
  ctx.beginPath();
  ctx.moveTo(bx, gy);
  ctx.lineTo(bx + barrelW, gy);
  ctx.stroke();
}

// Top highlight strip
ctx.fillStyle = 'rgba(255,200,130,0.18)';
ctx.fillRect(bx, by - bulge + 1, barrelW, 4);

// Bottom shadow strip
ctx.fillStyle = 'rgba(0,0,0,0.22)';
ctx.fillRect(bx, by + barrelH + bulge - 5, barrelW, 5);

ctx.restore();

// ─── Iron bands ──────────────────────────────────────────────────────────────

const bandPositions = [0.18, 0.5, 0.82];
for (const bp of bandPositions) {
  const bandCX = bx + barrelW * bp;
  const bandR  = 1.5 + Math.sin(bp * Math.PI) * 2.5;   // wider in middle

  // Band shadow
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(Math.floor(bandCX - 2), by - 2, 5, barrelH + 4);

  // Band body — dark iron
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(Math.floor(bandCX - 1.5), by - 1, 3, barrelH + 2);

  // Band highlight (left edge)
  ctx.fillStyle = '#606060';
  ctx.fillRect(Math.floor(bandCX - 1.5), by - 1, 1, barrelH + 2);

  // Rivet detail (two rivets per band)
  ctx.fillStyle = '#909090';
  ctx.beginPath();
  ctx.arc(bandCX, by + barrelH * 0.3, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bandCX, by + barrelH * 0.7, 1.5, 0, Math.PI * 2);
  ctx.fill();

  void bandR;
}

// ─── Right end cap (circular end face, visible from side) ────────────────────

const capCX = bx + barrelW - 1;
const capCY = bCY;
const capRX  = 5;   // horizontal radius (narrow — perspective)
const capRY  = barrelH / 2 + bulge;

// Cap shadow ellipse
ctx.fillStyle = 'rgba(0,0,0,0.25)';
ctx.beginPath();
ctx.ellipse(capCX + 2, capCY + 2, capRX, capRY, 0, 0, Math.PI * 2);
ctx.fill();

// Cap face
const capGrad = ctx.createRadialGradient(capCX - 2, capCY - 3, 1, capCX, capCY, capRX + capRY / 2);
capGrad.addColorStop(0,   '#d08040');
capGrad.addColorStop(0.5, '#9c6030');
capGrad.addColorStop(1,   '#4e2810');
ctx.fillStyle = capGrad;
ctx.beginPath();
ctx.ellipse(capCX, capCY, capRX, capRY, 0, 0, Math.PI * 2);
ctx.fill();

// Cap rim ring
ctx.strokeStyle = '#2a1408';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.ellipse(capCX, capCY, capRX, capRY, 0, 0, Math.PI * 2);
ctx.stroke();

// Cap wood grain lines (concentric rings)
ctx.strokeStyle = 'rgba(20,8,0,0.25)';
ctx.lineWidth = 1;
for (let r = 1; r <= 2; r++) {
  ctx.beginPath();
  ctx.ellipse(capCX, capCY, capRX * (0.4 + r * 0.28), capRY * (0.4 + r * 0.28), 0, 0, Math.PI * 2);
  ctx.stroke();
}

// ─── Outline stroke ───────────────────────────────────────────────────────────

ctx.strokeStyle = 'rgba(0,0,0,0.45)';
ctx.lineWidth = 1;
ctx.save();
ctx.beginPath();
const b2 = 4;
ctx.moveTo(bx, by);
ctx.bezierCurveTo(bx + barrelW * 0.25, by - b2, bx + barrelW * 0.75, by - b2, bx + barrelW, by);
ctx.lineTo(bx + barrelW, by + barrelH);
ctx.bezierCurveTo(bx + barrelW * 0.75, by + barrelH + b2, bx + barrelW * 0.25, by + barrelH + b2, bx, by + barrelH);
ctx.closePath();
ctx.stroke();
ctx.restore();

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'barrel_side.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${W}×${H} px)`);
