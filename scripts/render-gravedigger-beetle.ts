/**
 * The Gravedigger Beetle line's review harness.
 *
 * Art has to be judged as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, to lint and to reading the drawing code. The contact sheet is
 * painted from the larva, pupa and adult figures the way the runtime cache
 * bakes them, and the art gates run as part of the render, so one
 * command answers both "does it still hold together" and "what does it look
 * like".
 *
 *   npm run render:gravedigger-beetle
 *   npx tsx scripts/render-gravedigger-beetle.ts --stage=adult
 *   npx tsx scripts/render-gravedigger-beetle.ts --stage=adult --row=bite_side --scale=6
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { gravediggerBeetleGateFailures } from './gates-gravedigger-beetle.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  ADULT_ROWS,
  GORE_STATES,
  GRAVEDIGGER_BEETLE_FIGURE,
  GRAVEDIGGER_LARVA_FIGURE,
  GRAVEDIGGER_PUPA_FIGURE,
  LARVA_ROWS,
  PUPA_ROWS,
  TILE_SCALE,
  type RowSpec,
} from '../src/sprites/art/gravediggerBeetleFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts; the art is painted at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 4;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The floor-2 grounds the line actually lives on, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#888e96', '#191720', '#8c8170'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

function backdropFor(index: number): string {
  return FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
}

type StageId = 'larva' | 'pupa' | 'adult';

interface StageSheet {
  readonly def: FigureDef;
  readonly rows: readonly RowSpec[];
  /** Single-frame states with no row of their own, shown after the rows. */
  readonly extraStates: readonly string[];
}

const STAGE_SHEETS = {
  larva: { def: GRAVEDIGGER_LARVA_FIGURE, rows: LARVA_ROWS, extraStates: [] },
  pupa: { def: GRAVEDIGGER_PUPA_FIGURE, rows: PUPA_ROWS, extraStates: [] },
  adult: { def: GRAVEDIGGER_BEETLE_FIGURE, rows: ADULT_ROWS, extraStates: GORE_STATES },
} as const satisfies Record<StageId, StageSheet>;

function isStageId(value: string): value is StageId {
  return value === 'larva' || value === 'pupa' || value === 'adult';
}

function renderSheetPanel(stage: StageSheet, outPath: string, scale: number, only: string): void {
  const { def } = stage;
  const poseStates = [...stage.rows.map((row) => row.name), ...stage.extraStates];
  const wanted = only === '' ? [] : only.split(',');
  const states = wanted.length === 0 ? poseStates : poseStates.filter((s) => wanted.includes(s));
  if (states.length === 0) throw new Error(`No row named "${only}"`);
  const sheet = bakeFigureSheet(def, states).canvas;
  const { frameWidth, frameHeight } = def;

  const cellW = frameWidth * scale;
  const cellH = frameHeight * scale;
  const framesOf = (state: string): number => {
    const declared = def.states.get(state);
    if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
    return declared.frames;
  };
  const maxCols = Math.max(...states.map(framesOf));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameWidth * inGameScale;
  const inGameH = frameHeight * inGameScale;

  const stripWidth = PADDING + states.length * (inGameW + PADDING);
  const canvas = createCanvas(
    Math.ceil(Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth)),
    Math.ceil(
      PADDING +
        states.length * (cellH + LABEL_HEIGHT + PADDING) +
        (inGameH + LABEL_HEIGHT + PADDING),
    ),
  );
  const ctx: SheetContext = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  states.forEach((state, index) => {
    const row = stage.rows.find((candidate) => candidate.name === state);
    const frames = framesOf(state);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} — ${frames} frames, ${row?.view ?? '?'}, ${row?.kind ?? '?'}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
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

function main(): void {
  // Ahead of the contact sheet rather than after it. The sheet is a
  // many-megapixel allocation, and measuring the art on the other side of one
  // made the pilot's centroid gate report a seam at twice its true width every
  // so often — a red gate on art nobody touched, which is the one thing that
  // teaches an agent to loosen a threshold.
  console.log('Gating the gravedigger beetle figures…');
  reportFigureGates('gravedigger beetle line', gravediggerBeetleGateFailures());

  const stageFlag = parseFlag('stage', '');
  const wanted: readonly StageId[] = isStageId(stageFlag)
    ? [stageFlag]
    : ['larva', 'pupa', 'adult'];
  if (stageFlag !== '' && !isStageId(stageFlag)) throw new Error(`no stage named "${stageFlag}"`);
  for (const id of wanted) {
    const stage = STAGE_SHEETS[id];
    renderSheetPanel(
      stage,
      parseFlag('out', `${PREVIEW_DIR}/${stage.def.id}-review.png`),
      parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE),
      parseFlag('row', ''),
    );
  }
}

main();
