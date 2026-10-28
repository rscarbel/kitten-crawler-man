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

import type { SafeRoomId } from '../map/safeRoomId';
import type { Mob, PlayerDamageType } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import type { GrantedReward } from './items/loot/GrantedReward';
import type { QuestRewardSpec } from '../ui/questReward/types';
import type { DishId } from '../systems/bopcaDialog';
import type { TravelDestinationId } from '../systems/travel/travelDestinations';
import type { SkillId, CrawlerKind } from './skills/SkillManager';
import type { SpeakerRef } from '../dialog/speakers';
import type { CraftSkillId } from './labour/CraftSkills';
import type { StructureKind } from './world/structureKinds';
import type { PalisadeTier } from '../map/tileTypes';
import type { ResourceId } from './items/gathering/resourceIds';
import type { HarvestKind } from './labour/craftPerks';
import type { VillageQuestPhase } from './quests/villageQuestPhase';
import type { BlueprintsQuestPhase } from './quests/blueprintsQuestPhase';
import type { ItemId } from './items/defs/ItemDefs';
import type { EquipmentChange } from './items/equipment/EquipmentManager';
import type { ToolKind, ToolTier } from './items/gathering/toolTiers';
import type { ProcessingStationKind } from '../systems/briarHollow/processingStations';
import type { Rarity } from './items/defs/rarity';
import type { ChallengeSummary } from '../ai/interactions/challenges';
import type { ExplosionVariant } from '../sprites/dynamiteExplosion';

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
  multiKill: { killer: HumanPlayer | CatPlayer; count: number };

  /**
   * One dynamite blast (a single stick or a whole chain) killed enemies.
   * `bossKilled` is set when one of them was a boss and this blast landed the
   * killing blow. Allies caught in the blast are not counted.
   */
  dynamiteKills: { killer: HumanPlayer | CatPlayer; kills: number; bossKilled: boolean };

  /** A player entered a safe room (fires on each entry). */
  safeRoomEntered: { room: SafeRoomId };

  /** Every hostile that counts toward the room-clear rule is gone from this room. */
  roomCleared: { roomIndex: number };

  /** A boss room was locked (player entered). */
  bossRoomLocked: { bossType: string };

  bossDefeated: { bossType: string; mob: Mob };

  playerLevelUp: { player: Player; newLevel: number };

  spawnGore: { x: number; y: number; impactDx: number; impactDy: number };

  /**
   * A crawler brought up a bout of blood: the splatter lands at `x`/`y` (world
   * pixels), thrown along `dirX`/`dirY`.
   */
  bloodVomitRetch: { player: Player; x: number; y: number; dirX: number; dirY: number };

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

  /** The player gave up a quest under way, as Wendell's "drop this contract" does. */
  questAbandoned: { questId: string };

  /**
   * A quest item was pushed out of a crawler's quest slot by a different one
   * (`Inventory.replaceQuestSlot`) and is no longer held. The quest that owns
   * `itemId` listens, and puts the item back somewhere the player can fetch
   * it from if losing it would otherwise strand the quest.
   */
  questItemEvicted: { itemId: ItemId; crawler: CrawlerKind };

  /** A player first attacks a mob after being out of combat. */
  combatStarted: { attacker: 'Human' | 'Cat'; mobType: string };

  /** Players entered a boss room and the fight has begun. */
  bossFightInitiated: { bossType: string };

  healingPotionUsed: { player: 'Human' | 'Cat'; hpRestored: number };

  /**
   * A crawler reached for Hollow Stew while the potion cooldown it shares was
   * still running, so nothing was eaten. For a cook to explain why.
   */
  stewRefusedOnCooldown: { eater: Player };

  /** A thrown explosive left a crawler's hand; `item` is the one spent. */
  dynamiteUsed: { player: 'Human' | 'Cat'; item: ItemId };

  /** A crawler's HP entered the low-health band (`CRAWLER_HP_THRESHOLDS.low_health`). */
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

  /** The Stormcaller was swung, in place of `humanMeleeSwing`: its wave has left the blade. */
  stormcallerSwing: Record<string, never>;

  /** The sword's blade or its wave cut at least one enemy this frame. */
  stormcallerStrike: Record<string, never>;

  /** At least one enemy the sword cut threw chain lightning this frame. */
  stormcallerChain: Record<string, never>;

  /**
   * A weapon was swung through the generic weapon strike with no proc run to
   * sound it — it has none, or the combat context registers none — in place
   * of `humanMeleeSwing`; `hit` when it met anything.
   */
  weaponSwing: { weaponId: ItemId; hit: boolean };

  /**
   * A crawler's equipped set changed. `restore` replaces the whole set at once
   * (a snapshot, a reset), with no key or item named.
   */
  equipmentChanged: { crawler: CrawlerKind } & EquipmentChange;

  /** Cat claw-swipe attack's animation peak, with the claws she wears, if any. */
  catMeleeSwing: { hit: boolean; clawsId: ItemId | null };

  /** A missile struck something, at this world point. */
  missileImpact: { x: number; y: number };

  /** A slingshot stone struck something, at this world point. */
  slingshotImpact: { x: number; y: number };

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
   * The Wayfinder's Anchor completed a warp to `destination`; the tile is the
   * one it aimed for, which the party was set down on or as near as it could.
   */
  fastTravelUsed: { destination: TravelDestinationId; tileX: number; tileY: number };

  /** An award screen was dismissed and contains ability or special unlocks to announce. */
  rewardGranted: { rewards: GrantedReward[] };

  /**
   * A quest has paid its rewards and asks for its quest-complete screen. The
   * scene queues the spec on its one `QuestRewardScreen`.
   */
  questRewardShown: QuestRewardSpec;

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

  /** A crawler's evasiveness turned a mob attack into a clean miss. */
  playerDodged: { player: 'Human' | 'Cat' };

  /** A crawler discovered a skill for the first time. */
  skillUnlocked: { player: 'Human' | 'Cat'; skillId: SkillId };

  /** A known skill advanced a level, through use or a duplicate skill book. */
  skillLevelUp: { player: 'Human' | 'Cat'; skillId: SkillId; newLevel: number };

  /** A skill fired in the moment (e.g. 9 Lives catching a fatal blow). */
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

  /**
   * A crawler's or a goblin's dynamite or black powder bomb, or a gas bottle
   * set off through `DynamiteSystem`, went off at world pixel (`x`, `y`). Separate from `blastLanded`, which a trebuchet boulder
   * also raises, so a reaction tied to the charge itself — the camera kick —
   * can weigh one kind of charge against the other.
   */
  explosiveDetonated: { x: number; y: number; kind: ExplosionVariant };

  /** The Briar Hollow defense quest moved to a new phase. */
  villageQuestPhaseChanged: { phase: VillageQuestPhase };

  /** "The Borrowed Blueprints", Fenna's side quest, moved to a new phase. */
  blueprintsQuestPhaseChanged: { phase: BlueprintsQuestPhase };

  /** The bell tower, broken by a lost siege, was rebuilt. */
  bellTowerRepaired: Record<string, never>;

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

  /** A shop purchase went through: `item` is the row's label, `coins` what it cost. */
  shopPurchase: { buyer: Player; item: string; coins: number; shop: string };

  /** A crawler sold `quantity` of `item` to a shop for `coins` in total. */
  shopSold: { seller: Player; item: string; quantity: number; coins: number; shop: string };

  /** A status effect the crawler did not have took hold (a refresh of a running one does not count). */
  statusApplied: { player: Player; status: string };

  /** A status effect the crawler had is gone: cured, cleared or worn off. */
  statusCured: { player: Player; status: string };

  /** A reward chest was earned and its contents paid straight to `owner`. */
  rewardChestOpened: {
    owner: Player;
    rarity: Rarity;
    coins: number;
    potions: number;
    items: ItemId[];
  };

  /**
   * The run ended on the death screen. `fallen` is the crawler whose death or
   * bleed-out ended it, or null when the floor's collapse clock ran out on a
   * party still standing; `cause` is the death explanation's key.
   */
  playerDied: { fallen: Player | null; cause: string };

  /** A conversation opened on an empty dialog box (`started`) or the box emptied (`ended`). */
  conversation: { speaker: SpeakerRef; phase: 'started' | 'ended' };

  /** Dave pointed the party at one of the floor's objectives. */
  daveAdviceGiven: { objectiveId: string };

  /** The player took a challenge the AI offered; its clock starts now. */
  challengeAccepted: ChallengeSummary;

  /** The player turned down a challenge the AI offered. */
  challengeDeclined: ChallengeSummary;

  /** An accepted challenge was won; its reward chest went to `rewardedTo`. */
  challengeCompleted: ChallengeSummary & { rewardedTo: 'Human' | 'Cat'; secondsTaken: number };

  /**
   * An accepted challenge was lost: `reason` says how, `taunt` is the AI's
   * line the player was shown (empty when the party simply left the floor).
   */
  challengeFailed: ChallengeSummary & { reason: string; taunt: string };

  /**
   * The player answered a question the AI put to them. `answer` is the
   * label they picked, or null when they waved the question away.
   */
  playerAnswered: {
    questionId: string;
    question: string;
    answer: string | null;
    choices: string[];
    askedBy: string;
  };

  /** The AI wrote and awarded an achievement. */
  aiAchievementAwarded: {
    title: string;
    description: string;
    rarity: Rarity;
    player: 'Human' | 'Cat';
    awardedBy: string;
  };
}

type EventCallback<T> = (data: T) => void;

type ListenerSets = { [K in keyof GameEvents]?: Set<EventCallback<GameEvents[K]>> };

export class EventBus {
  private listeners: ListenerSets = {};

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof GameEvents>(event: K, callback: EventCallback<GameEvents[K]>): () => void {
    const set = this.listeners[event] ?? new Set<EventCallback<GameEvents[K]>>();
    // Narrowing the map to this one key is what lets the compiler see that the
    // set stored under `event` holds callbacks for `event`'s payload.
    const forThisEvent: { [P in K]?: Set<EventCallback<GameEvents[P]>> } = this.listeners;
    forThisEvent[event] = set;
    set.add(callback);
    return () => {
      this.listeners[event]?.delete(callback);
    };
  }

  /** Emit an event, notifying all subscribers synchronously. */
  emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const cb of set) {
      cb(data);
    }
  }

  /** Remove all listeners (call on scene teardown). */
  clear(): void {
    this.listeners = {};
  }
}
