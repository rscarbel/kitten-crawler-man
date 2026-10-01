/**
 * Art gates for GumGum: the living orc on Carl's rig and her corpse.
 *
 * What a typecheck cannot see and these do:
 *
 *   G1  structure — every row of hers, and the corpse, stays inside its cell
 *   G2  the states the sprite wrapper asks for all exist (an unknown state
 *       draws nothing and says nothing)
 *   G3  she is green: the orc read rests on the skin swap reaching the paint
 *   G4  her tusks show — near-white ink in the head band, above the apron
 *   G5  painting her leaves Carl's own cell byte-identical (her skin, garment,
 *       cut and expression are module state swapped in and reset after)
 *   G6  the corpse is in a pool of blood, wet, and is visibly her: blood-red
 *       ink, a specular sheen on it, her green skin and her plum coat
 *   G7  she reads as a woman by her hair: plaits lie down her chest, below the jaw
 *   G8  and by her silhouette: the skirt's hem stands wider than her shoulders
 *
 * Run by `npm run render:gumgum` before it writes any review image.
 */

import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import {
  figureStructuralFailures,
  inkBoxOf,
  type InkBox,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { GUMGUM_FIGURE } from '../src/sprites/art/gumGumFigure.js';
import { GUMGUM_STANDING_STATE, GUMGUM_WALK_STATE } from '../src/sprites/gumGumSprite.js';
import { GUMGUM_CORPSE_FIGURE, GUMGUM_CORPSE_STATE } from '../src/sprites/art/gumGumCorpseArt.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { resetCarlGarmentRamp, resetCarlSkinHairRamp } from '../src/sprites/art/carl/palette.js';
import { resetCarlTorsoCut } from '../src/sprites/art/carl/torso.js';
import { resetCarlExpression } from '../src/sprites/art/carl/head.js';
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

/** Green dominates both other channels by a clear margin: her skin, living or dead. */
const GREEN_MARGIN = 10;
const isGreenSkin: Classifier = ([r, g, b]) => g > r + GREEN_MARGIN && g > b + GREEN_MARGIN;

/** Every channel near white: a tusk. Her eye whites and the apron sit well under this. */
const TUSK_FLOOR = 185;
const isTusk: Classifier = ([r, g, b]) => Math.min(r, g, b) >= TUSK_FLOOR;

/** Red well over twice green and blue: blood, from the deep middle to the film. */
const BLOOD_RED_RATIO = 2;
const BLOOD_MIN_RED = 30;
const isBlood: Classifier = ([r, g, b]) =>
  r >= BLOOD_MIN_RED && r > g * BLOOD_RED_RATIO && r > b * BLOOD_RED_RATIO;

/**
 * The specular streak over blood: the near-white sheen blended over red comes
 * out a pale pink, red leading and green and blue level. The cream apron is the
 * only other pale ink, and its blue falls well under its green.
 */
const SHEEN_MIN_RED = 120;
const SHEEN_RED_LEAD = 15;
const SHEEN_GREEN_BLUE_SPREAD = 10;
const SHEEN_MIN_GREEN = 70;
const isSheen: Classifier = ([r, g, b]) =>
  r >= SHEEN_MIN_RED &&
  r - g >= SHEEN_RED_LEAD &&
  g >= SHEEN_MIN_GREEN &&
  Math.abs(g - b) <= SHEEN_GREEN_BLUE_SPREAD;

/** Her plum coat: red leading, blue over green — no other ink on her runs that way. */
const COAT_MIN_RED = 80;
const COAT_BLUE_LEAD = 10;
const isCoat: Classifier = ([r, g, b]) => r >= COAT_MIN_RED && r > b && b >= g + COAT_BLUE_LEAD;

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
  return [
    ...figureStructuralFailures(GUMGUM_FIGURE).map((f) => `G1 ${f}`),
    ...figureStructuralFailures(GUMGUM_CORPSE_FIGURE).map((f) => `G1 ${f}`),
  ];
}

function stateFailures(): string[] {
  const figure = GUMGUM_FIGURE;
  const names = [GUMGUM_STANDING_STATE, GUMGUM_WALK_STATE];
  return [
    ...missingStateFailures(figure, names, 'drawGumGumSprite').map((f) => `G2 ${f}`),
    ...missingStateFailures(GUMGUM_CORPSE_FIGURE, [GUMGUM_CORPSE_STATE], 'drawGumGumCorpse').map(
      (f) => `G2 ${f}`,
    ),
  ];
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
  const figure = GUMGUM_FIGURE;
  const state = GUMGUM_STANDING_STATE;
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
        `G7 ${state} frame ${frame}: ${plaits} hair pixels on her chest (want ≥ ${MIN_PLAIT_PIXELS}) — ` +
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
        `G8 ${state} frame ${frame}: skirt hem ${hem}px against shoulders ${shoulders}px ` +
          `(want ≥ ${MIN_HEM_OVER_SHOULDER}×) — the silhouette is square, not an A-line`,
      );
    }
  }
  return [...failures, ...nothingMeasuredFailures(measuredFrames, `frames of ${state}`)];
}

// ── G5 ───────────────────────────────────────────────────────────────────────

const CARL_REFERENCE_STATE = 'idle';

/**
 * The reference is painted from Carl's own defaults, restored here first: any
 * earlier bake in this process (another gate, the harness) could already have
 * leaked, and a reference painted in leaked colours makes the comparison pass.
 */
function swapFailures(): string[] {
  resetCarlSkinHairRamp();
  resetCarlGarmentRamp();
  resetCarlTorsoCut();
  resetCarlExpression();
  const before = pixelsOf(HUMAN_FIGURE, CARL_REFERENCE_STATE, 0);
  for (const state of figureStateNames(GUMGUM_FIGURE)) {
    bakeFigureCell(GUMGUM_FIGURE, state, 0);
  }
  const after = pixelsOf(HUMAN_FIGURE, CARL_REFERENCE_STATE, 0);
  if (before.data.length === 0) return ['G5 Carl reference cell is empty'];
  for (let i = 0; i < before.data.length; i++) {
    if (before.data[i] !== after.data[i]) {
      return [`G5 painting GumGum changed Carl's ${CARL_REFERENCE_STATE} cell — a swap leaked`];
    }
  }
  return [];
}

// ── G6 ───────────────────────────────────────────────────────────────────────

/** The pool and the stains together are a real share of the cell's ink, not a trim. */
const MIN_BLOOD_SHARE = 0.25;
const MIN_SHEEN_PIXELS = 30;
/**
 * The pool lies past her shoulders, in the left of the cell; the claw marks'
 * bleed on the apron and the rose patch are the same pale pink as the sheen, so
 * the sheen is only counted where the pool is and the body is not.
 */
const POOL_COLUMN_SHARE = 0.4;

function poolColumnEnd(cell: CellPixels): number {
  return Math.round(cell.width * POOL_COLUMN_SHARE);
}
const MIN_CORPSE_SKIN_PIXELS = 150;
const MIN_CORPSE_COAT_PIXELS = 400;

function corpseFailures(): string[] {
  const cell = pixelsOf(GUMGUM_CORPSE_FIGURE, GUMGUM_CORPSE_STATE, 0);
  const solid = solidPixels(cell);
  const failures = nothingMeasuredFailures(solid, 'solid corpse ink').map((f) => `G6 ${f}`);
  if (solid === 0) return failures;
  const bloodShare = countPixels(cell, isBlood) / solid;
  if (bloodShare < MIN_BLOOD_SHARE) {
    failures.push(
      `G6 blood is ${percent(bloodShare)} of the corpse's ink (want ≥ ${percent(MIN_BLOOD_SHARE)})`,
    );
  }
  const sheen = countPixels(cell, isSheen, 0, cell.height, poolColumnEnd(cell));
  if (sheen < MIN_SHEEN_PIXELS) {
    failures.push(
      `G6 ${sheen} sheen pixels on the pool (want ≥ ${MIN_SHEEN_PIXELS}) — it reads as paint`,
    );
  }
  const skin = countPixels(cell, isGreenSkin);
  if (skin < MIN_CORPSE_SKIN_PIXELS) {
    failures.push(`G6 ${skin} green skin pixels on the body (want ≥ ${MIN_CORPSE_SKIN_PIXELS})`);
  }
  const coat = countPixels(cell, isCoat);
  if (coat < MIN_CORPSE_COAT_PIXELS) {
    failures.push(`G6 ${coat} plum coat pixels on the body (want ≥ ${MIN_CORPSE_COAT_PIXELS})`);
  }
  return failures;
}

/** Every GumGum gate failure, one message each. */
export function gumGumGateFailures(): string[] {
  return [
    ...structureFailures(),
    ...stateFailures(),
    ...livingFailures(),
    ...swapFailures(),
    ...corpseFailures(),
  ];
}
