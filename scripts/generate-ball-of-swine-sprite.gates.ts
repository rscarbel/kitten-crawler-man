/**
 * The bake gate for the Ball of Swine sheet, and the entry point
 * `npm run gen:ball-of-swine` runs.
 *
 * A sheet that fails a gate must never reach disk. This module bakes into
 * memory, measures the baked pixels, collects every defect it finds with the
 * number it measured and the limit it measured against, and only then lets the
 * generator write. Failures accumulate rather than throwing one at a time, so
 * one run reports everything that is wrong.
 *
 * Several gates here exist specifically to catch the ways the *previous* art
 * failed — a ball that was a third of the size its frame paid for, and a maroon
 * sphere with none of the pink flesh, tusks or evening wear the creature is
 * described by. Those are measurable, so they are measured.
 *
 * `--skip-manifest-gate` is the measure → paste → re-run escape hatch: after a
 * geometry change the manifest is knowingly stale for exactly one run.
 */

import { type Canvas, createCanvas, loadImage } from 'canvas';
import { pathToFileURL } from 'node:url';

import {
  type BakedSheet,
  ROWS,
  type RowSpec,
  SHEET_ROWS,
  TILE_SCALE,
  bake,
  manifestMismatch,
  writeSheet,
} from './generate-ball-of-swine-sprite.js';
import { BALL_RADIUS, BODY_REACH, LOBE_BOX_DRIFT } from './ballOfSwineArt.js';
import { ARENA_PLATE_LIGHT } from '../src/map/tiles/specialFloorTiles.js';

const SKIP_MANIFEST_GATE = process.argv.includes('--skip-manifest-gate');

const INK_ALPHA_THRESHOLD = 24;
const OPAQUE_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const MAX_ALPHA = 255;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

// ── Pixel helpers ────────────────────────────────────────────────────────────

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

async function decode(sheet: BakedSheet): Promise<Canvas> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function gridOf(canvas: Canvas): Grid {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

/**
 * A cell address on the sheet.
 *
 * States share sheet rows, so every read goes through `cellOf`, which asks the
 * state itself where it lives. Addressing a packed sheet by a state's index in
 * `ROWS` measures whichever state happens to be parked on that row instead.
 */
interface Cell {
  readonly col: number;
  readonly row: number;
}

function cellOf(row: RowSpec, frame: number): Cell {
  return { col: row.colOffset + frame, row: row.sheetRow };
}

function cellAlpha(grid: Grid, sheet: BakedSheet, cell: Cell): Uint8ClampedArray {
  const size = sheet.geometry.frameSize;
  const out = new Uint8ClampedArray(size * size);
  const baseX = cell.col * size;
  const baseY = cell.row * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] =
        grid.data[((baseY + y) * grid.width + baseX + x) * CHANNELS + ALPHA_OFFSET];
    }
  }
  return out;
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function pixelAt(grid: Grid, sheet: BakedSheet, cell: Cell, x: number, y: number): Rgba {
  const size = sheet.geometry.frameSize;
  const index = ((cell.row * size + y) * grid.width + cell.col * size + x) * CHANNELS;
  return {
    r: grid.data[index],
    g: grid.data[index + 1],
    b: grid.data[index + 2],
    a: grid.data[index + 3],
  };
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const EMPTY_INK: InkStats = {
  count: 0,
  centroidX: 0,
  centroidY: 0,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};

/**
 * Ink statistics over a cell, optionally cropped to a disc about its centre.
 *
 * The crop is how the gates separate the *body* from what the body throws off
 * itself: a slam's spray and a burst's debris legitimately fly clear of the ball,
 * and a measurement that counted them would report the body as off-centre or as
 * the wrong size. Because the crop is itself centred on the anchor, a genuinely
 * off-centre body still shows up as off-centre inside it.
 */
function inkStatsOf(
  alpha: Uint8ClampedArray,
  size: number,
  threshold = INK_ALPHA_THRESHOLD,
  cropRadius = Infinity,
): InkStats {
  const centre = size / 2;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (alpha[y * size + x] < threshold) continue;
      if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > cropRadius) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return EMPTY_INK;
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

/**
 * How far from the centre a pixel still counts as the ball rather than as spray.
 *
 * Read off the art module's own `BODY_REACH` declaration, which is the other half
 * of the same contract: the painters keep every thrown droplet outside it, so
 * anything inside is body.
 */
const BODY_RADIUS_PX = BODY_REACH * TILE_SCALE;

function bodyStatsOf(grid: Grid, sheet: BakedSheet, row: RowSpec, frame: number): InkStats {
  return inkStatsOf(
    cellAlpha(grid, sheet, cellOf(row, frame)),
    sheet.geometry.frameSize,
    INK_ALPHA_THRESHOLD,
    BODY_RADIUS_PX,
  );
}

/**
 * Fraction of a body's mass the robust span trims off each end.
 *
 * The plain ink box is decided by its single outermost pixel, so one droplet of
 * slam spray or one tusk tip moves it several pixels and reports a perfectly
 * centred body as lopsided. Trimming a fiftieth of the mass off each side gives a
 * span that tracks where the body *is* while still moving the moment the body
 * itself does.
 */
const SPAN_TRIM = 0.02;

interface Span {
  readonly low: number;
  readonly high: number;
}

const EMPTY_SPAN: Span = { low: 0, high: 0 };

/**
 * The extent of a body along one axis, ignoring the outermost `SPAN_TRIM` of its
 * mass at each end.
 */
function robustSpan(
  alpha: Uint8ClampedArray,
  size: number,
  axis: 'x' | 'y',
  cropRadius: number,
): Span {
  const centre = size / 2;
  const buckets = new Float64Array(size);
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = alpha[y * size + x];
      if (value < INK_ALPHA_THRESHOLD) continue;
      if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > cropRadius) continue;
      buckets[axis === 'x' ? x : y] += value;
      total += value;
    }
  }
  if (total === 0) return EMPTY_SPAN;

  const trim = total * SPAN_TRIM;
  let running = 0;
  let low = 0;
  for (let i = 0; i < size; i++) {
    running += buckets[i];
    if (running >= trim) {
      low = i;
      break;
    }
  }
  running = 0;
  let high = size - 1;
  for (let i = size - 1; i >= 0; i--) {
    running += buckets[i];
    if (running >= trim) {
      high = i;
      break;
    }
  }
  return { low, high };
}

/**
 * Total alpha in a cell.
 *
 * The measure for "how much creature is left", as against a pixel count: a body
 * coming apart spreads over *more* pixels while becoming less substantial, so a
 * count would report a dissolving corpse as growing.
 */
function alphaMassOf(alpha: Uint8ClampedArray): number {
  let mass = 0;
  for (const value of alpha) mass += value;
  return mass / MAX_ALPHA;
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== (b[i] >= INK_ALPHA_THRESHOLD)) differing++;
  }
  return differing;
}

/** Mean channel value of a `#rrggbb` string, on the same 0–255 scale as a pixel. */
function hexLightness(hex: string): number {
  const RADIX = 16;
  const CHANNELS_IN_HEX = 3;
  let total = 0;
  for (let channel = 0; channel < CHANNELS_IN_HEX; channel++) {
    total += parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), RADIX);
  }
  return total / CHANNELS_IN_HEX;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cellsOf(grid: Grid, sheet: BakedSheet, row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) =>
    cellAlpha(grid, sheet, cellOf(row, frame)),
  );
}

/**
 * The state a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than read out
 * of `ROWS`, so renaming a state would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing. A gate that cannot find its
 * subject must fail, not skip.
 */
function rowOf(name: string): RowSpec | null {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail('G0', `no state named "${name}" — a gate is guarding a state that no longer exists`);
    return null;
  }
  return row;
}

// ── Gates ────────────────────────────────────────────────────────────────────

/** G1 — no frame may paint on its own cell border, and none may be blank. */
function gateBorderClip(grid: Grid, sheet: BakedSheet): void {
  const size = sheet.geometry.frameSize;
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, cellOf(row, frame)), size);
      if (stats.count === 0) {
        fail('G1', `${row.name}[${frame}] painted nothing at all`);
        continue;
      }
      if (
        stats.minX === 0 ||
        stats.minY === 0 ||
        stats.maxX === size - 1 ||
        stats.maxY === size - 1
      ) {
        fail(
          'G1',
          `${row.name}[${frame}] paints on its cell border (ink box ${stats.minX}..${stats.maxX} × ` +
            `${stats.minY}..${stats.maxY} in a ${size}×${size} cell)`,
        );
      }
    }
  }
}

/**
 * How far a rotated frame's body mass may sit from the cell centre, in pixels.
 *
 * The tightest gate on the sheet and the one that matters most: the runtime
 * rotates the ball about the manifest anchor, which is the cell centre. Mass
 * centred anywhere else makes the ball orbit a point off its own axis, and the
 * wobble grows with the offset.
 *
 * Measured on the alpha centroid rather than on the ink box, because the box is
 * decided by whichever tusk happens to stick out furthest this frame while the
 * centroid tracks where the body actually is — and it is the body's apparent
 * centre that a viewer sees wobble. The box gets its own, looser limit below.
 */
const MAX_CENTROID_DRIFT_PX = 3;

/**
 * How far the body's robust span may sit off centre on a rotated frame.
 *
 * Derived from the lobe depth the art module declares rather than picked: the
 * silhouette's ripple is a deliberate asymmetry, so the limit has to be whatever
 * that ripple can produce. Tightened past this it would forbid the rippling the
 * creature is described by; loosened it would stop catching a genuinely
 * off-centre bake.
 */
const MAX_SPAN_DRIFT_PX = LOBE_BOX_DRIFT * TILE_SCALE;

/** G2 — the rotated states are concentric on the cell centre, because that is the pivot. */
function gateConcentric(grid: Grid, sheet: BakedSheet): void {
  const size = sheet.geometry.frameSize;
  const centre = sheet.geometry.anchor;
  let checked = 0;
  for (const row of ROWS) {
    if (!row.rotated) continue;
    checked++;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = bodyStatsOf(grid, sheet, row, frame);
      if (stats.count === 0) continue;
      const centroidDrift = Math.hypot(stats.centroidX - centre, stats.centroidY - centre);
      if (centroidDrift > MAX_CENTROID_DRIFT_PX) {
        fail(
          'G2',
          `${row.name}[${frame}]'s body mass is ${centroidDrift.toFixed(1)}px off the cell centre ` +
            `(limit ${MAX_CENTROID_DRIFT_PX}px); a rotated draw pivots on the anchor, so this wobbles`,
        );
      }
      const alpha = cellAlpha(grid, sheet, cellOf(row, frame));
      const across = robustSpan(alpha, size, 'x', BODY_RADIUS_PX);
      const down = robustSpan(alpha, size, 'y', BODY_RADIUS_PX);
      const spanDrift = Math.hypot(
        (across.low + across.high + 1) / 2 - centre,
        (down.low + down.high + 1) / 2 - centre,
      );
      if (spanDrift > MAX_SPAN_DRIFT_PX) {
        fail(
          'G2',
          `${row.name}[${frame}]'s body spans ${across.low}..${across.high} × ${down.low}..${down.high}, ` +
            `${spanDrift.toFixed(1)}px off the cell centre — more than the declared lobe depth can ` +
            `account for (limit ${MAX_SPAN_DRIFT_PX.toFixed(1)}px)`,
        );
      }
    }
  }
  if (checked === 0) {
    fail('G2', 'no state declares itself rotated, so the pivot constraint measured nothing');
  }
}

const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

/** G3 — a loop must not pop across its seam. */
function gateLoopClosure(grid: Grid, sheet: BakedSheet): void {
  let checked = 0;
  for (const row of ROWS) {
    if (row.kind !== 'loop') continue;
    checked++;
    const cells = cellsOf(grid, sheet, row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) continue;
    // Two limits, because a smooth cycle's own step distribution is not uniform:
    // judged against the median alone, a legitimately large-but-not-largest seam
    // fails while nothing is wrong with it.
    const allowed = Math.max(
      typical * LOOP_SEAM_LIMIT,
      Math.max(...steps) * LOOP_SEAM_VS_WORST_STEP,
    );
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a median ` +
          `step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  }
  // Selected by `kind` rather than by name, so a renamed `RowKind` would otherwise
  // leave this gate green having measured nothing at all.
  if (checked === 0) fail('G3', 'no state declares itself a loop, so no seam was measured');
}

/**
 * Least a roll frame must differ from its neighbour, as a fraction of the ball's
 * own ink area.
 *
 * A rolling ball whose surface does not move is the single most likely way this
 * sheet fails without looking broken in a contact sheet: the silhouette is a
 * circle either way, so only the members betray it.
 */
const MIN_ROLL_STEP_FRACTION = 0.012;

/** G4 — the roll state's surface has to actually travel. */
function gateRollTravels(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('roll');
  if (row === null) return;
  const cells = cellsOf(grid, sheet, row);
  const area = inkStatsOf(cells[0], sheet.geometry.frameSize).count;
  if (area === 0) return;
  for (let i = 0; i < cells.length; i++) {
    const next = (i + 1) % cells.length;
    const fraction = frameDelta(cells[i], cells[next]) / area;
    if (fraction < MIN_ROLL_STEP_FRACTION) {
      fail(
        'G4',
        `roll[${i}]→[${next}] moves ${(fraction * 100).toFixed(2)}% of the ball's ink (floor ` +
          `${(MIN_ROLL_STEP_FRACTION * 100).toFixed(1)}%); the surface is not rolling`,
      );
    }
  }
}

/**
 * How much the rolling silhouette's width may vary across the row, as a
 * fraction of its own mean.
 *
 * The ball is rigid. A silhouette that grows and shrinks as it turns reads as
 * breathing, and at speed as a strobe.
 */
const MAX_ROLL_SPAN_VARIANCE = 0.09;

/** G5 — a rigid ball keeps its size while it turns. */
function gateRollSilhouetteIsRigid(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('roll');
  if (row === null) return;
  const spans: number[] = [];
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(grid, sheet, row, frame);
    if (stats.count === 0) continue;
    spans.push(Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY));
  }
  if (spans.length === 0) return;
  const mean = spans.reduce((sum, span) => sum + span, 0) / spans.length;
  const spread = (Math.max(...spans) - Math.min(...spans)) / mean;
  if (spread > MAX_ROLL_SPAN_VARIANCE) {
    fail(
      'G5',
      `the rolling silhouette varies ${(spread * 100).toFixed(1)}% in width across the row ` +
        `(limit ${(MAX_ROLL_SPAN_VARIANCE * 100).toFixed(0)}%); a rigid ball does not breathe`,
    );
  }
}

/**
 * How far the baked ball may be from the diameter the art module declares.
 *
 * `BALL_RADIUS` is not decoration: the fight's contact radius, the arena's clear
 * lines and the creature's whole "almost fifteen feet" read are all priced
 * against it. The art the *previous* sheet baked filled about a third of its
 * frame, and nothing measured that.
 */
const MAX_DIAMETER_ERROR = 0.1;

/** G6 — the ball is the size the code says it is. */
function gateDeclaredSize(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('roll');
  if (row === null) return;
  const expected = BALL_RADIUS * 2 * TILE_SCALE;
  const spans: number[] = [];
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(grid, sheet, row, frame);
    if (stats.count === 0) continue;
    // The mean of the two axes: tusks break the outline on whichever side they
    // happen to be, and judging the diameter off the wider axis alone would read
    // a spur as growth of the body.
    spans.push((stats.maxX - stats.minX + stats.maxY - stats.minY) / 2);
  }
  if (spans.length === 0) return;
  const measured = spans.reduce((sum, span) => sum + span, 0) / spans.length;
  const error = Math.abs(measured - expected) / expected;
  if (error > MAX_DIAMETER_ERROR) {
    fail(
      'G6',
      `the ball bakes ${measured.toFixed(0)}px across against a declared ${expected.toFixed(0)}px ` +
        `(${(error * 100).toFixed(0)}% off, limit ${(MAX_DIAMETER_ERROR * 100).toFixed(0)}%)`,
    );
  }
}

/** Least of its own cell the widest frame of any state must span. */
const MIN_INK_SPAN = 0.6;

/** G7 — the frame envelope has to be justified by the art inside it. */
function gateInkSpan(grid: Grid, sheet: BakedSheet): void {
  const size = sheet.geometry.frameSize;
  let widest = 0;
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, cellOf(row, frame)), size);
      if (stats.count === 0) continue;
      widest = Math.max(widest, (stats.maxX - stats.minX) / size, (stats.maxY - stats.minY) / size);
    }
  }
  if (widest < MIN_INK_SPAN) {
    fail(
      'G7',
      `no frame spans more than ${(widest * 100).toFixed(0)}% of its cell (floor ` +
        `${(MIN_INK_SPAN * 100).toFixed(0)}%); shrink the envelope rather than paying for empty pixels`,
    );
  }
}

/**
 * Megapixel ceiling for the sheet.
 *
 * Every sheet in the game is preloaded at boot and stays resident, so a cell
 * grown to clear a gate costs memory for the whole session. This one is set just
 * above the sheet it replaces — 3.54 Mpx — because a rebuild is not allowed to be
 * a memory regression on top of everything else it is.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 4.2;
/** Least of the sheet's cells that must actually hold a frame. */
const MIN_PACKING_EFFICIENCY = 0.8;

/** G8 — the sheet stays inside its memory budget, and is packed rather than padded. */
function gateTextureSize(sheet: BakedSheet): void {
  const size = sheet.geometry.frameSize;
  const cells = sheet.columns * SHEET_ROWS;
  const megapixels = (cells * size * size) / 1_000_000;
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G8',
      `the sheet is ${megapixels.toFixed(2)} Mpx against a budget of ${TEXTURE_BUDGET_MEGAPIXELS} Mpx`,
    );
  }
  const used = ROWS.reduce((total, row) => total + row.frameCount, 0);
  const efficiency = used / cells;
  if (efficiency < MIN_PACKING_EFFICIENCY) {
    fail(
      'G8',
      `only ${used} of ${cells} cells hold a frame (${(efficiency * 100).toFixed(0)}%, floor ` +
        `${(MIN_PACKING_EFFICIENCY * 100).toFixed(0)}%); repack the states rather than paying for ` +
        `empty cells at boot`,
    );
  }
}

/** G9 — no two states may claim the same cell. */
function gatePackingIsDisjoint(sheet: BakedSheet): void {
  const claimed = new Map<string, string>();
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const cell = cellOf(row, frame);
      if (cell.col >= sheet.columns || cell.row >= SHEET_ROWS) {
        fail(
          'G9',
          `${row.name}[${frame}] is packed at row ${cell.row} col ${cell.col}, outside the ` +
            `${sheet.columns}×${SHEET_ROWS} sheet`,
        );
        continue;
      }
      const key = `${cell.row},${cell.col}`;
      const owner = claimed.get(key);
      if (owner !== undefined) {
        fail('G9', `${row.name}[${frame}] is packed on top of ${owner} at row ${cell.row} col ${cell.col}`);
        continue;
      }
      claimed.set(key, `${row.name}[${frame}]`);
    }
  }
}

/**
 * Least the wallowing body must be wider than tall.
 *
 * The vulnerable window is the only moment the crawler can trade damage, so it
 * has to be legible across the arena from the silhouette alone — not from the
 * health bar and not from a colour change.
 */
const MIN_WALLOW_SPREAD = 1.25;

/** G10 — the wallow is a different shape from the roll, not a recoloured one. */
function gateWallowIsDistinct(grid: Grid, sheet: BakedSheet): void {
  const wallow = rowOf('wallow');
  const roll = rowOf('roll');
  if (wallow === null || roll === null) return;

  const rollStats = bodyStatsOf(grid, sheet, roll, 0);
  const rollSpan = rollStats.maxX - rollStats.minX;

  for (let frame = 0; frame < wallow.frameCount; frame++) {
    const stats = bodyStatsOf(grid, sheet, wallow, frame);
    if (stats.count === 0) continue;
    const ratio = (stats.maxX - stats.minX) / Math.max(1, stats.maxY - stats.minY);
    if (ratio < MIN_WALLOW_SPREAD) {
      fail(
        'G10',
        `wallow[${frame}] is only ${ratio.toFixed(2)}× wider than tall (floor ${MIN_WALLOW_SPREAD}); ` +
          `the vulnerable state has to read from the silhouette`,
      );
    }
    if (stats.maxX - stats.minX <= rollSpan) {
      fail(
        'G10',
        `wallow[${frame}] spans ${stats.maxX - stats.minX}px against the roll's ${rollSpan}px; ` +
          `a collapsed mass spreads sideways`,
      );
    }
  }
}

/** Least the slam's hardest frame must be compressed along the impact axis. */
const MIN_SLAM_CRUSH = 1.15;

/** G11 — the slam actually compresses, which is the whole content of the state. */
function gateSlamCrushes(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('slam');
  if (row === null) return;
  let bestRatio = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = bodyStatsOf(grid, sheet, row, frame);
    if (stats.count === 0) continue;
    // Taller than wide: the art is authored with the wall lying to +X and the
    // runtime rotates it to the impact normal.
    bestRatio = Math.max(
      bestRatio,
      (stats.maxY - stats.minY) / Math.max(1, stats.maxX - stats.minX),
    );
  }
  if (bestRatio < MIN_SLAM_CRUSH) {
    fail(
      'G11',
      `the slam never gets taller than ${bestRatio.toFixed(2)}× its width (floor ${MIN_SLAM_CRUSH}); ` +
        `nothing in the state reads as an impact`,
    );
  }
}

/** G12 — the burst opens up and thins out, rather than looping in place. */
function gateBurstComesApart(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('burst');
  if (row === null) return;
  const size = sheet.geometry.frameSize;
  const firstCell = cellAlpha(grid, sheet, cellOf(row, 0));
  const lastCell = cellAlpha(grid, sheet, cellOf(row, row.frameCount - 1));
  const first = inkStatsOf(firstCell, size);
  const last = inkStatsOf(lastCell, size);
  if (first.count === 0 || last.count === 0) return;
  if (last.maxY - last.minY <= first.maxY - first.minY) {
    fail(
      'G12',
      `the burst ends ${last.maxY - last.minY}px tall against ${first.maxY - first.minY}px at the ` +
        `start; the halves are not separating`,
    );
  }
  const firstMass = alphaMassOf(firstCell);
  const lastMass = alphaMassOf(lastCell);
  if (lastMass >= firstMass) {
    fail(
      'G12',
      `the burst ends with ${lastMass.toFixed(0)} of opaque mass against ${firstMass.toFixed(0)} at ` +
        `the start; the body should be thinning out as it comes apart`,
    );
  }
}

/**
 * Most of an overlay cell that may be fully opaque.
 *
 * `shade` and `shadow` are composited over and under a rolling frame. An opaque
 * overlay does not tint the ball, it replaces it.
 */
const MAX_OVERLAY_OPAQUE_FRACTION = 0.02;

/** G13 — the overlay states are overlays. */
function gateOverlaysAreTranslucent(grid: Grid, sheet: BakedSheet): void {
  const size = sheet.geometry.frameSize;
  let checked = 0;
  for (const row of ROWS) {
    if (row.kind !== 'overlay') continue;
    checked++;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const alpha = cellAlpha(grid, sheet, cellOf(row, frame));
      const opaque = inkStatsOf(alpha, size, OPAQUE_ALPHA_THRESHOLD).count;
      const fraction = opaque / (size * size);
      if (fraction > MAX_OVERLAY_OPAQUE_FRACTION) {
        fail(
          'G13',
          `${row.name}[${frame}] is ${(fraction * 100).toFixed(1)}% fully opaque (limit ` +
            `${(MAX_OVERLAY_OPAQUE_FRACTION * 100).toFixed(0)}%); it would replace the ball, not light it`,
        );
      }
    }
  }
  // Same reason as G3: selected by `kind`, so it has to say when nothing matched.
  if (checked === 0) fail('G13', 'no state declares itself an overlay, so none was measured');
}

/**
 * G14 — the shade state carries a direction, and the shadow state sits underneath.
 *
 * The whole reason the lighting is a separate state is that it must not turn with
 * the ball. If it stopped being directional there would be no reason for the
 * state to exist, and if the shadow drifted off the bottom it would read as a
 * bruise instead of as ground contact.
 */
function gateShadeIsDirectional(grid: Grid, sheet: BakedSheet): void {
  const shade = rowOf('shade');
  const shadow = rowOf('shadow');
  const size = sheet.geometry.frameSize;
  const half = Math.floor(size / 2);

  if (shade !== null) {
    let litSum = 0;
    let litCount = 0;
    let darkSum = 0;
    let darkCount = 0;
    const cell = cellOf(shade, 0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const pixel = pixelAt(grid, sheet, cell, x, y);
        if (pixel.a < INK_ALPHA_THRESHOLD) continue;
        // Weighted by alpha: a bright pixel laid on at 10% is a tenth of a bright
        // pixel, and the two halves are compared on what they do to the flesh
        // underneath rather than on the colours they were mixed from.
        const luminance = ((pixel.r + pixel.g + pixel.b) / 3) * (pixel.a / MAX_ALPHA);
        if (x < half && y < half) {
          litSum += luminance;
          litCount++;
        } else if (x >= half && y >= half) {
          darkSum += luminance;
          darkCount++;
        }
      }
    }
    if (litCount === 0 || darkCount === 0) {
      fail('G14', 'the shade state does not cover both the lit and the shadowed quadrant');
    } else {
      const lit = litSum / litCount;
      const dark = darkSum / darkCount;
      if (lit <= dark) {
        fail(
          'G14',
          `the shade state's lit quadrant averages ${lit.toFixed(1)} against ${dark.toFixed(1)} in ` +
            `the shadowed one; it carries no direction, so it does not need to be its own state`,
        );
      }
    }
  }

  if (shadow !== null) {
    const stats = inkStatsOf(cellAlpha(grid, sheet, cellOf(shadow, 0)), size);
    if (stats.count > 0 && stats.centroidY <= sheet.geometry.anchor) {
      fail(
        'G14',
        `the ground shadow's centre sits at y=${stats.centroidY.toFixed(0)}, at or above the ball's ` +
          `own centre (${sheet.geometry.anchor}); it is not on the ground`,
      );
    }
  }
}

/**
 * Least the flesh may average, on a 0–255 lightness scale.
 *
 * Judged over the ball's inner disc rather than the whole silhouette: outlines,
 * eyes, hooves and black cloth are all *meant* to be dark, and averaging them in
 * with the hide measures how much detail the creature has rather than what colour
 * its skin is.
 */
const MIN_PINK_LIGHTNESS = 110;
/** Fraction of the radius the flesh sample is taken inside, away from the rim falloff. */
const FLESH_SAMPLE_RADIUS = 0.55;
/**
 * Least the whole silhouette may average, as a multiple of the arena floor.
 *
 * The other half of the same problem: a creature at the same value as the ground
 * it rolls on is a smudge at 32px however well drawn it is, and the arena's
 * grating is very dark.
 */
const MIN_FLOOR_CONTRAST = 2.2;
/**
 * Lightness of the arena floor the ball is seen against, read off the tile renderer
 * rather than copied.
 *
 * It was copied, and the floor was then rewritten in the same change — leaving the
 * gate demanding contrast against a colour the game had stopped drawing.
 */
const ARENA_FLOOR_LIGHTNESS = hexLightness(ARENA_PLATE_LIGHT);
const MIN_TUSK_PIXELS = 40;
const MIN_SEQUIN_PIXELS = 24;
const MIN_LINEN_PIXELS = 10;

/**
 * G15 — the creature the source describes is actually on the sheet.
 *
 * Three specific claims from the description, each measurable, each a way the art
 * this replaces failed:
 *
 *  - "rippling **pink** flesh" — the old sphere was maroon, and dark enough to
 *    disappear against the arena's steel floor.
 *  - "**tusks**" — bone, so much lighter than anything else on the body.
 *  - "scraps of tuxedos and **red sequin dresses**" — the sequins are the only
 *    saturated highlight on the creature, and the linen the only real value
 *    contrast in the black cloth. Without them the scraps read as holes.
 */
function gateDescribedCreature(grid: Grid, sheet: BakedSheet): void {
  const row = rowOf('roll');
  if (row === null) return;
  const size = sheet.geometry.frameSize;
  const centre = sheet.geometry.anchor;
  const fleshRadius = BALL_RADIUS * FLESH_SAMPLE_RADIUS * TILE_SCALE;

  let bodyCount = 0;
  let bodySum = 0;
  let fleshCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let tuskPixels = 0;
  let sequinPixels = 0;
  let linenPixels = 0;

  for (let frame = 0; frame < row.frameCount; frame++) {
    const cell = cellOf(row, frame);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const pixel = pixelAt(grid, sheet, cell, x, y);
        if (pixel.a < OPAQUE_ALPHA_THRESHOLD) continue;
        bodyCount++;
        bodySum += (pixel.r + pixel.g + pixel.b) / 3;
        if (Math.hypot(x - centre, y - centre) <= fleshRadius) {
          fleshCount++;
          sumR += pixel.r;
          sumG += pixel.g;
          sumB += pixel.b;
        }
        const lightest = Math.max(pixel.r, pixel.g, pixel.b);
        const darkest = Math.min(pixel.r, pixel.g, pixel.b);
        // Bone: bright and barely saturated. Linen: brighter still and bluer than
        // bone, which is what separates a dress shirt from a tusk.
        if (darkest > 178 && lightest - darkest < 46) tuskPixels++;
        if (pixel.b > 200 && pixel.g > 200 && lightest - darkest < 26) linenPixels++;
        // Sequins: saturated red well above the hide's own dusty pink.
        if (pixel.r > 190 && pixel.r - pixel.g > 95 && pixel.r - pixel.b > 80) sequinPixels++;
      }
    }
  }

  if (fleshCount === 0 || bodyCount === 0) {
    fail('G15', 'the roll state has no opaque pixels at all');
    return;
  }
  const meanR = sumR / fleshCount;
  const meanG = sumG / fleshCount;
  const meanB = sumB / fleshCount;
  const lightness = (meanR + meanG + meanB) / 3;
  if (lightness < MIN_PINK_LIGHTNESS) {
    fail(
      'G15',
      `the flesh averages a lightness of ${lightness.toFixed(0)} (floor ${MIN_PINK_LIGHTNESS}); ` +
        `"rippling pink flesh" cannot be this dark`,
    );
  }
  if (meanR <= meanG || meanR <= meanB) {
    fail(
      'G15',
      `the flesh averages rgb(${meanR.toFixed(0)}, ${meanG.toFixed(0)}, ${meanB.toFixed(0)}), which ` +
        `is not pink`,
    );
  }
  const contrast = bodySum / bodyCount / ARENA_FLOOR_LIGHTNESS;
  if (contrast < MIN_FLOOR_CONTRAST) {
    fail(
      'G15',
      `the whole body averages only ${contrast.toFixed(2)}× the arena floor's lightness (floor ` +
        `${MIN_FLOOR_CONTRAST}×); at 32px it reads as a smudge on the grating`,
    );
  }
  if (tuskPixels < MIN_TUSK_PIXELS) {
    fail(
      'G15',
      `only ${tuskPixels} bone-bright pixels across the roll state (floor ${MIN_TUSK_PIXELS}); the ` +
        `tusks are gone`,
    );
  }
  if (sequinPixels < MIN_SEQUIN_PIXELS) {
    fail(
      'G15',
      `only ${sequinPixels} saturated-red pixels across the roll state (floor ${MIN_SEQUIN_PIXELS}); ` +
        `the sequin dresses have stopped reading as clothing`,
    );
  }
  if (linenPixels < MIN_LINEN_PIXELS) {
    fail(
      'G15',
      `only ${linenPixels} dress-linen pixels across the roll state (floor ${MIN_LINEN_PIXELS}); the ` +
        `tuxedo scraps have stopped reading as clothing`,
    );
  }
}

/** G16 — a sheet whose manifest entry does not describe it renders as garbage. */
function gateManifest(sheet: BakedSheet): void {
  if (SKIP_MANIFEST_GATE) {
    console.log('  manifest gate skipped (--skip-manifest-gate)');
    return;
  }
  const mismatch = manifestMismatch(sheet);
  if (mismatch !== null) fail('G16', mismatch);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function runGates(): Promise<BakedSheet> {
  console.log('Gating the ball-of-swine bake…');
  const sheet = bake();
  const grid = gridOf(await decode(sheet));

  gateBorderClip(grid, sheet);
  gateConcentric(grid, sheet);
  gateLoopClosure(grid, sheet);
  gateRollTravels(grid, sheet);
  gateRollSilhouetteIsRigid(grid, sheet);
  gateDeclaredSize(grid, sheet);
  gateInkSpan(grid, sheet);
  gateTextureSize(sheet);
  gatePackingIsDisjoint(sheet);
  gateWallowIsDistinct(grid, sheet);
  gateSlamCrushes(grid, sheet);
  gateBurstComesApart(grid, sheet);
  gateOverlaysAreTranslucent(grid, sheet);
  gateShadeIsDirectional(grid, sheet);
  gateDescribedCreature(grid, sheet);
  gateManifest(sheet);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log('  all gates passed');
  return sheet;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  // The gated sheet is the one written. Baking a second time to write would put
  // bytes on disk that nothing measured, and the whole contract of this module is
  // that a sheet which failed a gate never reaches the filesystem.
  runGates()
    .then((sheet) => {
      writeSheet(sheet);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runGates };
