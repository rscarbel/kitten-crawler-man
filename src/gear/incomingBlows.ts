/**
 * What a crawler's gear does to an enemy's blow before it lands: ink in the
 * striker's eyes spoils it, a relic's ward swallows a shot, and a shield on
 * the arm turns one loosed from in front.
 *
 * Asked by every single-target blow and shot a hostile lands on a crawler:
 * `Mob.deliverBlow` for blows a mob lands through it, the bosses' own landed
 * blows (a gauntlet punch, a boulder, a trample) before they land, and every
 * projectile system's direct hit — arrows, bolts, missiles, fireballs, acid
 * globs, thrown rocks, the Trash Gremlin's vomit. Area harm — bursts, flames,
 * gas, a stench, a pulse band, standing ground — is neither a blow nor a shot,
 * and passes both untouched.
 */

import { INK_STATUS } from '../core/combat/StatusEffect';
import type { Player } from '../Player';
import { runRangedWardHooks } from './gearHooks';

/** The share of an inked enemy's blows at a crawler that miss. */
const INK_MISS_SHARE = 0.35;
/** Shown over the crawler an inked blow missed. */
const INK_MISS_TEXT = 'MISS!';

/**
 * Whether ink in `striker`'s eyes spoils its blow at `target`, which then
 * misses outright. Only the party's gear lays ink, so only a crawler is spared.
 */
export function inkSpoilsBlow(striker: Player | null, target: Player): boolean {
  if (striker === null || !target.isCrawler || !striker.hasStatus(INK_STATUS)) return false;
  if (Math.random() >= INK_MISS_SHARE) return false;
  target.queueFloatingText(INK_MISS_TEXT, 'miss');
  return true;
}

/**
 * Whether a hostile projectile about to strike `target` is stopped before it
 * lands: swallowed by her ward, turned by a shield facing the way it flies in
 * from, or loosed blind by an inked `shooter`. Ask it once, on the frame the
 * shot reaches her, and treat true as a miss — no damage and no rider in
 * behind it. `velocityX`/`velocityY` are the shot's own travel; only their
 * direction is read.
 */
export function crawlerTurnsShot(
  target: Player,
  shooter: Player | null,
  velocityX: number,
  velocityY: number,
): boolean {
  if (!target.isCrawler) return false;
  if (runRangedWardHooks(target, { kind: 'flight', velocityX, velocityY })) return true;
  return inkSpoilsBlow(shooter, target);
}

/**
 * {@link crawlerTurnsShot} for a ranged blow a mob lands with no projectile of
 * its own — a reach, a spit, an area swipe — which comes in from where the
 * striker stands.
 */
export function crawlerTurnsRangedBlow(target: Player, striker: Player): boolean {
  if (!target.isCrawler) return false;
  const from = { x: striker.x, y: striker.y };
  if (runRangedWardHooks(target, { kind: 'striker', from })) return true;
  return inkSpoilsBlow(striker, target);
}
