/**
 * The stealth gate room off real floor-2 maps, for review: the portcullis
 * locked and raised, the prison door and its sign, at in-game size and at
 * twice that without smoothing.
 *
 * Seeds are searched until one map shows the gate in each wall the onward
 * doorway can open through, so a side doorway's oblique portcullis and a north
 * or south doorway's face-on one are both on the sheet.
 *
 *   npx tsx scripts/render-stealth-gate.ts [--seed-limit=60]
 *
 * Writes `preview/stealth-gate/<wall>-<seed>-<locked|open>.png` and a `@2x`
 * copy of each.
 */

import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { GameMap } from '../src/map/GameMap.js';
import { renderCanvas } from '../src/map/TileRenderer.js';
import type { RoomWall } from '../src/map/roomDoorways.js';
import type { StealthGateRoomData } from '../src/map/stealthGateLayout.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { setDungeonFloorTheme } from '../src/map/dungeon/floorTheme.js';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem.js';
import { setViewportSize } from '../src/core/Viewport.js';

const OUT_DIR = `${PREVIEW_DIR}/stealth-gate`;
const DEFAULT_SEED_LIMIT = 60;
/** Tiles of corridor shown round the room, and the rows above it for the north face. */
const ROOM_PADDING_TILES = 3;
const FACE_ROWS = 2;
const ZOOM = 2;
const LIGHTING_CLOCK_MS = 0;
const WALLS: ReadonlyArray<RoomWall> = ['north', 'south', 'west', 'east'];

function seedLimit(): number {
  const arg = process.argv.find((value) => value.startsWith('--seed-limit='));
  return arg === undefined ? DEFAULT_SEED_LIMIT : Number(arg.slice('--seed-limit='.length));
}

function buildMap(seed: number): GameMap {
  const levelDef = getLevelDef('level2');
  setDungeonFloorTheme(levelDef.groundTheme ?? 'service_level');
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    artSeed: FLOOR_ART_SEEDS[0],
    worldSeed: seed,
  });
}

function renderRoom(gameMap: GameMap, room: StealthGateRoomData): Canvas {
  const camX = (room.bounds.x - ROOM_PADDING_TILES) * TILE_SIZE;
  const camY = (room.bounds.y - ROOM_PADDING_TILES - FACE_ROWS) * TILE_SIZE;
  const viewW = (room.bounds.w + ROOM_PADDING_TILES * 2) * TILE_SIZE;
  const viewH = (room.bounds.h + ROOM_PADDING_TILES * 2 + FACE_ROWS) * TILE_SIZE;
  const canvas = createCanvas(viewW, viewH);
  const ctx = asGameContext(canvas.getContext('2d'));
  setViewportSize(viewW, viewH);
  renderCanvas(ctx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
  const decorations = gameMap
    .getVisibleDecorationTiles(camX, camY, viewW, viewH)
    .map((deco) => ({ sortY: deco.ty * TILE_SIZE + deco.sortYAnchorPx, deco }))
    .sort((a, b) => a.sortY - b.sortY);
  for (const { deco } of decorations) gameMap.drawDecorationAt(ctx, deco.tx, deco.ty, camX, camY);
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => LIGHTING_CLOCK_MS,
    additiveGlows: () => true,
  });
  lighting.render(ctx, camX, camY, viewW, viewH);
  return canvas;
}

function zoomed(source: Canvas): Canvas {
  const out = createCanvas(source.width * ZOOM, source.height * ZOOM);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

const remaining = new Set(WALLS);
for (let seed = 1; seed <= seedLimit() && remaining.size > 0; seed++) {
  const gameMap = buildMap(seed);
  const room = gameMap.stealthGateRoom;
  if (room === null || !remaining.has(room.onwardDoorway.wall)) continue;
  const wall = room.onwardDoorway.wall;
  remaining.delete(wall);
  for (const state of ['locked', 'open'] as const) {
    gameMap.setStealthGate(state);
    const canvas = renderRoom(gameMap, room);
    const name = `${OUT_DIR}/${wall}-${seed}-${state}`;
    console.log(writePreviewPng(`${name}.png`, canvas.toBuffer('image/png')));
    console.log(writePreviewPng(`${name}@2x.png`, zoomed(canvas).toBuffer('image/png')));
  }
}
if (remaining.size > 0)
  console.log(`no seed showed an onward doorway in: ${[...remaining].join(', ')}`);
