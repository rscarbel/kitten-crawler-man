/**
 * The Crocodilians' art gates: the janitor and Sydney, and the heal sparkle
 * every hireling's heal leaves.
 *
 * Pixel gates paint cells exactly the way the runtime cache bakes them, so what
 * is measured is what the game blits; pose-stream gates measure the rig and
 * need no pixels. Failures accumulate so one run reports everything wrong, and
 * every filtering loop counts what it examined — a gate that finds nothing to
 * measure fails rather than passing.
 *
 *   npm run gates:crocodilian
 *
 * The review harness, `npm run render:crocodilian`, runs these first.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  JANITOR_BUILD,
  MOP_GRIP_TOP_MARGIN,
  MOP_HANDLE_HALF,
  MOP_HANDLE_LENGTH,
  SYDNEY_BUILD,
  legReachLimit,
  measureHands,
  measureLegs,
  measureMop,
  pailMouth,
  skeletonLandmarks,
  TOOTH,
  type CrocBuild,
  type CrocView,
  type MopGeometry,
} from '../src/sprites/art/crocodilianArt.js';
import type { Pt } from '../src/sprites/art/bipedArt.js';
import {
  JANITOR_CELL,
  JANITOR_FIGURE,
  JANITOR_ROWS,
  SYDNEY_CELL,
  SYDNEY_FIGURE,
  SYDNEY_ROWS,
  TILE_SCALE,
  crocStateName,
  originOf,
  poseStream,
  tilesPerCycle,
  type CrocCell,
  type RowSpec,
} from '../src/sprites/art/crocodilianFigure.js';
import {
  JANITOR_MOP_FRAMES,
  JANITOR_MOP_STROKE_FRAMES,
  JANITOR_MOP_STROKE_PROGRESS,
  JANITOR_WRING_DUNK_FRAME,
  JANITOR_WRING_DUNK_PROGRESS,
  JANITOR_WRING_FRAMES,
  SYDNEY_TALK_PALM_FRAME,
} from '../src/sprites/crocodilianTiming.js';
import { crocodilianReachableStates } from '../src/sprites/crocodilianSprite.js';
import { HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE } from '../src/sprites/healSparkleSprite.js';
import { progressFrameIndex } from '../src/core/spriteAssets/SpriteRenderer.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha at or above which a pixel counts as solid body rather than shadow or glow. */
const SOLID_ALPHA = 200;
const INK_ALPHA = 24;
const BYTES_PER_PIXEL = 4;
const FLOAT_EPSILON = 1e-6;
/** Tiles are reported to a ten-thousandth, well under a pixel at any scale. */
const REPORT_DECIMALS = 4;
const PERCENT = 100;
const PERCENT_DECIMALS = 2;

const failures: string[] = [];

function pt(x: number, y: number): Pt {
  return { x, y };
}

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const pixelsByCell = new Map<string, Uint8ClampedArray>();

function cellPixels(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}.${state}[${frame}]`;
  const cached = pixelsByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  pixelsByCell.set(key, data);
  return data;
}

function framesOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) {
    fail('lookup', `${def.id} declares no state "${state}"`);
    return 0;
  }
  return declared.frames;
}

interface SolidBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Bounds of the solid (near-opaque) pixels — the body, not its shadow or glow. */
function solidBox(pixels: Uint8ClampedArray, width: number, height: number): SolidBox | null {
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return bottom < 0 ? null : { top, bottom, left, right };
}

/** Mean absolute alpha difference between two cells. */
function alphaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  let count = 0;
  for (let i = ALPHA_OFFSET; i < a.length; i += CHANNELS) {
    total += Math.abs(a[i] - b[i]);
    count++;
  }
  return total / count;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((l, r) => l - r);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;

function hexRgb(hex: string): Rgb {
  const channel = (index: number): number =>
    parseInt(hex.slice(1 + index * HEX_PAIR, 1 + (index + 1) * HEX_PAIR), HEX_RADIX);
  return { r: channel(0), g: channel(1), b: channel(2) };
}

// ── G1: structure ────────────────────────────────────────────────────────────

/** No clipped pose, no blank frame, and cells no larger than their widest pose needs. */
function gateStructure(): void {
  for (const f of figureStructuralFailures(JANITOR_FIGURE)) fail('G1', f);
  for (const f of figureStructuralFailures(SYDNEY_FIGURE)) fail('G1', f);
  for (const f of figureStructuralFailures(HEAL_SPARKLE_FIGURE)) fail('G1', f);
}

// ── G2: the feet stand on the ground line ────────────────────────────────────

/**
 * Where the lowest solid pixel of a standing frame may sit, in cell pixels
 * below the cell's ground row. The claws and the outline under them always
 * reach a pixel or more past the line (measured 2–4 on the shipped art), so a
 * sole at or above the line is a figure floating off its tile; more than the
 * ceiling below and it has sunk through the floor.
 */
const GROUND_MIN_SINK_PX = 1;
const GROUND_MAX_SINK_PX = 5;

/** Cell pixels round the strands' outermost points that the sole search leaves to the mop. */
const STRAND_EXCLUSION_MARGIN_PX = 4;

/**
 * The mop's strands lie on the floor too, and head-on they lie in front of his
 * feet — lower in the picture than his soles — so the sole is looked for
 * outside the strands' own box.
 */
function strandBox(cell: CrocCell, mop: MopGeometry | null): SolidBox | null {
  if (mop === null) return null;
  const origin = originOf(cell);
  const points = [...mop.roots, ...mop.bends, ...mop.tips];
  const xs = points.map((p) => origin.x + p.x * TILE_SCALE);
  const ys = points.map((p) => origin.y + p.y * TILE_SCALE);
  return {
    left: Math.min(...xs) - STRAND_EXCLUSION_MARGIN_PX,
    right: Math.max(...xs) + STRAND_EXCLUSION_MARGIN_PX,
    top: Math.min(...ys) - STRAND_EXCLUSION_MARGIN_PX,
    bottom: Math.max(...ys) + STRAND_EXCLUSION_MARGIN_PX,
  };
}

function solidBoxOutside(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  exclude: SolidBox | null,
): SolidBox | null {
  if (exclude === null) return solidBox(pixels, width, height);
  const masked = pixels.slice();
  for (
    let y = Math.max(0, Math.floor(exclude.top));
    y <= Math.min(height - 1, exclude.bottom);
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(exclude.left));
      x <= Math.min(width - 1, exclude.right);
      x++
    ) {
      masked[(y * width + x) * CHANNELS + ALPHA_OFFSET] = 0;
    }
  }
  return solidBox(masked, width, height);
}

function gateGroundLine(): void {
  let measured = 0;
  const check = (
    def: FigureDef,
    cell: CrocCell,
    state: string,
    mopAt: (frame: number) => MopGeometry | null = () => null,
  ): void => {
    const ground = originOf(cell).y;
    for (let frame = 0; frame < framesOf(def, state); frame++) {
      const box = solidBoxOutside(
        cellPixels(def, state, frame),
        def.frameWidth,
        def.frameHeight,
        strandBox(cell, mopAt(frame)),
      );
      if (box === null) {
        fail('G2', `${def.id}.${state}[${frame}] has no solid pixels to stand on`);
        continue;
      }
      measured++;
      const offset = box.bottom + 1 - ground;
      if (offset < GROUND_MIN_SINK_PX || offset > GROUND_MAX_SINK_PX) {
        fail(
          'G2',
          `${def.id}.${state}[${frame}] has its sole ${offset.toFixed(0)}px from the ground row ` +
            `(allowed ${GROUND_MIN_SINK_PX}..${GROUND_MAX_SINK_PX} below) — it floats or sinks`,
        );
      }
    }
  };
  // Head-on the stroking strands pass right in front of his feet, so only
  // the profile of the mop row is measured.
  const standing: readonly (readonly [string, CrocView])[] = [
    ['idle', 'front'],
    ['idle', 'side'],
    ['idle', 'away'],
    ['mop', 'side'],
  ];
  {
    for (const [base, view] of standing) {
      const row = janitorRow('G2', base, view);
      if (row === undefined) continue;
      check(JANITOR_FIGURE, JANITOR_CELL, row.name, (frame) =>
        measureMop(JANITOR_BUILD, row.pose(frame), row.view),
      );
    }
  }
  for (const state of ['idle', 'idle_side', 'idle_away', 'talk', 'talk_side', 'talk_away']) {
    check(SYDNEY_FIGURE, SYDNEY_CELL, state);
  }
  failUnlessMeasured('G2', measured, 'standing frames');
}

// ── G3: loops close, and nothing snaps ───────────────────────────────────────

/**
 * The loop seam — last frame to first — as a band. Its ceiling is against the
 * row's largest interior step, because a short sinusoidal row legitimately
 * alternates long and short steps, and a real pop exceeds every one of them;
 * its floor is against the median, because a last frame that repeats the first
 * holds the cycle still for a frame.
 */
const SEAM_MAX_RATIO = 1.3;
const SEAM_MIN_RATIO = 0.3;
/** No consecutive step may be this far above the row's second-largest step. */
const SNAP_RATIO = 2.4;

function gateLoops(def: FigureDef, rows: readonly RowSpec[]): void {
  let measured = 0;
  for (const row of rows) {
    const n = framesOf(def, row.name);
    if (n < 2) {
      fail('G3', `${def.id}.${row.name} declares ${n} frames, too few to step between`);
      continue;
    }
    const steps: number[] = [];
    for (let f = 1; f < n; f++) {
      steps.push(alphaDelta(cellPixels(def, row.name, f - 1), cellPixels(def, row.name, f)));
    }
    const typical = median(steps);
    const sorted = [...steps].sort((l, r) => l - r);
    const secondLargest = sorted.length > 1 ? sorted[sorted.length - 2] : sorted[0];
    for (let i = 0; i < steps.length; i++) {
      if (secondLargest > 0 && steps[i] > secondLargest * SNAP_RATIO && row.loops) {
        fail(
          'G3',
          `${def.id}.${row.name} jumps between frames ${i} and ${i + 1}: step ${steps[i].toFixed(2)} ` +
            `against the next largest ${secondLargest.toFixed(2)} (limit ${SNAP_RATIO}×)`,
        );
      }
    }
    if (!row.loops) continue;
    measured++;
    const seam = alphaDelta(cellPixels(def, row.name, n - 1), cellPixels(def, row.name, 0));
    const largest = Math.max(...steps);
    const tooBig = seam > largest * SEAM_MAX_RATIO;
    const tooSmall = seam < typical * SEAM_MIN_RATIO;
    if (tooBig || tooSmall) {
      fail(
        'G3',
        `${def.id}.${row.name} loop seam is ${seam.toFixed(2)} against a largest step of ` +
          `${largest.toFixed(2)} and a median of ${typical.toFixed(2)} (allowed ` +
          `${SEAM_MIN_RATIO}× median to ${SEAM_MAX_RATIO}× largest)`,
      );
    }
  }
  failUnlessMeasured('G3', measured, `looping rows on ${def.id}`);
}

// ── G4: the legs never clamp ─────────────────────────────────────────────────

/** A leg must keep this share of its reach in hand on every planted frame. */
const REACH_HEADROOM = 0.004;

function gateReach(build: CrocBuild, rows: readonly RowSpec[], label: string): void {
  const limit = legReachLimit(build) - REACH_HEADROOM;
  let measured = 0;
  for (const { row, frame, pose } of poseStream(rows)) {
    if (row.gait === null) continue;
    const legs = measureLegs(build, pose, row.view);
    for (const [side, foot, leg] of [
      ['near', pose.near, legs.near],
      ['far', pose.far, legs.far],
    ] as const) {
      if (Math.abs(foot.ball.y) > FLOAT_EPSILON) continue;
      measured++;
      if (leg.hipToAnkle > limit) {
        fail(
          'G4',
          `${label}.${row.name}[${frame}] ${side} leg spans ${leg.hipToAnkle.toFixed(REPORT_DECIMALS)} of a ` +
            `${legReachLimit(build).toFixed(REPORT_DECIMALS)} reach — it locks straight and the step hops`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, `planted feet on ${label}`);
}

// ── G5: a planted foot does not slide ────────────────────────────────────────

/**
 * Edge-on, a planted ball must move back through the cell at exactly the rate
 * the figure is carried over the floor — the cycle's ground divided by its
 * frames — or the walk moonwalks or skates.
 */
const SLIDE_TOLERANCE = 0.002;

function gateFootSlide(build: CrocBuild, rows: readonly RowSpec[], label: string): void {
  let measured = 0;
  for (const row of rows) {
    if (row.gait === null || row.view !== 'side') continue;
    const perFrame = tilesPerCycle(build, row.gait) / row.frameCount;
    const stream = poseStream([row]);
    for (let i = 1; i < stream.length; i++) {
      for (const side of ['near', 'far'] as const) {
        const before = stream[i - 1].pose[side];
        const after = stream[i].pose[side];
        const planted =
          Math.abs(before.ball.y) < FLOAT_EPSILON && Math.abs(after.ball.y) < FLOAT_EPSILON;
        // Two planted frames in a row are stance, unless the foot moved
        // forward — that is a swing that has just landed. A planted foot that
        // does not move at all is still stance, and fails: the body is being
        // carried over the floor and the foot must slide back with it.
        if (!planted || after.ball.x > before.ball.x) continue;
        measured++;
        const slid = before.ball.x - after.ball.x;
        if (Math.abs(slid - perFrame) > SLIDE_TOLERANCE) {
          fail(
            'G5',
            `${label}.${row.name}[${i}] ${side} planted foot moved ${slid.toFixed(REPORT_DECIMALS)} tiles against ` +
              `the ${perFrame.toFixed(REPORT_DECIMALS)} the figure travels per frame`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', measured, `planted steps on ${label}`);
}

// ── G6: the impact frames are the peaks ──────────────────────────────────────

function rowNamed(rows: readonly RowSpec[], name: string): RowSpec | undefined {
  const row = rows.find((r) => r.name === name);
  if (row === undefined) fail('G6', `no row named ${name}`);
  return row;
}

/**
 * Sydney's palm frame is the first frame her hand is fully out. Her dialog
 * lands on it, so a choreography edit that moves the peak must move the
 * constant with it. The janitor's event frames are G15 and G16.
 */
function gateImpactFrames(): void {
  let measured = 0;
  const talk = rowNamed(SYDNEY_ROWS, 'talk_side');
  if (talk !== undefined) {
    const out = Array.from({ length: talk.frameCount }, (_u, f) => {
      const hands = measureHands(SYDNEY_BUILD, talk.pose(f), 'side');
      return hands.near.end.x - hands.near.root.x;
    });
    measured++;
    const most = Math.max(...out);
    const first = out.findIndex((v) => v > most - FLOAT_EPSILON);
    if (first !== SYDNEY_TALK_PALM_FRAME) {
      fail(
        'G6',
        `Sydney's palm is first fully out on frame ${first}, not ${SYDNEY_TALK_PALM_FRAME}`,
      );
    }
  }
  failUnlessMeasured('G6', measured, 'impact rows');
}

// ── G8: the runtime's own names ──────────────────────────────────────────────

function gateStateNames(): void {
  for (const f of missingStateFailures(
    JANITOR_FIGURE,
    crocodilianReachableStates('janitor'),
    'crocodilianReachableStates(janitor)',
  ))
    fail('G8', f);
  for (const f of missingStateFailures(
    SYDNEY_FIGURE,
    crocodilianReachableStates('sydney'),
    'crocodilianReachableStates(sydney)',
  ))
    fail('G8', f);
  for (const f of missingStateFailures(
    HEAL_SPARKLE_FIGURE,
    [HEAL_SPARKLE_STATE],
    'the sparkle draw',
  ))
    fail('G8', f);
}

// ── G10: the teeth show ──────────────────────────────────────────────────────

/**
 * The row of teeth on the lipline is what makes the head read as a crocodile
 * rather than as a bill, so it has to survive the bake in every view that
 * faces the jaw.
 *
 * Counted inside the head's own box only, and at a tolerance tighter than the
 * gap to any other colour on or near the head — the belly's lightest ivory is
 * 36 steps off, the eye glint 45, the pearl 38 — so the chest print, the tin
 * bucket and the glint cannot stand in for missing teeth.
 */
const TOOTH_RGB = hexRgb(TOOTH);
const TOOTH_TOLERANCE = 14;
/**
 * A share of the head box's solid pixels. The thinnest shipped view (Bucket
 * Boy head-on, turned three-quarters) measures about 1.65%; half of that is a
 * row of teeth that has shrunk into the lipline.
 */
const TOOTH_MIN_SHARE = 0.008;
/** The head box, in head heights about the skull's centre: back of the skull to past the snout tip. */
const HEAD_BOX_BACK = 0.7;
const HEAD_BOX_BEYOND_SNOUT = 0.2;
const HEAD_BOX_ABOVE = 0.8;
const HEAD_BOX_BELOW = 0.6;

function toothShareInHead(
  def: FigureDef,
  rows: readonly RowSpec[],
  build: CrocBuild,
  cell: CrocCell,
  state: string,
): number | null {
  const row = rows.find((r) => r.name === state);
  if (row === undefined) return null;
  const head = skeletonLandmarks(build, row.pose(0), row.view).headCentre;
  const origin = originOf(cell);
  const unit = build.headHeight * TILE_SCALE;
  const cx = origin.x + head.x * TILE_SCALE;
  const cy = origin.y + head.y * TILE_SCALE;
  const x0 = Math.max(0, Math.floor(cx - HEAD_BOX_BACK * unit));
  const x1 = Math.min(
    def.frameWidth,
    Math.ceil(cx + (build.snoutLength + HEAD_BOX_BEYOND_SNOUT) * unit),
  );
  const y0 = Math.max(0, Math.floor(cy - HEAD_BOX_ABOVE * unit));
  const y1 = Math.min(def.frameHeight, Math.ceil(cy + HEAD_BOX_BELOW * unit));
  const pixels = cellPixels(def, state, 0);
  let solid = 0;
  let teeth = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * def.frameWidth + x) * CHANNELS;
      if (pixels[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      solid++;
      const close =
        Math.abs(pixels[i] - TOOTH_RGB.r) <= TOOTH_TOLERANCE &&
        Math.abs(pixels[i + 1] - TOOTH_RGB.g) <= TOOTH_TOLERANCE &&
        Math.abs(pixels[i + 2] - TOOTH_RGB.b) <= TOOTH_TOLERANCE;
      if (close) teeth++;
    }
  }
  return solid === 0 ? 0 : teeth / solid;
}

function gateTeeth(): void {
  let measured = 0;
  const check = (
    def: FigureDef,
    rows: readonly RowSpec[],
    build: CrocBuild,
    cell: CrocCell,
    state: string,
  ): void => {
    const share = toothShareInHead(def, rows, build, cell, state);
    if (share === null) {
      fail('G10', `${def.id} has no row ${state} to find the teeth in`);
      return;
    }
    measured++;
    if (share < TOOTH_MIN_SHARE) {
      fail(
        'G10',
        `${def.id}.${state} shows ${(share * PERCENT).toFixed(PERCENT_DECIMALS)}% tooth ivory in its head; the lipline needs ${(TOOTH_MIN_SHARE * PERCENT).toFixed(PERCENT_DECIMALS)}%`,
      );
    }
  };
  // Not from behind: the tooth rows are on the far side of the jaw there.
  for (const state of ['idle', 'idle_side']) {
    check(JANITOR_FIGURE, JANITOR_ROWS, JANITOR_BUILD, JANITOR_CELL, state);
    check(SYDNEY_FIGURE, SYDNEY_ROWS, SYDNEY_BUILD, SYDNEY_CELL, state);
  }
  failUnlessMeasured('G10', measured, 'jaw frames');
}

// ── G12: every frame is its own picture ──────────────────────────────────────

/** The wring starts and ends on the idle's rest pose, so it hands over from and back to the idle without a snap. */
function wringStartsAndEndsAtRest(state: string, earlier: number, later: number): boolean {
  return state.startsWith('wring') && earlier === 0 && later === JANITOR_WRING_FRAMES - 1;
}

function gateDistinctFrames(): void {
  for (const def of [JANITOR_FIGURE, SYDNEY_FIGURE, HEAL_SPARKLE_FIGURE]) {
    const report = distinctFrameFailures(def, (state, frame) => cellPixels(def, state, frame), {
      repeatsOnPurpose: wringStartsAndEndsAtRest,
    });
    for (const f of report.failures) fail('G12', f);
    failUnlessMeasured('G12', report.framesMeasured, `frames on ${def.id}`);
  }
}

// ── G13: warm-row memory ─────────────────────────────────────────────────────

function gateWarmRows(): void {
  for (const def of [JANITOR_FIGURE, SYDNEY_FIGURE, HEAL_SPARKLE_FIGURE]) {
    let widest = 0;
    for (const [, declared] of def.states) {
      widest = Math.max(
        widest,
        declared.frames * def.frameWidth * def.frameHeight * BYTES_PER_PIXEL,
      );
    }
    if (widest > figureByteBudgetFor(def)) {
      fail(
        'G13',
        `${def.id}'s widest row holds ${widest} bytes, over its ${figureByteBudgetFor(def)}-byte ceiling`,
      );
    }
  }
}

// ── G14: the sparkle fades out ───────────────────────────────────────────────

/** The sparkle's first frame must be its brightest half and its last a near-empty fade. */
function gateSparkleFade(): void {
  const n = framesOf(HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE);
  if (n < 2) {
    fail('G14', `the sparkle declares ${n} frames; a fade needs at least a first and a last`);
    return;
  }
  const inkOf = (frame: number): number => {
    const pixels = cellPixels(HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE, frame);
    let ink = 0;
    for (let i = ALPHA_OFFSET; i < pixels.length; i += CHANNELS) if (pixels[i] >= INK_ALPHA) ink++;
    return ink;
  };
  const inks = Array.from({ length: n }, (_u, f) => inkOf(f));
  const peak = Math.max(...inks);
  if (inks[n - 1] > peak * SPARKLE_END_SHARE) {
    fail(
      'G14',
      `the sparkle's last frame still has ${inks[n - 1]} lit pixels against a peak of ${peak} — it pops off instead of fading`,
    );
  }
  if (inks[0] < peak * SPARKLE_START_SHARE) {
    fail(
      'G14',
      `the sparkle's first frame has ${inks[0]} lit pixels against a peak of ${peak} — the heal lands on a blank frame`,
    );
  }
  if (inkBoxOf(HEAL_SPARKLE_FIGURE, HEAL_SPARKLE_STATE, 0) === null)
    fail('G14', 'the sparkle paints nothing on its first frame');
}

const SPARKLE_END_SHARE = 0.25;
const SPARKLE_START_SHARE = 0.2;

// ── The janitor's mop ────────────────────────────────────────────────────────

const JANITOR_VIEWS: readonly CrocView[] = ['front', 'side', 'away'];

function janitorRow(id: string, base: string, view: CrocView): RowSpec | undefined {
  const name = crocStateName(base, view);
  const row = JANITOR_ROWS.find((r) => r.name === name);
  if (row === undefined) fail(id, `the janitor has no row ${name}`);
  return row;
}

function mopOf(id: string, row: RowSpec, frame: number): MopGeometry | null {
  const mop = measureMop(JANITOR_BUILD, row.pose(frame), row.view);
  if (mop === null) fail(id, `janitor.${row.name}[${frame}] holds no mop`);
  return mop;
}

function lowestTip(mop: MopGeometry): number {
  return Math.max(...mop.tips.map((tip) => tip.y));
}

// ── G15: the strokes cross him, and swish where the timing says ──────────────

/** Each stroke must carry the strands this far either side of his centreline, in tiles across the floor. */
const STROKE_MIN_REACH = 0.15;
/** Head-on, the painted head's centre must swing this many cell pixels either side of the body's line. */
const STROKE_MIN_PAINTED_SWING_PX = 8;
/** Head-on the strands lie in front of his feet: rows from this far under the ground line hold nothing else. */
const STRAND_BAND_BELOW_GROUND_PX = 6;
const STROKES_PER_CYCLE = 2;

/** The frame, within each stroke's half of the cycle, at which a per-frame speed peaks. */
function strokePeaks(speeds: readonly number[]): number[] {
  const half = speeds.length / STROKES_PER_CYCLE;
  return Array.from({ length: STROKES_PER_CYCLE }, (_u, k) => {
    const slice = speeds.slice(k * half, (k + 1) * half);
    return k * half + slice.indexOf(Math.max(...slice));
  });
}

/** Centred difference round the loop, so the first and last frames are measured like the rest. */
function loopSpeeds(values: readonly Pt[]): number[] {
  const n = values.length;
  return values.map((_v, f) => {
    const next = values[(f + 1) % n];
    const prev = values[(f - 1 + n) % n];
    return Math.hypot(next.x - prev.x, next.y - prev.y);
  });
}

/** Mean x of the solid pixels in the rows under the feet, where only the strands lie head-on; null if none. */
function strandCentreX(pixels: Uint8ClampedArray, def: FigureDef, fromRow: number): number | null {
  let total = 0;
  let count = 0;
  for (let y = Math.max(0, fromRow); y < def.frameHeight; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      if (pixels[(y * def.frameWidth + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      total += x;
      count++;
    }
  }
  return count === 0 ? null : total / count;
}

function gateMopStrokes(): void {
  let measured = 0;
  JANITOR_MOP_STROKE_PROGRESS.forEach((progress, k) => {
    const shown = progressFrameIndex(progress, JANITOR_MOP_FRAMES);
    if (shown !== JANITOR_MOP_STROKE_FRAMES[k]) {
      fail(
        'G15',
        `JANITOR_MOP_STROKE_PROGRESS[${k}] shows frame ${shown}, not ${JANITOR_MOP_STROKE_FRAMES[k]}`,
      );
    }
  });
  for (const view of JANITOR_VIEWS) {
    const row = janitorRow('G15', 'mop', view);
    if (row === undefined) continue;
    const spots: Pt[] = [];
    for (let f = 0; f < row.frameCount; f++) {
      const mop = row.pose(f).mop;
      if (mop === null) {
        fail('G15', `janitor.${row.name}[${f}] holds no mop`);
        continue;
      }
      spots.push(pt(mop.lateral, mop.forward));
    }
    if (spots.length !== row.frameCount) continue;
    measured++;
    const laterals = spots.map((p) => p.x);
    const least = Math.min(...laterals);
    const most = Math.max(...laterals);
    // From behind the arc is kept out past his right leg so his body does not
    // hide it; there it must still sweep as wide, just not across his middle.
    const crossesHim = view !== 'away';
    const narrow = crossesHim
      ? least > -STROKE_MIN_REACH || most < STROKE_MIN_REACH
      : most - least < STROKE_MIN_REACH * 2;
    if (narrow) {
      fail(
        'G15',
        `janitor.${row.name} strokes reach ${least.toFixed(REPORT_DECIMALS)}..${most.toFixed(REPORT_DECIMALS)} across; ` +
          (crossesHim
            ? `each side needs ${STROKE_MIN_REACH}`
            : `the sweep needs ${STROKE_MIN_REACH * 2}`),
      );
    }
    // The swish is the strands moving fastest across the floor: measured in
    // the floor's own frame, which every view projects without bending.
    const peaks = strokePeaks(loopSpeeds(spots));
    peaks.forEach((peak, k) => {
      if (peak !== JANITOR_MOP_STROKE_FRAMES[k]) {
        fail(
          'G15',
          `janitor.${row.name} stroke ${k + 1} is fastest on frame ${peak}, not its swish frame ${JANITOR_MOP_STROKE_FRAMES[k]}`,
        );
      }
    });
  }
  // Painted, head-on: the strands' ink swings out either side and is fastest on the swish frames.
  const front = janitorRow('G15', 'mop', 'front');
  if (front !== undefined) {
    const origin = originOf(JANITOR_CELL);
    const centres: Pt[] = [];
    for (let f = 0; f < front.frameCount; f++) {
      const x = strandCentreX(
        cellPixels(JANITOR_FIGURE, front.name, f),
        JANITOR_FIGURE,
        origin.y + STRAND_BAND_BELOW_GROUND_PX,
      );
      if (x === null) {
        fail('G15', `janitor.${front.name}[${f}] paints no strands in front of his feet`);
        continue;
      }
      centres.push(pt(x, 0));
    }
    if (centres.length === front.frameCount) {
      measured++;
      const xs = centres.map((c) => c.x - origin.x);
      if (
        Math.min(...xs) > -STROKE_MIN_PAINTED_SWING_PX ||
        Math.max(...xs) < STROKE_MIN_PAINTED_SWING_PX
      ) {
        fail(
          'G15',
          `janitor.${front.name}'s painted strands swing ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}px about his centre; each side needs ${STROKE_MIN_PAINTED_SWING_PX}px`,
        );
      }
      strokePeaks(loopSpeeds(centres)).forEach((peak, k) => {
        if (peak !== JANITOR_MOP_STROKE_FRAMES[k]) {
          fail(
            'G15',
            `janitor.${front.name}'s painted stroke ${k + 1} is fastest on frame ${peak}, not ${JANITOR_MOP_STROKE_FRAMES[k]}`,
          );
        }
      });
    }
  }
  failUnlessMeasured('G15', measured, 'mop rows');
}

// ── G16: the wring dunks the strands in the pail on the slosh frame ─────────

/** By its last frame the pail is back in his hand and the mop back on the floor, so the row hands back to the idle. */
function gateWringDunk(): void {
  let measured = 0;
  const shown = progressFrameIndex(JANITOR_WRING_DUNK_PROGRESS, JANITOR_WRING_FRAMES);
  if (shown !== JANITOR_WRING_DUNK_FRAME) {
    fail(
      'G16',
      `JANITOR_WRING_DUNK_PROGRESS shows frame ${shown}, not ${JANITOR_WRING_DUNK_FRAME}`,
    );
  }
  for (const view of JANITOR_VIEWS) {
    const row = janitorRow('G16', 'wring', view);
    if (row === undefined) continue;
    let firstIn: number | null = null;
    let twistedClear = false;
    for (let f = 0; f < row.frameCount; f++) {
      const pose = row.pose(f);
      const mop = mopOf('G16', row, f);
      if (mop === null || pose.mop === null) continue;
      const pail = pailMouth(pose);
      // In the pail: the strand head stands on the pail's own spot on the
      // floor — both measured in the same picture, so depth counts — and the
      // strands reach down under its rim.
      const inside =
        pail !== null &&
        Math.abs(mop.ground.x - pail.floor.x) < pail.halfWidth &&
        Math.abs(mop.ground.y - pail.floor.y) < pail.halfWidth &&
        lowestTip(mop) > pail.rimY;
      if (inside && firstIn === null) firstIn = f;
      if (inside !== pose.mop.inPail) {
        fail(
          'G16',
          `janitor.${row.name}[${f}] has its strands ${inside ? 'in' : 'out of'} the pail but paints them as ${pose.mop.inPail ? 'in' : 'out of'} it`,
        );
      }
      const clearOfRim = pail !== null && lowestTip(mop) < pail.rimY;
      if (pose.mop.twist > WRUNG_TWIST && clearOfRim) twistedClear = true;
    }
    measured++;
    if (firstIn !== JANITOR_WRING_DUNK_FRAME) {
      fail(
        'G16',
        `janitor.${row.name} first dunks the strands in the pail on frame ${firstIn ?? 'never'}, not the slosh frame ${JANITOR_WRING_DUNK_FRAME}`,
      );
    }
    if (!twistedClear) fail('G16', `janitor.${row.name} never wrings the mop out over the pail`);
    const last = row.pose(row.frameCount - 1);
    if (last.bucket.kind !== 'hang' || last.mop === null || last.mop.lift > FLOAT_EPSILON) {
      fail(
        'G16',
        `janitor.${row.name} does not end with the pail in hand and the mop on the floor`,
      );
    }
  }
  failUnlessMeasured('G16', measured, 'wring rows');
}

/** A twist this far toward a rope counts as wrung. */
const WRUNG_TWIST = 0.9;

// ── G17: pushed or stroked, the strands stay on the floor ────────────────────

/** The painted strands' lowest solid row may sit no more than this above the floor under the head. */
const STRAND_TOUCH_TOLERANCE_PX = 1;
/** Columns either side of the strands' tips the painted check looks in: the strands' width and outline. */
const STRAND_COLUMN_MARGIN_PX = 2;

function gateMopOnFloor(): void {
  let measured = 0;
  const origin = originOf(JANITOR_CELL);
  for (const base of ['walk_mop', 'mop']) {
    for (const view of JANITOR_VIEWS) {
      const row = janitorRow('G17', base, view);
      if (row === undefined) continue;
      for (let f = 0; f < row.frameCount; f++) {
        const mop = mopOf('G17', row, f);
        if (mop === null) continue;
        measured++;
        if (lowestTip(mop) < mop.ground.y - FLOAT_EPSILON) {
          fail(
            'G17',
            `janitor.${row.name}[${f}]'s strands hang ${(mop.ground.y - lowestTip(mop)).toFixed(REPORT_DECIMALS)} tiles clear of the floor`,
          );
        }
        // From behind the strands are among his feet; the pose check covers that view.
        if (view === 'away') continue;
        const xs = mop.tips.map((tip) => origin.x + tip.x * TILE_SCALE);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)) - STRAND_COLUMN_MARGIN_PX);
        const x1 = Math.min(
          JANITOR_FIGURE.frameWidth,
          Math.ceil(Math.max(...xs)) + STRAND_COLUMN_MARGIN_PX,
        );
        const pixels = cellPixels(JANITOR_FIGURE, row.name, f);
        let lowest = -1;
        for (let y = 0; y < JANITOR_FIGURE.frameHeight; y++) {
          for (let x = x0; x < x1; x++) {
            if (
              pixels[(y * JANITOR_FIGURE.frameWidth + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA
            )
              lowest = y;
          }
        }
        const floorRow = origin.y + mop.ground.y * TILE_SCALE;
        if (lowest < floorRow - STRAND_TOUCH_TOLERANCE_PX) {
          fail(
            'G17',
            `janitor.${row.name}[${f}] paints its strands down to row ${lowest}, above the floor under them at ${floorRow.toFixed(1)}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G17', measured, 'mop frames on the floor');
}

// ── G18: the fists are on the handle ─────────────────────────────────────────

/** A near fist this far off the handle's centreline, in handle half-widths, has let go of it. */
const GRIP_OFF_HANDLE_HALVES = 2;
/** The strand bundle is wider than the handle: a fist closed on it may sit this far off its centreline. */
const GRIP_OFF_STRANDS_HALVES = 3;

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** The middle of the strands' tips: the far end of the bundle hanging from the clamp. */
function bundleEnd(mop: MopGeometry): Pt {
  const n = mop.tips.length;
  return pt(
    mop.tips.reduce((sum, tip) => sum + tip.x, 0) / n,
    mop.tips.reduce((sum, tip) => sum + tip.y, 0) / n,
  );
}

function gateMopGrips(): void {
  let measured = 0;
  for (const row of JANITOR_ROWS) {
    for (let f = 0; f < row.frameCount; f++) {
      const pose = row.pose(f);
      if (pose.mop === null) {
        fail('G18', `janitor.${row.name}[${f}] holds no mop`);
        continue;
      }
      const mop = mopOf('G18', row, f);
      if (mop === null) continue;
      measured++;
      const along = Math.hypot(mop.grip.x - mop.socket.x, mop.grip.y - mop.socket.y);
      if (along > MOP_HANDLE_LENGTH - MOP_GRIP_TOP_MARGIN || mop.grip.y >= mop.socket.y) {
        fail(
          'G18',
          `janitor.${row.name}[${f}]'s far fist is ${along.toFixed(REPORT_DECIMALS)} up a ${MOP_HANDLE_LENGTH}-tile handle — off its top or below its foot`,
        );
      }
      if (pose.mop.twoHanded !== (mop.nearGrip !== null))
        fail('G18', `janitor.${row.name}[${f}] loses its near grip`);
      if (mop.nearGrip === null) continue;
      // The near fist holds either the handle or, wringing, the strands under the clamp.
      const offHandle = distanceToSegment(mop.nearGrip, mop.socket, mop.top);
      const offStrands = distanceToSegment(mop.nearGrip, mop.socket, bundleEnd(mop));
      if (
        offHandle > MOP_HANDLE_HALF * GRIP_OFF_HANDLE_HALVES &&
        offStrands > MOP_HANDLE_HALF * GRIP_OFF_STRANDS_HALVES
      ) {
        fail(
          'G18',
          `janitor.${row.name}[${f}]'s near fist is ${offHandle.toFixed(REPORT_DECIMALS)} tiles off the handle and ${offStrands.toFixed(REPORT_DECIMALS)} off the strands`,
        );
      }
    }
  }
  failUnlessMeasured('G18', measured, 'frames holding the mop');
}

// ── G19: edge-on, the handle clears his snout ────────────────────────────────

/**
 * Edge-on the mop is in his far hand, so its handle is painted behind the
 * head: where it crosses the long snout it reads as run through the jaw.
 * Behind the skull it reads as behind him and is fine. The snout's box is in
 * head heights about the skull's centre.
 */
const SNOUT_BOX_FROM = 0.25;
const SNOUT_BOX_ABOVE = 0.2;
const SNOUT_BOX_BELOW = 0.35;
const HANDLE_SAMPLES = 24;

function gateHandleClearsSnout(): void {
  let measured = 0;
  const hh = JANITOR_BUILD.headHeight;
  for (const row of JANITOR_ROWS) {
    if (row.view !== 'side') continue;
    for (let f = 0; f < row.frameCount; f++) {
      const pose = row.pose(f);
      const mop = mopOf('G19', row, f);
      if (mop === null) continue;
      measured++;
      const head = skeletonLandmarks(JANITOR_BUILD, pose, row.view).headCentre;
      const left = head.x + SNOUT_BOX_FROM * hh;
      const right = head.x + JANITOR_BUILD.snoutLength * hh;
      const top = head.y - SNOUT_BOX_ABOVE * hh;
      const bottom = head.y + SNOUT_BOX_BELOW * hh;
      for (let k = 0; k <= HANDLE_SAMPLES; k++) {
        const t = k / HANDLE_SAMPLES;
        const x = mop.socket.x + (mop.top.x - mop.socket.x) * t;
        const y = mop.socket.y + (mop.top.y - mop.socket.y) * t;
        if (x > left && x < right && y > top && y < bottom) {
          fail(
            'G19',
            `janitor.${row.name}[${f}]'s handle crosses his snout at (${x.toFixed(REPORT_DECIMALS)}, ${y.toFixed(REPORT_DECIMALS)})`,
          );
          break;
        }
      }
    }
  }
  failUnlessMeasured('G19', measured, 'profile frames holding the mop');
}

/** Runs every crocodilian gate and returns one message per failure. */
export function crocodilianGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoops(JANITOR_FIGURE, JANITOR_ROWS);
  gateLoops(SYDNEY_FIGURE, SYDNEY_ROWS);
  gateReach(JANITOR_BUILD, JANITOR_ROWS, 'janitor');
  gateReach(SYDNEY_BUILD, SYDNEY_ROWS, 'sydney');
  gateFootSlide(JANITOR_BUILD, JANITOR_ROWS, 'janitor');
  gateFootSlide(SYDNEY_BUILD, SYDNEY_ROWS, 'sydney');
  gateImpactFrames();
  gateStateNames();
  gateTeeth();
  gateDistinctFrames();
  gateWarmRows();
  gateSparkleFade();
  gateMopStrokes();
  gateWringDunk();
  gateMopOnFloor();
  gateMopGrips();
  gateHandleClearsSnout();
  return [...failures];
}

if (process.argv[1].endsWith('gates-crocodilian.ts')) {
  reportFigureGates('crocodilians', crocodilianGateFailures());
}
