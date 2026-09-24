import type { Player } from '../Player';
import type { SystemContext } from './GameSystem';

/**
 * Everyone a fairy's area effect lands on: both crawlers, plus the scene's
 * extra player-side bodies (Mongo, hired mercenaries). Filled into `out`, which
 * is emptied first.
 *
 * Defend-quest NPCs are left out. They are escorted rather than hunted —
 * `MobUpdateLoop` strips them from the AI's target list for the same reason —
 * and a stray blast that killed the Goblin Mother would fail a quest the player
 * was winning.
 */
export function collectFairyPartyTargets(ctx: SystemContext, out: Player[]): void {
  out.length = 0;
  out.push(ctx.human, ctx.cat);
  for (const extra of ctx.extraTargets ?? []) {
    if (extra.isDefendTarget === true) continue;
    if (!out.includes(extra)) out.push(extra);
  }
}
