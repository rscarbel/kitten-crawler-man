/**
 * The Protective Shell's art gates.
 *
 * These three effects have no baked sheet to look at any more, so everything
 * the old bake would have shown a reviewer is asserted here against cells
 * painted from the figures themselves. The shell is almost entirely a
 * *relationship between frames* — a ring that grows, a border that pulses, a
 * ripple that fades as it travels — so most of what follows measures a row
 * across its whole length rather than any single cell.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the state it names fails
 * loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:protective-shell`.
 */

import { FIGURE_BYTE_BUDGET } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  MINI_SHELL_STATE,
  PROTECTIVE_SHELL_FIGURE,
  PROTECTIVE_SHELL_FIGURES,
  PROTECTIVE_SHELL_MINI_FIGURE,
  PROTECTIVE_SHELL_SHOCKWAVE_FIGURE,
  SHELL_ACTIVE_STATE,
  SHELL_APPEAR_FULL_POWER_STATE,
  SHELL_APPEAR_STATE,
  SHELL_BLANK_FRAMES,
  SHELL_EXPIRE_STATE,
  SHELL_FRAME_COUNT,
  SHELL_FULL_POWER_STATE,
  SHOCKWAVE_STATE,
  sweepFraction,
} from '../src/sprites/art/protectiveShellFigure.js';
import { missingStateFailures, nothingMeasuredFailures } from './figureGates.js';
import { figureStructuralFailures } from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;

const failures: string[] = [];

function fail(gate: string, message: string): void {
  failures.push(`${gate}: ${message}`);
}

/**
 * A gate whose filtered loop matched nothing passed without looking at
 * anything, which is indistinguishable from a pass and arrives by accident.
 */
function failUnlessMeasured(gate: string, measured: number, what: string): void {
  for (const message of nothingMeasuredFailures(measured, what)) fail(gate, message);
}

interface Cell {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const cellCache = new Map<string, Cell>();

function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}|${state}|${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(def, state, frame);
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const cell: Cell = { width: canvas.width, height: canvas.height, data: image.data };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

/** Alpha above which a pixel counts as ink rather than as the empty cell. */
const INK_ALPHA = 4;

interface RingMeasure {
  /** Distance from the anchor to the furthest ink, in cell pixels. */
  readonly outerRadius: number;
  /** The strongest alpha anywhere in the cell. */
  readonly peakAlpha: number;
  /** How many pixels carried ink at all. */
  readonly inkPixels: number;
}

function measureRing(def: FigureDef, state: string, frame: number): RingMeasure {
  const cell = cellOf(def, state, frame);
  let outerRadius = 0;
  let peakAlpha = 0;
  let inkPixels = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const alpha = alphaAt(cell, x, y);
      if (alpha <= INK_ALPHA) continue;
      inkPixels++;
      if (alpha > peakAlpha) peakAlpha = alpha;
      const radius = Math.hypot(x + PIXEL_CENTRE - def.tileX, y + PIXEL_CENTRE - def.tileY);
      if (radius > outerRadius) outerRadius = radius;
    }
  }
  return { outerRadius, peakAlpha, inkPixels };
}

/** A pixel's own centre, so a radius is measured from the middle of it. */
const PIXEL_CENTRE = 0.5;

/** Mean absolute alpha difference between two frames of a row, 0-255. */
function meanAlphaDelta(def: FigureDef, state: string, a: number, b: number): number {
  const first = cellOf(def, state, a);
  const second = cellOf(def, state, b);
  let total = 0;
  let pixels = 0;
  for (let i = ALPHA_OFFSET; i < first.data.length; i += CHANNELS) {
    total += Math.abs(first.data[i] - second.data[i]);
    pixels++;
  }
  return pixels === 0 ? 0 : total / pixels;
}

/** Every frame of a state that is not one of its declared blank endpoints. */
function paintedFrames(def: FigureDef, state: string): number[] {
  const blank = SHELL_BLANK_FRAMES.get(def.id)?.get(state);
  const frames: number[] = [];
  for (let frame = 0; frame < SHELL_FRAME_COUNT; frame++) {
    if (blank?.has(frame) === true) continue;
    frames.push(frame);
  }
  return frames;
}

// ── G1 — the shared structural gates ─────────────────────────────────────────

/**
 * How much of its cell each effect's widest frame has to fill.
 *
 * Lower than a creature's, and bought by geometry rather than waived: a ring is
 * inscribed in a square cell, so even a ring painted right out to the cell wall
 * could only ever cover π/4 of it, and these cells are padded past the ring on
 * top of that. G9 is what actually holds the cells honest, by re-measuring the
 * clear space each one keeps.
 */
const SHELL_MIN_INK_SHARE = 0.1;

function gateStructure(): void {
  let figuresMeasured = 0;
  for (const def of PROTECTIVE_SHELL_FIGURES) {
    const blankFrames = SHELL_BLANK_FRAMES.get(def.id);
    if (blankFrames === undefined) {
      fail('G1', `${def.id} declares no blank-frame table, so its fades are ungated`);
      continue;
    }
    figuresMeasured++;
    for (const message of figureStructuralFailures(def, {
      blankFrames,
      minInkAreaShare: SHELL_MIN_INK_SHARE,
    })) {
      fail('G1', message);
    }
  }
  failUnlessMeasured('G1', figuresMeasured, 'figures');
}

// ── G2 — every state name the runtime can ask for is one a figure paints ─────

const RUNTIME_STATES: ReadonlyArray<{
  readonly def: FigureDef;
  readonly names: readonly string[];
  readonly purpose: string;
}> = [
  {
    def: PROTECTIVE_SHELL_FIGURE,
    names: [
      SHELL_ACTIVE_STATE,
      SHELL_FULL_POWER_STATE,
      SHELL_APPEAR_STATE,
      SHELL_APPEAR_FULL_POWER_STATE,
      SHELL_EXPIRE_STATE,
    ],
    purpose: "SpellSystem's shell render and its cast prewarm",
  },
  {
    def: PROTECTIVE_SHELL_MINI_FIGURE,
    names: [MINI_SHELL_STATE],
    purpose: "SpellSystem's cat mini-shield",
  },
  {
    def: PROTECTIVE_SHELL_SHOCKWAVE_FIGURE,
    names: [SHOCKWAVE_STATE],
    purpose: "SpellSystem's expiry shockwave",
  },
];

function gateRuntimeStateNames(): void {
  let tablesChecked = 0;
  for (const { def, names, purpose } of RUNTIME_STATES) {
    tablesChecked++;
    for (const message of missingStateFailures(def, names, purpose)) fail('G2', message);
  }
  failUnlessMeasured('G2', tablesChecked, 'runtime state tables');
}

// ── G3 — a warm row still fits the cache ─────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * How many of the shell's rows have to be able to sit in the cache at once.
 *
 * A cast warms its appear row and the hold row it settles into, and the expiry
 * row joins them before the shell fades. The cat's shield and the shockwave are
 * separate figures with a ceiling each, so three is the worst case here.
 */
const ROWS_THAT_MUST_FIT_TOGETHER = 3;

/**
 * The ceiling for one warm row, taken from the cache's own per-figure ceiling
 * rather than picked. Importing the cache's constant is what stops this from
 * quietly becoming a different budget from the one the runtime enforces.
 */
const ROW_BUDGET_MEGABYTES = FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE / ROWS_THAT_MUST_FIT_TOGETHER;

/**
 * A warm row's resident bytes.
 *
 * The cell the cache keeps is the figure's declared cell at the bake scale, not
 * the supersampled surface it was composed on — that one is scratch and is
 * handed straight back — so the resident size does not carry the 4× the bake
 * costs momentarily.
 */
function warmRowMegabytes(def: FigureDef, frames: number): number {
  const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
  return (cellBytes * frames) / BYTES_PER_MEGABYTE;
}

function gateWarmRowBudget(): void {
  let statesMeasured = 0;
  for (const def of PROTECTIVE_SHELL_FIGURES) {
    let widestState = '';
    let widest = 0;
    let allRows = 0;
    for (const [state, declared] of def.states) {
      statesMeasured++;
      const megabytes = warmRowMegabytes(def, declared.frames);
      allRows += megabytes;
      if (megabytes > widest) {
        widest = megabytes;
        widestState = state;
      }
    }
    console.log(
      `  G3 warm row: ${def.id}.${widestState} is ${widest.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES.toFixed(0)} MB budget; readout only, every row warm at once ` +
        `would be ${allRows.toFixed(2)} MB of the ` +
        `${(FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE).toFixed(0)} MB per-figure ceiling, which ` +
        `nothing asserts because only ${ROWS_THAT_MUST_FIT_TOGETHER} of them are ever warm ` +
        'together',
    );
    if (widest > ROW_BUDGET_MEGABYTES) {
      fail(
        'G3',
        `${def.id}.${widestState} warms to ${widest.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES.toFixed(0)} MB`,
      );
    }
  }
  failUnlessMeasured('G3', statesMeasured, 'declared states');
}

// ── G4 — the shell expands into existence rather than popping up whole ───────

/**
 * The most of its final radius the first *visible* appear frame may already
 * have reached. The sweep starts the ring at a tenth of full size, so anything
 * near the finished radius this early means the growth has been flattened out
 * and the shell blinks on instead of inflating.
 */
const APPEAR_FIRST_VISIBLE_SHARE = 0.5;

/** Radii this close together count as the same, in cell pixels. */
const RADIUS_EPSILON = 0.5;

const APPEAR_STATES: readonly string[] = [SHELL_APPEAR_STATE, SHELL_APPEAR_FULL_POWER_STATE];

function gateAppearExpands(): void {
  let stepsChecked = 0;
  for (const state of APPEAR_STATES) {
    const frames = paintedFrames(PROTECTIVE_SHELL_FIGURE, state);
    if (frames.length < 2) {
      fail('G4', `${state} has ${frames.length} painted frames, too few to see it grow`);
      continue;
    }
    const radii = frames.map((frame) => measureRing(PROTECTIVE_SHELL_FIGURE, state, frame));
    const first = radii[0].outerRadius;
    const last = radii[radii.length - 1].outerRadius;
    if (first > last * APPEAR_FIRST_VISIBLE_SHARE) {
      fail(
        'G4',
        `${state} is already ${((first / last) * 100).toFixed(0)}% of its final radius on its ` +
          `first visible frame (${first.toFixed(1)} of ${last.toFixed(1)} px), so it pops ` +
          'rather than expanding',
      );
    }
    for (let i = 1; i < radii.length; i++) {
      stepsChecked++;
      if (radii[i].outerRadius > radii[i - 1].outerRadius + RADIUS_EPSILON) continue;
      fail(
        'G4',
        `${state} does not grow between painted frames ${frames[i - 1]} and ${frames[i]}: ` +
          `${radii[i - 1].outerRadius.toFixed(1)} → ${radii[i].outerRadius.toFixed(1)} px`,
      );
    }
    const held = measureRing(
      PROTECTIVE_SHELL_FIGURE,
      state === SHELL_APPEAR_STATE ? SHELL_ACTIVE_STATE : SHELL_FULL_POWER_STATE,
      0,
    );
    if (Math.abs(last - held.outerRadius) > RADIUS_EPSILON) {
      fail(
        'G4',
        `${state} finishes at ${last.toFixed(1)} px and the row it hands over to holds at ` +
          `${held.outerRadius.toFixed(1)} px, so the shell jumps as it finishes appearing`,
      );
    }
  }
  failUnlessMeasured('G4', stepsChecked, 'appear-row growth steps');
}

// ── G5 — the interior stays translucent ──────────────────────────────────────

/**
 * The most alpha the shell's interior may carry.
 *
 * The player fights *inside* this bubble: the whole ability is standing in it
 * while mobs are shoved off it, so an interior that goes even half-opaque hides
 * the fight it exists to protect. Measured at the anchor, which is the player's
 * own tile centre and the densest point of any concentric fill.
 */
const MAX_INTERIOR_ALPHA = 48;

const INTERIOR_STATES: ReadonlyArray<{ readonly def: FigureDef; readonly state: string }> = [
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_ACTIVE_STATE },
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_FULL_POWER_STATE },
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_APPEAR_STATE },
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_APPEAR_FULL_POWER_STATE },
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_EXPIRE_STATE },
  { def: PROTECTIVE_SHELL_MINI_FIGURE, state: MINI_SHELL_STATE },
];

function gateInteriorTranslucent(): void {
  let centresMeasured = 0;
  for (const { def, state } of INTERIOR_STATES) {
    for (const frame of paintedFrames(def, state)) {
      centresMeasured++;
      const cell = cellOf(def, state, frame);
      const alpha = alphaAt(cell, Math.floor(def.tileX), Math.floor(def.tileY));
      if (alpha <= MAX_INTERIOR_ALPHA) continue;
      fail(
        'G5',
        `${def.id}.${state}[${frame}] carries alpha ${alpha} at its centre, over the ` +
          `${MAX_INTERIOR_ALPHA} a bubble the player fights inside is held to`,
      );
    }
  }
  failUnlessMeasured('G5', centresMeasured, 'interior centres');
}

// ── G6 — the full-power shell reads as a different shell ─────────────────────

interface InkColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** The alpha-weighted mean colour of a cell's ink. */
function meanInkColor(def: FigureDef, state: string, frame: number): InkColor | null {
  const cell = cellOf(def, state, frame);
  let weight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < cell.data.length; i += CHANNELS) {
    const alpha = cell.data[i + ALPHA_OFFSET];
    if (alpha <= INK_ALPHA) continue;
    weight += alpha;
    red += cell.data[i + RED_OFFSET] * alpha;
    green += cell.data[i + GREEN_OFFSET] * alpha;
    blue += cell.data[i + BLUE_OFFSET] * alpha;
  }
  if (weight === 0) return null;
  return { red: red / weight, green: green / weight, blue: blue / weight };
}

/**
 * How far apart the two shells' mean ink colours have to sit, on a 0–255
 * channel scale.
 *
 * The full-power shell is the level-15 payoff and the only thing that tells the
 * player it is up: warm orange against cold blue. A player glancing at the
 * bubble has to know which one they are standing in without reading a number,
 * and these two rows are otherwise pixel-identical in shape.
 */
const MIN_VARIANT_COLOR_DISTANCE = 60;

function gateFullPowerReadsDifferent(): void {
  let framesCompared = 0;
  for (let frame = 0; frame < SHELL_FRAME_COUNT; frame++) {
    const standard = meanInkColor(PROTECTIVE_SHELL_FIGURE, SHELL_ACTIVE_STATE, frame);
    const full = meanInkColor(PROTECTIVE_SHELL_FIGURE, SHELL_FULL_POWER_STATE, frame);
    if (standard === null || full === null) {
      fail('G6', `one of the two active rows painted no ink at frame ${frame}`);
      continue;
    }
    framesCompared++;
    const distance = Math.hypot(
      standard.red - full.red,
      standard.green - full.green,
      standard.blue - full.blue,
    );
    if (distance >= MIN_VARIANT_COLOR_DISTANCE) continue;
    fail(
      'G6',
      `the standard and full-power shells differ by only ${distance.toFixed(1)} at frame ` +
        `${frame}, under the ${MIN_VARIANT_COLOR_DISTANCE} it takes to tell them apart`,
    );
  }
  failUnlessMeasured('G6', framesCompared, 'variant colour comparisons');
}

// ── G7 — the shockwave travels outward and spends itself doing it ────────────

function gateShockwaveTravels(): void {
  const frames = paintedFrames(PROTECTIVE_SHELL_SHOCKWAVE_FIGURE, SHOCKWAVE_STATE);
  let stepsChecked = 0;
  for (let i = 1; i < frames.length; i++) {
    stepsChecked++;
    const previous = measureRing(PROTECTIVE_SHELL_SHOCKWAVE_FIGURE, SHOCKWAVE_STATE, frames[i - 1]);
    const current = measureRing(PROTECTIVE_SHELL_SHOCKWAVE_FIGURE, SHOCKWAVE_STATE, frames[i]);
    if (current.outerRadius <= previous.outerRadius + RADIUS_EPSILON) {
      fail(
        'G7',
        `the shockwave does not travel between frames ${frames[i - 1]} and ${frames[i]}: ` +
          `${previous.outerRadius.toFixed(1)} → ${current.outerRadius.toFixed(1)} px`,
      );
    }
    if (current.peakAlpha >= previous.peakAlpha) {
      fail(
        'G7',
        `the shockwave does not fade between frames ${frames[i - 1]} and ${frames[i]}: ` +
          `peak alpha ${previous.peakAlpha} → ${current.peakAlpha}`,
      );
    }
  }
  failUnlessMeasured('G7', stepsChecked, 'shockwave steps');
}

// ── G8 — the hold rows pulse, and the sweep that drives them is honest ───────

/**
 * How much the border's strength has to vary across one hold cycle, on a 0–255
 * alpha scale.
 *
 * A shell that holds at a constant brightness reads as a flat decal stuck to
 * the floor; the pulse is the only thing that says it is a live field.
 */
const MIN_PULSE_ALPHA_SWING = 20;

/**
 * The mean alpha a step of the sweep has to move the cell, on the same scale.
 *
 * The quietest shipped step is the mini shield's 0.26 at a turning point of its
 * pulse and the human shell's 0.26; a floor an order of magnitude under that
 * catches the pulse aliasing into a freeze without firing on the slow ends of
 * the swing. This replaced a clause that compared the closing frame's peak alpha
 * against the opening frame's: `sweepFraction` runs 0 to 1 inclusive, so the two
 * are the same picture and the comparison was `X === X`.
 */
const MIN_SWEEP_STEP_ALPHA = 0.02;

/** Floating-point slack on a sweep that has to run exactly 0 to 1. */
const SWEEP_EPSILON = 1e-9;
const SWEEP_START = 0;
const SWEEP_END = 1;

const PULSING_STATES: ReadonlyArray<{ readonly def: FigureDef; readonly state: string }> = [
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_ACTIVE_STATE },
  { def: PROTECTIVE_SHELL_FIGURE, state: SHELL_FULL_POWER_STATE },
  { def: PROTECTIVE_SHELL_MINI_FIGURE, state: MINI_SHELL_STATE },
];

function gatePulse(): void {
  let rowsMeasured = 0;
  for (const { def, state } of PULSING_STATES) {
    const frames = paintedFrames(def, state);
    if (frames.length < SHELL_FRAME_COUNT) {
      fail('G8', `${def.id}.${state} paints ${frames.length} frames; a cycle needs all of them`);
      continue;
    }
    rowsMeasured++;
    const peaks = frames.map((frame) => measureRing(def, state, frame).peakAlpha);
    const swing = Math.max(...peaks) - Math.min(...peaks);
    if (swing < MIN_PULSE_ALPHA_SWING) {
      fail(
        'G8',
        `${def.id}.${state} swings only ${swing} in peak alpha across its cycle, under the ` +
          `${MIN_PULSE_ALPHA_SWING} it takes to read as a pulse`,
      );
    }
    for (let i = 1; i < frames.length; i++) {
      const step = meanAlphaDelta(def, state, frames[i - 1], frames[i]);
      if (step >= MIN_SWEEP_STEP_ALPHA) continue;
      fail(
        'G8',
        `${def.id}.${state} moves only ${step.toFixed(4)} of mean alpha between frames ` +
          `${frames[i - 1]} and ${frames[i]}, under the ${MIN_SWEEP_STEP_ALPHA} a live pulse ` +
          'shows — the swing has aliased into a freeze',
      );
    }
  }
  failUnlessMeasured('G8', rowsMeasured, 'pulsing rows');
}

/**
 * The sweep every row is sampled through has to run 0 to 1 in even steps.
 *
 * The pixel side cannot say this. `sweepFraction` is an inclusive sweep — frame
 * 0 at 0 and the last frame at 1 — so on a row whose pulse is one full period
 * the closing frame is a byte-for-byte repeat of the opening one, and any pixel
 * comparison between those two frames is a comparison of a picture with itself.
 * What is checkable is the mapping: a sweep that covers more or less than the
 * whole motion, or that samples it unevenly, stutters on every row at once.
 */
function gateSweepMapping(): void {
  const first = sweepFraction(0, SHELL_FRAME_COUNT);
  const last = sweepFraction(SHELL_FRAME_COUNT - 1, SHELL_FRAME_COUNT);
  if (Math.abs(first - SWEEP_START) > SWEEP_EPSILON) {
    fail('G8', `the sweep starts at ${first.toFixed(4)} rather than at ${SWEEP_START}`);
  }
  if (Math.abs(last - SWEEP_END) > SWEEP_EPSILON) {
    fail(
      'G8',
      `the sweep ends at ${last.toFixed(4)} rather than at ${SWEEP_END} over its ` +
        `${SHELL_FRAME_COUNT} frames, so every row stops short of its own motion or overruns it`,
    );
  }
  const firstStep = sweepFraction(1, SHELL_FRAME_COUNT) - first;
  let stepsMeasured = 0;
  for (let frame = 1; frame < SHELL_FRAME_COUNT; frame++) {
    stepsMeasured++;
    const step =
      sweepFraction(frame, SHELL_FRAME_COUNT) - sweepFraction(frame - 1, SHELL_FRAME_COUNT);
    if (Math.abs(step - firstStep) <= SWEEP_EPSILON) continue;
    fail(
      'G8',
      `the sweep advances ${step.toFixed(4)} into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled row stutters`,
    );
  }
  failUnlessMeasured('G8', stepsMeasured, 'sweep steps');
}

// ── G9 — every cell keeps the clear space it was sized with ──────────────────

/**
 * The clear space each cell keeps outside its widest ring, in cell pixels.
 *
 * These three cells were sized by hand and frozen by the parity run, so this is
 * not a rule they follow but a measurement of what each one actually has. It is
 * what catches art growing into its own padding: the structural gate only
 * speaks once the ink is already clipped, by which point the shell has a flat
 * edge on screen.
 */
const CELL_MARGINS: ReadonlyMap<string, number> = new Map([
  [PROTECTIVE_SHELL_FIGURE.id, 14],
  [PROTECTIVE_SHELL_MINI_FIGURE.id, 24],
  [PROTECTIVE_SHELL_SHOCKWAVE_FIGURE.id, 12],
]);

function gateCellMargin(): void {
  let cellsMeasured = 0;
  for (const def of PROTECTIVE_SHELL_FIGURES) {
    const required = CELL_MARGINS.get(def.id);
    if (required === undefined) {
      fail('G9', `${def.id} has no declared cell margin, so its padding is unchecked`);
      continue;
    }
    let tightest = Number.POSITIVE_INFINITY;
    let tightestAt = '';
    let cellsForThisFigure = 0;
    for (const [state] of def.states) {
      for (const frame of paintedFrames(def, state)) {
        cellsMeasured++;
        cellsForThisFigure++;
        // Square cell, centred anchor: the nearest wall is half the cell away.
        const margin = def.frameWidth / 2 - measureRing(def, state, frame).outerRadius;
        if (margin >= tightest) continue;
        tightest = margin;
        tightestAt = `${state}[${frame}]`;
      }
    }
    // Counted per figure as well as across all three: a figure whose every
    // frame was filtered out leaves `tightest` at infinity, which passes.
    failUnlessMeasured('G9', cellsForThisFigure, `cells for ${def.id}`);
    if (tightest >= required) continue;
    fail(
      'G9',
      `${def.id} leaves only ${tightest.toFixed(1)} px of clear space at ${tightestAt}, under ` +
        `the ${required} px its cell was sized with`,
    );
  }
  failUnlessMeasured('G9', cellsMeasured, 'cells for margin');
}

/** Every failure the shell's art gates found, in the order they were checked. */
export function protectiveShellGateFailures(): string[] {
  failures.length = 0;
  cellCache.clear();
  gateStructure();
  gateRuntimeStateNames();
  gateWarmRowBudget();
  gateAppearExpands();
  gateInteriorTranslucent();
  gateFullPowerReadsDifferent();
  gateShockwaveTravels();
  gatePulse();
  gateSweepMapping();
  gateCellMargin();
  return [...failures];
}
