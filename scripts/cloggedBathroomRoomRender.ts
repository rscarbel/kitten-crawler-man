/**
 * The room half of `render:clogged-bathroom`: the bathroom as the game draws it
 * and the fittings one at a time.
 *
 *  - `room`: one copy of the room off a real floor-2 map, broken (the line, the
 *    plumber, the signs, the drips, the pipe panel highlighted), briefed (the
 *    same with the objective beam over the pipe wall) and fixed (the goblins
 *    loitering, a stall in use, the sinks running), lit as the game
 *    lights it, at in-game size and at twice that.
 *  - `stalls`: the stall in every door and tag state, the pipe panel broken,
 *    fixed and highlighted, and the sink dry and running, at in-game size and
 *    blown up without smoothing.
 *  - `plumber`: the plumber at in-game size beside a queue goblin on the
 *    washroom floor.
 *
 * The sprites and the painted sheets are loaded only when one of these sections
 * is asked for, so a board-only run does not pay for them.
 */

import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { bakePropFamily } from './propSheetBake.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { GameMap } from '../src/map/GameMap.js';
import { renderCanvas } from '../src/map/TileRenderer.js';
import type { BathroomRoomData } from '../src/map/bathroomLayout.js';
import type { Point, Rect } from '../src/map/roomDoorways.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { setDungeonFloorTheme } from '../src/map/dungeon/floorTheme.js';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem.js';
import { CRAWLER_LIGHT_REACH_TILES } from '../src/systems/lighting/lightKinds.js';
import { setViewportSize } from '../src/core/rendering/Viewport.js';
import { PIPE_WALL_BEACON_FOOTPRINT } from '../src/systems/cloggedBathroom/CloggedBathroomSystem.js';
import { drawObjectiveBeacon } from '../src/ui/ObjectiveBeacon.js';
import { worldPalette } from '../src/ui/theme/worldInk.js';
import { bathroomSheetPlans } from '../src/sprites/sheets/bathroomSheets.js';
import {
  bathroomSinkSpots,
  drawBathroomRoomFixtures,
  drawBathroomSink,
  drawBathroomSinkWater,
  drawBathroomStall,
  drawPipeWall,
  type BathroomRoomLook,
  type BathroomStallLook,
} from '../src/sprites/bathroomRoomSprites.js';
import {
  drawGoblinPlumberSprite,
  drawGoblinSprite,
  type GoblinArchetype,
} from '../src/sprites/goblinSprite.js';

const OUT_DIR = `${PREVIEW_DIR}/clogged-bathroom`;
const SECTION_NAMES = ['room', 'stalls', 'plumber'] as const;
/** A floor-2 layout known to seat its bathrooms with every doorway kind; any seed would do. */
const DEFAULT_ROOM_SEED = 7;
/** Tiles of corridor shown round the room, and the extra rows above it for the stall faces. */
const ROOM_PADDING_TILES = 2;
const FACE_ROWS = 2;
const ZOOM = 2;
const STRIP_ZOOM = 4;
/** Caught with one drip mid-fall and the other swelling on the joint. */
const SNAPSHOT_SECONDS = 0.55;
const LIGHTING_CLOCK_MS = 0;
const QUEUE_ARCHETYPES: ReadonlyArray<GoblinArchetype> = [
  'sword',
  'axe',
  'mace',
  'bow',
  'warhammer',
];
/** Every few goblins in line is caught mid fidget rather than stood still. */
const FIDGET_EVERY = 3;
const IDLE_FRAMES = 4;
/** How many goblins still hang about the room after the fix, for the fixed picture. */
const LOITERERS = 8;
/** The stall the fixed picture shows in use, and the one standing open. */
const OCCUPIED_STALL = 1;
const OPEN_STALL = 2;
const STRIP_BACKDROP = '#20262a';
const STRIP_FLOOR = '#aab2af';
const STRIP_GAP_TILES = 0.5;
/** The pipe panel broken, fixed and highlighted, then the sink dry and running. */
const PIPE_WALL_LOOKS = 3;
const SINK_LOOKS = 2;

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

function wanted(): boolean {
  const only = flag('only');
  return only === null || SECTION_NAMES.some((name) => name === only);
}

if (wanted()) await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

function write(name: string, canvas: Canvas): string {
  return writePreviewPng(`${OUT_DIR}/${name}.png`, canvas.toBuffer('image/png'));
}

/** A nearest-neighbour blow-up, so the in-game pixels can be judged. */
function zoomed(source: Canvas, zoom: number): Canvas {
  const out = createCanvas(source.width * zoom, source.height * zoom);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

// ── The room ────────────────────────────────────────────────────────────────

interface SortedDraw {
  readonly sortY: number;
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
}

function buildMap(): GameMap {
  const levelDef = getLevelDef('level2');
  setDungeonFloorTheme(levelDef.groundTheme ?? 'service_level');
  const seed = Number(flag('room-seed') ?? DEFAULT_ROOM_SEED);
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    artSeed: FLOOR_ART_SEEDS[0],
    worldSeed: seed,
  });
}

function roomView(room: BathroomRoomData): Rect {
  const { bounds } = room;
  return {
    x: bounds.x - ROOM_PADDING_TILES,
    y: bounds.y - ROOM_PADDING_TILES - FACE_ROWS,
    w: bounds.w + ROOM_PADDING_TILES * 2,
    h: bounds.h + ROOM_PADDING_TILES * 2 + FACE_ROWS,
  };
}

function facingAlong(from: Point, to: Point | undefined): number {
  if (to === undefined || to.x === from.x) return 1;
  return to.x > from.x ? 1 : -1;
}

function goblinDraw(
  tile: Point,
  index: number,
  facingX: number,
  camX: number,
  camY: number,
): SortedDraw {
  const fidget = index % FIDGET_EVERY === 0;
  return {
    sortY: (tile.y + 1) * TILE_SIZE,
    draw: (ctx) =>
      drawGoblinSprite(ctx, {
        archetype: QUEUE_ARCHETYPES[index % QUEUE_ARCHETYPES.length],
        x: tile.x * TILE_SIZE - camX,
        y: tile.y * TILE_SIZE - camY,
        tileSize: TILE_SIZE,
        facingX,
        state: fidget ? 'idle_break' : 'idle',
        frame: index % IDLE_FRAMES,
      }),
  };
}

function bodies(room: BathroomRoomData, broken: boolean, camX: number, camY: number): SortedDraw[] {
  const draws: SortedDraw[] = [];
  const plumber = room.plumberTile;
  draws.push({
    sortY: (plumber.y + 1) * TILE_SIZE,
    draw: (ctx) =>
      drawGoblinPlumberSprite(ctx, {
        x: plumber.x * TILE_SIZE - camX,
        y: plumber.y * TILE_SIZE - camY,
        tileSize: TILE_SIZE,
        facingX: 1,
        state: 'idle',
        frame: 0,
      }),
  });
  if (broken) {
    // Each goblin in line faces the one ahead of it, as the queue stands.
    const line = room.queueTiles;
    line.forEach((tile, index) => {
      draws.push(
        goblinDraw(tile, index, facingAlong(tile, line[index - 1] ?? plumber), camX, camY),
      );
    });
    room.doorwayKnots.flat().forEach((tile, index) => {
      draws.push(goblinDraw(tile, index + line.length, index % 2 === 0 ? 1 : -1, camX, camY));
    });
  } else {
    room.loiterTiles.slice(0, LOITERERS).forEach((tile, index) => {
      draws.push(goblinDraw(tile, index, index % 2 === 0 ? 1 : -1, camX, camY));
    });
  }
  return draws;
}

/**
 * The room as the player meets it (`broken`), once the plumber has sent them
 * to the pipes (`briefed`, with the objective beam over the pipe wall), and
 * with the plumbing fixed.
 */
type RoomState = 'broken' | 'briefed' | 'fixed';
const ROOM_STATES: readonly RoomState[] = ['broken', 'briefed', 'fixed'];

function renderRoom(gameMap: GameMap, room: BathroomRoomData, state: RoomState): Canvas {
  const broken = state !== 'fixed';
  const beam = (target: CanvasRenderingContext2D): void => {
    if (state !== 'briefed') return;
    const stand = room.pipeWallStandTile;
    drawObjectiveBeacon(
      target,
      stand.x * TILE_SIZE - camX,
      stand.y * TILE_SIZE - camY,
      TILE_SIZE,
      worldPalette.ink.gold,
      LIGHTING_CLOCK_MS,
      PIPE_WALL_BEACON_FOOTPRINT,
    );
  };
  const view = roomView(room);
  const camX = view.x * TILE_SIZE;
  const camY = view.y * TILE_SIZE;
  const viewW = view.w * TILE_SIZE;
  const viewH = view.h * TILE_SIZE;
  gameMap.setBathroomPlumbing(broken ? 'broken' : 'fixed');
  const canvas = createCanvas(viewW, viewH);
  const ctx = asGameContext(canvas.getContext('2d'));
  setViewportSize(viewW, viewH);
  renderCanvas(ctx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

  const stalls: BathroomRoomLook['stalls'] = broken
    ? undefined
    : room.stallDoorTiles.map((_, index) =>
        index === OCCUPIED_STALL
          ? { door: 'shut', tag: 'occupied' }
          : index === OPEN_STALL
            ? { door: 'open', tag: 'vacant' }
            : { door: 'shut', tag: 'vacant' },
      );
  drawBathroomRoomFixtures(ctx, room, camX, camY, TILE_SIZE, {
    plumbing: broken ? 'broken' : 'fixed',
    stalls,
    pipeWallHighlighted: broken,
    timeSeconds: SNAPSHOT_SECONDS,
  });
  // Every body in the room stands south of the pipe wall, so drawing the beam
  // ahead of all of them matches the game's Y-sorted pass here.
  beam(ctx);

  const decorations: SortedDraw[] = gameMap
    .getVisibleDecorationTiles(camX, camY, viewW, viewH)
    .map((deco) => ({
      sortY: deco.ty * TILE_SIZE + deco.sortYAnchorPx,
      draw: (target) => gameMap.drawDecorationAt(target, deco.tx, deco.ty, camX, camY),
    }));
  // Just after the sink it runs into, on the same foot line.
  const sinkWater: SortedDraw[] = bathroomSinkSpots(gameMap.structure, room).map((spot) => ({
    sortY: (spot.tile.y + 1) * TILE_SIZE,
    draw: (target) =>
      drawBathroomSinkWater(
        target,
        spot.tile.x * TILE_SIZE - camX,
        spot.tile.y * TILE_SIZE - camY,
        TILE_SIZE,
        { side: spot.side, running: !broken, timeSeconds: SNAPSHOT_SECONDS },
      ),
  }));
  const sorted = [...decorations, ...sinkWater, ...bodies(room, broken, camX, camY)].sort(
    (a, b) => a.sortY - b.sortY,
  );
  for (const entry of sorted) entry.draw(ctx);

  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => LIGHTING_CLOCK_MS,
    additiveGlows: () => true,
  });
  const crawler = room.entranceTile;
  lighting.addDynamicLightSource({
    collectLights: (sink) =>
      sink.add(
        (crawler.x + HALF_TILE) * TILE_SIZE,
        (crawler.y + HALF_TILE) * TILE_SIZE,
        'crawler',
        1,
        CRAWLER_LIGHT_REACH_TILES,
      ),
  });
  lighting.render(ctx, camX, camY, viewW, viewH);
  lighting.renderOverDarkness(ctx, 1, { paintOverDarkness: beam });
  return canvas;
}

const HALF_TILE = 0.5;

const roomSection = {
  name: 'room',
  render: (): readonly string[] => {
    const gameMap = buildMap();
    if (gameMap.bathroomRooms.length === 0)
      throw new Error('render:clogged-bathroom: this map seats no bathroom');
    const room = gameMap.bathroomRooms[0];
    const written: string[] = [];
    for (const state of ROOM_STATES) {
      const canvas = renderRoom(gameMap, room, state);
      written.push(write(`room-${state}`, canvas));
      written.push(write(`room-${state}-${ZOOM}x`, zoomed(canvas, ZOOM)));
    }
    return written;
  },
};

// ── The fittings one at a time ──────────────────────────────────────────────

const STALL_LOOKS: ReadonlyArray<{ readonly name: string; readonly look: BathroomStallLook }> = [
  { name: 'out-of-order', look: { door: 'shut', tag: 'vacant', outOfOrder: true } },
  { name: 'shut-vacant', look: { door: 'shut', tag: 'vacant', outOfOrder: false } },
  { name: 'shut-occupied', look: { door: 'shut', tag: 'occupied', outOfOrder: false } },
  { name: 'open-vacant', look: { door: 'open', tag: 'vacant', outOfOrder: false } },
  { name: 'open-occupied', look: { door: 'open', tag: 'occupied', outOfOrder: false } },
];

/** One row of fittings on a strip of floor, each standing on its own anchor tile. */
function fittingsStrip(): Canvas {
  const stallTiles = STALL_LOOKS.length * (2 + STRIP_GAP_TILES);
  const otherTiles = (1 + STRIP_GAP_TILES) * (PIPE_WALL_LOOKS + SINK_LOOKS);
  const widthTiles = Math.ceil(stallTiles + otherTiles + STRIP_GAP_TILES);
  const floorRow = 2;
  const canvas = createCanvas(widthTiles * TILE_SIZE, (floorRow + 2) * TILE_SIZE);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = STRIP_BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = STRIP_FLOOR;
  ctx.fillRect(0, floorRow * TILE_SIZE, canvas.width, canvas.height);
  const floorY = floorRow * TILE_SIZE;
  let x = STRIP_GAP_TILES * TILE_SIZE;
  for (const { look } of STALL_LOOKS) {
    drawBathroomStall(ctx, x, floorY, TILE_SIZE, look);
    x += (2 + STRIP_GAP_TILES) * TILE_SIZE;
  }
  for (const [broken, highlighted] of [
    [true, false],
    [false, false],
    [true, true],
  ] as const) {
    drawPipeWall(ctx, x, floorY, TILE_SIZE, { broken, highlighted, timeSeconds: SNAPSHOT_SECONDS });
    x += (1 + STRIP_GAP_TILES) * TILE_SIZE;
  }
  for (const running of [false, true]) {
    drawBathroomSink(ctx, x, floorY, TILE_SIZE, {
      side: 'west',
      running,
      timeSeconds: SNAPSHOT_SECONDS,
    });
    x += (1 + STRIP_GAP_TILES) * TILE_SIZE;
  }
  return canvas;
}

const stallsSection = {
  name: 'stalls',
  render: (): readonly string[] => {
    const problems = bakePropFamily('clogged_bathroom', bathroomSheetPlans());
    if (problems.length > 0) {
      throw new Error(
        `render:clogged-bathroom: the bathroom sheets fail:\n  ${problems.join('\n  ')}`,
      );
    }
    const strip = fittingsStrip();
    return [write('fittings', strip), write(`fittings-${STRIP_ZOOM}x`, zoomed(strip, STRIP_ZOOM))];
  },
};

const plumberSection = {
  name: 'plumber',
  render: (): readonly string[] => {
    const widthTiles = 4;
    const heightTiles = 3;
    const canvas = createCanvas(widthTiles * TILE_SIZE, heightTiles * TILE_SIZE);
    const ctx = asGameContext(canvas.getContext('2d'));
    ctx.fillStyle = STRIP_FLOOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const footRow = 1;
    drawGoblinPlumberSprite(ctx, {
      x: TILE_SIZE,
      y: footRow * TILE_SIZE,
      tileSize: TILE_SIZE,
      facingX: 1,
      state: 'idle',
      frame: 0,
    });
    drawGoblinSprite(ctx, {
      archetype: 'sword',
      x: 2 * TILE_SIZE,
      y: footRow * TILE_SIZE,
      tileSize: TILE_SIZE,
      facingX: -1,
      state: 'idle',
      frame: 0,
    });
    return [write('plumber', canvas), write(`plumber-${STRIP_ZOOM}x`, zoomed(canvas, STRIP_ZOOM))];
  },
};

/** The room's sections, in the order `render:clogged-bathroom` runs them. */
export const BATHROOM_ROOM_SECTIONS = [roomSection, stallsSection, plumberSection];
