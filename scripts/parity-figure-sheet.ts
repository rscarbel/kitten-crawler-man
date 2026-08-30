/**
 * Proof that a painted figure reproduces the sheet it replaces.
 *
 * Run once per conversion, while the PNG is still on disk: it bakes every cell
 * from the figure's painter, cuts the matching cell out of the sheet, and
 * reports the per-pixel RMS difference between them. With cells baked
 * supersampled, as both the offline generators and the runtime cache do, the
 * difference is the downsampler's own rounding and nothing else.
 *
 * Both sides are enumerated, and a run that compared nothing fails: the painter
 * having painted every row it declares says nothing about the rows it forgot to
 * declare. This is also the only check on the five frozen geometry numbers —
 * `frameWidth`, `frameHeight`, `tileX`, `tileY`, `tileScale` — because every
 * other gate computes from them and a uniformly wrong one is invisible to all
 * of them.
 *
 *   npm run parity:figure -- \
 *     --module=src/sprites/art/<x>Figure.ts \
 *     --export=<X>_FIGURE \
 *     --key=<manifest key> \
 *     --manifest=src/images/<dir>/manifest.json
 *
 * A side-by-side of the worst state lands in `preview/<id>-parity.png`.
 *
 * No figure this repo ships has a sheet left to compare against, so there is
 * nothing here to run today: it survives for the next sheet somebody decides
 * to paint instead, and it can only ever be run before that sheet is deleted.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

/**
 * The RMS a supersampled repaint may differ from the sheet by, on a 0–255
 * channel scale. Tight: the two paths run the same painter at the same density,
 * so anything past rounding noise means the choreography drifted.
 */
const RMS_LIMIT = 2;

// A painter that composes on scratch surfaces of its own reaches for
// `document.createElement('canvas')`, which a Node process does not have.
installCanvasGlobals();

const RGBA_STRIDE = 4;
const CHANNELS_COMPARED = 4;

interface ManifestState {
  readonly row: number;
  readonly colOffset?: number;
  readonly frameCount: number;
  readonly colsPerRow?: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  /**
   * `| undefined` in the value type because the lookups below index it with
   * state names the painter declares, which the sheet need not carry — the
   * whole point of the check. Without it the miss is unreachable to the types.
   */
  readonly states: Readonly<Record<string, ManifestState | undefined>>;
}

function flag(name: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match === undefined) throw new Error(`missing --${name}=`);
  return match.slice(prefix.length);
}

/** Density the cache bakes at, and the default this run compares at. */
const SUPERSAMPLED_DENSITY = 2;
/** The density an unsupersampled generator baked its sheet at. */
const FLAT_DENSITY = 1;

/** Column width the per-state RMS table lines its numbers up on. */
const STATE_COLUMN = 20;
/** Decimal places every RMS in this report is quoted to. */
const RMS_DECIMALS = 3;

/**
 * Density the painter is run at for the comparison.
 *
 * Every creature generator supersampled, so the default is the density the
 * cache bakes at and the run measures the whole path. A handful of older
 * generators painted flat, and against one of those a supersampled repaint is
 * *smoother* than the sheet rather than different from it — `--density=1` is
 * how that is told apart from a choreography that drifted.
 */
function comparisonDensity(): number {
  const prefix = '--density=';
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match === undefined) return SUPERSAMPLED_DENSITY;
  const value = Number(match.slice(prefix.length));
  if (value !== SUPERSAMPLED_DENSITY && value !== FLAT_DENSITY) {
    throw new Error(`--density must be ${FLAT_DENSITY} or ${SUPERSAMPLED_DENSITY}`);
  }
  return value;
}

function paintedCell(def: FigureDef, state: string, frame: number, density: number): Canvas {
  if (density === SUPERSAMPLED_DENSITY) return bakeFigureCell(def, state, frame);
  return paintFigureCell(def, state, frame, density);
}

function isFigureDef(value: unknown): value is FigureDef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.frameWidth === 'number' &&
    typeof candidate.frameHeight === 'number' &&
    typeof candidate.tileX === 'number' &&
    typeof candidate.tileY === 'number' &&
    typeof candidate.tileScale === 'number' &&
    candidate.states instanceof Map &&
    typeof candidate.paintFrame === 'function'
  );
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.frameWidth === 'number' &&
    typeof candidate.frameHeight === 'number' &&
    typeof candidate.tileScale === 'number' &&
    typeof candidate.states === 'object' &&
    candidate.states !== null
  );
}

async function loadFigure(modulePath: string, exportName: string): Promise<FigureDef> {
  const loaded: unknown = await import(pathToFileURL(resolve(modulePath)).href);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new Error(`${modulePath} did not load as a module`);
  }
  const exported: Record<string, unknown> = { ...loaded };
  const def = exported[exportName];
  if (!isFigureDef(def)) throw new Error(`${modulePath} has no FigureDef export "${exportName}"`);
  return def;
}

function readManifestEntry(manifestPath: string, key: string): ManifestEntry {
  const parsed: unknown = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${manifestPath} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const entry = manifest[key];
  if (!isManifestEntry(entry)) throw new Error(`${manifestPath} has no sprite "${key}"`);
  return entry;
}

function frameOrigin(
  state: ManifestState,
  frameWidth: number,
  frameHeight: number,
  frame: number,
): { srcX: number; srcY: number } {
  const totalCol = (state.colOffset ?? 0) + frame;
  if (state.colsPerRow === undefined) {
    return { srcX: totalCol * frameWidth, srcY: state.row * frameHeight };
  }
  const row = state.row + Math.floor(totalCol / state.colsPerRow);
  return { srcX: (totalCol % state.colsPerRow) * frameWidth, srcY: row * frameHeight };
}

async function main(): Promise<void> {
  const def = await loadFigure(flag('module'), flag('export'));
  const density = comparisonDensity();
  const manifestPath = flag('manifest');
  const entry = readManifestEntry(manifestPath, flag('key'));

  const geometryMismatches: string[] = [];
  if (entry.frameWidth !== def.frameWidth || entry.frameHeight !== def.frameHeight) {
    geometryMismatches.push(
      `cell ${def.frameWidth}×${def.frameHeight} vs sheet ${entry.frameWidth}×${entry.frameHeight}`,
    );
  }
  if (entry.tileX !== def.tileX || entry.tileY !== def.tileY) {
    geometryMismatches.push(
      `anchor (${def.tileX}, ${def.tileY}) vs sheet (${entry.tileX}, ${entry.tileY})`,
    );
  }
  if (entry.tileScale !== def.tileScale) {
    geometryMismatches.push(`tileScale ${def.tileScale} vs sheet ${entry.tileScale}`);
  }

  const sheetPath = resolve('src/images', entry.path);
  const sheet = await loadImage(sheetPath);
  const cut = createCanvas(def.frameWidth, def.frameHeight);
  const cutCtx = cut.getContext('2d');

  let worstState = '';
  let worstRms = 0;
  let worstFrame = 0;
  let statesCompared = 0;
  let framesCompared = 0;
  const perState: Array<{ state: string; rms: number }> = [];

  // Both sides are enumerated. Walking the painter alone answers "is what I
  // painted right?" and never "did I paint all of it?" — a conversion that
  // ports ten of thirteen rows compares ten and reports parity, and the rows
  // easiest to forget are the `_away` ones, so the creature is invisible
  // exactly when it walks away from the player.
  for (const sheetOnly of Object.keys(entry.states)) {
    if (def.states.has(sheetOnly)) continue;
    console.error(
      `  FAIL the painter has no state "${sheetOnly}", which the sheet carries — ` +
        'the draw call for it returns without drawing anything',
    );
    process.exitCode = 1;
  }

  for (const [state, declared] of def.states) {
    const sheetState = entry.states[state];
    if (sheetState === undefined) {
      console.error(`  FAIL the sheet has no state "${state}"`);
      process.exitCode = 1;
      continue;
    }
    if (sheetState.frameCount !== declared.frames) {
      console.error(
        `  FAIL "${state}" has ${declared.frames} painted frames ` +
          `against ${sheetState.frameCount} on the sheet`,
      );
      process.exitCode = 1;
    }
    statesCompared++;
    let sumSquares = 0;
    let samples = 0;
    let stateWorst = 0;
    for (let frame = 0; frame < Math.min(declared.frames, sheetState.frameCount); frame++) {
      framesCompared++;
      const { srcX, srcY } = frameOrigin(sheetState, entry.frameWidth, entry.frameHeight, frame);
      cutCtx.clearRect(0, 0, def.frameWidth, def.frameHeight);
      cutCtx.drawImage(
        sheet,
        srcX,
        srcY,
        entry.frameWidth,
        entry.frameHeight,
        0,
        0,
        def.frameWidth,
        def.frameHeight,
      );
      const baked = paintedCell(def, state, frame, density);
      const bakedData = baked.getContext('2d').getImageData(0, 0, baked.width, baked.height).data;
      const sheetData = cutCtx.getImageData(0, 0, def.frameWidth, def.frameHeight).data;
      let frameSquares = 0;
      for (let i = 0; i < sheetData.length; i += RGBA_STRIDE) {
        for (let channel = 0; channel < CHANNELS_COMPARED; channel++) {
          const delta = bakedData[i + channel] - sheetData[i + channel];
          frameSquares += delta * delta;
        }
      }
      const frameSamples = (sheetData.length / RGBA_STRIDE) * CHANNELS_COMPARED;
      sumSquares += frameSquares;
      samples += frameSamples;
      const frameRms = Math.sqrt(frameSquares / frameSamples);
      if (frameRms > stateWorst) {
        stateWorst = frameRms;
        if (frameRms > worstRms) {
          worstRms = frameRms;
          worstState = state;
          worstFrame = frame;
        }
      }
    }
    const rms = samples === 0 ? 0 : Math.sqrt(sumSquares / samples);
    perState.push({ state, rms });
  }

  perState.sort((a, b) => b.rms - a.rms);
  console.log(`${def.id} parity against ${entry.path}`);
  for (const mismatch of geometryMismatches) {
    console.error(`  FAIL geometry: ${mismatch}`);
    process.exitCode = 1;
  }
  for (const { state, rms } of perState) {
    console.log(`  ${state.padEnd(STATE_COLUMN)} rms ${rms.toFixed(RMS_DECIMALS)}`);
  }

  // A run that compared nothing is the one result that must never read as a
  // pass: it is what an empty state map, or a manifest key naming the wrong
  // sprite, produces, and every downstream gate computes from the same five
  // geometry numbers this run is the only check on.
  if (statesCompared === 0) {
    console.error('  FAIL compared no states at all — nothing here was measured');
    process.exitCode = 1;
  }
  if (framesCompared === 0) {
    console.error('  FAIL compared no frames at all — nothing here was measured');
    process.exitCode = 1;
  }

  if (worstState !== '') {
    const sideBySide = createCanvas(def.frameWidth * 2, def.frameHeight);
    const ctx = sideBySide.getContext('2d');
    const sheetState = entry.states[worstState];
    if (sheetState !== undefined) {
      const { srcX, srcY } = frameOrigin(
        sheetState,
        entry.frameWidth,
        entry.frameHeight,
        worstFrame,
      );
      ctx.drawImage(
        sheet,
        srcX,
        srcY,
        entry.frameWidth,
        entry.frameHeight,
        0,
        0,
        def.frameWidth,
        def.frameHeight,
      );
    }
    ctx.drawImage(paintedCell(def, worstState, worstFrame, density), def.frameWidth, 0);
    const written = writePreviewPng(
      `${PREVIEW_DIR}/${def.id}-parity.png`,
      sideBySide.toBuffer('image/png'),
    );
    console.log(
      `  worst: ${worstState}[${worstFrame}] rms ${worstRms.toFixed(RMS_DECIMALS)} → ${written}`,
    );
  }

  if (worstRms > RMS_LIMIT) {
    console.error(`\nFAIL: worst-frame RMS ${worstRms.toFixed(RMS_DECIMALS)} exceeds ${RMS_LIMIT}`);
    process.exitCode = 1;
  } else if (process.exitCode === undefined || process.exitCode === 0) {
    console.log(`\nParity holds: worst-frame RMS ${worstRms.toFixed(RMS_DECIMALS)} ≤ ${RMS_LIMIT}`);
  }
}

await main();
