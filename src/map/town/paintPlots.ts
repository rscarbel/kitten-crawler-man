/**
 * Places the town's buildings on the plots the plan assigns them.
 *
 * A sprite building is one anchor tile carrying its manifest key; everything
 * else — how much ground the art covers and where its doorway falls — is
 * derived from the sprite itself, so re-sizing a building's art re-spaces its
 * plot without a code change.
 */

import { LANE_STREET, SPRITE_BUILDING } from '../tileTypes';
import { getSpriteDoorwayByKey, getSpriteFootprintByKey } from '../../core/SpriteLoader';
import type { TileGrid } from './tileGrid';
import { offsetToTile, type PlannedBuilding, type TilePoint, type TileRect } from './townPlan';
import type { TownPlan } from './townPlan';

/** Manifest key of the town's main tower, whose anchor tile carries no sprite key. */
const MAIN_TOWER_SPRITE_KEY = 'overworld_main_tower';

/**
 * The tower's blocking base, relative to its anchor: the manifest blocks the two
 * rows *above* the anchor and nothing else.
 */
const TOWER_BASE_NORTH_OFFSET = 2;
const TOWER_BASE_ROWS = 2;
/** Used only if the tower's sprite is missing from the manifest. */
const TOWER_BASE_FALLBACK_WIDTH = 6;
const TOWER_BASE_FALLBACK_WEST_OFFSET = 3;

/** A sprite building once it is on the grid. */
export interface SpritePlacement {
  readonly doorTile: TilePoint;
  /** Leftmost column of the facade's opening; `doorTile.x` is its centre. */
  readonly doorwayX: number;
  /** Tiles wide the facade's opening is, so the door's apron can match it. */
  readonly doorwayWidth: number;
  /** Ground the art covers. */
  readonly rect: TileRect;
}

/**
 * Writes one sprite building's anchor tile and clears its doorway.
 *
 * The plan states the plot's west column and the row the facade fronts; the
 * anchor is derived by aligning the manifest footprint's west and south edges to
 * those, so the plan never restates a sprite's size and a re-scaled building
 * keeps its frontage on the street.
 *
 * Throws rather than skipping on an off-map anchor or a sprite with no
 * footprint or doorway. Every one of these buildings is a named quest, dialog
 * and interior anchor, so a silently unplaced building still registers its
 * entry and still gets a street apron while its art is nowhere on the map —
 * far harder to diagnose than a failed generation.
 */
export function placeSpriteBuilding(
  grid: TileGrid,
  plan: TownPlan,
  planned: PlannedBuilding,
): SpritePlacement {
  const footprint = getSpriteFootprintByKey(planned.spriteKey);
  const doorway = getSpriteDoorwayByKey(planned.spriteKey);
  if (footprint === undefined || doorway === undefined) {
    throw new Error(`Sprite building '${planned.spriteKey}' is missing a footprint or a doorway`);
  }

  const anchor: TilePoint = {
    x: plan.centre.x + planned.west - footprint.dx,
    y: plan.centre.y + planned.frontRow - (footprint.dy + footprint.h - 1),
  };
  if (!grid.inBounds(anchor.x, anchor.y)) {
    throw new Error(
      `Sprite building '${planned.spriteKey}' anchors off the map at ${anchor.x},${anchor.y}`,
    );
  }
  grid.setSprite(anchor.x, anchor.y, SPRITE_BUILDING, planned.spriteKey);

  const doorTile: TilePoint = { x: anchor.x + doorway.dx, y: anchor.y + doorway.dy };
  grid.set(doorTile.x, doorTile.y, LANE_STREET);

  return {
    doorTile,
    doorwayX: anchor.x + doorway.dx0,
    doorwayWidth: doorway.width,
    rect: {
      x: anchor.x + footprint.dx,
      y: anchor.y + footprint.dy,
      w: footprint.w,
      h: footprint.h,
    },
  };
}

export function towerDoorTile(plan: TownPlan): TilePoint {
  return offsetToTile(plan, plan.tower.door);
}

/**
 * The ground the tower actually stands on: the two rows its manifest blocks, which
 * are the wall row and the row below it carrying the doorway.
 *
 * Not the sprite footprint — that is 23 rows tall and 21 of them overhang the
 * fields north of the wall. This is what a plot-overlap check should compare
 * against, and it is the same rectangle `townMetrics` measures the tower by.
 */
export function towerBasePlot(plan: TownPlan): TileRect {
  const anchor = offsetToTile(plan, plan.tower.anchor);
  const footprint = getSpriteFootprintByKey(MAIN_TOWER_SPRITE_KEY);
  const width = footprint?.w ?? TOWER_BASE_FALLBACK_WIDTH;
  const west = anchor.x + (footprint?.dx ?? -TOWER_BASE_FALLBACK_WEST_OFFSET);
  return { x: west, y: anchor.y - TOWER_BASE_NORTH_OFFSET, w: width, h: TOWER_BASE_ROWS };
}
