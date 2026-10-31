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
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { CatPlayer } from '../creatures/CatPlayer';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { InteractionStance } from '../ui/interactionFocus';
import { CAT_ATTACK_RANGE_TILES, HUMAN_ATTACK_RANGE_TILES } from './GameLoopPhases';
import { partyIsEngaged } from './StoryDelivery';

const TILE_CENTRE_FRACTION = 0.5;

/**
 * How near, in tiles from the steering crawler, a hostile that knows the
 * party is there makes enemies "near": close enough that it reaches the
 * party within a couple of seconds, so a conversation opened then would be
 * interrupted by the fight it ignored.
 */
export const ENEMIES_NEAR_RADIUS_TILES = 6;

/**
 * Whether a living hostile stands within `radiusPx` of the centre of
 * `player`'s tile. Allies (a hireling, Deinonychus) never count:
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
    if (mob.isHostileTarget) return true;
  }
  return false;
}

/**
 * Whether a hostile that has noticed one of `party` (chasing them, or alerted
 * by a blow or a packmate's shout) stands within
 * {@link ENEMIES_NEAR_RADIUS_TILES} of `active`. A hostile still unaware of
 * the party, or one that cannot see a hidden crawler, does not count.
 */
export function enemiesNear(
  active: HumanPlayer | CatPlayer,
  party: readonly Player[],
  mobGrid: SpatialGrid<Mob>,
): boolean {
  const px = active.x + TILE_SIZE * TILE_CENTRE_FRACTION;
  const py = active.y + TILE_SIZE * TILE_CENTRE_FRACTION;
  for (const mob of mobGrid.queryCircle(px, py, TILE_SIZE * ENEMIES_NEAR_RADIUS_TILES)) {
    if (!mob.isHostileTarget) continue;
    if (party.some((crawler) => mob.hasNoticed(crawler))) return true;
  }
  return false;
}

/**
 * Whether the party is in danger around `at` (world pixels): something is
 * already fighting a crawler, or a hostile within `radiusPx` of `at` has
 * picked a target and is on the hunt. A moment that holds the party still
 * waits until this is false. A boss still waiting for its fight is passed
 * over, as everywhere else, or its room's seal would never open.
 */
export function partyIsInDanger(
  mobs: ReadonlyArray<Mob>,
  mobGrid: SpatialGrid<Mob>,
  party: ReadonlyArray<Player>,
  at: { readonly x: number; readonly y: number },
  radiusPx: number,
): boolean {
  if (partyIsEngaged(mobs, party)) return true;
  for (const mob of mobGrid.queryCircle(at.x, at.y, radiusPx)) {
    if (mob.isHostileTarget && mob.currentTarget !== null) return true;
  }
  return false;
}

/**
 * The one answer, for prompts and presses alike, to how the fight around
 * `active` bears on an interact press: see {@link InteractionStance}.
 */
export function interactionStance(
  active: HumanPlayer | CatPlayer,
  party: readonly Player[],
  mobGrid: SpatialGrid<Mob>,
): InteractionStance {
  if (hostileWithinAttackRange(active, mobGrid)) return 'fighting';
  if (enemiesNear(active, party, mobGrid)) return 'enemiesNear';
  return 'clear';
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
