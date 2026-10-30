/**
 * Art gates for Baggi, the orc on the biped rig.
 *
 * What a typecheck cannot see and these do:
 *
 *   G1  structure — every row of hers stays inside its cell
 *   G2  the states the sprite wrapper asks for all exist (an unknown state
 *       draws nothing and says nothing)
 *   G3  she is green: the orc read rests on the skin swap reaching the paint
 *   G4  her tusks show — near-white ink in the head band, above the apron
 *   G5  baking frame 0 of every one of her rows leaves the human's idle frame 0
 *       byte-identical to a bake of it taken before hers
 *   G6  she reads as a woman by her hair: plaits lie down her chest, below the jaw
 *   G7  and by her silhouette: the skirt's hem stands wider than her shoulders
 *
 * Run by `npm run render:baggi` before it writes any review image.
 */

import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import {
  figureStructuralFailures,
  inkBoxOf,
  type InkBox,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { BAGGI_FIGURE, baggiStateName } from '../src/sprites/art/baggiFigure.js';
import { BAGGI_DRAWN_STATES } from '../src/sprites/baggiSprite.js';
import { undressedHumanFigure } from '../src/sprites/art/humanFigure.js';
import { activeHumanLook } from '../src/sprites/humanSprite.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const RGBA_STRIDE = 4;
const PERCENT = 100;
const PERCENT_DECIMALS = 1;

function percent(share: number): string {
  return `${(share * PERCENT).toFixed(PERCENT_DECIMALS)}%`;
}
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** A pixel counts as ink only when it is nearly opaque, so antialiased fringes are not classified by colour. */
const SOLID_ALPHA = 200;

type Pixel = readonly [number, number, number];
type Classifier = (pixel: Pixel) => boolean;

interface CellPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function pixelsOf(def: FigureDef, state: string, frame: number): CellPixels {
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
  return { width: cell.width, height: cell.height, data };
}

/** Solid pixels matching `matches` within rows `[fromRow, toRow)` and columns `[0, toColumn)`. */
function countPixels(
  cell: CellPixels,
  matches: Classifier,
  fromRow = 0,
  toRow = cell.height,
  toColumn = cell.width,
): number {
  let count = 0;
  for (let y = Math.max(0, fromRow); y < Math.min(cell.height, toRow); y++) {
    for (let x = 0; x < Math.min(cell.width, toColumn); x++) {
      const i = (y * cell.width + x) * RGBA_STRIDE;
      if (cell.data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      const pixel: Pixel = [cell.data[i], cell.data[i + GREEN_OFFSET], cell.data[i + BLUE_OFFSET]];
      if (matches(pixel)) count++;
    }
  }
  return count;
}

function solidPixels(cell: CellPixels): number {
  return countPixels(cell, () => true);
}

// ── Colour classes ───────────────────────────────────────────────────────────

/** Green dominates both other channels by a clear margin: her skin. */
const GREEN_MARGIN = 10;
const isGreenSkin: Classifier = ([r, g, b]) => g > r + GREEN_MARGIN && g > b + GREEN_MARGIN;

/** Every channel near white: a tusk. Her eye whites and the apron sit well under this. */
const TUSK_FLOOR = 185;
const isTusk: Classifier = ([r, g, b]) => Math.min(r, g, b) >= TUSK_FLOOR;

/**
 * Her hair: a dark warm brown, red over green over blue. The plum dress runs
 * blue over green, the apron is pale and the skin is green, so on her chest only
 * the plaits are this colour.
 */
const HAIR_MAX_RED = 140;
const HAIR_MIN_WARMTH = 20;
const isHair: Classifier = ([r, g, b]) =>
  r <= HAIR_MAX_RED && r > g && g > b && r - b >= HAIR_MIN_WARMTH;

// ── G1, G2 ───────────────────────────────────────────────────────────────────

function structureFailures(): string[] {
  return figureStructuralFailures(BAGGI_FIGURE).map((f) => `G1 ${f}`);
}

function stateFailures(): string[] {
  return missingStateFailures(BAGGI_FIGURE, BAGGI_DRAWN_STATES, 'drawBaggiSprite').map(
    (f) => `G2 ${f}`,
  );
}

// ── G3, G4 ───────────────────────────────────────────────────────────────────

/** At least this share of her standing ink is green skin: face, hands and shins. */
const MIN_GREEN_SHARE = 0.05;
/** The head band: the top of her ink (the bun) down this share of her height, which ends at her shoulders. */
const HEAD_BAND_SHARE = 0.27;
/** Small tusks: a pixel of ivory each at the baked size. */
const MIN_TUSK_PIXELS = 2;
/**
 * The chest band, as shares of her height down from the top of her ink: under
 * the shoulders and above the waist, where the plaits lie over the bodice.
 */
const CHEST_BAND_FROM = 0.3;
const CHEST_BAND_TO = 0.48;
/** Two plaits down the chest, each a column of several pixels. */
const MIN_PLAIT_PIXELS = 35;
/**
 * The shoulder band and the hem band, as shares of her height: the widest ink
 * in each. A woman's dress here is an A-line — the hem has to stand clear of
 * the shoulders, or the silhouette is a man's square coat.
 */
const SHOULDER_BAND_FROM = 0.28;
const SHOULDER_BAND_TO = 0.4;
const HEM_BAND_FROM = 0.7;
const HEM_BAND_TO = 0.83;
const MIN_HEM_OVER_SHOULDER = 1.08;

function bandRow(box: InkBox, share: number): number {
  return box.minY + Math.round((box.maxY - box.minY) * share);
}

/** The widest run of solid ink, left edge to right edge, over rows `[fromRow, toRow)`. */
function widestInk(cell: CellPixels, fromRow: number, toRow: number): number {
  let widest = 0;
  for (let y = fromRow; y < toRow; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < cell.width; x++) {
      if (cell.data[(y * cell.width + x) * RGBA_STRIDE + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) widest = Math.max(widest, right - left + 1);
  }
  return widest;
}

function livingFailures(): string[] {
  const figure = BAGGI_FIGURE;
  const state = baggiStateName('idle', 'front');
  const failures: string[] = [];
  let measuredFrames = 0;
  for (let frame = 0; frame < frameCountOf(figure, state); frame++) {
    const box = inkBoxOf(figure, state, frame);
    if (box === null) {
      failures.push(`G3 ${state} frame ${frame} paints nothing`);
      continue;
    }
    measuredFrames++;
    const cell = pixelsOf(figure, state, frame);
    const greenShare = countPixels(cell, isGreenSkin) / Math.max(1, solidPixels(cell));
    if (greenShare < MIN_GREEN_SHARE) {
      failures.push(
        `G3 ${state} frame ${frame}: only ${percent(greenShare)} of her ink is green ` +
          `(want ≥ ${percent(MIN_GREEN_SHARE)}) — the orc skin is not reaching the paint`,
      );
    }
    const headBandEnd = bandRow(box, HEAD_BAND_SHARE);
    const tusks = countPixels(cell, isTusk, box.minY, headBandEnd);
    if (tusks < MIN_TUSK_PIXELS) {
      failures.push(
        `G4 ${state} frame ${frame}: ${tusks} tusk pixels in the head band (want ≥ ${MIN_TUSK_PIXELS})`,
      );
    }
    const plaits = countPixels(
      cell,
      isHair,
      bandRow(box, CHEST_BAND_FROM),
      bandRow(box, CHEST_BAND_TO),
    );
    if (plaits < MIN_PLAIT_PIXELS) {
      failures.push(
        `G6 ${state} frame ${frame}: ${plaits} hair pixels on her chest (want ≥ ${MIN_PLAIT_PIXELS}) — ` +
          'the plaits are not reaching below the jaw',
      );
    }
    const shoulders = widestInk(
      cell,
      bandRow(box, SHOULDER_BAND_FROM),
      bandRow(box, SHOULDER_BAND_TO),
    );
    const hem = widestInk(cell, bandRow(box, HEM_BAND_FROM), bandRow(box, HEM_BAND_TO));
    if (hem < shoulders * MIN_HEM_OVER_SHOULDER) {
      failures.push(
        `G7 ${state} frame ${frame}: skirt hem ${hem}px against shoulders ${shoulders}px ` +
          `(want ≥ ${MIN_HEM_OVER_SHOULDER}×) — the silhouette is square, not an A-line`,
      );
    }
  }
  return [...failures, ...nothingMeasuredFailures(measuredFrames, `frames of ${state}`)];
}

// ── G5 ───────────────────────────────────────────────────────────────────────

const HUMAN_REFERENCE_STATE = 'idle';

/**
 * Painting Baggi on the biped rig leaves the human's own cells as they were: her
 * look reaches the rig only through the options her bake passes.
 */
function lookIsolationFailures(): string[] {
  const before = pixelsOf(undressedHumanFigure(activeHumanLook()), HUMAN_REFERENCE_STATE, 0);
  for (const state of figureStateNames(BAGGI_FIGURE)) {
    bakeFigureCell(BAGGI_FIGURE, state, 0);
  }
  const after = pixelsOf(undressedHumanFigure(activeHumanLook()), HUMAN_REFERENCE_STATE, 0);
  if (before.data.length === 0) return ['G5 the human reference cell is empty'];
  for (let i = 0; i < before.data.length; i++) {
    if (before.data[i] !== after.data[i]) {
      return [
        `G5 painting Baggi changed the human's ${HUMAN_REFERENCE_STATE} cell — her look reached his`,
      ];
    }
  }
  return [];
}

/** Every Baggi gate failure, one message each. */
export function baggiGateFailures(): string[] {
  return [
    ...structureFailures(),
    ...stateFailures(),
    ...livingFailures(),
    ...lookIsolationFailures(),
  ];
}
