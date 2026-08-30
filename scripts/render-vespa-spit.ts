#!/usr/bin/env tsx
/**
 * The Brindled Vespa acid-spit review harness.
 *
 * The art is transparent acid glow, so looking at a cell on white says nothing
 * about how it reads on a dungeon floor. This lays every frame over two
 * backdrops — a dark floor and a pale one — and puts the same frames at the
 * in-game tile size underneath, which is the exit criterion.
 *
 * The art gates run first, before the contact sheet is allocated.
 *
 *   npm run render:vespa-spit
 *   npx tsx scripts/render-vespa-spit.ts --only=glob --scale=6
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { vespaSpitGateFailures } from './gates-vespa-spit.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  VESPA_ACID_SPIT_IMPACT_FIGURE,
  VESPA_ACID_SPIT_PROJECTILE_FIGURE,
  VESPA_SPIT_FIGURES,
} from '../src/sprites/art/vespaSpitFigure.js';
import { TILE_SCALE } from '../src/sprites/art/vespaSpitArt.js';

// A painter composing on a scratch surface reaches `document.createElement`.
installCanvasGlobals();

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_RATIO = IN_GAME_TILE / TILE_SCALE;

const DEFAULT_SCALE = 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
/** Two backdrops per row: a glow on near-black flatters itself. */
const BACKDROP_DARK = '#23232a';
const BACKDROP_LIGHT = '#6b6357';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const ANCHOR_MARK = 'rgba(120,220,255,0.5)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

/** `--only=` selectors, short enough to type. */
const ALIASES = new Map<string, FigureDef>([
  ['glob', VESPA_ACID_SPIT_PROJECTILE_FIGURE],
  ['splash', VESPA_ACID_SPIT_IMPACT_FIGURE],
]);

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

interface BakedRow {
  readonly def: FigureDef;
  readonly frameCount: number;
  readonly image: Canvas;
}

function bakeRows(only: string): readonly BakedRow[] {
  const defs =
    only === '' ? VESPA_SPIT_FIGURES : [ALIASES.get(only)].filter((def) => def !== undefined);
  if (defs.length === 0) {
    throw new Error(`--only=${only} matches nothing; try ${[...ALIASES.keys()].join('|')}`);
  }
  return defs.map((def) => {
    const state = [...def.states.keys()][0];
    const sheet = bakeFigureSheet(def, [state]);
    return { def, frameCount: sheet.columns, image: sheet.canvas };
  });
}

function render(rows: readonly BakedRow[], outPath: string, scale: number): void {
  const blockHeightOf = (row: BakedRow): number =>
    LABEL_HEIGHT + row.def.frameHeight * scale * 2 + PADDING;
  const rowWidthOf = (row: BakedRow): number =>
    PADDING + row.frameCount * (row.def.frameWidth * scale + PADDING);

  const width = Math.max(...rows.map(rowWidthOf));
  const stripHeight = LABEL_HEIGHT + Math.max(...rows.map((row) => row.def.frameHeight));
  const height =
    PADDING +
    rows.reduce((total, row) => total + blockHeightOf(row) + LABEL_HEIGHT + PADDING, 0) +
    stripHeight +
    PADDING;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP_DARK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const row of rows) {
    const { def } = row;
    const cellW = def.frameWidth * scale;
    const cellH = def.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${def.id} — ${row.frameCount} frames of ${def.frameWidth}×${def.frameHeight}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (const backdrop of [BACKDROP_DARK, BACKDROP_LIGHT]) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const x = PADDING + frame * (cellW + PADDING);
        ctx.fillStyle = backdrop;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.drawImage(
          row.image,
          frame * def.frameWidth,
          0,
          def.frameWidth,
          def.frameHeight,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.strokeStyle = GRID_LINE;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.strokeStyle = ANCHOR_MARK;
        ctx.beginPath();
        ctx.moveTo(x + def.tileX * scale - PADDING, y + def.tileY * scale);
        ctx.lineTo(x + def.tileX * scale + PADDING, y + def.tileY * scale);
        ctx.moveTo(x + def.tileX * scale, y + def.tileY * scale - PADDING);
        ctx.lineTo(x + def.tileX * scale, y + def.tileY * scale + PADDING);
        ctx.stroke();
      }
      y += cellH + PADDING;
    }
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `in-game size (${IN_GAME_TILE}px tile) — judge everything here`,
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  let x = PADDING;
  for (const row of rows) {
    const { def } = row;
    const w = def.frameWidth * IN_GAME_RATIO;
    const h = def.frameHeight * IN_GAME_RATIO;
    for (let frame = 0; frame < row.frameCount; frame++) {
      ctx.drawImage(
        row.image,
        frame * def.frameWidth,
        0,
        def.frameWidth,
        def.frameHeight,
        x,
        y,
        w,
        h,
      );
      x += w + PADDING / 2;
    }
    x += PADDING * 2;
  }

  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

reportFigureGates('vespa spit', vespaSpitGateFailures());

const only = parseFlag('only', '');
const outPath = parseFlag('out', `${PREVIEW_DIR}/vespa-spit${only === '' ? '' : `-${only}`}.png`);
render(bakeRows(only), outPath, parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE));
