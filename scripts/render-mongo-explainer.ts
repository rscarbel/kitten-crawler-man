#!/usr/bin/env tsx
/**
 * The Mongo explainer's review harness.
 *
 * The explainer's pages are animations, and whether one reads — is that a
 * raptor running at a goblin, does the bar visibly drain past the line, does
 * the button say Resting before it says Summon — is a question only a picture
 * answers. This paints every page at a row of moments across its loop, at a
 * desktop fit and at both phone orientations, through the same overlay the game
 * opens, into one contact sheet.
 *
 *   npm run render:mongo-explainer
 *   npx tsx scripts/render-mongo-explainer.ts --stage=adult --out=explainer.png
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { HowToPlayOverlay } from '../src/ui/HowToPlayOverlay.js';
import { buildMongoExplainerPages, MONGO_EXPLAINER_CONFIG } from '../src/ui/MongoExplainer.js';
import type { MongoStage } from '../src/sprites/mongoSprite.js';

interface Fit {
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  readonly isMobile: boolean;
}

const FITS: readonly Fit[] = [
  { caption: 'desktop 1280×720', width: 1280, height: 720, isMobile: false },
  { caption: 'phone portrait 390×844', width: 390, height: 844, isMobile: true },
  { caption: 'phone landscape 844×390', width: 844, height: 390, isMobile: true },
];

/** Moments across each page's loop, in 60 Hz frames. */
const MOMENTS: readonly number[] = [20, 100, 170, 250, 320, 420];

const STAGES: readonly MongoStage[] = ['juvenile', 'adolescent', 'adult'];
const PAGE_COUNT = 3;
/** Each cell is a whole viewport drawn at a fraction of its size. */
const DEFAULT_CELL_SCALE = 0.5;
const GAP = 12;
const LABEL_H = 22;
const BACKDROP = '#3b3b40';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseStage(): MongoStage {
  const raw = parseFlag('stage', 'juvenile');
  const found = STAGES.find((stage) => stage === raw);
  if (found === undefined) throw new Error(`--stage=${raw} is not one of ${STAGES.join(', ')}`);
  return found;
}

function parseFit(): readonly Fit[] {
  const raw = parseFlag('fit', 'all');
  if (raw === 'all') return FITS;
  const index = Number(raw);
  const fit = FITS[index];
  if (fit === undefined) throw new Error(`--fit=${raw} is not 'all' or 0..${FITS.length - 1}`);
  return [fit];
}

installCanvasGlobals();
const stage = parseStage();
const fits = parseFit();
const CELL_SCALE = Number(parseFlag('scale', String(DEFAULT_CELL_SCALE)));
const moments =
  parseFlag('moments', '') === '' ? MOMENTS : parseFlag('moments', '').split(',').map(Number);

const cellW = (fit: Fit): number => Math.round(fit.width * CELL_SCALE);
const cellH = (fit: Fit): number => Math.round(fit.height * CELL_SCALE);
const rowWidth = (fit: Fit): number => moments.length * (cellW(fit) + GAP) + GAP;
const rowHeight = (fit: Fit): number => cellH(fit) + LABEL_H + GAP;

const sheetW = Math.max(...fits.map(rowWidth));
const sheetH = fits.reduce((sum, fit) => sum + rowHeight(fit) * PAGE_COUNT, 0) + GAP;
const sheet = createCanvas(sheetW, sheetH);
const sheetCtx = sheet.getContext('2d');
sheetCtx.fillStyle = BACKDROP;
sheetCtx.fillRect(0, 0, sheetW, sheetH);

let y = GAP;
for (const fit of fits) {
  setViewportSize(fit.width, fit.height);
  for (let page = 0; page < PAGE_COUNT; page++) {
    let x = GAP;
    for (const moment of moments) {
      const cell = createCanvas(fit.width, fit.height);
      const ctx = asGameContext(cell.getContext('2d'));
      const overlay = new HowToPlayOverlay(null, MONGO_EXPLAINER_CONFIG);
      overlay.open(buildMongoExplainerPages(stage, fit.isMobile));
      for (let i = 0; i < page; i++) overlay.advance();
      overlay.renderFrame(ctx, moment);
      sheetCtx.fillStyle = LABEL_COLOR;
      sheetCtx.font = LABEL_FONT;
      sheetCtx.fillText(`${fit.caption} · page ${page + 1} · frame ${moment}`, x, y + LABEL_H - 6);
      sheetCtx.drawImage(cell, x, y + LABEL_H, cellW(fit), cellH(fit));
      x += cellW(fit) + GAP;
    }
    y += rowHeight(fit);
  }
}

const out = parseFlag('out', `${PREVIEW_DIR}/mongo-explainer-${stage}.png`);
console.log(`wrote ${writePreviewPng(out, sheet.toBuffer('image/png'))}`);
