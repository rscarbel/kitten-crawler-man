/**
 * How each kind of overworld landmark wants its objective beacon shaped.
 *
 * A tracker target used to be a bare tile, which the beacon read as "one tile
 * wide, standing on that tile's south edge". The width half of that is wrong for
 * most of what quests point at: a market stall or a wide doorway is simply
 * bigger than the one tile recorded for it. The ground line is right far more
 * often — a facade's door row and a prop's own tile both meet the street at
 * their south edge — and a cart is the exception, being a counter the shopper
 * stands in front of rather than a thing rooted at its front face.
 *
 * Kept together here, rather than spread across the scene's wiring, so the three
 * shapes can be compared against each other.
 */

import { getSpriteDoorwayByKey, getSpriteFootprintByKey } from '../core/SpriteLoader';
import { plannedBuildingSpriteKey } from '../map/town/townPlan';
import { STALL_CANOPY_HEIGHT_TILES, STALL_WIDTH_TILES } from '../sprites/marketStall';
import { doorwaySpan, type BuildingEntry } from './BuildingSystem';
import type { TrackerTarget } from './questTracker';

/**
 * No backset: a town prop stands on its tile's south edge, same as a facade.
 *
 * A baked town sheet is blitted with the anchor tile's top-left as the sprite's
 * anchor point, and every fixture in `townFixtures.ts` is drawn from that origin
 * downward into one tile — Madame Voss's seat line is at 0.96 of a tile below
 * it, the deepest ink she has. The frame around her is larger only to hold the
 * `shadowBlur` halos on her eyes and her orb, and the manifest's `tileX`/`tileY`
 * cancel that margin back out; they are not a claim that she is centred in the
 * frame. Lifting the pool half a tile therefore put it at her waist rather than
 * at her feet.
 */
const PROP_BACKSET_TILES = 0;

/** The counter's own face, rather than the street the shopper stands in. */
const STALL_BACKSET_TILES = 0.5;

/** The backset lowers the beam's base by this much, which the beam has to climb back. */
const STALL_BASE_BELOW_NORTH_EDGE_TILES = 1 - STALL_BACKSET_TILES;

/**
 * How far the beam has to overshoot the canopy ridge to be seen above it.
 *
 * The beam's alpha ramp is a fraction of its own length — full strength at the
 * base, roughly a third of that at 45% of the height, nothing at the top — so
 * clearance has to be read as a share of the total beam, not as tiles. At 3
 * tiles over a 2.5-tile rise the ridge lands at 45% of the beam, which is where
 * the ramp still has a third of its colour, and a little over two tiles of
 * visible light stand above the canopy. The previous 1.7 put the ridge at 60%
 * of the beam, leaving barely a tile of it in the air.
 */
const STALL_RIDGE_CLEARANCE_TILES = 3;

const STALL_BEAM_HEIGHT_TILES =
  STALL_CANOPY_HEIGHT_TILES + STALL_BASE_BELOW_NORTH_EDGE_TILES + STALL_RIDGE_CLEARANCE_TILES;

/**
 * No backset at all: the door tile's south edge *is* the base of the building.
 *
 * A sprite building's doorway is pushed onto the footprint's bottom row, so the
 * art's lowest ink lands on that row's south edge — the line where the facade
 * meets the street. A whole tile of backset therefore did not stand the beam on
 * the building, it stood it a full tile up the wall, which on the usual 5-row
 * facade is partway up the door itself.
 */
const DOORWAY_BACKSET_TILES = 0;

/**
 * The door row the beam now starts *below*, and so has to climb before it
 * reaches the rows a facade's `roofRise` counts.
 */
const FACADE_DOOR_ROW_TILES = 1;

/**
 * Height for an entrance whose facade cannot be measured — tall enough to wash
 * up a wall rather than stop at the lintel, but a guess at the roofline rather
 * than a reading of it. Only the tower and the Big Top take this path.
 */
const DOORWAY_BEAM_HEIGHT_TILES = 6.4;

/**
 * How far the beam clears the ridge of a facade it *can* measure, as a share of
 * the climb up to that ridge.
 *
 * A share rather than a fixed distance because the beam's fade is proportional
 * to its own length: a constant clearance leaves the same tiles of light above a
 * cottage and above the Desperado Club, but on the taller beam those tiles sit
 * far further along the ramp and have almost no colour left. Holding the
 * roofline near two thirds of the beam keeps a comparable band of visible light
 * over every building.
 */
const FACADE_ROOF_CLEARANCE_FRACTION = 0.45;

/** Below which a short facade's proportional clearance is too little to notice. */
const FACADE_MIN_ROOF_CLEARANCE_TILES = 2.4;

/** The west column, width and roof height of a building drawn from a sprite. */
interface FacadeExtent {
  readonly westColumn: number;
  readonly widthTiles: number;
  /** Rows between the door row's own north edge and the roof's top edge. */
  readonly roofRise: number;
}

/**
 * Measures a building from the art it is actually drawn with.
 *
 * A `BuildingEntry` records only its door, so the beacon used to be sized to the
 * opening — which marks a cottage no better than it marks a wardrobe. The plan
 * states no sizes either, deliberately, so the size has to come from the sprite
 * manifest, and the entry's own door tile is what inverts back to the anchor the
 * manifest offsets are measured from.
 *
 * Null for an entrance with no sprite building behind it: the tower, whose frame
 * is 23 rows of mostly-transparent spire, and the tile-built Big Top.
 */
function facadeExtent(entry: BuildingEntry): FacadeExtent | null {
  const spriteKey = plannedBuildingSpriteKey(entry.name);
  if (spriteKey === undefined) return null;
  const footprint = getSpriteFootprintByKey(spriteKey);
  const doorway = getSpriteDoorwayByKey(spriteKey);
  if (footprint === undefined || doorway === undefined) return null;

  const anchorX = entry.doorTile.x - doorway.dx;
  const anchorY = entry.doorTile.y - doorway.dy;
  return {
    westColumn: anchorX + footprint.dx,
    widthTiles: footprint.w,
    roofRise: entry.doorTile.y - (anchorY + footprint.dy),
  };
}

/** A single-tile fixture such as the fortune teller's table. */
export function propBeaconTarget(tile: { x: number; y: number } | null): TrackerTarget | null {
  if (tile === null) return null;
  return { x: tile.x, y: tile.y, backsetTiles: PROP_BACKSET_TILES };
}

/**
 * A market stall, whose anchor is the west tile of a two-tile counter.
 *
 * Widening it is what stops the beam sitting over one half of the cart and the
 * paving beside it.
 */
export function stallBeaconTarget(westTile: { x: number; y: number } | null): TrackerTarget | null {
  if (westTile === null) return null;
  return {
    x: westTile.x,
    y: westTile.y,
    widthTiles: STALL_WIDTH_TILES,
    backsetTiles: STALL_BACKSET_TILES,
    heightTiles: STALL_BEAM_HEIGHT_TILES,
  };
}

/**
 * A building, across its whole frontage and up past its roof.
 *
 * Sized to the facade rather than to the doorway: a column standing in a
 * one-tile opening marks the door of a building the player is already looking
 * at, which is the one question they did not need answered.
 *
 * Falls back to the opening for the entrances with no measurable facade, where
 * a doorway-sized beam is still the honest answer.
 */
export function doorwayBeaconTarget(entry: BuildingEntry | null): TrackerTarget | null {
  if (entry === null) return null;
  const facade = facadeExtent(entry);
  if (facade === null) {
    const span = doorwaySpan(entry);
    return {
      x: span.x0,
      y: entry.doorTile.y,
      widthTiles: span.width,
      backsetTiles: DOORWAY_BACKSET_TILES,
      heightTiles: DOORWAY_BEAM_HEIGHT_TILES,
    };
  }
  const ridgeRise = facade.roofRise + FACADE_DOOR_ROW_TILES;
  const roofClearance = Math.max(
    FACADE_MIN_ROOF_CLEARANCE_TILES,
    ridgeRise * FACADE_ROOF_CLEARANCE_FRACTION,
  );
  return {
    x: facade.westColumn,
    y: entry.doorTile.y,
    widthTiles: facade.widthTiles,
    backsetTiles: DOORWAY_BACKSET_TILES,
    heightTiles: ridgeRise + roofClearance,
  };
}
