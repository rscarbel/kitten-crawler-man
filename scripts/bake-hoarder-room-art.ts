#!/usr/bin/env tsx
/**
 * Bakes the Hoarder's lair's painted sheets for review.
 *
 *   npx tsx scripts/bake-hoarder-room-art.ts
 *
 * Writes every sheet at the scale it is painted (`preview/props/hoarder/`)
 * and a contact sheet of all of them at the size the game draws them, on the
 * lair's own floor, beside a copy at twice that size
 * (`preview/props/hoarder/contact.png`). It fails if any frame is clipped by
 * its own cell.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { bakePropFamily, bakePropSheet } from './propSheetBake.js';
import { writePreviewPng } from './previewOut.js';
import { hoarderRoomSheetPlans } from '../src/sprites/sheets/bossRooms/hoarderSheets.js';

installCanvasGlobals();

const plans = hoarderRoomSheetPlans(0);
const problems = bakePropFamily('hoarder', plans, { groundedEdges: new Set() });
if (problems.length > 0) {
  console.error(`\n[hoarder] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

/** The game draws a 64-pixel painted tile into 32 screen pixels. */
const GAME_SCALE = 0.5;
const ZOOM_SCALE = 1;
const GAP = 12;
const BACKDROP = '#2a2118';
/** A gap before, between and after the two copies of each sheet. */
const GAPS_ACROSS = 3;

const baked = plans.map((plan) => bakePropSheet(plan));
const width =
  Math.max(...baked.map((sheet) => sheet.canvas.width)) * (GAME_SCALE + ZOOM_SCALE) +
  GAP * GAPS_ACROSS;
const height = baked.reduce((total, sheet) => total + sheet.canvas.height * ZOOM_SCALE + GAP, GAP);
const contact = createCanvas(Math.ceil(width), Math.ceil(height));
const ctx = contact.getContext('2d');
ctx.fillStyle = BACKDROP;
ctx.fillRect(0, 0, contact.width, contact.height);
let y = GAP;
for (const sheet of baked) {
  const { canvas } = sheet;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, GAP, y, canvas.width * GAME_SCALE, canvas.height * GAME_SCALE);
  ctx.drawImage(
    canvas,
    GAP * 2 + canvas.width * GAME_SCALE,
    y,
    canvas.width * ZOOM_SCALE,
    canvas.height * ZOOM_SCALE,
  );
  y += canvas.height * ZOOM_SCALE + GAP;
}
console.log(writePreviewPng('preview/props/hoarder/contact.png', contact.toBuffer('image/png')));
