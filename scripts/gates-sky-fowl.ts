/**
 * The Sky Fowl's art gates.
 *
 * The five sheets are gone, so every invariant they used to be inspected for is
 * enforced here against cells painted from the figures — baked exactly the way
 * the runtime cache bakes them, supersampled and downsampled, so what is
 * measured is what the game blits. The gait gate measures the rig itself and
 * needs no pixels at all.
 *
 * This creature is eight figures rather than one: a fowl wears one of eight
 * clothing palettes and each palette is its own `FigureDef`, because a cached
 * cell is keyed by figure, state and frame. The structural, identity and
 * clothing gates run over all eight; the pixel gates that are about anatomy
 * rather than colour run over two representative palettes, one hatted and one
 * bare-headed.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly: a lookup that quietly returns nothing turns a whole gate module
 * green while measuring nothing.
 *
 * Run by the review harness: `npm run render:sky-fowl`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  SKY_FOWL_FIGURES,
  SKY_FOWL_ROWS,
  TILE_SCALE,
  stridePhase,
  type RowSpec,
} from '../src/sprites/art/skyFowlFigure.js';
import {
  SKY_FOWL_BEAK_COLOR,
  SKY_FOWL_PALETTES,
  skyFowlWalkFeet,
} from '../src/sprites/art/skyFowlArt.js';
import { SKY_FOWL_DRAWN_STATES, SKY_FOWL_PREWARMED_STATES } from '../src/sprites/skyFowlSprite.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as ink. */
const INK_ALPHA = 8;
/** Alpha at or above which a pixel is the figure's own body rather than its edge. */
const SOLID_ALPHA = 200;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const TAU = Math.PI * 2;

/**
 * The palettes the pixel gates paint. Palette 0 wears a hat and palette 2 does
 * not, which is the one structural difference between the eight.
 */
const HATTED_PALETTE = 0;
const BARE_HEADED_PALETTE = 2;
const SAMPLED_PALETTES = [HATTED_PALETTE, BARE_HEADED_PALETTE];

/** How finely the swing arc is sampled when measuring its own peak height. */
const SWING_SAMPLE_COUNT = 720;

const { frameWidth, frameHeight } = SKY_FOWL_FIGURES[0];

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — one palette, one row, the
 * frames where a foot is actually in the air — and a narrowing that matches
 * nothing leaves a green gate that examined nothing. Every filtering loop here
 * counts what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellsByKey = new Map<string, Uint8ClampedArray>();

/** One cell's RGBA, baked as the runtime cache bakes it. */
function cellRgba(paletteIndex: number, state: string, frame: number): Uint8ClampedArray {
  const key = `${paletteIndex}/${state}[${frame}]`;
  const cached = cellsByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(figureFor(paletteIndex), state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  cellsByKey.set(key, data);
  return data;
}

function figureFor(paletteIndex: number): FigureDef {
  if (paletteIndex < 0 || paletteIndex >= SKY_FOWL_FIGURES.length) {
    throw new Error(
      `no sky fowl figure for palette ${paletteIndex}: the pixel gates sample a palette the ` +
        'family no longer has',
    );
  }
  return SKY_FOWL_FIGURES[paletteIndex];
}

function alphaAt(data: Uint8ClampedArray, x: number, y: number): number {
  return data[(y * frameWidth + x) * CHANNELS + ALPHA_OFFSET];
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * The names are string literals written here rather than read out of
 * `SKY_FOWL_ROWS`, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = SKY_FOWL_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_RADIX = 16;
const HEX_CHANNEL_WIDTH = 2;

function parseHex(hex: string): Rgb {
  const digits = hex.slice(1);
  const channel = (index: number): number =>
    Number.parseInt(
      digits.slice(index * HEX_CHANNEL_WIDTH, (index + 1) * HEX_CHANNEL_WIDTH),
      HEX_RADIX,
    );
  return { r: channel(0), g: channel(1), b: channel(2) };
}

/**
 * How far a baked pixel may sit from an authored colour and still count as it.
 *
 * The cache downsamples a supersampled cell, so even the interior of a flat
 * region picks up a little of its neighbours. Wide enough to admit that, narrow
 * enough that no two of the eight palettes' garments are within it of each
 * other.
 */
const COLOR_MATCH_TOLERANCE = 24;

function countColor(data: Uint8ClampedArray, want: Rgb): number {
  let found = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    if (Math.abs(data[i] - want.r) > COLOR_MATCH_TOLERANCE) continue;
    if (Math.abs(data[i + 1] - want.g) > COLOR_MATCH_TOLERANCE) continue;
    if (Math.abs(data[i + 2] - want.b) > COLOR_MATCH_TOLERANCE) continue;
    found++;
  }
  return found;
}

// ── G1: structure ────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates over every palette: each declared state
 * paints each declared frame, nothing paints against the cell edge, and the
 * cell is not mostly empty. The edge check is what the old bake's border-clip
 * gate did; a frame that paints outside its cell is clipped away silently and
 * nothing downstream can detect it.
 */
function gateStructure(): void {
  let figuresMeasured = 0;
  for (const figure of SKY_FOWL_FIGURES) {
    figuresMeasured++;
    for (const failure of figureStructuralFailures(figure)) fail('G1', failure);
  }
  failUnlessMeasured('G1', figuresMeasured, 'palette figures');
}

// ── G2: one identity per palette ─────────────────────────────────────────────

/**
 * G2 — there is exactly one figure per palette and no two of them share an id.
 *
 * The whole reason the clothing is a figure rather than a parameter is that the
 * cache keys on `(figure, state, frame)`. Two palettes sharing an id would hand
 * whichever bird reached the cache first its clothes to every bird after it,
 * and nothing else in the project would notice.
 */
function gateFigureIdentity(): void {
  if (SKY_FOWL_FIGURES.length !== SKY_FOWL_PALETTES.length) {
    fail(
      'G2',
      `${SKY_FOWL_FIGURES.length} figures against ${SKY_FOWL_PALETTES.length} palettes — ` +
        'a palette with no figure of its own would wear another bird’s clothes',
    );
  }
  const seen = new Set<string>();
  let idsMeasured = 0;
  for (const figure of SKY_FOWL_FIGURES) {
    idsMeasured++;
    if (seen.has(figure.id)) {
      fail(
        'G2',
        `two palettes share the figure id "${figure.id}" — the cache cannot tell them apart`,
      );
    }
    seen.add(figure.id);
  }
  failUnlessMeasured('G2', idsMeasured, 'figure ids');
}

// ── G3: the state names the runtime asks for ─────────────────────────────────

/**
 * G3 — every state name the runtime can reach is a state the figures paint.
 *
 * Both draw paths return silently on an unknown state, so a name the wrapper
 * builds and a figure lacks is an invisible bird and no log line.
 */
function gateRuntimeStateNames(): void {
  let figuresMeasured = 0;
  for (const figure of SKY_FOWL_FIGURES) {
    figuresMeasured++;
    for (const failure of missingStateFailures(figure, SKY_FOWL_DRAWN_STATES, 'the sprite wrapper'))
      fail('G3', failure);
    for (const failure of missingStateFailures(
      figure,
      SKY_FOWL_PREWARMED_STATES,
      'the prewarm list',
    ))
      fail('G3', failure);
  }
  failUnlessMeasured('G3', figuresMeasured, 'palette figures');
}

// ── G4: the walk cycle closes, and does not close early ──────────────────────

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = ALPHA_OFFSET; i < a.length; i += CHANNELS) sum += Math.abs(a[i] - b[i]);
  return sum;
}

/**
 * How far past its row's *largest* ordinary step the seam may sit.
 *
 * Judged against the largest rather than the median because a stride cycle's
 * pose distance saturates: half a cycle apart is as different as two frames can
 * be, and an eighth of a cycle is already most of that, so a median-relative
 * limit is swamped by the row's own motion. Measured on the shipped walk row,
 * identically on all eight palettes: the seam is 0.97× the largest ordinary
 * step and 1.18× the median. The ceiling sits 18% above that 0.97×.
 *
 * What it catches is a lone hitch at the seam. What it cannot catch — the
 * pixels being unable to say so at any threshold — is a row covering more or
 * less than one turn: at one and a half turns this same row measures 1.06×,
 * indistinguishable from shipped. The phase-span clause below is the ceiling
 * for that half of the failure mode.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How far *short* of its row's median step the seam may fall.
 *
 * Against the median rather than the narrowest step, because a row may
 * legitimately hold two adjacent frames still, which collapses a
 * narrowest-based floor into `seam >= 0`. A ceiling alone is passed by the
 * mistake that is easiest to make here: sampling at `frame / (frameCount - 1)`
 * rather than `frame / frameCount` makes the last frame identical to the first,
 * so the seam goes to zero and the row holds a whole frame every lap. The
 * shipped seam is 1.18× its median step, so a floor at 0.5 clears it twice over
 * and still catches a stalled seam.
 */
const LOOP_SEAM_FLOOR_VS_MEDIAN = 0.5;
/** A short loop has no meaningful spread of steps to compare a seam against. */
const LOOP_GATE_MIN_FRAMES = 4;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * G4 — the walk row covers exactly one stride in evenly spaced steps, and its
 * seam is an ordinary step rather than a jump or a stall.
 */
function gateLoopCloses(): void {
  gateStrideCoverage();
  let loopsMeasured = 0;
  for (const paletteIndex of SAMPLED_PALETTES) {
    for (const row of SKY_FOWL_ROWS) {
      if (!row.loops || row.frameCount < LOOP_GATE_MIN_FRAMES) continue;
      loopsMeasured++;
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(
          frameDelta(
            cellRgba(paletteIndex, row.name, frame - 1),
            cellRgba(paletteIndex, row.name, frame),
          ),
        );
      }
      const largestStep = Math.max(...steps);
      const typicalStep = median(steps);
      const seam = frameDelta(
        cellRgba(paletteIndex, row.name, row.frameCount - 1),
        cellRgba(paletteIndex, row.name, 0),
      );
      if (largestStep <= 0) {
        fail('G4', `${row.name} on palette ${paletteIndex} does not move between frames at all`);
        continue;
      }
      console.log(
        `  G4 ${row.name} palette ${paletteIndex}: seam ${(seam / largestStep).toFixed(2)}× the ` +
          `largest step, ${(seam / typicalStep).toFixed(2)}× the median`,
      );
      if (seam > largestStep * LOOP_SEAM_CEILING) {
        fail(
          'G4',
          `${row.name} on palette ${paletteIndex} jumps at its seam: ` +
            `${(seam / largestStep).toFixed(2)}× its largest step, past ${LOOP_SEAM_CEILING}×`,
        );
      }
      if (seam < typicalStep * LOOP_SEAM_FLOOR_VS_MEDIAN) {
        fail(
          'G4',
          `${row.name} on palette ${paletteIndex} barely moves at its seam: ` +
            `${(seam / typicalStep).toFixed(2)}× its median step, under ` +
            `${LOOP_SEAM_FLOOR_VS_MEDIAN}× — the cycle stops short of closing and holds a frame`,
        );
      }
    }
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows long enough to have a seam');
}

/**
 * The walk row's ceiling, in the units the defect is actually in: the stride
 * mapping must spend exactly one turn over the row's declared frames, in equal
 * steps, so that the frame after the last lands on the first.
 */
function gateStrideCoverage(): void {
  const row = rowNamed('walk', 'G4');
  if (row === null) return;
  const turns = (stridePhase(row.frameCount) - stridePhase(0)) / TAU;
  if (Math.abs(turns - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'G4',
      `the walk row spends ${turns.toFixed(4)} of a stride over its ${row.frameCount} frames ` +
        'rather than exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = stridePhase(1) - stridePhase(0);
  let stepsMeasured = 0;
  for (let frame = 1; frame < row.frameCount; frame++) {
    stepsMeasured++;
    const step = stridePhase(frame) - stridePhase(frame - 1);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'G4',
      `the walk row advances ${step.toFixed(4)} radians into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled stride stutters`,
    );
  }
  failUnlessMeasured('G4', stepsMeasured, 'stride phase steps');
}

// ── G5: the tile anchor ──────────────────────────────────────────────────────

/** Padding added on every side before an anchor is measured. */
const ANCHOR_PAD_PX = 32;

/**
 * How far the lowest solid pixel may sit from the tile's floor.
 *
 * Two numbers rather than one, because they guard different mistakes and one
 * threshold covering both has to be loosened until it catches nothing. The
 * fowl's contact shadow is painted on the ground line, so a few pixels of it
 * legitimately hang below the tile's floor; a figure that has come off its
 * anchor floats *above* it, and that side stays tight.
 *
 * Measured against the *tile* the figure declares, never against the painter's
 * own ground line: the two are built from the same constant, so a gate
 * comparing them moves both together and passes for any value. The tile is what
 * the health bar is hung off, which is what makes it an independent thing to
 * measure against.
 */
const SOLE_FLOAT_TOLERANCE_PX = 3;
const SOLE_HANG_TOLERANCE_PX = 8;
/** The bird shifts its weight, so its ink is not pinned to the tile's centre. */
const ANCHOR_CENTRE_TOLERANCE_PX = 6;

interface PaddedInk {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly pixels: number;
}

/**
 * The solid ink of one cell, measured in a canvas padded on all four sides and
 * returned in cell coordinates.
 *
 * Padded because in a tightly cropped cell every translation big enough to fail
 * an anchor check clips first, so the clipping gate speaks and this one is
 * structurally redundant. Solid rather than any ink because the contact shadow
 * is painted at the feet *wherever the feet are*, so a lowest-ink check
 * measures the shadow and stays green while the bird floats over it.
 */
function paddedSolidInk(paletteIndex: number, state: string, frame: number): PaddedInk {
  const padded = bakeFigureCell(
    {
      ...figureFor(paletteIndex),
      frameWidth: frameWidth + ANCHOR_PAD_PX * 2,
      frameHeight: frameHeight + ANCHOR_PAD_PX * 2,
      paintFrame: (ctx, paintState, paintFrame) => {
        ctx.save();
        ctx.translate(ANCHOR_PAD_PX, ANCHOR_PAD_PX);
        figureFor(paletteIndex).paintFrame(ctx, paintState, paintFrame);
        ctx.restore();
      },
    },
    state,
    frame,
  );
  const width = frameWidth + ANCHOR_PAD_PX * 2;
  const height = frameHeight + ANCHOR_PAD_PX * 2;
  const { data } = padded.getContext('2d').getImageData(0, 0, width, height);
  let bottom = -1;
  let left = width;
  let right = -1;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      pixels++;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return {
    bottom: bottom - ANCHOR_PAD_PX,
    left: left - ANCHOR_PAD_PX,
    right: right - ANCHOR_PAD_PX,
    pixels,
  };
}

/**
 * G5 — a redraw moves the tile anchor, and the health bar keys off it.
 * Measured rather than trusted, against the tile the figure declares.
 */
function gateAnchor(): void {
  const figure = SKY_FOWL_FIGURES[0];
  const tileFloor = figure.tileY + TILE_SCALE;
  const tileCentreX = figure.tileX + TILE_SCALE / 2;
  let framesMeasured = 0;
  for (const paletteIndex of SAMPLED_PALETTES) {
    for (const row of SKY_FOWL_ROWS) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const ink = paddedSolidInk(paletteIndex, row.name, frame);
        if (ink.pixels === 0) {
          fail('G5', `${row.name}[${frame}] on palette ${paletteIndex} painted no solid ink`);
          continue;
        }
        framesMeasured++;
        const belowFloor = ink.bottom - tileFloor;
        if (belowFloor < -SOLE_FLOAT_TOLERANCE_PX) {
          fail(
            'G5',
            `${row.name}[${frame}] on palette ${paletteIndex} paints ${-belowFloor}px above its ` +
              `tile's floor, past a float tolerance of ${SOLE_FLOAT_TOLERANCE_PX}px — it is ` +
              'hovering over the cobbles',
          );
        }
        if (belowFloor > SOLE_HANG_TOLERANCE_PX) {
          fail(
            'G5',
            `${row.name}[${frame}] on palette ${paletteIndex} paints ${belowFloor}px below its ` +
              `tile's floor, past a hang tolerance of ${SOLE_HANG_TOLERANCE_PX}px`,
          );
        }
        const centre = (ink.left + ink.right) / 2;
        if (Math.abs(centre - tileCentreX) > ANCHOR_CENTRE_TOLERANCE_PX) {
          fail(
            'G5',
            `${row.name}[${frame}] on palette ${paletteIndex} paints centred on ` +
              `x=${centre.toFixed(1)} against a tile centre of ${tileCentreX}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', framesMeasured, 'frames with a measurable sole line');
}

// ── G6: the warm-row budget ──────────────────────────────────────────────────

/**
 * The hard ceiling for one warm animation row of one palette.
 *
 * The sheets this figure replaced had a whole-texture budget. A painted figure
 * is admitted to the cache a row at a time, so the number that decides whether
 * it fits is the widest row's warm bytes rather than the sum of all of them —
 * and here it has to be multiplied by the palettes a busy street can show at
 * once, which is why the report prints that total too.
 */
const ROW_BUDGET_MEGABYTES = 3;

/** G6 — the widest warm row's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of SKY_FOWL_FIGURES[0].states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G6', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G6 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states of all ` +
      `${SKY_FOWL_FIGURES.length} palettes warm at once would be ` +
      `${(allWarmMegabytes * SKY_FOWL_FIGURES.length).toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G6',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G7: the gait ─────────────────────────────────────────────────────────────

/** Below this a foot is on the ground as far as the picture is concerned. */
const PLANTED_EPSILON = 1e-6;
/** The least a swinging foot must clear the ground by, in figure units. */
const MIN_SWING_CLEARANCE = 0.02;
/**
 * The swing arc's height, read off the art module by measuring it rather than
 * retyped: `skyFowlWalkFeet` is sampled at the top of a swing, where the lift
 * fraction is one, so the height it returns there *is* the constant.
 */
const SWING_LIFT_FIGURE_UNITS = Math.max(
  ...Array.from({ length: SWING_SAMPLE_COUNT }, (_, step) =>
    Math.max(...skyFowlWalkFeet((step * TAU) / SWING_SAMPLE_COUNT).map((foot) => -foot.y)),
  ),
);

/**
 * G7 — a two-legged walk keeps one foot down.
 *
 * A bird with both feet in the air is jumping, and one with neither ever
 * leaving the ground is skating. Read off `skyFowlWalkFeet`, which is the same
 * placement the painter draws from, so the gate cannot drift from the art by
 * being right about a different rig.
 */
function gateGait(): void {
  const walk = rowNamed('walk', 'G7');
  if (walk === null) return;
  let framesMeasured = 0;
  let swingsMeasured = 0;
  let liftedInRow = 0;
  let highestLift = 0;
  for (let frame = 0; frame < walk.frameCount; frame++) {
    const feet = skyFowlWalkFeet(stridePhase(frame));
    if (feet.length !== 2) {
      fail('G7', `frame ${frame} placed ${feet.length} feet — the fowl is a biped`);
      continue;
    }
    framesMeasured++;
    const airborne = feet.filter((foot) => foot.y < -PLANTED_EPSILON);
    if (airborne.length === feet.length) {
      fail('G7', `walk[${frame}] has both feet off the ground — the fowl is airborne`);
    }
    if (airborne.length > 0) liftedInRow++;
    for (const foot of feet) {
      swingsMeasured++;
      // The knee rides `liftFraction`, so a placement whose height and lift
      // fraction disagree bends the leg somewhere the foot is not.
      const impliedHeight = foot.liftFraction * SWING_LIFT_FIGURE_UNITS;
      if (Math.abs(impliedHeight + foot.y) > PLANTED_EPSILON) {
        fail(
          'G7',
          `walk[${frame}] has a foot ${(-foot.y).toFixed(4)} units up against a lift fraction ` +
            `of ${foot.liftFraction.toFixed(4)} — the knee is bending for a different foot`,
        );
      }
    }
    const peak = Math.max(...feet.map((foot) => -foot.y));
    highestLift = Math.max(highestLift, peak);
  }
  failUnlessMeasured('G7', framesMeasured, 'walk frames');
  failUnlessMeasured('G7', swingsMeasured, 'placed feet');
  if (framesMeasured > 0 && liftedInRow === 0) {
    fail('G7', 'no walk frame lifts a foot at all — the fowl slides along the street');
  }
  if (framesMeasured > 0 && highestLift < MIN_SWING_CLEARANCE) {
    fail(
      'G7',
      `the highest a foot leaves the ground over the whole row is ${highestLift.toFixed(4)} ` +
        `figure units, under the ${MIN_SWING_CLEARANCE} it takes to read as a step`,
    );
  }
}

// ── G8: the hawk's face ──────────────────────────────────────────────────────

/** How far in front of the head's centre the beak has to reach, in cell pixels. */
const MIN_BEAK_REACH_PX = 4;

/**
 * G8 — the beak leads the face, and the peck pushes it further forward.
 *
 * The hooked beak is the single feature that says hawk rather than pigeon, and
 * the peck row exists to put it somewhere. Measured as the rightmost beak-
 * coloured pixel, which is the beak's tip: every other part of the bird is
 * feather, garment or talon coloured.
 */
function gateBeak(): void {
  const beak = parseHex(SKY_FOWL_BEAK_COLOR);
  const idle = rowNamed('idle', 'G8');
  const peck = rowNamed('peck', 'G8');
  if (idle === null || peck === null) return;

  let palettesMeasured = 0;
  for (const paletteIndex of SAMPLED_PALETTES) {
    const idleTip = rightmostColorX(cellRgba(paletteIndex, idle.name, 0), beak);
    if (idleTip === null) {
      fail('G8', `palette ${paletteIndex} paints no beak at all in its idle`);
      continue;
    }
    palettesMeasured++;
    const headCentre = SKY_FOWL_FIGURES[0].tileX + TILE_SCALE / 2;
    if (idleTip - headCentre < MIN_BEAK_REACH_PX) {
      fail(
        'G8',
        `palette ${paletteIndex}'s beak reaches only ${idleTip - headCentre}px in front of the ` +
          `tile centre, under the ${MIN_BEAK_REACH_PX}px it takes to read as a beak`,
      );
    }

    let previous = idleTip;
    let advanced = false;
    for (let frame = 0; frame < peck.frameCount; frame++) {
      const tip = rightmostColorX(cellRgba(paletteIndex, peck.name, frame), beak);
      if (tip === null) {
        fail('G8', `palette ${paletteIndex}'s peck[${frame}] paints no beak`);
        continue;
      }
      if (tip < previous) {
        fail(
          'G8',
          `palette ${paletteIndex}'s peck pulls its beak back at frame ${frame} ` +
            `(x ${tip} against ${previous}) — the lunge has to go one way`,
        );
      }
      if (tip > previous) advanced = true;
      previous = tip;
    }
    if (!advanced) {
      fail('G8', `palette ${paletteIndex}'s peck never moves the beak forward at all`);
    }
  }
  failUnlessMeasured('G8', palettesMeasured, 'palettes with a measurable beak');
}

function rightmostColorX(data: Uint8ClampedArray, want: Rgb): number | null {
  let rightmost: number | null = null;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const at = (y * frameWidth + x) * CHANNELS;
      if (data[at + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (Math.abs(data[at] - want.r) > COLOR_MATCH_TOLERANCE) continue;
      if (Math.abs(data[at + 1] - want.g) > COLOR_MATCH_TOLERANCE) continue;
      if (Math.abs(data[at + 2] - want.b) > COLOR_MATCH_TOLERANCE) continue;
      if (rightmost === null || x > rightmost) rightmost = x;
    }
  }
  return rightmost;
}

// ── G9: the clothes are painted, and they are this bird's ────────────────────

/** The fewest pixels a garment must cover to be a garment rather than a fleck. */
const MIN_GARMENT_PIXELS = 12;
/**
 * The band a hat lives in: everything painted above the top edge of the tile the
 * bird stands in. A bare head reaches up here with its crest feather alone,
 * which is a few pixels; a hat fills the width of the head.
 */
const CROWN_ZONE_BOTTOM_PX = SKY_FOWL_FIGURES[0].tileY;
/** How much more of the crown zone a hat must cover than a bare head does. */
const MIN_HAT_CROWN_RATIO = 2.5;

/** Ink in the band above the head, where a hat is the only thing that can be. */
function crownInk(data: Uint8ClampedArray): number {
  let found = 0;
  for (let y = 0; y < CROWN_ZONE_BOTTOM_PX; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alphaAt(data, x, y) > INK_ALPHA) found++;
    }
  }
  return found;
}

/**
 * Pixels of one colour painted in the crown band, where only a hat can be.
 *
 * A hat has to be counted here rather than over the whole cell, and the reason
 * is measured: every hat colour in the family sits within
 * {@link COLOR_MATCH_TOLERANCE} of something painted further down the same bird
 * — the blue hat of a shade with its own trousers, the mustard one with its own
 * vest. Counted over the cell, the five hatted palettes score 180 to 364
 * matching pixels of which only 37 are the hat, so removing the hat block
 * outright still left the count an order of magnitude over the limit and the
 * check could not fail. In the crown band the same palettes score exactly those
 * 37 and a bird with no hat scores none.
 *
 * The vest and the trousers cannot be narrowed the same way — they are painted
 * over the body, where there is no band that only they can occupy — so their
 * half of this gate is weaker than its message reads: painting the vest in a
 * feather colour reddens three of the eight palettes rather than all eight.
 */
function countCrownColor(data: Uint8ClampedArray, want: Rgb): number {
  let found = 0;
  for (let y = 0; y < CROWN_ZONE_BOTTOM_PX; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const at = (y * frameWidth + x) * CHANNELS;
      if (data[at + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (Math.abs(data[at] - want.r) > COLOR_MATCH_TOLERANCE) continue;
      if (Math.abs(data[at + 1] - want.g) > COLOR_MATCH_TOLERANCE) continue;
      if (Math.abs(data[at + 2] - want.b) > COLOR_MATCH_TOLERANCE) continue;
      found++;
    }
  }
  return found;
}

/**
 * G9 — every palette paints its own vest and its own trousers, and a hatless
 * palette paints no hat.
 *
 * This is the gate for the thing the conversion changed: the clothing used to
 * be four tinted mask sheets composited over a neutral body, and is now painted
 * straight from the palette. A palette silently falling back to another's
 * colours — or to none — is invisible to every other gate here, because the
 * bird is still a correctly shaped bird.
 */
function gateClothing(): void {
  const idle = rowNamed('idle', 'G9');
  if (idle === null) return;
  let garmentsMeasured = 0;
  let hatlessMeasured = 0;
  const bareCrowns: number[] = [];
  const hattedCrowns: number[] = [];
  SKY_FOWL_PALETTES.forEach((cloth, paletteIndex) => {
    const data = cellRgba(paletteIndex, idle.name, 0);
    for (const [name, hex] of [
      ['vest', cloth.vest],
      ['trousers', cloth.pants],
    ] as const) {
      garmentsMeasured++;
      const painted = countColor(data, parseHex(hex));
      if (painted < MIN_GARMENT_PIXELS) {
        fail(
          'G9',
          `palette ${paletteIndex} paints ${painted} pixels of ${hex} for its ${name}, under the ` +
            `${MIN_GARMENT_PIXELS} it takes to be wearing one`,
        );
      }
    }
    if (cloth.hat === null) {
      hatlessMeasured++;
      bareCrowns.push(crownInk(data));
      return;
    }
    garmentsMeasured++;
    hattedCrowns.push(crownInk(data));
    const hatPixels = countCrownColor(data, parseHex(cloth.hat));
    if (hatPixels < MIN_GARMENT_PIXELS) {
      fail(
        'G9',
        `palette ${paletteIndex} paints ${hatPixels} pixels of ${cloth.hat} above its own tile, ` +
          `under the ${MIN_GARMENT_PIXELS} it takes to be wearing a hat`,
      );
    }
  });
  failUnlessMeasured('G9', garmentsMeasured, 'garments');
  failUnlessMeasured('G9', hatlessMeasured, 'bare-headed palettes');
  failUnlessMeasured('G9', hattedCrowns.length, 'hatted palettes');
  if (bareCrowns.length > 0 && hattedCrowns.length > 0) {
    const widestBare = Math.max(...bareCrowns);
    const narrowestHatted = Math.min(...hattedCrowns);
    // An ordering rather than a threshold on either: what has to stay true is
    // that a hat is a hat and a bare head is bare, and both numbers move
    // together whenever the head is redrawn.
    if (narrowestHatted < widestBare * MIN_HAT_CROWN_RATIO) {
      fail(
        'G9',
        `a hatted crown covers only ${narrowestHatted} pixels against ${widestBare} for a bare ` +
          `head — under the ${MIN_HAT_CROWN_RATIO}× that makes a hat visible as one`,
      );
    }
  }
}

// ── G10: a provoked fowl looks provoked ──────────────────────────────────────

/** The least red a provoked eye's ring must add over the calm one. */
const MIN_ANGRY_RED_PIXELS = 4;
/** How much redder than green a pixel has to be to be part of the ring. */
const RING_RED_DOMINANCE = 40;

/**
 * G10 — the aggressive row reads differently from the idle.
 *
 * A hostile fowl is a fowl the player may hit, and the only warning is the
 * picture. The two rows are one static frame each, so a palette tweak that
 * flattened the ring or the brow would leave two identical cells and nothing
 * else here would care.
 */
function gateAggressiveReads(): void {
  const idle = rowNamed('idle', 'G10');
  const angry = rowNamed('aggressive', 'G10');
  if (idle === null || angry === null) return;
  let palettesMeasured = 0;
  for (const paletteIndex of SAMPLED_PALETTES) {
    palettesMeasured++;
    const calm = cellRgba(paletteIndex, idle.name, 0);
    const provoked = cellRgba(paletteIndex, angry.name, 0);
    if (colorDelta(calm, provoked) === 0) {
      fail('G10', `palette ${paletteIndex} paints an identical cell whether or not it is angry`);
    }
    const redGain = countRedDominant(provoked) - countRedDominant(calm);
    if (redGain < MIN_ANGRY_RED_PIXELS) {
      fail(
        'G10',
        `palette ${paletteIndex} gains only ${redGain} red pixels when provoked, under the ` +
          `${MIN_ANGRY_RED_PIXELS} the eye ring is worth — nothing says it is hostile`,
      );
    }
  }
  failUnlessMeasured('G10', palettesMeasured, 'palettes compared calm against provoked');
}

function colorDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

function countRedDominant(data: Uint8ClampedArray): number {
  let found = 0;
  for (let i = 0; i < data.length; i += CHANNELS) {
    if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    if (data[i] - data[i + 1] < RING_RED_DOMINANCE) continue;
    if (data[i] - data[i + 2] < RING_RED_DOMINANCE) continue;
    found++;
  }
  return found;
}

/** Runs every gate and returns one message per failure. */
export function skyFowlGateFailures(): string[] {
  failures.length = 0;
  cellsByKey.clear();
  gateStructure();
  gateFigureIdentity();
  gateRuntimeStateNames();
  gateLoopCloses();
  gateAnchor();
  gateWarmRowSize();
  gateGait();
  gateBeak();
  gateClothing();
  gateAggressiveReads();
  return [...failures];
}
