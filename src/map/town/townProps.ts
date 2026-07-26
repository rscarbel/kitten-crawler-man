/**
 * Paints the plan's props onto the grid. Props are tile types rather than
 * sprites — the fountain, torches and wells all render procedurally — so
 * placing one is a write, and the registry is the plan's `props` list.
 *
 * Runs after the streets and buildings so props always sit on finished ground,
 * and before ground scatter so scatter never lands on top of one.
 */

import { FOUNTAIN, TORCH, WELL } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TilePoint, TownPlan } from './townPlan';

/**
 * Every prop is written with `setStanding`, so it remembers the surface it was
 * placed on.
 *
 * A prop's own type replaces the ground's, and the renderers then infer a floor
 * from the first cardinal neighbour they find — a probe that starts to the south
 * and skips anything that is not floor. The west side-gate torch stands on the
 * verge strip inside the wall with the fence south of it, the wall west of it and
 * **Market Street's cobble to the north**, so it drew a full tile of cobble
 * jutting down into the verge. Its mirror at the east gate has the identical
 * neighbourhood and drew verge — only because the tile south of it happened to be
 * planted that generation. Two identical props, opposite results, decided by a
 * dice roll in `plantGardens`; recording the surface removes the dice.
 */
export function paintTownProps(grid: TileGrid, plan: TownPlan): void {
  for (const prop of plan.props) {
    switch (prop.kind) {
      case 'fountain':
        grid.fillStanding(prop.bounds, FOUNTAIN);
        break;
      case 'torch':
        grid.setStanding(prop.tile.x, prop.tile.y, TORCH);
        break;
      case 'well':
        grid.setStanding(prop.tile.x, prop.tile.y, WELL);
        break;
    }
  }
}

/**
 * Centre tile of the plan's fountain — what the ambient water emitter and the
 * plaza's activity anchors position themselves against.
 *
 * Undefined when the plan has no fountain. Consumers already treat the fountain
 * as optional (`GameMap.fountainCentre`), and falling back to the town centre
 * would silently play water from a dry plaza rather than play nothing.
 */
export function fountainCentre(plan: TownPlan): TilePoint | undefined {
  for (const prop of plan.props) {
    if (prop.kind !== 'fountain') continue;
    return {
      x: prop.bounds.x + Math.floor(prop.bounds.w / 2),
      y: prop.bounds.y + Math.floor(prop.bounds.h / 2),
    };
  }
  return undefined;
}
