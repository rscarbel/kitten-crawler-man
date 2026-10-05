import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawLightBeam, lightBeamBounds, type LightBeamPlacement } from '../sprites/lightBeam';

/**
 * A standing column of light over the tracked objective's tile.
 *
 * The world arrow above the player answers "which way", and stops once the
 * player is close. This answers "which one of these" — the last few tiles, where
 * a bearing is useless because the thing is already on screen among a dozen
 * others that look like it.
 *
 * Only for places. A character draws `drawQuestBeacon` from its own render,
 * behind its body, and its tracker target is built with `characterTarget`.
 *
 * Drawn before the Y-sorted world, so the marked place — and anyone walking
 * past it — stands in front of its own light. A building hides the beam up to
 * its roofline, so a facade target's beam is sized to rise well clear of the
 * ridge, and its pool and edge glow still show round the building's sides.
 */

/** The beam's default height for a one-tile target. */
const BEAM_HEIGHT_TILES = 3.2;
/**
 * The narrowest lit width, in tiles. A one-tile target's beam is still wider
 * than a figure's, since a place marker is read from further away.
 */
const MIN_COVER_WIDTH_TILES = 0.9;
const BEAM_STRENGTH = 0.95;
/**
 * Culling margin, in tiles, around the viewport.
 *
 * The beam is drawn from a tile that may sit just past the edge while its light
 * still belongs on screen, so the test is run against the beam's extents rather
 * than the tile's.
 */
const OFFSCREEN_MARGIN_TILES = 1;

/**
 * How much of the marked thing the beam has to cover.
 *
 * A beacon anchored on one tile marks a market stall no better than it marks a
 * doorway: the stall is two tiles of counter, the doorway can be three tiles of
 * opening, and a column sized for neither reads as pointing at the ground beside
 * them. Every field is optional and defaults to the single-tile beam, so a
 * target that really is one tile — a seated fortune teller — says nothing.
 */
export interface ObjectiveBeaconFootprint {
  /** Tiles the thing spans east from the anchor tile. */
  readonly widthTiles?: number;
  /**
   * Tiles north of the anchor tile's south edge to stand the beam's base on.
   *
   * A tile's south edge is its boundary with whatever is in front of it, which
   * is the ground line for anything rooted there. A market cart is not: its
   * counter is meant to be approached from the front, so light rising from that
   * edge stands in the street the shopper occupies rather than on the cart.
   */
  readonly backsetTiles?: number;
  /** Beam height, for a target tall enough that the default stops partway up it. */
  readonly heightTiles?: number;
}

const DEFAULT_WIDTH_TILES = 1;
const DEFAULT_BACKSET_TILES = 0;
const HALF = 0.5;

function placementFor(
  screenX: number,
  screenY: number,
  tileSize: number,
  color: string,
  nowMs: number,
  footprint: ObjectiveBeaconFootprint,
): LightBeamPlacement {
  const spanTiles = footprint.widthTiles ?? DEFAULT_WIDTH_TILES;
  const backsetTiles = footprint.backsetTiles ?? DEFAULT_BACKSET_TILES;
  return {
    centreX: screenX + tileSize * spanTiles * HALF,
    groundY: screenY + tileSize - tileSize * backsetTiles,
    coverWidth: tileSize * Math.max(MIN_COVER_WIDTH_TILES, spanTiles),
    height: tileSize * (footprint.heightTiles ?? BEAM_HEIGHT_TILES),
    color,
    strength: BEAM_STRENGTH,
    timeMs: nowMs,
  };
}

function isOffScreen(placement: LightBeamPlacement, tileSize: number): boolean {
  const bounds = lightBeamBounds(placement);
  const margin = tileSize * OFFSCREEN_MARGIN_TILES;
  return (
    bounds.right < -margin ||
    bounds.left > viewportWidth() + margin ||
    bounds.bottom < -margin ||
    bounds.top > viewportHeight() + margin
  );
}

/**
 * The beam: ground pool, shaft and rising motes. Draw it before the Y-sorted
 * world, so the marked place and anyone near it stand in front of it.
 *
 * Skips itself entirely when the beam falls outside the viewport, so the caller
 * only has to convert world coordinates to screen ones.
 *
 * @param ctx       Canvas context, in screen space
 * @param screenX   Screen-x of the anchor tile's left edge
 * @param screenY   Screen-y of the anchor tile's top edge
 * @param tileSize  Tile size in pixels, which the beam scales itself against
 * @param color     Beam colour, as `#rrggbb` — pass the same one the quest arrow uses
 * @param nowMs     Monotonic clock driving the shimmer
 * @param footprint What the beam is covering; omit for a one-tile target
 */
export function drawObjectiveBeacon(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  tileSize: number,
  color: string,
  nowMs: number,
  footprint: ObjectiveBeaconFootprint = {},
): void {
  const placement = placementFor(screenX, screenY, tileSize, color, nowMs, footprint);
  if (isOffScreen(placement, tileSize)) return;
  drawLightBeam(ctx, placement);
}
