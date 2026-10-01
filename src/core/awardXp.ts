import type { Player } from '../Player';
import type { EventBus } from './EventBus';

/**
 * Awards XP and announces any level it buys. Returns the XP actually placed on
 * the bar, which a reward screen should display instead of the raw award —
 * {@link Player.xpCurve}'s diminishing multiplier can make the two differ.
 *
 * Every XP award goes through here rather than calling `gainXp` directly, so a
 * level-up always reaches the sound, the achievement log and the AI bridge —
 * all of which listen for `playerLevelUp` and cannot see a level gained any
 * other way.
 */
export function awardXp(player: Player, amount: number, bus: EventBus): number {
  const { leveledUp, xpApplied } = player.gainXp(amount);
  if (leveledUp) bus.emit('playerLevelUp', { player, newLevel: player.level });
  return xpApplied;
}

/** The two crawlers by role, for anything paid to the whole party. */
export interface CrawlerPair {
  readonly human: Player;
  readonly cat: Player;
}

/** What one party-wide award placed on each crawler's bar. */
export type PartyXpApplied = Readonly<Record<keyof CrawlerPair, number>>;

/**
 * Awards the full `amount` to each crawler, not a split: a quest is finished
 * by the party, and either crawler may be the one the player is driving when
 * it ends. Each crawler's applied figure can differ, since each has its own
 * level on {@link Player.xpCurve}.
 */
export function awardPartyXp(
  human: Player,
  cat: Player,
  amount: number,
  bus: EventBus,
): PartyXpApplied {
  return {
    human: awardXp(human, amount, bus),
    cat: awardXp(cat, amount, bus),
  };
}
