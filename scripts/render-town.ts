/**
 * Headless renderer for Taloncrest — the town as pixels, without a browser.
 *
 * The town is judged on a screenshot ("no visible grid", "every named building
 * identifiable from the street"), and every defect that has survived the
 * data-level checks was visible in the first image anyone rendered: a fence drawn as a ladder down its own side, a kerb outlining every
 * building plot, mint tufts on an olive lawn. `?townmap` cannot show any of
 * those — it draws one flat colour per tile type, and it cannot see props at
 * all, because they are created by systems in `DungeonScene` rather than by the
 * generator.
 *
 * So this runs the *real* render path: `renderCanvas` for the ground, the real
 * decoration overlay, and the real `TownPropRenderable`s from the real systems,
 * Y-sorted the way `RenderPipeline` sorts them. What it cannot show is anything
 * that needs a player: no entities, no camera follow, no interaction prompts.
 *
 *   npx tsx scripts/render-town.ts --x=113 --y=140 --w=56 --h=28 --out=town.png
 *
 * Coordinates are in tiles and name the top-left of the view. With no arguments
 * it frames the whole town interior. `--scale` multiplies the output resolution
 * for reviewing detail (the game draws at 32 px a tile; 4x is legible for prop
 * art), and a fractional `--scale` shrinks it for a map-scale overview
 * (`--x=0 --y=0 --w=280 --h=280 --scale=0.25`).
 *
 * `--seed` is the map's world seed. The town is fixed data, but the wilderness
 * outside the walls is generated, and a before/after comparison is only honest
 * when both images show the same wilderness — so a given seed always renders the
 * same map, and leaving it out picks `DEFAULT_WORLD_SEED` rather than a random one.

 */

import { createCanvas, type Canvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

/**
 * Everything below imports the game's own modules, which are written against
 * browser globals. Three shims are the whole compatibility layer: `Image` for
 * `SpriteLoader`, `document.createElement('canvas')` for `allocCanvas`'s
 * fallback path, and `window.devicePixelRatio` for the low-end downscale check.
 * The tile animations need `performance.now`, which Node already provides as
 * a global, so it needs no shim of its own.
 *
 * They are installed before the game modules are imported, because
 * `SpriteLoader` builds its footprint tables at module load.
 */
interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;

/**
 * Retina, so `shouldDownscaleForLowEndDevice` returns false and the sheets
 * render at the resolution they were baked at — halving them here would mean
 * the review image no longer shows the art that ships. Without this shim,
 * `window.devicePixelRatio` is undefined and that check throws.
 */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

/**
 * Animated art — the river's water, the fountain, the tower's banners — reads
 * the clock while it paints, so two runs a few milliseconds apart would differ
 * wherever something moves. A review image is a still, and a before/after pair
 * is only comparable pixel for pixel when both stills show the same instant.
 */
const FROZEN_CLOCK_MS = 0;
performance.now = () => FROZEN_CLOCK_MS;
Date.now = () => FROZEN_CLOCK_MS;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader');
const { GameMap } = await import('../src/map/GameMap');
const { renderCanvas, renderDecorationsOverlay } = await import('../src/map/TileRenderer');
const { MarketSystem } = await import('../src/systems/market/MarketSystem');
const { createShopStock } = await import('../src/economy/shopStock');
const { TownPropSystem } = await import('../src/systems/TownPropSystem');
const { TownDecorSystem } = await import('../src/systems/TownDecorSystem');
const { createTownPlan } = await import('../src/map/town/townPlan');

const MAP_SIZE = 280;
/** Matches `RenderPipeline.ENTITY_SORT_Y_OFFSET`: a prop sorts by its foot. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;
const DEFAULT_SCALE = 1;
const DEFAULT_OUT = `${PREVIEW_DIR}/town.png`;
const DEFAULT_WORLD_SEED = 1;

function numberArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw.slice(name.length + 3));
  // A scale that rounds the surface to zero pixels makes node-canvas fail with
  // the unhelpful "surface type is not appropriate for the operation".
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
}

const plan = createTownPlan(MAP_SIZE);
const viewTileX = intArg('x', plan.interior.x);
const viewTileY = intArg('y', plan.interior.y);
const viewTilesW = intArg('w', plan.interior.w);
const viewTilesH = intArg('h', plan.interior.h);
const scale = numberArg('scale', DEFAULT_SCALE);
const worldSeed = intArg('seed', DEFAULT_WORLD_SEED);
const outPath = stringArg('out', DEFAULT_OUT);
/** Which of the verified looks to paint the town in; 0 is the reviewed art. */
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const artSeed = FLOOR_ART_SEEDS[Math.abs(intArg('art-seed', 0)) % FLOOR_ART_SEEDS.length];

await loadSprites('src/images/');
// The ground tilesets and every prop on the street ship as painters rather than
// as files, so a harness that only loaded sheets would draw the whole town in
// fallback colours with nothing standing on it. Painted outright: there is no
// render loop here to pace the queue.
const { paintEnvironmentArtInNode } = await import('./nodeCanvasGlobals.js');
paintEnvironmentArtInNode(artSeed);

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed,
  artSeed,
});

// Built in `DungeonScene`'s order, and for its reason: the market claims its
// stall tiles first so the other props steer clear of them.
const market = new MarketSystem(
  gameMap,
  createShopStock(),
  () => undefined,
  () => false,
  () => null,
  () => true,
);
const townProps = new TownPropSystem(
  gameMap,
  () => undefined,
  () => undefined,
  () => null,
  market.reservedTiles,
);
const townDecor = new TownDecorSystem(
  gameMap,
  new Set([...market.reservedTiles, ...townProps.reservedTiles]),
);
const props = [...market.props, ...townProps.props, ...townDecor.props];

const camX = viewTileX * TILE_SIZE;
const camY = viewTileY * TILE_SIZE;
const viewW = viewTilesW * TILE_SIZE;
const viewH = viewTilesH * TILE_SIZE;
const sortedProps = [...props].sort(
  (a, b) => a.y + ENTITY_SORT_Y_OFFSET - (b.y + ENTITY_SORT_Y_OFFSET),
);

const canvas: Canvas = createCanvas(Math.round(viewW * scale), Math.round(viewH * scale));
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
const gameCtx = asGameContext(ctx);

renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
for (const prop of sortedProps) prop.render(gameCtx, camX, camY, TILE_SIZE);

const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
console.log(
  `${written}: ${viewTilesW}x${viewTilesH} tiles at ${scale}x from (${viewTileX}, ${viewTileY}), ` +
    `world seed ${worldSeed}, ${props.length} props`,
);
