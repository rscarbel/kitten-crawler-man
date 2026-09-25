#!/usr/bin/env tsx
/**
 * Bakes Briar Hollow's prop sheets for review, at a chosen art seed.
 *
 *   npm run gen:village [-- <artSeedIndex>] [-- --write-manifest]
 *
 * The shipped game paints these sheets for itself when it enters the floor,
 * from the plans in `src/sprites/sheets/villageSheets.ts`. This writes the
 * sheets to `preview/props/village/` plus a labelled contact sheet at game
 * scale beside them, and fails if any frame is clipped by its own cell.
 *
 * `--write-manifest` rewrites `src/images/environment/village/manifest.json`
 * from the plans — run it after changing a sheet's props or a prop's variant
 * count, then bake again (the manifest is what the plans are checked against).
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily, bakePropSheet, PROP_PREVIEW_ROOT } from './propSheetBake.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { VILLAGE_SALT, floorArtSubSeed, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';
import { VILLAGE_GROUNDED_EDGES, villageSheetPlans } from '../src/sprites/sheets/villageSheets.js';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';

const MANIFEST_PATH = resolve('src/images/environment/village/manifest.json');
const JSON_INDENT = 2;

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const writeManifest = process.argv.includes('--write-manifest');
const SEED_RADIX = 10;
const seedIndex = positional.length > 0 ? Number.parseInt(positional[0], SEED_RADIX) : 0;
if (!Number.isFinite(seedIndex)) throw new Error(`art seed index must be a number`);
setFloorArtSeed(FLOOR_ART_SEEDS[Math.abs(seedIndex) % FLOOR_ART_SEEDS.length]);

function manifestEntry(plan: PropSheetPlan): object {
  return {
    frameWidth: plan.frameWidth,
    frameHeight: plan.frameHeight,
    tileX: plan.tileX,
    tileY: plan.tileY,
    tileScale: plan.tileScale,
    states: Object.fromEntries(
      plan.rows.map((row, index) => [row.state, { row: index, frameCount: row.frames.length }]),
    ),
  };
}

const plans = villageSheetPlans(floorArtSubSeed(VILLAGE_SALT));
if (writeManifest) {
  const manifest = Object.fromEntries(plans.map((plan) => [plan.key, manifestEntry(plan)]));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, JSON_INDENT)}\n`);
  console.log(`wrote ${MANIFEST_PATH}`);
  // The manifest is imported statically, so this process still holds the old
  // one; baking against it would report the very mismatches just fixed.
  console.log('manifest rewritten — run again without --write-manifest to bake');
  process.exit(0);
}

await loadGameSpritesInNode();

const problems = bakePropFamily('village', plans, { groundedEdges: VILLAGE_GROUNDED_EDGES });
if (problems.length > 0) {
  console.error(`\n[village] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

// A contact sheet at game scale on the village's own ground tone, one cell
// per variant, because a prop's read at 32 px a tile is the only one that
// ships.
const GAME_TILE_PX = 32;
const CELL_PAD_PX = 10;
const LABEL_PX = 9;
const CONTACT_COLUMNS_PX = 1400;
const CONTACT_BACKGROUND = '#5e5238';
const LABEL_COLOR = '#f4e8c8';

interface ContactCell {
  readonly plan: PropSheetPlan;
  readonly row: number;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
}
const cells: ContactCell[] = [];
for (const plan of plans) {
  const scale = GAME_TILE_PX / plan.tileScale;
  plan.rows.forEach((row, rowIndex) => {
    row.frames.forEach((_frame, frameIndex) => {
      cells.push({
        plan,
        row: rowIndex,
        frame: frameIndex,
        width: plan.frameWidth * scale,
        height: plan.frameHeight * scale,
      });
    });
  });
}
const layout: Array<{ cell: ContactCell; x: number; y: number }> = [];
let cursorX = CELL_PAD_PX;
let cursorY = CELL_PAD_PX;
let rowHeight = 0;
for (const cell of cells) {
  const cellW = Math.max(cell.width, GAME_TILE_PX * 2) + CELL_PAD_PX;
  if (cursorX + cellW > CONTACT_COLUMNS_PX) {
    cursorX = CELL_PAD_PX;
    cursorY += rowHeight + LABEL_PX + CELL_PAD_PX;
    rowHeight = 0;
  }
  layout.push({ cell, x: cursorX, y: cursorY });
  cursorX += cellW;
  rowHeight = Math.max(rowHeight, cell.height);
}
const contact = createCanvas(CONTACT_COLUMNS_PX, cursorY + rowHeight + LABEL_PX + CELL_PAD_PX * 2);
const contactCtx = contact.getContext('2d');
contactCtx.fillStyle = CONTACT_BACKGROUND;
contactCtx.fillRect(0, 0, contact.width, contact.height);
const bakedByKey = new Map(plans.map((plan) => [plan.key, bakePropSheet(plan)]));
for (const { cell, x, y } of layout) {
  const baked = bakedByKey.get(cell.plan.key);
  if (baked === undefined) continue;
  contactCtx.drawImage(
    baked.canvas,
    cell.frame * cell.plan.frameWidth,
    cell.row * cell.plan.frameHeight,
    cell.plan.frameWidth,
    cell.plan.frameHeight,
    x,
    y,
    cell.width,
    cell.height,
  );
  contactCtx.fillStyle = LABEL_COLOR;
  contactCtx.font = `${LABEL_PX}px sans-serif`;
  contactCtx.fillText(
    `${cell.plan.rows[cell.row].state}${cell.plan.rows[cell.row].frames.length > 1 ? `#${cell.frame}` : ''}`,
    x,
    y + cell.height + LABEL_PX,
  );
}
const contactPath = resolve(PROP_PREVIEW_ROOT, 'village', 'village-contact.png');
writeFileSync(contactPath, contact.toBuffer('image/png'));
console.log(`wrote ${contactPath}`);
