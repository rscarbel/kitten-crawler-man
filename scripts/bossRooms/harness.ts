/**
 * Shared machinery for the boss-room render harness and its gates.
 *
 * Every room is judged on a real generated floor: the generator decides where
 * the room sits and which wall its doorway breaks through, and a template that
 * only ever met a hand-built room has never met the rooms that ship. A floor is
 * reproduced from its world seed, so a failing seed can be rendered again.
 *
 * Each room's own knowledge — how to find it, which systems dress it, how to
 * drive it into a fight state, and its extra gates — lives in its own module
 * beside this one (`hoarder.ts`, `juicer.ts`, …), so each room can change
 * without touching the others.
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../../src/core/constants.js';
import { EventBus } from '../../src/core/EventBus.js';
import { setViewportSize } from '../../src/core/Viewport.js';
import { CatPlayer } from '../../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { getLevelDef } from '../../src/levels/index.js';
import { dungeonOptionsForLevel } from '../../src/levels/dungeonOptions.js';
import type { LevelDef } from '../../src/levels/types.js';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  setDungeonFloorTheme,
} from '../../src/map/dungeon/floorTheme.js';
import { GameMap } from '../../src/map/GameMap.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import type {
  BossRoomDressing,
  DressingRenderable,
} from '../../src/systems/bossRooms/BossRoomDressing.js';
import { buildGauntletRoomDressings } from '../../src/systems/bossRooms/BossRoomDressings.js';
import {
  approachLaneTiles,
  findBossRoomDoorways,
  spawnClearTiles,
  type BossRoomDoorway,
  type DoorSide,
  type TilePoint,
  type TileRect,
} from '../../src/systems/bossRooms/bossRoomLayout.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import type { BossRoomAssetGroup } from '../../src/sprites/sheets/bossRoomSheets.js';
import type { FrameEdge } from '../../src/sprites/sheets/propSheetPlan.js';
import { asGameContext, type NodeContext } from '../nodeGameContext.js';

export const BOSS_ROOM_IDS = ['hoarder', 'juicer', 'krakaren', 'spider', 'swine'] as const;
export type BossRoomId = (typeof BOSS_ROOM_IDS)[number];

export const BOSS_ROOM_STATES = [
  'pre',
  'sealed',
  'enraged',
  'phase2',
  'phase3',
  'defeated',
] as const;
export type BossRoomState = (typeof BOSS_ROOM_STATES)[number];

export const DOOR_SIDES: readonly DoorSide[] = ['south', 'north', 'east', 'west'];

export function isBossRoomId(value: string): value is BossRoomId {
  return BOSS_ROOM_IDS.some((id) => id === value);
}

export function isBossRoomState(value: string): value is BossRoomState {
  return BOSS_ROOM_STATES.some((state) => state === value);
}

export function isDoorSide(value: string): value is DoorSide {
  return DOOR_SIDES.some((side) => side === value);
}

/** The dungeon floors the five rooms live on. */
export type BossFloor = 1 | 2;

/** A boss room found on a generated floor. */
export interface LocatedRoom {
  readonly bounds: TileRect;
  /** Where the boss stands when the fight starts. */
  readonly spawn: TilePoint;
  /** Every doorway, the one a template is keyed to first. */
  readonly doorways: readonly BossRoomDoorway[];
  readonly doorSide: DoorSide;
  /** The tiles that count as the room's floor area, walls excluded. */
  readonly interior: readonly TilePoint[];
}

/** The tiles a room's layout must leave open, per the layout contract every room shares. */
export interface RoomInvariantTiles {
  /** A clear approach from every doorway. */
  readonly approach: readonly TilePoint[];
  /** A clear disc around the boss's spawn. */
  readonly spawnDisc: readonly TilePoint[];
}

/** The live pieces of a room a render or a gate draws and drives. */
export interface RoomUnderTest {
  /** Advances the room one frame. */
  update(): void;
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  /** Live objects merged into the Y-sorted pass with the map's own decorations. */
  renderEntities(): ReadonlyArray<DressingRenderable>;
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  /**
   * Puts the room into `state` as the fight would, without a fight. Returns false
   * when the room has no such state, so the caller skips it rather than
   * rendering a picture labelled with a state it does not show.
   */
  driveToState(state: BossRoomState): boolean;
}

/** What a room module is handed to build its room. */
export interface RoomEnvironment {
  readonly gameMap: GameMap;
  readonly levelDef: LevelDef;
  readonly room: LocatedRoom;
  readonly frame: SystemContext;
  readonly bus: EventBus;
}

/** Collects failures for one room's gates, tagged with the seed that produced them. */
export interface GateReport {
  fail(message: string): void;
  /** Records a measured value, printed beside the verdicts so a regression can be seen coming. */
  note(message: string): void;
}

/** What a room module's own gates are handed for one generated floor. */
export interface RoomGateContext {
  readonly env: RoomEnvironment;
  readonly roomUnderTest: RoomUnderTest;
  readonly seed: number;
  readonly report: GateReport;
}

/**
 * Everything the harness knows about one boss room. One module per room; the
 * render harness and the gates both read the list in `rooms.ts`.
 */
export interface BossRoomHarness {
  readonly id: BossRoomId;
  readonly floor: BossFloor;
  /** The asset group whose painted sheets dress this room. */
  readonly assetGroup: BossRoomAssetGroup;
  /** Frame edges this room's sheets paint against on purpose — see `clippedFrames`. */
  readonly sheetGroundedEdges?: ReadonlySet<FrameEdge>;
  /** The states this room can be driven into, in the order a review reads them. */
  readonly states: readonly BossRoomState[];
  /** The state with the most on screen: where the draw-call budget is measured. */
  readonly heaviestState: BossRoomState;
  /** Door sides the generator can give this room; a `--door` outside it cannot be found. */
  readonly doorSides: readonly DoorSide[];
  /** The minimum share of the room's interior that must stay open floor. */
  readonly minOpenFloorShare: number;
  /**
   * Why this room's current layout is known to break the shared layout
   * invariants, while it waits for its template. Its violations are then
   * reported rather than failed — and the gate fails once there are none, so
   * the exemption cannot outlive the layout it excuses.
   */
  readonly layoutInvariantsPending?: string;
  locate(gameMap: GameMap, levelDef: LevelDef): LocatedRoom | null;
  /** Builds the room's live systems on the floor. May stamp props into the map. */
  build(env: RoomEnvironment): RoomUnderTest;
  /** The tiles the shared layout invariants check; defaults to `defaultInvariantTiles`. */
  invariantTiles?(room: LocatedRoom): RoomInvariantTiles;
  /** Room-specific checks run on every generated floor of the sweep. */
  gates?(context: RoomGateContext): void;
}

/** The share of a room's interior a layout may fill with props, at most. */
export const DEFAULT_MIN_OPEN_FLOOR_SHARE = 0.7;

export function defaultInvariantTiles(room: LocatedRoom): RoomInvariantTiles {
  return {
    approach: room.doorways.flatMap((doorway) => approachLaneTiles(doorway, room.bounds)),
    spawnDisc: spawnClearTiles(room.spawn),
  };
}

/** The first element, or undefined for an empty list. */
export function firstOf<T>(list: readonly T[]): T | undefined {
  return list.length > 0 ? list[0] : undefined;
}

/** Every tile of a rectangle, row by row. */
export function rectTiles(rect: TileRect): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** A rectangular room found by its bounds, keyed to its widest doorway. */
export function locateRectRoom(
  gameMap: GameMap,
  bounds: TileRect,
  spawn: TilePoint,
): LocatedRoom | null {
  const doorways = findBossRoomDoorways(gameMap.structure, bounds);
  const primary = firstOf(doorways);
  if (primary === undefined) return null;
  return { bounds, spawn, doorways, doorSide: primary.side, interior: rectTiles(bounds) };
}

/** The gauntlet boss room a level lists for `bossType`, found by its index in the level def. */
export function gauntletBossRoom(
  gameMap: GameMap,
  levelDef: LevelDef,
  bossType: string,
): LocatedRoom | null {
  const index = levelDef.bossRooms?.findIndex((room) => room.type === bossType) ?? -1;
  const room = index < 0 ? undefined : gameMap.bossRooms[index];
  if (room === undefined) return null;
  return locateRectRoom(gameMap, room.bounds, room.centre);
}

/**
 * The floor's gauntlet room dressings, built by the same call the scene makes,
 * so a room under test is the room the game builds.
 */
export function gameGauntletDressings(
  env: RoomEnvironment,
): ReturnType<typeof buildGauntletRoomDressings> {
  const bossTypes = env.levelDef.bossRooms?.map((room) => room.type) ?? [];
  return buildGauntletRoomDressings(env.gameMap, bossTypes);
}

// ── Floors ───────────────────────────────────────────────────────────────────

/** Builds a dungeon floor exactly as `DungeonScene` generates it, reproducible from `seed`. */
export function generateFloor(
  floor: BossFloor,
  seed: number,
): { gameMap: GameMap; levelDef: LevelDef } {
  const levelDef = getLevelDef(`level${floor}`);
  const gameMap = new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: seed,
  });
  return { gameMap, levelDef };
}

/**
 * Points the tile painters at a floor's ground theme, fallback included, as the
 * scene does on entering it. Call before the floor's first render.
 */
export function useFloorTheme(levelDef: LevelDef): void {
  setDungeonFloorTheme(levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);
}

/**
 * How many seeds a `--door` search tries before giving up. The side a room's
 * doorway lands on follows the gauntlet's placement, so every side a room can
 * have turns up within a few dozen floors.
 */
export const DOOR_SEARCH_MAX_SEEDS = 200;

export interface FoundRoom {
  readonly seed: number;
  readonly gameMap: GameMap;
  readonly levelDef: LevelDef;
  readonly room: LocatedRoom;
}

/**
 * The first floor from `startSeed` on whose room has its doorway on `side`, or
 * any floor with the room when `side` is undefined. Null when none is found.
 */
export function findFloorWithRoom(
  harness: BossRoomHarness,
  startSeed: number,
  side: DoorSide | undefined,
): FoundRoom | null {
  for (let offset = 0; offset < DOOR_SEARCH_MAX_SEEDS; offset++) {
    const seed = startSeed + offset;
    const { gameMap, levelDef } = generateFloor(harness.floor, seed);
    const room = harness.locate(gameMap, levelDef);
    if (room === null) continue;
    if (side !== undefined && room.doorSide !== side) continue;
    return { seed, gameMap, levelDef, room };
  }
  return null;
}

/**
 * A minimal frame context: the party standing in the room's doorway, no mobs.
 * Enough for a room's systems to update and draw without a scene.
 */
export function buildEnvironment(found: FoundRoom): RoomEnvironment {
  const doorway = found.room.doorways[0]?.tile ?? found.room.spawn;
  // Players are built from tile coordinates, like mobs.
  const human = new HumanPlayer(doorway.x, doorway.y, TILE_SIZE);
  const cat = new CatPlayer(doorway.x + 1, doorway.y, TILE_SIZE);
  const frame: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: new MobRoster(found.gameMap, new SpellSystem()),
    gameMap: found.gameMap,
  };
  return {
    gameMap: found.gameMap,
    levelDef: found.levelDef,
    room: found.room,
    frame,
    bus: new EventBus(),
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Tiles of floor shown around a room, so its walls and doorway read in context. */
export const ROOM_FRAME_MARGIN_TILES = 3;

export interface RoomView {
  readonly camX: number;
  readonly camY: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export function roomView(room: LocatedRoom): RoomView {
  const margin = ROOM_FRAME_MARGIN_TILES;
  return {
    camX: (room.bounds.x - margin) * TILE_SIZE,
    camY: (room.bounds.y - margin) * TILE_SIZE,
    widthPx: (room.bounds.w + margin * 2) * TILE_SIZE,
    heightPx: (room.bounds.h + margin * 2) * TILE_SIZE,
  };
}

/** The canvas calls counted against a room's per-frame budget. */
export const COUNTED_DRAW_CALLS = [
  'drawImage',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'fillText',
  'putImageData',
] as const;
export type CountedDrawCall = (typeof COUNTED_DRAW_CALLS)[number];
export type DrawCallCounts = Record<CountedDrawCall, number>;

function zeroCounts(): DrawCallCounts {
  return {
    drawImage: 0,
    fill: 0,
    stroke: 0,
    fillRect: 0,
    strokeRect: 0,
    fillText: 0,
    putImageData: 0,
  };
}

/**
 * Wraps a node context's draw calls with counters, switchable so only the
 * layers under measurement are counted. The wrapper replaces the methods on the
 * instance itself, so every painter handed this context is counted without
 * knowing it.
 */
export class DrawCallCounter {
  counts: DrawCallCounts = zeroCounts();
  counting = false;

  constructor(nodeCtx: NodeContext) {
    for (const name of COUNTED_DRAW_CALLS) {
      const original: unknown = Reflect.get(nodeCtx, name);
      if (typeof original !== 'function') throw new Error(`context has no ${name}()`);
      const wrapped = (...args: unknown[]): unknown => {
        if (this.counting) this.counts[name]++;
        const result: unknown = Reflect.apply(original, nodeCtx, args);
        return result;
      };
      Reflect.set(nodeCtx, name, wrapped);
    }
  }

  reset(): void {
    this.counts = zeroCounts();
  }
}

export interface RenderedRoom {
  readonly canvas: Canvas;
  /** Draw calls made by the room's dressing — its own layers and its Y-sorted props. */
  readonly dressingDrawCalls: DrawCallCounts;
}

/**
 * Draws a room the way the scene's render pipeline does, minus bodies: the
 * baked floor, the room's ground layer, the Y-sorted pass (the map's decoration
 * tiles and the room's live objects, sorted by foot), then the room's top layer.
 *
 * `withOverlay: false` skips the Y-sorted decoration tiles, which is how the
 * registry gate tells a prop drawn by the overlay pass from one baked flat.
 */
export function renderRoom(
  env: RoomEnvironment,
  roomUnderTest: RoomUnderTest,
  scale: number,
  options: { withOverlay?: boolean } = {},
): RenderedRoom {
  const view = roomView(env.room);
  setViewportSize(view.widthPx, view.heightPx);
  const canvas = createCanvas(view.widthPx * scale, view.heightPx * scale);
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(scale, scale);
  const counter = new DrawCallCounter(nodeCtx);
  const ctx = asGameContext(nodeCtx);
  const { camX, camY } = view;

  useFloorTheme(env.levelDef);
  env.gameMap.renderCanvas(ctx, camX, camY, view.widthPx, view.heightPx);

  counter.counting = true;
  roomUnderTest.renderGround(ctx, camX, camY);

  interface SortedDraw {
    readonly sortY: number;
    draw(): void;
  }
  const sorted: SortedDraw[] = [];
  if (options.withOverlay !== false) {
    for (const { tx, ty, sortYAnchorPx } of env.gameMap.getVisibleDecorationTiles(
      camX,
      camY,
      view.widthPx,
      view.heightPx,
    )) {
      sorted.push({
        sortY: ty * TILE_SIZE + sortYAnchorPx,
        draw: () => env.gameMap.drawDecorationAt(ctx, tx, ty, camX, camY),
      });
    }
  }
  for (const renderable of roomUnderTest.renderEntities()) {
    sorted.push({
      // The same foot offset the scene's pipeline sorts a live prop by.
      sortY: renderable.y + TILE_SIZE,
      draw: () => renderable.render(ctx, camX, camY, TILE_SIZE),
    });
  }
  sorted.sort((a, b) => a.sortY - b.sortY);
  for (const entry of sorted) entry.draw();

  roomUnderTest.renderAbove(ctx, camX, camY);
  counter.counting = false;

  return { canvas, dressingDrawCalls: counter.counts };
}

// ── Pixel checks ─────────────────────────────────────────────────────────────

const CHANNELS_PER_PIXEL = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
/**
 * How close to pure magenta a pixel must be to count as placeholder ink. Tight,
 * because the placeholder's stroke has an exact-colour core and no painted
 * material in these rooms comes near full red and blue with no green.
 */
const MAGENTA_HIGH_CHANNEL_MIN = 235;
const MAGENTA_LOW_CHANNEL_MAX = 30;

/** Counts pixels of placeholder magenta on a canvas. */
export function magentaPixelCount(canvas: Canvas): number {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let i = 0; i < data.length; i += CHANNELS_PER_PIXEL) {
    const red = data[i];
    const green = data[i + GREEN_OFFSET];
    const blue = data[i + BLUE_OFFSET];
    if (
      red >= MAGENTA_HIGH_CHANNEL_MIN &&
      blue >= MAGENTA_HIGH_CHANNEL_MIN &&
      green <= MAGENTA_LOW_CHANNEL_MAX
    ) {
      count++;
    }
  }
  return count;
}

/**
 * The colour of art nobody has painted yet. `magentaPixelCount` looks for
 * exactly this, so a stand-in painter must use it for the gate to find it.
 */
const PLACEHOLDER_MAGENTA = '#ff00ff';
const PLACEHOLDER_STROKE_WIDTH = 3;
/** Keeps the cross off the tile edge so it cannot bleed into a neighbour's cell. */
const PLACEHOLDER_INSET_PX = 3;

/**
 * The room with a stand-in painter on its ground pass: a magenta cross over
 * `tile`, as an unpainted dressing piece would draw. Every room's art is
 * painted, so this is how the magenta gate is still seen red.
 */
export function withPlaceholderGround(room: RoomUnderTest, tile: TilePoint): RoomUnderTest {
  return {
    update: () => room.update(),
    renderEntities: () => room.renderEntities(),
    renderAbove: (ctx, camX, camY) => room.renderAbove(ctx, camX, camY),
    driveToState: (state) => room.driveToState(state),
    renderGround: (ctx, camX, camY) => {
      room.renderGround(ctx, camX, camY);
      const near = PLACEHOLDER_INSET_PX;
      const far = TILE_SIZE - PLACEHOLDER_INSET_PX;
      const left = tile.x * TILE_SIZE - camX;
      const top = tile.y * TILE_SIZE - camY;
      ctx.save();
      ctx.strokeStyle = PLACEHOLDER_MAGENTA;
      ctx.lineWidth = PLACEHOLDER_STROKE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(left + near, top + near);
      ctx.lineTo(left + far, top + far);
      ctx.moveTo(left + far, top + near);
      ctx.lineTo(left + near, top + far);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** The PNG path a room render is written to. */
export function roomRenderPath(id: BossRoomId, state: BossRoomState, side: DoorSide): string {
  return `preview/boss-rooms/${id}-${state}-${side}.png`;
}

// ── Room modules' common case ────────────────────────────────────────────────

/** Layers drawn by a room's pre-existing systems alongside its dressing. */
export interface ExtraRoomLayers {
  update?(): void;
  renderGround?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  renderAbove?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  /**
   * Drives the states the dressing's fight hooks alone cannot reach. Returns
   * undefined for a state it leaves to the hooks.
   */
  driveToState?(state: BossRoomState): boolean | undefined;
}

/**
 * A room whose dressing implements `BossRoomDressing`, driven through the same
 * hooks the fight owners call: `onSeal` for a sealed room, then
 * `onBossDefeated` for a won one. Any other state is the room module's to
 * drive through `extra.driveToState`.
 */
export function dressingUnderTest(
  dressing: BossRoomDressing,
  env: RoomEnvironment,
  extra: ExtraRoomLayers = {},
): RoomUnderTest {
  return {
    update: () => {
      dressing.update(env.frame);
      extra.update?.();
    },
    renderGround: (ctx, camX, camY) => {
      extra.renderGround?.(ctx, camX, camY);
      dressing.renderGround(ctx, camX, camY, env.frame.active);
    },
    renderEntities: () => dressing.renderEntities(),
    renderAbove: (ctx, camX, camY) => {
      dressing.renderAbove(ctx, camX, camY);
      extra.renderAbove?.(ctx, camX, camY);
    },
    driveToState: (state) => {
      const drivenByRoom = extra.driveToState?.(state);
      if (drivenByRoom !== undefined) return drivenByRoom;
      switch (state) {
        case 'pre':
          return true;
        case 'sealed':
          dressing.onSeal();
          return true;
        case 'defeated':
          dressing.onSeal();
          dressing.onBossDefeated();
          // Twice, as the scene's replay after a build or a load delivers it:
          // the won room must come out of the repeat unchanged.
          dressing.onBossDefeated();
          return true;
        case 'enraged':
        case 'phase2':
        case 'phase3':
          return false;
      }
    },
  };
}

/** The states every room has before its own fight states are added. */
export const BASELINE_ROOM_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'defeated'];
