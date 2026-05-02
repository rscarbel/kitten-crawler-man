/**
 * Generates crate.png — 64×64 single frame of a wooden storage crate.
 * Run: tsx scripts/generateCrate.ts
 *
 * Top-down 3/4 perspective: the top face occupies the upper ~60% of the sprite,
 * the front face occupies the lower ~40%, separated by a dark shadow edge.
 * Metal corner brackets at the corners give it a sturdy dungeon look.
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

// ─── Geometry ─────────────────────────────────────────────────────────────────

const crateL  = 6;           // left edge
const crateR  = 58;          // right edge
const crateT  = 4;           // top edge of top face
const crateB  = 60;          // bottom of front face
const divY    = 38;          // boundary between top face and front face
const crateW  = crateR - crateL;
const topH    = divY - crateT;
const frontH  = crateB - divY;

// ─── Drop shadow ─────────────────────────────────────────────────────────────

ctx.fillStyle = 'rgba(0,0,0,0.28)';
ctx.fillRect(crateL + 4, crateT + 6, crateW, frontH + topH);

// ─── TOP FACE ────────────────────────────────────────────────────────────────

// Top plank boards running left-right
const topGrad = ctx.createLinearGradient(crateL, crateT, crateL, divY);
topGrad.addColorStop(0,   '#c88040');
topGrad.addColorStop(0.4, '#b07030');
topGrad.addColorStop(1,   '#8a5020');
ctx.fillStyle = topGrad;
ctx.fillRect(crateL, crateT, crateW, topH);

// Plank division lines (3 planks)
ctx.fillStyle = 'rgba(0,0,0,0.30)';
for (let i = 1; i <= 2; i++) {
  const px = crateL + Math.floor((crateW * i) / 3);
  ctx.fillRect(px, crateT, 2, topH);
}

// Wood grain (subtle horizontal lines within planks)
ctx.strokeStyle = 'rgba(20,8,0,0.18)';
ctx.lineWidth = 1;
for (let gy = crateT + 6; gy < divY; gy += 7) {
  ctx.beginPath();
  ctx.moveTo(crateL + 3, gy);
  ctx.lineTo(crateR - 3, gy + 1);
  ctx.stroke();
}

// Top face left highlight
ctx.fillStyle = 'rgba(255,210,140,0.22)';
ctx.fillRect(crateL, crateT, crateW, 3);

// Cross brace on top (two diagonals forming X)
ctx.strokeStyle = 'rgba(60,30,5,0.35)';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.moveTo(crateL + 4, crateT + 2);
ctx.lineTo(crateR - 4, divY - 2);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(crateR - 4, crateT + 2);
ctx.lineTo(crateL + 4, divY - 2);
ctx.stroke();

// ─── DIVIDING EDGE (shadow strip between top and front) ───────────────────────

ctx.fillStyle = '#1e0e04';
ctx.fillRect(crateL, divY, crateW, 3);
ctx.fillStyle = '#3a1e08';
ctx.fillRect(crateL, divY + 3, crateW, 1);

// ─── FRONT FACE ──────────────────────────────────────────────────────────────

const frontGrad = ctx.createLinearGradient(0, divY + 3, 0, crateB);
frontGrad.addColorStop(0,   '#8a5020');
frontGrad.addColorStop(0.5, '#7a4418');
frontGrad.addColorStop(1,   '#4e2808');
ctx.fillStyle = frontGrad;
ctx.fillRect(crateL, divY + 3, crateW, frontH - 3);

// Front plank divisions (match top planks)
ctx.fillStyle = 'rgba(0,0,0,0.28)';
for (let i = 1; i <= 2; i++) {
  const px = crateL + Math.floor((crateW * i) / 3);
  ctx.fillRect(px, divY + 3, 2, frontH - 3);
}

// Horizontal plank join line across front face
const midFront = divY + 3 + Math.floor((frontH - 3) / 2);
ctx.fillStyle = 'rgba(0,0,0,0.25)';
ctx.fillRect(crateL, midFront, crateW, 1);

// Front face wood grain
ctx.strokeStyle = 'rgba(20,8,0,0.15)';
ctx.lineWidth = 1;
for (let gx = crateL + 6; gx < crateR; gx += 10) {
  ctx.beginPath();
  ctx.moveTo(gx, divY + 4);
  ctx.lineTo(gx + 2, crateB - 1);
  ctx.stroke();
}

// ─── METAL CORNER BRACKETS ───────────────────────────────────────────────────

function drawBracket(bx: number, bTopY: number, bBotY: number, flipX: boolean): void {
  const dir = flipX ? -1 : 1;
  const bw  = 5;
  const bh  = 8;

  // Vertical strap on crate face
  ctx.fillStyle = '#505050';
  ctx.fillRect(bx, bTopY, dir * bw, bBotY - bTopY);
  // Horizontal strap across top
  ctx.fillStyle = '#505050';
  ctx.fillRect(bx, bTopY, dir * crateW, bh);
  // Bright highlight edge
  ctx.fillStyle = '#909090';
  ctx.fillRect(bx, bTopY, dir, bBotY - bTopY);
  ctx.fillRect(bx, bTopY, dir * crateW, 2);
  // Dark inner shadow
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(bx + dir * bw, bTopY, -dir, bBotY - bTopY);
}

// Top-left bracket (strap on top face + left side of front)
ctx.save();
ctx.rect(crateL, crateT, crateW, frontH + topH);
ctx.clip();
drawBracket(crateL, crateT, crateB, false);
drawBracket(crateR, crateT, crateB, true);
ctx.restore();

// ─── Outline ─────────────────────────────────────────────────────────────────

ctx.strokeStyle = 'rgba(0,0,0,0.50)';
ctx.lineWidth = 1.5;
ctx.strokeRect(crateL, crateT, crateW, frontH + topH);
// Top-face divider emphasized
ctx.strokeStyle = 'rgba(0,0,0,0.40)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(crateL, divY);
ctx.lineTo(crateR, divY);
ctx.stroke();

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'crate.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${W}×${H} px)`);
