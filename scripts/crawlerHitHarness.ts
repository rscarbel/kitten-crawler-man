/**
 * A crawler's hit for a harness to land, sized through the same resolver every
 * hit in play passes. Untagged and grown by no stat, so it lands for exactly
 * the figure given, whatever the crawler has trained.
 */

import {
  resolveCrawlerHit,
  type CrawlerDealer,
  type ResolvedHit,
} from '../src/core/combat/outgoingHit';
import { UNTAGGED_HIT } from '../src/core/combat/damageTags';
import type { PlayerDamageType } from '../src/creatures/Mob';

/** `dealer`'s blow of exactly `amount`, struck with `damageType` by her own body. */
export function harnessHit(
  dealer: CrawlerDealer,
  amount: number,
  damageType: PlayerDamageType | null = 'melee',
): ResolvedHit {
  return resolveCrawlerHit({
    dealer,
    delivery: 'unscaled',
    blow: amount,
    tags: UNTAGGED_HIT,
    training: 'trainsNothing',
    damageType,
    struckBy: 'dealer',
  });
}
