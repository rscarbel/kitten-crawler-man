/**
 * Furniture layout for the Cloak & Dagger interior.
 *
 * Each entry places one sprite from the club furniture sheets
 * (`src/images/environment/club/`) on a run of tiles. A prop's `tile` is the
 * top-left of its **footprint** — the single tile row it stands on — and the art
 * rises into the tiles behind it, which is exactly the anchor the sprite sheets
 * were generated against.
 *
 * The footprint row is what the prop sorts by in the interior's Y-sorted entity
 * pass. A crawler standing south of a counter therefore draws in front of it,
 * with no per-prop special-casing.
 *
 * Collision covers the footprint *and* the rows the art rises into: those tiles
 * are where the counter physically is, and a crawler allowed to stand in them
 * would be painted over by the very prop they walked behind. A free-standing
 * piece with room behind it — a slot cabinet — opts out with `openBehind`, and
 * there being painted over is exactly right: the crawler is behind it.
 *
 * Each station is laid out back-to-front along the same axis — backdrop piece,
 * then the staff tile, then the counter the player walks up to — so every room
 * reads the same way and every vendor ends up behind their own counter.
 */

import { TILE_SIZE } from '../constants';
import type { TilePoint } from '../../map/town/townPlan';
import {
  BLACKJACK_TABLE_TILE,
  CLUB_CASINO_SEATS,
  CLUB_DONALD_POST,
  CLUB_HOST_MARK,
  CLUB_PERFORMER_POSTS,
  CLUB_STANDING_TABLE_TILES,
  POKER_TABLE_TILE,
  SLOT_BANK_CABINETS_PER_ROW,
  SLOT_BANK_FIRST_X,
  SLOT_BANK_NORTH_ROW_Y,
  SLOT_BANK_SOUTH_ROW_Y,
  type ClubPerformerPost,
} from './clubLayout';
import clubSpriteManifest from '../../images/environment/club/manifest.json';

/** Furniture sheets available to the club layout, keyed as in the sprite manifest. */
export type ClubPropSprite = keyof typeof clubSpriteManifest;

export interface ClubProp {
  readonly sprite: ClubPropSprite;
  /** Frame index into the sheet's variant row — what makes two counters look different. */
  readonly variant: number;
  /** Top-left tile of the prop's one-tile-deep footprint. */
  readonly tile: TilePoint;
  /** A chasing-bulb sheet laid over the prop's art; see {@link ClubPropLights}. */
  readonly lights?: ClubPropLights;
  /**
   * Leaves the rows the art rises into walkable, blocking only the footprint.
   * A crawler there sorts before the prop, so the prop's front is painted over
   * them and they read as standing behind it.
   */
  readonly openBehind?: boolean;
  /**
   * Whether the prop blocks movement. Stools are deliberately not solid: the
   * player is meant to be able to stand among them at the bar rail.
   */
  readonly solid: boolean;
}

/**
 * The lit bulbs of a marquee or a wheel rim, kept on their own sheet so the
 * prop under them is painted once and only the bulbs step through their chase.
 */
export interface ClubPropLights {
  /** Sheet whose frames are the chase phases, drawn at the prop's own anchor. */
  readonly sprite: ClubPropSprite;
  /** Chase phases advanced per second. */
  readonly stepsPerSecond: number;
  /**
   * Phases this prop runs ahead of the clock. Each cabinet in the bank is one
   * phase on from the last, so the chase runs down the row rather than every
   * marquee blinking as one sign.
   */
  readonly phaseOffset: number;
}

/** A slot marquee chases briskly, the way a machine begs to be played. */
const SLOT_CHASE_STEPS_PER_SECOND = 8;
/** The idle wheel's rim lights walk slowly; it is waiting, not spinning. */
const WHEEL_CHASE_STEPS_PER_SECOND = 3;

/** The slot sheets whose cabinets each play the slot floor from where they stand. */
export const SLOT_CABINET_SPRITES = [
  'club_slot_cabinet',
  'club_slot_cabinet_back',
] as const satisfies ReadonlyArray<ClubPropSprite>;

function slotLights(phaseOffset: number): ClubPropLights {
  return {
    sprite: 'club_slot_lights',
    stepsPerSecond: SLOT_CHASE_STEPS_PER_SECOND,
    phaseOffset,
  };
}

/**
 * Tile columns a sheet's art covers, read from the sheet itself so the layout
 * can't disagree with the picture — a regenerated, differently-sized sheet moves
 * the collision box with it instead of silently drifting from the art.
 */
function propWidthTiles(sprite: ClubPropSprite): number {
  const def = clubSpriteManifest[sprite];
  return def.frameWidth / def.tileScale;
}

/**
 * Tile rows a sheet's art covers, counting the footprint row. Rounded up: a
 * stool that rises half a tile still has that half-tile standing in the row
 * above it.
 */
function propHeightTiles(sprite: ClubPropSprite): number {
  const def = clubSpriteManifest[sprite];
  return Math.ceil(def.frameHeight / def.tileScale);
}

/** Pixel Y a prop sorts on: the bottom of its footprint row, matching the entity pass. */
export function propSortY(prop: ClubProp): number {
  return prop.tile.y * TILE_SIZE;
}

/** The slot sheet has one livery per frame; the bank deals them out down each row. */
const SLOT_LIVERY_COUNT = clubSpriteManifest.club_slot_cabinet.states.idle.frameCount;
/**
 * The south row starts its liveries half a row on from the north row, so the
 * two machines facing each other across the aisle never wear the same one.
 */
const SOUTH_ROW_LIVERY_SHIFT = Math.ceil(SLOT_BANK_CABINETS_PER_ROW / 2);

/**
 * Two rows of cabinets facing each other across an aisle: the north row
 * against the back wall, seen from the front, and the south row seen from
 * behind. Only the footprint of each blocks; the aisle between the rows is
 * where the stools stand.
 */
function slotBank(): ClubProp[] {
  return Array.from({ length: SLOT_BANK_CABINETS_PER_ROW }, (_, index): ClubProp[] => [
    {
      sprite: 'club_slot_cabinet',
      variant: index % SLOT_LIVERY_COUNT,
      tile: { x: SLOT_BANK_FIRST_X + index, y: SLOT_BANK_NORTH_ROW_Y },
      solid: true,
      openBehind: true,
      lights: slotLights(index),
    },
    {
      sprite: 'club_slot_cabinet_back',
      variant: (index + SOUTH_ROW_LIVERY_SHIFT) % SLOT_LIVERY_COUNT,
      tile: { x: SLOT_BANK_FIRST_X + index, y: SLOT_BANK_SOUTH_ROW_Y },
      solid: true,
      openBehind: true,
    },
  ]).flat();
}

/** The stools every casino seat stands on, one bar-stool look after another. */
const STOOL_VARIANTS = clubSpriteManifest.club_bar_stool.states.idle.frameCount;
function casinoStools(): ClubProp[] {
  return CLUB_CASINO_SEATS.map((seat, index) => ({
    sprite: 'club_bar_stool',
    variant: index % STOOL_VARIANTS,
    tile: seat.tile,
    solid: false,
  }));
}

/** The stage platform's footprint is its front row: the top-left of that row is the prop's tile. */
function stageProp(post: ClubPerformerPost): ClubProp {
  return {
    sprite: 'club_stage',
    variant: 0,
    tile: { x: post.stage.x0, y: post.stage.y1 },
    solid: true,
  };
}

/** The host stand's footprint is the row south of Brandon's mark, so he stands behind it. */
const HOST_STAND_TILE = { x: CLUB_HOST_MARK.x, y: CLUB_HOST_MARK.y + 1 } as const;

const STANDING_TABLE_VARIANTS = clubSpriteManifest.club_standing_table.states.idle.frameCount;

/** High-top tables on the open floor east of Magnum's stage, where the crowd stands to drink. */
export const CLUB_PROPS: ReadonlyArray<ClubProp> = [
  // ── The Bar — back-bar shelving, the bartender's row, the counter, the rail ──
  { sprite: 'club_drink_shelf', variant: 0, tile: { x: 2, y: 1 }, solid: true },
  { sprite: 'club_bar_counter', variant: 0, tile: { x: 2, y: 4 }, solid: true },
  { sprite: 'club_bar_stool', variant: 0, tile: { x: 2, y: 5 }, solid: false },
  { sprite: 'club_bar_stool', variant: 1, tile: { x: 3, y: 5 }, solid: false },
  { sprite: 'club_bar_stool', variant: 2, tile: { x: 4, y: 5 }, solid: false },

  // ── The Casino — the slot bank in the west of the wing, the poker table, the
  //    blackjack table with Deuce behind it, and the wheel in the north-east
  //    corner with Donald's counter at its foot ──
  ...slotBank(),
  { sprite: 'club_poker_table', variant: 0, tile: POKER_TABLE_TILE, solid: true },
  { sprite: 'club_casino_table', variant: 0, tile: BLACKJACK_TABLE_TILE, solid: true },
  {
    sprite: 'club_fortune_wheel',
    variant: 0,
    tile: { x: CLUB_DONALD_POST.x - 2, y: CLUB_DONALD_POST.y - 1 },
    solid: true,
    lights: {
      sprite: 'club_fortune_wheel_lights',
      stepsPerSecond: WHEEL_CHASE_STEPS_PER_SECOND,
      phaseOffset: 0,
    },
  },
  {
    sprite: 'club_croupier_counter',
    variant: 0,
    tile: { x: CLUB_DONALD_POST.x, y: CLUB_DONALD_POST.y + 1 },
    solid: true,
  },
  ...casinoStools(),

  // ── The stages, one either side of the dance floor ──
  ...CLUB_PERFORMER_POSTS.map(stageProp),

  // ── The Market — awninged back stall, the vendor's row, the produce counter ──
  { sprite: 'club_market_backdrop', variant: 0, tile: { x: 2, y: 15 }, solid: true },
  { sprite: 'club_market_stall', variant: 0, tile: { x: 2, y: 17 }, solid: true },

  // ── The front of house — Brandon's stand by the door ──
  { sprite: 'club_host_stand', variant: 0, tile: HOST_STAND_TILE, solid: true, openBehind: true },

  // ── The open floor ──
  ...CLUB_STANDING_TABLE_TILES.map((tile, index): ClubProp => ({
    sprite: 'club_standing_table',
    variant: index % STANDING_TABLE_VARIANTS,
    tile,
    solid: true,
  })),
];

function collectSolidTiles(): ReadonlyArray<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const prop of CLUB_PROPS) {
    if (!prop.solid) continue;
    const widthTiles = propWidthTiles(prop.sprite);
    const heightTiles = prop.openBehind === true ? 1 : propHeightTiles(prop.sprite);
    for (let row = 0; row < heightTiles; row++) {
      for (let col = 0; col < widthTiles; col++) {
        tiles.push({ x: prop.tile.x + col, y: prop.tile.y - row });
      }
    }
  }
  return tiles;
}

/**
 * Every tile the club's furniture blocks, derived from the layout above so the
 * collision box can never drift from the art the player sees. The tiles still
 * render as ordinary club floor — the furniture is drawn by the sprite pass, not
 * by the tile renderer.
 *
 * A station's staff tile is among them: the vendor stands *inside* their own
 * counter's art, which is the point — they are behind the bar, and the player
 * talks to them across it from up to 2.6 tiles away. So is every stage tile:
 * the platform is the dancer's alone.
 */
export const CLUB_FURNITURE_TILES = collectSolidTiles();

/** Whether a sheet is one of the slot bank's cabinets, front or back. */
export function isSlotCabinet(sprite: ClubPropSprite): boolean {
  return SLOT_CABINET_SPRITES.some((cabinet) => cabinet === sprite);
}
