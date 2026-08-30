/**
 * The clown family's art gates.
 *
 * None of these creatures has a baked sheet to inspect any more, so every
 * invariant the old bake enforced by throwing before it wrote a PNG is enforced
 * here instead, against cells painted from the figures themselves. The two
 * generators between them threw on three things — a frame clipped by its own
 * cell wall, a frame that painted nothing, and a gas cloud that had gone
 * opaque because node-canvas dropped an exponent-notation alpha — and all three
 * survive below. The rest are invariants the bake never checked and could not:
 * that the feet stand on the ground line the tile hangs off, that the wrapper's
 * frame counts and the figure's agree, that every state name the runtime can
 * build is one the figure paints, and that a warm row still fits the cache.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:clowns`.
 */

import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureFrameCount } from '../src/sprites/figure/figureDef.js';
import {
  CLOWN_FIGURES,
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  STILT_CLOWN_FIGURE,
  TERROR_CLOWN_FIGURE,
  TILE_SCALE,
  clownSpecOf,
  terrorStyle,
} from '../src/sprites/art/clownFigure.js';
import {
  CLOWN_GAS_FIGURES,
  CLOWN_GAS_FIGURE,
  FRAME_PADDING,
  GAS_STATE,
} from '../src/sprites/art/clownGasFigure.js';
import { EVIL_CLOWN_FRAME_COUNT } from '../src/sprites/evilClownSprite.js';
import {
  EVIL_CLOWN_GORE_PARTS,
  EVIL_CLOWN_JUGGLE_STATES,
  EVIL_CLOWN_LOCOMOTION_STATES,
  EVIL_CLOWN_SWIPE_STATES,
} from '../src/sprites/evilClownSprite.js';
import {
  FAT_CLOWN_ATTACK_STATES,
  FAT_CLOWN_FRAME_COUNT,
  FAT_CLOWN_LOCOMOTION_STATES,
} from '../src/sprites/fatClownSprite.js';
import {
  STILT_CLOWN_ATTACK_STATES,
  STILT_CLOWN_FRAME_COUNT,
  STILT_CLOWN_LOCOMOTION_STATES,
} from '../src/sprites/stiltClownSprite.js';
import {
  TERROR_CLOWN_FRAME_COUNT,
  TERROR_CLOWN_LOCOMOTION_STATES,
  terrorClownAttackStates,
} from '../src/sprites/terrorTheClownSprite.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { FIGURE_BYTE_BUDGET } from '../src/sprites/figure/figureFrameCache.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Turns a 0-1 share into the percentage a message reads in. */
const PERCENT_SCALE = 100;

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

/**
 * The alpha a pixel has to carry to count as the figure's own body rather than
 * as something soft it casts.
 *
 * Every clown paints a contact shadow on the ground line wherever its feet
 * happen to be, so a lowest-*ink* anchor check measures the shadow and stays
 * green while the figure floats above it. Only near-solid pixels are the body.
 */
const SOLID_ALPHA = 200;

interface Extent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The bounding box of pixels at or above `threshold`, or null if there are none. */
function extentOf(cell: Cell, threshold: number): Extent | null {
  let minX = cell.width;
  let minY = cell.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/** Every pose state a clown declares — its gore pieces are not poses. */
function poseStatesOf(def: FigureDef): string[] {
  const spec = clownSpecOf(def);
  return spec.rows.filter((row) => row.pose !== null).map((row) => row.name);
}

/** Every gore state a clown declares, which is only ever the Evil Clown's. */
function goreStatesOf(def: FigureDef): string[] {
  const spec = clownSpecOf(def);
  return spec.rows.flatMap((row) => [...(row.pieceStates ?? [])]);
}

// ── G1 — the shared structural gates ─────────────────────────────────────────

/**
 * The gore pieces are exempt from the cell-fill check and from nothing else.
 *
 * A severed shoe is one small shape in a cell sized for a three-tile figure;
 * the cell is the clown's, not the shoe's, and shrinking it is not on offer
 * while the pose rows need every pixel of it.
 */
/**
 * How much of its cell an effect's widest frame has to fill.
 *
 * Lower than a figure's, and bought by geometry rather than waived: an effect's
 * cell is square and sized by the furthest the effect reaches in *any*
 * direction, so a tumbling bottle — long, narrow, and spinning — can only ever
 * fill the inscribed sliver of it. What holds the cells honest here is G6,
 * which re-derives each cell from the effect's own declared reach, and G5,
 * which prices the row.
 */
const GAS_MIN_INK_SHARE = 0.1;

function gateStructure(): void {
  let figuresMeasured = 0;
  for (const def of CLOWN_FIGURES) {
    figuresMeasured++;
    for (const message of figureStructuralFailures(def, { sparseStates: goreStatesOf(def) })) {
      fail('G1', message);
    }
  }
  for (const { def } of CLOWN_GAS_FIGURES) {
    figuresMeasured++;
    for (const message of figureStructuralFailures(def, { minInkAreaShare: GAS_MIN_INK_SHARE })) {
      fail('G1', message);
    }
  }
  failUnlessMeasured('G1', figuresMeasured, 'figures');
}

// ── G2 — the wrapper and the figure agree about row lengths ──────────────────

/**
 * The draw calls *clamp* the frame index, so a row that lost frames would
 * silently freeze on its last one rather than throw. Each wrapper therefore
 * carries its own exhaustive frame-count table, and this is what holds the two
 * to each other.
 *
 * Both sides read the same `WALK_FRAMES`-style constants out of the figure
 * module, so retuning a row's length moves both numbers together and this can
 * never speak about that — which is the right outcome, because one constant is
 * exactly what a collapsed duplicate looks like. What it does catch is the two
 * tables parting company *structurally*: a row renamed on one side (an unknown
 * state answers 1 frame), a row given a hand-written length, a row the figure
 * paints that no wrapper animates, or a wrapper state no figure paints.
 */
const WRAPPER_FRAME_COUNTS: ReadonlyArray<{
  readonly def: FigureDef;
  readonly counts: Readonly<Record<string, number>>;
}> = [
  { def: FAT_CLOWN_FIGURE, counts: FAT_CLOWN_FRAME_COUNT },
  { def: STILT_CLOWN_FIGURE, counts: STILT_CLOWN_FRAME_COUNT },
  { def: TERROR_CLOWN_FIGURE, counts: TERROR_CLOWN_FRAME_COUNT },
  { def: EVIL_CLOWN_FIGURE, counts: EVIL_CLOWN_FRAME_COUNT },
];

function gateWrapperFrameCounts(): void {
  let rowsCompared = 0;
  for (const { def, counts } of WRAPPER_FRAME_COUNTS) {
    for (const [state, declared] of Object.entries(counts)) {
      rowsCompared++;
      const painted = figureFrameCount(def, state);
      if (painted === declared) continue;
      fail(
        'G2',
        `${def.id}.${state}: the sprite wrapper animates ${declared} frames and the figure ` +
          `paints ${painted}`,
      );
    }
    for (const state of poseStatesOf(def)) {
      if (state in counts) continue;
      fail(
        'G2',
        `${def.id}.${state} is a pose row the figure paints that the sprite wrapper's frame-count ` +
          'table does not name, so nothing animates it and nothing prewarms it',
      );
    }
  }
  failUnlessMeasured('G2', rowsCompared, 'wrapper rows');
}

// ── G3 — every state name the runtime can build is one a figure paints ───────

function gateRuntimeStateNames(): void {
  const tables: ReadonlyArray<{
    readonly def: FigureDef;
    readonly names: readonly string[];
    readonly purpose: string;
  }> = [
    {
      def: FAT_CLOWN_FIGURE,
      names: Object.keys(FAT_CLOWN_FRAME_COUNT),
      purpose: 'the fat clown wrapper',
    },
    {
      def: FAT_CLOWN_FIGURE,
      names: [...FAT_CLOWN_LOCOMOTION_STATES],
      purpose: 'the fat clown spawn prewarm',
    },
    {
      def: FAT_CLOWN_FIGURE,
      names: [...FAT_CLOWN_ATTACK_STATES],
      purpose: 'the fat clown slam prewarm',
    },
    {
      def: STILT_CLOWN_FIGURE,
      names: Object.keys(STILT_CLOWN_FRAME_COUNT),
      purpose: 'the stilt clown wrapper',
    },
    {
      def: STILT_CLOWN_FIGURE,
      names: [...STILT_CLOWN_LOCOMOTION_STATES],
      purpose: 'the stilt clown spawn prewarm',
    },
    {
      def: STILT_CLOWN_FIGURE,
      names: [...STILT_CLOWN_ATTACK_STATES],
      purpose: 'the stilt clown lunge prewarm',
    },
    {
      def: TERROR_CLOWN_FIGURE,
      names: Object.keys(TERROR_CLOWN_FRAME_COUNT),
      purpose: 'the terror wrapper',
    },
    {
      def: TERROR_CLOWN_FIGURE,
      names: [...TERROR_CLOWN_LOCOMOTION_STATES],
      purpose: 'the terror spawn prewarm',
    },
    {
      def: TERROR_CLOWN_FIGURE,
      names: [...terrorClownAttackStates(false)],
      purpose: 'the terror mallet prewarm',
    },
    {
      def: TERROR_CLOWN_FIGURE,
      names: [...terrorClownAttackStates(true)],
      purpose: 'the enraged mallet prewarm',
    },
    {
      def: EVIL_CLOWN_FIGURE,
      names: Object.keys(EVIL_CLOWN_FRAME_COUNT),
      purpose: 'the evil clown wrapper',
    },
    {
      def: EVIL_CLOWN_FIGURE,
      names: [...EVIL_CLOWN_LOCOMOTION_STATES],
      purpose: 'the evil clown spawn prewarm',
    },
    {
      def: EVIL_CLOWN_FIGURE,
      names: [...EVIL_CLOWN_SWIPE_STATES],
      purpose: 'the evil clown swipe prewarm',
    },
    {
      def: EVIL_CLOWN_FIGURE,
      names: [...EVIL_CLOWN_JUGGLE_STATES],
      purpose: 'the evil clown juggle prewarm',
    },
    {
      def: EVIL_CLOWN_FIGURE,
      names: [...EVIL_CLOWN_GORE_PARTS],
      purpose: 'the body-part gore list',
    },
  ];
  for (const { def, names, purpose } of tables) {
    for (const message of missingStateFailures(def, names, purpose)) fail('G3', message);
  }
  for (const { def } of CLOWN_GAS_FIGURES) {
    for (const message of missingStateFailures(
      def,
      [...def.states.keys()],
      `${def.id}'s own row`,
    )) {
      fail('G3', message);
    }
  }
  failUnlessMeasured('G3', tables.length, 'runtime state tables');
}

// ── G4 — the feet stand on the ground line the tile hangs off ────────────────

/**
 * How far a planted foot may sit from the ground line, in cell pixels.
 *
 * Wide enough for a heel lifting through toe-off and for a stilt's point, and
 * narrow enough that a pose whose feet were authored off the floor — the usual
 * shape of a rig change gone wrong — cannot hide inside it. The measurement is
 * of the *pose* against its own ground line: the cell geometry itself is what
 * the parity run against the sheet proved, and nothing here can re-prove it.
 */
const FLOAT_TOLERANCE_PX = 4;

/**
 * Only the float half is measured here, and the other direction is deliberately
 * left to G1.
 *
 * A companion clause allowing a figure to sink 24 px below the ground line
 * stood here and could not fail on its own terms. A cell holds only so much
 * room under its ground line — 19 px for the fat and stilt clowns, 25 and 27
 * for Terror and the Evil Clown — so the sink allowance sat *above* two of the
 * four ceilings and within two or three pixels of the other two. Anything
 * driven deep enough to trip it had already run its ink into the bottom cell
 * wall, which G1's clipping check reports first and for every clown; mutation
 * testing reddened G1 212 times and this clause twice, at exactly the cell
 * floor. A figure standing through its own tile is therefore G1's to catch.
 */
function gateFeetOnTheGround(): void {
  let framesMeasured = 0;
  for (const def of CLOWN_FIGURES) {
    const spec = clownSpecOf(def);
    const groundY = spec.groundY;
    let highestState = '';
    let highestGap = Number.NEGATIVE_INFINITY;
    for (const state of poseStatesOf(def)) {
      for (let frame = 0; frame < figureFrameCount(def, state); frame++) {
        const extent = extentOf(cellOf(def, state, frame), SOLID_ALPHA);
        if (extent === null) {
          fail('G4', `${def.id}.${state}[${frame}] paints no solid pixels at all`);
          continue;
        }
        framesMeasured++;
        const above = groundY - extent.maxY;
        if (above > highestGap) {
          highestGap = above;
          highestState = `${state}[${frame}]`;
        }
      }
    }
    if (highestGap > FLOAT_TOLERANCE_PX) {
      fail(
        'G4',
        `${def.id}.${highestState} has its lowest solid pixel ${highestGap.toFixed(0)} px above ` +
          `the ground line at y=${groundY}, past the ${FLOAT_TOLERANCE_PX} px allowed; the ` +
          'figure is standing off its own tile',
      );
    }
  }
  failUnlessMeasured('G4', framesMeasured, 'pose frames');
}

// ── G5 — a warm row still fits the cache ─────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * How many of a figure's rows have to be able to sit in the cache at once.
 *
 * A clown holds its walk and its idle warm all the time and adds an attack pair
 * on top the moment it engages, which is four; Terror carries both palettes of
 * the pair he is in. Any fewer and a wind-up evicts the walk it interrupted.
 */
const ROWS_THAT_MUST_FIT_TOGETHER = 4;

/**
 * The ceiling for one warm animation row, taken from the cache's own per-figure
 * ceiling rather than picked.
 *
 * A painted figure is admitted a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of every
 * row. Importing the cache's constant is what stops this from quietly becoming
 * a different budget from the one the runtime enforces.
 */
const ROW_BUDGET_MEGABYTES = FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE / ROWS_THAT_MUST_FIT_TOGETHER;

function gateWarmRowSize(): void {
  let figuresMeasured = 0;
  const gasDefs = CLOWN_GAS_FIGURES.map((entry) => entry.def);
  for (const def of [...CLOWN_FIGURES, ...gasDefs]) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    let totalFrames = 0;
    let statesMeasured = 0;
    for (const [state, declared] of def.states) {
      statesMeasured++;
      totalFrames += declared.frames;
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    failUnlessMeasured('G5', statesMeasured, `declared states on ${def.id}`);
    if (statesMeasured === 0) continue;
    figuresMeasured++;

    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G5 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES.toFixed(0)} MB budget; all ${statesMeasured} states warm at ` +
        `once would be ${allWarm.toFixed(2)} MB against the cache's ` +
        `${(FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE).toFixed(0)} MB per-figure ceiling`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'G5',
        `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES.toFixed(0)} MB`,
      );
    }
  }
  failUnlessMeasured('G5', figuresMeasured, 'figures');
}

// ── G6 — the gas cells are the size their own reach asks for ─────────────────

/**
 * The vial, the shatter and the cloud each declare how far they paint, and the
 * cell is derived from that declaration — so comparing the cell back against
 * the formula that built it would prove nothing. What is worth measuring is the
 * *ink*: an effect that has outgrown its declared reach paints pixels past a
 * number nothing else here computes from.
 *
 * Only that one direction. A second clause claiming to catch the opposite case
 * — a reach the effect no longer needs, so a cell larger than the art — stood
 * beside it and asked whether the clear space left inside the cell fell under
 * the padding, which for every cell size the formula can produce works out to
 * the same comparison as the overshoot clause and never fired on its own. An
 * oversized cell is priced by G1's minimum ink share instead, which is what
 * {@link GAS_MIN_INK_SHARE} is for.
 */
/**
 * How far past its declared reach an effect's softest edge may still put ink.
 *
 * A cloud's rim is a gradient, so the last visible pixel lands a little outside
 * the radius the shape is authored to. Taken as a share of the padding the cell
 * carries rather than as a number of its own, so it cannot be raised past that
 * padding and start forgiving ink the cell has no room for. A guard comparing
 * the two constants stood here instead and was decidable from their types
 * alone — a clause no art could ever change the answer to.
 */
const REACH_OVERSHOOT_SHARE = 0.6;
const REACH_OVERSHOOT_PX = Math.round(FRAME_PADDING * REACH_OVERSHOOT_SHARE);

function gateGasCells(): void {
  let framesMeasured = 0;
  for (const { def, reach } of CLOWN_GAS_FIGURES) {
    const reachPx = reach * TILE_SCALE + REACH_OVERSHOOT_PX;
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        const cell = cellOf(def, state, frame);
        const extent = extentOf(cell, 1);
        if (extent === null) {
          fail('G6', `${def.id}.${state}[${frame}] painted nothing`);
          continue;
        }
        framesMeasured++;
        const furthest = Math.max(
          def.tileX - extent.minX,
          extent.maxX - def.tileX,
          def.tileY - extent.minY,
          extent.maxY - def.tileY,
        );
        if (furthest > reachPx) {
          fail(
            'G6',
            `${def.id}.${state}[${frame}] paints ${furthest.toFixed(0)} px from its anchor, ` +
              `past the ${reachPx.toFixed(0)} px reach its cell was sized from`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G6', framesMeasured, 'gas frames');
}

// ── G7 — the cloud is see-through everywhere ─────────────────────────────────

/**
 * node-canvas drops an `rgba()` whose alpha serialises as `5e-17`, which turns
 * a gradient's transparent stop opaque and bakes a solid disc where a soft
 * cloud belongs. A cloud that is fully opaque anywhere is the signature, and
 * the runtime painter is exposed to the identical trap through the harness.
 */
const MAX_CLOUD_ALPHA = 250;

function gateNoOpaqueSmear(): void {
  let framesMeasured = 0;
  let worst = 0;
  for (let frame = 0; frame < figureFrameCount(CLOWN_GAS_FIGURE, GAS_STATE); frame++) {
    const cell = cellOf(CLOWN_GAS_FIGURE, GAS_STATE, frame);
    framesMeasured++;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) worst = Math.max(worst, alphaAt(cell, x, y));
    }
  }
  failUnlessMeasured('G7', framesMeasured, 'cloud frames');
  if (worst > MAX_CLOUD_ALPHA) {
    fail(
      'G7',
      `the cloud reaches alpha ${worst}; it is meant to be see-through everywhere. A fully ` +
        'opaque pixel means a gradient stop lost its alpha — check for exponent-notation alphas ' +
        'reaching rgba()',
    );
  }
}

// ── G8 — enrage is a repaint, not a tint ─────────────────────────────────────

/**
 * How far apart, on a 0–255 channel scale, the mean colour of Terror's two
 * palettes has to sit on the same frame.
 *
 * Enrage swaps the suit, the mane and the eye glow together — that is the whole
 * reason it costs a second set of rows rather than a `ctx.filter`. Two palettes
 * that have drifted into each other are eight rows of cache for nothing the
 * player can see.
 */
const ENRAGE_COLOUR_DISTANCE = 12;

const ENRAGE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['walk', 'walk_enraged'],
  ['idle', 'idle_enraged'],
  ['windup', 'windup_enraged'],
  ['swing', 'swing_enraged'],
];

/** The mean RGB of a cell's solid pixels, which is the costume's own colour. */
function meanSolidColour(cell: Cell): readonly [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < SOLID_ALPHA) continue;
      const base = (y * cell.width + x) * CHANNELS;
      r += cell.data[base];
      g += cell.data[base + 1];
      b += cell.data[base + 2];
      count++;
    }
  }
  if (count === 0) return null;
  return [r / count, g / count, b / count];
}

function gateEnrageIsARepaint(): void {
  let pairsCompared = 0;
  // Read off the palettes as well as the pixels: two style objects that have
  // become the same object make every painted comparison agree trivially.
  const plain = terrorStyle(false).palette;
  const enraged = terrorStyle(true).palette;
  if (plain.suitMid === enraged.suitMid) {
    fail('G8', 'the enraged and plain suits are the same colour, so enrage repaints nothing');
  }
  for (const [calm, angry] of ENRAGE_PAIRS) {
    const frames = Math.min(
      figureFrameCount(TERROR_CLOWN_FIGURE, calm),
      figureFrameCount(TERROR_CLOWN_FIGURE, angry),
    );
    if (frames === 0) {
      fail('G8', `terror_clown has no pair of rows named "${calm}" and "${angry}"`);
      continue;
    }
    for (let frame = 0; frame < frames; frame++) {
      const before = meanSolidColour(cellOf(TERROR_CLOWN_FIGURE, calm, frame));
      const after = meanSolidColour(cellOf(TERROR_CLOWN_FIGURE, angry, frame));
      if (before === null || after === null) {
        fail('G8', `terror_clown ${calm}/${angry}[${frame}] has no solid pixels to compare`);
        continue;
      }
      pairsCompared++;
      const distance = Math.hypot(before[0] - after[0], before[1] - after[1], before[2] - after[2]);
      if (distance >= ENRAGE_COLOUR_DISTANCE) continue;
      fail(
        'G8',
        `terror_clown ${calm}[${frame}] and ${angry}[${frame}] differ by only ` +
          `${distance.toFixed(1)} of the ${ENRAGE_COLOUR_DISTANCE} an enrage has to read as`,
      );
    }
  }
  failUnlessMeasured('G8', pairsCompared, 'enrage row pairs');
}

// ── G9 — the juggled vials clear the clown's own head ────────────────────────

/**
 * A juggler's cascade crests level with the top of the head. Anything shorter
 * keeps the vials down among the arms, where the figure's own limbs hide the
 * one thing the row exists to show — and the vials are what tells the player
 * that gas is coming.
 */
const CASCADE_CLEARANCE_PX = 24;

const JUGGLE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['walk', 'juggle_walk'],
  ['walk_side', 'juggle_walk_side'],
  ['walk_away', 'juggle_walk_away'],
];

function gateCascadeClearsTheHead(): void {
  let rowsCompared = 0;
  for (const [plain, juggling] of JUGGLE_ROWS) {
    const plainFrames = figureFrameCount(EVIL_CLOWN_FIGURE, plain);
    const juggleFrames = figureFrameCount(EVIL_CLOWN_FIGURE, juggling);
    if (plainFrames === 0 || juggleFrames === 0) {
      fail('G9', `evil_clown has no pair of rows named "${plain}" and "${juggling}"`);
      continue;
    }
    let headTop = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < plainFrames; frame++) {
      const extent = extentOf(cellOf(EVIL_CLOWN_FIGURE, plain, frame), 1);
      if (extent !== null) headTop = Math.min(headTop, extent.minY);
    }
    let cascadeTop = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < juggleFrames; frame++) {
      const extent = extentOf(cellOf(EVIL_CLOWN_FIGURE, juggling, frame), 1);
      if (extent !== null) cascadeTop = Math.min(cascadeTop, extent.minY);
    }
    if (!Number.isFinite(headTop) || !Number.isFinite(cascadeTop)) {
      fail('G9', `evil_clown ${plain}/${juggling} painted nothing to measure`);
      continue;
    }
    rowsCompared++;
    const clearance = headTop - cascadeTop;
    if (clearance >= CASCADE_CLEARANCE_PX) continue;
    fail(
      'G9',
      `evil_clown ${juggling} reaches only ${clearance.toFixed(0)} px above ${plain}, under the ` +
        `${CASCADE_CLEARANCE_PX} px the cascade has to clear the head by`,
    );
  }
  failUnlessMeasured('G9', rowsCompared, 'juggle rows');
}

// ── G10 — the looping rows turn over ─────────────────────────────────────────

/**
 * The rows that play on a clock rather than once, taken from the prewarm lists
 * the runtime already keeps rather than from a name pattern of this gate's own.
 *
 * The juggling walk is a walk with three vials in the air, so it loops; the
 * laugh that opens the vial phase is a one-shot and is filtered out here.
 */
const EVIL_JUGGLE_LOOP_PREFIX = 'juggle_walk';

const LOOPING_ROWS: ReadonlyArray<{
  readonly def: FigureDef;
  readonly states: readonly string[];
}> = [
  { def: FAT_CLOWN_FIGURE, states: FAT_CLOWN_LOCOMOTION_STATES },
  { def: STILT_CLOWN_FIGURE, states: STILT_CLOWN_LOCOMOTION_STATES },
  { def: TERROR_CLOWN_FIGURE, states: TERROR_CLOWN_LOCOMOTION_STATES },
  {
    def: EVIL_CLOWN_FIGURE,
    states: [
      ...EVIL_CLOWN_LOCOMOTION_STATES,
      ...EVIL_CLOWN_JUGGLE_STATES.filter((state) => state.startsWith(EVIL_JUGGLE_LOOP_PREFIX)),
    ],
  },
];

/**
 * How small the seam may be relative to the row's median step.
 *
 * The seventeen shipped loop rows wrap between 0.94 and 1.74 times their median
 * step, which is what a cycle that turns over looks like. What this catches is
 * the wrap changing nothing — the shape a phase sampled at
 * `frame / (frameCount - 1)` produces, which makes the last frame a repeat of
 * the first and spends a frame of the cycle held still.
 */
const MIN_SEAM_VS_MEDIAN_STEP = 0.4;

/**
 * How far two poses may differ before they count as different poses.
 *
 * Every number in a clown's pose is an angle in radians or a length in tiles,
 * so this is far below anything an author would type and far above the
 * accumulated rounding of the same trigonometry evaluated at 0 and at 1.
 */
const POSE_EPSILON = 1e-9;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Every number reachable inside a pose, in a stable order. */
function poseNumbers(value: unknown, into: number[]): void {
  if (typeof value === 'number') {
    into.push(value);
    return;
  }
  if (!isRecord(value)) return;
  for (const nested of Object.values(value)) poseNumbers(nested, into);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

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

/**
 * A loop has to cover exactly one turn, and its wrap has to move the art.
 *
 * The two halves are measured in different units on purpose. The turn is read
 * off the *pose*, by asking the row for the frame after its last one: a row that
 * runs one and a half cycles, or that stops a frame short, lands somewhere other
 * than where it opened, and the pixels cannot say so — a clown's ordinary walk
 * steps rise faster than its wrap does when the cycle is stretched, so a
 * deliberately broken 1.5-turn walk measures a *smaller* seam-to-step ratio than
 * the shipped row and sails past any pixel ceiling. The wrap itself is read off
 * the pixels, where a held frame is unmistakable.
 */
function gateLoopsTurnOver(): void {
  let rowsMeasured = 0;
  for (const { def, states } of LOOPING_ROWS) {
    const spec = clownSpecOf(def);
    failUnlessMeasured('G10', states.length, `looping rows on ${def.id}`);
    for (const message of missingStateFailures(def, states, `${def.id}'s looping rows`)) {
      fail('G10', message);
    }
    for (const state of states) {
      const row = spec.rows.find((candidate) => candidate.name === state);
      const pose = row?.pose ?? null;
      if (row === undefined || pose === null) {
        fail('G10', `${def.id} declares no posed row named "${state}" to measure a loop on`);
        continue;
      }
      rowsMeasured++;
      const opening: number[] = [];
      const wrappingRound: number[] = [];
      poseNumbers(pose(0), opening);
      poseNumbers(pose(row.frameCount), wrappingRound);
      if (opening.length !== wrappingRound.length) {
        fail('G10', `${def.id}.${state} poses a different shape at frame 0 and at its wrap`);
      } else {
        const worst = opening.reduce(
          (drift, value, index) => Math.max(drift, Math.abs(value - wrappingRound[index])),
          0,
        );
        if (worst > POSE_EPSILON) {
          fail(
            'G10',
            `${def.id}.${state} does not cover exactly one turn: the frame after its last sits ` +
              `${worst.toFixed(4)} away from the frame it opened on, so it pops once per cycle`,
          );
        }
      }
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(meanAlphaDelta(def, state, frame - 1, frame));
      }
      if (steps.length === 0) {
        fail('G10', `${def.id}.${state} has ${row.frameCount} frames, too few to judge a loop by`);
        continue;
      }
      const seam = meanAlphaDelta(def, state, row.frameCount - 1, 0);
      const typical = median(steps);
      if (typical <= 0) {
        fail('G10', `${def.id}.${state} does not move at all between any two frames`);
        continue;
      }
      if (seam >= typical * MIN_SEAM_VS_MEDIAN_STEP) continue;
      fail(
        'G10',
        `${def.id}.${state} moves only ${seam.toFixed(2)} of mean alpha across its wrap against ` +
          `a median in-cycle step of ${typical.toFixed(2)} ` +
          `(${(seam / typical).toFixed(2)}×, floor ${MIN_SEAM_VS_MEDIAN_STEP}×) — the row ends ` +
          'on a repeat of the frame it starts on and spends a frame of the cycle held still',
      );
    }
  }
  failUnlessMeasured('G10', rowsMeasured, 'looping rows');
}

const rgbaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's full RGBA, baked as the runtime cache bakes it. */
function cellRgba(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}|${state}|${frame}`;
  const cached = rgbaByCell.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const { data } = bakeFigureCell(def, state, frame)
    .getContext('2d')
    .getImageData(0, 0, frameWidth, frameHeight);
  rgbaByCell.set(key, data);
  return data;
}

/**
 * G11 — a row paints as many pictures as it declares frames.
 *
 * G10 above is blind to this by construction: seam closure measures how far the
 * art *moves* across the wrap, and a cycle that comes back the way it went moves
 * exactly as much on the return leg. The evil clown's head-on walks shipped that
 * way — eight declared frames and seven pictures, the mid-row frame being the
 * opening frame again because both feet are home at rest on both of them — and
 * so did his laugh, whose two heaves put two frames on the same instant.
 *
 * Baked rather than merely painted, because the baked cell is what the cache
 * stores and the game blits.
 */
function gateDistinctFrames(): void {
  let framesMeasured = 0;
  let worst: { readonly share: number; readonly note: string } | null = null;
  for (const def of [...CLOWN_FIGURES, ...CLOWN_GAS_FIGURES.map(({ def: gas }) => gas)]) {
    const report = sharedDistinctFrameFailures(def, (state, frame) => cellRgba(def, state, frame));
    for (const message of report.failures) fail('G11', message);
    framesMeasured += report.framesMeasured;
    if (report.closestNote === null || report.closestShare === null) continue;
    if (worst === null || report.closestShare < worst.share) {
      worst = { share: report.closestShare, note: report.closestNote };
    }
  }
  failUnlessMeasured('G11', framesMeasured, 'painted frames');
  if (worst !== null) console.log(`  G11 closest frames: ${worst.note}`);
}

/** Runs every gate and returns one message per failure. */
// ── G12 — the gore pieces are telling apart ──────────────────────────────────

const GORE_MASK = 16;
const GORE_INK_ALPHA = 24;
/**
 * How much of its silhouette one gore piece may share with another.
 *
 * Only the Evil Clown comes apart, and he comes apart into ten pieces that all
 * land on the floor at once, so a player reading the pile has nothing but
 * outline to go on. The same 0.62 the Hoarder, the Juicer, the Krakaren and the
 * cockroach hold to; his worst pair is the head against the ruff at 59%.
 *
 * This gate was missing until his gore was measured against theirs, and it
 * found one: the vials' vented gas was painted as a disc centred on the glass,
 * which made the whole piece a disc, and the ruff is a ring — 82% of one
 * outline inside the other, the worst pair in the game by twenty points. The
 * plume rises off the glass now instead of haloing it.
 */
const GORE_IOU_LIMIT = 0.62;

/**
 * A gore piece's silhouette, resampled into a square mask of its own bounding
 * box, so two pieces are compared on shape rather than on where they sit or how
 * big they are — a severed arm and a severed leg of different sizes are still
 * two long thin shapes and still read as one thing in a pile.
 */
function goreMask(def: FigureDef, state: string): boolean[] {
  const pixels = cellRgba(def, state, 0);
  const cell: Cell = { width: def.frameWidth, height: def.frameHeight, data: pixels };
  const mask = new Array<boolean>(GORE_MASK * GORE_MASK).fill(false);
  const box = extentOf(cell, GORE_INK_ALPHA);
  if (box === null) return mask;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY) + 1;
  const originX = (box.minX + box.maxX) / 2 - span / 2;
  const originY = (box.minY + box.maxY) / 2 - span / 2;
  for (let my = 0; my < GORE_MASK; my++) {
    for (let mx = 0; mx < GORE_MASK; mx++) {
      const x = Math.round(originX + ((mx + 0.5) / GORE_MASK) * span);
      const y = Math.round(originY + ((my + 0.5) / GORE_MASK) * span);
      const inside = x >= 0 && y >= 0 && x < cell.width && y < cell.height;
      mask[my * GORE_MASK + mx] = inside && alphaAt(cell, x, y) >= GORE_INK_ALPHA;
    }
  }
  return mask;
}

/** G12 — no two gore pieces tumble as the same blob. */
function gateGoreDistinctness(): void {
  let pairsMeasured = 0;
  let worst = 0;
  let worstPair = '';
  for (const def of CLOWN_FIGURES) {
    const states = goreStatesOf(def);
    const masks = states.map((state) => goreMask(def, state));
    for (let a = 0; a < masks.length; a++) {
      for (let b = a + 1; b < masks.length; b++) {
        pairsMeasured++;
        let intersection = 0;
        let union = 0;
        for (let i = 0; i < masks[a].length; i++) {
          if (masks[a][i] && masks[b][i]) intersection++;
          if (masks[a][i] || masks[b][i]) union++;
        }
        const iou = union === 0 ? 0 : intersection / union;
        if (iou > worst) {
          worst = iou;
          worstPair = `${def.id} ${states[a]} vs ${states[b]}`;
        }
        if (iou <= GORE_IOU_LIMIT) continue;
        fail(
          'G12',
          `${def.id} ${states[a]} and ${states[b]} share ${(iou * PERCENT_SCALE).toFixed(0)}% of ` +
            `their silhouette (limit ${(GORE_IOU_LIMIT * PERCENT_SCALE).toFixed(0)}%) — they ` +
            'tumble as the same blob',
        );
      }
    }
  }
  failUnlessMeasured('G12', pairsMeasured, 'pairs of gore pieces');
  console.log(
    `  G12 gore distinctness: worst ${worstPair} at ${(worst * PERCENT_SCALE).toFixed(1)}% ` +
      `(limit ${(GORE_IOU_LIMIT * PERCENT_SCALE).toFixed(0)}%)`,
  );
}

export function clownGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateWrapperFrameCounts();
  gateRuntimeStateNames();
  gateFeetOnTheGround();
  gateWarmRowSize();
  gateGasCells();
  gateNoOpaqueSmear();
  gateEnrageIsARepaint();
  gateCascadeClearsTheHead();
  gateLoopsTurnOver();
  gateDistinctFrames();
  gateGoreDistinctness();
  return [...failures];
}
