/**
 * Headless renderer for a dungeon floor — floors 1 and 2 as pixels, without a
 * browser. The sibling of `scripts/render-town.ts`, for the same reason: these
 * floors are judged on a screenshot, and `?tiles` shows a material by itself
 * rather than a room full of it next to its neighbours, its walls, and the
 * contact shading under them. Every art problem found in this set so far — walls
 * so light they swamped the rooms, brick paving that read as masonry laid flat,
 * a neighbouring room's floor seeping out from under a shared wall — was
 * invisible in a swatch and obvious here.
 *
 *   npx tsx scripts/render-dungeon.ts --level=2 --w=60 --h=34 --scale=2
 *
 * With no view given it frames the start room and its surroundings;
 * `--safe-room` frames a Bopca station instead. `--level` picks the floor and so
 * the ground theme. There is no `--seed`: the generator
 * draws from `Math.random`, so a fresh run is a fresh map.
 *
 * What it cannot show is anything that needs a player or a system: no entities,
 * no props placed by `DungeonScene`, no lighting.
 */

import { createCanvas, type Canvas } from 'canvas';
import { writeFileSync } from 'node:fs';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer.js';
import { stampSafeRoomCounters } from '../src/map/safeRoomCounterLayout.js';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  setDungeonFloorTheme,
} from '../src/map/dungeon/floorTheme.js';

const DEFAULT_LEVEL = 1;
const DEFAULT_VIEW_TILES_W = 56;
const DEFAULT_VIEW_TILES_H = 32;
const DEFAULT_SCALE = 1;
const DEFAULT_OUT = 'dungeon.png';

/** Length of the `--name=` prefix an argument's value starts after. */
const ARG_PREFIX_LENGTH = '--='.length;

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + ARG_PREFIX_LENGTH), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const floorNumber = intArg('level', DEFAULT_LEVEL);
const levelDef = getLevelDef(`level${floorNumber}`);
if (levelDef.isOverworld) throw new Error(`level${floorNumber} is an overworld — use render-town`);

const viewTilesW = intArg('w', DEFAULT_VIEW_TILES_W);
const viewTilesH = intArg('h', DEFAULT_VIEW_TILES_H);
const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);

await loadGameSpritesInNode();

// Written exactly as `DungeonScene` writes it on entering a floor, fallback
// included: the tile painters read the active theme rather than being handed
// one, so a harness that resolved it differently would not be showing the game.
setDungeonFloorTheme(levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);

const gameMap = new GameMap({
  mapSize: levelDef.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'dungeon',
  dungeon: dungeonOptionsForLevel(levelDef),
});

// Centred on the start room, or on a safe room when one is asked for: a station
// keeps its own materials on both floors, so how it sits inside each floor's
// walls is a question only a framed screenshot answers.
const safeRoom = process.argv.includes('--safe-room') ? gameMap.safeRooms[0] : undefined;
const focus = safeRoom === undefined ? gameMap.startTile : safeRoom.centre;

// The generator lays the room; `DungeonScene` stamps the counter run and the
// furnishings on entering the floor. A harness that skipped them framed an empty
// station, which is the one thing a station screenshot is not for.
if (safeRoom !== undefined) {
  stampSafeRoomCounters(gameMap);
  stampSafeRoomDecor(gameMap);
}

const viewTileX = intArg('x', focus.x - Math.floor(viewTilesW / 2));
const viewTileY = intArg('y', focus.y - Math.floor(viewTilesH / 2));

const camX = viewTileX * TILE_SIZE;
const camY = viewTileY * TILE_SIZE;
const viewW = viewTilesW * TILE_SIZE;
const viewH = viewTilesH * TILE_SIZE;

const canvas: Canvas = createCanvas(viewW * scale, viewH * scale);
const ctx = canvas.getContext('2d');
ctx.scale(scale, scale);
// node-canvas implements the same drawing surface the game's renderers are
// written against, but not the DOM's `CanvasRenderingContext2D` nominal type.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const gameCtx = ctx as unknown as CanvasRenderingContext2D;

renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(
  `${outPath}: ${levelDef.name} (${levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME}), ` +
    `${viewTilesW}x${viewTilesH} tiles at ${scale}x from (${viewTileX}, ${viewTileY})`,
);
