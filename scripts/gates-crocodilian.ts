/**
 * The Crocodilians' art gates: Bucket Boy, Clarabelle and the Triage sparkle.
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
  BUCKET_BOY_BUILD,
  CLARABELLE_BUILD,
  legReachLimit,
  measureHands,
  measureLegs,
  skeletonLandmarks,
  TOOTH,
  type CrocBuild,
} from '../src/sprites/art/crocodilianArt.js';
import {
  BUCKET_BOY_CELL,
  BUCKET_BOY_FIGURE,
  BUCKET_BOY_ROWS,
  CLARABELLE_CELL,
  CLARABELLE_FIGURE,
  CLARABELLE_ROWS,
  TILE_SCALE,
  TRIAGE_SPARKLE_FIGURE,
  TRIAGE_SPARKLE_STATE,
  originOf,
  poseStream,
  tilesPerCycle,
  type CrocCell,
  type RowSpec,
} from '../src/sprites/art/crocodilianFigure.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import {
  BUCKET_BOY_DEATH_FRAMES,
  BUCKET_BOY_SLAP_FRAMES,
  BUCKET_BOY_SLAP_IMPACT_FRAME,
  BUCKET_BOY_TRIAGE_FRAMES,
  BUCKET_BOY_TRIAGE_RELEASE_FRAME,
  CLARABELLE_TALK_PALM_FRAME,
  bucketBoySlapImpactProgress,
  bucketBoyTriageReleaseProgress,
} from '../src/sprites/crocodilianTiming.js';
import { crocodilianReachableStates } from '../src/sprites/crocodilianSprite.js';
import { progressFrameIndex } from '../src/core/SpriteRenderer.js';
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

/** Share of a cell's solid pixels within `tolerance` (per channel) of a colour. */
function colourShare(pixels: Uint8ClampedArray, colour: Rgb, tolerance: number): number {
  let solid = 0;
  let matched = 0;
  for (let i = 0; i < pixels.length; i += CHANNELS) {
    if (pixels[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    solid++;
    const close =
      Math.abs(pixels[i] - colour.r) <= tolerance &&
      Math.abs(pixels[i + 1] - colour.g) <= tolerance &&
      Math.abs(pixels[i + 2] - colour.b) <= tolerance;
    if (close) matched++;
  }
  return solid === 0 ? 0 : matched / solid;
}

// ── G1: structure ────────────────────────────────────────────────────────────

/** No clipped pose, no blank frame, and cells no larger than their widest pose needs. */
function gateStructure(): void {
  for (const f of figureStructuralFailures(BUCKET_BOY_FIGURE)) fail('G1', f);
  for (const f of figureStructuralFailures(CLARABELLE_FIGURE)) fail('G1', f);
  for (const f of figureStructuralFailures(TRIAGE_SPARKLE_FIGURE)) fail('G1', f);
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

function gateGroundLine(): void {
  let measured = 0;
  const check = (def: FigureDef, cell: CrocCell, state: string): void => {
    const ground = originOf(cell).y;
    for (let frame = 0; frame < framesOf(def, state); frame++) {
      const box = solidBox(cellPixels(def, state, frame), def.frameWidth, def.frameHeight);
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
  for (const state of ['idle', 'idle_side', 'idle_away', 'cower', 'cower_side', 'cower_away']) {
    check(BUCKET_BOY_FIGURE, BUCKET_BOY_CELL, state);
  }
  for (const state of ['idle', 'idle_side', 'idle_away', 'talk', 'talk_side', 'talk_away']) {
    check(CLARABELLE_FIGURE, CLARABELLE_CELL, state);
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
 * The slap's impact frame is the one its palm is furthest forward; the Triage
 * release frame is the one its glow peaks; Clarabelle's palm frame is the first
 * frame her hand is fully out. A kit lands its effect on these, so a
 * choreography edit that moves the peak must move the constant with it.
 */
function gateImpactFrames(): void {
  let measured = 0;
  const slap = rowNamed(BUCKET_BOY_ROWS, 'slap_side');
  if (slap !== undefined) {
    const reach = Array.from({ length: slap.frameCount }, (_u, f) => {
      const hands = measureHands(BUCKET_BOY_BUILD, slap.pose(f), 'side');
      return hands.far.end.x - hands.far.root.x;
    });
    measured++;
    const peak = reach.indexOf(Math.max(...reach));
    if (peak !== BUCKET_BOY_SLAP_IMPACT_FRAME) {
      fail(
        'G6',
        `the slap's palm is furthest forward on frame ${peak}, not the impact frame ${BUCKET_BOY_SLAP_IMPACT_FRAME}`,
      );
    }
  }
  for (const view of ['cast_triage', 'cast_triage_side', 'cast_triage_away']) {
    const row = rowNamed(BUCKET_BOY_ROWS, view);
    if (row === undefined) continue;
    const glow = Array.from({ length: row.frameCount }, (_u, f) => row.pose(f).glow);
    measured++;
    const peak = glow.indexOf(Math.max(...glow));
    if (peak !== BUCKET_BOY_TRIAGE_RELEASE_FRAME) {
      fail(
        'G6',
        `${view} glows brightest on frame ${peak}, not the release frame ${BUCKET_BOY_TRIAGE_RELEASE_FRAME}`,
      );
    }
  }
  const talk = rowNamed(CLARABELLE_ROWS, 'talk_side');
  if (talk !== undefined) {
    const out = Array.from({ length: talk.frameCount }, (_u, f) => {
      const hands = measureHands(CLARABELLE_BUILD, talk.pose(f), 'side');
      return hands.near.end.x - hands.near.root.x;
    });
    measured++;
    const most = Math.max(...out);
    const first = out.findIndex((v) => v > most - FLOAT_EPSILON);
    if (first !== CLARABELLE_TALK_PALM_FRAME) {
      fail(
        'G6',
        `Clarabelle's palm is first fully out on frame ${first}, not ${CLARABELLE_TALK_PALM_FRAME}`,
      );
    }
  }
  // The runtime picks frames with progressFrameIndex: the exported progress
  // must land exactly on the declared frame.
  const slapFrame = progressFrameIndex(bucketBoySlapImpactProgress(), BUCKET_BOY_SLAP_FRAMES);
  if (slapFrame !== BUCKET_BOY_SLAP_IMPACT_FRAME) {
    fail(
      'G6',
      `bucketBoySlapImpactProgress() shows frame ${slapFrame}, not ${BUCKET_BOY_SLAP_IMPACT_FRAME}`,
    );
  }
  const triageFrame = progressFrameIndex(
    bucketBoyTriageReleaseProgress(),
    BUCKET_BOY_TRIAGE_FRAMES,
  );
  if (triageFrame !== BUCKET_BOY_TRIAGE_RELEASE_FRAME) {
    fail(
      'G6',
      `bucketBoyTriageReleaseProgress() shows frame ${triageFrame}, not ${BUCKET_BOY_TRIAGE_RELEASE_FRAME}`,
    );
  }
  failUnlessMeasured('G6', measured, 'impact rows');
}

// ── G7: death ends on a corpse ───────────────────────────────────────────────

/**
 * The last death frame must be a body lying on the floor: much wider than it is
 * tall, and well under his standing height. The height allowance leaves room
 * for a limp arm and the snout, which lie across the body rather than along it.
 */
const CORPSE_ASPECT = 1.8;
const CORPSE_MAX_HEIGHT_TILES = 0.72;

function gateCorpse(): void {
  let measured = 0;
  for (const state of ['death', 'death_side', 'death_away']) {
    const n = framesOf(BUCKET_BOY_FIGURE, state);
    if (n === 0) continue;
    const last = solidBox(
      cellPixels(BUCKET_BOY_FIGURE, state, n - 1),
      BUCKET_BOY_FIGURE.frameWidth,
      BUCKET_BOY_FIGURE.frameHeight,
    );
    if (last === null) {
      fail('G7', `${state} ends on an empty frame`);
      continue;
    }
    measured++;
    const width = last.right - last.left + 1;
    const height = last.bottom - last.top + 1;
    if (width < height * CORPSE_ASPECT || height > CORPSE_MAX_HEIGHT_TILES * TILE_SCALE) {
      fail(
        'G7',
        `${state} ends on a ${width}×${height}px body — not lying down (needs ${CORPSE_ASPECT}× wider ` +
          `than tall and under ${CORPSE_MAX_HEIGHT_TILES * TILE_SCALE}px high)`,
      );
    }
  }
  failUnlessMeasured('G7', measured, 'death rows');
}

// ── G8: the runtime's own names ──────────────────────────────────────────────

function gateStateNames(): void {
  for (const f of missingStateFailures(
    BUCKET_BOY_FIGURE,
    crocodilianReachableStates('bucket_boy'),
    'crocodilianReachableStates(bucket_boy)',
  ))
    fail('G8', f);
  for (const f of missingStateFailures(
    CLARABELLE_FIGURE,
    crocodilianReachableStates('clarabelle'),
    'crocodilianReachableStates(clarabelle)',
  ))
    fail('G8', f);
  for (const f of missingStateFailures(
    TRIAGE_SPARKLE_FIGURE,
    [TRIAGE_SPARKLE_STATE],
    'the sparkle draw',
  ))
    fail('G8', f);
}

// ── G9: the armband is on the hireling, and only on the hireling ─────────────

/** The Meat Shields orange, and how close a baked pixel must come to count. */
const ARMBAND_RGB = hexRgb('#e06040');
const ARMBAND_TOLERANCE = 30;
/** A share of the body's solid pixels, not a count, so the floor means the same on both builds. */
const ARMBAND_MIN_SHARE = 0.004;
const ARMBAND_MAX_STRAY_SHARE = 0.0005;

function gateArmband(): void {
  let measured = 0;
  for (const state of ['idle', 'idle_side', 'idle_away', 'walk_side']) {
    const share = colourShare(
      cellPixels(BUCKET_BOY_FIGURE, state, 0),
      ARMBAND_RGB,
      ARMBAND_TOLERANCE,
    );
    measured++;
    if (share < ARMBAND_MIN_SHARE) {
      fail(
        'G9',
        `Bucket Boy's ${state} shows ${(share * PERCENT).toFixed(PERCENT_DECIMALS)}% armband orange; a hireling needs ${(ARMBAND_MIN_SHARE * PERCENT).toFixed(PERCENT_DECIMALS)}%`,
      );
    }
  }
  for (const state of ['idle', 'idle_side', 'idle_away']) {
    const share = colourShare(
      cellPixels(CLARABELLE_FIGURE, state, 0),
      ARMBAND_RGB,
      ARMBAND_TOLERANCE,
    );
    measured++;
    if (share > ARMBAND_MAX_STRAY_SHARE) {
      fail(
        'G9',
        `Clarabelle's ${state} shows ${(share * PERCENT).toFixed(PERCENT_DECIMALS)}% armband orange — the door staff are not Meat Shields`,
      );
    }
  }
  failUnlessMeasured('G9', measured, 'armband frames');
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
    check(BUCKET_BOY_FIGURE, BUCKET_BOY_ROWS, BUCKET_BOY_BUILD, BUCKET_BOY_CELL, state);
    check(CLARABELLE_FIGURE, CLARABELLE_ROWS, CLARABELLE_BUILD, CLARABELLE_CELL, state);
  }
  failUnlessMeasured('G10', measured, 'jaw frames');
}

// ── G11: heights against Carl ────────────────────────────────────────────────

/**
 * Bucket Boy is short and Clarabelle is big: measured against the player's own
 * standing height, in tiles, from the baked idle.
 */
/** Measured 0.64 on the shipped art: two-thirds of the player, a head and a half shorter. */
const BUCKET_BOY_MAX_SHARE_OF_CARL = 0.72;
/** Measured 1.18 on the shipped art. */
const CLARABELLE_MIN_SHARE_OF_CARL = 1.12;

function standingHeightTiles(def: FigureDef): number | null {
  const box = solidBox(cellPixels(def, 'idle', 0), def.frameWidth, def.frameHeight);
  return box === null ? null : (box.bottom - box.top + 1) / def.tileScale;
}

function gateHeights(): void {
  const carl = standingHeightTiles(HUMAN_FIGURE);
  const bucketBoy = standingHeightTiles(BUCKET_BOY_FIGURE);
  const clarabelle = standingHeightTiles(CLARABELLE_FIGURE);
  if (carl === null || bucketBoy === null || clarabelle === null) {
    fail('G11', 'could not measure a standing height');
    return;
  }
  if (bucketBoy > carl * BUCKET_BOY_MAX_SHARE_OF_CARL) {
    fail(
      'G11',
      `Bucket Boy stands ${bucketBoy.toFixed(2)} tiles against Carl's ${carl.toFixed(2)} — he is meant to be short (≤${BUCKET_BOY_MAX_SHARE_OF_CARL}×)`,
    );
  }
  if (clarabelle < carl * CLARABELLE_MIN_SHARE_OF_CARL) {
    fail(
      'G11',
      `Clarabelle stands ${clarabelle.toFixed(2)} tiles against Carl's ${carl.toFixed(2)} — a bouncer must tower (≥${CLARABELLE_MIN_SHARE_OF_CARL}×)`,
    );
  }
}

// ── G12: every frame is its own picture ──────────────────────────────────────

/**
 * Two repeats are on purpose: the last two death frames are the body at rest
 * after its bounce, which is what the runtime lingers on, and the slap's last
 * frame is its first, so it hands back to the idle without a snap.
 */
function gateDistinctFrames(): void {
  // A slap ends where it began, so handing back to the idle is not a snap.
  const slapReturn = (state: string, earlier: number, later: number): boolean =>
    state.startsWith('slap') && earlier === 0 && later === BUCKET_BOY_SLAP_FRAMES - 1;
  const corpseHold = (state: string, earlier: number, later: number): boolean =>
    state.startsWith('death') && later === earlier + 1 && earlier >= BUCKET_BOY_CORPSE_HELD_FROM;
  for (const def of [BUCKET_BOY_FIGURE, CLARABELLE_FIGURE, TRIAGE_SPARKLE_FIGURE]) {
    const report = distinctFrameFailures(def, (state, frame) => cellPixels(def, state, frame), {
      repeatsOnPurpose: (state, earlier, later) =>
        corpseHold(state, earlier, later) || slapReturn(state, earlier, later),
    });
    for (const f of report.failures) fail('G12', f);
    failUnlessMeasured('G12', report.framesMeasured, `frames on ${def.id}`);
  }
}

/** The corpse's last two frames: the body at rest after its bounce. */
const BUCKET_BOY_CORPSE_HELD_FROM = BUCKET_BOY_DEATH_FRAMES - 2;

// ── G13: warm-row memory ─────────────────────────────────────────────────────

function gateWarmRows(): void {
  for (const def of [BUCKET_BOY_FIGURE, CLARABELLE_FIGURE, TRIAGE_SPARKLE_FIGURE]) {
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
  const n = framesOf(TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE);
  if (n < 2) {
    fail('G14', `the sparkle declares ${n} frames; a fade needs at least a first and a last`);
    return;
  }
  const inkOf = (frame: number): number => {
    const pixels = cellPixels(TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE, frame);
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
  if (inkBoxOf(TRIAGE_SPARKLE_FIGURE, TRIAGE_SPARKLE_STATE, 0) === null)
    fail('G14', 'the sparkle paints nothing on its first frame');
}

const SPARKLE_END_SHARE = 0.25;
const SPARKLE_START_SHARE = 0.2;

/** Runs every crocodilian gate and returns one message per failure. */
export function crocodilianGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoops(BUCKET_BOY_FIGURE, BUCKET_BOY_ROWS);
  gateLoops(CLARABELLE_FIGURE, CLARABELLE_ROWS);
  gateReach(BUCKET_BOY_BUILD, BUCKET_BOY_ROWS, 'bucket_boy');
  gateReach(CLARABELLE_BUILD, CLARABELLE_ROWS, 'clarabelle');
  gateFootSlide(BUCKET_BOY_BUILD, BUCKET_BOY_ROWS, 'bucket_boy');
  gateFootSlide(CLARABELLE_BUILD, CLARABELLE_ROWS, 'clarabelle');
  gateImpactFrames();
  gateCorpse();
  gateStateNames();
  gateArmband();
  gateTeeth();
  gateHeights();
  gateDistinctFrames();
  gateWarmRows();
  gateSparkleFade();
  return [...failures];
}

if (process.argv[1].endsWith('gates-crocodilian.ts')) {
  reportFigureGates('crocodilians', crocodilianGateFailures());
}
