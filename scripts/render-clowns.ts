/**
 * The clown family's review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. Each contact sheet is
 * painted from the figure the way the runtime cache bakes it — supersampled and
 * downsampled — so what a reviewer looks at is what the game blits, and the art
 * gates run as part of the render so one command answers both "does it still
 * hold together" and "what does it look like".
 *
 * The gates run **first**, before any contact sheet is allocated: a contact
 * sheet is a tens-of-megapixel allocation, and measuring art on the far side of
 * one has produced phantom failures before.
 *
 *   npm run render:clowns
 *   npx tsx scripts/render-clowns.ts --clown=evil --scale=4
 */

import { createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { clownGateFailures } from './gates-clowns.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  STILT_CLOWN_FIGURE,
  TERROR_CLOWN_FIGURE,
} from '../src/sprites/art/clownFigure.js';
import {
  CLOWN_GAS_FIGURE,
  CLOWN_SHATTER_FIGURE,
  CLOWN_VIAL_FIGURE,
} from '../src/sprites/art/clownGasFigure.js';

const SUBJECTS: Readonly<Record<string, FigureDef>> = {
  fat: FAT_CLOWN_FIGURE,
  stilt: STILT_CLOWN_FIGURE,
  terror: TERROR_CLOWN_FIGURE,
  evil: EVIL_CLOWN_FIGURE,
  vial: CLOWN_VIAL_FIGURE,
  shatter: CLOWN_SHATTER_FIGURE,
  gas: CLOWN_GAS_FIGURE,
};

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseScale(): number {
  const raw = parseFlag('scale', String(DEFAULT_SCALE));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

function drawContactSheet(def: FigureDef, scale: number): Buffer {
  const states = [...def.states.keys()];
  const sheet = bakeFigureSheet(def, states).canvas;
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const maxCols = Math.max(...states.map((state) => frameCountOf(def, state)));
  const inGameScale = IN_GAME_TILE / def.tileScale;
  const inGameW = def.frameWidth * inGameScale;
  const inGameH = def.frameHeight * inGameScale;

  const width = PADDING + maxCols * (cellW + PADDING);
  const height =
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  states.forEach((state, row) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        frame * def.frameWidth,
        row * def.frameHeight,
        def.frameWidth,
        def.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      // The tile box shows where the mob's collision tile sits inside the cell,
      // so overhang and foot placement can be judged against it.
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + def.tileX * scale,
        y + def.tileY * scale,
        def.tileScale * scale,
        def.tileScale * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  states.forEach((state, row) => {
    const x = PADDING + row * (inGameW + PADDING);
    ctx.drawImage(
      sheet,
      0,
      row * def.frameHeight,
      def.frameWidth,
      def.frameHeight,
      x,
      y,
      inGameW,
      inGameH,
    );
  });

  return canvas.toBuffer('image/png');
}

function subjectsRequested(): ReadonlyArray<readonly [string, FigureDef]> {
  const requested = parseFlag('clown', 'all');
  if (requested === 'all') return Object.entries(SUBJECTS);
  const def = SUBJECTS[requested];
  if (def === undefined) {
    throw new Error(
      `--clown=${requested} is not one of ${Object.keys(SUBJECTS).join(', ')} (or "all")`,
    );
  }
  return [[requested, def]];
}

function main(): void {
  // Gates before the contact sheets, never after: measuring art on the far side
  // of a tens-of-megapixel allocation has produced phantom failures before.
  console.log('Clown art gates:');
  reportFigureGates('clowns', clownGateFailures());

  const scale = parseScale();
  const subjects = subjectsRequested();
  for (const [name, def] of subjects) {
    // `--out` names one file, so it only applies when one subject was asked
    // for; otherwise every sheet would be written over the same path.
    const defaultOut = `${PREVIEW_DIR}/${name}-clown-review.png`;
    const outPath = subjects.length === 1 ? parseFlag('out', defaultOut) : defaultOut;
    const written = writePreviewPng(outPath, drawContactSheet(def, scale));
    console.log(`Wrote ${written} (${def.id}, scale ${scale}×)`);
  }
}

main();
