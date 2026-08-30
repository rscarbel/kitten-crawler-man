/**
 * Headless review harness for the Skeleton Lord's effect sheets.
 *
 * The browser harness cannot reliably answer "does this look right" from a
 * still, so the art has to be judgeable offline. This slices each baked sheet
 * into a labelled grid at `--scale=`, and puts a strip of the same frames at the
 * in-game tile size underneath — the strip is the exit criterion, because an
 * effect only has to survive at the size players actually see it.
 *
 *   npm run render:skeleton-effects
 *   npx tsx scripts/render-skeleton-effects.ts --out=skel-fx.png --scale=3
 *   npx tsx scripts/render-skeleton-effects.ts --only=hands --scale=6
 *
 * The art gates run first, before the contact sheet is allocated: measuring art
 * on the far side of a tens-of-megapixel allocation has produced spurious
 * failures on other figures.
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { skeletonEffectGateFailures } from './gates-skeleton-effects.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_EFFECT_FIGURES,
  SKELETON_GRASPING_HANDS_FIGURE,
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
  TILE_SCALE,
} from '../src/sprites/art/skeletonEffectsFigure.js';

// A painter composing on a scratch surface reaches `document.createElement`.
installCanvasGlobals();

/** `--only=` selectors, short enough to type. */
const ALIASES = new Map<string, FigureDef>([
  ['bolt', SKELETON_SOUL_BOLT_FIGURE],
  ['burst', SKELETON_SOUL_BURST_FIGURE],
  ['arrow', SKELETON_BONE_ARROW_FIGURE],
  ['hands', SKELETON_GRASPING_HANDS_FIGURE],
]);

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_RATIO = IN_GAME_TILE / TILE_SCALE;

const DEFAULT_SCALE = 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
/** Two backdrops per row: light art on a dark floor has to work on both. */
const BACKDROP_DARK = '#23232a';
const BACKDROP_LIGHT = '#6b6357';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const ANCHOR_MARK = 'rgba(120,220,255,0.5)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

interface LoadedSheet {
  readonly def: FigureDef;
  readonly state: string;
  readonly frameCount: number;
  readonly image: Canvas;
}

function bakeSheets(only: string): readonly LoadedSheet[] {
  const defs =
    only === '' ? SKELETON_EFFECT_FIGURES : [ALIASES.get(only)].filter((def) => def !== undefined);
  if (defs.length === 0) {
    throw new Error(`--only=${only} matches nothing; try ${[...ALIASES.keys()].join('|')}`);
  }
  return defs.map((def) => {
    const state = [...def.states.keys()][0];
    const sheet = bakeFigureSheet(def, [state]);
    return { def, state, frameCount: sheet.columns, image: sheet.canvas };
  });
}

function render(sheets: readonly LoadedSheet[], outPath: string, scale: number): void {
  const blockHeightOf = (sheet: LoadedSheet): number =>
    LABEL_HEIGHT + sheet.def.frameHeight * scale + PADDING + sheet.def.frameHeight * scale;
  const rowWidthOf = (sheet: LoadedSheet): number =>
    PADDING + sheet.frameCount * (sheet.def.frameWidth * scale + PADDING);

  const width = Math.max(...sheets.map(rowWidthOf));
  const stripHeight = LABEL_HEIGHT + Math.max(...sheets.map((s) => s.def.frameHeight));
  const height =
    PADDING +
    sheets.reduce((total, sheet) => total + blockHeightOf(sheet) + LABEL_HEIGHT + PADDING, 0) +
    stripHeight +
    PADDING;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP_DARK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const sheet of sheets) {
    const { def } = sheet;
    const cellW = def.frameWidth * scale;
    const cellH = def.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${def.id} — ${sheet.frameCount} frames of ${def.frameWidth}×${def.frameHeight}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    // The same row twice, on a dark floor and on a pale one. Green light on a
    // near-black backdrop flatters itself; the pale band is where a washed-out
    // core or a missing dark separation line actually shows.
    for (const backdrop of [BACKDROP_DARK, BACKDROP_LIGHT]) {
      for (let frame = 0; frame < sheet.frameCount; frame++) {
        const x = PADDING + frame * (cellW + PADDING);
        ctx.fillStyle = backdrop;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.drawImage(
          sheet.image,
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
  for (const sheet of sheets) {
    const { def } = sheet;
    const w = def.frameWidth * IN_GAME_RATIO;
    const h = def.frameHeight * IN_GAME_RATIO;
    for (let frame = 0; frame < sheet.frameCount; frame++) {
      ctx.drawImage(
        sheet.image,
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

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

reportFigureGates('skeleton effects', skeletonEffectGateFailures());

const only = parseFlag('only', '');
const outPath = parseFlag(
  'out',
  `${PREVIEW_DIR}/skeleton-effects${only === '' ? '' : `-${only}`}.png`,
);
render(bakeSheets(only), outPath, parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE));
