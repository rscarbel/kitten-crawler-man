import type { Player } from '../Player';
import type { EventBus } from './EventBus';

/**
 * Awards XP and announces any level it buys.
 *
 * Every XP award goes through here rather than calling `gainXp` directly, so a
 * level-up always reaches the sound, the achievement log and the AI bridge —
 * all of which listen for `playerLevelUp` and cannot see a level gained any
 * other way.
 */
export function awardXp(player: Player, amount: number, bus: EventBus): void {
  if (player.gainXp(amount)) bus.emit('playerLevelUp', { player, newLevel: player.level });
}
