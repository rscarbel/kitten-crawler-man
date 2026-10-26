/**
 * How many baked figure cells are byte-identical to another cell of the same
 * figure, published as `globalThis.__perfDuplicateCells` on the `?perf` route.
 *
 * Held poses repeat a frame across a row, and every repeat is a cell's worth of
 * pixels that one shared surface could hold instead. Reading every cell back is
 * slow, so this is for a run that is not being timed.
 *
 * {@link findDuplicateCells} is pure so the headless report in
 * `scripts/report-duplicate-cells.ts` counts the same way.
 */

import { SURFACE_BYTES_PER_PIXEL, surfaceContext } from '../core/rendering/canvasSurface';
import { residentFigureCells } from '../sprites/figure/figureFrameCache';

/** One cell's pixels, RGBA in row order, as `getImageData` returns them. */
export interface CellPixels {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface FigureDuplicateCells {
  readonly figureId: string;
  readonly cells: number;
  /** Cells whose pixels match an earlier cell of the same figure exactly. */
  readonly duplicates: number;
  readonly bytes: number;
  /** What the duplicates hold, which sharing one surface per picture would give back. */
  readonly duplicateBytes: number;
}

interface DuplicateCellsReport {
  /** Largest saving first. */
  readonly figures: FigureDuplicateCells[];
  readonly cells: number;
  readonly duplicates: number;
  readonly bytes: number;
  readonly duplicateBytes: number;
}

/**
 * {@link DuplicateCellsReport} for the live cache, with what it could not
 * read: a zero-sized surface has no pixels to compare, and a gap between the
 * bytes read and what the cache charges itself means the readout missed
 * cells rather than that the cache holds few.
 */
interface ResidentDuplicateCellsReport extends DuplicateCellsReport {
  readonly unreadableCells: number;
  readonly cacheBytes: number;
}

declare global {
  var __perfDuplicateCells: (() => ResidentDuplicateCellsReport) | undefined;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const BYTES_PER_WORD = Uint32Array.BYTES_PER_ELEMENT;

interface CellWords {
  readonly width: number;
  readonly height: number;
  readonly words: Uint32Array;
}

function wordsOf(cell: CellPixels): Uint32Array {
  const { pixels } = cell;
  // A view needs a word-aligned offset; a pixel buffer handed over at an odd
  // offset is copied rather than refused.
  const aligned = pixels.byteOffset % BYTES_PER_WORD === 0 ? pixels : pixels.slice();
  return new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / BYTES_PER_WORD);
}

function mix(hash: number, word: number): number {
  return Math.imul(hash ^ word, FNV_PRIME) >>> 0;
}

/** FNV-1a over whole words with the size folded in, so a hash match is only a candidate. */
function hashCell(cell: CellWords): number {
  let hash = mix(mix(FNV_OFFSET_BASIS, cell.width), cell.height);
  for (const word of cell.words) hash = mix(hash, word);
  return hash;
}

function sameCell(a: CellWords, b: CellWords): boolean {
  if (a.width !== b.width || a.height !== b.height || a.words.length !== b.words.length) {
    return false;
  }
  for (let i = 0; i < a.words.length; i++) {
    if (a.words[i] !== b.words[i]) return false;
  }
  return true;
}

/** Counts the cells of one figure that repeat an earlier cell's pixels exactly. */
export function findDuplicateCells(
  figureId: string,
  cells: readonly CellPixels[],
): FigureDuplicateCells {
  const distinctByHash = new Map<number, CellWords[]>();
  let duplicates = 0;
  let bytes = 0;
  let duplicateBytes = 0;
  for (const cell of cells) {
    const cellBytes = cell.width * cell.height * SURFACE_BYTES_PER_PIXEL;
    bytes += cellBytes;
    const candidate: CellWords = { width: cell.width, height: cell.height, words: wordsOf(cell) };
    const hash = hashCell(candidate);
    const bucket = distinctByHash.get(hash);
    if (bucket === undefined) {
      distinctByHash.set(hash, [candidate]);
      continue;
    }
    if (bucket.some((seen) => sameCell(seen, candidate))) {
      duplicates += 1;
      duplicateBytes += cellBytes;
    } else {
      bucket.push(candidate);
    }
  }
  return { figureId, cells: cells.length, duplicates, bytes, duplicateBytes };
}

/** Totals a set of per-figure counts, largest saving first. */
export function summariseDuplicateCells(figures: FigureDuplicateCells[]): DuplicateCellsReport {
  const sorted = [...figures].sort((a, b) => b.duplicateBytes - a.duplicateBytes);
  let cells = 0;
  let duplicates = 0;
  let bytes = 0;
  let duplicateBytes = 0;
  for (const figure of sorted) {
    cells += figure.cells;
    duplicates += figure.duplicates;
    bytes += figure.bytes;
    duplicateBytes += figure.duplicateBytes;
  }
  return { figures: sorted, cells, duplicates, bytes, duplicateBytes };
}

/** The resident figure cache's cells, read back off their own surfaces. */
function residentDuplicateCells(): ResidentDuplicateCellsReport {
  const figures: FigureDuplicateCells[] = [];
  let unreadableCells = 0;
  let cacheBytes = 0;
  for (const { figureId, cells, bytes } of residentFigureCells()) {
    cacheBytes += bytes;
    const readable = cells.filter((cell) => cell.width > 0 && cell.height > 0);
    unreadableCells += cells.length - readable.length;
    const pixels = readable.map((cell) => ({
      width: cell.width,
      height: cell.height,
      pixels: surfaceContext(cell).getImageData(0, 0, cell.width, cell.height).data,
    }));
    figures.push(findDuplicateCells(figureId, pixels));
  }
  return { ...summariseDuplicateCells(figures), unreadableCells, cacheBytes };
}

export function installPerfDuplicateCells(): void {
  globalThis.__perfDuplicateCells = residentDuplicateCells;
}
