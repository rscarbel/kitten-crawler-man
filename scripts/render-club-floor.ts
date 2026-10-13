#!/usr/bin/env tsx
/**
 * Review harness for the Desperado Club's floor: renders the real room (the
 * same interior `BuildingInteriorScene` generates on door entry) with its
 * real cast — station staff, the DJ, the dancers and the wandering patrons —
 * driven through `DesperadoClubSystem`'s own `update()`, so what's on screen
 * is what the game actually draws, not a hand-picked pose.
 *
 *   npm run render:club-floor
 *
 * Output lands in `preview/desperado-club/`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

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
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { createTownPlan } = await import('../src/map/town/townPlan.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { createClubMembership } = await import('../src/core/ClubMembership.js');
const { createMercenaryRoster } = await import('../src/core/MercenaryRoster.js');
const { createMarketStock } = await import('../src/systems/market/MarketStock.js');
const { DesperadoClubSystem } = await import('../src/systems/DesperadoClubSystem.js');

const TOWN_PLAN_SIZE = 280;
const WARM_FRAMES = 90;
const SCALE = 2;
const CLUB_BUILDING_NAME = 'The Desperado Club';
const OUT_DIR = `${PREVIEW_DIR}/desperado-club`;

await loadSprites('src/images/');
const artSeed = FLOOR_ART_SEEDS[0];
paintEnvironmentArtInNode(artSeed);
installCanvasGlobals();

const plan = createTownPlan(TOWN_PLAN_SIZE);
const building = plan.buildings.find((b) => b.name === CLUB_BUILDING_NAME);
if (building === undefined) throw new Error(`town plan has no "${CLUB_BUILDING_NAME}"`);

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [], artSeed });
map.generateInterior(building.kind, 0, building.name, false, 'default');
map.invalidateAllTileArt();

const mapW = map.structure[0]?.length ?? 0;
const mapH = map.structure.length;
const viewW = mapW * TILE_SIZE;
const viewH = mapH * TILE_SIZE;

const human = new HumanPlayer(map.startTile.x, map.startTile.y, TILE_SIZE);
const cat = new CatPlayer(map.startTile.x + 1, map.startTile.y, TILE_SIZE);

const club = new DesperadoClubSystem(
  map,
  createClubMembership(),
  createMercenaryRoster(),
  new Conversation(null),
  null,
  false,
  human,
  createMarketStock(),
);

for (let frame = 0; frame < WARM_FRAMES; frame++) club.update(human, cat);

const canvas: Canvas = createCanvas(viewW * SCALE, viewH * SCALE);
const ctx = canvas.getContext('2d');
ctx.scale(SCALE, SCALE);
const gameCtx = asGameContext(ctx);

map.renderCanvas(gameCtx, 0, 0, viewW, viewH);
map.renderDecorationsOverlay(gameCtx, 0, 0, viewW, viewH);
club.renderFloor(gameCtx, 0, 0);

const figures = [...club.sortedRenderables()].sort((a, b) => a.y - b.y);
for (const figure of figures) figure.render(gameCtx, 0, 0, TILE_SIZE);

writePreviewPng(`${OUT_DIR}/floor.png`, canvas.toBuffer('image/png'));
console.log(`wrote ${OUT_DIR}/floor.png (${mapW}x${mapH} tiles)`);

// A tighter crop over the dance floor, enlarged, so the dancers' motion and
// the mixed-species crowd read clearly rather than as dots in a wide shot.
const CROP_SCALE = 4;
const DANCE_FLOOR_TILES = { x0: 8, y0: 5, x1: 15, y1: 12 };
const cropW = (DANCE_FLOOR_TILES.x1 - DANCE_FLOOR_TILES.x0) * TILE_SIZE;
const cropH = (DANCE_FLOOR_TILES.y1 - DANCE_FLOOR_TILES.y0) * TILE_SIZE;
const cropCanvas: Canvas = createCanvas(cropW * CROP_SCALE, cropH * CROP_SCALE);
const cropCtx = cropCanvas.getContext('2d');
cropCtx.imageSmoothingEnabled = false;
cropCtx.scale(CROP_SCALE, CROP_SCALE);
const cropGameCtx = asGameContext(cropCtx);
const camX = DANCE_FLOOR_TILES.x0 * TILE_SIZE;
const camY = DANCE_FLOOR_TILES.y0 * TILE_SIZE;
map.renderCanvas(cropGameCtx, camX, camY, cropW, cropH);
map.renderDecorationsOverlay(cropGameCtx, camX, camY, cropW, cropH);
club.renderFloor(cropGameCtx, camX, camY);
for (const figure of figures) figure.render(cropGameCtx, camX, camY, TILE_SIZE);
writePreviewPng(`${OUT_DIR}/dance-floor-4x.png`, cropCanvas.toBuffer('image/png'));
console.log(`wrote ${OUT_DIR}/dance-floor-4x.png`);

// The casino at in-game size and enlarged, so the slot bank, the wheel and the
// counter are judged both as the player sees them and in detail. Carl and
// Donut stand in the row behind the slot bank, where the cabinets' fronts must
// be painted over them.
const CASINO_TILES = { x0: 17, y0: 0, x1: 24, y1: 10 };
const BEHIND_SLOTS_ROW = 7;
const CARL_BEHIND_SLOTS_X = 21;
const DONUT_BEHIND_SLOTS_X = 22;
const carlBehindSlots = new HumanPlayer(CARL_BEHIND_SLOTS_X, BEHIND_SLOTS_ROW, TILE_SIZE);
const donutBehindSlots = new CatPlayer(DONUT_BEHIND_SLOTS_X, BEHIND_SLOTS_ROW, TILE_SIZE);
const casinoFigures = [...figures, carlBehindSlots, donutBehindSlots].sort((a, b) => a.y - b.y);
const CASINO_SCALES = [1, CROP_SCALE] as const;
for (const scale of CASINO_SCALES) {
  const casinoW = (CASINO_TILES.x1 - CASINO_TILES.x0) * TILE_SIZE;
  const casinoH = (CASINO_TILES.y1 - CASINO_TILES.y0) * TILE_SIZE;
  const casinoCanvas: Canvas = createCanvas(casinoW * scale, casinoH * scale);
  const casinoCtx = casinoCanvas.getContext('2d');
  casinoCtx.scale(scale, scale);
  const casinoGameCtx = asGameContext(casinoCtx);
  const casinoCamX = CASINO_TILES.x0 * TILE_SIZE;
  const casinoCamY = CASINO_TILES.y0 * TILE_SIZE;
  map.renderCanvas(casinoGameCtx, casinoCamX, casinoCamY, casinoW, casinoH);
  map.renderDecorationsOverlay(casinoGameCtx, casinoCamX, casinoCamY, casinoW, casinoH);
  club.renderFloor(casinoGameCtx, casinoCamX, casinoCamY);
  for (const figure of casinoFigures) {
    figure.render(casinoGameCtx, casinoCamX, casinoCamY, TILE_SIZE);
  }
  const file = `${OUT_DIR}/casino-${scale}x.png`;
  writePreviewPng(file, casinoCanvas.toBuffer('image/png'));
  console.log(`wrote ${file}`);
}
