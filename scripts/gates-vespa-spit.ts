/**
 * The Brindled Vespa's acid-spit gates.
 *
 * Both sheets are gone, so the invariant the deleted bake threw on — art cut
 * along a straight line by the cell wall — is enforced here against cells
 * painted from the two `FigureDef`s, alongside the ones the bake never had:
 * that the glob's loop closes, that the splash blooms before it fades, and that
 * the rows the draw wrapper asks for are the rows the figures paint.
 *
 * Failures accumulate rather than throwing one at a time. A gate that cannot
 * find the figure or row it names fails loudly, and so does one whose filtered
 * loop examined nothing.
 *
 * Run by the review harness: `npm run render:vespa-spit`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  SPIT_STATE,
  VESPA_ACID_SPIT_IMPACT_FIGURE,
  VESPA_ACID_SPIT_PROJECTILE_FIGURE,
  VESPA_SPIT_FIGURES,
} from '../src/sprites/art/vespaSpitFigure.js';
import { projectilePhase } from '../src/sprites/art/vespaSpitArt.js';

/** Alpha a pixel may carry before it counts as ink, and the bake's edge limit. */
const INK_ALPHA = 6;
const MAX_EDGE_ALPHA = 6;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/** Fails a gate whose filtered loop ran zero times. */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

interface Cell {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

function cellOf(def: FigureDef, frame: number): Cell {
  const key = `${def.id}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const { data } = bakeFigureCell(def, SPIT_STATE, frame)
    .getContext('2d')
    .getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const cell: Cell = { alpha, width: frameWidth, height: frameHeight };
  cellCache.set(key, cell);
  return cell;
}

function frameCountOf(def: FigureDef): number {
  return def.states.get(SPIT_STATE)?.frames ?? 0;
}

function inkPixels(cell: Cell): number {
  let count = 0;
  for (const value of cell.alpha) {
    if (value > INK_ALPHA) count++;
  }
  return count;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Alpha difference at which a pixel counts as having changed between frames. */
const FRAME_CHANGE_ALPHA = 24;

function changeShare(a: Cell, b: Cell): number {
  let changed = 0;
  let inked = 0;
  for (let i = 0; i < a.alpha.length; i++) {
    if (a.alpha[i] > INK_ALPHA || b.alpha[i] > INK_ALPHA) inked++;
    if (Math.abs(a.alpha[i] - b.alpha[i]) >= FRAME_CHANGE_ALPHA) changed++;
  }
  if (inked === 0) return 0;
  return changed / inked;
}

// ── V1 structure ─────────────────────────────────────────────────────────────

/**
 * The splash's last frame is empty on purpose: its fade term reaches a true
 * zero at the end of the row, and the runtime stops drawing it there. Declared
 * both ways by the shared gate — a frame named here that paints ink fails as
 * loudly as an undeclared frame that paints none.
 */
function blankFramesFor(def: FigureDef): ReadonlyMap<string, ReadonlySet<number>> | undefined {
  if (def !== VESPA_ACID_SPIT_IMPACT_FIGURE) return undefined;
  const last = frameCountOf(def) - 1;
  return new Map([[SPIT_STATE, new Set(last >= 0 ? [last] : [])]]);
}

function gateStructure(): void {
  failUnlessMeasured('V1', VESPA_SPIT_FIGURES.length, 'figures for structure');
  for (const def of VESPA_SPIT_FIGURES) {
    for (const failure of figureStructuralFailures(def, { blankFrames: blankFramesFor(def) })) {
      fail('V1', failure);
    }
  }
}

// ── V2 the cell wall ─────────────────────────────────────────────────────────

/**
 * Ported from the deleted bake. The glob is drawn rotated to its velocity, so a
 * cut against the cell wall sweeps around with it and is impossible to miss.
 */
function gateEdgeBleed(): void {
  let framesMeasured = 0;
  for (const def of VESPA_SPIT_FIGURES) {
    for (let frame = 0; frame < frameCountOf(def); frame++) {
      framesMeasured++;
      const cell = cellOf(def, frame);
      const right = cell.width - 1;
      const bottom = cell.height - 1;
      let worst = 0;
      for (let x = 0; x <= right; x++) {
        worst = Math.max(worst, cell.alpha[x], cell.alpha[bottom * cell.width + x]);
      }
      for (let y = 0; y <= bottom; y++) {
        worst = Math.max(worst, cell.alpha[y * cell.width], cell.alpha[y * cell.width + right]);
      }
      if (worst > MAX_EDGE_ALPHA) {
        fail(
          'V2',
          `${def.id}[${frame}] paints its own border at alpha ${worst}; shrink the layer or grow ` +
            'the frame envelope',
        );
      }
    }
  }
  failUnlessMeasured('V2', framesMeasured, 'frames for edge bleed');
}

// ── V3 the effect fills the cell it costs ────────────────────────────────────

/**
 * How much of its own cell width a figure's widest frame must reach.
 *
 * Distinct from the shared structural fill check, which is an *area* share and
 * so is answered by ink of any shape: a splash squashed to half its width and
 * stretched to make the area back up passes that one and fails this. Verified
 * by mutation — an x-scale of 0.5 with a y-scale of 1.6 on the impact reddens
 * this gate alone.
 */
const MIN_INK_SPAN = 0.35;

function gateInkSpan(): void {
  let figuresMeasured = 0;
  for (const def of VESPA_SPIT_FIGURES) {
    let widest = 0;
    for (let frame = 0; frame < frameCountOf(def); frame++) {
      const cell = cellOf(def, frame);
      let minX = cell.width;
      let maxX = -1;
      for (let y = 0; y < cell.height; y++) {
        for (let x = 0; x < cell.width; x++) {
          if (cell.alpha[y * cell.width + x] <= INK_ALPHA) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (maxX < 0) continue;
      widest = Math.max(widest, (maxX - minX) / cell.width);
    }
    figuresMeasured++;
    if (widest < MIN_INK_SPAN) {
      fail(
        'V3',
        `${def.id} never spans more than ${(widest * 100).toFixed(0)}% of its cell width; shrink ` +
          'the frame envelope rather than paying for empty pixels on every frame',
      );
    }
  }
  failUnlessMeasured('V3', figuresMeasured, 'figures for ink span');
}

// ── V4 the glob's pulse actually moves ───────────────────────────────────────

/**
 * Share of a pair's inked pixels that must change between consecutive frames.
 *
 * The glob's pulse is a sine, so its steps are bimodal: the shipped row runs
 * 1.5% at the turning points and 8.8% through the middle of the swing. The
 * limit sits under the quietest shipped pair and catches the pulse being
 * switched off, which turns the glob into a green dot sliding across the floor.
 */
const MIN_FRAME_CHANGE = 0.01;

function gateGlobPulses(): void {
  const def = VESPA_ACID_SPIT_PROJECTILE_FIGURE;
  const frames = frameCountOf(def);
  let pairsMeasured = 0;
  for (let frame = 0; frame + 1 < frames; frame++) {
    pairsMeasured++;
    const share = changeShare(cellOf(def, frame), cellOf(def, frame + 1));
    if (share >= MIN_FRAME_CHANGE) continue;
    fail(
      'V4',
      `${def.id} changes only ${(share * 100).toFixed(2)}% of its inked pixels between frames ` +
        `${frame} and ${frame + 1}; the pulse reads as a still`,
    );
  }
  failUnlessMeasured('V4', pairsMeasured, 'consecutive frame pairs');
}

// ── V5 the glob's loop closes ────────────────────────────────────────────────

/**
 * How far short of the row's median step the painted wrap may fall.
 *
 * The shipped wrap changes 10.9% of the ink against a median step of 8.4%, so a
 * floor at 0.65 clears it and still catches a wrap that changes nothing — which
 * is what sampling the phase at `frame / (frames - 1)` produces.
 */
const WRAP_VS_MEDIAN_FLOOR = 0.65;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

function gateGlobLoopCloses(): void {
  const def = VESPA_ACID_SPIT_PROJECTILE_FIGURE;
  const frames = frameCountOf(def);
  if (frames < 3) {
    fail('V5', `${def.id} has ${frames} frames, too few to judge a loop by`);
    return;
  }

  // The ceiling, in the units the defect is actually in. A row that runs more
  // or less than one turn pops once per cycle, and the pixels cannot say so:
  // every phase offset tested measures a *smaller* wrap than the shipped row,
  // because a longer cycle raises the ordinary steps faster than it raises the
  // wrap. The mapping itself is what is checkable.
  const span = projectilePhase(frames, frames) - projectilePhase(0, frames);
  if (Math.abs(span - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'V5',
      `${def.id} spends ${span.toFixed(4)} of a turn over its ${frames} frames rather than ` +
        'exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = projectilePhase(1, frames) - projectilePhase(0, frames);
  let stepsMeasured = 0;
  for (let frame = 1; frame < frames; frame++) {
    stepsMeasured++;
    const step = projectilePhase(frame, frames) - projectilePhase(frame - 1, frames);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'V5',
      `${def.id} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
    );
  }
  failUnlessMeasured('V5', stepsMeasured, `phase steps of ${def.id}`);

  // The floor, in pixels.
  const steps: number[] = [];
  for (let frame = 0; frame + 1 < frames; frame++) {
    steps.push(changeShare(cellOf(def, frame), cellOf(def, frame + 1)));
  }
  failUnlessMeasured('V5', steps.length, `painted steps of ${def.id}`);
  const wrap = changeShare(cellOf(def, frames - 1), cellOf(def, 0));
  const typical = median(steps);
  console.log(
    `  V5 ${def.id}: covers ${span.toFixed(3)} of a turn; the wrap changes ` +
      `${(wrap * 100).toFixed(2)}% of the ink against a median step of ` +
      `${(typical * 100).toFixed(2)}%`,
  );
  if (wrap < typical * WRAP_VS_MEDIAN_FLOOR) {
    fail(
      'V5',
      `${def.id} holds still across its wrap: it changes ${(wrap * 100).toFixed(2)}% of the ink ` +
        `against a median step of ${(typical * 100).toFixed(2)}%, so the cycle does not turn over`,
    );
  }
}

// ── V6 the splash blooms, then dies ──────────────────────────────────────────

/** Slack allowed against a strictly shrinking tail, as a fraction. */
const DECAY_SLACK = 0.03;

function gateSplashBloomsThenFades(): void {
  const def = VESPA_ACID_SPIT_IMPACT_FIGURE;
  const frames = frameCountOf(def);
  const ink: number[] = [];
  for (let frame = 0; frame < frames; frame++) ink.push(inkPixels(cellOf(def, frame)));
  failUnlessMeasured('V6', ink.length, 'splash frames');
  if (ink.length === 0) return;
  let peakFrame = 0;
  for (let frame = 1; frame < ink.length; frame++) {
    if (ink[frame] > ink[peakFrame]) peakFrame = frame;
  }
  console.log(`  V6 splash ink ${ink.join(' → ')} — peaks on frame ${peakFrame} of ${frames}`);
  if (peakFrame === 0) {
    fail(
      'V6',
      'the splash is at its widest on frame 0, so it reads as a stamp fading rather ' +
        'than as liquid landing',
    );
  }
  // Unimodal: once the splash has started to shrink it may never grow again.
  // Scanning from the measured peak instead would be answered by the data —
  // a frame that swells back up simply becomes the new peak, and the scan
  // starts after it.
  let shrinking = false;
  let stepsMeasured = 0;
  for (let frame = 0; frame + 1 < ink.length; frame++) {
    stepsMeasured++;
    if (ink[frame + 1] < ink[frame]) {
      shrinking = true;
      continue;
    }
    if (!shrinking) continue;
    const allowed = ink[frame] * (1 + DECAY_SLACK);
    if (ink[frame + 1] <= allowed) continue;
    fail(
      'V6',
      `the splash grows again after it started to die: frame ${frame} carries ${ink[frame]} ` +
        `pixels and frame ${frame + 1} carries ${ink[frame + 1]}`,
    );
  }
  failUnlessMeasured('V6', stepsMeasured, 'steps of the splash');
  if (ink[ink.length - 1] !== 0) {
    fail(
      'V6',
      `the splash still carries ${ink[ink.length - 1]} pixels on its last frame; the runtime ` +
        'stops drawing it there, so it would vanish mid-splash',
    );
  }
}

// ── V7 the rows the runtime asks for ─────────────────────────────────────────

function gateDrawnStates(): void {
  failUnlessMeasured('V7', VESPA_SPIT_FIGURES.length, 'figures the draw wrapper asks for');
  for (const def of VESPA_SPIT_FIGURES) {
    for (const failure of missingStateFailures(def, [SPIT_STATE], `${def.id}'s draw wrapper`)) {
      fail('V7', failure);
    }
    for (const state of def.states.keys()) {
      if (state === SPIT_STATE) continue;
      fail('V7', `${def.id} paints a "${state}" row that the draw wrapper never asks for`);
    }
  }
}

// ── V8 warm-row budget ───────────────────────────────────────────────────────

/**
 * The megabyte limit is a READOUT for these two figures, not a gate.
 *
 * The shipped rows warm to 0.037 MB and 0.281 MB, and mutation testing puts the
 * smallest impact cell that crosses six megabytes at 640×640 — nearly seven
 * times the shipped cell in each direction, and a size the ink-span and
 * cell-fill gates redden at a third of. No plausible art change reaches it, so
 * read the printed line as a cost report and let the other gates hold the cell
 * size honest. Lowering the number to make it bite would only duplicate them.
 *
 * The zero-frame clause below is a real gate and does fail: renaming the row a
 * figure paints reddens it.
 */
const ROW_BUDGET_MEGABYTES = 6;

function gateWarmRows(): void {
  let figuresMeasured = 0;
  for (const def of VESPA_SPIT_FIGURES) {
    const frames = frameCountOf(def);
    if (frames === 0) {
      fail('V8', `${def.id} declares no frames in its "${SPIT_STATE}" row`);
      continue;
    }
    figuresMeasured++;
    const megabytes =
      (frames * def.frameWidth * def.frameHeight * BYTES_PER_PIXEL) / BYTES_PER_MEGABYTE;
    console.log(
      `  V8 warm row: ${def.id} is ${megabytes.toFixed(3)} MB of a ${ROW_BUDGET_MEGABYTES} MB ` +
        'budget',
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'V8',
        `${def.id} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
  }
  failUnlessMeasured('V8', figuresMeasured, 'figures for warm-row cost');
}

/** Runs every acid-spit gate and returns one message per failure. */
export function vespaSpitGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateEdgeBleed();
  gateInkSpan();
  gateGlobPulses();
  gateGlobLoopCloses();
  gateSplashBloomsThenFades();
  gateDrawnStates();
  gateWarmRows();
  return [...failures];
}
