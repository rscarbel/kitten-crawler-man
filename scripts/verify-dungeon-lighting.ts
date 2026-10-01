/**
 * Behaviour gates for the dungeon lighting pass on floors 1 and 2.
 *
 *   npx tsx scripts/verify-dungeon-lighting.ts
 *
 * - A static light's cookie never lights a tile it has no line of sight to:
 *   a light behind a one-tile wall leaves the corridor on the far side dark,
 *   and on generated floors every tile a cookie reaches is seen from its
 *   light (or is the upper rows of a wall face whose foot is seen).
 * - The crawlers' light is always there: the scene registers it, and a
 *   crawler standing in the darkest room on the floor stands in light.
 * - The darkness is drawn after the bodies and before every warning, health
 *   bar and label: the order in `DungeonScene.render`, and a mob's health bar
 *   held back from the entity pass until the darkness has been drawn.
 * - Breaking a light puts it out; standing the prop up again relights it.
 * - The spider lab is never darkened by this pass.
 * - A boss room and the colosseum are never darkened, take at least one mood
 *   light each, and the spider lab takes none.
 * - A wall face takes light only from its open side, never from a light behind it.
 * - A crawler's light walked through a doorway never jumps between frames,
 *   and no frame, moving light or torch-lit, shows a hard line.
 * - A flame flickers over about the share of its cut it is tuned to move.
 * - Eye-shine sits on the head for every facing and is gone facing away.
 *
 * The sight, backface, crawler-light, order, health-bar, breaking, spider-lab
 * and eye checks are also run against a broken input they must catch, so a
 * check that has stopped being able to fail turns the gate red. The edge,
 * jump and flicker checks have no broken twin; their thresholds sit well
 * clear of what a hard clip or a multiplied-away flicker measures.
 */

import { readFileSync } from 'node:fs';
import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { setDungeonFloorTheme } from '../src/map/dungeon/floorTheme.js';
import { FloorTypeValue } from '../src/map/tileTypes.js';
import type { RoomRegion } from '../src/map/regionMap.js';
import type { RoomWall } from '../src/map/roomDoorways.js';
import {
  FLICKER_SHARE,
  POWER_DOWN_MS,
  flickerValue,
  DungeonLightingSystem,
  LIGHT_BLOCKING_TYPES,
  LIGHT_DEATH_MS,
  STATIC_LIGHT_FIXTURES,
} from '../src/systems/DungeonLightingSystem.js';
import { buildLightCookie, WALL_FACE_ROWS } from '../src/systems/lighting/lightCookie.js';
import { partyLightSource } from '../src/systems/lighting/partyLights.js';
import {
  beginAboveDarkness,
  closeAboveDarkness,
  flushAboveDarkness,
} from '../src/systems/lighting/aboveDarkness.js';
import { registerBossRoomMoodLights } from '../src/systems/bossRooms/BossRoomDressings.js';
import { Rat } from '../src/creatures/Rat.js';
import { Llama } from '../src/creatures/Llama.js';
import { Goblin } from '../src/creatures/Goblin.js';
import { GoblinArcher } from '../src/creatures/GoblinArcher.js';
import { Troglodyte } from '../src/creatures/Troglodyte.js';
import { BrindleGrub, type GrubStage } from '../src/creatures/BrindleGrub.js';
import { IceFairy } from '../src/creatures/fairies/IceFairy.js';
import { FireFairy } from '../src/creatures/fairies/FireFairy.js';
import { NecroFairy } from '../src/creatures/fairies/NecroFairy.js';
import { ShieldFairy } from '../src/creatures/fairies/ShieldFairy.js';
import { HealingFairy } from '../src/creatures/fairies/HealingFairy.js';

/** Generated floors checked per level, from fixed seeds so a failure replays. */
const SEED_COUNT = 3;
const FIRST_SEED = 3;
const SEED_STRIDE = 4;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, index) => FIRST_SEED + index * SEED_STRIDE);
const FLOORS = [1, 2] as const;
const HALF = 0.5;
/** Inset of a sample point from its tile's corner, so a ray never grazes the corner itself. */
const SAMPLE_INSET = 0.02;
/** Step along a sight ray, in tiles: small enough that no tile corner is skipped. */
const RAY_STEP_TILES = 0.02;
/** A view big enough to frame any room on these floors. */
const VIEW_TILES_W = 48;
const VIEW_TILES_H = 32;
const RGBA = 4;
const WHITE = 255;
/** A channel at or above this is lit; well past what the cap leaves of white. */
const LIT_CHANNEL = 225;
/** A channel this far below lit reads as dark. */
const DARK_CHANNEL = 200;
const HEALTH_BAR_GREEN = { r: 0x4a, g: 0xde, b: 0x80 };
const COLOUR_TOLERANCE = 6;
/** Tiles along each side of the canvas a rat and its bar are drawn on. */
const HEALTH_BAR_CANVAS_TILES = 4;

const failures: string[] = [];
const notes: string[] = [];

function fail(check: string, message: string): void {
  failures.push(`[${check}] ${message}`);
}

// ── Sight ───────────────────────────────────────────────────────────────────

type OpaqueTest = (x: number, y: number) => boolean;

/** Whether a straight line from a tile's centre reaches a point without crossing an opaque tile. */
function rayClear(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  target: { x: number; y: number },
  isOpaque: OpaqueTest,
): boolean {
  const startX = fromX + HALF;
  const startY = fromY + HALF;
  const length = Math.hypot(toX - startX, toY - startY);
  const steps = Math.max(1, Math.ceil(length / RAY_STEP_TILES));
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const x = Math.floor(startX + (toX - startX) * t);
    const y = Math.floor(startY + (toY - startY) * t);
    if ((x === target.x && y === target.y) || (x === fromX && y === fromY)) continue;
    if (isOpaque(x, y)) return false;
  }
  return true;
}

/**
 * Where a ray may land in a tile to see it: its centre, points just inside
 * its corners and edges, and the corners themselves — a shadowcast lights a
 * wall tile whose corner it can see past the wall beside it.
 */
const SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [HALF, HALF],
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [SAMPLE_INSET, SAMPLE_INSET],
  [1 - SAMPLE_INSET, SAMPLE_INSET],
  [SAMPLE_INSET, 1 - SAMPLE_INSET],
  [1 - SAMPLE_INSET, 1 - SAMPLE_INSET],
  [HALF, SAMPLE_INSET],
  [HALF, 1 - SAMPLE_INSET],
  [SAMPLE_INSET, HALF],
  [1 - SAMPLE_INSET, HALF],
];

function seenFrom(
  emitterX: number,
  emitterY: number,
  x: number,
  y: number,
  isOpaque: OpaqueTest,
): boolean {
  if (x === emitterX && y === emitterY) return true;
  return SAMPLE_OFFSETS.some(([ox, oy]) =>
    rayClear(emitterX, emitterY, x + ox, y + oy, { x, y }, isOpaque),
  );
}

/**
 * Tiles in a cookie that its light cannot see: neither in sight, nor the
 * upper rows of a seen wall face, nor the wall the light hangs on.
 */
function unseenLitTiles(
  emitterX: number,
  emitterY: number,
  lightTile: { x: number; y: number },
  litTiles: Iterable<number>,
  width: number,
  isOpaque: OpaqueTest,
): Array<{ x: number; y: number }> {
  const lit = new Set(litTiles);
  const unseen: Array<{ x: number; y: number }> = [];
  for (const index of lit) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === lightTile.x && y === lightTile.y) continue;
    if (seenFrom(emitterX, emitterY, x, y, isOpaque)) continue;
    let onSeenFace = false;
    if (isOpaque(x, y)) {
      for (let rise = 1; rise < WALL_FACE_ROWS && !onSeenFace; rise++) {
        const footY = y + rise;
        const isFoot = isOpaque(x, footY) && !isOpaque(x, footY + 1);
        if (
          isFoot &&
          lit.has(footY * width + x) &&
          seenFrom(emitterX, emitterY, x, footY, isOpaque)
        ) {
          onSeenFace = true;
        }
      }
    }
    if (!onSeenFace) unseen.push({ x, y });
  }
  return unseen;
}

// ── Check: one-tile wall ────────────────────────────────────────────────────

/** The one-tile-wall test map: a corridor, a wall one tile thick, a room with a light in it. */
const TEST_MAP = {
  width: 11,
  height: 10,
  corridorRows: [1, 2],
  wallRow: 3,
  light: { x: 5, y: 6 },
  /** Far enough that the corridor is in reach once the wall is gone. */
  reachTiles: 5,
} as const;

/** The corridor tiles a light in the test map's room lights. */
function corridorTilesLitThroughWall(isOpaque: OpaqueTest): number {
  const { width, height, light, reachTiles } = TEST_MAP;
  const cookie = buildLightCookie({
    emitterTileX: light.x,
    emitterTileY: light.y,
    centreX: (light.x + HALF) * TILE_SIZE,
    centreY: (light.y + HALF) * TILE_SIZE,
    reachTiles,
    mapWidth: width,
    mapHeight: height,
    isOpaque,
  });
  const corridorRows: ReadonlyArray<number> = TEST_MAP.corridorRows;
  let corridorLit = 0;
  for (const index of cookie.litTiles) {
    if (corridorRows.includes(Math.floor(index / width))) corridorLit++;
  }
  return corridorLit;
}

function checkOneTileWall(): void {
  const WIDTH = TEST_MAP.width;
  const HEIGHT = TEST_MAP.height;
  const wallRow = TEST_MAP.wallRow;
  const solid: OpaqueTest = (x, y) =>
    x <= 0 || y <= 0 || x >= WIDTH - 1 || y >= HEIGHT - 1 || y === wallRow;
  const leaked = corridorTilesLitThroughWall(solid);
  if (leaked > 0) fail('one-tile-wall', `${leaked} corridor tiles lit through a one-tile wall`);
  // The same light with the wall taken away must reach the corridor, or the
  // check above could not fail.
  const open: OpaqueTest = (x, y) => x <= 0 || y <= 0 || x >= WIDTH - 1 || y >= HEIGHT - 1;
  if (corridorTilesLitThroughWall(open) === 0) {
    fail(
      'one-tile-wall',
      'negative test: with no wall the corridor stayed dark; the check cannot fail',
    );
  }
}

/** The wall-row tiles the test map's light lights from the corridor side of the wall. */
function facesLitFromBehind(isOpaque: OpaqueTest, from: { x: number; y: number }): number {
  const { width, height, wallRow } = TEST_MAP;
  const cookie = buildLightCookie({
    emitterTileX: from.x,
    emitterTileY: from.y,
    centreX: (from.x + HALF) * TILE_SIZE,
    centreY: (from.y + HALF) * TILE_SIZE,
    reachTiles: TEST_MAP.reachTiles,
    mapWidth: width,
    mapHeight: height,
    isOpaque,
  });
  let lit = 0;
  for (const index of cookie.litTiles) {
    if (Math.floor(index / width) === wallRow) lit++;
  }
  return lit;
}

/**
 * The wall between the test map's corridor and room is drawn as the room's
 * face, looking south: a light in the corridor north of it must not light it,
 * and the room's own light must.
 */
function checkBackfaces(): void {
  const { width, height, wallRow } = TEST_MAP;
  const solid: OpaqueTest = (x, y) =>
    x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 || y === wallRow;
  const corridorLight = { x: TEST_MAP.light.x, y: TEST_MAP.corridorRows[0] };
  const fromBehind = facesLitFromBehind(solid, corridorLight);
  if (fromBehind > 0) fail('backface', `${fromBehind} room faces lit by a light behind them`);
  if (facesLitFromBehind(solid, TEST_MAP.light) === 0) {
    fail(
      'backface',
      'negative test: the room light lit none of its own faces; the check cannot fail',
    );
  }
}

/** Lit tiles of a light that are south-looking faces with the light north of them. */
function backfacesOf(
  emitterY: number,
  litTiles: Iterable<number>,
  width: number,
  isOpaque: OpaqueTest,
  lightTile: { x: number; y: number },
): number {
  let count = 0;
  for (const index of litTiles) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === lightTile.x && y === lightTile.y) continue;
    const isFaceFoot = isOpaque(x, y) && !isOpaque(x, y + 1);
    if (isFaceFoot && emitterY <= y) count++;
  }
  return count;
}

// ── Floors ──────────────────────────────────────────────────────────────────

function buildFloor(level: number, seed: number): GameMap {
  const levelDef = getLevelDef(`level${level}`);
  setDungeonFloorTheme(levelDef.groundTheme ?? 'cellars');
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: seed,
  });
}

function lightingFor(gameMap: GameMap, clock: { ms: number }, glows = true): DungeonLightingSystem {
  return new DungeonLightingSystem({ gameMap, now: () => clock.ms, additiveGlows: () => glows });
}

function opaqueOn(gameMap: GameMap): OpaqueTest {
  const height = gameMap.structure.length;
  const width = gameMap.structure[0]?.length ?? 0;
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    return LIGHT_BLOCKING_TYPES.has(gameMap.structure[y][x].type);
  };
}

function checkCookieSight(gameMap: GameMap, lighting: DungeonLightingSystem, label: string): void {
  const width = gameMap.structure[0]?.length ?? 0;
  const isOpaque = opaqueOn(gameMap);
  let lights = 0;
  for (const light of lighting.staticLightTiles()) {
    const geometry = lighting.staticLightGeometry(light.x, light.y);
    if (geometry === null) continue;
    lights++;
    const unseen = unseenLitTiles(
      geometry.emitterX,
      geometry.emitterY,
      light,
      geometry.litTiles,
      width,
      isOpaque,
    );
    const backfaces = backfacesOf(geometry.emitterY, geometry.litTiles, width, isOpaque, light);
    if (backfaces > 0) {
      fail(
        'backface',
        `${label}: the ${light.kind} at (${light.x},${light.y}) lights ${backfaces} faces from behind`,
      );
    }
    if (unseen.length > 0) {
      const first = unseen[0];
      fail(
        'cookie-sight',
        `${label}: the ${light.kind} at (${light.x},${light.y}) lights ${unseen.length} tiles it cannot see, first (${first.x},${first.y})`,
      );
    }
  }
  if (lights === 0) fail('cookie-sight', `${label}: no static lights on the floor`);
  notes.push(`${label}: ${lights} static lights checked for sight`);
}

/** A white canvas with the lighting pass drawn over it, framed on `focus`. */
function renderOnWhite(
  lighting: DungeonLightingSystem,
  focus: { x: number; y: number },
): { pixel: (worldX: number, worldY: number) => number; camX: number; camY: number } {
  const viewW = VIEW_TILES_W * TILE_SIZE;
  const viewH = VIEW_TILES_H * TILE_SIZE;
  const camX = focus.x - viewW / 2;
  const camY = focus.y - viewH / 2;
  const canvas = createCanvas(viewW, viewH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, viewW, viewH);
  lighting.render(asGameContext(ctx), camX, camY, viewW, viewH);
  const data = ctx.getImageData(0, 0, viewW, viewH).data;
  return {
    camX,
    camY,
    pixel: (worldX, worldY) => {
      const x = Math.round(worldX - camX);
      const y = Math.round(worldY - camY);
      if (x < 0 || y < 0 || x >= viewW || y >= viewH) return WHITE;
      const index = (y * viewW + x) * RGBA;
      return Math.min(data[index], data[index + 1], data[index + 2]);
    },
  };
}

function roomCentre(room: RoomRegion): { x: number; y: number } {
  return {
    x: (room.bounds.x + room.bounds.w / 2) * TILE_SIZE,
    y: (room.bounds.y + room.bounds.h / 2) * TILE_SIZE,
  };
}

/** The room whose centre the ambient leaves darkest, unlit by any static light. */
function darkestRoom(gameMap: GameMap, lighting: DungeonLightingSystem): RoomRegion | null {
  let best: RoomRegion | null = null;
  let bestDark = 0;
  for (const room of gameMap.regionMap.rooms) {
    const cx = room.bounds.x + Math.floor(room.bounds.w / 2);
    const cy = room.bounds.y + Math.floor(room.bounds.h / 2);
    const dark = lighting.ambientDarknessAt(cx, cy) * (1 - lighting.staticLightAt(cx, cy));
    if (dark > bestDark) {
      bestDark = dark;
      best = room;
    }
  }
  return best;
}

function checkCrawlerLight(gameMap: GameMap, label: string): void {
  const clock = { ms: 0 };
  const lit = lightingFor(gameMap, clock);
  const room = darkestRoom(gameMap, lit);
  if (room === null) {
    notes.push(`${label}: no dark room to stand a crawler in`);
    return;
  }
  const centre = roomCentre(room);
  const crawler = { x: centre.x - TILE_SIZE * HALF, y: centre.y - TILE_SIZE * HALF };
  lit.addDynamicLightSource(
    partyLightSource({
      crawlers: () => [crawler],
      companions: () => [],
      crawlerReachTiles: (base) => lit.crawlerReachTiles(base),
    }),
  );
  const withLight = renderOnWhite(lit, centre).pixel(centre.x, centre.y);
  if (!lit.stats.dynamicKinds.has('crawler'))
    fail('crawler-light', `${label}: no crawler light drawn`);
  if (withLight < LIT_CHANNEL) {
    fail(
      'crawler-light',
      `${label}: a crawler in the darkest room stands at ${withLight}/255, not lit`,
    );
  }
  // Without the crawler's light the same spot must be dark, or the check above could not fail.
  const unlit = renderOnWhite(lightingFor(gameMap, clock), centre).pixel(centre.x, centre.y);
  if (unlit > DARK_CHANNEL) {
    fail(
      'crawler-light',
      `${label}: negative test: the darkest room's centre is ${unlit}/255 with no light`,
    );
  }
}

function checkBreaking(gameMap: GameMap, label: string): void {
  const clock = { ms: 0 };
  const lighting = lightingFor(gameMap, clock);
  // A prop-carried light: wall fixtures are broken through their own state,
  // which the fixture gate covers, and their tile is a wall that must not change.
  const torch = lighting
    .staticLightTiles()
    .find(
      (light) =>
        light.kind !== 'hearth' &&
        STATIC_LIGHT_FIXTURES.has(gameMap.structure[light.y][light.x].type),
    );
  if (torch === undefined) {
    fail('breaking', `${label}: no breakable light to break`);
    return;
  }
  const tile = gameMap.structure[torch.y][torch.x];
  const propType = tile.type;
  const centre = { x: (torch.x + HALF) * TILE_SIZE, y: (torch.y + HALF) * TILE_SIZE };
  const before = renderOnWhite(lighting, centre).pixel(centre.x, centre.y);

  // What `DestructiblePropSystem` does to a smashed prop's tile.
  const groundType = tile.groundType;
  tile.type = groundType ?? FloorTypeValue.concrete;
  lighting.update();
  if (lighting.isLightOnAt(torch.x, torch.y))
    fail('breaking', `${label}: a smashed ${torch.kind} is still lit`);
  clock.ms += LIGHT_DEATH_MS + 1;
  const after = renderOnWhite(lighting, centre).pixel(centre.x, centre.y);
  const ambient = lighting.ambientDarknessAt(torch.x, torch.y);
  if (ambient > 0 && lighting.staticLightAt(torch.x, torch.y) < 1 && after >= before) {
    fail(
      'breaking',
      `${label}: smashing the ${torch.kind} left its tile as bright (${after} vs ${before})`,
    );
  }

  tile.type = propType;
  lighting.update();
  if (!lighting.isLightOnAt(torch.x, torch.y)) {
    fail('breaking', `${label}: the ${torch.kind} stood back up but stayed dark`);
  }

  if (!lighting.removeStaticLight(torch.x, torch.y) || lighting.isLightOnAt(torch.x, torch.y)) {
    fail('breaking', `${label}: removeStaticLight did not put the light out`);
  }

  // A light whose prop is left standing must stay lit, or the checks above
  // would pass on a system that puts out every light it is asked about.
  const untouched = lightingFor(gameMap, clock);
  untouched.update();
  if (!untouched.isLightOnAt(torch.x, torch.y)) {
    fail('breaking', `${label}: negative test: a light whose prop still stands went out`);
  }
}

function checkSpiderLab(gameMap: GameMap, label: string): boolean {
  const lab = gameMap.regionMap.rooms.find((room) => room.role === 'spider_lab');
  if (lab === undefined) return false;
  const lighting = lightingFor(gameMap, { ms: 0 });
  const frame = renderOnWhite(lighting, roomCentre(lab));
  let darkened = 0;
  for (let y = lab.bounds.y; y < lab.bounds.y + lab.bounds.h; y++) {
    for (let x = lab.bounds.x; x < lab.bounds.x + lab.bounds.w; x++) {
      if (lighting.hasStaticLightAt(x, y))
        fail('spider-lab', `${label}: a static light at (${x},${y})`);
      const value = frame.pixel((x + HALF) * TILE_SIZE, (y + HALF) * TILE_SIZE);
      if (lighting.ambientDarknessAt(x, y) > 0 || value < WHITE) darkened++;
    }
  }
  if (darkened > 0) fail('spider-lab', `${label}: ${darkened} lab tiles darkened`);

  // The same pixel test over a dark room must find it darkened, or it could
  // not have caught a darkened lab.
  const dark = darkestRoom(gameMap, lighting);
  if (dark !== null) {
    const darkFrame = renderOnWhite(lighting, roomCentre(dark));
    const centre = roomCentre(dark);
    if (darkFrame.pixel(centre.x, centre.y) >= WHITE) {
      fail('spider-lab', `${label}: negative test: a dark room read as undarkened`);
    }
  }
  return true;
}

// ── Check: boss rooms ───────────────────────────────────────────────────────

/** The tiles of every boss fight's ground: each boss room, and the colosseum's drum. */
function bossFightRegions(
  gameMap: GameMap,
): Array<{ name: string; id: number; tiles: Array<{ x: number; y: number }> }> {
  const regions: Array<{ name: string; id: number; tiles: Array<{ x: number; y: number }> }> = [];
  for (const room of gameMap.regionMap.rooms) {
    if (room.role !== 'boss') continue;
    const tiles: Array<{ x: number; y: number }> = [];
    for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h; y++) {
      for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) tiles.push({ x, y });
    }
    regions.push({ name: `boss room ${room.id}`, id: room.id, tiles });
  }
  for (const hallway of gameMap.regionMap.hallways) {
    if (!hallway.arena) continue;
    regions.push({ name: `colosseum ${hallway.id}`, id: hallway.id, tiles: [...hallway.tiles] });
  }
  return regions;
}

/**
 * Lights a floor's boss rooms the way the scene does and checks they stay
 * fully lit: no ambient darkness and no darkened pixel on any tile, at least
 * one mood light each, and none of them in the spider lab.
 */
function checkBossRooms(gameMap: GameMap, level: number, label: string): number {
  const lighting = lightingFor(gameMap, { ms: 0 });
  const bossTypes = getLevelDef(`level${level}`).bossRooms?.map((room) => room.type) ?? [];
  registerBossRoomMoodLights(lighting, gameMap, bossTypes);
  const lights = lighting.staticLightTiles();
  const regions = bossFightRegions(gameMap);
  for (const region of regions) {
    const name = `${label} ${region.name}`;
    let darkened = 0;
    let sumX = 0;
    let sumY = 0;
    for (const tile of region.tiles) {
      sumX += tile.x;
      sumY += tile.y;
    }
    const focus = {
      x: (sumX / region.tiles.length + HALF) * TILE_SIZE,
      y: (sumY / region.tiles.length + HALF) * TILE_SIZE,
    };
    const frame = renderOnWhite(lighting, focus);
    for (const tile of region.tiles) {
      const value = frame.pixel((tile.x + HALF) * TILE_SIZE, (tile.y + HALF) * TILE_SIZE);
      if (lighting.ambientDarknessAt(tile.x, tile.y) > 0 || value < WHITE) darkened++;
    }
    if (darkened > 0) fail('boss-room', `${name}: ${darkened} tiles darkened`);
    const moodLights = lights.filter(
      (light) =>
        gameMap.regionAt(light.x, light.y) === region.id ||
        gameMap.regionAt(light.x, light.y + 1) === region.id,
    );
    if (moodLights.length === 0) fail('boss-room', `${name}: no mood light`);
    notes.push(`${name}: ${moodLights.map((light) => light.kind).join(', ')}`);
  }

  const lab = gameMap.regionMap.rooms.find((room) => room.role === 'spider_lab');
  if (lab !== undefined) {
    for (const light of lights) {
      const inLab =
        light.x >= lab.bounds.x - 1 &&
        light.y >= lab.bounds.y - 1 &&
        light.x <= lab.bounds.x + lab.bounds.w &&
        light.y <= lab.bounds.y + lab.bounds.h;
      if (inLab) fail('boss-room', `${label}: a ${light.kind} in or on the spider lab`);
    }
    const labCentre = {
      tileX: lab.bounds.x + Math.floor(lab.bounds.w / 2),
      tileY: lab.bounds.y + Math.floor(lab.bounds.h / 2),
    };
    const offered = { ...labCentre, kind: 'hanging_bulb', centre: { x: 0, y: 0 } } as const;
    if (lighting.registerMoodLight(offered)) {
      fail('boss-room', `${label}: the spider lab took a mood light`);
    }
  }

  // An ordinary room must refuse a mood light, and the same darkened-tile
  // test must find darkness in a dark room, or the checks above cannot fail.
  const ordinary = gameMap.regionMap.rooms.find((room) => room.role === 'regular');
  if (ordinary !== undefined) {
    const tile = {
      tileX: ordinary.bounds.x + Math.floor(ordinary.bounds.w / 2),
      tileY: ordinary.bounds.y + Math.floor(ordinary.bounds.h / 2),
    };
    if (lighting.registerMoodLight({ ...tile, kind: 'hanging_bulb' })) {
      fail('boss-room', `${label}: negative test: an ordinary room took a mood light`);
    }
  }
  const dark = darkestRoom(gameMap, lighting);
  if (dark !== null) {
    const centre = roomCentre(dark);
    if (renderOnWhite(lighting, centre).pixel(centre.x, centre.y) >= WHITE) {
      fail('boss-room', `${label}: negative test: a dark room read as undarkened`);
    }
  }
  return regions.length;
}

// ── Check: render order ─────────────────────────────────────────────────────

const SCENE_SOURCE_PATH = 'src/scenes/DungeonScene.ts';

function methodBody(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const end = source.indexOf('\n  }\n', start);
  return end < 0 ? null : source.slice(start, end);
}

/** Calls that must come after the darkness: every warning, bar, label and the HUD. */
const AFTER_DARKNESS = [
  'this.bossRoom.renderProjectiles(',
  'this.combat.floatingText.render(',
  'this.renderPipeline.renderEffects(',
  'this.renderPipeline.renderVisibilityFog(',
  'drawHUD(',
  'this.destruction.loot.render(',
];

function renderOrderErrors(source: string): string[] {
  const errors: string[] = [];
  const render = methodBody(source, '  render(ctx: CanvasRenderingContext2D): void {');
  const darkness = methodBody(source, '  private renderDungeonDarkness(');
  const build = methodBody(source, '  private buildDungeonLighting(');
  if (render === null || darkness === null || build === null) {
    return ['DungeonScene has lost render, renderDungeonDarkness or buildDungeonLighting'];
  }
  const at = (text: string, call: string): number => text.indexOf(call);
  const begin = at(render, 'beginAboveDarkness(');
  const entities = at(render, 'this.renderPipeline.renderEntities(');
  const dark = at(render, 'this.renderDungeonDarkness(ctx, rc)');
  if (begin < 0 || entities < 0 || dark < 0) return ['a render step is missing'];
  if (!(begin < entities && entities < dark)) {
    errors.push('deferral must open before the entity pass and the darkness come after it');
  }
  for (const call of AFTER_DARKNESS) {
    const index = at(render, call);
    if (index < 0) errors.push(`render() no longer calls ${call}`);
    else if (index < dark) errors.push(`${call} is drawn before the darkness`);
  }
  const passIndex = at(darkness, 'lighting.render(');
  const warnings = at(darkness, 'renderOverDarkness(');
  const flush = at(darkness, 'flushAboveDarkness(ctx)');
  if (passIndex < 0 || warnings < 0 || flush < 0 || !(passIndex < warnings && passIndex < flush)) {
    errors.push(
      'renderDungeonDarkness must draw the darkness before the warnings and held-back bars',
    );
  }
  if (at(build, 'partyLightSource(') < 0) errors.push('the crawlers no longer carry a light');
  return errors;
}

function checkRenderOrder(): void {
  const source = readFileSync(SCENE_SOURCE_PATH, 'utf8');
  for (const error of renderOrderErrors(source)) fail('order', error);
  // The darkness moved down past the effects pass and the fog must be caught.
  const darknessCall = '    this.renderDungeonDarkness(ctx, rc);\n';
  const fogCall = '    this.renderPipeline.renderVisibilityFog(ctx, rc);\n';
  const moved = source.replace(darknessCall, '').replace(fogCall, `${fogCall}${darknessCall}`);
  if (moved === source || renderOrderErrors(moved).length === 0) {
    fail('order', 'negative test: darkness drawn after the effects pass went unnoticed');
  }
}

function greenPixels(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  size: number,
): number {
  const data = ctx.getImageData(0, 0, size, size).data;
  let count = 0;
  for (let index = 0; index < data.length; index += RGBA) {
    const close =
      Math.abs(data[index] - HEALTH_BAR_GREEN.r) <= COLOUR_TOLERANCE &&
      Math.abs(data[index + 1] - HEALTH_BAR_GREEN.g) <= COLOUR_TOLERANCE &&
      Math.abs(data[index + 2] - HEALTH_BAR_GREEN.b) <= COLOUR_TOLERANCE;
    if (close) count++;
  }
  return count;
}

/** A hurt rat's health bar must wait for the flush, and appear with it. */
function checkHealthBarDeferral(): void {
  const SIZE = TILE_SIZE * HEALTH_BAR_CANVAS_TILES;
  const rat = new Rat(1, 2, TILE_SIZE);
  rat.healthBarTimer = 1000;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const game = asGameContext(ctx);

  beginAboveDarkness(() => 1);
  rat.render(game, 0, 0, TILE_SIZE);
  const during = greenPixels(ctx, SIZE);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  flushAboveDarkness(game);
  const after = greenPixels(ctx, SIZE);
  if (during > 0) fail('health-bar', `${during} health-bar pixels drawn inside the entity pass`);
  if (after === 0) fail('health-bar', 'the held-back health bar never drew after the darkness');

  // With nothing deferring, the bar draws at once: the check above can see one.
  ctx.clearRect(0, 0, SIZE, SIZE);
  rat.render(game, 0, 0, TILE_SIZE);
  if (greenPixels(ctx, SIZE) === 0)
    fail('health-bar', 'negative test: an undeferred bar was not seen');

  // A pass that throws between begin and flush skips the flush; the frame
  // boundary's close must still hand the next scene undeferred drawing.
  beginAboveDarkness(() => 1);
  closeAboveDarkness();
  ctx.clearRect(0, 0, SIZE, SIZE);
  rat.render(game, 0, 0, TILE_SIZE);
  if (greenPixels(ctx, SIZE) === 0)
    fail('health-bar', 'deferral stayed open after the frame closed it');
}

// ── Check: no hard edges, no snapping ───────────────────────────────────────

/** A small view for the edge checks, so a walk of many frames stays quick. */
const EDGE_VIEW_TILES_W = 20;
const EDGE_VIEW_TILES_H = 14;
/** Tiles walked either side of a doorway, and the step between frames in pixels. */
const WALK_TILES = 3;
const WALK_STEP_PX = 2;
/**
 * The most any one pixel of the darkness may change while the crawler's light
 * moves {@link WALK_STEP_PX}: the light's own falloff moves a few levels; a
 * clip snapping to a new region changes a pixel by the whole cap.
 */
const MAX_FRAME_STEP = 10;
/**
 * The most two neighbouring pixels may differ anywhere in a lit frame. Soft
 * falloff and a feathered wall-top fade stay well under it; a straight cut
 * of the dark or of a glow is a step of the full light.
 */
const MAX_NEIGHBOUR_STEP = 12;
/** The background a glow is judged against: mid grey, so an added glow shows. */
const MID_GREY = 128;

const WALL_STEP: Readonly<Record<RoomWall, { x: number; y: number }>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/** The lighting pass drawn over a flat background; one luminance byte per pixel. */
function renderFlat(
  lighting: DungeonLightingSystem,
  camX: number,
  camY: number,
  background: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = EDGE_VIEW_TILES_W * TILE_SIZE;
  const height = EDGE_VIEW_TILES_H * TILE_SIZE;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${background},${background},${background})`;
  ctx.fillRect(0, 0, width, height);
  lighting.render(asGameContext(ctx), camX, camY, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8ClampedArray(width * height);
  for (let index = 0; index < data.length; index++) {
    data[index] = Math.max(rgba[index * RGBA], rgba[index * RGBA + 1], rgba[index * RGBA + 2]);
  }
  return { data, width, height };
}

/**
 * The largest difference between horizontally or vertically adjacent pixels,
 * and where. Puddle tiles are skipped: a glint on water is a small, crisp
 * specular highlight by design, not the edge of a pool of light.
 */
function largestNeighbourStep(
  frame: { data: Uint8ClampedArray; width: number; height: number },
  gameMap: GameMap,
  camX: number,
  camY: number,
): {
  step: number;
  x: number;
  y: number;
} {
  let worst = { step: 0, x: 0, y: 0 };
  const { data, width, height } = frame;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tileX = Math.floor((camX + x) / TILE_SIZE);
      const tileY = Math.floor((camY + y) / TILE_SIZE);
      if (gameMap.isPuddleAt(tileX, tileY)) continue;
      const here = data[y * width + x];
      const step = Math.max(
        Math.abs(here - data[y * width + x + 1]),
        Math.abs(here - data[(y + 1) * width + x]),
      );
      if (step > worst.step) worst = { step, x, y };
    }
  }
  return worst;
}

/**
 * The darkest room with a doorway, for walking a light through it: a light
 * crossing from a dark room into a hall is where a hard edge would show most.
 */
function doorwayToWalk(
  gameMap: GameMap,
  lighting: DungeonLightingSystem,
): { room: RoomRegion; door: { x: number; y: number }; out: { x: number; y: number } } | null {
  let best: {
    room: RoomRegion;
    door: { x: number; y: number };
    out: { x: number; y: number };
  } | null = null;
  let bestDark = -1;
  for (const room of gameMap.regionMap.rooms) {
    if (room.role !== 'regular' && room.role !== 'chain') continue;
    if (room.doorways.length === 0) continue;
    const doorway = room.doorways[0];
    const dark = lighting.ambientDarknessAt(
      room.bounds.x + Math.floor(room.bounds.w / 2),
      room.bounds.y + Math.floor(room.bounds.h / 2),
    );
    if (dark <= bestDark) continue;
    bestDark = dark;
    best = { room, door: doorway.tile, out: WALL_STEP[doorway.wall] };
  }
  return best;
}

/**
 * Walks a crawler's light from inside a room, through its doorway, out into
 * the hall, a couple of pixels a frame, and fails on any frame where the dark
 * jumps or shows a hard line.
 */
function checkMovingLight(gameMap: GameMap, label: string): void {
  const clock = { ms: 0 };
  const lighting = lightingFor(gameMap, clock);
  const walk = doorwayToWalk(gameMap, lighting);
  if (walk === null) {
    notes.push(`${label}: no doorway to walk through`);
    return;
  }
  const position = { x: 0, y: 0 };
  lighting.addDynamicLightSource(
    partyLightSource({
      crawlers: () => [position],
      companions: () => [],
      crawlerReachTiles: (base) => lighting.crawlerReachTiles(base),
    }),
  );
  const startX = (walk.door.x - walk.out.x * WALK_TILES) * TILE_SIZE;
  const startY = (walk.door.y - walk.out.y * WALK_TILES) * TILE_SIZE;
  const camX = (walk.door.x - EDGE_VIEW_TILES_W / 2) * TILE_SIZE;
  const camY = (walk.door.y - EDGE_VIEW_TILES_H / 2) * TILE_SIZE;
  const steps = (WALK_TILES * 2 * TILE_SIZE) / WALK_STEP_PX;
  let previous: Uint8ClampedArray | null = null;
  let worstJump = { step: 0, at: 0 };
  let worstLine = { step: 0, x: 0, y: 0, at: 0 };
  for (let step = 0; step <= steps; step++) {
    position.x = startX + walk.out.x * step * WALK_STEP_PX;
    position.y = startY + walk.out.y * step * WALK_STEP_PX;
    const frame = renderFlat(lighting, camX, camY, WHITE);
    const line = largestNeighbourStep(frame, gameMap, camX, camY);
    if (line.step > worstLine.step) worstLine = { ...line, at: step };
    if (previous !== null) {
      for (let index = 0; index < frame.data.length; index++) {
        const jump = Math.abs(frame.data[index] - previous[index]);
        if (jump > worstJump.step) worstJump = { step: jump, at: step };
      }
    }
    previous = frame.data;
  }
  notes.push(
    `${label}: walking light — largest frame jump ${worstJump.step}, largest edge ${worstLine.step} at (${worstLine.x},${worstLine.y}) frame ${worstLine.at}`,
  );
  if (worstJump.step > MAX_FRAME_STEP) {
    fail(
      'moving-light',
      `${label}: the dark jumped by ${worstJump.step} in one ${WALK_STEP_PX}px step (frame ${worstJump.at})`,
    );
  }
  if (worstLine.step > MAX_NEIGHBOUR_STEP) {
    fail(
      'moving-light',
      `${label}: a hard line of ${worstLine.step} at (${worstLine.x},${worstLine.y}) on frame ${worstLine.at}`,
    );
  }
}

/** Static lights with their glows, framed on a lit torch, must fall off without a straight cut. */
function checkStaticEdges(gameMap: GameMap, label: string): void {
  const lighting = lightingFor(gameMap, { ms: 0 });
  const torch = lighting
    .staticLightTiles()
    .find((light) => light.kind === 'wall_sconce' || light.kind === 'standing_torch');
  if (torch === undefined) return;
  const camX = (torch.x - EDGE_VIEW_TILES_W / 2) * TILE_SIZE;
  const camY = (torch.y - EDGE_VIEW_TILES_H / 2) * TILE_SIZE;
  const line = largestNeighbourStep(
    renderFlat(lighting, camX, camY, MID_GREY),
    gameMap,
    camX,
    camY,
  );
  notes.push(`${label}: torch-lit frame — largest edge ${line.step}`);
  if (line.step > MAX_NEIGHBOUR_STEP) {
    fail(
      'static-edges',
      `${label}: a hard line of ${line.step} near the ${torch.kind} at (${torch.x},${torch.y})`,
    );
  }
}

// ── Check: eye-shine sits on the head ───────────────────────────────────────

interface Facing {
  readonly x: number;
  readonly y: number;
}

const FACINGS: ReadonlyArray<Facing> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

interface EyeSubject {
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  isMoving: boolean;
  eyeShineAnchor(out: { x: number; y: number; spacingPx: number }): boolean;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}

/** Pixels a tile spans when a creature is drawn for the eye check: big enough to find a head. */
const EYE_CHECK_SCALE = 3;
/** Tiles of canvas round the creature's own tile, for art that reaches past it. */
const EYE_CHECK_MARGIN_TILES = 2;
/** Alpha above which a pixel is the creature's body rather than a soft shadow or glow. */
const BODY_ALPHA = 160;
/** How far down the drawn body the eyes may sit, as a share of its height: the head end. */
const HEAD_SHARE_OF_HEIGHT = 0.45;
/**
 * The top share of the drawn body whose width a profile's eyes are judged
 * against: the head end, above a weapon or a bow held out in front.
 */
const HEAD_ROWS_SHARE = 0.3;
/** How far outside a profile's head end the eyes may sit, as a share of its width. */
const PROFILE_BACK_SLACK = 0.05;

/** The box round a creature's drawn body, in world pixels, or null when nothing was drawn. */
interface BodyBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The horizontal extent of the top {@link HEAD_ROWS_SHARE} of the body. */
  headLeft: number;
  headRight: number;
}

function bodyBox(subject: EyeSubject): BodyBox | null {
  const tiles = 1 + EYE_CHECK_MARGIN_TILES * 2;
  const size = tiles * TILE_SIZE * EYE_CHECK_SCALE;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.scale(EYE_CHECK_SCALE, EYE_CHECK_SCALE);
  const camX = subject.x - EYE_CHECK_MARGIN_TILES * TILE_SIZE;
  const camY = subject.y - EYE_CHECK_MARGIN_TILES * TILE_SIZE;
  subject.render(asGameContext(ctx), camX, camY, TILE_SIZE);
  const data = ctx.getImageData(0, 0, size, size).data;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * RGBA + RGBA - 1] < BODY_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (left > right) return null;
  const headBottom = top + (bottom - top) * HEAD_ROWS_SHARE;
  let headLeft = Infinity;
  let headRight = -Infinity;
  for (let y = top; y <= headBottom; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * RGBA + RGBA - 1] < BODY_ALPHA) continue;
      headLeft = Math.min(headLeft, x);
      headRight = Math.max(headRight, x);
    }
  }
  return {
    left: camX + left / EYE_CHECK_SCALE,
    right: camX + right / EYE_CHECK_SCALE,
    top: camY + top / EYE_CHECK_SCALE,
    bottom: camY + bottom / EYE_CHECK_SCALE,
    headLeft: camX + headLeft / EYE_CHECK_SCALE,
    headRight: camX + headRight / EYE_CHECK_SCALE,
  };
}

/**
 * What is wrong with a creature's eyes at a facing, judged against the body
 * it actually draws: shown while it faces away, missing while it faces the
 * camera, off its body, low on its body, or on the back end of a profile.
 */
function eyeErrors(subject: EyeSubject, facing: Facing, headEnd: HeadEnd = 'top'): string | null {
  subject.facingX = facing.x;
  subject.facingY = facing.y;
  subject.isMoving = false;
  const eyes = { x: 0, y: 0, spacingPx: 0 };
  const shown = subject.eyeShineAnchor(eyes);
  if (facing.y < 0) return shown ? 'eyes shown while facing away' : null;
  if (!shown) return 'no eyes while facing the camera';
  const box = bodyBox(subject);
  if (box === null) return 'nothing drawn';
  if (eyes.x < box.left || eyes.x > box.right || eyes.y < box.top || eyes.y > box.bottom) {
    return 'eyes off the body';
  }
  const height = box.bottom - box.top;
  const headDepth = headEnd === 'top' ? eyes.y - box.top : box.bottom - eyes.y;
  if (headDepth > height * HEAD_SHARE_OF_HEIGHT) return 'eyes away from the head end of the body';
  if (facing.x !== 0 && headEnd === 'top') {
    const margin = (box.headRight - box.headLeft) * PROFILE_BACK_SLACK;
    if (eyes.x < box.headLeft - margin || eyes.x > box.headRight + margin) {
      return 'eyes beside the head end, not on it';
    }
  }
  return null;
}

/** The brindle grub's last stage, the flying vespa. */
const VESPA_STAGE: GrubStage = 3;

function grubAt(stage: GrubStage): () => EyeSubject {
  return () => {
    const grub = new BrindleGrub(0, 0, TILE_SIZE);
    grub.stage = stage;
    return grub;
  };
}

/**
 * Which end of a creature's drawn body its head is at: the top for anything
 * standing or flying, the bottom for a grub seen from above, head down.
 */
type HeadEnd = 'top' | 'bottom';

/** Every floor-1 and floor-2 hostile that can stand in a dark room, with its own silhouette. */
const EYE_CREATURES: ReadonlyArray<readonly [string, () => EyeSubject, HeadEnd?]> = [
  ['llama', () => new Llama(0, 0, TILE_SIZE)],
  ['rat', () => new Rat(0, 0, TILE_SIZE)],
  ['goblin', () => new Goblin(0, 0, TILE_SIZE, 'mace')],
  ['goblin archer', () => new GoblinArcher(0, 0, TILE_SIZE)],
  ['troglodyte', () => new Troglodyte(0, 0, TILE_SIZE)],
  ['brindle grub', grubAt(1)],
  ['cow-tailed grub', grubAt(2), 'bottom'],
  ['brindled vespa', grubAt(VESPA_STAGE)],
  ['ice fairy', () => new IceFairy(0, 0, TILE_SIZE)],
  ['fire fairy', () => new FireFairy(0, 0, TILE_SIZE)],
  ['necro fairy', () => new NecroFairy(0, 0, TILE_SIZE)],
  ['shield fairy', () => new ShieldFairy(0, 0, TILE_SIZE)],
  ['healing fairy', () => new HealingFairy(0, 0, TILE_SIZE)],
];

const EYE_CHECK_TILE = 4;

/** A llama whose eyes are pinned to the middle of its tile, for the negative test. */
class CentredEyesLlama extends Llama {
  override eyeShineAnchor(out: { x: number; y: number; spacingPx: number }): boolean {
    out.x = this.x + TILE_SIZE * HALF;
    out.y = this.y + TILE_SIZE * HALF;
    return true;
  }
}

function checkEyeShine(): void {
  for (const [name, make, headEnd] of EYE_CREATURES) {
    for (const facing of FACINGS) {
      const subject = make();
      subject.x = EYE_CHECK_TILE * TILE_SIZE;
      subject.y = EYE_CHECK_TILE * TILE_SIZE;
      const error = eyeErrors(subject, facing, headEnd);
      if (error !== null) fail('eye-shine', `${name} facing (${facing.x},${facing.y}): ${error}`);
    }
  }
  // Eyes fixed to the middle of the tile whatever the facing sit on a llama's
  // rump and a fairy's chest, and must be caught.
  const fixed = new CentredEyesLlama(EYE_CHECK_TILE, EYE_CHECK_TILE, TILE_SIZE);
  if (FACINGS.every((facing) => eyeErrors(fixed, facing) === null)) {
    fail('eye-shine', 'negative test: eyes fixed to the middle of the tile went unnoticed');
  }
}

// ── Check: flicker swings as far as it is tuned to ──────────────────────────

/** Moments the flicker is sampled at, and how far apart. */
const FLICKER_SAMPLES = 40;
const FLICKER_STEP_MS = 37;
/** The share of the tuned swing a flame must at least show; a multiplied-away flicker shows a fifth. */
const MIN_FLICKER_SHARE_SHOWN = 0.6;
const FLAME_KINDS = new Set(['standing_torch', 'wall_sconce', 'brazier', 'candle_cluster']);

/**
 * A flame's own tile must dim and brighten by about the share of its cut its
 * flicker is tuned to move, against the darkness round it.
 */
function checkFlicker(gameMap: GameMap, label: string): void {
  const clock = { ms: 0 };
  // The darkness alone: an added glow on a white page would saturate and hide the swing.
  const lighting = lightingFor(gameMap, clock, false);
  let flame: { x: number; y: number; kind: string } | null = null;
  let darkest = 0;
  for (const light of lighting.staticLightTiles()) {
    if (!FLAME_KINDS.has(light.kind)) continue;
    const geometry = lighting.staticLightGeometry(light.x, light.y);
    if (geometry === null) continue;
    const dark = lighting.ambientDarknessAt(geometry.emitterX, geometry.emitterY);
    if (dark > darkest) {
      darkest = dark;
      flame = light;
    }
  }
  if (flame === null) return;
  const geometry = lighting.staticLightGeometry(flame.x, flame.y);
  if (geometry === null) return;
  const profile =
    flame.kind === 'brazier' ? 'brazier' : flame.kind === 'candle_cluster' ? 'candle' : 'flame';
  const share = FLICKER_SHARE[profile];
  const centre = {
    x: (geometry.emitterX + HALF) * TILE_SIZE,
    y: (geometry.emitterY + HALF) * TILE_SIZE,
  };
  let lightest = 0;
  let dimmest = WHITE;
  // Over a short sample the two groups' phases cover different stretches of
  // their curve, so the swing expected is the one this light's own group made.
  let flickerLow = 1;
  let flickerHigh = 0;
  for (let sample = 0; sample < FLICKER_SAMPLES; sample++) {
    clock.ms = sample * FLICKER_STEP_MS;
    const value = renderOnWhite(lighting, centre).pixel(centre.x, centre.y);
    lightest = Math.max(lightest, value);
    dimmest = Math.min(dimmest, value);
    const f = flickerValue(profile, geometry.flickerGroup, clock.ms);
    flickerLow = Math.min(flickerLow, f);
    flickerHigh = Math.max(flickerHigh, f);
  }
  const flickerRange = flickerHigh - flickerLow;
  // The dark the flame cuts into, read with the flame put out: the ambient as
  // drawn, less whatever its neighbours already cut there.
  lighting.removeStaticLight(flame.x, flame.y);
  clock.ms += LIGHT_DEATH_MS + POWER_DOWN_MS;
  const behind = WHITE - renderOnWhite(lighting, centre).pixel(centre.x, centre.y);
  const tuned = behind * share * flickerRange;
  const shown = lightest - dimmest;
  notes.push(
    `${label}: ${flame.kind} flicker swings ${shown}, tuned for about ${Math.round(tuned)}`,
  );
  if (shown < tuned * MIN_FLICKER_SHARE_SHOWN) {
    fail(
      'flicker',
      `${label}: the ${flame.kind} at (${flame.x},${flame.y}) swings ${shown}, tuned for ${Math.round(tuned)}`,
    );
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

await loadGameSpritesInNode();
checkOneTileWall();
checkRenderOrder();
checkHealthBarDeferral();
checkEyeShine();
checkBackfaces();
let labsSeen = 0;
let bossRegionsSeen = 0;
for (const level of FLOORS) {
  for (const seed of SEEDS) {
    const label = `floor ${level} seed ${seed}`;
    const gameMap = buildFloor(level, seed);
    const lighting = lightingFor(gameMap, { ms: 0 });
    checkCookieSight(gameMap, lighting, label);
    checkCrawlerLight(gameMap, label);
    checkBreaking(gameMap, label);
    if (checkSpiderLab(gameMap, label)) labsSeen++;
    bossRegionsSeen += checkBossRooms(gameMap, level, label);
    checkMovingLight(gameMap, label);
    checkStaticEdges(gameMap, label);
    checkFlicker(gameMap, label);
  }
}
if (labsSeen === 0) fail('spider-lab', 'no generated floor had a spider lab to check');
notes.push(`spider labs checked: ${labsSeen}`);
if (bossRegionsSeen === 0) fail('boss-room', 'no generated floor had a boss room to check');
notes.push(`boss fight regions checked: ${bossRegionsSeen}`);

for (const note of notes) console.log(note);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('verify-dungeon-lighting: all checks passed');
