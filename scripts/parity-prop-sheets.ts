#!/usr/bin/env tsx
/**
 * Proves the runtime painters reproduce a sheet they replaced, pixel for pixel.
 *
 * The one check that says a conversion from a baked PNG to a runtime painter
 * changed nothing. A contact sheet shows that the art still looks right; this
 * shows that it *is* the same art, which is the claim worth making while the
 * PNGs are still recoverable from git:
 *
 *   git show HEAD:src/images/environment/<family>/<sheet>.png > ref/<sheet>.png
 *   npm run parity:props -- --family=<name> --ref=ref
 *
 * Run: npm run parity:props -- --family=trees --ref=<directory of reference PNGs>
 *
 * A reference sheet the directory does not hold is reported and skipped, so a
 * family can be checked before every one of its sheets has been snapshotted.
 */

import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropSheet } from './propSheetBake.js';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';
import { townscapeSheetPlans } from '../src/sprites/sheets/townscapeSheets.js';
import { overCitySheetPlans } from '../src/sprites/sheets/overCitySheets.js';
import { treeSheetPlans } from '../src/sprites/sheets/treeSheets.js';
import { rockSheetPlans } from '../src/sprites/sheets/rockSheets.js';
import { campSheetPlans } from '../src/sprites/sheets/campSheets.js';
import { destructiblePropSheetPlans } from '../src/sprites/sheets/destructiblePropSheets.js';
import { clubFurnitureSheetPlans } from '../src/sprites/sheets/clubFurnitureSheets.js';

/**
 * Every family paints at an art seed term of zero — the look each variant's own
 * literal seed gives, which is the art the reference sheets were baked from.
 */
const UNVARIED = 0;

/**
 * Differences a sheet is allowed to have against the art it replaced, and why.
 *
 * A parity check that ships permanently red is a check the next person waives,
 * so a known and understood difference is written down as a budget rather than
 * left as a failure. The budget is a *ceiling*: it goes red the moment the
 * difference grows, which is the property worth keeping.
 */
interface ParityBudget {
  readonly shapeDiffs: number;
  readonly worstAlpha: number;
  readonly colorDiffs: number;
  readonly worstColor: number;
  readonly because: string;
}

const PARITY_BUDGETS: Readonly<Record<string, ParityBudget>> = {
  brazier: {
    shapeDiffs: 2200,
    worstAlpha: 8,
    colorDiffs: 1400,
    worstColor: 24,
    because:
      'the ember glow is wider than its own cell, so the sheet this replaced — composited ' +
      "without clipping — carried a sliver of the *next* phase's glow in every frame. The game " +
      'draws one frame at a time, so that sliver was foreign light. Clipping each frame to its ' +
      'own cell removes it: a three-percent halo, invisible at any size',
  },
};

const FAMILIES: Readonly<Record<string, () => PropSheetPlan[]>> = {
  townscape: townscapeSheetPlans,
  over_city: overCitySheetPlans,
  trees: () => treeSheetPlans(UNVARIED),
  rocks: () => rockSheetPlans(UNVARIED),
  camps: () => campSheetPlans(UNVARIED),
  props: () => destructiblePropSheetPlans(UNVARIED),
  club: () => clubFurnitureSheetPlans(UNVARIED),
};

/**
 * Alpha above which a pixel's colour is worth comparing.
 *
 * A fully transparent pixel's red, green and blue are arbitrary — nothing reads
 * them — so a raw channel comparison reports a difference of 255 wherever one
 * side happened to leave a colour behind under zero alpha. Comparing shape
 * exactly and colour only where something is drawn is what makes the number
 * mean "the picture changed".
 */
const VISIBLE_ALPHA = 8;

interface PixelDelta {
  /** Pixels whose opacity differs at all, and by how much at worst. */
  readonly shapeDiffs: number;
  readonly worstAlpha: number;
  /** Pixels that are drawn on either side and whose colour differs. */
  readonly colorDiffs: number;
  readonly worstColor: number;
}

function comparePixels(wanted: Uint8ClampedArray, got: Uint8ClampedArray): PixelDelta {
  const CHANNELS_PER_PIXEL = 4;
  const ALPHA_OFFSET = 3;
  let shapeDiffs = 0;
  let worstAlpha = 0;
  let colorDiffs = 0;
  let worstColor = 0;
  for (let index = 0; index < wanted.length; index += CHANNELS_PER_PIXEL) {
    const alphaDelta = Math.abs(wanted[index + ALPHA_OFFSET] - got[index + ALPHA_OFFSET]);
    if (alphaDelta > 0) {
      shapeDiffs++;
      worstAlpha = Math.max(worstAlpha, alphaDelta);
    }
    const drawn = Math.max(wanted[index + ALPHA_OFFSET], got[index + ALPHA_OFFSET]);
    if (drawn <= VISIBLE_ALPHA) continue;
    const colorDelta = Math.max(
      Math.abs(wanted[index] - got[index]),
      Math.abs(wanted[index + 1] - got[index + 1]),
      Math.abs(wanted[index + 2] - got[index + 2]),
    );
    if (colorDelta > 0) {
      colorDiffs++;
      worstColor = Math.max(worstColor, colorDelta);
    }
  }
  return { shapeDiffs, worstAlpha, colorDiffs, worstColor };
}

function describeDelta(delta: PixelDelta): string {
  return (
    `${delta.shapeDiffs} px differ in shape (worst ${delta.worstAlpha}/255) and ` +
    `${delta.colorDiffs} in colour where drawn (worst ${delta.worstColor}/255)`
  );
}

function stringArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match === undefined ? undefined : match.slice(prefix.length);
}

const referenceDir = stringArg('ref');
if (referenceDir === undefined) {
  throw new Error('--ref=<directory of reference PNGs> is required');
}
const familyName = stringArg('family');
const families =
  familyName === undefined
    ? Object.keys(FAMILIES)
    : Object.keys(FAMILIES).filter((name) => name === familyName);
if (families.length === 0) {
  throw new Error(`--family must be one of ${Object.keys(FAMILIES).join(', ')}`);
}

await loadGameSpritesInNode();

function withinBudget(delta: PixelDelta, budget: ParityBudget): boolean {
  return (
    delta.shapeDiffs <= budget.shapeDiffs &&
    delta.worstAlpha <= budget.worstAlpha &&
    delta.colorDiffs <= budget.colorDiffs &&
    delta.worstColor <= budget.worstColor
  );
}

let compared = 0;
let skipped = 0;
let budgeted = 0;
const mismatches: string[] = [];

for (const name of families) {
  for (const plan of FAMILIES[name]()) {
    const referencePath = resolve(referenceDir, plan.file);
    if (!existsSync(referencePath)) {
      skipped++;
      console.log(`skip ${plan.key}: no reference sheet at ${plan.file}`);
      continue;
    }
    const reference = await loadImage(referencePath);
    const baked = bakePropSheet(plan);
    if (reference.width !== baked.canvas.width || reference.height !== baked.canvas.height) {
      mismatches.push(
        `${plan.key}: reference is ${reference.width}x${reference.height}, ` +
          `the painter makes ${baked.canvas.width}x${baked.canvas.height}`,
      );
      continue;
    }
    const canvas = createCanvas(reference.width, reference.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(reference, 0, 0);
    const delta = comparePixels(
      ctx.getImageData(0, 0, reference.width, reference.height).data,
      baked.pixels.data,
    );
    compared++;
    const budget = PARITY_BUDGETS[plan.key];
    if (budget === undefined) {
      if (delta.shapeDiffs > 0 || delta.colorDiffs > 0) {
        mismatches.push(`${plan.key}: ${describeDelta(delta)}`);
      }
    } else if (withinBudget(delta, budget)) {
      budgeted++;
      console.log(`  known  ${plan.key}: ${describeDelta(delta)} — ${budget.because}`);
    } else {
      mismatches.push(
        `${plan.key}: ${describeDelta(delta)}, past its known budget of ` +
          `${budget.shapeDiffs} px / ${budget.worstAlpha} alpha / ${budget.colorDiffs} px / ` +
          `${budget.worstColor} colour`,
      );
    }
  }
}

console.log(
  `\n[parity:props] ${compared} sheet(s) compared, ${skipped} skipped, ` +
    `${budgeted} within a known budget`,
);
if (compared === 0) {
  console.error('[parity:props] FAIL: nothing was compared, so this proves nothing');
  process.exit(1);
}
if (mismatches.length > 0) {
  console.error(`[parity:props] FAIL — ${mismatches.length} sheet(s) differ`);
  for (const mismatch of mismatches) console.error(`  ${mismatch}`);
  process.exit(1);
}
console.log('[parity:props] OK — every painter reproduces the sheet it replaced');
