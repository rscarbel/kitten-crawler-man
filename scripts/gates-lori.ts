/**
 * Old Lori's art gates.
 *
 * Pixel gates measure cells painted from the figure the way the runtime cache
 * bakes them; pose-stream gates read the choreography directly: her boots and
 * her cane hold the floor while they bear weight, and the cane goes down with
 * her bad leg.
 *
 * Failures accumulate so one run reports everything. A gate whose loop
 * measured nothing fails rather than passing.
 *
 *   npm run gates:lori
 *   (also run first by `npm run render:lori`)
 */

import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  BAD_FOOT_SUPPORT,
  CANE_SUPPORT,
  GOOD_FOOT_SUPPORT,
  GROUND_OFFSET_IN_TILE,
  IDLE_BLINK_FRAME,
  LORI_FIGURE,
  LORI_ROW_NAMES,
  LORI_TILES_PER_WALK_CYCLE,
  LORI_VIEWS,
  type LoriRow,
  type Support,
  TILE_SCALE,
  TILE_X,
  TILE_Y,
  WALK_BLINK_FRAME,
  loriPose,
  loriStateName,
} from '../src/sprites/art/loriFigure.js';
import {
  type LoriPose,
  type LoriView,
  loriBootSoles,
  loriCaneTipPoint,
} from '../src/sprites/art/loriArt.js';
import { LORI_IDLE_FRAMES, LORI_WALK_FRAMES } from '../src/sprites/loriTiming.js';
import { loriReachableStates } from '../src/sprites/loriSprite.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Above this a pixel is her body, not the soft contact shadow on the ground line. */
const SOLID_ALPHA = 200;
/** Lifts and slides under this are float noise, not motion. */
const FLOAT_EPSILON = 1e-9;
const REPORT_DECIMALS = 4;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const pixelCache = new Map<string, Pixels>();

function pixelsOf(state: string, frame: number): Pixels {
  const cacheKey = `${state}/${frame}`;
  const cached = pixelCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(LORI_FIGURE, state, frame);
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = { width: canvas.width, height: canvas.height, data };
  pixelCache.set(cacheKey, pixels);
  return pixels;
}

function alphaAt(pixels: Pixels, x: number, y: number): number {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return 0;
  return pixels.data[(py * pixels.width + px) * CHANNELS + ALPHA_OFFSET];
}

/** Whether any solid pixel lies within `radius` cell pixels of a point. */
function solidNear(pixels: Pixels, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (alphaAt(pixels, x + dx, y + dy) >= SOLID_ALPHA) return true;
    }
  }
  return false;
}

/** The lowest cell row holding a solid pixel, or -1 for none. */
function lowestSolidRow(pixels: Pixels): number {
  for (let y = pixels.height - 1; y >= 0; y--) {
    for (let x = 0; x < pixels.width; x++) if (alphaAt(pixels, x, y) >= SOLID_ALPHA) return y;
  }
  return -1;
}

const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

function framesOf(state: string): number {
  const frames = LORI_FIGURE.states.get(state)?.frames;
  if (frames === undefined) throw new Error(`lori declares no state "${state}"`);
  return frames;
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(LORI_FIGURE)) fail('G1', failure);
}

// ── G2: the choreography matches the timing it is played at ─────────────────

/**
 * Whether `frame` lies in `[0, frames)`. Taking plain numbers keeps the check
 * honest about constants whose literal types the linter would otherwise fold
 * into an always-true comparison.
 */
function frameInRow(frame: number, frames: number): boolean {
  return frame >= 0 && frame < frames;
}

function gateChoreographyContract(): void {
  const blinks: ReadonlyArray<readonly [LoriRow, number, number]> = [
    ['idle', IDLE_BLINK_FRAME, LORI_IDLE_FRAMES],
    ['walk', WALK_BLINK_FRAME, LORI_WALK_FRAMES],
  ];
  for (const [row, blink, frames] of blinks) {
    if (!frameInRow(blink, frames)) {
      fail('G2', `the ${row} blink is on frame ${blink}, outside the ${frames}-frame row`);
    }
  }
  let tapFrames = 0;
  for (let frame = 0; frame < LORI_IDLE_FRAMES; frame++) {
    if (loriPose('idle', frame).caneLift > 0) tapFrames++;
  }
  if (tapFrames === 0) {
    fail('G2', 'no idle frame lifts the cane, so the hobble never re-plants it');
  }
}

// ── G3: every frame is its own picture ───────────────────────────────────────

function gateDistinctFrames(): void {
  const report = distinctFrameFailures(LORI_FIGURE, (state, frame) => pixelsOf(state, frame).data);
  for (const failure of report.failures) fail('G3', failure);
  failUnlessMeasured('G3', report.framesMeasured, 'lori frames');
}

// ── G4: the walk loops without a pop or a held frame ─────────────────────────

/**
 * The seam — last frame to first — as a band. Its ceiling is against the two
 * steps either side of it, because her steps are uneven (the cane's quick
 * swing outweighs a slow stance step several times over) and a pop is a seam
 * far bigger than the motion running into and out of it. Its floor is a share
 * of the median step: a cycle sampled one frame short holds still across it.
 */
const SEAM_MAX_NEIGHBOUR_RATIO = 1.6;
const SEAM_MIN_RATIO = 0.4;
/** No interior step may be this far above the row's second-largest step. */
const SNAP_RATIO = 2.4;

function alphaDelta(a: Pixels, b: Pixels): number {
  let total = 0;
  for (let i = ALPHA_OFFSET; i < a.data.length; i += CHANNELS) {
    total += Math.abs(a.data[i] - b.data[i]);
  }
  return total / (a.data.length / CHANNELS);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((l, r) => l - r);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function gateWalkLoop(): void {
  let measured = 0;
  for (const view of LORI_VIEWS) {
    const state = loriStateName('walk', view);
    const n = framesOf(state);
    const steps: number[] = [];
    for (let f = 1; f < n; f++) steps.push(alphaDelta(pixelsOf(state, f - 1), pixelsOf(state, f)));
    if (steps.length < 2) {
      fail('G4', `${state} declares ${n} frames, too few to loop`);
      continue;
    }
    measured++;
    const sorted = [...steps].sort((l, r) => l - r);
    const secondLargest = sorted[sorted.length - 2];
    steps.forEach((step, i) => {
      if (step > secondLargest * SNAP_RATIO) {
        fail(
          'G4',
          `${state} jumps between frames ${i} and ${i + 1}: step ${step.toFixed(2)} against the ` +
            `next largest ${secondLargest.toFixed(2)} (limit ${SNAP_RATIO}×)`,
        );
      }
    });
    const seam = alphaDelta(pixelsOf(state, n - 1), pixelsOf(state, 0));
    const neighbour = Math.max(steps[0], steps[steps.length - 1]);
    const typical = median(steps);
    if (seam > neighbour * SEAM_MAX_NEIGHBOUR_RATIO || seam < typical * SEAM_MIN_RATIO) {
      fail(
        'G4',
        `${state} loop seam is ${seam.toFixed(2)} against neighbouring steps up to ` +
          `${neighbour.toFixed(2)} and a median of ${typical.toFixed(2)} (allowed ` +
          `${SEAM_MIN_RATIO}× median to ${SEAM_MAX_NEIGHBOUR_RATIO}× the larger neighbour)`,
      );
    }
  }
  failUnlessMeasured('G4', measured, 'walk rows');
}

// ── G5: a planted boot or cane does not slide ────────────────────────────────

/**
 * While it bears weight a support moves back through the cell at exactly the
 * rate she is carried over the floor — the cycle's ground over its frames —
 * or the walk moonwalks or skates. And some boot is always down: she never
 * leaves the floor.
 */
const SLIDE_TOLERANCE = 0.002;

interface SupportTrack {
  readonly name: string;
  readonly support: Support;
  readonly read: (pose: LoriPose) => { readonly d: number; readonly lift: number };
}

const SUPPORTS: readonly SupportTrack[] = [
  { name: 'bad (right) boot', support: BAD_FOOT_SUPPORT, read: (pose) => pose.rightFoot },
  { name: 'good (left) boot', support: GOOD_FOOT_SUPPORT, read: (pose) => pose.leftFoot },
  {
    name: 'cane',
    support: CANE_SUPPORT,
    read: (pose) => ({ d: pose.caneFoot.d, lift: pose.caneLift }),
  },
];

function walkPoses(): LoriPose[] {
  return Array.from({ length: LORI_WALK_FRAMES }, (_unused, frame) => loriPose('walk', frame));
}

function planted(lift: number): boolean {
  return Math.abs(lift) < FLOAT_EPSILON;
}

function gateSupportsHoldTheFloor(): void {
  const poses = walkPoses();
  const perFrame = LORI_TILES_PER_WALK_CYCLE / LORI_WALK_FRAMES;
  let measured = 0;
  for (const track of SUPPORTS) {
    for (let frame = 0; frame < poses.length; frame++) {
      const before = track.read(poses[frame]);
      const after = track.read(poses[(frame + 1) % poses.length]);
      // On the floor on both frames it is bearing weight, and must not move
      // forward — a support that touches down before its swing ends skates.
      if (!planted(before.lift) || !planted(after.lift)) continue;
      measured++;
      const slid = before.d - after.d;
      if (Math.abs(slid - perFrame) > SLIDE_TOLERANCE) {
        fail(
          'G5',
          `walk[${frame}→${(frame + 1) % poses.length}]: the planted ${track.name} moved ` +
            `${slid.toFixed(REPORT_DECIMALS)} tiles against the ${perFrame.toFixed(REPORT_DECIMALS)} ` +
            'she travels per frame',
        );
      }
    }
  }
  failUnlessMeasured('G5', measured, 'planted walk steps');
  poses.forEach((pose, frame) => {
    if (!planted(pose.rightFoot.lift) && !planted(pose.leftFoot.lift)) {
      fail('G5', `walk[${frame}] has both boots off the floor — an old woman on a cane never hops`);
    }
  });
}

// ── G6: the cane goes down with the bad leg ──────────────────────────────────

/** The frames a support lands on: planted, after a frame off the floor. */
function landingFrames(poses: readonly LoriPose[], track: SupportTrack): number[] {
  const frames: number[] = [];
  poses.forEach((pose, frame) => {
    const previous = poses[(frame + poses.length - 1) % poses.length];
    if (planted(track.read(pose).lift) && !planted(track.read(previous).lift)) frames.push(frame);
  });
  return frames;
}

function gateCaneRhythm(): void {
  const poses = walkPoses();
  const [bad, , cane] = SUPPORTS;
  const caneLandings = landingFrames(poses, cane);
  const badLandings = landingFrames(poses, bad);
  if (caneLandings.length !== 1 || badLandings.length !== 1) {
    fail(
      'G6',
      `one walk cycle should land the cane once and the bad boot once; it lands the cane on ` +
        `[${caneLandings.join(', ')}] and the bad boot on [${badLandings.join(', ')}]`,
    );
  } else if (caneLandings[0] !== badLandings[0]) {
    fail(
      'G6',
      `the cane lands on walk[${caneLandings[0]}] but the bad boot on walk[${badLandings[0]}]: ` +
        'the cane has to go down with the leg it is there to spare',
    );
  }
  let measured = 0;
  poses.forEach((pose, frame) => {
    if (!planted(pose.rightFoot.lift)) return;
    measured++;
    if (!planted(pose.caneLift)) {
      fail(
        'G6',
        `walk[${frame}]: the bad boot bears weight with the cane in the air ` +
          `(${pose.caneLift.toFixed(REPORT_DECIMALS)} tiles up)`,
      );
    }
  });
  failUnlessMeasured('G6', measured, 'frames on the bad leg');
}

// ── G7: what bears weight is painted on the floor ────────────────────────────

/**
 * How far below the ground row a planted boot's lowest solid pixel may sit:
 * its outline reaches a pixel or two past the line, a step ahead a little more
 * for the floor's depth.
 */
const GROUND_MIN_SINK_PX = 0;
const GROUND_MAX_SINK_PX = 5;
/**
 * The same for her whole figure, whose lowest pixel is often the cane's
 * ferrule: head-on, a cane planted well ahead of her draws further down the
 * floor than her boots do.
 */
const FIGURE_MAX_SINK_PX = 7;
/** How far, in cell pixels, the ferrule's painted ink may sit from where the pose puts it. */
const CANE_TIP_TOLERANCE = 2;
/**
 * Half the width, in cell pixels, of the column a boot is measured in:
 * narrower than a boot, so the cane and the other boot stay out of it.
 */
const BOOT_COLUMN_HALF = 1;

/** The lowest solid row in the columns within `half` of `x`, or -1 for none. */
function lowestSolidInColumns(pixels: Pixels, x: number, half: number): number {
  const centre = Math.round(x);
  for (let y = pixels.height - 1; y >= 0; y--) {
    for (let dx = -half; dx <= half; dx++) {
      if (alphaAt(pixels, centre + dx, y) >= SOLID_ALPHA) return y;
    }
  }
  return -1;
}

function gateGroundContact(): void {
  let frames = 0;
  let tips = 0;
  let boots = 0;
  for (const row of LORI_ROW_NAMES) {
    for (const view of LORI_VIEWS) {
      const state = loriStateName(row, view);
      for (let frame = 0; frame < framesOf(state); frame++) {
        const pixels = pixelsOf(state, frame);
        frames++;
        const sink = lowestSolidRow(pixels) + 1 - ORIGIN_Y;
        if (sink < GROUND_MIN_SINK_PX || sink > FIGURE_MAX_SINK_PX) {
          fail(
            'G7',
            `${state}[${frame}] has its lowest solid pixel ${sink}px from the ground row ` +
              `(allowed ${GROUND_MIN_SINK_PX}..${FIGURE_MAX_SINK_PX} below) — she floats or sinks`,
          );
        }
        const pose = loriPose(row, frame);
        for (const sole of loriBootSoles(view, pose)) {
          if (!planted(sole.lift)) continue;
          boots++;
          const column = ORIGIN_X + sole.x * TILE_SCALE;
          const floorRow = ORIGIN_Y + sole.floorY * TILE_SCALE;
          const bootSink = Math.round(
            lowestSolidInColumns(pixels, column, BOOT_COLUMN_HALF) + 1 - floorRow,
          );
          if (bootSink < GROUND_MIN_SINK_PX || bootSink > GROUND_MAX_SINK_PX) {
            fail(
              'G7',
              `${state}[${frame}]: the planted ${sole.side} boot's lowest solid pixel is ${bootSink}px ` +
                `from the floor under it (allowed ${GROUND_MIN_SINK_PX}..${GROUND_MAX_SINK_PX} below) — ` +
                'it bears her weight off the floor',
            );
          }
        }
        if (!planted(pose.caneLift)) continue;
        tips++;
        const tip = loriCaneTipPoint(view, pose);
        const x = ORIGIN_X + tip.x * TILE_SCALE;
        const y = ORIGIN_Y + tip.y * TILE_SCALE;
        if (!solidNear(pixels, x, y, CANE_TIP_TOLERANCE)) {
          fail(
            'G7',
            `${state}[${frame}]: the planted cane's ferrule (${x.toFixed(1)}, ${y.toFixed(1)}) is not painted`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G7', frames, 'standing and walking frames');
  failUnlessMeasured('G7', tips, 'planted cane tips');
  failUnlessMeasured('G7', boots, 'planted boots');
}

// ── G8: facing parity ────────────────────────────────────────────────────────

interface RowExtent {
  readonly left: number;
  readonly right: number;
}

function extentInBand(pixels: Pixels, top: number, bottom: number): RowExtent | null {
  let left = Infinity;
  let right = -Infinity;
  for (let y = Math.round(top); y <= Math.round(bottom); y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (alphaAt(pixels, x, y) < SOLID_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return Number.isFinite(left) ? { left: ORIGIN_X - left, right: right - ORIGIN_X } : null;
}

/** Heights, in tiles above the ground, of the bands the parity checks read. */
const NOSE_BAND_LOW = 0.64;
const NOSE_BAND_HIGH = 0.74;
const CANE_BAND_LOW = 0.02;
const CANE_BAND_HIGH = 0.12;
const FACE_BAND: readonly [number, number] = [NOSE_BAND_LOW, NOSE_BAND_HIGH];
const CANE_BAND: readonly [number, number] = [CANE_BAND_LOW, CANE_BAND_HIGH];
/** How much further, in cell pixels, the leading side must reach. */
const PARITY_MARGIN = 4;

interface ParityCheck {
  readonly view: LoriView;
  readonly band: readonly [number, number];
  readonly what: string;
  /** +1 when `what` should reach further right of her centre than left, −1 for the reverse. */
  readonly side: number;
}

const PARITY_CHECKS: readonly ParityCheck[] = [
  // In profile she faces +x: the nose leads the face band.
  { view: 'side', band: FACE_BAND, what: 'her nose', side: 1 },
  // The cane is in her left hand: the viewer's right head-on, the viewer's left from behind.
  { view: 'front', band: CANE_BAND, what: 'the cane', side: 1 },
  { view: 'away', band: CANE_BAND, what: 'the cane', side: -1 },
];

function gateFacingParity(): void {
  let measured = 0;
  for (const { view, band, what, side } of PARITY_CHECKS) {
    for (const row of LORI_ROW_NAMES) {
      const state = loriStateName(row, view);
      const top = ORIGIN_Y - band[1] * TILE_SCALE;
      const bottom = ORIGIN_Y - band[0] * TILE_SCALE;
      for (let frame = 0; frame < framesOf(state); frame++) {
        const extent = extentInBand(pixelsOf(state, frame), top, bottom);
        measured++;
        if (extent === null) {
          fail('G8', `${state}[${frame}] paints nothing in the band ${what} is measured in`);
          continue;
        }
        const leading = side > 0 ? extent.right : extent.left;
        const trailing = side > 0 ? extent.left : extent.right;
        if (leading < trailing + PARITY_MARGIN) {
          fail(
            'G8',
            `${state}[${frame}]: ${what} should reach ${PARITY_MARGIN}px further to the ` +
              `${side > 0 ? 'right' : 'left'} of her centre (${leading}px) than the other way (${trailing}px)`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G8', measured, 'parity bands');
}

// ── G9: she is short even for a dwarf ────────────────────────────────────────

/**
 * Standing height to the crown of her hair, in tiles. The human crawler is two
 * tiles; a dwarf woman bent over a cane comes to his hip.
 */
const MIN_HEIGHT_TILES = 0.82;
const MAX_HEIGHT_TILES = 0.95;

function gateHeight(): void {
  let measured = 0;
  for (const view of LORI_VIEWS) {
    const state = loriStateName('idle', view);
    const pixels = pixelsOf(state, 0);
    let top = -1;
    for (let y = 0; y < pixels.height && top < 0; y++) {
      for (let x = 0; x < pixels.width; x++) {
        if (alphaAt(pixels, x, y) >= SOLID_ALPHA) {
          top = y;
          break;
        }
      }
    }
    measured++;
    const height = (ORIGIN_Y - top) / TILE_SCALE;
    if (top < 0 || height < MIN_HEIGHT_TILES || height > MAX_HEIGHT_TILES) {
      fail(
        'G9',
        `${state}[0] stands ${height.toFixed(2)} tiles, outside ${MIN_HEIGHT_TILES}–${MAX_HEIGHT_TILES}`,
      );
    }
  }
  failUnlessMeasured('G9', measured, 'standing heights');
}

// ── G10: every state the sprite can ask for is painted ───────────────────────

function gateReachableStates(): void {
  for (const failure of missingStateFailures(
    LORI_FIGURE,
    loriReachableStates(),
    'drawLoriSprite',
  )) {
    fail('G10', failure);
  }
}

/** Runs every gate and returns one message per failure. */
export function loriGateFailures(): string[] {
  failures.length = 0;
  pixelCache.clear();
  const gates: ReadonlyArray<readonly [string, () => void]> = [
    ['G2', gateChoreographyContract],
    ['G1', gateStructure],
    ['G3', gateDistinctFrames],
    ['G4', gateWalkLoop],
    ['G5', gateSupportsHoldTheFloor],
    ['G6', gateCaneRhythm],
    ['G7', gateGroundContact],
    ['G8', gateFacingParity],
    ['G9', gateHeight],
    ['G10', gateReachableStates],
  ];
  for (const [id, gate] of gates) {
    try {
      gate();
    } catch (error) {
      fail(id, `the gate threw before it could measure: ${String(error)}`);
    }
  }
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Old Lori art gates');
  reportFigureGates('lori', loriGateFailures());
}
