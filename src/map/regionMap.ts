import type { TileContent } from './tileTypes';
import { corridorComponents } from './progressionValidation';
import { roomDoorways, type Point, type Rect, type RoomDoorway } from './roomDoorways';

/**
 * What a generated room is *for*. Carried on the room itself rather than
 * inferred from its index, so every downstream stage (corridor width, stairwell
 * eligibility, decoration, mob spawns, and anything reading the finished
 * {@link RegionMap}) asks the room what it is.
 */
export type RoomRole = 'start' | 'safe' | 'boss' | 'quest' | 'spider_lab' | 'chain' | 'regular';

/**
 * How deep into the floor a point lies, by straight-line distance from the
 * start room's centre.
 */
export type Zone = 'entrance' | 'mid' | 'deep';

/**
 * The shape a corridor was carved in.
 *
 * - `narrow`: one tile wide, the default.
 * - `standard`: three tiles wide, for main arteries and landmark approaches.
 * - `nook`: one tile wide with a 5×5 alcove carved at its L-bend.
 */
export type HallwayKind = 'narrow' | 'standard' | 'nook';

/** `regionAt` for a wall, void, or any tile outside the grid. */
export const NO_REGION = -1;

/**
 * First hallway region id. Room ids count up from 0 and hallway ids from here,
 * so the two ranges can never meet: a floor seats far fewer rooms than this,
 * and `Int16Array` still leaves room for as many hallway segments above it.
 */
export const HALLWAY_REGION_BASE = 16384;

/** Largest id an `Int16Array` cell can hold. */
const MAX_REGION_ID = 32767;

/** One room the generator seated, as a region. */
export interface RoomRegion {
  readonly type: 'room';
  /** Region id; also the room's index into `GameMap.roomBounds`. */
  readonly id: number;
  readonly bounds: Readonly<Rect>;
  readonly role: RoomRole;
  /** Set on a room chosen to hold a treasure chest. Independent of {@link role}, which stays `regular`. */
  readonly treasure: boolean;
  /** Zone of the room's centre. */
  readonly zone: Zone;
  /** The generic floor type the room was carved with (a `FloorTypeValue`). */
  readonly floor: number;
  /**
   * Every doorway through the room's perimeter, read off the finished grid by
   * `roomDoorways` — a wide or corner opening is one entry, not one per tile.
   */
  readonly doorways: ReadonlyArray<RoomDoorway>;
}

/**
 * One connected stretch of walkable floor outside every room: a corridor, or a
 * junction where several corridors run together.
 */
export interface HallwayRegion {
  readonly type: 'hallway';
  /** Region id, `HALLWAY_REGION_BASE + segment index`. */
  readonly id: number;
  /** Every tile of the segment, in flood order. */
  readonly tiles: ReadonlyArray<Point>;
  /** Room ids (indices into `GameMap.roomBounds`) the segment opens onto, without duplicates. */
  readonly rooms: ReadonlyArray<number>;
  /**
   * Every corridor shape carved into this segment, in `narrow`, `standard`,
   * `nook` order. Several when corridors of different kinds merge at a junction;
   * empty when no corridor carver made any of it (the arena drum and its
   * concourse, sign pockets, the arena's north gate).
   */
  readonly hallwayKinds: ReadonlyArray<HallwayKind>;
  /**
   * The most distinctive of {@link hallwayKinds} — `nook` over `standard` over
   * `narrow` — so "is this a nook" is one comparison. Null when
   * `hallwayKinds` is empty.
   */
  readonly hallwayKind: HallwayKind | null;
  /** Zone of the segment's tile centroid. */
  readonly zone: Zone;
  /**
   * Set when the segment reaches inside an arena's radius: the arena drum is
   * walkable floor that no room rectangle covers, so it lands here as a
   * "hallway" and needs telling apart from one.
   */
  readonly arena: boolean;
}

export type Region = RoomRegion | HallwayRegion;
export type RegionKind = Region['type'];

/** A room as the generator hands it to {@link buildRegionMap}. */
export interface RegionRoomInput {
  readonly bounds: Readonly<Rect>;
  readonly role: RoomRole;
  readonly treasure: boolean;
  readonly floor: number;
}

/** Everything {@link buildRegionMap} reads besides the grid. */
export interface RegionMapInput {
  readonly grid: TileContent[][];
  /** In placement order; a room's position here becomes its region id. */
  readonly rooms: ReadonlyArray<RegionRoomInput>;
  /** The kind of corridor that first carved a tile, or `undefined` for a tile no corridor carved. */
  readonly corridorKindAt: (x: number, y: number) => HallwayKind | undefined;
  readonly zoneOf: (point: Point) => Zone;
  readonly arenas: ReadonlyArray<{ readonly centre: Point; readonly radius: number }>;
}

const HALLWAY_KIND_ORDER: ReadonlyArray<HallwayKind> = ['narrow', 'standard', 'nook'];

/**
 * Which room or hallway segment every tile of a dungeon floor belongs to.
 *
 * Generation data: built once by the dungeon generator from the finished grid
 * and never updated, so a tile that later changes type (a smashed prop, a quest
 * door) keeps the region it was generated with, and nothing about it needs
 * checkpointing.
 *
 * - A room region covers its whole rectangle, whatever tile stands on it — a
 *   pillar, counter or stairwell inside a room is still that room. Where two
 *   rectangles overlap, the earlier room wins, matching a first-match search
 *   over `roomBounds`.
 * - Hallway regions are the connected stretches of walkable floor outside every
 *   room, split the same way `corridorComponents` splits them.
 * - Everything else — walls, void, a non-walkable tile outside every room — is
 *   {@link NO_REGION}. The one exception is a prop the generator dresses a
 *   hallway with after this map is built: it keeps the id of the segment it
 *   stands in, as a prop in a room keeps the room's.
 *
 * Maps that are not forced-progression dungeon floors get {@link RegionMap.empty},
 * where every tile is {@link NO_REGION}.
 */
export class RegionMap {
  readonly width: number;
  readonly height: number;
  /** Rooms in placement order; `rooms[i].id === i`. */
  readonly rooms: ReadonlyArray<RoomRegion>;
  /** Hallway segments; `hallways[i].id === HALLWAY_REGION_BASE + i`. */
  readonly hallways: ReadonlyArray<HallwayRegion>;
  /** Each room's rectangle, in the same order as {@link rooms}. */
  readonly roomBounds: ReadonlyArray<Rect>;
  private readonly cells: Int16Array;

  /** Prefer {@link buildRegionMap}, which derives every part from a finished grid. */
  constructor(parts: {
    readonly width: number;
    readonly height: number;
    /** Row-major region ids, `width * height` long. */
    readonly cells: Int16Array;
    readonly rooms: ReadonlyArray<RoomRegion>;
    readonly hallways: ReadonlyArray<HallwayRegion>;
  }) {
    this.width = parts.width;
    this.height = parts.height;
    this.cells = parts.cells;
    this.rooms = parts.rooms;
    this.hallways = parts.hallways;
    this.roomBounds = parts.rooms.map((room) => ({ ...room.bounds }));
  }

  /** A map with no regions at all, for overworld, interior, tutorial and free-roam maps. */
  static empty(): RegionMap {
    return new RegionMap({
      width: 0,
      height: 0,
      cells: new Int16Array(0),
      rooms: [],
      hallways: [],
    });
  }

  /** The region id at a tile, or {@link NO_REGION} for walls, void and tiles off the grid. */
  regionAt(tileX: number, tileY: number): number {
    if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) return NO_REGION;
    return this.cells[tileY * this.width + tileX];
  }

  /** Whether an id names a room or a hallway segment, or null for {@link NO_REGION} and unknown ids. */
  regionKind(id: number): RegionKind | null {
    return this.region(id)?.type ?? null;
  }

  /** The region an id names, or null for {@link NO_REGION} and unknown ids. */
  region(id: number): Region | null {
    return this.room(id) ?? this.hallway(id);
  }

  /** The room an id names, or null when it names no room. */
  room(id: number): RoomRegion | null {
    return this.rooms[id] ?? null;
  }

  /** The hallway segment an id names, or null when it names no hallway. */
  hallway(id: number): HallwayRegion | null {
    if (id < HALLWAY_REGION_BASE) return null;
    return this.hallways[id - HALLWAY_REGION_BASE] ?? null;
  }

  /** The region at a tile, or null where {@link regionAt} is {@link NO_REGION}. */
  regionAtTile(tileX: number, tileY: number): Region | null {
    return this.region(this.regionAt(tileX, tileY));
  }

  /** The index into {@link roomBounds} of the room covering a tile, or `-1` when no room does. */
  roomIndexAt(tileX: number, tileY: number): number {
    const id = this.regionAt(tileX, tileY);
    return id >= 0 && id < this.rooms.length ? id : NO_REGION;
  }
}

function dominantHallwayKind(kinds: ReadonlyArray<HallwayKind>): HallwayKind | null {
  return kinds.length === 0 ? null : kinds[kinds.length - 1];
}

function centroidOf(tiles: ReadonlyArray<Point>): Point {
  let sumX = 0;
  let sumY = 0;
  for (const tile of tiles) {
    sumX += tile.x;
    sumY += tile.y;
  }
  const count = Math.max(1, tiles.length);
  return { x: Math.round(sumX / count), y: Math.round(sumY / count) };
}

function insideAnyArena(tiles: ReadonlyArray<Point>, arenas: RegionMapInput['arenas']): boolean {
  return arenas.some(({ centre, radius }) =>
    tiles.some((tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) < radius),
  );
}

/**
 * Builds a floor's {@link RegionMap} from its finished grid.
 *
 * Reads only; it draws no randomness and changes no tile, so running it never
 * changes the floor it describes.
 */
export function buildRegionMap(input: RegionMapInput): RegionMap {
  const { grid, rooms, corridorKindAt, zoneOf, arenas } = input;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const cells = new Int16Array(width * height).fill(NO_REGION);

  if (rooms.length >= HALLWAY_REGION_BASE) {
    throw new Error(`region map: ${rooms.length} rooms overflow the room id range`);
  }

  // Filled last-to-first so the earliest room ends up owning any tile two
  // rectangles share.
  for (let index = rooms.length - 1; index >= 0; index--) {
    const { bounds } = rooms[index];
    for (let y = Math.max(0, bounds.y); y < Math.min(height, bounds.y + bounds.h); y++) {
      for (let x = Math.max(0, bounds.x); x < Math.min(width, bounds.x + bounds.w); x++) {
        cells[y * width + x] = index;
      }
    }
  }

  const roomRegions: RoomRegion[] = rooms.map((room, index) => ({
    type: 'room',
    id: index,
    bounds: { ...room.bounds },
    role: room.role,
    treasure: room.treasure,
    zone: zoneOf({
      x: Math.floor(room.bounds.x + room.bounds.w / 2),
      y: Math.floor(room.bounds.y + room.bounds.h / 2),
    }),
    floor: room.floor,
    doorways: roomDoorways(grid, room.bounds),
  }));

  const components = corridorComponents(
    grid,
    rooms.map((room) => room.bounds),
  );
  if (HALLWAY_REGION_BASE + components.length > MAX_REGION_ID) {
    throw new Error(`region map: ${components.length} hallway segments overflow the id range`);
  }

  const hallwayRegions: HallwayRegion[] = components.map((component, segment) => {
    const id = HALLWAY_REGION_BASE + segment;
    const carvedKinds = new Set<HallwayKind>();
    for (const tile of component.tiles) {
      cells[tile.y * width + tile.x] = id;
      const kind = corridorKindAt(tile.x, tile.y);
      if (kind !== undefined) carvedKinds.add(kind);
    }
    const hallwayKinds = HALLWAY_KIND_ORDER.filter((kind) => carvedKinds.has(kind));
    return {
      type: 'hallway',
      id,
      tiles: component.tiles,
      rooms: component.rooms,
      hallwayKinds,
      hallwayKind: dominantHallwayKind(hallwayKinds),
      zone: zoneOf(centroidOf(component.tiles)),
      arena: insideAnyArena(component.tiles, arenas),
    };
  });

  return new RegionMap({ width, height, cells, rooms: roomRegions, hallways: hallwayRegions });
}
