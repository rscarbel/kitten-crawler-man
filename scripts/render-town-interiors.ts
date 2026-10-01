#!/usr/bin/env tsx
/**
 * Headless renderer for the Over City's walk-in interiors, populated with
 * their real occupants.
 *
 * Every building's interior is generated from `GameMap.generateInterior` —
 * the same call `BuildingInteriorScene` makes on door entry — then drawn
 * through the map's own `renderCanvas` / `renderDecorationsOverlay`, with
 * `InteriorOccupantSystem`'s roster laid over it in Y-sorted order the same
 * way the scene does. It skips everything `BuildingInteriorScene` needs a
 * live `Player` for (services, quest encounters, the shop panel), because
 * the point here is the room and the people standing in it, not play state.
 *
 *   npx tsx scripts/render-town-interiors.ts
 *   npx tsx scripts/render-town-interiors.ts --only=anvil
 *   npx tsx scripts/render-town-interiors.ts --out-dir=preview/my-pass --scale=2
 *   npx tsx scripts/render-town-interiors.ts --probes
 *
 * `--only` matches a case-insensitive substring of the building name.
 * `--probes` stands Carl at a counter, a table, the doorway and on the top
 * row of the room's first rug (one of each the room actually has) so a scale
 * mismatch between the new interior props and a real figure — or a rug drawn
 * over the people standing on it — shows up in the picture rather than
 * staying a number.
 *
 * The tower is drawn one image per storey (`<slug>-floor-<n>.png`); it has no
 * `InteriorOccupantSystem` roster, so its storeys show the furniture alone.
 * Excluded on purpose: the Big Top, a quest-encounter interior whose default
 * variant is an empty ring.
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
/** Matches the bake resolution the shipped sheets are authored at (see `nodeCanvasGlobals.ts`). */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { GameMap, TOWER_FLOOR_COUNT } = await import('../src/map/GameMap.js');
const { createTownPlan } = await import('../src/map/town/townPlan.js');
const { stampSafeRoomCounters } = await import('../src/map/safeRoomCounterLayout.js');
const { stampSafeRoomDecor } = await import('../src/map/safeRoomDecorLayout.js');
const { InteriorOccupantSystem, scanInteriorFurniture } =
  await import('../src/systems/InteriorOccupantSystem.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { drawTownInteriorGroundProps, townInteriorGroundProps, townInteriorPropFigures } =
  await import('../src/systems/townInteriorPropFigures.js');
const { drawCarlFront } = await import('../src/sprites/art/carl/figure.js');
const { restingPose } = await import('../src/sprites/art/carl/rig.js');
const { HUMAN_SCALE } = await import('../src/sprites/art/human/figureScale.js');

/** Matches how `TownPlan` sizes and centres a level-3 town; only `.buildings` is read here. */
const TOWN_PLAN_SIZE = 280;
/** How long an occupant roster runs before the shot, so nobody is caught on wander frame zero. */
const WARM_FRAMES = 60;
const DEFAULT_SCALE = 2;
const DEFAULT_OUT_DIR = `${PREVIEW_DIR}/town-interiors`;
/** Buildings this harness does not cover; see the file doc for why. */
const EXCLUDED_BUILDING_NAMES: ReadonlySet<string> = new Set(['Big Top']);

/** Length of the `--` prefix and `=` separator around a flag's name. */
const FLAG_PREFIX_LENGTH = 3;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + FLAG_PREFIX_LENGTH);
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name, '');
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

const only = stringArg('only', '').toLowerCase();
const outDir = stringArg('out-dir', DEFAULT_OUT_DIR);
const scale = intArg('scale', DEFAULT_SCALE);
const artSeed = FLOOR_ART_SEEDS[Math.abs(intArg('art-seed', 0)) % FLOOR_ART_SEEDS.length];
const withProbes = process.argv.includes('--probes');

await loadSprites('src/images/');
paintEnvironmentArtInNode(artSeed);
installCanvasGlobals();

const plan = createTownPlan(TOWN_PLAN_SIZE);
const rooms = [...plan.buildings, plan.tower].filter(
  (building) =>
    !EXCLUDED_BUILDING_NAMES.has(building.name) && building.name.toLowerCase().includes(only),
);

if (rooms.length === 0) {
  throw new Error(`--only=${only} matched no building`);
}

/** Slugifies a building name into a filesystem-safe basename. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** One screen pixel of headroom above a probe's own foot tile, so he reads as standing beside the furniture rather than merged into it. */
const PROBE_SOUTH_OFFSET_TILES = 1;
/** A probe stands on the middle of its tile, not its west edge. */
const PROBE_FOOT_CENTRE_TILES = 0.5;

const storeys = rooms.flatMap((building) => {
  const floorCount = building.kind === 'tower' ? TOWER_FLOOR_COUNT : 1;
  return Array.from({ length: floorCount }, (_, floor) => ({ building, floor, floorCount }));
});

for (const { building, floor, floorCount } of storeys) {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [], artSeed });
  const hasSafeRoom = 'hasSafeRoom' in building && building.hasSafeRoom === true;
  map.generateInterior(building.kind, floor, building.name, hasSafeRoom, 'default');
  if (hasSafeRoom) {
    stampSafeRoomCounters(map);
    stampSafeRoomDecor(map);
  }
  map.invalidateAllTileArt();

  const occupants = InteriorOccupantSystem.forBuilding(map, building.kind, building.name);
  for (let frame = 0; frame < WARM_FRAMES; frame++) occupants?.update();

  const mapW = map.structure[0]?.length ?? 0;
  const mapH = map.structure.length;
  const viewW = mapW * TILE_SIZE;
  const viewH = mapH * TILE_SIZE;

  const canvas: Canvas = createCanvas(viewW * scale, viewH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const gameCtx = asGameContext(ctx);

  map.renderCanvas(gameCtx, 0, 0, viewW, viewH);
  drawTownInteriorGroundProps(gameCtx, map, 0, 0, TILE_SIZE);
  map.renderDecorationsOverlay(gameCtx, 0, 0, viewW, viewH);

  function drawCarlProbe(tileX: number, tileY: number): void {
    const footX = (tileX + PROBE_FOOT_CENTRE_TILES) * TILE_SIZE;
    const footY = (tileY + 1) * TILE_SIZE;
    ctx.save();
    ctx.translate(footX, footY);
    ctx.scale(TILE_SIZE, TILE_SIZE);
    ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
    drawCarlFront(gameCtx, restingPose());
    ctx.restore();
  }

  // Keeper Brenna Kestrel is a counter-anchored occupant like any other
  // resident, so the General Store's roster below already draws her — there
  // is no separate shopkeeper figure to special-case here.
  const figures: Array<{ y: number; render: () => void }> = [];
  for (const occupant of occupants?.people ?? []) {
    figures.push({ y: occupant.y, render: () => occupant.render(gameCtx, 0, 0, TILE_SIZE) });
  }
  for (const figure of townInteriorPropFigures(map)) {
    figures.push({ y: figure.y, render: () => figure.render(gameCtx, 0, 0, TILE_SIZE) });
  }
  if (withProbes) {
    const furniture = scanInteriorFurniture(map);
    const counterTile = furniture.get('counter')?.[0];
    const tableTile = furniture.get('table')?.[0];
    const doorTile = { x: map.startTile.x, y: map.startTile.y };
    // Standing on a rug's top row is where a rug sorted with the figures
    // would paint over him, so it is the probe that proves the ground layer.
    const groundProps = townInteriorGroundProps(map);
    const rug = groundProps.length > 0 ? groundProps[0] : undefined;
    const rugTopRowTile =
      rug === undefined ? undefined : { x: rug.tile.x, y: rug.tile.y - PROBE_SOUTH_OFFSET_TILES };
    const probeTiles = [counterTile, tableTile, doorTile, rugTopRowTile].filter(
      (t): t is { x: number; y: number } => t !== undefined,
    );
    for (const t of probeTiles) {
      const probeY = t.y + PROBE_SOUTH_OFFSET_TILES;
      figures.push({
        y: probeY * TILE_SIZE,
        render: () => drawCarlProbe(t.x, probeY),
      });
    }
  }

  for (const figure of [...figures].sort((a, b) => a.y - b.y)) figure.render();

  const outPath = writePreviewPng(
    floorCount > 1
      ? `${outDir}/${slug(building.name)}-floor-${floor}.png`
      : `${outDir}/${slug(building.name)}.png`,
    canvas.toBuffer('image/png'),
  );
  console.log(`${outPath}: ${mapW}x${mapH} tiles, ${occupants?.people.length ?? 0} occupant(s)`);
}
