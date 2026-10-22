/**
 * The bounty marks the necromancer drives against Briar Hollow, one per
 * assault wave: the same creatures Shady posts bounties on, with their own
 * fights intact, fielded weaker than a real bounty by the siege's tuning.
 */

import type { GameMap } from '../../map/GameMap';
import type { Mob } from '../../creatures/Mob';
import { spawnMob, type SpawnContext } from '../../levels/spawnFunnel';
import type { SpawnTile } from '../../levels/mobKinds';
import { prewarmMantidApproach } from '../../sprites/mantidSprite';
import { prewarmSkeletonLordSprite } from '../../sprites/skeletonSprite';
import { prewarmRockGolemApproach } from '../../sprites/rockGolemSprite';

/** Every bounty mark a siege wave can bring, by the bounty's own id. */
export type AssaultBountyKind =
  'evil_clown' | 'mantid' | 'skeleton_lord' | 'dark_knight' | 'rock_golem';

export const ASSAULT_BOUNTY_KINDS: readonly AssaultBountyKind[] = [
  'evil_clown',
  'mantid',
  'skeleton_lord',
  'dark_knight',
  'rock_golem',
];

/**
 * Builds one bounty mark on `tile`, on `map`, with its biggest rows warmed —
 * unlevelled and unscaled: the siege owns both.
 */
export function createBountyMark(
  kind: AssaultBountyKind,
  tile: SpawnTile,
  map: GameMap,
  context: SpawnContext,
): Mob {
  switch (kind) {
    case 'evil_clown':
      return spawnMob('evil_clown', tile, map, context);
    case 'mantid':
      prewarmMantidApproach('mantid');
      return spawnMob('mantid', tile, map, context);
    case 'skeleton_lord':
      prewarmSkeletonLordSprite();
      return spawnMob('skeleton_lord', tile, map, context);
    case 'dark_knight':
      return spawnMob('dark_knight', tile, map, context);
    case 'rock_golem':
      prewarmRockGolemApproach('rock_golem_boss');
      return spawnMob('rock_golem_boss', tile, map, context);
  }
}
