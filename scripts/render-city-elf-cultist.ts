#!/usr/bin/env tsx
/**
 * Review harness and gates for the city elf cultist (`cityElfCultistFigure.ts`).
 *
 * Runs the gates first and exits non-zero if any fails, then writes:
 *   <out>/cultist-sheet.png      every row, enlarged to 96 px per tile (3x)
 *   <out>/cultist-context.png    beside Carl and a robed townsperson, at 32 px
 *                                per tile on a light and a dark floor, and 3x
 *   <out>/cultist-ingame.png     the 32 px render blown up pixel-for-pixel
 *   <out>/cultist-closeup.png    the three views well past bake density
 *   <out>/cultist-strip-<row>.png  one animation row at 32 px and 3x
 *
 *   npm run render:city-elf-cultist
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, frameCountOf, paintFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  inkBoxOf,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { TILE_SIZE } from '../src/core/constants.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { townCastOutfitFigure, townCastStateName } from '../src/sprites/art/townCastFigure.js';
import { TOWN_CAST_LOOKS } from '../src/sprites/person/townCastLooks.js';
import {
  CITY_ELF_CULTIST_FIGURE,
  CULTIST_CAST_FRAMES,
  CULTIST_ROLES,
  CULTIST_VIEWS,
  cultistStateName,
} from '../src/sprites/art/cityElfCultistFigure.js';
import { CITY_ELF_CULTIST_DRAWN_STATES } from '../src/sprites/cityElfCultistSprite.js';

function flagValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? fallback : arg.slice(prefix.length);
}

const FIGURE = CITY_ELF_CULTIST_FIGURE;
const OUT_DIR = flagValue('out', `${PREVIEW_DIR}/city-elf-cultist`);
const PREFIX = flagValue('prefix', 'cultist');
const ENLARGED_PX_PER_TILE = TILE_SIZE * 3;
const PIXEL_ZOOM = 3;
const CLOSEUP_PX_PER_TILE = TILE_SIZE * 6;
const BACKDROP = '#2f2a2e';
const FLOOR = '#6f665a';
/** The cult's lodge is lit by candles on dark boards: the violet robe has to part from it. */
const DARK_FLOOR = '#2c2826';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '11px sans-serif';
const LABEL_HEIGHT = 14;
const PADDING = 8;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const ROBED_RESIDENT_ID = 'adult_merchant';
const SIDE_BY_SIDE_SPACING_TILES = 1.6;
const ROW_SPACING_TILES = 1.3;
const CLOSEUP_SPACING_TILES = 1.5;
const LINEUP_HEADROOM_TILES = 2.2;

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * An elf has to stand taller than a human, or the "tall and slender" read is
 * gone: the cultist's ink top is held above Carl's by at least this many cell
 * pixels at the shared 64 px tile.
 */
const MIN_HEIGHT_OVER_CARL_PX = 4;

function inkTopOf(def: FigureDef, state: string): number | null {
  return inkBoxOf(def, state, 0)?.minY ?? null;
}

function heightFailures(): string[] {
  const cultistTop = inkTopOf(FIGURE, cultistStateName('idle', 'front'));
  const carlTop = inkTopOf(HUMAN_FIGURE, 'idle');
  if (cultistTop === null || carlTop === null) return ['the idle rows painted no ink to measure'];
  const cultistAboveTile = FIGURE.tileY - cultistTop;
  const carlAboveTile = HUMAN_FIGURE.tileY - carlTop;
  console.log(`  info ink above the tile: cultist ${cultistAboveTile}px, Carl ${carlAboveTile}px`);
  return cultistAboveTile - carlAboveTile >= MIN_HEIGHT_OVER_CARL_PX
    ? []
    : ['the cultist stands no taller than Carl: an elf has to read as tall'];
}

/**
 * The cast has to put the casting hand out toward the target: edge-on, the
 * ink's leading edge on the thrust frame reaches past the idle's by at least
 * this much of a tile. A cast row that never moves the arm passes every other
 * gate.
 */
const MIN_CAST_REACH_TILES = 0.25;
const CAST_THRUST_FRAME = 1;

function castReachFailures(): string[] {
  const idle = inkBoxOf(FIGURE, cultistStateName('idle', 'side'), 0);
  const cast = inkBoxOf(FIGURE, cultistStateName('cast', 'side'), CAST_THRUST_FRAME);
  if (idle === null || cast === null) return ['the side idle or cast painted no ink to measure'];
  const reachTiles = (cast.maxX - idle.maxX) / FIGURE.tileScale;
  console.log(`  info side cast reach past idle: ${reachTiles.toFixed(2)} tiles`);
  return reachTiles >= MIN_CAST_REACH_TILES
    ? []
    : [`the side cast reaches only ${reachTiles.toFixed(2)} tiles past the idle`];
}

/** Every row warm at once must fit the per-figure cache ceiling: a hideout holds several at once. */
function budgetFailures(): string[] {
  const cellBytes = FIGURE.frameWidth * FIGURE.frameHeight * BYTES_PER_PIXEL;
  let cells = 0;
  for (const declared of FIGURE.states.values()) cells += declared.frames;
  const bytes = cells * cellBytes;
  const budget = figureByteBudgetFor(FIGURE);
  console.log(
    `  info every row warm: ${cells} cells, ${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB ` +
      `of ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
  );
  return bytes > budget ? ['every row warm at once overruns the figure cache ceiling'] : [];
}

function castFrameFailures(): string[] {
  let measured = 0;
  const failures: string[] = [];
  for (const view of CULTIST_VIEWS) {
    const frames = frameCountOf(FIGURE, cultistStateName('cast', view));
    measured++;
    if (frames !== CULTIST_CAST_FRAMES) {
      failures.push(`cast${view} paints ${frames} frames, not ${CULTIST_CAST_FRAMES}`);
    }
  }
  return [...nothingMeasuredFailures(measured, 'cast rows'), ...failures];
}

function runGates(): boolean {
  const results = [
    reportFigureGates('structure', figureStructuralFailures(FIGURE)),
    reportFigureGates(
      'drawn states',
      missingStateFailures(FIGURE, CITY_ELF_CULTIST_DRAWN_STATES, 'cityElfCultistSprite'),
    ),
    reportFigureGates('taller than Carl', heightFailures()),
    reportFigureGates('cast reaches out', castReachFailures()),
    reportFigureGates('cast frame count', castFrameFailures()),
    reportFigureGates('budget', budgetFailures()),
  ];
  return results.every(Boolean);
}

// ── Pictures ─────────────────────────────────────────────────────────────────

interface Subject {
  readonly label: string;
  readonly def: FigureDef;
  readonly state: string;
  readonly frame: number;
}

function label(ctx: NodeCtx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function placeCell(
  ctx: NodeCtx,
  subject: Subject,
  tileLeft: number,
  tileTop: number,
  pxPerTile: number,
): void {
  // Past the bake's own density the cell is painted at the size it is shown,
  // so a closeup shows the painter's detail rather than an upscaled blur.
  const density = pxPerTile / subject.def.tileScale;
  const cell =
    density > 1
      ? paintFigureCell(subject.def, subject.state, subject.frame, density)
      : bakeFigureCell(subject.def, subject.state, subject.frame);
  const drawScale = density > 1 ? 1 : density;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    cell,
    tileLeft - subject.def.tileX * density,
    tileTop - subject.def.tileY * density,
    cell.width * drawScale,
    cell.height * drawScale,
  );
}

function lineup(
  subjects: readonly Subject[],
  pxPerTile: number,
  spacingTiles: number,
  floor: string,
): Canvas {
  const width = Math.ceil(subjects.length * spacingTiles * pxPerTile);
  const height = Math.ceil((LINEUP_HEADROOM_TILES + 1) * pxPerTile) + LABEL_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, width, height - LABEL_HEIGHT);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, height - LABEL_HEIGHT, width, LABEL_HEIGHT);
  subjects.forEach((subject, index) => {
    const centreX = (index + 0.5) * spacingTiles * pxPerTile;
    placeCell(ctx, subject, centreX - pxPerTile / 2, LINEUP_HEADROOM_TILES * pxPerTile, pxPerTile);
    label(ctx, subject.label, centreX, height - 3);
  });
  return canvas;
}

function stack(canvases: readonly Canvas[]): Canvas {
  const width = Math.max(...canvases.map((c) => c.width)) + PADDING * 2;
  const height = canvases.reduce((sum, c) => sum + c.height + PADDING, PADDING);
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  let y = PADDING;
  for (const c of canvases) {
    ctx.drawImage(c, PADDING, y);
    y += c.height + PADDING;
  }
  return out;
}

function zoomed(source: Canvas, zoom: number): Canvas {
  const out = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function contextSubjects(): Subject[] {
  const robed = TOWN_CAST_LOOKS.find((look) => look.id === ROBED_RESIDENT_ID);
  if (robed === undefined) throw new Error(`no town cast look "${ROBED_RESIDENT_ID}"`);
  return [
    { label: 'Carl', def: HUMAN_FIGURE, state: 'idle', frame: 0 },
    { label: 'cultist', def: FIGURE, state: cultistStateName('idle', 'front'), frame: 0 },
    { label: 'side', def: FIGURE, state: cultistStateName('idle', 'side'), frame: 0 },
    { label: 'away', def: FIGURE, state: cultistStateName('idle', 'away'), frame: 0 },
    { label: 'cast', def: FIGURE, state: cultistStateName('cast', 'side'), frame: 1 },
    { label: 'cast', def: FIGURE, state: cultistStateName('cast', 'front'), frame: 1 },
    {
      label: 'merchant',
      def: townCastOutfitFigure(robed),
      state: townCastStateName('idle', 'down'),
      frame: 0,
    },
  ];
}

function rowSubjects(state: string): Subject[] {
  return Array.from({ length: frameCountOf(FIGURE, state) }, (_unused, frame) => ({
    label: `${frame}`,
    def: FIGURE,
    state,
    frame,
  }));
}

function write(name: string, canvas: Canvas): void {
  const path = `${OUT_DIR}/${PREFIX}-${name}.png`;
  writePreviewPng(path, canvas.toBuffer('image/png'));
  console.log(`  wrote ${path}`);
}

function main(): void {
  console.log('city elf cultist gates');
  const passed = runGates();

  const subjects = contextSubjects();
  const spacing = SIDE_BY_SIDE_SPACING_TILES;
  const inGame = lineup(subjects, TILE_SIZE, spacing, FLOOR);
  const inGameDark = lineup(subjects, TILE_SIZE, spacing, DARK_FLOOR);
  write(
    'context',
    stack([inGame, inGameDark, lineup(subjects, ENLARGED_PX_PER_TILE, spacing, DARK_FLOOR)]),
  );
  write('ingame', zoomed(stack([inGame, inGameDark]), PIXEL_ZOOM));
  const closeups = subjects.filter((subject) => subject.def === FIGURE);
  write('closeup', lineup(closeups, CLOSEUP_PX_PER_TILE, CLOSEUP_SPACING_TILES, FLOOR));

  if (!process.argv.includes('--context-only')) {
    const sheetRows: Canvas[] = [];
    for (const role of CULTIST_ROLES) {
      for (const view of CULTIST_VIEWS) {
        const state = cultistStateName(role, view);
        const frames = rowSubjects(state);
        sheetRows.push(lineup(frames, ENLARGED_PX_PER_TILE, ROW_SPACING_TILES, DARK_FLOOR));
        write(
          `strip-${state}`,
          stack([
            zoomed(lineup(frames, TILE_SIZE, ROW_SPACING_TILES, DARK_FLOOR), PIXEL_ZOOM),
            lineup(frames, ENLARGED_PX_PER_TILE, ROW_SPACING_TILES, FLOOR),
          ]),
        );
      }
    }
    write('sheet', stack(sheetRows));
  }

  if (!passed) process.exit(1);
}

main();
