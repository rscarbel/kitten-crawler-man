import type { GameSystem, SystemContext } from './GameSystem';
import type { Player } from '../Player';
import type { EventBus } from '../core/EventBus';
import type { SkillEvent, SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { SystemAnnouncer } from '../ui/SystemAnnouncer';

/**
 * First-unlock copy, in the System's dry faux-corporate register. One line per
 * skill so discovering something reads as an event rather than a status change.
 */
const UNLOCK_LINES: Record<SkillId, string> = {
  cockroach:
    'New skill unlocked: Cockroach. Statistically, you will need it. Statistically, it will not be enough.',
  cat_reflexes:
    'New skill unlocked: Cat-like Reflexes. The System notes this was already true and has decided to charge you for it anyway.',
  pugilism:
    'New skill unlocked: Pugilism. Hitting things, but with documentation. Sponsors love documentation.',
  iron_stomach:
    'New skill unlocked: Iron Stomach. Your digestive tract has been reclassified as a hazardous materials container.',
  night_vision:
    'New skill unlocked: Night Vision. You may now see exactly what is about to happen to you.',
};

const COCKROACH_RECHARGED_LINE =
  'Cockroach is back online. Please continue almost dying at your earliest convenience.';

/**
 * Drains everything a `Player` queues for the scene to voice or broadcast: skill
 * events, migration notices, and dodges.
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
    private readonly announcer: SystemAnnouncer,
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
      this.announcer.announce(COCKROACH_RECHARGED_LINE);
    }
    this.cockroachWasRecharging = !ready;
  }

  private drain(player: Player, who: 'Human' | 'Cat'): void {
    const notices = player.pendingSystemNotices;
    for (const line of notices) this.announcer.announce(line);
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
        this.announcer.announce(UNLOCK_LINES[event.id]);
        return;
      case 'leveled':
        this.bus.emit('skillLevelUp', { player: who, skillId: event.id, newLevel: event.level });
        this.announcer.announce(
          `${def.name} is now level ${event.level}. ${def.describeEffect(event.level)} The System is contractually obliged to sound impressed.`,
        );
        return;
      case 'triggered':
        this.bus.emit('skillTriggered', { player: who, skillId: event.id });
        this.announcer.announce(TRIGGER_LINES[event.id]);
        return;
      default: {
        const unhandled: never = event.kind;
        return unhandled;
      }
    }
  }
}

/** Copy for a skill firing in the moment. Only skills with a dramatic proc need one. */
const TRIGGER_LINES: Record<SkillId, string> = {
  cockroach:
    'Fatal damage detected. Cockroach engaged. Your subscriber numbers just spiked. Congratulations on the near-death experience.',
  cat_reflexes: 'Cat-like Reflexes engaged.',
  pugilism: 'Pugilism engaged.',
  iron_stomach: 'Iron Stomach engaged.',
  night_vision: 'Night Vision engaged.',
};
