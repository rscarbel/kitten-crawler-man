import type { EventBus } from '../core/EventBus';
import type { Player } from '../Player';

/**
 * Reports each crawler's status effects starting and ending as
 * `statusApplied` / `statusCured` on the bus.
 *
 * `Player` has no bus and statuses are applied from dozens of places (mob
 * attacks, food, traps, spells, the AI), so the change is found by comparing
 * the set of status types once a frame rather than at each call site. A
 * refreshed status (re-applied while still running) is not a change.
 */
export class StatusChangeWatcher {
  /** Each crawler's status types as of the last change; replaced only when they change. */
  private readonly seen = new Map<Player, string[]>();

  update(human: Player, cat: Player, bus: EventBus): void {
    this.check(human, bus);
    this.check(cat, bus);
  }

  /** Allocates nothing on the frames where nothing changed, which is nearly all of them. */
  private check(player: Player, bus: EventBus): void {
    const effects = player.statusEffects;
    const before = this.seen.get(player);
    if (before !== undefined && sameTypes(effects, before)) return;
    this.seen.set(
      player,
      effects.map((effect) => effect.type),
    );
    if (before === undefined) return;
    effects.forEach((effect, i) => {
      const status = effect.type;
      const firstOfItsType = effects.findIndex((other) => other.type === status) === i;
      if (firstOfItsType && !before.includes(status)) bus.emit('statusApplied', { player, status });
    });
    for (const status of before) {
      if (!effects.some((effect) => effect.type === status))
        bus.emit('statusCured', { player, status });
    }
  }
}

function sameTypes(effects: readonly { type: string }[], types: readonly string[]): boolean {
  if (effects.length !== types.length) return false;
  for (let i = 0; i < effects.length; i++) {
    if (effects[i]?.type !== types[i]) return false;
  }
  return true;
}
