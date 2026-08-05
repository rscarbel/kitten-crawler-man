import type { GameSystem, SystemContext } from './GameSystem';
import type { Player } from '../Player';
import type { EventBus } from '../core/EventBus';
import type { SkillEvent, SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { HotbarToast } from '../ui/HotbarToast';

/**
 * First-unlock copy. One line per skill, trimmed to the name and the fact that
 * it is new: these ride the hotbar toast, which is read at a glance mid-fight.
 */
const UNLOCK_LINES: Record<SkillId, string> = {
  cockroach: 'Skill unlocked: Cockroach',
  cat_reflexes: 'Skill unlocked: Cat-like Reflexes',
  pugilism: 'Skill unlocked: Pugilism',
  iron_stomach: 'Skill unlocked: Iron Stomach',
  night_vision: 'Skill unlocked: Night Vision',
};

const COCKROACH_RECHARGED_LINE = 'Cockroach ready';

/**
 * Effect blurbs are written as prose sentences for the skills panel, so they end
 * in a period the one-line level-up toast reads better without.
 */
const TRAILING_PERIOD = /\.$/;

/**
 * Drains everything a `Player` queues for the scene to announce or broadcast:
 * skill events, migration notices, and dodges.
 *
 * Players have no event bus in scope — a dodge is decided inside
 * `Player.takeDamage` — so they queue and this converts. It is built
 * unconditionally in both scenes, unlike the combat stack, so nothing it drains
 * can be lost by standing in the wrong kind of room.
 */
export class SystemNoticeSystem implements GameSystem {
  /** Tracks the recharge edge so the ready-toast fires once, not every frame. */
  private cockroachWasRecharging = false;

  constructor(
    private readonly bus: EventBus,
    private readonly toast: HotbarToast,
  ) {}

  update(ctx: SystemContext): void {
    this.drainFor(ctx.human, ctx.cat);
  }

  /**
   * Drain both crawlers directly. Building interiors without an encounter never
   * build a `SystemContext`, but a skill book can still be used in one.
   */
  drainFor(human: Player, cat: Player): void {
    this.drain(human, 'Human');
    this.drain(cat, 'Cat');
    this.announceCockroachRecharge(cat);
  }

  /**
   * A one-shot toast the moment Cockroach comes back online.
   *
   * Polled rather than queued: the recharge is a wall-clock deadline that ripens
   * on its own, with no gameplay event to hang an announcement off.
   */
  private announceCockroachRecharge(cat: Player): void {
    if (!cat.skills.isUnlocked('cockroach')) return;
    const ready = cat.isCockroachReady;
    if (ready && this.cockroachWasRecharging) {
      this.toast.show(COCKROACH_RECHARGED_LINE);
    }
    this.cockroachWasRecharging = !ready;
  }

  private drain(player: Player, who: 'Human' | 'Cat'): void {
    const notices = player.pendingSystemNotices;
    for (const line of notices) this.toast.show(line);
    notices.length = 0;

    for (let i = 0; i < player.pendingDodges; i++) {
      this.bus.emit('playerDodged', { player: who });
    }
    player.pendingDodges = 0;

    const queue = player.skills.pendingEvents;
    if (queue.length === 0) return;
    for (const event of queue) this.handle(event, who);
    queue.length = 0;
  }

  private handle(event: SkillEvent, who: 'Human' | 'Cat'): void {
    const def = getSkillDef(event.id);
    switch (event.kind) {
      case 'unlocked':
        this.bus.emit('skillUnlocked', { player: who, skillId: event.id });
        this.toast.show(UNLOCK_LINES[event.id]);
        return;
      case 'leveled':
        this.bus.emit('skillLevelUp', { player: who, skillId: event.id, newLevel: event.level });
        this.toast.show(
          `${def.name} Lv ${event.level} — ${def.describeEffect(event.level)}`.replace(
            TRAILING_PERIOD,
            '',
          ),
        );
        return;
      case 'triggered':
        this.bus.emit('skillTriggered', { player: who, skillId: event.id });
        this.toast.show(TRIGGER_LINES[event.id]);
        return;
      default: {
        const unhandled: never = event.kind;
        return unhandled;
      }
    }
  }
}

/**
 * Copy for a skill firing in the moment. Only skills with a dramatic proc need
 * one. Kept to a single short line: these ride the hotbar toast, which fires
 * mid-fight and does not wrap.
 */
const TRIGGER_LINES: Record<SkillId, string> = {
  cockroach: 'Cockroach — fatal damage survived',
  cat_reflexes: 'Cat-like Reflexes engaged.',
  pugilism: 'Pugilism engaged.',
  iron_stomach: 'Iron Stomach engaged.',
  night_vision: 'Night Vision engaged.',
};
