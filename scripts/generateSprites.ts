#!/usr/bin/env tsx
// scripts/generateSprites.ts
// Generates PNG sprite sheets for all creatures and characters.
// Run: tsx scripts/generateSprites.ts
//
// Output layout per sheet: each row = one animation state, each column = frame.
// Tile origin (sx, sy) is centered in each frame cell with padding.
// Scale s=64 (2× game tile) for sharper exports.

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

import { drawCatSprite } from '../src/sprites/catSprite.js';
import { drawHumanSprite, drawHumanPunchArm, drawHumanKickLeg } from '../src/sprites/humanSprite.js';
import { drawGoblinBodyOnly, drawGoblinWeaponOnly } from '../src/sprites/goblinSprite.js';
import { drawRatSprite } from '../src/sprites/ratSprite.js';
import { drawLlamaSprite } from '../src/sprites/llamaSprite.js';
import { drawMongoSprite } from '../src/sprites/mongoSprite.js';
import { drawTroglodyteSprite } from '../src/sprites/troglodyteSprite.js';
import { drawTusklingSprite } from '../src/sprites/tusklingSprite.js';
import {
  drawBrindleGrubSprite,
  drawCowTailedGrubSprite,
  drawBrindledVespaSprite,
} from '../src/sprites/brindleGrubSprite.js';
import { drawHoarderSprite } from '../src/sprites/hoarderSprite.js';
import { drawJuicerSprite } from '../src/sprites/juicerSprite.js';
import { drawBallOfSwineSprite } from '../src/sprites/ballOfSwineSprite.js';
import { drawKrakarenSprite } from '../src/sprites/krakarenSprite.js';
import { drawRatKinSprite } from '../src/sprites/ratKinSprite.js';
import { drawIncubusSprite } from '../src/sprites/incubusSprite.js';
import { drawBugabooSprite } from '../src/sprites/bugabooSprite.js';
import {
  drawSkyFowlSprite,
  SKY_FOWL_LEG_COLOR,
  drawSkyFowlPantsMask,
  drawSkyFowlVestMask,
  drawSkyFowlTrimMask,
  drawSkyFowlHatMask,
} from '../src/sprites/skyFowlSprite.js';
import { drawQuestNPCSprite, drawChildSprite } from '../src/sprites/questNPCSprite.js';
import {
  drawProtectiveShellActive,
  drawProtectiveShellAppear,
  drawProtectiveShellExpire,
  drawProtectiveShellMini,
  drawProtectiveShellShockwave,
} from '../src/sprites/protectiveShellSprite.js';
import { drawBloodDrop, drawBloodPuddle } from '../src/sprites/goreSprite.js';
import {
  drawCottageWallFacade,
  drawTowerWallFacade,
  drawMerchantWallFacade,
  drawStoneWallFacade,
  drawCircusWallFacade,
  drawMetalWall,
  drawBackGableWall,
  drawThatchRoofEaves, drawThatchRoofMiddle, drawThatchRoofBack,
  drawSlateRoofEaves, drawSlateRoofMiddle, drawSlateRoofBack,
  drawRedRoofEaves, drawRedRoofMiddle, drawRedRoofBack,
  drawGreenRoofEaves, drawGreenRoofMiddle, drawGreenRoofBack,
  drawCircusRoofEaves, drawCircusRoofMiddle, drawCircusRoofBack,
  type RoofStyle,
  drawRoofHipCornerFL, drawRoofHipCornerFR, drawRoofHipCornerBL, drawRoofHipCornerBR,
  drawRoofHipSideL, drawRoofHipSideR,
  drawRoofGableEndL, drawRoofGableEndR,
  drawRoofValleyFL, drawRoofValleyFR,
  drawRoofFlat,
  drawRoofRidgeEndL, drawRoofRidgeEndR,
  drawCircusTentPeak, drawCircusTentSlope, drawCircusTentCorner, drawCircusTentScallop,
  drawTree,
  drawTorch,
  drawWell,
  drawFountain,
  drawGrassyWeed,
  drawDirtPatch,
} from '../src/sprites/environmentSprites.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const S = 64; // export tile scale — 2× game size for better quality
const TAU = Math.PI * 2;
const WALK_FRAMES = 8;
const ATTACK_FRAMES = 6;

const OUT_DIR = path.join(process.cwd(), 'src', 'images');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Node-canvas context is structurally identical to browser CanvasRenderingContext2D.
// tsx strips types so the structural mismatch between lib.dom and canvas pkg is irrelevant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;
type FrameFn = (ctx: Ctx, sx: number, sy: number, s: number) => void;

interface AnimRow {
  label: string;
  frames: FrameFn[];
}

interface SheetSpec {
  name: string;
  category: string;
  /** pixel width of each frame cell */
  frameW: number;
  /** pixel height of each frame cell */
  frameH: number;
  /** tile-origin X offset within each cell */
  tileX: number;
  /** tile-origin Y offset within each cell */
  tileY: number;
  rows: AnimRow[];
  /** Override the recorded tileScale in the manifest (defaults to S=64). */
  tileScale?: number;
}

interface FrameStateMeta {
  row: number;
  frameCount: number;
}

interface SpriteMeta {
  path: string;
  frameWidth: number;
  frameHeight: number;
  tileX: number;
  tileY: number;
  tileScale: number;
  states: Record<string, FrameStateMeta>;
}

// ---------------------------------------------------------------------------
// Frame helpers
// ---------------------------------------------------------------------------

/** 8-frame walk cycle: walkFrame sweeps 0 → TAU. */
function walkRow(label: string, render: (ctx: Ctx, sx: number, sy: number, s: number, wf: number) => void): AnimRow {
  return {
    label,
    frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
      render(ctx, sx, sy, s, k * TAU / WALK_FRAMES),
    ),
  };
}

/** 8-frame time-based walk cycle: walkTime sweeps 0 → TAU (one bob period). */
function timeWalkRow(label: string, render: (ctx: Ctx, sx: number, sy: number, s: number, t: number) => void): AnimRow {
  // body-bob period = 2π / 0.25 ≈ 25 s; spread 8 frames over one full cycle
  const PERIOD = TAU / 0.25;
  return {
    label,
    frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
      render(ctx, sx, sy, s, k * PERIOD / WALK_FRAMES),
    ),
  };
}

/** N-frame sweep of a 0–1 parameter. */
function sweepRow(label: string, count: number, render: (ctx: Ctx, sx: number, sy: number, s: number, t: number) => void): AnimRow {
  return {
    label,
    frames: Array.from({ length: count }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
      render(ctx, sx, sy, s, count === 1 ? 0 : k / (count - 1)),
    ),
  };
}

/** Single static frame. */
function staticRow(label: string, render: FrameFn): AnimRow {
  return { label, frames: [render] };
}

// ---------------------------------------------------------------------------
// Sheet builder
// ---------------------------------------------------------------------------

function buildSheet(spec: SheetSpec): SpriteMeta {
  const maxCols = Math.max(...spec.rows.map(r => r.frames.length));
  const sheetW = maxCols * spec.frameW;
  const sheetH = spec.rows.length * spec.frameH;

  const canvas = createCanvas(sheetW, sheetH);
  const ctx = canvas.getContext('2d') as Ctx;

  const states: Record<string, FrameStateMeta> = {};

  for (let rowIdx = 0; rowIdx < spec.rows.length; rowIdx++) {
    const row = spec.rows[rowIdx];
    states[row.label] = { row: rowIdx, frameCount: row.frames.length };
    for (let colIdx = 0; colIdx < row.frames.length; colIdx++) {
      const absX = colIdx * spec.frameW + spec.tileX;
      const absY = rowIdx * spec.frameH + spec.tileY;
      row.frames[colIdx](ctx, absX, absY, S);
    }
  }

  const outPath = path.join(OUT_DIR, spec.category, `${spec.name}.png`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));

  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`  ✓ ${spec.category}/${spec.name}.png  (${sheetW}×${sheetH} px, ${kb} KB)`);

  return {
    path: `${spec.category}/${spec.name}.png`,
    frameWidth: spec.frameW,
    frameHeight: spec.frameH,
    tileX: spec.tileX,
    tileY: spec.tileY,
    tileScale: spec.tileScale ?? S,
    states,
  };
}

// ---------------------------------------------------------------------------
// Manifest accumulator
// ---------------------------------------------------------------------------

const manifest: Record<string, SpriteMeta> = {};

function gen(spec: SheetSpec): void {
  manifest[spec.name] = buildSheet(spec);
}

// ---------------------------------------------------------------------------
// performance.now() mock for time-based sprites
// Allows generating distinct animation frames for vespa/boss time-driven animations.
// ---------------------------------------------------------------------------

let perfMockValue: number | null = null;
const origPerfNow = performance.now.bind(performance);

function setPerfTime(ms: number): void {
  perfMockValue = ms;
  performance.now = () => perfMockValue!;
}
function resetPerfTime(): void {
  perfMockValue = null;
  performance.now = origPerfNow;
}

/** Renders N frames by cycling performance.now across [startMs, startMs+periodMs). */
function perfFrameRow(
  label: string,
  count: number,
  periodMs: number,
  startMs: number,
  render: FrameFn,
): AnimRow {
  return {
    label,
    frames: Array.from({ length: count }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) => {
      setPerfTime(startMs + k * periodMs / count);
      render(ctx, sx, sy, s);
      resetPerfTime();
    }),
  };
}

// ===========================================================================
// CHARACTERS
// ===========================================================================

console.log('\n=== Characters ===');

// --- Cat ---
gen({
  name: 'cat',
  category: 'characters',
  frameW: 96, frameH: 96, tileX: 16, tileY: 8,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawCatSprite(ctx, sx, sy, s, wf, true, 0)),
    staticRow('idle', (ctx, sx, sy, s) => drawCatSprite(ctx, sx, sy, s, 0, false, 0)),
    walkRow('walk_away', (ctx, sx, sy, s, wf) => drawCatSprite(ctx, sx, sy, s, wf, true, -1)),
  ],
});

// --- Human base body ---
// frameW=96 keeps the torso/legs within bounds; punch/kick limbs are in separate compositing sheets.
gen({
  name: 'human',
  category: 'characters',
  frameW: 96, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    walkRow('walk',      (ctx, sx, sy, s, wf) => drawHumanSprite(ctx, sx, sy, s, false, wf, true,  0)),
    staticRow('idle',    (ctx, sx, sy, s)     => drawHumanSprite(ctx, sx, sy, s, false, 0,  false, 0)),
    walkRow('walk_away', (ctx, sx, sy, s, wf) => drawHumanSprite(ctx, sx, sy, s, false, wf, true, -1)),
    // Body during kick: right leg is hidden so the kick-leg compositing sheet can overlay it.
    staticRow('kick_body', (ctx, sx, sy, s)   => drawHumanSprite(ctx, sx, sy, s, true,  0,  false, 0)),
  ],
});

// --- Human punch arm (compositing layer, pixel-aligned with human.png) ---
// Sleeve + knuckled fist extending rightward. Overlay on human idle at the same tile origin.
// frameW=128: shoulder at tileX+s*0.78=65.9px, full reach +s*0.52=33.3px → tip at 99.2px < 128 ✓
gen({
  name: 'human_punch_arm',
  category: 'characters',
  frameW: 128, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    sweepRow('punch', 6, (ctx, sx, sy, _s, t) => drawHumanPunchArm(ctx, sx, sy, S, t)),
  ],
});

// --- Human kick leg (compositing layer, pixel-aligned with human.png) ---
// Bare leg + dark shoe extending rightward with a slight upward arc.
// Overlay on human kick_body at the same tile origin.
// frameW=128: hip at tileX+s*0.55=51.2px, full reach +s*0.52=33.3px → tip+shoe at ~96px < 128 ✓
gen({
  name: 'human_kick_leg',
  category: 'characters',
  frameW: 128, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    sweepRow('kick', 6, (ctx, sx, sy, _s, t) => drawHumanKickLeg(ctx, sx, sy, S, t)),
  ],
});

// ===========================================================================
// ENEMIES
// ===========================================================================

console.log('\n=== Enemies ===');

const GOBLIN_ATTACK_FRAMES = 16;
const GOBLIN_SKIN = '#6b8c4e';
const GOBLIN_EYE = '#ffe44d';

// --- Goblin base (body without weapon — compositing layer) ---
gen({
  name: 'goblin_base',
  category: 'enemies',
  frameW: 96, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    walkRow('walk',   (ctx, sx, sy, s, wf) => drawGoblinBodyOnly(ctx, sx, sy, s, GOBLIN_SKIN, GOBLIN_EYE, wf, true,  0)),
    staticRow('idle', (ctx, sx, sy, s)     => drawGoblinBodyOnly(ctx, sx, sy, s, GOBLIN_SKIN, GOBLIN_EYE, 0,  false, 0)),
    sweepRow('attack', GOBLIN_ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawGoblinBodyOnly(ctx, sx, sy, s, GOBLIN_SKIN, GOBLIN_EYE, 0, false, t)),
  ],
});

// --- Goblin club weapon (pixel-aligned with goblin_base) ---
// frameW=128: pivot at tileX+s*0.87=71.7px; full swing reach ~31px right → 102px < 128 ✓
gen({
  name: 'goblin_weapon_club',
  category: 'enemies',
  frameW: 128, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    walkRow('walk',   (ctx, sx, sy, s, wf) => drawGoblinWeaponOnly(ctx, sx, sy, s, 'club', wf, true,  0)),
    staticRow('idle', (ctx, sx, sy, s)     => drawGoblinWeaponOnly(ctx, sx, sy, s, 'club', 0,  false, 0)),
    sweepRow('attack', GOBLIN_ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawGoblinWeaponOnly(ctx, sx, sy, s, 'club', 0, false, t)),
  ],
});

// --- Goblin hammer weapon (pixel-aligned with goblin_base) ---
// frameW=128: pivot at tileX+s*0.87=71.7px; hammer head extends ~31px right → 102px < 128 ✓
gen({
  name: 'goblin_weapon_hammer',
  category: 'enemies',
  frameW: 128, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    walkRow('walk',   (ctx, sx, sy, s, wf) => drawGoblinWeaponOnly(ctx, sx, sy, s, 'hammer', wf, true,  0)),
    staticRow('idle', (ctx, sx, sy, s)     => drawGoblinWeaponOnly(ctx, sx, sy, s, 'hammer', 0,  false, 0)),
    sweepRow('attack', GOBLIN_ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawGoblinWeaponOnly(ctx, sx, sy, s, 'hammer', 0, false, t)),
  ],
});

// --- Rat ---
gen({
  name: 'rat',
  category: 'enemies',
  frameW: 96, frameH: 96, tileX: 16, tileY: 8,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawRatSprite(ctx, sx, sy, s, wf, true, 0)),
    staticRow('idle', (ctx, sx, sy, s) => drawRatSprite(ctx, sx, sy, s, 0, false, 0)),
    sweepRow('attack', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawRatSprite(ctx, sx, sy, s, t * Math.PI, false, t)),
  ],
});

// --- Llama ---
gen({
  name: 'llama',
  category: 'enemies',
  frameW: 128, frameH: 96, tileX: 32, tileY: 8,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawLlamaSprite(ctx, sx, sy, s, wf, true, 0)),
    staticRow('idle', (ctx, sx, sy, s) => drawLlamaSprite(ctx, sx, sy, s, 0, false, 0)),
    sweepRow('spit', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawLlamaSprite(ctx, sx, sy, s, 0, false, t)),
  ],
});

// --- Mongo (blue raptor) ---
gen({
  name: 'mongo',
  category: 'enemies',
  frameW: 128, frameH: 96, tileX: 32, tileY: 8,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawMongoSprite(ctx, sx, sy, s, wf, true, 1, 0, 0, 1.0)),
    staticRow('idle', (ctx, sx, sy, s) => drawMongoSprite(ctx, sx, sy, s, 0, false, 1, 0, 0, 1.0)),
    sweepRow('attack', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawMongoSprite(ctx, sx, sy, s, t * Math.PI, false, 1, 0, t, 1.0)),
  ],
});

// --- Troglodyte (body only — tongue is a separate rotatable sprite) ---
// 1.15× tile scale; body arms reach cx ± cs*0.38 = 56 ± 27.9 → max 84px < 128 ✓
gen({
  name: 'troglodyte',
  category: 'enemies',
  frameW: 128, frameH: 128, tileX: 24, tileY: 16,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawTroglodyteSprite(ctx, sx, sy, s, wf, true, 0, 0, 1, 0)),
    staticRow('idle', (ctx, sx, sy, s) => drawTroglodyteSprite(ctx, sx, sy, s, 0, false, 0, 0, 1, 0)),
    // jaw windup (no tongue) — shows the mouth opening before the lash
    sweepRow('mouth_open', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawTroglodyteSprite(ctx, sx, sy, s, 0, false, 0, t, 1, 0)),
  ],
});

// --- Troglodyte tongue (standalone rotatable sprite) ---
// Drawn from anchor point (tileX, tileY) extending right along +X.
// In game: translate to mouth position, rotate toward player, draw this sprite.
// tileX/tileY in manifest = the anchor point within each frame cell.
// Frame: wide enough for full tongue (s*2.9=186px) + fork (≈11px) + padding.
// Height: enough for fork spread (forkLen*sin(0.42)≈4.5px) + lineWidth/2 + bow sag (cs*0.06≈4.4px).
{
  const TONGUE_PINK = '#d42860';
  const TONGUE_TIP = '#ff4d88';

  function drawTongueOnly(ctx: Ctx, ox: number, oy: number, s: number, tongueExtend: number): void {
    if (tongueExtend <= 0.01) return;
    const cs = s * 1.15;
    const tongueLen = s * 2.9 * tongueExtend;
    const endX = ox + tongueLen;
    const endY = oy;
    // Slight downward bow matching the sprite
    const midX = (ox + endX) * 0.5;
    const midY = oy + cs * 0.06;

    ctx.strokeStyle = TONGUE_PINK;
    ctx.lineWidth = cs * 0.075;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.stroke();

    // Forked tip (horizontal tip angle = 0)
    const forkLen = cs * 0.15;
    ctx.strokeStyle = TONGUE_TIP;
    ctx.lineWidth = cs * 0.048;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX + Math.cos(0.42) * forkLen, endY + Math.sin(0.42) * forkLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX + Math.cos(-0.42) * forkLen, endY + Math.sin(-0.42) * forkLen);
    ctx.stroke();
  }

  gen({
    name: 'troglodyte_tongue',
    category: 'enemies',
    // frameW = anchor_pad(8) + max_tongue(186) + fork_x(10) + right_pad(8) = 212 → 220
    // frameH = top_pad(12) + bow_sag(cs*0.06≈4) + fork_spread(5) + bottom_pad(12) = ~40
    // tileX/tileY = anchor point (mouth origin) within frame
    frameW: 220, frameH: 40, tileX: 8, tileY: 20,
    rows: [
      sweepRow('extend', ATTACK_FRAMES, (ctx, ox, oy, s, t) => drawTongueOnly(ctx, ox, oy, s, t)),
    ],
  });
}

// --- Tuskling ---
// 1.1× tile scale
gen({
  name: 'tuskling',
  category: 'enemies',
  frameW: 128, frameH: 128, tileX: 24, tileY: 16,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawTusklingSprite(ctx, sx, sy, s, wf, true, 0, 1, 1)),
    staticRow('idle', (ctx, sx, sy, s) => drawTusklingSprite(ctx, sx, sy, s, 0, false, 0, 1, 1)),
    sweepRow('charge', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawTusklingSprite(ctx, sx, sy, s, t * Math.PI, true, t, 1, 1)),
  ],
});

// --- Brindle Grub (stage 1) ---
gen({
  name: 'brindle_grub',
  category: 'enemies',
  frameW: 96, frameH: 80, tileX: 16, tileY: 12,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawBrindleGrubSprite(ctx, sx, sy, s, wf, true)),
    staticRow('idle', (ctx, sx, sy, s) => drawBrindleGrubSprite(ctx, sx, sy, s, 0, false)),
  ],
});

// --- Cow-Tailed Grub (stage 2) ---
gen({
  name: 'cow_tailed_grub',
  category: 'enemies',
  frameW: 96, frameH: 96, tileX: 16, tileY: 12,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawCowTailedGrubSprite(ctx, sx, sy, s, wf, true)),
    staticRow('idle', (ctx, sx, sy, s) => drawCowTailedGrubSprite(ctx, sx, sy, s, 0, false)),
  ],
});

// --- Brindled Vespa (stage 3) ---
// Uses performance.now() internally for hover/wing; simulate distinct frames by varying time.
// Wing flutter period = 2π / 22 ≈ 286 ms
{
  const WING_PERIOD_MS = (TAU / 22) * 1000;
  const HOVER_PERIOD_MS = (TAU / 4.5) * 1000;

  gen({
    name: 'brindled_vespa',
    category: 'enemies',
    frameW: 128, frameH: 96, tileX: 32, tileY: 16,
    rows: [
      perfFrameRow('hover', WALK_FRAMES, WING_PERIOD_MS, 0,
        (ctx, sx, sy, s) => drawBrindledVespaSprite(ctx, sx, sy, s, 0, false, 1)),
      // facing left variant
      perfFrameRow('hover_left', WALK_FRAMES, WING_PERIOD_MS, 0,
        (ctx, sx, sy, s) => drawBrindledVespaSprite(ctx, sx, sy, s, 0, false, -1)),
      // hover bob cycle
      perfFrameRow('hover_bob', WALK_FRAMES, HOVER_PERIOD_MS, 0,
        (ctx, sx, sy, s) => drawBrindledVespaSprite(ctx, sx, sy, s, 0, false, 1)),
    ],
  });
}

// ===========================================================================
// BOSSES
// ===========================================================================

console.log('\n=== Bosses ===');

// --- The Hoarder ---
gen({
  name: 'hoarder',
  category: 'bosses',
  frameW: 144, frameH: 160, tileX: 40, tileY: 20,
  rows: [
    staticRow('idle', (ctx, sx, sy, s) => drawHoarderSprite(ctx, sx, sy, s, false, 0, 1, 0)),
    staticRow('enraged', (ctx, sx, sy, s) => drawHoarderSprite(ctx, sx, sy, s, true, 0, 1, 0)),
    sweepRow('vomit', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawHoarderSprite(ctx, sx, sy, s, false, 0, 1, t)),
    sweepRow('vomit_enraged', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawHoarderSprite(ctx, sx, sy, s, true, 0, 1, t)),
  ],
});

// --- Juicer ---
// 1.6× tile — use generous frame size
gen({
  name: 'juicer',
  category: 'bosses',
  frameW: 208, frameH: 224, tileX: 72, tileY: 24,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) =>
      drawJuicerSprite(ctx, sx, sy, s, wf, true, 0, 1, 1, false, false)),
    staticRow('idle', (ctx, sx, sy, s) =>
      drawJuicerSprite(ctx, sx, sy, s, 0, false, 0, 1, 1, false, false)),
    sweepRow('throw', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawJuicerSprite(ctx, sx, sy, s, 0, false, t, 1, 1, false, t > 0.3)),
    walkRow('walk_enraged', (ctx, sx, sy, s, wf) =>
      drawJuicerSprite(ctx, sx, sy, s, wf, true, 0, 1, 1, true, false)),
    staticRow('idle_enraged', (ctx, sx, sy, s) =>
      drawJuicerSprite(ctx, sx, sy, s, 0, false, 0, 1, 1, true, false)),
  ],
});

// --- Ball of Swine ---
// Burst applies ctx.scale(1 + burstProgress*1.8) from the ball's center.
// Max local radius: ts*(ball_r=0.82 + tendril_max=0.20 + half_lineWidth≈0.025) = ts*1.045.
// At peak burst scale 2.8: screen radius = 64*1.045*2.8 ≈ 188px from center.
// cx = tileX + s/2; need cx ≥ 188 and (frameW-cx) ≥ 188.
// tileX=160 → cx=192 → margin=4px at full-burst (which is globalAlpha=0, invisible).
// At the last visible frame (burstProgress=0.9, scale=2.62): radius≈175px, margin=17px ✓
gen({
  name: 'ball_of_swine',
  category: 'bosses',
  frameW: 384, frameH: 384, tileX: 160, tileY: 160,
  rows: [
    // rolling orbit cycle
    {
      label: 'orbit',
      frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
        drawBallOfSwineSprite(ctx, sx, sy, s, k * TAU / WALK_FRAMES, false, false, 0),
      ),
    },
    // stopped (vulnerable) state — 4 frames to show the pulsing stopped glow
    {
      label: 'stopped',
      frames: Array.from({ length: 4 }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
        drawBallOfSwineSprite(ctx, sx, sy, s, k * TAU / 4, true, false, 0),
      ),
    },
    // burst death animation
    sweepRow('burst', 6, (ctx, sx, sy, s, t) =>
      drawBallOfSwineSprite(ctx, sx, sy, s, 0, false, true, t)),
  ],
});

// --- Krakaren Clone ---
// 3×3 tile visual; center tile at frame center
gen({
  name: 'krakaren',
  category: 'bosses',
  frameW: 320, frameH: 320, tileX: 128, tileY: 128,
  rows: [
    // idle sway — time parameter advances over 8 frames
    {
      label: 'idle',
      frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
        drawKrakarenSprite(ctx, sx, sy, s, k * 0.5, false, 0, 1, -1, 0),
      ),
    },
    // attack sweep across first tentacle (index 0)
    sweepRow('attack', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawKrakarenSprite(ctx, sx, sy, s, 0, false, 0, 1, 0, t)),
    // enraged idle
    {
      label: 'enraged',
      frames: Array.from({ length: WALK_FRAMES }, (_, k) => (ctx: Ctx, sx: number, sy: number, s: number) =>
        drawKrakarenSprite(ctx, sx, sy, s, k * 0.5, true, 0, 1, -1, 0),
      ),
    },
  ],
});

// ===========================================================================
// NPCs
// ===========================================================================

console.log('\n=== NPCs ===');

// --- Rat Kin (Mordecai default form) ---
gen({
  name: 'rat_kin',
  category: 'npcs',
  frameW: 96, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    timeWalkRow('walk', (ctx, sx, sy, s, t) => drawRatKinSprite(ctx, sx, sy, s, t, true, 1)),
    staticRow('idle', (ctx, sx, sy, s) => drawRatKinSprite(ctx, sx, sy, s, 0, false, 1)),
    timeWalkRow('walk_left', (ctx, sx, sy, s, t) => drawRatKinSprite(ctx, sx, sy, s, t, true, -1)),
  ],
});

// --- Incubus (Mordecai level 3 / overworld form) ---
// Left wing tip: sx - s*0.42 = tileX - 26.9px  → need tileX ≥ 27.
// Right wing tip: sx + s*1.42 = tileX + 90.9px → need frameW ≥ tileX + 92.
// tileX=32 → left wing at 5.1px, right wing at 122.9px; frameW=160 gives 37px right margin.
gen({
  name: 'incubus',
  category: 'npcs',
  frameW: 160, frameH: 128, tileX: 32, tileY: 16,
  rows: [
    timeWalkRow('walk', (ctx, sx, sy, s, t) => drawIncubusSprite(ctx, sx, sy, s, t, true, 1)),
    staticRow('idle', (ctx, sx, sy, s) => drawIncubusSprite(ctx, sx, sy, s, 0, false, 1)),
    timeWalkRow('walk_left', (ctx, sx, sy, s, t) => drawIncubusSprite(ctx, sx, sy, s, t, true, -1)),
  ],
});

// --- Bugaboo (Mordecai level 2 form) ---
gen({
  name: 'bugaboo',
  category: 'npcs',
  frameW: 128, frameH: 144, tileX: 32, tileY: 16,
  rows: [
    timeWalkRow('walk', (ctx, sx, sy, s, t) => drawBugabooSprite(ctx, sx, sy, s, t, true, 1, 0)),
    staticRow('idle', (ctx, sx, sy, s) => drawBugabooSprite(ctx, sx, sy, s, 0, false, 1, 0)),
    sweepRow('attack', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawBugabooSprite(ctx, sx, sy, s, 0, false, 1, t)),
  ],
});

// --- Sky Fowl — tint-mask layers ---
// Five pixel-aligned sheets. At runtime: draw body, then for each clothing region
// fill the desired color, destination-in with the mask, source-over onto the scene.
const SF_SPEC = { category: 'npcs', frameW: 96, frameH: 128, tileX: 16, tileY: 16 };
const TRANSPARENT = 'rgba(0,0,0,0)';
const SF_BODY_CLOTH = { vest: TRANSPARENT, pants: SKY_FOWL_LEG_COLOR, trim: TRANSPARENT, hat: null as null };

// Body — full hawk, thighs drawn in natural leg color, no clothing colors
gen({
  name: 'sky_fowl_body', ...SF_SPEC,
  rows: [
    walkRow('walk',       (ctx, sx, sy, s, wf) => drawSkyFowlSprite(ctx, sx, sy, s, wf, true,  false, 1, 1, SF_BODY_CLOTH, 0)),
    staticRow('idle',     (ctx, sx, sy, s)     => drawSkyFowlSprite(ctx, sx, sy, s, 0,  false, false, 1, 1, SF_BODY_CLOTH, 0)),
    sweepRow('peck', ATTACK_FRAMES, (ctx, sx, sy, s, t) => drawSkyFowlSprite(ctx, sx, sy, s, 0, false, false, 1, 1, SF_BODY_CLOTH, t)),
    staticRow('aggressive', (ctx, sx, sy, s)   => drawSkyFowlSprite(ctx, sx, sy, s, 0,  false, true,  1, 1, SF_BODY_CLOTH, 0)),
  ],
});

// Pants mask — white thigh silhouette on transparent background
gen({
  name: 'sky_fowl_pants_mask', ...SF_SPEC,
  rows: [
    walkRow('walk',         (ctx, sx, sy, s, wf) => drawSkyFowlPantsMask(ctx, sx, sy, s, wf, true, 1)),
    staticRow('idle',       (ctx, sx, sy, s)     => drawSkyFowlPantsMask(ctx, sx, sy, s, 0, false, 1)),
    sweepRow('peck', ATTACK_FRAMES, (ctx, sx, sy, s, _t) => drawSkyFowlPantsMask(ctx, sx, sy, s, 0, false, 1)),
    staticRow('aggressive', (ctx, sx, sy, s)     => drawSkyFowlPantsMask(ctx, sx, sy, s, 0, false, 1)),
  ],
});

// Vest mask — white vest ellipse on transparent background
gen({
  name: 'sky_fowl_vest_mask', ...SF_SPEC,
  rows: [
    walkRow('walk',         (ctx, sx, sy, s, wf) => drawSkyFowlVestMask(ctx, sx, sy, s, wf, true, 0, 1)),
    staticRow('idle',       (ctx, sx, sy, s)     => drawSkyFowlVestMask(ctx, sx, sy, s, 0, false, 0, 1)),
    sweepRow('peck', ATTACK_FRAMES, (ctx, sx, sy, s, t) => drawSkyFowlVestMask(ctx, sx, sy, s, 0, false, t, 1)),
    staticRow('aggressive', (ctx, sx, sy, s)     => drawSkyFowlVestMask(ctx, sx, sy, s, 0, false, 0, 1)),
  ],
});

// Trim mask — white vest collar + buttons on transparent background
gen({
  name: 'sky_fowl_trim_mask', ...SF_SPEC,
  rows: [
    walkRow('walk',         (ctx, sx, sy, s, wf) => drawSkyFowlTrimMask(ctx, sx, sy, s, wf, true, 0, 1)),
    staticRow('idle',       (ctx, sx, sy, s)     => drawSkyFowlTrimMask(ctx, sx, sy, s, 0, false, 0, 1)),
    sweepRow('peck', ATTACK_FRAMES, (ctx, sx, sy, s, t) => drawSkyFowlTrimMask(ctx, sx, sy, s, 0, false, t, 1)),
    staticRow('aggressive', (ctx, sx, sy, s)     => drawSkyFowlTrimMask(ctx, sx, sy, s, 0, false, 0, 1)),
  ],
});

// Hat mask — white crown + brim + band on transparent background
gen({
  name: 'sky_fowl_hat_mask', ...SF_SPEC,
  rows: [
    walkRow('walk',         (ctx, sx, sy, s, wf) => drawSkyFowlHatMask(ctx, sx, sy, s, wf, true, 0, 1)),
    staticRow('idle',       (ctx, sx, sy, s)     => drawSkyFowlHatMask(ctx, sx, sy, s, 0, false, 0, 1)),
    sweepRow('peck', ATTACK_FRAMES, (ctx, sx, sy, s, t) => drawSkyFowlHatMask(ctx, sx, sy, s, 0, false, t, 1)),
    staticRow('aggressive', (ctx, sx, sy, s)     => drawSkyFowlHatMask(ctx, sx, sy, s, 0, false, 0, 1)),
  ],
});

// --- Quest NPC (Goblin Mother) ---
gen({
  name: 'quest_npc',
  category: 'npcs',
  frameW: 96, frameH: 128, tileX: 16, tileY: 16,
  rows: [
    staticRow('idle', (ctx, sx, sy, s) => drawQuestNPCSprite(ctx, sx, sy, s, 1, 0)),
    sweepRow('hurt', ATTACK_FRAMES, (ctx, sx, sy, s, t) =>
      drawQuestNPCSprite(ctx, sx, sy, s, 1, t * 30)), // hurtTimer counts frames
    staticRow('idle_left', (ctx, sx, sy, s) => drawQuestNPCSprite(ctx, sx, sy, s, -1, 0)),
  ],
});

// --- Goblin Child ---
gen({
  name: 'goblin_child',
  category: 'npcs',
  frameW: 64, frameH: 80, tileX: 8, tileY: 8,
  rows: [
    walkRow('walk', (ctx, sx, sy, s, wf) => drawChildSprite(ctx, sx, sy, s, wf, true, 1)),
    staticRow('idle', (ctx, sx, sy, s) => drawChildSprite(ctx, sx, sy, s, 0, false, 1)),
  ],
});

// ===========================================================================
// EFFECTS
// ===========================================================================

console.log('\n=== Effects ===');

// ---------------------------------------------------------------------------
// Missile draw helpers — mirror the logic in catSprite.ts drawMissiles,
// pulled apart by variant. (cx, cy) is the missile head center.
// All projectiles fly rightward; trail/beam extends to the LEFT (−X).
// ---------------------------------------------------------------------------

function drawStdMissile(ctx: Ctx, cx: number, cy: number, s: number, trailFrac: number): void {
  const trailLen = trailFrac * s * 0.9;
  if (trailLen > 2) {
    const g = ctx.createLinearGradient(cx, cy, cx - trailLen, cy);
    g.addColorStop(0, 'rgba(180, 100, 255, 0.75)');
    g.addColorStop(1, 'rgba(180, 100, 255, 0)');
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - trailLen, cy);
    ctx.stroke();
    ctx.restore();
  }
  const r = s * 0.32;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g2.addColorStop(0, 'rgba(230, 190, 255, 0.9)');
  g2.addColorStop(0.5, 'rgba(150, 70, 240, 0.55)');
  g2.addColorStop(1, 'rgba(80, 0, 180, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g2;
  ctx.fill();
  ctx.fillStyle = '#f0e0ff';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawSubMissile(ctx: Ctx, cx: number, cy: number, s: number, trailFrac: number): void {
  const trailLen = trailFrac * s * 0.9;
  if (trailLen > 2) {
    const g = ctx.createLinearGradient(cx, cy, cx - trailLen, cy);
    g.addColorStop(0, 'rgba(180, 100, 255, 0.75)');
    g.addColorStop(1, 'rgba(180, 100, 255, 0)');
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = s * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - trailLen, cy);
    ctx.stroke();
    ctx.restore();
  }
  const r = s * 0.2;
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g2.addColorStop(0, 'rgba(230, 190, 255, 0.9)');
  g2.addColorStop(0.5, 'rgba(150, 70, 240, 0.55)');
  g2.addColorStop(1, 'rgba(80, 0, 180, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g2;
  ctx.fill();
  ctx.fillStyle = '#f0e0ff';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawFullPowerMissile(ctx: Ctx, cx: number, cy: number, s: number, beamFrac: number): void {
  const beamLen = beamFrac * s * 1.8;
  if (beamLen > 2) {
    const g = ctx.createLinearGradient(cx, cy, cx - beamLen, cy);
    g.addColorStop(0, 'rgba(255, 240, 120, 0.95)');
    g.addColorStop(0.4, 'rgba(255, 120, 0, 0.8)');
    g.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = s * 0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - beamLen, cy);
    ctx.stroke();
    ctx.restore();
  }
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.42);
  g2.addColorStop(0, 'rgba(255, 240, 160, 1.0)');
  g2.addColorStop(0.45, 'rgba(255, 100, 0, 0.7)');
  g2.addColorStop(1, 'rgba(180, 20, 0, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = g2;
  ctx.fill();
  ctx.fillStyle = '#fffbe0';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

function drawMissileExplosion(ctx: Ctx, cx: number, cy: number, s: number, t: number, fullPower: boolean): void {
  const radius = t * s * (fullPower ? 1.6 : 1.1);
  const alpha = 1 - t;
  ctx.save();
  if (fullPower) {
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = '#ffdd44';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = '#d8b4fe';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  if (t < 0.55) {
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = fullPower ? '#ffe080' : '#f3e8ff';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * radius * 0.3, cy + Math.sin(angle) * radius * 0.3);
      ctx.lineTo(cx + Math.cos(angle) * radius * 0.75, cy + Math.sin(angle) * radius * 0.75);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(radius * 0.28, 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- Magic missile projectiles ---
// tileX/tileY = missile head center within each frame cell.
// Projectile flies rightward; trail/beam extends left from that anchor.
// 3 frames per variant: no trail (spawn), half trail, full trail.
// Frame bounds:
//   left  = tileX - s*1.8 (full-power beam) = 140 - 115 = 25px ✓
//   right  = tileX + s*0.42 (full-power glow) = 140 + 27 = 167 < 176 ✓
//   top/bottom = tileY ± s*0.42 = 40 ± 27 → [13, 67] within 80 ✓
gen({
  name: 'magic_missile_projectile',
  category: 'effects',
  frameW: 176, frameH: 80, tileX: 140, tileY: 40,
  rows: [
    {
      label: 'standard',
      frames: [0, 0.5, 1].map(frac => (ctx: Ctx, cx: number, cy: number, s: number) =>
        drawStdMissile(ctx, cx, cy, s, frac)),
    },
    {
      label: 'sub_missile',
      frames: [0, 0.5, 1].map(frac => (ctx: Ctx, cx: number, cy: number, s: number) =>
        drawSubMissile(ctx, cx, cy, s, frac)),
    },
    {
      label: 'full_power',
      frames: [0, 0.5, 1].map(frac => (ctx: Ctx, cx: number, cy: number, s: number) =>
        drawFullPowerMissile(ctx, cx, cy, s, frac)),
    },
  ],
});

// --- Magic missile explosions ---
// tileX/tileY = explosion center within each frame cell.
// 8 frames: t = 0/7 → 7/7 (alpha fades 1→0, radius grows to max).
// Frame bounds at t=1 (invisible): full-power radius = s*1.6 = 102px from center;
//   tileX=112, margin = 112 - 102 = 10px. Fully opaque frames are much smaller.
gen({
  name: 'magic_missile_explosion',
  category: 'effects',
  frameW: 224, frameH: 224, tileX: 112, tileY: 112,
  rows: [
    sweepRow('standard', 8, (ctx, cx, cy, s, t) => drawMissileExplosion(ctx, cx, cy, s, t, false)),
    sweepRow('full_power', 8, (ctx, cx, cy, s, t) => drawMissileExplosion(ctx, cx, cy, s, t, true)),
  ],
});

// --- Protective Shell effects ---
// All generated at tileScale=32 (native game scale). tileX=tileY=frameW/2 centers the anchor.
// The anchor is the shell center (player tile center), NOT a tile corner.
const SHELL_S = 32;

// Main shell — standard (blue, L1-14) and full-power (orange, L15)
// radius = 5 tiles, frame = 400×400, anchor at center (200,200)
gen({
  name: 'protective_shell', category: 'effects',
  frameW: 400, frameH: 400, tileX: 200, tileY: 200,
  tileScale: SHELL_S,
  rows: [
    sweepRow('active',            8, (ctx, cx, cy, _s, t) => drawProtectiveShellActive(ctx, cx, cy, SHELL_S, 'standard',   t)),
    sweepRow('full_power',        8, (ctx, cx, cy, _s, t) => drawProtectiveShellActive(ctx, cx, cy, SHELL_S, 'full_power',  t)),
    sweepRow('appear',            8, (ctx, cx, cy, _s, t) => drawProtectiveShellAppear(ctx, cx, cy, SHELL_S, 'standard',   t)),
    sweepRow('appear_full_power', 8, (ctx, cx, cy, _s, t) => drawProtectiveShellAppear(ctx, cx, cy, SHELL_S, 'full_power',  t)),
    sweepRow('expire',            8, (ctx, cx, cy, _s, t) => drawProtectiveShellExpire(ctx, cx, cy, SHELL_S, t)),
  ],
});

// Cat mini-shell — purple, 2-tile radius, frame = 192×192, anchor at center (96,96)
gen({
  name: 'protective_shell_mini', category: 'effects',
  frameW: 192, frameH: 192, tileX: 96, tileY: 96,
  tileScale: SHELL_S,
  rows: [
    sweepRow('active', 8, (ctx, cx, cy, _s, t) => drawProtectiveShellMini(ctx, cx, cy, SHELL_S, t)),
  ],
});

// Shockwave — L15 expiry orange ring, expands from 2.5-tile to 7-tile radius
// frame = 480×480, anchor at center (240,240)
gen({
  name: 'protective_shell_shockwave', category: 'effects',
  frameW: 480, frameH: 480, tileX: 240, tileY: 240,
  tileScale: SHELL_S,
  rows: [
    sweepRow('expand', 8, (ctx, cx, cy, _s, t) => drawProtectiveShellShockwave(ctx, cx, cy, SHELL_S, t)),
  ],
});

// ---------------------------------------------------------------------------
// Gore — blood particles and puddles
// Generated at game native scale (tileScale=32) so 1 sprite pixel = 1 game pixel.
// Anchor is the visual centroid of each piece.
// ---------------------------------------------------------------------------

const GORE_S = 32; // game tile scale

// --- Blood particle drops ---
// Row 0 `drop`  — round drops, frame 0 (smallest, r≈2px) → frame 5 (largest, r≈7px).
// Row 1 `tear`  — teardrop drops, tail pointing upward; same size progression.
// frameW=24, frameH=24; anchor at centre (12,12).
gen({
  name: 'blood_particle',
  category: 'effects',
  frameW: 24, frameH: 24, tileX: 12, tileY: 12,
  tileScale: GORE_S,
  rows: [
    {
      label: 'drop',
      frames: [0, 1, 2, 3, 4, 5].map(i =>
        (ctx: Ctx, sx: number, sy: number, _s: number) =>
          drawBloodDrop(ctx, sx, sy, GORE_S, i / 5, 0)),
    },
    {
      label: 'tear',
      frames: [0, 1, 2, 3, 4, 5].map(i =>
        (ctx: Ctx, sx: number, sy: number, _s: number) =>
          drawBloodDrop(ctx, sx, sy, GORE_S, i / 5, 0.4 + (i / 5) * 0.45)),
    },
  ],
});

// --- Blood puddles ---
// Six shape variants (0=small oval → 5=large pool with many drips).
// frameW=72, frameH=48; anchor at centre (36,24).
// Largest puddle (variant 5): rx≈20, ry≈13 + spoke tips, fits within 36/24 px margin.
gen({
  name: 'blood_puddle',
  category: 'effects',
  frameW: 72, frameH: 48, tileX: 36, tileY: 24,
  tileScale: GORE_S,
  rows: [
    {
      label: 'puddle',
      frames: [0, 1, 2, 3, 4, 5].map(v =>
        (ctx: Ctx, sx: number, sy: number, _s: number) =>
          drawBloodPuddle(ctx, sx, sy, GORE_S, v)),
    },
  ],
});

// ===========================================================================
// ENVIRONMENT — walls, roofs, decorations
// ===========================================================================

console.log('\n=== Environment ===');

// Wall sheets share these dimensions:
// frameH=192, tileY=128 → 128 px above tile origin for gable triangle
const WALL_W = 64;
const WALL_H = 192;
const WALL_TY = 128;

// --- Cottage (half-timber plaster, thatch gable) ---
gen({
  name: 'wall_cottage', category: 'environment',
  frameW: WALL_W, frameH: WALL_H, tileX: 0, tileY: WALL_TY,
  rows: [
    staticRow('facade_window', (ctx, sx, sy, s) => drawCottageWallFacade(ctx, sx, sy, s, true)),
    staticRow('facade_plain',  (ctx, sx, sy, s) => drawCottageWallFacade(ctx, sx, sy, s, false)),
    staticRow('back_gable',    (ctx, sx, sy, s) => drawBackGableWall(ctx, sx, sy, s, 'thatch')),
  ],
});

// --- Tower (dressed stone, slate gable) ---
gen({
  name: 'wall_tower', category: 'environment',
  frameW: WALL_W, frameH: WALL_H, tileX: 0, tileY: WALL_TY,
  rows: [
    staticRow('facade_window', (ctx, sx, sy, s) => drawTowerWallFacade(ctx, sx, sy, s, true)),
    staticRow('facade_plain',  (ctx, sx, sy, s) => drawTowerWallFacade(ctx, sx, sy, s, false)),
    staticRow('back_gable',    (ctx, sx, sy, s) => drawBackGableWall(ctx, sx, sy, s, 'slate')),
  ],
});

// --- Merchant (painted plaster, terracotta gable) ---
gen({
  name: 'wall_merchant', category: 'environment',
  frameW: WALL_W, frameH: WALL_H, tileX: 0, tileY: WALL_TY,
  rows: [
    staticRow('facade_window', (ctx, sx, sy, s) => drawMerchantWallFacade(ctx, sx, sy, s, true)),
    staticRow('facade_plain',  (ctx, sx, sy, s) => drawMerchantWallFacade(ctx, sx, sy, s, false)),
    staticRow('back_gable',    (ctx, sx, sy, s) => drawBackGableWall(ctx, sx, sy, s, 'red')),
  ],
});

// --- Generic stone (rough-hewn, mossy gable) ---
gen({
  name: 'wall_stone', category: 'environment',
  frameW: WALL_W, frameH: WALL_H, tileX: 0, tileY: WALL_TY,
  rows: [
    staticRow('facade_window', (ctx, sx, sy, s) => drawStoneWallFacade(ctx, sx, sy, s, true)),
    staticRow('facade_plain',  (ctx, sx, sy, s) => drawStoneWallFacade(ctx, sx, sy, s, false)),
    staticRow('back_gable',    (ctx, sx, sy, s) => drawBackGableWall(ctx, sx, sy, s, 'green')),
  ],
});

// --- Circus walls (3 colour variants, 2 rows each) ---
for (const tint of ['red', 'blue', 'purple'] as const) {
  const gt: 'circus_red' | 'circus_blue' | 'circus_purple' = `circus_${tint}`;
  gen({
    name: `wall_circus_${tint}`, category: 'environment',
    frameW: WALL_W, frameH: WALL_H, tileX: 0, tileY: WALL_TY,
    rows: [
      staticRow('facade',    (ctx, sx, sy, s) => drawCircusWallFacade(ctx, sx, sy, s, tint)),
      staticRow('back_gable',(ctx, sx, sy, s) => drawBackGableWall(ctx, sx, sy, s, gt)),
    ],
  });
}

// --- Metal wall (arena exterior, no gable) ---
gen({
  name: 'wall_metal', category: 'environment',
  frameW: 64, frameH: 64, tileX: 0, tileY: 0,
  rows: [
    staticRow('default', (ctx, sx, sy, s) => drawMetalWall(ctx, sx, sy, s)),
  ],
});

// ---------------------------------------------------------------------------
// Roof tiles — 3 rows each: eaves / middle+ridge / back slope
// ---------------------------------------------------------------------------

const ROOF_SPEC = { frameW: 64, frameH: 64, tileX: 0, tileY: 0 };

function roofShapeRows(style: RoofStyle) {
  return [
    staticRow('hip_corner_fl', (ctx, sx, sy, s) => drawRoofHipCornerFL(ctx, sx, sy, s, style)),
    staticRow('hip_corner_fr', (ctx, sx, sy, s) => drawRoofHipCornerFR(ctx, sx, sy, s, style)),
    staticRow('hip_corner_bl', (ctx, sx, sy, s) => drawRoofHipCornerBL(ctx, sx, sy, s, style)),
    staticRow('hip_corner_br', (ctx, sx, sy, s) => drawRoofHipCornerBR(ctx, sx, sy, s, style)),
    staticRow('hip_side_l',    (ctx, sx, sy, s) => drawRoofHipSideL(ctx, sx, sy, s, style)),
    staticRow('hip_side_r',    (ctx, sx, sy, s) => drawRoofHipSideR(ctx, sx, sy, s, style)),
    staticRow('gable_end_l',   (ctx, sx, sy, s) => drawRoofGableEndL(ctx, sx, sy, s, style)),
    staticRow('gable_end_r',   (ctx, sx, sy, s) => drawRoofGableEndR(ctx, sx, sy, s, style)),
    staticRow('valley_fl',     (ctx, sx, sy, s) => drawRoofValleyFL(ctx, sx, sy, s, style)),
    staticRow('valley_fr',     (ctx, sx, sy, s) => drawRoofValleyFR(ctx, sx, sy, s, style)),
    staticRow('flat',          (ctx, sx, sy, s) => drawRoofFlat(ctx, sx, sy, s, style)),
    staticRow('ridge_end_l',   (ctx, sx, sy, s) => drawRoofRidgeEndL(ctx, sx, sy, s, style)),
    staticRow('ridge_end_r',   (ctx, sx, sy, s) => drawRoofRidgeEndR(ctx, sx, sy, s, style)),
  ];
}

gen({
  name: 'roof_thatch', category: 'environment', ...ROOF_SPEC,
  rows: [
    staticRow('eaves',  (ctx, sx, sy, s) => drawThatchRoofEaves(ctx, sx, sy, s)),
    staticRow('middle', (ctx, sx, sy, s) => drawThatchRoofMiddle(ctx, sx, sy, s)),
    staticRow('back',   (ctx, sx, sy, s) => drawThatchRoofBack(ctx, sx, sy, s)),
    ...roofShapeRows('thatch'),
  ],
});

gen({
  name: 'roof_slate', category: 'environment', ...ROOF_SPEC,
  rows: [
    staticRow('eaves',  (ctx, sx, sy, s) => drawSlateRoofEaves(ctx, sx, sy, s)),
    staticRow('middle', (ctx, sx, sy, s) => drawSlateRoofMiddle(ctx, sx, sy, s)),
    staticRow('back',   (ctx, sx, sy, s) => drawSlateRoofBack(ctx, sx, sy, s)),
    ...roofShapeRows('slate'),
  ],
});

gen({
  name: 'roof_red', category: 'environment', ...ROOF_SPEC,
  rows: [
    staticRow('eaves',  (ctx, sx, sy, s) => drawRedRoofEaves(ctx, sx, sy, s)),
    staticRow('middle', (ctx, sx, sy, s) => drawRedRoofMiddle(ctx, sx, sy, s)),
    staticRow('back',   (ctx, sx, sy, s) => drawRedRoofBack(ctx, sx, sy, s)),
    ...roofShapeRows('red'),
  ],
});

gen({
  name: 'roof_green', category: 'environment', ...ROOF_SPEC,
  rows: [
    staticRow('eaves',  (ctx, sx, sy, s) => drawGreenRoofEaves(ctx, sx, sy, s)),
    staticRow('middle', (ctx, sx, sy, s) => drawGreenRoofMiddle(ctx, sx, sy, s)),
    staticRow('back',   (ctx, sx, sy, s) => drawGreenRoofBack(ctx, sx, sy, s)),
    ...roofShapeRows('green'),
  ],
});

// Old circus rectangular roof rows — kept for wall_circus back_gable compatibility
for (const tint of ['red', 'blue', 'purple'] as const) {
  gen({
    name: `roof_circus_${tint}`, category: 'environment', ...ROOF_SPEC,
    rows: [
      staticRow('eaves',  (ctx, sx, sy, s) => drawCircusRoofEaves(ctx, sx, sy, s, tint)),
      staticRow('middle', (ctx, sx, sy, s) => drawCircusRoofMiddle(ctx, sx, sy, s, tint)),
      staticRow('back',   (ctx, sx, sy, s) => drawCircusRoofBack(ctx, sx, sy, s, tint)),
    ],
  });
}

// Circus tent tiles — conical big-top, designed to tile into a circular tent footprint
for (const tint of ['red', 'blue', 'purple'] as const) {
  gen({
    name: `circus_tent_${tint}`, category: 'environment', ...ROOF_SPEC,
    rows: [
      staticRow('peak',       (ctx, sx, sy, s) => drawCircusTentPeak(ctx, sx, sy, s, tint)),
      staticRow('slope_s',    (ctx, sx, sy, s) => drawCircusTentSlope(ctx, sx, sy, s, tint, 's')),
      staticRow('slope_n',    (ctx, sx, sy, s) => drawCircusTentSlope(ctx, sx, sy, s, tint, 'n')),
      staticRow('slope_e',    (ctx, sx, sy, s) => drawCircusTentSlope(ctx, sx, sy, s, tint, 'e')),
      staticRow('slope_w',    (ctx, sx, sy, s) => drawCircusTentSlope(ctx, sx, sy, s, tint, 'w')),
      staticRow('slope_c',    (ctx, sx, sy, s) => drawCircusTentSlope(ctx, sx, sy, s, tint, 'c')),
      staticRow('corner_se',  (ctx, sx, sy, s) => drawCircusTentCorner(ctx, sx, sy, s, tint, 'se')),
      staticRow('corner_sw',  (ctx, sx, sy, s) => drawCircusTentCorner(ctx, sx, sy, s, tint, 'sw')),
      staticRow('corner_ne',  (ctx, sx, sy, s) => drawCircusTentCorner(ctx, sx, sy, s, tint, 'ne')),
      staticRow('corner_nw',  (ctx, sx, sy, s) => drawCircusTentCorner(ctx, sx, sy, s, tint, 'nw')),
      staticRow('scallop_s',  (ctx, sx, sy, s) => drawCircusTentScallop(ctx, sx, sy, s, tint, 's')),
      staticRow('scallop_n',  (ctx, sx, sy, s) => drawCircusTentScallop(ctx, sx, sy, s, tint, 'n')),
      staticRow('scallop_e',  (ctx, sx, sy, s) => drawCircusTentScallop(ctx, sx, sy, s, tint, 'e')),
      staticRow('scallop_w',  (ctx, sx, sy, s) => drawCircusTentScallop(ctx, sx, sy, s, tint, 'w')),
    ],
  });
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

// Tree — canopy extends above tile (tileY=96 → 96 px of room above tile origin)
gen({
  name: 'tree', category: 'environment',
  frameW: 64, frameH: 160, tileX: 0, tileY: 96,
  rows: [
    staticRow('idle', (ctx, sx, sy, s) => drawTree(ctx, sx, sy, s)),
  ],
});

// Torch — animated flame (6 frames), sconce extends above tile
gen({
  name: 'torch', category: 'environment',
  frameW: 64, frameH: 128, tileX: 0, tileY: 64,
  rows: [
    sweepRow('flicker', 6, (ctx, sx, sy, _s, t) => drawTorch(ctx, sx, sy, S, t)),
  ],
});

// Well — crossbeam extends above tile
gen({
  name: 'well', category: 'environment',
  frameW: 64, frameH: 96, tileX: 0, tileY: 32,
  rows: [
    staticRow('idle', (ctx, sx, sy, s) => drawWell(ctx, sx, sy, s)),
  ],
});

// Fountain — animated water ripples (8 frames), jet extends above tile
gen({
  name: 'fountain', category: 'environment',
  frameW: 64, frameH: 96, tileX: 0, tileY: 32,
  rows: [
    sweepRow('ripple', 8, (ctx, sx, sy, _s, t) => drawFountain(ctx, sx, sy, S, t)),
  ],
});

// Grassy weed — 2 variants as separate rows
gen({
  name: 'grassy_weed', category: 'environment',
  frameW: 64, frameH: 64, tileX: 0, tileY: 0,
  rows: [
    staticRow('variant_a', (ctx, sx, sy, s) => drawGrassyWeed(ctx, sx, sy, s, 0)),
    staticRow('variant_b', (ctx, sx, sy, s) => drawGrassyWeed(ctx, sx, sy, s, 1)),
  ],
});

// Dirt patch — 2 variants as separate rows
gen({
  name: 'dirt_patch', category: 'environment',
  frameW: 64, frameH: 64, tileX: 0, tileY: 0,
  rows: [
    staticRow('variant_a', (ctx, sx, sy, s) => drawDirtPatch(ctx, sx, sy, s, 0)),
    staticRow('variant_b', (ctx, sx, sy, s) => drawDirtPatch(ctx, sx, sy, s, 1)),
  ],
});

// ===========================================================================
// Write manifest
// ===========================================================================

const manifestPath = path.join(OUT_DIR, 'manifest.json');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const totalKb = Object.values(manifest).reduce((sum, m) => {
  const fullPath = path.join(OUT_DIR, m.path);
  return sum + (fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0);
}, 0);

console.log(`\n✓ Wrote ${Object.keys(manifest).length} sprite sheets`);
console.log(`  Total size: ${Math.round(totalKb / 1024)} KB`);
console.log(`  Manifest:   ${manifestPath}`);
