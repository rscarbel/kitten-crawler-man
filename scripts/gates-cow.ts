/**
 * The cows' and calves' art gates.
 *
 * Pixel gates measure cells painted from the six figures exactly as the runtime
 * cache bakes them — supersampled and downsampled — so what is measured is what
 * the game blits. Pose-stream gates measure the choreography itself and need no
 * pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:cow`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import { CACHE_BYTE_BUDGET, figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  type CowPose,
  cowFrontFaceHeight,
  cowPollPoint,
  cowSideLegs,
  drawCowFrontHead,
} from '../src/sprites/art/cowArt.js';
import {
  COW_FIGURE_ENTRIES,
  COW_GORE_UNIT,
  type CowAction,
  type CowFigureEntry,
  type CowRowSpec,
  GAIT_SIZES,
  TILE_SCALE,
  WALK_SWING_SHARE,
  tilesPerCycle,
} from '../src/sprites/art/cowFigure.js';
import {
  COW_GORE_STATES,
  GORE_CENTRE_CORRECTION,
  goreCorrectionKey,
} from '../src/sprites/art/cowGore.js';
import {
  COW_BODY_PART_KEYS,
  COW_DRAWN_STATES,
  COW_GORE_PARTS,
  COW_PREWARMED_STATES,
} from '../src/sprites/cowSprite.js';
import {
  CALF_TILES_PER_TROT_CYCLE,
  CALF_TILES_PER_WALK_CYCLE,
  COW_TILES_PER_TROT_CYCLE,
  COW_TILES_PER_WALK_CYCLE,
} from '../src/sprites/cowTiming.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha above which a pixel is the animal rather than the soft contact shadow it
 * paints on the ground line. A ground gate measured against ordinary ink would
 * measure the shadow, which sits where the hooves ought to be whether or not
 * they are there.
 */
const SOLID_ALPHA_THRESHOLD = 200;
const GROUND_MEASURE_PAD = 64;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const PERCENT = 100;
const PIXEL_CENTRE = 0.5;
const TILE_DECIMALS = 6;
const OFFSET_DECIMALS = 4;
const RATIO_DECIMALS = 3;
/** Where on the scratch canvas the head's poll is placed, as a share of its height. */
const HEAD_POLL_SHARE = 0.3;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

function cellAlpha(entry: CowFigureEntry, state: string, frame: number): Uint8ClampedArray {
  const def = entry.figure;
  const key = `${def.id}:${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  const alpha = new Uint8ClampedArray(def.frameWidth * def.frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function inkCount(alpha: Uint8ClampedArray): number {
  let count = 0;
  for (const value of alpha) if (value >= INK_ALPHA_THRESHOLD) count++;
  return count;
}

function coverageDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBox(alpha: Uint8ClampedArray, width: number, height: number): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < INK_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * The lowest solid row, measured on a canvas padded well past the cell, so art
 * that has slipped off its anchor is measured rather than clipped away.
 */
function lowestSolidRowUnclipped(entry: CowFigureEntry, state: string, frame: number): number {
  const def = entry.figure;
  const canvas = createCanvas(
    def.frameWidth + GROUND_MEASURE_PAD * 2,
    def.frameHeight + GROUND_MEASURE_PAD * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(GROUND_MEASURE_PAD, GROUND_MEASURE_PAD);
  def.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      return y - GROUND_MEASURE_PAD;
    }
  }
  return Number.NaN;
}

function rowNamed(entry: CowFigureEntry, name: string, gateId: string): CowRowSpec | null {
  const row = entry.rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(
      gateId,
      `${entry.figure.id} has no row named "${name}" — a gate is guarding a row that no longer exists`,
    );
    return null;
  }
  return row;
}

function entryOf(figureId: string, gateId: string): CowFigureEntry | null {
  const entry = COW_FIGURE_ENTRIES.find((candidate) => candidate.figure.id === figureId);
  if (entry === undefined) fail(gateId, `no figure named "${figureId}"`);
  return entry ?? null;
}

/** One figure of each age, for gates whose subject is the choreography rather than a coat. */
const AGE_REPRESENTATIVES: readonly string[] = ['cow_holstein', 'calf_holstein'];

// ── C1 structure ─────────────────────────────────────────────────────────────

/**
 * C1 — every declared state paints every declared frame, nothing paints against
 * the cell edge, and the cell is not mostly empty. Gore pieces are exempt from
 * the fill check: a severed tail is meant to be thin in a cell sized for a cow.
 */
function gateStructure(): void {
  for (const entry of COW_FIGURE_ENTRIES) {
    for (const failure of figureStructuralFailures(entry.figure, {
      sparseStates: COW_GORE_STATES,
    })) {
      fail('C1', `${entry.figure.id}: ${failure}`);
    }
  }
}

// ── C2 the hooves stand on the tile ──────────────────────────────────────────

/**
 * How far a grounded frame's lowest solid pixel may sit from the bottom of the
 * animal's own tile box, in tiles. Measured against `tileY + tileScale` — the
 * box the runtime hangs a health bar off — rather than a ground line the
 * painter computes, because a reference derived from the constant under test
 * moves with it and passes for any value.
 */
const GROUND_BAND_TILES = 0.2;
/** Rows whose every frame has a hoof, a knee or a belly on the ground. */
const GROUNDED_ACTIONS: readonly string[] = [
  'idle',
  'walk',
  'graze',
  'trot',
  'flinch',
  'lie',
  'lie_down',
];

function gateGroundLine(): void {
  let framesMeasured = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    const tileBottom = entry.figure.tileY + TILE_SCALE;
    const band = GROUND_BAND_TILES * TILE_SCALE;
    for (const row of entry.rows) {
      if (!GROUNDED_ACTIONS.includes(row.action)) continue;
      for (let frame = 0; frame < row.frameCount; frame++) {
        const lowest = lowestSolidRowUnclipped(entry, row.name, frame);
        if (Number.isNaN(lowest)) {
          fail('C2', `${entry.figure.id} ${row.name}[${frame}] painted no solid pixel at all`);
          continue;
        }
        framesMeasured++;
        if (Math.abs(lowest - tileBottom) <= band) continue;
        fail(
          'C2',
          `${entry.figure.id} ${row.name}[${frame}] has its lowest solid pixel on row ${lowest}, ` +
            `${((lowest - tileBottom) / TILE_SCALE).toFixed(2)} tiles from the bottom of its tile ` +
            'box — the animal is not standing on the tile it occupies',
        );
      }
    }
  }
  failUnlessMeasured('C2', framesMeasured, 'grounded frames');
}

// ── C3 loops close, and nothing is frozen ────────────────────────────────────

/**
 * How much bigger a loop's wrap may be than its widest in-cycle step, and how
 * small it may be against its median step. The pair bands the seam: a ceiling
 * alone cannot see a row that ends on a repeat of its first frame.
 *
 * Re-derived from the shipped rows, which seam at 0.55–1.0 of their widest step
 * and at 0.8–2.0 of their median.
 */
const LOOP_WRAP_TOLERANCE = 1.15;
const MIN_LOOP_WRAP_SHARE = 0.5;
/**
 * The share of a frame's ink that must change between two adjacent loop frames.
 * An idle cow moves little — a chewing jaw, a swishing tail — so this is low,
 * but a pair of identical frames scores zero and is what an aliased cycle looks
 * like.
 */
const MIN_LOOP_STEP_SHARE = 0.004;
const LOOP_PHASE_EPSILON = 1e-9;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function gateLoops(): void {
  let loopsMeasured = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    for (const row of entry.rows) {
      if (row.kind !== 'loop') continue;
      loopsMeasured++;
      const label = `${entry.figure.id} ${row.name}`;
      // The half no pixel can reach: a row sampling more than one turn of its
      // cycle seams exactly as cleanly as one that closes.
      const step = row.pose(1).time - row.pose(0).time;
      const turns = step * row.frameCount;
      if (Math.abs(turns - 1) > LOOP_PHASE_EPSILON) {
        fail(
          'C3',
          `${label} covers ${turns} turns of its cycle over ${row.frameCount} frames rather than exactly one`,
        );
      }
      for (let frame = 2; frame < row.frameCount; frame++) {
        const thisStep = row.pose(frame).time - row.pose(frame - 1).time;
        if (Math.abs(thisStep - step) <= LOOP_PHASE_EPSILON) continue;
        fail(
          'C3',
          `${label} is sampled unevenly — it advances ${thisStep} into frame ${frame} but ${step} into frame 1`,
        );
        break;
      }
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(
          coverageDelta(cellAlpha(entry, row.name, frame - 1), cellAlpha(entry, row.name, frame)),
        );
      }
      const widest = Math.max(...steps);
      const typical = median(steps);
      const wrap = coverageDelta(
        cellAlpha(entry, row.name, row.frameCount - 1),
        cellAlpha(entry, row.name, 0),
      );
      if (wrap > widest * LOOP_WRAP_TOLERANCE) {
        fail(
          'C3',
          `${label} jumps ${wrap} px from its last frame to its first against a widest step of ${widest} — the loop does not close`,
        );
      } else if (wrap < typical * MIN_LOOP_WRAP_SHARE) {
        fail(
          'C3',
          `${label} moves only ${wrap} px from its last frame to its first against a median step of ${typical} — it ends on a repeat of its first frame`,
        );
      }
      const reference = inkCount(cellAlpha(entry, row.name, 0));
      const narrowest = Math.min(...steps, wrap);
      if (narrowest / reference < MIN_LOOP_STEP_SHARE) {
        fail(
          'C3',
          `${label} has two adjacent frames differing by ${((narrowest / reference) * PERCENT).toFixed(2)}% of its ink — the cycle has aliased into a hold`,
        );
      }
    }
  }
  failUnlessMeasured('C3', loopsMeasured, 'looping rows');
}

// ── C4 stride sync ───────────────────────────────────────────────────────────

/**
 * How closely the ground a planted hoof slides back over must match the frozen
 * tiles-per-cycle the runtime advances the gait by. The runtime carries the
 * sprite over the ground at exactly that rate, so any difference is a hoof
 * skating on the grass.
 */
const STRIDE_SYNC_TOLERANCE = 1e-6;

interface GaitCheck {
  readonly action: string;
  readonly tiles: number;
}

function gaitChecksFor(entry: CowFigureEntry): readonly GaitCheck[] {
  return entry.age === 'adult'
    ? [
        { action: 'walk_side', tiles: COW_TILES_PER_WALK_CYCLE },
        { action: 'trot_side', tiles: COW_TILES_PER_TROT_CYCLE },
      ]
    : [
        { action: 'walk_side', tiles: CALF_TILES_PER_WALK_CYCLE },
        { action: 'trot_side', tiles: CALF_TILES_PER_TROT_CYCLE },
      ];
}

type FootKey = 'frontL' | 'frontR' | 'hindL' | 'hindR';
const FEET: readonly FootKey[] = ['hindL', 'frontL', 'hindR', 'frontR'];

/**
 * C4 — measures the stance slide of every planted hoof, frame to frame, and
 * compares the ground a whole cycle covers against the frozen constant.
 */
function gateStrideSync(): void {
  let pairsMeasured = 0;
  for (const id of AGE_REPRESENTATIVES) {
    const entry = entryOf(id, 'C4');
    if (entry === null) continue;
    for (const check of gaitChecksFor(entry)) {
      const row = rowNamed(entry, check.action, 'C4');
      if (row === null) continue;
      for (let frame = 0; frame < row.frameCount; frame++) {
        const here = row.pose(frame);
        const next = row.pose((frame + 1) % row.frameCount);
        for (const foot of FEET) {
          if (here[foot].lift > 0 || next[foot].lift > 0) continue;
          const slide = next[foot].dx - here[foot].dx;
          pairsMeasured++;
          const measured = -slide * row.frameCount;
          if (Math.abs(measured - check.tiles) <= STRIDE_SYNC_TOLERANCE) continue;
          fail(
            'C4',
            `${entry.figure.id} ${row.name}[${frame}→${frame + 1}]: the planted ${foot} slides back ` +
              `${measured.toFixed(TILE_DECIMALS)} tiles per cycle but the runtime carries the sprite ` +
              `${check.tiles.toFixed(TILE_DECIMALS)} — the hoof skates; paste the measured value into cowTiming.ts`,
          );
        }
      }
    }
  }
  failUnlessMeasured('C4', pairsMeasured, 'planted hoof steps');
  // The constants are derived from the stride, never chosen: this is the same
  // arithmetic, so a reach changed without the constant is named here directly.
  const derived: ReadonlyArray<readonly [string, number, number]> = [
    [
      'COW_TILES_PER_WALK_CYCLE',
      tilesPerCycle(GAIT_SIZES.adult.walkReach, WALK_SWING_SHARE),
      COW_TILES_PER_WALK_CYCLE,
    ],
    [
      'CALF_TILES_PER_WALK_CYCLE',
      tilesPerCycle(GAIT_SIZES.calf.walkReach, WALK_SWING_SHARE),
      CALF_TILES_PER_WALK_CYCLE,
    ],
  ];
  for (const [name, expected, frozen] of derived) {
    if (Math.abs(expected - frozen) <= STRIDE_SYNC_TOLERANCE) continue;
    fail('C4', `${name} is frozen at ${frozen} but the walk's stride covers ${expected}`);
  }
}

// ── C5 the walk is a lateral sequence ────────────────────────────────────────

/** The footfall order cattle walk in: left hind, left fore, right hind, right fore. */
const LATERAL_ORDER: readonly FootKey[] = ['hindL', 'frontL', 'hindR', 'frontR'];

/** The frame each hoof leaves the ground on, or -1 when it never does. */
function liftOffFrames(row: CowRowSpec): Map<FootKey, number[]> {
  const liftOffs = new Map<FootKey, number[]>();
  for (const foot of FEET) {
    const frames: number[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      const before = row.pose((frame - 1 + row.frameCount) % row.frameCount)[foot].lift;
      const now = row.pose(frame)[foot].lift;
      if (before <= 0 && now > 0) frames.push(frame);
    }
    liftOffs.set(foot, frames);
  }
  return liftOffs;
}

/**
 * C5 — every hoof leaves the ground exactly once a cycle, in the order LH → LF →
 * RH → RF read cyclically, each a quarter cycle after the last. A trot's
 * diagonal pairs (LF with RH) must leave together instead.
 */
function gateGaitOrder(): void {
  let rowsMeasured = 0;
  for (const id of AGE_REPRESENTATIVES) {
    const entry = entryOf(id, 'C5');
    if (entry === null) continue;
    for (const view of ['walk', 'walk_side', 'walk_away']) {
      const row = rowNamed(entry, view, 'C5');
      if (row === null) continue;
      rowsMeasured++;
      const liftOffs = liftOffFrames(row);
      const firsts: number[] = [];
      for (const foot of LATERAL_ORDER) {
        const frames = liftOffs.get(foot) ?? [];
        if (frames.length !== 1) {
          fail(
            'C5',
            `${entry.figure.id} ${row.name}: ${foot} leaves the ground ${frames.length} times a cycle, not once`,
          );
          continue;
        }
        firsts.push(frames[0]);
      }
      if (firsts.length !== LATERAL_ORDER.length) continue;
      const quarter = row.frameCount / LATERAL_ORDER.length;
      for (let i = 1; i < firsts.length; i++) {
        const gap = (firsts[i] - firsts[i - 1] + row.frameCount) % row.frameCount;
        if (gap === quarter) continue;
        fail(
          'C5',
          `${entry.figure.id} ${row.name}: ${LATERAL_ORDER[i]} leaves the ground ${gap} frames after ` +
            `${LATERAL_ORDER[i - 1]}, not the ${quarter} a lateral-sequence walk (LH → LF → RH → RF) needs`,
        );
      }
    }
    const trot = rowNamed(entry, 'trot_side', 'C5');
    if (trot === null) continue;
    rowsMeasured++;
    const trotLifts = liftOffFrames(trot);
    for (const [a, b] of [
      ['frontL', 'hindR'],
      ['frontR', 'hindL'],
    ] as const) {
      const first = trotLifts.get(a) ?? [];
      const second = trotLifts.get(b) ?? [];
      if (first.length === 1 && second.length === 1 && first[0] === second[0]) continue;
      fail(
        'C5',
        `${entry.figure.id} trot_side: the diagonal pair ${a} and ${b} do not leave the ground together`,
      );
    }
  }
  failUnlessMeasured('C5', rowsMeasured, 'gait rows');
}

// ── C6 the ears read head-on ─────────────────────────────────────────────────

/**
 * How much wider the head's silhouette must be at its ears than at its muzzle.
 * Ears standing out sideways are what make a face seen straight on a cow's; the
 * same face with its ears tucked is a horse's or a deer's.
 */
const MIN_EAR_TO_MUZZLE = 1.6;
/** Share of the head's ink height, from the bottom, that counts as the muzzle. */
const MUZZLE_BAND_SHARE = 0.25;
const HEAD_MEASURE_SIZE = 256;
const HEAD_MEASURE_SCALE = 256;

function headWidths(pose: CowPose, entry: CowFigureEntry): { ears: number; muzzle: number } | null {
  const canvas = createCanvas(HEAD_MEASURE_SIZE, HEAD_MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.translate(HEAD_MEASURE_SIZE / 2, HEAD_MEASURE_SIZE * HEAD_POLL_SHARE);
  ctx.scale(HEAD_MEASURE_SCALE, HEAD_MEASURE_SCALE);
  drawCowFrontHead(
    asGameContext(ctx),
    pose,
    entry.look,
    { x: 0, y: 0 },
    cowFrontFaceHeight(pose, entry.look),
  );
  const { data } = ctx.getImageData(0, 0, HEAD_MEASURE_SIZE, HEAD_MEASURE_SIZE);
  const widthOf = (y: number): number => {
    let minX = HEAD_MEASURE_SIZE;
    let maxX = -1;
    for (let x = 0; x < HEAD_MEASURE_SIZE; x++) {
      if (data[(y * HEAD_MEASURE_SIZE + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD)
        continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    return maxX < 0 ? 0 : maxX - minX + 1;
  };
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < HEAD_MEASURE_SIZE; y++) {
    if (widthOf(y) === 0) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  if (top < 0) return null;
  const muzzleTop = Math.round(bottom - (bottom - top) * MUZZLE_BAND_SHARE);
  let ears = 0;
  for (let y = top; y < muzzleTop; y++) ears = Math.max(ears, widthOf(y));
  let muzzle = 0;
  for (let y = muzzleTop; y <= bottom; y++) muzzle = Math.max(muzzle, widthOf(y));
  return { ears, muzzle };
}

/** C6 — for every figure, over every frame of its head-on idle. */
function gateEarRead(): void {
  let framesMeasured = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    const row = rowNamed(entry, 'idle', 'C6');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const widths = headWidths(row.pose(frame), entry);
      if (widths === null || widths.muzzle === 0) {
        fail('C6', `${entry.figure.id} idle[${frame}]: the head painted nothing to measure`);
        continue;
      }
      framesMeasured++;
      const ratio = widths.ears / widths.muzzle;
      if (ratio >= MIN_EAR_TO_MUZZLE) continue;
      fail(
        'C6',
        `${entry.figure.id} idle[${frame}]: the head is ${widths.ears} px wide at its ears against ` +
          `${widths.muzzle} px at the muzzle (${ratio.toFixed(2)}×, minimum ${MIN_EAR_TO_MUZZLE}×) — ` +
          'the ears no longer stand out, and the face stops reading as a cow',
      );
    }
  }
  failUnlessMeasured('C6', framesMeasured, 'head-on frames');
}

// ── C7 gore ──────────────────────────────────────────────────────────────────

/** How far a piece's ink centre may sit from its cell's centre, in cell pixels. */
const GORE_CENTRE_TOLERANCE = 3;
/**
 * How much of the smaller piece's ink two pieces must differ by. A duplicated
 * piece scores zero; the closest shipped pair — the two ham pieces — sit well
 * above this.
 */
const MIN_PIECE_DISTINCTION_SHARE = 0.3;

/**
 * C7 — every gore piece stays inside the circle it spins through (a cell wide
 * enough but not tall enough shears a piece partway round a tumble), sits
 * centred in its cell so it tumbles rather than orbits, and differs from every
 * other piece.
 */
function gateGore(): void {
  let piecesMeasured = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    const def = entry.figure;
    const cx = def.frameWidth / 2;
    const cy = def.frameHeight / 2;
    const spinRadius = Math.min(cx, cy);
    for (const state of COW_GORE_STATES) {
      const alpha = cellAlpha(entry, state, 0);
      let worst = 0;
      let found = false;
      for (let y = 0; y < def.frameHeight; y++) {
        for (let x = 0; x < def.frameWidth; x++) {
          if (alpha[y * def.frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
          found = true;
          worst = Math.max(worst, Math.hypot(x + PIXEL_CENTRE - cx, y + PIXEL_CENTRE - cy));
        }
      }
      const box = inkBox(alpha, def.frameWidth, def.frameHeight);
      if (!found || box === null) {
        fail('C7', `${def.id} ${state} painted nothing`);
        continue;
      }
      piecesMeasured++;
      if (worst > spinRadius) {
        fail(
          'C7',
          `${def.id} ${state} reaches ${worst.toFixed(1)} px from its cell's centre, past the ${spinRadius} px it spins through — it is sheared partway round a tumble`,
        );
      }
      const offX = (box.minX + box.maxX + 1) / 2 - cx;
      const offY = (box.minY + box.maxY + 1) / 2 - cy;
      if (Math.hypot(offX, offY) > GORE_CENTRE_TOLERANCE) {
        const unit = COW_GORE_UNIT * entry.look.build.goreScale;
        const key = goreCorrectionKey(state, entry.look);
        const frozen = GORE_CENTRE_CORRECTION.get(key) ?? { x: 0, y: 0 };
        const pasteX = frozen.x + offX / unit;
        const pasteY = frozen.y + offY / unit;
        fail(
          'C7',
          `${def.id} ${state}'s ink is centred (${offX.toFixed(1)}, ${offY.toFixed(1)}) px off its ` +
            `cell's centre — it will orbit rather than tumble; freeze ['${key}', { x: ${pasteX.toFixed(OFFSET_DECIMALS)}, ` +
            `y: ${pasteY.toFixed(OFFSET_DECIMALS)} }] in GORE_CENTRE_CORRECTION`,
        );
      }
    }
    for (let a = 0; a < COW_GORE_STATES.length; a++) {
      for (let b = a + 1; b < COW_GORE_STATES.length; b++) {
        const first = cellAlpha(entry, COW_GORE_STATES[a], 0);
        const second = cellAlpha(entry, COW_GORE_STATES[b], 0);
        const smaller = Math.min(inkCount(first), inkCount(second));
        if (smaller === 0) continue;
        const share = coverageDelta(first, second) / smaller;
        if (share >= MIN_PIECE_DISTINCTION_SHARE) continue;
        fail(
          'C7',
          `${def.id} ${COW_GORE_STATES[a]} and ${COW_GORE_STATES[b]} differ by only ${(share * PERCENT).toFixed(1)}% — they cannot be told apart`,
        );
      }
    }
  }
  failUnlessMeasured('C7', piecesMeasured, 'gore pieces');
}

// ── C8 the runtime's own names ───────────────────────────────────────────────

/** C8 — every state name the runtime can build is one every figure paints, and back. */
function gateRuntimeStateNames(): void {
  for (const entry of COW_FIGURE_ENTRIES) {
    const def = entry.figure;
    for (const failure of missingStateFailures(
      def,
      COW_DRAWN_STATES,
      "cowSprite's COW_DRAWN_STATES",
    ))
      fail('C8', failure);
    for (const failure of missingStateFailures(def, COW_GORE_PARTS, "cowSprite's COW_GORE_PARTS"))
      fail('C8', failure);
    for (const failure of missingStateFailures(
      def,
      COW_PREWARMED_STATES,
      "cowSprite's COW_PREWARMED_STATES",
    ))
      fail('C8', failure);
    const reachable = new Set([...COW_DRAWN_STATES, ...COW_GORE_PARTS]);
    for (const row of entry.rows) {
      if (reachable.has(row.name)) continue;
      fail('C8', `${def.id} paints "${row.name}", which no runtime state name can reach`);
    }
  }
  const keys = new Set(COW_BODY_PART_KEYS);
  for (const entry of COW_FIGURE_ENTRIES) {
    if (keys.has(entry.figure.id)) continue;
    fail('C8', `${entry.figure.id} has no gore registry key, so its pieces never spawn`);
  }
}

// ── C9 the calf reads young ──────────────────────────────────────────────────

/** A calf is about 0.6 of an adult's length. */
const CALF_LENGTH_SHARE_MIN = 0.5;
const CALF_LENGTH_SHARE_MAX = 0.72;

/**
 * C9 — a calf is about 0.6 of an adult's painted length, carries a larger head
 * for its body than an adult does (fewer heads to its body length: a big head
 * is the baby read), and has no horns and no udder.
 */
function gateCalfReadsYoung(): void {
  let pairsMeasured = 0;
  for (const coat of ['holstein', 'jersey', 'dun']) {
    const adult = entryOf(`cow_${coat}`, 'C9');
    const calf = entryOf(`calf_${coat}`, 'C9');
    if (adult === null || calf === null) continue;
    pairsMeasured++;
    const widthOf = (entry: CowFigureEntry): number => {
      const box = inkBox(
        cellAlpha(entry, 'idle_side', 0),
        entry.figure.frameWidth,
        entry.figure.frameHeight,
      );
      return box === null ? 0 : box.maxX - box.minX;
    };
    const share = widthOf(calf) / Math.max(1, widthOf(adult));
    if (share < CALF_LENGTH_SHARE_MIN || share > CALF_LENGTH_SHARE_MAX) {
      fail(
        'C9',
        `calf_${coat} is ${share.toFixed(2)} of the adult's length in profile, outside ${CALF_LENGTH_SHARE_MIN}–${CALF_LENGTH_SHARE_MAX}`,
      );
    }
    const headsOf = (entry: CowFigureEntry): number =>
      (entry.look.build.bodyHalfLength * 2) / entry.look.build.headLength;
    if (headsOf(calf) >= headsOf(adult)) {
      fail(
        'C9',
        `calf_${coat} carries ${headsOf(calf).toFixed(2)} heads to its body length against the adult's ${headsOf(adult).toFixed(2)} — its head is not big for its body, and it reads as a small cow rather than a calf`,
      );
    }
    if (calf.look.horns !== null) fail('C9', `calf_${coat} has horns`);
    if (calf.look.build.udderRadius > 0) fail('C9', `calf_${coat} has an udder`);
  }
  failUnlessMeasured('C9', pairsMeasured, 'adult and calf pairs');
}

// ── C10 the happy rows ───────────────────────────────────────────────────────

/**
 * C10 — the adult's happy row bounces on its forelegs (the front hooves leave
 * the ground while the hind stay down), and the calf's is a buck with all four
 * hooves off the ground at once. Both must end back at a standing rest, so the
 * idle they return to does not pop.
 */
const HAPPY_REST_TOLERANCE = 0.02;

function gateHappy(): void {
  let rowsMeasured = 0;
  for (const id of AGE_REPRESENTATIVES) {
    const entry = entryOf(id, 'C10');
    if (entry === null) continue;
    const row = rowNamed(entry, 'happy_side', 'C10');
    if (row === null) continue;
    rowsMeasured++;
    let frontBounce = false;
    let allAirborne = false;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const p = row.pose(frame);
      const frontUp = p.frontL.dy < 0 && p.frontR.dy < 0;
      const hindUp = p.hindL.dy < 0 && p.hindR.dy < 0;
      if (frontUp && !hindUp) frontBounce = true;
      if (frontUp && hindUp) allAirborne = true;
    }
    if (entry.age === 'adult' && !frontBounce)
      fail('C10', `${id} happy_side never bounces on its forelegs`);
    if (entry.age === 'adult' && allAirborne)
      fail('C10', `${id} happy_side leaves the ground entirely — only a calf bucks`);
    if (entry.age === 'calf' && !allAirborne)
      fail('C10', `${id} happy_side never has all four hooves off the ground`);
    const last = row.pose(row.frameCount - 1);
    const drift = Math.max(
      Math.abs(last.bob),
      Math.abs(last.frontL.dy),
      Math.abs(last.hindL.dy),
      Math.abs(last.pitch),
    );
    if (drift > HAPPY_REST_TOLERANCE)
      fail(
        'C10',
        `${id} happy_side ends ${drift.toFixed(RATIO_DECIMALS)} off its standing rest — the hand-back to idle will pop`,
      );
  }
  failUnlessMeasured('C10', rowsMeasured, 'happy rows');
}

// ── C11 warm-row memory ──────────────────────────────────────────────────────

/**
 * The share of the cache's fleet-wide ceiling a whole herd's prewarm set may
 * take. A pasture can hold all six cattle figures at once, and the village
 * around it has its own villagers, soldiers and undead to keep warm: a third
 * leaves the rest of the fleet two thirds of the room.
 */
const HERD_PREWARM_CACHE_SHARE_DIVISOR = 3;
const HERD_PREWARM_CACHE_SHARE = 1 / HERD_PREWARM_CACHE_SHARE_DIVISOR;

function bytesOf(entry: CowFigureEntry, states: Iterable<string>): number {
  const def = entry.figure;
  const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
  let frames = 0;
  for (const state of states) frames += def.states.get(state)?.frames ?? 0;
  return frames * cellBytes;
}

/**
 * C11 — every figure's full working set fits its own cache budget
 * (`figureByteBudgetFor`, never a copied constant), and the prewarm set of all
 * six figures together fits the herd's share of the fleet-wide ceiling.
 */
function gateMemory(): void {
  let figuresMeasured = 0;
  let herdPrewarm = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    figuresMeasured++;
    const def = entry.figure;
    const all = bytesOf(entry, def.states.keys());
    const budget = figureByteBudgetFor(def);
    if (all > budget) {
      fail(
        'C11',
        `${def.id}'s full working set is ${(all / BYTES_PER_MEGABYTE).toFixed(2)} MB, over its ` +
          `${(budget / BYTES_PER_MEGABYTE).toFixed(2)} MB cache budget`,
      );
    }
    herdPrewarm += bytesOf(entry, COW_PREWARMED_STATES);
  }
  failUnlessMeasured('C11', figuresMeasured, 'figures');
  const herdBudget = CACHE_BYTE_BUDGET * HERD_PREWARM_CACHE_SHARE;
  console.log(
    `  C11 memory: the six figures' prewarm set is ${(herdPrewarm / BYTES_PER_MEGABYTE).toFixed(2)} MB ` +
      `of the herd's ${(herdBudget / BYTES_PER_MEGABYTE).toFixed(2)} MB share`,
  );
  if (herdPrewarm > herdBudget) {
    fail(
      'C11',
      `the herd's prewarm set is ${(herdPrewarm / BYTES_PER_MEGABYTE).toFixed(2)} MB, over its ` +
        `${(herdBudget / BYTES_PER_MEGABYTE).toFixed(2)} MB share of the figure cache`,
    );
  }
}

// ── C12 the poll anchor ──────────────────────────────────────────────────────

/**
 * C12 — `cowPollPoint`, which anything hung over the head (the hearts a petted
 * cow gives off) reads, lands on the head's ink in every view's idle frame.
 */
function gatePollAnchor(): void {
  let framesMeasured = 0;
  for (const entry of COW_FIGURE_ENTRIES) {
    const def = entry.figure;
    for (const [state, view] of [
      ['idle', 'front'],
      ['idle_side', 'side'],
    ] as const) {
      const row = rowNamed(entry, state, 'C12');
      if (row === null) continue;
      const poll = cowPollPoint(row.pose(0), entry.look, view);
      const px = Math.round(def.frameWidth / 2 + poll.x * TILE_SCALE);
      const py = Math.round(def.tileY + TILE_SCALE / 2 + poll.y * TILE_SCALE);
      const alpha = cellAlpha(entry, state, 0);
      framesMeasured++;
      let near = false;
      const REACH = 6;
      for (let dy = -REACH; dy <= REACH && !near; dy++) {
        for (let dx = -REACH; dx <= REACH && !near; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= def.frameWidth || y >= def.frameHeight) continue;
          if (alpha[y * def.frameWidth + x] >= SOLID_ALPHA_THRESHOLD) near = true;
        }
      }
      if (!near)
        fail(
          'C12',
          `${def.id} ${state}: cowPollPoint lands at (${px}, ${py}), nowhere near the head's ink`,
        );
    }
  }
  failUnlessMeasured('C12', framesMeasured, 'poll anchors');
}

// ── C13 legs reach their hooves ─────────────────────────────────────────────

/**
 * How far past its own length a leg may be asked to reach, in tiles: about half
 * an art pixel, for float error. The two-bone solve clamps a hoof out of reach
 * and the leg is then drawn with a stretched cannon — at a calf's buck that
 * read as a floating animal on stilts, with every other gate green.
 */
const LEG_REACH_TOLERANCE = 0.008;
const REACH_CHECKED_ACTIONS: readonly CowAction[] = ['walk', 'trot', 'happy', 'flinch'];

/**
 * C13 — in every profile frame of the gait, happy and flinch rows, each hoof is
 * within its leg's reach of its pivot, measured through the same body frame the
 * painter draws with.
 */
function gateLegReach(): void {
  const legsByAction = new Map<CowAction, number>();
  for (const entry of COW_FIGURE_ENTRIES) {
    for (const row of entry.rows) {
      if (row.view !== 'side' || !REACH_CHECKED_ACTIONS.includes(row.action)) continue;
      const action = row.action;
      for (let frame = 0; frame < row.frameCount; frame++) {
        for (const leg of cowSideLegs(row.pose(frame), entry.look.build)) {
          legsByAction.set(action, (legsByAction.get(action) ?? 0) + 1);
          const distance = Math.hypot(leg.hoof.x - leg.root.x, leg.hoof.y - leg.root.y);
          const over = distance - leg.length;
          if (over <= LEG_REACH_TOLERANCE) continue;
          fail(
            'C13',
            `${entry.figure.id} ${row.name}[${frame}]: the ${leg.foot} hoof is ` +
              `${(over * TILE_SCALE).toFixed(1)} art px past its leg's reach — the leg is drawn stretched`,
          );
        }
      }
    }
  }
  // Per action, not in total: an action whose rows stopped matching would
  // otherwise vanish from the gate behind the legs every other action counts.
  for (const action of REACH_CHECKED_ACTIONS) {
    failUnlessMeasured('C13', legsByAction.get(action) ?? 0, `legs in "${action}" profile rows`);
  }
}

/** Runs every gate and returns one message per failure. */
export function cowGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoops();
  gateStrideSync();
  gateGaitOrder();
  gateEarRead();
  gateGore();
  gateRuntimeStateNames();
  gateCalfReadsYoung();
  gateHappy();
  gateMemory();
  gatePollAnchor();
  gateLegReach();
  return [...failures];
}
