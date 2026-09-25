/**
 * The Grave Bull's art gates.
 *
 * Measured against cells baked the way the runtime cache bakes them, plus the
 * pose stream for what needs no pixels. Failures accumulate so one run reports
 * everything, and a gate whose filter matches nothing fails rather than
 * passing on an empty loop.
 *
 * Run by the review harness: `npm run render:grave-bull`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  GRAVE_BULL_ACTION_VIEWS,
  GRAVE_BULL_CHARGE_FRAMES,
  GRAVE_BULL_DEATH_FRAMES,
  GRAVE_BULL_FIGURE,
  GRAVE_BULL_GROUND_Y,
  GRAVE_BULL_PAW_FRAMES,
  GRAVE_BULL_ROWS,
  GRAVE_BULL_TICKS_PER_FRAME,
  GRAVE_BULL_TILES_PER_CHARGE_CYCLE,
  GRAVE_BULL_TILES_PER_WALK_CYCLE,
  GRAVE_BULL_WALK_FRAMES,
  graveBullRow,
} from '../src/sprites/art/graveBullFigure.js';
import { GRAVE_BULL_SCALE } from '../src/sprites/art/graveBullArt.js';
import { cowFigure } from '../src/sprites/art/cowFigure.js';
import { COW_GORE_STATES } from '../src/sprites/art/cowGore.js';
import {
  GRAVE_BULL_DRAWN_STATES,
  GRAVE_BULL_GORE_PARTS,
  GRAVE_BULL_ARRIVAL_ROWS,
  GRAVE_BULL_ATTACK_ACTIONS,
  GRAVE_BULL_DEATH_ACTIONS,
} from '../src/sprites/graveBullSprite.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const SOLID_ALPHA = 128;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const TILE_SCALE = GRAVE_BULL_FIGURE.tileScale;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

const cells = new Map<string, Uint8ClampedArray>();

function cellRgba(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}.${state}[${frame}]`;
  const cached = cells.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  cells.set(key, data);
  return data;
}

function bull(state: string, frame: number): Uint8ClampedArray {
  return cellRgba(GRAVE_BULL_FIGURE, state, frame);
}

// ── B1 structure and reachable states ───────────────────────────────────────

function structureGates(): void {
  for (const failure of figureStructuralFailures(GRAVE_BULL_FIGURE, {
    // A loose bone is one small piece in a cell sized for a bull.
    sparseStates: [...GRAVE_BULL_GORE_PARTS],
  })) {
    fail('B1 structure', failure);
  }
  for (const failure of missingStateFailures(
    GRAVE_BULL_FIGURE,
    GRAVE_BULL_DRAWN_STATES,
    'drawGraveBullSprite',
  )) {
    fail('B1 states', failure);
  }
  for (const failure of missingStateFailures(
    GRAVE_BULL_FIGURE,
    GRAVE_BULL_GORE_PARTS,
    'the gore registry',
  )) {
    fail('B1 states', failure);
  }
  // Each warmed action, in every view it is painted in, spelt out here rather
  // than through the figure's own name builder so a drifted name is caught.
  const nameOf = (action: string, view: string): string =>
    view === 'front' ? action : `${action}_${view === 'side' ? 'side' : 'away'}`;
  const warmed = [
    ...GRAVE_BULL_ARRIVAL_ROWS.map((row) => nameOf(row.action, row.view)),
    ...[...GRAVE_BULL_ATTACK_ACTIONS, ...GRAVE_BULL_DEATH_ACTIONS].flatMap((action) =>
      GRAVE_BULL_ACTION_VIEWS[action].map((view) => nameOf(action, view)),
    ),
  ];
  for (const failure of missingStateFailures(GRAVE_BULL_FIGURE, warmed, 'the prewarm list')) {
    fail('B1 states', failure);
  }
}

// ── B2 size against a cow ───────────────────────────────────────────────────

const MIN_SIZE_RATIO = 1.12;
const MAX_SIZE_RATIO = 1.35;

function sizeGate(): void {
  const cow = cowFigure('holstein', 'adult');
  const cowBox = inkBoxOf(cow, 'idle_side', 0);
  const bullBox = inkBoxOf(GRAVE_BULL_FIGURE, 'idle_side', 0);
  if (cowBox === null || bullBox === null) {
    fail('B2 size', 'could not measure the cow or the bull edge-on');
    return;
  }
  // Length nose to rump is the size read of a big animal; the horns and the
  // chains would stand for height the body does not have.
  const ratio = (bullBox.maxX - bullBox.minX) / (cowBox.maxX - cowBox.minX);
  console.log(
    `  B2 the bull is ${ratio.toFixed(2)}× a cow's length (drawn at ${GRAVE_BULL_SCALE}×)`,
  );
  if (ratio < MIN_SIZE_RATIO || ratio > MAX_SIZE_RATIO) {
    fail(
      'B2 size',
      `the bull is ${ratio.toFixed(2)}× a cow's length; it must read as a bigger animal`,
    );
  }
}

// ── B3 stride sync ──────────────────────────────────────────────────────────

const STRIDE_TOLERANCE = 0.03;
const STRIDE_DECIMALS = 3;

/** Ground a planted fore hoof slides back per cycle, in tiles at the bull's size. */
function measuredTilesPerCycle(state: string, frames: number): number | null {
  const row = graveBullRow(state);
  if (row === undefined) return null;
  let travel = 0;
  let planted = 0;
  for (let f = 0; f < frames; f++) {
    const here = row.pose(f).frontL;
    const next = row.pose((f + 1) % frames).frontL;
    if (here.lift > 0 || next.lift > 0 || next.dx >= here.dx) continue;
    travel += here.dx - next.dx;
    planted++;
  }
  if (planted === 0) return null;
  return (travel / planted) * frames * GRAVE_BULL_SCALE;
}

function strideGate(): void {
  const cases: readonly (readonly [string, number, number])[] = [
    ['walk_side', GRAVE_BULL_WALK_FRAMES, GRAVE_BULL_TILES_PER_WALK_CYCLE],
    ['charge_side', GRAVE_BULL_CHARGE_FRAMES, GRAVE_BULL_TILES_PER_CHARGE_CYCLE],
  ];
  for (const [state, frames, declared] of cases) {
    const measured = measuredTilesPerCycle(state, frames);
    if (measured === null) {
      fail('B3 stride', `${state} has no planted frames to measure`);
      continue;
    }
    if (Math.abs(measured - declared) / declared > STRIDE_TOLERANCE) {
      fail(
        'B3 stride',
        `${state}'s planted hoof covers ${measured.toFixed(STRIDE_DECIMALS)} tiles a cycle but the ` +
          `runtime paces it at ${declared.toFixed(STRIDE_DECIMALS)}: the hooves would skate`,
      );
    }
  }
}

// ── B4 the ribcage glows, B5 no meat ────────────────────────────────────────

function isGlow(r: number, g: number, b: number): boolean {
  return b >= GLOW_MIN_BLUE && g >= GLOW_MIN_GREEN && b - r >= GLOW_BLUE_LEAD;
}
/** Lower than a raised ratkin's eye test: the ribcage's glow is seen through the dark of the wound. */
const GLOW_MIN_BLUE = 200;
const GLOW_MIN_GREEN = 170;
const GLOW_BLUE_LEAD = 12;
const MIN_RIB_GLOW = 20;
/** The barrel's band of the cell, as fractions of the bull's ink height. */
const BARREL_FROM = 0.25;
const BARREL_TO = 0.75;

function glowInBarrel(def: FigureDef, state: string): number {
  const data = cellRgba(def, state, 0);
  const box = inkBoxOf(def, state, 0);
  if (box === null) return 0;
  const top = box.minY + (box.maxY - box.minY) * BARREL_FROM;
  const bottom = box.minY + (box.maxY - box.minY) * BARREL_TO;
  const left = box.minX + (box.maxX - box.minX) * BARREL_FROM;
  const right = box.minX + (box.maxX - box.minX) * BARREL_TO;
  let n = 0;
  for (let y = Math.round(top); y <= bottom; y++) {
    for (let x = Math.round(left); x <= right; x++) {
      const i = (y * def.frameWidth + x) * CHANNELS;
      if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isGlow(data[i], data[i + 1], data[i + 2])) n++;
    }
  }
  return n;
}

/** Red flesh: what the cow's quarters are painted in, and what a carcass must not drop. */
function isMeat(r: number, g: number, b: number): boolean {
  return r - g >= MEAT_RED_LEAD && r - b >= MEAT_RED_LEAD && r >= MEAT_MIN_RED;
}
const MEAT_RED_LEAD = 60;
const MEAT_MIN_RED = 120;

function appearanceGates(): void {
  const glow = glowInBarrel(GRAVE_BULL_FIGURE, 'idle_side');
  const cowGlow = glowInBarrel(cowFigure('holstein', 'adult'), 'idle_side');
  console.log(`  B4 ribcage glow: bull ${glow} px, a living cow ${cowGlow} px`);
  if (glow < MIN_RIB_GLOW)
    fail('B4 glow', `only ${glow} glowing pixels in the barrel; the ribcage must burn blue`);
  if (cowGlow >= MIN_RIB_GLOW)
    fail('B4 glow', 'a living cow scores as glowing; the measure cannot tell them apart');

  for (const state of COW_GORE_STATES) {
    if (GRAVE_BULL_FIGURE.states.has(state))
      fail('B5 no meat', `the bull paints the cow's "${state}"`);
  }
  let meat = 0;
  let measured = 0;
  for (const part of GRAVE_BULL_GORE_PARTS) {
    const data = bull(part, 0);
    measured++;
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isMeat(data[i], data[i + 1], data[i + 2]))
        meat++;
    }
  }
  failUnlessMeasured('B5 no meat', measured, 'gore pieces');
  if (meat > 0)
    fail('B5 no meat', `the bull's pieces carry ${meat} pixels of red meat; it drops bones only`);
}

// ── B6 the paw telegraph ────────────────────────────────────────────────────

/** The charge's wind-up: the paw row must fill at least this many ticks. */
const PAW_TELEGRAPH_TICKS = 60;
const MIN_SNORT_PIXELS = 10;

function pawGate(): void {
  const ticks = GRAVE_BULL_PAW_FRAMES * GRAVE_BULL_TICKS_PER_FRAME.paw;
  if (ticks < PAW_TELEGRAPH_TICKS) {
    fail(
      'B6 paw',
      `the paw plays for ${ticks} ticks, under the ${PAW_TELEGRAPH_TICKS}-tick telegraph`,
    );
  }
  // The blue snort, outside the barrel: count glow above the ground in the
  // front half of the cell, over the row, less what the idle already has.
  const base = glowCount(bull('idle_side', 0));
  let best = 0;
  for (let f = 0; f < GRAVE_BULL_PAW_FRAMES; f++)
    best = Math.max(best, glowCount(bull('paw_side', f)) - base);
  if (best < MIN_SNORT_PIXELS)
    fail('B6 paw', `the paw shows no snort (${best} extra glowing pixels)`);
}

function glowCount(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] > 0 && isGlow(data[i], data[i + 1], data[i + 2])) n++;
  }
  return n;
}

// ── B7 loops and distinct frames, B8 death ──────────────────────────────────

const SEAM_MAX_OF_MEDIAN = 1.6;
const SEAM_MIN_OF_MEDIAN = 0.3;
const CHANNEL_STEP = 12;
const DEATH_HELD_FRAMES = 3;
/** A heap well under half its standing height; the skull's horn stands up out of it. */
const MAX_HEAP_TILES = 0.8;

function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += CHANNELS) {
    for (let c = 0; c < CHANNELS; c++) {
      if (Math.abs(a[i + c] - b[i + c]) >= CHANNEL_STEP) {
        n++;
        break;
      }
    }
  }
  return n;
}

function motionGates(): void {
  let measured = 0;
  for (const row of GRAVE_BULL_ROWS) {
    if (!row.loops) continue;
    const steps: number[] = [];
    for (let f = 1; f < row.frameCount; f++)
      steps.push(changed(bull(row.name, f - 1), bull(row.name, f)));
    const seam = changed(bull(row.name, row.frameCount - 1), bull(row.name, 0));
    const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)] ?? 0;
    measured++;
    if (median === 0) {
      fail('B7 loop', `${row.name} does not move`);
      continue;
    }
    const ratio = seam / median;
    if (ratio > SEAM_MAX_OF_MEDIAN || ratio < SEAM_MIN_OF_MEDIAN) {
      fail('B7 loop', `${row.name}'s seam is ${ratio.toFixed(2)}× its median step`);
    }
  }
  failUnlessMeasured('B7 loop', measured, 'looping rows');
  const report = distinctFrameFailures(GRAVE_BULL_FIGURE, bull, {
    repeatsOnPurpose: (state, earlier) =>
      state === 'death_side' && earlier >= GRAVE_BULL_DEATH_FRAMES - DEATH_HELD_FRAMES,
  });
  for (const failure of report.failures) fail('B7 distinct', failure);

  const last = bull('death_side', GRAVE_BULL_DEATH_FRAMES - 1);
  const before = bull('death_side', GRAVE_BULL_DEATH_FRAMES - 2);
  if (changed(last, before) > 0) fail('B8 death', 'the heap still moves into the held last frame');
  const box = inkBoxOf(GRAVE_BULL_FIGURE, 'death_side', GRAVE_BULL_DEATH_FRAMES - 1);
  const heap = box === null ? 0 : (GRAVE_BULL_GROUND_Y - box.minY) / TILE_SCALE;
  if (heap > MAX_HEAP_TILES)
    fail('B8 death', `the heap stands ${heap.toFixed(2)} tiles; it must collapse`);
}

// ── B9 budget ───────────────────────────────────────────────────────────────

function budgetGate(): void {
  const cell = GRAVE_BULL_FIGURE.frameWidth * GRAVE_BULL_FIGURE.frameHeight * BYTES_PER_PIXEL;
  let total = 0;
  let widest = 0;
  for (const [, declared] of GRAVE_BULL_FIGURE.states) {
    total += declared.frames * cell;
    widest = Math.max(widest, declared.frames * cell);
  }
  console.log(
    `  B9 widest row ${(widest / BYTES_PER_MEGABYTE).toFixed(2)} MB; every row warm ` +
      `${(total / BYTES_PER_MEGABYTE).toFixed(1)} MB`,
  );
  if (widest > figureByteBudgetFor(GRAVE_BULL_FIGURE))
    fail('B9 budget', 'the widest row outgrows the budget');
}

export function graveBullGateFailures(): string[] {
  failures.length = 0;
  structureGates();
  sizeGate();
  strideGate();
  appearanceGates();
  pawGate();
  motionGates();
  budgetGate();
  return [...failures];
}
