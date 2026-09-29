/**
 * Review harness for the town art vocabulary module
 * (`src/sprites/art/town/`): a material board (each material as a wall/roof/
 * floor swatch, at 32 px/tile display scale and at 3× for detail), a few
 * sample props painted through the frame contract, and — because the module
 * decides its own bake scale — a bake-scale measurement that bakes the same
 * material content at 48 and 64 px/tile and times it.
 *
 *   npx tsx scripts/render-town-art.ts
 *
 * Writes:
 * - `preview/town-art/materials.png` — the material board: Over City's
 *   plaster, timber, dressed stone, slate, clay, iron, cloth and sky-icon
 *   ramps as wall/roof/floor swatches, beside the game's real ground
 *   materials the ramps are authored against, beside Briar Hollow's own
 *   wood/fieldstone swatches for comparison, beside a crop of the current
 *   shipped facade bake if
 *   `preview/over-city-baseline/buildings/buildings-review.png` exists.
 * - `preview/town-art/props.png` — three sample footprints (1×1, 2×1, 1×2)
 *   painted through `withFootprintClip`, showing the frame contract holding
 *   real material content, not just a placeholder block.
 *
 * Also prints the bake-scale measurement to the console: decoded bytes and
 * paint time for a representative facade at 48 vs 64 px/tile, and what that
 * projects to for the whole facade set against the shipped facade bake's
 * measured baseline decoded size and floor-sweep time.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext, type NodeContext } from './nodeGameContext.js';
import { getMaterial, paintPatch } from '../src/map/tilegen/materials.js';
import { TILE_PX } from '../src/map/tilegen/raster.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import {
  TOWN_TILE_SCALE,
  DISPLAY_TILE_PX,
  withFootprintClip,
  paintCastShadow,
  paintContactAo,
  type TownPropFrame,
} from '../src/sprites/art/town/townArt.js';
import { TOWN_RAMPS, type TownRampId } from '../src/sprites/art/town/townPalette.js';
import {
  paintPlasterWash,
  paintTimberFraming,
  paintStoneCourses,
  paintRoofCourses,
  paintIronStrap,
  paintClothAwning,
  paintGlazing,
  paintPlankBoard,
} from '../src/sprites/art/town/townMaterials.js';
import { drawPlanks as drawVillagePlanks, drawFieldstones } from '../src/sprites/art/villageArt.js';

// ── layout ───────────────────────────────────────────────────────────────────

const HEX_BASE = 16;
const HEX_BYTE_MASK = 0xff;
const HEX_GREEN_SHIFT = 8;
const HEX_RED_SHIFT = 16;

/** Parses a `#rrggbb` literal into an RGB tuple — one string literal rather than three bare numbers. */
function hexRgb(value: string): readonly [number, number, number] {
  const n = Number.parseInt(value.replace('#', ''), HEX_BASE);
  return [
    (n >> HEX_RED_SHIFT) & HEX_BYTE_MASK,
    (n >> HEX_GREEN_SHIFT) & HEX_BYTE_MASK,
    n & HEX_BYTE_MASK,
  ];
}

const SWATCH_TILES_W = 3;
const SWATCH_TILES_H = 2;
const PANEL_GUTTER_PX = 24;
const LABEL_H_PX = 20;
const DETAIL_ZOOM = 3;
/** Left of the in-game swatch, between it and the 3× detail, and right of the detail. */
const PANEL_COLUMN_GUTTER_COUNT = 3;
const SEED = 20260928;

// ── ground textures, tiled from the game's own material painters ─────────────

const groundCache = new Map<string, Canvas>();

function groundSwatch(materialId: string): Canvas {
  const cached = groundCache.get(materialId);
  if (cached !== undefined) return cached;
  const material = getMaterial(materialId);
  const patch = paintPatch(material, SEED, SEED);
  const canvas = createCanvas(patch.size, patch.size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(patch.size, patch.size);
  image.data.set(patch.toRgba());
  ctx.putImageData(image, 0, 0);
  groundCache.set(materialId, canvas);
  return canvas;
}

function paintGroundTile(
  ctx: NodeContext,
  materialId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const swatch = groundSwatch(materialId);
  const tilesAcross = swatch.width / TILE_PX;
  const cellPx = tilesAcross * (w / SWATCH_TILES_W);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let cy = y; cy < y + h; cy += cellPx) {
    for (let cx = x; cx < x + w; cx += cellPx) {
      ctx.drawImage(swatch, cx, cy, cellPx, cellPx);
    }
  }
  ctx.restore();
}

// ── one wall/roof/floor swatch row ────────────────────────────────────────────

type RowPainter = (ctx: NodeContext, x: number, y: number, w: number, h: number) => void;

interface SwatchRow {
  readonly label: string;
  readonly paint: RowPainter;
}

function townWallRow(rampId: TownRampId, kind: 'plaster' | 'stone'): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const ramp = TOWN_RAMPS[rampId];
    nodeCtx.fillStyle = `rgb(${ramp.mid[0]},${ramp.mid[1]},${ramp.mid[2]})`;
    nodeCtx.fillRect(x, y, w, h);
    const ctx = asGameContext(nodeCtx);
    const rng = mulberry32(SEED);
    if (kind === 'plaster') {
      paintPlasterWash(ctx, x, y, w, h, ramp, rng);
      paintTimberFraming(ctx, x, y, w, h, TOWN_RAMPS.oc_timber, rng);
    } else {
      paintStoneCourses(ctx, x, y, w, h, ramp, rng);
    }
  };
}

function townRoofRow(rampId: TownRampId, material: 'clay' | 'slate'): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const ctx = asGameContext(nodeCtx);
    const ramp = TOWN_RAMPS[rampId];
    const rng = mulberry32(SEED);
    paintRoofCourses(
      ctx,
      [
        [x, y + h],
        [x + w / 2, y],
        [x + w, y + h],
      ],
      y + h,
      y,
      x,
      x + w,
      ramp,
      material,
      rng,
    );
  };
}

const IRON_STRAP_X_FRACTION_A = 0.1;
const IRON_STRAP_X_FRACTION_B = 0.55;
const IRON_STRAP_Y_FRACTION = 0.5;
const IRON_STRAP_LENGTH_FRACTION = 0.35;
const IRON_STRAP_B_ANGLE_SIXTH_TURNS = 6;

function townIronRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const shadow = TOWN_RAMPS.iron_black.shadow;
    nodeCtx.fillStyle = `rgb(${shadow[0]},${shadow[1]},${shadow[2]})`;
    nodeCtx.fillRect(x, y, w, h);
    const ctx = asGameContext(nodeCtx);
    paintIronStrap(
      ctx,
      x + w * IRON_STRAP_X_FRACTION_A,
      y + h * IRON_STRAP_Y_FRACTION,
      w * IRON_STRAP_LENGTH_FRACTION,
      0,
      TOWN_RAMPS.iron_black,
    );
    paintIronStrap(
      ctx,
      x + w * IRON_STRAP_X_FRACTION_B,
      y + h * IRON_STRAP_Y_FRACTION,
      w * IRON_STRAP_LENGTH_FRACTION,
      Math.PI / IRON_STRAP_B_ANGLE_SIXTH_TURNS,
      TOWN_RAMPS.iron_black,
    );
  };
}

function townClothRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    paintClothAwning(
      asGameContext(nodeCtx),
      x,
      y,
      w,
      h,
      TOWN_RAMPS.oc_cloth_sky,
      TOWN_RAMPS.oc_cloth_ember,
    );
  };
}

const GLAZING_INSET_FRACTION = 0.15;
const GLAZING_WIDTH_FRACTION = 0.7;
/** A warm lit-interior tone for a swatch; reuses the town's own `hearth_glow` family. */
const SWATCH_WINDOW_GLOW_COLOR = hexRgb('#E8C878');

function townGlazingRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const mid = TOWN_RAMPS.oc_plaster.mid;
    nodeCtx.fillStyle = `rgb(${mid[0]},${mid[1]},${mid[2]})`;
    nodeCtx.fillRect(x, y, w, h);
    const inset = h * GLAZING_INSET_FRACTION;
    paintGlazing(
      asGameContext(nodeCtx),
      x + w * GLAZING_INSET_FRACTION,
      y + inset,
      w * GLAZING_WIDTH_FRACTION,
      h - inset * 2,
      {
        wallRamp: TOWN_RAMPS.oc_plaster,
        trimRamp: TOWN_RAMPS.oc_timber,
        glowColor: SWATCH_WINDOW_GLOW_COLOR,
      },
    );
  };
}

/** Boards per swatch height, for both the town and village plank rows — matched so the two are a fair comparison. */
const SWATCH_PLANK_ROWS = 4;

function townPlankRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const rng = mulberry32(SEED);
    paintPlankBoard(asGameContext(nodeCtx), x, y, w, h, rng, {
      direction: 'horizontal',
      boardPx: h / SWATCH_PLANK_ROWS,
      ramp: TOWN_RAMPS.oc_timber,
    });
  };
}

function villageWoodRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const rng = mulberry32(SEED);
    drawVillagePlanks(asGameContext(nodeCtx), x, y, w, h, rng, {
      direction: 'horizontal',
      boardPx: h / SWATCH_PLANK_ROWS,
    });
  };
}

/** Stone-row height as a share of the swatch height, matched against `STONE_COURSE_HEIGHT_FRACTION` used by the town's own dressed stone. */
const SWATCH_VILLAGE_STONE_ROWS = 3;

function villageStoneRow(): RowPainter {
  return (nodeCtx, x, y, w, h) => {
    const rng = mulberry32(SEED);
    drawFieldstones(asGameContext(nodeCtx), x, y, w, h, rng, h / SWATCH_VILLAGE_STONE_ROWS);
  };
}

const GROUND_ROWS: SwatchRow[] = [
  {
    label: 'ground: plaza (flagstone)',
    paint: (ctx, x, y, w, h) => paintGroundTile(ctx, 'plaza', x, y, w, h),
  },
  {
    label: 'ground: street (cobble)',
    paint: (ctx, x, y, w, h) => paintGroundTile(ctx, 'cobble', x, y, w, h),
  },
  {
    label: 'ground: verge (grass)',
    paint: (ctx, x, y, w, h) => paintGroundTile(ctx, 'grass', x, y, w, h),
  },
];

const WALL_ROWS: SwatchRow[] = [
  { label: 'wall: oc_plaster + oc_timber', paint: townWallRow('oc_plaster', 'plaster') },
  { label: 'wall: oc_stone (dressed, coursed)', paint: townWallRow('oc_stone', 'stone') },
  { label: 'roof: oc_clay (coursed tile)', paint: townRoofRow('oc_clay', 'clay') },
  { label: 'roof: oc_slate (coursed slate)', paint: townRoofRow('oc_slate', 'slate') },
  { label: 'ironwork: iron_black', paint: townIronRow() },
  { label: 'cloth: oc_cloth_sky / oc_cloth_ember', paint: townClothRow() },
  { label: 'glazing: oc_plaster + oc_timber', paint: townGlazingRow() },
  { label: 'plank/board: oc_timber (interior furniture)', paint: townPlankRow() },
];

const VILLAGE_ROWS: SwatchRow[] = [
  { label: 'village: WOOD planks (for comparison)', paint: villageWoodRow() },
  { label: 'village: STONE fieldstones (for comparison)', paint: villageStoneRow() },
];

async function currentFacadeCrop(): Promise<Canvas | null> {
  try {
    const image = await loadImage(
      `${PREVIEW_DIR}/over-city-baseline/buildings/buildings-review.png`,
    );
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

async function paintMaterialBoard(): Promise<Buffer> {
  const rows = [...GROUND_ROWS, ...WALL_ROWS, ...VILLAGE_ROWS];
  const swatchW = SWATCH_TILES_W * DISPLAY_TILE_PX;
  const swatchH = SWATCH_TILES_H * DISPLAY_TILE_PX;
  const rowH = LABEL_H_PX + swatchH * DETAIL_ZOOM + PANEL_GUTTER_PX;
  const colW = swatchW + swatchW * DETAIL_ZOOM + PANEL_GUTTER_PX * PANEL_COLUMN_GUTTER_COUNT;
  const currentFacade = await currentFacadeCrop();
  const facadePanelH =
    currentFacade === null ? 0 : currentFacade.height * (colW / currentFacade.width);

  const width = PANEL_GUTTER_PX * 2 + colW;
  const height = PANEL_GUTTER_PX * 2 + rowH * rows.length + facadePanelH + PANEL_GUTTER_PX;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#26241f';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '14px sans-serif';
  ctx.textBaseline = 'top';

  rows.forEach((row, index) => {
    const rowY = PANEL_GUTTER_PX + index * rowH;
    ctx.fillStyle = '#e8e0d0';
    ctx.fillText(row.label, PANEL_GUTTER_PX, rowY);
    const swatchY = rowY + LABEL_H_PX;
    // 32 px/tile, true in-game size — no panel stretching.
    row.paint(ctx, PANEL_GUTTER_PX, swatchY, swatchW, swatchH);
    // 3× the same content, painted fresh at 3× rather than the destination
    // panel's own size — painting fresh (not scaling a bitmap) is what makes
    // this a magnified crop rather than a blurred stretch.
    row.paint(
      ctx,
      PANEL_GUTTER_PX * 2 + swatchW,
      swatchY,
      swatchW * DETAIL_ZOOM,
      swatchH * DETAIL_ZOOM,
    );
  });

  if (currentFacade !== null) {
    const y = PANEL_GUTTER_PX + rowH * rows.length;
    ctx.fillStyle = '#e8e0d0';
    ctx.fillText('current shipped facade bake (for comparison)', PANEL_GUTTER_PX, y);
    ctx.drawImage(currentFacade, PANEL_GUTTER_PX, y + LABEL_H_PX, colW, facadePanelH);
  }

  return canvas.toBuffer('image/png');
}

// ── frame-contract sample props ───────────────────────────────────────────────

const SAMPLE_PROP_BASE_AO_DEPTH_TILES = 0.3;
const SAMPLE_PROP_BASE_AO_ALPHA = 0.5;
/** Spreads each sample footprint's seed apart so the 2x1 and 1x2 samples never share a stream. */
const FOOTPRINT_SEED_MULTIPLIER = 10;

function paintSampleProp(nodeCtx: NodeContext, frame: TownPropFrame, rampId: TownRampId): void {
  const ctx = asGameContext(nodeCtx);
  withFootprintClip(ctx, frame, () => {
    const rng = mulberry32(SEED + frame.footprintW * FOOTPRINT_SEED_MULTIPLIER + frame.footprintH);
    const w = frame.footprintW * frame.tileScale;
    const h = frame.footprintH * frame.tileScale;
    const top = frame.originY + frame.tileScale - h;
    paintStoneCourses(ctx, frame.originX, top, w, h, TOWN_RAMPS[rampId], rng);
    paintCastShadow(
      ctx,
      frame.originX + w,
      frame.originY + frame.tileScale,
      frame.footprintH,
      frame.tileScale,
    );
    const aoDepth = frame.tileScale * SAMPLE_PROP_BASE_AO_DEPTH_TILES;
    paintContactAo(
      ctx,
      frame.originX,
      frame.originY + frame.tileScale - aoDepth,
      w,
      aoDepth,
      'bottom',
      aoDepth,
      SAMPLE_PROP_BASE_AO_ALPHA,
    );
  });
}

/** How many tile-widths of margin each sample footprint gets inside its own cell. */
const PROPS_BOARD_CELL_TILES = 3;

function paintPropsBoard(): Buffer {
  const scale = TOWN_TILE_SCALE;
  const samples: Array<{ w: number; h: number }> = [
    { w: 1, h: 1 },
    { w: 2, h: 1 },
    { w: 1, h: 2 },
  ];
  const cellPx = scale * PROPS_BOARD_CELL_TILES;
  const width = cellPx * samples.length + PANEL_GUTTER_PX * (samples.length + 1);
  const height = cellPx + PANEL_GUTTER_PX * 2 + LABEL_H_PX;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a4634';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '14px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e8e0d0';
  ctx.fillText(
    'frame contract: three sample footprints, ink clipped to the frame',
    PANEL_GUTTER_PX,
    PANEL_GUTTER_PX / 2,
  );

  samples.forEach((sample, index) => {
    const originX =
      PANEL_GUTTER_PX + index * (cellPx + PANEL_GUTTER_PX) + (cellPx - sample.w * scale) / 2;
    const originY = LABEL_H_PX + PANEL_GUTTER_PX + cellPx - scale;
    const frame: TownPropFrame = {
      originX,
      originY,
      tileScale: scale,
      footprintW: sample.w,
      footprintH: sample.h,
    };
    paintSampleProp(ctx, frame, index % 2 === 0 ? 'oc_stone' : 'oc_plaster');
  });

  return canvas.toBuffer('image/png');
}

// ── bake-scale measurement ────────────────────────────────────────────────────

/** The town facade group's decoded residency before this vocabulary existed: the `town` asset group's decoded size at the shipped 48 px/tile facade bake, across its 42 painted sheets. */
const BASELINE_TOWN_GROUP_DECODED_MB = 89.4;
const BASELINE_SCALE = 48;
/** The `verify:floor-sweep -- --only=facades` wall-clock time before this vocabulary existed, at the shipped 48 px/tile facade bake. */
const BASELINE_FLOOR_SWEEP_SECONDS = 405;
const MEASURE_SCALES = [BASELINE_SCALE, TOWN_TILE_SCALE] as const;
const MEASURE_ITERATIONS = 12;
const MEASURE_WARMUP = 2;
/** A representative facade's ground story and roof, in tiles — the same figures the mock used, matching a real shopfront's proportions. */
const MEASURE_FACADE_COLS = 3;
const MEASURE_GROUND_STORY_TILES = 2.6;
const MEASURE_ROOF_DEPTH_TILES = 1.1;
const MEASURE_FOUNDATION_TILES = 0.5;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const NANOSECONDS_PER_MILLISECOND = 1e6;

function paintRepresentativeFacade(nodeCtx: NodeContext, tileScale: number): void {
  const ctx = asGameContext(nodeCtx);
  const width = MEASURE_FACADE_COLS * tileScale;
  const groundStoryH = MEASURE_GROUND_STORY_TILES * tileScale;
  const roofDepth = MEASURE_ROOF_DEPTH_TILES * tileScale;
  const rng = mulberry32(SEED);
  const foundationH = tileScale * MEASURE_FOUNDATION_TILES;
  paintStoneCourses(
    ctx,
    0,
    groundStoryH - foundationH,
    width,
    foundationH,
    TOWN_RAMPS.oc_stone,
    rng,
  );
  paintPlasterWash(ctx, 0, 0, width, groundStoryH - foundationH, TOWN_RAMPS.oc_plaster, rng);
  paintTimberFraming(ctx, 0, 0, width, groundStoryH - foundationH, TOWN_RAMPS.oc_timber, rng);
  paintRoofCourses(
    ctx,
    [
      [0, groundStoryH],
      [width / 2, groundStoryH - roofDepth],
      [width, groundStoryH],
    ],
    groundStoryH,
    groundStoryH - roofDepth,
    0,
    width,
    TOWN_RAMPS.oc_clay,
    'clay',
    rng,
  );
}

interface ScaleMeasurement {
  readonly tileScale: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly decodedBytes: number;
  readonly meanPaintMs: number;
}

function measureBakeScale(): ScaleMeasurement[] {
  return MEASURE_SCALES.map((tileScale) => {
    const width = Math.round(MEASURE_FACADE_COLS * tileScale);
    const height = Math.round((MEASURE_GROUND_STORY_TILES + MEASURE_ROOF_DEPTH_TILES) * tileScale);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const timings: number[] = [];
    for (let i = 0; i < MEASURE_WARMUP + MEASURE_ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      paintRepresentativeFacade(ctx, tileScale);
      const end = process.hrtime.bigint();
      if (i >= MEASURE_WARMUP) timings.push(Number(end - start) / NANOSECONDS_PER_MILLISECOND);
    }
    const meanPaintMs = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    return {
      tileScale,
      widthPx: width,
      heightPx: height,
      decodedBytes: width * height * BYTES_PER_PIXEL,
      meanPaintMs,
    };
  });
}

const REPORT_DECIMALS = 3;

function reportBakeScale(): void {
  const measurements = measureBakeScale();
  console.log(
    '\nbake-scale measurement (node-canvas; see node-and-chrome-canvas-costs-diverge memory — not a Chrome timing):',
  );
  for (const m of measurements) {
    console.log(
      `  ${m.tileScale}px/tile: ${m.widthPx}x${m.heightPx}px, ${(m.decodedBytes / BYTES_PER_MB).toFixed(REPORT_DECIMALS)} MB decoded ` +
        `(one representative facade), mean paint ${m.meanPaintMs.toFixed(2)} ms over ${MEASURE_ITERATIONS} runs`,
    );
  }
  const at48 = measurements.find((m) => m.tileScale === BASELINE_SCALE);
  const at64 = measurements.find((m) => m.tileScale === TOWN_TILE_SCALE);
  if (at48 !== undefined && at64 !== undefined) {
    const pixelRatio = at64.decodedBytes / at48.decodedBytes;
    const timeRatio = at64.meanPaintMs / at48.meanPaintMs;
    console.log(
      `  pixel-count ratio 64:48 = ${pixelRatio.toFixed(REPORT_DECIMALS)} (exact, from dimensions)`,
    );
    console.log(`  measured paint-time ratio 64:48 = ${timeRatio.toFixed(REPORT_DECIMALS)}`);
    const projectedTownGroupMb = BASELINE_TOWN_GROUP_DECODED_MB * pixelRatio;
    console.log(
      `  projected whole-facade-set decoded residency at 64: ${projectedTownGroupMb.toFixed(1)} MB ` +
        `(${BASELINE_TOWN_GROUP_DECODED_MB} MB measured at ${BASELINE_SCALE} × the exact pixel ratio)`,
    );
    const projectedFloorSweepSeconds = BASELINE_FLOOR_SWEEP_SECONDS * timeRatio;
    console.log(
      `  projected verify:floor-sweep wall time at 64: ${projectedFloorSweepSeconds.toFixed(0)} s ` +
        `(${BASELINE_FLOOR_SWEEP_SECONDS} s measured at ${BASELINE_SCALE} × the measured paint-time ratio)`,
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const materialsPng = await paintMaterialBoard();
  const materialsPath = writePreviewPng(`${PREVIEW_DIR}/town-art/materials.png`, materialsPng);
  console.log(`wrote ${materialsPath}`);

  const propsPng = paintPropsBoard();
  const propsPath = writePreviewPng(`${PREVIEW_DIR}/town-art/props.png`, propsPng);
  console.log(`wrote ${propsPath}`);

  reportBakeScale();
}

await main();
