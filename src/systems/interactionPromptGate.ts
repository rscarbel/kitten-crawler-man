/**
 * The one answer to "may a world prompt show right now?", shared by every
 * scene and every system that floats a SPACE prompt over something.
 *
 * The Space chain gives a press to the swing whenever a hostile is inside the
 * active crawler's attack range, so a prompt drawn then promises a press the
 * player will not get. Asked in one place, the prompts and the chain cannot
 * disagree.
 */

import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { CatPlayer } from '../creatures/CatPlayer';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { Mob } from '../creatures/Mob';
import { CAT_ATTACK_RANGE_TILES, HUMAN_ATTACK_RANGE_TILES } from './GameLoopPhases';

const TILE_CENTRE_FRACTION = 0.5;

/**
 * Whether a living hostile stands within `radiusPx` of the centre of
 * `player`'s tile. Allies (Signet, the Ink Marauders, a hireling) never count:
 * one standing close must not turn a press to talk into a swing.
 */
export function hostileWithinRadius(
  player: HumanPlayer | CatPlayer,
  mobGrid: SpatialGrid<Mob>,
  radiusPx: number,
): boolean {
  const px = player.x + TILE_SIZE * TILE_CENTRE_FRACTION;
  const py = player.y + TILE_SIZE * TILE_CENTRE_FRACTION;
  for (const mob of mobGrid.queryCircle(px, py, radiusPx)) {
    if (mob.isAlive && mob.isHostile) return true;
  }
  return false;
}

/** Whether a living hostile stands inside `active`'s attack range. */
export function hostileWithinAttackRange(
  active: HumanPlayer | CatPlayer,
  mobGrid: SpatialGrid<Mob>,
): boolean {
  const rangeTiles =
    active instanceof HumanPlayer ? HUMAN_ATTACK_RANGE_TILES : CAT_ATTACK_RANGE_TILES;
  return hostileWithinRadius(active, mobGrid, TILE_SIZE * rangeTiles);
}

/** Whether world prompts may show for `active`: not while a hostile is in its attack range. */
export function shouldShowInteractionPrompts(
  active: HumanPlayer | CatPlayer,
  mobGrid: SpatialGrid<Mob>,
): boolean {
  return !hostileWithinAttackRange(active, mobGrid);
}
