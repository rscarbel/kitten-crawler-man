#!/usr/bin/env tsx
/**
 * The Mongo explainer's review harness.
 *
 * The explainer's pages are animations, and whether one reads — is that a
 * raptor running at a goblin, does the bar visibly drain past the line, does
 * the button say Resting before it says Summon — is a question only a picture
 * answers. This paints every page at a row of moments across its loop, at a
 * desktop fit and at both phone orientations, through the same explainers
 * host surface the game mounts, on a real `UiRoot`, into one contact sheet.
 *
 *   npm run render:mongo-explainer
 *   npx tsx scripts/render-mongo-explainer.ts --stage=adult --out=explainer.png
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { UiRoot } from '../src/ui/core/UiRoot.js';
import { NO_INSETS } from '../src/ui/core/viewport.js';
import type { Density } from '../src/ui/theme/tokens.js';
import { CraftExplainers } from '../src/ui/screens/dialogs/CraftExplainers.js';
import { mongoExplainerEntry } from '../src/ui/screens/dialogs/mongoExplainer.js';
import { getMongoStats, MONGO_MAX_LEVEL } from '../src/abilities/mongo.js';
import type { MongoStage } from '../src/sprites/mongoSprite.js';

interface Fit {
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  readonly density: Density;
}

const FITS: readonly Fit[] = [
  { caption: 'desktop 1280×720', width: 1280, height: 720, density: 'pointer' },
  { caption: 'phone portrait 390×844', width: 390, height: 844, density: 'touch' },
  { caption: 'phone landscape 844×390', width: 844, height: 390, density: 'touch' },
];

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
/** Long enough for the overlay's open and page-turn tweens to settle before a moment is timed. */
const SETTLE_MS = 1000;
const SURFACE_ID = 'craft-explainers';

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

/** The lowest pet level at which Mongo is drawn as `stage`. */
function levelForStage(stage: MongoStage): number {
  for (let level = 1; level <= MONGO_MAX_LEVEL; level++) {
    if (getMongoStats(level).stage === stage) return level;
  }
  throw new Error(`no pet level draws Mongo as ${stage}`);
}

installCanvasGlobals();
const stage = parseStage();
const petLevel = levelForStage(stage);
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

/**
 * Draws `page` of the explainer `momentFrames` into its loop: opened, turned
 * to the page, settled, then drawn once at the moment.
 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  fit: Fit,
  page: number,
  momentFrames: number,
): void {
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: fit.width,
      cssHeight: fit.height,
      density: fit.density,
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    now: () => clock,
    warn: () => undefined,
  });
  const host = new CraftExplainers();
  host.register(
    'mongo',
    mongoExplainerEntry(() => petLevel),
  );
  root.mount(host.surface({ id: SURFACE_ID }));
  host.open('mongo');
  // The first frame picks the density the pages are worded for.
  root.frame(ctx);
  for (let i = 0; i < page; i++) host.advance();
  clock = SETTLE_MS;
  root.frame(ctx);
  const pageShownAt = page === 0 ? 0 : SETTLE_MS;
  clock = Math.max(SETTLE_MS, pageShownAt + (momentFrames / FRAMES_PER_SECOND) * MS_PER_SECOND);
  ctx.clearRect(0, 0, fit.width, fit.height);
  root.frame(ctx);
}

let y = GAP;
for (const fit of fits) {
  for (let page = 0; page < PAGE_COUNT; page++) {
    let x = GAP;
    for (const moment of moments) {
      const cell = createCanvas(fit.width, fit.height);
      const ctx = asGameContext(cell.getContext('2d'));
      drawCell(ctx, fit, page, moment);
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
