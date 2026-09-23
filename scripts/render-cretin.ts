/**
 * The Cretins' review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. The gates run first,
 * then the sheet is painted from the figures the way the runtime cache bakes
 * them.
 *
 *   npm run render:cretin                                   every row of Sledge
 *   npx tsx scripts/render-cretin.ts --variant=bomo --row=walk_side --scale=5
 *   npx tsx scripts/render-cretin.ts --mode=lineup          all four beside Carl
 *   npx tsx scripts/render-cretin.ts --mode=strip32         every row at 32 px
 *   npx tsx scripts/render-cretin.ts --mode=shield          the amber dome
 *   --skip-gates                                            art iteration only
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { cretinGateFailures } from './gates-cretin.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { CRETIN_VARIANTS, type CretinVariant } from '../src/sprites/art/cretinArt.js';
import {
  CRETIN_ACTIONS,
  CRETIN_FIGURES,
  CRETIN_SHIELD_FIGURE,
  CRETIN_SHIELD_ROWS,
  CRETIN_VIEWS,
  cretinStateName,
} from '../src/sprites/art/cretinFigure.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#2f2f35';
/** The grounds the club's bouncers and a hired Cretin stand on. */
const FLOOR_SWATCHES: readonly string[] = ['#3b3b40', '#4a3a52', '#637032', '#7a6244'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const NEAREST_ZOOM = 3;
/** Paddings a two-panel page spends: left, between, right. */
const PANEL_PADDINGS = 3;
/** Width of each figure's slot in the lineup and strip, in tiles: room for a Cretin's reach. */
const LINEUP_SLOT_TILES = 2.2;
const STRIP_SLOT_TILES = 2.6;
/** Height of a lineup or strip row, in tiles: a Cretin with its arms raised. */
const LINEUP_ROW_TILES = 3.4;
const STRIP_ROW_TILES = 3.3;
/** Pixels between a row's ground line and its bottom edge. */
const GROUND_MARGIN = 6;
const STRIP_ZOOM = 2;
const SHIELD_STRIP_TILES = 4;
const SHIELD_STRIP_GROUND_TILES = 2.5;

type Mode = 'sheet' | 'lineup' | 'strip32' | 'shield';
const MODES: readonly Mode[] = ['sheet', 'lineup', 'strip32', 'shield'];

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

function parseVariant(): CretinVariant {
  const raw = parseFlag('variant', 'sledge');
  const found = CRETIN_VARIANTS.find((variant) => variant === raw);
  if (found === undefined) {
    throw new Error(`--variant=${raw} is not one of ${CRETIN_VARIANTS.join(', ')}`);
  }
  return found;
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

function allPoseStates(): string[] {
  return CRETIN_ACTIONS.flatMap((action) =>
    CRETIN_VIEWS.map((view) => cretinStateName(action, view)),
  );
}

function selectedStates(): string[] {
  const only = parseFlag('row', '');
  if (only === '') return allPoseStates();
  const wanted = only.split(',');
  const states = allPoseStates().filter((state) => wanted.includes(state));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  return states;
}

/** A labelled grid of rows, then the same rows' first frames at the size the game blits. */
function renderSheet(
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
  const { canvas, ctx } = newPanel(
    PADDING + maxCols * (cellW + PADDING),
    PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING),
  );
  let y = PADDING;
  states.forEach((state, index) => {
    const frames = frameCountOf(def, state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${def.id}.${state} — ${frames} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frames; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
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
        def.tileScale * scale,
        def.tileScale * scale,
      );
    }
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/** Draws one baked cell with its tile placed at (tileLeft, tileTop) at the given tile size. */
function blitCell(
  ctx: SheetContext,
  def: FigureDef,
  state: string,
  frame: number,
  tileLeft: number,
  tileTop: number,
  tile: number,
): void {
  const cell = bakeFigureCell(def, state, frame);
  const scale = tile / def.tileScale;
  ctx.drawImage(
    cell,
    tileLeft - def.tileX * scale,
    tileTop - def.tileY * scale,
    def.frameWidth * scale,
    def.frameHeight * scale,
  );
}

/**
 * The four Cretins in each view beside Carl, at the in-game tile and enlarged
 * with nearest-neighbour: the size read and the tell-them-apart read in one
 * picture.
 */
function renderLineup(outPath: string): void {
  const figures: { def: FigureDef; state: (view: string) => string; label: string }[] = [
    {
      def: HUMAN_FIGURE,
      state: (view) => (view === 'front' ? 'idle' : `idle_${view}`),
      label: 'Carl',
    },
    ...CRETIN_VARIANTS.map((variant) => ({
      def: CRETIN_FIGURES[variant],
      state: (view: string) => (view === 'front' ? 'idle' : `idle_${view}`),
      label: variant,
    })),
  ];
  const views = ['front', 'side', 'away'];
  const slot = IN_GAME_TILE * LINEUP_SLOT_TILES;
  const rowHeight = IN_GAME_TILE * LINEUP_ROW_TILES;
  const smallW = PADDING + figures.length * views.length * slot;
  const small = createCanvas(Math.ceil(smallW), Math.ceil(rowHeight));
  const sctx = small.getContext('2d');
  sctx.fillStyle = FLOOR_SWATCHES[0];
  sctx.fillRect(0, 0, small.width, small.height);
  views.forEach((view, v) => {
    figures.forEach((figure, f) => {
      const x = PADDING + (v * figures.length + f) * slot + slot / 2 - IN_GAME_TILE / 2;
      blitCell(
        sctx,
        figure.def,
        figure.state(view),
        0,
        x,
        rowHeight - IN_GAME_TILE - GROUND_MARGIN,
        IN_GAME_TILE,
      );
    });
  });
  const { canvas, ctx } = newPanel(
    small.width * NEAREST_ZOOM + PADDING * 2,
    small.height * (NEAREST_ZOOM + 1) + LABEL_HEIGHT * 2 + PADDING * PANEL_PADDINGS,
  );
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `in-game (${IN_GAME_TILE}px tile): ${figures.map((f) => f.label).join(', ')} × front/side/away`,
    PADDING,
    LABEL_HEIGHT - GROUND_MARGIN,
  );
  ctx.drawImage(small, PADDING, LABEL_HEIGHT);
  ctx.fillText(`${NEAREST_ZOOM}× nearest`, PADDING, LABEL_HEIGHT * 2 + small.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    small,
    PADDING,
    LABEL_HEIGHT * 2 + small.height + GROUND_MARGIN,
    small.width * NEAREST_ZOOM,
    small.height * NEAREST_ZOOM,
  );
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, lineup)`);
}

/** Every frame of the chosen rows at the in-game tile, with a nearest-neighbour copy. */
function renderStrip32(def: FigureDef, states: readonly string[], outPath: string): void {
  const tile = IN_GAME_TILE;
  const slotW = tile * STRIP_SLOT_TILES;
  const slotH = tile * STRIP_ROW_TILES;
  const maxCols = Math.max(...states.map((state) => frameCountOf(def, state)));
  const small = createCanvas(
    Math.ceil(PADDING + maxCols * slotW),
    Math.ceil(states.length * slotH),
  );
  const sctx = small.getContext('2d');
  sctx.fillStyle = FLOOR_SWATCHES[0];
  sctx.fillRect(0, 0, small.width, small.height);
  states.forEach((state, row) => {
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame < frames; frame++) {
      blitCell(
        sctx,
        def,
        state,
        frame,
        PADDING + frame * slotW + (slotW - tile) / 2,
        row * slotH + slotH - tile - GROUND_MARGIN,
        tile,
      );
    }
  });
  const zoom = STRIP_ZOOM;
  const { canvas, ctx } = newPanel(
    small.width * (zoom + 1) + PADDING * PANEL_PADDINGS,
    small.height * zoom + LABEL_HEIGHT,
  );
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `${def.id} at ${tile}px (left) and ${zoom}× nearest (right): ${states.join(', ')}`,
    PADDING,
    LABEL_HEIGHT - GROUND_MARGIN,
  );
  ctx.drawImage(small, PADDING, LABEL_HEIGHT);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    small,
    small.width + PADDING * 2,
    LABEL_HEIGHT,
    small.width * zoom,
    small.height * zoom,
  );
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, strip)`);
}

/** The dome's three rows enlarged, then held over Carl at the in-game tile. */
function renderShield(outPath: string, scale: number): void {
  const def = CRETIN_SHIELD_FIGURE;
  const rows = Object.keys(CRETIN_SHIELD_ROWS);
  const cellW = def.frameWidth * scale;
  const cellH = def.frameHeight * scale;
  const cols = Math.max(...rows.map((row) => frameCountOf(def, row)));
  const { canvas, ctx } = newPanel(
    PADDING + cols * (cellW + PADDING),
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING) + IN_GAME_TILE * SHIELD_STRIP_TILES,
  );
  let y = PADDING;
  rows.forEach((row) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${def.id}.${row}`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < frameCountOf(def, row); frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = FLOOR_SWATCHES[0];
      ctx.fillRect(x, y, cellW, cellH);
      blitCell(
        ctx,
        HUMAN_FIGURE,
        'idle',
        0,
        x + def.tileX * scale,
        y + def.tileY * scale,
        def.tileScale * scale,
      );
      ctx.drawImage(bakeFigureCell(def, row, frame), x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  });
  for (let frame = 0; frame < frameCountOf(def, 'hold'); frame++) {
    const x = PADDING + frame * IN_GAME_TILE * 2;
    blitCell(
      ctx,
      HUMAN_FIGURE,
      'idle',
      0,
      x,
      y + IN_GAME_TILE * SHIELD_STRIP_GROUND_TILES,
      IN_GAME_TILE,
    );
    blitCell(
      ctx,
      def,
      'hold',
      frame,
      x,
      y + IN_GAME_TILE * SHIELD_STRIP_GROUND_TILES,
      IN_GAME_TILE,
    );
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, shield)`);
}

function main(): void {
  if (!process.argv.includes('--skip-gates')) {
    // Ahead of any contact sheet: a sheet is a large allocation, and measuring
    // the art on the far side of one has made gates on other figures report
    // defects that were not there.
    console.log('Gating the Cretin figures…');
    reportFigureGates('cretins', cretinGateFailures());
  }
  const mode = parseMode();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'lineup') {
    renderLineup(parseFlag('out', `${PREVIEW_DIR}/cretin-lineup.png`));
    return;
  }
  if (mode === 'shield') {
    renderShield(parseFlag('out', `${PREVIEW_DIR}/cretin-shield.png`), scale);
    return;
  }
  const variant = parseVariant();
  const def = CRETIN_FIGURES[variant];
  const states = selectedStates();
  if (mode === 'strip32') {
    renderStrip32(def, states, parseFlag('out', `${PREVIEW_DIR}/cretin-${variant}-strip32.png`));
    return;
  }
  renderSheet(def, states, parseFlag('out', `${PREVIEW_DIR}/cretin-${variant}-review.png`), scale);
}

main();
