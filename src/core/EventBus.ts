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
import type { GrantedReward } from './GrantedReward';
import type { DishId } from '../systems/bopcaDialog';
import type { SkillId } from './SkillManager';

export interface GameEvents {
  /** A mob was just killed. */
  mobKilled: {
    mob: Mob;
    killer: HumanPlayer | CatPlayer | null;
    killType: 'melee' | 'missile' | 'shell' | 'smush' | null;
    topDamageDealer: HumanPlayer | CatPlayer | null;
  };

  /** A player entered a safe room (fires on each entry). */
  safeRoomEntered: Record<string, never>;

  /** A boss room was locked (player entered). */
  bossRoomLocked: { bossType: string };

  /** A boss was defeated. */
  bossDefeated: { bossType: string; mob: Mob };

  /** A player leveled up. */
  playerLevelUp: { player: Player; newLevel: number };

  /** Gore should be spawned at a position. */
  spawnGore: { x: number; y: number; impactDx: number; impactDy: number };

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

  /** A quest was started. */
  questStarted: { questId: string };

  /** A quest was completed. */
  questCompleted: { questId: string; difficulty?: 'easy' | 'medium' | 'hard' };

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
  stairwellFound: Record<string, never>;

  /** Active player has been standing still and doing nothing for another 5-second interval. */
  playerIdle: { totalIdleMs: number };

  /** Human melee attack peak fired (swing animation peak). */
  humanMeleeSwing: { hit: boolean };

  /** Cat melee attack peak fired (claw swipe peak). */
  catMeleeSwing: { hit: boolean };

  /** A magic missile struck a mob. */
  missileImpact: Record<string, never>;

  /** Player descended to the next floor via a stairwell. */
  levelComplete: Record<string, never>;

  /** A mission objective was completed (e.g. goblin child returned to mother). */
  objectiveComplete: { objectiveId: string };

  /** An award screen was dismissed and contains ability or special unlocks to announce. */
  rewardGranted: { rewards: GrantedReward[] };

  /** A safe-room Bopca was spoken to. `tone` is which character it is addressing. */
  bopcaGreeted: { tone: 'toHuman' | 'toCat' };

  /**
   * A crawler asked a Bopca for food; the cook timer has just started.
   *
   * No sound is wired to this one: the cook sizzle is a loop, so `BopcaSystem`
   * drives it from its own state rather than from a start event that has no
   * matching guarantee of a stop.
   */
  bopcaOrderPlaced: { tone: 'toHuman' | 'toCat' };

  /** A Bopca finished cooking and set a dish down on its counter. */
  bopcaServedFood: { dishId: DishId };

  /** A crawler took a dish off a Bopca's counter and ate it. */
  bopcaFoodEaten: { dishId: DishId; healed: number };

  /** A crawler's dexterity turned a mob attack into a clean miss. */
  playerDodged: { player: 'Human' | 'Cat' };

  /** A crawler discovered a skill for the first time. */
  skillUnlocked: { player: 'Human' | 'Cat'; skillId: SkillId };

  /** A known skill advanced a level, through use or a duplicate skill book. */
  skillLevelUp: { player: 'Human' | 'Cat'; skillId: SkillId; newLevel: number };

  /** A skill fired in the moment (e.g. Cockroach catching a fatal blow). */
  skillTriggered: { player: 'Human' | 'Cat'; skillId: SkillId };
}

type EventCallback<T> = (data: T) => void;

export class EventBus {
  // Type erasure is unavoidable for a heterogeneous event map — callbacks are
  // stored as unknown and narrowed by the generic API surface.
  private readonly listeners = new Map<string, Set<EventCallback<unknown>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof GameEvents>(event: K, callback: EventCallback<GameEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    set.add(callback as EventCallback<unknown>);
    return () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      this.listeners.get(event)?.delete(callback as EventCallback<unknown>);
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
