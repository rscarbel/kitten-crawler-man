/**
 * Shared geometry for the Cloak & Dagger interior.
 *
 * The tile-carving code in `GameMap.generateInterior` and the runtime
 * `CloakAndDaggerSystem` (station NPCs, stages, casino seats, dance-floor
 * lights, interaction prompts) must agree on exactly where every room and
 * station sits. Keeping the single source of truth here avoids the two drifting
 * apart into a broken layout.
 *
 * Coordinates are interior tile indices. The interior is walled at its border
 * (x = 0 / x = W-1, y = 0 / y = H-1); the south exit door is carved by the
 * generic interior code at the bottom-centre, so the layout below only covers
 * the club-specific floor, dividers, and stations.
 *
 * The room reads west to east as bar and market, a stage, the dance floor, a
 * stage, and the open floor of tables; the whole north wing is the casino.
 */

import type { TilePoint } from '../../map/town/townPlan';

export const CLUB_INTERIOR_W = 28;
export const CLUB_INTERIOR_H = 20;

/** From a tile's corner to its middle, in tiles. */
const TILE_CENTRE = 0.5;

/** Inclusive tile bounds. */
export interface ClubTileRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function inClubRect(rect: ClubTileRect, tx: number, ty: number): boolean {
  return tx >= rect.x0 && tx <= rect.x1 && ty >= rect.y0 && ty <= rect.y1;
}

/** The central dance-floor region. */
export const CLUB_DANCE_FLOOR: ClubTileRect = { x0: 11, y0: 8, x1: 16, y1: 13 };

/**
 * Short vertical wall segments that close the bar and the market off from the
 * entrance corridor on their east sides, each leaving its room's open row
 * facing the middle of the club so neither is ever sealed off.
 */
export const CLUB_DIVIDER_WALLS = [
  { x: 6, y0: 1, y1: 5 },
  { x: 6, y0: 14, y1: 18 },
] as const;

/** Identifiers for every interactable club station. */
export type ClubStationId = 'bar' | 'casino' | 'market';

export interface ClubStation {
  readonly id: ClubStationId;
  readonly tile: TilePoint;
}

/** Where the bartender works, between the back-bar shelves and the counter. */
export const CLUB_BARTENDER_POST = { x: 3, y: 3 } as const satisfies TilePoint;

/** Where the market's vendor stands, between the awninged backdrop and the stall. */
export const CLUB_VENDOR_POST = { x: 3, y: 16 } as const satisfies TilePoint;

/** Where Deuce deals from, behind the blackjack table. */
export const CLUB_DEALER_POST = { x: 20, y: 4 } as const satisfies TilePoint;

/**
 * Where Donald stands: behind his counter at the foot of the Wheel of Fortune's
 * east side, facing south onto the casino floor. The counter's art rises into
 * this tile, so no patron or crawler can path onto it.
 */
export const CLUB_DONALD_POST = { x: 25, y: 3 } as const satisfies TilePoint;

/**
 * Every station the player can work. The casino answers at each of its games
 * — Deuce's table, the poker table, the slot aisle and the wheel — because the
 * wing is too wide for one counter to reach; every one of them opens the same
 * game picker.
 */
export const CLUB_STATIONS: ReadonlyArray<ClubStation> = [
  { id: 'bar', tile: CLUB_BARTENDER_POST },
  { id: 'market', tile: CLUB_VENDOR_POST },
  { id: 'casino', tile: CLUB_DEALER_POST },
  { id: 'casino', tile: { x: 14, y: 3 } },
  { id: 'casino', tile: { x: 9, y: 2 } },
  { id: 'casino', tile: CLUB_DONALD_POST },
];

/** The staffed stations, whose keeper stands on the station tile itself. */
export const CLUB_STAFFED_POSTS: ReadonlyArray<TilePoint> = [
  CLUB_BARTENDER_POST,
  CLUB_VENDOR_POST,
  CLUB_DEALER_POST,
  CLUB_DONALD_POST,
];

/**
 * Brandon's mark behind the host stand by the entrance, where he greets
 * whoever walks in. He is a resident of the occupant system, stood here by his
 * occupant spec.
 */
export const CLUB_HOST_MARK = { x: 16, y: 16 } as const satisfies TilePoint;

/** Cosmetic dancers that dance in place across the dance floor. */
export const CLUB_DANCER_TILES: ReadonlyArray<TilePoint> = [
  { x: 11, y: 9 },
  { x: 13, y: 9 },
  { x: 15, y: 9 },
  { x: 12, y: 11 },
  { x: 14, y: 11 },
  { x: 16, y: 11 },
  { x: 13, y: 13 },
  { x: 15, y: 13 },
];

/** Who dances on a stage. */
export type ClubPerformerId = 'angel' | 'magnum';

/**
 * A stage and who works it. `stage` is the platform's whole footprint, which
 * the stage prop blocks; `pole` is the tile the pole stands on, at the
 * platform's centre. `attraction` is how strongly the crowd drifts over to
 * watch, against a weight of one for the rest of the open floor, and
 * `watchFrom` is the floor the watchers gather on.
 */
export interface ClubPerformerPost {
  readonly performer: ClubPerformerId;
  readonly stage: ClubTileRect;
  readonly pole: TilePoint;
  readonly attraction: number;
  readonly watchFrom: ClubTileRect;
}

/** The side of a stage the crowd gathers on has room for a knot of watchers, not a queue. */
const STAGE_ATTRACTION = 2;

/**
 * Angel works the west stage and Magnum the east. Each stage keeps two open
 * rows above and below it, so the walk from the bar to the tables passes
 * either side of both platforms.
 */
export const CLUB_PERFORMER_POSTS: ReadonlyArray<ClubPerformerPost> = [
  {
    performer: 'angel',
    stage: { x0: 7, y0: 9, x1: 9, y1: 11 },
    pole: { x: 8, y: 10 },
    attraction: STAGE_ATTRACTION,
    watchFrom: { x0: 5, y0: 12, x1: 10, y1: 13 },
  },
  {
    performer: 'magnum',
    stage: { x0: 18, y0: 9, x1: 20, y1: 11 },
    pole: { x: 19, y: 10 },
    attraction: STAGE_ATTRACTION,
    watchFrom: { x0: 17, y0: 12, x1: 22, y1: 13 },
  },
];

/** Which way a seated gambler faces, as the cast rows draw it. */
export type CasinoSeatFacing = 'north' | 'south' | 'east' | 'west';

/** The game a casino stool is drawn up to. */
export type CasinoSeatGame = 'slots' | 'blackjack' | 'poker';

/**
 * A stool at one of the casino's games. `pokerSeat` is the seat index at the
 * poker table this stool stands for, so the regular the poker screen deals to
 * a seat is the one sitting on it in the room.
 */
export type CasinoSeatFixture =
  | {
      readonly game: Exclude<CasinoSeatGame, 'poker'>;
      readonly tile: TilePoint;
      readonly facing: CasinoSeatFacing;
    }
  | {
      readonly game: Extract<CasinoSeatGame, 'poker'>;
      readonly tile: TilePoint;
      readonly facing: CasinoSeatFacing;
      readonly pokerSeat: number;
    };

/** The westmost column of the slot bank; both rows run east from it. */
export const SLOT_BANK_FIRST_X = 7;
/** Cabinets in each of the bank's two rows. */
export const SLOT_BANK_CABINETS_PER_ROW = 5;
/** The north row's cabinets stand against the back wall, facing south down the aisle. */
export const SLOT_BANK_NORTH_ROW_Y = 1;
/** The south row stands across the aisle, facing north, its backs to the casino floor. */
export const SLOT_BANK_SOUTH_ROW_Y = 5;
/** The north row's stools, in the aisle in front of their machines. */
const SLOT_NORTH_STOOL_Y = SLOT_BANK_NORTH_ROW_Y + 1;
/**
 * The south row's stools, in the aisle behind the south row. A clear row
 * runs between the two rows of stools, so the two rows of players never
 * stack into one figure.
 */
const SLOT_SOUTH_STOOL_Y = SLOT_BANK_SOUTH_ROW_Y - 1;
/**
 * One cabinet in each row is left without a stool, so the bank reads as busy
 * rather than booked solid, and the aisle keeps a gap to walk in by.
 */
const SLOT_OPEN_CABINET_INDEX = 2;

const SLOT_SEATS: ReadonlyArray<CasinoSeatFixture> = Array.from(
  { length: SLOT_BANK_CABINETS_PER_ROW },
  (_, index) => index,
)
  .filter((index) => index !== SLOT_OPEN_CABINET_INDEX)
  .flatMap((index): CasinoSeatFixture[] => [
    {
      game: 'slots',
      tile: { x: SLOT_BANK_FIRST_X + index, y: SLOT_NORTH_STOOL_Y },
      facing: 'north',
    },
    {
      game: 'slots',
      tile: { x: SLOT_BANK_FIRST_X + index, y: SLOT_SOUTH_STOOL_Y },
      facing: 'south',
    },
  ]);

/** The blackjack table's footprint row, and its three stools along its front rail. */
export const BLACKJACK_TABLE_TILE = { x: 19, y: 5 } as const satisfies TilePoint;
const BLACKJACK_STOOL_Y = BLACKJACK_TABLE_TILE.y + 1;
const BLACKJACK_STOOLS = 3;
const BLACKJACK_SEATS: ReadonlyArray<CasinoSeatFixture> = Array.from(
  { length: BLACKJACK_STOOLS },
  (_, offset) => ({
    game: 'blackjack',
    tile: { x: BLACKJACK_TABLE_TILE.x + offset, y: BLACKJACK_STOOL_Y },
    facing: 'north',
  }),
);

/** The poker table's footprint row: a two-by-two table whose art rises into the row above. */
export const POKER_TABLE_TILE = { x: 14, y: 4 } as const satisfies TilePoint;

/**
 * The six poker stools, indexed by the poker screen's seat numbers and running
 * clockwise from the player's seat at the south-west corner, as the screen
 * deals them. The far side's two stools stand in the row the table's art
 * rises into, so the table hides their lower halves as it would at a real
 * table; nobody walks there, so the table may block it. Seat 0 is the
 * player's: nobody sits on it, and it stands empty
 * while the crawler plays.
 */
const POKER_SEATS: ReadonlyArray<CasinoSeatFixture> = [
  { game: 'poker', tile: { x: 14, y: 5 }, facing: 'north', pokerSeat: 0 },
  { game: 'poker', tile: { x: 13, y: 4 }, facing: 'east', pokerSeat: 1 },
  { game: 'poker', tile: { x: 14, y: 3 }, facing: 'south', pokerSeat: 2 },
  { game: 'poker', tile: { x: 15, y: 3 }, facing: 'south', pokerSeat: 3 },
  { game: 'poker', tile: { x: 16, y: 4 }, facing: 'west', pokerSeat: 4 },
  { game: 'poker', tile: { x: 15, y: 5 }, facing: 'north', pokerSeat: 5 },
];

export const CLUB_CASINO_SEATS: ReadonlyArray<CasinoSeatFixture> = [
  ...SLOT_SEATS,
  ...BLACKJACK_SEATS,
  ...POKER_SEATS,
];

/**
 * A decorated floor region for each station — larger than the single station
 * tile so the areas read as distinct rooms. Bounds are inclusive tile indices
 * that stay clear of the border walls and the central dance floor.
 */
export interface ClubZone extends ClubTileRect {
  readonly id: ClubStationId;
  /**
   * The name painted along the rug's front edge, or null for a room whose
   * floor is furnished from wall to wall: the name is painted under the
   * furniture, and a word cut off between two props reads as a glitch.
   */
  readonly label: string | null;
  /** Theme accent used for the zone rug, label, and prop trim. */
  readonly color: string;
}

export const CLUB_ZONES: ReadonlyArray<ClubZone> = [
  { id: 'bar', label: 'THE BAR', x0: 1, y0: 1, x1: 5, y1: 6, color: '#e0b060' },
  { id: 'market', label: 'THE MARKET', x0: 1, y0: 13, x1: 5, y1: 18, color: '#c07ad8' },
  { id: 'casino', label: null, x0: 7, y0: 1, x1: 26, y1: 6, color: '#40c878' },
];

/**
 * Whether cosmetic patrons may stand on a tile. They have the run of the club's
 * open floor — the entrance hall, the lanes past the stages, the tables in the
 * east — but stay out of the dance floor (that belongs to the dancers), the
 * stages, and the station rooms (a patron loitering behind the bar reads as a
 * bug, and they would shove the staff off their marks). The casino's people
 * are its seated gamblers, so the crowd stays out of it too.
 *
 * The border ring is excluded too: its only walkable tiles are the exit
 * doorway, and a patron shoved into it blocks the door. So are the marks of the
 * figures who never move, so a patron is never sent to lean into one forever.
 *
 * Walkability is the caller's job: this only answers "is this somewhere a patron
 * belongs", and knows nothing about walls or furniture.
 */
export function isClubPatronTile(tx: number, ty: number): boolean {
  const onBorder = tx <= 0 || ty <= 0 || tx >= CLUB_INTERIOR_W - 1 || ty >= CLUB_INTERIOR_H - 1;
  if (onBorder) return false;
  const onFixedFigureMark =
    (tx === CLUB_HOST_MARK.x && ty === CLUB_HOST_MARK.y) ||
    CLUB_STAFFED_POSTS.some((post) => post.x === tx && post.y === ty);
  if (onFixedFigureMark) return false;
  if (inClubRect(CLUB_DANCE_FLOOR, tx, ty)) return false;
  if (CLUB_PERFORMER_POSTS.some((post) => inClubRect(post.stage, tx, ty))) return false;
  return !CLUB_ZONES.some((zone) => inClubRect(zone, tx, ty));
}

export const CLUB_PATRON_COUNT = 14;

/** The high-top tables on the open floor east of Magnum's stage. */
export const CLUB_STANDING_TABLE_TILES: ReadonlyArray<TilePoint> = [
  { x: 22, y: 15 },
  { x: 25, y: 13 },
  { x: 24, y: 17 },
];

/**
 * Somewhere patrons stand together: a ring round `centre` (in tiles, a point
 * rather than a tile) at `radiusTiles`, holding at most `capacity` people
 * facing in. A table's ring stands round the table; an open circle is a knot
 * of friends with nothing in the middle.
 */
export interface ClubGathering {
  readonly centre: { readonly x: number; readonly y: number };
  readonly radiusTiles: number;
  readonly capacity: number;
}

/**
 * A high-top table's pedestal stands in the middle of its footprint tile, and
 * its top overhangs it, so the ring stands a little more than a tile out.
 */
const TABLE_RING_RADIUS_TILES = 1.15;
const TABLE_RING_CAPACITY = 3;
/** Friends in the open stand far enough apart that two in a row never read as one figure. */
const OPEN_CIRCLE_RADIUS_TILES = 1.1;
const OPEN_CIRCLE_CAPACITY = 5;

/** Open floor where a knot of friends forms: by the bar's mouth, in the entrance hall, and by the tables. */
const OPEN_CIRCLE_CENTRES: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 3.5, y: 9.5 },
  { x: 9.5, y: 16.5 },
  { x: 19, y: 16.5 },
];

export const CLUB_GATHERINGS: ReadonlyArray<ClubGathering> = [
  ...CLUB_STANDING_TABLE_TILES.map((tile) => ({
    centre: { x: tile.x + TILE_CENTRE, y: tile.y + TILE_CENTRE },
    radiusTiles: TABLE_RING_RADIUS_TILES,
    capacity: TABLE_RING_CAPACITY,
  })),
  ...OPEN_CIRCLE_CENTRES.map((centre) => ({
    centre,
    radiusTiles: OPEN_CIRCLE_RADIUS_TILES,
    capacity: OPEN_CIRCLE_CAPACITY,
  })),
];
