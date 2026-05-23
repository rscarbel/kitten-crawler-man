#!/usr/bin/env tsx
/**
 * Regenerates the Juicer boss sprite sheet.
 *
 * Outputs: src/images/bosses/juicer.png
 *
 * Run: npx tsx scripts/generate-juicer-sprite.ts
 *
 * Changes from original generation (commit a85ec24):
 *   - tileY raised from 24 → 50 so the head crest and enraged glow ring clear the frame top
 *   - frameH increased from 224 → 256 to provide bottom padding
 *   - Eye visibility condition fixed: facingY < -0.5 hides eyes (was facingY > 0.5,
 *     which incorrectly hid eyes when facing south/toward the camera)
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const S = 64; // tile scale used during drawing
const FRAME_W = 208;
const FRAME_H = 256; // was 224; extra 32px prevents row bleed from head crest
const TILE_X = 72;
const TILE_Y = 50; // was 24; enraged glow (cs*0.72=73.7px above cy) needs cy≥74 from frame top
const WALK_FRAMES = 8;
const THROW_FRAMES = 6;
const TAU = Math.PI * 2;

type Ctx = NodeCtx;

// ---------------------------------------------------------------------------
// Inline drawDumbbellHeld (from gymEquipmentSprite.ts)
// ---------------------------------------------------------------------------

function drawDumbbellHeld(ctx: Ctx, cx: number, cy: number, s: number, throwAnim: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const angle = -0.8 + throwAnim * 1.6;
  ctx.rotate(angle);

  const barLen = s * 0.55;
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = '#999';
  ctx.fillRect(-barLen * 0.5, -s * 0.04, barLen, s * 0.08);

  for (const sign of [-1, 1]) {
    (ctx as unknown as CanvasRenderingContext2D).fillStyle = '#444';
    ctx.beginPath();
    ctx.ellipse(sign * barLen * 0.47, 0, s * 0.07, s * 0.14, 0, 0, TAU);
    ctx.fill();
    (ctx as unknown as CanvasRenderingContext2D).fillStyle = '#666';
    ctx.beginPath();
    ctx.ellipse(sign * barLen * 0.47, 0, s * 0.04, s * 0.09, 0, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Procedural Juicer sprite drawing
// ---------------------------------------------------------------------------

function drawJuicer(
  ctx: Ctx,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  throwAnim = 0,
  facingX = 1,
  facingY = 1,
  isEnraged = false,
  heldDumbbell = false,
  enragedGlowAlpha = 0.45,
): void {
  const cs = s * 1.6;
  const cx = sx + s * 0.5;
  const cy = sy + s * 0.5;

  const bodyBob = isMoving ? -Math.abs(Math.sin(walkFrame)) * s * 0.05 : 0;
  const legSwing = isMoving ? Math.sin(walkFrame) * cs * 0.06 : 0;
  const armSwing = isMoving ? -Math.sin(walkFrame) * cs * 0.04 : 0;
  const tailSway = Math.sin(walkFrame * 0.7) * cs * 0.1;

  const skinColor = '#3a8a3a';
  const skinDark = '#2a6a2a';
  const skinLight = '#5aaa5a';
  const scaleColor = '#245a24';
  const bellyColor = '#c8b87a';
  const shortsColor = '#1a1a1a';
  const shortsHighlight = '#2e2e2e';
  const eyeWhite = '#fff';
  const pupilColor = isEnraged ? '#f97316' : '#1a3a1a';

  ctx.save();

  // Shadow
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, sy + s * 0.97, cs * 0.45, cs * 0.1, 0, 0, TAU);
  ctx.fill();

  // Tail (drawn behind body)
  const tailBase = { x: cx - facingX * cs * 0.25, y: cy + cs * 0.1 + bodyBob };
  const tailTip = {
    x: tailBase.x - facingX * cs * 0.4 + tailSway,
    y: tailBase.y + cs * 0.35,
  };
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = skinColor;
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = cs * 0.16;
  (ctx as unknown as CanvasRenderingContext2D).lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tailBase.x, tailBase.y);
  ctx.quadraticCurveTo(
    tailBase.x - facingX * cs * 0.1 + tailSway * 0.5,
    tailBase.y + cs * 0.2,
    tailTip.x,
    tailTip.y,
  );
  ctx.stroke();
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = cs * 0.07;
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = skinDark;
  ctx.beginPath();
  ctx.moveTo(tailTip.x, tailTip.y);
  ctx.lineTo(tailTip.x - facingX * cs * 0.12 + tailSway * 0.3, tailTip.y + cs * 0.18);
  ctx.stroke();
  (ctx as unknown as CanvasRenderingContext2D).lineCap = 'butt';

  // Legs
  const legY = cy + cs * 0.12 + bodyBob;
  const legW = cs * 0.2;
  const legH = cs * 0.34;

  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinDark;
  ctx.beginPath();
  ctx.roundRect(cx - cs * 0.27 - legW * 0.5, legY - legSwing * 0.5, legW, legH, cs * 0.06);
  ctx.fill();
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx - cs * 0.27 + facingX * cs * 0.06, legY + legH - legSwing * 0.5, legW * 0.7, legW * 0.3, 0, 0, TAU);
  ctx.fill();

  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinDark;
  ctx.beginPath();
  ctx.roundRect(cx + cs * 0.07 - legW * 0.5, legY + legSwing * 0.5, legW, legH, cs * 0.06);
  ctx.fill();
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.07 + facingX * cs * 0.06, legY + legH + legSwing * 0.5, legW * 0.7, legW * 0.3, 0, 0, TAU);
  ctx.fill();

  // Shorts
  const shortsY = cy + cs * 0.04 + bodyBob;
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = shortsColor;
  ctx.beginPath();
  ctx.moveTo(cx - cs * 0.4, shortsY);
  ctx.lineTo(cx + cs * 0.4, shortsY);
  ctx.lineTo(cx + cs * 0.38, shortsY + cs * 0.28);
  ctx.lineTo(cx - cs * 0.38, shortsY + cs * 0.28);
  ctx.closePath();
  ctx.fill();
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = shortsHighlight;
  ctx.fillRect(cx - cs * 0.41, shortsY - cs * 0.02, cs * 0.82, cs * 0.06);
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = '#111';
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, shortsY);
  ctx.lineTo(cx, shortsY + cs * 0.28);
  ctx.stroke();

  // Torso
  const torsoY = cy - cs * 0.08 + bodyBob;
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(cx, torsoY, cs * 0.42, cs * 0.28, 0, 0, TAU);
  ctx.fill();

  // Scale pattern
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = scaleColor;
  for (let row = 0; row < 3; row++) {
    for (let col = -1; col <= 1; col++) {
      const scx = cx + col * cs * 0.13 + (row % 2 === 0 ? 0 : cs * 0.065);
      const scy = torsoY - cs * 0.14 + row * cs * 0.12;
      ctx.beginPath();
      ctx.ellipse(scx, scy, cs * 0.055, cs * 0.04, 0, 0, TAU);
      ctx.fill();
    }
  }

  // Belly
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = bellyColor;
  ctx.beginPath();
  ctx.ellipse(cx + facingX * cs * 0.04, torsoY + cs * 0.06, cs * 0.18, cs * 0.22, 0, 0, TAU);
  ctx.fill();

  // Pecs
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinLight;
  ctx.beginPath();
  ctx.ellipse(cx - cs * 0.14, torsoY - cs * 0.06, cs * 0.14, cs * 0.1, -0.3, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + cs * 0.14, torsoY - cs * 0.06, cs * 0.14, cs * 0.1, 0.3, 0, TAU);
  ctx.fill();

  // Arms
  const leftArmX = cx - cs * 0.48;
  const leftArmY = torsoY + armSwing;
  const rightArmX = cx + cs * 0.48;
  const throwRaise = throwAnim > 0 ? -Math.sin(throwAnim * Math.PI) * cs * 0.3 : 0;
  const rightArmY = torsoY - armSwing + throwRaise;

  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(leftArmX, leftArmY, cs * 0.14, cs * 0.2, -0.2, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(rightArmX, rightArmY, cs * 0.14, cs * 0.2, 0.2, 0, TAU);
  ctx.fill();

  // Forearms
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(leftArmX - cs * 0.04, leftArmY + cs * 0.2, cs * 0.1, cs * 0.15, -0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(rightArmX + cs * 0.04, rightArmY + cs * 0.2, cs * 0.1, cs * 0.15, 0.1, 0, TAU);
  ctx.fill();

  // Hands
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(leftArmX - cs * 0.06, leftArmY + cs * 0.35, cs * 0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightArmX + cs * 0.06, rightArmY + cs * 0.35, cs * 0.08, 0, TAU);
  ctx.fill();

  // Claws
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = '#1a4a1a';
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(rightArmX + cs * 0.06 + i * cs * 0.05, rightArmY + cs * 0.35);
    ctx.lineTo(rightArmX + cs * 0.06 + i * cs * 0.06, rightArmY + cs * 0.43);
    ctx.stroke();
  }

  // Bicep vein
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = skinDark;
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftArmX - cs * 0.04, leftArmY - cs * 0.06);
  ctx.bezierCurveTo(
    leftArmX - cs * 0.1, leftArmY,
    leftArmX - cs * 0.08, leftArmY + cs * 0.08,
    leftArmX, leftArmY + cs * 0.12,
  );
  ctx.stroke();

  // Head
  const headY = cy - cs * 0.38 + bodyBob;
  const headX = cx + facingX * cs * 0.08;

  // Neck
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(cx, headY + cs * 0.14, cs * 0.16, cs * 0.12, 0, 0, TAU);
  ctx.fill();

  // Head base
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(headX, headY, cs * 0.28, cs * 0.22, 0, 0, TAU);
  ctx.fill();

  // Crest spines
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = scaleColor;
  for (let i = -2; i <= 2; i++) {
    const spineX = headX + i * cs * 0.07;
    const spineBaseY = headY - cs * 0.14;
    const spineH = cs * (0.1 + Math.abs(i) * 0.02);
    ctx.beginPath();
    ctx.moveTo(spineX - cs * 0.025, spineBaseY);
    ctx.lineTo(spineX + cs * 0.025, spineBaseY);
    ctx.lineTo(spineX, spineBaseY - spineH);
    ctx.closePath();
    ctx.fill();
  }

  // Snout
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinDark;
  ctx.beginPath();
  ctx.ellipse(headX + facingX * cs * 0.2, headY + cs * 0.06, cs * 0.16, cs * 0.1, 0, 0, TAU);
  ctx.fill();
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(headX + facingX * cs * 0.2, headY + cs * 0.04, cs * 0.13, cs * 0.08, 0, 0, TAU);
  ctx.fill();

  // Nostrils
  (ctx as unknown as CanvasRenderingContext2D).fillStyle = '#1a3a1a';
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.27, headY + cs * 0.03, cs * 0.015, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.27, headY + cs * 0.06, cs * 0.015, 0, TAU);
  ctx.fill();

  // Eyes — hidden only when clearly facing north/away (facingY < -0.5).
  // Original bug: condition was `facingY > 0.5`, which hid eyes when facing south.
  if (facingY >= -0.5) {
    const eyeOffX = cs * 0.1;
    const eyeY = headY - cs * 0.04;

    (ctx as unknown as CanvasRenderingContext2D).fillStyle = eyeWhite;
    ctx.beginPath();
    ctx.ellipse(headX - eyeOffX, eyeY, cs * 0.075, cs * 0.065, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headX + eyeOffX, eyeY, cs * 0.075, cs * 0.065, 0, 0, TAU);
    ctx.fill();

    (ctx as unknown as CanvasRenderingContext2D).fillStyle = pupilColor;
    ctx.beginPath();
    ctx.ellipse(headX - eyeOffX + facingX * cs * 0.02, eyeY, cs * 0.02, cs * 0.05, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headX + eyeOffX + facingX * cs * 0.02, eyeY, cs * 0.02, cs * 0.05, 0, 0, TAU);
    ctx.fill();

    // Eyebrow ridges
    (ctx as unknown as CanvasRenderingContext2D).strokeStyle = scaleColor;
    (ctx as unknown as CanvasRenderingContext2D).lineWidth = cs * 0.03;
    (ctx as unknown as CanvasRenderingContext2D).lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX - eyeOffX - cs * 0.065, eyeY - cs * 0.055);
    ctx.lineTo(headX - eyeOffX + cs * 0.045, eyeY - cs * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX + eyeOffX - cs * 0.045, eyeY - cs * 0.07);
    ctx.lineTo(headX + eyeOffX + cs * 0.065, eyeY - cs * 0.055);
    ctx.stroke();
    (ctx as unknown as CanvasRenderingContext2D).lineCap = 'butt';
  }

  // Jaw teeth
  (ctx as unknown as CanvasRenderingContext2D).strokeStyle = '#c8b87a';
  (ctx as unknown as CanvasRenderingContext2D).lineWidth = cs * 0.02;
  ctx.beginPath();
  ctx.arc(headX + facingX * cs * 0.18, headY + cs * 0.06, cs * 0.1, 0.15, Math.PI - 0.15);
  ctx.stroke();

  // Held dumbbell
  if (heldDumbbell) {
    const handX = rightArmX + cs * 0.06;
    const handY = rightArmY + cs * 0.35;
    drawDumbbellHeld(ctx as unknown as CanvasRenderingContext2D, handX, handY, s, throwAnim);
  }

  // Enraged glow (per-frame alpha creates animation across walk cycle)
  if (isEnraged) {
    ctx.save();
    (ctx as unknown as CanvasRenderingContext2D).globalAlpha = enragedGlowAlpha;
    (ctx as unknown as CanvasRenderingContext2D).strokeStyle = '#f97316';
    (ctx as unknown as CanvasRenderingContext2D).lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + bodyBob * 0.5, cs * 0.55, cs * 0.72, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sheet builder
// ---------------------------------------------------------------------------

interface FrameFn {
  (ctx: Ctx, sx: number, sy: number, s: number): void;
}

interface AnimRow {
  label: string;
  frames: FrameFn[];
}

function buildSheet(rows: AnimRow[]): void {
  const maxCols = Math.max(...rows.map((r) => r.frames.length));
  const sheetW = maxCols * FRAME_W;
  const sheetH = rows.length * FRAME_H;

  const canvas = createCanvas(sheetW, sheetH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (let colIdx = 0; colIdx < row.frames.length; colIdx++) {
      const absX = colIdx * FRAME_W + TILE_X;
      const absY = rowIdx * FRAME_H + TILE_Y;
      row.frames[colIdx](ctx, absX, absY, S);
    }
  }

  const outPath = resolve(process.cwd(), 'src/images/bosses/juicer.png');
  mkdirSync(resolve(process.cwd(), 'src/images/bosses'), { recursive: true });
  writeFileSync(outPath, canvas.toBuffer('image/png'));

  const kb = Math.round(
    (canvas.toBuffer('image/png').byteLength) / 1024,
  );
  console.log(`✓ src/images/bosses/juicer.png  (${sheetW}×${sheetH}px, ~${kb}KB)`);
  console.log(`  frameW=${FRAME_W}  frameH=${FRAME_H}  tileX=${TILE_X}  tileY=${TILE_Y}`);
  console.log(`  rows: ${rows.map((r, i) => `${i}:${r.label}(${r.frames.length}f)`).join('  ')}`);
}

// ---------------------------------------------------------------------------
// Frame definitions
// ---------------------------------------------------------------------------

const walkRow: AnimRow = {
  label: 'walk',
  frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) => {
    const wf = (k / WALK_FRAMES) * TAU;
    drawJuicer(ctx, sx, sy, s, wf, true, 0, 1, 1, false, false);
  }),
};

const idleRow: AnimRow = {
  label: 'idle',
  frames: [
    (ctx: Ctx, sx: number, sy: number, s: number) => {
      drawJuicer(ctx, sx, sy, s, 0, false, 0, 1, 1, false, false);
    },
  ],
};

const throwRow: AnimRow = {
  label: 'throw',
  frames: Array.from({ length: THROW_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) => {
    const t = THROW_FRAMES === 1 ? 0 : k / (THROW_FRAMES - 1);
    const held = t > 0.3;
    drawJuicer(ctx, sx, sy, s, 0, false, t, 1, 1, false, held);
  }),
};

const walkEnragedRow: AnimRow = {
  label: 'walk_enraged',
  frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) => {
    const wf = (k / WALK_FRAMES) * TAU;
    // Spread glow alpha across the walk cycle for visible pulsing in the sheet.
    const glowAlpha = 0.35 + 0.2 * Math.sin((k / WALK_FRAMES) * TAU);
    drawJuicer(ctx, sx, sy, s, wf, true, 0, 1, 1, true, false, glowAlpha);
  }),
};

const idleEnragedRow: AnimRow = {
  label: 'idle_enraged',
  frames: [
    (ctx: Ctx, sx: number, sy: number, s: number) => {
      drawJuicer(ctx, sx, sy, s, 0, false, 0, 1, 1, true, false, 0.45);
    },
  ],
};

buildSheet([walkRow, idleRow, throwRow, walkEnragedRow, idleEnragedRow]);
