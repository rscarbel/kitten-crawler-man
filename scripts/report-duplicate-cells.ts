/**
 * How many of each painted figure's cells are byte-identical to another cell
 * of the same figure, baked headless with every declared state and frame.
 *
 *   npm run report:duplicate-cells
 *
 * The figures are the paint bench's subjects, one per distinct id. Cells are
 * baked at the figure's declared size, the way the contact sheets are, while
 * the game bakes them at the render quality's scale; a smaller cell can only
 * merge frames that differ by less than a pixel, so the counts here are an
 * upper bound on what the game would find and the byte columns are at 1×.
 * `__perfDuplicateCells()` on the `?perf` route reads the real resident cells.
 *
 * A report, not a gate: it exits non-zero only when a figure cannot be baked.
 */

import { PAINT_BENCH_SUBJECTS } from '../src/dev/paintBenchSubjects.js';
import {
  findDuplicateCells,
  summariseDuplicateCells,
  type CellPixels,
  type FigureDuplicateCells,
} from '../src/dev/perfDuplicateCells.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { bakeFigureCell } from './figureSheet.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const BYTES_PER_KILOBYTE = 1024;
const KB_DECIMALS = 0;
const PERCENT = 100;
const PERCENT_DECIMALS = 1;
const NAME_COLUMN = 40;
const COUNT_COLUMN = 8;
const KB_COLUMN = 11;
const SHARE_COLUMN = 8;

function distinctFigures(): FigureDef[] {
  const byId = new Map<string, FigureDef>();
  for (const { def } of PAINT_BENCH_SUBJECTS) byId.set(def.id, def);
  return [...byId.values()];
}

function bakedCells(def: FigureDef): CellPixels[] {
  const cells: CellPixels[] = [];
  for (const [state, declared] of def.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      const cell = bakeFigureCell(def, state, frame);
      const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
      cells.push({ width: cell.width, height: cell.height, pixels: data });
    }
  }
  return cells;
}

function kilobytes(bytes: number): string {
  return (bytes / BYTES_PER_KILOBYTE).toFixed(KB_DECIMALS);
}

function share(part: number, whole: number): string {
  if (whole === 0) return '-';
  return `${((part / whole) * PERCENT).toFixed(PERCENT_DECIMALS)}%`;
}

function row(name: string, cells: string, dupes: string, kb: string, saved: string, pct: string) {
  return (
    name.padEnd(NAME_COLUMN) +
    cells.padStart(COUNT_COLUMN) +
    dupes.padStart(COUNT_COLUMN) +
    kb.padStart(KB_COLUMN) +
    saved.padStart(KB_COLUMN) +
    pct.padStart(SHARE_COLUMN)
  );
}

const figures: FigureDuplicateCells[] = [];
for (const def of distinctFigures()) {
  try {
    figures.push(findDuplicateCells(def.id, bakedCells(def)));
  } catch (error) {
    console.error(`  FAIL ${def.id} could not be baked: ${String(error)}`);
    process.exitCode = 1;
  }
}

const report = summariseDuplicateCells(figures);
console.log(row('figure', 'cells', 'dupes', 'KB @1x', 'saved KB', 'saved'));
for (const figure of report.figures) {
  console.log(
    row(
      figure.figureId,
      String(figure.cells),
      String(figure.duplicates),
      kilobytes(figure.bytes),
      kilobytes(figure.duplicateBytes),
      share(figure.duplicateBytes, figure.bytes),
    ),
  );
}
console.log(
  row(
    'total',
    String(report.cells),
    String(report.duplicates),
    kilobytes(report.bytes),
    kilobytes(report.duplicateBytes),
    share(report.duplicateBytes, report.bytes),
  ),
);
