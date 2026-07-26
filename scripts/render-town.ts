/**
 * Headless renderer for the Over City — the town as pixels, without a browser.
 *
 * The town redesign's phases are accepted on a screenshot ("no visible grid",
 * "every named building identifiable from the street"), and every defect that
 * survived a phase's data-level checks was visible in the first image anyone
 * rendered: a fence drawn as a ladder down its own side, a kerb outlining every
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
 * art), and `--seed` is unused by the town, which is fixed data — it exists so a
 * caller can re-roll the wilderness outside the walls.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { writeFileSync } from 'node:fs';

/**
 * Everything below imports the game's own modules, which are written against
 * browser globals. Two shims are the whole compatibility layer: `Image` for
 * `SpriteLoader`, and `document.createElement('canvas')` for `allocCanvas`'s
 * fallback path. The tile animations want `performance.now`, which Node provides
 * as a global already — worth stating, because a third shim was written for it
 * here and never assigned, and nothing failed.
 *
 * They are installed before the game modules are imported, because
 * `SpriteLoader` builds its footprint tables at module load.
 */
interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
}
const globals: CanvasGlobals = globalThis;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { loadSprites } = await import('../src/core/SpriteLoader');
const { GameMap } = await import('../src/map/GameMap');
const { renderCanvas, renderDecorationsOverlay } = await import('../src/map/TileRenderer');
const { MarketSystem } = await import('../src/systems/market/MarketSystem');
const { TownPropSystem } = await import('../src/systems/TownPropSystem');
const { TownDecorSystem } = await import('../src/systems/TownDecorSystem');
const { createTownPlan } = await import('../src/map/town/townPlan');

const MAP_SIZE = 280;
/** Matches `RenderPipeline.ENTITY_SORT_Y_OFFSET`: a prop sorts by its foot. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;
const DEFAULT_SCALE = 1;
const DEFAULT_OUT = 'town.png';

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
const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);

await loadSprites('src/images/');

const gameMap = new GameMap({ mapSize: MAP_SIZE, tileHeight: TILE_SIZE, mapType: 'overworld' });

// Built in `DungeonScene`'s order, and for its reason: the market claims its
// stall tiles first so the other props steer clear of them.
const market = new MarketSystem(
  gameMap,
  [],
  () => undefined,
  () => false,
  () => null,
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

const canvas: Canvas = createCanvas(viewW * scale, viewH * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const gameCtx = ctx as unknown as CanvasRenderingContext2D;

renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

for (const prop of [...props].sort(
  (a, b) => a.y + ENTITY_SORT_Y_OFFSET - (b.y + ENTITY_SORT_Y_OFFSET),
)) {
  prop.render(gameCtx, camX, camY, TILE_SIZE);
}

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(
  `${outPath}: ${viewTilesW}x${viewTilesH} tiles at ${scale}x from (${viewTileX}, ${viewTileY}), ${props.length} props`,
);
