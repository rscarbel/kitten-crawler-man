/**
 * The bounty marks the necromancer drives against Briar Hollow, one per
 * assault wave: the same creatures Shady posts bounties on, with their own
 * fights intact, fielded weaker than a real bounty by the siege's tuning.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import type { Mob } from '../../creatures/Mob';
import { EvilClown } from '../../creatures/EvilClown';
import { Mantid } from '../../creatures/Mantid';
import { SkeletonLord } from '../../creatures/SkeletonLord';
import { DarkKnight } from '../../creatures/DarkKnight';
import { RockGolemBoss } from '../../creatures/RockGolemBoss';
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
 * Builds one bounty mark on the tile, on `map`, with its biggest rows warmed —
 * unlevelled and unscaled: the siege owns both.
 */
export function createBountyMark(
  kind: AssaultBountyKind,
  tileX: number,
  tileY: number,
  map: GameMap,
): Mob {
  const mark = buildMark(kind, tileX, tileY);
  mark.setMap(map);
  return mark;
}

function buildMark(kind: AssaultBountyKind, tileX: number, tileY: number): Mob {
  switch (kind) {
    case 'evil_clown':
      return new EvilClown(tileX, tileY, TILE_SIZE);
    case 'mantid':
      prewarmMantidApproach('mantid');
      return new Mantid(tileX, tileY, TILE_SIZE);
    case 'skeleton_lord':
      prewarmSkeletonLordSprite();
      return new SkeletonLord(tileX, tileY, TILE_SIZE);
    case 'dark_knight':
      return new DarkKnight(tileX, tileY, TILE_SIZE);
    case 'rock_golem':
      prewarmRockGolemApproach('rock_golem_boss');
      return new RockGolemBoss(tileX, tileY, TILE_SIZE);
  }
}
