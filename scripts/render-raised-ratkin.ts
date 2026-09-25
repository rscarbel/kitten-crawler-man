/**
 * The Raised Ratkin's review harness. Runs the art gates first, then bakes a
 * contact sheet per look, and a mixed line-up of living villagers and raised
 * dead for the living-or-dead blind test.
 *
 *   npm run render:raised-ratkin
 *   npx tsx scripts/render-raised-ratkin.ts --look=shroud --scale=3 --row=rise
 *   npx tsx scripts/render-raised-ratkin.ts --mode=lineup --seed=4
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell, bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { raisedRatkinGateFailures } from './gates-raised-ratkin.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { RAISED_ROWS, RAISED_RATKIN_FIGURES } from '../src/sprites/art/raisedRatkinFigure.js';
import { RAISED_RATKIN_LOOKS, type RaisedRatkinLook } from '../src/sprites/art/raisedRatkinArt.js';
import { ratkinCastFigure } from '../src/sprites/art/ratkinCastFigure.js';
import type { RatkinCastId } from '../src/sprites/art/ratkin/cast.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 20;
const PADDING = 6;
const BACKDROP = '#55693f';
const LABEL_COLOR = '#f4efe4';
const LABEL_FONT = '13px sans-serif';
/** A 128 px cell drawn at a 32 px tile, which the art is painted at twice. */
const IN_GAME_SHRINK = 0.5;
const LINEUP_COLUMNS = 6;

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

function isLook(value: string): value is RaisedRatkinLook {
  return RAISED_RATKIN_LOOKS.some((look) => look === value);
}

function renderSheet(def: FigureDef, scale: number, only: string): Canvas {
  const rows = only === '' ? RAISED_ROWS : RAISED_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const baked = bakeFigureSheet(
    def,
    rows.map((row) => row.name),
  );
  const cellW = baked.frameWidth * scale;
  const cellH = baked.frameHeight * scale;
  const cols = Math.max(...rows.map((row) => row.frameCount));
  const canvas = createCanvas(
    Math.ceil(PADDING + cols * (cellW + PADDING)),
    Math.ceil(PADDING + rows.length * (cellH + LABEL_HEIGHT)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  rows.forEach((row, index) => {
    const y = PADDING + index * (cellH + LABEL_HEIGHT);
    const events = Object.entries(row.eventFrames ?? {})
      .map(([name, frame]) => `${name}@${frame}`)
      .join(' ');
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${row.name} — ${row.frameCount} frames ${events}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    for (let f = 0; f < row.frameCount; f++) {
      ctx.drawImage(
        baked.canvas,
        f * baked.frameWidth,
        index * baked.frameHeight,
        baked.frameWidth,
        baked.frameHeight,
        PADDING + f * (cellW + PADDING),
        y + LABEL_HEIGHT,
        cellW,
        cellH,
      );
    }
  });
  return canvas;
}

interface LineupEntry {
  readonly def: FigureDef;
  readonly state: string;
  readonly frame: number;
  readonly answer: string;
}

const LINEUP_VILLAGERS: readonly RatkinCastId[] = [
  'merrit',
  'sedge',
  'nella',
  'garn',
  'midge',
  'fenna',
  'hobb',
  'cricket',
  'elder_thistle',
];
const LIVING_STATES: readonly string[] = ['idle', 'walk_side', 'walk', 'idle_side', 'walk_away'];
const DEAD_STATES: readonly string[] = [
  'idle',
  'shamble_side',
  'shamble',
  'idle_side',
  'shamble_away',
  'claw',
  'idle_away',
];
const DEAD_PER_LOOK = 3;
const FRAME_SPREAD = 3;
const FRAMES_SAMPLED = 8;

/** A seeded shuffle, so a line-up can be re-drawn for a fresh reviewer. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  const next = (): number => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const LCG_MULTIPLIER = 9301;
const LCG_INCREMENT = 49297;
const LCG_MODULUS = 233280;

/**
 * Living villagers and raised dead mixed and numbered, each at the in-game
 * size and at 2× nearest-neighbour. The answer key is printed to the console,
 * never onto the image.
 */
function renderLineup(seed: number): Canvas {
  const entries: LineupEntry[] = [];
  LINEUP_VILLAGERS.forEach((id, i) => {
    entries.push({
      def: ratkinCastFigure(id),
      state: LIVING_STATES[i % LIVING_STATES.length],
      frame: (i * FRAME_SPREAD) % FRAMES_SAMPLED,
      answer: `living ${id}`,
    });
  });
  RAISED_RATKIN_LOOKS.forEach((look, i) => {
    const def = RAISED_RATKIN_FIGURES.get(look);
    if (def === undefined) throw new Error(`no figure for ${look}`);
    for (let k = 0; k < DEAD_PER_LOOK; k++) {
      entries.push({
        def,
        state: DEAD_STATES[(i * DEAD_PER_LOOK + k) % DEAD_STATES.length],
        frame: (k * FRAME_SPREAD * 2) % FRAMES_SAMPLED,
        answer: `dead ${look}`,
      });
    }
  });
  const order = shuffled(entries, seed);
  const first = order[0];
  const cell = first.def.frameWidth * IN_GAME_SHRINK;
  const band = LABEL_HEIGHT + cell + cell * 2 + PADDING;
  const rows = Math.ceil(order.length / LINEUP_COLUMNS);
  const canvas = createCanvas(LINEUP_COLUMNS * cell * 2, rows * band);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  order.forEach((entry, i) => {
    const x = (i % LINEUP_COLUMNS) * cell * 2;
    const y = Math.floor(i / LINEUP_COLUMNS) * band;
    const baked = bakeFigureCell(entry.def, entry.state, entry.frame);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(String(i + 1), x + PADDING, y + LABEL_HEIGHT - PADDING);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(baked, x + cell / 2, y + LABEL_HEIGHT, cell, cell);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, x, y + LABEL_HEIGHT + cell, cell * 2, cell * 2);
    console.log(`  ${i + 1}: ${entry.answer} (${entry.state})`);
  });
  return canvas;
}

function main(): void {
  if (process.argv.includes('--no-gates')) {
    console.log('Skipping the raised ratkin gates (--no-gates)…');
  } else {
    console.log('Gating the raised ratkin figures…');
    reportFigureGates('raised ratkin', raisedRatkinGateFailures());
  }
  const mode = parseFlag('mode', 'sheet');
  if (mode === 'lineup') {
    const seed = parseNumberFlag('seed', 1, 0, LCG_MODULUS);
    const out = parseFlag('out', `${PREVIEW_DIR}/raised-ratkin-lineup.png`);
    console.log(`Wrote ${writePreviewPng(out, renderLineup(seed).toBuffer('image/png'))}`);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const lookFlag = parseFlag('look', '');
  const chosen = lookFlag === '' ? RAISED_RATKIN_LOOKS : [lookFlag];
  for (const look of chosen) {
    if (!isLook(look))
      throw new Error(`--look=${look} is not one of ${RAISED_RATKIN_LOOKS.join(', ')}`);
    const def = RAISED_RATKIN_FIGURES.get(look);
    if (def === undefined) throw new Error(`no figure for ${look}`);
    const out = parseFlag('out', `${PREVIEW_DIR}/raised-ratkin-${look}.png`);
    console.log(
      `Wrote ${writePreviewPng(out, renderSheet(def, scale, only).toBuffer('image/png'))}`,
    );
  }
}

main();
