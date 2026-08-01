/**
 * Furniture layout for the Desperado Club interior.
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
 * would be painted over by the very prop they walked behind.
 *
 * Each station is laid out back-to-front along the same axis — backdrop piece,
 * then the staff tile, then the counter the player walks up to — so every room
 * reads the same way and every vendor ends up behind their own counter.
 */

import { TILE_SIZE } from './constants';
import clubSpriteManifest from '../images/environment/club/manifest.json';

/** Furniture sheets available to the club layout, keyed as in the sprite manifest. */
export type ClubPropSprite = keyof typeof clubSpriteManifest;

export interface ClubProp {
  sprite: ClubPropSprite;
  /** Frame index into the sheet's variant row — what makes two counters look different. */
  variant: number;
  /** Top-left tile of the prop's one-tile-deep footprint. */
  tile: { x: number; y: number };
  /**
   * Whether the prop blocks movement. Stools are deliberately not solid: the
   * player is meant to be able to stand among them at the bar rail.
   */
  solid: boolean;
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

export const CLUB_PROPS: ReadonlyArray<ClubProp> = [
  // ── The Bar — back-bar shelving, the bartender's row, the counter, the rail ──
  { sprite: 'club_drink_shelf', variant: 0, tile: { x: 2, y: 1 }, solid: true },
  { sprite: 'club_bar_counter', variant: 0, tile: { x: 2, y: 4 }, solid: true },
  { sprite: 'club_bar_stool', variant: 0, tile: { x: 2, y: 5 }, solid: false },
  { sprite: 'club_bar_stool', variant: 1, tile: { x: 3, y: 5 }, solid: false },
  { sprite: 'club_bar_stool', variant: 2, tile: { x: 4, y: 5 }, solid: false },

  // ── The Casino — a service shelf behind the dealer, the felt table in front ──
  { sprite: 'club_drink_shelf', variant: 2, tile: { x: 19, y: 1 }, solid: true },
  { sprite: 'club_casino_table', variant: 0, tile: { x: 19, y: 5 }, solid: true },
  { sprite: 'club_bar_stool', variant: 1, tile: { x: 18, y: 6 }, solid: false },
  { sprite: 'club_bar_stool', variant: 2, tile: { x: 22, y: 6 }, solid: false },

  // ── The Market — awninged back stall, the vendor's row, the produce counter ──
  { sprite: 'club_market_backdrop', variant: 0, tile: { x: 2, y: 13 }, solid: true },
  { sprite: 'club_market_stall', variant: 0, tile: { x: 2, y: 15 }, solid: true },

  // ── Meat Shields — the arms rack behind Rosemarie, her contract desk in front ──
  { sprite: 'club_weapon_rack', variant: 0, tile: { x: 19, y: 13 }, solid: true },
  { sprite: 'club_merc_desk', variant: 0, tile: { x: 19, y: 15 }, solid: true },

  // ── VIP Lounge — rope, podium, rope, walling off the whole north nook ────────
  { sprite: 'club_velvet_rope', variant: 0, tile: { x: 7, y: 3 }, solid: true },
  { sprite: 'club_vip_counter', variant: 0, tile: { x: 9, y: 3 }, solid: true },
  { sprite: 'club_velvet_rope', variant: 1, tile: { x: 15, y: 3 }, solid: true },
];

function collectSolidTiles(): ReadonlyArray<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const prop of CLUB_PROPS) {
    if (!prop.solid) continue;
    const widthTiles = propWidthTiles(prop.sprite);
    const heightTiles = propHeightTiles(prop.sprite);
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
 * talks to them across it from up to 2.6 tiles away.
 *
 * The VIP row seals the x7–16 nook behind it on purpose: the lounge is a
 * look-but-don't-enter set piece, and its host is reachable across the counter.
 * Nothing the player needs lives inside it.
 */
export const CLUB_FURNITURE_TILES = collectSolidTiles();
