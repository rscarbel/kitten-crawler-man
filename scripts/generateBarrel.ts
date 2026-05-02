/**
 * Generates barrel.png — a single 64×64 sprite with transparent background.
 * Run: tsx scripts/generateBarrel.ts
 *
 * Design: wooden barrel viewed from slight 3/4 perspective, standing upright.
 * Visible top face + front face with pronounced stave lines and three iron bands.
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const T = 64;

const canvas = createCanvas(T, T);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.clearRect(0, 0, T, T);

// ─── Barrel geometry ──────────────────────────────────────────────────────────

const cx = T / 2;          // horizontal centre
const bodyTop = 14;        // top of the barrel body (below the lid ellipse)
const bodyBot = 60;        // bottom of the barrel body
const bodyH = bodyBot - bodyTop;

// Barrel radius at normalised height t (0=top, 1=bottom).
// Classic bilge shape: narrow at ends, widest at 40% from top.
function radius(t: number): number {
  const rMin = 13;
  const rMax = 22;
  // Shape: sine bump peaking at t=0.4
  return rMin + (rMax - rMin) * Math.sin(Math.PI * Math.min(t / 0.8, 1));
}

// Draw the barrel body outline as a closed canvas path.
function bodyPath(): void {
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = bodyTop + t * bodyH;
    const r = radius(t);
    if (i === 0) ctx.moveTo(cx + r, y);
    else ctx.lineTo(cx + r, y);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const y = bodyTop + t * bodyH;
    const r = radius(t);
    ctx.lineTo(cx - r, y);
  }
  ctx.closePath();
}

// ─── Drop shadow ──────────────────────────────────────────────────────────────

ctx.save();
ctx.translate(3, 4);
ctx.fillStyle = 'rgba(0,0,0,0.28)';
bodyPath();
ctx.fill();
ctx.restore();

// ─── Barrel body — wood gradient ─────────────────────────────────────────────

const woodGrad = ctx.createLinearGradient(cx - 22, 0, cx + 22, 0);
woodGrad.addColorStop(0,    '#2e1206');
woodGrad.addColorStop(0.12, '#5a2810');
woodGrad.addColorStop(0.3,  '#9c5020');
woodGrad.addColorStop(0.48, '#c87030');
woodGrad.addColorStop(0.62, '#b06028');
woodGrad.addColorStop(0.8,  '#7a3a14');
woodGrad.addColorStop(1,    '#2e1206');

ctx.fillStyle = woodGrad;
bodyPath();
ctx.fill();

// ─── Stave lines ─────────────────────────────────────────────────────────────
// Clip to body before drawing staves so they don't bleed outside.

ctx.save();
bodyPath();
ctx.clip();

const numStaves = 11;
ctx.lineWidth = 1.2;
for (let si = 0; si < numStaves; si++) {
  // Distribute staves evenly across the front face using cosine mapping.
  const angle = ((si / (numStaves - 1)) - 0.5) * Math.PI * 0.82;
  const xFrac = Math.sin(angle);

  // Stave colour: dark on the sides, slightly lighter in the middle.
  const centre = 1 - Math.abs(xFrac) * 1.4;
  const alpha = 0.35 + centre * 0.15;
  ctx.strokeStyle = `rgba(20,6,0,${alpha})`;

  ctx.beginPath();
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = bodyTop + t * bodyH;
    const r = radius(t);
    const x = cx + xFrac * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// Subtle vertical highlight stripe on the brightest area (~35% from left).
const hiGrad = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
hiGrad.addColorStop(0,   'rgba(255,230,180,0)');
hiGrad.addColorStop(0.5, 'rgba(255,230,180,0.12)');
hiGrad.addColorStop(1,   'rgba(255,230,180,0)');
ctx.fillStyle = hiGrad;
bodyPath();
ctx.fill();

ctx.restore();

// ─── Iron bands ───────────────────────────────────────────────────────────────

const bandTs = [0.06, 0.46, 0.88]; // normalised heights for three bands

for (const bt of bandTs) {
  const by = bodyTop + bt * bodyH;
  const t = bt;
  const r = radius(t);
  const bh = 5;  // band height in pixels

  // Band shadow (ellipse below)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, by + bh / 2 + 1.5, r + 2.5, bh / 2 + 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Band body — dark steel
  const bandGrad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  bandGrad.addColorStop(0,    '#282828');
  bandGrad.addColorStop(0.18, '#505050');
  bandGrad.addColorStop(0.5,  '#787878');
  bandGrad.addColorStop(0.82, '#505050');
  bandGrad.addColorStop(1,    '#282828');
  ctx.fillStyle = bandGrad;
  ctx.beginPath();
  ctx.ellipse(cx, by + bh / 2, r + 1.5, bh / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Band top highlight
  ctx.strokeStyle = 'rgba(200,200,200,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, by + bh / 2, r + 1.5, bh / 2, 0, Math.PI, 0); // top arc only
  ctx.stroke();

  // Band bottom shadow line
  ctx.strokeStyle = 'rgba(0,0,0,0.50)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, by + bh / 2, r + 1.5, bh / 2, 0, 0, Math.PI); // bottom arc only
  ctx.stroke();

  // Rivet on the left and right sides
  for (const rx of [cx - r + 3, cx + r - 3]) {
    ctx.fillStyle = '#909090';
    ctx.beginPath();
    ctx.arc(rx, by + bh / 2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(rx - 0.5, by + bh / 2 - 0.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Lid (top ellipse) ────────────────────────────────────────────────────────

const lidRX = radius(0);  // same as top radius = 13
const lidRY = 6;
const lidCY = bodyTop + 1;

// Lid shadow
ctx.fillStyle = 'rgba(0,0,0,0.22)';
ctx.beginPath();
ctx.ellipse(cx, lidCY + 1, lidRX + 1, lidRY + 1, 0, 0, Math.PI * 2);
ctx.fill();

// Lid face — slightly lighter warm wood
const lidGrad = ctx.createRadialGradient(cx - 4, lidCY - 2, 1, cx, lidCY, lidRX);
lidGrad.addColorStop(0,   '#e8a85a');
lidGrad.addColorStop(0.5, '#c07838');
lidGrad.addColorStop(1,   '#7a4018');
ctx.fillStyle = lidGrad;
ctx.beginPath();
ctx.ellipse(cx, lidCY, lidRX, lidRY, 0, 0, Math.PI * 2);
ctx.fill();

// Lid plank lines (3 across)
ctx.lineWidth = 0.8;
for (const dx of [-5, 0, 5]) {
  const normX = dx / lidRX;
  if (Math.abs(normX) >= 1) continue;
  const halfH = Math.sqrt(1 - normX * normX) * lidRY;
  ctx.strokeStyle = 'rgba(50,18,4,0.38)';
  ctx.beginPath();
  ctx.moveTo(cx + dx, lidCY - halfH);
  ctx.lineTo(cx + dx, lidCY + halfH);
  ctx.stroke();
}

// Lid rim band
ctx.strokeStyle = '#585858';
ctx.lineWidth = 2;
ctx.beginPath();
ctx.ellipse(cx, lidCY, lidRX + 1, lidRY + 1, 0, 0, Math.PI * 2);
ctx.stroke();

// Lid specular highlight
ctx.fillStyle = 'rgba(255,240,200,0.18)';
ctx.beginPath();
ctx.ellipse(cx - 4, lidCY - 1, lidRX * 0.48, lidRY * 0.45, 0, 0, Math.PI * 2);
ctx.fill();

// ─── Barrel outline stroke ────────────────────────────────────────────────────

ctx.strokeStyle = 'rgba(20,6,0,0.60)';
ctx.lineWidth = 1.5;
bodyPath();
ctx.stroke();

// ─── Output ───────────────────────────────────────────────────────────────────

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'barrel.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${T}×${T} px)`);
