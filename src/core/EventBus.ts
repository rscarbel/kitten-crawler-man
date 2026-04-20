/**
 * Lightweight typed event bus for decoupled system communication.
 *
 * Systems subscribe to events they care about and emit events when
 * noteworthy things happen, removing the need for the orchestrator
 * (DungeonScene) to manually wire every cross-system interaction.
 *
 * Usage:
 *   const bus = new EventBus();
 *   bus.on('mobKilled', (e) => loot.spawnLoot(e.mob));
 *   bus.emit('mobKilled', { mob, killer, killType });
 */

import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';

// ── Event definitions ──────────────────────────────────────────────
// Add new event types here as the game grows.

export interface GameEvents {
  /** A mob was just killed. */
  mobKilled: {
    mob: Mob;
    killer: HumanPlayer | CatPlayer | null;
    killType: 'melee' | 'missile' | null;
    topDamageDealer: HumanPlayer | CatPlayer | null;
  };

  /** A player entered a safe room for the first time. */
  safeRoomEntered: {};

  /** A boss room was locked (player entered). */
  bossRoomLocked: { bossType: string };

  /** A boss was defeated. */
  bossDefeated: { bossType: string; mob: Mob };

  /** A player leveled up. */
  playerLevelUp: { player: Player; newLevel: number };

  /** Gore should be spawned at a position. */
  spawnGore: { x: number; y: number };

  /** A loot drop should be created. */
  lootDrop: {
    x: number;
    y: number;
    items: unknown;
    recipient: Player;
    isBossLoot: boolean;
  };

  /** An achievement was unlocked. */
  achievementUnlocked: {
    achievementId: string;
    player: 'Human' | 'Cat';
  };

  /** A quest was completed. */
  questCompleted: { questId: string };

  /** A quest was failed. */
  questFailed: { questId: string };

  /** A player first attacks a mob after being out of combat. */
  combatStarted: { attacker: 'Human' | 'Cat'; mobType: string };

  /** Players entered a boss room and the fight has begun. */
  bossFightInitiated: { bossType: string };

  /** A player drank a healing potion. */
  healingPotionUsed: { player: 'Human' | 'Cat'; hpRestored: number };

  /** A player threw goblin dynamite. */
  dynamiteUsed: { player: 'Human' | 'Cat' };

  /** A player's HP dropped below 25 % of max. */
  healthLow: { player: 'Human' | 'Cat'; hp: number; maxHp: number };

  /** Players stepped onto a stairwell for the first time (menu just opened). */
  stairwellFound: {};
}

// ── Implementation ─────────────────────────────────────────────────

type EventCallback<T> = (data: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventCallback<unknown>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof GameEvents>(event: K, callback: EventCallback<GameEvents[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(callback as EventCallback<unknown>);

    return () => {
      set.delete(callback as EventCallback<unknown>);
    };
  }

  /** Emit an event, notifying all subscribers synchronously. */
  emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      cb(data);
    }
  }

  /** Remove all listeners (call on scene teardown). */
  clear(): void {
    this.listeners.clear();
  }
}
