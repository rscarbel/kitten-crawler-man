/**
 * Splash Zone's review harness: the otter's rows and his water effects.
 *
 * The art gates run first, before anything is baked, and the sheet is painted
 * from the figures the way the runtime cache bakes them — so one command
 * answers both "does it still hold together" and "what does it look like".
 *
 *   npm run render:splash-zone
 *   npx tsx scripts/render-splash-zone.ts --row=walk_side,shoot --scale=4
 *   npx tsx scripts/render-splash-zone.ts --mode=strip32
 *   npx tsx scripts/render-splash-zone.ts --mode=effects --scale=3
 *   npx tsx scripts/render-splash-zone.ts --mode=onion --row=walk_side --scale=4
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { splashZoneGateFailures } from './gates-splash-zone.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  SPLASH_ZONE_BOLT_FIGURE,
  SPLASH_ZONE_FIGURE,
  SPLASH_ZONE_SPLASH_FIGURE,
  SPLASH_ZONE_WAVE_FIGURE,
  TILE_SCALE,
} from '../src/sprites/art/splashZoneFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
/** The in-game strip is also shown blown up this much with nearest-neighbour, so its pixels can be read. */
const STRIP_ZOOM = 3;
/** Left margin, the gap between the two strips, and the right margin. */
const STRIP_GUTTERS = 3;
const EAST = 0;
const SOUTH = Math.PI / 2;
const WEST = Math.PI;
const NORTH_EAST = -SOUTH / 2;
/** Headings the wave is shown turned to. */
const REVIEW_HEADINGS: readonly number[] = [EAST, SOUTH, WEST, NORTH_EAST];
const NARROW_STRETCH = 0.7;
const WIDE_STRETCH = 1.6;
/** Stretches across its heading the wave is shown at: narrower and wider than authored. */
const REVIEW_STRETCHES: readonly number[] = [NARROW_STRETCH, WIDE_STRETCH];
/** Size of the red dot marking an effect's anchor. */
const ANCHOR_DOT = 4;
/** The in-game strip of effects is spaced this many paddings apart. */
const IN_GAME_GAP_PADDINGS = 4;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2c2c31';
/** The grounds a hireling actually stands on: dungeon stone, grass, dirt, club floor. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#637032', '#7a6244', '#8c8170'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const ONION_ALPHA = 0.28;

type Mode = 'sheet' | 'strip32' | 'effects' | 'onion';
const MODES: ReadonlyArray<Mode> = ['sheet', 'strip32', 'effects', 'onion'];

type SheetContext = ReturnType<Canvas['getContext']>;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

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

function selectedStates(def: FigureDef): string[] {
  const all = figureStateNames(def);
  const only = parseFlag('row', '');
  if (only === '') return all;
  const wanted = only.split(',');
  const states = all.filter((state) => wanted.includes(state));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  return states;
}

/** A labelled grid, one row per state, each cell on a floor swatch with its tile outlined. */
function renderSheet(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const { canvas, ctx } = newPanel(
    PADDING + columns * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
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
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bakeFigureCell(def, state, frame), x, y, cellW, cellH);
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
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every frame of every row at the size the game blits it, on each floor, with a
 * nearest-neighbour blow-up beside it. Review-scale beauty that dies at 32 px
 * counts for nothing.
 */
function renderStrip32(def: FigureDef, states: readonly string[], outPath: string): void {
  const cellW = Math.ceil(def.frameWidth * IN_GAME_SCALE);
  const cellH = Math.ceil(def.frameHeight * IN_GAME_SCALE);
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const rowWidth = columns * cellW;
  const { canvas, ctx } = newPanel(
    PADDING * STRIP_GUTTERS + rowWidth * (1 + STRIP_ZOOM),
    PADDING + states.length * (cellH * STRIP_ZOOM + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    const strip = createCanvas(rowWidth, cellH);
    const stripCtx = strip.getContext('2d');
    stripCtx.fillStyle = backdropFor(index);
    stripCtx.fillRect(0, 0, rowWidth, cellH);
    stripCtx.imageSmoothingEnabled = true;
    for (let frame = 0; frame < frames; frame++) {
      stripCtx.drawImage(bakeFigureCell(def, state, frame), frame * cellW, 0, cellW, cellH);
    }
    ctx.drawImage(strip, PADDING, y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(strip, PADDING * 2 + rowWidth, y, rowWidth * STRIP_ZOOM, cellH * STRIP_ZOOM);
    ctx.imageSmoothingEnabled = true;
    y += cellH * STRIP_ZOOM + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, in-game strip)`);
}

/** Consecutive frames overlaid faintly: a snap or a pop shows as a doubled edge. */
function renderOnion(
  def: FigureDef,
  states: readonly string[],
  outPath: string,
  scale: number,
): void {
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    PADDING + states.length * (cellW + PADDING),
    PADDING + cellH + LABEL_HEIGHT + PADDING,
  );
  states.forEach((state, index) => {
    const x = PADDING + index * (cellW + PADDING);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(state, x, PADDING + LABEL_HEIGHT - PADDING);
    ctx.fillStyle = backdropFor(index);
    ctx.fillRect(x, PADDING + LABEL_HEIGHT, cellW, cellH);
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < frameCountOf(def, state); frame++) {
      ctx.drawImage(bakeFigureCell(def, state, frame), x, PADDING + LABEL_HEIGHT, cellW, cellH);
    }
    ctx.globalAlpha = 1;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, onion)`);
}

/**
 * The bolt, the wave and the splash, each at review scale and at the in-game
 * size, plus the wave turned to four headings and stretched to two widths the
 * way the runtime draws it.
 */
function renderEffects(outPath: string, scale: number): void {
  const figures: ReadonlyArray<FigureDef> = [
    SPLASH_ZONE_BOLT_FIGURE,
    SPLASH_ZONE_WAVE_FIGURE,
    SPLASH_ZONE_SPLASH_FIGURE,
  ];
  const widest = Math.max(...figures.map((def) => def.frameWidth));
  const tallest = Math.max(...figures.map((def) => def.frameHeight));
  const columns = Math.max(...figures.map((def) => frameCountOf(def, figureStateNames(def)[0])));
  const headings = REVIEW_HEADINGS;
  const stretches = REVIEW_STRETCHES;
  const turnedPanel = tallest * 2 + PADDING * 2;
  const { canvas, ctx } = newPanel(
    PADDING +
      Math.max(
        columns * (widest * scale + PADDING),
        (headings.length + stretches.length) * (turnedPanel + PADDING),
      ),
    PADDING +
      figures.length * (tallest * scale + LABEL_HEIGHT + PADDING) +
      LABEL_HEIGHT +
      tallest * IN_GAME_SCALE +
      PADDING +
      LABEL_HEIGHT +
      turnedPanel +
      PADDING,
  );
  let y = PADDING;
  figures.forEach((def, index) => {
    const state = figureStateNames(def)[0];
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${def.id} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (widest * scale + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, def.frameWidth * scale, def.frameHeight * scale);
      ctx.drawImage(
        bakeFigureCell(def, state, frame),
        x,
        y,
        def.frameWidth * scale,
        def.frameHeight * scale,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, def.frameWidth * scale, def.frameHeight * scale);
      ctx.fillStyle = 'rgba(255,80,80,0.9)';
      ctx.fillRect(
        x + def.tileX * scale - ANCHOR_DOT / 2,
        y + def.tileY * scale - ANCHOR_DOT / 2,
        ANCHOR_DOT,
        ANCHOR_DOT,
      );
    }
    y += tallest * scale + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('in-game size', PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  figures.forEach((def, index) => {
    const state = figureStateNames(def)[0];
    const x = PADDING + index * (widest * IN_GAME_SCALE + PADDING * IN_GAME_GAP_PADDINGS);
    ctx.fillStyle = backdropFor(index);
    ctx.fillRect(x, y, def.frameWidth * IN_GAME_SCALE, def.frameHeight * IN_GAME_SCALE);
    ctx.drawImage(
      bakeFigureCell(def, state, 0),
      x,
      y,
      def.frameWidth * IN_GAME_SCALE,
      def.frameHeight * IN_GAME_SCALE,
    );
  });
  y += tallest * IN_GAME_SCALE + PADDING;

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'wave turned to a heading and stretched across it, as the runtime draws it (2×)',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  const wave = SPLASH_ZONE_WAVE_FIGURE;
  const waveCell = bakeFigureCell(wave, figureStateNames(wave)[0], 0);
  const drawTurned = (panelIndex: number, heading: number, stretch: number): void => {
    const x = PADDING + panelIndex * (turnedPanel + PADDING);
    ctx.fillStyle = backdropFor(panelIndex);
    ctx.fillRect(x, y, turnedPanel, turnedPanel);
    ctx.save();
    ctx.translate(x + turnedPanel / 2, y + turnedPanel / 2);
    ctx.rotate(heading);
    ctx.scale(2, 2 * stretch);
    ctx.drawImage(waveCell, -wave.tileX, -wave.tileY);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.fillRect(
      x + turnedPanel / 2 - ANCHOR_DOT / 2,
      y + turnedPanel / 2 - ANCHOR_DOT / 2,
      ANCHOR_DOT,
      ANCHOR_DOT,
    );
  };
  headings.forEach((heading, i) => {
    drawTurned(i, heading, 1);
  });
  stretches.forEach((stretch, i) => {
    drawTurned(headings.length + i, 0, stretch);
  });

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, effects)`);
}

function main(): void {
  if (!process.argv.includes('--skip-gates')) {
    // Ahead of the sheet: a tens-of-megapixel allocation between painting and
    // measuring has been seen to make a pixel gate misreport.
    console.log('Gating Splash Zone…');
    reportFigureGates('splash zone', splashZoneGateFailures());
  }
  const mode = parseMode();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'effects') {
    renderEffects(parseFlag('out', `${PREVIEW_DIR}/splash-zone-effects.png`), scale);
    return;
  }
  const states = selectedStates(SPLASH_ZONE_FIGURE);
  if (mode === 'strip32') {
    renderStrip32(
      SPLASH_ZONE_FIGURE,
      states,
      parseFlag('out', `${PREVIEW_DIR}/splash-zone-strip32.png`),
    );
    return;
  }
  if (mode === 'onion') {
    renderOnion(
      SPLASH_ZONE_FIGURE,
      states,
      parseFlag('out', `${PREVIEW_DIR}/splash-zone-onion.png`),
      scale,
    );
    return;
  }
  renderSheet(
    SPLASH_ZONE_FIGURE,
    states,
    parseFlag('out', `${PREVIEW_DIR}/splash-zone-review.png`),
    scale,
  );
}

main();
