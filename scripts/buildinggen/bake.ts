/**
 * Painting a building into a sheet, and putting that sheet through every gate
 * that measures pixels.
 *
 * The shipped game paints these facades for itself — there is no PNG and no
 * generated manifest any more — so everything here exists for the offline
 * harnesses: the review baker writes the picture a reviewer looks at, and
 * `render-buildings.ts` draws contact sheets. Both compose the sheet the same
 * way the runtime does, and neither writes into `src/images/`.
 *
 * The layout is never restated here. Which column the idle frame takes and
 * where the life row starts are the manifest's to choose, so both are read back
 * out of the checked-in entry through `sheetLayoutFor` — a bake holding its own
 * copy of the layout would keep composing yesterday's sheet while the game read
 * today's.
 */

import { createCanvas, type Canvas } from 'canvas';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asNodeCanvas } from '../nodeGameContext.js';
import { paintBuilding } from '../../src/sprites/buildinggen/paint.js';
import { paintLifeFrame } from '../../src/sprites/buildinggen/animate.js';
import { project } from '../../src/sprites/buildinggen/projection.js';
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
import type { SpriteManifestEntry, SpriteStateDef } from '../../src/core/SpriteLoader.js';
import {
  BUILDING_IDLE_STATE,
  BUILDING_LIFE_STATE,
  buildingManifestEntry,
} from '../../src/sprites/buildinggen/runtimeBuildingSheets.js';
import {
  BUILDING_TILE_SCALE,
  frameHeightPx,
  frameWidthPx,
  type BuildingSpec,
} from '../../src/sprites/buildinggen/spec.js';

const FIXTURE_PATH = resolve('scripts/buildinggen/fixtures/footprints.json');

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

/**
 * Where a spec's frames sit on its sheet, as the manifest entry lays them out.
 *
 * `columns` and `rows` come from the entry alone — the frame counts and offsets
 * it declares — so a gate comparing them against the painted canvas is
 * comparing two independently derived numbers rather than one expression
 * against itself.
 */
export interface SheetLayout {
  readonly idleColumn: number;
  readonly idleRow: number;
  readonly lifeColumn: number;
  readonly lifeRow: number;
  readonly columns: number;
  readonly rows: number;
}

function stateOf(entry: SpriteManifestEntry, name: string): SpriteStateDef {
  const states: Readonly<Record<string, SpriteStateDef | undefined>> = entry.states;
  const state = states[name];
  if (state === undefined) {
    throw new Error(`the manifest entry declares no '${name}' state, so nothing can be laid out`);
  }
  return state;
}

export function sheetLayoutFor(entry: SpriteManifestEntry): SheetLayout {
  const idle = stateOf(entry, BUILDING_IDLE_STATE);
  const life = stateOf(entry, BUILDING_LIFE_STATE);
  const idleColumn = idle.colOffset ?? 0;
  const lifeColumn = life.colOffset ?? 0;
  return {
    idleColumn,
    idleRow: idle.row,
    lifeColumn,
    lifeRow: life.row,
    columns: Math.max(idleColumn + idle.frameCount, lifeColumn + life.frameCount),
    rows: Math.max(idle.row, life.row) + 1,
  };
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

function sameRegions(
  painted: ReadonlyArray<BlockedRegion>,
  declared: ReadonlyArray<BlockedRegion> | undefined,
): boolean {
  if (declared === undefined || declared.length !== painted.length) return false;
  return painted.every((region, index) => {
    const other = declared[index];
    return (
      region.x1 === other.x1 &&
      region.y1 === other.y1 &&
      region.x2 === other.x2 &&
      region.y2 === other.y2
    );
  });
}

function describeRegions(regions: ReadonlyArray<BlockedRegion>): string {
  return regions.map((r) => `(${r.x1},${r.y1})-(${r.x2},${r.y2})`).join(' ');
}

/**
 * Every way a spec disagrees with the manifest entry the game reads it through.
 *
 * The manifest is checked-in data now rather than something a bake emits, which
 * means the two halves can drift in silence: a spec that grows a tile, gains a
 * life frame or moves its door still paints happily, while the game keeps
 * slicing the old geometry out of the new sheet and keeps blocking the old
 * doorway. Nothing else compares them, so this is the whole of that contract.
 */
export function manifestEntryProblems(spec: BuildingSpec): string[] {
  const entry = buildingManifestEntry(spec);
  const problems: string[] = [];
  const complain = (detail: string): void => {
    problems.push(`'${spec.key}' ${detail}`);
  };

  if (entry.path !== undefined) {
    complain(
      `has a manifest entry naming the file '${entry.path}'; these facades are painted at ` +
        'runtime, and an entry with a path makes the loader fetch a sheet that is not there',
    );
  }
  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  if (entry.frameWidth !== frameWidth || entry.frameHeight !== frameHeight) {
    complain(
      `paints ${frameWidth}x${frameHeight}px frames; its manifest entry declares ` +
        `${entry.frameWidth}x${entry.frameHeight}, so every frame would be sliced out of the ` +
        'wrong rectangle',
    );
  }
  if (entry.tileScale !== BUILDING_TILE_SCALE) {
    complain(
      `is painted at ${BUILDING_TILE_SCALE}px per tile; its manifest entry declares ` +
        `${entry.tileScale}, and the footprint every plot is spaced against derives from that`,
    );
  }
  const idle = stateOf(entry, BUILDING_IDLE_STATE);
  const life = stateOf(entry, BUILDING_LIFE_STATE);
  const IDLE_FRAME_COUNT = 1;
  if (idle.frameCount !== IDLE_FRAME_COUNT) {
    complain(
      `declares ${idle.frameCount} idle frames; a facade has exactly one, and the rest of the ` +
        'row belongs to its life overlay',
    );
  }
  if (life.frameCount !== spec.life.frames) {
    complain(
      `paints ${spec.life.frames} life frames but its manifest entry declares ${life.frameCount}`,
    );
  }
  const painted = blockedRegionsFor(spec);
  if (!sameRegions(painted, entry.blockedRegions)) {
    complain(
      `paints blocked regions ${describeRegions(painted)}; its manifest entry declares ` +
        `${describeRegions(entry.blockedRegions ?? [])}, and the doorway the town walks ` +
        'through is derived from the entry',
    );
  }
  return problems;
}

export interface BakedBuilding {
  readonly spec: BuildingSpec;
  /** The sheet laid out as the manifest describes it, which is what the gates measure. */
  readonly sheet: Canvas;
  /**
   * The individual cells, kept so the review harness can lay them out without
   * re-painting. Painting is the expensive half of a bake and doing it twice
   * would also let the picture and the gated pixels drift apart.
   */
  readonly idle: Canvas;
  readonly life: ReadonlyArray<Canvas>;
  readonly entry: SpriteManifestEntry;
}

/**
 * @param weatherSeed  The floor's art-seed term, which reaches a facade's
 *   weathering layers and nothing else. Zero — the default — bakes the reviewed
 *   art, which is what every gate and every review harness wants.
 */
export function bake(spec: BuildingSpec, weatherSeed = 0): BakedBuilding {
  const entry = buildingManifestEntry(spec);
  const layout = sheetLayoutFor(entry);
  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  const sheet = createCanvas(layout.columns * frameWidth, layout.rows * frameHeight);
  const ctx = sheet.getContext('2d');

  const idle = asNodeCanvas(paintBuilding(spec, weatherSeed).canvas);
  ctx.drawImage(idle, layout.idleColumn * frameWidth, layout.idleRow * frameHeight);

  const life: Canvas[] = [];
  for (let step = 0; step < spec.life.frames; step++) {
    const frame = asNodeCanvas(paintLifeFrame(spec, step));
    life.push(frame);
    const left = (layout.lifeColumn + step) * frameWidth;
    const top = layout.lifeRow * frameHeight;
    // Clipped to its own cell: a painter reaching past the frame it was sized
    // for bleeds into the next one, which reads as a drawing bug in the *next*
    // frame and is very hard to trace back to the frame that caused it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, frameWidth, frameHeight);
    ctx.clip();
    ctx.drawImage(frame, left, top);
    ctx.restore();
  }

  return { spec, sheet, idle, life, entry };
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
  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  const layout = sheetLayoutFor(baked.entry);

  for (const problem of manifestEntryProblems(spec)) {
    results.fail(spec.key, 'manifest-entry', problem);
  }

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
      columns: layout.columns,
      rows: layout.rows,
    },
    replaced.footprint.w,
    replaced.footprint.h,
  );

  const idle = readSheetCell(sheet, layout.idleColumn, layout.idleRow, frameWidth, frameHeight);
  const lifeFrames = Array.from({ length: spec.life.frames }, (_unused, step) =>
    readSheetCell(sheet, layout.lifeColumn + step, layout.lifeRow, frameWidth, frameHeight),
  );

  gateNoCellBleed(results, spec, baked.idle, {
    frameWidth: baked.entry.frameWidth,
    frameHeight: baked.entry.frameHeight,
  });
  gateSilhouette(results, spec, idle, project(spec));
  gateTextureRichness(results, spec, idle, replaced.textureRichness);
  gatePlaneSeparation(results, spec, idle, project(spec));
  gatePalette(results, spec, idle, declaredRamps(spec));
  gateLifeFrameCount(results, spec, lifeFrames);
  gateLifeTransparency(results, spec, lifeFrames);
  gateLifeLoop(results, spec, lifeFrames);
}
