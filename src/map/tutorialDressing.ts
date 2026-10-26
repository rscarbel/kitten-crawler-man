/**
 * Dresses the hand-built tutorial map with the dungeon generator's own passes
 * — room and hallway dressing, wall characters, wall fixtures — so the first
 * place a new player sees is furnished and lit like a floor-1 cellar.
 *
 * The tutorial has no generator run behind it, so this builds the minimum
 * those passes read (a region map and a character per region) from the map's
 * own rooms and halls, and adds the two set pieces no character expresses: the
 * treasure room's candle-lit chest and the torches framing the exit stairs.
 */

import type { PrebuiltDressing } from './GameMap';
import { buildRegionMap, NO_REGION, type HallwayRegion, type RoomRole } from './regionMap';
import { blockingWouldSplitRoom, roomDoorways, type Point, type Rect } from './roomDoorways';
import {
  BRAZIER,
  CANDLE_CLUSTER,
  FloorTypeValue,
  TORCH,
  placeProp,
  type TileContent,
} from './tileTypes';
import { mulberry32 } from '../sprites/person/rng';
import { dressHallway, dressRoom, dressSpecialRoom } from './dungeon/roomDressing';
import {
  FLOOR1_HALLWAY_CHARACTERS,
  FLOOR1_ROOM_CHARACTERS,
  SPECIAL_REGION_LIGHTING,
  SPECIAL_REGION_PROPS,
  type HallwayCharacter,
  type PropSetEntry,
  type RoomCharacter,
} from './dungeon/roomCharacters';
import { RegionCharacters, type RegionAssignment } from './dungeon/regionCharacters';
import {
  fixtureFoot,
  freshFixtureState,
  isFixtureFace,
  placeWallFixtures,
  type WallFixture,
  type WallFixtureKind,
} from './dungeon/wallFixtures';
import { UINT32_SPAN } from '../core/world/WorldRandom';

/** What each tutorial room is dressed as. */
export type TutorialRoomKind = 'start' | 'treasure' | 'safe' | 'exit';

export interface TutorialDressingRoom {
  readonly bounds: Rect;
  readonly kind: TutorialRoomKind;
  /** The floor type the room was carved with. */
  readonly floor: number;
}

/** The tutorial layout as the dressing passes need it. */
export interface TutorialDressingLayout {
  readonly grid: TileContent[][];
  readonly rooms: ReadonlyArray<TutorialDressingRoom>;
  readonly halls: ReadonlyArray<Rect>;
  /**
   * Every tile no prop may stand on and no wall fixture may hang over: gate
   * and fence rows, walking lines between objectives, spawn, chest and stair
   * tiles. Room dressing also keeps a one-tile ring clear around each.
   */
  readonly keepClear: ReadonlyArray<Rect>;
  readonly chestTile: Point;
  readonly stairTile: Point;
}

/**
 * The tutorial always looks the same: every pass draws from streams split off
 * this one seed, like a generated floor's dressing seed.
 */
const TUTORIAL_DRESSING_SEED = 0x7a11_cafe;
const HALLWAY_STREAM_SALT = 0x4a11_0001;
const SPECIAL_ROOM_STREAM_SALT = 0x5bec_0002;
const FIXTURE_STREAM_SALT = 0xf1c7_0003;
const HALL_SCONCE_STREAM_SALT = 0x5c0e_0004;

const SCONCE_LIGHT_KIND = 'sconce' as const satisfies WallFixtureKind;

/** Every tutorial region is the floor's entrance: nothing is rolled dark or deep. */
const TUTORIAL_ZONE = 'entrance';

/**
 * The tutorial shares floor 1's cellars (`groundTheme: 'cellars'` on its level
 * definition), so it is furnished from that floor's tables.
 */
const TUTORIAL_FLOOR_PROPS = SPECIAL_REGION_PROPS.cellars;

const ROOM_ROLE_OF_KIND = {
  start: 'start',
  treasure: 'regular',
  safe: 'safe',
  exit: 'regular',
} as const satisfies Record<TutorialRoomKind, RoomRole>;

function floor1RoomCharacter(id: RoomCharacter['id']): RoomCharacter {
  const character = FLOOR1_ROOM_CHARACTERS.find((candidate) => candidate.id === id);
  if (character === undefined) throw new Error(`tutorial dressing: no floor-1 room ${id}`);
  return character;
}

/**
 * Pieces a crypt keeps its valuables among. The chapel's sarcophagus is left
 * out: a coffin beside the chest would read as the thing to open.
 */
const TREASURE_ROOM_PROPS: ReadonlyArray<PropSetEntry> = [
  { family: 'clay_urn', weight: 3, count: { min: 3, max: 4 }, placement: 'corner' },
  { family: 'bookshelf', weight: 2, count: { min: 1, max: 2 }, placement: 'wall' },
  { family: 'bottle_rack', weight: 1, count: { min: 1, max: 1 }, placement: 'north-face' },
];

/**
 * The treasure room wears the crypt chapel's banners, herringbone and mosaic
 * ring — the ring is centred, so it lies under the chest like a plinth.
 */
const TREASURE_ROOM_CHARACTER: RoomCharacter = {
  ...floor1RoomCharacter('crypt_chapel'),
  props: TREASURE_ROOM_PROPS,
  stamps: [],
  stampChance: 0,
};

/** The exit is a guard post: a brazier, a rack of spears and chains on the wall. */
const EXIT_ROOM_CHARACTER: RoomCharacter = floor1RoomCharacter('guard_post');

function floor1HallwayCharacter(id: HallwayCharacter['id']): HallwayCharacter {
  const character = FLOOR1_HALLWAY_CHARACTERS.find((candidate) => candidate.id === id);
  if (character === undefined) throw new Error(`tutorial dressing: no floor-1 hallway ${id}`);
  return character;
}

/** Plain passages with sconces: the halls have to lead the eye, not hold it. */
const HALLWAY_CHARACTER = floor1HallwayCharacter('cellar_passage');

/** Candles set on each diagonal of the chest, so it sits in a pool of its own light. */
const CHEST_CANDLE_OFFSETS: ReadonlyArray<Point> = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

/**
 * Columns either side of the chest its braziers stand in: far enough out that
 * the chest's own candle ring stays the brightest thing in the room.
 */
const CHEST_BRAZIER_COLUMNS_OUT = 3;
const CHEST_BRAZIER_OFFSETS: ReadonlyArray<number> = [
  -CHEST_BRAZIER_COLUMNS_OUT,
  CHEST_BRAZIER_COLUMNS_OUT,
];

/**
 * Columns either side of the stairwell's west edge the framing torches stand
 * in. The stairwell is two tiles wide, so the east torch is one column further
 * out than the west, leaving each one tile clear of the stairs.
 */
const EXIT_TORCH_WEST_OFFSET = -2;
const EXIT_TORCH_EAST_OFFSET = 3;

function isInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function placeSetPiece(grid: TileContent[][], room: Rect, tile: Point, propType: number): void {
  if (!isInRect(room, tile.x, tile.y)) {
    throw new Error(`tutorial set piece at (${tile.x}, ${tile.y}) falls outside its room`);
  }
  placeProp(grid[tile.y][tile.x], propType);
}

function placeSetPieces(layout: TutorialDressingLayout): void {
  for (const room of layout.rooms) {
    if (room.kind === 'treasure') {
      for (const offset of CHEST_CANDLE_OFFSETS) {
        const tile = { x: layout.chestTile.x + offset.x, y: layout.chestTile.y + offset.y };
        placeSetPiece(layout.grid, room.bounds, tile, CANDLE_CLUSTER);
      }
      for (const offsetX of CHEST_BRAZIER_OFFSETS) {
        const tile = { x: layout.chestTile.x + offsetX, y: layout.chestTile.y };
        placeSetPiece(layout.grid, room.bounds, tile, BRAZIER);
      }
    } else if (room.kind === 'exit') {
      const { x, y } = layout.stairTile;
      placeSetPiece(layout.grid, room.bounds, { x: x + EXIT_TORCH_WEST_OFFSET, y }, TORCH);
      placeSetPiece(layout.grid, room.bounds, { x: x + EXIT_TORCH_EAST_OFFSET, y }, TORCH);
    }
  }
}

/**
 * Rows between candles down a north–south hall. Fixtures hang only on north
 * faces and such a hall has none, so these are its only light of its own.
 */
const HALL_CANDLE_SPACING_ROWS = 5;
/** Rows left bare at each end of a hall, so nothing stands in a doorway's mouth. */
const HALL_CANDLE_END_MARGIN_ROWS = 1;

/**
 * Candles set against alternate side walls of every north–south hall. They are
 * walkable, so they never narrow the lane a crawler or a goblin walks.
 */
function placeHallCandles(
  grid: TileContent[][],
  halls: ReadonlyArray<Rect>,
  isKeptClear: (x: number, y: number) => boolean,
): void {
  for (const hall of halls) {
    const runsNorthSouth = hall.h > hall.w;
    if (!runsNorthSouth) continue;
    const lastRow = hall.y + hall.h - 1 - HALL_CANDLE_END_MARGIN_ROWS;
    let againstWestWall = true;
    let y = hall.y + HALL_CANDLE_END_MARGIN_ROWS;
    while (y <= lastRow) {
      const x = againstWestWall ? hall.x : hall.x + hall.w - 1;
      const tile = grid[y][x];
      const isBareFloor = tile.type === FloorTypeValue.tile_floor && tile.groundType === undefined;
      if (isKeptClear(x, y) || !isBareFloor) {
        y++;
        continue;
      }
      placeProp(tile, CANDLE_CLUSTER);
      againstWestWall = !againstWestWall;
      y += HALL_CANDLE_SPACING_ROWS;
    }
  }
}

function assignmentFor(kind: TutorialRoomKind): RegionAssignment {
  switch (kind) {
    case 'start':
      return { type: 'special', tag: 'start' };
    case 'safe':
      return { type: 'special', tag: 'safe' };
    case 'treasure':
      return { type: 'room', character: TREASURE_ROOM_CHARACTER, unlit: false };
    case 'exit':
      return { type: 'room', character: EXIT_ROOM_CHARACTER, unlit: false };
  }
}

/**
 * Re-indexes the fixtures left after some are dropped, keeping each one's
 * circuit pointing at the same fuse box (or at none, if its box was dropped).
 */
function reindexFixtures(kept: ReadonlyArray<WallFixture>): WallFixture[] {
  const newIdOf = new Map(kept.map((fixture, index) => [fixture.id, index]));
  return kept.map((fixture, index) => ({
    ...fixture,
    id: index,
    circuit: fixture.circuit === null ? null : (newIdOf.get(fixture.circuit) ?? null),
  }));
}

/**
 * Furnishes the tutorial grid in place and returns the region data its
 * lighting, ambience, dungeon life and painters read.
 */
export function dressTutorial(layout: TutorialDressingLayout): PrebuiltDressing {
  const { grid } = layout;
  const isKeptClear = (x: number, y: number): boolean =>
    layout.keepClear.some((rect) => isInRect(rect, x, y));
  const isHallTile = (x: number, y: number): boolean =>
    layout.halls.some((rect) => isInRect(rect, x, y));

  placeSetPieces(layout);
  placeHallCandles(grid, layout.halls, isKeptClear);

  const placementRng = mulberry32(TUTORIAL_DRESSING_SEED);
  const specialRoomRng = mulberry32(TUTORIAL_DRESSING_SEED ^ SPECIAL_ROOM_STREAM_SALT);
  const roomAssignments = layout.rooms.map((room) => assignmentFor(room.kind));
  layout.rooms.forEach((room, index) => {
    const site = {
      bounds: room.bounds,
      floor: room.floor,
      zone: TUTORIAL_ZONE,
      doorways: roomDoorways(grid, room.bounds),
      isReserved: isKeptClear,
      wouldSplitRoom: (x: number, y: number) =>
        blockingWouldSplitRoom(grid, room.bounds, [{ x, y }]),
    } as const;
    const assignment = roomAssignments[index];
    if (assignment.type === 'room') {
      dressRoom(grid, site, assignment, placementRng);
    } else if (assignment.type === 'special') {
      dressSpecialRoom(
        grid,
        site,
        SPECIAL_REGION_LIGHTING[assignment.tag],
        TUTORIAL_FLOOR_PROPS[assignment.tag] ?? [],
        specialRoomRng,
      );
    }
  });

  const regionMap = buildRegionMap({
    grid,
    rooms: layout.rooms.map((room) => ({
      bounds: room.bounds,
      role: ROOM_ROLE_OF_KIND[room.kind],
      treasure: room.kind === 'treasure',
      floor: room.floor,
    })),
    corridorKindAt: (x, y) => (isHallTile(x, y) ? 'standard' : undefined),
    zoneOf: () => TUTORIAL_ZONE,
    arenas: [],
  });

  const hallwayRng = mulberry32(TUTORIAL_DRESSING_SEED ^ HALLWAY_STREAM_SALT);
  const hallwayAssignments = regionMap.hallways.map((hallway): RegionAssignment => {
    dressHallway(
      grid,
      {
        hallway,
        corridorKindAt: (x, y) => (isHallTile(x, y) ? 'standard' : undefined),
        isReserved: isKeptClear,
        isRoomTile: (x, y) => regionMap.roomIndexAt(x, y) !== NO_REGION,
      },
      HALLWAY_CHARACTER,
      hallwayRng,
    );
    return { type: 'hallway', character: HALLWAY_CHARACTER };
  });

  const regionCharacters = new RegionCharacters(regionMap, roomAssignments, hallwayAssignments);
  const placed = placeWallFixtures({
    grid,
    regionMap,
    characters: regionCharacters,
    rng: mulberry32(TUTORIAL_DRESSING_SEED ^ FIXTURE_STREAM_SALT),
  });
  // A fixture over a gate would hang through its grille as it rises.
  const wallFixtures: WallFixture[] = reindexFixtures(
    placed.filter((fixture) => {
      const foot = fixtureFoot(fixture);
      return !isKeptClear(foot.x, foot.y);
    }),
  );

  const fixtureRng = mulberry32(TUTORIAL_DRESSING_SEED ^ HALL_SCONCE_STREAM_SALT);
  for (const hallway of regionMap.hallways) {
    const sconce = hallSconce(grid, hallway, wallFixtures, isKeptClear, fixtureRng);
    if (sconce !== null) wallFixtures.push(sconce);
  }

  return { regionMap, regionCharacters, wallFixtures };
}

/**
 * A sconce for a hall the spaced-light rule left dark. The tutorial's halls are
 * shorter than the run a generated corridor needs before it earns a light of
 * its own, so each one with any north face takes one near its middle.
 */
function hallSconce(
  grid: TileContent[][],
  hallway: HallwayRegion,
  hung: ReadonlyArray<WallFixture>,
  isKeptClear: (x: number, y: number) => boolean,
  rng: () => number,
): WallFixture | null {
  const alreadyLit = hung.some(
    (fixture) => fixture.region === hallway.id && fixture.kind === SCONCE_LIGHT_KIND,
  );
  if (alreadyLit) return null;
  const touchesHung = (face: Point): boolean =>
    hung.some((fixture) => fixture.tileY === face.y && Math.abs(fixture.tileX - face.x) <= 1);
  const faces = hallway.tiles
    .filter((foot) => isFixtureFace(grid, foot.x, foot.y - 1) && !isKeptClear(foot.x, foot.y))
    .map((foot) => ({ x: foot.x, y: foot.y - 1 }))
    .filter((face) => !touchesHung(face))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (faces.length === 0) return null;
  const middle = faces[Math.floor(faces.length / 2)];
  return {
    id: hung.length,
    tileX: middle.x,
    tileY: middle.y,
    kind: SCONCE_LIGHT_KIND,
    seed: Math.floor(rng() * UINT32_SPAN),
    region: hallway.id,
    circuit: null,
    dying: false,
    state: freshFixtureState(SCONCE_LIGHT_KIND),
  };
}
