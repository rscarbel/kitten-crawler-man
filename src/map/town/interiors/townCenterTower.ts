/**
 * The Town Center Tower, storey by storey, from the cistern under the hill to
 * the cattery at the top where the Warden keeps the town's cats.
 *
 * - **0, the cistern.** Below ground, reached only up the sewer's cistern
 *   culvert. Brick, the town's water in a deep basin, and the ward conduit: a
 *   channel of water-borne light running from its sluice in the north wall
 *   down to the drain, which feeds the wards upstairs.
 * - **1, the gatehouse.** The guard hall behind the front door, where the
 *   tower guards keep their watch between the cellar stair and the stair up.
 * - **2, the kitchen.** Hearth, worktable and the larder behind its wall,
 *   with the dumbwaiter's foot on the west wall and the stair up barred by a
 *   portcullis that is raised only from above.
 * - **3, the bell storey.** The bells, their beams, the gear train and the
 *   counterweight that holds the kitchen's portcullis.
 * - **4, the warded archive.** Ranks of filing between ward-lined aisles, and
 *   the dumbwaiter's upper hatch.
 * - **5, the cattery and observatory.** Cages along both side walls, the
 *   ritual circle under the observatory window, and the binding pillars round
 *   it. The Warden is fought here.
 *
 * Each storey is a plan of rows (its walls, its floor, its stairs, its water)
 * plus props placed by code. Every storey keeps its stair blocks clear, the
 * two landing rows below each stair clear, the stairs joined to each other
 * and to every walkable tile of the storey, and each reserved mechanic zone
 * open floor with no prop in it.
 *
 * **The top storey is an arena.** The Lich anchors at the north wall and
 * sweeps the room south with walls of fire, each wave born on the first row
 * from which every column runs clear to the south wall. So everything that
 * blocks stands either against a side wall (the cages), against the north
 * wall (the hearth), or in the band at the Lich's end above that row (the
 * binding pillars round the circle); the floor from there to the south wall
 * is open, which is where the waves travel.
 *
 * A storey reads the quest only through {@link TowerConditions}, derived from
 * the progress object, so a storey built at any phase is that phase's storey.
 */

import type { SoundId } from '../../../audio/sounds';
import type { ItemId } from '../../../core/items/defs/ItemDefs';
import {
  missingCatsProgressAt,
  phaseReached,
  type MissingCatsProgress,
} from '../../../core/quests/missingCatsProgress';
import { CAT_ALLY_IDS, type CatAllyId } from '../../../core/party/partySplit';
import { DEFAULT_DUNGEON_FLOOR_THEME, type DungeonFloorThemeId } from '../../dungeon/floorTheme';
import { TOWN_CAT_IDS, type TownCatId } from '../../../core/state/townCatIds';
import {
  CAT_LEDGE,
  FLOOR_DROP,
  FloorTypeValue,
  INTERIOR_BOARD_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_INK_FLOOR,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  RUG,
  TOWER_STAIR_SPAN,
} from '../../tileTypes';
import {
  LARDER_DOOR_VARIANT,
  LOOSE_THING_VARIANT,
  WALL_FITTING_VARIANT,
  WARD_STONE_VARIANT,
} from '../../../sprites/art/townInterior/rooms/towerWorks';
import { knockableProp, prop, statefulProp, tile, type TownInteriorLayoutEntry } from './types';
import type { StatelessTownInteriorPropId } from '../../../sprites/art/townInterior/townInteriorProps';

// ── The storeys ──────────────────────────────────────────────────────────────

/** Every storey of the tower, bottom up; a storey's index is its place here. */
export const TOWER_STOREY_IDS = [
  'cistern',
  'gatehouse',
  'kitchen',
  'bell_storey',
  'archive',
  'cattery',
] as const;

export type TowerStoreyId = (typeof TOWER_STOREY_IDS)[number];

/** The storey at `index`, or null past either end. */
export function towerStoreyAt(index: number): TowerStoreyId | null {
  return TOWER_STOREY_IDS[index] ?? null;
}

/** Where `storey` stands in the climb. */
export function towerStoreyIndex(storey: TowerStoreyId): number {
  return TOWER_STOREY_IDS.indexOf(storey);
}

/** Each storey as its banner and its stair prompts name it. */
const TOWER_STOREY_LABELS = {
  cistern: 'Cistern',
  gatehouse: 'Gatehouse',
  kitchen: 'Kitchen',
  bell_storey: 'Bell Storey',
  archive: 'Archive',
  cattery: 'Cattery',
} as const satisfies Record<TowerStoreyId, string>;

/** The label for the storey at `index`, for a caller that counts storeys by number. */
export function towerStoreyLabel(index: number): string {
  const storey = towerStoreyAt(index);
  return storey === null ? `Storey ${index}` : TOWER_STOREY_LABELS[storey];
}

// ── What the quest has done to the tower ─────────────────────────────────────

/**
 * How the archive's wards stand: burning solid until the conduit is shut,
 * pulsing on a rhythm after, sweeping on their tracks once the Warden knows
 * the party is inside, and spent once the Warden is gone.
 */
export type TowerWardState = 'solid' | 'pulsing' | 'sweeping' | 'spent';

/** Whose cage a cattery cage is: a town cat's, the stray's who shares the cattery, or the crawlers' cat's. */
export type CatteryCageOccupant = TownCatId | CatAllyId | 'crawler_cat';

/** Everything a storey's build reads from the quest. */
export interface TowerConditions {
  readonly conduit: 'running' | 'shut';
  /** The kitchen's portcullis, raised by the bell storey's counterweight falling. */
  readonly portcullis: 'shut' | 'raised';
  readonly larder: 'locked' | 'open';
  readonly wards: TowerWardState;
  /** The archive's hole in the floor, open until the cat's chapter there has laid a shelf board across it. */
  readonly archiveFloor: 'holed' | 'bridged';
  /** Whether the archivist's key ring has gone down the dumbwaiter, so its shelf top is bare. */
  readonly keyRingSent: boolean;
  readonly ritual: 'dark' | 'lit';
  readonly openCages: ReadonlySet<CatteryCageOccupant>;
  /** Town cats bound to a pillar of the circle: every one nobody let out. */
  readonly boundCats: ReadonlySet<TownCatId>;
}

/**
 * The archive's wards while the party is apart, by the cistern's conduit: fed
 * by it and burning solid, or starved once its sluice is shut and pulsing.
 */
export const ARCHIVE_WARDS_BY_CONDUIT = {
  running: 'solid',
  shut: 'pulsing',
} as const satisfies Record<TowerConditions['conduit'], TowerWardState>;

/** The tower as the questline leaves it. */
export function towerConditionsFor(
  progress: Pick<
    MissingCatsProgress,
    | 'phase'
    | 'conduitShut'
    | 'catsFreed'
    | 'crawlerCatUncaged'
    | 'cellmateFreed'
    | 'larderOpened'
    | 'portcullisRaised'
    | 'keyRingSent'
  >,
): TowerConditions {
  const crawlerCatOut = phaseReached(progress, 'cistern');
  const reunited = phaseReached(progress, 'ascent');
  const wardenGone = phaseReached(progress, 'aftermath');
  const conduit = progress.conduitShut ? 'shut' : 'running';
  const wards: TowerWardState = wardenGone
    ? 'spent'
    : reunited
      ? 'sweeping'
      : ARCHIVE_WARDS_BY_CONDUIT[conduit];
  const openCages = new Set<CatteryCageOccupant>(
    wardenGone ? [...TOWN_CAT_IDS, ...CAT_ALLY_IDS, 'crawler_cat'] : progress.catsFreed,
  );
  if (crawlerCatOut || progress.crawlerCatUncaged) openCages.add('crawler_cat');
  if (progress.cellmateFreed) {
    for (const ally of CAT_ALLY_IDS) openCages.add(ally);
  }
  const boundCats = new Set(
    wardenGone ? [] : TOWN_CAT_IDS.filter((cat) => !progress.catsFreed.has(cat)),
  );
  return {
    conduit,
    portcullis: reunited || progress.portcullisRaised ? 'raised' : 'shut',
    larder: progress.larderOpened || reunited ? 'open' : 'locked',
    wards,
    archiveFloor: phaseReached(progress, 'gatehouse') ? 'bridged' : 'holed',
    keyRingSent: progress.keyRingSent,
    ritual: reunited && !wardenGone ? 'lit' : 'dark',
    openCages,
    boundCats,
  };
}

// ── Plans ────────────────────────────────────────────────────────────────────

/**
 * The glyphs a storey's rows are written in.
 *
 * ```
 *  #  wall                     .  the storey's floor
 *  U  the stair up             D  the stair down (each a 2×2 block)
 *  +  the front door, in the south wall
 *  ~  the ward conduit's channel   o  the cistern basin
 *  ,  the cistern's overflow, ankle deep
 *  L  a ledge only a cat stands on   _  a drop through the floor
 * ```
 */
const PLAN_CHAR = {
  wall: '#',
  floor: '.',
  stairUp: 'U',
  stairDown: 'D',
  door: '+',
  conduit: '~',
  basin: 'o',
  overflow: ',',
  ledge: 'L',
  drop: '_',
} as const;

export interface TowerTile {
  readonly x: number;
  readonly y: number;
}

/** An inclusive rectangle of tiles. */
export interface TowerTileRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One storey's rows and what its floor is laid in. */
interface StoreyPlanDef {
  readonly rows: ReadonlyArray<string>;
  /** The tile type a `.` is built as. */
  readonly floor: number;
  /** The tile type a `#` is built as. */
  readonly wall: number;
  /**
   * The dungeon theme the storey is drawn under. A storey of dungeon tiles
   * is drawn in it; a storey of interior tiles draws the same under any
   * theme, and takes the default so nothing is left over from the one before.
   */
  readonly theme: DungeonFloorThemeId;
}

/** The cistern is the sewer's own brick and water, so it is built and drawn as the sewer is. */
const CISTERN_PLAN: StoreyPlanDef = {
  floor: FloorTypeValue.concrete,
  wall: FloorTypeValue.wall,
  theme: 'sewer',
  rows: [
    '####################',
    '######........######',
    '####.....~~.....UU##',
    '###......~~.....UU.#',
    '##.......~~........#',
    '##.......~~........#',
    '#........~~....,,,,#',
    '#........~~....,,,,#',
    '#..................#',
    '#........~~........#',
    '##.......~~.......##',
    '##ooooo..~~.......##',
    '##ooooo..~~~~~~...##',
    '###oooo..~~~~~~..###',
    '####################',
    '####################',
  ],
};

const GATEHOUSE_PLAN: StoreyPlanDef = {
  floor: INTERIOR_FLAG_FLOOR,
  wall: INTERIOR_WALL,
  theme: DEFAULT_DUNGEON_FLOOR_THEME,
  rows: [
    '####################',
    '#..................#',
    '#.DD...............#',
    '#.DD...............#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#...............UU.#',
    '#...............UU.#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#########++#########',
  ],
};

/** The larder is the walled room in the south-east, entered by one doorway in its north wall. */
const KITCHEN_PLAN: StoreyPlanDef = {
  floor: INTERIOR_STONE_FLOOR,
  wall: INTERIOR_WALL,
  theme: DEFAULT_DUNGEON_FLOOR_THEME,
  rows: [
    '####################',
    '#..................#',
    '#.DD...........UU..#',
    '#.DD...........UU..#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..........###.#####',
    '#..........#.......#',
    '#..........#.......#',
    '#..........#.......#',
    '#..........#.......#',
    '#..........#.......#',
    '####################',
  ],
};

/**
 * The bell storey: the open shaft the two great bells hang in runs across the
 * middle of the room, and the only ways over it are the three beams a cat
 * walks and the ringers' walk down the east wall, which is barred by a grate
 * the counterweight's rope hauls clear.
 */
const BELL_STOREY_PLAN: StoreyPlanDef = {
  floor: INTERIOR_BOARD_FLOOR,
  wall: INTERIOR_WALL,
  theme: DEFAULT_DUNGEON_FLOOR_THEME,
  rows: [
    '####################',
    '#..................#',
    '#.DD...........UU..#',
    '#.DD...........UU..#',
    '#..................#',
    '#..................#',
    '#___L____L____L___.#',
    '#___L____L____L___.#',
    '#___L____L____L___.#',
    '#___L____L____L___.#',
    '#___L____L____L___.#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
};

/**
 * The archive is two rooms either side of a filing wall: the east room the
 * cattery's stair comes down into, with the dumbwaiter's hatch, and the west
 * room the stair to the bell storey goes down from, split by a hole where the
 * boards have gone. A doorway at each end of the wall joins them.
 */
const ARCHIVE_PLAN: StoreyPlanDef = {
  floor: INTERIOR_INK_FLOOR,
  wall: INTERIOR_WALL,
  theme: DEFAULT_DUNGEON_FLOOR_THEME,
  rows: [
    '####################',
    '#.....LLL#.........#',
    '#.DD.....#.....UU..#',
    '#.DD.....#.....UU..#',
    '#..................#',
    '#........#........L#',
    '#________#........L#',
    '#________#........L#',
    '#.....LLL#.........#',
    '#..................#',
    '#........#.........#',
    '#........#.........#',
    '#........#.........#',
    '#........#LL.......#',
    '#........#.........#',
    '####################',
  ],
};

const CATTERY_PLAN: StoreyPlanDef = {
  floor: INTERIOR_BOARD_FLOOR,
  wall: INTERIOR_WALL,
  theme: DEFAULT_DUNGEON_FLOOR_THEME,
  rows: [
    '####################',
    '#..................#',
    '#.DD...............#',
    '#.DD...............#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
};

const STOREY_PLANS = {
  cistern: CISTERN_PLAN,
  gatehouse: GATEHOUSE_PLAN,
  kitchen: KITCHEN_PLAN,
  bell_storey: BELL_STOREY_PLAN,
  archive: ARCHIVE_PLAN,
  cattery: CATTERY_PLAN,
} as const satisfies Record<TowerStoreyId, StoreyPlanDef>;

/** How deep each kind of cistern water stands. */
const CONDUIT_RUNNING_DEPTH = 3;
const CONDUIT_SHUT_DEPTH = 1;
const BASIN_DEPTH = 3;
const OVERFLOW_DEPTH = 1;
/** Water this deep cannot be waded, so its tiles are held shut. */
const UNWADEABLE_DEPTH = 3;

/** A run of water a storey is built with, flooded on every build because a map's water is never saved. */
export interface TowerWater {
  readonly tiles: ReadonlyArray<TowerTile>;
  readonly depth: number;
  readonly unwadeable: boolean;
}

/** A storey's shell as its rows lay it out. */
export interface TowerStoreyPlan {
  readonly storey: TowerStoreyId;
  readonly width: number;
  readonly height: number;
  readonly theme: DungeonFloorThemeId;
  /** North-west tile of the 2×2 stair up, or null on the top storey. */
  readonly stairUp: TowerTile | null;
  /** North-west tile of the 2×2 stair down, or null on the cistern. */
  readonly stairDown: TowerTile | null;
  /** The front door's tiles in the south wall; empty on every storey but the gatehouse. */
  readonly door: ReadonlyArray<TowerTile>;
  /** Where a party that did not come by stair or door is set down, and what every tile must be reachable from. */
  readonly arrival: TowerTile;
  /** The ward conduit's channel, from the sluice to the drain; empty on every storey but the cistern. */
  readonly conduit: ReadonlyArray<TowerTile>;
}

/** Where the sewer's cistern culvert sets the party down on the cistern. */
export const TOWER_CISTERN_ARRIVAL_TILE: TowerTile = { x: 3, y: 8 };

/** Every way a plan's rows can be malformed, reported together. */
class TowerPlanError extends Error {
  constructor(storey: TowerStoreyId, problems: ReadonlyArray<string>) {
    super(`tower storey "${storey}": ${problems.join('; ')}`);
  }
}

interface ParsedStoreyPlan extends TowerStoreyPlan {
  readonly def: StoreyPlanDef;
  readonly basin: ReadonlyArray<TowerTile>;
  readonly overflow: ReadonlyArray<TowerTile>;
}

/** The two rows below a stair block that stay clear: where a party arriving down it is set, and behind it. */
const LANDING_DEPTH = 2;

/** Where a storey with neither stair nor door would be entered: never reached by an authored plan. */
const PLAN_ORIGIN_FALLBACK: TowerTile = { x: 1, y: 1 };

function parseStoreyPlan(storey: TowerStoreyId): ParsedStoreyPlan {
  const def = STOREY_PLANS[storey];
  const problems: string[] = [];
  const height = def.rows.length;
  const width = def.rows[0]?.length ?? 0;
  let stairUp: TowerTile | null = null;
  let stairDown: TowerTile | null = null;
  const door: TowerTile[] = [];
  const conduit: TowerTile[] = [];
  const basin: TowerTile[] = [];
  const overflow: TowerTile[] = [];
  for (let y = 0; y < def.rows.length; y++) {
    const row = def.rows[y] ?? '';
    if (row.length !== width) problems.push(`row ${y} is ${row.length} wide, wants ${width}`);
    for (let x = 0; x < row.length; x++) {
      const char = row.charAt(x);
      switch (char) {
        case PLAN_CHAR.wall:
        case PLAN_CHAR.floor:
        case PLAN_CHAR.ledge:
        case PLAN_CHAR.drop:
          break;
        case PLAN_CHAR.stairUp:
          stairUp ??= { x, y };
          break;
        case PLAN_CHAR.stairDown:
          stairDown ??= { x, y };
          break;
        case PLAN_CHAR.door:
          door.push({ x, y });
          break;
        case PLAN_CHAR.conduit:
          conduit.push({ x, y });
          break;
        case PLAN_CHAR.basin:
          basin.push({ x, y });
          break;
        case PLAN_CHAR.overflow:
          overflow.push({ x, y });
          break;
        default:
          problems.push(`unknown glyph "${char}" at ${x},${y}`);
      }
    }
  }
  const arrival =
    storey === 'cistern'
      ? TOWER_CISTERN_ARRIVAL_TILE
      : door.length > 0
        ? { x: Math.max(...door.map((t) => t.x)), y: height - LANDING_DEPTH }
        : landingOf(stairDown ?? stairUp ?? PLAN_ORIGIN_FALLBACK);
  if (problems.length > 0) throw new TowerPlanError(storey, problems);
  return {
    storey,
    def,
    width,
    height,
    theme: def.theme,
    stairUp,
    stairDown,
    door,
    arrival,
    conduit,
    basin,
    overflow,
  };
}

/** The tile a party arriving by the stair whose block starts at `origin` is set down on. */
function landingOf(origin: TowerTile): TowerTile {
  return { x: origin.x, y: origin.y + TOWER_STAIR_SPAN };
}

/** The landing rows below a stair block: its arrival row and the row behind it. */
export function towerLandingTiles(origin: TowerTile): TowerTile[] {
  const tiles: TowerTile[] = [];
  for (let dy = 0; dy < LANDING_DEPTH; dy++)
    for (let dx = 0; dx < TOWER_STAIR_SPAN; dx++)
      tiles.push({ x: origin.x + dx, y: origin.y + TOWER_STAIR_SPAN + dy });
  return tiles;
}

const PARSED_PLANS: Readonly<Record<TowerStoreyId, ParsedStoreyPlan>> = {
  cistern: parseStoreyPlan('cistern'),
  gatehouse: parseStoreyPlan('gatehouse'),
  kitchen: parseStoreyPlan('kitchen'),
  bell_storey: parseStoreyPlan('bell_storey'),
  archive: parseStoreyPlan('archive'),
  cattery: parseStoreyPlan('cattery'),
};

/** A storey's shell: its size, theme, stairs, door and arrival tile. */
export function towerStoreyPlan(storey: TowerStoreyId): TowerStoreyPlan {
  return PARSED_PLANS[storey];
}

// ── Reserved for the cats' mechanics ─────────────────────────────────────────

/**
 * Open floor each storey keeps for what the cats do there: no prop stands in
 * a zone, and every tile of one is walkable. Named for what goes there.
 */
export const TOWER_MECHANIC_ZONES = {
  cistern: {},
  gatehouse: {},
  kitchen: {
    /** In front of the dumbwaiter's hatch and bell in the west wall. */
    dumbwaiter_foot: { x0: 2, y0: 8, x1: 2, y1: 10 },
    /** In front of the portcullis chain on the larder's east wall. */
    larder_chain: { x0: 17, y0: 11, x1: 17, y1: 12 },
  },
  bell_storey: {
    /** Under the counterweight, where it comes down. */
    counterweight: { x0: 8, y0: 12, x1: 11, y1: 14 },
    /** The ringers' walk down the east wall, barred midway by the grate. */
    ringers_walk: { x0: 18, y0: 6, x1: 18, y1: 10 },
  },
  archive: {
    /** The doorways through the filing wall, where the wards across them burn. */
    ward_north_door: { x0: 9, y0: 4, x1: 9, y1: 4 },
    ward_doorway: { x0: 9, y0: 9, x1: 9, y1: 9 },
    /** The ward line that keeps the west room's stair from the hole. */
    ward_west: { x0: 5, y0: 1, x1: 5, y1: 5 },
    /** In front of the dumbwaiter's upper hatch and bell in the east wall. */
    dumbwaiter_hatch: { x0: 17, y0: 9, x1: 17, y1: 10 },
    /** Where the key ring comes down off the shelf top on its way into the hatch. */
    key_ring_drop: { x0: 18, y0: 8, x1: 18, y1: 8 },
  },
  cattery: {},
} as const satisfies Record<TowerStoreyId, Readonly<Record<string, TowerTileRect>>>;

// ── Placed fittings other systems find by id ─────────────────────────────────

/** The ward conduit's sluice, on the cistern's north wall over the conduit's head. */
export const WARD_CONDUIT_SLUICE_ID = 'ward_conduit_sluice';
export const WARD_CONDUIT_SLUICE_TILE: TowerTile = { x: 9, y: 1 };
/** Which `ward_conduit_sluice` variant draws which state. */
export const WARD_CONDUIT_SLUICE_VARIANT = { running: 0, shut: 1 } as const;

/** The portcullis over the kitchen's stair up. */
export const KITCHEN_PORTCULLIS_ID = 'kitchen_stair_portcullis';

/** The dumbwaiter: its foot in the kitchen's west wall, its head in the archive's east wall, each with its bell pull. */
export const TOWER_DUMBWAITER = {
  foot: { storey: 'kitchen', hatch: { x: 1, y: 9 }, bell: { x: 1, y: 8 } },
  head: { storey: 'archive', hatch: { x: 18, y: 9 }, bell: { x: 18, y: 10 } },
} as const satisfies Record<
  'foot' | 'head',
  { readonly storey: TowerStoreyId; readonly hatch: TowerTile; readonly bell: TowerTile }
>;

/** The larder's door, in the doorway through its north wall. */
export const LARDER_DOOR_ID = 'kitchen_larder_door';
export const LARDER_DOOR_TILE: TowerTile = { x: 14, y: 9 };
/** Where the portcullis chain comes down the larder's east wall. */
export const PORTCULLIS_CHAIN_TILE: TowerTile = { x: 18, y: 11 };

// ── The archive's works ──────────────────────────────────────────────────────

/** The things on the archive's shelf tops a cat can bat off, each where it stands. */
export const ARCHIVE_KNOCKABLES = {
  /** The archivist's key ring, on the east shelf top above the hatch. */
  key_ring: { id: 'archive_key_ring', at: { x: 18, y: 7 } },
  /** A loose board on the west room's south shelf top, over the hole. */
  shelf_board: { id: 'archive_shelf_board', at: { x: 7, y: 8 } },
  /** A jar on the west room's north shelf top, over the ward plate. */
  plate_jar: { id: 'archive_plate_jar', at: { x: 7, y: 1 } },
  /** A jar on the east room's low shelf by the filing wall, which lands loudly. */
  noise_jar: { id: 'archive_noise_jar', at: { x: 10, y: 13 } },
} as const satisfies Record<string, { readonly id: string; readonly at: TowerTile }>;

/** The archivist's key ring once it is off its shelf: the item that unlocks the kitchen's larder. */
export const TOWER_KEY_RING_ITEM = 'quest_key_ring' as const satisfies ItemId;

/** The plate that quenches the west ward while something weighs it down. */
export const ARCHIVE_WARD_PLATE = { id: 'archive_ward_plate', at: { x: 7, y: 4 } } as const;

/** The tiles of the hole the shelf board lies across once it is knocked over. */
const ARCHIVE_BRIDGE_TILES: ReadonlyArray<TowerTile> = [
  { x: 7, y: 7 },
  { x: 7, y: 6 },
];

/** How far a knocked jar's landing is heard, in tiles: from the filing wall across the west room. */
const NOISE_JAR_HEARD_TILES = 9;

/** What each thing knocked off the archive's shelves sounds like landing. */
export const ARCHIVE_LANDING_CUES = {
  jar: 'rock_thud_1',
  loudJar: 'pans_clatter_2',
  board: 'raft_slam_wood_1',
  keyRing: 'chain_rattle_1',
} as const satisfies Record<string, SoundId>;
const SHELF_BOARD_SPAN_TILES = ARCHIVE_BRIDGE_TILES.length;
const KEY_RING_DROP_TILES = 2;
const PLATE_JAR_DROP_TILES = 3;

/** What quenches each of the archive's fixed wards before the Warden knows the party is inside. */
export type ArchiveWardQuench = 'never' | 'conduit' | 'plate';

/** A ward line across tiles that stays where it is laid. */
export interface ArchiveFixedWard {
  readonly tiles: ReadonlyArray<TowerTile>;
  /**
   * Under burning-solid wards every one is solid. Once the conduit is shut,
   * `conduit` wards pulse, a `plate` ward goes dark while its plate is held,
   * and a `never` ward stays solid.
   */
  readonly quench: ArchiveWardQuench;
}

function tilesOf(rect: TowerTileRect): TowerTile[] {
  const tiles: TowerTile[] = [];
  for (let y = rect.y0; y <= rect.y1; y++)
    for (let x = rect.x0; x <= rect.x1; x++) tiles.push({ x, y });
  return tiles;
}

export const ARCHIVE_FIXED_WARDS = {
  north_door: { tiles: tilesOf(TOWER_MECHANIC_ZONES.archive.ward_north_door), quench: 'never' },
  doorway: { tiles: tilesOf(TOWER_MECHANIC_ZONES.archive.ward_doorway), quench: 'conduit' },
  west: { tiles: tilesOf(TOWER_MECHANIC_ZONES.archive.ward_west), quench: 'plate' },
} as const satisfies Record<string, ArchiveFixedWard>;

/** A ward line that sweeps back and forth across a band of columns, fed by its stone. */
export interface ArchiveSweepingWard {
  readonly stoneId: string;
  readonly stone: TowerTile;
  /** The columns it sweeps between, inclusive. */
  readonly fromX: number;
  readonly toX: number;
  /** The rows it spans, inclusive. */
  readonly y0: number;
  readonly y1: number;
}

/** The wards once the Warden knows: each sweeps its band, until the human breaks the stone Belle finds for it. */
export const ARCHIVE_SWEEPING_WARDS = {
  west_room: {
    stoneId: 'ward_stone_west_room',
    stone: { x: 1, y: 1 },
    fromX: 4,
    toX: 8,
    y0: 1,
    y1: 5,
  },
  north_door: {
    stoneId: 'ward_stone_north_door',
    stone: { x: 1, y: 5 },
    fromX: 9,
    toX: 13,
    y0: 4,
    y1: 4,
  },
  stair_up: {
    stoneId: 'ward_stone_stair_up',
    stone: { x: 17, y: 12 },
    fromX: 11,
    toX: 17,
    y0: 4,
    y1: 6,
  },
} as const satisfies Record<string, ArchiveSweepingWard>;

/** The archive's wardens' rounds before the Warden knows: the corners each drifts between, in order. */
export const ARCHIVE_WARDEN_ROUNDS: ReadonlyArray<ReadonlyArray<TowerTile>> = [
  [
    { x: 2, y: 10 },
    { x: 7, y: 10 },
    { x: 7, y: 13 },
    { x: 2, y: 13 },
  ],
];

/** Where the archive's krasue rise to fight once the Warden knows. */
export const ARCHIVE_KRASUE_TILES: ReadonlyArray<TowerTile> = [
  { x: 13, y: 10 },
  { x: 15, y: 12 },
  { x: 4, y: 11 },
];

// ── The bell storey's works ──────────────────────────────────────────────────

/** The beams a cat crosses the bell shaft on, by column, and the rows they span. */
export const BELL_STOREY_BEAMS = { west: 4, middle: 9, east: 14 } as const;
export const BELL_STOREY_BEAM_ROWS = { y0: 6, y1: 10 } as const;

/** The two plates the counterweight's catch needs held at once. */
export const BELL_STOREY_PLATES = {
  west: { id: 'bell_plate_west', at: { x: 5, y: 13 } },
  east: { id: 'bell_plate_east', at: { x: 14, y: 13 } },
} as const satisfies Record<string, { readonly id: string; readonly at: TowerTile }>;

/** The plate set whose target is the counterweight; opening it raises the kitchen's portcullis. */
export const BELL_COUNTERWEIGHT_SET_ID = 'bell_counterweight';
/** Where the counterweight hangs, how far it falls, and the grate its rope hauls clear. */
export const BELL_COUNTERWEIGHT = {
  weightTile: { x: 9, y: 11 },
  dropTiles: 2,
  grate: [{ x: 18, y: 8 }],
} as const;

/** Which `cattery_cage` variant draws which state. */
export const CATTERY_CAGE_VARIANT = { shut: 0, open: 1 } as const;
/** Which `ritual_circle` variant draws which state. */
const RITUAL_VARIANT = { dark: 0, lit: 1 } as const;
/** Which `binding_pillar` variant draws which state: never lit, lit round a bound cat, or shattered. */
export const BINDING_PILLAR_VARIANT = { dark: 0, lit: 1, broken: 2 } as const;

/** Each cage of the cattery, by whose it is: five down the west wall, four down the east. */
export const TOWER_CATTERY_CAGES = {
  taloncrest_inn_cat: { x: 1, y: 7 },
  taloncrest_old_lady_cottage_cat: { x: 1, y: 8 },
  taloncrest_apothecary_cat: { x: 1, y: 9 },
  taloncrest_flagon_tavern_cat: { x: 1, y: 10 },
  taloncrest_mill_farm_cat: { x: 1, y: 11 },
  taloncrest_smithy_cat: { x: 18, y: 7 },
  taloncrest_general_store_cat: { x: 18, y: 8 },
  tower_cattery_cellmate: { x: 18, y: 9 },
  crawler_cat: { x: 18, y: 10 },
} as const satisfies Record<CatteryCageOccupant, TowerTile>;

/** The ritual circle's north-west tile: under the observatory window, where the Warden stands. */
export const RITUAL_CIRCLE_TILE: TowerTile = { x: 8, y: 3 };

/**
 * Each town cat's binding pillar, round the circle and all above the row the
 * Lich's walls of fire start on, so no wave is ever born among them.
 */
export const TOWER_BINDING_PILLARS = {
  taloncrest_inn_cat: { x: 7, y: 1 },
  taloncrest_old_lady_cottage_cat: { x: 12, y: 1 },
  taloncrest_apothecary_cat: { x: 6, y: 3 },
  taloncrest_flagon_tavern_cat: { x: 13, y: 3 },
  taloncrest_mill_farm_cat: { x: 4, y: 3 },
  taloncrest_smithy_cat: { x: 15, y: 3 },
  taloncrest_general_store_cat: { x: 17, y: 2 },
} as const satisfies Record<TownCatId, TowerTile>;

/** The id each cage and pillar is placed under. */
export function catteryCageId(occupant: CatteryCageOccupant): string {
  return `cattery_cage_${occupant}`;
}
export function bindingPillarId(cat: TownCatId): string {
  return `binding_pillar_${cat}`;
}

// ── The gatehouse watch ──────────────────────────────────────────────────────

/** The named points the gatehouse guards' patrol scripts walk between. */
export const GATEHOUSE_PATROL_POINTS = {
  a: { x: 4, y: 9 },
  b: { x: 15, y: 9 },
  c: { x: 13, y: 3 },
  d: { x: 13, y: 11 },
  e: { x: 6, y: 4 },
} as const satisfies Record<string, TowerTile>;

// ── Building a storey ────────────────────────────────────────────────────────

/** Everything `GameMap` lays for one storey: its tile and prop entries, and the water it floods. */
export interface TowerStoreyBuild {
  readonly plan: TowerStoreyPlan;
  readonly entries: ReadonlyArray<TownInteriorLayoutEntry>;
  readonly water: ReadonlyArray<TowerWater>;
}

/**
 * Every tile, prop and water write for one storey as `conditions` leave it.
 * The floor material comes first, so the stairs `GameMap` lays afterwards
 * record it as the floor they stand on.
 */
export function buildTowerStorey(
  storey: TowerStoreyId,
  conditions: TowerConditions,
): TowerStoreyBuild {
  const plan = PARSED_PLANS[storey];
  const entries = shellEntries(plan);
  entries.push(...STOREY_FURNISHERS[storey](conditions));
  return { plan, entries, water: storeyWater(plan, conditions) };
}

function shellEntries(plan: ParsedStoreyPlan): TownInteriorLayoutEntry[] {
  const entries: TownInteriorLayoutEntry[] = [];
  plan.def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const char = row.charAt(x);
      if (char === PLAN_CHAR.door) continue;
      entries.push(tile(x, y, shellTileType(plan.def, char)));
    }
  });
  return entries;
}

function shellTileType(def: StoreyPlanDef, char: string): number {
  switch (char) {
    case PLAN_CHAR.wall:
      return def.wall;
    case PLAN_CHAR.ledge:
      return CAT_LEDGE;
    case PLAN_CHAR.drop:
      return FLOOR_DROP;
    default:
      return def.floor;
  }
}

function storeyWater(plan: ParsedStoreyPlan, conditions: TowerConditions): TowerWater[] {
  const conduitDepth =
    conditions.conduit === 'running' ? CONDUIT_RUNNING_DEPTH : CONDUIT_SHUT_DEPTH;
  return [
    { tiles: plan.conduit, depth: conduitDepth },
    { tiles: plan.basin, depth: BASIN_DEPTH },
    { tiles: plan.overflow, depth: OVERFLOW_DEPTH },
  ]
    .filter((run) => run.tiles.length > 0)
    .map((run) => ({ ...run, unwadeable: run.depth >= UNWADEABLE_DEPTH }));
}

type StoreyFurnisher = (conditions: TowerConditions) => TownInteriorLayoutEntry[];

const STOREY_FURNISHERS: Readonly<Record<TowerStoreyId, StoreyFurnisher>> = {
  cistern: furnishCistern,
  gatehouse: furnishGatehouse,
  kitchen: furnishKitchen,
  bell_storey: furnishBellStorey,
  archive: furnishArchive,
  cattery: furnishCattery,
};

function furnishCistern(conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const variant = WARD_CONDUIT_SLUICE_VARIANT[conditions.conduit];
  const { x, y } = WARD_CONDUIT_SLUICE_TILE;
  const westWallColumn = 0;
  return [
    prop(x, y, 'ward_conduit_sluice', variant, { id: WARD_CONDUIT_SLUICE_ID }),
    prop(westWallColumn, TOWER_CISTERN_ARRIVAL_TILE.y, 'cistern_culvert'),
  ];
}

const CABINET_SHUT = 0;
const CABINET_DRAWER_OPEN = 1;
const BOXES_TALL = 0;
const BOXES_OPENED = 1;
const DESK_HEAPED = 1;
const BUNK_MADE = 0;
const BUNK_SLEPT_IN = 1;

/** One piece of furniture a storey always has: a prop with nothing saved, or one its room remembers under `id`. */
type Placement =
  | {
      readonly at: TowerTile;
      readonly prop: Parameters<typeof prop>[2];
      readonly variant?: number;
    }
  | {
      readonly at: TowerTile;
      readonly stateful: Parameters<typeof statefulProp>[2];
      readonly id: string;
      readonly variant?: number;
    };

function placeAll(placements: ReadonlyArray<Placement>): TownInteriorLayoutEntry[] {
  return placements.map((placement) =>
    'prop' in placement
      ? prop(placement.at.x, placement.at.y, placement.prop, placement.variant)
      : statefulProp(
          placement.at.x,
          placement.at.y,
          placement.stateful,
          placement.id,
          placement.variant,
        ),
  );
}

/** The red runner from the front door to the guards' benches. */
const GATEHOUSE_RUNNER: TowerTileRect = { x0: 9, y0: 9, x1: 10, y1: 14 };

const GATEHOUSE_FURNITURE: ReadonlyArray<Placement> = [
  { at: { x: 5, y: 1 }, prop: 'garrison_weapon_rack' },
  { at: { x: 8, y: 1 }, prop: 'muster_board' },
  { at: { x: 12, y: 1 }, prop: 'tower_hearth' },
  { at: { x: 16, y: 1 }, prop: 'writ_board' },
  { at: { x: 18, y: 1 }, stateful: 'torchere', id: 'torchere_north' },
  { at: { x: 8, y: 6 }, prop: 'lodge_map_table' },
  { at: { x: 8, y: 8 }, prop: 'feast_bench' },
  { at: { x: 10, y: 8 }, prop: 'feast_bench' },
  { at: { x: 1, y: 8 }, prop: 'lodge_bunk', variant: BUNK_SLEPT_IN },
  { at: { x: 1, y: 10 }, prop: 'lodge_bunk', variant: BUNK_MADE },
  { at: { x: 16, y: 4 }, prop: 'bunk_bed' },
  { at: { x: 16, y: 6 }, prop: 'lodge_bunk', variant: BUNK_SLEPT_IN },
  { at: { x: 5, y: 12 }, stateful: 'keg_stack', id: 'keg_stack' },
  { at: { x: 12, y: 12 }, prop: 'cask_rack' },
  { at: { x: 1, y: 13 }, stateful: 'torchere', id: 'torchere_south_west' },
  { at: { x: 18, y: 13 }, stateful: 'torchere', id: 'torchere_south_east' },
  { at: { x: 7, y: 14 }, stateful: 'coat_stand', id: 'coat_stand_west' },
  { at: { x: 12, y: 14 }, stateful: 'coat_stand', id: 'coat_stand_east' },
];

function furnishGatehouse(_conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const entries: TownInteriorLayoutEntry[] = [];
  const runner = GATEHOUSE_RUNNER;
  for (let y = runner.y0; y <= runner.y1; y++)
    for (let x = runner.x0; x <= runner.x1; x++) entries.push(tile(x, y, RUG));
  entries.push(...placeAll(GATEHOUSE_FURNITURE));
  return entries;
}

const KITCHEN_FURNITURE: ReadonlyArray<Placement> = [
  { at: { x: 6, y: 1 }, prop: 'farm_hearth' },
  { at: { x: 10, y: 1 }, prop: 'pot_rack' },
  { at: { x: 11, y: 1 }, prop: 'pot_rack' },
  { at: { x: 12, y: 1 }, stateful: 'farm_dresser', id: 'farm_dresser' },
  { at: { x: 8, y: 6 }, stateful: 'farm_table', id: 'farm_table' },
  { at: { x: 4, y: 7 }, stateful: 'bake_trough', id: 'bake_trough' },
  { at: { x: 4, y: 10 }, prop: 'flour_bin' },
  { at: { x: 17, y: 5 }, stateful: 'jars', id: 'jars_dresser_end' },
  { at: { x: 18, y: 7 }, stateful: 'barrel', id: 'barrel_kitchen' },
  { at: { x: 1, y: 13 }, stateful: 'crate', id: 'crate_kitchen' },
  { at: { x: 12, y: 10 }, stateful: 'larder_shelf', id: 'larder_shelf_west' },
  { at: { x: 16, y: 10 }, stateful: 'larder_shelf', id: 'larder_shelf_east' },
  { at: { x: 18, y: 10 }, stateful: 'crock_stack', id: 'crock_stack' },
  { at: { x: 12, y: 14 }, stateful: 'flour_sack_stack', id: 'flour_sacks' },
  { at: { x: 15, y: 14 }, prop: 'sack_pile' },
  { at: { x: 18, y: 14 }, stateful: 'barrel', id: 'barrel_larder' },
  { at: { x: 1, y: 1 }, prop: 'drying_beam' },
  { at: { x: 5, y: 1 }, stateful: 'log_basket', id: 'log_basket_hearth' },
  { at: { x: 7, y: 3 }, prop: 'floor_stain' },
  { at: { x: 9, y: 8 }, prop: 'floor_stain', variant: 1 },
  { at: { x: 7, y: 6 }, stateful: 'stool', id: 'stool_table_west' },
  { at: { x: 11, y: 5 }, stateful: 'stool', id: 'stool_table_east' },
  { at: { x: 17, y: 6 }, stateful: 'water_trough', id: 'water_trough_kitchen' },
  { at: { x: 18, y: 8 }, stateful: 'crock_cluster', id: 'crocks_kitchen' },
  { at: { x: 5, y: 10 }, prop: 'flour_drift' },
  { at: { x: 6, y: 12 }, stateful: 'table_small', id: 'table_prep' },
  { at: { x: 6, y: 13 }, stateful: 'stool', id: 'stool_prep' },
  { at: { x: 8, y: 13 }, stateful: 'basket', id: 'basket_kitchen' },
  { at: { x: 2, y: 13 }, stateful: 'sack', id: 'sack_kitchen' },
  { at: { x: 12, y: 12 }, stateful: 'open_crate', id: 'open_crate_larder' },
  { at: { x: 14, y: 14 }, stateful: 'crock_cluster', id: 'crocks_larder', variant: 1 },
  { at: { x: 1, y: 4 }, stateful: 'crockery_shelf', id: 'crockery_shelf_kitchen' },
  { at: { x: 1, y: 5 }, stateful: 'shelving_unit', id: 'shelving_kitchen' },
  { at: { x: 9, y: 14 }, prop: 'dairy_churn' },
  { at: { x: 10, y: 14 }, stateful: 'barrel', id: 'barrel_kitchen_south' },
];

function furnishKitchen(conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const entries = placeAll(KITCHEN_FURNITURE);
  const { hatch, bell } = TOWER_DUMBWAITER.foot;
  entries.push(
    prop(hatch.x, hatch.y, 'dumbwaiter_hatch', WALL_FITTING_VARIANT.west_wall),
    prop(bell.x, bell.y, 'dumbwaiter_bell', WALL_FITTING_VARIANT.west_wall),
    prop(
      LARDER_DOOR_TILE.x,
      LARDER_DOOR_TILE.y,
      'larder_door',
      LARDER_DOOR_VARIANT[conditions.larder],
      {
        id: LARDER_DOOR_ID,
      },
    ),
    prop(PORTCULLIS_CHAIN_TILE.x, PORTCULLIS_CHAIN_TILE.y, 'portcullis_chain'),
  );
  const stairUp = PARSED_PLANS.kitchen.stairUp;
  if (stairUp !== null) {
    const portcullis = KITCHEN_PORTCULLIS_PROPS[conditions.portcullis];
    entries.push(prop(stairUp.x, stairUp.y, portcullis, 0, { id: KITCHEN_PORTCULLIS_ID }));
  }
  return entries;
}

/** The portcullis over the kitchen's stair up, as the kitchen is built with it shut or raised. */
export const KITCHEN_PORTCULLIS_PROPS = {
  shut: 'stair_portcullis',
  raised: 'stair_portcullis_raised',
} as const satisfies Record<TowerConditions['portcullis'], StatelessTownInteriorPropId>;

const BELL_STOREY_FURNITURE: ReadonlyArray<Placement> = [
  { at: { x: 1, y: 13 }, prop: 'timber_stack' },
  { at: { x: 1, y: 12 }, stateful: 'crate', id: 'crate_bell_west' },
  { at: { x: 17, y: 13 }, stateful: 'barrel', id: 'barrel_bell_east' },
  { at: { x: 18, y: 14 }, stateful: 'crate', id: 'crate_bell_east' },
  {
    at: { x: 18, y: 1 },
    stateful: 'archive_boxes',
    id: 'archive_boxes_bell',
    variant: BOXES_OPENED,
  },
];

function furnishBellStorey(_conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const entries = placeAll(BELL_STOREY_FURNITURE);
  for (const plate of Object.values(BELL_STOREY_PLATES)) {
    entries.push(prop(plate.at.x, plate.at.y, 'pressure_plate', 0, { id: plate.id }));
  }
  return entries;
}

const ARCHIVE_FURNITURE: ReadonlyArray<Placement> = [
  { at: { x: 1, y: 13 }, stateful: 'archive_boxes', id: 'archive_boxes_1', variant: BOXES_TALL },
  { at: { x: 1, y: 14 }, stateful: 'archive_boxes', id: 'archive_boxes_2', variant: BOXES_OPENED },
  { at: { x: 8, y: 14 }, stateful: 'archive_boxes', id: 'archive_boxes_3', variant: BOXES_TALL },
  { at: { x: 11, y: 1 }, prop: 'pigeonhole_wall' },
  {
    at: { x: 17, y: 1 },
    stateful: 'records_cabinet',
    id: 'cabinet_north_east',
    variant: CABINET_DRAWER_OPEN,
  },
  { at: { x: 13, y: 8 }, stateful: 'records_cabinet', id: 'rank_east_1', variant: CABINET_SHUT },
  {
    at: { x: 14, y: 8 },
    stateful: 'records_cabinet',
    id: 'rank_east_2',
    variant: CABINET_DRAWER_OPEN,
  },
  {
    at: { x: 13, y: 11 },
    stateful: 'records_cabinet',
    id: 'rank_east_3',
    variant: CABINET_DRAWER_OPEN,
  },
  { at: { x: 14, y: 11 }, stateful: 'records_cabinet', id: 'rank_east_4', variant: CABINET_SHUT },
  { at: { x: 3, y: 11 }, stateful: 'records_cabinet', id: 'rank_west_1', variant: CABINET_SHUT },
  {
    at: { x: 4, y: 11 },
    stateful: 'records_cabinet',
    id: 'rank_west_2',
    variant: CABINET_DRAWER_OPEN,
  },
  { at: { x: 1, y: 8 }, prop: 'conduit_coil' },
  { at: { x: 17, y: 14 }, stateful: 'scrivener_desk', id: 'scrivener_desk', variant: DESK_HEAPED },
];

function furnishArchive(conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const entries = placeAll(ARCHIVE_FURNITURE);
  const { hatch, bell } = TOWER_DUMBWAITER.head;
  entries.push(
    prop(hatch.x, hatch.y, 'dumbwaiter_hatch', WALL_FITTING_VARIANT.east_wall),
    prop(bell.x, bell.y, 'dumbwaiter_bell', WALL_FITTING_VARIANT.east_wall),
  );
  if (conditions.archiveFloor === 'bridged') {
    for (const at of ARCHIVE_BRIDGE_TILES) entries.push(tile(at.x, at.y, ARCHIVE_PLAN.floor));
  }
  if (conditions.wards === 'sweeping' || conditions.wards === 'spent') {
    const stone =
      conditions.wards === 'sweeping' ? WARD_STONE_VARIANT.lit : WARD_STONE_VARIANT.broken;
    for (const ward of Object.values(ARCHIVE_SWEEPING_WARDS)) {
      entries.push(prop(ward.stone.x, ward.stone.y, 'ward_stone', stone, { id: ward.stoneId }));
    }
    return entries;
  }
  entries.push(
    prop(ARCHIVE_WARD_PLATE.at.x, ARCHIVE_WARD_PLATE.at.y, 'pressure_plate', 0, {
      id: ARCHIVE_WARD_PLATE.id,
    }),
  );
  entries.push(...archiveKnockables(conditions));
  return entries;
}

/** The things on the shelf tops, each with where it goes and what its landing does. */
function archiveKnockables(conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const { key_ring, shelf_board, plate_jar, noise_jar } = ARCHIVE_KNOCKABLES;
  const onShelf = LOOSE_THING_VARIANT.shelf_top;
  const entries: TownInteriorLayoutEntry[] = [
    knockableProp(
      plate_jar.at.x,
      plate_jar.at.y,
      'knockable_jar',
      plate_jar.id,
      {
        fall: { kind: 'direction', dx: 0, dy: 1, reachTiles: PLATE_JAR_DROP_TILES },
        landing: { kind: 'pressPlate' },
        landingCue: ARCHIVE_LANDING_CUES.jar,
      },
      onShelf,
    ),
    knockableProp(
      noise_jar.at.x,
      noise_jar.at.y,
      'knockable_jar',
      noise_jar.id,
      {
        fall: { kind: 'direction', dx: 0, dy: 1, reachTiles: 1 },
        landing: { kind: 'makeNoise', radiusTiles: NOISE_JAR_HEARD_TILES },
        landingCue: ARCHIVE_LANDING_CUES.loudJar,
      },
      onShelf,
    ),
  ];
  if (conditions.archiveFloor === 'holed') {
    entries.push(
      knockableProp(
        shelf_board.at.x,
        shelf_board.at.y,
        'knockable_shelf_board',
        shelf_board.id,
        {
          fall: { kind: 'direction', dx: 0, dy: -1, reachTiles: 1 },
          landing: {
            kind: 'bridge',
            floorTileType: ARCHIVE_PLAN.floor,
            spanTiles: SHELF_BOARD_SPAN_TILES,
          },
          landingCue: ARCHIVE_LANDING_CUES.board,
        },
        onShelf,
      ),
    );
  }
  if (!conditions.keyRingSent) {
    entries.push(
      knockableProp(
        key_ring.at.x,
        key_ring.at.y,
        'knockable_key_ring',
        key_ring.id,
        {
          fall: { kind: 'direction', dx: 0, dy: 1, reachTiles: KEY_RING_DROP_TILES },
          landing: { kind: 'deliver', item: TOWER_KEY_RING_ITEM },
          landingCue: ARCHIVE_LANDING_CUES.keyRing,
        },
        onShelf,
      ),
    );
  }
  return entries;
}

/** The cattery's fittings that never change: the hearth and the observatory window above the circle. */
const CATTERY_FURNITURE: ReadonlyArray<Placement> = [
  { at: { x: 4, y: 1 }, prop: 'hearth_wide' },
  { at: { x: 8, y: 1 }, prop: 'sky_window' },
];

function furnishCattery(conditions: TowerConditions): TownInteriorLayoutEntry[] {
  const ritual = RITUAL_VARIANT[conditions.ritual];
  const entries = placeAll(CATTERY_FURNITURE);
  entries.push(
    prop(RITUAL_CIRCLE_TILE.x, RITUAL_CIRCLE_TILE.y, 'ritual_circle', ritual, {
      id: 'ritual_circle',
    }),
  );
  for (const occupant of CATTERY_CAGE_OCCUPANTS) {
    const { x, y } = TOWER_CATTERY_CAGES[occupant];
    const open = conditions.openCages.has(occupant);
    const variant = open ? CATTERY_CAGE_VARIANT.open : CATTERY_CAGE_VARIANT.shut;
    entries.push(prop(x, y, 'cattery_cage', variant, { id: catteryCageId(occupant) }));
  }
  for (const cat of TOWN_CAT_IDS) {
    const { x, y } = TOWER_BINDING_PILLARS[cat];
    const lit = conditions.ritual === 'lit' && conditions.boundCats.has(cat);
    const variant = lit ? BINDING_PILLAR_VARIANT.lit : BINDING_PILLAR_VARIANT.dark;
    entries.push(prop(x, y, 'binding_pillar', variant, { id: bindingPillarId(cat) }));
  }
  return entries;
}

const CATTERY_CAGE_OCCUPANTS: ReadonlyArray<CatteryCageOccupant> = [
  ...TOWN_CAT_IDS,
  ...CAT_ALLY_IDS,
  'crawler_cat',
];

// ── Every state a storey can be built in ─────────────────────────────────────

/** A questline record and the tower it builds. */
export interface TowerState {
  readonly progress: MissingCatsProgress;
  readonly conditions: TowerConditions;
}

/**
 * Every distinct tower the questline can leave, with a record that leaves it,
 * for a gate or a review render that must see each storey in every state it
 * has. Read through {@link towerConditionsFor} from every phase as a record
 * standing at its start leaves it, then with the conduit open and shut, the
 * cattery's cats all caged and all freed, and the phase's own works done and
 * undone.
 */
export function everyTowerState(
  phases: ReadonlyArray<MissingCatsProgress['phase']>,
): ReadonlyArray<TowerState> {
  const seen = new Map<string, TowerState>();
  const freedSets: ReadonlyArray<ReadonlySet<TownCatId>> = [new Set(), new Set(TOWN_CAT_IDS)];
  for (const phase of phases) {
    for (const conduitShut of [false, true]) {
      for (const catsFreed of freedSets) {
        for (const worksDone of [false, true]) {
          const progress = missingCatsProgressAt(phase);
          progress.conduitShut = conduitShut;
          for (const cat of catsFreed) progress.catsFreed.add(cat);
          if (worksDone) {
            progress.crawlerCatUncaged = true;
            progress.cellmateFreed = true;
            progress.larderOpened = true;
            progress.portcullisRaised = true;
            progress.keyRingSent = true;
          }
          const conditions = towerConditionsFor(progress);
          seen.set(towerConditionsKey(conditions), { progress, conditions });
        }
      }
    }
  }
  return [...seen.values()];
}

/** Every distinct set of conditions the questline can leave the tower in; see {@link everyTowerState}. */
export function everyTowerConditions(
  phases: ReadonlyArray<MissingCatsProgress['phase']>,
): ReadonlyArray<TowerConditions> {
  return everyTowerState(phases).map((state) => state.conditions);
}

/** A short stable name for a set of conditions, for labelling renders and failures. */
export function towerConditionsKey(conditions: TowerConditions): string {
  const caged = CATTERY_CAGE_OCCUPANTS.length - conditions.openCages.size;
  return [
    `conduit-${conditions.conduit}`,
    `portcullis-${conditions.portcullis}`,
    `larder-${conditions.larder}`,
    `wards-${conditions.wards}`,
    `floor-${conditions.archiveFloor}`,
    `keyring-${conditions.keyRingSent ? 'sent' : 'shelved'}`,
    `ritual-${conditions.ritual}`,
    `caged-${caged}`,
    `bound-${conditions.boundCats.size}`,
  ].join('_');
}

/**
 * The part of `conditions` a storey's build actually reads, so a review that
 * renders each storey once per state it has can skip the rest.
 */
export function towerStoreyStateKey(storey: TowerStoreyId, conditions: TowerConditions): string {
  switch (storey) {
    case 'cistern':
      return `conduit-${conditions.conduit}`;
    case 'gatehouse':
      return 'only';
    case 'bell_storey':
      return `portcullis-${conditions.portcullis}`;
    case 'kitchen':
      return `portcullis-${conditions.portcullis}_larder-${conditions.larder}`;
    case 'archive':
      return `wards-${conditions.wards}_floor-${conditions.archiveFloor}_keyring-${conditions.keyRingSent ? 'sent' : 'shelved'}`;
    case 'cattery': {
      const caged = CATTERY_CAGE_OCCUPANTS.length - conditions.openCages.size;
      return `ritual-${conditions.ritual}_caged-${caged}_bound-${conditions.boundCats.size}`;
    }
    default: {
      const unhandled: never = storey;
      throw new Error(`unhandled tower storey ${String(unhandled)}`);
    }
  }
}
