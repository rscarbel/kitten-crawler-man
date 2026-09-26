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

import type { Mob, PlayerDamageType } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import type { GrantedReward } from './GrantedReward';
import type { DishId } from '../systems/bopcaDialog';
import type { RecallMode } from '../systems/RecallSystem';
import type { SkillId, CrawlerKind } from './SkillManager';
import type { CraftSkillId } from './CraftSkills';
import type { StructureKind } from './structureKinds';
import type { PalisadeTier } from '../map/tileTypes';
import type { ResourceId } from './resourceIds';
import type { HarvestKind } from './craftPerks';
import type { VillageQuestPhase } from './villageQuestPhase';
import type { ToolKind, ToolTier } from './toolTiers';
import type { ProcessingStationKind } from '../systems/briarHollow/processingStations';

/**
 * Who decides what plays when a boss fight starts or ends.
 *
 * `shared` is the ordinary case: the audio wiring picks the track from the boss
 * type. `caller` says the emitter has already chosen — the interior encounters
 * each have a track of their own (the circus battle, the town playlist after
 * Quill) that no boss-type table could name — so the audio wiring plays the
 * sting and leaves the music alone.
 */
export type BossMusicOwnership = 'shared' | 'caller';

export interface GameEvents {
  mobKilled: {
    mob: Mob;
    killer: HumanPlayer | CatPlayer | null;
    killType: PlayerDamageType | null;
    topDamageDealer: HumanPlayer | CatPlayer | null;
  };

  /**
   * One area-of-effect resolution emptied several enemies' health at once.
   * Counted at the damage site, because by the time `mobKilled` fires the kills
   * have already been split into one event each. Allies and livestock caught in
   * it are not counted.
   */
  multiKill: { killer: HumanPlayer; count: number };

  /**
   * One dynamite blast (a single stick or a whole chain) killed enemies.
   * `bossKilled` is set when one of them was a boss and this blast landed the
   * killing blow. Allies caught in the blast are not counted.
   */
  dynamiteKills: { killer: HumanPlayer; kills: number; bossKilled: boolean };

  /** A player entered a safe room (fires on each entry). */
  safeRoomEntered: Record<string, never>;

  /** Every hostile that counts toward the room-clear rule is gone from this room. */
  roomCleared: { roomIndex: number };

  /** A boss room was locked (player entered). */
  bossRoomLocked: { bossType: string };

  bossDefeated: { bossType: string; mob: Mob; music?: BossMusicOwnership };

  playerLevelUp: { player: Player; newLevel: number };

  spawnGore: { x: number; y: number; impactDx: number; impactDy: number };

  lootDrop: {
    x: number;
    y: number;
    items: unknown;
    recipient: Player;
    isBossLoot: boolean;
  };

  achievementUnlocked: {
    achievementId: string;
    player: 'Human' | 'Cat';
  };

  questStarted: { questId: string };

  questCompleted: { questId: string; difficulty?: 'easy' | 'medium' | 'hard' };

  questFailed: { questId: string };

  /** A player first attacks a mob after being out of combat. */
  combatStarted: { attacker: 'Human' | 'Cat'; mobType: string };

  /** Players entered a boss room and the fight has begun. */
  bossFightInitiated: { bossType: string; music?: BossMusicOwnership };

  healingPotionUsed: { player: 'Human' | 'Cat'; hpRestored: number };

  /**
   * A crawler reached for Hollow Stew while the potion cooldown it shares was
   * still running, so nothing was eaten. For a cook to explain why.
   */
  stewRefusedOnCooldown: { eater: Player };

  dynamiteUsed: { player: 'Human' | 'Cat' };

  /** A player's HP dropped below 25 % of max. */
  healthLow: { player: 'Human' | 'Cat'; hp: number; maxHp: number };

  /**
   * A crawler dropped to 0 HP and went down. The single source of truth for a
   * knockout, fired once per knockout regardless of which scene or fight
   * system drove it there.
   */
  crawlerKnockedOut: { player: Player };

  /**
   * A downed crawler is back on their feet from the proximity revive or a
   * boss-room re-entry. Fired once per revive. Paid services that call
   * `Player.reviveToFull` (temple, inn room, infirmary) do not fire it, since
   * they run from menu callbacks with no bus in reach.
   */
  crawlerRevived: { player: Player };

  /** Players stepped onto a stairwell for the first time (menu just opened). */
  stairwellFound: Record<string, never>;

  /** Active player has been standing still and doing nothing for another 5-second interval. */
  playerIdle: { totalIdleMs: number };

  /** Human melee attack's swing-animation peak. */
  humanMeleeSwing: { hit: boolean };

  /** Cat claw-swipe attack's animation peak. */
  catMeleeSwing: { hit: boolean };

  missileImpact: Record<string, never>;

  slingshotImpact: Record<string, never>;

  /** Player descended to the next floor via a stairwell. */
  levelComplete: Record<string, never>;

  /**
   * A game-progress save was written — a checkpoint, a safe room, or a floor
   * transition. Never fired for a settings-only write (volume, keybindings),
   * which has no checkpoint and isn't something a death or reload returns to.
   */
  gameSaved: Record<string, never>;

  /** A mission objective was completed (e.g. goblin child returned to mother). */
  objectiveComplete: { objectiveId: string };

  /**
   * The Wayfinder's Anchor completed a warp. `mode` says which way it pulled —
   * `recall` to the town square, `return` back out to the trail anchor — and the
   * tile is where the party was set down.
   */
  fastTravelUsed: { mode: RecallMode; tileX: number; tileY: number };

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

  /** A crawler was taught a craft skill for the first time, at level 1. */
  craftSkillLearned: { crawler: CrawlerKind; id: CraftSkillId };

  /** A crawler's craft skill advanced a level, through XP earned from its own actions. */
  craftSkillLevelUp: { crawler: CrawlerKind; id: CraftSkillId; level: number };

  /** A crawler (or their thrall) pulled a raw resource out of a deposit. */
  resourceHarvested: {
    id: ResourceId;
    amount: number;
    byThrall: boolean;
    x: number;
    y: number;
  };

  /** A tree was felled or a rock crumbled by harvesting, at tile (`x`, `y`). */
  resourceNodeDepleted: { kind: HarvestKind; x: number; y: number };

  /** A structure finished construction. `tier` is set for palisade segments. */
  structureBuilt: { kind: StructureKind; tier?: PalisadeTier };

  /** A damaged structure was repaired back to full health. */
  structureRepaired: { kind: StructureKind };

  /** A structure took damage but survived. */
  structureDamaged: { kind: StructureKind; x: number; y: number };

  /** A structure's health reached zero. `permanent` is set when it cannot be rebuilt. */
  structureDestroyed: { kind: StructureKind; permanent: boolean };

  /** A crawler petted a village cow at world pixel (`x`, `y`). */
  cowPetted: { x: number; y: number };

  /** A village cow died. */
  cowKilled: { x: number; y: number };

  /**
   * An explosion went off at world pixel (`x`, `y`) with a blast radius of
   * `radiusPx` — heard by anything that reacts to a bang rather than to being
   * hit, like livestock bolting.
   */
  blastLanded: { x: number; y: number; radiusPx: number };

  /** The Briar Hollow defense quest moved to a new phase. */
  villageQuestPhaseChanged: { phase: VillageQuestPhase };

  /** A wave of the village assault began. `index` counts from 0. */
  villageAssaultWave: { index: number };

  /** Oren handed the party its starter axe and pickaxe and taught both crawlers Resourcing. */
  toolsGranted: Record<string, never>;

  /** The party's axe or pickaxe went up a tier at the forge, in both crawlers' packs at once. */
  toolUpgraded: { kind: ToolKind; tier: ToolTier };

  /**
   * Wood was turned into boards or rope: by hand at one of the sawmill's
   * machines (`manual`), or in a batch Fenna was paid for (`fenna`). `count`
   * is what came out, `woodSpent` what went in.
   */
  woodProcessed: {
    output: ProcessingStationKind;
    count: number;
    woodSpent: number;
    via: 'manual' | 'fenna';
  };
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
