#!/usr/bin/env tsx
/**
 * Review harness for the Cloak & Dagger's floor: renders the real room (the
 * same interior `BuildingInteriorScene` generates on door entry) with its
 * real cast — station staff, the host at the door, the stage acts, the
 * gamblers, the dancers and the wandering patrons — driven through
 * `CloakAndDaggerSystem`'s own `update()`, so what's on screen
 * is what the game actually draws, not a hand-picked pose.
 *
 *   npm run render:club-floor
 *
 * Output lands in `preview/cloak-and-dagger/`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { partyOwnsGear } from '../src/loot/gearPools.js';
import { UNZOOMED, worldPx } from '../src/core/rendering/camera.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
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
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { createTownPlan } = await import('../src/map/town/townPlan.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { createCasinoState } = await import('../src/core/club/CasinoState.js');
const { InteriorOccupantSystem } = await import('../src/systems/InteriorOccupantSystem.js');
const { missingCatsProgressAt } = await import('../src/core/quests/missingCatsProgress.js');
const { createShopStock } = await import('../src/economy/shopStock.js');
const { CloakAndDaggerSystem } = await import('../src/systems/CloakAndDaggerSystem.js');

const TOWN_PLAN_SIZE = 280;
const WARM_FRAMES = 90;
const SCALE = 2;
const OUT_DIR = `${PREVIEW_DIR}/cloak-and-dagger`;

await loadSprites('src/images/');
const artSeed = FLOOR_ART_SEEDS[0];
paintEnvironmentArtInNode(artSeed);
installCanvasGlobals();

const plan = createTownPlan(TOWN_PLAN_SIZE);
const building = plan.buildings.find((b) => b.id === 'taloncrest_nightclub');
if (building === undefined) throw new Error(`town plan has no "taloncrest_nightclub"`);

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [], artSeed });
map.generateInterior(building.kind, 0, building.id, false, 'default');
map.releaseTileArt();

const mapW = map.structure[0]?.length ?? 0;
const mapH = map.structure.length;
const viewW = mapW * TILE_SIZE;
const viewH = mapH * TILE_SIZE;

const human = new HumanPlayer(map.startTile.x, map.startTile.y, TILE_SIZE);
const cat = new CatPlayer(map.startTile.x + 1, map.startTile.y, TILE_SIZE);

const club = new CloakAndDaggerSystem(
  map,
  createCasinoState(),
  null,
  null,
  createShopStock(),
  (id) => partyOwnsGear([human, cat], id),
);
const residents = InteriorOccupantSystem.forBuilding(map, building.kind, building.id, {
  missingCats: missingCatsProgressAt('complete'),
});
const people = residents?.people ?? [];

for (let frame = 0; frame < WARM_FRAMES; frame++) {
  residents?.update();
  club.update(human, cat, people);
}

const canvas: Canvas = createCanvas(viewW * SCALE, viewH * SCALE);
const ctx = canvas.getContext('2d');
ctx.scale(SCALE, SCALE);
const gameCtx = asGameContext(ctx);

map.renderCanvas(gameCtx, {
  x: 0,
  y: 0,
  viewWidth: worldPx(viewW),
  viewHeight: worldPx(viewH),
  zoom: UNZOOMED,
});
map.renderDecorationsOverlay(gameCtx, {
  x: 0,
  y: 0,
  viewWidth: worldPx(viewW),
  viewHeight: worldPx(viewH),
  zoom: UNZOOMED,
});
club.renderFloor(gameCtx, 0, 0);

const figures = [...club.sortedRenderables(), ...people, human, cat].sort((a, b) => a.y - b.y);
for (const figure of figures) figure.render(gameCtx, 0, 0, TILE_SIZE);

writePreviewPng(`${OUT_DIR}/floor.png`, canvas.toBuffer('image/png'));
console.log(`wrote ${OUT_DIR}/floor.png (${mapW}x${mapH} tiles)`);

interface Crop {
  readonly name: string;
  readonly tiles: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/**
 * Tighter crops, each at in-game size and enlarged, so the stages, the casino
 * and the front door are judged both as the player sees them and in detail.
 */
const CROP_SCALES = [1, 4] as const;
const CROPS: ReadonlyArray<Crop> = [
  { name: 'stages', tiles: { x0: 5, y0: 6, x1: 23, y1: 15 } },
  { name: 'casino', tiles: { x0: 6, y0: 0, x1: 27, y1: 8 } },
  { name: 'entrance', tiles: { x0: 9, y0: 13, x1: 27, y1: 20 } },
];

for (const crop of CROPS) {
  for (const scale of CROP_SCALES) {
    const cropW = (crop.tiles.x1 - crop.tiles.x0) * TILE_SIZE;
    const cropH = (crop.tiles.y1 - crop.tiles.y0) * TILE_SIZE;
    const cropCanvas: Canvas = createCanvas(cropW * scale, cropH * scale);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.imageSmoothingEnabled = false;
    cropCtx.scale(scale, scale);
    const cropGameCtx = asGameContext(cropCtx);
    const camX = crop.tiles.x0 * TILE_SIZE;
    const camY = crop.tiles.y0 * TILE_SIZE;
    map.renderCanvas(cropGameCtx, {
      x: camX,
      y: camY,
      viewWidth: worldPx(cropW),
      viewHeight: worldPx(cropH),
      zoom: UNZOOMED,
    });
    map.renderDecorationsOverlay(cropGameCtx, {
      x: camX,
      y: camY,
      viewWidth: worldPx(cropW),
      viewHeight: worldPx(cropH),
      zoom: UNZOOMED,
    });
    club.renderFloor(cropGameCtx, camX, camY);
    for (const figure of figures) figure.render(cropGameCtx, camX, camY, TILE_SIZE);
    const file = `${OUT_DIR}/${crop.name}-${scale}x.png`;
    writePreviewPng(file, cropCanvas.toBuffer('image/png'));
    console.log(`wrote ${file}`);
  }
}
