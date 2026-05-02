/**
 * Generates well.png — a single 64×128 idle frame with transparent background.
 * Run: tsx scripts/generateWell.ts
 *
 * Layout (tileY=64, tileScale=64 → at ts=32 the sprite is drawn 32px above
 * the tile top and fills the full tile below):
 *   rows  0–63  = crossbeam + posts above the tile boundary
 *   rows 64–127 = stone ring + base within the tile
 *
 * Full structure visible: two thick wooden posts rise from the stone ring
 * all the way up to a wide crossbeam, with a rope and bucket hanging down.
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const W = 64;
const H = 128;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.clearRect(0, 0, W, H);

const cx = W / 2;  // 32

// ─── Geometry constants ───────────────────────────────────────────────────────

// Stone ring (within-tile area, rows 70–118)
const ringCX  = cx;
const ringCY  = 96;          // centre of the ring
const ringR   = 20;          // outer radius
const innerR  = 13;          // inner hole radius
const ringTop = ringCY - ringR;   // ≈ 76

// Wooden posts (left + right, rise from ring top to crossbeam)
const postW      = 7;
const postLeftX  = ringCX - ringR - 1;   // left post left edge
const postRightX = ringCX + ringR - postW + 1; // right post left edge
const postTop    = 10;        // top of posts (below crossbeam)
const postBot    = ringTop + 6;  // posts anchor into the stone ring

// Crossbeam (horizontal, spans the two posts)
const beamY  = postTop;
const beamH  = 10;
const beamX0 = postLeftX - 3;
const beamX1 = postRightX + postW + 3;

// Rope hangs from the centre of the crossbeam
const ropeX    = cx;
const ropeTopY = beamY + beamH;
const ropeBotY = ringCY - innerR + 4;  // drops just inside the ring

// Bucket sits at the bottom of the rope
const bucketW  = 8;
const bucketH  = 7;
const bucketX  = ropeX - bucketW / 2;
const bucketY  = ropeBotY - bucketH - 2;

// ─── Drop shadows ─────────────────────────────────────────────────────────────

// Post shadows (offset right + down)
ctx.fillStyle = 'rgba(0,0,0,0.22)';
ctx.fillRect(postLeftX + 3,  postTop + 2,  postW, postBot - postTop);
ctx.fillRect(postRightX + 3, postTop + 2,  postW, postBot - postTop);

// Beam shadow
ctx.fillStyle = 'rgba(0,0,0,0.22)';
ctx.fillRect(beamX0 + 3, beamY + 3, beamX1 - beamX0, beamH);

// Ring shadow
ctx.fillStyle = 'rgba(0,0,0,0.25)';
ctx.beginPath();
ctx.arc(ringCX + 2, ringCY + 2, ringR + 1, 0, Math.PI * 2);
ctx.fill();

// ─── Stone ring ───────────────────────────────────────────────────────────────

// Outer ring — grey stone
ctx.fillStyle = '#7a7a7a';
ctx.beginPath();
ctx.arc(ringCX, ringCY, ringR, 0, Math.PI * 2);
ctx.fill();

// Top-left highlight arc
ctx.fillStyle = '#b8b8b8';
ctx.beginPath();
ctx.arc(ringCX, ringCY, ringR, Math.PI * 1.1, Math.PI * 1.9);
ctx.fill();
// Restore the interior after the arc highlight
ctx.fillStyle = '#7a7a7a';
ctx.beginPath();
ctx.arc(ringCX, ringCY, ringR - 4, Math.PI * 1.1, Math.PI * 1.9);
ctx.fill();

// Mortar crack lines (short radial ticks around the ring)
ctx.strokeStyle = '#606060';
ctx.lineWidth = 1;
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const r0 = ringR - 3;
  const r1 = ringR - 8;
  ctx.beginPath();
  ctx.moveTo(ringCX + Math.cos(angle) * r0, ringCY + Math.sin(angle) * r0);
  ctx.lineTo(ringCX + Math.cos(angle) * r1, ringCY + Math.sin(angle) * r1);
  ctx.stroke();
}

// Stone ring bottom shadow (inner bottom edge)
ctx.fillStyle = '#505050';
ctx.beginPath();
ctx.arc(ringCX, ringCY + 2, ringR, 0, Math.PI);
ctx.fill();
ctx.fillStyle = '#7a7a7a';
ctx.beginPath();
ctx.arc(ringCX, ringCY, ringR - 4, 0, Math.PI);
ctx.fill();

// Deep well interior
ctx.fillStyle = '#0e1620';
ctx.beginPath();
ctx.arc(ringCX, ringCY, innerR, 0, Math.PI * 2);
ctx.fill();

// Water glint far below
ctx.fillStyle = '#1a3650';
ctx.beginPath();
ctx.arc(ringCX, ringCY + innerR * 0.45, innerR * 0.6, 0, Math.PI * 2);
ctx.fill();

// ─── Wooden posts ─────────────────────────────────────────────────────────────

function drawPost(px: number): void {
  const ph = postBot - postTop;

  // Post shadow side
  ctx.fillStyle = '#2e1608';
  ctx.fillRect(px + postW - 2, postTop, 2, ph);

  // Post body gradient (left highlight → dark right)
  const g = ctx.createLinearGradient(px, 0, px + postW, 0);
  g.addColorStop(0,   '#8c5428');
  g.addColorStop(0.3, '#a86838');
  g.addColorStop(0.7, '#7a4420');
  g.addColorStop(1,   '#3e1e08');
  ctx.fillStyle = g;
  ctx.fillRect(px, postTop, postW, ph);

  // Wood grain lines
  ctx.strokeStyle = 'rgba(20,8,0,0.30)';
  ctx.lineWidth = 1;
  for (let gy = postTop + 8; gy < postBot; gy += 12) {
    ctx.beginPath();
    ctx.moveTo(px + 1, gy);
    ctx.lineTo(px + postW - 1, gy + 1);
    ctx.stroke();
  }

  // Left edge highlight
  ctx.fillStyle = 'rgba(255,200,140,0.18)';
  ctx.fillRect(px, postTop, 2, ph);

  // Post base cap (where it meets the stone ring)
  ctx.fillStyle = '#4e2e10';
  ctx.fillRect(px - 1, postBot - 5, postW + 2, 5);
  ctx.fillStyle = '#7a5030';
  ctx.fillRect(px - 1, postBot - 5, postW + 2, 2);
}

drawPost(postLeftX);
drawPost(postRightX);

// ─── Crossbeam ────────────────────────────────────────────────────────────────

const bw = beamX1 - beamX0;

// Beam shadow side (bottom)
ctx.fillStyle = '#2e1608';
ctx.fillRect(beamX0, beamY + beamH - 3, bw, 3);

// Beam body
const bg = ctx.createLinearGradient(0, beamY, 0, beamY + beamH);
bg.addColorStop(0,   '#c88040');
bg.addColorStop(0.4, '#a86828');
bg.addColorStop(1,   '#5a3010');
ctx.fillStyle = bg;
ctx.fillRect(beamX0, beamY, bw, beamH);

// Beam top highlight
ctx.fillStyle = 'rgba(255,220,160,0.22)';
ctx.fillRect(beamX0, beamY, bw, 2);

// Wood grain on beam
ctx.strokeStyle = 'rgba(20,8,0,0.25)';
ctx.lineWidth = 1;
for (let gx = beamX0 + 6; gx < beamX1; gx += 10) {
  ctx.beginPath();
  ctx.moveTo(gx, beamY + 1);
  ctx.lineTo(gx + 2, beamY + beamH - 1);
  ctx.stroke();
}

// Mortise notches where posts meet beam (visual joint detail)
ctx.fillStyle = 'rgba(0,0,0,0.20)';
ctx.fillRect(postLeftX - 1,  beamY + beamH - 4, postW + 2, 4);
ctx.fillRect(postRightX - 1, beamY + beamH - 4, postW + 2, 4);

// Beam end caps (slightly darker)
ctx.fillStyle = '#4a2810';
ctx.fillRect(beamX0, beamY, 4, beamH);
ctx.fillRect(beamX1 - 4, beamY, 4, beamH);

// ─── Rope ─────────────────────────────────────────────────────────────────────

// Rope body — tan/hemp colour with slight twist suggestion
const ropeLen = ropeBotY - ropeTopY;
ctx.fillStyle = '#b89050';
ctx.fillRect(ropeX - 1, ropeTopY, 2, ropeLen);

// Twist marks on rope
ctx.strokeStyle = 'rgba(80,50,10,0.45)';
ctx.lineWidth = 0.8;
for (let ry = ropeTopY + 4; ry < ropeBotY; ry += 6) {
  ctx.beginPath();
  ctx.moveTo(ropeX - 1, ry);
  ctx.lineTo(ropeX + 1, ry + 3);
  ctx.stroke();
}

// ─── Bucket ───────────────────────────────────────────────────────────────────

// Bucket body (slightly tapered — wider at top)
ctx.fillStyle = '#6a5028';
ctx.fillRect(bucketX, bucketY, bucketW, bucketH);

// Bucket top rim
ctx.fillStyle = '#8a7040';
ctx.fillRect(bucketX - 1, bucketY, bucketW + 2, 2);

// Bucket bottom (slightly narrower)
ctx.fillStyle = '#4e3818';
ctx.fillRect(bucketX + 1, bucketY + bucketH - 2, bucketW - 2, 2);

// Metal band on bucket
ctx.fillStyle = '#808080';
ctx.fillRect(bucketX - 1, bucketY + Math.floor(bucketH * 0.45), bucketW + 2, 1);

// Bucket highlight
ctx.fillStyle = 'rgba(255,220,160,0.18)';
ctx.fillRect(bucketX, bucketY + 1, 2, bucketH - 2);

// ─── Rope attachment to beam (small hook/peg) ─────────────────────────────────

ctx.fillStyle = '#606060';
ctx.beginPath();
ctx.arc(ropeX, beamY + beamH / 2, 2.5, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = '#a0a0a0';
ctx.beginPath();
ctx.arc(ropeX - 0.5, beamY + beamH / 2 - 0.8, 1, 0, Math.PI * 2);
ctx.fill();

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'well.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${W}×${H} px)`);
