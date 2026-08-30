#!/usr/bin/env tsx
/**
 * Headless review harness for the three skeletons.
 *
 * A still cannot answer "does this move well", but it is the only thing that can
 * answer "does this read as bones" — and that is the question this art lives or
 * dies on. Every row is sliced out at review scale with the tile guide drawn on
 * it, and the same frames are blitted again at the in-game tile size, because a
 * ribcage that reads beautifully at 4× and turns into a white blob at 32 px has
 * failed.
 *
 * The art gates run first, before any contact sheet is baked: a sheet is a
 * tens-of-megapixel allocation, and a gate that measures on the far side of one
 * is a gate that reports seams nobody drew. They cover all three variants
 * whichever one is being rendered, because the three share every pose function.
 *
 *   npm run render:skeletons
 *   npx tsx scripts/render-skeletons.ts --only=sword --row=slash_side --scale=5
 *   npx tsx scripts/render-skeletons.ts --only=archer --mode=gore
 */

import { type Canvas, createCanvas } from 'canvas';

// Row order, frame counts and cell geometry come straight from the figures, so a
// new row cannot desync the only review path this art has.
import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { skeletonGateFailures } from './gates-skeletons.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  GORE_STATES,
  SKELETON_FIGURES,
  SKELETON_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/skeletonFigure.js';
import type { SkeletonVariant } from '../src/sprites/art/skeletonArt.js';

const VARIANTS: ReadonlyArray<SkeletonVariant> = ['lord', 'sword', 'archer'];

/** One variant's figure, its rows and the name its files carry. */
interface Subject {
  readonly variant: SkeletonVariant;
  readonly key: string;
  readonly rows: readonly RowSpec[];
}

function subjectFor(variant: SkeletonVariant): Subject {
  return {
    variant,
    key: SKELETON_FIGURES[variant].id,
    rows: SKELETON_ROWS[variant],
  };
}

/** Matches TILE_SIZE in src/core/constants.ts; the sheets are drawn at 2× that. */
const IN_GAME_TILE = 32;
/** What `drawSpriteRotatedCenter` scales a loose bone by in play. */
const GORE_RENDER_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a bone has to survive, largest first. */
const GORE_REVIEW_SCALES: readonly number[] = [4, 1, GORE_RENDER_SCALE];

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
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

function subjectNamed(only: string): Subject {
  const found = VARIANTS.find(
    (variant) => variant === only || SKELETON_FIGURES[variant].id === only,
  );
  if (found === undefined) throw new Error(`--only=${only} is not one of ${VARIANTS.join(' | ')}`);
  return subjectFor(found);
}

/**
 * The loose bones at the three sizes that matter. The bottom strip is the exit
 * criterion: name all seven from it, or the set has failed.
 */
function renderGorePanel(subject: Subject, outPath: string): void {
  const figure = SKELETON_FIGURES[subject.variant];
  const pieceCount = GORE_STATES.length;
  if (pieceCount === 0) throw new Error(`${subject.key} paints no loose bones`);
  const cells = GORE_STATES.map((state) => bakeFigureCell(figure, state, 0));
  const { frameWidth, frameHeight } = figure;

  const widths = GORE_REVIEW_SCALES.map((scale) => frameWidth * scale);
  const width = PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING)));
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce(
      (total, scale) => total + frameHeight * scale + LABEL_HEIGHT + PADDING,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = frameWidth * scale;
    const cellH = frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    const caption =
      scale === GORE_RENDER_SCALE
        ? `${subject.key} — at the size it renders in game; name all ${pieceCount} from this row`
        : `${subject.key} — ${scale}×`;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let piece = 0; piece < pieceCount; piece++) {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(cells[piece], 0, 0, frameWidth, frameHeight, x, y, cellW, cellH);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${subject.key} bones)`);
}

function renderSheetPanel(
  subject: Subject,
  sheet: Canvas,
  outPath: string,
  scale: number,
  only: string,
  onlyFrame: string,
): void {
  const { frameWidth, frameHeight, tileX, tileY } = SKELETON_FIGURES[subject.variant];
  const rows: readonly RowSpec[] =
    only === '' ? subject.rows : subject.rows.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`${subject.key} has no row named "${only}"`);
  const longestRow = Math.max(...rows.map((row) => row.frameCount));
  const firstFrame = onlyFrame === '' ? 0 : parseNumberFlag('frame', 0, 0, longestRow - 1);
  const framesPerRow = (row: RowSpec): number => (onlyFrame === '' ? row.frameCount : 1);

  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...rows.map(framesPerRow));
  const inGameW = frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = frameHeight * (IN_GAME_TILE / TILE_SCALE);

  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING +
    LABEL_HEIGHT +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`${subject.key} — ${scale}×`, PADDING, PADDING + LABEL_HEIGHT - PADDING);
  let y = PADDING + LABEL_HEIGHT;

  for (const row of rows) {
    const sheetRow = subject.rows.findIndex((candidate) => candidate.name === row.name);
    ctx.fillStyle = LABEL_COLOR;
    const shown = framesPerRow(row);
    const label =
      onlyFrame === ''
        ? `${row.name} — ${row.frameCount} frames`
        : `${row.name} — frame ${firstFrame} of ${row.frameCount}`;
    ctx.fillText(label, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let i = 0; i < shown; i++) {
      const col = firstFrame + i;
      const x = PADDING + i * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        col * frameWidth,
        sheetRow * frameHeight,
        frameWidth,
        frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(x + tileX * scale, y + tileY * scale, TILE_SCALE * scale, TILE_SCALE * scale);
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = subject.rows.findIndex((candidate) => candidate.name === rows[i].name);
    ctx.drawImage(
      sheet,
      firstFrame * frameWidth,
      sheetRow * frameHeight,
      frameWidth,
      frameHeight,
      PADDING + i * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

function main(): void {
  const mode = parseFlag('mode', 'sheet');
  const only = parseFlag('only', '');
  const outPath = parseFlag('out', '');

  // Gates before any contact sheet, always. A sheet is a tens-of-megapixel
  // allocation, and measuring the art on the far side of one is how a gate
  // starts reporting defects nobody drew.
  reportFigureGates('skeletons', skeletonGateFailures());

  // With no --only the whole family renders: three variants that share one set
  // of pose functions are only reviewable side by side, and a reviewer handed
  // one of them cannot see that the other two moved with it.
  const subjects = only === '' ? VARIANTS.map(subjectFor) : [subjectNamed(only)];
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  for (const subject of subjects) {
    const out = outPath === '' ? `${PREVIEW_DIR}/skeleton-${subject.variant}-${mode}.png` : outPath;
    if (mode === 'gore') {
      renderGorePanel(subject, out);
      continue;
    }
    const sheet = bakeFigureSheet(
      SKELETON_FIGURES[subject.variant],
      subject.rows.map((row) => row.name),
    ).canvas;
    renderSheetPanel(subject, sheet, out, scale, parseFlag('row', ''), parseFlag('frame', ''));
  }
}

main();
