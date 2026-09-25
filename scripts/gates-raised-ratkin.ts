/**
 * The Raised Ratkin's art gates, over all three looks.
 *
 * Measured against cells baked the way the runtime cache bakes them, plus the
 * pose stream for what needs no pixels. Failures accumulate so one run reports
 * everything, and a gate whose filter matches nothing fails rather than
 * passing on an empty loop.
 *
 * Run by the review harness: `npm run render:raised-ratkin`.
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
  CLAW_FRAMES,
  CLAW_IMPACT_FRAME,
  DEATH_FRAMES,
  RAISED_ORIGIN_Y,
  RAISED_RATKIN_FIGURES,
  RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE,
  RAISED_RATKIN_TILE_SCALE,
  RAISED_ROWS,
  RISE_FRAMES,
  SHAMBLE_FRAMES,
  RAISED_TICKS_PER_FRAME,
  raisedRiseFrame,
  raisedRow,
} from '../src/sprites/art/raisedRatkinFigure.js';
import { SKELETON_RISE_FRAMES } from '../src/sprites/skeletonTiming.js';
import { RAISED_RATKIN_LOOKS } from '../src/sprites/art/raisedRatkinArt.js';
import { RAT_KIN_SCALE } from '../src/sprites/art/ratKinFigure.js';
import { toeContactHeight, type FootPose } from '../src/sprites/art/ratKinArt.js';
import { ratkinCastFigure } from '../src/sprites/art/ratkinCastFigure.js';
import {
  RAISED_DRAWN_STATES,
  RAISED_ENGAGED_ACTIONS,
  RAISED_PREWARMED_ACTIONS,
} from '../src/sprites/raisedRatkinSprite.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const SOLID_ALPHA = 128;
const PERCENT = 100;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

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

function solidCount(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = ALPHA_OFFSET; i < data.length; i += CHANNELS) if (data[i] >= SOLID_ALPHA) n++;
  return n;
}

/** Solid pixels above a cell row. */
function solidAbove(def: FigureDef, data: Uint8ClampedArray, row: number): number {
  let n = 0;
  for (let y = 0; y < row; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      if (data[(y * def.frameWidth + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) n++;
    }
  }
  return n;
}

function looks(): { look: string; def: FigureDef }[] {
  return [...RAISED_RATKIN_FIGURES.entries()].map(([look, def]) => ({ look, def }));
}

// ── R1 structure, R2 reachable states ───────────────────────────────────────

function structureGates(): void {
  failUnlessMeasured('R1 structure', RAISED_RATKIN_FIGURES.size, 'figures');
  for (const { def } of looks()) {
    for (const failure of figureStructuralFailures(def)) fail('R1 structure', failure);
    for (const failure of missingStateFailures(
      def,
      RAISED_DRAWN_STATES,
      'drawRaisedRatkinSprite',
    )) {
      fail('R2 states', failure);
    }
    const warmed = [...RAISED_PREWARMED_ACTIONS, ...RAISED_ENGAGED_ACTIONS];
    for (const failure of missingStateFailures(def, warmed, 'the prewarm lists'))
      fail('R2 states', failure);
  }
}

// ── R3 stride sync, R4 the dragged foot ──────────────────────────────────────

/** A planted foot is on the floor to within this, in figure units. */
const PLANTED_TOLERANCE = 1e-3;
/** The dragged foot may clear the floor by at most this, anywhere in the cycle. */
const DRAG_CLEARANCE = 0.03;
/** The good foot has to actually step: its highest lift at least this. */
const MIN_STEP_LIFT = 0.08;
/** How far the measured stride may sit from the declared pace. */
const STRIDE_TOLERANCE = 0.03;
const STRIDE_DECIMALS = 4;
const LIFT_DECIMALS = 3;

function lowestPoint(foot: FootPose): number {
  return Math.max(foot.ball.y, toeContactHeight(foot));
}

function gaitGates(): void {
  const row = raisedRow('shamble_side');
  if (row === undefined) {
    fail('R3 stride', 'there is no shamble_side row to measure');
    return;
  }
  const scale = RAT_KIN_SCALE;
  let travel = 0;
  let planted = 0;
  let maxDragClearance = 0;
  let maxStepLift = 0;
  for (let f = 0; f < SHAMBLE_FRAMES; f++) {
    const pose = row.pose(f);
    const next = row.pose((f + 1) % SHAMBLE_FRAMES);
    const here = pose.nearFoot.ball;
    const there = next.nearFoot.ball;
    const onFloor = Math.abs(here.y) < PLANTED_TOLERANCE && Math.abs(there.y) < PLANTED_TOLERANCE;
    if (onFloor && there.x < here.x) {
      travel += here.x - there.x;
      planted++;
    }
    maxDragClearance = Math.max(maxDragClearance, -lowestPoint(pose.farFoot));
    maxStepLift = Math.max(maxStepLift, -pose.nearFoot.ball.y);
  }
  failUnlessMeasured('R3 stride', planted, 'planted frames of the good foot');
  if (planted > 0) {
    const perFrame = travel / planted;
    const perCycle = perFrame * SHAMBLE_FRAMES * scale;
    const drift =
      Math.abs(perCycle - RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE) /
      RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE;
    if (drift > STRIDE_TOLERANCE) {
      fail(
        'R3 stride',
        `the planted foot covers ${perCycle.toFixed(STRIDE_DECIMALS)} tiles a cycle but the shamble is paced at ` +
          `${RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE.toFixed(STRIDE_DECIMALS)}: the feet would skate`,
      );
    }
  }
  if (maxDragClearance > DRAG_CLEARANCE) {
    fail(
      'R4 drag',
      `the dragged foot lifts ${maxDragClearance.toFixed(LIFT_DECIMALS)} clear of the floor; it must be hauled along it`,
    );
  }
  if (maxStepLift < MIN_STEP_LIFT) {
    fail(
      'R4 drag',
      `the good foot only lifts ${maxStepLift.toFixed(LIFT_DECIMALS)}; the shamble has no step in it`,
    );
  }
}

// ── R5 the eyes glow, R6 the hunch ───────────────────────────────────────────

/**
 * The white-blue of a soul-light's core: saturated cloth (a blue shirt) is
 * blue-dominant too, but never this bright in every channel.
 */
function isGlowPixel(r: number, g: number, b: number): boolean {
  return b >= GLOW_MIN_BLUE && g >= GLOW_MIN_GREEN && b - r >= GLOW_BLUE_LEAD;
}
const GLOW_MIN_BLUE = 235;
const GLOW_MIN_GREEN = 170;
const GLOW_BLUE_LEAD = 12;
/** The glow must be found in the top of the figure, where the head is. */
const HEAD_SHARE = 0.35;
/**
 * One eye's white-blue core, in cell pixels: edge-on only one eye shows, and
 * its core is a few pixels across. A living villager scores none.
 */
const MIN_GLOW_PIXELS = 3;

function glowInHead(def: FigureDef, state: string): number {
  const data = cellRgba(def, state, 0);
  const box = inkBoxOf(def, state, 0);
  if (box === null) return 0;
  const bottom = box.minY + (box.maxY - box.minY) * HEAD_SHARE;
  let n = 0;
  for (let y = box.minY; y <= bottom; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const i = (y * def.frameWidth + x) * CHANNELS;
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (isGlowPixel(data[i], data[i + 1], data[i + 2])) n++;
    }
  }
  return n;
}

/** The dead stand at most this share of a living villager's height, edge-on. */
const MAX_HEIGHT_OF_LIVING = 0.9;

function crownRise(def: FigureDef, state: string, originY: number): number {
  const box = inkBoxOf(def, state, 0);
  return box === null ? 0 : (originY - box.minY) / RAISED_RATKIN_TILE_SCALE;
}

function appearanceGates(): void {
  let measured = 0;
  for (const { look, def } of looks()) {
    for (const state of ['idle', 'idle_side']) {
      measured++;
      const glow = glowInHead(def, state);
      if (glow < MIN_GLOW_PIXELS) {
        fail(
          'R5 eyes',
          `${look} ${state} shows ${glow} glowing pixels in its head; the dead eyes must burn blue`,
        );
      }
    }
  }
  failUnlessMeasured('R5 eyes', measured, 'heads');
  // The same measure on a living villager must find nothing, or the gate is
  // counting something every ratkin has.
  const living = ratkinCastFigure('merrit');
  const livingGlow = glowInHead(living, 'idle');
  console.log(`  R5 a living villager's head scores ${livingGlow} glowing pixels`);
  if (livingGlow >= MIN_GLOW_PIXELS) {
    fail(
      'R5 eyes',
      `a living villager scores ${livingGlow} glowing pixels; the measure cannot tell them apart`,
    );
  }
  const livingHeight = crownRise(living, 'idle_side', livingOriginY(living));
  for (const { look, def } of looks()) {
    const dead = crownRise(def, 'idle_side', RAISED_ORIGIN_Y);
    const share = dead / livingHeight;
    if (share > MAX_HEIGHT_OF_LIVING) {
      fail(
        'R6 hunch',
        `${look} stands ${(share * PERCENT).toFixed(0)}% of a living villager's height edge-on; ` +
          `the hunch must bring it under ${MAX_HEIGHT_OF_LIVING * PERCENT}%`,
      );
    }
  }
}

/** The cast's ground line, from its own tile anchor. */
function livingOriginY(def: FigureDef): number {
  const groundOffset = RAISED_ORIGIN_Y - (RAISED_RATKIN_FIGURES.get('smock')?.tileY ?? 0);
  return def.tileY + groundOffset;
}

// ── R7 the claw lands on its impact frame ───────────────────────────────────

function clawGate(): void {
  const def = RAISED_RATKIN_FIGURES.get('smock');
  if (def === undefined) {
    fail('R7 claw', 'there is no smock figure to measure');
    return;
  }
  let furthest = -1;
  let furthestFrame = -1;
  for (let f = 0; f < CLAW_FRAMES; f++) {
    const box = inkBoxOf(def, 'claw_side', f);
    if (box === null) continue;
    if (box.maxX > furthest) {
      furthest = box.maxX;
      furthestFrame = f;
    }
  }
  const declared = raisedRow('claw_side')?.eventFrames?.impact;
  if (declared !== CLAW_IMPACT_FRAME || Math.abs(furthestFrame - CLAW_IMPACT_FRAME) > 0) {
    fail(
      'R7 claw',
      `the claw reaches furthest on frame ${furthestFrame} but its impact is declared on ${declared}`,
    );
  }
}

// ── R8 rise, R9 death ───────────────────────────────────────────────────────

const RISE_FIRST_SHARE = 0.05;
const RISE_LAST_SHARE = 0.9;
/** Pixels above the ground line, clear of the broken earth at it. */
const GROUND_CLEARANCE_PX = 4;
const MAX_HEAP_TILES = 0.45;
const MAX_HELD_CHANGE = 0;

function riseAndDeathGates(): void {
  for (const { look, def } of looks()) {
    const groundRow = Math.round(RAISED_ORIGIN_Y) - GROUND_CLEARANCE_PX;
    const standing = solidAbove(def, cellRgba(def, 'idle', 0), groundRow);
    const first = solidAbove(def, cellRgba(def, 'rise', 0), groundRow);
    const last = solidAbove(def, cellRgba(def, 'rise', RISE_FRAMES - 1), groundRow);
    if (first > standing * RISE_FIRST_SHARE) {
      fail(
        'R8 rise',
        `${look} rise starts with ${first} of ${standing} pixels above ground; it must start buried`,
      );
    }
    if (last < standing * RISE_LAST_SHARE) {
      fail(
        'R8 rise',
        `${look} rise ends with ${last} of ${standing} pixels above ground; it must end standing`,
      );
    }
    const end = cellRgba(def, 'death', DEATH_FRAMES - 1);
    const before = cellRgba(def, 'death', DEATH_FRAMES - 2);
    let changed = 0;
    for (let i = 0; i < end.length; i++) if (end[i] !== before[i]) changed++;
    if (changed > MAX_HELD_CHANGE) {
      fail(
        'R9 death',
        `${look}'s death still moves into its held last frame (${changed} bytes differ)`,
      );
    }
    const box = inkBoxOf(def, 'death', DEATH_FRAMES - 1);
    const heap = box === null ? 0 : (RAISED_ORIGIN_Y - box.minY) / RAISED_RATKIN_TILE_SCALE;
    if (heap > MAX_HEAP_TILES) {
      fail('R9 death', `${look}'s heap stands ${heap.toFixed(2)} tiles; it must collapse`);
    }
    if (solidCount(end) === 0) fail('R9 death', `${look}'s death leaves nothing behind`);
  }
}

// ── R10 loops, R11 distinct frames ──────────────────────────────────────────

const SEAM_MAX_OF_MEDIAN = 1.6;
const SEAM_MIN_OF_MEDIAN = 0.3;
const CHANNEL_STEP = 12;

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

/** Death frames from which the heap has settled and holds. */
const DEATH_HELD_FRAMES = 3;
const DEATH_HELD_FROM = DEATH_FRAMES - DEATH_HELD_FRAMES;

function motionGates(): void {
  let measured = 0;
  for (const { look, def } of looks()) {
    for (const row of RAISED_ROWS) {
      if (!row.loops) continue;
      const steps: number[] = [];
      for (let f = 1; f < row.frameCount; f++) {
        steps.push(changed(cellRgba(def, row.name, f - 1), cellRgba(def, row.name, f)));
      }
      const seam = changed(cellRgba(def, row.name, row.frameCount - 1), cellRgba(def, row.name, 0));
      const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)] ?? 0;
      measured++;
      if (median === 0) {
        fail('R10 loop', `${look} ${row.name} does not move`);
        continue;
      }
      const ratio = seam / median;
      if (ratio > SEAM_MAX_OF_MEDIAN || ratio < SEAM_MIN_OF_MEDIAN) {
        fail('R10 loop', `${look} ${row.name}'s seam is ${ratio.toFixed(2)}× its median step`);
      }
    }
    const report = distinctFrameFailures(def, (state, frame) => cellRgba(def, state, frame), {
      repeatsOnPurpose: (state, earlier) => state === 'death' && earlier >= DEATH_HELD_FROM,
    });
    for (const failure of report.failures) fail('R11 distinct', failure);
  }
  failUnlessMeasured('R10 loop', measured, 'looping rows');
}

// ── R12 budget ──────────────────────────────────────────────────────────────

function budgetGate(): void {
  let all = 0;
  for (const { def } of looks()) {
    const cell = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let total = 0;
    let widest = 0;
    for (const [, declared] of def.states) {
      total += declared.frames * cell;
      widest = Math.max(widest, declared.frames * cell);
    }
    all += total;
    if (widest > figureByteBudgetFor(def))
      fail('R12 budget', `${def.id}'s widest row outgrows its budget`);
  }
  console.log(
    `  R12 every row of all ${RAISED_RATKIN_LOOKS.length} looks warm: ${(all / BYTES_PER_MEGABYTE).toFixed(1)} MB`,
  );
}

// ── R13 the rise fills the rising window ────────────────────────────────────

function riseTimingGate(): void {
  const last = raisedRiseFrame(SKELETON_RISE_FRAMES);
  const lastBeforeEnd = raisedRiseFrame(SKELETON_RISE_FRAMES - 1);
  if (last !== RISE_FRAMES - 1) {
    fail(
      'R13 rise timing',
      `the rising window ends on frame ${last} of ${RISE_FRAMES}; it must end standing`,
    );
  }
  if (lastBeforeEnd < RISE_FRAMES - 2) {
    fail(
      'R13 rise timing',
      `a tick before the window ends the rise is on frame ${lastBeforeEnd}; it would pop`,
    );
  }
  const held = RAISED_TICKS_PER_FRAME.rise * RISE_FRAMES;
  if (Math.abs(held - SKELETON_RISE_FRAMES) > RISE_TICKS_TOLERANCE) {
    fail(
      'R13 rise timing',
      `the rise is held for ${held} ticks but the rising window is ${SKELETON_RISE_FRAMES}`,
    );
  }
}

const RISE_TICKS_TOLERANCE = 1e-6;

export function raisedRatkinGateFailures(): string[] {
  failures.length = 0;
  structureGates();
  gaitGates();
  appearanceGates();
  clawGate();
  riseAndDeathGates();
  motionGates();
  budgetGate();
  riseTimingGate();
  return [...failures];
}
