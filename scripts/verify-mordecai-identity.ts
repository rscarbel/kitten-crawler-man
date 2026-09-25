#!/usr/bin/env tsx
/**
 * Mordecai's rat-kin cells, held byte for byte against a stored baseline.
 *
 * The rat-kin painter is shared by every ratkin look in the game, and Mordecai
 * is only one outfit of it. Any change to the shared painter — a new garment
 * layer, a proportion preset, a held prop — can quietly move a pixel of his
 * art, and no structural gate would notice: he would still stand on his tile,
 * still fit his cell, still walk. This compares every cell of every row he
 * paints against the checked-in baseline of his approved art, and fails on a
 * single byte of difference.
 *
 * Two surfaces per cell, because each hides differences the other shows: the
 * supersampled paint (what the painter actually drew, before a downsample can
 * average a sub-pixel change away) and the baked cell (what the game blits).
 *
 *   npm run verify:mordecai-identity
 *   npx tsx scripts/verify-mordecai-identity.ts --write-baseline   # only when his art is meant to change
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { bakeFigureCell, figureStateNames, frameCountOf, paintFigureCell } from './figureSheet.js';
import { figureBakeDensity, type FigureDef } from '../src/sprites/figure/figureDef.js';
import { RAT_KIN_FIGURE } from '../src/sprites/art/ratKinFigure.js';

/**
 * Where the baseline lives. Checked in: it is the reference the gate compares
 * against, and regenerating it on every run would make the gate compare the
 * painter against itself.
 */
export const MORDECAI_BASELINE_PATH = resolve('scripts/baselines/mordecai-rat-kin.rgba.gz');

const CHANNELS = 4;

interface CellSurface {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8ClampedArray;
}

/** Every surface the gate compares, in a fixed order: state, frame, then paint before bake. */
function captureSurfaces(def: FigureDef): CellSurface[] {
  const surfaces: CellSurface[] = [];
  const density = figureBakeDensity(def);
  for (const state of figureStateNames(def)) {
    for (let frame = 0; frame < frameCountOf(def, state); frame++) {
      const painted = paintFigureCell(def, state, frame, density);
      surfaces.push({
        label: `${state}#${frame} painted@${density}x`,
        width: painted.width,
        height: painted.height,
        bytes: painted.getContext('2d').getImageData(0, 0, painted.width, painted.height).data,
      });
      const baked = bakeFigureCell(def, state, frame);
      surfaces.push({
        label: `${state}#${frame} baked`,
        width: baked.width,
        height: baked.height,
        bytes: baked.getContext('2d').getImageData(0, 0, baked.width, baked.height).data,
      });
    }
  }
  return surfaces;
}

/** The layout written ahead of the pixels, so a changed row set is its own failure. */
interface BaselineHeader {
  readonly figureId: string;
  readonly surfaces: readonly { label: string; width: number; height: number }[];
}

const HEADER_LENGTH_BYTES = 4;

function encodeBaseline(def: FigureDef, surfaces: readonly CellSurface[]): Buffer {
  const header: BaselineHeader = {
    figureId: def.id,
    surfaces: surfaces.map(({ label, width, height }) => ({ label, width, height })),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(HEADER_LENGTH_BYTES);
  length.writeUInt32LE(headerBytes.length, 0);
  const pixels = surfaces.map((surface) => Buffer.from(surface.bytes.buffer));
  return gzipSync(Buffer.concat([length, headerBytes, ...pixels]));
}

function isBaselineHeader(value: unknown): value is BaselineHeader {
  if (typeof value !== 'object' || value === null) return false;
  if (!('figureId' in value) || typeof value.figureId !== 'string') return false;
  if (!('surfaces' in value) || !Array.isArray(value.surfaces)) return false;
  return value.surfaces.every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      'label' in entry &&
      typeof entry.label === 'string' &&
      'width' in entry &&
      typeof entry.width === 'number' &&
      'height' in entry &&
      typeof entry.height === 'number',
  );
}

interface DecodedBaseline {
  readonly header: BaselineHeader;
  readonly pixels: Buffer;
}

function decodeBaseline(file: Buffer): DecodedBaseline {
  const raw = gunzipSync(file);
  const headerLength = raw.readUInt32LE(0);
  const headerEnd = HEADER_LENGTH_BYTES + headerLength;
  const parsed: unknown = JSON.parse(raw.subarray(HEADER_LENGTH_BYTES, headerEnd).toString('utf8'));
  if (!isBaselineHeader(parsed)) throw new Error('baseline header is malformed');
  return { header: parsed, pixels: raw.subarray(headerEnd) };
}

/** Writes the baseline from whatever the painter paints now. */
export function writeMordecaiBaseline(def: FigureDef = RAT_KIN_FIGURE): string {
  const surfaces = captureSurfaces(def);
  mkdirSync(dirname(MORDECAI_BASELINE_PATH), { recursive: true });
  writeFileSync(MORDECAI_BASELINE_PATH, encodeBaseline(def, surfaces));
  return `${surfaces.length} surfaces of ${def.id} written to ${MORDECAI_BASELINE_PATH}`;
}

/** How many differing cells to itemise before summarising the rest. */
const REPORTED_DIFFERENCES = 8;

/**
 * Every way `def`'s cells differ from the stored baseline, empty when they are
 * byte-identical. `def` defaults to Mordecai; the negative test passes another
 * outfit to prove the comparison can fail.
 */
export function mordecaiIdentityFailures(def: FigureDef = RAT_KIN_FIGURE): string[] {
  if (!existsSync(MORDECAI_BASELINE_PATH)) {
    return [`no baseline at ${MORDECAI_BASELINE_PATH}; nothing was compared`];
  }
  const { header, pixels } = decodeBaseline(readFileSync(MORDECAI_BASELINE_PATH));
  const surfaces = captureSurfaces(def);
  const failures: string[] = [];

  if (header.figureId !== def.id) {
    failures.push(`baseline is of "${header.figureId}", compared against "${def.id}"`);
  }
  if (header.surfaces.length !== surfaces.length) {
    failures.push(
      `baseline has ${header.surfaces.length} surfaces, figure paints ${surfaces.length}`,
    );
    return failures;
  }

  let offset = 0;
  let differing = 0;
  let comparedBytes = 0;
  surfaces.forEach((surface, index) => {
    const expected = header.surfaces[index];
    const length = expected.width * expected.height * CHANNELS;
    const reference = pixels.subarray(offset, offset + length);
    offset += length;
    if (
      expected.label !== surface.label ||
      expected.width !== surface.width ||
      expected.height !== surface.height
    ) {
      failures.push(
        `surface ${index} is ${surface.label} ${surface.width}x${surface.height}, baseline has ${expected.label} ${expected.width}x${expected.height}`,
      );
      return;
    }
    comparedBytes += length;
    let changedPixels = 0;
    let firstChanged = -1;
    let largestDelta = 0;
    for (let pixel = 0; pixel < length / CHANNELS; pixel++) {
      let pixelDiffers = false;
      for (let channel = 0; channel < CHANNELS; channel++) {
        const i = pixel * CHANNELS + channel;
        const delta = Math.abs(surface.bytes[i] - reference[i]);
        if (delta === 0) continue;
        pixelDiffers = true;
        largestDelta = Math.max(largestDelta, delta);
      }
      if (!pixelDiffers) continue;
      changedPixels++;
      if (firstChanged < 0) firstChanged = pixel;
    }
    if (changedPixels === 0) return;
    differing++;
    if (differing <= REPORTED_DIFFERENCES) {
      const x = firstChanged % surface.width;
      const y = Math.floor(firstChanged / surface.width);
      failures.push(
        `${surface.label}: ${changedPixels} pixels differ, first at (${x}, ${y}), largest channel delta ${largestDelta}`,
      );
    }
  });
  if (differing > REPORTED_DIFFERENCES) {
    failures.push(`…and ${differing - REPORTED_DIFFERENCES} more surfaces differ`);
  }
  if (offset !== pixels.length) {
    failures.push(`baseline holds ${pixels.length - offset} bytes past the last surface`);
  }
  if (comparedBytes === 0) failures.push('no pixel bytes were compared');
  return failures;
}

function main(): void {
  if (process.argv.includes('--write-baseline')) {
    console.log(writeMordecaiBaseline());
    return;
  }
  const failures = mordecaiIdentityFailures();
  if (failures.length > 0) {
    console.error(`FAIL mordecai identity — ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log('PASS mordecai identity: every cell byte-identical to the baseline');
}

const invokedDirectly = process.argv[1]?.endsWith('verify-mordecai-identity.ts') ?? false;
if (invokedDirectly) main();
