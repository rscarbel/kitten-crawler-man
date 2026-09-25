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
