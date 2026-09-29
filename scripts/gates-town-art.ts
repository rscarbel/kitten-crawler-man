#!/usr/bin/env tsx
/**
 * Gates for the town art vocabulary module (`src/sprites/art/town/`).
 *
 *   npm run gates:town-art
 *   npm run gates:town-art -- --fault=wide-prop      # must fail
 *   npm run gates:town-art -- --fault=flat-material  # must fail
 *
 * Checked, in order:
 *
 * 1. **Frame contract.** `withFootprintClip` and `paintPlaceholderTownProp`
 *    keep ink inside a prop's footprint width and bottom edge, with height
 *    allowed above — checked both for the placeholder and for a real
 *    material painter (stone courses) wrapped in the same clip, at three
 *    footprint sizes.
 * 2. **Texture frequency.** Every wall and roof material's local
 *    contrast lands within a ceiling of the ground material it is authored
 *    to sit near (never far busier than the ground), and above a floor
 *    (never flatter than the ground either) — calibrated against a flat
 *    fill of the same ramp, so a genuinely flat material fails this gate
 *    rather than passing it vacuously.
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { getMaterial, paintPatch } from '../src/map/tilegen/materials.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import {
  withFootprintClip,
  paintPlaceholderTownProp,
  type TownPropFrame,
} from '../src/sprites/art/town/townArt.js';
import { TOWN_RAMPS, type TownRampId } from '../src/sprites/art/town/townPalette.js';
import {
  paintPlasterWash,
  paintTimberFraming,
  paintStoneCourses,
  paintRoofCourses,
} from '../src/sprites/art/town/townMaterials.js';

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);

const failures: string[] = [];
const MAX_FAILURES_SHOWN = 25;
function check(condition: boolean, scope: string, message: string): void {
  if (!condition) failures.push(`${scope}: ${message}`);
}

// ── 1. Frame contract ──────────────────────────────────────────────────────────

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const INK_ALPHA_MIN = 24;
const MIN_INK_PX = 40;
const PAD_PX = 64;
/** How far the deliberate fault pushes art past the footprint. */
const FAULT_OVERHANG_PX = 4;
/** Headroom the sample uses, deliberately small so an above-headroom fault is easy to construct if ever needed. */
const SAMPLE_HEADROOM_TILES = 3;

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

const SCALE = 64;
/** Spreads each footprint's seed apart so the 2x1 and 1x2 samples never share a stream. */
const FOOTPRINT_SEED_MULTIPLIER = 10;
const SAMPLES: ReadonlyArray<{ footprintW: number; footprintH: number }> = [
  { footprintW: 1, footprintH: 1 },
  { footprintW: 2, footprintH: 1 },
  { footprintW: 1, footprintH: 2 },
];

function checkFrame(
  scope: string,
  frame: TownPropFrame,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  const width = frame.footprintW * SCALE + PAD_PX * 2;
  const height = frame.footprintH * SCALE + PAD_PX * 2 + SAMPLE_HEADROOM_TILES * SCALE;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  paint(ctx);
  const report = inkReport(nodeCtx.getImageData(0, 0, width, height).data, width, height, {
    x0: PAD_PX,
    x1: PAD_PX + frame.footprintW * SCALE,
    y1: PAD_PX + SAMPLE_HEADROOM_TILES * SCALE + frame.footprintH * SCALE,
  });
  check(report.inked >= MIN_INK_PX, scope, `paints only ${report.inked} px — nothing to see`);
  check(
    report.left + report.right + report.bottom === 0,
    scope,
    `ink outside its footprint: ${describeOverhang(report)} — past the sides or below the ` +
      'foot is ground a crawler can stand on while drawn behind the prop',
  );
}

let frameChecksRun = 0;
for (const sample of SAMPLES) {
  const frame: TownPropFrame = {
    originX: PAD_PX,
    originY: PAD_PX + SAMPLE_HEADROOM_TILES * SCALE,
    tileScale: SCALE,
    footprintW: sample.footprintW,
    footprintH: sample.footprintH,
  };
  checkFrame(`placeholder ${sample.footprintW}x${sample.footprintH}`, frame, (ctx) => {
    paintPlaceholderTownProp(ctx, frame);
    if (fault === 'wide-prop' && sample.footprintW === 1 && sample.footprintH === 1) {
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(
        frame.originX - FAULT_OVERHANG_PX,
        frame.originY,
        FAULT_OVERHANG_PX,
        FAULT_OVERHANG_PX * 2,
      );
    }
  });
  frameChecksRun++;

  checkFrame(`stone-courses ${sample.footprintW}x${sample.footprintH}`, frame, (ctx) => {
    withFootprintClip(ctx, frame, () => {
      const rng = mulberry32(sample.footprintW * FOOTPRINT_SEED_MULTIPLIER + sample.footprintH);
      const w = frame.footprintW * frame.tileScale;
      const h = frame.footprintH * frame.tileScale;
      paintStoneCourses(
        ctx,
        frame.originX,
        frame.originY + frame.tileScale - h,
        w,
        h,
        TOWN_RAMPS.oc_stone,
        rng,
      );
    });
  });
  frameChecksRun++;
}
check(frameChecksRun > 0, 'frame contract', 'no frame checks ran — the gate measured nothing');

// ── 2. Texture frequency ─────────────────────────────────────────────────────

const TEXTURE_WINDOW_PX = 8;
const OPAQUE_ALPHA = 255;

/** Mean local contrast over the opaque region, in 8x8-px windows — the same measure `measureTextureRichness` (`scripts/buildinggen/gates.ts`) uses, restated here rather than imported so this module carries no dependency on `buildinggen`. */
function measureLocalContrast(data: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let windows = 0;
  for (let wy = 0; wy + TEXTURE_WINDOW_PX <= height; wy += TEXTURE_WINDOW_PX) {
    for (let wx = 0; wx + TEXTURE_WINDOW_PX <= width; wx += TEXTURE_WINDOW_PX) {
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      let allOpaque = true;
      for (let y = wy; y < wy + TEXTURE_WINDOW_PX && allOpaque; y++) {
        for (let x = wx; x < wx + TEXTURE_WINDOW_PX; x++) {
          const index = (y * width + x) * CHANNELS;
          if (data[index + ALPHA_OFFSET] < OPAQUE_ALPHA) {
            allOpaque = false;
            break;
          }
          const LUMA_RED = 0.299;
          const LUMA_GREEN = 0.587;
          const LUMA_BLUE = 0.114;
          const value =
            data[index] * LUMA_RED + data[index + 1] * LUMA_GREEN + data[index + 2] * LUMA_BLUE;
          sum += value;
          sumSquares += value * value;
          count++;
        }
      }
      if (!allOpaque || count === 0) continue;
      const mean = sum / count;
      total += Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
      windows++;
    }
  }
  return windows === 0 ? 0 : total / windows;
}

const RICHNESS_SEED = 20260928;
const RICHNESS_SWATCH_TILES = 3;
const RICHNESS_SWATCH_H_TILES = 2;

function richnessOfGround(materialId: string): number {
  const material = getMaterial(materialId);
  const patch = paintPatch(material, RICHNESS_SEED, RICHNESS_SEED);
  const canvas = createCanvas(patch.size, patch.size);
  const nodeCtx = canvas.getContext('2d');
  const image = nodeCtx.createImageData(patch.size, patch.size);
  image.data.set(patch.toRgba());
  nodeCtx.putImageData(image, 0, 0);
  return measureLocalContrast(
    nodeCtx.getImageData(0, 0, patch.size, patch.size).data,
    patch.size,
    patch.size,
  );
}

const WALL_KIND_BY_RAMP: Readonly<Record<TownRampId, 'plaster' | 'stone' | null>> = {
  oc_plaster: 'plaster',
  oc_timber: null,
  oc_stone: 'stone',
  oc_slate: null,
  oc_clay: null,
  iron_black: null,
  oc_cloth_sky: null,
  oc_cloth_ember: null,
  oc_sky_icon: null,
};

/** With `--fault=flat-material`, paints only the flat fill a real material never ships as — proves the floor/flat-fill checks below would actually catch a flattened material rather than passing one vacuously. */
function paintedWallSwatch(rampId: TownRampId): Uint8ClampedArray | null {
  const kind = WALL_KIND_BY_RAMP[rampId];
  if (kind === null) return null;
  const w = RICHNESS_SWATCH_TILES * SCALE;
  const h = RICHNESS_SWATCH_H_TILES * SCALE;
  const canvas = createCanvas(w, h);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  const ramp = TOWN_RAMPS[rampId];
  const rng = mulberry32(RICHNESS_SEED);
  ctx.fillStyle = `rgb(${ramp.mid[0]},${ramp.mid[1]},${ramp.mid[2]})`;
  ctx.fillRect(0, 0, w, h);
  if (fault !== 'flat-material') {
    if (kind === 'plaster') {
      paintPlasterWash(ctx, 0, 0, w, h, ramp, rng);
      paintTimberFraming(ctx, 0, 0, w, h, TOWN_RAMPS.oc_timber, rng);
    } else {
      paintStoneCourses(ctx, 0, 0, w, h, ramp, rng);
    }
  }
  return nodeCtx.getImageData(0, 0, w, h).data;
}

function flatWallSwatch(rampId: TownRampId): Uint8ClampedArray {
  const w = RICHNESS_SWATCH_TILES * SCALE;
  const h = RICHNESS_SWATCH_H_TILES * SCALE;
  const canvas = createCanvas(w, h);
  const nodeCtx = canvas.getContext('2d');
  const ramp = TOWN_RAMPS[rampId];
  nodeCtx.fillStyle = `rgb(${ramp.mid[0]},${ramp.mid[1]},${ramp.mid[2]})`;
  nodeCtx.fillRect(0, 0, w, h);
  return nodeCtx.getImageData(0, 0, w, h).data;
}

function roofSwatch(rampId: TownRampId, material: 'clay' | 'slate'): Uint8ClampedArray {
  const w = RICHNESS_SWATCH_TILES * SCALE;
  const h = RICHNESS_SWATCH_H_TILES * SCALE;
  const canvas = createCanvas(w, h);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  const rng = mulberry32(RICHNESS_SEED);
  paintRoofCourses(
    ctx,
    [
      [0, h],
      [w / 2, 0],
      [w, h],
    ],
    h,
    0,
    0,
    w,
    TOWN_RAMPS[rampId],
    material,
    rng,
  );
  return nodeCtx.getImageData(0, 0, w, h).data;
}

/** Ceiling: within about 15% of the ground, never far above it. */
const TEXTURE_CEILING_FRACTION = 1.15;
/** Floor: not flatter than the ground either — a genuinely flat material is exactly as wrong as a busy one. */
const TEXTURE_FLOOR_FRACTION = 0.5;
/** How much of the real material's own richness a flat fill of the same ramp must fall short of — proves the metric has teeth. */
const FLAT_FILL_MAX_FRACTION_OF_PAINTED = 0.3;
const PERCENT_MULTIPLIER = 100;

const groundPlazaRichness = richnessOfGround('plaza');
const groundCobbleRichness = richnessOfGround('cobble');
/**
 * The texture-frequency rule compares a facade against the ground *it stands
 * on*, which this module-level gate cannot know yet — no building is placed
 * on a particular ground material here. Anchoring on the busier of the two
 * real grounds (the plaza) rather than an average keeps this gate from
 * penalising a legitimately detailed material for a comparison against a
 * calmer street it may never actually stand on; a facade-placement gate
 * checks the real ground under each real building once that placement
 * exists.
 */
const groundRichness = Math.max(groundPlazaRichness, groundCobbleRichness);
check(groundRichness > 0, 'ground', 'measured zero richness — the gate measured nothing');

const WALL_MATERIALS: ReadonlyArray<TownRampId> = ['oc_plaster', 'oc_stone'];
for (const rampId of WALL_MATERIALS) {
  const painted = paintedWallSwatch(rampId);
  if (painted === null) {
    check(false, `wall ${rampId}`, 'painted nothing');
    continue;
  }
  const w = RICHNESS_SWATCH_TILES * SCALE;
  const h = RICHNESS_SWATCH_H_TILES * SCALE;
  const paintedRichness = measureLocalContrast(painted, w, h);
  const flatRichness = measureLocalContrast(flatWallSwatch(rampId), w, h);
  check(
    paintedRichness <= groundRichness * TEXTURE_CEILING_FRACTION,
    `wall ${rampId}`,
    `local contrast ${paintedRichness.toFixed(2)} exceeds the ceiling of ` +
      `${(groundRichness * TEXTURE_CEILING_FRACTION).toFixed(2)} (${(TEXTURE_CEILING_FRACTION * PERCENT_MULTIPLIER).toFixed(0)}% of the ground's ${groundRichness.toFixed(2)})`,
  );
  check(
    paintedRichness >= groundRichness * TEXTURE_FLOOR_FRACTION,
    `wall ${rampId}`,
    `local contrast ${paintedRichness.toFixed(2)} is below the floor of ` +
      `${(groundRichness * TEXTURE_FLOOR_FRACTION).toFixed(2)} (${(TEXTURE_FLOOR_FRACTION * PERCENT_MULTIPLIER).toFixed(0)}% of the ground's ${groundRichness.toFixed(2)}) — as wrong as reading busier`,
  );
  check(
    flatRichness <= paintedRichness * FLAT_FILL_MAX_FRACTION_OF_PAINTED,
    `wall ${rampId}`,
    `a flat fill of the same ramp measures ${flatRichness.toFixed(2)}, not clearly below the ` +
      `painted material's ${paintedRichness.toFixed(2)} — the metric would not catch a flattened material`,
  );
}

const ROOF_MATERIALS: ReadonlyArray<[TownRampId, 'clay' | 'slate']> = [
  ['oc_clay', 'clay'],
  ['oc_slate', 'slate'],
];
for (const [rampId, material] of ROOF_MATERIALS) {
  const w = RICHNESS_SWATCH_TILES * SCALE;
  const h = RICHNESS_SWATCH_H_TILES * SCALE;
  const paintedRichness = measureLocalContrast(roofSwatch(rampId, material), w, h);
  check(
    paintedRichness <= groundRichness * TEXTURE_CEILING_FRACTION,
    `roof ${rampId}`,
    `local contrast ${paintedRichness.toFixed(2)} exceeds the ceiling of ` +
      (groundRichness * TEXTURE_CEILING_FRACTION).toFixed(2),
  );
  check(
    paintedRichness >= groundRichness * TEXTURE_FLOOR_FRACTION,
    `roof ${rampId}`,
    `local contrast ${paintedRichness.toFixed(2)} is below the floor of ` +
      (groundRichness * TEXTURE_FLOOR_FRACTION).toFixed(2),
  );
}

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log(
  `town art: ${frameChecksRun} frame checks, ground richness ${groundRichness.toFixed(2)} ` +
    `(plaza ${groundPlazaRichness.toFixed(2)}, cobble ${groundCobbleRichness.toFixed(2)})`,
);
if (failures.length > 0) {
  const shown = failures.slice(0, MAX_FAILURES_SHOWN);
  console.error(`\nFAIL — ${failures.length} problem(s):`);
  for (const failure of shown) console.error(`  ${failure}`);
  if (failures.length > shown.length)
    console.error(`  … and ${failures.length - shown.length} more`);
  process.exit(1);
}
console.log('PASS');
