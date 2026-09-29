#!/usr/bin/env tsx
/**
 * Gates for the town interior prop library (`src/sprites/art/townInterior/`).
 *
 *   npm run gates:town-interior-props
 *   npm run gates:town-interior-props -- --fault=wide-prop   # must fail
 *
 * Checked, for every prop and every one of its variants: ink stays inside
 * the footprint's width and bottom edge (memory: "decoration art must fit
 * its blocked tiles"), with height allowed above — the same frame contract
 * `gates-town-art.ts` already checks for the placeholder and material
 * painters this library is built from.
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();
import { mulberry32 } from '../src/sprites/person/rng.js';
import {
  TOWN_INTERIOR_PROPS,
  isTownInteriorPropId,
  drawTownInteriorProp,
  townInteriorPropSortY,
} from '../src/sprites/art/townInterior/townInteriorProps.js';
import {
  TOWN_TILE_SCALE,
  footprintBox,
  type TownPropFrame,
} from '../src/sprites/art/town/townArt.js';

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);

const failures: string[] = [];
const MAX_FAILURES_SHOWN = 25;
function check(condition: boolean, scope: string, message: string): void {
  if (!condition) failures.push(`${scope}: ${message}`);
}

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const INK_ALPHA_MIN = 24;
const PAD_PX = 48;
/** Headroom above the footprint the sample canvas allows — generous enough for every prop's art height. */
const SAMPLE_HEADROOM_TILES = 4;
/** How far the deliberate fault pushes art past the footprint. */
const FAULT_OVERHANG_PX = 4;

interface InkReport {
  readonly inked: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

function inkReport(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  allowed: { x0: number; x1: number; y1: number },
): InkReport {
  let inked = 0;
  let left = 0;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] <= INK_ALPHA_MIN) continue;
      inked++;
      if (x < allowed.x0) left++;
      else if (x >= allowed.x1) right++;
      else if (y >= allowed.y1) bottom++;
    }
  }
  return { inked, left, right, bottom };
}

function describeOverhang(report: InkReport): string {
  return (['left', 'right', 'bottom'] as const)
    .filter((side) => report[side] > 0)
    .map((side) => `${report[side]} px past its ${side}`)
    .join(', ');
}

let checksRun = 0;

for (const key of Object.keys(TOWN_INTERIOR_PROPS)) {
  if (!isTownInteriorPropId(key)) continue;
  const propId = key;
  const propDef = TOWN_INTERIOR_PROPS[propId];
  for (let variant = 0; variant < propDef.variants; variant++) {
    const width = propDef.footprint.w * TOWN_TILE_SCALE + PAD_PX * 2;
    const height =
      propDef.footprint.h * TOWN_TILE_SCALE + PAD_PX * 2 + SAMPLE_HEADROOM_TILES * TOWN_TILE_SCALE;
    const canvas = createCanvas(width, height);
    const nodeCtx = canvas.getContext('2d');
    const ctx = asGameContext(nodeCtx);
    const frame: TownPropFrame = {
      originX: PAD_PX,
      originY: PAD_PX + SAMPLE_HEADROOM_TILES * TOWN_TILE_SCALE,
      tileScale: TOWN_TILE_SCALE,
      footprintW: propDef.footprint.w,
      footprintH: propDef.footprint.h,
    };
    const rng = mulberry32(variant + 1);
    propDef.paint(ctx, frame, variant, rng);

    const isFaultTarget = fault === 'wide-prop' && propId === 'crate' && variant === 0;
    if (isFaultTarget) {
      const box = footprintBox(frame);
      nodeCtx.fillStyle = '#ff00ff';
      nodeCtx.fillRect(
        box.left - FAULT_OVERHANG_PX,
        box.top,
        FAULT_OVERHANG_PX,
        FAULT_OVERHANG_PX * 2,
      );
    }

    const box = footprintBox(frame);
    const report = inkReport(nodeCtx.getImageData(0, 0, width, height).data, width, height, {
      x0: box.left,
      x1: box.right,
      y1: box.bottom,
    });
    const scope = `${propId} variant ${variant}`;
    check(
      report.left + report.right + report.bottom === 0,
      scope,
      `ink outside its footprint: ${describeOverhang(report)} — past the sides or below the ` +
        'foot is ground a crawler can stand on while drawn behind the prop',
    );
    checksRun++;
  }
}

// ── Footprint anchor agreement ──────────────────────────────────────────────
//
// `(x, y)` in a placed layout entry names the footprint's north-west tile.
// `GameMap.applyTownInteriorLayout`'s blocking loop, `drawTownInteriorProp`
// and `townInteriorPropSortY` all have to read that the same way, or a
// multi-tile prop blocks one row/column, draws in another, and sorts in a
// third. Sort/block agreement is checked for a 2×1 and a 1×2 against the
// documented formula; draw/block agreement is checked in real pixels for a
// 2×1 (`table_medium`, wide) and a 3×2 (`forge`, deep).
const ORIGIN_TILE_Y = 4;
const AGREEMENT_TILE_SIZE = 32;
/** Canvas rows beyond a sampled footprint: the one-tile origin above it plus room below to catch paint that overhangs its foot. */
const AGREEMENT_SLACK_ROWS = 3;

/** The tiles `GameMap.applyTownInteriorLayout`'s blocking loop would mark solid for a footprint placed at the origin above. */
function blockedRows(footprintH: number): number[] {
  const rows: number[] = [];
  for (let dy = 0; dy < footprintH; dy++) rows.push(ORIGIN_TILE_Y + dy);
  return rows;
}

function checkSortAgreesWithBlocking(label: string, footprint: { w: number; h: number }): void {
  const southmostBlockedRow = Math.max(...blockedRows(footprint.h));
  const sortY = townInteriorPropSortY(ORIGIN_TILE_Y, footprint, AGREEMENT_TILE_SIZE);
  const isFaultTarget = fault === 'footprint-anchor';
  // The fault path recreates the pre-fix formula (bottom of the footprint,
  // one row past the southmost blocked row) to prove this check catches it.
  const testedSortY = isFaultTarget ? (ORIGIN_TILE_Y + footprint.h) * AGREEMENT_TILE_SIZE : sortY;
  check(
    testedSortY + AGREEMENT_TILE_SIZE === (southmostBlockedRow + 1) * AGREEMENT_TILE_SIZE,
    `footprint-anchor-agreement (${label})`,
    `townInteriorPropSortY + one tile (${testedSortY + AGREEMENT_TILE_SIZE}) does not land on the ` +
      `southmost blocked row's bottom edge (${(southmostBlockedRow + 1) * AGREEMENT_TILE_SIZE})`,
  );
  checksRun++;
}

checkSortAgreesWithBlocking('2x1 wide', { w: 2, h: 1 });
checkSortAgreesWithBlocking('1x2 tall (geometric replica)', { w: 1, h: 2 });

// The real-pixels half for a wide footprint: `table_medium` paints and
// blocks across two columns of one row.
{
  const wideDef = TOWN_INTERIOR_PROPS.table_medium;
  const width = (wideDef.footprint.w + 2) * AGREEMENT_TILE_SIZE;
  const height = (wideDef.footprint.h + AGREEMENT_SLACK_ROWS) * AGREEMENT_TILE_SIZE;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  drawTownInteriorProp(ctx, 'table_medium', 0, 1, 1, 0, 0, AGREEMENT_TILE_SIZE);
  const southmostBlockedRowBottomPx = (1 + wideDef.footprint.h) * AGREEMENT_TILE_SIZE;
  const pixels = nodeCtx.getImageData(0, 0, width, height).data;
  let inkedBelowFootprint = 0;
  for (let y = southmostBlockedRowBottomPx; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] > INK_ALPHA_MIN) inkedBelowFootprint++;
    }
  }
  check(
    inkedBelowFootprint === 0,
    'footprint-anchor-agreement (2x1 wide, real pixels)',
    `${inkedBelowFootprint}px of table_medium's own paint fall past the row drawTownInteriorProp ` +
      'and the blocking loop agree is its southmost — draw and block have drifted apart',
  );
  checksRun++;
}

// The real-pixels half for a two-row footprint: `forge` blocks two rows, so
// its paint must reach down into the southmost of them and stop at its
// bottom edge. A frame anchored on the north row instead leaves the south
// row bare and draws the whole prop a row north of where it blocks.
{
  const tallDef = TOWN_INTERIOR_PROPS.forge;
  const width = (tallDef.footprint.w + 2) * AGREEMENT_TILE_SIZE;
  const height = (tallDef.footprint.h + AGREEMENT_SLACK_ROWS + 1) * AGREEMENT_TILE_SIZE;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  const originTile = 2;
  drawTownInteriorProp(ctx, 'forge', 0, 1, originTile, 0, 0, AGREEMENT_TILE_SIZE);
  const southmostRowTopPx = (originTile + tallDef.footprint.h - 1) * AGREEMENT_TILE_SIZE;
  const southmostRowBottomPx = southmostRowTopPx + AGREEMENT_TILE_SIZE;
  const pixels = nodeCtx.getImageData(0, 0, width, height).data;
  let inkedInSouthRow = 0;
  let inkedBelowFootprint = 0;
  for (let y = southmostRowTopPx; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] <= INK_ALPHA_MIN) continue;
      if (y < southmostRowBottomPx) inkedInSouthRow++;
      else inkedBelowFootprint++;
    }
  }
  check(
    inkedInSouthRow > 0 && inkedBelowFootprint === 0,
    'footprint-anchor-agreement (3x2 deep, real pixels)',
    `forge painted ${inkedInSouthRow}px in its southmost blocked row and ${inkedBelowFootprint}px ` +
      'below it — a deep prop must fill the row it blocks and stop at its foot',
  );
  checksRun++;
}

check(checksRun > 0, 'ink-inside-footprint', 'no prop checks ran — the gate measured nothing');
check(
  fault !== 'wide-prop' || failures.length > 0,
  'negative test',
  '--fault=wide-prop should have failed the frame contract and did not',
);

if (fault === undefined && failures.length > 0) {
  console.error(`${failures.length} failure(s):`);
  for (const failure of failures.slice(0, MAX_FAILURES_SHOWN)) console.error(`  ${failure}`);
  process.exit(1);
}

if (fault !== undefined) {
  if (failures.length === 0) {
    console.error(`--fault=${fault} did not trigger any failure`);
    process.exit(1);
  }
  console.log(`--fault=${fault} correctly failed (${failures.length} failure(s))`);
  process.exit(0);
}

console.log(`gates-town-interior-props: ${checksRun} prop/variant checks passed`);
