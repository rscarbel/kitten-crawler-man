/**
 * Painting a building into a sheet, and putting that sheet through every gate
 * that does not need it on disk.
 *
 * This lives apart from the bake driver because two callers need it and they
 * must not drift: the driver writes the result, and `render-buildings.ts` draws
 * contact sheets from it without writing anything. The obvious alternative —
 * letting the review harness import the driver — does not work, because the
 * driver *is* a write: it runs at module load and rewrites the manifest.
 *
 * The one gate not here is the doorway, which needs `SpriteLoader` reading a
 * manifest that exists. Only the driver can run that, and only after it writes.
 */

import { createCanvas, type Canvas } from 'canvas';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paintBuilding } from './paint.js';
import { paintLifeFrame } from './animate.js';
import { project } from './projection.js';
import {
  GateResults,
  gateLifeFrameCount,
  gateLifeLoop,
  gateLifeTransparency,
  gateNoCellBleed,
  gatePalette,
  gatePlaneSeparation,
  gateSilhouette,
  gateTextureRichness,
  gateFrameGeometry,
  readSheetCell,
  type BlockedRegion,
} from './gates.js';
import { BUILDING_TILE_SCALE, type BuildingSpec } from './spec.js';

const FIXTURE_PATH = resolve('scripts/buildinggen/fixtures/footprints.json');
const MANIFEST_DIRECTORY_PREFIX = 'environment/buildings';

export const IDLE_ROW = 0;
export const LIFE_ROW = 1;

export interface FootprintFixtureEntry {
  readonly footprint: { readonly w: number; readonly h: number };
  readonly textureRichness: number | null;
  /**
   * The replaced art's own geometry, carried so the review harness can draw it
   * beside the new sheet at matched tiles-per-pixel. The bake itself needs only
   * the footprint and the benchmark.
   */
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileScale: number;
}

export function readFixture(): ReadonlyMap<string, FootprintFixtureEntry> {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `${FIXTURE_PATH} is missing. Run 'npx tsx scripts/snapshot-building-footprints.ts' first — ` +
        'it records the frozen footprints and the texture-richness benchmark this bake is gated against.',
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('footprint fixture is not an object');
  const result = new Map<string, FootprintFixtureEntry>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry: Record<string, unknown> = { ...value };
    const footprint = entry.footprint;
    if (typeof footprint !== 'object' || footprint === null) continue;
    const dimensions: Record<string, unknown> = { ...footprint };
    const width = dimensions.w;
    const height = dimensions.h;
    const richness = entry.textureRichness;
    if (typeof width !== 'number' || typeof height !== 'number') continue;
    if (
      typeof entry.path !== 'string' ||
      typeof entry.frameWidth !== 'number' ||
      typeof entry.frameHeight !== 'number' ||
      typeof entry.tileScale !== 'number'
    ) {
      continue;
    }
    result.set(key, {
      footprint: { w: width, h: height },
      textureRichness: typeof richness === 'number' ? richness : null,
      path: entry.path,
      frameWidth: entry.frameWidth,
      frameHeight: entry.frameHeight,
      tileScale: entry.tileScale,
    });
  }
  return result;
}

export interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
}

export interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly blockedRegions: ReadonlyArray<BlockedRegion>;
  readonly states: Readonly<Record<string, ManifestStateEntry>>;
}

/**
 * The base course, blocked either side of the door.
 *
 * Three rectangles, and the vertical split between them is load-bearing.
 * `SpriteLoader` decides which rectangles form the base course by taking the
 * deepest `y2` and keeping everything within one tile of it, so the wall band
 * must stop short of that row or it joins the base course, spans the whole
 * frontage, and leaves no gap for a door to be found in.
 */
export function blockedRegionsFor(spec: BuildingSpec): ReadonlyArray<BlockedRegion> {
  const scale = BUILDING_TILE_SCALE;
  const frameWidth = spec.tilesWide * scale;
  const frameHeight = spec.tilesHigh * scale;
  const baseRowTop = (spec.tilesHigh - 1) * scale;
  const wallTop = Math.round(project(spec).eavesY);
  const gapLeft = spec.door.col * scale;
  const gapRight = (spec.door.col + spec.door.gapTiles) * scale;

  if (spec.door.col < 1 || spec.door.col + spec.door.gapTiles > spec.tilesWide - 1) {
    throw new Error(
      `'${spec.key}' puts its doorway at columns [${spec.door.col}, ${spec.door.col + spec.door.gapTiles}) ` +
        `of ${spec.tilesWide}; a facade needs at least one blocked column on each side of its door`,
    );
  }
  if (wallTop >= baseRowTop - 1) {
    throw new Error(
      `'${spec.key}' has a wall band starting at y=${wallTop}, at or below the base course top ` +
        `y=${baseRowTop}; the two would merge and the doorway would vanish`,
    );
  }

  return [
    { x1: 0, y1: wallTop, x2: frameWidth, y2: baseRowTop - 1 },
    { x1: 0, y1: baseRowTop, x2: gapLeft, y2: frameHeight },
    { x1: gapRight, y1: baseRowTop, x2: frameWidth, y2: frameHeight },
  ];
}

export function manifestEntryFor(spec: BuildingSpec): ManifestEntry {
  return {
    path: `${MANIFEST_DIRECTORY_PREFIX}/${spec.file}`,
    frameWidth: spec.tilesWide * BUILDING_TILE_SCALE,
    frameHeight: spec.tilesHigh * BUILDING_TILE_SCALE,
    tileX: 0,
    tileY: 0,
    tileScale: BUILDING_TILE_SCALE,
    blockedRegions: blockedRegionsFor(spec),
    states: {
      idle: { row: IDLE_ROW, frameCount: 1 },
      life: { row: LIFE_ROW, frameCount: spec.life.frames },
    },
  };
}

export interface BakedBuilding {
  readonly spec: BuildingSpec;
  /** The two-row sheet as it would be written, which is what the gates measure. */
  readonly sheet: Canvas;
  /**
   * The individual cells, kept so the review harness can lay them out without
   * re-painting. Painting is the expensive half of a bake and doing it twice
   * would also let the picture and the gated pixels drift apart.
   */
  readonly idle: Canvas;
  readonly life: ReadonlyArray<Canvas>;
  readonly entry: ManifestEntry;
}

export function bake(spec: BuildingSpec): BakedBuilding {
  const frameWidth = spec.tilesWide * BUILDING_TILE_SCALE;
  const frameHeight = spec.tilesHigh * BUILDING_TILE_SCALE;
  const sheet = createCanvas(spec.life.frames * frameWidth, frameHeight * 2);
  const ctx = sheet.getContext('2d');

  const idle = paintBuilding(spec);
  ctx.drawImage(idle.canvas, 0, 0);

  const life: Canvas[] = [];
  for (let step = 0; step < spec.life.frames; step++) {
    const frame = paintLifeFrame(spec, step);
    life.push(frame);
    // Clipped to its own cell: a painter reaching past the frame it was sized
    // for bleeds into the next one, which reads as a drawing bug in the *next*
    // frame and is very hard to trace back to the frame that caused it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(step * frameWidth, frameHeight, frameWidth, frameHeight);
    ctx.clip();
    ctx.drawImage(frame, step * frameWidth, frameHeight);
    ctx.restore();
  }

  return { spec, sheet, idle: idle.canvas, life, entry: manifestEntryFor(spec) };
}

/** Every ramp a spec names, which is what the palette gate measures against. */
export function declaredRamps(spec: BuildingSpec): ReadonlySet<string> {
  const ramps = new Set<string>([
    'ink_outline',
    'ground_shadow',
    'step_stone',
    'iron_black',
    'dark_glass',
  ]);
  const addWall = (wall: { ramp: string; trimRamp: string }): void => {
    ramps.add(wall.ramp);
    ramps.add(wall.trimRamp);
  };
  addWall(spec.facade.ground);
  if (spec.facade.upper !== undefined) addWall(spec.facade.upper);
  for (const band of spec.facade.bands) ramps.add(band.ramp);
  if (spec.facade.pilasterRamp !== undefined) ramps.add(spec.facade.pilasterRamp);
  ramps.add('fieldstone');
  ramps.add(spec.roof.ramp);
  ramps.add(spec.roof.ridgeRamp);
  for (const chimney of spec.roof.chimneys) ramps.add(chimney.ramp);
  ramps.add(spec.door.ramp);
  for (const window of spec.windows) {
    ramps.add(window.glowRamp ?? 'hearth_glow');
    if (window.shutterRamp !== undefined) ramps.add(window.shutterRamp);
    if (window.flowerBox) {
      ramps.add('flower_pink');
      ramps.add('leaf_green');
    }
  }
  for (const prop of spec.props) {
    ramps.add(prop.ramp);
    ramps.add(prop.accentRamp);
  }
  for (const effect of spec.life.effects) ramps.add(effect.ramp);
  return ramps;
}

export function runPixelGates(
  results: GateResults,
  baked: BakedBuilding,
  fixture: ReadonlyMap<string, FootprintFixtureEntry>,
): void {
  const { spec, sheet } = baked;
  const frameWidth = spec.tilesWide * BUILDING_TILE_SCALE;
  const frameHeight = spec.tilesHigh * BUILDING_TILE_SCALE;

  const replaced = fixture.get(spec.replaces);
  if (replaced === undefined) {
    results.fail(
      spec.key,
      'fixture',
      `no recorded geometry for '${spec.replaces}', so the frozen footprint and the texture ` +
        'benchmark cannot be checked — re-run the footprint snapshot',
    );
    return;
  }
  if (replaced.textureRichness === null) {
    results.fail(
      spec.key,
      'fixture',
      `'${spec.replaces}' has no recorded texture richness, so the flat-fill gate would measure nothing`,
    );
    return;
  }

  gateFrameGeometry(
    results,
    spec,
    sheet,
    {
      frameWidth: baked.entry.frameWidth,
      frameHeight: baked.entry.frameHeight,
      tileScale: baked.entry.tileScale,
      lifeFrameCount: baked.entry.states.life.frameCount,
    },
    replaced.footprint.w,
    replaced.footprint.h,
  );

  const idle = readSheetCell(sheet, 0, IDLE_ROW, frameWidth, frameHeight);
  const lifeFrames = Array.from({ length: spec.life.frames }, (_unused, step) =>
    readSheetCell(sheet, step, LIFE_ROW, frameWidth, frameHeight),
  );

  gateNoCellBleed(results, spec, sheet);
  gateSilhouette(results, spec, idle, project(spec));
  gateTextureRichness(results, spec, idle, replaced.textureRichness);
  gatePlaneSeparation(results, spec, idle, project(spec));
  gatePalette(results, spec, idle, declaredRamps(spec));
  gateLifeFrameCount(results, spec, lifeFrames);
  gateLifeTransparency(results, spec, lifeFrames);
  gateLifeLoop(results, spec, lifeFrames);
}
