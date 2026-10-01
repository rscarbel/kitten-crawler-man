/**
 * Furnishes a generated room or hallway from its character.
 *
 * Reads the character tables in `roomCharacters.ts` and writes prop tiles into
 * the grid through `placeProp`. Everything a character names that has no tile
 * type yet is drawn through a stand-in chosen here, in one table per kind of
 * thing, so adding a real prop is a one-line change to its row.
 *
 * Every placement keeps to the rules that make a furnished room playable:
 *
 * - props hug the walls and sit in clusters; the middle of a room stays open
 * - blocking props cover at most {@link MAX_BLOCKING_PROP_COVERAGE} of a room
 * - nothing blocking stands within a tile of a doorway, a spawn point, a
 *   stairwell or a chest
 * - nothing blocking may cut a room's walkable floor in two
 * - a hallway's walking lane never takes a blocking prop; only the corners of
 *   a nook's alcove do
 */

import type { Rng } from '../../sprites/person/rng';
import {
  BONE_PILE,
  SLUMPED_SKELETON,
  BARREL,
  BARREL_SIDE,
  BOILER,
  CABLE_BUNDLE,
  DROPPED_TOWEL,
  FILING_CABINET,
  GAS_CYLINDER,
  LOCKER_BANK,
  LOCKER_BENCH,
  MOP_BUCKET,
  PALLET_STACK,
  PAPER_DRIFT,
  SERVICE_DESK,
  VENDING_MACHINE,
  BONES,
  BOOKSHELF,
  BOTTLE_RACK,
  BRAZIER,
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  CLAY_URN,
  CRATE,
  CRAWLER_SIGN,
  FALLEN_BEAM,
  FloorTypeValue,
  GLOW_FUNGUS,
  GRAIN_SACK,
  placeProp,
  RUBBLE_HEAP,
  RUBBLE_SLOPE,
  SARCOPHAGUS,
  SPEAR_RACK,
  STRAW_SCATTER,
  TORCH,
  WINE_CASK,
  type TileContent,
} from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import { CELLAR_LIGHT_CARRYING_TILE_TYPES } from '../cellarProps';
import { PROP_PART_TILE_TYPES, multiTilePieceTypes } from '../serviceLevelProps';
import type { HallwayKind, HallwayRegion, Zone } from '../regionMap';
import type { Point, Rect, RoomDoorway } from '../roomDoorways';
import {
  PROP_FAMILIES,
  type CountRange,
  type DressingStampId,
  type HallwayCharacter,
  type LightSourceKind,
  type LightingProfile,
  type LightSourceSpec,
  type PropFamilyId,
  type PropFootprint,
  type PropSetEntry,
} from './roomCharacters';
import type { RoomCharacterAssignment } from './regionCharacters';
import { pickWeighted } from './regionCharacters';

// ── Stand-ins ───────────────────────────────────────────────────────────────

/**
 * The tile each prop family is drawn as today, or null to leave it out.
 *
 * A family with its own tile type maps to it; a family still to be painted
 * maps to the nearest existing prop of the same size and solidity, or to
 * null where no existing prop could pass for it (a rope coil drawn as a crate
 * would block a tile the finished room leaves open). When a family's real tile
 * type lands, its row here is the only placement change it needs.
 */
const PROP_FAMILY_STAND_INS = {
  barrel: BARREL,
  barrel_side: BARREL_SIDE,
  crate: CRATE,
  bookshelf: BOOKSHELF,
  bone_scatter: BONES,
  bone_pile: BONE_PILE,
  slumped_skeleton: SLUMPED_SKELETON,
  clay_urn: CLAY_URN,
  grain_sack: GRAIN_SACK,
  rope_coil: null,
  cask_cradle: WINE_CASK,
  bottle_rack: BOTTLE_RACK,
  table_stools: CELLAR_TABLE,
  weapon_rack: SPEAR_RACK,
  rubble_pile: RUBBLE_HEAP,
  rubble_slope: RUBBLE_SLOPE,
  fallen_beam: FALLEN_BEAM,
  rotting_crate: CRATE,
  sarcophagus: SARCOPHAGUS,
  straw_scatter: STRAW_SCATTER,
  water_trough: BARREL_SIDE,
  glow_fungus: GLOW_FUNGUS,
  steel_shelving: BOOKSHELF,
  supply_boxes: CRATE,
  steel_drum: BARREL,
  gas_cylinder: GAS_CYLINDER,
  locker_bank: LOCKER_BANK,
  bench: LOCKER_BENCH,
  dropped_towel: DROPPED_TOWEL,
  filing_cabinet: FILING_CABINET,
  desk_monitor: SERVICE_DESK,
  paper_drift: PAPER_DRIFT,
  mop_bucket: MOP_BUCKET,
  pallet_stack: PALLET_STACK,
  vending_machine: VENDING_MACHINE,
  round_table: CRATE,
  boiler: BOILER,
  pump_housing: BARREL,
  cable_bundle: CABLE_BUNDLE,
} as const satisfies Record<PropFamilyId, number | null>;

/** The tile type a prop family is placed as, or null when it has nothing to be drawn as yet. */
export function propFamilyTileType(family: PropFamilyId): number | null {
  return PROP_FAMILY_STAND_INS[family];
}

/**
 * The standing prop each light source is placed as, or null for a source that
 * stands on no floor tile of its own.
 *
 * Sconces, tubes, sodium lamps, emergency lights and monitors hang on wall
 * faces as fixtures (`wallFixtures.ts`), so they take no floor tile. A desk
 * lamp has no prop yet and is carried by a standing torch, so a room that
 * should be lit still shows its light where the player can see it.
 */
const LIGHT_SOURCE_STAND_INS = {
  wall_sconce: null,
  standing_torch: TORCH,
  brazier: BRAZIER,
  candle_cluster: CANDLE_CLUSTER,
  fluorescent_tube: null,
  sodium_lamp: null,
  emergency_light: null,
  glow_fungus: GLOW_FUNGUS,
  vending_glow: null,
  monitor_glow: null,
  boiler_window: null,
  desk_lamp: TORCH,
} as const satisfies Record<LightSourceKind, number | null>;

/** The tile type a light source is placed as, or null when it needs no floor tile. */
export function lightSourceTileType(kind: LightSourceKind): number | null {
  return LIGHT_SOURCE_STAND_INS[kind];
}

/** Every tile type room and hallway dressing can place, for gates and counts. */
export const DRESSING_TILE_TYPES: ReadonlySet<number> = new Set<number>([
  ...[...Object.values(PROP_FAMILY_STAND_INS), ...Object.values(LIGHT_SOURCE_STAND_INS)].filter(
    (type): type is NonNullable<typeof type> => type !== null,
  ),
  // A multi-tile piece's other tiles are dressing as much as its anchor is.
  ...PROP_PART_TILE_TYPES,
]);

// ── Stamps ──────────────────────────────────────────────────────────────────

interface DressingStamp {
  /**
   * Rows of tile types, 0 for a tile the stamp leaves alone. Row 0 is laid
   * against the wall the stamp is set on; rows further from that wall than a
   * stamp may reach are dropped.
   */
  readonly tiles: ReadonlyArray<ReadonlyArray<number>>;
  readonly minZone?: Zone;
  readonly minRoomW?: number;
  readonly minRoomH?: number;
}

const ZONE_ORDER: ReadonlyArray<Zone> = ['entrance', 'mid', 'deep'];

// prettier-ignore
const DRESSING_STAMPS = {
  watch_brazier: {
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     CRATE, BRAZIER, CRATE, 0    ],
      [0,     0,     BONES,   0,     0    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  barrel_crate_rows: {
    tiles: [
      [BARREL,      BARREL,      0, CRATE,       CRATE      ],
      [BARREL_SIDE, BARREL_SIDE, 0, BARREL_SIDE, BARREL_SIDE],
    ],
    minRoomW: 9,
  },
  torch_barrel_crate_row: {
    tiles: [
      [BARREL, CRATE, TORCH, CRATE, BARREL],
      [0,      0,     0,     0,     0     ],
      [BONES,  0,     0,     0,     BONES ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  barrel_row: {
    tiles: [
      [BARREL, BARREL_SIDE, BARREL, BARREL_SIDE, BARREL],
    ],
    minRoomW: 9,
  },
  barrel_bone_field: {
    tiles: [
      [BONES,       0,           BARREL_SIDE, 0    ],
      [0,           BARREL_SIDE, 0,           BONES],
      [BARREL_SIDE, 0,           BONES,       0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  barrel_corners: {
    tiles: [
      [BARREL, 0, 0, 0, BARREL],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [BARREL, 0, 0, 0, BARREL],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  barrel_crate_corner: {
    tiles: [
      [BARREL, BARREL, CRATE],
      [BARREL, 0,      0    ],
      [CRATE,  CRATE,  0    ],
    ],
    minRoomW: 7,
  },
  bone_shrine: {
    minZone: 'mid',
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     BONES, 0,       BONES, 0    ],
      [0,     0,     BRAZIER, 0,     0    ],
      [0,     BONES, 0,       BONES, 0    ],
      [TORCH, 0,     0,       0,     TORCH],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  bone_crate_wall: {
    minZone: 'mid',
    tiles: [
      [BONES, BONES, CRATE, BONES, BONES],
      [BONES, 0,     0,     0,     CRATE],
      [CRATE, 0,     0,     0,     BONES],
    ],
    minRoomW: 9,
  },
  crate_heap: {
    minZone: 'mid',
    tiles: [
      [CRATE, CRATE, CRATE, 0    ],
      [CRATE, 0,     0,     CRATE],
      [BONES, BONES, 0,     0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  shelf_brazier: {
    minZone: 'deep',
    tiles: [
      [BOOKSHELF, 0,     TORCH,   0,     BOOKSHELF],
      [0,         CRATE, BRAZIER, CRATE, 0        ],
      [BONES,     BONES, 0,       BONES, BONES    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  bone_barrel_altar: {
    minZone: 'deep',
    tiles: [
      [BONES,  BONES, BRAZIER, BONES, BONES ],
      [BONES,  0,     0,       0,     BONES ],
      [BARREL, BONES, BONES,   BONES, BARREL],
    ],
    minRoomW: 9, minRoomH: 7,
  },
} as const satisfies Record<DressingStampId, DressingStamp>;

// ── Placement rules ─────────────────────────────────────────────────────────

/**
 * The most of a room's floor, as a share of its area, that dressing may
 * cover with blocking props. Enough for a room to read as furnished while
 * leaving space to fight in.
 */
export const MAX_BLOCKING_PROP_COVERAGE = 0.12;

/**
 * How far in from a room's edge a loose blocking prop may stand: on the edge
 * row or one step in. Keeps furniture against the walls.
 */
const WALL_BAND_DEPTH = 1;

/**
 * How far in a stamp or a walkable scatter piece may reach. A stamp is a
 * composed arrangement read as one group against its wall, so it gets one row
 * more than a loose prop; anything past this is the open middle of the room.
 */
export const STAMP_BAND_DEPTH = 2;

/** Tiles kept free of blocking props on every side of a doorway, spawn point, stairwell or chest. */
const BLOCKING_CLEARANCE_TILES = 1;

/**
 * How far a gas bottle stands from every doorway and every spawn point: its
 * blast must never be the first thing a crawler walks into, nor go off on a
 * mob the moment it spawns.
 */
export const GAS_CYLINDER_CLEARANCE_TILES = 3;

/** Gas bottles one room may hold: one is a hazard to use, two are a minefield. */
export const MAX_GAS_CYLINDERS_PER_ROOM = 1;

/**
 * Tiles that read as a body at game size: a slumped skeleton, a bone pile,
 * and the loose-bones decal, whose skull and ribs read as a whole skeleton
 * lying down. Both floors have skeleton enemies, so a room strewn with them
 * makes a crawler read each one as a threat, and a row of them reads as a
 * squad lying in wait.
 */
export const REMAINS_TILE_TYPES: ReadonlySet<number> = new Set<number>([
  BONES,
  BONE_PILE,
  SLUMPED_SKELETON,
]);

/** Remains one room may hold: enough to say who died here, too few to read as a crowd. */
export const MAX_REMAINS_PER_ROOM = 3;

/** Tiles kept between two remains every way, so they never line up into a row. */
export const REMAINS_SPACING_TILES = 1;

/** Offsets tried along a wall before a family gives up on that wall. */
const MAX_WALL_ATTEMPTS = 24;

/** Random starts a stamp tries against each wall. */
const STAMP_OFFSET_ATTEMPTS = 4;

/** North-face columns kept clear of north-face families in a room that hangs a light on that face. */
const FACE_COLUMNS_KEPT_FOR_LIGHTS = 2;

/** Pieces one corner takes before the rest move on to the next corner. */
const CORNER_CLUSTER_MAX = 2;

/** Blocking props a nook's alcove may hold. */
const MAX_NOOK_PROPS = 2;

/**
 * How far from a crawler sign a nook keeps its alcove bare: wide enough that
 * a five-tile alcove is clear end to end from a sign on any of its walls.
 */
const SIGN_KEEP_CLEAR_TILES = 8;

/** Junctions in one hallway segment that may take scatter. */
const MAX_SCATTER_JUNCTIONS = 3;

/**
 * How far a corridor has to run out of a tile for that direction to count as
 * an arm. Longer than the widest corridor is wide, so the inside of a wide
 * straight run is never a crossing.
 */
const JUNCTION_ARM_TILES = 4;

/** Arms a hallway tile needs to be a junction rather than a bend or a run. */
const JUNCTION_MIN_ARMS = 3;

const SINGLE_TILE_FOOTPRINT: PropFootprint = { w: 1, h: 1 };

/** Corners apart, going round the room, that two diagonally opposite corners lie. */
const OPPOSITE_CORNER_STEP = 2;

/** Chance a stamp tries the north wall before the south. */
const NORTH_WALL_FIRST_CHANCE = 0.5;

type Side = 'north' | 'south' | 'west' | 'east';
const SIDES: ReadonlyArray<Side> = ['north', 'south', 'west', 'east'];

const ORTHOGONAL: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * Whether a tile holds a solid dressing piece with no open floor on any of
 * its four sides. A part tile of a larger piece is judged through the
 * piece's anchor, which is what a blow or a blast strikes.
 */
export function isWalledInPiece(grid: TileContent[][], x: number, y: number): boolean {
  const tile = tileAt(grid, x, y);
  if (tile?.groundType === undefined) return false;
  if (!DRESSING_TILE_TYPES.has(tile.type) || PROP_PART_TILE_TYPES.has(tile.type)) return false;
  if (isWalkableTileType(tile)) return false;
  return !ORTHOGONAL.some((step) => isOpen(grid, x + step.x, y + step.y));
}

/** Whether a tile of this type stops movement, judged the way the map judges it. */
function tileTypeBlocks(tileType: number): boolean {
  return !isWalkableTileType({ tileId: '', type: tileType });
}

function rollCount(range: CountRange, rng: Rng): number {
  return range.min + Math.floor(rng() * (range.max - range.min + 1));
}

function randomIndex(length: number, rng: Rng): number {
  return Math.floor(rng() * length);
}

/** Entries in a weighted random order, heavier ones tending to come first. */
function weightedOrder<T extends { readonly weight: number }>(
  entries: ReadonlyArray<T>,
  rng: Rng,
): T[] {
  const remaining = [...entries];
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const next = pickWeighted(remaining, rng);
    if (next === null) break;
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

// ── Rooms ───────────────────────────────────────────────────────────────────

/** Everything about a room its dressing needs besides the grid. */
export interface RoomDressingSite {
  readonly bounds: Readonly<Rect>;
  /** The room's own floor type; only tiles still of this type are dressed. */
  readonly floor: number;
  readonly zone: Zone;
  readonly doorways: ReadonlyArray<RoomDoorway>;
  /** A tile nothing may stand on or next to: a spawn point, a stairwell footprint, a chest. */
  readonly isReserved: (x: number, y: number) => boolean;
  /** Whether making a tile solid would cut the room's walkable floor apart. */
  readonly wouldSplitRoom: (x: number, y: number) => boolean;
}

/** What one room's dressing placed. */
export interface RoomDressingResult {
  readonly blockingTiles: number;
  readonly walkableTiles: number;
}

/**
 * Dresses one populated room from its character, in priority order: its
 * lights, then possibly one stamp against a wall, then its loose families.
 */
export function dressRoom(
  grid: TileContent[][],
  site: RoomDressingSite,
  assignment: RoomCharacterAssignment,
  rng: Rng,
): RoomDressingResult {
  const placer = new RoomPlacer(grid, site);
  const plansFaceLight =
    !assignment.unlit &&
    assignment.character.lighting.sources.some((source) => source.placement === 'north-face');
  if (plansFaceLight) placer.keepNorthFaceColumnsFree(FACE_COLUMNS_KEPT_FOR_LIGHTS);
  const { character } = assignment;
  if (!assignment.unlit) {
    for (const source of character.lighting.sources) placer.placeLight(source, rng);
  }
  if (character.stamps.length > 0 && rng() < character.stampChance) {
    const eligible = character.stamps.filter((choice) => placer.stampFits(choice.id));
    const choice = pickWeighted(eligible, rng);
    if (choice !== null) placer.placeStamp(choice.id, rng);
  }
  for (const entry of weightedOrder(character.props, rng)) {
    // A piece that carries a flame or a glow is a light, and an unlit room has none.
    const tileType = propFamilyTileType(entry.family);
    if (assignment.unlit && tileType !== null && CELLAR_LIGHT_CARRYING_TILE_TYPES.has(tileType)) {
      continue;
    }
    placer.placeFamily(entry, rng);
  }
  return { blockingTiles: placer.blockingPlaced, walkableTiles: placer.walkablePlaced };
}

/**
 * Dresses a special room — the start room, a safe room, the nursery, a boss
 * room — from what its region declares: its standing lights, then its loose
 * props. Wall-hung lights are left to the room's own system (the nursery
 * hangs its sconces itself), and a region that declares nothing is left as
 * its own system built it.
 */
export function dressSpecialRoom(
  grid: TileContent[][],
  site: RoomDressingSite,
  lighting: LightingProfile | null,
  props: ReadonlyArray<PropSetEntry>,
  rng: Rng,
): RoomDressingResult {
  const placer = new RoomPlacer(grid, site);
  for (const source of lighting?.sources ?? []) placer.placeLight(source, rng);
  for (const entry of weightedOrder(props, rng)) placer.placeFamily(entry, rng);
  return { blockingTiles: placer.blockingPlaced, walkableTiles: placer.walkablePlaced };
}

class RoomPlacer {
  blockingPlaced = 0;
  /** Tiles of the north wall's row the north-face families may still take. */
  private northFaceTilesLeft = Number.POSITIVE_INFINITY;
  walkablePlaced = 0;
  private gasCylindersPlaced = 0;
  private remainsPlaced = 0;
  private readonly blockingBudget: number;
  private readonly doorwayGuard = new Set<string>();
  private readonly right: number;
  private readonly bottom: number;

  constructor(
    private readonly grid: TileContent[][],
    private readonly site: RoomDressingSite,
  ) {
    const { bounds } = site;
    this.right = bounds.x + bounds.w - 1;
    this.bottom = bounds.y + bounds.h - 1;
    this.blockingBudget = Math.floor(bounds.w * bounds.h * MAX_BLOCKING_PROP_COVERAGE);
    for (const doorway of site.doorways) {
      for (const tile of doorway.tiles) {
        for (let dy = -BLOCKING_CLEARANCE_TILES; dy <= BLOCKING_CLEARANCE_TILES; dy++) {
          for (let dx = -BLOCKING_CLEARANCE_TILES; dx <= BLOCKING_CLEARANCE_TILES; dx++) {
            this.doorwayGuard.add(`${tile.x + dx},${tile.y + dy}`);
          }
        }
      }
    }
  }

  /** Tiles between a tile and the nearest edge of the room; 0 on the edge row. */
  private depthOf(x: number, y: number): number {
    const { bounds } = this.site;
    return Math.min(x - bounds.x, this.right - x, y - bounds.y, this.bottom - y);
  }

  private nearReserved(x: number, y: number): boolean {
    for (let dy = -BLOCKING_CLEARANCE_TILES; dy <= BLOCKING_CLEARANCE_TILES; dy++) {
      for (let dx = -BLOCKING_CLEARANCE_TILES; dx <= BLOCKING_CLEARANCE_TILES; dx++) {
        if (this.site.isReserved(x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  /** Whether a tile may take a prop, before the split test that only placement can answer. */
  private tileAccepts(x: number, y: number, blocks: boolean, maxDepth: number): boolean {
    const { bounds } = this.site;
    if (x < bounds.x || x > this.right || y < bounds.y || y > this.bottom) return false;
    if (this.grid[y]?.[x]?.type !== this.site.floor) return false;
    if (this.depthOf(x, y) > maxDepth) return false;
    if (!blocks) return !this.site.isReserved(x, y);
    if (this.doorwayGuard.has(`${x},${y}`)) return false;
    return !this.nearReserved(x, y);
  }

  /**
   * Places one piece over `cells`, all or nothing. Blocking cells are made
   * solid one at a time and each is split-tested against the ones before it,
   * so a piece that would wall off part of the room is taken back whole.
   */
  private tryPlace(
    cells: ReadonlyArray<Point>,
    tileType: number,
    blocks: boolean,
    maxDepth: number,
  ): boolean {
    if (cells.length === 0) return false;
    if (blocks && this.blockingPlaced + cells.length > this.blockingBudget) return false;
    if (!cells.every((cell) => this.tileAccepts(cell.x, cell.y, blocks, maxDepth))) return false;
    const isGasCylinder = tileType === GAS_CYLINDER;
    if (isGasCylinder && !this.gasCylinderFits(cells)) return false;
    const isRemains = REMAINS_TILE_TYPES.has(tileType);
    if (isRemains && !this.remainsFit(cells)) return false;
    const placed: Array<{ tile: TileContent; groundType: number | undefined }> = [];
    const takeBack = (): false => {
      for (const undo of placed) {
        undo.tile.type = this.site.floor;
        undo.tile.groundType = undo.groundType;
      }
      return false;
    };
    const pieceTypes = multiTilePieceTypes(tileType, cells);
    for (const [index, cell] of cells.entries()) {
      if (blocks && this.site.wouldSplitRoom(cell.x, cell.y)) return takeBack();
      const tile = this.grid[cell.y][cell.x];
      placed.push({ tile, groundType: tile.groundType });
      placeProp(tile, pieceTypes[index] ?? tileType);
    }
    if (blocks && cells.some((cell) => this.walledInAround(cell))) return takeBack();
    if (blocks) this.blockingPlaced += cells.length;
    else this.walkablePlaced += cells.length;
    if (isGasCylinder) this.gasCylindersPlaced++;
    if (isRemains) this.remainsPlaced += cells.length;
    return true;
  }

  /**
   * Whether a tile or any piece beside it is now walled in: a solid piece
   * with no open floor on any side. A walled-in piece cannot be struck, so
   * a crate or a lamp boxed in by its neighbours could never be broken, and
   * a lamp that cannot be broken is a light that can never go out.
   */
  private walledInAround(cell: Point): boolean {
    if (isWalledInPiece(this.grid, cell.x, cell.y)) return true;
    return ORTHOGONAL.some((step) => isWalledInPiece(this.grid, cell.x + step.x, cell.y + step.y));
  }

  /** Whether remains may lie on `cells`: the room's cap, and no other remains beside them. */
  private remainsFit(cells: ReadonlyArray<Point>): boolean {
    if (this.remainsPlaced + cells.length > MAX_REMAINS_PER_ROOM) return false;
    const reach = REMAINS_SPACING_TILES;
    return cells.every((cell) => {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const neighbour = tileAt(this.grid, cell.x + dx, cell.y + dy);
          if (neighbour !== null && REMAINS_TILE_TYPES.has(neighbour.type)) return false;
        }
      }
      return true;
    });
  }

  /** Whether a gas bottle may stand on `cells`: the room's cap, and clear of doorways and spawns. */
  private gasCylinderFits(cells: ReadonlyArray<Point>): boolean {
    if (this.gasCylindersPlaced >= MAX_GAS_CYLINDERS_PER_ROOM) return false;
    const reach = GAS_CYLINDER_CLEARANCE_TILES;
    return cells.every((cell) => {
      const nearDoorway = this.site.doorways.some((doorway) =>
        doorway.tiles.some(
          (tile) => Math.abs(tile.x - cell.x) <= reach && Math.abs(tile.y - cell.y) <= reach,
        ),
      );
      if (nearDoorway) return false;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (this.site.isReserved(cell.x + dx, cell.y + dy)) return false;
        }
      }
      return true;
    });
  }

  /** The cells of a piece set against `side` at `offset` tiles along it. */
  private cellsAgainst(side: Side, offset: number, footprint: PropFootprint): Point[] {
    const { bounds } = this.site;
    const cells: Point[] = [];
    // A piece's width runs along the wall and its depth away from it, so a
    // two-across piece stands lengthways against whichever wall it is set on.
    for (let along = 0; along < footprint.w; along++) {
      for (let away = 0; away < footprint.h; away++) {
        switch (side) {
          case 'north':
            cells.push({ x: bounds.x + offset + along, y: bounds.y + away });
            break;
          case 'south':
            cells.push({ x: bounds.x + offset + along, y: this.bottom - away });
            break;
          case 'west':
            cells.push({ x: bounds.x + away, y: bounds.y + offset + along });
            break;
          case 'east':
            cells.push({ x: this.right - away, y: bounds.y + offset + along });
            break;
        }
      }
    }
    return cells;
  }

  private sideLength(side: Side): number {
    return side === 'north' || side === 'south' ? this.site.bounds.w : this.site.bounds.h;
  }

  /**
   * Places up to `count` pieces side by side along one wall, starting from a
   * random offset and sliding past anything in the way.
   */
  private placeAlong(
    side: Side,
    count: number,
    footprint: PropFootprint,
    tileType: number,
    blocks: boolean,
    rng: Rng,
  ): number {
    const length = this.sideLength(side);
    const slots = length - footprint.w + 1;
    if (slots <= 0) return 0;
    let offset = randomIndex(slots, rng);
    let placed = 0;
    for (let attempt = 0; attempt < MAX_WALL_ATTEMPTS && placed < count; attempt++) {
      const cells = this.cellsAgainst(side, offset % slots, footprint);
      if (this.tryPlace(cells, tileType, blocks, WALL_BAND_DEPTH)) {
        placed++;
        offset += footprint.w;
      } else {
        offset++;
      }
    }
    return placed;
  }

  /** Walls in a random order, longer ones tending to come first. */
  private sidesInOrder(rng: Rng): Side[] {
    return weightedOrder(
      SIDES.map((side) => ({ side, weight: this.sideLength(side) })),
      rng,
    ).map((entry) => entry.side);
  }

  /**
   * The room's four corners going round the room from a random one, each as
   * its tiles nearest-first.
   */
  private cornerCells(rng: Rng): Point[][] {
    const { bounds } = this.site;
    // Listed round the room, so any corner and the one two places after it
    // are diagonally opposite.
    const corners = [
      { x: bounds.x, y: bounds.y, dx: 1, dy: 1 },
      { x: this.right, y: bounds.y, dx: -1, dy: 1 },
      { x: this.right, y: this.bottom, dx: -1, dy: -1 },
      { x: bounds.x, y: this.bottom, dx: 1, dy: -1 },
    ];
    const start = randomIndex(corners.length, rng);
    const nearFirst: ReadonlyArray<Point> = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
    ];
    return corners.map((_, index) => {
      const corner = corners[(start + index) % corners.length];
      return nearFirst.map((step) => ({
        x: corner.x + step.x * corner.dx,
        y: corner.y + step.y * corner.dy,
      }));
    });
  }

  /** Every tile in the wall band, in a random order. */
  private shuffledBand(maxDepth: number, rng: Rng): Point[] {
    const { bounds } = this.site;
    const tiles: Point[] = [];
    for (let y = bounds.y; y <= this.bottom; y++) {
      for (let x = bounds.x; x <= this.right; x++) {
        if (this.depthOf(x, y) <= maxDepth) tiles.push({ x, y });
      }
    }
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1, rng);
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return tiles;
  }

  /**
   * Holds back `columns` of the north wall's row from the families lined up
   * along it, so the face above them stays clear for a wall light: a rack or
   * cask standing in front of a sconce would hide it.
   */
  keepNorthFaceColumnsFree(columns: number): void {
    this.northFaceTilesLeft = Math.max(0, this.site.bounds.w - columns);
  }

  placeFamily(entry: PropSetEntry, rng: Rng): void {
    const tileType = propFamilyTileType(entry.family);
    const count = rollCount(entry.count, rng);
    if (tileType === null || count === 0) return;
    // Judged by the tile actually placed, not the family it stands in for: a
    // bone pile drawn as a walkable bone decal must not spend the room's
    // blocking budget or be held to the doorway clearance a solid pile needs.
    const blocks = tileTypeBlocks(tileType);
    const { footprint } = PROP_FAMILIES[entry.family];
    this.placePieces(entry.placement, count, footprint, tileType, blocks, rng);
  }

  private placePieces(
    placement: PropSetEntry['placement'],
    count: number,
    footprint: PropFootprint,
    tileType: number,
    blocks: boolean,
    rng: Rng,
  ): void {
    const singleTile = footprint.w === 1 && footprint.h === 1;
    switch (placement) {
      case 'north-face': {
        const fits = Math.floor(this.northFaceTilesLeft / footprint.w);
        const placed = this.placeAlong(
          'north',
          Math.min(count, fits),
          footprint,
          tileType,
          blocks,
          rng,
        );
        this.northFaceTilesLeft -= placed * footprint.w;
        return;
      }
      case 'wall':
        this.placeOnWalls(count, footprint, tileType, blocks, rng);
        return;
      case 'corner':
        if (singleTile) this.placeInCorner(count, tileType, blocks, rng);
        else this.placeOnWalls(count, footprint, tileType, blocks, rng);
        return;
      case 'cluster':
        if (singleTile) this.placeCluster(count, tileType, blocks, rng);
        else this.placeOnWalls(count, footprint, tileType, blocks, rng);
        return;
      case 'scatter':
        if (singleTile && !blocks) this.placeScatter(count, tileType, rng);
        else this.placeOnWalls(count, footprint, tileType, blocks, rng);
        return;
    }
  }

  private placeOnWalls(
    count: number,
    footprint: PropFootprint,
    tileType: number,
    blocks: boolean,
    rng: Rng,
  ): void {
    let remaining = count;
    for (const side of this.sidesInOrder(rng)) {
      if (remaining <= 0) return;
      // A piece wider than a tile is laid with its anchor on its south-west
      // tile and its parts to the east, so it can only lie along a north or
      // south wall; against a side wall it would stand on end.
      if (footprint.w > 1 && (side === 'west' || side === 'east')) continue;
      remaining -= this.placeAlong(side, remaining, footprint, tileType, blocks, rng);
    }
  }

  /**
   * Packs pieces into corners, at most {@link CORNER_CLUSTER_MAX} to a corner,
   * so a large count spreads round the room rather than piling into one.
   */
  private placeInCorner(count: number, tileType: number, blocks: boolean, rng: Rng): void {
    let placed = 0;
    for (const cells of this.cornerCells(rng)) {
      let inCorner = 0;
      for (const cell of cells) {
        if (placed >= count) return;
        if (inCorner >= CORNER_CLUSTER_MAX) break;
        if (this.tryPlace([cell], tileType, blocks, WALL_BAND_DEPTH)) {
          placed++;
          inCorner++;
        }
      }
    }
  }

  /** A clump grown outwards from one edge tile, never deeper than the wall band. */
  private placeCluster(count: number, tileType: number, blocks: boolean, rng: Rng): void {
    const seeds = this.shuffledBand(0, rng);
    for (const seed of seeds) {
      if (!this.tryPlace([seed], tileType, blocks, WALL_BAND_DEPTH)) continue;
      const clump: Point[] = [seed];
      for (let index = 0; index < clump.length && clump.length < count; index++) {
        for (const step of ORTHOGONAL) {
          if (clump.length >= count) break;
          const next = { x: clump[index].x + step.x, y: clump[index].y + step.y };
          if (this.tryPlace([next], tileType, blocks, WALL_BAND_DEPTH)) clump.push(next);
        }
      }
      return;
    }
  }

  private placeScatter(count: number, tileType: number, rng: Rng): void {
    let placed = 0;
    for (const tile of this.shuffledBand(STAMP_BAND_DEPTH, rng)) {
      if (placed >= count) return;
      if (this.tryPlace([tile], tileType, false, STAMP_BAND_DEPTH)) placed++;
    }
  }

  placeLight(source: LightSourceSpec, rng: Rng): void {
    const tileType = lightSourceTileType(source.kind);
    if (tileType === null) return;
    const blocks = tileTypeBlocks(tileType);
    const count = 'count' in source.amount ? rollCount(source.amount.count, rng) : 1;
    if (count === 0) return;
    switch (source.placement) {
      case 'north-face':
      case 'ceiling':
        this.placeSpreadAlongNorth(count, tileType, blocks);
        return;
      case 'corner':
      case 'cluster':
        this.placeInOppositeCorners(count, tileType, blocks, rng);
        return;
      // A light carried by a prop that has no tile of its own yet (a desk
      // lamp without its desk) stands against a wall in the prop's place.
      case 'wall':
      case 'on-prop':
        this.placeOnWalls(count, SINGLE_TILE_FOOTPRINT, tileType, blocks, rng);
        return;
    }
  }

  /** Lights spaced evenly along the north wall, as a row of sconces would be. */
  private placeSpreadAlongNorth(count: number, tileType: number, blocks: boolean): void {
    const { bounds } = this.site;
    for (let index = 0; index < count; index++) {
      const target = Math.floor(((index + 1) * bounds.w) / (count + 1));
      // Nudged outwards from the ideal spot until a tile accepts it.
      for (let nudge = 0; nudge < bounds.w; nudge++) {
        const direction = nudge % 2 === 0 ? 1 : -1;
        const x = bounds.x + target + direction * Math.ceil(nudge / 2);
        if (this.tryPlace([{ x, y: bounds.y }], tileType, blocks, WALL_BAND_DEPTH)) break;
      }
    }
  }

  /**
   * Lights one to a corner, diagonally opposite corners first, so a pair
   * lights the room from both ends and a third and fourth take the corners
   * still dark.
   */
  private placeInOppositeCorners(count: number, tileType: number, blocks: boolean, rng: Rng): void {
    const corners = this.cornerCells(rng);
    const oppositePairsFirst = [
      corners[0],
      corners[OPPOSITE_CORNER_STEP],
      corners[1],
      corners[1 + OPPOSITE_CORNER_STEP],
    ];
    let placed = 0;
    for (const cells of oppositePairsFirst) {
      if (placed >= count) return;
      for (const cell of cells) {
        if (this.tryPlace([cell], tileType, blocks, WALL_BAND_DEPTH)) {
          placed++;
          break;
        }
      }
    }
  }

  stampFits(id: DressingStampId): boolean {
    const stamp: DressingStamp = DRESSING_STAMPS[id];
    const { bounds } = this.site;
    const width = stamp.tiles[0]?.length ?? 0;
    if (width > bounds.w || stamp.tiles.length > bounds.h) return false;
    if (stamp.minRoomW !== undefined && bounds.w < stamp.minRoomW) return false;
    if (stamp.minRoomH !== undefined && bounds.h < stamp.minRoomH) return false;
    if (stamp.minZone === undefined) return true;
    return ZONE_ORDER.indexOf(this.site.zone) >= ZONE_ORDER.indexOf(stamp.minZone);
  }

  /**
   * Sets a stamp against the north or the south wall, its first row on the
   * wall. Each tile goes through the same checks as a loose prop, so a stamp
   * that meets a doorway or the room's middle loses those tiles rather than
   * breaking a rule; one that places nothing is tried at another offset.
   */
  placeStamp(id: DressingStampId, rng: Rng): void {
    const stamp: DressingStamp = DRESSING_STAMPS[id];
    const { bounds } = this.site;
    const width = stamp.tiles[0]?.length ?? 0;
    const slots = bounds.w - width + 1;
    if (slots <= 0) return;
    const walls: ReadonlyArray<'north' | 'south'> =
      rng() < NORTH_WALL_FIRST_CHANCE ? ['north', 'south'] : ['south', 'north'];
    for (const wall of walls) {
      for (let attempt = 0; attempt < STAMP_OFFSET_ATTEMPTS; attempt++) {
        const originX = bounds.x + randomIndex(slots, rng);
        let placed = 0;
        stamp.tiles.forEach((row, rowIndex) => {
          const y = wall === 'north' ? bounds.y + rowIndex : this.bottom - rowIndex;
          row.forEach((tileType, column) => {
            if (tileType === 0) return;
            const blocks = tileTypeBlocks(tileType);
            if (this.tryPlace([{ x: originX + column, y }], tileType, blocks, STAMP_BAND_DEPTH)) {
              placed++;
            }
          });
        });
        if (placed > 0) return;
      }
    }
  }
}

// ── Hallways ────────────────────────────────────────────────────────────────

/** Everything about a hallway segment its dressing needs besides the grid. */
export interface HallwayDressingSite {
  readonly hallway: HallwayRegion;
  /** The corridor shape that carved a tile, or undefined for a tile no corridor carved. */
  readonly corridorKindAt: (x: number, y: number) => HallwayKind | undefined;
  /** A tile nothing may stand on or, for a blocking prop, next to. */
  readonly isReserved: (x: number, y: number) => boolean;
  /** Whether a tile lies inside any room's rectangle. */
  readonly isRoomTile: (x: number, y: number) => boolean;
}

const PLAIN_FLOOR_TYPES: ReadonlySet<number> = new Set<number>([
  FloorTypeValue.concrete,
  FloorTypeValue.tile_floor,
  FloorTypeValue.carpet,
  FloorTypeValue.wood,
]);

/** The tile at a position, or null off the grid. */
function tileAt(grid: TileContent[][], x: number, y: number): TileContent | null {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return null;
  return grid[y][x];
}

function isPlainFloor(grid: TileContent[][], x: number, y: number): boolean {
  const tile = tileAt(grid, x, y);
  return tile !== null && PLAIN_FLOOR_TYPES.has(tile.type) && tile.groundType === undefined;
}

function isOpen(grid: TileContent[][], x: number, y: number): boolean {
  const tile = tileAt(grid, x, y);
  return tile !== null && isWalkableTileType(tile);
}

/**
 * Whether a tile is the inside corner of an open area at least two tiles
 * wide: open on exactly two perpendicular sides, closed on the other two, with
 * the diagonal between the open sides open too.
 *
 * Such a tile is off every walking line — a one-tile lane has no such
 * corner, since its bend tile's diagonal is wall — and making it solid can
 * never disconnect anything: its two open neighbours still meet through the
 * diagonal.
 */
export function isOpenAreaCorner(grid: TileContent[][], x: number, y: number): boolean {
  const open = ORTHOGONAL.map((step) => isOpen(grid, x + step.x, y + step.y));
  if (open.filter(Boolean).length !== 2) return false;
  for (let index = 0; index < ORTHOGONAL.length; index++) {
    const next = (index + 1) % ORTHOGONAL.length;
    if (!open[index] || !open[next]) continue;
    const diagonalX = x + ORTHOGONAL[index].x + ORTHOGONAL[next].x;
    const diagonalY = y + ORTHOGONAL[index].y + ORTHOGONAL[next].y;
    return isOpen(grid, diagonalX, diagonalY);
  }
  return false;
}

/**
 * Whether a crawler sign stands within {@link SIGN_KEEP_CLEAR_TILES} of a tile.
 * A sign's arrow is aimed across the open floor of the junction it was
 * planned on; a prop standing in that floor afterwards changes the
 * junction's shape and can leave the arrow pointing at a way out that is no
 * longer the first one a crawler meets.
 */
function nearCrawlerSign(grid: TileContent[][], tile: Point): boolean {
  for (let dy = -SIGN_KEEP_CLEAR_TILES; dy <= SIGN_KEEP_CLEAR_TILES; dy++) {
    for (let dx = -SIGN_KEEP_CLEAR_TILES; dx <= SIGN_KEEP_CLEAR_TILES; dx++) {
      if (grid[tile.y + dy]?.[tile.x + dx]?.type === CRAWLER_SIGN) return true;
    }
  }
  return false;
}

/**
 * Dresses one hallway segment: walkable scatter where corridors meet, and at
 * most {@link MAX_NOOK_PROPS} blocking pieces tucked into the corners of a
 * nook's alcove. The walking lane never takes a blocking prop.
 */
export function dressHallway(
  grid: TileContent[][],
  site: HallwayDressingSite,
  character: HallwayCharacter,
  rng: Rng,
): void {
  const { hallway } = site;
  const nearRoomOrReserved = (x: number, y: number): boolean => {
    for (let dy = -BLOCKING_CLEARANCE_TILES; dy <= BLOCKING_CLEARANCE_TILES; dy++) {
      for (let dx = -BLOCKING_CLEARANCE_TILES; dx <= BLOCKING_CLEARANCE_TILES; dx++) {
        if (site.isRoomTile(x + dx, y + dy) || site.isReserved(x + dx, y + dy)) return true;
      }
    }
    return false;
  };

  if (character.junctionScatter.length > 0) {
    const segmentTiles = new Set(hallway.tiles.map((tile) => `${tile.x},${tile.y}`));
    const junctions = hallway.tiles.filter((tile) => {
      let arms = 0;
      for (const step of ORTHOGONAL) {
        let reach = 1;
        while (
          reach <= JUNCTION_ARM_TILES &&
          segmentTiles.has(`${tile.x + step.x * reach},${tile.y + step.y * reach}`)
        ) {
          reach++;
        }
        if (reach > JUNCTION_ARM_TILES) arms++;
      }
      return arms >= JUNCTION_MIN_ARMS;
    });
    const chosen = weightedOrder(
      junctions.map((tile) => ({ tile, weight: 1 })),
      rng,
    ).slice(0, MAX_SCATTER_JUNCTIONS);
    for (const { tile } of chosen) {
      for (const entry of character.junctionScatter) {
        const tileType = propFamilyTileType(entry.family);
        if (tileType === null || tileTypeBlocks(tileType)) continue;
        let remaining = rollCount(entry.count, rng);
        for (const step of [{ x: 0, y: 0 }, ...ORTHOGONAL]) {
          if (remaining <= 0) break;
          const x = tile.x + step.x;
          const y = tile.y + step.y;
          if (!segmentTiles.has(`${x},${y}`) || !isPlainFloor(grid, x, y)) continue;
          if (site.isReserved(x, y)) continue;
          placeProp(grid[y][x], tileType);
          remaining--;
        }
      }
    }
  }

  if (!hallway.hallwayKinds.includes('nook') || character.nookProps.length === 0) return;
  let nookBudget = MAX_NOOK_PROPS;
  const nookPropsPlaced: Point[] = [];
  // Two pieces touching would close off each other's open side, and a piece
  // that is no longer an open corner is one a lane might run past.
  const touchesPlacedProp = (tile: Point): boolean =>
    nookPropsPlaced.some(
      (placed) => Math.abs(placed.x - tile.x) <= 1 && Math.abs(placed.y - tile.y) <= 1,
    );
  const alcoveTiles = hallway.tiles.filter(
    (tile) => site.corridorKindAt(tile.x, tile.y) === 'nook',
  );
  for (const entry of weightedOrder(character.nookProps, rng)) {
    const tileType = propFamilyTileType(entry.family);
    const family = PROP_FAMILIES[entry.family];
    const singleTile = family.footprint.w === 1 && family.footprint.h === 1;
    // A hallway is all walking lane and doorway, so a gas bottle never stands in one.
    if (tileType === null || tileType === GAS_CYLINDER || !family.blocks || !singleTile) continue;
    let remaining = Math.min(rollCount(entry.count, rng), nookBudget);
    const candidates = weightedOrder(
      alcoveTiles.map((tile) => ({ tile, weight: 1 })),
      rng,
    );
    for (const { tile } of candidates) {
      if (remaining <= 0) break;
      if (!isPlainFloor(grid, tile.x, tile.y)) continue;
      if (!isOpenAreaCorner(grid, tile.x, tile.y)) continue;
      if (nearRoomOrReserved(tile.x, tile.y) || touchesPlacedProp(tile)) continue;
      if (nearCrawlerSign(grid, tile)) continue;
      placeProp(grid[tile.y][tile.x], tileType);
      nookPropsPlaced.push(tile);
      remaining--;
      nookBudget--;
    }
  }
}
