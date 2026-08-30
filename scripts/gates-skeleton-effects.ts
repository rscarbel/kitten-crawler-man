/**
 * The Skeleton Lord's effect gates.
 *
 * The four sheets are gone, so every invariant the deleted bake threw on is
 * enforced here against cells painted from the four `FigureDef`s, baked exactly
 * the way the runtime cache bakes them.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the figure or row it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:skeleton-effects`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  ARROW_CELL_HEIGHT,
  ARROW_CELL_WIDTH,
  BOLT_CELL,
  BURST_CELL,
  HANDS_CELL,
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_EFFECT_FIGURES,
  SKELETON_GRASPING_HANDS_FIGURE,
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
  TILE_SCALE,
  cyclePhase,
} from '../src/sprites/art/skeletonEffectsFigure.js';
import { HANDS_GROUND_Y } from '../src/sprites/art/skeletonEffectsArt.js';

/**
 * Alpha a pixel may carry before it counts as ink.
 *
 * Downsampling a supersampled cell leaves a haze of near-zero alpha around
 * everything, and a gate that counted that haze would measure the antialiaser
 * rather than the art.
 */
const INK_ALPHA = 6;
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

/** One cell's alpha channel, baked the way the runtime cache bakes it. */
function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const { data } = bakeFigureCell(def, state, frame)
    .getContext('2d')
    .getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const cell: Cell = { alpha, width: frameWidth, height: frameHeight };
  cellCache.set(key, cell);
  return cell;
}

/** The one state each of these figures declares, or null after failing. */
function onlyStateOf(def: FigureDef, gateId: string): string | null {
  const names = [...def.states.keys()];
  if (names.length !== 1) {
    fail(gateId, `${def.id} declares ${names.length} states; these effects each have exactly one`);
    return null;
  }
  return names[0];
}

function frameCountOf(def: FigureDef, state: string): number {
  return def.states.get(state)?.frames ?? 0;
}

interface InkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly pixels: number;
}

function inkBoundsOf(cell: Cell): InkBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let pixels = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.alpha[y * cell.width + x] <= INK_ALPHA) continue;
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, pixels };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ── S1 structure ─────────────────────────────────────────────────────────────

/**
 * The shared structural gates over all four figures: every declared frame
 * paints something, nothing is clipped by the cell wall, and no cell is mostly
 * empty.
 */
function gateStructure(): void {
  for (const def of SKELETON_EFFECT_FIGURES) {
    for (const failure of figureStructuralFailures(def)) fail('S1', failure);
  }
  failUnlessMeasured('S1', SKELETON_EFFECT_FIGURES.length, 'effect figures');
}

// ── S2 the cell wall ─────────────────────────────────────────────────────────

/**
 * A frame that paints its own border has been cut along a straight line by the
 * cell wall. Ported from the deleted bake, which held the border to the same
 * alpha at which a pixel starts counting as ink.
 */
function gateEdgeBleed(): void {
  let framesMeasured = 0;
  for (const def of SKELETON_EFFECT_FIGURES) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const cell = cellOf(def, state, frame);
        const right = cell.width - 1;
        const bottom = cell.height - 1;
        let worst = 0;
        for (let x = 0; x <= right; x++) {
          worst = Math.max(worst, cell.alpha[x], cell.alpha[bottom * cell.width + x]);
        }
        for (let y = 0; y <= bottom; y++) {
          worst = Math.max(worst, cell.alpha[y * cell.width], cell.alpha[y * cell.width + right]);
        }
        if (worst > INK_ALPHA) {
          fail(
            'S2',
            `${def.id}.${state}[${frame}] paints its own border at alpha ${worst}; the art is ` +
              'clipped by the cell. Grow the cell or shrink the effect.',
          );
        }
      }
    }
  }
  failUnlessMeasured('S2', framesMeasured, 'frames for edge bleed');
}

// ── S3 the effect fills the cell it costs ────────────────────────────────────

/**
 * A cell grown to clear a gate and never shrunk back is invisible in review and
 * costs memory on every frame. Judged on the widest frame: a one-shot burst
 * legitimately opens small.
 */
const MIN_INK_SPAN = 0.35;

function gateInkSpan(): void {
  let figuresMeasured = 0;
  for (const def of SKELETON_EFFECT_FIGURES) {
    let widest = 0;
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        const ink = inkBoundsOf(cellOf(def, state, frame));
        if (ink.pixels === 0) continue;
        widest = Math.max(widest, (ink.maxX - ink.minX) / def.frameWidth);
      }
    }
    figuresMeasured++;
    if (widest < MIN_INK_SPAN) {
      fail(
        'S3',
        `${def.id} never spans more than ${(widest * 100).toFixed(0)}% of its cell width; shrink ` +
          'the frame envelope rather than paying for empty pixels on every frame',
      );
    }
  }
  failUnlessMeasured('S3', figuresMeasured, 'figures for ink span');
}

// ── S4 the animated rows actually move ───────────────────────────────────────

/** Alpha difference at which a pixel counts as having changed between frames. */
const FRAME_CHANGE_ALPHA = 24;
/**
 * Share of a pair's inked pixels that must change between consecutive frames.
 *
 * Measured per pixel rather than on ink area, because both of these rows keep
 * the same footprint from frame to frame — an area comparison would pass a loop
 * whose only moving parts had been deleted.
 */
const MIN_FRAME_CHANGE = 0.06;

/** Share of inked pixels whose alpha differs between two cells. */
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

/**
 * The two rows whose every frame is meant to differ from the last. The burst is
 * left out on purpose: its tail is a dissipation that fades to almost nothing,
 * so its last few frames legitimately barely change. What the burst has to do
 * instead is expand, which is its own gate.
 */
const ANIMATED_FIGURES: readonly FigureDef[] = [
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_GRASPING_HANDS_FIGURE,
];

function gateRowsMove(): void {
  let pairsMeasured = 0;
  for (const def of ANIMATED_FIGURES) {
    const state = onlyStateOf(def, 'S4');
    if (state === null) continue;
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame + 1 < frames; frame++) {
      pairsMeasured++;
      const share = changeShare(cellOf(def, state, frame), cellOf(def, state, frame + 1));
      if (share < MIN_FRAME_CHANGE) {
        fail(
          'S4',
          `${def.id} changes only ${(share * 100).toFixed(1)}% of its inked pixels between ` +
            `frames ${frame} and ${frame + 1}; the animation reads as a still`,
        );
      }
    }
  }
  failUnlessMeasured('S4', pairsMeasured, 'consecutive frame pairs');
}

// ── S5 the bolt's loop closes ────────────────────────────────────────────────

/**
 * How far short of the row's median step the painted wrap may fall.
 *
 * The bolt is the one row here the runtime plays on a clock rather than on a
 * progress value, so it is the only one whose last frame is followed by its
 * first. On the shipped art the wrap changes 22.2% of the ink against a median
 * step of 20.9%, so a floor at 0.65 clears it and still catches a wrap that
 * changes nothing.
 *
 * The other end of the band is asserted on the phase mapping rather than on the
 * pixels; see below for why the pixels cannot carry it.
 */
const WRAP_VS_MEDIAN_FLOOR = 0.65;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

function gateBoltLoopCloses(): void {
  const def = SKELETON_SOUL_BOLT_FIGURE;
  const state = onlyStateOf(def, 'S5');
  if (state === null) return;
  const frames = frameCountOf(def, state);

  // The ceiling, in the units the defect is actually in. A row that runs more
  // or less than one turn is a bolt that pops once per cycle, and the pixels
  // cannot say so: any phase offset at all decorrelates the seeded wisps, so
  // the wrap and an ordinary step both measure about a fifth of the ink
  // whatever the cycle is doing. What is checkable is the mapping itself.
  const span = cyclePhase(frames, frames) - cyclePhase(0, frames);
  if (Math.abs(span - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'S5',
      `${def.id} spends ${span.toFixed(4)} of a turn over its ${frames} frames rather than ` +
        'exactly one, so the frame after the last does not land on the first',
    );
  }
  let stepsMeasured = 0;
  const firstStep = cyclePhase(1, frames) - cyclePhase(0, frames);
  for (let frame = 1; frame < frames; frame++) {
    stepsMeasured++;
    const step = cyclePhase(frame, frames) - cyclePhase(frame - 1, frames);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'S5',
      `${def.id} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
    );
  }
  failUnlessMeasured('S5', stepsMeasured, `phase steps of ${def.id}`);

  // The floor, in pixels. A cycle sampled at `frame / (frames - 1)` covers a
  // turn's worth of phase and still holds the bolt still across its wrap.
  const steps: number[] = [];
  for (let frame = 0; frame + 1 < frames; frame++) {
    steps.push(changeShare(cellOf(def, state, frame), cellOf(def, state, frame + 1)));
  }
  failUnlessMeasured('S5', steps.length, `painted steps of ${def.id}`);
  if (steps.length === 0) return;
  const wrap = changeShare(cellOf(def, state, frames - 1), cellOf(def, state, 0));
  const typical = median(steps);
  console.log(
    `  S5 ${def.id}: covers ${span.toFixed(3)} of a turn; the wrap changes ` +
      `${(wrap * 100).toFixed(1)}% of the ink against a median step of ` +
      `${(typical * 100).toFixed(1)}%`,
  );
  if (wrap < typical * WRAP_VS_MEDIAN_FLOOR) {
    fail(
      'S5',
      `${def.id} holds still across its wrap: it changes ${(wrap * 100).toFixed(1)}% of the ink ` +
        `against a median step of ${(typical * 100).toFixed(1)}%, so the cycle does not turn over`,
    );
  }
}

// ── S6 the burst expands ─────────────────────────────────────────────────────

/**
 * An impact whose ink is widest on its first frame is a disc shrinking, which
 * is the failure this effect exists to avoid.
 */
const MIN_BURST_GROWTH = 1.4;

function gateBurstExpands(): void {
  const def = SKELETON_SOUL_BURST_FIGURE;
  const state = onlyStateOf(def, 'S6');
  if (state === null) return;
  const frames = frameCountOf(def, state);
  const first = inkBoundsOf(cellOf(def, state, 0));
  let widest = first.maxX - first.minX;
  let widestFrame = 0;
  let framesMeasured = first.pixels > 0 ? 1 : 0;
  for (let frame = 1; frame < frames; frame++) {
    const ink = inkBoundsOf(cellOf(def, state, frame));
    if (ink.pixels === 0) continue;
    framesMeasured++;
    if (ink.maxX - ink.minX <= widest) continue;
    widest = ink.maxX - ink.minX;
    widestFrame = frame;
  }
  failUnlessMeasured('S6', framesMeasured, 'burst frames');
  const growth = widest / Math.max(1, first.maxX - first.minX);
  if (widestFrame === 0 || growth < MIN_BURST_GROWTH) {
    fail(
      'S6',
      `${def.id} peaks at frame ${widestFrame} with only ${growth.toFixed(2)}x the ink width of ` +
        'frame 0; the burst reads as a shrinking disc rather than a dissipation',
    );
  }
}

// ── S7 the arrow points along +X ─────────────────────────────────────────────

/**
 * `drawFigureCachedRotatedCenter` spins this cell by the projectile's heading,
 * so a frame drawn pointing anywhere else flies permanently sideways.
 */
const MIN_ARROW_ASPECT = 2.5;
/**
 * The share of the arrow's length, at each end, the profile is read over.
 *
 * The clause this replaces asked whether the leading section carried ink on the
 * centre line, which the shaft answers whichever way round the arrow is drawn:
 * mirroring the whole sprite to -X left the gate green. What separates the two
 * ends is their profile — the point is knapped down to a few pixels and the
 * fletching is the tallest thing in the cell — so the gate reads that instead.
 * On the shipped art the tail is 2.85x the tip; drawn backwards it is 0.35x.
 */
const ARROW_END_SHARE = 0.15;
/** How much taller the fletched tail must stand than the knapped point. */
const MIN_TAIL_OVER_TIP = 1.8;
/** Where along the arrow the bare shaft is sampled, clear of both ends. */
const ARROW_SHAFT_SAMPLE = 0.45;
/** Where the head's barbs start, as a share of the arrow's length. */
const ARROW_HEAD_START = 0.6;
/** How much wider than the shaft the head's barbs have to flare. */
const MIN_HEAD_FLARE = 1.5;

/** Every inked column of a cell, as (x, ink height). */
function inkColumnsOf(cell: Cell): ReadonlyArray<{ readonly x: number; readonly height: number }> {
  const columns: Array<{ x: number; height: number }> = [];
  for (let x = 0; x < cell.width; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < cell.height; y++) {
      if (cell.alpha[y * cell.width + x] <= INK_ALPHA) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top >= 0) columns.push({ x, height: bottom - top + 1 });
  }
  return columns;
}

function gateArrowAimsAlongX(): void {
  const def = SKELETON_BONE_ARROW_FIGURE;
  const state = onlyStateOf(def, 'S7');
  if (state === null) return;
  const cell = cellOf(def, state, 0);
  const ink = inkBoundsOf(cell);
  if (ink.pixels === 0) {
    fail('S7', `${def.id} paints nothing at all`);
    return;
  }
  const width = ink.maxX - ink.minX;
  const height = ink.maxY - ink.minY;
  const aspect = width / Math.max(1, height);
  if (aspect < MIN_ARROW_ASPECT) {
    fail(
      'S7',
      `${def.id} ink is ${width}x${height} (aspect ${aspect.toFixed(2)}); an arrow drawn along ` +
        `+X must be at least ${MIN_ARROW_ASPECT}x wider than it is tall`,
    );
  }
  // Which end is which, or the sprite flies backwards and nobody notices until
  // it is on screen at 32 px.
  const columns = inkColumnsOf(cell);
  const meanHeightOf = (
    section: ReadonlyArray<{ readonly x: number; readonly height: number }>,
  ): number => section.reduce((total, column) => total + column.height, 0) / section.length;
  const tail = columns.filter((column) => column.x <= ink.minX + width * ARROW_END_SHARE);
  const tip = columns.filter((column) => column.x >= ink.maxX - width * ARROW_END_SHARE);
  failUnlessMeasured('S7', tail.length, "columns of the arrow's tail");
  failUnlessMeasured('S7', tip.length, "columns of the arrow's point");
  if (tail.length > 0 && tip.length > 0) {
    const taper = meanHeightOf(tail) / Math.max(1, meanHeightOf(tip));
    if (taper < MIN_TAIL_OVER_TIP) {
      fail(
        'S7',
        `${def.id} is ${taper.toFixed(2)}x taller at its tail than at its point (needs ` +
          `${MIN_TAIL_OVER_TIP}x); the fletched end is not at -X, so the arrow flies backwards`,
      );
    }
  }

  const shaftColumn = columns.find((column) => column.x >= ink.minX + width * ARROW_SHAFT_SAMPLE);
  const head = columns.filter((column) => column.x >= ink.minX + width * ARROW_HEAD_START);
  failUnlessMeasured('S7', head.length, "columns of the arrow's head");
  if (shaftColumn === undefined) {
    fail('S7', `${def.id} has no inked column at midshaft to measure its head against`);
    return;
  }
  if (head.length === 0) return;
  const widestHead = head.reduce((widest, column) => Math.max(widest, column.height), 0);
  const flare = widestHead / Math.max(1, shaftColumn.height);
  if (flare < MIN_HEAD_FLARE) {
    fail(
      'S7',
      `${def.id}'s head flares to only ${flare.toFixed(2)}x the shaft's ${shaftColumn.height}px ` +
        `(needs ${MIN_HEAD_FLARE}x); an arrow with no barbs reads as a floating bone`,
    );
  }
}

// ── S8 the hands patch stays off its own cell wall ───────────────────────────

/**
 * The runtime fills a cone with several overlapping copies of this cell. Ink
 * anywhere near the border bakes a rectangular seam grid into the cone, which
 * is the one failure that only shows up once there are many of them.
 */
const HANDS_MIN_INK_MARGIN = 8;

function gateHandsPatchInset(): void {
  const def = SKELETON_GRASPING_HANDS_FIGURE;
  const state = onlyStateOf(def, 'S8');
  if (state === null) return;
  const frames = frameCountOf(def, state);
  let framesMeasured = 0;
  for (let frame = 0; frame < frames; frame++) {
    const cell = cellOf(def, state, frame);
    const ink = inkBoundsOf(cell);
    if (ink.pixels === 0) continue;
    framesMeasured++;
    const margin = Math.min(
      ink.minX,
      ink.minY,
      cell.width - 1 - ink.maxX,
      cell.height - 1 - ink.maxY,
    );
    if (margin < HANDS_MIN_INK_MARGIN) {
      fail(
        'S8',
        `${def.id} frame ${frame} leaves only ${margin}px between its ink and the cell wall ` +
          `(needs ${HANDS_MIN_INK_MARGIN}px); overlapping copies will show a seam grid`,
      );
    }
  }
  failUnlessMeasured('S8', framesMeasured, 'hands frames');
}

// ── S9 the fingers keep daylight between them ────────────────────────────────

/**
 * Negative space is the whole skeletal read. If the bones bake into one solid
 * mass, a scanline through the hand stops showing separate ink runs.
 *
 * Checked over most of the row rather than on its best frame: a hand that
 * closes to a full fist still passes a best-frame check while losing every gap
 * on exactly the frames the attack lands on.
 */
const MIN_FINGER_RUNS = 4;
const MIN_GAPPED_FRAME_FRACTION = 0.5;

function widestRunCount(cell: Cell): number {
  let best = 0;
  for (let y = 0; y < cell.height; y++) {
    let runs = 0;
    let inRun = false;
    for (let x = 0; x < cell.width; x++) {
      const isInk = cell.alpha[y * cell.width + x] > INK_ALPHA;
      if (isInk && !inRun) runs++;
      inRun = isInk;
    }
    best = Math.max(best, runs);
  }
  return best;
}

function gateFingerGaps(): void {
  const def = SKELETON_GRASPING_HANDS_FIGURE;
  const state = onlyStateOf(def, 'S9');
  if (state === null) return;
  const frames = frameCountOf(def, state);
  const runsPerFrame: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    runsPerFrame.push(widestRunCount(cellOf(def, state, frame)));
  }
  failUnlessMeasured('S9', runsPerFrame.length, 'hands frames');
  const gapped = runsPerFrame.filter((runs) => runs >= MIN_FINGER_RUNS).length;
  if (gapped < Math.ceil(frames * MIN_GAPPED_FRAME_FRACTION)) {
    fail(
      'S9',
      `only ${gapped}/${frames} frames of ${def.id} cross ${MIN_FINGER_RUNS} separate ink runs ` +
        `on any scanline (per frame: ${runsPerFrame.join(',')}); the fingers have merged into ` +
        'one mitten',
    );
  }
}

// ── S10 a risen hand still touches the ground ───────────────────────────────

/**
 * The forearm is grown to reach back down past the soil line and clipped there,
 * so a forearm drawn short leaves the arm ending in mid-air with a gap under
 * it: the patch then reads as a prop dropped on the tile rather than as an
 * eruption.
 *
 * Measured under the *highest* hand only, in the column band that hand occupies,
 * and in solid alpha rather than in ink — the gate the bake shipped asked
 * whether the soil row carried ink at all, which the mound and the broken socket
 * answer on every frame whatever the arms are doing, and narrowing it to the
 * raised hand's columns was still not enough: the witch-light glow rising out of
 * the breach is a soft disc that fills every row under a floating hand at the
 * ink threshold, so a forearm cut to a stub left the gate green. Bone is painted
 * opaque and every soft thing in this cell is not, so the gap has to be
 * measured in bone. On the shipped art no frame leaves an empty row at all under
 * the raised hand; a forearm drawn at a fixed stub length leaves ten.
 */
const MAX_FLOATING_GAP_PX = 3;
/**
 * Alpha at which a pixel is bone rather than glow, soil or a thrown clod.
 *
 * The mound is laid at 0.75 alpha and the glow peaks at 0.5; every bone in the
 * hand is opaque.
 */
const SOLID_ALPHA = 200;
/** Rows below the topmost ink that still count as "the raised hand". */
const RISEN_HAND_BAND_PX = 8;

function gateHandsMeetTheGround(): void {
  const def = SKELETON_GRASPING_HANDS_FIGURE;
  const state = onlyStateOf(def, 'S10');
  if (state === null) return;
  const groundRow = Math.round(TILE_SCALE * HANDS_GROUND_Y);
  const groundY = def.tileY + groundRow - 1;
  let framesMeasured = 0;
  for (let frame = 0; frame < frameCountOf(def, state); frame++) {
    const cell = cellOf(def, state, frame);
    const ink = (x: number, y: number): boolean => cell.alpha[y * cell.width + x] >= SOLID_ALPHA;
    const rowHasInk = (y: number, fromX: number, toX: number): boolean => {
      for (let x = fromX; x <= toX; x++) {
        if (ink(x, y)) return true;
      }
      return false;
    };
    let topInk = -1;
    for (let y = 0; y < cell.height && topInk < 0; y++) {
      if (rowHasInk(y, 0, cell.width - 1)) topInk = y;
    }
    if (topInk < 0 || topInk >= groundY) continue;
    let minX = cell.width;
    let maxX = -1;
    const bandBottom = Math.min(groundY, topInk + RISEN_HAND_BAND_PX);
    for (let y = topInk; y < bandBottom; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (!ink(x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX < 0) continue;
    framesMeasured++;
    let worstGap = 0;
    let run = 0;
    for (let y = topInk; y <= groundY; y++) {
      if (rowHasInk(y, minX, maxX)) {
        run = 0;
        continue;
      }
      run++;
      worstGap = Math.max(worstGap, run);
    }
    if (worstGap > MAX_FLOATING_GAP_PX) {
      fail(
        'S10',
        `${def.id} frame ${frame} leaves a ${worstGap}px band of empty rows between its raised ` +
          `hand at row ${topInk} and the soil row ${groundY}; the arm is floating above the ` +
          'ground it erupted from',
      );
    }
  }
  failUnlessMeasured('S10', framesMeasured, 'frames with a raised hand');
}

// ── S11 the rows the runtime asks for ────────────────────────────────────────

/**
 * The state name every draw wrapper in `src/sprites/skeletonEffectsSprite.ts`
 * passes, checked in both directions: a name the wrapper builds and a figure
 * does not paint is an invisible effect and no log line, and a row a figure
 * declares that nothing draws is bake time and memory nobody spends.
 */
const DRAWN_STATES: ReadonlyArray<{ readonly def: FigureDef; readonly state: string }> = [
  { def: SKELETON_SOUL_BOLT_FIGURE, state: 'fly' },
  { def: SKELETON_SOUL_BURST_FIGURE, state: 'burst' },
  { def: SKELETON_BONE_ARROW_FIGURE, state: 'fly' },
  { def: SKELETON_GRASPING_HANDS_FIGURE, state: 'erupt' },
];

function gateDrawnStates(): void {
  failUnlessMeasured('S11', DRAWN_STATES.length, 'states the draw wrappers ask for');
  for (const { def, state } of DRAWN_STATES) {
    for (const failure of missingStateFailures(def, [state], `${def.id}'s draw wrapper`)) {
      fail('S11', failure);
    }
  }
  for (const def of SKELETON_EFFECT_FIGURES) {
    for (const state of def.states.keys()) {
      if (DRAWN_STATES.some((drawn) => drawn.def === def && drawn.state === state)) continue;
      fail('S11', `${def.id} paints a "${state}" row that no draw wrapper ever asks for`);
    }
  }
}

// ── S12 warm-row budget ──────────────────────────────────────────────────────

/**
 * The widest warm row's memory, reported whether or not it passes. A painted
 * figure is admitted to the cache one row at a time, so the number that decides
 * whether it fits is its widest row's bytes rather than the sum of every row.
 */
const ROW_BUDGET_MEGABYTES = 6;

function gateWarmRows(): void {
  let figuresMeasured = 0;
  for (const def of SKELETON_EFFECT_FIGURES) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    for (const [state, declared] of def.states) {
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    if (widestFrames === 0) {
      fail('S12', `${def.id} declares no state with frames in it`);
      continue;
    }
    figuresMeasured++;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  S12 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'S12',
        `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
  }
  failUnlessMeasured('S12', figuresMeasured, 'figures for warm-row cost');
}

// ── S13 the cells are still the ones the sheets shipped with ─────────────────

/**
 * Every cell here is derived from the art's own declared reach rather than
 * picked by eye, which means retuning a reach silently resizes a cell — and a
 * resized cell moves the anchor the runtime places the effect on. These are the
 * four cell sizes the parity run proved against the sheets, so they are the one
 * record of what the geometry was when it was last checked against pixels.
 */
const SHIPPED_CELLS: ReadonlyArray<{
  readonly def: FigureDef;
  readonly width: number;
  readonly height: number;
}> = [
  { def: SKELETON_SOUL_BOLT_FIGURE, width: 80, height: 80 },
  { def: SKELETON_SOUL_BURST_FIGURE, width: 146, height: 146 },
  { def: SKELETON_BONE_ARROW_FIGURE, width: 98, height: 42 },
  { def: SKELETON_GRASPING_HANDS_FIGURE, width: 118, height: 118 },
];

function gateCellGeometry(): void {
  const derived = new Map<string, readonly [number, number]>([
    [SKELETON_SOUL_BOLT_FIGURE.id, [BOLT_CELL, BOLT_CELL]],
    [SKELETON_SOUL_BURST_FIGURE.id, [BURST_CELL, BURST_CELL]],
    [SKELETON_BONE_ARROW_FIGURE.id, [ARROW_CELL_WIDTH, ARROW_CELL_HEIGHT]],
    [SKELETON_GRASPING_HANDS_FIGURE.id, [HANDS_CELL, HANDS_CELL]],
  ]);
  let cellsMeasured = 0;
  for (const shipped of SHIPPED_CELLS) {
    const span = derived.get(shipped.def.id);
    if (span === undefined) {
      fail('S13', `no derived cell span for ${shipped.def.id}`);
      continue;
    }
    cellsMeasured++;
    if (span[0] !== shipped.width || span[1] !== shipped.height) {
      fail(
        'S13',
        `${shipped.def.id}'s cell derives to ${span[0]}x${span[1]} but the sheets it replaces ` +
          `were ${shipped.width}x${shipped.height}; the anchor has moved, so re-run the parity ` +
          'comparison before accepting the new size',
      );
    }
    if (shipped.def.frameWidth !== span[0] || shipped.def.frameHeight !== span[1]) {
      fail(
        'S13',
        `${shipped.def.id} declares ${shipped.def.frameWidth}x${shipped.def.frameHeight} but its ` +
          `own reach derives ${span[0]}x${span[1]}`,
      );
    }
    if (shipped.def.tileX !== span[0] / 2 || shipped.def.tileY !== span[1] / 2) {
      fail(
        'S13',
        `${shipped.def.id} anchors at (${shipped.def.tileX}, ${shipped.def.tileY}) rather than ` +
          'at its cell centre, which is where every caller places it',
      );
    }
  }
  failUnlessMeasured('S13', cellsMeasured, 'cell geometries');
}

/** Runs every skeleton-effect gate and returns one message per failure. */
export function skeletonEffectGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateEdgeBleed();
  gateInkSpan();
  gateRowsMove();
  gateBoltLoopCloses();
  gateBurstExpands();
  gateArrowAimsAlongX();
  gateHandsPatchInset();
  gateFingerGaps();
  gateHandsMeetTheGround();
  gateDrawnStates();
  gateWarmRows();
  gateCellGeometry();
  return [...failures];
}
