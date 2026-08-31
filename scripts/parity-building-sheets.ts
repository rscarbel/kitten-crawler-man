#!/usr/bin/env tsx
/**
 * Proves the runtime facade painter reproduces the sheets it replaced, cell for
 * cell.
 *
 * Not sheet for sheet: the painted sheet lays its idle frame beside its life row
 * on one line where the baked one used two, so the two images are different
 * shapes carrying identical pictures. What is compared is therefore each frame
 * at the position the manifest says it now occupies, against the position the
 * old two-row manifest said it used to.
 *
 * Run: npm run parity:buildings -- --ref=<directory of the replaced PNGs>
 */

import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asNodeCanvas } from './nodeGameContext.js';
import {
  paintEnvironmentArtNow,
  flushEnvironmentArtCache,
} from '../src/map/environmentArtCache.js';
import { getManifestKeys, getManifestEntry, getSpriteDefByKey } from '../src/core/SpriteLoader.js';
import { requestBuildingSheets } from '../src/sprites/buildinggen/runtimeBuildingSheets.js';
import { BUILDING_SPECS } from '../src/sprites/buildinggen/buildings.js';
import { frameHeightPx, frameWidthPx } from '../src/sprites/buildinggen/spec.js';

/** The seed term at which a facade paints the art its literal seed alone gave. */
const UNVARIED = 0;
/** The row the life frames sat on in the two-row sheets being compared against. */
const REPLACED_LIFE_ROW = 1;

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
  throw new Error('--ref=<directory of the replaced PNGs> is required');
}

await loadGameSpritesInNode();
flushEnvironmentArtCache();
requestBuildingSheets(UNVARIED);
paintEnvironmentArtNow();

interface Cell {
  readonly label: string;
  /** Column and row in the sheet that is being compared. */
  readonly column: number;
  readonly row: number;
}

let compared = 0;
let skipped = 0;
const mismatches: string[] = [];

for (const spec of BUILDING_SPECS) {
  const referencePath = resolve(referenceDir, spec.file);
  if (!existsSync(referencePath)) {
    skipped++;
    console.log(`skip ${spec.key}: no reference sheet at ${spec.file}`);
    continue;
  }
  const def = getSpriteDefByKey(spec.key);
  if (def === undefined) {
    mismatches.push(`${spec.key}: the painter published no sheet`);
    continue;
  }
  const key = getManifestKeys().find((candidate) => candidate === spec.key);
  if (key === undefined) {
    mismatches.push(`${spec.key}: names no manifest entry`);
    continue;
  }
  const entry = getManifestEntry(key);
  const lifeState = entry.states.life;
  const painted: Cell[] = [
    { label: 'idle', column: entry.states.idle.colOffset ?? 0, row: entry.states.idle.row },
    ...Array.from({ length: lifeState.frameCount }, (_unused, step) => ({
      label: `life ${step}`,
      column: (lifeState.colOffset ?? 0) + step,
      row: lifeState.row,
    })),
  ];
  const replaced: Cell[] = [
    { label: 'idle', column: 0, row: 0 },
    ...Array.from({ length: lifeState.frameCount }, (_unused, step) => ({
      label: `life ${step}`,
      column: step,
      row: REPLACED_LIFE_ROW,
    })),
  ];

  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  const reference = await loadImage(referencePath);
  const cell = createCanvas(frameWidth, frameHeight);
  const cellCtx = cell.getContext('2d');
  // A painted sheet is always a surface, never an `HTMLImageElement`: nothing
  // fetched it. Narrowed rather than asserted, so a building that quietly went
  // back to being a file fails here instead of being compared against itself.
  const paintedSheet = def.img;
  if (!('getContext' in paintedSheet)) {
    mismatches.push(`${spec.key}: was loaded from a file rather than painted`);
    continue;
  }
  const paintedCanvas = createCanvas(paintedSheet.width, paintedSheet.height);
  const paintedCtx = paintedCanvas.getContext('2d');
  paintedCtx.drawImage(asNodeCanvas(paintedSheet), 0, 0);

  painted.forEach((paintedCell, index) => {
    const replacedCell = replaced[index];
    cellCtx.clearRect(0, 0, frameWidth, frameHeight);
    cellCtx.drawImage(
      reference,
      replacedCell.column * frameWidth,
      replacedCell.row * frameHeight,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight,
    );
    const delta = comparePixels(
      cellCtx.getImageData(0, 0, frameWidth, frameHeight).data,
      paintedCtx.getImageData(
        paintedCell.column * frameWidth,
        paintedCell.row * frameHeight,
        frameWidth,
        frameHeight,
      ).data,
    );
    compared++;
    if (delta.shapeDiffs > 0 || delta.colorDiffs > 0) {
      mismatches.push(`${spec.key} ${paintedCell.label}: ${describeDelta(delta)}`);
    }
  });
}

console.log(`\n[parity:buildings] ${compared} cell(s) compared, ${skipped} sheet(s) skipped`);
if (compared === 0) {
  console.error('[parity:buildings] FAIL: nothing was compared, so this proves nothing');
  process.exit(1);
}
if (mismatches.length > 0) {
  console.error(`[parity:buildings] FAIL — ${mismatches.length} cell(s) differ`);
  for (const mismatch of mismatches.slice(0, 20)) console.error(`  ${mismatch}`);
  process.exit(1);
}
console.log('[parity:buildings] OK — every facade cell is the cell it replaced');
