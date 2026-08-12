import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { platform } from '../core/Platform';
import { TILE_SIZE } from '../core/constants';
import { clamp, frameTime } from '../utils';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { GameMap } from '../map/GameMap';
import { DEFAULT_DUNGEON_FLOOR_THEME, setDungeonFloorTheme } from '../map/dungeon/floorTheme';
import { type HumanPlayer } from '../creatures/HumanPlayer';
import { type CatPlayer } from '../creatures/CatPlayer';
import { type Mob, type LootDrop } from '../creatures/Mob';
import type { Player } from '../Player';
import { PlayerManager } from '../core/PlayerManager';
import { MobileTouchState } from '../core/MobileTouchState';
import type { LevelDef } from '../levels/types';
import {
  spawnForLevel,
  spawnExtraMobs,
  createMob,
  spawnTreasureRoomMobs,
  partyLevelOf,
  recommendedPartyLevelFor,
} from '../levels/spawner';
import { activeDifficultyProfile, applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import { getSpriteMissCounts, prewarmGroups, releaseSpritesExcept } from '../core/SpriteLoader';
import { requiredSpriteKeysForLevel } from '../core/systemAssetRequirements';
import { getLevelDef } from '../levels';
import { dungeonOptionsForLevel } from '../levels/dungeonOptions';
import { TUTORIAL_LEVEL_ID } from '../levels/tutorial';
import { LevelCompleteScreen } from '../ui/LevelCompleteScreen';
import type { PauseMenu } from '../ui/PauseMenu';
import { SpellSystem } from '../systems/SpellSystem';
import type { InventoryItem } from '../core/ItemDefs';
import { AchievementManager } from '../core/AchievementManager';
import { AchievementUISystem } from '../systems/AchievementUISystem';

import { MiniMapSystem, type QuestMarkerType } from '../systems/MiniMapSystem';
import {
  captureJournalProgress,
  createJournalProgress,
  restoreJournalProgress,
  type JournalProgress,
} from '../core/JournalProgress';
import { TownGuideSystem } from '../systems/TownGuideSystem';
import { drawArrowAbovePlayer, drawBearingArrowAbovePlayer } from '../ui/WorldArrow';
import { drawObjectiveBeacon } from '../ui/ObjectiveBeacon';
import {
  availableTargets,
  collectTrackerEntries,
  isOutstanding,
  resolvePinnedEntry,
  type TrackerEntry,
  type TrackerTarget,
} from '../systems/questTracker';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { resolveSkillBookPrompt } from '../systems/skillBookUse';
import { getSkillDef, type CrawlerKind } from '../core/SkillManager';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { BossRoomSystem, BOSS_META } from '../systems/BossRoomSystem';
import { drawHUD, renderMobileSkillBadge } from '../ui/HUD';
import { LavaBallSystem } from '../systems/LavaBallSystem';
import { RockThrowSystem } from '../systems/RockThrowSystem';
import { SkeletonProjectileSystem } from '../systems/SkeletonProjectileSystem';
import { GoblinArrowSystem } from '../systems/GoblinArrowSystem';
import { SkeletonSummonSystem } from '../systems/SkeletonSummonSystem';
import { ClownGasSystem } from '../systems/ClownGasSystem';
import { KnightMissileSystem } from '../systems/KnightMissileSystem';
import { CombatKit } from '../systems/kits/CombatKit';
import { DestructionKit } from '../systems/kits/DestructionKit';
import { ALL_BREAKABLE_PROPS, NO_BREAKABLE_PROPS } from '../systems/DestructiblePropSystem';
import { MenusKit } from '../systems/kits/MenusKit';
import { ChatKit, type ChatCommand } from '../systems/kits/ChatKit';
import {
  activateHotbarSlot,
  drinkAnyHealthPotion,
  releaseChargedDynamite,
  type HotbarHost,
} from '../systems/kits/hotbarActions';
import { MobRoster, type SceneWorld } from '../systems/kits/SceneWorld';
import {
  advanceFocusedOverlay,
  auditOverlayFocus,
  focusedOverlay,
  keyboardSuppressed,
  worldHalted,
  type OverlayInputClaim,
  type OverlaySpaceHandling,
} from '../systems/kits/OverlayClaims';
import {
  CompanionSystem,
  createCompanionStanceState,
  type CompanionStanceState,
} from '../systems/CompanionSystem';
import { StairwellSystem } from '../systems/StairwellSystem';
import {
  RECALL_COOLDOWN_FRAMES,
  RecallSystem,
  type RecallSceneRebuildState,
} from '../systems/RecallSystem';
import { BuildingSystem, type BuildingEntry } from '../systems/BuildingSystem';
import { TownLifeSystem } from '../systems/TownLifeSystem';
import type { Townsperson } from '../creatures/Townsperson';
import { CONVERSATION_WALK_AWAY_TILES } from '../creatures/townInteraction';
import { TownDecorSystem } from '../systems/TownDecorSystem';
import { TownPropSystem } from '../systems/TownPropSystem';
import { MarketSystem, type MarketBrowse } from '../systems/market/MarketSystem';
import type { TownPropRenderable } from '../systems/townPropRenderable';
import {
  captureMarketStock,
  createMarketStock,
  restoreMarketStock,
  type MarketStock,
} from '../systems/market/MarketStock';
import {
  buildCitizenConversation,
  roleDisplayName,
  type TownDialogContext,
} from '../systems/townDialog';
import { buildTownNotices, type TownNoticeContext } from '../systems/townNotices';
import { CitizenDialog } from '../ui/CitizenDialog';
import { NoticeBoardPanel } from '../ui/NoticeBoardPanel';
import { PricedMenuPanel } from '../ui/PricedMenuPanel';
import { FortuneTellerPanel } from '../ui/FortuneTellerPanel';
import { drawInteractionPrompt, setInteractionPromptsSuppressed } from '../ui/InteractionPrompt';
import { JuicerRoomSystem } from '../systems/JuicerRoomSystem';
import { ArenaRoomSystem } from '../systems/ArenaRoomSystem';
import { BarrierSystem } from '../systems/BarrierSystem';
import { ArenaSystem } from '../systems/ArenaSystem';
import { TreasureChestSystem } from '../systems/TreasureChestSystem';
import { ChestRewardDialog, type ChestLootSplit } from '../ui/ChestRewardDialog';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { Goblin } from '../creatures/Goblin';
import { GoblinArcher } from '../creatures/GoblinArcher';

import {
  snapPlayer,
  restorePlayer,
  revivedSnapshot,
  checkpointSnapshot,
  type PlayerSnapshot,
} from '../core/PlayerSnapshot';
import type { LevelCheckpoint } from '../core/LevelCheckpoint';
import type { WorldCheckpoint } from '../core/WorldCheckpoint';
import { BossIntroSystem } from '../systems/BossIntroSystem';
import { DungeonIntroSystem } from '../systems/DungeonIntroSystem';
import { TreeSystem } from '../systems/TreeSystem';
import { WaterAnimationSystem } from '../systems/WaterAnimationSystem';
import {
  AbilityManager,
  type AbilityId,
  type SerializedAbilityState,
} from '../core/AbilityManager';
import { FollowerMenu } from '../systems/FollowerMenu';
import { MAGIC_MISSILE_DEF } from '../abilities/magicMissile';
import { MONGO_DEF, getMongoStats } from '../abilities/mongo';
import {
  captureMongoPetState,
  createMongoPetState,
  restoreMongoPetState,
  type MongoPetState,
} from '../core/MongoPetState';

import { PROTECTIVE_SHELL_DEF } from '../abilities/protectiveShell';
import { SMUSH_DEF } from '../abilities/smush';
import type { GrantedReward } from '../core/GrantedReward';
import { drawMongoIcon } from '../sprites/mongoSprite';
import { EventBus } from '../core/EventBus';
import { DifficultyTelemetrySystem } from '../systems/DifficultyTelemetrySystem';
import {
  readMovement,
  applyMovement,
  applyKnockbackMotion,
  isStandingInWater,
  type SouthCollisionAnchor,
  checkDeath,
  revealMinimap,
  triggerPlayerAttack,
  HUMAN_ATTACK_RANGE_TILES,
  CAT_ATTACK_RANGE_TILES,
} from '../systems/GameLoopPhases';
import { OverworldMusicSystem } from '../systems/OverworldMusicSystem';
import { AmbientSoundSystem, type AmbientEmitter } from '../systems/AmbientSoundSystem';
import { drunkCameraOffset } from '../core/DrunkEffect';
import {
  BIG_TOP_BUILDING_NAME,
  BIG_TOP_SEALED_MESSAGE,
  captureCircusQuestProgress,
  createCircusQuestProgress,
  isBigTopSealed,
  restoreCircusQuestProgress,
  type CircusQuestProgress,
} from '../core/CircusQuestProgress';
import {
  captureMurderQuestProgress,
  createMurderQuestProgress,
  restoreMurderQuestProgress,
  type MurderQuestProgress,
} from '../core/MurderQuestProgress';
import {
  captureAnchorQuestProgress,
  createAnchorQuestProgress,
  restoreAnchorQuestProgress,
  type AnchorQuestProgress,
} from '../core/AnchorQuestProgress';
import {
  captureBountyProgress,
  createBountyProgress,
  restoreBountyProgress,
  type BountyProgress,
} from '../core/BountyProgress';
import { BountySystem } from '../systems/BountySystem';
import { findBountyDef } from '../systems/bountyDefs';
import { findNearbyWalkableTile, hasRoomToMove } from '../map/findWalkableTile';
import { resolveDeathCause } from '../systems/DeathCauseSystem';
import { pickDeathExplanation } from '../ui/DeathExplanations';
import { BuildingInteriorScene } from './BuildingInteriorScene';
import { MongoSystem, SUMMON_BUTTON_HEIGHT, SUMMON_BUTTON_WIDTH } from '../systems/MongoSystem';
import { DEFEND_QUEST_ID, DefendQuestSystem } from '../systems/DefendQuestSystem';
import { SpiderQuestSystem, SPIDER_QUEST_COMPLETION_XP } from '../systems/SpiderQuestSystem';
import { CircusQuestSystem, CIRCUS_QUEST_ID } from '../systems/CircusQuestSystem';
import { MurderMysteryQuestSystem, MURDER_QUEST_ID } from '../systems/MurderMysteryQuestSystem';
import { AnchorQuestSystem } from '../systems/AnchorQuestSystem';
import {
  propBeaconTarget,
  stallBeaconTarget,
  doorwayBeaconTarget,
} from '../systems/objectiveBeaconTargets';
import { TINKER_VENDOR_ID } from '../systems/market/vendorDefs';
import { createDoomsdayProgress, type DoomsdayProgress } from '../core/DoomsdayProgress';
import {
  captureClubMembership,
  createClubMembership,
  restoreClubMembership,
  type ClubMembership,
} from '../core/ClubMembership';
import {
  captureTownMemory,
  createTownMemory,
  restoreTownMemory,
  type TownMemory,
} from '../core/TownMemory';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type MercenaryRoster,
} from '../core/MercenaryRoster';
import { createGodModeState, type GodModeState } from '../core/GodMode';
import { MercenarySystem } from '../systems/MercenarySystem';
import { DoomsdayEscapeSystem } from '../systems/DoomsdayEscapeSystem';
import { RenderPipeline, visibilityRadiusPx, type RenderContext } from '../systems/RenderPipeline';
import type { SystemContext } from '../systems/GameSystem';
import { GameplayInputHandler } from '../systems/GameplayInputHandler';
import { GameplayScene } from './GameplayScene';
import { TutorialController, type TutorialRenderContext } from '../systems/TutorialController';
import { TutorialMap, TUTORIAL_CHEST_POS, TUTORIAL_TREASURE_ROOM_BOUNDS } from '../map/TutorialMap';
import { TutorialInventoryInteraction } from '../ui/TutorialInventoryInteraction';
import { HOTBAR_REFUSAL_MESSAGE } from '../ui/InventoryInteraction';
import { ITEM_DEF, isWearable, type ItemId } from '../core/ItemDefs';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { SmallSpider } from '../creatures/SmallSpider';
import {
  GrotesqueSpider,
  SLAM_AUDIO_OFFSET,
  SCREECH_AUDIO_OFFSET,
} from '../creatures/GrotesqueSpider';
import { randomInt, pointInRect } from '../utils';
import { aiAdapter } from '../ai/AIAdapter';
import {
  adviceObjective,
  gatewayAdviceId,
  MordecaiAdvisor,
  type AdviceObjective,
  type AdviceSlot,
} from '../systems/mordecaiAdvice';
import type { AISceneContext } from '../ai/aiActions';
import { GameStats } from '../core/GameStats';
import { difficultyStats } from '../core/DifficultyStats';
import type { AudioManager } from '../audio/AudioManager';
import { sfxGroupsForLevelId } from '../audio/sfxGroups';
import { drawText } from '../ui/TextBox';
import { renderKnockedOutUI, updateKnockoutState } from '../systems/KnockoutRevive';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { renderQuality } from '../core/RenderQuality';
import {
  setButtonMouseState,
  setButtonAudio,
  notifyButtonClick,
  clearButtonMouseState,
  menuFocusContextId,
} from '../ui/Button';

/**
 * Persists a run. Everything a resumed game needs that the scene cannot
 * re-derive: both crawlers, the floor they are on, and the party's ability
 * progress — which belongs to neither `PlayerSnapshot` because it is shared.
 */
export type SaveProgressFn = (data: {
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  levelId: string;
  abilityStates: SerializedAbilityState[];
  /**
   * Whether the Krakaren chest has been opened. The pet's level and XP ride
   * along in `abilityStates`, but whether he exists at all does not — it is not
   * an ability state, it is a one-off unlock.
   */
  mongoUnlocked: boolean;
  /** The pet's current HP, which does not reset between summons or sessions. */
  mongoPetHp: number;
  mongoPetResting: boolean;
}) => void;

export interface DungeonSceneOptions {
  /** Tile coordinates to spawn players at (instead of map start tile). */
  spawnAt?: { x: number; y: number };
  /** Preserved human player state from a previous scene (e.g. building interior). */
  humanSnap?: PlayerSnapshot;
  /** Preserved cat player state from a previous scene. */
  catSnap?: PlayerSnapshot;
  /**
   * Pixel position to drop a knocked-out companion back at, instead of the party
   * spawn point — used when returning from a building the player entered alone.
   */
  knockedOutCompanionAt?: { x: number; y: number };
  /** Existing map to reuse instead of generating a new one (e.g. returning from building). */
  existingMap?: GameMap;
  /**
   * Minimap to reuse so fog-of-war survives the scene rebuild. Only honoured
   * alongside `existingMap` — its fog array is sized to that map's structure.
   */
  existingMiniMap?: MiniMapSystem;
  /**
   * The Wayfinder's Anchor's cooldown and trail anchor, carried across a
   * building-exit rebuild — only meaningful alongside `existingMap`, since the
   * anchor tile it names is only still real ground on the same map instance.
   */
  existingRecallState?: RecallSceneRebuildState;
  /** Carry achievement managers across floor transitions. */
  humanAchievements?: AchievementManager;
  catAchievements?: AchievementManager;
  /** Achievement state at floor entry — restored on death-restart so achievements can be re-earned. */
  floorEntryHumanAchievements?: AchievementManager;
  floorEntryCatAchievements?: AchievementManager;
  /** Snapshot of player state at the very start of this floor — used to respawn after death. */
  floorEntryHumanSnap?: PlayerSnapshot;
  /** Snapshot of cat state at the very start of this floor — used to respawn after death. */
  floorEntryCatSnap?: PlayerSnapshot;
  /** Whether Mongo the velociraptor has been unlocked (persists across floors). */
  mongoUnlocked?: boolean;
  /**
   * The pet's HP and quest lock, threaded by reference like the quest progress
   * objects. His health persists across summons, floors and buildings, and the
   * `Mongo` instance that carries it in play is destroyed on every despawn.
   */
  mongoPetState?: MongoPetState;
  /** Carry ability leveling progress across floor transitions. */
  abilityManager?: AbilityManager;
  /** Ability state at floor entry — restored on death-restart so level-up progress rewinds to floor-start. */
  floorEntryAbilityManager?: AbilityManager;
  /** Called whenever the game wants to persist progress (e.g. on safe-room entry). */
  saveProgress?: SaveProgressFn;
  /** Shared AudioManager instance — persists across scene transitions. */
  audio?: AudioManager;
  /** When provided, the scene runs in tutorial mode using a hand-crafted map and guided state machine. */
  tutorialController?: TutorialController;
  /** Called when the player confirms Reset Game — should wipe progress and return to the start screen. */
  onResetGame?: () => void;
  /** Circus questline state, threaded by reference across building/scene transitions. */
  circusQuestProgress?: CircusQuestProgress;
  /** Murder-mystery questline state, threaded by reference across building/scene transitions. */
  murderQuestProgress?: MurderQuestProgress;
  /** Wayfinder's Anchor questline state, threaded by reference across building/scene transitions. */
  anchorQuestProgress?: AnchorQuestProgress;
  /** Journal state that must survive a door: guide visits and the pinned objective. */
  journalProgress?: JournalProgress;
  /** Bounty-board state, threaded by reference across building/scene transitions. */
  bountyProgress?: BountyProgress;
  /** Doomsday-finale state (soul crystal containment + escape), threaded by reference across building/scene transitions. */
  doomsdayQuestProgress?: DoomsdayProgress;
  /** Desperado Club membership, threaded by reference across building/scene transitions. */
  clubMembership?: ClubMembership;
  /** Resident lore progress + the apothecary's batch, threaded by reference across building/scene transitions. */
  townMemory?: TownMemory;
  /** Market-stall stock, threaded by reference so a shop trip can't restock a stall. */
  marketStock?: MarketStock;
  /** Hired-mercenary roster, threaded by reference across building/scene transitions. */
  mercenaryRoster?: MercenaryRoster;
  /** Companion combat stance, threaded by reference so passive/aggressive survives building/floor transitions. */
  companionStance?: CompanionStanceState;
  /** `!god` / `!tough` cheat state, threaded by reference so it survives scene transitions. */
  godModeState?: GodModeState;
  /**
   * The run's kill and potion tallies, threaded by reference: the Stats tab is
   * readable from inside a building, and a counter that reset every time the
   * party stepped through a door would be reporting the last five minutes.
   */
  gameStats?: GameStats;
  /** Dev bootstrap only: spawn beside the circus instead of the map start tile. */
  spawnAtCircus?: boolean;
  /**
   * Dev bootstrap only: picks the spawn tile from this floor's freshly generated
   * map — a gateway safe room, the spider lab door. A callback rather than a
   * coordinate because the coordinate does not exist until the constructor has
   * generated the map, and because keeping the landmark vocabulary out of here
   * is what lets a release build drop the dev bootstrap entirely. Returning null
   * falls back to the floor's own start tile.
   */
  resolveSpawnTile?: (gameMap: GameMap) => { x: number; y: number } | null;
  /** Skip the level-intro banner and fanfare — set when re-entering a level already introduced (e.g. leaving a building). */
  skipIntro?: boolean;
  /**
   * In-run checkpoint from the last safe room entered on this floor. Threaded
   * through building detours so a death mid-detour still returns to the safe
   * room rather than restarting the floor.
   */
  checkpoint?: LevelCheckpoint;
}

// Items with a designated owner — kept in sync with non-boss floor loot routing below
/** Building whose forge fires supply the town's fire-crackle ambience. */
const RUSTY_ANVIL_BUILDING_NAME = 'The Rusty Anvil';
/** How far outside the mark `!bounty go` lands the party — inside its aggro range. */
const BOUNTY_WARP_STANDOFF_TILES = 4;
/** Widest ring `!bounty go` will search for somewhere walkable to land. */
const BOUNTY_WARP_SEARCH_TILES = 20;
/** A recall lands *on* its destination where it can, so the ring search starts there. */
const RECALL_WARP_STANDOFF_TILES = 0;
/** Widest ring the Wayfinder's Anchor will search for somewhere to set the party down. */
const RECALL_WARP_SEARCH_TILES = 24;
/** How far from the human the companion may be nudged when a warp lands. */
const WARP_COMPANION_SEARCH_TILES = 6;
/** Distance-attenuated ambience tuning for the overworld town. */
const FOUNTAIN_AMBIENT_RADIUS_TILES = 10;
const FOUNTAIN_AMBIENT_VOLUME = 0.5;
const FORGE_AMBIENT_RADIUS_TILES = 8;
const FORGE_AMBIENT_VOLUME = 0.45;
/**
 * The plaza's murmur is a wide, quiet bed rather than a wall of crowd noise —
 * wide enough to carry a little way up every lane off the 17 x 16 slab, which is
 * what 12 tiles from its centre reaches.
 */
const TOWN_SQUARE_AMBIENT_RADIUS_TILES = 12;
const TOWN_SQUARE_AMBIENT_VOLUME = 0.28;
/**
 * The city chatter spans the whole town so it reaches silence exactly where the
 * town ends. Its radius tracks the safe-zone radius; the fallback only matters on
 * an overworld map that somehow reports no safe zone.
 */
const CITY_CROWD_AMBIENT_FALLBACK_RADIUS_TILES = 40;
const CITY_CROWD_AMBIENT_VOLUME = 0.35;

/** Shown via `HotbarToast` on safe-room entry, once a checkpoint is actually captured. */
const PROGRESS_SAVED_TOAST_TEXT = 'Progress Saved...';

/** Toast shown the moment the Juicer falls and both crawlers take the ink. */
const DESPERADO_TATTOO_NOTICE = 'New tattoo: the Desperado Pass. The Club will know you.';
/** Its line in the Juicer chest's reward columns — an award, not an inventory item. */
const DESPERADO_TATTOO_REWARD_LABEL = 'Desperado Pass Tattoo (both crawlers)';

const FORCED_TO_HUMAN = new Set<string>([
  'trollskin_shirt',
  'nightgaunt_cloak',
  'splatter_skunk_toe_ring',
  'shade_gnoll_kneepads',
  'grull_war_gauntlet',
  'slingshot',
]);
const FORCED_TO_CAT = new Set<string>([
  'enchanted_crown_sepsis_whore',
  'fae_scale_crupper',
  'slate_butterfly_talisman',
  'bracelet_of_dex',
]);

/**
 * Which crawler must receive this item, or null when either may have it.
 *
 * Beyond the two hand-listed signature items, a skill book written for one
 * crawler is routed to that crawler — the alternative is handing the cat's only
 * guaranteed Cockroach book to the human, who cannot read it.
 */
function forcedRecipientFor(id: ItemId): CrawlerKind | null {
  if (FORCED_TO_HUMAN.has(id)) return 'human';
  if (FORCED_TO_CAT.has(id)) return 'cat';
  const skillId = ITEM_DEF[id].skillId;
  if (skillId === undefined) return null;
  const eligibleFor = getSkillDef(skillId).eligibleFor;
  return eligibleFor === 'both' ? null : eligibleFor;
}

// Companion/Follower system
const FOLLOWER_FOLLOW_RANGE_TILES = 2.5;
/**
 * How far the recall spell will look for a walking route before it gives up and
 * teleports the companion. Map-scale, because "no route" is what makes recall
 * teleport, and a companion left across town can still walk back.
 */
const RECALL_MAX_PATH_DISTANCE_TILES = 96;
const TILE_CENTER_OFFSET = 0.5;
const COMPANION_ERROR_DISPLAY_FRAMES = 180;

/** Ripples and splashes centre on the wader, not on their tile corner. */
const WADER_CENTRE_FRACTION = 0.5;

/**
 * The river bed. Its emitter is repositioned every frame onto the nearest
 * *visible* water tile, so the sound arrives as the river comes on screen and
 * swells as the player approaches it, rather than switching on at a fixed
 * distance from a point that a winding river does not have.
 */
const RIVER_AMBIENT_VOLUME = 0.55;
/** Distance at which the river fades out, in tiles. About a screen and a half. */
const RIVER_AMBIENT_RADIUS_TILES = 26;
/**
 * Radius used while actually wading. Collapsing it to the listener's own tile is
 * what guarantees the loop is at full volume in the water: measured from a tile
 * centre, standing in the river still leaves up to 0.7 tiles of distance, which
 * would quietly cap the "loudest" case just below its maximum.
 */
const RIVER_AMBIENT_IN_WATER_RADIUS_TILES = 0;

/**
 * Entry splashes play at full gain. The mp3s are mastered to the same event
 * loudness as the other one-shots (their loudest 300 ms sits at -11.5 dB, matching
 * `punch_1`), so trimming here only makes them hard to hear again — which is
 * exactly what an earlier 0.7 did.
 */
const SPLASH_VOLUME = 1;
/** Beyond this a mob's splash is silent; within it, it fades with distance. */
const MOB_SPLASH_AUDIBLE_RADIUS_TILES = 18;

// Loot and drop rates
/** Boss chests sit this far north of the boss room centre, clear of the boss itself. */
const BOSS_CHEST_TILES_NORTH = 2;
const LOOT_SPLIT_THRESHOLD = 0.5;
const LOW_HP_LOOT_CHANCE = 0.4;
const MED_HP_LOOT_CHANCE = 0.6;
const MIN_COIN_DROP = 15;
const MAX_COIN_DROP = 50;

// Chest potion weights — proportional to original mob drop rates (8:8:4:1.5 scaled to integers)
const CHEST_POTION_SPEED_FIZZ_WEIGHT = 16;
const CHEST_POTION_JUGG_JUICE_WEIGHT = 16;
const CHEST_POTION_COOLDOWN_CRISP_WEIGHT = 8;
const CHEST_POTION_STAT_BOOST_WEIGHT = 3;
const CHEST_POTION_TOTAL_WEIGHT =
  CHEST_POTION_SPEED_FIZZ_WEIGHT +
  CHEST_POTION_JUGG_JUICE_WEIGHT +
  CHEST_POTION_COOLDOWN_CRISP_WEIGHT +
  CHEST_POTION_STAT_BOOST_WEIGHT;
const SPIT_PLACEMENT_ATTEMPTS = 8;
const SPIT_PLACEMENT_RANDOMNESS = 0.5;

/**
 * Ceiling on how many mobs of one `onMobKilledSpawns` rule may be alive within
 * {@link ON_KILL_SPAWN_CAP_RADIUS} of a death.
 *
 * Floor 2's rule turns *every* death into one to five brindle grubs, so the
 * denser rooms this difficulty pass introduced would otherwise compound into a
 * swarm that outnumbers the encounter it came out of — and each of those grubs
 * dying is not itself a trigger, so nothing else bounds the total.
 */
const MAX_CONCURRENT_ON_KILL_SPAWNS = 12;

/**
 * How far the cap above looks. Wide enough to cover the room a fight is in plus
 * the corridor mouths feeding it, so a single encounter can't stack bursts, and
 * short enough that grubs abandoned elsewhere on the floor stop counting.
 */
const ON_KILL_SPAWN_CAP_RADIUS_TILES = 12;
const ON_KILL_SPAWN_CAP_RADIUS = ON_KILL_SPAWN_CAP_RADIUS_TILES * TILE_SIZE;

/** Magic Missile level that earns the cat the slate butterfly talisman. */
const MAGIC_MISSILE_TALISMAN_LEVEL = 3;

/** Kills one attack has to land at once to earn the crowd-control award. */
const MULTIKILL_ACHIEVEMENT_THRESHOLD = 10;

/**
 * How far around the Juicer's room a troglodyte still counts as one of his
 * guards. His minions are the gateway troglodytes standing outside the door,
 * not in-room spawns, so the radius has to reach past the room itself while
 * staying clear of the floor's ordinary troglodyte population.
 */
const BIG_BRAWLER_GUARD_RADIUS_TILES = 20;
const BIG_BRAWLER_GUARD_RADIUS = BIG_BRAWLER_GUARD_RADIUS_TILES * TILE_SIZE;

/** Spawn-table key of the mobs that guard the Juicer's gateway. */
const TROGLODYTE_SPAWN_KEY = 'troglodyte';

// UI positioning and sizing
const MINIMAP_MARGIN = 8;
const MOBILE_UI_SPACING = 4;

// UI button positioning (Mongo/Gear/Bag etc)
const SUMMON_BUTTON_X = 10;
const SUMMON_BUTTON_Y_OFFSET_1 = 52;
const SUMMON_BUTTON_Y_OFFSET_2 = 12;
const SUMMON_BUTTON_Y_OFFSET_3 = 52;
const SUMMON_BUTTON_Y_OFFSET_4 = 8;

// Music and animation timing
const MUSIC_FADE_IN_MS = 2000;
const LONGPRESS_TIMEOUT_MS = 500;
const MENU_TAP_DURATION_MS = 250;
const MENU_TAP_MAX_DISTANCE = 20;
const TOUCH_DRAG_THRESHOLD = 10;
const MINIMAP_DRAG_THRESHOLD = 5;

// Health visual feedback
const HEALTH_BAR_COLOR_THRESHOLD = 0.78;
const HEALTH_BAR_WARNING_THRESHOLD = 0.75;

// Combat and interaction
const ACHIEVEMENT_RECENT_EVENTS_LIMIT = 5;
const MORDECAI_CHAT_MERGED_EVENTS_LIMIT = 5;

/** Floors Mordecai has a list of objectives for; the rest fall through to the AI chat. */
const DUNGEON_FLOOR_ONE = 1;
const DUNGEON_FLOOR_TWO = 2;
/**
 * The Over City: the only floor that is a town rather than a dungeon, and the
 * first with more than one questline running at once — which is why it is also
 * where the Quest Journal starts being offered.
 */
const OVERWORLD_FLOOR_THREE = 3;
const GROTESQUE_SPIDER_WALKING_TRIGGER_DISTANCE_TILES = 12;
const COMBAT_COOLDOWN_FRAMES = 300;
const PLAYER_IDLE_REPORT_INTERVAL_FRAMES = 300;
const LOW_HEALTH_THRESHOLD = 0.25;
const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

// Spider-lab arrow geometry
const ARROW_LENGTH_MULTIPLIER_BASE2 = 0.45;
const ARROW_LENGTH_MULTIPLIER_HEIGHT = 0.5;
const ARROW_LENGTH_MULTIPLIER_CENTER = 0.1;
const ARROW_BOUNCE_FREQUENCY = 0.005;
const ARROW_BOUNCE_AMPLITUDE = 4;
const ARROW_LENGTH_PIXELS = 22;
const ARROW_LINE_WIDTH = 1.5;
const ARROW_VERTICAL_OFFSET_TILES = 1.5;

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;
/** Inside this many tiles the pinned-objective arrow is suppressed — it is on screen. */
const PINNED_ARROW_SUPPRESS_TILES = 4;
/** Gold, matching the pinned Journal row it belongs to. */
const PINNED_ARROW_COLOR = '#facc15';
/** Gold, as the `!reveal` cheat arrow has always been. */
const STAIRWELL_ARROW_COLOR = '#facc15';
/** The stairwell's own violet, so the fail-safe reads as the hole's draft rather than as a quest marker. */
const WAYFINDER_ARROW_COLOR = '#c084fc';

function splitChestLoot(loot: LootDrop): { humanLoot: LootDrop; catLoot: LootDrop } {
  const humanItems: LootDrop['items'] = [];
  const catItems: LootDrop['items'] = [];
  const singlePool: LootDrop['items'] = [];

  for (const item of loot.items) {
    const forced = forcedRecipientFor(item.id);
    if (forced === 'human') {
      humanItems.push({ ...item });
    } else if (forced === 'cat') {
      catItems.push({ ...item });
    } else if (item.quantity === 1) {
      singlePool.push({ ...item });
    } else {
      // Split stacks evenly; extra goes to random player
      const half = Math.floor(item.quantity / 2);
      const extra = item.quantity - half * 2;
      const humanGetsExtra = extra > 0 && Math.random() < LOOT_SPLIT_THRESHOLD;
      humanItems.push({ id: item.id, quantity: half + (humanGetsExtra ? extra : 0) });
      catItems.push({ id: item.id, quantity: half + (humanGetsExtra ? 0 : extra) });
    }
  }

  // Fisher-Yates shuffle, then round-robin distribute single items
  for (let i = singlePool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [singlePool[i], singlePool[j]] = [singlePool[j], singlePool[i]];
  }
  singlePool.forEach((item, i) => {
    if (i % 2 === 0) humanItems.push(item);
    else catItems.push(item);
  });

  // Split coins; odd coin goes to random player
  const halfCoins = Math.floor(loot.coins / 2);
  const extraCoin = loot.coins - halfCoins * 2;
  const humanGetsExtraCoin = extraCoin > 0 && Math.random() < LOOT_SPLIT_THRESHOLD;

  return {
    humanLoot: { coins: halfCoins + (humanGetsExtraCoin ? extraCoin : 0), items: humanItems },
    catLoot: { coins: halfCoins + (humanGetsExtraCoin ? 0 : extraCoin), items: catItems },
  };
}

/** Picks a potion type for a chest using the relative rarity weights. */
function rollChestPotion(): ItemId {
  const r = Math.random() * CHEST_POTION_TOTAL_WEIGHT;
  if (r < CHEST_POTION_SPEED_FIZZ_WEIGHT) return 'speed_fizz';
  if (r < CHEST_POTION_SPEED_FIZZ_WEIGHT + CHEST_POTION_JUGG_JUICE_WEIGHT) return 'jugg_juice';
  if (
    r <
    CHEST_POTION_SPEED_FIZZ_WEIGHT +
      CHEST_POTION_JUGG_JUICE_WEIGHT +
      CHEST_POTION_COOLDOWN_CRISP_WEIGHT
  )
    return 'cooldown_crisp';
  return 'stat_boost_potion';
}

export class DungeonScene extends GameplayScene {
  private gameMap: GameMap;
  readonly pm: PlayerManager;
  /** Map, bus, audio and population — what every kit this scene builds is handed. */
  private readonly world: SceneWorld;
  private grotesqueSpiders: GrotesqueSpider[] = [];

  protected override get pauseMenu(): PauseMenu {
    return this.menus.pauseMenu;
  }

  /**
   * The frame's shared system context and its `extraTargets` list, held as
   * fields and refreshed by `buildSystemContext` rather than rebuilt, so the
   * per-frame system pass allocates nothing.
   */
  private readonly _extraTargets: Player[] = [];
  /** Reused per-frame array of the minimap's quest markers. */
  private readonly _questMarkers: Array<{ x: number; y: number; type: QuestMarkerType }> = [];
  /** Reused per-frame array of the Journal's entries, for the same reason. */
  private readonly _trackerEntries: TrackerEntry[] = [];
  private readonly _systemContext: SystemContext;

  // Systems
  private miniMap: MiniMapSystem;
  private safeRoom: SafeRoomSystem;
  private bopca: BopcaSystem;
  private readonly systemNotices: SystemNoticeSystem;
  /** Spells, mob AI, attack and death resolution, gore, regen, the death screen. */
  private readonly combat: CombatKit;
  /** Smashable props, floor loot and dynamite. Always present — see `DestructionKit`. */
  private readonly destruction: DestructionKit;
  /** Bag, gear, pause menu, award stack, toasts, potions, skill books. */
  private readonly menus: MenusKit;
  /** The chat box and the cheat table behind it. */
  private readonly chat: ChatKit;
  private bossRoom: BossRoomSystem;
  private readonly mordecaiAdvisor = new MordecaiAdvisor();
  private lavaBalls: LavaBallSystem;
  private rockThrows: RockThrowSystem;
  private skeletonShots: SkeletonProjectileSystem;
  private goblinArrows: GoblinArrowSystem;
  private skeletonSummons: SkeletonSummonSystem;
  private clownGas: ClownGasSystem;
  private knightMissiles: KnightMissileSystem;
  private companion: CompanionSystem;
  private trees: TreeSystem | null;
  /** Null on every map but the overworld, which is the only one with rivers. */
  private water: WaterAnimationSystem | null;
  private stairwell: StairwellSystem;
  /** The Wayfinder's Anchor: channel, cooldown and trail anchor. */
  private readonly recall: RecallSystem;
  private building: BuildingSystem | null = null;
  private townLife: TownLifeSystem | null = null;
  private townProps: TownPropSystem | null = null;
  /** Shady's bounty loop. Overworld only — null on every other floor. */
  private bounty: BountySystem | null = null;
  private townGuide: TownGuideSystem | null = null;
  /** Screen rect of the Journal's compass button, or null on floors without one. */
  private journalButtonRect: UIRenderer.Rect | null = null;
  private townDecor: TownDecorSystem | null = null;
  private market: MarketSystem | null = null;
  /**
   * Every town fixture in one Y-sort list. Built once, since both owning systems
   * fill their prop arrays in their constructors and never add to them.
   */
  private townPropRenderables: ReadonlyArray<TownPropRenderable> | null = null;
  private citizenDialog: CitizenDialog | null = null;
  /** Citizen currently frozen mid-conversation; unfrozen once `citizenDialog` closes. */
  private citizenDialogTarget: Townsperson | null = null;
  private noticeBoard: NoticeBoardPanel | null = null;
  private marketPanel: PricedMenuPanel | null = null;
  private fortuneTeller: FortuneTellerPanel | null = null;
  private juicerRoom: JuicerRoomSystem;
  private arenaRoom: ArenaRoomSystem;
  private barriers: BarrierSystem;
  private defendQuest!: DefendQuestSystem;
  private spiderQuest!: SpiderQuestSystem;
  private circusQuest!: CircusQuestSystem;
  private murderQuest!: MurderMysteryQuestSystem;
  private anchorQuest!: AnchorQuestSystem;
  private doomsdayEscape!: DoomsdayEscapeSystem;
  private overworldMusic: OverworldMusicSystem | null = null;
  private ambientSound: AmbientSoundSystem | null = null;
  /**
   * The river's emitter, held so `updateRiverAmbience` can move it. Owned here
   * rather than rebuilt each frame because `AmbientSoundSystem` holds the object
   * and reads it every tick — mutating the one it already has is the whole
   * mechanism.
   */
  private riverAmbientEmitter: AmbientEmitter | null = null;
  private readonly circusQuestProgress: CircusQuestProgress;
  private readonly murderQuestProgress: MurderQuestProgress;
  private readonly anchorQuestProgress: AnchorQuestProgress;
  private readonly journalProgress: JournalProgress;
  private readonly bountyProgress: BountyProgress;
  private readonly doomsdayQuestProgress: DoomsdayProgress;
  private readonly clubMembership: ClubMembership;
  private readonly townMemory: TownMemory;
  private readonly marketStock: MarketStock;
  private readonly mercenaryRoster: MercenaryRoster;
  /** Companion combat stance, threaded by reference so it survives building trips and floor changes. */
  private readonly companionStance: CompanionStanceState;
  private readonly godModeState: GodModeState;
  private _spiderKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private difficultyTelemetry = new DifficultyTelemetrySystem();
  /**
   * Whether the floor has already been told where its stairwell is.
   *
   * Latches for the life of the scene, and pointedly is *not* part of the world
   * checkpoint: a restore puts the gauntlet boss back on its feet, so the same
   * kill can be earned twice, and rewinding this would let the line play twice
   * in one run. The floor only opens once no matter how many times the player
   * dies proving it.
   */
  private stairwellHintAnnounced = false;
  private readonly mongoSystem: MongoSystem;
  private readonly mongoPetState: MongoPetState;
  private readonly mercenarySystem: MercenarySystem;
  private renderPipeline = new RenderPipeline();
  private bus = new EventBus();

  private levelCompleteScreen = new LevelCompleteScreen();

  private achievementUI!: AchievementUISystem;
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;

  private bossIntro = new BossIntroSystem();
  private readonly dungeonIntro = new DungeonIntroSystem();
  // Becomes true once the AudioContext is running so intro ticks in sync with sound.
  private introStarted = false;
  private readonly skipIntro: boolean;
  /** Set just before swapping into a building so onExit leaves the music running. */
  private musicPersistsAcrossExit = false;

  private readonly abilityManager: AbilityManager;

  private arena!: ArenaSystem;
  private readonly treasureChests = new TreasureChestSystem();
  private readonly chestRewardDialog = new ChestRewardDialog();

  private floorEntryHumanSnap!: PlayerSnapshot;
  private floorEntryCatSnap!: PlayerSnapshot;
  private floorEntryHumanAchievements!: AchievementManager;
  private floorEntryCatAchievements!: AchievementManager;
  private floorEntryAbilityManager!: AbilityManager;

  private readonly followerMenu = new FollowerMenu();

  private _revealStairwell = false;
  private _revealSpiderLab = false;

  private gameOver = false;
  protected readonly notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  private readonly LEVEL_TIME_LIMIT = 216_000; // 1 hour @ 60 fps
  private wasInSafeRoom = false;
  /** In-run checkpoint from the last safe room entered on this floor, or null if none yet. */
  private checkpoint: LevelCheckpoint | null = null;
  private speechBubblePulse = 0;

  private readonly inputHandler = new GameplayInputHandler();

  private readonly touch = new MobileTouchState();
  private krakarenKilled = false;
  private krakarenBossRoomIdx = -1;
  private juicerKilled = false;
  private juicerBossRoomIdx = -1;
  private woodBreakSoundIdx = 0;
  private combatCooldownFrames = 0;
  private humanHealthLow = false;
  private catHealthLow = false;
  private playerIdleFrames = 0;
  private readonly gameStats: GameStats;

  private _mouseX = -9999; // eslint-disable-line @typescript-eslint/no-magic-numbers
  private _mouseY = -9999; // eslint-disable-line @typescript-eslint/no-magic-numbers
  private _mouseDown = false;
  private _companionErrorMsg: { text: string; framesLeft: number } | null = null;
  private _miniMapDragging = false;
  private _miniMapDragLastX = 0;
  private _miniMapDragLastY = 0;

  private onSaveProgress: SaveProgressFn | undefined;

  private readonly onResetGameCallback: (() => void) | null;

  private readonly audio: AudioManager | null;
  private readonly tutorial: TutorialController | null = null;

  constructor(
    private readonly levelDef: LevelDef,
    input: InputManager,
    sceneManager: SceneManager,
    options?: DungeonSceneOptions,
  ) {
    super(input, sceneManager);

    // Before anything is generated or drawn: the tile painters read the active
    // theme rather than being handed one, so it has to be right for this floor
    // by the time the first chunk is baked. Set here rather than in `GameMap`
    // because a re-entry reuses `options.existingMap` and never builds one.
    //
    // Unconditionally, including for the tutorial and for an overworld level,
    // so the theme is always a property of the level being entered rather than
    // a leftover from the last one — see `DEFAULT_DUNGEON_FLOOR_THEME` for the
    // town interiors that would otherwise inherit floor 2's blockwork.
    setDungeonFloorTheme(levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);

    // Both are needed before the roster below, which hands every mob it accepts
    // the spell context, and by the level spawners' audio-carrying siblings.
    this.audio = options?.audio ?? null;
    this.companionStance = options?.companionStance ?? createCompanionStanceState();
    this.godModeState = options?.godModeState ?? createGodModeState();
    this.gameStats = options?.gameStats ?? new GameStats();
    this.humanAchievements = options?.humanAchievements ?? new AchievementManager();
    this.catAchievements = options?.catAchievements ?? new AchievementManager();
    // Ahead of the kits: `CombatKit` levels abilities off kills and `MenusKit`
    // draws the ability screen, so both want this before they exist.
    this.abilityManager = options?.abilityManager ?? new AbilityManager();
    this.abilityManager.register(MAGIC_MISSILE_DEF);
    this.abilityManager.register(PROTECTIVE_SHELL_DEF);
    this.abilityManager.register(SMUSH_DEF);
    this.abilityManager.register(MONGO_DEF);

    const tutorialController = options?.tutorialController ?? null;
    // Built here rather than beside the bag it restricts: `MenusKit` owns the
    // bag now, and the kit is constructed long before the tutorial's other
    // wiring.
    const tutorialInventoryInteraction =
      tutorialController === null ? null : new TutorialInventoryInteraction();
    if (tutorialController !== null && tutorialInventoryInteraction !== null) {
      const drag = tutorialInventoryInteraction;
      drag.getAllowedSourceItemId = () => tutorialController.tutorialDragItemId;
      drag.getAllowedTargetHotbarSlot = () => tutorialController.tutorialDragTargetSlot;
      drag.getBlockedDragItemId = () => tutorialController.tutorialBlockedDragItemId;
      drag.onBlockedDragAttempt = () => {
        this.audio?.play('error');
        tutorialController.triggerBoxersDragHint();
      };
    }
    /**
     * The floor's starting population, held aside until the roster exists —
     * `MobRoster.add` is what gives a mob its map and spell context, so nothing
     * may reach `this.world.roster.mobs` before it.
     */
    const initialMobs: Mob[] = [];
    let spawnTileX = 0;
    let spawnTileY = 0;

    if (tutorialController !== null) {
      const tutMap = new TutorialMap();
      this.gameMap = tutMap;
      this.tutorial = tutorialController;
      this.levelTimerFrames = this.LEVEL_TIME_LIMIT;

      spawnTileX = tutMap.humanStartTile.x;
      spawnTileY = tutMap.humanStartTile.y;
      this.pm = new PlayerManager(spawnTileX, spawnTileY);
      // Place cat at its own spawn room, separated from the human
      this.pm.cat.x = tutMap.catStartTile.x * TILE_SIZE;
      this.pm.cat.y = tutMap.catStartTile.y * TILE_SIZE;

      tutorialController.initializePlayers(this.human, this.cat);
      this.floorEntryHumanSnap = snapPlayer(this.human);
      this.floorEntryCatSnap = snapPlayer(this.cat);

      initialMobs.push(...tutorialController.allMobs);
      // Tutorial chest — unlocked immediately since there are no mob guards
      this.treasureChests.addWoodenChest(
        TUTORIAL_CHEST_POS.x,
        TUTORIAL_CHEST_POS.y,
        TUTORIAL_TREASURE_ROOM_BOUNDS,
        { coins: 0, items: [] },
        false,
      );
      this.gameMap.blockTilePermanently(TUTORIAL_CHEST_POS.x, TUTORIAL_CHEST_POS.y);
    } else {
      this.gameMap =
        options?.existingMap ??
        new GameMap({
          mapSize: levelDef.mapSize,
          tileHeight: TILE_SIZE,
          mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
          dungeon: dungeonOptionsForLevel(levelDef),
        });
      this.levelTimerFrames = levelDef.hasCollapseTimer === true ? this.LEVEL_TIME_LIMIT : 0;

      // Dev bootstrap: spawn on the southern circus grounds so quest stages
      // can be exercised without the walk from town.
      const CIRCUS_SPAWN_EDGE_INSET_TILES = 3;
      const circusSpawn =
        options?.spawnAtCircus === true && this.gameMap.circusCentre
          ? {
              x: this.gameMap.circusCentre.x,
              y:
                this.gameMap.circusCentre.y +
                (this.gameMap.circusRadiusTiles ?? 0) -
                CIRCUS_SPAWN_EDGE_INSET_TILES,
            }
          : null;
      const resolvedSpawn = options?.resolveSpawnTile?.(this.gameMap) ?? null;
      const spawn = circusSpawn ?? resolvedSpawn ?? options?.spawnAt ?? this.gameMap.startTile;
      spawnTileX = spawn.x;
      spawnTileY = spawn.y;
      this.pm = new PlayerManager(spawnTileX, spawnTileY);

      if (options?.humanSnap) restorePlayer(this.human, options.humanSnap);
      if (options?.catSnap) restorePlayer(this.cat, options.catSnap);
      this.pm.setPositions(spawnTileX, spawnTileY);

      // A companion who went down out here stays exactly where they fell while
      // the player is off inside a building, rather than being dragged to the door.
      const downedAt = options?.knockedOutCompanionAt;
      const companion = this.pm.inactive();
      if (downedAt !== undefined && companion.isKnockedOut) {
        companion.x = downedAt.x;
        companion.y = downedAt.y;
      }

      this.floorEntryHumanSnap =
        options?.floorEntryHumanSnap ?? revivedSnapshot(snapPlayer(this.human));
      this.floorEntryCatSnap = options?.floorEntryCatSnap ?? revivedSnapshot(snapPlayer(this.cat));

      // The chests themselves are built much later in this constructor, but
      // their tiles have to stop being walkable now: every spawner below asks
      // the map what is walkable, and a tile whose chest does not exist yet
      // looks like open floor.
      for (const br of this.gameMap.bossRooms) {
        this.gameMap.blockTilePermanently(br.centre.x, br.centre.y - BOSS_CHEST_TILES_NORTH);
      }
      for (const tr of this.gameMap.treasureRooms) {
        this.gameMap.blockTilePermanently(tr.centre.x, tr.centre.y);
      }

      // Read once, here: every level below is party-relative, and the whole
      // point of computing them at floor generation is that nothing re-levels a
      // mob afterwards. Both crawlers have been restored from their snapshots by
      // this line, so this is the party that is about to walk in. The
      // difficulty profile is captured alongside it for the same reason — a
      // settings flip mid-floor must not re-level anything already spawned.
      const partyLevel = partyLevelOf(this.human.level, this.cat.level);
      const difficultyProfile = activeDifficultyProfile();
      initialMobs.push(...spawnForLevel(levelDef, this.gameMap, partyLevel, difficultyProfile));
      initialMobs.push(...spawnExtraMobs(levelDef, this.gameMap, partyLevel, difficultyProfile));

      // Treasure room mobs (extra enemies guarding wooden chests)
      if (levelDef.hasTreasureRoomGuards === true) {
        initialMobs.push(
          ...spawnTreasureRoomMobs(
            this.gameMap.treasureRooms,
            levelDef,
            this.gameMap,
            difficultyProfile,
          ),
        );
      }
    }

    this.world = {
      gameMap: this.gameMap,
      bus: this.bus,
      audio: this.audio,
      pm: this.pm,
      roster: new MobRoster(this.gameMap, new SpellSystem()),
    };
    for (const mob of initialMobs) this.world.roster.add(mob);

    this.grotesqueSpiders = this.world.roster.mobs.filter(
      (m): m is GrotesqueSpider => m instanceof GrotesqueSpider,
    );

    this.cat.setMap(this.gameMap);

    const reusableMiniMap =
      options?.existingMap !== undefined && options.existingMap === this.gameMap
        ? options.existingMiniMap
        : undefined;
    this.miniMap = reusableMiniMap ?? new MiniMapSystem(this.gameMap);
    this.safeRoom = new SafeRoomSystem(
      this.gameMap,
      spawnTileX,
      spawnTileY,
      this.levelDef.id,
      this.audio,
    );
    this.combat = new CombatKit({
      world: this.world,
      abilityManager: this.abilityManager,
      safeRoom: this.safeRoom,
      xpDiminishingTiers: levelDef.xpDiminishingTiers,
    });
    this.menus = new MenusKit({
      world: this.world,
      abilityManager: this.abilityManager,
      inventoryInteraction: tutorialInventoryInteraction ?? undefined,
      onOverlayRaised: () => this.clearInvLongPress(),
      // The tutorial waits on this one: `SWITCHED_TO_CAT` locks the cat in place
      // and drinking is the only thing that unlocks her.
      onPotionDrunk: (id) => {
        if (id === 'health_potion') this.tutorial?.onPotionUsed();
      },
    });
    this.menus.inventoryPanel.interaction.onBlockedHotbarDrop = () => {
      this.audio?.play('error');
      this.menus.announce(HOTBAR_REFUSAL_MESSAGE);
    };
    this.chat = new ChatKit({
      world: this.world,
      abilityManager: this.abilityManager,
      godModeState: this.godModeState,
      describeSituation: () =>
        `Human is level ${this.human.level}, Cat is level ${this.cat.level}. ` +
        `Floor: ${this.levelDef.id}. ` +
        `Human HP: ${this.human.hp}/${this.human.maxHp}, Cat HP: ${this.cat.hp}/${this.cat.maxHp}.`,
      sceneCommands: this.dungeonChatCommands(),
    });
    this.destruction = new DestructionKit(this.world, levelDef.floorNumber, {
      // The town's street torches and gate braziers are architecture. Everything
      // underground, and everything indoors, is for breaking.
      breakableProps: levelDef.isOverworld ? NO_BREAKABLE_PROPS : ALL_BREAKABLE_PROPS,
      trees: () => this.trees,
    });
    this.systemNotices = new SystemNoticeSystem(this.bus, this.menus.hotbarToast);
    // The safe-room counter is stamped here rather than in the generators: it
    // belongs to every safe room on every map, and this and BuildingInteriorScene
    // are the only two places a safe room is ever brought to life. Idempotent,
    // because a reused map instance passes through here again on every scene
    // reconstruction.
    this.bopca = new BopcaSystem(
      this.gameMap,
      stampSafeRoomCounters(this.gameMap),
      this.bus,
      this.audio,
    );
    // After the counter, because the furnishings keep clear of every tile it
    // owns and cannot know them until it is planned.
    stampSafeRoomDecor(this.gameMap);
    this.bossRoom = new BossRoomSystem(
      this.gameMap,
      this.miniMap,
      levelDef.bossRooms?.map((b) => b.type) ?? [],
    );
    this._systemContext = {
      human: this.human,
      cat: this.cat,
      active: this.active(),
      inactive: this.inactive(),
      activeIsMoving: false,
      roster: this.world.roster,
      gameMap: this.gameMap,
      bossRoom: this.bossRoom,
    };
    this.juicerRoom = new JuicerRoomSystem(this.gameMap.bossRooms[1]?.bounds);
    // Anchored to the room he spawns into rather than to where his corpse ends
    // up: a knockback onto a doorway or boundary tile can land his death
    // position outside every tracked boss room, which would otherwise pin
    // this at -1 and make the Big Brawler gauntlet permanently unclearable.
    this.juicerBossRoomIdx = levelDef.bossRooms?.findIndex((b) => b.type === 'juicer') ?? -1;
    this.arenaRoom = new ArenaRoomSystem(this.gameMap.arenaExteriors[0]);
    this.barriers = new BarrierSystem(this.gameMap);
    this.defendQuest = new DefendQuestSystem(this.gameMap, this.bus, (mob) =>
      this.world.roster.add(mob),
    );
    this.spiderQuest = new SpiderQuestSystem(this.gameMap, this.bus, (mob) => {
      this.world.roster.add(mob);
      // The lab's boss arrives through this closure rather than the level's
      // initial spawn, so it missed the one-shot filter that builds this list
      // at construction — which is what renders its ground traps and spit and
      // plays its slam. Without this the boss is silent and trapless until
      // something else rebuilds the list.
      if (mob instanceof GrotesqueSpider) this.grotesqueSpiders.push(mob);
    });
    this.circusQuestProgress = options?.circusQuestProgress ?? createCircusQuestProgress();
    this.murderQuestProgress = options?.murderQuestProgress ?? createMurderQuestProgress();
    this.anchorQuestProgress = options?.anchorQuestProgress ?? createAnchorQuestProgress();
    this.journalProgress = options?.journalProgress ?? createJournalProgress();
    this.bountyProgress = options?.bountyProgress ?? createBountyProgress();
    this.doomsdayQuestProgress = options?.doomsdayQuestProgress ?? createDoomsdayProgress();
    this.clubMembership = options?.clubMembership ?? createClubMembership();
    this.townMemory = options?.townMemory ?? createTownMemory();
    this.marketStock = options?.marketStock ?? createMarketStock();
    this.mercenaryRoster = options?.mercenaryRoster ?? createMercenaryRoster();
    this.mercenarySystem = new MercenarySystem(this.mercenaryRoster);
    this.arena = new ArenaSystem(
      this.gameMap,
      this.bus,
      () => this.world.roster.mobs,
      (mob) => this.world.roster.add(mob),
      this.bossRoom,
    );
    // Trees are generated only by `OverworldGenerator`, so every other floor
    // would build a system with nothing on the map to talk to.
    this.trees = levelDef.isOverworld
      ? new TreeSystem(this.gameMap, this.destruction.loot, levelDef.floorNumber, (tileX, tileY) =>
          this.miniMap.markTileChanged(tileX, tileY),
        )
      : null;
    // Overworld-only, mirroring `TreeSystem` above: no other map is ever
    // generated with a water tile on it, so elsewhere this would scan the
    // viewport every frame to find nothing.
    this.water = levelDef.isOverworld ? new WaterAnimationSystem(this.gameMap) : null;
    this.lavaBalls = new LavaBallSystem(this.gameMap);
    this.rockThrows = new RockThrowSystem(this.gameMap);
    this.skeletonShots = new SkeletonProjectileSystem(this.gameMap);
    this.goblinArrows = new GoblinArrowSystem(this.gameMap);
    this.skeletonSummons = new SkeletonSummonSystem(this.gameMap, (mob) =>
      this.world.roster.add(mob),
    );
    this.clownGas = new ClownGasSystem(this.gameMap);
    this.knightMissiles = new KnightMissileSystem(this.gameMap);
    this.companion = new CompanionSystem(
      this.gameMap,
      spawnTileX,
      spawnTileY,
      this.companionStance,
    );
    this.companion.registerHazardSource(this.bossRoom);
    this.companion.registerHazardSource(this.clownGas);

    if (tutorialController !== null) {
      // Both players start anchored in the tutorial so neither chases the other
      // across separated spawn rooms. Players can opt into follow later via the
      // follower menu once the tutorial unlocks it.
      this.companion.setDoNotMove(this.cat, true);
      this.companion.setDoNotMove(this.human, false);
    }

    this.followerMenu.onFollowMe = () => {
      const companionIsCat = this.human.isActive;
      const companion = companionIsCat ? this.cat : this.human;
      const caster = companionIsCat ? this.human : this.cat;
      const ts = TILE_SIZE;
      const dist = Math.hypot(companion.x - caster.x, companion.y - caster.y);
      const hasLOS =
        dist < ts * FOLLOWER_FOLLOW_RANGE_TILES ||
        this.gameMap.hasLineOfSight(
          companion.x + ts * TILE_CENTER_OFFSET,
          companion.y + ts * TILE_CENTER_OFFSET,
          caster.x + ts * TILE_CENTER_OFFSET,
          caster.y + ts * TILE_CENTER_OFFSET,
        );
      if (!hasLOS) {
        const compTX = Math.floor((companion.x + ts * TILE_CENTER_OFFSET) / ts);
        const compTY = Math.floor((companion.y + ts * TILE_CENTER_OFFSET) / ts);
        const casterTX = Math.floor((caster.x + ts * TILE_CENTER_OFFSET) / ts);
        const casterTY = Math.floor((caster.y + ts * TILE_CENTER_OFFSET) / ts);
        const path = this.gameMap.findPath(
          compTX,
          compTY,
          casterTX,
          casterTY,
          RECALL_MAX_PATH_DISTANCE_TILES,
        );
        if (path.length === 0) {
          const adjacentOffsets = [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 1 },
            { dx: -1, dy: 1 },
            { dx: 1, dy: -1 },
            { dx: -1, dy: -1 },
          ];
          const teleportTile = adjacentOffsets
            .map(({ dx, dy }) => ({ x: casterTX + dx, y: casterTY + dy }))
            .find(({ x, y }) => this.gameMap.isWalkable(x, y));
          if (teleportTile === undefined) {
            this.audio?.play('error');
            const companionName = companionIsCat ? 'cat' : 'human';
            this._companionErrorMsg = {
              text: `The ${companionName} is too far away.`,
              framesLeft: COMPANION_ERROR_DISPLAY_FRAMES,
            };
            return;
          }
          companion.x = teleportTile.x * ts;
          companion.y = teleportTile.y * ts;
        }
      }
      this.audio?.play('menu_change_follower');
      this.companion.setFollowMe(this.human.isActive);
      this.inactive().autoTarget = null;
      this.tutorial?.onFollowMeSelected();
    };
    this.followerMenu.onDoNotMove = () => {
      this.audio?.play('menu_change_follower');
      this.companion.setDoNotMove(this.inactive(), this.human.isActive);
    };
    this.followerMenu.onSetAggressive = () => {
      this.audio?.play('menu_change_follower');
      this.companion.setAggressive(this.human.isActive);
    };
    this.followerMenu.onSetPassive = () => {
      this.audio?.play('menu_change_follower');
      this.companion.setPassive(this.human.isActive);
      this.inactive().autoTarget = null;
    };
    const partyLevel = (): number => partyLevelOf(this.human.level, this.cat.level);
    this.stairwell = new StairwellSystem(
      this.gameMap,
      levelDef,
      () => {
        if (!levelDef.nextLevelId) return;
        const nextDef = getLevelDef(levelDef.nextLevelId);

        difficultyStats.recordDescend(
          partyLevel(),
          recommendedPartyLevelFor(nextDef, activeDifficultyProfile()),
        );

        // Night Vision trains on floors survived while leading, not on kills — it
        // is a passive, so a whole floor is the only honest unit of use. Credited
        // before the save below, or closing the browser on the celebration screen
        // would lose the floor's progress.
        if (this.cat.isActive) this.cat.skills.recordUse('night_vision');

        // Save progress immediately so the floor is recorded as complete even if
        // the player closes the browser during the celebration screen.
        this.onSaveProgress?.({
          humanSnap: revivedSnapshot(snapPlayer(this.human)),
          catSnap: revivedSnapshot(snapPlayer(this.cat)),
          levelId: levelDef.nextLevelId,
          abilityStates: this.abilityManager.serializeStates(),
          mongoUnlocked: this.mongoSystem.unlocked,
          // The system's accessor, not the stored value: both of these saves can
          // fire with Mongo still out, and the stored value is only written back
          // when he despawns — so a safe room entered with a 5/130 raptor at the
          // player's heel was recording 130.
          mongoPetHp: this.mongoSystem.hp,
          mongoPetResting: this.mongoSystem.restingUntilFull,
        });

        this.bus.emit('levelComplete', {});

        // Drain now: the celebration screen stops `updateGameplay`, and the queue
        // does not survive into the next scene, so a level-up earned on the last
        // step of the floor would otherwise never be announced.
        this.systemNotices.drainFor(this.human, this.cat);

        this.levelCompleteScreen.activate(levelDef.name, nextDef.name, () => {
          // Dismiss Mongo and any hired merc before floor transition
          this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          // This is the one genuine floor change among DungeonScene's four
          // `sceneManager.replace` sites, so it's the only one that runs the
          // sprite eviction pass — building enter/exit rebuild the scene around
          // the same floor identity and must never evict. Keyed on the *new*
          // floor's required keys, not the old floor's: anything the two
          // floors share (core, dungeon_common, ...) simply isn't touched.
          releaseSpritesExcept(requiredSpriteKeysForLevel(nextDef.id, nextDef.spriteGroups));
          this.sceneManager.replace(
            new DungeonScene(nextDef, this.input, this.sceneManager, {
              // Taking the stairs regroups the party: a companion carried down
              // still knocked out would time out on arrival with no way to reach them.
              humanSnap: revivedSnapshot(snapPlayer(this.human)),
              catSnap: revivedSnapshot(snapPlayer(this.cat)),
              humanAchievements: this.humanAchievements,
              catAchievements: this.catAchievements,
              mongoUnlocked: this.mongoSystem.unlocked,
              mongoPetState: this.mongoPetState,
              abilityManager: this._cleanAbilityManager(),
              saveProgress: this.onSaveProgress,
              audio: this.audio ?? undefined,
              onResetGame: this.onResetGameCallback ?? undefined,
              godModeState: this.godModeState,
              companionStance: this.companionStance,
            }),
          );
        });
      },
      partyLevel,
    );

    this.recall = new RecallSystem(
      this.gameMap,
      levelDef,
      this.bus,
      () => this.bossRoom.anyLocked,
      (player, rangePx) => this.hasNearbyEnemy(player, rangePx),
      (tile) => this.warpPartyForRecall(tile),
      (message) => this.menus.hotbarToast.show(message),
      this.audio,
    );
    // Only meaningful on the same map instance the anchor tile was recorded
    // against — a building-exit rebuild, never a floor change or a death.
    if (options?.existingMap !== undefined && options.existingRecallState !== undefined) {
      this.recall.restoreFromSceneRebuild(options.existingRecallState);
    }

    if (levelDef.isOverworld) {
      this.building = new BuildingSystem(
        this.gameMap,
        (entry) => {
          // Spawn one tile south of the door so the player exits outside and
          // doesn't immediately re-trigger the "Enter building?" prompt.
          const returnTile = {
            x: entry.doorTile.x,
            y: entry.doorTile.y + 1,
          };
          // Neither Mongo nor a hired merc can follow indoors — dismiss so they
          // aren't stranded in a stale mob list (the merc respawns from the
          // roster when the player returns to the overworld).
          this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.musicPersistsAcrossExit = true;
          const humanSnap = snapPlayer(this.human);
          const catSnap = snapPlayer(this.cat);
          // Where a downed companion is left lying while the player is indoors.
          const downedCompanion = this.inactive();
          const downedCompanionAt = downedCompanion.isKnockedOut
            ? { x: downedCompanion.x, y: downedCompanion.y }
            : undefined;
          this.sceneManager.replace(
            new BuildingInteriorScene(
              entry,
              humanSnap,
              catSnap,
              this.input,
              this.sceneManager,
              (hSnap, cSnap, defeated) => {
                // Losing an interior encounter sends the party home to the level's
                // start tile instead of dumping them back on the doorstep.
                const exitTile = defeated ? this.gameMap.startTile : returnTile;
                this.sceneManager.replace(
                  new DungeonScene(levelDef, this.input, this.sceneManager, {
                    spawnAt: exitTile,
                    humanSnap: hSnap,
                    catSnap: cSnap,
                    knockedOutCompanionAt: downedCompanionAt,
                    // Entering a building is a detour, not a new floor — the death
                    // checkpoint has to stay pinned to where this floor began.
                    floorEntryHumanSnap: this.floorEntryHumanSnap,
                    floorEntryCatSnap: this.floorEntryCatSnap,
                    floorEntryHumanAchievements: this.floorEntryHumanAchievements,
                    floorEntryCatAchievements: this.floorEntryCatAchievements,
                    floorEntryAbilityManager: this.floorEntryAbilityManager,
                    // Deliberately NOT threaded, though the scene rebuilt here keeps
                    // the same map: a checkpoint now describes the *population* too,
                    // and every mob and player reference in it belongs to the scene
                    // this line is destroying. Restoring one on the far side would
                    // revive corpses nothing can see and pay floor loot into a
                    // detached crawler. Unreachable either way today — the overworld
                    // is the only level with buildings and it generates no safe
                    // rooms — so the cost of dropping it is currently zero, and the
                    // fallback (a floor restart) is merely harsh rather than broken.
                    checkpoint: undefined,
                    existingMap: this.gameMap,
                    existingMiniMap: this.miniMap,
                    existingRecallState: this.recall.captureForSceneRebuild(),
                    humanAchievements: this.humanAchievements,
                    catAchievements: this.catAchievements,
                    mongoUnlocked: this.mongoSystem.unlocked,
                    mongoPetState: this.mongoPetState,
                    abilityManager: this._cleanAbilityManager(),
                    saveProgress: this.onSaveProgress,
                    audio: this.audio ?? undefined,
                    onResetGame: this.onResetGameCallback ?? undefined,
                    circusQuestProgress: this.circusQuestProgress,
                    murderQuestProgress: this.murderQuestProgress,
                    anchorQuestProgress: this.anchorQuestProgress,
                    journalProgress: this.journalProgress,
                    bountyProgress: this.bountyProgress,
                    doomsdayQuestProgress: this.doomsdayQuestProgress,
                    clubMembership: this.clubMembership,
                    townMemory: this.townMemory,
                    marketStock: this.marketStock,
                    mercenaryRoster: this.mercenaryRoster,
                    godModeState: this.godModeState,
                    companionStance: this.companionStance,
                    gameStats: this.gameStats,
                    skipIntro: true,
                  }),
                );
              },
              this.humanAchievements,
              this.catAchievements,
              this.audio ?? undefined,
              this.abilityManager,
              { progress: this.circusQuestProgress, overworldCentre: this.gameMap.circusCentre },
              this.murderQuestProgress,
              this.doomsdayQuestProgress,
              this.clubMembership,
              this.townMemory,
              this.mercenaryRoster,
              this.godModeState,
              this.companionStance,
              this.mongoPetState,
              () => this.abilityManager.getLevel('mongo'),
              this.gameStats,
              this.anchorQuestProgress,
            ),
          );
        },
        {
          blockedMessage: (entry) => this.sealedBuildingMessage(entry),
          onRefused: (message) => {
            this.audio?.play('error');
            this.menus.hotbarToast.show(message);
          },
        },
      );
      this.noticeBoard = new NoticeBoardPanel();
      this.marketPanel = new PricedMenuPanel();
      this.fortuneTeller = new FortuneTellerPanel();
      // Both built before TownLifeSystem so their blocked tiles are excluded from
      // the citizen spawn candidates — and the market first, so the other props
      // can steer clear of the stall footprints it claims.
      this.market = new MarketSystem(
        this.gameMap,
        this.marketStock,
        (browse) => this.openMarketStall(browse),
        () => this.marketPanel?.isOpen === true,
        () => this.audio,
        // Resolved lazily: the quest system is built after the market, and a
        // stall is only ever browsed long after both exist.
        (gate) => this.anchorQuest.isVendorLineOffered(gate),
      );
      this.townProps = new TownPropSystem(
        this.gameMap,
        () => this.openNoticeBoard(),
        () => this.openFortuneTeller(),
        () => this.audio,
        this.market.reservedTiles,
      );
      // Claimed before the decor system copies the reserved set, or a lamp post
      // is planted on the tile the bounty giver is about to stand on.
      const bountyGiverTile = this.townProps.claimBountyGiverTile();
      this.townDecor = new TownDecorSystem(
        this.gameMap,
        new Set([...this.market.reservedTiles, ...this.townProps.reservedTiles]),
      );
      this.townPropRenderables = [
        ...this.market.props,
        ...this.townProps.props,
        ...this.townDecor.props,
      ];
      this.townLife = new TownLifeSystem(this.gameMap);
      this.bounty = new BountySystem(
        this.gameMap,
        this.bus,
        this.bountyProgress,
        (mob) => this.world.roster.add(mob),
        this.audio,
      );
      if (bountyGiverTile !== null) {
        this.bounty.placeShady(bountyGiverTile);
      } else {
        // No room beside the board — he cannot be talked to, so send the collect
        // arrow to the board itself rather than nowhere.
        const boardTile = this.townProps.boardTile;
        if (boardTile !== null) {
          this.bounty.setCollectPoint(
            (boardTile.x + TILE_CENTER_OFFSET) * TILE_SIZE,
            (boardTile.y + TILE_CENTER_OFFSET) * TILE_SIZE,
          );
        }
      }
      this.townGuide = new TownGuideSystem(
        this.gameMap,
        this.townProps.boardTile,
        this.journalProgress,
      );
    }

    this.achievementUI = new AchievementUISystem(
      this.humanAchievements,
      this.catAchievements,
      this.human,
      this.cat,
      this.audio,
    );
    // Boss-style so the pile never fades: an achievement pays out once, and a
    // reward that expired on the floor could not be earned a second time.
    this.achievementUI.onRewardOverflow = (player, id, quantity) => {
      this.destruction.loot.addLoot(
        player.x + TILE_SIZE * TILE_CENTER_OFFSET,
        player.y + TILE_SIZE * TILE_CENTER_OFFSET,
        { coins: 0, items: [{ id, quantity }] },
        player,
        true,
      );
    };

    if (tutorialController !== null) {
      const tut = tutorialController;
      this.achievementUI.onAllBoxesOpened = () => {
        tut.onHumanRewardDialogDismissed(this.human);
        this.bus.emit('rewardGranted', {
          rewards: [this._makeAbilityReward('smush'), this._makeAbilityReward('protective_shell')],
        });
      };
    }

    this.floorEntryHumanAchievements =
      options?.floorEntryHumanAchievements ?? this.humanAchievements.clone();
    this.floorEntryCatAchievements =
      options?.floorEntryCatAchievements ?? this.catAchievements.clone();

    // Built here rather than as a field initialiser because it needs both the
    // shared pet state and a live read of the pet's ability level.
    // Seeded against whatever level the restored ability manager carries, not
    // against level 1: an older save with no stored pet HP but a level-10 Mongo
    // would otherwise boot him at 20 of 130 and make the player wait out a
    // quarter of an hour of regen he never spent.
    const petMaxHp = getMongoStats(this.abilityManager.getLevel('mongo')).maxHp;
    this.mongoPetState = options?.mongoPetState ?? createMongoPetState(petMaxHp, petMaxHp);
    this.mongoSystem = new MongoSystem(
      this.mongoPetState,
      () => this.abilityManager.getLevel('mongo'),
      (amount) => {
        this.abilityManager.addXp('mongo', amount);
      },
      () => this.mongoXpFraction(),
      (message) => this.menus.hotbarToast.show(message),
    );
    if (options?.mongoUnlocked) {
      this.mongoSystem.unlocked = true;
    }
    this.floorEntryAbilityManager =
      options?.floorEntryAbilityManager ?? this.abilityManager.clone();
    this.abilityManager.onLevelUp = (id, newLevel) => {
      if (id === 'mongo') this.mongoSystem.onPetLevelUp();
      if (id === 'magic_missile' && newLevel >= MAGIC_MISSILE_TALISMAN_LEVEL) {
        this.unlockFirstHundred();
      }
      const def = this.abilityManager.getDef(id);
      if (def === null) return;
      this.menus.cancelInventoryDragForOverlay();
      this.menus.levelUpDialog.enqueue({
        name: def.name,
        newLevel,
        perkDescription: def.perks.find((p) => p.level === newLevel)?.description ?? null,
        renderIcon: def.renderIcon,
      });
      this.audio?.play('ability_level_up');
    };
    this.cat.setAbilityManager(this.abilityManager);
    this.human.setAbilityManager(this.abilityManager);

    // Re-apply cheat overlays carried in from the previous scene. God mode is an
    // overlay on top of base stats and so is never present in a snapshot — an
    // active cheat has to be rebuilt here rather than surviving in the stats.
    this.chat.applyCarriedCheat();

    this.onSaveProgress = options?.saveProgress;
    this.checkpoint = options?.checkpoint ?? null;
    this.onResetGameCallback = options?.onResetGame ?? null;
    // Additive and cheap even on a re-entry: `preload` skips any id already in
    // `buffers`, so this just tops up whatever this floor needs without
    // re-decoding what a previous floor already loaded. This is the per-floor
    // SFX unload/reload cycle: only the current floor's sounds stay resident.
    void this.audio?.preload(sfxGroupsForLevelId(levelDef.id));
    // Same "additive, cheap on re-entry" reasoning as the SFX preload above,
    // for this floor's declared sprite groups.
    // `prewarmGroups` also forces each sheet's GPU texture upload during this
    // floor's fade-in rather than on whichever frame first draws it.
    // Still fire-and-forget: this must not block scene construction/rendering.
    // Bounty/quest-system-introduced creatures aren't covered here — those
    // stay on the lazy load-on-miss path (`SpriteLoader.getSpriteDef`
    // schedules a load the first time a sprite is requested and fails safe
    // until it resolves) except bounties, which `BountySystem.stageEncounter`
    // pre-warms itself well before the fight starts.
    // Ground tiles and decorations bake into cached chunk canvases the first
    // time they're drawn (see `TileChunkCache`), which — unlike a plain sprite
    // draw — never looks again once baked. A chunk near the player can bake
    // before this floor's sheets finish loading, locking in the fallback
    // colors/art forever. Re-baking once the whole group is confirmed loaded
    // turns that into the intended "wrong for a frame or two", not permanent.
    void prewarmGroups(levelDef.spriteGroups).then(() => this.gameMap.invalidateAllTileArt());
    this.spiderQuest.setSongClock(() => this.audio?.getKeyboardHeroMusicTimeMs() ?? null);
    if (this.townLife !== null && this.audio !== null) {
      this.citizenDialog = new CitizenDialog(this.audio);
    }
    this.skipIntro = options?.skipIntro ?? false;
    if (this.skipIntro) this.dungeonIntro.skip();
    this.overworldMusic =
      levelDef.isOverworld && this.audio !== null
        ? new OverworldMusicSystem(this.gameMap, this.audio)
        : null;
    this.ambientSound =
      levelDef.isOverworld && this.audio !== null
        ? new AmbientSoundSystem(this.audio, this.buildTownAmbientEmitters())
        : null;
    // Constructed after audio/music so the quest can drive battle tracks;
    // stage re-entry may spawn mobs immediately.
    this.circusQuest = new CircusQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => this.world.roster.add(mob),
      this.mongoSystem,
      this.circusQuestProgress,
      this.overworldMusic,
      this.audio,
      this.active(),
    );
    this.murderQuest = new MurderMysteryQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => this.world.roster.add(mob),
      this.murderQuestProgress,
      this.overworldMusic,
      this.audio,
    );
    // Reads the plaza's fortune tile and the tinker's counter through accessors
    // rather than holding either system: both are null on floors with no town.
    this.anchorQuest = new AnchorQuestSystem(
      this.bus,
      this.anchorQuestProgress,
      () => [this.human, this.cat],
      () => propBeaconTarget(this.townProps?.fortuneTellerTile ?? null),
      () => stallBeaconTarget(this.market?.stallTileFor(TINKER_VENDOR_ID) ?? null),
      (buildingName) =>
        doorwayBeaconTarget(
          this.gameMap.buildingEntries.find((entry) => entry.name === buildingName) ?? null,
        ),
      (message) => this.menus.announce(message),
      this.audio,
    );
    this.doomsdayEscape = new DoomsdayEscapeSystem(this.gameMap, this.doomsdayQuestProgress);
    if (this.tutorial !== null && this.audio !== null) {
      this.tutorial.setAudio(this.audio);
    }
    if (this.audio !== null) {
      aiAdapter.messages.setAudio(this.audio);
    }
    this.menus.pauseMenu.onResetGame = this.onResetGameCallback;
    this.menus.pauseMenu.skipAudioPause = () =>
      this.tutorial !== null &&
      (this.tutorial.state === 'HUMAN_OPENED_ACHIEVEMENT' ||
        this.tutorial.state === 'CAT_OPENED_TREASURE_BOX');
    this.menus.pauseMenu.onOpenChat = () => {
      this.menus.pauseMenu.close();
      this.triggerOpenChat();
    };

    const openInventoryFor = (player: HumanPlayer | CatPlayer): void => {
      this.menus.openInventoryFor(player, () => this.menus.pauseMenu.openToInventory());
    };
    this.menus.pauseMenu.onManageHumanInventory = () => openInventoryFor(this.human);
    this.menus.pauseMenu.onManageCatInventory = () => openInventoryFor(this.cat);

    this.gameMap.bossRooms.forEach((br, i) => {
      const cx = br.centre.x;
      const cy = br.centre.y - BOSS_CHEST_TILES_NORTH;
      this.treasureChests.addBossChest(cx, cy, i);
      this.gameMap.blockTilePermanently(cx, cy);
    });

    // Wooden chests for treasure rooms
    for (const tr of this.gameMap.treasureRooms) {
      const coins = randomInt(MIN_COIN_DROP, MAX_COIN_DROP);
      const items: LootDrop['items'] = [];
      const roll = Math.random();
      if (roll < LOW_HP_LOOT_CHANCE) {
        items.push({ id: 'health_potion', quantity: randomInt(1, 2) });
      } else if (roll < MED_HP_LOOT_CHANCE) {
        items.push({ id: 'scroll_of_confusing_fog', quantity: 1 });
      }
      items.push({ id: rollChestPotion(), quantity: 1 });
      this.treasureChests.addWoodenChest(tr.centre.x, tr.centre.y, tr.bounds, {
        coins,
        items,
      });
      this.gameMap.blockTilePermanently(tr.centre.x, tr.centre.y);
    }

    // Wire chest opened callback
    this.treasureChests.setOnOpen((chest) => {
      const tutorial = this.tutorial;
      if (tutorial !== null && tutorial.state === 'CAT_INSIDE_TREASURE_ROOM') {
        const catRewardSplit: ChestLootSplit = {
          humanLoot: { coins: 0, items: [] },
          catLoot: {
            coins: 0,
            items: [
              { id: 'magic_missile_tome', quantity: 1 },
              { id: 'health_potion', quantity: 10 },
            ],
          },
          displayLabels: { magic_missile_tome: 'Magic Missile Ability' },
        };
        this.chestRewardDialog.open(chest, catRewardSplit, () => {
          tutorial.onCatRewardDialogDismissed(this.cat);
          this.bus.emit('rewardGranted', {
            rewards: [this._makeAbilityReward('magic_missile')],
          });
        });
        this.audio?.play('opening_treasure_chest');
        return;
      }

      // Krakaren boss chest: append "Mongo (pet)" to the cat column and trigger the reward dialog
      if (chest.bossRoomIndex !== null && chest.bossRoomIndex === this.krakarenBossRoomIdx) {
        const baseSplit = chest.loot !== null ? splitChestLoot(chest.loot) : null;
        this._grantChestLootSplit(baseSplit);
        this.tutorial?.onChestOpened();
        const krakarenSplit: ChestLootSplit = {
          humanLoot: baseSplit?.humanLoot ?? { coins: 0, items: [] },
          catLoot: baseSplit?.catLoot ?? { coins: 0, items: [] },
          customCatEntries: ['Mongo (pet)'],
        };
        this.chestRewardDialog.open(chest, krakarenSplit, () => {
          this.mongoSystem.unlocked = true;
          this.bus.emit('rewardGranted', { rewards: [this._makeMongoReward()] });
        });
        this.audio?.play('opening_treasure_chest');
        return;
      }

      if (chest.bossRoomIndex !== null && chest.bossRoomIndex === this.juicerBossRoomIdx) {
        const baseSplit = chest.loot !== null ? splitChestLoot(chest.loot) : null;
        this._grantChestLootSplit(baseSplit);
        this.tutorial?.onChestOpened();
        const juicerSplit: ChestLootSplit = {
          humanLoot: baseSplit?.humanLoot ?? { coins: 0, items: [] },
          catLoot: baseSplit?.catLoot ?? { coins: 0, items: [] },
          customHumanEntries: [DESPERADO_TATTOO_REWARD_LABEL],
        };
        this.chestRewardDialog.open(chest, juicerSplit);
        this.audio?.play('opening_treasure_chest');
        return;
      }

      const split = chest.loot !== null ? splitChestLoot(chest.loot) : null;
      this._grantChestLootSplit(split);
      this.tutorial?.onChestOpened();
      this.chestRewardDialog.open(chest, split);
      this.audio?.play('opening_treasure_chest');
    });

    this.treasureChests.setOnLockedAttempt(() => {
      this.audio?.play('chest_locked');
    });
    this.treasureChests.setOnWoodenChestUnlocked(() => {
      this.audio?.play('chest_unlocked_in_treasure_room');
    });

    this.wireEventBus();
    this.checkFloorEntryAchievements();
    aiAdapter.bindScene(this.createAISceneContext(), this.bus);
  }

  /**
   * One-shot awards decided by the state the party arrives in rather than by
   * anything they do on the floor. Runs after the bus is wired so the unlock is
   * heard, and the retroactive Magic Missile check is here because a resumed
   * save restores ability levels silently — `onLevelUp` never fires for a level
   * the crawler reached in an earlier session.
   */
  private checkFloorEntryAchievements(): void {
    if (this.tutorial !== null) return;
    if (this.human.inventory.equipment.getEquippedItem('Legs:Pants') === null) {
      if (this.humanAchievements.tryUnlock('no_pants')) {
        this.bus.emit('achievementUnlocked', { achievementId: 'no_pants', player: 'Human' });
      }
    }
    if (this.abilityManager.getRealLevel('magic_missile') >= MAGIC_MISSILE_TALISMAN_LEVEL) {
      this.unlockFirstHundred();
    }
  }

  private unlockFirstHundred(): void {
    if (this.tutorial !== null) return;
    if (this.catAchievements.tryUnlock('first_hundred')) {
      this.bus.emit('achievementUnlocked', { achievementId: 'first_hundred', player: 'Cat' });
    }
  }

  /**
   * Whether the Juicer is dead and none of his gateway guards are still
   * standing — the pair of conditions the Big Brawler award needs, which can
   * complete in either order.
   */
  private juicerGauntletFullyCleared(): boolean {
    if (!this.juicerKilled) return false;
    // -1 on a level with no Juicer gauntlet, which leaves no centre to measure
    // his guards against.
    if (this.juicerBossRoomIdx < 0) return false;
    const room = this.gameMap.bossRooms[this.juicerBossRoomIdx];
    const guards = this.countLivingMobsOfTypeNear(
      TROGLODYTE_SPAWN_KEY,
      room.centre.x * TILE_SIZE,
      room.centre.y * TILE_SIZE,
      BIG_BRAWLER_GUARD_RADIUS,
    );
    return guards === 0;
  }

  private tryUnlockBigBrawler(): void {
    if (this.tutorial !== null) return;
    if (!this.juicerGauntletFullyCleared()) return;
    if (this.humanAchievements.tryUnlock('big_brawler')) {
      this.bus.emit('achievementUnlocked', { achievementId: 'big_brawler', player: 'Human' });
    }
  }

  /** Which boss room holds the given world-pixel position, or -1 if none does. */
  private bossRoomIndexContaining(x: number, y: number): number {
    const tileX = Math.round(x / TILE_SIZE);
    const tileY = Math.round(y / TILE_SIZE);
    return this.gameMap.bossRooms.findIndex(
      (br) =>
        tileX >= br.bounds.x &&
        tileX < br.bounds.x + br.bounds.w &&
        tileY >= br.bounds.y &&
        tileY < br.bounds.y + br.bounds.h,
    );
  }

  /**
   * How many living mobs from a given spawn-table key are inside the patch of
   * map centred on (x, y) — the encounter's own neighbourhood, not the floor.
   */
  private countLivingMobsOfTypeNear(type: string, x: number, y: number, radius: number): number {
    let count = 0;
    for (const mob of this.world.roster.grid.queryCircle(x, y, radius)) {
      if (mob.isAlive && mob.spawnTypeKey === type) count++;
    }
    return count;
  }

  /**
   * Unlocks the silver chest of any boss room that has just been marked
   * defeated and whose chest the kill pipeline left shut.
   *
   * The pipeline is the mechanism; this is the net under it. The `mobKilled`
   * handler fills the chest only when somebody was credited with damage, so a
   * boss killed with an empty ledger — by the environment, or by anything that
   * empties its HP without an attacker — left an open door, a visibly dead boss
   * and a chest locked for the rest of the run. That failure has already cost a
   * playtest once, which is why it gets a net at all.
   *
   * It cannot race the pipeline: `BossRoomSystem.update` sees a death that
   * `resolveKills` resolved on the *previous* frame, so `mobKilled` has always
   * had its turn by the time a room lands in this queue.
   */
  private backfillDefeatedBossChests(): void {
    const defeated = this.bossRoom.newlyDefeatedRooms;
    if (defeated.length === 0) return;
    for (const { roomIndex, boss } of defeated) {
      if (!this.treasureChests.hasLockedBossChest(roomIndex)) continue;
      // A fresh roll when the boss has none left: either its table came up
      // empty or the loot has already been spent elsewhere, and a silver boss
      // chest that opens on nothing reads as the bug this method exists to fix.
      const loot = boss.droppedLoot ?? boss.rollLootDrop(null);
      boss.droppedLoot = null;
      this.treasureChests.receiveBossLoot(roomIndex, loot);
    }
    defeated.length = 0;
  }

  /** Fires once, the frame the floor's last gauntlet boss dies. */
  private static readonly STAIRWELL_HINT_ANNOUNCEMENT =
    'The floor shudders. Something has opened below — your map remembers where.';

  /** Fires once, the first time the Wayfinder fail-safe shows its arrow. */
  private static readonly WAYFINDER_ANNOUNCEMENT =
    'Your whiskers catch a draft… something below is breathing.';

  private wireEventBus(): void {
    const bus = this.bus;

    bus.on('spawnGore', (e) => {
      this.combat.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });

    // ── stats tracking ──
    bus.on('mobKilled', (e) => this.gameStats.recordKill(e.mob.displayName));
    bus.on('healingPotionUsed', () => this.gameStats.recordPotionUsed());

    // ── difficulty telemetry ──
    // Separate from `gameStats` because these counters have to survive the
    // stairwell that rebuilds this scene; see `DifficultyStats`.
    difficultyStats.setFloor(this.levelDef.floorNumber);
    bus.on('healingPotionUsed', () => difficultyStats.recordPotionUsed());
    bus.on('playerDodged', () => difficultyStats.recordDodge());
    bus.on('bossDefeated', (e) => difficultyStats.noteBossDefeated(e.bossType));

    // The stairwell hunt is measured from the *last* gauntlet boss, not any
    // named one, so floor 2's single-boss gauntlet and floor 1's two-boss one
    // both fall out of the same lookup.
    const gauntlets = this.levelDef.progression?.gauntlets;
    const lastGauntletBossType = gauntlets ? gauntlets[gauntlets.length - 1]?.bossType : undefined;
    bus.on('bossDefeated', (e) => {
      if (e.bossType !== lastGauntletBossType) return;
      difficultyStats.startStairwellHunt();
      this.stairwell.armWayfinder();

      const bossTX = Math.floor((e.mob.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
      const bossTY = Math.floor((e.mob.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
      const nearestStairwell = this.stairwell.nearestStairwellTile({ x: bossTX, y: bossTY });
      if (nearestStairwell !== undefined) {
        this.miniMap.revealStairwellNeighborhood(nearestStairwell);
        if (!this.stairwellHintAnnounced) {
          this.stairwellHintAnnounced = true;
          this.menus.announce(DungeonScene.STAIRWELL_HINT_ANNOUNCEMENT);
        }
      }
    });
    bus.on('stairwellFound', () => {
      difficultyStats.finishStairwellHunt();
      this.stairwell.retireWayfinder();
    });
    bus.on('fastTravelUsed', () => {
      this.anchorQuestProgress.recallEverUsed = true;
    });

    // ── mobKilled: corpse marker, achievements, loot, grub spawns ──
    bus.on('mobKilled', (e) => {
      const { mob, killer, topDamageDealer } = e;
      const cx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const cy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET;

      // Only a kill the party earned. Mobs kill each other — friendly fire, a
      // confusion fog, a bounty boss clearing the room it spawned into — and
      // none of that is the player pressing forward.
      if (killer !== null) this.mongoSystem.onKill();

      this.combat.spawnKillGore(mob, killer);
      this.miniMap.addCorpseMarker(cx, cy);

      if (killer === this.human && this.humanAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Human' });
        if (this.tutorial !== null) {
          this.humanAchievements.grantBox('Gold', 'Tutorial', 'first_blood');
        }
      }
      if (killer === this.cat && this.catAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Cat' });
        if (this.tutorial !== null) {
          const emptySlot = this.cat.inventory.bag.slots.findIndex((s) => s === null);
          if (emptySlot >= 0) {
            this.cat.inventory.bag.slots[emptySlot] = { ...ITEM_DEF.health_potion, quantity: 10 };
          }
        }
      }

      if (
        this.tutorial === null &&
        killer === this.human &&
        (mob.killType === 'melee' || mob.killType === 'smush')
      ) {
        if (this.humanAchievements.tryUnlock('smush')) {
          bus.emit('achievementUnlocked', { achievementId: 'smush', player: 'Human' });
        }
      }

      if (this.tutorial === null && killer === this.cat && mob.killType === 'missile') {
        if (this.catAchievements.tryUnlock('magic_touch')) {
          bus.emit('achievementUnlocked', { achievementId: 'magic_touch', player: 'Cat' });
        }
      }

      // The archer is a goblin to the player even though it descends from `Mob`
      // rather than from `Goblin`, so it is named alongside it.
      if (
        this.tutorial === null &&
        killer === this.human &&
        mob.killType === 'smush' &&
        (mob instanceof Goblin || mob instanceof GoblinArcher)
      ) {
        if (this.humanAchievements.tryUnlock('podophilia')) {
          bus.emit('achievementUnlocked', { achievementId: 'podophilia', player: 'Human' });
        }
      }

      if (mob.spawnTypeKey === TROGLODYTE_SPAWN_KEY) {
        this.tryUnlockBigBrawler();
      }

      if (mob.droppedLoot && topDamageDealer) {
        if (mob.isBoss) {
          // Boss loot goes into the boss chest, not the floor
          const mobTileX = Math.round(mob.x / TILE_SIZE);
          const mobTileY = Math.round(mob.y / TILE_SIZE);
          const bossRoomIdx = this.gameMap.bossRooms.findIndex(
            (br) =>
              mobTileX >= br.bounds.x &&
              mobTileX < br.bounds.x + br.bounds.w &&
              mobTileY >= br.bounds.y &&
              mobTileY < br.bounds.y + br.bounds.h,
          );
          // Onto the floor when no chest took it — a boss standing outside every
          // boss room the map knows about, or one whose chest is already open.
          // Tested rather than assumed: this used to discard the drop on the
          // strength of having called `receiveBossLoot`, whether or not the call
          // found anything. Still partitioned by owner even down this path — The
          // Hoarder's guaranteed Cockroach book is the cat's only reliable
          // source and must never land on the human.
          // `hasLockedBossChest` is asked first because `receiveBossLoot` warns
          // on a miss, and a boss room whose chest has already been opened is a
          // legitimate miss rather than the silent failure that warning exists
          // to catch.
          const chestTookIt =
            bossRoomIdx >= 0 &&
            this.treasureChests.hasLockedBossChest(bossRoomIdx) &&
            this.treasureChests.receiveBossLoot(bossRoomIdx, mob.droppedLoot);
          if (!chestTookIt) {
            this.dropLootByOwner(cx, cy, mob.droppedLoot, topDamageDealer, true);
          }
        } else {
          this.dropLootByOwner(cx, cy, mob.droppedLoot, topDamageDealer, false);
        }
        mob.droppedLoot = null;
      }

      // The Ball of Swine is the one boss that does not carry the `isBoss` flag:
      // the arena owns it, not `BossRoomSystem`, and that flag is what commits a
      // mob to a room lock and a clamp it has no room for. Its death is a boss
      // defeat all the same, and the arena's second wave waits on this event.
      if (mob.isBoss || mob instanceof BallOfSwine) {
        // One emit per boss, named by its spawn key. Every listener that cares
        // *which* boss died — the Mongo unlock, the difficulty stats, the arena
        // — is written in snake_case spawn keys, and the class name this used
        // to send was a second vocabulary they did not speak, so the Hoarder
        // and the Juicer were never recorded as beaten. The Krakaren papered
        // over its own case by announcing itself a second time under its real
        // name, which cost a duplicate boss-slayer loot box per crawler.
        bus.emit('bossDefeated', {
          bossType: mob.spawnTypeKey ?? (mob.constructor.name || 'unknown'),
          mob,
        });
      }

      if (this.levelDef.onMobKilledSpawns) {
        for (const rule of this.levelDef.onMobKilledSpawns) {
          if (mob instanceof BrindleGrub && rule.type === 'brindle_grub') continue;
          if (mob instanceof SmallSpider) continue;
          const tx = Math.round(mob.x / TILE_SIZE);
          const ty = Math.round(mob.y / TILE_SIZE);
          // Bounded against what is alive *here*, not against the floor. The
          // rule fires on any mob dying, so an unbounded version compounds into
          // a swarm — but grubs left behind in rooms the party has already
          // cleared are neither a threat nor a cost, and counting them starved
          // every later encounter of the burst that makes the rule interesting.
          const alreadyAliveNearby = this.countLivingMobsOfTypeNear(
            rule.type,
            mob.x,
            mob.y,
            ON_KILL_SPAWN_CAP_RADIUS,
          );
          const headroom = MAX_CONCURRENT_ON_KILL_SPAWNS - alreadyAliveNearby;
          if (headroom <= 0) continue;
          const count = Math.min(headroom, randomInt(rule.minCount, rule.maxCount));
          for (let i = 0; i < count; i++) {
            let placed = false;
            for (let attempt = 0; attempt < SPIT_PLACEMENT_ATTEMPTS && !placed; attempt++) {
              const ox = Math.floor(
                (Math.random() - SPIT_PLACEMENT_RANDOMNESS) * rule.spreadRadius * 2,
              );
              const oy = Math.floor(
                (Math.random() - SPIT_PLACEMENT_RANDOMNESS) * rule.spreadRadius * 2,
              );
              const gtx = tx + ox;
              const gty = ty + oy;
              if (!this.gameMap.isWalkable(gtx, gty)) continue;
              const spawned = createMob(rule.type, gtx, gty, this.gameMap);
              // Inherited rather than left at 1: these burst out of a mob the
              // party has just fought, and a level-1 grub swarm on floor 2 was
              // free XP that arrived exactly when the fight should be hardest.
              spawned.applyMobLevel(mob.mobLevel);
              applyActiveDifficultyRewards(spawned);
              this.world.roster.add(spawned);
              placed = true;
            }
          }
        }
      }
    });

    bus.on('bossDefeated', (e) => {
      if (this.tutorial === null) {
        if (this.humanAchievements.tryUnlock('boss_slayer')) {
          bus.emit('achievementUnlocked', { achievementId: 'boss_slayer', player: 'Human' });
        } else {
          this.humanAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
        }
        if (this.catAchievements.tryUnlock('boss_slayer')) {
          bus.emit('achievementUnlocked', { achievementId: 'boss_slayer', player: 'Cat' });
        } else {
          this.catAchievements.grantBox('Bronze', 'Boss', 'boss_slayer');
        }
      }
      const bossLabel = `Defeated boss: ${e.bossType.replace(/_/g, ' ')}`;
      this.humanAchievements.logRecentEvent(bossLabel);
      this.catAchievements.logRecentEvent(bossLabel);

      if (e.bossType === 'krakaren_clone' && !this.krakarenKilled) {
        this.krakarenKilled = true;
        this.krakarenBossRoomIdx = this.bossRoomIndexContaining(e.mob.x, e.mob.y);
      }

      if (e.bossType === 'juicer' && !this.juicerKilled) {
        this.juicerKilled = true;
        this.human.hasDesperadoPassTattoo = true;
        this.cat.hasDesperadoPassTattoo = true;
        // Announced here as well as on the chest, so a player who walks past the
        // chest still learns the Club will now let them in.
        this.human.queueSystemNotice(DESPERADO_TATTOO_NOTICE);
        this.tryUnlockBigBrawler();
      }
    });

    bus.on('multiKill', (e) => {
      if (this.tutorial !== null) return;
      if (e.count < MULTIKILL_ACHIEVEMENT_THRESHOLD) return;
      if (this.humanAchievements.tryUnlock('crowd_control')) {
        bus.emit('achievementUnlocked', { achievementId: 'crowd_control', player: 'Human' });
      }
    });

    bus.on('rewardGranted', (e) => {
      for (const reward of e.rewards) {
        this.menus.cancelInventoryDragForOverlay();
        this.menus.rewardGrantedDialog.enqueue(reward);
      }
    });

    bus.on('playerLevelUp', (e) => {
      const isHuman = e.player === this.human;
      const who = isHuman ? 'Human' : 'Cat';
      const mgr = isHuman ? this.humanAchievements : this.catAchievements;
      mgr.logRecentEvent(`${who} reached level ${e.newLevel}`);
    });

    bus.on('safeRoomEntered', () => {
      if (this.tutorial === null && this.humanAchievements.tryUnlock('safe_haven')) {
        bus.emit('achievementUnlocked', { achievementId: 'safe_haven', player: 'Human' });
      }
      if (this.tutorial === null && this.catAchievements.tryUnlock('safe_haven')) {
        bus.emit('achievementUnlocked', { achievementId: 'safe_haven', player: 'Cat' });
      }
      this.onSaveProgress?.({
        humanSnap: revivedSnapshot(snapPlayer(this.human)),
        catSnap: revivedSnapshot(snapPlayer(this.cat)),
        levelId: this.levelDef.id,
        abilityStates: this.abilityManager.serializeStates(),
        mongoUnlocked: this.mongoSystem.unlocked,
        // The system's accessor, not the stored value: both of these saves can
        // fire with Mongo still out, and the stored value is only written back
        // when he despawns — so a safe room entered with a 5/130 raptor at the
        // player's heel was recording 130.
        mongoPetHp: this.mongoSystem.hp,
        mongoPetResting: this.mongoSystem.restingUntilFull,
      });

      // Skipped in the tutorial, matching the achievement unlocks above — the
      // tutorial has its own hand-scripted flow and never reaches death-restart.
      if (this.tutorial === null) {
        // The event fires from `pm.isAnySafe()`, which can be true for the
        // inactive crawler while the active one is still outside the room
        // bounds — guard rather than assert on a missing room.
        const roomInfo = this.safeRoom.safeRoomInfoAt(this.active());
        if (roomInfo !== null) {
          this.markMobsAtCheckpoint();
          this.checkpoint = {
            world: this.captureWorldCheckpoint(),
            humanSnap: checkpointSnapshot(snapPlayer(this.human)),
            catSnap: checkpointSnapshot(snapPlayer(this.cat)),
            abilities: this.abilityManager.clone(),
            humanAchievements: this.humanAchievements.clone(),
            catAchievements: this.catAchievements.clone(),
            respawnX: roomInfo.centre.x * TILE_SIZE,
            respawnY: roomInfo.centre.y * TILE_SIZE,
            levelTimerFrames: this.levelTimerFrames,
          };
          this.menus.hotbarToast.show(PROGRESS_SAVED_TOAST_TEXT);
        }
      }
    });

    // Whatever the player just picked up is what they mean to do next, so the
    // Journal opens already showing it and the world arrow already points at it,
    // rather than waiting for a pin the player has to know exists.
    //
    // The quest's own id, not the id of whichever step is being tracked right
    // now: the anchor questline re-keys its entry per shard, and a pin on one
    // shard's row would die the moment that shard was found. `pinMatchesEntry`
    // is what lets the shorter id keep resolving.
    bus.on('questStarted', (e) => {
      this.journalProgress.pinnedTrackerId = e.questId;
    });

    bus.on('questCompleted', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        const def = this.defendQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().coins += def.rewards.coins;
        }
        this.humanAchievements.grantBox('Silver', 'Adventurer', 'quest_defend_npc');
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
      if (e.questId === 'grotesque_spider') {
        if (this.human.gainXp(SPIDER_QUEST_COMPLETION_XP)) {
          this.bus.emit('playerLevelUp', { player: this.human, newLevel: this.human.level });
        }
        if (this.cat.gainXp(SPIDER_QUEST_COMPLETION_XP)) {
          this.bus.emit('playerLevelUp', { player: this.cat, newLevel: this.cat.level });
        }
        // Straight to the cat: the lab's dark is what the book is about, and she
        // is the only crawler who can read it.
        this.cat.inventory.addItem('skill_book_night_vision', 1);
      }
      if (e.questId === 'the_show_must_go_on') {
        const def = this.circusQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().coins += def.rewards.coins;
        }
      }
      if (e.questId === MURDER_QUEST_ID) {
        const def = this.murderQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().coins += def.rewards.coins;
        }
      }
    });

    bus.on('questFailed', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
    });

    this.audio?.wireEvents(bus, this.levelDef.music);
  }

  onEnter(): void {
    // Level entry is the one stretch of real rendering the player cannot act
    // during, which is what makes it usable cover for the quality probe.
    renderQuality.requestProbe();
    this.audio?.resume();
    // Delay intro ticking until the AudioContext is running so the intro sound
    // plays in sync with the visual. On desktop this is nearly instant; on mobile
    // it waits for the first user gesture and shows a "Tap to begin" prompt.
    const TUTORIAL_MUSIC_VOLUME = 0.25;
    const startIntro = (): void => {
      this.introStarted = true;
      if (this.tutorial !== null) {
        this.audio?.setMusicVolume(TUTORIAL_MUSIC_VOLUME);
        this.audio?.playMusic('tutorial_island', { fadeInMs: MUSIC_FADE_IN_MS });
      } else {
        if (!this.skipIntro) this.audio?.playWhenReady('level_begins');
        // Overworld music is zone-driven (town/wilds/circus) by OverworldMusicSystem.
        if (this.overworldMusic === null && this.audio?.currentMusicId !== this.levelDef.music) {
          this.audio?.playMusic(this.levelDef.music, { fadeInMs: MUSIC_FADE_IN_MS });
        }
      }
    };
    if (this.audio === null || this.audio.isRunning) {
      startIntro();
    } else {
      this.audio.onRunning(startIntro);
    }

    this._spiderKeyHandler = (e: KeyboardEvent) => {
      // The Bopca's three-way choice is picked with 1/2/3, which the hotbar also
      // owns. Stopped rather than merely defaulted: the shared handler's
      // suppression gate reads whether her dialog is open *after* this ran, and
      // the choice that closes it — "leave" — would otherwise land on a hotbar
      // slot on its way out.
      if (this.bopca.handleKeyDown(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      this.spiderQuest.handleKeyDown(e.key, e.timeStamp);
    };
    window.addEventListener('keydown', this._spiderKeyHandler);

    this.inputHandler.bind({
      // Reads the overlay registry rather than its own list, so that a hotbar key
      // pressed under an award overlay cannot queue a second read behind it,
      // stacking a prompt whose Read button the overlay's own OK then swallows.
      isSuppressed: () => keyboardSuppressed(this.overlayClaims),
      isGameOver: () => this.gameOver,
      dismissChestDialog: () => this.chestRewardDialog.handleKeyDown(),
      dismissDialog: () => {
        if (this.menus.skillBookPrompt.isOpen) {
          // Escape declines the read; the book stays in the pack.
          this.menus.skillBookPrompt.close();
          this.menus.releaseSkillBookReader();
          return true;
        }
        if (this.chat.isOpen) {
          this.chat.cancel();
          return true;
        }
        if (this.defendQuest.dismissDialog()) return true;
        if (this.spiderQuest.dismissDialog()) return true;
        if (this.bounty?.dismissDialog() === true) return true;
        if (this.circusQuest.dismissDialog()) return true;
        if (this.murderQuest.dismissDialog()) return true;
        if (this.anchorQuest.dismissDialog()) return true;
        if (this.noticeBoard?.isOpen === true) {
          this.noticeBoard.close();
          return true;
        }
        if (this.marketPanel?.isOpen === true) {
          this.marketPanel.close();
          return true;
        }
        if (this.fortuneTeller?.isOpen === true) {
          this.fortuneTeller.close();
          return true;
        }
        if (this.safeRoom.mordecaiDialogOpen) {
          this.safeRoom.mordecaiDialogOpen = false;
          return true;
        }
        if (this.bopca.dismissDialog()) return true;
        // Last, and declining while anything halts the world: a street
        // conversation is the bottom-most surface Escape can be aimed at,
        // everything else is drawn over it, and the handler reaches the
        // stairwell, building and follower menus *after* this callback. Without
        // the guard, stepping onto a shop's doorstep mid-sentence and pressing
        // Escape shuts the conversation underneath the Enter/Stay menu the
        // player is actually looking at.
        if (this.citizenDialog?.isOpen === true && !this.gameplayHalted) {
          this.citizenDialog.close();
          return true;
        }
        return false;
      },
      dismissStairwell: () => {
        if (this.stairwell.menuOpen) {
          this.stairwell.closeMenu();
          return true;
        }
        return false;
      },
      dismissBuilding: () => {
        if (this.building?.menuOpen) {
          this.building.closeMenu();
          return true;
        }
        return false;
      },
      dismissFollowerMenu: () => {
        if (this.followerMenu.isOpen) {
          this.followerMenu.close();
          return true;
        }
        return false;
      },
      togglePause: () => {
        this.menus.pauseMenu.toggle();
        if (this.menus.pauseMenu.isOpen) {
          this.menus.closePanels();
          this.audio?.play('menu_open');
        } else {
          this.input.clear();
        }
      },
      // Runs before the input-suppression gate, because most of these overlays
      // are themselves what suppresses input — Space would otherwise never
      // reach them. Consuming here is also what keeps the press off the world:
      // whatever owns the screen eats Space even when it has nothing to do with
      // it, so a click-only menu can never leak the press to an NPC behind it.
      advanceDialog: () => advanceFocusedOverlay(this.overlayClaims) !== 'ignored',
      switchCharacter: () => this.triggerSwitchCharacter(),
      spaceAction: () => this.triggerSpaceAction(),
      // No slot: the dedicated potion key means "any bottle you have", unlike a
      // hotbar key or a menu click, which each name one.
      usePotion: () => drinkAnyHealthPotion(this.hotbarHost()),
      toggleInventory: () => this.menus.toggleInventory(),
      toggleGear: () => this.menus.toggleGear(),
      companionFollow: () => this.triggerCompanionFollow(),
      toggleMiniMap: () => {
        this.miniMap.toggle();
        this.audio?.play('menu_expand_map');
      },
      toggleQuestTracker: () => {
        // Same gate as its button: a menu tab that opens onto a floor with no
        // quests to list is worse than a key that does nothing.
        if (!this.hasQuestJournal) return;
        if (this.openQuestJournal()) this.audio?.play('menu_open');
      },
      openChat: () => this.triggerOpenChat(),
      mongoSummon: () => this.toggleMongoSummon(),
      buildAction: () => this.triggerBuildAction(),
      hotbarActivation: (idx) => activateHotbarSlot(this.hotbarHost(), idx),
      dynamiteRelease: (idx) => releaseChargedDynamite(this.hotbarHost(), idx),
    });
  }

  onExit(): void {
    this.audio?.stopWalkingLoop();
    // Walking into a building mid-river must not leave the wading loop running
    // under the interior: nothing in `BuildingInteriorScene` would ever stop it.
    this.audio?.stopWadingLoop();
    this.audio?.stopMachineryLoop();
    // Ambient loops are positional, so they always die with the scene — unlike
    // music, which may deliberately survive a building round-trip.
    this.ambientSound?.dispose();
    this.bopca.dispose();
    this.menus.dispose();
    if (!this.musicPersistsAcrossExit) this.audio?.stopMusic();
    this.inputHandler.unbind();
    // A real <input> on document.body, which swallows every key it is focused
    // for. Left behind, it makes the scene that replaces this one unplayable.
    this.chat.dispose();
    if (this._spiderKeyHandler !== null) {
      window.removeEventListener('keydown', this._spiderKeyHandler);
      this._spiderKeyHandler = null;
    }
    this.spiderQuest.dispose();
    this.bounty?.dispose();
    // Drops any standing order along with the hazard sources that were meant to
    // steer around it. Both name systems this scene is taking with it.
    this.companion.dispose();
    // Drops the pack-alert grid among other things. It is a module-level handle,
    // so a scene that exited without this leaves its whole mob roster — and
    // through it its `GameMap` — reachable for the rest of the page's life.
    this.combat.dispose();
    aiAdapter.unbindScene();
    this.bus.clear();
  }

  /**
   * Ambient emitters for the overworld town: the fountain and the smithy's forges
   * swell as you approach them, a quiet crowd bed fills the square, and city
   * chatter carries across the whole town, fading out at its edge.
   */
  private buildTownAmbientEmitters(): AmbientEmitter[] {
    const emitters: AmbientEmitter[] = [];
    // Starts silent (`radiusTiles: 0`) and is aimed each frame by
    // `updateRiverAmbience`. Only the overworld builds these emitters, which is
    // also the only place a river exists.
    const river: AmbientEmitter = {
      soundId: 'ambient_river_flowing',
      x: 0,
      y: 0,
      radiusTiles: 0,
      maxVolume: RIVER_AMBIENT_VOLUME,
    };
    this.riverAmbientEmitter = river;
    emitters.push(river);
    const fountain = this.gameMap.fountainCentre;
    if (fountain !== undefined) {
      emitters.push({
        soundId: 'ambient_fountain',
        x: fountain.x,
        y: fountain.y,
        radiusTiles: FOUNTAIN_AMBIENT_RADIUS_TILES,
        maxVolume: FOUNTAIN_AMBIENT_VOLUME,
      });
    }
    const squareCentre = this.gameMap.townSquareCentre;
    if (squareCentre !== undefined) {
      emitters.push({
        soundId: 'ambient_town_square_crowd',
        x: squareCentre.x,
        y: squareCentre.y,
        radiusTiles: TOWN_SQUARE_AMBIENT_RADIUS_TILES,
        maxVolume: TOWN_SQUARE_AMBIENT_VOLUME,
      });
      const cityCrowdRadiusTiles =
        this.gameMap.townSafeRadius ?? CITY_CROWD_AMBIENT_FALLBACK_RADIUS_TILES;
      emitters.push({
        soundId: 'ambient_city_crowd_chatting',
        x: squareCentre.x,
        y: squareCentre.y,
        radiusTiles: cityCrowdRadiusTiles,
        maxVolume: CITY_CROWD_AMBIENT_VOLUME,
      });
    }
    const smithy = this.gameMap.buildingEntries.find((e) => e.name === RUSTY_ANVIL_BUILDING_NAME);
    if (smithy !== undefined) {
      emitters.push({
        soundId: 'ambient_fire_crackling',
        x: smithy.doorTile.x,
        y: smithy.doorTile.y,
        radiusTiles: FORGE_AMBIENT_RADIUS_TILES,
        maxVolume: FORGE_AMBIENT_VOLUME,
      });
    }
    return emitters;
  }

  private triggerSwitchCharacter(force = false): void {
    if (!force && this.tutorial !== null && !this.tutorial.canSwitchCharacter) {
      this.audio?.play('error');
      return;
    }
    if (this.inactive().isKnockedOut) {
      this.audio?.play('error');
      return;
    }
    this.audio?.play('menu_change_follower');
    this.safeRoom.mordecaiDialogOpen = false;
    // Capture who is currently active before the switch
    const wasHumanActive = this.human.isActive;
    this.pm.switchActive();
    // The character that just became the companion: update their anchor to current position
    const newCompanion = wasHumanActive ? this.human : this.cat;
    this.companion.notifyBecameCompanion(newCompanion, wasHumanActive);
    this.cat.autoTarget = null;
    this.human.autoTarget = null;
    this.companion.isFollowOverride = false;
  }

  /** The `!reveal` cheat: an exact, unquantized bearing to the nearest stairwell. */
  private renderStairwellRevealArrow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    if (!this._revealStairwell) return;
    const player = this.active();
    const target = this.stairwell.nearestStairwellCenter(player);
    if (target === null) return;

    drawArrowAbovePlayer(
      ctx,
      player.x,
      player.y,
      target.x,
      target.y,
      camX,
      camY,
      STAIRWELL_ARROW_COLOR,
      {
        avoidRect: this._hudRect,
      },
    );
  }

  /**
   * The Wayfinder fail-safe: an intermittent, compass-rounded bearing for a
   * crawler who has hunted well past the point where the breadcrumbs were
   * supposed to work. Deliberately a coarser thing than the cheat above — it
   * narrows the search to an eighth of the map and then goes away again.
   */
  private renderWayfinderArrow(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const player = this.active();
    const bearing = this.stairwell.wayfinderBearing(player);
    if (bearing === null) return;

    drawBearingArrowAbovePlayer(
      ctx,
      player.x,
      player.y,
      bearing,
      camX,
      camY,
      WAYFINDER_ARROW_COLOR,
      {
        avoidRect: this._hudRect,
      },
    );
  }

  private renderSpiderLabArrow(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this._revealSpiderLab) return;
    const lab = this.gameMap.spiderLabRoom;
    if (lab === null) return;

    const player = this.active();
    const px = player.x + TILE_SIZE / 2;
    const py = player.y + TILE_SIZE / 2;
    const targetX = lab.centre.x * TILE_SIZE;
    const targetY = lab.centre.y * TILE_SIZE;

    const dx = targetX - px;
    const dy = targetY - py;
    const angle = Math.atan2(dy, dx);

    const t = Date.now();
    const bounce = Math.sin(t * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
    const len = ARROW_LENGTH_PIXELS;
    const arrowX = player.x - camX + TILE_SIZE / 2;
    const arrowY = player.y - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES + bounce;

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.fillStyle = '#a855f7';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = ARROW_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * ARROW_LENGTH_MULTIPLIER_BASE2, -len * ARROW_LENGTH_MULTIPLIER_HEIGHT);
    ctx.lineTo(-len * ARROW_LENGTH_MULTIPLIER_CENTER, 0);
    ctx.lineTo(-len * ARROW_LENGTH_MULTIPLIER_BASE2, len * ARROW_LENGTH_MULTIPLIER_HEIGHT);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Whether this floor offers a Quest Journal at all.
   *
   * The town is the first floor where several threads run at once, which is what
   * a journal is for. The tutorial is held back for the same reason the
   * achievement chrome is: it is itself a guidance system, and a second one
   * offering the player somewhere else to go is the opposite of what it is for.
   */
  private get hasQuestJournal(): boolean {
    return this.tutorial === null && this.levelDef.floorNumber >= OVERWORLD_FLOOR_THREE;
  }

  /** Pauses into the Journal — the compass button's action and the J key's. */
  private openQuestJournal(): boolean {
    if (this.gameOver) return false;
    this.syncJournalContext();
    this.menus.pauseMenu.openToJournal();
    // The same housekeeping `togglePause` does, because this opens the same
    // menu: two panels left open behind it would be waiting on the far side of
    // a Resume the player pressed to get back to the game.
    this.menus.closePanels();
    // No sound here: the compass button declares its own, which the pointer
    // paths have already played through `notifyButtonClick`. The key path plays
    // it at the binding instead, exactly as `togglePause` does.
    return true;
  }

  /**
   * Hands the pause menu this frame's journal, or takes it away.
   *
   * Null is what hides the Quest Journal row from the Game tab, so the menu has
   * one condition to read rather than a floor number it would have to be told
   * about separately.
   */
  private syncJournalContext(): void {
    if (!this.hasQuestJournal) {
      this.menus.pauseMenu.journalContext = null;
      return;
    }
    const active = this.active();
    this.menus.pauseMenu.journalContext = {
      playerTileX: Math.floor(active.x / TILE_SIZE),
      playerTileY: Math.floor(active.y / TILE_SIZE),
      entries: this._trackerEntries,
      progress: this.journalProgress,
    };
  }

  /** The tile the pinned Journal entry points at, or null when nothing is pinned. */
  private get pinnedObjectiveTile(): TrackerTarget | null {
    const pinned = resolvePinnedEntry(this.journalProgress.pinnedTrackerId, this._trackerEntries);
    return pinned?.target ?? null;
  }

  /**
   * A standing column of light on the pinned objective's own tile.
   *
   * The counterpart to the arrow below, and deliberately the opposite trade: the
   * arrow gives a bearing from anywhere and goes quiet up close, where a
   * direction is no longer the question. This is only ever drawn when the tile
   * is on screen, and answers the question that replaces it — which of the
   * things now in front of the player is the one.
   */
  private renderPinnedObjectiveBeacon(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const target = this.pinnedObjectiveTile;
    if (target === null) return;
    drawObjectiveBeacon(
      ctx,
      target.x * TILE_SIZE - camX,
      target.y * TILE_SIZE - camY,
      TILE_SIZE,
      PINNED_ARROW_COLOR,
      performance.now(),
      target,
    );
  }

  /**
   * A beacon over every quest still on offer, unaccepted — Madame Voss's table
   * included, before the player has ever spoken to her.
   *
   * Independent of the pin on purpose: nothing here implies a quest is under
   * way, only that one could be started. `resolvePinnedEntry` no longer falls
   * back to picking one of these for the player — that read as the floor
   * starting with a quest already active — so this is the only thing that
   * still points at a quest giver before their quest is accepted.
   */
  private renderAvailableQuestBeacons(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const now = performance.now();
    for (const target of availableTargets(this._trackerEntries)) {
      drawObjectiveBeacon(
        ctx,
        target.x * TILE_SIZE - camX,
        target.y * TILE_SIZE - camY,
        TILE_SIZE,
        PINNED_ARROW_COLOR,
        now,
        target,
      );
    }
  }

  /**
   * The world arrow for whichever Journal entry the player pinned.
   *
   * Suppressed within a few tiles of the target, as the bounty arrow is: past
   * that point the thing is on screen, and an arrow still insisting on a
   * direction is telling the player something they can see.
   */
  private renderPinnedObjectiveArrow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const target = this.pinnedObjectiveTile;
    if (target === null) return;

    const player = this.active();
    const targetX = (target.x + TILE_CENTRE_FRACTION) * TILE_SIZE;
    const targetY = (target.y + TILE_CENTRE_FRACTION) * TILE_SIZE;
    const distanceTiles =
      Math.hypot(targetX - (player.x + TILE_SIZE / 2), targetY - (player.y + TILE_SIZE / 2)) /
      TILE_SIZE;
    if (distanceTiles < PINNED_ARROW_SUPPRESS_TILES) return;

    drawArrowAbovePlayer(
      ctx,
      player.x,
      player.y,
      targetX,
      targetY,
      camX,
      camY,
      PINNED_ARROW_COLOR,
      {
        avoidRect: this._hudRect,
      },
    );
  }

  private triggerCompanionFollow(): void {
    if (this.tutorial !== null && !this.tutorial.showFollowerButton) return;
    this.followerMenu.open();
  }

  /**
   * Return a clean ability manager for floor/scene transitions — godModeMinLevel
   * is not carried across floors, so clone() (which leaves it at 0) is correct.
   */
  private _cleanAbilityManager(): AbilityManager {
    return this.abilityManager.clone();
  }

  private triggerOpenChat(): void {
    if (this.gameOver || this.menus.pauseMenu.isOpen) return;
    this.chat.open(this.sceneManager.canvas);
  }

  /**
   * The cheats only this floor can answer. The universal four (`!god`,
   * `!tough`, `!payday`, `!levelup`) live in `ChatKit`; these reach systems that
   * exist nowhere else, so a scene without them simply does not offer them.
   */
  private dungeonChatCommands(): ReadonlyArray<ChatCommand> {
    return [
      {
        name: '!reveal',
        run: () => {
          this._revealStairwell = !this._revealStairwell;
          return this._revealStairwell ? '🧭 STAIRWELL REVEALED' : '🧭 STAIRWELL HIDDEN';
        },
      },
      {
        name: '!bounty',
        run: (argument) => {
          this.runBountyCheat(argument);
          return null;
        },
      },
      {
        name: '!assets',
        run: () => this.spriteMissReport(),
      },
      {
        name: '!spider',
        run: () => {
          if (this.gameMap.spiderLabRoom === null) {
            this.audio?.play('error');
            return null;
          }
          this._revealSpiderLab = !this._revealSpiderLab;
          return this._revealSpiderLab ? '🕷 SPIDER LAB REVEALED' : '🕷 SPIDER LAB HIDDEN';
        },
      },
    ];
  }

  /**
   * `!assets` — dumps every sprite key that has ever missed (`getSpriteDef`/
   * `getSpriteDefByKey` found nothing loaded for it) and how many times, so a
   * lazily-loaded or typo'd sheet shows up in seconds instead of during a
   * playtest.
   */
  private spriteMissReport(): string {
    const misses = [...getSpriteMissCounts().entries()];
    if (misses.length === 0) return '🖼 NO SPRITE MISSES';
    misses.sort((a, b) => b[1] - a[1]);
    console.warn('[SpriteLoader] Miss counts:', Object.fromEntries(misses));
    return `🖼 MISSES: ${misses.map(([key, count]) => `${key}×${count}`).join(', ')}`;
  }

  /**
   * The `!bounty` cheat family, which lets the whole loop be exercised from
   * anywhere on the floor:
   *
   * - `!bounty` — issue whatever the cycle has queued next
   * - `!bounty <type>` — issue a named type instead (`evil_clown`, `mantid`,
   *   `dark_knight`, `rock_golem`, `skeleton_lord`), so testing one particular
   *   fight does not mean rerolling the shuffle until it comes up
   * - `!bounty go` — warp to the staged mark
   * - `!bounty done` — force-collect one whose mark is already dead
   */
  private runBountyCheat(argument: string): void {
    const bounty = this.bounty;
    if (bounty === null) {
      this.audio?.play('error');
      return;
    }
    if (argument === 'go') {
      this.runBountyWarpCheat();
      return;
    }
    if (argument === 'done') {
      const coins = bounty.collectBounty(this.active());
      if (coins === 0) {
        this.audio?.play('error');
        return;
      }
      this.chat.showBubble(`💰 BOUNTY PAID +${coins}`);
      return;
    }
    const forcedTypeId = argument === '' ? undefined : argument;
    if (forcedTypeId !== undefined && findBountyDef(forcedTypeId) === null) {
      this.chat.showBubble(`❓ NO BOUNTY TYPE "${forcedTypeId}"`);
      this.audio?.play('error');
      return;
    }
    if (!bounty.issueBounty(this.human, this.cat, forcedTypeId)) {
      this.audio?.play('error');
      return;
    }
    this.chat.showBubble(`🎯 ${bounty.currentName ?? '?'} ${bounty.currentTypeLabel ?? ''}`);
  }

  /**
   * `!bounty go` — drops the party just outside the staged mark.
   *
   * `pickSiteIndex` guarantees a site is at least 60 tiles from the party, so
   * without this every test of a bounty *fight* — the part that has never been
   * exercised by automation — costs a minute of walking first.
   */
  private runBountyWarpCheat(): void {
    const bounty = this.bounty;
    const mark = bounty?.markPointWorld ?? null;
    if (mark === null) {
      this.audio?.play('error');
      return;
    }
    const markTileX = Math.floor(mark.x / TILE_SIZE);
    const markTileY = Math.floor(mark.y / TILE_SIZE);
    const landing = this.findWarpLandingTile(
      markTileX,
      markTileY,
      BOUNTY_WARP_STANDOFF_TILES,
      BOUNTY_WARP_SEARCH_TILES,
    );
    if (landing === null) {
      this.audio?.play('error');
      return;
    }
    this.placePartyAtTile(landing);
    this.chat.showBubble('🎯 WARPED TO MARK');
  }

  /**
   * The Wayfinder's Anchor's half of the warp: everything that has to happen to
   * the world, in the order the shipped teleports establish.
   *
   * The landing search runs *before* the dismissal, unlike the building-entry
   * precedent it copies: a dismissal on a warp that then finds nowhere to land
   * would cost the player their pet for a trip they never took.
   *
   * @returns whether the party actually moved.
   */
  private warpPartyForRecall(tile: { x: number; y: number }): boolean {
    const landing = this.findWarpLandingTile(
      tile.x,
      tile.y,
      RECALL_WARP_STANDOFF_TILES,
      RECALL_WARP_SEARCH_TILES,
    );
    if (landing === null) return false;

    // Neither can follow a warp, and their own dismissal is what keeps `mobs`
    // and `mobGrid` in step — the party is moved, they are removed.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.placePartyAtTile(landing);
    return true;
  }

  /**
   * Sets both crawlers down on a landing tile: the human on it, the companion on
   * the nearest tile beside it that will hold them.
   *
   * Shared by every warp that is not a checkpoint respawn, so the cheat and the
   * stone cannot drift apart on where a party ends up.
   */
  private placePartyAtTile(landing: { x: number; y: number }): void {
    this.human.x = landing.x * TILE_SIZE;
    this.human.y = landing.y * TILE_SIZE;
    const companionTile = findNearbyWalkableTile(
      this.gameMap,
      landing.x + 1,
      landing.y,
      WARP_COMPANION_SEARCH_TILES,
    );
    // Stacked on the human rather than nowhere: the companion is dragged along
    // by every shipped warp, and CompanionSystem gives up past its path budget.
    this.cat.x = (companionTile?.x ?? landing.x) * TILE_SIZE;
    this.cat.y = (companionTile?.y ?? landing.y) * TILE_SIZE;
  }

  /**
   * Nearest tile with room to stand at least `standoffTiles` out from a target.
   *
   * The standoff is what keeps `!bounty go` from dropping the party inside the
   * boss; a recall passes zero, because landing on the town square is the point.
   * `hasRoomToMove` rather than `isWalkable`: a one-tile gap between two trunks
   * passes every walkability test and traps whoever lands in it.
   */
  private findWarpLandingTile(
    targetTileX: number,
    targetTileY: number,
    standoffTiles: number,
    searchTiles: number,
  ): { x: number; y: number } | null {
    for (let radius = standoffTiles; radius <= searchTiles; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tileX = targetTileX + dx;
          const tileY = targetTileY + dy;
          if (hasRoomToMove(this.gameMap, tileX, tileY)) return { x: tileX, y: tileY };
        }
      }
    }
    return null;
  }

  private triggerBuildAction(): void {
    this.defendQuest.tryBuildBarrier(this.active());
  }

  /**
   * Progress toward the next pet level, 0–1, for the strip on the Summon button.
   *
   * Full at the cap rather than empty: `xpToNextLevel` is Infinity there, and a
   * bar reading zero for a maxed-out pet says the opposite of what is true.
   */
  private mongoXpFraction(): number {
    const state = this.abilityManager.getState('mongo');
    if (state === null) return 0;
    if (!Number.isFinite(state.xpToNextLevel) || state.xpToNextLevel <= 0) return 1;
    return Math.max(0, Math.min(1, state.xp / state.xpToNextLevel));
  }

  /**
   * The Summon button and the R key are one toggle: out of play he is summoned,
   * in play he is called back — and he runs home rather than vanishing, so
   * recalling him mid-fight is a real decision rather than a free undo.
   */
  private toggleMongoSummon(): void {
    if (!this.cat.isActive) return;
    if (this.mongoSystem.mongo) {
      this.mongoSystem.toggleRecall();
      return;
    }
    const mongo = this.mongoSystem.summon(this.cat, this.gameMap);
    if (mongo) {
      this.world.roster.add(mongo);
      this.abilityManager.addUsageXp('mongo');
      this.audio?.play('mongo_released');
    }
  }

  /**
   * Routes a death-screen exit to the in-run checkpoint, if one was captured on
   * this floor, or to the full floor restart otherwise.
   */
  private respawnAfterDeath(): void {
    // Before the branch, so it runs on both routes: a checkpoint restore keeps
    // the world (and so would keep the mark standing where the party fell) while
    // a floor restart throws it away, and the durable record would have survived
    // either one.
    this.bounty?.abandonBounty(this.world.roster.mobs, this.world.roster.grid);

    const cp = this.checkpoint;
    if (cp !== null) {
      this.restoreFromCheckpoint(cp);
    } else {
      this.restartAtFloorEntry();
    }
  }

  /**
   * Restores the party *and the floor* to an in-run checkpoint in place, rather
   * than tearing down and rebuilding the scene. Map generation has no seed, so
   * the world the player left cannot be re-derived — it can only be kept and
   * rewound, which is what {@link restoreWorldCheckpoint} does.
   *
   * The three deliberate exceptions, all preserved rather than rewound: the
   * doomsday countdown (rewinding it would make dying a way to buy back time),
   * the `difficultyStats` singleton (adaptive difficulty has to keep learning
   * from real deaths), and fog of war (re-walking explored map is only tedium).
   */
  private restoreFromCheckpoint(cp: LevelCheckpoint): void {
    this.audio?.stopSound('death_sequence');
    this.combat.deathScreen.reset();
    this.gameOver = false;
    // Its pending callback grants a chest's reward against a world that is
    // about to be rewound to before the chest was opened.
    this.chestRewardDialog.discard();

    restorePlayer(this.human, cp.humanSnap);
    restorePlayer(this.cat, cp.catSnap);
    this.abilityManager.restoreStates(cp.abilities.snapshotStates());
    this.humanAchievements.restoreFrom(cp.humanAchievements);
    this.catAchievements.restoreFrom(cp.catAchievements);

    // restorePlayer() already cleared status effects and downed state — the
    // checkpoint snapshot carries neither — so only what PlayerSnapshot doesn't
    // cover is left. HP last, since maxHp reads the (already-zeroed) Jugg Juice loan.
    this.human.clearTransientCombatState();
    this.cat.clearTransientCombatState();
    this.human.hp = this.human.maxHp;
    this.cat.hp = this.cat.maxHp;
    this.human.resetCombatState();
    this.cat.resetCombatState();

    this.human.x = cp.respawnX;
    this.human.y = cp.respawnY;
    this.cat.x = cp.respawnX + TILE_SIZE;
    this.cat.y = cp.respawnY;

    this.levelTimerFrames = cp.levelTimerFrames;

    // The pet goes home rather than being healed where he stands: his HP is the
    // whole cost of using him, and a free full heal on every safe-room restore
    // would hand it back. Dismissing also writes his real remaining HP into the
    // shared state, which nothing else on this path does.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // The same problem one companion over: the roster rewind below can un-hire a
    // mercenary taken on after the safe room, and nothing reachable from a
    // snapshot can splice the body out of the scene once that reference is gone.
    this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);

    this.rewindMobsToCheckpoint();

    this.combat.resetForCheckpoint();
    this.destruction.resetForCheckpoint();
    this.lavaBalls.resetForCheckpoint();
    this.rockThrows.resetForCheckpoint();
    this.skeletonShots.resetForCheckpoint();
    this.goblinArrows.resetForCheckpoint();
    this.clownGas.resetForCheckpoint();
    this.knightMissiles.resetForCheckpoint();
    this.skeletonSummons.resetForCheckpoint();
    this.bossRoom.resetForCheckpoint();
    this.arena.resetForCheckpoint();

    // Last, so the snapshot has the final word. The two resets above clear the
    // same room locks and entry windows the snapshot describes, and they clear
    // them to "no fight in progress" rather than to what was actually captured.
    this.restoreWorldCheckpoint(cp.world);

    this.bossIntro.cancel();
    this.combatCooldownFrames = 0;

    // A boss encounter switches to its boss track via `bossFightInitiated`, but
    // dying mid-fight and restoring here never emits `bossDefeated` — nothing
    // else tells the audio system the encounter is over, so the boss track
    // would otherwise keep playing at the safe room.
    if (this.overworldMusic === null && this.audio?.currentMusicId !== this.levelDef.music) {
      this.audio?.playMusic(this.levelDef.music, { fadeInMs: MUSIC_FADE_IN_MS });
    }

    // The player is standing in the safe room right now — the latch has to
    // agree, or the next step out and back in is the only thing that re-arms it.
    this.wasInSafeRoom = true;
  }

  /**
   * Asks every owner of durable state to describe itself.
   *
   * Systems rather than a flat field list because the invariants live with the
   * owners: a room lock mirrors a map call, a felled tree is recorded on the
   * tile rather than in the system that felled it, and only the system knows.
   */
  private captureWorldCheckpoint(): WorldCheckpoint {
    return {
      gameMap: this.gameMap.captureCheckpoint(),
      gameStats: this.gameStats.snapshot(),

      bossRoom: this.bossRoom.captureCheckpoint(),
      arena: this.arena.captureCheckpoint(),
      arenaRoom: this.arenaRoom.captureCheckpoint(),
      juicerRoom: this.juicerRoom.captureCheckpoint(),
      barriers: this.barriers.captureCheckpoint(),
      safeRoom: this.safeRoom.captureCheckpoint(),
      miniMap: this.miniMap.captureCheckpoint(),
      stairwell: this.stairwell.captureCheckpoint(),
      recall: this.recall.captureCheckpoint(),
      treasureChests: this.treasureChests.captureCheckpoint(),
      destruction: this.destruction.captureCheckpoint(),
      bopca: this.bopca.captureCheckpoint(),
      difficultyTelemetry: this.difficultyTelemetry.captureCheckpoint(),
      mercenary: this.mercenarySystem.captureCheckpoint(),
      mongo: this.mongoSystem.captureCheckpoint(),

      defendQuest: this.defendQuest.captureCheckpoint(),
      spiderQuest: this.spiderQuest.captureCheckpoint(),
      circusQuest: this.circusQuest.captureCheckpoint(),
      murderQuest: this.murderQuest.captureCheckpoint(),
      doomsdayEscape: this.doomsdayEscape.captureCheckpoint(),

      trees: this.trees?.captureCheckpoint() ?? null,
      bounty: this.bounty?.captureCheckpoint() ?? null,

      circusQuestProgress: captureCircusQuestProgress(this.circusQuestProgress),
      murderQuestProgress: captureMurderQuestProgress(this.murderQuestProgress),
      anchorQuestProgress: captureAnchorQuestProgress(this.anchorQuestProgress),
      journal: captureJournalProgress(this.journalProgress),
      bountyProgress: captureBountyProgress(this.bountyProgress),
      clubMembership: captureClubMembership(this.clubMembership),
      townMemory: captureTownMemory(this.townMemory),
      marketStock: captureMarketStock(this.marketStock),
      mercenaryRoster: captureMercenaryRoster(this.mercenaryRoster),
      mongoPetState: captureMongoPetState(this.mongoPetState),

      krakarenKilled: this.krakarenKilled,
      krakarenBossRoomIdx: this.krakarenBossRoomIdx,
      juicerKilled: this.juicerKilled,
      juicerBossRoomIdx: this.juicerBossRoomIdx,
    };
  }

  /**
   * Puts every owner of durable state back to what it described at capture.
   *
   * Ordering is load-bearing in three places, each noted below; everything else
   * is independent and listed in the same order as the capture above.
   */
  private restoreWorldCheckpoint(world: WorldCheckpoint): void {
    // Before the systems that might re-issue one: a rewind puts the party back
    // before the fight that gave the companion its standing order, and nothing
    // in `CompanionSystem` revokes an order on its own.
    this.companion.clearDirective();
    this.gameMap.restoreCheckpoint(world.gameMap);
    this.gameStats.restore(world.gameStats);

    this.bossRoom.restoreCheckpoint(world.bossRoom);
    this.arena.restoreCheckpoint(world.arena);
    this.arenaRoom.restoreCheckpoint(world.arenaRoom);
    this.juicerRoom.restoreCheckpoint(world.juicerRoom);
    this.barriers.restoreCheckpoint(world.barriers);
    this.safeRoom.restoreCheckpoint(world.safeRoom);
    this.miniMap.restoreCheckpoint(world.miniMap);
    this.stairwell.restoreCheckpoint(world.stairwell);
    this.recall.restoreCheckpoint(world.recall);
    this.treasureChests.restoreCheckpoint(world.treasureChests);
    this.destruction.restoreCheckpoint(world.destruction);
    this.bopca.restoreCheckpoint(world.bopca);
    this.difficultyTelemetry.restoreCheckpoint(world.difficultyTelemetry);
    this.mercenarySystem.restoreCheckpoint(world.mercenary);
    this.mongoSystem.restoreCheckpoint(world.mongo);

    this.defendQuest.restoreCheckpoint(world.defendQuest);
    this.spiderQuest.restoreCheckpoint(world.spiderQuest);
    // The grid the mob rewind just rebuilt, not the one the last frame saw:
    // Signet's move back to the Big Top door has to land in the live one.
    this.circusQuest.restoreCheckpoint(world.circusQuest, this.world.roster.grid);
    this.murderQuest.restoreCheckpoint(world.murderQuest);
    this.doomsdayEscape.restoreCheckpoint(world.doomsdayEscape);

    if (this.trees !== null && world.trees !== null) {
      this.trees.restoreCheckpoint(world.trees);
    }
    // After `abandonBounty` in `respawnAfterDeath`, which has already pulled the
    // encounter out of the world: the system re-stages a contract accepted
    // before the checkpoint rather than re-pointing at mobs nothing can hit.
    if (this.bounty !== null && world.bounty !== null) {
      this.bounty.restoreCheckpoint(world.bounty);
    }

    restoreCircusQuestProgress(this.circusQuestProgress, world.circusQuestProgress);
    restoreMurderQuestProgress(this.murderQuestProgress, world.murderQuestProgress);
    restoreAnchorQuestProgress(this.anchorQuestProgress, world.anchorQuestProgress);
    restoreJournalProgress(this.journalProgress, world.journal);
    // Paired with the bounty system above: the re-stage reads the mark's type,
    // name and site from this record, so an un-restored cursor would re-stage
    // the wrong contract — or burn a name the player never saw.
    restoreBountyProgress(this.bountyProgress, world.bountyProgress);
    restoreClubMembership(this.clubMembership, world.clubMembership);
    restoreTownMemory(this.townMemory, world.townMemory);
    restoreMarketStock(this.marketStock, world.marketStock);
    restoreMercenaryRoster(this.mercenaryRoster, world.mercenaryRoster);
    // After `mongoSystem.dismiss()`, which writes the live pet's remaining HP
    // and rest latch into this very object on its way out — restoring first
    // would hand the despawn a snapshot to overwrite.
    restoreMongoPetState(this.mongoPetState, world.mongoPetState);

    this.krakarenKilled = world.krakarenKilled;
    this.krakarenBossRoomIdx = world.krakarenBossRoomIdx;
    this.juicerKilled = world.juicerKilled;
    this.juicerBossRoomIdx = world.juicerBossRoomIdx;
  }

  /**
   * Records which mobs the floor held, and which of them were alive, so a later
   * restore can tell a kill the player has already banked from one it scored
   * after the safe room.
   */
  private markMobsAtCheckpoint(): void {
    for (const mob of this.world.roster.mobs) {
      mob.presentAtCheckpoint = true;
      mob.aliveAtCheckpoint = mob.isAlive;
    }
  }

  /**
   * Puts the floor's population back the way the checkpoint found it: anything
   * that arrived after the safe room is dropped, anything killed after it
   * stands back up, and the survivors are reset as they always were.
   *
   * Dropping a mob is the one thing this scene otherwise never does — `mobs` is
   * append-only so corpses stay renderable — so the array is rebuilt in place
   * rather than spliced repeatedly, which keeps the cost linear even after a
   * summon-heavy fight has added hundreds of bodies.
   */
  private rewindMobsToCheckpoint(): void {
    const kept: Mob[] = [];
    for (const mob of this.world.roster.mobs) {
      if (!mob.presentAtCheckpoint) {
        // Summoned, hired or staged after the safe room, so it has no business
        // existing. Disposed because it is leaving the array for good — the
        // other splice sites (bounty abandon, companion despawn, the boss-room
        // roach compaction) owe the same call.
        mob.dispose();
        continue;
      }
      if (mob.aliveAtCheckpoint && !mob.isAlive) {
        mob.reviveForCheckpoint();
      } else if (mob.isAlive) {
        if (mob.resetsFullyOnCheckpoint) {
          mob.resetToSpawn();
        } else {
          // Allies (Mongo, hired mercenaries) aren't spawn-anchored encounters
          // to reposition — their "spawn tile" is wherever they were summoned
          // or hired, not this safe room — but they can take real damage
          // fighting alongside the party and must not stay critically wounded
          // once the party itself is fully healed.
          mob.healAndForgetFight();
        }
      }
      kept.push(mob);
    }
    this.world.roster.replaceAll(kept);

    // Re-derived rather than filtered: a spider that spawned after the
    // checkpoint has just left `mobs`, and this list would otherwise keep
    // rendering and ticking it.
    this.grotesqueSpiders = this.world.roster.mobs.filter(
      (mob): mob is GrotesqueSpider => mob instanceof GrotesqueSpider,
    );

    this.world.roster.rebuildGrid();
  }

  private restartAtFloorEntry(): void {
    // Before the scene is replaced: his HP only reaches the shared state through
    // a despawn, and the instance holding it is about to be discarded.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.audio?.stopSound('death_sequence');
    this.sceneManager.replace(
      new DungeonScene(this.levelDef, this.input, this.sceneManager, {
        humanSnap: this.floorEntryHumanSnap,
        catSnap: this.floorEntryCatSnap,
        floorEntryHumanSnap: this.floorEntryHumanSnap,
        floorEntryCatSnap: this.floorEntryCatSnap,
        humanAchievements: this.floorEntryHumanAchievements.clone(),
        catAchievements: this.floorEntryCatAchievements.clone(),
        floorEntryHumanAchievements: this.floorEntryHumanAchievements,
        floorEntryAbilityManager: this.floorEntryAbilityManager,
        floorEntryCatAchievements: this.floorEntryCatAchievements,
        abilityManager: this.floorEntryAbilityManager.clone(),
        mongoUnlocked: this.mongoSystem.unlocked,
        mongoPetState: this.mongoPetState,
        audio: this.audio ?? undefined,
        tutorialController:
          this.tutorial !== null ? TutorialController.createForTutorial() : undefined,
        saveProgress: this.onSaveProgress,
        onResetGame: this.onResetGameCallback ?? undefined,
        // Preserved rather than reset — a death restart shouldn't force-replay an
        // already-completed boss fight (Grimaldi/Quill), and for the doomsday
        // timer specifically, resetting it here would let a player cancel a
        // lethal countdown for free by simply dying to anything else.
        circusQuestProgress: this.circusQuestProgress,
        murderQuestProgress: this.murderQuestProgress,
        anchorQuestProgress: this.anchorQuestProgress,
        // Carried through a death restart with the questlines it belongs to: the
        // Town Guide is a record of where the player has been, and dying does not
        // un-visit the shop.
        journalProgress: this.journalProgress,
        bountyProgress: this.bountyProgress,
        doomsdayQuestProgress: this.doomsdayQuestProgress,
        clubMembership: this.clubMembership,
        townMemory: this.townMemory,
        marketStock: this.marketStock,
        mercenaryRoster: this.mercenaryRoster,
        godModeState: this.godModeState,
        companionStance: this.companionStance,
      }),
    );
  }

  private hasNearbyEnemy(player: HumanPlayer | CatPlayer, range: number): boolean {
    const px = player.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const py = player.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const nearby = this.world.roster.grid.queryCircle(px, py, range);
    for (const mob of nearby) {
      // Allies (Signet, Ink Marauders) must not force attack-priority over talking.
      if (mob.isAlive && mob.isHostile) return true;
    }
    return false;
  }

  private townDialogContext(): TownDialogContext {
    return {
      circus: this.circusQuestProgress.stage,
      murder: this.murderQuestProgress.stage,
      doomsday: this.doomsdayQuestProgress.stage,
      heatherSlain: this.circusQuestProgress.heatherSlain,
      quillNamed: this.murderQuestProgress.quillNamed,
    };
  }

  private townNoticeContext(): TownNoticeContext {
    const murder = this.murderQuestProgress;
    const cluesFound = [murder.wellClueFound, murder.homeClueFound, murder.roostClueFound].filter(
      Boolean,
    ).length;
    return {
      circus: this.circusQuestProgress.stage,
      heatherSlain: this.circusQuestProgress.heatherSlain,
      murder: murder.stage,
      murderCluesFound: cluesFound,
      doomsday: this.doomsdayQuestProgress.stage,
      bounty: this.bounty?.noticeState ?? null,
    };
  }

  /** Opens the town notice board panel, populated with the current postings. */
  private openNoticeBoard(): void {
    if (this.noticeBoard === null) return;
    this.noticeBoard.openWith(buildTownNotices(this.townNoticeContext()));
    this.audio?.play('menu_open');
  }

  /** Opens a market stall's buy panel on the rows the market system built. */
  private openMarketStall(browse: MarketBrowse): void {
    if (this.marketPanel === null) return;
    this.marketPanel.open(browse.buildMenu, browse.purchase, browse.onBlocked);
    this.audio?.play('menu_open');
  }

  /** Opens the fortune teller's panel, seeded with the current quest state. */
  private openFortuneTeller(): void {
    // While the Anchor questline still has business with Madame Voss, consulting
    // her opens that conversation. The card reading is what she gives you when
    // it does not.
    if (this.anchorQuest.tryOpenDialog(this.active())) return;
    if (this.fortuneTeller === null) return;
    this.fortuneTeller.openWith(this.townDialogContext());
    this.audio?.play('menu_open');
  }

  /** Floats a SPACE prompt over the nearest interactive town prop, when actionable. */
  private renderPropPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.townProps === null && this.market === null) return;
    if (
      this.noticeBoard?.isOpen === true ||
      this.marketPanel?.isOpen === true ||
      this.fortuneTeller?.isOpen === true ||
      this.bounty?.isDialogOpen === true
    ) {
      return;
    }
    const active = this.active();
    const attackRange = this.human.isActive
      ? TILE_SIZE * HUMAN_ATTACK_RANGE_TILES
      : TILE_SIZE * CAT_ATTACK_RANGE_TILES;
    if (this.hasNearbyEnemy(active, attackRange)) return;
    // Same order as the Space chain in `tryInteract`, so the prompt always names
    // the thing that press would actually reach.
    if (this.market?.renderPrompt(ctx, camX, camY, active) === true) return;
    if (this.bounty?.renderPrompt(ctx, camX, camY, active) === true) return;
    this.townProps?.renderPrompt(ctx, camX, camY, active);
  }

  /** Floats a "Talk" prompt over the nearest citizen when one is in range and idle. */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.citizenDialog === null || this.townLife === null) return;
    if (this.citizenDialog.isOpen) return;
    const active = this.active();
    const attackRange = this.human.isActive
      ? TILE_SIZE * HUMAN_ATTACK_RANGE_TILES
      : TILE_SIZE * CAT_ATTACK_RANGE_TILES;
    if (this.hasNearbyEnemy(active, attackRange)) return;
    const target = this.townLife.findTalkTarget(active.x, active.y);
    if (target === null) return;
    drawInteractionPrompt(ctx, target.x - camX, target.y - camY, TILE_SIZE, 'Talk');
  }

  /** Opens a conversation with the nearest street citizen, if one is in range. */
  private tryTalkToCitizen(active: Player): boolean {
    const dialog = this.citizenDialog;
    if (dialog === null || this.townLife === null) return false;
    const target = this.townLife.findTalkTarget(active.x, active.y);
    if (target === null) return false;
    target.faceToward(active.x, active.y);
    target.frozen = true;
    this.citizenDialogTarget = target;
    const lines = buildCitizenConversation(
      target.role,
      target.appearance.seed,
      target.conversationCount,
      this.townDialogContext(),
    );
    dialog.open(roleDisplayName(target.role), lines);
    target.conversationCount++;
    return true;
  }

  /** This floor's overlays, ordered by which one a press should reach first. */
  private get overlayClaims(): readonly OverlayInputClaim[] {
    const tutorial = this.tutorial;
    const noticeBoard = this.noticeBoard;
    const marketPanel = this.marketPanel;
    const fortuneTeller = this.fortuneTeller;
    const citizenDialog = this.citizenDialog;
    const closeWithClick = (close: () => void): OverlaySpaceHandling => ({
      kind: 'advance',
      advance: () => {
        close();
        this.audio?.play('menu_click');
      },
    });
    /**
     * The shape most of this list takes: a panel that stops the floor, takes the
     * keyboard, and answers Space through its own focus ring rather than here.
     */
    const modal = (isOpen: boolean, focusContext: string | null): OverlayInputClaim => ({
      isOpen,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext,
    });
    /** A dialog the player pages through, over a floor that keeps running. */
    const floatingDialog = (isOpen: boolean, advance: () => void): OverlayInputClaim => ({
      isOpen,
      space: { kind: 'advance', advance },
      locksKeyboard: false,
      haltsWorld: false,
      focusContext: null,
    });
    return [
      modal(this.chestRewardDialog.isOpen, 'chest-reward'),
      floatingDialog(tutorial?.showNearGoblinDialog === true, () =>
        tutorial?.dismissNearGoblinDialog(),
      ),
      // Not world-halting: `update` has its own branch for each of these two,
      // and it is what types the dialog out a character at a time. Halting here
      // would make that branch unreachable and every page arrive blank.
      floatingDialog(tutorial?.showTutorialMordecaiDialog === true, () =>
        tutorial?.advanceTutorialMordecaiDialog(),
      ),
      floatingDialog(tutorial?.showMordecaiReminderDialog === true, () =>
        tutorial?.advanceMordecaiReminderDialog(),
      ),
      // No single ring to promise: the award stack is several surfaces deep, and
      // each of the notification, the loot box and the chest award declares its
      // own. Floating, so the audit does not hold it to one.
      floatingDialog(this.achievementUI.isBlocking, () => void this.achievementUI.handleSpaceBar()),
      // The four below each render an accept button inside their own focus ring,
      // so the ring takes the press before this chain is reached. The claim is
      // still needed to keep the rest of the keyboard — and the world behind —
      // out of it.
      modal(this.menus.levelUpDialog.isShowing, 'level-up'),
      modal(this.menus.rewardGrantedDialog.isShowing, 'reward-granted'),
      modal(this.menus.skillBookPrompt.isOpen, 'skill-book-prompt'),
      // Below the award stack because that stack draws over the death screen — a
      // level-up earned by the blow that killed you is still on top and still
      // has to be dismissible. `locksKeyboard` even so: the screen's own focus
      // ring listens in the capture phase and is reached first, so locking here
      // only stops a hotbar key spending a potion the respawn will throw away.
      modal(this.gameOver, 'death-screen'),
      {
        isOpen: this.levelCompleteScreen.isActive,
        space: { kind: 'swallow' },
        locksKeyboard: false,
        haltsWorld: true,
        focusContext: 'level-complete',
      },
      {
        isOpen: this.chat.isOpen,
        space: { kind: 'passThrough' },
        locksKeyboard: true,
        haltsWorld: true,
        // The DOM input owns every key while it is up, the ring included.
        focusContext: null,
      },
      {
        isOpen: noticeBoard?.isOpen === true,
        space: closeWithClick(() => noticeBoard?.close()),
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'notice-board',
      },
      modal(marketPanel?.isOpen === true, 'priced-menu'),
      modal(fortuneTeller?.isOpen === true, 'fortune-teller'),
      {
        isOpen: this.bopca.isDialogOpen,
        space: { kind: 'advance', advance: () => this.bopca.advanceDialog() },
        locksKeyboard: true,
        haltsWorld: false,
        focusContext: 'bopca-dialog',
      },
      {
        isOpen: this.defendQuest.isDialogOpen,
        space: { kind: 'advance', advance: () => this.advanceDefendQuestPage() },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'defend-quest',
      },
      floatingDialog(this.defendQuest.isOutcomeOverlayShowing, () => this.advanceDefendQuestPage()),
      floatingDialog(this.circusQuest.isOutcomeOverlayShowing, () =>
        this.dismissOutcomeOverlay(this.circusQuest.advanceOutcomeOverlay()),
      ),
      floatingDialog(this.murderQuest.isOutcomeOverlayShowing, () =>
        this.dismissOutcomeOverlay(this.murderQuest.advanceOutcomeOverlay()),
      ),
      floatingDialog(this.anchorQuest.isOutcomeOverlayShowing, () =>
        this.dismissOutcomeOverlay(this.anchorQuest.advanceOutcomeOverlay()),
      ),
      // The quest systems below own their own window listener for Space, so the
      // claim here only has to keep the press away from the world behind them.
      modal(this.spiderQuest.isDialogOpen, 'spider-quest'),
      modal(this.bounty?.isDialogOpen === true, 'quest-dialog'),
      modal(this.circusQuest.isDialogOpen, 'quest-dialog'),
      modal(this.murderQuest.isDialogOpen, 'quest-dialog'),
      modal(this.anchorQuest.isDialogOpen, 'quest-dialog'),
      floatingDialog(this.safeRoom.mordecaiDialogOpen, () => this.safeRoom.advanceMordecaiDialog()),
      // Not world-halting for the same reason: `update`'s sleep branch is the
      // only thing that ticks the sleep down, and the only thing that ever ends
      // it. Halting here would leave the player asleep for good.
      {
        isOpen: this.safeRoom.isSleeping,
        space: { kind: 'swallow' },
        locksKeyboard: true,
        haltsWorld: false,
        // A timed fade with no buttons; the sleep ends itself.
        focusContext: null,
      },
      modal(this.stairwell.menuOpen, 'stairwell'),
      modal(this.building?.menuOpen === true, 'building-entry'),
      {
        isOpen: this.followerMenu.isOpen,
        space: { kind: 'swallow' },
        locksKeyboard: true,
        haltsWorld: false,
        focusContext: 'follower-menu',
      },
      {
        isOpen: this.menus.pauseMenu.isOpen,
        space: { kind: 'swallow' },
        locksKeyboard: true,
        haltsWorld: true,
        // The base of the namespace: the menu re-keys its ring per tab, and an
        // inner confirm narrows it further, so the declared id is `pause-…`.
        focusContext: 'pause',
      },
      // Last: the one overlay the world keeps running under — a street
      // conversation ends because the player walked away from it — and the one
      // every other surface here is drawn over. Ranking it above them would hand
      // Space and Escape to the box underneath whatever the player is looking at.
      {
        isOpen: citizenDialog?.isOpen === true,
        space: { kind: 'advance', advance: () => citizenDialog?.advance() },
        locksKeyboard: true,
        haltsWorld: false,
        // Advance-anywhere: one speaker line, no buttons to reach.
        focusContext: null,
      },
    ];
  }

  private advanceDefendQuestPage(): void {
    if (this.defendQuest.advancePage()) this.audio?.play('menu_click');
  }

  /** Shared feedback for the space-dismisses-the-banner-early claims below. */
  private dismissOutcomeOverlay(dismissed: boolean): void {
    if (dismissed) this.audio?.play('menu_click');
  }

  /** The overlay that currently owns input, or null when play has the floor. */
  private get focusedOverlay(): OverlayInputClaim | null {
    return focusedOverlay(this.overlayClaims);
  }

  /**
   * Anything that takes the floor away from ordinary play.
   *
   * Derived from the claim registry rather than restated as a second boolean
   * chain: the two used to be hand-maintained lists of the same overlays, and a
   * dialog added to one of them and not the other is a menu the world keeps
   * running underneath. The spider lab's cutscene is the one term with no
   * overlay behind it — the quest freezes the floor from inside its own state
   * machine.
   */
  private get gameplayHalted(): boolean {
    return worldHalted(this.overlayClaims) || this.spiderQuest.isDungeonPaused;
  }

  /**
   * Ends a street conversation once the player has plainly walked off.
   *
   * The threshold is several times the ~1.1-tile radius that opens one, so that
   * a tapped movement key reads as standing still and only a deliberate walk
   * closes the box.
   */
  private dismissCitizenDialogIfWalkedAway(): void {
    const target = this.citizenDialogTarget;
    const dialog = this.citizenDialog;
    if (target === null || dialog?.isOpen !== true) return;
    const active = this.active();
    const distance = Math.hypot(active.x - target.x, active.y - target.y);
    if (distance > TILE_SIZE * CONVERSATION_WALK_AWAY_TILES) dialog.close();
  }

  /**
   * Small talk loses to anything that seized the frame — a quest interjection
   * the player walked into, a level-up, the death screen. Without this the two
   * boxes render on top of each other and the chat eats the Space presses meant
   * for the interruption.
   */
  private yieldCitizenDialogToInterruption(): void {
    if (this.citizenDialog?.isOpen === true && this.gameplayHalted) this.citizenDialog.close();
  }

  /**
   * Mordecai's answer, from the highest-ranked of three sources that has one:
   *
   *     tutorial (if it handles it) → floor advice → AI chat
   *
   * The tutorial keeps first claim, as it always had. Floor advice sits above the
   * AI chat because it is the deterministic answer to "what is left to do here",
   * and it needs no server; the chat becomes the flavour path for a cleared floor.
   */
  private talkToMordecai(active: { x: number; y: number }): void {
    if (this.tutorial?.onMordecaiInteracted() === true) return;

    const pages = this.floorAdvice(active);
    if (pages !== null) {
      this.safeRoom.openMordecaiPages(pages);
      return;
    }

    const humanEvents = this.humanAchievements.getTopRecentEvents(ACHIEVEMENT_RECENT_EVENTS_LIMIT);
    const catEvents = this.catAchievements.getTopRecentEvents(ACHIEVEMENT_RECENT_EVENTS_LIMIT);
    const merged = [...humanEvents, ...catEvents]
      .sort((a, b) => a.secondsAgo - b.secondsAgo)
      .slice(0, MORDECAI_CHAT_MERGED_EVENTS_LIMIT);
    this.safeRoom.openMordecaiDialog(
      aiAdapter.chatWithMordecai({
        recentEvents: merged,
        humanLevel: this.human.level,
        catLevel: this.cat.level,
      }),
    );
  }

  /**
   * The advice pages for this floor, or null when there is nothing left to say.
   *
   * Bearings are measured from the safe room the player is standing in rather
   * than from the first one on the map: a floor carries two, and pointing at the
   * same boss from both has to give two different answers.
   */
  private floorAdvice(active: { x: number; y: number }): ReadonlyArray<string> | null {
    const safeRoom = this.safeRoom.safeRoomInfoAt(active);
    if (safeRoom === null) return null;
    const bearingOrigin = safeRoom.centre;

    const pinned = this.pinnedGatewayAdvice(safeRoom.guardsBossType);
    if (pinned !== null) return this.mordecaiAdvisor.renderObjective(pinned, bearingOrigin);

    const objectives = this.floorObjectives();
    if (objectives.length === 0) return null;

    return this.mordecaiAdvisor.nextAdvice({
      floorNumber: this.levelDef.floorNumber,
      bearingOrigin,
      objectives,
    });
  }

  /**
   * The speech a gateway safe room owes its own boss, or null.
   *
   * A room that stands between the player and a specific boss talks about that
   * boss and nothing else, for as long as the boss is alive. Once it is dead the
   * room rejoins the ordinary floor-wide advice flow.
   */
  private pinnedGatewayAdvice(guardsBossType: string | undefined): AdviceObjective | null {
    const id = gatewayAdviceId(guardsBossType);
    if (id === null) return null;
    const objective =
      id === 'ball_of_swine' ? this.ballOfSwineObjective('ball_of_swine') : this.bossObjective(id);
    return objective.complete ? null : objective;
  }

  /** What this floor still asks of the player, in the order Mordecai raises it. */
  private floorObjectives(): ReadonlyArray<AdviceSlot> {
    // The tutorial shares floor 1's number but not its map: its hand-crafted
    // grid has no boss rooms, no goblin mother and no stairs down, so the floor-1
    // list would send the player after a Hoarder that does not exist — and with
    // no boss room to take a bearing from, without even a direction.
    if (this.levelDef.id === TUTORIAL_LEVEL_ID) return [];

    switch (this.levelDef.floorNumber) {
      case DUNGEON_FLOOR_ONE:
        return [
          this.bossObjective('the_hoarder'),
          this.bossObjective('juicer'),
          this.defendQuestObjective(),
        ];
      case DUNGEON_FLOOR_TWO:
        return [
          this.bossObjective('krakaren_clone'),
          this.spiderLabObjective(),
          this.defendQuestObjective(),
          this.ballOfSwineObjective('ball_of_swine_distant'),
        ];
      case OVERWORLD_FLOOR_THREE:
        // The floor's three questlines, and deliberately not the Town Guide's
        // stops: Mordecai's advice is quest-shaped — a page of prose and a
        // bearing about something worth doing — and "there is a shop" is a
        // signpost, not a story. The Journal carries those; he does not.
        //
        // The Anchor's offer leads the list: accepting it is what makes every
        // later trip on this floor shorter, so he raises it before the other
        // three errands rather than after them.
        return [
          this.anchorOfferObjective(),
          this.circusObjective(),
          this.murderQuestObjective(),
          this.bountyObjective(),
          this.anchorStoneObjective(),
          this.speedFizzObjective(),
        ].filter((objective): objective is AdviceSlot => objective !== null);
      default:
        return [];
    }
  }

  private circusObjective(): AdviceObjective {
    return adviceObjective(
      'the_circus',
      this.circusQuest.questManager.getStatus(CIRCUS_QUEST_ID) === 'completed',
      this.gameMap.circusCentre ?? null,
    );
  }

  private murderQuestObjective(): AdviceObjective {
    const complete = this.murderQuest.questManager.getStatus(MURDER_QUEST_ID) === 'completed';
    // The quest's own first anchor, so his bearing points where its Journal row
    // does rather than at the town centre.
    const target = this.murderQuest.trackerEntries()[0]?.target ?? null;
    return adviceObjective('krasue_murders', complete, target);
  }

  /**
   * Shady, or null on a floor with no bounty loop — the bounty system is the one
   * of the three that is optional on the map.
   *
   * Never "complete": there is always another mark, which is the whole shape of
   * the loop. Mordecai therefore keeps offering it, which is correct — it is the
   * floor's repeatable work.
   */
  private bountyObjective(): AdviceObjective | null {
    const bounty = this.bounty;
    if (bounty === null) return null;
    return adviceObjective('shady_bounties', false, bounty.trackerEntries()[0]?.target ?? null);
  }

  /**
   * A boss objective, located by the boss's index in the level definition.
   *
   * `BossRoomSystem` builds its states from `gameMap.bossRooms` and its types
   * from `levelDef.bossRooms`, in the same order, so the two lists are index
   * aligned and this is the same mapping the system itself uses.
   */
  private bossObjective(bossType: 'the_hoarder' | 'juicer' | 'krakaren_clone'): AdviceObjective {
    const index = this.levelDef.bossRooms?.findIndex((room) => room.type === bossType) ?? -1;
    const room = index < 0 ? undefined : this.gameMap.bossRooms[index];
    return adviceObjective(
      bossType,
      this.bossRoom.defeatedBossTypes.has(bossType),
      room?.centre ?? null,
    );
  }

  private defendQuestObjective(): AdviceObjective {
    const complete = this.defendQuest.questManager.getStatus(DEFEND_QUEST_ID) === 'completed';
    return adviceObjective(
      'defend_goblin_mother',
      complete,
      this.gameMap.questRooms[0]?.centre ?? null,
    );
  }

  private spiderLabObjective(): AdviceObjective {
    return adviceObjective(
      'spider_lab',
      this.spiderQuest.isComplete,
      this.gameMap.spiderLabRoom?.centre ?? null,
    );
  }

  /**
   * The Ball of Swine, done once the arena has moved on to its second phase —
   * which is what killing it starts, and the only state that survives the event
   * that announced it.
   *
   * Shared between the pinned antechamber speech and the distant floor-wide
   * objective: both watch the same arena state and target, and differ only in
   * which prose id they carry.
   */
  private ballOfSwineObjective(id: 'ball_of_swine' | 'ball_of_swine_distant'): AdviceObjective {
    return adviceObjective(
      id,
      this.arena.phase2Active,
      this.gameMap.arenaExteriors[0]?.centre ?? null,
    );
  }

  /** Points at Madame Voss; complete once the party has taken up the errand. */
  private anchorOfferObjective(): AdviceObjective {
    return adviceObjective(
      'anchor_offer',
      this.anchorQuestProgress.status !== 'available',
      this.townProps?.fortuneTellerTile ?? null,
    );
  }

  /**
   * Restates what the assembled stone does, or null before it exists — a
   * player with no stone has nothing to use it on.
   *
   * No target: the objective is "use the item you are carrying", not "walk
   * somewhere", so there is nothing for a bearing to point at.
   */
  private anchorStoneObjective(): AdviceObjective | null {
    if (this.anchorQuestProgress.status !== 'completed') return null;
    return adviceObjective('anchor_stone', this.anchorQuestProgress.recallEverUsed, null);
  }

  /** Points at the tinker's stall; complete once a Speed Fizz has been bought or drunk. */
  private speedFizzObjective(): AdviceObjective {
    return adviceObjective(
      'speed_fizz_tip',
      this.anchorQuestProgress.speedFizzDiscovered,
      this.market?.stallTileFor(TINKER_VENDOR_ID) ?? this.gameMap.townSquareCentre ?? null,
    );
  }

  /**
   * Latches `speedFizzDiscovered` once either crawler is holding or drinking a
   * fizz. Neither signal alone survives the whole story — a bought fizz gets
   * drunk, a drunk fizz's status expires — so this is read every frame and only
   * ever flips the flag on, never off.
   */
  private updateSpeedFizzDiscovery(): void {
    if (this.anchorQuestProgress.speedFizzDiscovered) return;
    const owns = (player: HumanPlayer | CatPlayer): boolean =>
      player.inventory.countOf('speed_fizz') > 0 || player.hasStatus('speed_fizz');
    if (owns(this.human) || owns(this.cat)) this.anchorQuestProgress.speedFizzDiscovered = true;
  }

  private triggerSpaceAction(tapScreenX?: number, tapScreenY?: number): void {
    // Whatever owns the screen has already had this press: the keyboard path
    // hands it to `advanceDialog` before the suppression gate, and the mobile
    // tap path runs `handleClick` first. Either way the world behind the overlay
    // must not see it — that is what opened an NPC conversation underneath the
    // building menu and left both boxes fighting over the same clicks.
    if (this.focusedOverlay !== null) return;

    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) {
      // Beside the Mordecai and bed checks rather than above them: each fixture
      // owns its own corner of the room, so only one of the three can ever be in
      // range, and the order between them is not a priority decision.
      if (this.bopca.tryInteract(active)) {
        return;
      }
      if (this.safeRoom.isNearBed(active)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(active)) {
        this.talkToMordecai(active);
      }
      return;
    }
    // If an enemy is within attack range, prefer attacking over interacting
    const attackRange = this.human.isActive
      ? TILE_SIZE * HUMAN_ATTACK_RANGE_TILES
      : TILE_SIZE * CAT_ATTACK_RANGE_TILES;
    if (this.hasNearbyEnemy(active, attackRange)) {
      // fall through to attack logic below
    } else {
      // Chest interaction
      if (this.treasureChests.tryInteract(active)) {
        return;
      }
      if (this.defendQuest.tryInteract(active)) {
        return;
      }
      if (this.spiderQuest.tryInteract(active)) {
        return;
      }
      if (this.circusQuest.tryInteract(active)) {
        return;
      }
      if (this.murderQuest.tryInteract(active)) {
        return;
      }
      if (
        this.juicerRoom.tryPickupNear(active) ||
        this.arenaRoom.tryPickupNear(active) ||
        this.barriers.tryPickupNear(active)
      ) {
        return;
      }
      if (this.market?.tryInteract(active) === true) {
        return;
      }
      // Before the board he stands beside: with both in reach, a press should
      // reach the man, not the noticeboard behind him.
      if (this.bounty?.tryInteract(active, this.human, this.cat) === true) {
        return;
      }
      if (this.townProps?.tryInteract(active) === true) {
        return;
      }
      if (this.tryTalkToCitizen(active)) {
        return;
      }
    }
    if (this.tutorial !== null && !this.tutorial.canAttack) return;

    // On mobile tap: aim toward tap position before snapping to nearest mob
    if (tapScreenX !== undefined && tapScreenY !== undefined) {
      const cam = this.camera();
      const wx = tapScreenX + cam.x;
      const wy = tapScreenY + cam.y;
      const ddx = wx - (active.x + TILE_SIZE / 2);
      const ddy = wy - (active.y + TILE_SIZE / 2);
      const d = Math.hypot(ddx, ddy);
      if (d > 0) {
        active.facingX = ddx / d;
        active.facingY = ddy / d;
      }
    }
    triggerPlayerAttack(this.human, this.cat, this.world.roster.grid, this.gameMap, this.audio);
  }

  /**
   * The collaborators a hotbar press reaches. Rebuilt per press rather than held,
   * so it always names the systems this scene currently owns.
   */
  private hotbarHost(): HotbarHost {
    return {
      world: this.world,
      menus: this.menus,
      abilityManager: this.abilityManager,
      spells: this.combat.spells,
      dynamite: this.destruction.dynamite,
      trySceneSlot: (slot, hotbarIdx) => this.trySceneHotbarSlot(slot, hotbarIdx),
    };
  }

  /**
   * The slots that mean something only down here: the gym equipment a barrier is
   * built from, the quest boards, and the tutorial's one blocked item.
   *
   * @returns whether the press was consumed, so the shared table does not also
   *   act on it.
   */
  private trySceneHotbarSlot(slot: InventoryItem, hotbarIdx: number): boolean {
    if (this.tutorial?.blockBoxersActivation === true && slot.id === 'enchanted_bigboi_boxers') {
      this.audio?.play('error');
      this._companionErrorMsg = {
        text: 'The boxers are already doing their job — just equip them!',
        framesLeft: COMPANION_ERROR_DISPLAY_FRAMES,
      };
      return true;
    }
    if (
      (slot.id === 'gym_dumbbell' ||
        slot.id === 'gym_bench_press' ||
        slot.id === 'gym_treadmill') &&
      !this.barriers.isConstructing
    ) {
      this.barriers.beginConstruct(this.active(), hotbarIdx, slot.id);
      return true;
    }
    if (slot.id === 'quest_wood_board') {
      this.defendQuest.tryBuildBarrier(this.active());
      return true;
    }
    // A press while the stone is already channelling gives it up, so the same
    // key both starts and abandons the trip.
    if (slot.id === 'wayfinders_anchor') {
      this.recall.toggle(this.active());
      return true;
    }
    return false;
  }

  handleClick(mx: number, my: number, eventTimeStampMs: number): void {
    notifyButtonClick(mx, my);
    // Before the routing chain below, because most of its branches return long
    // before the bag is offered the click: a field left focused by a press that
    // opened the journal or the market would go on eating that overlay's keys.
    this.menus.blurInventorySearchUnlessClicked(mx, my);
    if (this.tutorial?.showNearGoblinDialog === true) {
      this.tutorial.dismissNearGoblinDialog();
      return;
    }

    if (this.tutorial?.showTutorialMordecaiDialog === true) {
      this.tutorial.advanceTutorialMordecaiDialog();
      return;
    }

    if (this.tutorial?.showMordecaiReminderDialog === true) {
      this.tutorial.advanceMordecaiReminderDialog();
      return;
    }

    if (this.chestRewardDialog.isOpen) {
      this.chestRewardDialog.handleClick(mx, my);
      return;
    }
    // Ranked here rather than below the panels, matching where `overlayClaims`
    // puts it: the award overlays swallow every click while they are up, so a
    // menu that outranked them here would take a press aimed at their OK button
    // and leave the overlay with no way to be dismissed.
    if (this.achievementUI.handleClick(mx, my)) return;
    if (this.menus.levelUpDialog.handleClick(mx, my)) return;
    if (this.menus.rewardGrantedDialog.handleClick(mx, my)) return;
    if (this.menus.skillBookPrompt.isOpen) {
      const reader = this.menus.pendingSkillBookReader(this.menus.inventoryPlayer());
      const choice = resolveSkillBookPrompt(this.menus.skillBookFlowHost(), reader, mx, my);
      if (choice !== null) this.menus.releaseSkillBookReader();
      return;
    }
    if (this.defendQuest.handleClick(mx, my)) return;
    if (this.spiderQuest.handleClick(mx, my, eventTimeStampMs)) return;
    if (this.bounty?.handleClick(mx, my) === true) return;
    if (this.circusQuest.handleClick(mx, my)) return;
    if (this.murderQuest.handleClick(mx, my)) return;
    if (this.anchorQuest.handleClick(mx, my)) return;
    // Only the dialog's own box is consumed: a conversation does not halt the
    // world, so the bag can be open underneath it and its slots must stay live.
    if (this.citizenDialog?.handleClick(mx, my) === true) return;
    if (this.noticeBoard?.isOpen === true) {
      this.noticeBoard.handleClick();
      return;
    }
    if (this.marketPanel?.isOpen === true) {
      this.marketPanel.handleClick(mx, my, this.active());
      return;
    }
    if (this.fortuneTeller?.isOpen === true) {
      this.fortuneTeller.handleClick(mx, my, this.active());
      return;
    }
    if (this.followerMenu.isOpen) {
      this.followerMenu.restrictedToButtonIndex = this.tutorial?.followerMenuRestriction ?? null;
      this.followerMenu.handleClick(mx, my);
      return;
    }

    if (!platform.isMobile && !this.gameOver && !this.menus.pauseMenu.isOpen) {
      if (pointInRect(mx, my, this.touch.followBtnRect)) {
        this.triggerCompanionFollow();
        return;
      }
    }

    if (
      !platform.isMobile &&
      !this.gameOver &&
      !this.menus.pauseMenu.isOpen &&
      this.mongoSystem.canShow &&
      this.cat.isActive
    ) {
      const sb = this.touch.summonBtnRect;
      if (pointInRect(mx, my, sb)) {
        this.toggleMongoSummon();
        return;
      }
    }

    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      if (this.achievementUI.handleAchievIconClick(mx, my)) return;
      if (this.achievementUI.handleLootBoxIconClick(mx, my, () => this.menus.pauseMenu.close()))
        return;
      if (this.menus.tryOpenSpendScreen(mx, my, this._hudSkillBannerRect)) return;
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.advanceMordecaiDialog();
      return;
    }

    if (this.bopca.handleClick(mx, my)) {
      return;
    }

    if (this.levelCompleteScreen.isActive) {
      this.levelCompleteScreen.handleClick(mx, my);
      return;
    }

    if (this.stairwell.menuOpen) {
      this.stairwell.handleClick(mx, my);
      return;
    }

    if (this.building?.menuOpen) {
      this.building.handleClick(mx, my);
      return;
    }

    if (this.gameOver) {
      if (this.combat.deathScreen.handleClick(mx, my)) {
        this.respawnAfterDeath();
      }
      return;
    }

    if (this.menus.pauseMenu.isOpen) {
      const allowedLabel = this.tutorial?.getAllowedMenuButtonLabel(
        this.menus.pauseMenu.currentTab,
      );
      if (allowedLabel !== undefined && allowedLabel !== null) {
        // Tutorial is guiding: only permit the highlighted button to be clicked
        const btn = this.menus.pauseMenu.renderedButtons.find((b) => b.label === allowedLabel);
        if (btn !== undefined) {
          const { x, y, w, h } = btn;
          if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
            if (btn.positionedAction !== undefined) {
              btn.positionedAction(mx, my);
            } else {
              btn.action?.();
            }
          }
        }
        return;
      }
      this.menus.pauseMenu.handleClick(mx, my);
      return;
    }

    const active = this.active();
    const invPlayer = this.menus.inventoryPlayer();

    const gearResult = this.menus.gearPanel.handleClick(mx, my, active.inventory);
    if (gearResult) {
      active.onEquipmentChanged();
      return;
    }

    if (this.menus.gearPanel.isOpen && this.menus.inventoryPanel.isOpen) {
      const slotIdx = this.menus.inventoryPanel.getClickedInventorySlot(
        mx,
        my,
        invPlayer.inventory,
      );
      if (slotIdx !== null) {
        const item = invPlayer.inventory.bag.slots[slotIdx];
        if (isWearable(item) && this.menus.inventoryPanel.interaction.bagSlotIsInteractive(item)) {
          // The click is spent either way — it was aimed at armour — but a
          // refusal (wrong wearer, same id already worn) changes nothing, and
          // announcing a change that never happened is a lie to every listener.
          if (invPlayer.inventory.canEquipSlot(slotIdx)) {
            invPlayer.inventory.equip(slotIdx);
            invPlayer.onEquipmentChanged();
          }
          return;
        }
      }
    }

    // With the rest of the HUD chrome, and crucially *above* the world hit-tests
    // below: those compare screen coordinates against loot drops and chests, so
    // anything drawn behind the button would otherwise take a click aimed at it.
    if (this.journalButtonRect !== null && pointInRect(mx, my, this.journalButtonRect)) {
      this.openQuestJournal();
      return;
    }

    const wasInventoryOpen = this.menus.inventoryPanel.isOpen;
    if (this.menus.inventoryPanel.handleClick(mx, my, invPlayer.inventory)) {
      this.menus.resolvePendingInventoryActions(invPlayer, (id, quantity) =>
        this.destruction.loot.addPlayerDrop(invPlayer.x, invPlayer.y, id, quantity, invPlayer),
      );
      if (this.menus.inventoryPanel.isOpen && !wasInventoryOpen) {
        this.menus.gearPanel.isOpen = false;
      }
      return;
    }

    const { x: camX, y: camY } = this.camera();
    if (this.destruction.loot.tryCollectLootAt(mx, my, camX, camY, active, this.inactive())) return;

    // Click on an unlocked chest in the world to open it
    for (const chest of this.treasureChests.allChests) {
      if (chest.state !== 'unlocked') continue;
      const chestScreenX = chest.tileX * TILE_SIZE - camX;
      const chestScreenY = chest.tileY * TILE_SIZE - camY;
      if (
        mx >= chestScreenX &&
        mx <= chestScreenX + TILE_SIZE &&
        my >= chestScreenY &&
        my <= chestScreenY + TILE_SIZE
      ) {
        if (this.treasureChests.tryInteract(active)) return;
      }
    }

    const pb = UIRenderer.pauseButtonRect(this.miniMap);
    if (pointInRect(mx, my, pb)) {
      this.menus.pauseMenu.toggle();
      this.menus.closePanels();
      this.input.clear();
      return;
    }
  }

  private clearInvLongPress(): void {
    if (this.touch.longPressTimer !== null) {
      clearTimeout(this.touch.longPressTimer);
      this.touch.longPressTimer = null;
    }
    this.touch.longPressPos = null;
  }

  /**
   * True while a pausing overlay owns the screen. The bag is still drawn
   * underneath one, and the overlays' buttons sit right on top of its slots, so
   * every raw-pointer path has to stop here — otherwise a click on Read or
   * Cancel also lands on the slot beneath it and re-queues the prompt.
   */
  private get isOverlayBlockingPointer(): boolean {
    return this.menus.isOverlayBlockingPointer;
  }

  handleMouseDown(mx: number, my: number): void {
    this._mouseDown = true;
    // Delegated rather than swallowed: the pause menu's Equipment tab drags gear
    // between the bag and the doll, and a drag is a press and a release, not a
    // click. Every other tab ignores these.
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseDown(mx, my, this.human, this.cat);
      return;
    }
    if (this.gameOver || this.isOverlayBlockingPointer) return;
    if (this.miniMap.isExpanded && pointInRect(mx, my, this.touch.miniMapRect)) {
      this._miniMapDragging = true;
      this._miniMapDragLastX = mx;
      this._miniMapDragLastY = my;
      return;
    }
    this.menus.inventoryPanel.handleMouseDown(mx, my, this.menus.inventoryPlayer().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseMove(mx, my);
      return;
    }
    if (this._miniMapDragging) {
      this.miniMap.pan(mx - this._miniMapDragLastX, my - this._miniMapDragLastY);
      this._miniMapDragLastX = mx;
      this._miniMapDragLastY = my;
    }
    this.menus.inventoryPanel.handleMouseMove(mx, my);
    this.menus.gearPanel.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseDown = false;
    this._miniMapDragging = false;
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseUp(mx, my, this.human, this.cat);
      return;
    }
    if (this.gameOver || this.isOverlayBlockingPointer) return;
    this.menus.inventoryPanel.handleMouseUp(mx, my, this.menus.inventoryPlayer().inventory);
  }

  handleMouseLeave(): void {
    this._mouseDown = false;
    this._miniMapDragging = false;
    clearButtonMouseState();
  }

  handleContextMenu(mx: number, my: number): void {
    if (this.gameOver || this.menus.pauseMenu.isOpen || this.isOverlayBlockingPointer) return;
    this.menus.inventoryPanel.openContextMenu(mx, my, this.menus.inventoryPlayer().inventory);
  }

  handleWheel(deltaY: number): void {
    if (this.menus.pauseMenu.isOpen) this.menus.pauseMenu.handleWheel(deltaY);
  }

  update(): void {
    this.yieldCitizenDialogToInterruption();
    this.dismissCitizenDialogIfWalkedAway();
    if (this.citizenDialogTarget !== null && this.citizenDialog?.isOpen !== true) {
      this.citizenDialogTarget.frozen = false;
      this.citizenDialogTarget = null;
    }
    aiAdapter.update();
    this.chat.update();
    this.citizenDialog?.update();
    if (this._companionErrorMsg !== null) {
      this._companionErrorMsg.framesLeft--;
      if (this._companionErrorMsg.framesLeft <= 0) {
        this._companionErrorMsg = null;
      }
    }
    this.achievementUI.tick();
    // Above the boss-intro return below: an award overlay raised on the frame a
    // boss room locks would otherwise sit frozen at its first frame for the
    // length of the intro, and a potion's effect cue would be held with it.
    this.menus.update();
    this.chestRewardDialog.tick();
    if (this.chestRewardDialog.rewardSoundPending) {
      this.chestRewardDialog.rewardSoundPending = false;
      this.audio?.play('treasure_chest_reward');
    }

    // Only tick once audio is ready so the intro visual and sound start together.
    if (this.introStarted && this.tutorial === null) {
      this.dungeonIntro.tick();
    }

    if (this.bossIntro.isActive) {
      this.bossIntro.tick();
      return;
    }

    // Spider quest ticks even while other systems are paused (keyboard hero must advance)
    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      const sqCtx = this.buildSystemContext();
      this.spiderQuest.update(sqCtx);
      this._processSpiderQuestSounds();
    }

    // Town keeps living through citizen chats and other overlay dialogs — only a
    // hard stop (game over, the pause menu, or the level-complete screen) should
    // freeze the streets.
    if (!this.gameOver && !this.menus.pauseMenu.isOpen && !this.levelCompleteScreen.isActive) {
      this.townLife?.update(this.buildSystemContext());
      this.townProps?.update();
      this.townDecor?.update();
      this.market?.update();
      // Latches its stops here rather than in `updateGameplay`, so walking past
      // the shop while a citizen is mid-sentence still counts as having found it.
      this.townGuide?.update(this.buildSystemContext());
    }

    // Above the gameplay-halted early return below: his talk pose is only ever
    // wanted while his own dialog is open, which is exactly when gameplay is
    // halted and `updateGameplay` never runs.
    this.bounty?.syncShady();
    // Same reason, for the two givers whose beacon and glyph are drawn by
    // different owners. Their marker state is suppressed while their own dialog
    // is open, and an open dialog is a halted frame — so setting it in `update`
    // alone would leave a column of light standing over somebody mid-sentence.
    this.circusQuest.syncMarkers();
    this.murderQuest.syncMarkers();

    // Also drained ahead of the early returns: the request is raised by a
    // right-click or a hotbar key, neither of which routes through the panel's
    // own click handler, and the prompt it opens is itself one of the gates.
    this.menus.openPendingSkillBookPrompt(this.menus.inventoryPlayer());

    if (this.gameplayHalted) {
      this.marketPanel?.update();
      return;
    }

    if (this.safeRoom.isSleeping) {
      const deduct = this.safeRoom.updateSleep(this.human, this.cat);
      this.levelTimerFrames = Math.max(0, this.levelTimerFrames - deduct);
      return;
    }

    if (this.tutorial?.showNearGoblinDialog === true) return;
    if (this.tutorial?.showTutorialMordecaiDialog === true) {
      this.tutorial.tickDialog();
      return;
    }

    this.updateGameplay();
  }

  render(ctx: CanvasRenderingContext2D): void {
    setButtonAudio(this.audio);
    setButtonMouseState(this._mouseX, this._mouseY, this._mouseDown);
    // Any overlay at all, not only the world-halting ones: a street conversation
    // lets the player keep walking, and a "SPACE — Talk" cap still hovering over
    // the citizen they are already talking to is the loudest of these.
    setInteractionPromptsSuppressed(this.focusedOverlay !== null || this.gameOver);
    const { x: camX, y: camY } = this.camera();

    const rc: RenderContext = {
      camX,
      camY,
      gameMap: this.gameMap,
      pm: this.pm,
      active: this.active(),
      inactive: this.inactive(),
      mobs: this.world.roster.mobs,
      mobGrid: this.world.roster.grid,
      townsfolk: this.townLife?.people,
      townProps: this.townPropRenderables ?? undefined,
      gameOver: this.gameOver,
      pauseMenuOpen: this.menus.pauseMenu.isOpen,
      gore: this.combat.gore,
      bodyPartGore: this.combat.bodyPartGore,
      safeRoom: this.safeRoom,
      bossRoom: this.bossRoom,
      juicerRoom: this.juicerRoom,
      arenaRoom: this.arenaRoom,
      stairwell: this.stairwell,
      building: this.building,
      barriers: this.barriers,
      spells: this.combat.spells,
      dynamite: this.destruction.dynamite,
      smushFx: this.combat.smushFx,
      lavaBalls: this.lavaBalls,
      rockThrows: this.rockThrows,
      skeletonShots: this.skeletonShots,
      goblinArrows: this.goblinArrows,
      clownGas: this.clownGas,
      knightMissiles: this.knightMissiles,
      destructibles: this.destruction.destructibles,
      trees: this.trees,
      water: this.water,
      loot: this.destruction.loot,
      treasureChests: this.treasureChests,
      miniMap: this.miniMap,
      mongoSystem: this.mongoSystem,
      speechBubblePulse: this.speechBubblePulse,
    };

    this.renderPipeline.renderWorld(ctx, rc);
    this.bopca.renderObjects(ctx, camX, camY, this.active(), this.inactive());
    this.tutorial?.renderGatesAndLedge(ctx, camX, camY);
    const activeCrawler = this.active();
    this.defendQuest.renderObjects(ctx, camX, camY, activeCrawler, activeCrawler);
    this.spiderQuest.render(ctx, camX, camY, this.active());
    this.circusQuest.render(ctx, camX, camY, this.active());
    this.murderQuest.render(ctx, camX, camY, this.active());
    this.doomsdayEscape.render(ctx, camX, camY);
    this.combat.floatingText.render(ctx, camX, camY);
    // Puddles render before entities so players/mobs always appear on top of them
    for (const spider of this.grotesqueSpiders) {
      spider.renderSpitGroundTraps(ctx, camX, camY, TILE_SIZE);
    }

    this.renderPipeline.renderEntities(ctx, rc);
    this.murderQuest.renderWellClueOverlay(ctx, camX, camY, this.active());
    this.spiderQuest.renderTableForeground(ctx, camX, camY, this.active());
    this.spiderQuest.renderLifeMachinesForeground(ctx, camX, camY, this.active());
    this.bossRoom.renderProjectiles(ctx, camX, camY);
    // Projectile renders after entities so it flies visually over mobs/players
    for (const spider of this.grotesqueSpiders) {
      spider.renderSpitProjectile(ctx, camX, camY, TILE_SIZE);
    }
    this.spiderQuest.renderCutsceneEffects(ctx, camX, camY);

    this.chat.renderBubble(ctx, camX, camY);

    this.renderPipeline.renderTowerBalconyOverlay(ctx, rc);

    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) =>
      UIRenderer.renderLevelUpFlash(c, cx, cy, this.pm),
    );

    this.renderPipeline.renderVisibilityFog(ctx, rc);

    UIRenderer.renderHealthVignette(ctx, this.active(), this.gameOver);

    // Between the fog and the HUD, and pinned there by both neighbours.
    //
    // It has to be after the fog, which fills everything past its outer radius
    // with solid black: a marker clamped to the screen edge is by definition out
    // at that radius or further — further still once the camera clamps at a map
    // border and puts the party on the opposite side of the screen — so drawn
    // with the world effects it was painted out in precisely the
    // far-from-the-cat case it exists to answer.
    //
    // And it has to be before the HUD, which is the one piece of chrome drawn
    // ahead of it. The other directional affordances below are drawn *at the
    // player* and can never reach the corners; this one is clamped to the edge,
    // so a pet off the top of the screen puts it inside the HUD panel's health
    // bars. Everything else on screen — the minimap, the buttons, the pause menu
    // and the award overlays — is drawn after this point and covers it already.
    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      this.mongoSystem.renderOffscreenMarker(
        ctx,
        camX,
        camY,
        this.active(),
        visibilityRadiusPx(this.active()),
      );
    }

    // Render the HUD panel. On mobile the skill-points badge is NOT drawn here;
    // it is stacked below the boss UI box further down in this method.
    const hudResult = drawHUD(ctx, this.human, this.cat, this.notifPulse, this._hudCollapsed);
    this._hudToggleRect = hudResult.toggleRect;
    this._hudRect = hudResult.hudRect;
    if (!platform.isMobile) {
      this._hudSkillBannerRect = hudResult.notifRect;
    }

    // Rebuilt once here, above every consumer: the pinned world arrow, the
    // minimap's extra marker and the Journal tab all resolve the pin against
    // this list, and reading it a block later would have the arrow a frame
    // behind the tab it is supposed to be following. Skipped outright on the
    // floors with no Journal, where every one of those consumers is off — the
    // list is rebuilt from scratch each frame and nothing would read it.
    if (this.hasQuestJournal) this.collectTrackerEntries();
    else this._trackerEntries.length = 0;
    // Every frame, not only when the Journal is opened from its own button: the
    // pause menu can also be reached with Escape, and the Game tab decides
    // whether to offer a Quest Journal row from whether this is null.
    this.syncJournalContext();

    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      const mmSize = this.miniMap.isExpanded
        ? this.miniMap.EXPANDED_SIZE
        : this.miniMap.NORMAL_SIZE;
      renderKnockedOutUI(ctx, camX, camY, this.active(), this.inactive(), mmSize);
      this.renderStairwellRevealArrow(ctx, camX, camY);
      this.renderWayfinderArrow(ctx, camX, camY);
      this.renderSpiderLabArrow(ctx, camX, camY);
      this.bounty?.renderArrow(ctx, this.active(), camX, camY, this._hudRect);
      this.renderAvailableQuestBeacons(ctx, camX, camY);
      this.renderPinnedObjectiveBeacon(ctx, camX, camY);
      this.renderPinnedObjectiveArrow(ctx, camX, camY);
      this.recall.render(ctx, this.active(), camX, camY, this._hudRect);
    }

    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      this.miniMap.render(
        ctx,
        this.active(),
        this.inactive(),
        this.world.roster.grid,
        this.safeRoom.mordecaiPositions,
        this.collectQuestMarkers(),
        this.mongoSystem.mongo,
      );
      const mmSz = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
      this.touch.miniMapRect = {
        x: viewportWidth() - mmSz - MINIMAP_MARGIN,
        y: MINIMAP_MARGIN,
        w: mmSz,
        h: mmSz,
      };
    } else {
      this.touch.miniMapRect = { x: -9999, y: 0, w: 0, h: 0 };
    }

    if (this.levelDef.hasCollapseTimer === true && !this.gameOver && this.tutorial === null) {
      UIRenderer.renderLevelTimer(ctx, this.miniMap, this.levelTimerFrames);
    }

    let mobileQuestTopY: number | undefined;
    if (platform.isMobile) {
      // On mobile, stack the boss UI directly below the HUD bar and render the
      // skill-points badge below that so nothing overlaps.
      const mobileTopY = hudResult.hudPanelBottom + MOBILE_UI_SPACING;
      const bossBottom = this.bossRoom.renderUI(
        ctx,
        camX,
        camY,
        this.world.roster.mobs,
        this.human,
        this.cat,
        mobileTopY,
      );
      const skillTopY = bossBottom !== null ? bossBottom + MOBILE_UI_SPACING : mobileTopY;
      this._hudSkillBannerRect = renderMobileSkillBadge(
        ctx,
        this.human,
        this.cat,
        this.notifPulse,
        skillTopY,
      );
      const skillBadgeBottom =
        this._hudSkillBannerRect.w > 0
          ? this._hudSkillBannerRect.y + this._hudSkillBannerRect.h
          : skillTopY;
      mobileQuestTopY = skillBadgeBottom + MOBILE_UI_SPACING;
    } else {
      this.bossRoom.renderUI(ctx, camX, camY, this.world.roster.mobs, this.human, this.cat);
    }
    this.arena.render(ctx, this.active());

    this.destruction.loot.render(ctx, camX, camY, this.active());

    const showAchievUI = this.tutorial === null || this.tutorial.showAchievementUI;
    if (showAchievUI) {
      this.achievementUI.drawAchievementIcon(
        ctx,
        this.miniMap,
        this.gameOver,
        this.menus.pauseMenu.isOpen,
      );
      this.achievementUI.drawLootBoxIcon(ctx, this.gameOver, this.menus.pauseMenu.isOpen);
    }

    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      const active = this.active();
      const invPlayer = this.menus.inventoryPlayer();
      const invName = invPlayer === this.human ? 'Human' : 'Cat';
      this.menus.inventoryPanel.abilityCooldowns.set('protective_shell', {
        current: this.combat.spells.shellCooldown,
        max: this.combat.spells.shellCooldownMax,
      });
      this.menus.inventoryPanel.abilityCooldowns.set('magic_missile', {
        current: this.cat.missileCooldownCurrent,
        max: Math.max(1, this.cat.missileCooldownMax),
      });
      this.menus.inventoryPanel.abilityCooldowns.set('smush', {
        current: this.human.smushCooldown,
        max: Math.max(1, this.human.getSmushCooldownMax()),
      });
      // Keyed by item id rather than ability id — the stone is a plain item that
      // happens to have a cooldown; `renderSlot` falls back to the id for it.
      this.menus.inventoryPanel.abilityCooldowns.set('wayfinders_anchor', {
        current: this.recall.cooldownRemainingFrames,
        max: RECALL_COOLDOWN_FRAMES,
      });
      const mmSz = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
      this.menus.inventoryPanel.mmSize = mmSz;

      // Render persistent HUD buttons before panels so open menus and context menus paint over them.
      UIRenderer.drawPauseButton(ctx, this.miniMap, this.gameOver, this.menus.pauseMenu.isOpen);

      if (this.hasQuestJournal) {
        const outstanding = this._trackerEntries.filter((entry) =>
          isOutstanding(entry.status),
        ).length;
        this.journalButtonRect = UIRenderer.drawJournalButton(ctx, this.miniMap, outstanding);
      } else {
        this.journalButtonRect = null;
      }
      if (platform.isMobile)
        UIRenderer.renderMobileButtons(ctx, this.touch, {
          human: this.human,
          cat: this.cat,
          miniMap: this.miniMap,
          companion: this.companion,
          mongoSystem: this.mongoSystem,
          inventoryPanel: this.menus.inventoryPanel,
          gearPanel: this.menus.gearPanel,
          hideSwitchButton: this.tutorial !== null && !this.tutorial.showSwitchButton,
          hideFollowerButton: this.tutorial !== null && !this.tutorial.showFollowerButton,
        });
      else if (this.tutorial === null || this.tutorial.showFollowerButton)
        UIRenderer.renderFollowerButton(ctx, this.touch, this.companion, this.human.isActive);

      this.menus.inventoryPanel.render(
        ctx,
        invPlayer.inventory,
        invName,
        invPlayer.coins,
        this.menus.inventoryWieldedWeaponId(),
      );
      const activeName = this.human.isActive ? 'Human' : 'Cat';
      this.menus.gearPanel.render(ctx, active.inventory, activeName);
      this.destruction.dynamite.renderChargeBar(ctx, viewportWidth(), viewportHeight());
      this.barriers.renderConstructUI(ctx);
      this.defendQuest.renderUI(ctx, mobileQuestTopY);
      this.circusQuest.renderUI(ctx);
      this.murderQuest.renderUI(ctx);
      this.anchorQuest.renderUI(ctx);
      this.doomsdayEscape.renderUI(ctx);
      if (!platform.isMobile && this.mongoSystem.canShow && this.cat.isActive) {
        this.touch.summonBtnRect = this.mongoSystem.renderSummonButton(
          ctx,
          SUMMON_BUTTON_X,
          viewportHeight() -
            SUMMON_BUTTON_Y_OFFSET_1 -
            SUMMON_BUTTON_Y_OFFSET_2 -
            SUMMON_BUTTON_Y_OFFSET_3 -
            SUMMON_BUTTON_Y_OFFSET_4,
          SUMMON_BUTTON_WIDTH,
          SUMMON_BUTTON_HEIGHT,
          this.cat.isActive,
        );
      }
    }

    if (this.gameOver) {
      this.combat.deathScreen.render(ctx);
    }

    if (this.menus.pauseMenu.isOpen) {
      const inSafe = this.human.isProtected || this.cat.isProtected;
      const onOpenHuman =
        inSafe && this.humanAchievements.pendingBoxes.length > 0
          ? () => this.achievementUI.openBoxQueue('human', () => this.menus.pauseMenu.close())
          : undefined;
      const onOpenCat =
        inSafe && this.catAchievements.pendingBoxes.length > 0
          ? () => this.achievementUI.openBoxQueue('cat', () => this.menus.pauseMenu.close())
          : undefined;
      this.menus.renderPauseMenu(ctx, {
        humanAchievements: this.humanAchievements,
        catAchievements: this.catAchievements,
        gameStats: this.gameStats,
        onOpenHumanBoxes: onOpenHuman,
        onOpenCatBoxes: onOpenCat,
        mouseX: this._mouseX,
        mouseY: this._mouseY,
      });
    }

    const anyMenuOpen =
      this.menus.pauseMenu.isOpen ||
      this.menus.inventoryPanel.isOpen ||
      this.menus.gearPanel.isOpen ||
      this.followerMenu.isOpen;
    if (!this.gameOver && !anyMenuOpen) {
      this.safeRoom.renderUI(
        ctx,
        camX,
        camY,
        this.active(),
        this.bopca.hasInteraction(this.active()),
      );
      this.bopca.renderUI(ctx, camX, camY, this.active());
      this.renderCitizenPrompt(ctx, camX, camY);
      this.bounty?.renderShadyOverlay(ctx, camX, camY, this.active());
      this.renderPropPrompt(ctx, camX, camY);
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.renderMordecaiDialog(ctx);
    }

    this.bopca.renderDialog(ctx);

    this.bounty?.renderDialog(ctx);
    this.citizenDialog?.render(ctx);
    this.noticeBoard?.render(ctx);
    this.marketPanel?.render(ctx, this.active());
    this.fortuneTeller?.render(ctx, this.active());

    if (this.stairwell.menuOpen) {
      this.stairwell.renderMenu(ctx);
    }

    if (this.levelCompleteScreen.isActive) {
      this.levelCompleteScreen.render(ctx);
    }

    if (this.building?.menuOpen) {
      this.building.renderMenu(ctx);
    }

    if (this.safeRoom.isSleeping) {
      this.safeRoom.renderSleepOverlay(ctx);
    }

    if (this.followerMenu.isOpen) {
      this.followerMenu.restrictedToButtonIndex = this.tutorial?.followerMenuRestriction ?? null;
      this.followerMenu.render(
        ctx,
        this.companion.getMovementMode(this.human.isActive),
        this.companion.getCombatStance(this.human.isActive),
        this.human.isActive,
      );
    }

    // The award stack, drawn lowest-priority first so that draw order matches
    // the order `overlayClaims` and `handleClick` rank these same surfaces in.
    // Whichever one is on top is then also the one that owns the keyboard's
    // focus ring and the one a click reaches — three orders that used to
    // disagree, which left the topmost dialog visible but un-activatable.
    this.menus.renderOverlays(ctx);
    this.achievementUI.renderOverlays(ctx);
    if (this.chestRewardDialog.isOpen) {
      this.chestRewardDialog.render(ctx);
    }

    // Hidden behind the pause menu, like every other overlay above: the intro
    // card is drawn last and would otherwise cover the menu it was opened over,
    // leaving a screen of buttons nobody can see to aim at.
    if (this.tutorial === null && !this.menus.pauseMenu.isOpen) {
      this.dungeonIntro.render(ctx);

      if (this.dungeonIntro.isActive && !this.introStarted) {
        const hint = platform.isMobile ? 'Tap to begin' : 'Press any key to begin';
        drawText(ctx, hint, {
          x: Math.round(viewportWidth() / 2),
          y: Math.round(viewportHeight() * HEALTH_BAR_COLOR_THRESHOLD),
          align: 'center',
          size: 18,
          bold: true,
          color: '#ffffff',
          outline: true,
          glow: true,
        });
      }
    }

    if (this._companionErrorMsg !== null) {
      const msg = this._companionErrorMsg;
      const FADE_FRAMES = 30;
      const alpha = Math.min(1, msg.framesLeft / FADE_FRAMES);
      drawText(ctx, msg.text, {
        x: Math.round(viewportWidth() / 2),
        y: Math.round(viewportHeight() * HEALTH_BAR_WARNING_THRESHOLD),
        align: 'center',
        size: 18,
        bold: true,
        color: '#ff5555',
        outline: true,
        alpha,
      });
    }

    this.menus.hotbarToast.render(ctx, this.menus.inventoryPanel.hotbarBandHeight());
    aiAdapter.render(ctx);
    this.chat.renderHint(ctx);
    this.spiderQuest.renderUI(ctx, camX, camY);

    if (this.bossIntro.isActive) {
      this.bossIntro.render(ctx);
    }

    if (
      platform.showEntityTooltip &&
      !this.gameOver &&
      !this.menus.pauseMenu.isOpen &&
      !this.achievementUI.isBlocking
    ) {
      UIRenderer.renderEntityTooltip(
        ctx,
        camX,
        camY,
        this._mouseX,
        this._mouseY,
        this.world.roster.grid,
      );
    }

    if (this.tutorial !== null) {
      const { x: tutCamX, y: tutCamY } = this.camera();
      const activePlayer = this.active();
      const pb = UIRenderer.pauseButtonRect(this.miniMap);
      const invPlayer = this.menus.inventoryPlayer();
      const bagSlots = invPlayer.inventory.bag.slots;
      const smushIdx = bagSlots.findIndex((s) => s?.id === 'smush_tome');
      const potionIdx = bagSlots.findIndex((s) => s?.id === 'health_potion');
      const boxersIdx = bagSlots.findIndex((s) => s?.id === 'enchanted_bigboi_boxers');
      const missileIdx = bagSlots.findIndex((s) => s?.id === 'magic_missile_tome');
      const HOTBAR_SLOT_COUNT = 8;
      const tutRenderCtx: TutorialRenderContext = {
        isPlayerInSafeRoom: this.safeRoom.isEntityInSafeRoom(activePlayer),
        pauseMenuOpen: this.menus.pauseMenu.isOpen,
        pauseMenuTab: this.menus.pauseMenu.isOpen ? this.menus.pauseMenu.currentTab : null,
        pauseMenuButtons: this.menus.pauseMenu.renderedButtons,
        inventoryPanelOpen: this.menus.inventoryPanel.isOpen,
        gearPanelOpen: this.menus.gearPanel.isOpen,
        pauseButtonRect: { x: pb.x, y: pb.y, w: pb.w, h: pb.h },
        bagItemRects: {
          smush_tome:
            smushIdx >= 0 ? (this.menus.inventoryPanel.getBagSlotRect(smushIdx) ?? null) : null,
          health_potion:
            potionIdx >= 0 ? (this.menus.inventoryPanel.getBagSlotRect(potionIdx) ?? null) : null,
          enchanted_bigboi_boxers:
            boxersIdx >= 0 ? (this.menus.inventoryPanel.getBagSlotRect(boxersIdx) ?? null) : null,
          magic_missile_tome:
            missileIdx >= 0 ? (this.menus.inventoryPanel.getBagSlotRect(missileIdx) ?? null) : null,
        },
        hotbarSlotRects: Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) =>
          this.menus.inventoryPanel.getHotbarSlotRect(i),
        ),
        isDragActive: this.menus.inventoryPanel.interaction.isDragging,
        isAchievementNotifActive: this.achievementUI.notifActive,
        isContextMenuOpen: this.menus.inventoryPanel.interaction.contextMenu !== null,
        contextMenuOptionRects: this.menus.inventoryPanel.contextMenuOptionRects,
        isAbilityDialogShowing: this.menus.levelUpDialog.isShowing,
        isRewardGrantedDialogShowing: this.menus.rewardGrantedDialog.isShowing,
        followerButtonRect: this.touch.followBtnRect.w > 0 ? this.touch.followBtnRect : null,
        followerMenuOpen: this.followerMenu.isOpen,
        followerMenuFollowMeRect: this.followerMenu.isOpen
          ? this.followerMenu.followMeButtonRect
          : null,
      };
      this.tutorial.renderOverlay(
        ctx,
        tutCamX,
        tutCamY,
        activePlayer.x,
        activePlayer.y,
        tutRenderCtx,
      );
    }

    // Last, once every surface has drawn: the ring belongs to whoever declared
    // it last, so this is the only point at which the frame's answer to "who
    // owns the keyboard" is final.
    //
    // The bag declares no claim of its own, so every claim in that list outranks
    // it. Checked per frame rather than at each overlay's open, because the
    // floor raises them from event handlers, the mobile tap path and a death the
    // player never touched a button for.
    if (keyboardSuppressed(this.overlayClaims)) this.menus.blurInventorySearch();
    auditOverlayFocus(this.overlayClaims, menuFocusContextId());
  }

  /**
   * The refusal a doorway answers with, or null when it opens normally.
   *
   * The only door in town a quest holds shut. `BuildingSystem` asks rather than
   * decides, so the tent's reason for being closed stays with the questline that
   * closes it.
   */
  private sealedBuildingMessage(entry: BuildingEntry): string | null {
    if (entry.name !== BIG_TOP_BUILDING_NAME) return null;
    return isBigTopSealed(this.circusQuestProgress.stage) ? BIG_TOP_SEALED_MESSAGE : null;
  }

  /** Gathers every quest's minimap markers into one reused array. */
  private collectQuestMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const markers = this._questMarkers;
    markers.length = 0;
    markers.push(...this.defendQuest.questMarkers);
    markers.push(...this.circusQuest.questMarkers);
    markers.push(...this.murderQuest.questMarkers);
    markers.push(...this.anchorQuest.questMarkers);
    if (this.bounty !== null) markers.push(...this.bounty.questMarkers);
    const pinned = resolvePinnedEntry(this.journalProgress.pinnedTrackerId, this._trackerEntries);
    // The pinned objective gets a marker of its own on top of whatever its own
    // system already contributes. That is not redundant: a quest can be pinned
    // while its system's marker rules say nothing (a bounty being collected,
    // a Town Guide pointer), and the pin is the player's own answer to "where
    // am I going", which should outrank the quest's.
    if (pinned?.target !== undefined) {
      markers.push({ x: pinned.target.x, y: pinned.target.y, type: 'exclamation' });
    }
    return markers;
  }

  /** Gathers every quest system's Journal lines into one reused array. */
  private collectTrackerEntries(): TrackerEntry[] {
    const entries = this._trackerEntries;
    entries.length = 0;
    entries.push(
      ...collectTrackerEntries([
        this.defendQuest,
        this.spiderQuest,
        this.circusQuest,
        this.murderQuest,
        this.anchorQuest,
        this.bounty,
        this.townGuide,
      ]),
    );
    return entries;
  }

  /**
   * Refreshes and returns the shared per-frame system context. One mutable
   * object reused across every system and every call in a frame — it used to be
   * rebuilt (with a fresh `extraTargets` array) twice per frame.
   */
  private buildSystemContext(): SystemContext {
    const active = this.active();
    const targets = this._extraTargets;
    targets.length = 0;
    // Not while he is retreating: on one hit point with the interception holding
    // him there, further hits are damage nobody can act on and a fight he cannot
    // leave.
    const mongo = this.mongoSystem.mongo;
    if (mongo && !mongo.recalling && !mongo.collapsing) targets.push(mongo);
    if (this.mercenarySystem.activeMerc) targets.push(this.mercenarySystem.activeMerc);
    const npc = this.defendQuest.questNPC;
    if (npc?.isAlive) targets.push(npc);

    const ctx = this._systemContext;
    ctx.human = this.human;
    ctx.cat = this.cat;
    ctx.active = active;
    ctx.inactive = this.inactive();
    ctx.activeIsMoving = active.isMoving;
    ctx.roster = this.world.roster;
    ctx.gameMap = this.gameMap;
    ctx.bossRoom = this.bossRoom;
    ctx.extraTargets = targets.length > 0 ? targets : undefined;
    return ctx;
  }

  private updateGameplay(): void {
    const player = this.active();

    const move = readMovement(
      this.input,
      this.touch.moveTarget,
      this.touch.tapStart,
      player,
      this.camera(),
    );
    const catMoveBlocked = this.tutorial !== null && !this.tutorial.canCatMove && this.cat.isActive;
    const humanMoveBlocked =
      this.tutorial !== null && !this.tutorial.canHumanMove && this.human.isActive;
    if (!this.spiderQuest.playerLocked && !catMoveBlocked && !humanMoveBlocked) {
      // A dungeon wall is a wall seen from in front, the same as an interior's,
      // so a crawler walking south into one has to stop with their feet on the
      // last floor tile rather than planting their whole lower half on the
      // masonry — see `SOLE_COLLISION_OFFSET`. Only the outdoor town keeps the
      // old waist anchor: out there the "walls" are building facades and town
      // walls whose art and clearances are a separate question from this one.
      const southAnchor: SouthCollisionAnchor =
        this.levelDef.isOverworld === true ? 'waist' : 'sole';
      applyMovement(player, move, this.gameMap, southAnchor);
    }
    // Both crawlers, not just the active one — a thrown dumbbell can knock back
    // whichever player it hits, including the companion the input above never moved.
    applyKnockbackMotion(this.human, this.gameMap);
    applyKnockbackMotion(this.cat, this.gameMap);

    // Tutorial gate and ledge constraints — applied after movement
    this.tutorial?.applyGateConstraints(this.human, this.cat);

    // After every constraint that can still move a crawler this frame, so the
    // splash and the ripples are keyed off where they actually ended up. Run
    // before the tutorial gate and a gate shove would shed ripples on dry land.
    this.updateWaders();

    // Wading *replaces* the footstep loop rather than layering over it: boots on
    // turf underneath a river crossing is two surfaces at once, and the pair
    // muddies both. The river bed keeps playing under either.
    const isWading = player.isMoving && isStandingInWater(player, this.gameMap);
    if (isWading) {
      this.audio?.stopWalkingLoop();
      this.audio?.startWadingLoop();
    } else if (player.isMoving) {
      this.audio?.stopWadingLoop();
      this.audio?.startWalkingLoop();
    } else {
      this.audio?.stopWalkingLoop();
      this.audio?.stopWadingLoop();
    }

    this.pm.updateProtection(this.safeRoom);

    const nowInSafeRoom = this.pm.isAnySafe(this.safeRoom);
    if (!this.wasInSafeRoom && nowInSafeRoom) {
      this.bus.emit('safeRoomEntered', {});
      this.tutorial?.onSafeRoomEntered();
    }
    this.wasInSafeRoom = nowInSafeRoom;

    const ctx = this.buildSystemContext();

    this.safeRoom.update(ctx);
    // Straight after the context is built, so the move-cancel it watches for is
    // this frame's movement rather than the previous frame's.
    this.recall.update(ctx);
    this.stairwell.update(ctx);
    if (this.stairwell.wayfinderAnnouncePending) {
      this.stairwell.wayfinderAnnouncePending = false;
      this.menus.announce(DungeonScene.WAYFINDER_ANNOUNCEMENT);
    }
    this.bopca.update(ctx);
    this.combat.floatingText.update(ctx);
    this.systemNotices.update(ctx);
    this.bossRoom.update(ctx);
    this.spiderQuest.applyRoomLock(this.human, this.cat);
    this.arena.update(ctx);

    if (this.bossRoom.newlyLockedBossType !== null) {
      const bt = this.bossRoom.newlyLockedBossType;
      this.bossRoom.newlyLockedBossType = null;
      const meta = BOSS_META[bt] ?? {
        displayName: 'THE BOSS',
        color: '#ef4444',
      };
      this.bossIntro.trigger(bt, meta.displayName, meta.color);
      this.bus.emit('bossFightInitiated', { bossType: bt });
    }

    this.backfillDefeatedBossChests();

    this.barriers.update(ctx);
    this.defendQuest.update(ctx);
    if (this.defendQuest.hammerSoundPending) {
      this.defendQuest.hammerSoundPending = false;
      this.audio?.play('hammer_strike');
    }
    if (this.defendQuest.woodBreakSoundPending) {
      this.defendQuest.woodBreakSoundPending = false;
      const sounds = ['wood_breaking_1', 'wood_breaking_2', 'wood_breaking_3'] as const;
      this.audio?.play(sounds[this.woodBreakSoundIdx % sounds.length]);
      this.woodBreakSoundIdx++;
    }
    if ((this.trees?.drainFelled() ?? 0) > 0) {
      // Splitting timber is splitting timber, so a tree coming down reuses the
      // prop break cue rather than shipping an audio file for one event. One
      // cue however many trees fell together, for the reason above.
      const treeFallSounds = ['wood_breaking_1', 'wood_breaking_2', 'wood_breaking_3'] as const;
      this.audio?.play(treeFallSounds[this.woodBreakSoundIdx % treeFallSounds.length]);
      this.woodBreakSoundIdx++;
    }
    if (this.defendQuest.menuOpenSoundPending) {
      this.defendQuest.menuOpenSoundPending = false;
      this.audio?.play('menu_open');
    }
    this.circusQuest.update(ctx);
    this.murderQuest.update(ctx);
    this.anchorQuest.update();
    this.updateSpeedFizzDiscovery();
    this.doomsdayEscape.update(ctx);
    if (this.doomsdayEscape.floorEscapedPending) {
      this.doomsdayEscape.floorEscapedPending = false;
      this.audio?.play('quest_complete');
      this.humanAchievements.tryUnlock('city_evacuated');
      this.catAchievements.tryUnlock('city_evacuated');
    }
    this.overworldMusic?.update(ctx);
    this.ambientSound?.update(ctx);
    this.juicerRoom.update(ctx);
    this.arenaRoom.update(ctx);
    // Advance tutorial state machine; anchor companion when tutorial requires it
    if (this.tutorial !== null) {
      this.tutorial.update(this.human, this.cat);
      if (this.tutorial.consumeGateSound()) {
        this.audio?.play('gate_opening');
      }
      if (this.tutorial.needsSwitchToCat) {
        this.tutorial.needsSwitchToCat = false;
        this.triggerSwitchCharacter(true);
      } else if (this.tutorial.needsSwitchToHuman) {
        this.tutorial.needsSwitchToHuman = false;
        this.triggerSwitchCharacter(true);
      }
      if (this.tutorial.shouldAnchorCurrentCompanion) {
        this.companion.setDoNotMove(this.inactive(), this.human.isActive);
      }

      if (this.tutorial.needsCameraPanStart) {
        this.tutorial.needsCameraPanStart = false;
        const { w: mapPxW, h: mapPxH } = this.mapExtentsPx();
        const halfW = viewportWidth() / 2;
        const halfH = viewportHeight() / 2;
        const humanCamX = clamp(this.human.x + TILE_SIZE / 2 - halfW, 0, mapPxW - viewportWidth());
        const humanCamY = clamp(this.human.y + TILE_SIZE / 2 - halfH, 0, mapPxH - viewportHeight());
        const catCamX = clamp(this.cat.x + TILE_SIZE / 2 - halfW, 0, mapPxW - viewportWidth());
        const catCamY = clamp(this.cat.y + TILE_SIZE / 2 - halfH, 0, mapPxH - viewportHeight());
        this.tutorial.startCameraPan(humanCamX, humanCamY, catCamX, catCamY);
      }

      if (this.tutorial.needsAutoCloseMenus) {
        this.tutorial.needsAutoCloseMenus = false;
        this.menus.pauseMenu.close();
        this.menus.closePanels();
      }
    }
    this.companion.update(ctx);
    this.bossRoom.clampJoinedPlayers(this.human, this.cat);
    if (this.cat.pendingAutoFireSound) {
      this.cat.pendingAutoFireSound = false;
      this.audio?.play('cat_missile_fire', { volume: 0.5 });
    }

    this.combat.updatePlayerAttacks();

    this.bounty?.update(ctx);
    this.combat.updateMobs(ctx);
    for (const name of this.combat.spells.takeFogResistedNames()) {
      this.menus.announce(`${name} sees you through the fog`);
    }

    this.combat.drainMobAudioCues(this.audio);

    const activePlayer = this.active();
    const spiderWalkTriggerDist = TILE_SIZE * GROTESQUE_SPIDER_WALKING_TRIGGER_DISTANCE_TILES;
    const spiderWalkTriggerDistSq = spiderWalkTriggerDist * spiderWalkTriggerDist;
    let anySpiderWalkingNear = false;

    for (const spider of this.grotesqueSpiders) {
      if (spider.slamSoundPending) {
        spider.slamSoundPending = false;
        this.audio?.play('grotesque_spider_slam_attack', { startOffset: SLAM_AUDIO_OFFSET });
      }
      if (spider.screechSoundPending) {
        spider.screechSoundPending = false;
        this.audio?.play('grotesque_spider_screech_attack', {
          startOffset: SCREECH_AUDIO_OFFSET,
        });
      }
      if (spider.spitFireSoundPending) {
        spider.spitFireSoundPending = false;
        this.audio?.play('grotesque_spider_spit_attack');
      }
      if (spider.spitLandSoundPending) {
        spider.spitLandSoundPending = false;
        this.audio?.play('grotesque_spider_spit_landing');
      }
      if (spider.isAlive && spider.isMoving && !anySpiderWalkingNear) {
        const dx = spider.x - activePlayer.x;
        const dy = spider.y - activePlayer.y;
        anySpiderWalkingNear = dx * dx + dy * dy < spiderWalkTriggerDistSq;
      }
    }
    if (anySpiderWalkingNear) {
      this.audio?.startSpiderWalkingLoop();
    } else {
      this.audio?.stopSpiderWalkingLoop();
    }

    const outcome = this.combat.resolvePlayerAttacks({
      destructibles: this.destruction.destructibles,
      trees: this.trees ?? undefined,
    });

    if (outcome.hitLanded) {
      if (this.combatCooldownFrames <= 0) {
        const hitMob = this.world.roster.mobs.find((m) => m.isAlive && m.damageTakenBy.size > 0);
        this.bus.emit('combatStarted', {
          attacker: this.human.isActive ? 'Human' : 'Cat',
          mobType: hitMob?.constructor.name ?? 'Unknown',
        });
      }
      this.combatCooldownFrames = COMBAT_COOLDOWN_FRAMES;
    } else if (this.combatCooldownFrames > 0) {
      this.combatCooldownFrames--;
    }

    if (player.isMoving || outcome.hitLanded) {
      this.playerIdleFrames = 0;
    } else {
      this.playerIdleFrames++;
      if (this.playerIdleFrames % PLAYER_IDLE_REPORT_INTERVAL_FRAMES === 0) {
        this.bus.emit('playerIdle', {
          totalIdleMs: Math.round((this.playerIdleFrames / FRAMES_PER_SECOND) * MS_PER_SECOND),
        });
      }
    }

    for (const [player, name] of [
      [this.human, 'Human'],
      [this.cat, 'Cat'],
    ] as const) {
      const isLow = player.hp / player.maxHp < LOW_HEALTH_THRESHOLD;
      if (name === 'Human') {
        if (isLow && !this.humanHealthLow) {
          this.bus.emit('healthLow', { player: 'Human', hp: player.hp, maxHp: player.maxHp });
        }
        this.humanHealthLow = isLow;
      } else {
        if (isLow && !this.catHealthLow) {
          this.bus.emit('healthLow', { player: 'Cat', hp: player.hp, maxHp: player.maxHp });
        }
        this.catHealthLow = isLow;
      }
    }

    this.mongoSystem.checkHealth();
    this.mercenarySystem.checkHealth(this.world.roster.mobs, this.world.roster.grid);
    this.combat.resolveKills();

    this.combat.resolveSpellAftermath();

    this.mongoSystem.update(ctx);
    this.mercenarySystem.update(ctx);
    this.pm.tickTimers();

    if (this.human.effectDamageSoundPending) {
      this.human.effectDamageSoundPending = false;
      this.audio?.playRandom(['human_effect_damage_1', 'human_effect_damage_2']);
    }
    if (this.cat.effectDamageSoundPending) {
      this.cat.effectDamageSoundPending = false;
      this.audio?.playRandom(['cat_effect_damage_1', 'cat_effect_damage_2', 'cat_effect_damage_3']);
    }

    if (this.tutorial?.suppressCatRegen === true) {
      this.combat.playerTick.tickRegenHumanOnly(this.human);
      this.combat.playerTick.tickAutoPotion(this.human, this.cat);
    } else {
      this.combat.playerTick.update(ctx);
    }
    this.difficultyTelemetry.update(ctx);
    this.treasureChests.update(this.world.roster.mobs);
    this.speechBubblePulse++;
    this.combat.updatePostCombat(this.audio);
    this.lavaBalls.update(ctx);
    this.rockThrows.update(ctx);
    // Summons first, so a skeleton raised this frame is already in `ctx.roster.mobs`
    // when the projectile system walks it. Neither ordering can strand a shot —
    // the drain reads the whole list every frame — but this one keeps a wave and
    // the bolts covering it on the same tick.
    this.skeletonSummons.update(ctx);
    this.skeletonShots.update(ctx);
    this.goblinArrows.update(ctx);
    this.clownGas.update(ctx);
    this.knightMissiles.update(ctx);
    this.trees?.update(ctx);
    this.destruction.update(ctx);
    this.destruction.drainAudioCues(this.audio);

    // The llama's own impact cue. It is drained here rather than from
    // `playMobAudioCues` because the ball outlives its llama, and a shot that
    // lands after the animal died has no mob left to carry the flag.
    if (this.lavaBalls.burstSoundPending) {
      this.lavaBalls.burstSoundPending = false;
      this.audio?.play('llama_fireball_explosion');
    }

    // The golem's boulder shatter, drained here for the same reason: the rock
    // outlives the golem that threw it.
    if (this.rockThrows.burstSoundPending) {
      this.rockThrows.burstSoundPending = false;
      this.audio?.playRandom(['rock_thud_1', 'rock_thud_2', 'rock_thud_3', 'rock_thud_4']);
    }

    // Drained here rather than from `playMobAudioCues` for the same reason the
    // llama's is: a soul bolt outlives its caster, and one that lands after the
    // lord died has no mob left to carry the flag.
    if (this.skeletonShots.burstSoundPending) {
      this.skeletonShots.burstSoundPending = false;
      this.audio?.play('magic_ball_impact');
    }

    // A bone shaft does not go off, so it is drained separately from the bolt
    // burst above — the same frame can end one of each.
    if (this.skeletonShots.arrowImpactSoundPending) {
      this.skeletonShots.arrowImpactSoundPending = false;
      this.audio?.play('arrow_impact');
    }

    if (this.goblinArrows.impactSoundPending) {
      this.goblinArrows.impactSoundPending = false;
      this.audio?.play('arrow_impact');
    }

    // Likewise the rise: the mob that made it happen is the lord, but the sound
    // belongs to the skeletons coming out of the ground.
    if (this.skeletonSummons.riseSoundPending) {
      this.skeletonSummons.riseSoundPending = false;
      this.audio?.play('bones_rattling');
    }
    if (this.clownGas.shatterSoundPending) {
      this.clownGas.shatterSoundPending = false;
      // Two cues on one beat by design: the bottle breaking, and the cloud it
      // lets out. They are simultaneous in the fiction and in `ClownGasSystem`,
      // which spawns the shatter and the cloud on the same frame.
      this.audio?.playRandom(['glass_break_1', 'glass_break_2', 'glass_break_3', 'glass_break_4']);
      this.audio?.play('gas_cloud');
    }
    if (this.knightMissiles.impactSoundPending) {
      this.knightMissiles.impactSoundPending = false;
      this.audio?.playRandom([
        'small_magic_impact_1',
        'small_magic_impact_2',
        'small_magic_impact_3',
      ]);
    }

    if (this.levelDef.hasCollapseTimer === true && this.levelTimerFrames > 0) {
      this.levelTimerFrames--;
    }

    revealMinimap(player, this.miniMap);

    const wasStairwellOpen = this.stairwell.menuOpen;
    this.stairwell.detect(this.active());
    if (!wasStairwellOpen && this.stairwell.menuOpen) {
      this.bus.emit('stairwellFound', {});
    }
    if (this.stairwell.menuOpen && this.tutorial !== null && !this.tutorial.canUseStairwell) {
      this.stairwell.closeMenu();
    }
    this.building?.detect(this.active());

    updateKnockoutState({
      active: this.active(),
      inactive: this.inactive(),
      inactiveIsHuman: this.inactive() === this.human,
      audio: this.audio,
    });

    if (
      !this.gameOver &&
      checkDeath(
        this.human,
        this.cat,
        this.levelDef.hasCollapseTimer === true,
        this.levelTimerFrames,
      )
    ) {
      this.gameOver = true;
      // A death arrives from the fight, not from a key or a click, so nothing
      // else here has taken the keyboard off a bag left open behind it.
      this.menus.cancelInventoryDragForOverlay();
      difficultyStats.recordDeath();
      this.barriers.cancelConstruct();
      const deathCause = resolveDeathCause(
        this.human,
        this.cat,
        this.levelDef.hasCollapseTimer === true,
        this.levelTimerFrames,
      );
      this.combat.deathScreen.activate(
        pickDeathExplanation(deathCause),
        this.checkpoint !== null ? 'checkpoint' : 'floorRestart',
      );
    }
  }

  private _processSpiderQuestSounds(): void {
    if (this.spiderQuest.machineryStartPending) {
      this.spiderQuest.machineryStartPending = false;
      this.audio?.startMachineryLoop();
    }
    if (this.spiderQuest.machineryStopPending) {
      this.spiderQuest.machineryStopPending = false;
      this.audio?.stopMachineryLoop();
    }
    if (this.spiderQuest.poweringOffSoundPending) {
      this.spiderQuest.poweringOffSoundPending = false;
      this.audio?.play('powering_off');
    }
    if (this.spiderQuest.rumbleSoundPending) {
      this.spiderQuest.rumbleSoundPending = false;
      this.audio?.play('rumble');
    }
    if (this.spiderQuest.exclamationSoundPending) {
      this.spiderQuest.exclamationSoundPending = false;
      this.audio?.play('scientist_exclaiming_about_an_escape');
    }
    if (this.spiderQuest.lifeMachinePoweringOnPending) {
      this.spiderQuest.lifeMachinePoweringOnPending = false;
      this.audio?.play('life_machine_powering_on');
    }
    if (this.spiderQuest.menuClickSoundPending) {
      this.spiderQuest.menuClickSoundPending = false;
      this.audio?.play('menu_click');
    }
    if (this.spiderQuest.menuOpenSoundPending) {
      this.spiderQuest.menuOpenSoundPending = false;
      this.audio?.play('menu_open');
    }
    if (this.spiderQuest.explanationSoundPending) {
      this.spiderQuest.explanationSoundPending = false;
      // Boosted volume: this audio was recorded significantly quieter than other SFX
      this.audio?.play('scientist_explaining_request', { volume: 3.5 });
    }
    if (this.spiderQuest.keyboardHeroMusicStartPending) {
      this.spiderQuest.keyboardHeroMusicStartPending = false;
      this.audio?.startKeyboardHeroMusic();
    }
    if (this.spiderQuest.keyboardHeroMusicStopPending) {
      this.spiderQuest.keyboardHeroMusicStopPending = false;
      this.audio?.stopKeyboardHeroMusic();
    }
    if (this.spiderQuest.hackFailErrorSoundPending) {
      this.spiderQuest.hackFailErrorSoundPending = false;
      this.audio?.play('error');
    }
    if (this.spiderQuest.cutsceneSpitImpactSoundPending) {
      this.spiderQuest.cutsceneSpitImpactSoundPending = false;
      this.audio?.play('grotesque_spider_spit_landing');
    }
    if (this.spiderQuest.cutsceneGoreSoundPending) {
      this.spiderQuest.cutsceneGoreSoundPending = false;
      this.audio?.play('flesh_being_sliced');
    }
    if (this.spiderQuest.bossFightStartPending) {
      this.spiderQuest.bossFightStartPending = false;
      this.bossIntro.trigger('grotesque_spider', 'GROTESQUE SPIDER', '#22c55e');
    }
    if (this.spiderQuest.bossMusicStartPending) {
      this.spiderQuest.bossMusicStartPending = false;
      this.bus.emit('bossFightInitiated', { bossType: 'grotesque_spider' });
    }
    if (this.spiderQuest.bossMusicStopPending) {
      this.spiderQuest.bossMusicStopPending = false;
      this.audio?.playMusic(this.levelDef.music, { fadeInMs: MUSIC_FADE_IN_MS });
    }
  }

  /**
   * Spill a loot drop onto the floor, routing items that belong to one specific
   * crawler to that crawler and everything else to `defaultRecipient`.
   */
  private dropLootByOwner(
    cx: number,
    cy: number,
    loot: LootDrop,
    defaultRecipient: HumanPlayer | CatPlayer,
    isBossLoot: boolean,
  ): void {
    const sharedItems = loot.items.filter((it) => forcedRecipientFor(it.id) === null);
    const humanItems = loot.items.filter((it) => forcedRecipientFor(it.id) === 'human');
    const catItems = loot.items.filter((it) => forcedRecipientFor(it.id) === 'cat');
    if (sharedItems.length > 0 || loot.coins > 0) {
      this.destruction.loot.addLoot(
        cx,
        cy,
        { coins: loot.coins, items: sharedItems },
        defaultRecipient,
        isBossLoot,
      );
    }
    if (humanItems.length > 0) {
      this.destruction.loot.addLoot(
        cx,
        cy,
        { coins: 0, items: humanItems },
        this.human,
        isBossLoot,
      );
    }
    if (catItems.length > 0) {
      this.destruction.loot.addLoot(cx, cy, { coins: 0, items: catItems }, this.cat, isBossLoot);
    }
  }

  private createAISceneContext(): AISceneContext {
    return {
      getHuman: () => this.human,
      getCat: () => this.cat,
      getMobs: () => this.world.roster.mobs,
      getGameMap: () => this.gameMap,
      getLevelId: () => this.levelDef.id,
      spawnMob: (mob) => this.world.roster.add(mob),
      isBossFightActive: () => this.bossRoom.anyLocked,
      isPaused: () =>
        this.gameOver ||
        this.menus.pauseMenu.isOpen ||
        this.stairwell.menuOpen ||
        (this.building?.menuOpen ?? false) ||
        this.defendQuest.isDialogOpen ||
        this.circusQuest.isDialogOpen ||
        this.murderQuest.isDialogOpen ||
        this.anchorQuest.isDialogOpen ||
        this.citizenDialog?.isOpen === true ||
        this.chat.isOpen,
    };
  }

  /**
   * Pixel extents of the current map: the row count gives the height, a row's
   * length the width. Every camera clamp needs both — deriving one axis from the
   * other silently works only for as long as maps stay square.
   */
  private mapExtentsPx(): { w: number; h: number } {
    const rows = this.gameMap.structure;
    return {
      w: (rows[0]?.length ?? rows.length) * TILE_SIZE,
      h: rows.length * TILE_SIZE,
    };
  }

  private camera(): { x: number; y: number } {
    const tutorialCam = this.tutorial?.cameraOverride;
    if (tutorialCam !== null && tutorialCam !== undefined) return tutorialCam;

    const player = this.active();
    const { w: mapPxW, h: mapPxH } = this.mapExtentsPx();

    const targetOverride = this.spiderQuest.cameraTargetOverride;
    const targetX = targetOverride !== null ? targetOverride.x : player.x;
    const targetY = targetOverride !== null ? targetOverride.y : player.y;

    const camX = targetX + TILE_SIZE / 2 - viewportWidth() / 2;
    const camY = targetY + TILE_SIZE / 2 - viewportHeight() / 2;

    const shakeOffset = this.spiderQuest.cameraOffset;
    const smushShake = this.combat.smushFx.cameraOffset;
    const juicerShake = this.juicerRoom.cameraOffset;
    // Applied after the clamp so the sway can drift past the map edge rather than
    // being flattened to nothing whenever the camera is already against a border.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return {
      x:
        clamp(camX, 0, mapPxW - viewportWidth()) +
        shakeOffset.x +
        sway.x +
        smushShake.x +
        juicerShake.x,
      y:
        clamp(camY, 0, mapPxH - viewportHeight()) +
        shakeOffset.y +
        sway.y +
        smushShake.y +
        juicerShake.y,
    };
  }

  handleTouchStart(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // A full-screen town modal (notice board, market stall, fortune teller) or
      // a pausing award overlay owns every tap while it's open — route to it
      // before any HUD button, so a tap landing on a now-hidden control (e.g.
      // Switch, which would change whose wallet a shop charges) can't leak
      // through underneath the overlay, and so an overlay button sitting over the
      // hotbar band is pressed rather than starting a drag on the slot beneath.
      if (
        this.noticeBoard?.isOpen === true ||
        this.marketPanel?.isOpen === true ||
        this.fortuneTeller?.isOpen === true ||
        this.menus.skillBookPrompt.isOpen ||
        this.menus.levelUpDialog.isShowing ||
        this.menus.rewardGrantedDialog.isShowing
      ) {
        this.handleClick(x, y, e.timeStamp);
        continue;
      }

      if (platform.isMobile) {
        const ht = this._hudToggleRect;
        if (pointInRect(x, y, ht)) {
          this._hudCollapsed = !this._hudCollapsed;
          continue;
        }
      }

      if (
        platform.isMobile &&
        !this.gameOver &&
        !this.menus.pauseMenu.isOpen &&
        this.menus.tryOpenSpendScreen(x, y, this._hudSkillBannerRect)
      ) {
        continue;
      }

      if (platform.isMobile && !this.gameOver && !this.menus.pauseMenu.isOpen) {
        const mm = this.touch.miniMapRect;
        if (pointInRect(x, y, mm)) {
          if (!this.miniMap.isExpanded) {
            this.miniMap.toggle();
          } else {
            // Track touch for drag-to-pan or tap-to-collapse
            this.touch.miniMapTouchId = touch.identifier;
            this.touch.miniMapTouchStartX = x;
            this.touch.miniMapTouchStartY = y;
            this.touch.miniMapTouchLastX = x;
            this.touch.miniMapTouchLastY = y;
            this.touch.miniMapDragged = false;
          }
          continue;
        }
      }

      if (platform.isMobile && !this.gameOver && !this.menus.pauseMenu.isOpen) {
        const bb = this.touch.bagBtnRect;
        if (pointInRect(x, y, bb)) {
          this.menus.inventoryPanel.toggle();
          if (this.menus.inventoryPanel.isOpen) {
            this.menus.gearPanel.isOpen = false;
          }
          continue;
        }
      }

      // The Journal's compass, before the fall-through that turns an unclaimed
      // tap into a move order: without this a tap on it also walks the party
      // toward the button and swings on release.
      if (
        platform.isMobile &&
        !this.gameOver &&
        !this.menus.pauseMenu.isOpen &&
        this.journalButtonRect !== null &&
        pointInRect(x, y, this.journalButtonRect)
      ) {
        notifyButtonClick(x, y);
        this.openQuestJournal();
        continue;
      }

      if (platform.isMobile && this.mongoSystem.canShow && this.cat.isActive) {
        const mb = this.touch.summonBtnRect;
        if (pointInRect(x, y, mb)) {
          if (!this.menus.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.toggleMongoSummon();
          continue;
        }
      }

      if (platform.isMobile && this.followerMenu.isOpen) {
        this.followerMenu.restrictedToButtonIndex = this.tutorial?.followerMenuRestriction ?? null;
        this.followerMenu.handleClick(x, y);
        continue;
      }

      if (platform.isMobile) {
        const sb = this.touch.switchBtnRect;
        if (pointInRect(x, y, sb)) {
          if (!this.menus.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerSwitchCharacter();
          continue;
        }
        const fb = this.touch.followBtnRect;
        if (pointInRect(x, y, fb)) {
          if (!this.menus.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver)
            this.triggerCompanionFollow();
          continue;
        }
      }

      if (!this.menus.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
        const hi = this.menus.inventoryPanel.getHotbarTappedIndex(x, y);
        if (hi >= 0) {
          this.touch.inventoryDragTouchId = touch.identifier;
          this.handleMouseDown(x, y);
          this.clearInvLongPress();
          this.touch.longPressPos = { x, y };
          this.touch.longPressFired = false;
          this.touch.longPressTimer = setTimeout(() => {
            this.touch.longPressFired = true;
            this.menus.inventoryPanel.cancelDrag();
            this.handleContextMenu(x, y);
          }, LONGPRESS_TIMEOUT_MS);
          continue;
        }
      }

      if (
        this.achievementUI.isBlocking ||
        this.stairwell.menuOpen ||
        this.gameOver ||
        this.menus.pauseMenu.isOpen ||
        this.safeRoom.mordecaiDialogOpen ||
        this.bopca.isDialogOpen ||
        this.spiderQuest.isDialogOpen ||
        this.circusQuest.isDialogOpen ||
        this.murderQuest.isDialogOpen ||
        this.anchorQuest.isDialogOpen ||
        this.citizenDialog?.isOpen === true ||
        // Town modals (notice board / market stall / fortune teller) are handled
        // by the early full-screen-modal gate at the top of this loop.
        this.tutorial?.showTutorialMordecaiDialog === true ||
        this.tutorial?.showMordecaiReminderDialog === true
      ) {
        if (this.menus.pauseMenu.isOpen) {
          if (this.touch.pauseScrollTouchId === null) {
            this.touch.pauseScrollTouchId = touch.identifier;
            this.touch.pauseScrollTapStart = { x, y, time: Date.now() };
            this.menus.pauseMenu.touchScrollStart(x, y, this.human, this.cat);
          }
        } else {
          this.handleClick(x, y, e.timeStamp);
        }
        continue;
      }

      if (this.human.isActive) {
        const dynIdx = this.menus.inventoryPanel.getHotbarTappedIndex(x, y);
        if (dynIdx >= 0 && this.human.inventory.actionBar.slots[dynIdx]?.id === 'goblin_dynamite') {
          this.destruction.dynamite.beginCharge(dynIdx);
          this.touch.dynamiteTouchId = touch.identifier;
          continue;
        }
      }

      if (this.menus.inventoryPanel.isOpen) {
        if (this.menus.inventoryPanel.hitsPanel(x, y)) {
          this.handleMouseDown(x, y);
          this.touch.inventoryDragTouchId ??= touch.identifier;
          this.clearInvLongPress();
          this.touch.longPressPos = { x, y };
          this.touch.longPressFired = false;
          this.touch.longPressTimer = setTimeout(() => {
            this.touch.longPressFired = true;
            this.menus.inventoryPanel.cancelDrag();
            this.handleContextMenu(x, y);
          }, LONGPRESS_TIMEOUT_MS);
          continue;
        }
      }

      if (this.touch.moveTouchId === null) {
        this.touch.moveTouchId = touch.identifier;
        this.touch.moveTarget = { x, y };
        this.touch.tapStart = { x, y, time: Date.now() };
        this.menus.pauseMenu.touchScrollStart(x, y, this.human, this.cat);
      }
    }
  }

  handleTouchMove(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (this.touch.longPressPos) {
        const dist = Math.hypot(x - this.touch.longPressPos.x, y - this.touch.longPressPos.y);
        if (dist > TOUCH_DRAG_THRESHOLD) this.clearInvLongPress();
      }

      this.handleMouseMove(x, y);

      if (touch.identifier === this.touch.miniMapTouchId) {
        const dx = x - this.touch.miniMapTouchLastX;
        const dy = y - this.touch.miniMapTouchLastY;
        const totalDist = Math.hypot(
          x - this.touch.miniMapTouchStartX,
          y - this.touch.miniMapTouchStartY,
        );
        if (totalDist > MINIMAP_DRAG_THRESHOLD) this.touch.miniMapDragged = true;
        if (this.touch.miniMapDragged) this.miniMap.pan(dx, dy);
        this.touch.miniMapTouchLastX = x;
        this.touch.miniMapTouchLastY = y;
      }

      if (touch.identifier === this.touch.moveTouchId) {
        this.touch.moveTarget = { x, y };
        this.menus.pauseMenu.touchScrollMove(x, y);
      }

      if (touch.identifier === this.touch.pauseScrollTouchId) {
        this.menus.pauseMenu.touchScrollMove(x, y);
      }
    }
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (touch.identifier === this.touch.miniMapTouchId) {
        if (!this.touch.miniMapDragged) this.miniMap.toggle();
        this.touch.miniMapTouchId = null;
        this.touch.miniMapDragged = false;
        continue;
      }

      if (touch.identifier === this.touch.pauseScrollTouchId) {
        this.menus.pauseMenu.touchScrollEnd(x, y, this.human, this.cat);
        this.touch.pauseScrollTouchId = null;
        const tapStart = this.touch.pauseScrollTapStart;
        this.touch.pauseScrollTapStart = null;
        if (tapStart !== null) {
          const elapsed = Date.now() - tapStart.time;
          const moved = Math.hypot(x - tapStart.x, y - tapStart.y);
          const wasTap = elapsed < MENU_TAP_DURATION_MS && moved < MENU_TAP_MAX_DISTANCE;
          if (wasTap) {
            this.handleClick(x, y, e.timeStamp);
          } else {
            // A drag ends here and nowhere else: no click follows it, so the
            // menu's held-back click would sit waiting and eat the next tap.
            this.menus.pauseMenu.clearSuppressedClick();
          }
        }
        continue;
      }

      if (touch.identifier === this.touch.dynamiteTouchId) {
        const wasCharging = this.destruction.dynamite.isCharging;
        this.destruction.dynamite.release(
          this.human,
          this.cat,
          this.world.roster.mobs,
          this.world.roster.grid,
        );
        if (wasCharging) this.bus.emit('dynamiteUsed', { player: 'Human' });
        this.touch.dynamiteTouchId = null;
        continue;
      }

      if (touch.identifier === this.touch.inventoryDragTouchId) {
        const longPressFired = this.touch.longPressFired;
        // longPressPos is cleared by move handler when finger travels > 10px — use it to
        // distinguish a tap (pos still set) from a drag (pos already null).
        const wasTap = this.touch.longPressPos !== null;
        this.clearInvLongPress();
        if (!longPressFired) {
          this.handleMouseUp(x, y);
          const hi = this.menus.inventoryPanel.getHotbarTappedIndex(x, y);
          if (
            hi >= 0 &&
            wasTap &&
            // A menu open over the bar owns the tap: it is drawn on top of the
            // slots, so activating the slot beneath would swallow the selection.
            this.menus.inventoryPanel.interaction.contextMenu === null &&
            // Likewise a pausing overlay, which a second finger can raise while
            // this one is still down.
            !this.isOverlayBlockingPointer &&
            !this.menus.pauseMenu.isOpen &&
            !this.safeRoom.isSleeping &&
            !this.gameOver
          ) {
            activateHotbarSlot(this.hotbarHost(), hi);
          } else if (wasTap) {
            this.handleClick(x, y, e.timeStamp);
          }
        }
        this.touch.inventoryDragTouchId = null;
        continue;
      }

      if (touch.identifier === this.touch.moveTouchId) {
        if (this.touch.tapStart) {
          const elapsed = Date.now() - this.touch.tapStart.time;
          const moved = Math.hypot(x - this.touch.tapStart.x, y - this.touch.tapStart.y);
          if (elapsed < MENU_TAP_DURATION_MS && moved < MENU_TAP_MAX_DISTANCE) {
            if (
              this.destruction.dynamite.isCharging &&
              this.human.isActive &&
              !this.menus.pauseMenu.isOpen &&
              !this.safeRoom.isSleeping &&
              !this.gameOver
            ) {
              const cam = this.camera();
              const ddx = x + cam.x - (this.human.x + TILE_SIZE / 2);
              const ddy = y + cam.y - (this.human.y + TILE_SIZE / 2);
              const dist = Math.hypot(ddx, ddy);
              if (dist > 0) {
                this.human.facingX = ddx / dist;
                this.human.facingY = ddy / dist;
              }
              this.destruction.dynamite.release(
                this.human,
                this.cat,
                this.world.roster.mobs,
                this.world.roster.grid,
              );
              this.bus.emit('dynamiteUsed', { player: 'Human' });
            } else {
              this.handleClick(x, y, e.timeStamp);
              if (!this.menus.pauseMenu.isOpen && !this.safeRoom.isSleeping && !this.gameOver) {
                const cam = this.camera();
                const grateHandled = this.defendQuest.tryMobileTapOnGrate(
                  x,
                  y,
                  cam.x,
                  cam.y,
                  this.active(),
                );
                if (!grateHandled) {
                  this.triggerSpaceAction(x, y);
                }
              }
            }
          }
        }
        this.menus.pauseMenu.touchScrollEnd(x, y, this.human, this.cat);
        this.touch.moveTouchId = null;
        this.touch.moveTarget = null;
        this.touch.tapStart = null;
      }
    }
  }

  private _makeAbilityReward(abilityId: AbilityId): GrantedReward {
    const def = this.abilityManager.getDef(abilityId);
    const name = def?.name ?? abilityId;
    const description =
      def?.perks.find((p) => p.level === 1)?.description ?? 'A new ability has been granted!';
    const renderIcon =
      def !== null
        ? (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) =>
            def.renderIcon(ctx, x, y, size, 1)
        : (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
            ctx.fillStyle = '#a855f7';
            ctx.fillRect(x, y, size, size);
          };
    return { kind: 'ability', name, description, renderIcon };
  }

  private _grantChestLootSplit(split: { humanLoot: LootDrop; catLoot: LootDrop } | null): void {
    if (split === null) return;
    for (const item of split.humanLoot.items) {
      this.human.inventory.addItem(item.id, item.quantity);
    }
    this.human.coins += split.humanLoot.coins;
    for (const item of split.catLoot.items) {
      this.cat.inventory.addItem(item.id, item.quantity);
    }
    this.cat.coins += split.catLoot.coins;
  }

  private _makeMongoReward(): GrantedReward {
    return {
      kind: 'ability',
      name: 'Mongo',
      description:
        'A loyal velociraptor companion. Summon Mongo to fight alongside the Cat in battle!',
      renderIcon: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        const stage = getMongoStats(this.abilityManager.getLevel('mongo')).stage;
        drawMongoIcon(ctx, stage, x + size / 2, y + size / 2, size);
      },
    };
  }

  /**
   * Feed everything that can wade to the water system, so it splashes on entry
   * and sheds ripples while it is in there, and drive the river's ambient bed.
   *
   * Both crawlers plus every live mob: mobs cross rivers now, and one that waded
   * without disturbing the surface would look like it was walking on the water.
   * Reported whether wet or dry — the dry frames are how the system spots the
   * bank-to-water edge, which is the only moment a splash can be detected.
   */
  private updateWaders(): void {
    const water = this.water;
    if (water === null) return;
    water.beginFrame();
    const centre = TILE_SIZE * WADER_CENTRE_FRACTION;

    const humanEntered = water.updateWader(
      this.human,
      this.human.x + centre,
      this.human.y + centre,
      isStandingInWater(this.human, this.gameMap),
    );
    if (humanEntered) this.audio?.play('human_splash', { volume: SPLASH_VOLUME });

    const catEntered = water.updateWader(
      this.cat,
      this.cat.x + centre,
      this.cat.y + centre,
      isStandingInWater(this.cat, this.gameMap),
    );
    if (catEntered) this.audio?.play('cat_splash', { volume: SPLASH_VOLUME });

    const listener = this.pm.active();
    let mobSplashed = false;
    for (const mob of this.world.roster.mobs) {
      if (!mob.isAlive) continue;
      const entered = water.updateWader(mob, mob.x + centre, mob.y + centre, mob.isWading());
      // At most one voice a frame however many wade in together: a camp's worth
      // of goblins hitting the water on the same step stacks into a bang rather
      // than reading as several splashes.
      if (!entered || mobSplashed) continue;
      const distanceTiles = Math.hypot(mob.x - listener.x, mob.y - listener.y) / TILE_SIZE;
      if (distanceTiles > MOB_SPLASH_AUDIBLE_RADIUS_TILES) continue;
      // Faded with distance rather than played flat: a goblin wading in across
      // the map at the same volume as your own step reads as being right beside
      // you, which is worse than not hearing it.
      const falloff = 1 - distanceTiles / MOB_SPLASH_AUDIBLE_RADIUS_TILES;
      this.audio?.play('mob_splash', { volume: SPLASH_VOLUME * falloff });
      mobSplashed = true;
    }

    this.updateRiverAmbience(listener);
  }

  /**
   * Point the river's ambient emitter at the nearest visible water tile.
   *
   * A river is a long line, not a point, so a fixed emitter would be loud at one
   * bend and silent at the next. Moving one emitter to the nearest visible tile
   * gives the whole length a single voice that always comes from the part of it
   * the player can actually see. Setting `radiusTiles` to zero is how the
   * emitter is silenced — `AmbientSoundSystem.gainFor` reads that as no reach,
   * and its own hysteresis then fades and tears the loop down.
   */
  private updateRiverAmbience(listener: Player): void {
    const emitter = this.riverAmbientEmitter;
    if (emitter === null) return;
    const nearest = this.water?.nearestVisibleWaterTile(
      listener.x + TILE_SIZE * WADER_CENTRE_FRACTION,
      listener.y + TILE_SIZE * WADER_CENTRE_FRACTION,
    );
    if (nearest === undefined || nearest === null) {
      // `constant` is cleared here as well as set below. It overrides distance
      // entirely, so a frame that silenced the emitter by radius alone while the
      // flag was still set from wading would play the river at full volume with
      // no river anywhere near.
      emitter.constant = false;
      emitter.radiusTiles = 0;
      return;
    }
    if (isStandingInWater(listener, this.gameMap)) {
      emitter.x = listener.x / TILE_SIZE;
      emitter.y = listener.y / TILE_SIZE;
      emitter.radiusTiles = RIVER_AMBIENT_IN_WATER_RADIUS_TILES;
      emitter.constant = true;
      return;
    }
    emitter.x = nearest.x;
    emitter.y = nearest.y;
    emitter.radiusTiles = RIVER_AMBIENT_RADIUS_TILES;
    emitter.constant = false;
  }
}
