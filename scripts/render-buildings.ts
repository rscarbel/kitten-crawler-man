#!/usr/bin/env tsx
/**
 * Headless review harness for the Over City's generated building exteriors.
 *
 * The bake writes PNGs and a manifest; this writes a picture and touches
 * neither. A sheet opened in an image viewer answers the questions the gates
 * cannot — whether a facade reads as a volume, whether the smoke leaves the pot
 * it is meant to, whether the thing looks like somewhere a person lives — and it
 * answers one the gates can only answer after a write: whether the painted door
 * sits inside the walkable opening its own spec asks for. That is marked here.
 *
 *   npx tsx scripts/render-buildings.ts --only=sleeping_cat_inn --scale=3
 *   npx tsx scripts/render-buildings.ts --compare
 *
 * Three views per building, because each hides what the others show:
 *
 * - the bake resolution, where a brush stroke is a brush stroke;
 * - the in-game resolution, seated on a ground strip, which is the only size the
 *   art is ever actually seen at and the size at which detail turns to mud;
 * - the `life` overlay composited over `idle`, which is what the runtime draws.
 *   An overlay cell on its own is 95%+ empty by gate, so a row of them alone
 *   tells a reviewer nothing.
 *
 * Like `render-townsfolk.ts` and unlike the bake generator, the PNG is written
 * *before* the failures are reported. A red gate is exactly when the picture is
 * wanted most, and a harness that exits without drawing on failure is a harness
 * that is useless on the only days it matters.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { TILE_SIZE } from '../src/core/constants.js';
import { BUILDING_SPECS, findBuildingSpec } from './buildinggen/buildings.js';
import {
  bake,
  readFixture,
  runPixelGates,
  type BakedBuilding,
  type FootprintFixtureEntry,
} from './buildinggen/bake.js';
import { GateResults } from './buildinggen/gates.js';
import { BUILDING_TILE_SCALE, type BuildingSpec } from './buildinggen/spec.js';

/**
 * node-canvas's `Image`, named off `loadImage` rather than imported, so the
 * import list stays to the three symbols this file draws with.
 */
type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

const REPLACED_DIR = resolve('scripts/buildinggen/fixtures/replaced');

// ── flags ──────────────────────────────────────────────────────────────────

/** Length of the `--` prefix plus the `=` separator around a flag name. */
const FLAG_SYNTAX_LENGTH = 3;

function parseFlag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match === undefined ? undefined : match.slice(name.length + FLAG_SYNTAX_LENGTH);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const DEFAULT_SCALE = 2;
const MIN_SCALE = 1;
const MAX_SCALE = 8;

function parseScale(): number {
  const raw = parseFlag('scale');
  if (raw === undefined) return DEFAULT_SCALE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

function selectedSpecs(): ReadonlyArray<BuildingSpec> {
  const only = parseFlag('only');
  // `findBuildingSpec` throws on a miss, which is the whole point: a typo that
  // silently rendered all fifteen would look like the flag being ignored.
  return only === undefined ? BUILDING_SPECS : [findBuildingSpec(only)];
}

// ── gates ──────────────────────────────────────────────────────────────────

// ── sheet layout ───────────────────────────────────────────────────────────

const SHEET_MARGIN = 12;
const GROUP_GAP = 20;
const CELL_GAP = 12;
const ROW_GAP = 8;
const TITLE_BAND = 15;
const CAPTION_BAND = 11;

const BACKDROP = '#2f3440';
const CELL_TINT = 'rgba(255,255,255,0.04)';
const TITLE_COLOR = '#f2ead9';
const CAPTION_COLOR = '#9fb0c4';
const TITLE_FONT = '11px sans-serif';
const CAPTION_FONT = '9px sans-serif';

/**
 * The reference surface under the in-game view. Flat bands on purpose: this is
 * here so the building is judged as seated on something, and a faithful render
 * of the real town ground would compete with the art for the reviewer's eye.
 */
const GROUND_BAND_PX = 18;
const GRASS_NEAR = '#3f5a32';
const GRASS_FAR = '#4a6a3a';
const APRON_STONE = '#6d6b63';
/** How far the street apron spreads past the walkable gap, in tiles. */
const APRON_MARGIN_TILES = 0.75;
/** Share of the ground band given to the far grass, before the near band. */
const GRASS_FAR_FRACTION = 0.45;

const DOOR_MARKER_COLOR = '#7ef2ff';
const DOOR_MARKER_WIDTH_PX = 1;
/** How far up the facade the opening markers run, in tiles. */
const DOOR_MARKER_TILES = 3;

interface Group {
  readonly building: BakedBuilding;
  readonly compare: LoadedImage | null;
  readonly compareWidth: number;
  readonly compareHeight: number;
  readonly width: number;
  readonly height: number;
  readonly topRowHeight: number;
}

function inGameWidth(spec: BuildingSpec): number {
  return spec.tilesWide * TILE_SIZE;
}

function inGameHeight(spec: BuildingSpec): number {
  return spec.tilesHigh * TILE_SIZE;
}

function measureGroup(
  building: BakedBuilding,
  compare: LoadedImage | null,
  compareWidth: number,
  compareHeight: number,
): Group {
  const { spec, idle } = building;
  const seatedHeight = inGameHeight(spec) + GROUND_BAND_PX;
  const topRowHeight = Math.max(idle.height, seatedHeight, compareHeight);
  const topRowWidth =
    idle.width + CELL_GAP + inGameWidth(spec) + (compare === null ? 0 : CELL_GAP + compareWidth);
  const lifeRowWidth = spec.life.frames * (inGameWidth(spec) + CELL_GAP);
  const height =
    TITLE_BAND + CAPTION_BAND + topRowHeight + ROW_GAP + CAPTION_BAND + inGameHeight(spec);
  return {
    building,
    compare,
    compareWidth,
    compareHeight,
    width: Math.max(topRowWidth, lifeRowWidth),
    height,
    topRowHeight,
  };
}

type SheetContext = ReturnType<Canvas['getContext']>;

function drawCaption(ctx: SheetContext, text: string, x: number, y: number): void {
  ctx.font = CAPTION_FONT;
  ctx.fillStyle = CAPTION_COLOR;
  ctx.fillText(text, x, y);
}

function drawCellTint(
  ctx: SheetContext,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = CELL_TINT;
  ctx.fillRect(x, y, width, height);
}

function drawGroundStrip(
  ctx: SheetContext,
  spec: BuildingSpec,
  left: number,
  groundY: number,
): void {
  const width = inGameWidth(spec);
  const farHeight = GROUND_BAND_PX * GRASS_FAR_FRACTION;
  ctx.fillStyle = GRASS_FAR;
  ctx.fillRect(left, groundY, width, farHeight);
  ctx.fillStyle = GRASS_NEAR;
  ctx.fillRect(left, groundY + farHeight, width, GROUND_BAND_PX - farHeight);

  const apronLeft = left + (spec.door.col - APRON_MARGIN_TILES) * TILE_SIZE;
  const apronWidth = (spec.door.gapTiles + APRON_MARGIN_TILES * 2) * TILE_SIZE;
  ctx.fillStyle = APRON_STONE;
  ctx.fillRect(apronLeft, groundY, apronWidth, GROUND_BAND_PX);
}

/**
 * The edges of the walkable gap, drawn over the in-game view.
 *
 * This is the most useful mark on the sheet. The door's painted ink and the gap
 * left in the blocked base course both come from `door.col`, but the paint goes
 * through the facade plane's own inset while the regions are frame-space — a
 * door that has drifted out of its opening is a wall the player walks through,
 * and it is invisible in an unmarked picture.
 */
function drawDoorwayMarkers(
  ctx: SheetContext,
  spec: BuildingSpec,
  left: number,
  groundY: number,
): void {
  const top = groundY - DOOR_MARKER_TILES * TILE_SIZE;
  const height = DOOR_MARKER_TILES * TILE_SIZE + GROUND_BAND_PX;
  ctx.fillStyle = DOOR_MARKER_COLOR;
  for (const col of [spec.door.col, spec.door.col + spec.door.gapTiles]) {
    ctx.fillRect(left + col * TILE_SIZE, top, DOOR_MARKER_WIDTH_PX, height);
  }
}

function drawGroup(ctx: SheetContext, group: Group, left: number, top: number): void {
  const { building, compare, compareWidth, compareHeight, topRowHeight } = group;
  const { spec, idle, life } = building;

  ctx.font = TITLE_FONT;
  ctx.fillStyle = TITLE_COLOR;
  ctx.fillText(`${spec.title}  ·  ${spec.key}`, left, top);

  const captionTop = top + TITLE_BAND;
  const rowTop = captionTop + CAPTION_BAND;
  const rowBottom = rowTop + topRowHeight;

  // Bottom-aligned rather than top-aligned: the three views are different
  // heights, and a common ground line is what makes their masses comparable.
  let cellLeft = left;
  drawCaption(ctx, `bake ${BUILDING_TILE_SCALE}px/tile`, cellLeft, captionTop);
  drawCellTint(ctx, cellLeft, rowBottom - idle.height, idle.width, idle.height);
  ctx.drawImage(idle, cellLeft, rowBottom - idle.height);
  cellLeft += idle.width + CELL_GAP;

  const seatedGroundY = rowBottom - GROUND_BAND_PX;
  const seatedTop = seatedGroundY - inGameHeight(spec);
  drawCaption(ctx, `in-game ${TILE_SIZE}px/tile`, cellLeft, captionTop);
  drawGroundStrip(ctx, spec, cellLeft, seatedGroundY);
  ctx.drawImage(idle, cellLeft, seatedTop, inGameWidth(spec), inGameHeight(spec));
  drawDoorwayMarkers(ctx, spec, cellLeft, seatedGroundY);
  cellLeft += inGameWidth(spec) + CELL_GAP;

  if (compare !== null) {
    drawCaption(ctx, `replaced: ${spec.replaces}`, cellLeft, captionTop);
    drawCellTint(ctx, cellLeft, rowBottom - compareHeight, compareWidth, compareHeight);
    ctx.drawImage(compare, cellLeft, rowBottom - compareHeight, compareWidth, compareHeight);
  }

  const lifeCaptionTop = rowBottom + ROW_GAP;
  drawCaption(ctx, `life ×${spec.life.frames}, each over idle`, left, lifeCaptionTop);
  const lifeTop = lifeCaptionTop + CAPTION_BAND;
  life.forEach((frame, index) => {
    const frameLeft = left + index * (inGameWidth(spec) + CELL_GAP);
    drawCellTint(ctx, frameLeft, lifeTop, inGameWidth(spec), inGameHeight(spec));
    ctx.drawImage(idle, frameLeft, lifeTop, inGameWidth(spec), inGameHeight(spec));
    ctx.drawImage(frame, frameLeft, lifeTop, inGameWidth(spec), inGameHeight(spec));
  });
}

function renderSheet(groups: ReadonlyArray<Group>, scale: number, outPath: string): void {
  const sheetWidth =
    SHEET_MARGIN * 2 + groups.reduce((widest, group) => Math.max(widest, group.width), 0);
  const sheetHeight =
    SHEET_MARGIN * 2 +
    groups.reduce((total, group) => total + group.height + GROUP_GAP, 0) -
    GROUP_GAP;

  const canvas = createCanvas(Math.ceil(sheetWidth * scale), Math.ceil(sheetHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheetWidth, sheetHeight);
  ctx.textBaseline = 'top';

  let top = SHEET_MARGIN;
  for (const group of groups) {
    drawGroup(ctx, group, SHEET_MARGIN, top);
    top += group.height + GROUP_GAP;
  }

  writeFileSync(outPath, canvas.toBuffer('image/png'));
}

// ── the replaced art ───────────────────────────────────────────────────────

/**
 * Loads the PNG a spec replaces, sized to the same tiles-per-pixel as the
 * in-game view beside it.
 *
 * The old sheets were baked at four different tile scales, so drawing them at
 * their own pixel size would make a 21.5px/tile cottage look half the building
 * it is. Scaling by `TILE_SIZE / tileScale` is what puts the two at the size the
 * player sees, which is the only comparison worth making.
 */
async function loadComparison(
  spec: BuildingSpec,
  fixture: ReadonlyMap<string, FootprintFixtureEntry>,
): Promise<{ image: LoadedImage; width: number; height: number }> {
  const entry = fixture.get(spec.replaces);
  if (entry === undefined) {
    throw new Error(`--compare has no fixture entry for '${spec.replaces}' (${spec.key})`);
  }
  const path = resolve(REPLACED_DIR, basename(entry.path));
  if (!existsSync(path)) {
    throw new Error(
      `--compare needs ${path}, which is missing; the replaced PNGs are copied into ` +
        'scripts/buildinggen/fixtures/replaced/ so the comparison survives the bake overwriting the originals',
    );
  }
  const tilesPerPixel = TILE_SIZE / entry.tileScale;
  return {
    image: await loadImage(path),
    width: entry.frameWidth * tilesPerPixel,
    height: entry.frameHeight * tilesPerPixel,
  };
}

// ── entry ──────────────────────────────────────────────────────────────────

const scale = parseScale();
const outPath = resolve(parseFlag('out') ?? 'buildings-review.png');
const wantsComparison = hasFlag('compare');
const fixture = readFixture();
const specs = selectedSpecs();

const results = new GateResults();
const groups: Group[] = [];
for (const spec of specs) {
  const building = bake(spec);
  runPixelGates(results, building, fixture);
  results.report(
    spec.key,
    'doorway',
    'not run here — it needs SpriteLoader reading a written manifest, so only ' +
      '`npm run gen:buildings` can check it',
  );
  if (wantsComparison) {
    const comparison = await loadComparison(spec, fixture);
    groups.push(measureGroup(building, comparison.image, comparison.width, comparison.height));
  } else {
    const NO_COMPARISON_SIZE = 0;
    groups.push(measureGroup(building, null, NO_COMPARISON_SIZE, NO_COMPARISON_SIZE));
  }
}

renderSheet(groups, scale, outPath);

const KEY_COLUMN = 22;
const GATE_COLUMN = 18;
for (const line of results.reports) {
  console.log(`  ${line.key.padEnd(KEY_COLUMN)} ${line.gate.padEnd(GATE_COLUMN)} ${line.detail}`);
}
console.log(`\nWrote ${outPath} at ${scale}x — ${groups.length} building(s)`);

if (results.failures.length > 0) {
  console.error('\nGATE FAILURES:');
  for (const failure of results.failures) {
    console.error(`  ✗ ${failure.key} / ${failure.gate}: ${failure.detail}`);
  }
  process.exit(1);
}
console.log('All building gates that can run without a written manifest passed.');
