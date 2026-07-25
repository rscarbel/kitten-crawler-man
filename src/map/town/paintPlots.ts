/**
 * Places the town's buildings on the plots the plan assigns them.
 *
 * A sprite building is one anchor tile carrying its manifest key; everything
 * else — how much ground the art covers and where its doorway falls — is
 * derived from the sprite itself, so re-sizing a building's art re-spaces its
 * plot without a code change.
 */

import { SPRITE_BUILDING } from '../tileTypes';
import { FloorTypeValue } from '../tileTypes';
import { getSpriteDoorwayByKey, getSpriteFootprintByKey } from '../../core/SpriteLoader';
import type { TileGrid } from './tileGrid';
import { offsetToTile, type PlannedBuilding, type TilePoint, type TileRect } from './townPlan';
import type { TownPlan } from './townPlan';

/** A sprite building once it is on the grid. */
export interface SpritePlacement {
  readonly doorTile: TilePoint;
  /** Tiles wide the facade's opening is, so the door's street stub can match it. */
  readonly doorwayWidth: number;
  /** Ground the art covers. */
  readonly rect: TileRect;
}

/**
 * Writes one sprite building's anchor tile and clears its doorway.
 *
 * Throws rather than skipping on an off-map anchor or a sprite with no
 * footprint or doorway. Every one of these buildings is a named quest, dialog
 * and interior anchor, so a silently unplaced building still registers its
 * entry and still gets a street stub while its art is nowhere on the map —
 * far harder to diagnose than a failed generation.
 */
export function placeSpriteBuilding(
  grid: TileGrid,
  plan: TownPlan,
  planned: PlannedBuilding,
): SpritePlacement {
  const anchor = offsetToTile(plan, planned.anchor);
  if (!grid.inBounds(anchor.x, anchor.y)) {
    throw new Error(
      `Sprite building '${planned.spriteKey}' anchors off the map at ${anchor.x},${anchor.y}`,
    );
  }
  grid.setSprite(anchor.x, anchor.y, SPRITE_BUILDING, planned.spriteKey);

  const footprint = getSpriteFootprintByKey(planned.spriteKey);
  const doorway = getSpriteDoorwayByKey(planned.spriteKey);
  if (footprint === undefined || doorway === undefined) {
    throw new Error(`Sprite building '${planned.spriteKey}' is missing a footprint or a doorway`);
  }

  const doorTile: TilePoint = { x: anchor.x + doorway.dx, y: anchor.y + doorway.dy };
  grid.set(doorTile.x, doorTile.y, FloorTypeValue.road);

  return {
    doorTile,
    doorwayWidth: doorway.width,
    rect: {
      x: anchor.x + footprint.dx,
      y: anchor.y + footprint.dy,
      w: footprint.w,
      h: footprint.h,
    },
  };
}

/**
 * The tower's reserved plot in absolute tiles. No tiles are written: the tower
 * renders entirely from its sprite, and painting wall or roof tiles under it
 * would show through the art's transparent areas. The rectangle exists so
 * street routing treats the spire as a structure to detour around.
 */
export function towerPlot(plan: TownPlan): TileRect {
  const origin = offsetToTile(plan, plan.tower.plot.offset);
  return { x: origin.x, y: origin.y, w: plan.tower.plot.w, h: plan.tower.plot.h };
}

export function towerDoorTile(plan: TownPlan): TilePoint {
  return offsetToTile(plan, plan.tower.door);
}
