#!/usr/bin/env tsx
/**
 * Headless review renders of the warded archive as Belle plays it, with the
 * conduit shut and the key ring still on its shelf: the room at in-game scale
 * with its warden on its round, turning to the dumbwaiter's bell, and peering
 * into the hatch with its room left empty; then a close crop of each thing
 * that can be worked, taken at the height of its sheen's twinkle.
 *
 *   npx tsx scripts/render-tower-archive.ts
 *
 * Writes `preview/missing-cats/tower-archive/<moment>.png` and
 * `preview/missing-cats/tower-archive/tell--<thing>.png`.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

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
const { TOWN_TOWER_ID } = await import('../src/map/buildingIds.js');
const { setDungeonFloorTheme } = await import('../src/map/dungeon/floorTheme.js');
const { missingCatsProgressAt } = await import('../src/core/quests/missingCatsProgress.js');
const {
  towerConditionsFor,
  towerStoreyIndex,
  ARCHIVE_KNOCKABLES,
  ARCHIVE_WARD_PLATE,
  TOWER_DUMBWAITER,
} = await import('../src/map/town/interiors/townCenterTower.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { drawTownInteriorGroundProps, townInteriorPropFigures } =
  await import('../src/systems/townInteriorPropFigures.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { createPartySplitState } = await import('../src/core/party/partySplit.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { SpellSystem } = await import('../src/systems/SpellSystem.js');
const { MobRoster } = await import('../src/systems/kits/SceneWorld.js');
const { SenseLayer } = await import('../src/systems/senses/SenseLayer.js');
const { RoomMechanisms } = await import('../src/systems/roomMechanisms/RoomMechanisms.js');
const { CONVEYOR_PLACEMENTS, plateSetsFor, TOWER_DUMBWAITER_BELL_FLAG } =
  await import('../src/map/town/interiors/roomMechanisms.js');
const { ArchiveWorks } = await import('../src/systems/tower/archiveWorks.js');
const { cameraAt, UNZOOMED, worldPx } = await import('../src/core/rendering/camera.js');
type TowerTile = import('../src/map/town/interiors/townCenterTower.js').TowerTile;

const OUT_DIR = `${PREVIEW_DIR}/missing-cats/tower-archive`;
/** In-game scale is one canvas pixel per world pixel at the bake's device ratio. */
const SCALE = 2;
const CROP_SCALE = 5;
const CROP_RADIUS_TILES = 1.5;
/** Steps of the sense layer's clock, long enough for the wards to fade fully in for Belle. */
const SENSE_FADE_STEPS = 10;
const SENSE_FADE_STEP_MS = 100;
/** Frames into the round before the first picture, and into the bell's answer for the next two. */
const ROUND_FRAMES = 200;
const HEARING_FRAMES = 25;
const ANSWER_LIMIT_FRAMES = 2000;
/** One twinkle's period and the share of it at which a glint stands brightest, per `interestGlint.ts`. */
const GLINT_PERIOD_MS = 2600;
const GLINT_PEAK_SHARE = 0.09;
const GLINT_SEED_PHASE_STEP = 0.37;
const TILE_CENTRE = 0.5;
/** The bell pull's signal conveyor, as `CONVEYOR_PLACEMENTS` names it. */
const BELL_CONVEYOR_ID = 'tower_dumbwaiter_bell';

await loadSprites('src/images/');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);
installCanvasGlobals();

const progress = missingCatsProgressAt('archive');
progress.conduitShut = true;
const conditions = towerConditionsFor(progress);
const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
map.generateInterior('tower', towerStoreyIndex('archive'), TOWN_TOWER_ID, false, {
  kind: 'tower',
  conditions,
});
const theme = map.towerStoreyTheme;
if (theme !== null) setDungeonFloorTheme(theme);
map.releaseTileArt();

const bus = new EventBus();
const split = createPartySplitState();
const senses = new SenseLayer();
const mechanisms = new RoomMechanisms({
  map,
  place: { building: TOWN_TOWER_ID, storey: towerStoreyIndex('archive') },
  plateSets: plateSetsFor(TOWN_TOWER_ID, towerStoreyIndex('archive')),
  conveyors: CONVEYOR_PLACEMENTS,
  split,
  bus,
  shatter: () => false,
  playSound: () => undefined,
});
const human = new HumanPlayer(0, 0, TILE_SIZE);
const cat = new CatPlayer(0, 0, TILE_SIZE);
const works = new ArchiveWorks({
  map,
  progress,
  conditions,
  bus,
  audio: null,
  senses,
  mechanisms,
  split,
  addMob: () => undefined,
  removeMob: () => undefined,
  presentCrawlers: () => [],
  presentCompanions: () => [],
  regroupCompanions: () => undefined,
  setPartyDown: () => undefined,
  toast: () => undefined,
});
const frameCtx = {
  human,
  cat,
  active: cat,
  partner: human,
  activeIsMoving: false,
  roster: new MobRoster(map, new SpellSystem()),
  gameMap: map,
  camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
};
works.enter(frameCtx);
for (let step = 0; step <= SENSE_FADE_STEPS; step++)
  senses.update(cat, step * SENSE_FADE_STEP_MS, true);

let nowMs = 0;
Reflect.set(performance, 'now', () => nowMs);

const viewW = (map.structure[0]?.length ?? 0) * TILE_SIZE;
const viewH = map.structure.length * TILE_SIZE;
setViewportSize(viewW, viewH);

function paintRoom(): ReturnType<typeof createCanvas> {
  const canvas = createCanvas(viewW * SCALE, viewH * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const gameCtx = asGameContext(ctx);
  const view = {
    x: 0,
    y: 0,
    viewWidth: worldPx(viewW),
    viewHeight: worldPx(viewH),
    zoom: UNZOOMED,
  };
  map.renderCanvas(gameCtx, view);
  drawTownInteriorGroundProps(gameCtx, map, 0, 0, TILE_SIZE);
  works.renderWorld(gameCtx, 0, 0);
  mechanisms.renderGround(gameCtx, 0, 0);
  senses.paint(gameCtx, { camX: 0, camY: 0, width: worldPx(viewW), height: worldPx(viewH) });
  map.renderDecorationsOverlay(gameCtx, view);
  const hidden = new Set(mechanisms.hiddenProps());
  const figures = [
    ...townInteriorPropFigures(map, hidden),
    ...mechanisms.sortedFigures(),
    ...works.roomFigures(),
  ].sort((a, b) => (a.depthY ?? a.y) - (b.depthY ?? b.y));
  for (const figure of figures) figure.render(gameCtx, 0, 0, TILE_SIZE);
  works.renderEffects(gameCtx, 0, 0);
  return canvas;
}

function writeRoom(name: string): void {
  console.log(writePreviewPng(`${OUT_DIR}/${name}.png`, paintRoom().toBuffer('image/png')));
}

function writeCrop(name: string, tile: TowerTile, seed: number): void {
  const peakShare = (((GLINT_PEAK_SHARE - seed * GLINT_SEED_PHASE_STEP) % 1) + 1) % 1;
  nowMs = peakShare * GLINT_PERIOD_MS;
  const room = paintRoom();
  const side = CROP_RADIUS_TILES * 2 * TILE_SIZE * SCALE;
  const crop = createCanvas(side * CROP_SCALE, side * CROP_SCALE);
  const ctx = crop.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const left = (tile.x + TILE_CENTRE - CROP_RADIUS_TILES) * TILE_SIZE * SCALE;
  const top = (tile.y + TILE_CENTRE - CROP_RADIUS_TILES) * TILE_SIZE * SCALE;
  ctx.drawImage(room, left, top, side, side, 0, 0, side * CROP_SCALE, side * CROP_SCALE);
  console.log(writePreviewPng(`${OUT_DIR}/tell--${name}.png`, crop.toBuffer('image/png')));
}

let answered = false;
bus.on('towerMoment', ({ moment }) => {
  if (moment.kind === 'archive_bell_answered') answered = true;
});

for (let frame = 0; frame < ROUND_FRAMES; frame++) works.update(frameCtx);
writeRoom('1-round');
writeCrop('key-ring', ARCHIVE_KNOCKABLES.key_ring.at, 0);
writeCrop('shelf-board', ARCHIVE_KNOCKABLES.shelf_board.at, 1);
writeCrop('plate-jar', ARCHIVE_KNOCKABLES.plate_jar.at, 2);
writeCrop('bell', TOWER_DUMBWAITER.head.bell, 3);
writeCrop('plate', ARCHIVE_WARD_PLATE.at, 0);

bus.emit('conveyorSignalled', {
  conveyor: BELL_CONVEYOR_ID,
  flag: TOWER_DUMBWAITER_BELL_FLAG,
  from: 'head',
});
for (let frame = 0; frame < HEARING_FRAMES; frame++) works.update(frameCtx);
writeRoom('2-hears-the-bell');
for (let frame = 0; frame < ANSWER_LIMIT_FRAMES && !answered; frame++) works.update(frameCtx);
writeRoom('3-peering-into-the-hatch');
works.dispose();
