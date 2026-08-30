#!/usr/bin/env tsx
/**
 * Review harness for the Protective Shell's three effects.
 *
 * Art has to be reviewed as an image, by something that only looks at the
 * image: every defect that has ever mattered on a figure in this project was
 * invisible to `typecheck`, `lint` and reading the drawing code, and visible
 * within seconds in a render. This is how that render gets made.
 *
 * The gates run first, ahead of the contact sheet, so nothing is measured on
 * the far side of a many-megapixel allocation.
 *
 * The default sheet is a contact sheet at review scale. `--mode=ingame` is the
 * one that answers the question the contact sheet cannot: a dome drawn over
 * floor rather than over a flat backdrop, at the size a player sees it, which
 * is the only way to judge whether the interior is still translucent enough to
 * fight inside.
 *
 *   npm run render:protective-shell
 *   npx tsx scripts/render-protective-shell.ts --mode=ingame
 *   npx tsx scripts/render-protective-shell.ts --scale=1 --row=appear
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import {
  MINI_SHELL_STATE,
  PROTECTIVE_SHELL_FIGURES,
  SHELL_ACTIVE_STATE,
  SHELL_APPEAR_STATE,
  SHELL_FULL_POWER_STATE,
  SHOCKWAVE_STATE,
  shellTileSizeFor,
} from '../src/sprites/art/protectiveShellFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { asGameContext } from './nodeGameContext.js';
import { bakeFigureSheet, figureStateNames } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { protectiveShellGateFailures } from './gates-protective-shell.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

installCanvasGlobals();

const MODES = ['sheet', 'ingame'] as const;
type Mode = (typeof MODES)[number];

const BACKDROP = '#1a1d22';
const LABEL_INK = '#e6ede6';
const LABEL_FONT = '14px sans-serif';
const CAPTION_FONT = '12px sans-serif';
const GRID_INK = 'rgba(255,255,255,0.10)';
const PANEL_PAD = 24;
const ROW_GAP = 10;
const LABEL_HEIGHT = 22;
const DEFAULT_SCALE = 0.5;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;

/** The tile size the game renders at, and the shell radius a mid-level cast has. */
const IN_GAME_TILE = 32;
const IN_GAME_SHELL_RADIUS_TILES = 5;
const MINI_SHELL_RADIUS_TILES = 2;
const SHOCKWAVE_RADIUS_TILES = 7;

interface Options {
  readonly mode: Mode;
  readonly out: string;
  readonly scale: number;
  readonly row: string | null;
}

function isMode(value: string): value is Mode {
  return MODES.some((mode) => mode === value);
}

function parseArgs(argv: readonly string[]): Options {
  let mode: Mode = 'sheet';
  let out: string | null = null;
  let scale = DEFAULT_SCALE;
  let row: string | null = null;
  for (const arg of argv) {
    const [flag, raw] = arg.split('=');
    if (raw === undefined) continue;
    if (flag === '--mode') {
      if (!isMode(raw)) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
      mode = raw;
    } else if (flag === '--out') out = raw;
    else if (flag === '--scale') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
        throw new Error(`--scale=${raw} is not a number between ${MIN_SCALE} and ${MAX_SCALE}`);
      }
      scale = value;
    } else if (flag === '--row') row = raw;
  }
  return { mode, out: out ?? `${PREVIEW_DIR}/protective-shell-${mode}.png`, scale, row };
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.fillStyle = LABEL_INK;
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

interface SheetRow {
  readonly def: FigureDef;
  readonly state: string;
  readonly image: Canvas;
  readonly rowIndex: number;
  readonly frames: number;
}

function sheetRows(options: Options): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const def of PROTECTIVE_SHELL_FIGURES) {
    const states = figureStateNames(def).filter(
      (state) => options.row === null || state === options.row,
    );
    if (states.length === 0) continue;
    const baked = bakeFigureSheet(def, states);
    states.forEach((state, rowIndex) => {
      rows.push({
        def,
        state,
        image: baked.canvas,
        rowIndex,
        frames: def.states.get(state)?.frames ?? 0,
      });
    });
  }
  if (rows.length === 0) {
    throw new Error(`--row=${options.row ?? ''} matched no state on any shell figure`);
  }
  return rows;
}

function renderSheetPanel(options: Options): Canvas {
  const rows = sheetRows(options);
  const columns = Math.max(...rows.map((row) => row.frames));
  const widest = Math.max(...rows.map((row) => row.def.frameWidth)) * options.scale;

  const width = PANEL_PAD * 2 + columns * (widest + ROW_GAP);
  const height =
    PANEL_PAD * 2 +
    rows.reduce(
      (sum, row) => sum + row.def.frameHeight * options.scale + LABEL_HEIGHT + ROW_GAP,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = PANEL_PAD;
  for (const row of rows) {
    const cell = row.def.frameWidth * options.scale;
    label(ctx, `${row.def.id}.${row.state} — ${row.frames} frames`, PANEL_PAD, y, CAPTION_FONT);
    const top = y + LABEL_HEIGHT;
    for (let frame = 0; frame < row.frames; frame++) {
      const x = PANEL_PAD + frame * (widest + ROW_GAP);
      ctx.drawImage(
        row.image,
        frame * row.def.frameWidth,
        row.rowIndex * row.def.frameHeight,
        row.def.frameWidth,
        row.def.frameHeight,
        x,
        top,
        cell,
        cell,
      );
      ctx.strokeStyle = GRID_INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, cell - 1, cell - 1);
    }
    y = top + cell + ROW_GAP;
  }
  return canvas;
}

const FLOOR_DARK = '#2a2622';
const FLOOR_LIGHT = '#332e29';
const FLOOR_GROUT = 'rgba(0,0,0,0.35)';
const PLAYER_INK = '#d8d2c4';
const PLAYER_RADIUS = 7;

/** A dungeon-ish floor, so the shell is judged over something rather than nothing. */
function paintFloor(ctx: Ctx, width: number, height: number): void {
  for (let y = 0; y < height; y += IN_GAME_TILE) {
    for (let x = 0; x < width; x += IN_GAME_TILE) {
      const checker = ((x / IN_GAME_TILE + y / IN_GAME_TILE) | 0) % 2 === 0;
      ctx.fillStyle = checker ? FLOOR_DARK : FLOOR_LIGHT;
      ctx.fillRect(x, y, IN_GAME_TILE, IN_GAME_TILE);
      ctx.strokeStyle = FLOOR_GROUT;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, IN_GAME_TILE - 1, IN_GAME_TILE - 1);
    }
  }
}

interface InGameSubject {
  readonly def: FigureDef;
  readonly state: string;
  readonly radiusTiles: number;
  readonly caption: string;
}

function inGameSubjects(): InGameSubject[] {
  const [shell, mini, shockwave] = PROTECTIVE_SHELL_FIGURES;
  return [
    {
      def: shell,
      state: SHELL_ACTIVE_STATE,
      radiusTiles: IN_GAME_SHELL_RADIUS_TILES,
      caption: 'active — the shell a player fights inside',
    },
    {
      def: shell,
      state: SHELL_FULL_POWER_STATE,
      radiusTiles: IN_GAME_SHELL_RADIUS_TILES,
      caption: 'full_power — level 15, has to read as a different shell',
    },
    {
      def: shell,
      state: SHELL_APPEAR_STATE,
      radiusTiles: IN_GAME_SHELL_RADIUS_TILES,
      caption: 'appear — has to inflate, not blink on',
    },
    {
      def: mini,
      state: MINI_SHELL_STATE,
      radiusTiles: MINI_SHELL_RADIUS_TILES,
      caption: "active — the cat's own shield",
    },
    {
      def: shockwave,
      state: SHOCKWAVE_STATE,
      radiusTiles: SHOCKWAVE_RADIUS_TILES,
      caption: 'expand — the expiry ring',
    },
  ];
}

const IN_GAME_STRIP_FRAMES = 4;

function renderInGamePanel(): Canvas {
  const subjects = inGameSubjects();
  const widest = Math.max(...subjects.map((s) => s.radiusTiles)) * IN_GAME_TILE * 2;
  const bandHeight = widest + LABEL_HEIGHT + ROW_GAP;
  const canvas = createCanvas(
    Math.ceil(PANEL_PAD * 2 + IN_GAME_STRIP_FRAMES * (widest + ROW_GAP)),
    Math.ceil(PANEL_PAD * 2 + subjects.length * bandHeight),
  );
  const ctx = canvas.getContext('2d');
  paintFloor(ctx, canvas.width, canvas.height);

  let y = PANEL_PAD;
  for (const subject of subjects) {
    label(ctx, `${subject.def.id}.${subject.state} — ${subject.caption}`, PANEL_PAD, y, LABEL_FONT);
    const top = y + LABEL_HEIGHT;
    const radiusPx = subject.radiusTiles * IN_GAME_TILE;
    const tileSize = shellTileSizeFor(subject.def, radiusPx);
    const drawn = (subject.def.frameWidth * tileSize) / subject.def.tileScale;
    const frames = subject.def.states.get(subject.state)?.frames ?? 0;
    const step = Math.max(1, Math.floor(frames / IN_GAME_STRIP_FRAMES));
    for (let i = 0; i < IN_GAME_STRIP_FRAMES; i++) {
      const centreX = PANEL_PAD + i * (widest + ROW_GAP) + widest / 2;
      const centreY = top + widest / 2;
      // The player stands at the anchor, and the whole point of the effect is
      // that they stay visible through it.
      ctx.fillStyle = PLAYER_INK;
      ctx.beginPath();
      ctx.arc(centreX, centreY, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      const painted = asGameContext(ctx);
      painted.save();
      painted.translate(centreX - drawn / 2, centreY - drawn / 2);
      painted.scale(tileSize / subject.def.tileScale, tileSize / subject.def.tileScale);
      subject.def.paintFrame(painted, subject.state, Math.min(i * step, frames - 1));
      painted.restore();
    }
    y = top + widest + ROW_GAP;
  }
  return canvas;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // Ahead of the contact sheet rather than after it: the sheet is a
  // many-megapixel allocation, and measuring art on the other side of one is
  // what made a sibling figure's gate report a defect on art nobody touched.
  console.log('Gating the protective shell figures…');
  reportFigureGates('protective-shell', protectiveShellGateFailures());

  const panel = options.mode === 'ingame' ? renderInGamePanel() : renderSheetPanel(options);
  const outPath = writePreviewPng(options.out, panel.toBuffer('image/png'));
  console.log(`  → ${outPath}  (${panel.width}×${panel.height})`);
}

main();
