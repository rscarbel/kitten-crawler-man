/**
 * The rock golems' review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. The contact sheet is
 * painted from the figures the way the runtime cache bakes them, and the art
 * gates run as part of the render, so one command answers both "does it still
 * hold together" and "what does it look like".
 *
 *   npm run render:rock-golem
 *   npx tsx scripts/render-rock-golem.ts --only=boss --row=throw_side --scale=5
 *   npx tsx scripts/render-rock-golem.ts --mode=gore
 *   npx tsx scripts/render-rock-golem.ts --mode=effects
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { rockGolemGateFailures } from './gates-rock-golem.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { GolemVariant } from '../src/sprites/art/rockGolemArt.js';
import {
  GOLEM_FIGURES,
  GOLEM_ROCK_BURST_FIGURE,
  GOLEM_ROCK_FIGURE,
  GORE_STATES,
  ROCK_EFFECT_STATE,
  TILE_SCALE,
  golemRowsFor,
} from '../src/sprites/art/rockGolemFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The three sizes a rubble piece has to survive, largest first. */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [4, 1, IN_GAME_SCALE];

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The grounds a golem actually stands on, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#637032', '#7a6244', '#8c8170'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

type Mode = 'sheet' | 'gore' | 'effects';
const MODES: ReadonlyArray<Mode> = ['sheet', 'gore', 'effects'];
const VARIANTS: ReadonlyArray<GolemVariant> = ['regular', 'boss'];

type SheetContext = ReturnType<Canvas['getContext']>;

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

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const found = MODES.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return found;
}

function parseVariant(): GolemVariant {
  const raw = parseFlag('only', 'boss');
  const found = VARIANTS.find((variant) => variant === raw);
  if (found === undefined) throw new Error(`--only=${raw} is not one of ${VARIANTS.join(', ')}`);
  return found;
}

function backdropFor(index: number): string {
  return FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

/**
 * A labelled grid of rows, plus a strip of first frames at the size the game
 * blits them — which is the size the silhouette actually has to survive.
 */
function renderRows(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const sheet = bakeFigureSheet(def, [...states]).canvas;
  const { frameWidth, frameHeight } = def;
  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const maxCols = Math.max(...states.map((state) => frameCountOf(def, state)));
  const inGameW = frameWidth * IN_GAME_SCALE;
  const inGameH = frameHeight * IN_GAME_SCALE;

  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const { canvas, ctx } = newPanel(
    Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING),
  );

  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * frameWidth,
        index * frameHeight,
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
      ctx.strokeRect(
        x + def.tileX * scale,
        y + def.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  states.forEach((_state, index) => {
    ctx.drawImage(
      sheet,
      0,
      index * frameHeight,
      frameWidth,
      frameHeight,
      PADDING + index * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * The rubble at the three sizes that matter. The bottom strip is the exit
 * criterion: tell all eight apart from it, or the set has failed.
 */
function renderGorePanel(def: FigureDef, outPath: string): void {
  const sheet = bakeFigureSheet(def, [...GORE_STATES]).canvas;
  const { frameWidth, frameHeight } = def;
  const widths = GORE_REVIEW_SCALES.map((scale) => frameWidth * scale);

  const { canvas, ctx } = newPanel(
    PADDING + Math.max(...widths.map((w) => GORE_STATES.length * (w + PADDING))),
    PADDING +
      GORE_REVIEW_SCALES.reduce(
        (total, scale) => total + frameHeight * scale + LABEL_HEIGHT + PADDING,
        0,
      ),
  );

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = frameWidth * scale;
    const cellH = frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === Math.min(...GORE_REVIEW_SCALES)
        ? 'at the size it renders in game — tell all eight apart from this row'
        : `${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    GORE_STATES.forEach((state, piece) => {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(sheet, 0, piece * frameHeight, frameWidth, frameHeight, x, y, cellW, cellH);
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(state, x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    });
    y += cellH + PADDING;
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, gore panel)`);
}

/** The thrown boulder and its burst, one row each. */
function renderEffectsPanel(outPath: string, scale: number): void {
  const figures: ReadonlyArray<FigureDef> = [GOLEM_ROCK_FIGURE, GOLEM_ROCK_BURST_FIGURE];
  const widest = Math.max(...figures.map((def) => def.frameWidth));
  const tallest = Math.max(...figures.map((def) => def.frameHeight));
  const columns = Math.max(...figures.map((def) => frameCountOf(def, ROCK_EFFECT_STATE)));

  const { canvas, ctx } = newPanel(
    PADDING + columns * (widest * scale + PADDING),
    PADDING + figures.length * (tallest * scale + LABEL_HEIGHT + PADDING),
  );

  let y = PADDING;
  figures.forEach((def, index) => {
    const sheet = bakeFigureSheet(def, [ROCK_EFFECT_STATE]).canvas;
    const frames = frameCountOf(def, ROCK_EFFECT_STATE);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${def.id} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (widest * scale + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, def.frameWidth * scale, def.frameHeight * scale);
      ctx.drawImage(
        sheet,
        frame * def.frameWidth,
        0,
        def.frameWidth,
        def.frameHeight,
        x,
        y,
        def.frameWidth * scale,
        def.frameHeight * scale,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, def.frameWidth * scale, def.frameHeight * scale);
    }
    y += tallest * scale + PADDING;
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, effect panel)`);
}

function main(): void {
  // Ahead of the contact sheet rather than after it. The sheet is a
  // tens-of-megapixel allocation, and measuring the art on the other side of one
  // made the pilot's centroid gate report a seam at twice its true width every
  // so often — a red gate on art nobody touched, which is the one thing that
  // teaches an agent to loosen a threshold.
  console.log('Gating the rock golem figures…');
  reportFigureGates('rock golems', rockGolemGateFailures());

  const mode = parseMode();
  const variant = parseVariant();
  const def = GOLEM_FIGURES[variant];
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);

  if (mode === 'effects') {
    renderEffectsPanel(parseFlag('out', `${PREVIEW_DIR}/rock-golem-effects.png`), scale);
    return;
  }
  if (mode === 'gore') {
    renderGorePanel(def, parseFlag('out', `${PREVIEW_DIR}/rock-golem-${variant}-gore.png`));
    return;
  }

  const poseStates = golemRowsFor(variant).map((row) => row.name);
  const only = parseFlag('row', '');
  const wanted = only === '' ? [] : only.split(',');
  const states = wanted.length === 0 ? poseStates : poseStates.filter((s) => wanted.includes(s));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  renderRows(
    def,
    states,
    parseFlag('out', `${PREVIEW_DIR}/rock-golem-${variant}-review.png`),
    scale,
  );
}

main();
