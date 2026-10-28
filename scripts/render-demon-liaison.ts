#!/usr/bin/env tsx
/**
 * Review harness and gates for the Demon Liaison (`demonLiaisonFigure.ts`).
 *
 * Runs the gates first, then writes:
 *   <out>/demon-liaison-sheet.png every row, enlarged to 96 px per tile (3x)
 *   <out>/demon-liaison-context.png   standing next to the human and town residents,
 *                                     at 32 px per tile and again enlarged 3x
 *   <out>/demon-liaison-ingame.png    the 32 px render blown up pixel-for-pixel, to
 *                                     judge what the game actually shows
 *   <out>/demon-liaison-strip-<row>.png  one animation row at 32 px and 3x
 *
 *   npm run render:demon-liaison
 *   npx tsx scripts/render-demon-liaison.ts --out=preview/late-items --prefix=demon-liaison-after
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakeFigureCell, frameCountOf } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  reportFigureGates,
} from './figureGates.js';
import { TILE_SIZE } from '../src/core/constants.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import { undressedHumanFigure } from '../src/sprites/art/humanFigure.js';
import { activeHumanLook } from '../src/sprites/humanSprite.js';
import { townCastOutfitFigure, townCastStateName } from '../src/sprites/art/townCastFigure.js';
import { TOWN_CAST_LOOKS } from '../src/sprites/person/townCastLooks.js';
import {
  DEMON_LIAISON_FIGURE,
  DEMON_LIAISON_ROLES,
  DEMON_LIAISON_VIEWS,
  demonLiaisonStateName,
} from '../src/sprites/art/demonLiaisonFigure.js';
import { DEMON_LIAISON_DRAWN_STATES } from '../src/sprites/demonLiaisonSprite.js';

function flagValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? fallback : arg.slice(prefix.length);
}

const OUT_DIR = flagValue('out', `${PREVIEW_DIR}/demon-liaison`);
const PREFIX = flagValue('prefix', 'demon-liaison');
const ENLARGED_PX_PER_TILE = TILE_SIZE * 3;
const PIXEL_ZOOM = 3;
/** Past the bake's own density, for reading parts: every cached pixel is several here. */
const CLOSEUP_PX_PER_TILE = TILE_SIZE * 6;
const BACKDROP = '#2f2a2e';
/** A mid-value town floor: the grey skin and dark shirt both have to separate from it. */
const FLOOR = '#6f665a';
const DARK_FLOOR = '#2c2826';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '11px sans-serif';
const LABEL_HEIGHT = 14;
const PADDING = 8;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const RESIDENT_IDS: readonly string[] = ['adult_guard', 'adult_merchant', 'adult_innkeeper'];

// ── Gates ────────────────────────────────────────────────────────────────────

/** Every row warm at once must fit his cache ceiling: a figure on screen keeps every row it plays warm. */
function budgetFailures(): string[] {
  const cellBytes =
    DEMON_LIAISON_FIGURE.frameWidth * DEMON_LIAISON_FIGURE.frameHeight * BYTES_PER_PIXEL;
  let cells = 0;
  for (const declared of DEMON_LIAISON_FIGURE.states.values()) cells += declared.frames;
  const bytes = cells * cellBytes;
  const budget = figureByteBudgetFor(DEMON_LIAISON_FIGURE);
  console.log(
    `  info every row warm: ${cells} cells, ${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB ` +
      `of ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
  );
  return bytes > budget ? ['every row warm at once overruns the figure cache ceiling'] : [];
}

function runGates(): boolean {
  const results = [
    reportFigureGates('structure', figureStructuralFailures(DEMON_LIAISON_FIGURE)),
    reportFigureGates(
      'drawn states',
      missingStateFailures(DEMON_LIAISON_FIGURE, DEMON_LIAISON_DRAWN_STATES, 'demonLiaisonSprite'),
    ),
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

/** Draws a subject's cell so its tile lands at (tileLeft, tileTop) at `pxPerTile`. */
function placeCell(
  ctx: NodeCtx,
  subject: Subject,
  tileLeft: number,
  tileTop: number,
  pxPerTile: number,
): void {
  const cell = bakeFigureCell(subject.def, subject.state, subject.frame);
  const scale = pxPerTile / subject.def.tileScale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    cell,
    tileLeft - subject.def.tileX * scale,
    tileTop - subject.def.tileY * scale,
    cell.width * scale,
    cell.height * scale,
  );
}

/** A row of subjects standing on one floor strip, spaced `spacingTiles` apart. */
function lineup(
  subjects: readonly Subject[],
  pxPerTile: number,
  spacingTiles: number,
  floor: string,
): Canvas {
  const headroomTiles = 2.2;
  const width = Math.ceil(subjects.length * spacingTiles * pxPerTile);
  const height = Math.ceil((headroomTiles + 1) * pxPerTile) + LABEL_HEIGHT;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, width, height - LABEL_HEIGHT);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, height - LABEL_HEIGHT, width, LABEL_HEIGHT);
  subjects.forEach((subject, index) => {
    const centreX = (index + 0.5) * spacingTiles * pxPerTile;
    placeCell(ctx, subject, centreX - pxPerTile / 2, headroomTiles * pxPerTile, pxPerTile);
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
  const looks = new Map(TOWN_CAST_LOOKS.map((look) => [look.id, look]));
  const residents = RESIDENT_IDS.map((id): Subject => {
    const look = looks.get(id);
    if (look === undefined) throw new Error(`no town cast look "${id}"`);
    return {
      label: id.replace('adult_', ''),
      def: townCastOutfitFigure(look),
      state: townCastStateName('idle', 'down'),
      frame: 0,
    };
  });
  return [
    { label: 'The human', def: undressedHumanFigure(activeHumanLook()), state: 'idle', frame: 0 },
    { label: 'Demon Liaison', def: DEMON_LIAISON_FIGURE, state: 'idle', frame: 0 },
    { label: 'side', def: DEMON_LIAISON_FIGURE, state: 'idle_side', frame: 0 },
    { label: 'away', def: DEMON_LIAISON_FIGURE, state: 'idle_away', frame: 0 },
    ...residents,
  ];
}

function rowSubjects(state: string): Subject[] {
  return Array.from({ length: frameCountOf(DEMON_LIAISON_FIGURE, state) }, (_unused, frame) => ({
    label: `${frame}`,
    def: DEMON_LIAISON_FIGURE,
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
  console.log('demon liaison gates');
  runGates();

  const onlyContext = process.argv.includes('--context-only');
  const subjects = contextSubjects();
  const inGame = lineup(subjects, TILE_SIZE, 1.6, FLOOR);
  const inGameDark = lineup(subjects, TILE_SIZE, 1.6, DARK_FLOOR);
  write('context', stack([inGame, inGameDark, lineup(subjects, ENLARGED_PX_PER_TILE, 1.6, FLOOR)]));
  write('ingame', zoomed(stack([inGame, inGameDark]), PIXEL_ZOOM));
  const closeups = subjects.filter((subject) => subject.def === DEMON_LIAISON_FIGURE);
  write('closeup', lineup(closeups, CLOSEUP_PX_PER_TILE, 1.5, FLOOR));
  if (onlyContext) return;

  const sheetRows: Canvas[] = [];
  for (const role of DEMON_LIAISON_ROLES) {
    for (const view of DEMON_LIAISON_VIEWS) {
      const state = demonLiaisonStateName(role, view);
      const frames = rowSubjects(state);
      sheetRows.push(lineup(frames, ENLARGED_PX_PER_TILE, 1.2, FLOOR));
      write(
        `strip-${state}`,
        stack([
          zoomed(lineup(frames, TILE_SIZE, 1.2, FLOOR), PIXEL_ZOOM),
          lineup(frames, ENLARGED_PX_PER_TILE, 1.2, FLOOR),
        ]),
      );
    }
  }
  write('sheet', stack(sheetRows));
}

main();
