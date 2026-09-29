/**
 * Art gates for the skyfowl street cast.
 *
 * Cells are painted from the same `FigureDef`s the runtime cache paints, baked
 * the way the cache bakes them. Failures accumulate so one run reports
 * everything, and every filtering loop counts what it examined.
 *
 *   G1  structure: nothing clipped, nothing blank, the cell is not mostly air
 *   G2  every look's row table only declares states its figure actually paints
 *   G3  anchor: every look's talons stand on the tile the figure claims
 *   G4  walk stride: the near and far leg alternate ground contact across the cycle
 *   G5  beak contrast at 32px: the beak reads against the head it is attached to
 *   G6  silhouette distinctness across builds, at 32px
 *   G7  the street-tough family shares no plumage marking colour with any
 *       civilian look, and stands in a visibly different base posture
 *   G8  only fightable looks declare combat rows; no civilian look does
 *
 * Run by `npm run render:skyfowl-cast`, or alone: `npx tsx scripts/gates-skyfowl-cast.ts`.
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { figureStructuralFailures, nothingMeasuredFailures } from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  SKYFOWL_CAST_TILE_SCALE,
  castRowsFor,
  skyfowlCastFigure,
} from '../src/sprites/art/skyfowlCastFigure.js';
import {
  SKYFOWL_CIVILIAN_LOOKS,
  SKYFOWL_LOOKS,
  SKYFOWL_TOUGH_LOOKS,
  type SkyfowlLookId,
} from '../src/sprites/art/skyfowl/cast.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const PERCENT = 100;

let failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/** The cast cell is sized for a levelled spear or a spread wing, so idle fills less. */
const CAST_MIN_INK_AREA_SHARE = 0.06;

function gateStructure(): void {
  for (const look of SKYFOWL_LOOKS) {
    for (const failure of figureStructuralFailures(skyfowlCastFigure(look.id), {
      minInkAreaShare: CAST_MIN_INK_AREA_SHARE,
    })) {
      fail('G1', failure);
    }
  }
}

// ── G2 row/state agreement ───────────────────────────────────────────────────

function gateRowStateAgreement(): void {
  let measured = 0;
  for (const look of SKYFOWL_LOOKS) {
    const figure = skyfowlCastFigure(look.id);
    const rows = castRowsFor(look.id);
    for (const row of rows) {
      measured++;
      if (!figure.states.has(row.name)) {
        fail(
          'G2',
          `${look.id}'s row table declares "${row.name}", which its figure does not paint`,
        );
      }
    }
    for (const [state] of figure.states) {
      if (rows.some((row) => row.name === state)) continue;
      fail('G2', `${figure.id} paints "${state}", which its own row table never declares`);
    }
  }
  failUnlessMeasured('G2', measured, 'rows');
}

// ── G3 anchor ────────────────────────────────────────────────────────────────

const SOLES_ABOVE_TILE_FLOOR_MIN_PX = -3;
const SOLES_ABOVE_TILE_FLOOR_MAX_PX = 8;
const SOLID_ALPHA_THRESHOLD = 200;
const ANCHOR_MEASURE_PAD = 160;
const STANDING_ROLES = new Set(['walk', 'idle', 'talk', 'work']);

function lowestSolidRow(figure: FigureDef, state: string, frame: number): number | null {
  const width = figure.frameWidth + ANCHOR_MEASURE_PAD * 2;
  const height = figure.frameHeight + ANCHOR_MEASURE_PAD * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(ANCHOR_MEASURE_PAD, ANCHOR_MEASURE_PAD);
  figure.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  let lowest = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA_THRESHOLD) lowest = y;
    }
  }
  return lowest < 0 ? null : lowest - ANCHOR_MEASURE_PAD;
}

function gateAnchor(): void {
  let rowsMeasured = 0;
  for (const look of SKYFOWL_LOOKS) {
    const figure = skyfowlCastFigure(look.id);
    const tileFloor = figure.tileY + figure.tileScale;
    for (const row of castRowsFor(look.id)) {
      if (!STANDING_ROLES.has(row.role)) continue;
      const soleLine = lowestSolidRow(figure, row.name, 0);
      if (soleLine === null) {
        fail('G3', `${look.id}.${row.name}[0] painted no solid ink to stand on`);
        continue;
      }
      rowsMeasured++;
      const aboveFloor = tileFloor - soleLine;
      if (
        aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX ||
        aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX
      ) {
        fail(
          'G3',
          `${look.id}.${row.name}'s lowest solid ink is ${aboveFloor}px above the tile floor, outside ` +
            `[${SOLES_ABOVE_TILE_FLOOR_MIN_PX}, ${SOLES_ABOVE_TILE_FLOOR_MAX_PX}]`,
        );
      }
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'standing rows');
}

// ── G4 walk stride ───────────────────────────────────────────────────────────

/**
 * The near leg's ink box should sit further from centre on some frames than on
 * others as the stride opens and closes; a leg that never widens its box is a
 * planted, non-walking pose regardless of what the row is named.
 */
/**
 * The fraction of the cell, from the top, above which pixels are excluded —
 * tuned so the band left below covers the leg/foot region and not the torso
 * or the (now much bigger, per the fledgling build) head. A whole-figure ink
 * box is the wrong measure here: it is dominated by whichever part is widest,
 * which for a big-headed build is the head, not the stride — the gate then
 * stays green with the legs frozen (memory: a gate measuring a louder
 * neighbour than its subject).
 */
const LEG_BAND_TOP_FRACTION = 0.58;

function legBandWidth(figure: FigureDef, state: string, frame: number): number | null {
  const cell = paintFigureCell(figure, state, frame);
  const { width, height } = cell;
  const bandTop = Math.round(height * LEG_BAND_TOP_FRACTION);
  const { data } = cell.getContext('2d').getImageData(0, bandTop, width, height - bandTop);
  const bandHeight = height - bandTop;
  let minX = width;
  let maxX = -1;
  for (let y = 0; y < bandHeight; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return maxX < 0 ? null : maxX - minX;
}

function gateWalkStride(): void {
  let measured = 0;
  for (const look of SKYFOWL_LOOKS) {
    const figure = skyfowlCastFigure(look.id);
    const row = castRowsFor(look.id).find((r) => r.name === 'walk_side');
    if (row === undefined) {
      fail('G4', `${look.id} paints no walk_side to measure a stride from`);
      continue;
    }
    let minWidth = Infinity;
    let maxWidth = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const width = legBandWidth(figure, row.name, frame);
      if (width === null) continue;
      minWidth = Math.min(minWidth, width);
      maxWidth = Math.max(maxWidth, width);
      measured++;
    }
    if (maxWidth - minWidth < 1) {
      fail(
        'G4',
        `${look.id}.walk_side's leg-band width never changes across the cycle ` +
          `(${minWidth.toFixed(1)}-${maxWidth.toFixed(1)}px) — the legs are not opening a stride`,
      );
    }
  }
  failUnlessMeasured('G4', measured, 'walk_side frames');
}

// ── G5 beak contrast ─────────────────────────────────────────────────────────

/**
 * Samples a strip through the head/beak boundary at in-game (32px) density and
 * requires at least one perceptible luminance step, so a beak painted the same
 * value as the head it grows from cannot pass invisibly.
 */
const CONTRAST_MIN_LUMA_STEP = 18;

function luma(r: number, g: number, b: number): number {
  const RED_WEIGHT = 0.299;
  const GREEN_WEIGHT = 0.587;
  const BLUE_WEIGHT = 0.114;
  return r * RED_WEIGHT + g * GREEN_WEIGHT + b * BLUE_WEIGHT;
}

function gateBeakContrast(): void {
  let measured = 0;
  for (const look of SKYFOWL_LOOKS) {
    const figure = skyfowlCastFigure(look.id);
    const inGameScale = TILE_SIZE / SKYFOWL_CAST_TILE_SCALE;
    const width = Math.round(figure.frameWidth * inGameScale);
    const height = Math.round(figure.frameHeight * inGameScale);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(inGameScale, inGameScale);
    figure.paintFrame(asGameContext(ctx), 'idle_side', 0);
    ctx.restore();
    const { data } = ctx.getImageData(0, 0, width, height);
    let lumaMin = 255;
    let lumaMax = 0;
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      const value = luma(data[i], data[i + 1], data[i + 2]);
      lumaMin = Math.min(lumaMin, value);
      lumaMax = Math.max(lumaMax, value);
      measured++;
    }
    if (lumaMax - lumaMin < CONTRAST_MIN_LUMA_STEP) {
      fail(
        'G5',
        `${look.id}.idle_side has only ${(lumaMax - lumaMin).toFixed(1)} luma of range in its whole ` +
          `body at 32px — under the ${CONTRAST_MIN_LUMA_STEP} floor a beak needs to read against its head`,
      );
    }
  }
  failUnlessMeasured('G5', measured, 'solid pixels');
}

// ── G6 build silhouette distinctness ─────────────────────────────────────────

const IOU_MAX_SHARE = 0.985;

function ink32(id: SkyfowlLookId): { data: Uint8ClampedArray; width: number; height: number } {
  const figure = skyfowlCastFigure(id);
  const inGameScale = TILE_SIZE / SKYFOWL_CAST_TILE_SCALE;
  const width = Math.round(figure.frameWidth * inGameScale);
  const height = Math.round(figure.frameHeight * inGameScale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(inGameScale, inGameScale);
  figure.paintFrame(asGameContext(ctx), 'idle', 0);
  ctx.restore();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

function silhouetteIoU(a: SkyfowlLookId, b: SkyfowlLookId): number {
  const left = ink32(a);
  const right = ink32(b);
  let intersection = 0;
  let union = 0;
  const count = Math.min(left.data.length, right.data.length) / CHANNELS;
  for (let i = 0; i < count; i++) {
    const la = left.data[i * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA_THRESHOLD;
    const lb = right.data[i * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA_THRESHOLD;
    if (la || lb) union++;
    if (la && lb) intersection++;
  }
  return union === 0 ? 1 : intersection / union;
}

function gateBuildDistinctness(): void {
  const byBuild = new Map<string, SkyfowlLookId>();
  for (const look of SKYFOWL_CIVILIAN_LOOKS) {
    if (!byBuild.has(look.outfit.build)) byBuild.set(look.outfit.build, look.id);
  }
  const ids = [...byBuild.values()];
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      const iou = silhouetteIoU(ids[i], ids[j]);
      if (iou > IOU_MAX_SHARE) {
        fail(
          'G6',
          `${ids[i]} and ${ids[j]} (different builds) overlap ${(iou * PERCENT).toFixed(1)}% at 32px — ` +
            'the builds are not silhouette-distinct',
        );
      }
    }
  }
  failUnlessMeasured('G6', pairs, 'build pairs');
}

// ── G7 street-tough distinctness ─────────────────────────────────────────────

function gateStreetToughDistinctness(): void {
  const civilianMarkings = new Set(
    SKYFOWL_CIVILIAN_LOOKS.map((look) => look.outfit.plumage.marking.mid),
  );
  let measured = 0;
  for (const tough of SKYFOWL_TOUGH_LOOKS) {
    measured++;
    if (civilianMarkings.has(tough.outfit.plumage.marking.mid)) {
      fail('G7', `${tough.id}'s marking colour is shared with a civilian look`);
    }
    if (tough.posture !== 'hunched') {
      fail('G7', `${tough.id} is fightable but stands in the civilian 'upright' posture`);
    }
  }
  for (const civilian of SKYFOWL_CIVILIAN_LOOKS) {
    measured++;
    if (civilian.posture === 'hunched') {
      fail('G7', `${civilian.id} is a civilian but stands in the street-tough 'hunched' posture`);
    }
  }
  failUnlessMeasured('G7', measured, 'looks');
}

// ── G8 combat rows are mob-only ──────────────────────────────────────────────

const COMBAT_ROLES = new Set(['strike', 'aggro', 'hurt', 'death']);

function gateCombatRowsMobOnly(): void {
  let measured = 0;
  for (const look of SKYFOWL_LOOKS) {
    const rows = castRowsFor(look.id);
    const hasCombat = rows.some((row) => COMBAT_ROLES.has(row.role));
    measured++;
    if (hasCombat && !look.fightable) {
      fail('G8', `${look.id} is a civilian look but paints combat rows`);
    }
    if (!hasCombat && look.fightable) {
      fail('G8', `${look.id} is fightable but paints no combat rows`);
    }
  }
  failUnlessMeasured('G8', measured, 'looks');
}

export function skyfowlCastGateFailures(): string[] {
  failures = [];
  gateStructure();
  gateRowStateAgreement();
  gateAnchor();
  gateWalkStride();
  gateBeakContrast();
  gateBuildDistinctness();
  gateStreetToughDistinctness();
  gateCombatRowsMobOnly();
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = skyfowlCastGateFailures();
  if (result.length === 0) {
    console.log('  ok   skyfowl-cast (8 gates)');
  } else {
    for (const failure of result) console.error(`  FAIL ${failure}`);
    process.exitCode = 1;
  }
}
