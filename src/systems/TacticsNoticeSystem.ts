import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import { TACTICS_TRAITS, type TacticsTrait } from '../creatures/tactics/tacticsTraits';

/**
 * One line per trait, fired the first time the party meets it. Written in the
 * System's own voice — dry, bureaucratic, unbothered by what it's describing.
 * Kept short: these ride the non-wrapping hotbar toast, which clips rather
 * than wraps a line that runs past a phone-width canvas.
 */
const TACTICS_NOTICE_LINES: Record<TacticsTrait, string> = {
  flank: 'Hostiles flank now. No safe side left.',
  block: 'Hostiles guard hits now. Free shots are over.',
  kite: "Hostiles retreat toward friends. It's bait.",
  regroup: 'Wounded hostiles regroup on a fighting ally.',
  riposte: 'Hostiles that block now hit back faster.',
};

/**
 * Announces each tactics trait the first time a mob carrying it draws blood
 * with the party — either direction — so smarter AI reads as a deliberate
 * escalation instead of randomness.
 *
 * Triggers off {@link Mob.hasStruckPlayer} / {@link Mob.wasDamagedByParty},
 * not `currentTarget`: a pack shout sets `currentTarget` on every packmate in
 * range, sight unseen, so a mob alerted but never actually fought would fire
 * a notice about a fight that hasn't happened yet. Blood is a fact.
 *
 * Trait-agnostic and behaviour-agnostic — it fires off the trait being
 * present at the moment blood is drawn, not off any one behaviour's own move
 * landing, so it keeps working correctly however flank/kite/regroup/riposte's
 * behaviour code changes.
 *
 * `seenTraits` is the caller's own set, not rewound on a checkpoint death —
 * see `DungeonScene.tacticsNoticesSeen` — so a heard notice stays heard for
 * the rest of the run, while a page reload can't repeat one either.
 */
export class TacticsNoticeSystem implements GameSystem {
  constructor(private readonly seenTraits: Set<TacticsTrait>) {}

  private get isComplete(): boolean {
    return this.seenTraits.size >= TACTICS_TRAITS.length;
  }

  update(ctx: SystemContext): void {
    this.scan(ctx.roster.mobs, ctx.human);
  }

  /**
   * The scan itself, apart from {@link update}, so a scene without a full
   * `SystemContext` — a building interior drains its roster and players
   * directly — can still share this one implementation.
   */
  scan(mobs: readonly Mob[], human: Player): void {
    if (this.isComplete) return;
    for (const mob of mobs) {
      if (!mob.isAlive || mob.isBoss || !mob.hasActiveTactics) continue;
      if (!mob.hasStruckPlayer && !mob.wasDamagedByParty) continue;
      for (const trait of mob.activeTacticsTraits) {
        if (this.seenTraits.has(trait)) continue;
        // Only latched on success: a queue that's full this frame gets a free
        // retry next frame instead of losing the notice for the rest of the run.
        if (human.queueSystemNotice(TACTICS_NOTICE_LINES[trait])) this.seenTraits.add(trait);
      }
    }
  }
}
