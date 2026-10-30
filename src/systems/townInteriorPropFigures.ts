/**
 * Splits a generated interior's placed town props into the two layers they
 * draw in. `BuildingInteriorScene` and `scripts/render-town-interiors.ts` both
 * draw through these — a prop drawn only by one of the two would be a room
 * that looks furnished in review renders and bare in the real game.
 *
 * - **Ground layer** (`drawTownInteriorGroundProps`): every prop whose def is
 *   walkable and does not stand up (`townInteriorPropLiesFlat`) — rugs,
 *   runners, a cellar hatch. These lie flat on the boards,
 *   so they draw straight after the floor and under every figure. Sorted with
 *   the figures instead, a rug sorts on its bottom row and paints over anyone
 *   standing on its upper rows.
 * - **Y-sorted pass** (`townInteriorPropFigures`): everything that stands up
 *   off the floor, as `InteriorFigure`s, the same shape the Cloak & Dagger's
 *   furniture and every room's occupants already draw through.
 *
 * The split is read off the prop def, so a new flat prop lands in the right
 * layer by being declared walkable.
 */

import { TILE_SIZE } from '../core/constants';
import { frameTime } from '../utils';
import type { GameMap, PlacedTownInteriorProp } from '../map/GameMap';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import {
  TOWN_INTERIOR_PROPS,
  drawTownInteriorProp,
  townInteriorPropLiesFlat,
  townInteriorPropSortY,
} from '../sprites/art/townInterior/townInteriorProps';
import { drawPropFlames } from '../sprites/art/townInterior/propFlames';

/** A sorted-pass figure that remembers which placed prop it draws, so a gate can ask what entered the sort. */
export interface TownInteriorPropFigure extends InteriorFigure {
  readonly placed: PlacedTownInteriorProp;
}

const NOTHING_BROKEN: ReadonlySet<string> = new Set();

/** Whether a placed prop lies flat on the floor and so belongs in the ground layer. */
function liesOnFloor(placed: PlacedTownInteriorProp): boolean {
  return townInteriorPropLiesFlat(placed.propId);
}

function drawPlaced(
  ctx: CanvasRenderingContext2D,
  placed: PlacedTownInteriorProp,
  camX: number,
  camY: number,
  tileSize: number,
): void {
  drawTownInteriorProp(
    ctx,
    placed.propId,
    placed.variant,
    placed.tile.x,
    placed.tile.y,
    camX,
    camY,
    tileSize,
  );
  const propDef = TOWN_INTERIOR_PROPS[placed.propId];
  if (propDef.flames === undefined) return;
  drawPropFlames(
    ctx,
    propDef.flames,
    propDef.footprint.h,
    placed.tile.x,
    placed.tile.y,
    camX,
    camY,
    tileSize,
    frameTime,
  );
}

/**
 * How far down its own row a walkable standing prop sorts, in tiles. A figure
 * on a tile sorts at the row's top, the same line a solid prop takes, and wins
 * that tie; a bar stool sorted half a tile lower is drawn over the legs of a
 * crawler whose feet are on its tile, while one standing in the row south of
 * it still sorts after it.
 */
const STANDING_WALKABLE_SORT_DROP_TILES = 0.5;

function figureFor(placed: PlacedTownInteriorProp): TownInteriorPropFigure {
  const propDef = TOWN_INTERIOR_PROPS[placed.propId];
  const footprintSortY = townInteriorPropSortY(placed.tile.y, propDef.footprint, TILE_SIZE);
  const sortDropPx = propDef.standsUp === true ? STANDING_WALKABLE_SORT_DROP_TILES * TILE_SIZE : 0;
  return {
    placed,
    y: footprintSortY + sortDropPx,
    render: (ctx, camX, camY, tileSize) => drawPlaced(ctx, placed, camX, camY, tileSize),
  };
}

/**
 * Every standing prop a building's layout file placed, ready for the room's
 * Y-sorted render pass. Walkable props are left out — they belong to
 * {@link drawTownInteriorGroundProps}. `broken` names the ids
 * (`PlacedTownInteriorProp.id`) a swing has already flattened this visit —
 * `TownInteriorPropDestructionSystem`'s — so a smashed crate stops standing in
 * the room without needing a second copy of this list to drop it from.
 */
export function townInteriorPropFigures(
  map: GameMap,
  broken: ReadonlySet<string> = NOTHING_BROKEN,
): TownInteriorPropFigure[] {
  return map.placedInteriorProps
    .filter((placed) => !liesOnFloor(placed) && !broken.has(placed.id))
    .map(figureFor);
}

/** The placed props that lie flat on the floor, in placement order — the ground layer's draw list. */
export function townInteriorGroundProps(
  map: GameMap,
  broken: ReadonlySet<string> = NOTHING_BROKEN,
): PlacedTownInteriorProp[] {
  return map.placedInteriorProps.filter((placed) => liesOnFloor(placed) && !broken.has(placed.id));
}

/**
 * Draws the room's flat props. Call after the floor tiles and before any
 * Y-sorted figure, so everyone standing on a rug is drawn over it.
 */
export function drawTownInteriorGroundProps(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camX: number,
  camY: number,
  tileSize: number,
  broken: ReadonlySet<string> = NOTHING_BROKEN,
): void {
  for (const placed of townInteriorGroundProps(map, broken)) {
    drawPlaced(ctx, placed, camX, camY, tileSize);
  }
}
