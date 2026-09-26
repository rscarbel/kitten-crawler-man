import { displayHp } from '../core/crawlerFormulas';
import { awardXp } from '../core/awardXp';
import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { platform } from '../core/Platform';
import { TILE_SIZE } from '../core/constants';
import { clamp, frameTime } from '../utils';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { GameMap } from '../map/GameMap';
import { DEFAULT_DUNGEON_FLOOR_THEME, setDungeonFloorTheme } from '../map/dungeon/floorTheme';
import type { GameProgressInput } from '../auth/AuthClient';
import { parseSavedWorld, WORLD_GENERATOR_VERSION } from '../core/SavedWorld';
import { setFloorArtSeed } from '../map/ground/floorArtSeed';
import { groundSheetKeysAmong, requestGroundSheets } from '../map/ground/runtimeGroundSheets';
import { releaseEnvironmentArt } from '../map/environmentArtCache';
import { requestEnvironmentSheetsForGroups } from '../sprites/sheets/environmentSheets';
import { type HumanPlayer } from '../creatures/HumanPlayer';
import { type CatPlayer } from '../creatures/CatPlayer';
import { despawnMob, type Mob, type LootDrop } from '../creatures/Mob';
import type { Player } from '../Player';
import { PlayerManager } from '../core/PlayerManager';
import { MobileTouchState } from '../core/MobileTouchState';
import type { LevelDef, MobLevelRange, MobSpawnRule } from '../levels/types';
import {
  spawnForLevel,
  spawnExtraMobs,
  createMob,
  spawnTreasureRoomMobs,
  partyLevelOf,
  pickRule,
  recommendedPartyLevelFor,
  resolveAmbientLevel,
} from '../levels/spawner';
import { activeDifficultyProfile, applySpawnDifficulty } from '../core/difficultyProfiles';
import { getSpriteMissCounts, prewarmGroups, releaseSpritesExcept } from '../core/SpriteLoader';
import { flushFigureFrameCache } from '../sprites/figure/figureFrameCache';
import { requiredSpriteKeysForLevel } from '../core/systemAssetRequirements';
import { getLevelDef } from '../levels';
import { dungeonOptionsForLevel } from '../levels/dungeonOptions';
import { TUTORIAL_LEVEL_ID } from '../levels/tutorial';
import { LevelCompleteScreen } from '../ui/LevelCompleteScreen';
import {
  RUN_COMPLETE_FOCUS_ID,
  RunCompleteScreen,
  buildRunSummary,
  countPartyAchievements,
  finishRun,
} from '../ui/RunCompleteScreen';
import { PostSignupScene } from './PostSignupScene';
import { MENU_TAP_DURATION_MS, MENU_TAP_MAX_DISTANCE, type PauseMenu } from '../ui/PauseMenu';
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
import { drawArrowAbovePlayer } from '../ui/WorldArrow';
import { drawObjectiveBeacon } from '../ui/ObjectiveBeacon';
import {
  availableTargets,
  collectTrackerEntries,
  isOutstanding,
  pinMatchesEntry,
  resolvePinnedEntry,
  type TrackerEntry,
  type TrackerTarget,
} from '../systems/questTracker';
import { SafeRoomSystem, type SafeRoomInfo } from '../systems/SafeRoomSystem';
import { SkillPointReminderSystem } from '../systems/SkillPointReminderSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { TacticsNoticeSystem } from '../systems/TacticsNoticeSystem';
import type { TacticsTrait } from '../creatures/tactics/tacticsTraits';
import { isEngagedInFight } from '../creatures/tactics/tacticalFrame';
import { resolveSkillBookPrompt } from '../systems/skillBookUse';
import { getSkillDef, type CrawlerKind } from '../core/SkillManager';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { BossRoomSystem, BOSS_META } from '../systems/BossRoomSystem';
import { drawHUD, renderMobileSkillBadge, hudCoinCounterScreenPos } from '../ui/HUD';
import { LavaBallSystem } from '../systems/LavaBallSystem';
import { RockThrowSystem } from '../systems/RockThrowSystem';
import { HirelingBoltSystem } from '../systems/HirelingBoltSystem';
import { playHirelingProjectileCues } from '../systems/hirelingProjectileCues';
import { awardFirstHundred, bindAbilityLevelUps } from '../systems/abilityLevelUps';
import { bindCraftLevelUps } from '../systems/craftLevelUps';
import { SkeletonProjectileSystem } from '../systems/SkeletonProjectileSystem';
import { GoblinArrowSystem } from '../systems/GoblinArrowSystem';
import { SkeletonSummonSystem } from '../systems/SkeletonSummonSystem';
import { ClownGasSystem } from '../systems/ClownGasSystem';
import { FairySystem } from '../systems/FairySystem';
import { FairyFireballSystem } from '../systems/FairyFireballSystem';
import {
  playFairyFireballCues,
  playFairySystemCues,
  playFrostCues,
} from '../systems/fairyAudioCues';
import { Fairy } from '../creatures/fairies/Fairy';
import { FAIRY_KINDS } from '../sprites/art/fairyTiming';
import {
  FAIRY_SPAWN_KEYS,
  FairyRoomLedger,
  spawnBossRoomHealers,
  spawnOverworldFairies,
  spawnRoomFairies,
} from '../levels/fairySpawner';
import { KnightMissileSystem } from '../systems/KnightMissileSystem';
import { CombatKit } from '../systems/kits/CombatKit';
import { DestructionKit } from '../systems/kits/DestructionKit';
import type { GroundPickupCheckpoint } from '../systems/GroundPickupSystem';
import {
  hostileWithinAttackRange,
  hostileWithinRadius,
  shouldShowInteractionPrompts,
} from '../systems/interactionPromptGate';
import { ALL_BREAKABLE_PROPS, NO_BREAKABLE_PROPS } from '../systems/DestructiblePropSystem';
import { MenusKit } from '../systems/kits/MenusKit';
import { ChatKit, type ChatCommand } from '../systems/kits/ChatKit';
import {
  activateHotbarSlot,
  drinkAnyHealthPotion,
  releaseChargedDynamite,
  refuseDynamiteInSafeRoom,
  type HotbarHost,
} from '../systems/kits/hotbarActions';
import { MobRoster, type SceneWorld } from '../systems/kits/SceneWorld';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../systems/mobCheckpoint';
import { deadFairyUpgradeBosses, replayFairyRateUpgrades } from '../systems/fairyUpgradeBosses';
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
import {
  CRAWLER_SIGN_SPEAKER,
  CrawlerSignSystem,
  SIGN_REVEAL_INTERVAL_MS,
  signPages,
} from '../systems/CrawlerSignSystem';
import type { CrawlerSignPlacement } from '../map/crawlerSigns';
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
import {
  drawInteractionPrompt,
  interactionPromptsDrawnThisFrame,
  setInteractionPromptsSuppressed,
} from '../ui/InteractionPrompt';
import type { JuicerRoomSystem } from '../systems/JuicerRoomSystem';
import {
  BossRoomDressings,
  buildColosseumDressing,
  buildGauntletRoomDressings,
} from '../systems/bossRooms/BossRoomDressings';
import { ArenaRoomSystem } from '../systems/ArenaRoomSystem';
import { BarrierSystem } from '../systems/BarrierSystem';
import { ArenaSystem } from '../systems/ArenaSystem';
import {
  type TreasureChest,
  TreasureChestSystem,
  isChestOpenable,
} from '../systems/TreasureChestSystem';
import { HumanTalkDriver, openChestWithGesture } from '../creatures/humanGestures';
import { type Pt } from '../sprites/art/carlArt';
import { ChestRewardDialog, type ChestLootSplit } from '../ui/ChestRewardDialog';
import { RewardFlySystem, type RewardFlyHold } from '../systems/RewardFlySystem';
import { playRewardLandingCues } from '../systems/rewardFlyAudio';
import type { PendingLoot } from '../systems/LootSystem';
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
import {
  carriedSaveRegeneratesFloor,
  owesArrivalSave,
  respawnModeFor,
  respawnRouteFor,
  savePointAfterWrite,
  type SavePoint,
} from '../core/SavePoint';
import { sceneSetupFromSave } from './resumeFromSave';
import type { TilePoint } from '../map/town/townPlan';
import type { WorldCheckpoint } from '../core/WorldCheckpoint';
import {
  toPersistedArenaCheckpoint,
  fromPersistedArenaCheckpoint,
  toPersistedTreasureChestCheckpoint,
  fromPersistedTreasureChestCheckpoint,
  toPersistedDefendQuestCheckpoint,
  fromPersistedDefendQuestCheckpoint,
  toPersistedSpiderQuestCheckpoint,
  fromPersistedSpiderQuestCheckpoint,
  toPersistedCircusQuestCheckpoint,
  fromPersistedCircusQuestCheckpoint,
  toPersistedMurderMysteryQuestCheckpoint,
  fromPersistedMurderMysteryQuestCheckpoint,
  toPersistedBountyCheckpoint,
  fromPersistedBountyCheckpoint,
  toPersistedMarketStockCheckpoint,
  fromPersistedMarketStockCheckpoint,
  type PersistedWorldState,
} from '../core/PersistedWorldState';
import { assertNoFieldsLeft } from '../core/guards';
import { BossIntroSystem } from '../systems/BossIntroSystem';
import { DungeonIntroSystem } from '../systems/DungeonIntroSystem';
import { TreeSystem } from '../systems/TreeSystem';
import { WaterAnimationSystem } from '../systems/WaterAnimationSystem';
import { AbilityManager, type AbilityId } from '../core/AbilityManager';
import { FollowerMenu } from '../systems/FollowerMenu';
import { MAGIC_MISSILE_DEF, MAGIC_MISSILE_TALISMAN_LEVEL } from '../abilities/magicMissile';
import { MONGO_EXPLAINER_FOCUS_ID } from '../ui/MongoExplainer';
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
import {
  CrawlerBarkSystem,
  DONUT_KNOCKOUT_BARK,
  WARD_EXPLAINER_BARK_LINES,
} from '../systems/CrawlerBarkSystem';
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
import { BountySystem, BOUNTY_TRACKER_ID } from '../systems/BountySystem';
import { findBountyDef } from '../systems/bountyDefs';
import { findNearbyWalkableTile, hasRoomToMove } from '../map/findWalkableTile';
import { resolveDeathCause } from '../systems/DeathCauseSystem';
import { pickDeathExplanation } from '../ui/DeathExplanations';
import { BuildingInteriorScene } from './BuildingInteriorScene';
import {
  MongoSystem,
  mongoXpFraction,
  SUMMON_BUTTON_HEIGHT,
  SUMMON_BUTTON_WIDTH,
} from '../systems/MongoSystem';
import type { InteriorCompanionArrival } from '../systems/companionCarry';
import { DefendQuestSystem } from '../systems/DefendQuestSystem';
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
import {
  capturePersistedDoomsday,
  createDoomsdayProgress,
  rearmExpiredDoomsday,
  restoreDoomsdayProgress,
  type DoomsdayProgress,
} from '../core/DoomsdayProgress';
import {
  captureClubMembership,
  createClubMembership,
  restoreClubMembership,
  type ClubMembership,
} from '../core/ClubMembership';
import {
  captureTownMemory,
  createTownMemory,
  forgetClearedCamps,
  noteCampCasualty,
  restoreTownMemory,
  type TownMemory,
} from '../core/TownMemory';
import {
  clonePartyCraftsState,
  createPartyCraftsState,
  restorePartyCraftsState,
  type PartyCraftsState,
} from '../core/partyCrafts';
import {
  captureBriarHollowState,
  createBriarHollowState,
  restoreBriarHollowState,
  type BriarHollowState,
} from '../core/briarHollowState';
import { PartyTools } from '../core/PartyTools';
import { keybindings } from '../core/Keybindings';
import {
  BriarHollowKit,
  type BriarHollowKitCheckpoint,
} from '../systems/briarHollow/BriarHollowKit';
import { resolveVillageAssaultLevel } from '../systems/briarHollow/villageAssaultLevel';
import { GatheringKit, type GatheringCheckpoint } from '../systems/briarHollow/GatheringKit';
import { GrateSpikesMenu } from '../systems/GrateSpikesMenu';
import { StructureHold } from '../systems/briarHollow/structureHold';
import {
  anyResourceZone,
  inGatheringDistrict,
  nearPalisade,
} from '../systems/briarHollow/resourceZones';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type MercenaryRoster,
  type MercenaryRosterCheckpoint,
} from '../core/MercenaryRoster';
import { createGodModeState, type GodModeState } from '../core/GodMode';
import { MercenarySystem } from '../systems/MercenarySystem';
import {
  DOOMSDAY_TRACKER_ID,
  DoomsdayEscapeSystem,
  STAIRWELL_KNOCKED_OUT_TOAST,
} from '../systems/DoomsdayEscapeSystem';
import {
  clearSightOf,
  RenderPipeline,
  visibilityRadiusPx,
  type RenderContext,
} from '../systems/RenderPipeline';
import { cameraWorldView, setVisibleWorldView } from '../core/visibleWorldView';
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
  SLAM_AUDIO_SEEK_SECONDS,
  SCREECH_AUDIO_SEEK_SECONDS,
} from '../creatures/GrotesqueSpider';
import { randomInt, pointInRect } from '../utils';
import { aiAdapter } from '../ai/AIAdapter';
import {
  adviceObjective,
  asOptional,
  gatewayAdviceId,
  MordecaiAdvisor,
  type AdviceObjective,
  type AdviceSlot,
} from '../systems/mordecaiAdvice';
import {
  ALL_DEBRIEF_BOSS_TYPES,
  debriefBossType,
  debriefHasNews,
  debriefPages,
  EMPTY_DEBRIEF_MEMORY,
  isSupersededDebrief,
  reconcileDebriefMemory,
  rememberDebriefSpoken,
  sameDebriefMemory,
  unwornGear,
  type DebriefBossType,
  type DebriefMemory,
  type DebriefState,
  type MordecaiDebriefCheckpoint,
} from '../systems/mordecaiDebrief';
import type { QuestMarkerState } from '../sprites/questNPCSprite';
import type { AISceneContext } from '../ai/aiActions';
import { GameStats, bindRunStats, type GameStatsSnapshot } from '../core/GameStats';
import { difficultyStats } from '../core/DifficultyStats';
import { settings } from '../core/Settings';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { VillageBuildingId } from '../map/overworld/briarHollowLayout';
import { rectCentre } from '../map/overworld/briarHollowSite';
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
 * progress — which belongs to neither `PlayerSnapshot` because it is shared —
 * plus the floor's generation seeds and the safe room to stand back in.
 */
export type SaveProgressFn = (data: GameProgressInput) => void;

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
  /** Regenerates the floor a save was written on. Unused when `existingMap` is given. */
  worldSeed?: number;
  /** Collapse-timer frames remaining, so a resume does not hand back a full clock. */
  levelTimerFrames?: number;
  /** The art seed that floor was painted with, so a resume looks like the run it resumes. */
  artSeed?: number;
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
  /**
   * Whatever was lying on the ground to be picked up, carried across a
   * building-exit rebuild — only meaningful alongside `existingMap`, since the
   * spots they lie on are only still open ground on the same map instance.
   */
  existingGroundPickups?: GroundPickupCheckpoint;
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
  /**
   * Whether Mongo was out beside the party at the building door they just came
   * out of. He is rebuilt beside the cat on the first frame, at the health the
   * pet state carries.
   */
  mongoWasOut?: boolean;
  /** Carry ability leveling progress across floor transitions. */
  abilityManager?: AbilityManager;
  /** Ability state at floor entry — restored on death-restart so level-up progress rewinds to floor-start. */
  floorEntryAbilityManager?: AbilityManager;
  /** The run's tallies at floor entry — a floor restart rewinds the world's counters to these. */
  floorEntryGameStats?: GameStatsSnapshot;
  /**
   * The hire as it stood at floor entry. A floor restart rewinds the coins a
   * contract was paid with, so it has to rewind the contract with them.
   */
  floorEntryMercenaryRoster?: MercenaryRosterCheckpoint;
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
  /** Tactics-trait System notices already shown this run, threaded like `journalProgress`. */
  tacticsNoticesSeen?: Set<TacticsTrait>;
  /** Bounty-board state, threaded by reference across building/scene transitions. */
  bountyProgress?: BountyProgress;
  /** Doomsday-finale state (soul crystal containment + escape), threaded by reference across building/scene transitions. */
  doomsdayQuestProgress?: DoomsdayProgress;
  /** Desperado Club membership, threaded by reference across building/scene transitions. */
  clubMembership?: ClubMembership;
  /** Resident lore progress + the apothecary's batch, threaded by reference across building/scene transitions. */
  townMemory?: TownMemory;
  /**
   * Shared tool tiers and seen craft explainers. Party progress like
   * `abilityManager`, so it is threaded the same way rather than reset per
   * floor: an axe upgrade survives every door and every stairway.
   */
  partyCrafts?: PartyCraftsState;
  /**
   * Briar Hollow's quest, structures and soldier orders, threaded by
   * reference across building/scene transitions like `townMemory`. Empty and
   * inert off floor 3.
   */
  briarHollowState?: BriarHollowState;
  /**
   * Dev-only: run once on Briar Hollow's systems as soon as they are built,
   * before the first frame — a playtest preset standing the village up
   * part-way through its questline.
   */
  prepareBriarHollow?: (kit: BriarHollowKit, gameMap: GameMap) => void;
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
   * Dev bootstrap only: these boss types never spawn, and their rooms are
   * marked won before the first frame — a playtest preset dropping the party
   * past a gauntlet gate it never fought.
   */
  preDefeatedBossTypes?: readonly MobSpawnRule['type'][];
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
   * The first frame takes no save: neither the floor-arrival save nor, for a
   * party that starts inside the town wall, a town entry. Set by a floor
   * restart, which rewinds the party to how it stood when the floor began.
   * The restart only runs when the run has no save to return to, but writing
   * that older party over one would lose it, so the arrival never writes. The
   * next real save point saves as usual.
   */
  suppressArrivalSave?: boolean;
  /**
   * The last save the run wrote, for a scene rebuilt without writing a new one
   * — a building exit, or a respawn from the save itself. A death before this
   * scene takes its own save respawns from it. Only the save crosses over, never
   * its in-place checkpoint: a rebuilt scene regenerates its population, and a
   * checkpoint's mob flags belong to the roster that captured it.
   *
   * Absent on a new floor, which takes its own save on arrival.
   */
  lastSave?: GameProgressInput;
  /** Floor and run state from a resumed save; absent on a fresh game or an older save. */
  persistedWorldState?: PersistedWorldState;
}

// Items with a designated owner — kept in sync with non-boss floor loot routing below
/** Building whose forge fires supply the town's fire-crackle ambience. */
const RUSTY_ANVIL_BUILDING_NAME = 'The Rusty Anvil';
/** The key the necromancer's boss intro is played under: his spawn key. */
const NECROMANCER_BOSS_TYPE = 'necromancer';
/** How far outside the mark `!bounty go` lands the party — inside its aggro range. */
const BOUNTY_WARP_STANDOFF_TILES = 4;

/** Most fairies one `!fairy` spawns. */
const FAIRY_CHEAT_MAX_COUNT = 8;
/** Tiles either side of the crawler `!fairy` scatters its fairies across. */
const FAIRY_CHEAT_SPREAD_TILES = 3;
/** Random tiles tried before `!fairy` settles for however many it placed. */
const FAIRY_CHEAT_ATTEMPTS = 40;
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
/** Briar Hollow's bed is a constant, palisade-wide emitter: full inside the wall, silent outside it. */
const VILLAGE_AMBIENT_VOLUME = 0.4;
/** The forge and cookhouse beds swell as you walk up to their doors, then fade out across the square. */
const VILLAGE_WORKSHOP_AMBIENT_RADIUS_TILES = 9;
const VILLAGE_WORKSHOP_AMBIENT_VOLUME = 0.5;

/** Shown via `HotbarToast` on safe-room entry, once a checkpoint is actually captured. */
const PROGRESS_SAVED_TOAST_TEXT = 'Progress Saved...';

/** Toast shown the moment the Juicer falls and both crawlers take the ink. */
const DESPERADO_TATTOO_NOTICE = 'New tattoo: the Desperado Pass. The Club will know you.';
/** Its line in the Juicer chest's reward columns — an award, not an inventory item. */
const DESPERADO_TATTOO_REWARD_LABEL = 'Desperado Pass Tattoo (both crawlers)';
/** Healing potions the tutorial's treasure chest hands the cat with her Magic Missile tome. */
const TUTORIAL_CHEST_CAT_POTIONS = 10;

/**
 * What an opened chest's reward dialog shows, and what dismissing it grants
 * over and above the loot, which is already handed over when it is shown.
 */
interface ChestReward {
  readonly split: ChestLootSplit | null;
  readonly onDismissed?: () => void;
}

/** The tutorial shares `floorNumber: 1` with this level, so the id is what tells them apart. */
const FIRST_DUNGEON_LEVEL_ID = 'level1';

const FORCED_TO_HUMAN = new Set<string>([
  'trollskin_shirt',
  'nightgaunt_cloak',
  'splatter_skunk_toe_ring',
  'shade_gnoll_kneepads',
  'grull_war_gauntlet',
  'slingshot',
  'explosives_handling_tome',
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

/** Kills one attack has to land at once to earn the crowd-control award. */
const MULTIKILL_ACHIEVEMENT_THRESHOLD = 10;
/** Enemies one dynamite blast has to kill to earn the Little Boom award. */
const LITTLE_BOOM_KILL_THRESHOLD = 2;

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

/**
 * How fast the floor's track ducks out when a hack begins. Short: the count-in
 * starts almost immediately, and a long crossfade would have the player counting
 * themselves in over the tail of the previous song.
 */
const KEYBOARD_HERO_MUSIC_HANDOVER_FADE_MS = 400;

/** The keyboard-hero per-hit tick sits under the track rather than over it. */
const KEYBOARD_HERO_HIT_TICK_VOLUME = 0.45;
const LONGPRESS_TIMEOUT_MS = 500;
const TOUCH_DRAG_THRESHOLD = 10;
const MINIMAP_DRAG_THRESHOLD = 5;
/** How close two world taps must land, in time, to read as the village kit's double-tap gesture. */
const BRIAR_HOLLOW_DOUBLE_TAP_WINDOW_MS = 300;
/** A hold that moved the crawler further than this was a walk, not a long-press. */
const HOLD_WALK_TOLERANCE_PX = 4;

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
/** The cat's reward for her first tutorial kill. */
const FIRST_BLOOD_POTION_REWARD = 10;
const PLAYER_IDLE_REPORT_INTERVAL_FRAMES = 300;
const LOW_HEALTH_THRESHOLD = 0.25;
const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const TREE_FALL_SOUNDS = ['tree_fall_1', 'tree_fall_2', 'tree_fall_3', 'tree_fall_4'] as const;
const MONGO_ADULT_SQUAWK_MIN_LEVEL = 5;
const MONGO_ADULT_HAPPY_SQUAWKS = [
  'happy_adult_mongo_squawk_1',
  'happy_adult_mongo_squawk_2',
  'happy_adult_mongo_squawk_3',
  'happy_adult_mongo_squawk_4',
] as const;
const MONGO_BABY_HAPPY_SQUAWKS = [
  'happy_baby_mongo_squawk_1',
  'happy_baby_mongo_squawk_2',
  'happy_baby_mongo_squawk_3',
  'happy_baby_mongo_squawk_4',
] as const;
/** The five-minute alarm is the ten-minute one pitched up, so the escalation is audible. */
const FIVE_MINUTE_WARNING_PLAYBACK_RATE = 1.3;

/**
 * Mob-attack and hazard one-shots long enough to still be sounding when a
 * death interrupts them — a bottle's gas hiss, a spider's slam or screech
 * wind-up. Nothing else stops these mid-play: `restoreFromCheckpoint` (an
 * in-place restore) and `restartAtFloorEntry` (a full floor restart) both
 * carry the same `AudioManager` into the world that comes after, so an
 * orphaned source plays out its full length across the death screen and into
 * the respawn — which is exactly what reads as a hazard sound that "keeps
 * going" after reviving. Stopped alongside `death_sequence` everywhere that
 * one already is.
 */
const HAZARD_SOUNDS_TO_STOP_ON_RESPAWN: readonly SoundId[] = [
  'gas_cloud',
  'grotesque_spider_slam_attack',
  'grotesque_spider_screech_attack',
];

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
  // Only ever called from `update`, by which point the constructor has assigned
  // every boss system the check reads.
  protected readonly skillPointReminder = new SkillPointReminderSystem((ctx) =>
    this.isPartyInUnresolvedBossRoom(ctx),
  );
  private readonly systemNotices: SystemNoticeSystem;
  private readonly tacticsNotices: TacticsNoticeSystem;
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
  /**
   * Saved, but not rewound on death, so heard speeches stay heard; see
   * `forgetDebriefsOfLivingBosses` for the one rewind that must reset it.
   */
  private mordecaiDebrief: MordecaiDebriefCheckpoint = {};
  /**
   * Saved, but not rewound on death, so a heard System notice stays heard.
   * Threaded by reference across building/scene transitions like
   * `journalProgress`, so a trait met indoors is still met on the way back out.
   */
  private readonly tacticsNoticesSeen: Set<TacticsTrait>;
  private lavaBalls: LavaBallSystem;
  private rockThrows: RockThrowSystem;
  private hirelingShots: HirelingBoltSystem;
  private skeletonShots: SkeletonProjectileSystem;
  private goblinArrows: GoblinArrowSystem;
  private skeletonSummons: SkeletonSummonSystem;
  private clownGas: ClownGasSystem;
  private readonly fairies: FairySystem;
  private readonly fairyFireballs: FairyFireballSystem;
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
  /** The HUD's Build button, while it shows. */
  private buildButtonRect: UIRenderer.Rect | null = null;
  private townDecor: TownDecorSystem | null = null;
  private market: MarketSystem | null = null;
  /**
   * Every town fixture in one Y-sort list. Built once, since both owning systems
   * fill their prop arrays in their constructors and never add to them.
   */
  private townPropRenderables: ReadonlyArray<TownPropRenderable> | null = null;
  private citizenDialog: CitizenDialog | null = null;
  private crawlerSigns: CrawlerSignSystem | null = null;
  /** Separate from `citizenDialog`, which is overworld-only and owned by the townsfolk conversation. */
  private signDialog: CitizenDialog | null = null;
  private signDialogTarget: CrawlerSignPlacement | null = null;
  /** Citizen currently frozen mid-conversation; unfrozen once `citizenDialog` closes. */
  private citizenDialogTarget: Townsperson | null = null;
  /** Keeps Carl talking, turned to whoever he is in conversation with. */
  private readonly humanTalk = new HumanTalkDriver();
  private noticeBoard: NoticeBoardPanel | null = null;
  private marketPanel: PricedMenuPanel | null = null;
  private fortuneTeller: FortuneTellerPanel | null = null;
  private juicerRoom: JuicerRoomSystem;
  private bossRoomDressings: BossRoomDressings;
  private arenaRoom: ArenaRoomSystem;
  private barriers: BarrierSystem;
  private defendQuest!: DefendQuestSystem;
  /** The Structure menu over a boarded grate, for a crawler who can spike it. */
  private readonly grateSpikes: GrateSpikesMenu;
  /** Whether the current world touch came down on a structure, making it a long-press rather than a walk. */
  private readonly structureHold = new StructureHold();
  /** Where the active crawler stood when the current world touch began. */
  private holdStartActivePos: { x: number; y: number } | null = null;
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
  /** Briar Hollow's bed, held so `updateVillageAmbience` can switch it with the player's position. */
  private villageAmbientEmitter: AmbientEmitter | null = null;
  private readonly circusQuestProgress: CircusQuestProgress;
  private readonly murderQuestProgress: MurderQuestProgress;
  private readonly anchorQuestProgress: AnchorQuestProgress;
  private readonly journalProgress: JournalProgress;
  private readonly bountyProgress: BountyProgress;
  private readonly doomsdayQuestProgress: DoomsdayProgress;
  private readonly clubMembership: ClubMembership;
  private readonly townMemory: TownMemory;
  private readonly partyCrafts: PartyCraftsState;
  /** Wraps `partyCrafts.tools` by reference; one instance for the scene's lifetime. */
  private readonly partyTools: PartyTools;
  private readonly briarHollowState: BriarHollowState;
  /**
   * Built only on the floor-3 overworld, and only once its village site has
   * been generated onto the map (`gameMap.briarHollow`). Null everywhere else.
   */
  private briarHollowKit: BriarHollowKit | null = null;
  /**
   * The kit's own transient state as of the last save point, held on this scene
   * instance rather than in `LevelCheckpoint` — nothing here is durable, and a
   * door-rebuild or a fresh load starts the kit with nothing to restore.
   */
  private briarHollowKitCheckpoint: BriarHollowKitCheckpoint | null = null;
  /**
   * Chopping, mining, thralls and the resource HUD. Built on every overworld
   * floor, village or not, because any tree or boulder can be worked; null
   * elsewhere.
   */
  private gathering: GatheringKit | null = null;
  /** The gathering kit's own checkpoint, taken and put back beside the village kit's. */
  private gatheringCheckpoint: GatheringCheckpoint | null = null;
  /** When the last world tap resolved, so a second one close behind it reads as the kit's double-tap gesture. */
  private briarHollowLastWorldTapAt: number | null = null;
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
  /**
   * Mongo walked out of a building with the party and is waiting to be put down
   * beside the cat. Held for the first gameplay frame rather than done in the
   * constructor, which runs before the party is placed at the door.
   */
  private mongoCarryPending = false;
  private readonly mercenarySystem: MercenarySystem;
  private renderPipeline = new RenderPipeline();
  private bus = new EventBus();
  private readonly crawlerBarks = new CrawlerBarkSystem();

  private levelCompleteScreen = new LevelCompleteScreen();
  private readonly runCompleteScreen = new RunCompleteScreen();

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
  /** Coins/items flying to the HUD from wherever they were earned. Screen-space; ticks and draws every frame regardless of what else is on screen. */
  protected readonly rewardFly = new RewardFlySystem();
  /** The chest reward dialog's own hold, if one is outstanding — set in `showChestReward`, cleared on release. */
  private chestRewardFlyHold: RewardFlyHold | null = null;

  private floorEntryHumanSnap!: PlayerSnapshot;
  private floorEntryCatSnap!: PlayerSnapshot;
  private floorEntryHumanAchievements!: AchievementManager;
  private floorEntryCatAchievements!: AchievementManager;
  private floorEntryAbilityManager!: AbilityManager;
  private readonly floorEntryGameStats: GameStatsSnapshot;
  private readonly floorEntryMercenaryRoster: MercenaryRosterCheckpoint;

  private readonly followerMenu = new FollowerMenu();

  private _revealStairwell = false;
  private _revealSpiderLab = false;

  private gameOver = false;
  protected readonly notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  /**
   * The tutorial has no `LevelDef` collapse timer of its own — it isn't built
   * from one — so it keeps the hour every timed floor used to run on, named
   * here rather than repeating the literal. Also the fallback clamp for a
   * timed `LevelDef` that omits `collapseTimeLimitFrames`.
   */
  private readonly TUTORIAL_TIME_LIMIT_FRAMES = 216_000; // 1 hour @ 60 fps
  private wasInSafeRoom = false;
  /**
   * Whether the active crawler stood inside the town wall last frame. Starts
   * false so that a scene built with the party already inside the wall — a
   * building exit, the floor-3 arrival, a loaded save — counts as entering town
   * on its first frame and takes a save. A death restart opts out through
   * `suppressArrivalSave`.
   */
  private wasInTown = false;
  /**
   * Whether the active crawler stood in Briar Hollow's square last frame —
   * the same first-frame convention as {@link wasInTown}, so a scene built
   * with the party already standing there (a building exit, a loaded save)
   * counts as entering it and takes a save.
   */
  private wasInBriarHollowSquare = false;
  /**
   * The last save point entered — a safe room's centre, or the tile where the
   * party entered town — which is where a resume puts them.
   */
  private lastSavePointTile: TilePoint | null = null;
  /** The last save the run wrote, which is where a death respawns; null until there is one. */
  private lastSave: SavePoint | null = null;
  /**
   * Whether the first frame still owes the floor-arrival save. A floor with no
   * save of its own would send a death back to the previous floor's last save
   * point, so a new floor saves where the party stands the moment it arrives.
   */
  private arrivalSavePending = false;
  /**
   * Room indices (into `gameMap.roomBounds`) that have already taken their
   * one-time stairwell save, so clearing a room that keeps producing grub
   * spawns doesn't resave it every kill. Never cleared: it is scoped to this
   * floor's `DungeonScene` instance, same as `lastSave`.
   */
  private readonly stairwellRoomsSaved = new Set<number>();
  /**
   * Stairwell rooms that already held zero counted hostiles the moment this
   * floor's mobs finished their initial spawn — set once in the constructor
   * and never touched again.
   *
   * This is the only set the *entry* save (walking into an already-quiet room)
   * is allowed to fire from. A room a guard was later chased out of is not in
   * it, even once the last of those guards dies somewhere else, so dashing
   * into the room one step ahead of a pursuer can never bank a checkpoint —
   * only a kill that actually happens *in* the room, through `mobKilled`, can
   * clear a room that started this floor occupied.
   *
   * A same-instance checkpoint rewind (`restoreFromCheckpoint`) never touches
   * this: it replays combat outcomes on the roster the floor already spawned,
   * not a new spawn, so the floor's true starting occupancy hasn't changed. A
   * save/floor-restart route instead builds a brand new `DungeonScene`, whose
   * own constructor computes its own fresh set from its own fresh spawn.
   */
  private roomsClearAtFloorStart: ReadonlySet<number> = new Set();
  /**
   * A stairwell room whose guards are all dead but whose save was withheld
   * because a hostile was still engaged near the active crawler — retried
   * every frame (cheap: a no-op past the first two guards) until the
   * engagement clears or the room is saved by some other route.
   */
  private pendingStairwellSaveRoomIndex: number | null = null;
  /**
   * The active crawler's room index as of last frame, so the per-frame
   * stairwell entry-save check — which walks every mob in the room — only
   * runs on the frame that index actually changes, plus any frame a save is
   * still pending.
   */
  private lastActiveRoomIndexForStairwellSave: number | null = null;
  /**
   * The carried save when this floor could not be rebuilt from it — it has no
   * world, or one from an older generator — and was generated fresh in its
   * place; null otherwise. While it is still the last save, the arrival save
   * replaces it.
   */
  private staleCarriedSave: GameProgressInput | null = null;
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

  protected readonly audio: AudioManager | null;
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
    this.floorEntryGameStats = options?.floorEntryGameStats ?? this.gameStats.snapshot();
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
    let fairyLedger: FairyRoomLedger | null = null;
    let spawnTileX = 0;
    let spawnTileY = 0;

    if (tutorialController !== null) {
      const tutMap = new TutorialMap();
      this.gameMap = tutMap;
      this.tutorial = tutorialController;
      this.levelTimerFrames = this.TUTORIAL_TIME_LIMIT_FRAMES;

      spawnTileX = tutMap.humanStartTile.x;
      spawnTileY = tutMap.humanStartTile.y;
      this.pm = new PlayerManager(spawnTileX, spawnTileY, levelDef.xpDiminishingTiers);
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
          worldSeed: options?.worldSeed,
          artSeed: options?.artSeed,
        });
      if (levelDef.hasCollapseTimer === true) {
        const floorTimeLimit = levelDef.collapseTimeLimitFrames ?? this.TUTORIAL_TIME_LIMIT_FRAMES;
        // Clamped to this floor's own limit even for a resumed save: a save
        // written on a floor with a longer limit must not hand a shorter one
        // more time than it is supposed to have.
        this.levelTimerFrames = Math.min(
          options?.levelTimerFrames ?? floorTimeLimit,
          floorTimeLimit,
        );
      } else {
        this.levelTimerFrames = 0;
      }

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
      this.pm = new PlayerManager(spawnTileX, spawnTileY, levelDef.xpDiminishingTiers);

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
      // Read from the save itself on a resume: the saved `townMemory` is only
      // applied once every system exists, long after the roster is filled.
      const clearedCamps = new Set(
        options?.persistedWorldState?.townMemory.clearedCamps ?? options?.townMemory?.clearedCamps,
      );
      const preDefeatedBossTypes = options?.preDefeatedBossTypes ?? [];
      initialMobs.push(
        ...spawnForLevel(
          levelDef,
          this.gameMap,
          partyLevel,
          difficultyProfile,
          clearedCamps,
        ).filter(
          // Left out of the roster entirely, not just marked dead: a boss
          // skipped this way never fights, so nothing should ever find it
          // alive, and the hard-mode healer spawn below only puts one beside a
          // boss it can find in its room.
          (mob) => !(mob.isBoss && preDefeatedBossTypes.some((type) => type === mob.spawnTypeKey)),
        ),
      );
      // The difficulty key is read here with the profile, for the same reason:
      // a fairy's potency is stamped once and a settings flip must not move it.
      fairyLedger = new FairyRoomLedger(
        levelDef,
        partyLevel,
        difficultyProfile,
        settings.difficulty,
      );
      initialMobs.push(...spawnRoomFairies(this.gameMap, fairyLedger));
      initialMobs.push(...spawnOverworldFairies(this.gameMap, fairyLedger));
      // A resumed save's won rooms are still in the save rather than in the
      // boss-room system, which only learns them once every system exists.
      const persistedBossRooms = options?.persistedWorldState?.bossRoom.rooms ?? [];
      initialMobs.push(
        ...spawnBossRoomHealers(
          fairyLedger,
          this.gameMap,
          initialMobs,
          (roomIndex) =>
            roomIndex < persistedBossRooms.length && persistedBossRooms[roomIndex].defeated,
        ),
      );
      initialMobs.push(...spawnExtraMobs(levelDef, this.gameMap, partyLevel, difficultyProfile));

      // Treasure room mobs (extra enemies guarding wooden chests)
      if (levelDef.hasTreasureRoomGuards === true) {
        initialMobs.push(
          ...spawnTreasureRoomMobs(
            this.gameMap.treasureRooms,
            levelDef,
            this.gameMap,
            partyLevel,
            difficultyProfile,
          ),
        );
      }
    }

    // The map — freshly generated, reused across a checkpoint restore, or the
    // tutorial's — is what owns the art seed, and every runtime painter reads it
    // from the module slot rather than being handed it. Set before the first tile
    // chunk or ground sheet is baked, and never again while this floor is live:
    // a chunk baked under one seed and drawn under another is a silent tear.
    setFloorArtSeed(this.gameMap.artSeed);

    // Queued, not painted: the cache spends a few milliseconds a frame on these
    // so the floor fades in while its ground arrives, and re-bakes the tile
    // chunks each time a sheet lands — chunks near the player bake against each
    // material's fallback colour first and would otherwise keep it forever.
    const repaintTileArt = (): void => this.gameMap.invalidateAllTileArt();
    requestGroundSheets(
      groundSheetKeysAmong(requiredSpriteKeysForLevel(levelDef.id, levelDef.spriteGroups)),
      repaintTileArt,
    );
    // After the ground, because the queue drains in request order and a floor
    // with no ground yet is unreadable while a floor with no trees yet is merely
    // sparse. The same tile-art invalidation applies: a decoration bakes into a
    // chunk, and a chunk baked before its sheet landed would keep the gap.
    requestEnvironmentSheetsForGroups(levelDef.spriteGroups, {
      onSheetPainted: repaintTileArt,
      // The facades are seconds of painting and the rest of the town is not, so
      // they are painted outward from where the party actually arrives.
      town:
        this.gameMap.townPlan === undefined
          ? undefined
          : {
              plan: this.gameMap.townPlan,
              spawnTile: { x: spawnTileX, y: spawnTileY },
            },
    });

    this.world = {
      gameMap: this.gameMap,
      bus: this.bus,
      audio: this.audio,
      pm: this.pm,
      roster: new MobRoster(this.gameMap, new SpellSystem()),
    };
    for (const mob of initialMobs) this.world.roster.add(mob);

    // After the initial spawn, and only ever here: this is the floor's true
    // starting occupancy, which a stairwell room's *entry* save is gated on.
    this.roomsClearAtFloorStart = new Set(
      this.gameMap.roomBounds
        .map((_room, roomIndex) => roomIndex)
        .filter(
          (roomIndex) =>
            this.roomIndexOfStairwellRoom(roomIndex) &&
            this.gameMap.hostilesInRoom(roomIndex, this.world.roster.mobs).length === 0,
        ),
    );

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
    this.safeRoom.setMarkerSource((room) => this.mordecaiMarkerFor(room));
    this.combat = new CombatKit({
      world: this.world,
      abilityManager: this.abilityManager,
      safeRoom: this.safeRoom,
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
        `Human HP: ${displayHp(this.human.hp)}/${this.human.maxHp}, Cat HP: ${displayHp(this.cat.hp)}/${this.cat.maxHp}.`,
      sceneCommands: this.dungeonChatCommands(),
    });
    this.destruction = new DestructionKit(this.world, levelDef.floorNumber, {
      // The town's street torches and gate braziers are architecture. Everything
      // underground, and everything indoors, is for breaking.
      breakableProps: levelDef.isOverworld ? NO_BREAKABLE_PROPS : ALL_BREAKABLE_PROPS,
      trees: () => this.trees,
    });
    this.destruction.loot.onCredited = (loot) => this.flyLootReward(loot);
    this.destruction.groundPickups.onCollected = (itemId, quantity, worldX, worldY) => {
      const cam = this.camera();
      const name = ITEM_DEF[itemId].name;
      for (let i = 0; i < quantity; i++) {
        this.rewardFly.enqueueItem(itemId, name, worldX - cam.x, worldY - cam.y);
      }
    };
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
    const bossTypes = levelDef.bossRooms?.map((b) => b.type) ?? [];
    this.bossRoom = new BossRoomSystem(
      this.gameMap,
      this.miniMap,
      this.bus,
      bossTypes,
      (roomIndex) => this.treasureChests.hasUnopenedBossChest(roomIndex),
    );
    for (const bossType of options?.preDefeatedBossTypes ?? []) {
      this.bossRoom.markPreDefeated(bossType);
    }
    this._systemContext = {
      human: this.human,
      cat: this.cat,
      active: this.active(),
      inactive: this.inactive(),
      activeIsMoving: false,
      roster: this.world.roster,
      gameMap: this.gameMap,
      bossRoom: this.bossRoom,
      crawlerBarks: this.crawlerBarks,
    };
    const gauntletRoomDressings = buildGauntletRoomDressings(this.gameMap, bossTypes);
    this.juicerRoom = gauntletRoomDressings.juicer;
    // Anchored to the room he spawns into rather than to where his corpse ends
    // up: a knockback onto a doorway or boundary tile can land his death
    // position outside every tracked boss room, which would otherwise pin
    // this at -1 and make the Big Brawler gauntlet permanently unclearable.
    this.juicerBossRoomIdx = levelDef.bossRooms?.findIndex((b) => b.type === 'juicer') ?? -1;
    this.arenaRoom = new ArenaRoomSystem(this.gameMap.arenaExteriors[0]);
    this.barriers = new BarrierSystem(this.gameMap);
    this.defendQuest = new DefendQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => this.world.roster.add(mob),
      () => {
        const band = levelDef.defendQuestWave;
        if (band === undefined) return 1;
        return resolveAmbientLevel(
          band,
          levelDef,
          partyLevelOf(this.human.level, this.cat.level),
          activeDifficultyProfile(),
        );
      },
      levelDef.levelledCurve,
    );
    // The column's layout state is module-level and outlives a scene; a new
    // one starts from nothing until its first frame says otherwise.
    UIRenderer.resetColumnLayoutState();
    this.grateSpikes = new GrateSpikesMenu({
      defendQuest: this.defendQuest,
      human: this.human,
      cat: this.cat,
      audio: this.audio,
      announce: (message) => this.menus.announce(message),
    });
    this.spiderQuest = new SpiderQuestSystem(this.gameMap, this.bus, (mob) => {
      this.world.roster.add(mob);
      // The lab's boss arrives through this closure rather than the level's
      // initial spawn, so it missed the one-shot filter that builds this list
      // at construction — which is what renders its ground traps and spit and
      // plays its slam. Without this the boss is silent and trapless until
      // something else rebuilds the list.
      if (mob instanceof GrotesqueSpider) this.grotesqueSpiders.push(mob);
    });
    this.spiderQuest.labDressing?.setLootSink(this.destruction.loot);
    this.circusQuestProgress = options?.circusQuestProgress ?? createCircusQuestProgress();
    this.murderQuestProgress = options?.murderQuestProgress ?? createMurderQuestProgress();
    this.anchorQuestProgress = options?.anchorQuestProgress ?? createAnchorQuestProgress();
    this.journalProgress = options?.journalProgress ?? createJournalProgress();
    this.tacticsNoticesSeen = options?.tacticsNoticesSeen ?? new Set<TacticsTrait>();
    this.tacticsNotices = new TacticsNoticeSystem(this.tacticsNoticesSeen);
    this.bountyProgress = options?.bountyProgress ?? createBountyProgress();
    this.doomsdayQuestProgress = options?.doomsdayQuestProgress ?? createDoomsdayProgress();
    this.clubMembership = options?.clubMembership ?? createClubMembership();
    this.townMemory = options?.townMemory ?? createTownMemory();
    this.partyCrafts = options?.partyCrafts ?? createPartyCraftsState();
    this.partyTools = new PartyTools(this.partyCrafts.tools);
    // Self-heals any drift between the two inventories (a stray other-tier
    // tool, one crawler missing the current tier entirely). A no-op while no
    // tool has ever been granted, since `reconcile` only touches a kind whose
    // tier is non-null.
    this.partyTools.reconcile(this.human, this.cat);
    this.briarHollowState = options?.briarHollowState ?? createBriarHollowState();
    this.marketStock = options?.marketStock ?? createMarketStock();
    this.mercenaryRoster = options?.mercenaryRoster ?? createMercenaryRoster();
    this.floorEntryMercenaryRoster =
      options?.floorEntryMercenaryRoster ?? captureMercenaryRoster(this.mercenaryRoster);
    this.mercenarySystem = new MercenarySystem(
      this.mercenaryRoster,
      levelDef.id,
      (entity) => this.safeRoom.isEntityInSafeRoom(entity),
      {
        toast: (message) => this.menus.hotbarToast.show(message),
        sound: (id) => this.audio?.play(id),
      },
    );
    this.arena = new ArenaSystem(
      this.gameMap,
      this.bus,
      () => this.world.roster.mobs,
      (mob) => this.world.roster.add(mob),
      this.bossRoom,
    );
    const colosseumDressing = buildColosseumDressing(this.gameMap);
    this.arena.dressing = colosseumDressing;
    this.bossRoomDressings = new BossRoomDressings(
      {
        ...gauntletRoomDressings,
        spiderLab: this.spiderQuest.labDressing,
        colosseum: colosseumDressing,
      },
      bossTypes,
    );
    this.bossRoom.fightListener = this.bossRoomDressings;
    // After the listener exists: a preset's pre-defeated bosses were marked
    // before there was any room to tell.
    this.replayBossRoomDefeats();
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
    this.hirelingShots = new HirelingBoltSystem(this.gameMap, (point) =>
      this.safeRoom.isEntityInSafeRoom(point),
    );
    this.skeletonShots = new SkeletonProjectileSystem(this.gameMap);
    this.goblinArrows = new GoblinArrowSystem(this.gameMap);
    this.skeletonSummons = new SkeletonSummonSystem(this.gameMap, (mob) =>
      this.world.roster.add(mob),
    );
    this.clownGas = new ClownGasSystem(this.gameMap);
    this.fairies = new FairySystem({
      bus: this.bus,
      gameMap: this.gameMap,
      ledger: fairyLedger,
      getMobs: () => this.world.roster.mobs,
      getCrawlers: () => [this.human, this.cat],
      addMob: (mob) => this.world.roster.add(mob),
      skeletonSummons: this.skeletonSummons,
    });
    this.fairyFireballs = new FairyFireballSystem({
      bus: this.bus,
      gameMap: this.gameMap,
      getMobs: () => this.world.roster.mobs,
    });
    this.knightMissiles = new KnightMissileSystem(this.gameMap);
    this.companion = new CompanionSystem(
      this.gameMap,
      spawnTileX,
      spawnTileY,
      this.companionStance,
    );
    this.companion.registerHazardSource(this.bossRoom);
    this.companion.registerHazardSource(this.clownGas);
    this.companion.registerHazardSource(this.fairyFireballs);
    this.companion.registerHazardSource(this.bossRoomDressings);
    this.combat.mobLoop.registerHazardSource(this.bossRoom);
    this.combat.mobLoop.registerHazardSource(this.bossRoomDressings);
    this.combat.mobLoop.registerHazardSource(this.clownGas);
    this.combat.mobLoop.registerHazardSource(this.fairyFireballs);
    this.combat.mobLoop.registerHazardSource(this.lavaBalls);
    if (this.trees !== null) this.combat.mobLoop.registerHazardSource(this.trees);

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
        this.gameMap.hasWalkableLine(
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
    this.followerMenu.onSwitchCharacter = () => this.triggerSwitchCharacter();
    this.followerMenu.onToggleMongoAutoSummon = () => {
      this.audio?.play('menu_change_follower');
      settings.setCatAutoSummonsMongo(!settings.catAutoSummonsMongo);
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

        // A floor that suppresses its descent advice is not progression, so the
        // gap it would record is not a difficulty signal: the tutorial's party
        // cannot reach the level the next floor's mob bands imply, and booking
        // that as underlevelled is the telemetry lying to itself.
        const recommendedLevel =
          levelDef.suppressDescentAdvice === true
            ? null
            : recommendedPartyLevelFor(nextDef, activeDifficultyProfile());
        difficultyStats.recordDescend(partyLevel(), recommendedLevel);

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
          crafts: this.partyCrafts,
          mongoUnlocked: this.mongoSystem.unlocked,
          // The system's accessor, not the stored value: both of these saves can
          // fire with Mongo still out, and the stored value is only written back
          // when he despawns — so a safe room entered with a 5/130 raptor at the
          // player's heel was recording 130.
          mongoPetHp: this.mongoSystem.hp,
          mongoPetResting: this.mongoSystem.restingUntilFull,
          gameStats: this.gameStats.snapshot(),
          // No `world`: everything in it describes the floor being left, and a
          // reload has to build the next floor fresh, exactly as the stairs do.
        });

        this.bus.emit('levelComplete', {});
        this.mercenarySystem.endContractForFloor();

        // Drain now: the celebration screen stops `updateGameplay`, and the queue
        // does not survive into the next scene, so a level-up earned on the last
        // step of the floor would otherwise never be announced.
        this.systemNotices.drainFor(this.human, this.cat);

        this.levelCompleteScreen.activate(levelDef.name, nextDef.name, () => {
          // Dismiss Mongo and any hired merc before floor transition
          this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
          // This is the one genuine floor change among DungeonScene's four
          // `sceneManager.replace` sites, so it's the only one that runs the
          // sprite eviction pass — building enter/exit rebuild the scene around
          // the same floor identity and must never evict. Keyed on the *new*
          // floor's required keys, not the old floor's: anything the two
          // floors share (core, dungeon_common, ...) simply isn't touched.
          const nextFloorKeys = requiredSpriteKeysForLevel(nextDef.id, nextDef.spriteGroups);
          releaseSpritesExcept(nextFloorKeys);
          // The same keep set on the same beat, so the painted sheets and the
          // defs pointing at them can never disagree about what is still live.
          // Anything seeded goes regardless: the next floor draws its own art
          // seed, including for a key the two floors share.
          releaseEnvironmentArt(nextFloorKeys);
          // The painted creatures give their memory back on the same beat and
          // for the same reason: whatever the next floor still shows is
          // repainted lazily, and nothing else is carried down the stairs.
          flushFigureFrameCache();
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
              // Party progress, not floor state: an axe bought on this floor is
              // still the axe in hand on the next one.
              partyCrafts: this.partyCrafts,
              saveProgress: this.onSaveProgress,
              audio: this.audio ?? undefined,
              onResetGame: this.onResetGameCallback ?? undefined,
              godModeState: this.godModeState,
              companionStance: this.companionStance,
              // Unlike the journal or the club, this is run-scoped: a trait
              // announced once stays announced for every floor of the run.
              tacticsNoticesSeen: this.tacticsNoticesSeen,
              // Run-scoped for the same reason: the run-complete screen sums up
              // every floor, not the last one.
              gameStats: this.gameStats,
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
      (player, rangePx) => hostileWithinRadius(player, this.world.roster.grid, rangePx),
      (tile) => this.warpPartyForRecall(tile),
      (message) => this.menus.hotbarToast.show(message),
      this.audio,
    );
    // Only meaningful on the same map instance the anchor tile was recorded
    // against — a building-exit rebuild, never a floor change or a death.
    if (options?.existingMap !== undefined && options.existingRecallState !== undefined) {
      this.recall.restoreFromSceneRebuild(options.existingRecallState);
    }
    if (options?.existingMap !== undefined && options.existingGroundPickups !== undefined) {
      this.destruction.groundPickups.restoreCheckpoint(options.existingGroundPickups);
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
          // Read before the dismiss that clears it. The dismiss still has to
          // happen: this scene's roster is thrown away with it, and the dismiss
          // is what writes his remaining health into the pet state the interior
          // rebuilds him from.
          const companionArrival: InteriorCompanionArrival = {
            mongoUnlocked: this.mongoSystem.unlocked,
            mongoWasOut: this.mongoSystem.followsThroughDoor,
          };
          this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          // A standing hire's health goes into the roster the interior stands it
          // up from; a hire lying downed at the door is lost with this scene.
          this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
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
              levelDef.xpDiminishingTiers,
              this.input,
              this.sceneManager,
              (hSnap, cSnap, defeated, companionDeparture) => {
                // A defeat indoors is a death like any other, so it lands on the
                // last save rather than on the doorstep the party died behind.
                const lastSave = this.lastSave;
                if (defeated) rearmExpiredDoomsday(this.doomsdayQuestProgress, Date.now());
                if (defeated && lastSave !== null) {
                  this.respawnFromSave(lastSave.progress);
                  return;
                }
                // Unreachable once the floor has taken its arrival save, which
                // the overworld does on its first frame; the start tile at least
                // keeps a defeat off the doorstep.
                const exitTile = defeated ? this.gameMap.startTile : returnTile;
                this.sceneManager.replace(
                  new DungeonScene(levelDef, this.input, this.sceneManager, {
                    spawnAt: exitTile,
                    humanSnap: hSnap,
                    catSnap: cSnap,
                    knockedOutCompanionAt: downedCompanionAt,
                    // Entering a building is a detour, not a new floor — the floor
                    // restart has to stay pinned to where this floor began.
                    floorEntryHumanSnap: this.floorEntryHumanSnap,
                    floorEntryCatSnap: this.floorEntryCatSnap,
                    floorEntryHumanAchievements: this.floorEntryHumanAchievements,
                    floorEntryCatAchievements: this.floorEntryCatAchievements,
                    floorEntryAbilityManager: this.floorEntryAbilityManager,
                    floorEntryGameStats: this.floorEntryGameStats,
                    floorEntryMercenaryRoster: this.floorEntryMercenaryRoster,
                    // The save, not its checkpoint: the rebuilt scene regenerates the
                    // overworld's creatures, so mob flags captured against this
                    // scene would mean nothing there. An exit inside the town wall
                    // saves afresh on its first frame whenever a town save is
                    // allowed; until then — and for good after an exit outside the
                    // wall, such as the Big Top's — a death respawns from this save.
                    lastSave: this.lastSave?.progress,
                    existingMap: this.gameMap,
                    existingMiniMap: this.miniMap,
                    existingRecallState: this.recall.captureForSceneRebuild(),
                    existingGroundPickups: this.destruction.groundPickups.captureCheckpoint(),
                    humanAchievements: this.humanAchievements,
                    catAchievements: this.catAchievements,
                    mongoUnlocked: this.mongoSystem.unlocked,
                    mongoPetState: this.mongoPetState,
                    mongoWasOut: companionDeparture.mongoWasOut,
                    abilityManager: this._cleanAbilityManager(),
                    partyCrafts: this.partyCrafts,
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
                    briarHollowState: this.briarHollowState,
                    marketStock: this.marketStock,
                    mercenaryRoster: this.mercenaryRoster,
                    godModeState: this.godModeState,
                    companionStance: this.companionStance,
                    gameStats: this.gameStats,
                    tacticsNoticesSeen: this.tacticsNoticesSeen,
                    skipIntro: true,
                  }),
                );
              },
              this.marketStock,
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
              this.gameMap.artSeed,
              this.tacticsNoticesSeen,
              respawnModeFor(respawnRouteFor(this.lastSave)),
              companionArrival,
              this.partyCrafts,
              this.briarHollowState,
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
        (coins, worldX, worldY) => {
          const cam = this.camera();
          this.rewardFly.enqueueCoins(coins, worldX - cam.x, worldY - cam.y);
        },
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
      this.gathering = new GatheringKit({
        gameMap: this.gameMap,
        bus: this.bus,
        audio: this.audio,
        human: this.human,
        cat: this.cat,
        tools: this.partyCrafts.tools,
        partyTools: this.partyTools,
        nodes: this.briarHollowState.nodes,
        trees: this.trees,
        onTileChanged: (tileX, tileY) => this.miniMap.markTileChanged(tileX, tileY),
        announce: (message) => this.menus.announce(message),
        bagOwner: () => this.menus.inventoryPlayer(),
        inResourceZone: anyResourceZone(
          inGatheringDistrict(this.gameMap),
          nearPalisade(this.gameMap),
        ),
        otherBodies: () => [
          ...(this.briarHollowKit?.villagers?.villagers ?? []),
          ...this.world.roster.mobs.filter((mob) => mob.isAlive),
        ],
        isAutoSummonEnabled: (crawler) => this.partyCrafts.autoSummonThralls[crawler],
        setAutoSummonEnabled: (crawler, enabled) => {
          this.partyCrafts.autoSummonThralls[crawler] = enabled;
        },
      });
      const gathering = this.gathering;
      this.companion.registerHarvestSource(gathering);
      this.menus.inventoryPanel.interaction.extraContextOptions = (item) =>
        gathering.contextOptionsFor(item);
      this.briarHollowKit =
        this.gameMap.briarHollow !== null
          ? new BriarHollowKit(this.world, {
              human: this.human,
              cat: this.cat,
              partyTools: this.partyTools,
              partyCrafts: this.partyCrafts,
              state: this.briarHollowState,
              menus: this.menus,
              audio: this.audio,
              keybindings,
              groundPickups: this.destruction.groundPickups,
              dynamite: this.destruction.dynamite,
              noteResourceActivity: () => gathering.hud.noteActivity(),
              onTileChanged: (tileX, tileY) => this.miniMap.markTileChanged(tileX, tileY),
              worldHalted: () => this.gameplayHalted,
              isInSafeRoom: (point) => this.safeRoom.isEntityInSafeRoom(point),
              music: () => this.overworldMusic,
              bossIntro: (name, color) => {
                this.bossIntro.trigger(NECROMANCER_BOSS_TYPE, name, color);
              },
              dropItems: (x, y, items) =>
                this.destruction.loot.addLoot(
                  x,
                  y,
                  { coins: 0, items: [...items] },
                  this.active(),
                  true,
                ),
              onCoinsGranted: (coins, worldX, worldY) => {
                const cam = this.camera();
                this.rewardFly.enqueueCoins(coins, worldX - cam.x, worldY - cam.y);
              },
              onItemGranted: (id, quantity, worldX, worldY) => {
                const cam = this.camera();
                for (let i = 0; i < quantity; i++) {
                  this.rewardFly.enqueueItem(id, ITEM_DEF[id].name, worldX - cam.x, worldY - cam.y);
                }
              },
              assaultLevel: () =>
                resolveVillageAssaultLevel(
                  levelDef,
                  partyLevelOf(this.human.level, this.cat.level),
                  activeDifficultyProfile(),
                ),
            })
          : null;
      // Regrowth must never stand a rock or a tree back up under a trebuchet or a snare.
      gathering.setStructureClaims(this.briarHollowKit?.defences?.defense ?? null);
      // So an ordinary hostile (not just the assault's own wave) can notice
      // and attack a live trebuchet the way it notices a crawler.
      this.combat.mobLoop.setTrebuchetDefense(this.briarHollowKit?.defences?.defense ?? null);
      if (this.briarHollowKit !== null) {
        options?.prepareBriarHollow?.(this.briarHollowKit, this.gameMap);
      }
    }

    this.achievementUI = new AchievementUISystem(
      this.humanAchievements,
      this.catAchievements,
      this.human,
      this.cat,
      this.rewardFly,
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
      () => mongoXpFraction(this.abilityManager),
      (message) => this.menus.hotbarToast.show(message),
    );
    if (options?.mongoUnlocked) {
      this.mongoSystem.unlocked = true;
    }
    this.mongoCarryPending = options?.mongoWasOut === true;
    this.floorEntryAbilityManager =
      options?.floorEntryAbilityManager ?? this.abilityManager.clone();
    bindAbilityLevelUps({
      abilityManager: this.abilityManager,
      menus: this.menus,
      audio: this.audio,
      onPetLevelUp: () => this.mongoSystem.onPetLevelUp(),
      onTalismanLevel: () => this.unlockFirstHundred(),
    });
    bindCraftLevelUps({ bus: this.bus, menus: this.menus, audio: this.audio });
    this.cat.setAbilityManager(this.abilityManager);
    this.human.setAbilityManager(this.abilityManager);

    // Re-apply cheat overlays carried in from the previous scene. God mode is an
    // overlay on top of base stats and so is never present in a snapshot — an
    // active cheat has to be rebuilt here rather than surviving in the stats.
    this.chat.applyCarriedCheat();

    this.onSaveProgress = options?.saveProgress;
    const carriedSave = options?.lastSave;
    if (carriedSave !== undefined) {
      this.lastSave = { progress: carriedSave, checkpoint: null };
      // A safe-room save with no room under either crawler names no tile of its
      // own, so it keeps the resume tile the carried save already had. Parsed,
      // not read raw: a save from before a generator change names a tile on a
      // map that no longer exists, and re-saving it would stamp that tile as
      // belonging to the new one.
      this.lastSavePointTile = parseSavedWorld(carriedSave.world)?.safeRoomTile ?? null;
    }
    // The tutorial is left out because its scripted flow saves at its own safe
    // rooms, and a save of a tutorial just begun would resume without the script.
    // A carried save this floor could not be rebuilt from — see
    // `carriedSaveRegeneratesFloor` — is replaced by the arrival save, so a
    // death returns to this floor rather than drawing another.
    this.staleCarriedSave = carriedSaveRegeneratesFloor(carriedSave) ? (carriedSave ?? null) : null;
    this.arrivalSavePending = owesArrivalSave(
      carriedSave,
      options?.suppressArrivalSave === true,
      this.tutorial !== null,
    );
    this.wasInTown = options?.suppressArrivalSave === true;
    this.wasInBriarHollowSquare = options?.suppressArrivalSave === true;
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
    if (this.audio !== null) {
      const signDialog = new CitizenDialog(this.audio, 'word', SIGN_REVEAL_INTERVAL_MS);
      const signs = new CrawlerSignSystem(
        CrawlerSignSystem.placementsFromMap(this.gameMap),
        (sign) => {
          this.signDialogTarget = sign;
          signDialog.open(CRAWLER_SIGN_SPEAKER, signPages(sign.direction));
        },
      );
      if (!signs.isEmpty) {
        this.signDialog = signDialog;
        this.crawlerSigns = signs;
      }
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
    this.circusQuest.onItemGranted = (id, quantity, worldX, worldY) => {
      const cam = this.camera();
      for (let i = 0; i < quantity; i++) {
        this.rewardFly.enqueueItem(id, ITEM_DEF[id].name, worldX - cam.x, worldY - cam.y);
      }
    };
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
    this.anchorQuest.onItemGranted = (id, quantity, worldX, worldY) => {
      const cam = this.camera();
      for (let i = 0; i < quantity; i++) {
        this.rewardFly.enqueueItem(id, ITEM_DEF[id].name, worldX - cam.x, worldY - cam.y);
      }
    };
    this.doomsdayEscape = new DoomsdayEscapeSystem(
      this.gameMap,
      this.doomsdayQuestProgress,
      (message) => this.menus.hotbarToast.show(message),
      () => (this.human.isKnockedOut || this.cat.isKnockedOut ? STAIRWELL_KNOCKED_OUT_TOAST : null),
    );
    // Y-sorted with the town's fixtures, so the tower above it can never paint over it.
    if (this.townPropRenderables !== null) {
      this.townPropRenderables = [...this.townPropRenderables, this.doomsdayEscape.stairwellProp];
    }
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
      // The loot is his on the press, so nothing that befalls him while he
      // heaves the lid can lose it; only the showing waits for the lid.
      const reward = this.grantChestContents(chest);
      const chestCentre = {
        x: chest.tileX * TILE_SIZE + TILE_SIZE / 2,
        y: chest.tileY * TILE_SIZE + TILE_SIZE / 2,
      };
      openChestWithGesture(this.active(), chestCentre, (outcome) => {
        if (outcome === 'shown') this.showChestReward(chest, reward);
        else reward.onDismissed?.();
      });
    });

    this.treasureChests.setOnLockedAttempt(() => {
      this.audio?.play('chest_locked');
    });
    this.treasureChests.setOnWoodenChestUnlocked(() => {
      this.audio?.play('chest_unlocked_in_treasure_room');
    });

    if (options?.persistedWorldState !== undefined) {
      this.applyPersistedWorldState(options.persistedWorldState);
    }

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
    if (this.levelDef.id === FIRST_DUNGEON_LEVEL_ID) {
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
    awardFirstHundred(this.catAchievements, this.bus);
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

  /** Fires once, the first time the Wayfinder fail-safe sheds a mote. */
  private static readonly WAYFINDER_ANNOUNCEMENT =
    'Your whiskers catch a draft… something below is breathing.';

  private wireEventBus(): void {
    const bus = this.bus;

    bus.on('spawnGore', (e) => {
      this.combat.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });

    // ── stats tracking ──
    bus.on('mobKilled', (e) => this.gameStats.recordMobKilled(e));
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

    bus.on('crawlerKnockedOut', (e) => {
      e.player.applyCockroachKnockoutRelief();
      if (e.player === this.cat && this.human.isAlive && !this.human.isKnockedOut) {
        this.crawlerBarks.say(this.human, [DONUT_KNOCKOUT_BARK]);
      }
    });

    // ── mobKilled: corpse marker, achievements, loot, grub spawns ──
    bus.on('mobKilled', (e) => {
      const { mob, killer, topDamageDealer } = e;
      const cx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const cy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET;

      // Only a kill the party earned. Mobs kill each other — friendly fire, a
      // confusion fog, a bounty boss clearing the room it spawned into — and
      // none of that is the player pressing forward. Nor is a death that is no
      // kill at all (a cow caught in a blast): it earns nothing below but its
      // gore and its corpse marker.
      const creditedKiller = mob.countsAsKill ? killer : null;
      if (creditedKiller !== null) this.mongoSystem.onKill();

      this.combat.spawnKillGore(mob, killer);
      this.miniMap.addCorpseMarker(cx, cy);
      noteCampCasualty(this.townMemory, mob, this.world.roster.mobs);

      this.attemptStairwellSave(
        this.gameMap.roomIndexAt(Math.floor(cx / TILE_SIZE), Math.floor(cy / TILE_SIZE)),
      );

      if (creditedKiller === this.human && this.humanAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Human' });
        if (this.tutorial !== null) {
          this.humanAchievements.grantBox('Gold', 'Tutorial', 'first_blood');
        }
      }
      if (creditedKiller === this.cat && this.catAchievements.tryUnlock('first_blood')) {
        bus.emit('achievementUnlocked', { achievementId: 'first_blood', player: 'Cat' });
        if (this.tutorial !== null) {
          this.cat.inventory.addItem('health_potion', FIRST_BLOOD_POTION_REWARD);
        }
      }

      if (
        this.tutorial === null &&
        creditedKiller === this.human &&
        (mob.killType === 'melee' || mob.killType === 'smush')
      ) {
        if (this.humanAchievements.tryUnlock('smush')) {
          bus.emit('achievementUnlocked', { achievementId: 'smush', player: 'Human' });
        }
      }

      if (this.tutorial === null && creditedKiller === this.cat && mob.killType === 'missile') {
        if (this.catAchievements.tryUnlock('magic_touch')) {
          bus.emit('achievementUnlocked', { achievementId: 'magic_touch', player: 'Cat' });
        }
      }

      // The archer is a goblin to the player even though it descends from `Mob`
      // rather than from `Goblin`, so it is named alongside it.
      if (
        this.tutorial === null &&
        creditedKiller === this.human &&
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
          // Tested rather than assumed: calling `receiveBossLoot` is no proof a
          // chest took the drop, and a drop nothing took must still land
          // somewhere. Still partitioned by owner even down this path — The
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
          // A boss's own staged add (a guard tentacle, a roach, a tuskling) is not
          // a kill the party earned against the floor's population.
          if (mob.isBossAdd) continue;
          if (!mob.seedsOnKillSpawns) continue;
          // A body an enemy conjured is not a kill the party earned, so it
          // does not seed a swarm either — a necro fairy's skeletons would
          // otherwise turn every raise into free grubs.
          if (mob.paysNoRewards) continue;
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
              spawned.applyMobLevel(mob.mobLevel, mob.levelledCurve);
              applySpawnDifficulty(spawned);
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

    // Human-only by construction: only the human can light a stick.
    bus.on('dynamiteKills', (e) => {
      if (this.tutorial !== null) return;
      if (
        e.kills >= LITTLE_BOOM_KILL_THRESHOLD &&
        this.humanAchievements.tryUnlock('little_boom')
      ) {
        bus.emit('achievementUnlocked', { achievementId: 'little_boom', player: 'Human' });
      }
      if (e.bossKilled && this.humanAchievements.tryUnlock('finish_with_a_blow')) {
        bus.emit('achievementUnlocked', { achievementId: 'finish_with_a_blow', player: 'Human' });
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
      // Reachable mid-fight: the event fires for either crawler, and one left
      // outside a locked boss room can still walk into a safe room. Both the
      // saved game and the death checkpoint are skipped, so neither one can
      // resume a fight that is still in progress.
      if (this.isBossFightInProgress) return;
      // Nor while anyone is down: a reload would stand them up for free.
      if (this.isRevivePending) return;
      // The event fires from `pm.isAnySafe()`, which is true when either crawler
      // is protected, so the active one may still be outside the room; the save
      // point is then the room the companion reached.
      const enteredRoom =
        this.safeRoom.safeRoomInfoAt(this.active()) ??
        this.safeRoom.safeRoomInfoAt(this.inactive());
      if (enteredRoom === null) {
        // With no room to name, the resume tile stays as it was and the save
        // carries no checkpoint, so a death rebuilds from this save.
        this.saveProgress(null);
        return;
      }
      this.captureSavePoint(enteredRoom.centre);
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
      // A player pin keeps the arrow as long as what it names is still
      // outstanding — only a pin left dangling on something finished gets
      // taken over automatically, the same as if nothing had been pinned.
      if (this.journalProgress.pinSource === 'player') {
        const stillActive =
          resolvePinnedEntry(this.journalProgress.pinnedTrackerId, this._trackerEntries) !== null;
        if (stillActive) return;
      }
      this.journalProgress.pinnedTrackerId = e.questId;
      this.journalProgress.pinSource = 'auto';
    });

    bus.on('questCompleted', (e) => {
      if (e.questId === 'defend_goblin_mother') {
        const def = this.defendQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().earnCoins(def.rewards.coins);
          this.flyQuestCoins(def.rewards.coins);
        }
        this.humanAchievements.grantBox('Silver', 'Adventurer', 'quest_defend_npc');
        this.human.inventory.clearQuestSlot();
        this.cat.inventory.clearQuestSlot();
      }
      if (e.questId === 'grotesque_spider') {
        const humanXpApplied = awardXp(this.human, SPIDER_QUEST_COMPLETION_XP, this.bus);
        const catXpApplied = awardXp(this.cat, SPIDER_QUEST_COMPLETION_XP, this.bus);
        this.spiderQuest.setAwardedXp(humanXpApplied, catXpApplied);
        // Straight to the cat: the lab's dark is what the book is about, and she
        // is the only crawler who can read it.
        this.cat.inventory.addItem('skill_book_night_vision', 1);
        this.flyQuestItem('skill_book_night_vision');
      }
      if (e.questId === 'the_show_must_go_on') {
        const def = this.circusQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().earnCoins(def.rewards.coins);
          this.flyQuestCoins(def.rewards.coins);
        }
      }
      if (e.questId === MURDER_QUEST_ID) {
        const def = this.murderQuest.questManager.getDef(e.questId);
        if (def?.rewards.coins) {
          this.active().earnCoins(def.rewards.coins);
          this.flyQuestCoins(def.rewards.coins);
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
    bindRunStats(this.gameStats);
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
        // The tutorial floor ducks the music bus to TUTORIAL_MUSIC_VOLUME via the
        // non-remembered setMusicVolume(); nothing else undoes that duck, so every
        // later level must restore the player's actual preference before playing.
        this.audio?.setMusicVolume(settings.musicVolume);
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
      if (this.grateSpikes.handleKeyDown(e.key, e.repeat)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // A villager's numbered choices, stopped for the same reason as the Bopca's.
      if (this.briarHollowKit?.handleKeyDown(e.key, e.repeat) === true) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // The bag's Drop/Trade quantity prompt: digits edit the amount directly,
      // so they must never also reach the hotbar or the movement keys.
      if (this.menus.itemQuantityPicker.handleKey(e.key)) {
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
      // The two end-of-floor screens count as over for Escape: each owns the
      // screen until its own button is pressed, and a pause menu opened behind
      // one would take the keyboard from it.
      isGameOver: () =>
        this.gameOver || this.levelCompleteScreen.isActive || this.runCompleteScreen.isActive,
      dismissChestDialog: () => this.chestRewardDialog.handleKeyDown(),
      dismissDialog: () => {
        if (this.menus.mongoExplainer.isOpen && !this.menus.isAwardStackShowing) {
          this.menus.mongoExplainer.close();
          return true;
        }
        if (this.menus.craftExplainers.isOpen && !this.menus.isAwardStackShowing) {
          this.menus.craftExplainers.close();
          return true;
        }
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
        if (this.grateSpikes.close()) return true;
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
        if (!this.gameplayHalted && this.briarHollowKit?.dismissDialog() === true) return true;
        if (this.signDialog?.isOpen === true && !this.gameplayHalted) {
          this.signDialog.close();
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
      onConstruction: () => this.briarHollowKit?.openConstruction(),
      onStructureMenu: () => {
        if (this.briarHollowKit?.tryStructureMenu() === true) return;
        this.grateSpikes.tryOpen();
      },
      onQuickLoad: () => this.briarHollowKit?.repairOrLoad(),
    });
  }

  onExit(): void {
    // Every floor is a fresh `DungeonScene`, which would already start this
    // fresh too — reset defensively anyway, so a hold left outstanding by a
    // dialog that never got its close callback can never surface as a
    // permanently-low coin counter on whatever replaces this scene.
    this.rewardFly.reset();
    this.humanTalk.stop(this.human);
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
    this.briarHollowKit?.dispose();
    this.gathering?.dispose();
    this.fairies.dispose();
    this.fairyFireballs.dispose();
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
    const village: AmbientEmitter = {
      soundId: 'ambient_village',
      x: 0,
      y: 0,
      radiusTiles: 0,
      maxVolume: 0,
      constant: true,
    };
    this.villageAmbientEmitter = village;
    emitters.push(village);
    const villageSite = this.gameMap.briarHollow;
    if (villageSite !== null) {
      const workshopBeds: ReadonlyArray<{ id: VillageBuildingId; soundId: SoundId }> = [
        { id: 'forge', soundId: 'ambient_forge' },
        { id: 'cookhouse', soundId: 'ambient_cookhouse' },
      ];
      for (const bed of workshopBeds) {
        const building = villageSite.buildings.find((candidate) => candidate.id === bed.id);
        if (building === undefined) continue;
        const centre = rectCentre(building.interior);
        emitters.push({
          soundId: bed.soundId,
          x: centre.x,
          y: centre.y,
          radiusTiles: VILLAGE_WORKSHOP_AMBIENT_RADIUS_TILES,
          maxVolume: VILLAGE_WORKSHOP_AMBIENT_VOLUME,
        });
      }
    }
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

  /** The active crawler's own tile, for ranking a pinned header's sub-steps by distance. */
  private get activeTile(): { x: number; y: number } {
    const active = this.active();
    return { x: Math.floor(active.x / TILE_SIZE), y: Math.floor(active.y / TILE_SIZE) };
  }

  /** The Journal entry the pin resolves to right now, or null when nothing is pinned. */
  private get pinnedObjectiveEntry(): TrackerEntry | null {
    return resolvePinnedEntry(
      this.journalProgress.pinnedTrackerId,
      this._trackerEntries,
      this.activeTile,
    );
  }

  /** The tile the pinned Journal entry points at, or null when nothing is pinned. */
  private get pinnedObjectiveTile(): TrackerTarget | null {
    return this.pinnedObjectiveEntry?.target ?? null;
  }

  /**
   * Whether Shady's own guidance arrow should draw this frame.
   *
   * An explicit pin — quest or bounty — always wins: if it names the bounty,
   * the bounty draws its own arrow (colour keyed to hunt-vs-collect); if it
   * names anything else, the bounty stays off the screen entirely rather than
   * stacking a second arrow under the pinned one. With nothing pinned, the
   * bounty only shows once every other quest is done — starting a quest while
   * a bounty is active takes the arrow, and accepting a bounty while a quest
   * is active does nothing visible.
   */
  private shouldShowBountyArrow(): boolean {
    const pinned = this.pinnedObjectiveEntry;
    if (pinned !== null) return pinMatchesEntry(BOUNTY_TRACKER_ID, pinned);
    return !this._trackerEntries.some(
      (entry) => entry.status === 'active' && !pinMatchesEntry(BOUNTY_TRACKER_ID, entry),
    );
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
    if (target === null || target.wearsOwnMarker === true) return;
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
      if (target.wearsOwnMarker === true) continue;
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
    const pinned = this.pinnedObjectiveEntry;
    // A pin on the bounty is drawn by the bounty's own arrow, which knows
    // whether it is a hunt or a collect and colours itself accordingly — this
    // generic arrow would otherwise stack a second one under it.
    if (pinned !== null && pinMatchesEntry(BOUNTY_TRACKER_ID, pinned)) return;
    const target = pinned?.target ?? null;
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
   * `!fairy <kind> [count]` — puts fairies beside the active crawler at the
   * party's ambient level for this floor, through the same roster path and
   * levelling order as any spawn.
   */
  private runFairyCheat(argument: string): string | null {
    const [kindArgument = '', countArgument = ''] = argument.split(/\s+/);
    const kind = FAIRY_KINDS.find((candidate) => candidate === kindArgument);
    if (kind === undefined) {
      this.audio?.play('error');
      return `❓ FAIRY KINDS: ${FAIRY_KINDS.join(', ')}`;
    }
    const requested = Number.parseInt(countArgument, 10);
    const count = Number.isNaN(requested)
      ? 1
      : Math.min(Math.max(1, requested), FAIRY_CHEAT_MAX_COUNT);
    const active = this.active();
    const originX = Math.floor((active.x + TILE_SIZE / 2) / TILE_SIZE);
    const originY = Math.floor((active.y + TILE_SIZE / 2) / TILE_SIZE);
    const profile = activeDifficultyProfile();
    const partyLevel = partyLevelOf(this.human.level, this.cat.level);
    const floorRules =
      this.levelDef.roomMobs.length > 0 ? this.levelDef.roomMobs : this.levelDef.hallwayMobs;
    const band: MobLevelRange = floorRules.length > 0 ? pickRule(floorRules) : {};
    let spawned = 0;
    for (let attempt = 0; attempt < FAIRY_CHEAT_ATTEMPTS && spawned < count; attempt++) {
      const tileX = originX + randomInt(-FAIRY_CHEAT_SPREAD_TILES, FAIRY_CHEAT_SPREAD_TILES);
      const tileY = originY + randomInt(-FAIRY_CHEAT_SPREAD_TILES, FAIRY_CHEAT_SPREAD_TILES);
      if (!this.gameMap.isWalkable(tileX, tileY)) continue;
      const mob = createMob(FAIRY_SPAWN_KEYS[kind], tileX, tileY, this.gameMap);
      if (!(mob instanceof Fairy)) continue;
      this.world.roster.add(mob);
      mob.setHostFloor(this.levelDef.floorNumber);
      mob.applyMobLevel(
        resolveAmbientLevel(band, this.levelDef, partyLevel, profile),
        this.levelDef.levelledCurve,
      );
      applySpawnDifficulty(mob, profile);
      mob.stampPotency(settings.difficulty);
      spawned++;
    }
    return spawned > 0 ? `🧚 ${spawned}× ${kind.toUpperCase()} FAIRY` : null;
  }

  /**
   * The cheats only this floor can answer. The universal four (`!god`,
   * `!tough`, `!payday`, `!levelup`) live in `ChatKit`; these reach systems that
   * exist nowhere else, so a scene without them simply does not offer them.
   */
  private dungeonChatCommands(): ReadonlyArray<ChatCommand> {
    return [
      {
        name: '!fairy',
        run: (argument) => this.runFairyCheat(argument),
      },
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
        // Just inside Briar Hollow's gate, so the village can be playtested
        // without the walk out from town.
        name: '!village',
        run: () => {
          const gate = this.gameMap.briarHollow?.gate.inside;
          if (gate === undefined) {
            this.audio?.play('error');
            return null;
          }
          this.placePartyAtTile(gate);
          return '🏘 WARPED TO BRIAR HOLLOW';
        },
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

    // Mongo cannot follow a warp — he goes home and waits to be resummoned.
    // The hire's contract still stands in this same scene, so it respawns
    // beside the party on the next update; dismissing it first is what keeps
    // `mobs` and `mobGrid` in step through the jump rather than leaving it
    // standing where the party no longer is.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
    this.placePartyAtTile(landing);
    return true;
  }

  /**
   * Sets both crawlers down on a landing tile: the human on it, the companion on
   * the nearest tile beside it that will hold them.
   *
   * Shared by the bounty cheat, the recall stone and the checkpoint respawn, so
   * none of them can drift apart on where a party ends up.
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

  private triggerBuildAction(): boolean {
    const active = this.active();
    if (!active.canAct) return false;
    return this.defendQuest.tryBuildBarrier(active);
  }

  /**
   * The Summon button and the R key are one toggle: out of play he is summoned,
   * in play he is called back — and he runs home rather than vanishing, so
   * recalling him mid-fight is a real decision rather than a free undo.
   */
  private toggleMongoSummon(): void {
    if (!this.cat.isActive || !this.active().canAct) return;
    if (this.mongoSystem.mongo) {
      this.mongoSystem.toggleRecall();
      return;
    }
    this.summonMongo();
  }

  /**
   * Whether either crawler stands in a boss room whose fight is unfinished.
   *
   * Three owners, because the Ball of Swine arena and the spider lab are run by
   * their own systems rather than `BossRoomSystem`. Either crawler counts:
   * either one walking in is what starts and holds a boss fight.
   */
  private isPartyInUnresolvedBossRoom(ctx: SystemContext): boolean {
    const { mobs } = ctx.roster;
    return [ctx.human, ctx.cat].some(
      (crawler) =>
        this.bossRoom.isEntityInUnresolvedBossRoom(crawler, mobs) ||
        this.arena.isEntityInUnresolvedArena(crawler, mobs) ||
        this.spiderQuest.isEntityInUnresolvedLab(crawler, mobs),
    );
  }

  private carryMongoIn(): void {
    if (!this.mongoCarryPending) return;
    this.mongoCarryPending = false;
    const mongo = this.mongoSystem.carryIn(this.cat, this.gameMap);
    if (mongo !== null) this.world.roster.add(mongo);
  }

  /**
   * `Player.noteWardBlockedHit` has no scene to bark through, so it raises a
   * pending flag instead; this is the one place both crawlers' flags are
   * drained into the actual bark.
   */
  private drainWardExplainerBarks(): void {
    if (this.human.pendingWardExplainerBark) {
      this.human.pendingWardExplainerBark = false;
      this.crawlerBarks.say(this.human, WARD_EXPLAINER_BARK_LINES);
    }
    if (this.cat.pendingWardExplainerBark) {
      this.cat.pendingWardExplainerBark = false;
      this.crawlerBarks.say(this.cat, WARD_EXPLAINER_BARK_LINES);
    }
  }

  /** Returns whether he came out; a refusal has already been spoken by the cat. */
  private summonMongo(): boolean {
    const mongo = this.mongoSystem.summon(this.cat, this.gameMap);
    if (mongo === null) return false;
    this.world.roster.add(mongo);
    this.abilityManager.addUsageXp('mongo');
    this.audio?.play('mongo_released');
    return true;
  }

  /**
   * The companion cat sends Mongo in on her own when a fight reaches her.
   *
   * Only while the human is being driven: with the cat in hand the player has
   * the Summon button, and a pet that deployed himself would take the decision
   * away from them. A passive stance is an order to stay out of fights, and
   * sending the pet in would break it by proxy.
   */
  private autoSummonMongo(ctx: SystemContext): void {
    if (!settings.catAutoSummonsMongo) return;
    if (!this.human.isActive || this.mongoSystem.mongo !== null) return;
    if (this.companion.getCombatStance(true) === 'passive') return;
    // A rest stop is not a staging ground: a hostile in sight through the door
    // would otherwise have him deployed from inside the sanctuary.
    if (this.pm.isAnySafe(this.safeRoom)) return;
    if (!this.mongoSystem.catWantsToSummon(ctx)) return;
    if (!this.summonMongo()) this.mongoSystem.onAutoSummonRefused();
  }

  /**
   * Routes a death-screen exit to the last save: rewound in place when this
   * scene took it, rebuilt from it when the scene was built after it, and the
   * floor restart only when the run has never saved.
   */
  private respawnAfterDeath(): void {
    // Before the branch, so it runs on every route: a checkpoint restore keeps
    // the world (and so would keep the mark standing where the party fell) while
    // the other two throw it away, and the durable record would have survived
    // any of them.
    this.bounty?.abandonBounty(this.world.roster.mobs, this.world.roster.grid);
    rearmExpiredDoomsday(this.doomsdayQuestProgress, Date.now());

    const route = respawnRouteFor(this.lastSave);
    switch (route.kind) {
      case 'checkpoint':
        this.restoreFromCheckpoint(route.checkpoint);
        break;
      case 'resumeSave':
        this.respawnFromSave(route.progress);
        break;
      case 'floorRestart':
        this.restartAtFloorEntry();
        break;
    }
  }

  /**
   * Stops every hazard/attack one-shot in {@link HAZARD_SOUNDS_TO_STOP_ON_RESPAWN}
   * that might still be sounding. Call anywhere the party is put back at a save
   * or floor entry — the world a death interrupted is going away or being
   * rewound, and nothing else will ever stop a source that outlives it.
   */
  private stopHazardSoundsForRespawn(): void {
    for (const id of HAZARD_SOUNDS_TO_STOP_ON_RESPAWN) this.audio?.stopSound(id);
  }

  /**
   * Rebuilds the floor from a save, exactly as a page reload would, for a scene
   * that holds the save but not a checkpoint of it: one rebuilt around a
   * regenerated population after a building exit, one that was itself resumed
   * from the save, or one whose last write had no room to stand the party in.
   *
   * Carries over only what the save does not hold and a reload would not want
   * lost. The doomsday countdown is preserved for the same reason
   * {@link restoreFromCheckpoint} preserves it: rewinding it would make dying a
   * way to buy back time. The run's tallies rewind to the save's copy, but keep
   * the deaths and time played of the run in progress; a save with no copy
   * keeps the live tallies as they stand. Achievements
   * are carried the same way only for a save written before they were
   * persisted; otherwise the save's copy replaces them.
   */
  private respawnFromSave(progress: GameProgressInput): void {
    // His HP only reaches the shared state through a despawn, and the instance
    // holding it is about to be discarded.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.audio?.stopSound('death_sequence');
    this.stopHazardSoundsForRespawn();
    const sameFloor = progress.levelId === this.levelDef.id;
    const { levelDef, options } = sceneSetupFromSave(
      {
        audio: this.audio ?? undefined,
        saveProgress: this.onSaveProgress,
        onResetGame: this.onResetGameCallback ?? undefined,
        humanAchievements: this.humanAchievements,
        catAchievements: this.catAchievements,
        // A respawn is not a new floor, so a later floor restart still rewinds
        // to where this one began.
        floorEntryHumanSnap: sameFloor ? this.floorEntryHumanSnap : undefined,
        floorEntryCatSnap: sameFloor ? this.floorEntryCatSnap : undefined,
        floorEntryHumanAchievements: sameFloor ? this.floorEntryHumanAchievements : undefined,
        floorEntryCatAchievements: sameFloor ? this.floorEntryCatAchievements : undefined,
        floorEntryAbilityManager: sameFloor ? this.floorEntryAbilityManager : undefined,
        floorEntryGameStats: sameFloor ? this.floorEntryGameStats : undefined,
        floorEntryMercenaryRoster: sameFloor ? this.floorEntryMercenaryRoster : undefined,
        doomsdayQuestProgress: this.doomsdayQuestProgress,
        godModeState: this.godModeState,
        companionStance: this.companionStance,
        gameStats: this.gameStats,
        skipIntro: true,
      },
      progress,
    );
    this.sceneManager.replace(new DungeonScene(levelDef, this.input, this.sceneManager, options));
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
    this.stopHazardSoundsForRespawn();
    this.combat.deathScreen.reset();
    this.gameOver = false;
    // Its pending callback grants a chest's reward against a world that is
    // about to be rewound to before the chest was opened. Cancelling by this
    // hold's own handle drops only its own queued grants, leaving any other
    // hold outstanding at the same time (an achievement reveal, say) untouched.
    if (this.chestRewardFlyHold !== null) {
      this.rewardFly.cancel(this.chestRewardFlyHold);
      this.chestRewardFlyHold = null;
    }
    this.chestRewardDialog.discard();
    // The same for granted-reward cards and whatever waits on them (the
    // Resourcing explainer after Oren's tools): the rewind takes the grant back.
    this.menus.rewardGrantedDialog.discard();

    restorePlayer(this.human, cp.humanSnap);
    restorePlayer(this.cat, cp.catSnap);
    this.abilityManager.restoreStates(cp.abilities.snapshotStates());
    restorePartyCraftsState(this.partyCrafts, cp.crafts);
    // The restored tool tier may not match what each inventory now holds, so
    // self-heal the same way scene entry does.
    this.partyTools.reconcile(this.human, this.cat);
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

    // Placed rather than offset by a fixed tile: a town save point is wherever
    // the party crossed the wall, and the tile beside it can be the gate pier.
    const respawnTile = {
      x: Math.round(cp.respawnX / TILE_SIZE),
      y: Math.round(cp.respawnY / TILE_SIZE),
    };
    this.placePartyAtTile(respawnTile);
    // After the placement, so the companion's fresh anchors name the save point.
    this.companion.resetForRespawn(this.human, this.cat);

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

    this.rewindRosterToCheckpoint();

    this.combat.resetForCheckpoint();
    this.destruction.resetForCheckpoint();
    this.lavaBalls.resetForCheckpoint();
    this.rockThrows.resetForCheckpoint();
    this.hirelingShots.resetForCheckpoint();
    this.skeletonShots.resetForCheckpoint();
    this.goblinArrows.resetForCheckpoint();
    this.clownGas.resetForCheckpoint();
    this.fairyFireballs.resetForCheckpoint();
    this.knightMissiles.resetForCheckpoint();
    this.skeletonSummons.resetForCheckpoint();
    this.bossRoom.resetForCheckpoint();
    this.arena.resetForCheckpoint();
    this.bossRoomDressings.resetForCheckpoint();

    // Last, so the snapshot has the final word. The two resets above clear the
    // same room locks and entry windows the snapshot describes, and they clear
    // them to "no fight in progress" rather than to what was actually captured.
    this.restoreWorldCheckpoint(cp.world);
    if (this.briarHollowKitCheckpoint !== null) {
      this.briarHollowKit?.restoreCheckpoint(this.briarHollowKitCheckpoint);
    }
    if (this.gatheringCheckpoint !== null) {
      this.gathering?.restoreCheckpoint(this.gatheringCheckpoint);
    }
    this.fairies.resetForCheckpoint(
      this.world.roster.mobs,
      deadFairyUpgradeBosses(this.bossRoom, this.arena),
    );
    this.forgetDebriefsOfLivingBosses();

    this.bossIntro.cancel();
    this.combatCooldownFrames = 0;

    // A boss encounter switches to its boss track via `bossFightInitiated`, but
    // dying mid-fight and restoring here never emits `bossDefeated` — nothing
    // else tells the audio system the encounter is over, so the boss track
    // would otherwise keep playing at the safe room.
    if (this.overworldMusic === null && this.audio?.currentMusicId !== this.levelDef.music) {
      this.audio?.playMusic(this.levelDef.music, { fadeInMs: MUSIC_FADE_IN_MS });
    }

    // A town save can predate a quest fight that was still being fought when
    // the party fell. Rewound to before it, the quest no longer owns the track,
    // and nothing else on this path hands it back to the zone music.
    const questFightOwnsTrack =
      this.circusQuest.isWaveFightInProgress || this.murderQuest.isTownFightInProgress;
    if (this.overworldMusic !== null && !questFightOwnsTrack) {
      this.overworldMusic.battleMusicActive = false;
      this.overworldMusic.reset();
    }

    // The party is standing on the save point right now — the latches have to
    // agree, or the respawn frame would read as a fresh entry and save the
    // rewound world over itself.
    this.wasInSafeRoom = true;
    this.wasInTown = this.isInsideTownWall(this.active());
    this.wasInBriarHollowSquare = this.isInBriarHollowSquare(this.active());
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
      bossRoomDressing: this.bossRoomDressings.captureCheckpoint(),
      barriers: this.barriers.captureCheckpoint(),
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
      briarHollow: captureBriarHollowState(this.briarHollowState),

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
    this.bossRoomDressings.restoreCheckpoint(world.bossRoomDressing);
    this.barriers.restoreCheckpoint(world.barriers);
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
    this.circusQuest.restoreCheckpoint(
      world.circusQuest,
      this.world.roster.mobs,
      this.world.roster.grid,
    );
    this.murderQuest.restoreCheckpoint(
      world.murderQuest,
      this.world.roster.mobs,
      this.world.roster.grid,
    );
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
    restoreBriarHollowState(this.briarHollowState, world.briarHollow);

    this.krakarenKilled = world.krakarenKilled;
    this.krakarenBossRoomIdx = world.krakarenBossRoomIdx;
    this.juicerKilled = world.juicerKilled;
    this.juicerBossRoomIdx = world.juicerBossRoomIdx;
  }

  /**
   * The subset of {@link captureWorldCheckpoint} that survives a page reload,
   * written into `SavedWorld` on safe-room entry. See {@link PersistedWorldState}.
   */
  private capturePersistedWorldState(): PersistedWorldState {
    return {
      bossRoom: this.bossRoom.captureCheckpoint(),
      arena: toPersistedArenaCheckpoint(this.arena.captureCheckpoint()),
      treasureChests: toPersistedTreasureChestCheckpoint(this.treasureChests.captureCheckpoint()),
      defendQuest: toPersistedDefendQuestCheckpoint(this.defendQuest.captureCheckpoint()),
      spiderQuest: toPersistedSpiderQuestCheckpoint(this.spiderQuest.captureCheckpoint()),
      circusQuest: toPersistedCircusQuestCheckpoint(this.circusQuest.captureCheckpoint()),
      murderQuest: toPersistedMurderMysteryQuestCheckpoint(this.murderQuest.captureCheckpoint()),
      bounty:
        this.bounty === null ? null : toPersistedBountyCheckpoint(this.bounty.captureCheckpoint()),

      circusQuestProgress: captureCircusQuestProgress(this.circusQuestProgress),
      anchorQuestProgress: captureAnchorQuestProgress(this.anchorQuestProgress),
      murderQuestProgress: captureMurderQuestProgress(this.murderQuestProgress),
      journal: captureJournalProgress(this.journalProgress),
      bountyProgress: captureBountyProgress(this.bountyProgress),
      clubMembership: captureClubMembership(this.clubMembership),
      marketStock: toPersistedMarketStockCheckpoint(captureMarketStock(this.marketStock)),
      townMemory: captureTownMemory(this.townMemory),
      mercenaryRoster: captureMercenaryRoster(this.mercenaryRoster),
      mongoPetState: captureMongoPetState({ ...this.mongoPetState, hp: this.mongoSystem.hp }),
      mordecaiDebrief: { ...this.mordecaiDebrief },
      tacticsNoticesSeen: [...this.tacticsNoticesSeen],
      doomsday: capturePersistedDoomsday(this.doomsdayQuestProgress, Date.now()),
      bossRoomDressing: this.bossRoomDressings.captureCheckpoint(),
      briarHollow: captureBriarHollowState(this.briarHollowState),

      krakarenKilled: this.krakarenKilled,
      krakarenBossRoomIdx: this.krakarenBossRoomIdx,
      juicerKilled: this.juicerKilled,
      juicerBossRoomIdx: this.juicerBossRoomIdx,
    };
  }

  /** Tells each boss room whose boss is already dead that it was won. */
  private replayBossRoomDefeats(): void {
    this.bossRoomDressings.replayDefeats({
      gauntletBossTypes: this.bossRoom.defeatedBossTypes,
      spiderLab: this.spiderQuest.isComplete,
      colosseum: this.arena.phase2Active,
    });
  }

  /**
   * Applies a `PersistedWorldState` from a resumed save. Runs once, from the
   * constructor, after every system it touches exists. Unlike
   * {@link restoreWorldCheckpoint} it is not a rewind, so there is no fight or
   * companion directive to clear first.
   */
  private applyPersistedWorldState(state: PersistedWorldState): void {
    // Every field is destructured so that the unused-variable lint catches one
    // that is read here but never applied, and the rest has to type as empty so
    // that a field added to the save but never read here fails the typecheck.
    const {
      bossRoom,
      arena,
      treasureChests,
      defendQuest,
      spiderQuest,
      circusQuest,
      murderQuest,
      bounty,
      circusQuestProgress,
      anchorQuestProgress,
      murderQuestProgress,
      journal,
      bountyProgress,
      clubMembership,
      marketStock,
      townMemory,
      mercenaryRoster,
      mongoPetState,
      mordecaiDebrief,
      tacticsNoticesSeen,
      doomsday,
      bossRoomDressing,
      briarHollow,
      krakarenKilled,
      krakarenBossRoomIdx,
      juicerKilled,
      juicerBossRoomIdx,
      ...unappliedFields
    } = state;
    assertNoFieldsLeft(unappliedFields);

    const { mobs, grid } = this.world.roster;

    this.bossRoom.restoreCheckpoint(bossRoom);
    this.arena.restoreCheckpoint(fromPersistedArenaCheckpoint(arena));
    // The roster was regenerated from the seed, so it holds every boss the
    // player already killed, alive again.
    const beatenBosses = this.bossRoom.bossesInDefeatedRooms(mobs);
    if (this.arena.phase2Active) {
      beatenBosses.push(...mobs.filter((mob) => mob instanceof BallOfSwine));
    }
    for (const boss of beatenBosses) despawnMob(boss, mobs, grid);
    replayFairyRateUpgrades(this.fairies, deadFairyUpgradeBosses(this.bossRoom, this.arena));

    this.treasureChests.restoreCheckpoint(
      fromPersistedTreasureChestCheckpoint(treasureChests, this.treasureChests.allChests),
    );
    this.defendQuest.restoreCheckpoint(fromPersistedDefendQuestCheckpoint(defendQuest));
    this.spiderQuest.restoreCheckpoint(fromPersistedSpiderQuestCheckpoint(spiderQuest));
    if (bossRoomDressing !== undefined) this.bossRoomDressings.restoreCheckpoint(bossRoomDressing);
    // A save older than the dressings restores none of them, so the rooms
    // learn of their dead bosses here instead.
    this.replayBossRoomDefeats();

    // Before the quest systems' own restores: they reconcile the NPCs their
    // constructors spawned against this same progress object, and must see the
    // saved progress rather than the default those constructors read.
    restoreCircusQuestProgress(this.circusQuestProgress, circusQuestProgress);
    restoreMurderQuestProgress(this.murderQuestProgress, murderQuestProgress);

    this.circusQuest.restoreCheckpoint(fromPersistedCircusQuestCheckpoint(circusQuest), mobs, grid);
    this.murderQuest.restoreCheckpoint(
      fromPersistedMurderMysteryQuestCheckpoint(murderQuest),
      mobs,
      grid,
    );
    if (this.bounty !== null && bounty !== null) {
      this.bounty.restoreFromSave(fromPersistedBountyCheckpoint(bounty));
    }

    restoreAnchorQuestProgress(this.anchorQuestProgress, anchorQuestProgress);
    restoreJournalProgress(this.journalProgress, journal);
    restoreBountyProgress(this.bountyProgress, bountyProgress);
    restoreClubMembership(this.clubMembership, clubMembership);
    restoreTownMemory(this.townMemory, townMemory);
    restoreMarketStock(this.marketStock, fromPersistedMarketStockCheckpoint(marketStock));
    restoreMercenaryRoster(this.mercenaryRoster, mercenaryRoster);
    restoreMongoPetState(this.mongoPetState, mongoPetState);
    // A save older than the village restores none of it, leaving the
    // constructor's fresh, empty state in place.
    if (briarHollow !== undefined) restoreBriarHollowState(this.briarHollowState, briarHollow);

    this.mordecaiDebrief = { ...mordecaiDebrief };
    // `TacticsNoticeSystem` holds this exact Set by reference, so it's refilled
    // in place rather than replaced — a reassignment here would leave the
    // system watching the stale, pre-load one.
    this.tacticsNoticesSeen.clear();
    for (const trait of tacticsNoticesSeen ?? []) this.tacticsNoticesSeen.add(trait);
    if (doomsday !== undefined) {
      restoreDoomsdayProgress(this.doomsdayQuestProgress, doomsday, Date.now());
    }

    this.krakarenKilled = krakarenKilled;
    this.krakarenBossRoomIdx = krakarenBossRoomIdx;
    this.juicerKilled = juicerKilled;
    this.juicerBossRoomIdx = juicerBossRoomIdx;
  }

  /**
   * Writes the save and makes it the one a death respawns from, paired with
   * `checkpoint` when the caller took one alongside it. A save without one still
   * replaces the last checkpoint: a death then rebuilds from this save rather
   * than rewinding to an older moment than the one just persisted.
   */
  private saveProgress(checkpoint: LevelCheckpoint | null): void {
    const progress: GameProgressInput = {
      humanSnap: revivedSnapshot(snapPlayer(this.human)),
      catSnap: revivedSnapshot(snapPlayer(this.cat)),
      levelId: this.levelDef.id,
      abilityStates: this.abilityManager.serializeStates(),
      crafts: this.partyCrafts,
      mongoUnlocked: this.mongoSystem.unlocked,
      // The system's accessor, not the stored value: both of these saves can
      // fire with Mongo still out, and the stored value is only written back
      // when he despawns — so a safe room entered with a 5/130 raptor at the
      // player's heel was recording 130.
      mongoPetHp: this.mongoSystem.hp,
      mongoPetResting: this.mongoSystem.restingUntilFull,
      humanAchievements: this.humanAchievements.serialize(),
      catAchievements: this.catAchievements.serialize(),
      gameStats: this.gameStats.snapshot(),
      // The tutorial's hand-built map has no layout to regenerate.
      world:
        this.tutorial === null
          ? {
              generatorVersion: WORLD_GENERATOR_VERSION,
              worldSeed: this.gameMap.worldSeed,
              artSeed: this.gameMap.artSeed,
              safeRoomTile: this.lastSavePointTile,
              levelTimerFrames:
                this.levelDef.hasCollapseTimer === true ? this.levelTimerFrames : null,
              persisted: this.capturePersistedWorldState(),
            }
          : undefined,
    };
    this.lastSave = savePointAfterWrite(progress, checkpoint, this.tutorial !== null);
    this.onSaveProgress?.(progress);
  }

  /** The party is down the escape stairwell: the game is won. */
  private completeRun(): void {
    finishRun(this.runCompleteScreen, {
      // A hire lying downed cannot follow the party down the stairs, so it dies
      // here as it would at any door. A standing one keeps walking with them.
      settleParty: () =>
        this.mercenarySystem.forfeitDownedHire(this.world.roster.mobs, this.world.roster.grid),
      unlockAchievements: () => {
        this.humanAchievements.tryUnlock('city_evacuated');
        this.catAchievements.tryUnlock('city_evacuated');
      },
      save: () => this.captureSavePoint(this.saveTileUnder(this.active()), { announce: false }),
      summarize: () =>
        buildRunSummary({
          stats: this.gameStats,
          humanLevel: this.human.level,
          catLevel: this.cat.level,
          mongoLevel: this.mongoSystem.unlocked ? this.abilityManager.getRealLevel('mongo') : null,
          achievements: countPartyAchievements(this.humanAchievements, this.catAchievements),
        }),
      handlers: {
        // The stage is already 'complete', which is what leaves the stairwell inert.
        onKeepExploring: () => undefined,
        onMainMenu: () => this.returnToMainMenu(),
      },
    });
    this.audio?.play('level_complete');
  }

  /**
   * The start menu, with the finished run offered as the save to continue.
   *
   * Not the pause menu's Reset Game: that wipes the save, and a run the player
   * just finished is exactly the one they may want to walk around in again.
   */
  private returnToMainMenu(): void {
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    const baseOptions: DungeonSceneOptions = {
      audio: this.audio ?? undefined,
      saveProgress: this.onSaveProgress,
      onResetGame: this.onResetGameCallback ?? undefined,
    };
    const save = this.lastSave?.progress ?? null;
    const onContinue =
      save === null
        ? undefined
        : () => {
            const { levelDef, options } = sceneSetupFromSave(baseOptions, save);
            this.sceneManager.replace(
              new DungeonScene(levelDef, this.input, this.sceneManager, options),
            );
          };
    this.sceneManager.replace(
      new PostSignupScene(this.input, this.sceneManager, baseOptions, onContinue),
    );
  }

  /**
   * Takes a save point at `respawnTile`: the persisted game, which resumes on
   * that tile, and — outside the tutorial — the in-run checkpoint that rewinds
   * a death to the same moment in place. Callers own the guards; this never
   * refuses. `announce: false` is for a save the player did nothing to trigger
   * beyond what already told them they were safe.
   *
   * The tutorial takes no checkpoint and shows no toast: its hand-scripted flow
   * cannot be rewound in place, and a death there restarts it rather than
   * returning here.
   */
  private captureSavePoint(respawnTile: TilePoint, { announce = true } = {}): void {
    this.lastSavePointTile = respawnTile;
    this.saveProgress(this.tutorial === null ? this.captureLevelCheckpoint(respawnTile) : null);
    if (announce && this.tutorial === null) this.menus.hotbarToast.show(PROGRESS_SAVED_TOAST_TEXT);
  }

  private captureLevelCheckpoint(respawnTile: TilePoint): LevelCheckpoint {
    markMobsAtCheckpoint(this.world.roster);
    this.briarHollowKitCheckpoint = this.briarHollowKit?.captureCheckpoint() ?? null;
    this.gatheringCheckpoint = this.gathering?.captureCheckpoint() ?? null;
    return {
      world: this.captureWorldCheckpoint(),
      humanSnap: checkpointSnapshot(snapPlayer(this.human)),
      catSnap: checkpointSnapshot(snapPlayer(this.cat)),
      abilities: this.abilityManager.clone(),
      crafts: clonePartyCraftsState(this.partyCrafts),
      humanAchievements: this.humanAchievements.clone(),
      catAchievements: this.catAchievements.clone(),
      respawnX: respawnTile.x * TILE_SIZE,
      respawnY: respawnTile.y * TILE_SIZE,
      levelTimerFrames: this.levelTimerFrames,
    };
  }

  /** Whether a body's centre stands inside the town wall; false off the overworld. */
  private isInsideTownWall(body: Pick<Mob, 'x' | 'y'>): boolean {
    return this.gameMap.isInsideTownWall(
      body.x + TILE_SIZE * TILE_CENTRE_FRACTION,
      body.y + TILE_SIZE * TILE_CENTRE_FRACTION,
    );
  }

  /**
   * The walled town is a save point. Deliberately not `safeRoomEntered`: that
   * event also plays the safe-room sound, unlocks `safe_haven`, drives the
   * tutorial and reports to the AI adapter, none of which belongs to walking
   * through a gate.
   *
   * A blocked entry is not retried when the blocker clears; the next save is
   * the next real entry. That keeps the rule predictable — walking in is what
   * saves, never something that happens later somewhere in the streets.
   */
  private onTownEntered(active: Pick<Mob, 'x' | 'y'>): void {
    if (!this.canSaveInTown) return;
    this.captureSavePoint(this.saveTileUnder(active));
  }

  /** Whether a body's centre stands inside Briar Hollow's square district. */
  private isInBriarHollowSquare(body: Pick<Mob, 'x' | 'y'>): boolean {
    return (
      this.gameMap.briarHollowDistrictAt(
        body.x + TILE_SIZE * TILE_CENTRE_FRACTION,
        body.y + TILE_SIZE * TILE_CENTRE_FRACTION,
      ) === 'square'
    );
  }

  /**
   * Briar Hollow's square, with its bell tower, is a save point the same way
   * the walled town's gate is: walking in is what saves. Guarded the same way
   * — never mid-siege, never with a hostile still fighting in the village, so
   * a reload can't skip either.
   */
  private onBriarHollowSquareEntered(active: Pick<Mob, 'x' | 'y'>): void {
    if (!this.canSaveInBriarHollowSquare) return;
    this.captureSavePoint(this.saveTileUnder(active));
  }

  /**
   * A hostile inside the palisade that has actually traded blows with the
   * party — mirrors {@link isTownUnderAttack} for Briar Hollow's own walls,
   * since a fight in the main town says nothing about the village being safe.
   */
  private get isBriarHollowUnderAttack(): boolean {
    return this.world.roster.mobs.some(
      (mob) => mob.isHostile && isEngagedInFight(mob) && this.gameMap.isInBriarHollow(mob.x, mob.y),
    );
  }

  private get canSaveInBriarHollowSquare(): boolean {
    return !this.isRevivePending && !this.isBriarHollowUnderAttack && !this.isBossFightInProgress;
  }

  /**
   * The tile a town or arrival save resumes and respawns on: where the active
   * crawler stands, so a building exit resumes on that building's doorstep,
   * unless that tile is a pocket a respawn could get stuck in.
   */
  private saveTileUnder(active: Pick<Mob, 'x' | 'y'>): TilePoint {
    const standingTile = {
      x: Math.floor((active.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
      y: Math.floor((active.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    };
    if (hasRoomToMove(this.gameMap, standingTile.x, standingTile.y)) return standingTile;
    return this.gameMap.townSquareCentre ?? this.gameMap.startTile;
  }

  private get canSaveInTown(): boolean {
    return !this.isRevivePending && !this.isTownUnderAttack && !this.isBossFightInProgress;
  }

  /**
   * How far a stairwell room's save point may drift from the room's exact
   * centre to land on ground with room to stand in — the seat computed by the
   * dungeon generator is usually clear, but a room whose centre falls on a
   * prop or a wall segment still needs a nearby, spawnable substitute.
   */
  private static readonly STAIRWELL_SAVE_TILE_SEARCH_RADIUS = 6;
  /**
   * A hostile this close to the active crawler blocks a stairwell save,
   * whatever the room's own guard count reads: a crawler fleeing a pursuer can
   * cross into an already-quiet room one step ahead of it, and the room's
   * count says nothing about a threat that hasn't entered yet.
   */
  private static readonly STAIRWELL_SAVE_ENGAGEMENT_RADIUS_TILES = 4;

  /**
   * Every room the floor's dungeon generator recorded that also holds a
   * stairwell — the boundary a fresh kill or a quiet entry checks against.
   */
  private roomIndexOfStairwellRoom(roomIndex: number): boolean {
    if (roomIndex < 0 || roomIndex >= this.gameMap.roomBounds.length) return false;
    const room = this.gameMap.roomBounds[roomIndex];
    return this.gameMap.stairwellTiles.some(
      (tile) =>
        tile.x >= room.x &&
        tile.x < room.x + room.w &&
        tile.y >= room.y &&
        tile.y < room.y + room.h,
    );
  }

  /** Whether a living hostile is close enough to the active crawler to call the fight still on. */
  private hasEngagedHostileNearActive(): boolean {
    return hostileWithinRadius(
      this.active(),
      this.world.roster.grid,
      TILE_SIZE * DungeonScene.STAIRWELL_SAVE_ENGAGEMENT_RADIUS_TILES,
    );
  }

  /**
   * Takes the once-per-room stairwell save the moment a room holding a
   * stairwell has no hostiles left in it — whether that is because the last
   * guard just died or because the room was already quiet — and no hostile is
   * engaged near the active crawler. Guarded the same way `safeRoomEntered` is:
   * never mid-boss-fight, never with a revive pending, so a reload can't skip
   * either.
   *
   * Callers, not this method, decide *when* a room qualifies: the per-frame
   * entry check only calls this for a room in `roomsClearAtFloorStart`, while
   * `mobKilled` and the pending retry call it for any room, because a kill
   * that actually happens in the room is always allowed to clear it.
   */
  private attemptStairwellSave(roomIndex: number): void {
    if (roomIndex < 0) return;
    if (this.stairwellRoomsSaved.has(roomIndex)) {
      if (this.pendingStairwellSaveRoomIndex === roomIndex)
        this.pendingStairwellSaveRoomIndex = null;
      return;
    }
    if (this.isBossFightInProgress || this.isRevivePending) return;
    if (!this.roomIndexOfStairwellRoom(roomIndex)) return;
    if (this.gameMap.hostilesInRoom(roomIndex, this.world.roster.mobs).length > 0) return;

    if (this.hasEngagedHostileNearActive()) {
      // The room itself is clear, but the fight that cleared it hasn't — keep
      // this room queued so a later, quieter frame can finish the save.
      this.pendingStairwellSaveRoomIndex = roomIndex;
      return;
    }

    this.stairwellRoomsSaved.add(roomIndex);
    if (this.pendingStairwellSaveRoomIndex === roomIndex) this.pendingStairwellSaveRoomIndex = null;
    const room = this.gameMap.roomBounds[roomIndex];
    const centreTileX = room.x + Math.floor(room.w / 2);
    const centreTileY = room.y + Math.floor(room.h / 2);
    const respawnTile = findNearbyWalkableTile(
      this.gameMap,
      centreTileX,
      centreTileY,
      DungeonScene.STAIRWELL_SAVE_TILE_SEARCH_RADIUS,
    ) ?? { x: centreTileX, y: centreTileY };
    this.bus.emit('roomCleared', { roomIndex });
    this.captureSavePoint(respawnTile, { announce: false });
    this.audio?.play('stairwell_save_chime');
  }

  /**
   * The per-frame half of the stairwell save: only fires the (mob-scanning)
   * attempt when the active crawler's room actually changed this frame, or a
   * save is still pending from an earlier engagement — never on every frame
   * regardless, which would walk the roster for nothing every time the party
   * stands still in a room that already has its save.
   */
  private updateStairwellEntrySave(active: Pick<Mob, 'x' | 'y'>): void {
    const activeRoomIndex = this.gameMap.roomIndexAt(
      Math.floor((active.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
      Math.floor((active.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    );
    const roomChanged = activeRoomIndex !== this.lastActiveRoomIndexForStairwellSave;
    this.lastActiveRoomIndexForStairwellSave = activeRoomIndex;

    if (roomChanged && this.roomsClearAtFloorStart.has(activeRoomIndex)) {
      this.attemptStairwellSave(activeRoomIndex);
    }
    // Retried only while the crawler is standing in the pending room itself —
    // a kill landed near its doorway does not bank a save for a room the party
    // has already walked away from.
    if (
      this.pendingStairwellSaveRoomIndex !== null &&
      activeRoomIndex === this.pendingStairwellSaveRoomIndex
    ) {
      this.attemptStairwellSave(this.pendingStairwellSaveRoomIndex);
    }
  }

  /**
   * Either crawler, not just the inactive one: the active crawler can be the
   * downed one for a frame around a switch. Both save snapshots stand a downed
   * crawler back up, so saving now would turn a pending revive into a free one.
   * A downed hireling is the same case: the roster still names it standing.
   */
  private get isRevivePending(): boolean {
    return this.human.isKnockedOut || this.cat.isKnockedOut || this.mercenarySystem.revivePending;
  }

  /**
   * A fight in the streets: the krasue night attack, or any hostile creature
   * inside the wall that has actually traded blows with the party — a bounty
   * target or a summon that chased them through a gate. A mob that has only
   * noticed the party is not a fight, and allies are filtered by `isHostile`
   * because they share the mob roster.
   */
  private get isTownUnderAttack(): boolean {
    if (this.murderQuest.isTownFightInProgress) return true;
    return this.world.roster.mobs.some(
      (mob) => mob.isHostile && isEngagedInFight(mob) && this.isInsideTownWall(mob),
    );
  }

  /**
   * A save is never written mid-fight. The save cannot hold the creatures in
   * the fight, so a reload would either hand out the fight for free or rebuild
   * it around a party standing in a safe room outside the locked door.
   */
  private get isBossFightInProgress(): boolean {
    return (
      this.bossRoom.anyLocked ||
      this.arena.isBossFightInProgress ||
      this.spiderQuest.isBossFightInProgress ||
      this.briarHollowKit?.assault?.inSiege === true
    );
  }

  /**
   * Rewinds the roster to the checkpoint, then the spider list with it:
   * re-derived rather than filtered, because a spider that spawned after the
   * checkpoint has just left `mobs`, and this list would otherwise keep
   * rendering and ticking it.
   */
  private rewindRosterToCheckpoint(): void {
    rewindMobsToCheckpoint(this.world.roster);
    this.grotesqueSpiders = this.world.roster.mobs.filter(
      (mob): mob is GrotesqueSpider => mob instanceof GrotesqueSpider,
    );
  }

  private restartAtFloorEntry(): void {
    // Before the scene is replaced: his HP only reaches the shared state through
    // a despawn, and the instance holding it is about to be discarded.
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.audio?.stopSound('death_sequence');
    this.stopHazardSoundsForRespawn();
    // The restart generates the floor from a fresh seed and rewinds the party
    // to floor entry, so every camp is a new place with fresh XP in it.
    forgetClearedCamps(this.townMemory);
    // The party is rewound to floor entry, so the kills, gold and damage of the
    // failed attempt go with it; deaths and time played are the run's and stay.
    this.gameStats.restore(this.floorEntryGameStats);
    this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    restoreMercenaryRoster(this.mercenaryRoster, this.floorEntryMercenaryRoster);
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
        floorEntryGameStats: this.floorEntryGameStats,
        floorEntryMercenaryRoster: this.floorEntryMercenaryRoster,
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
        partyCrafts: this.partyCrafts,
        // No `briarHollowState`: the village is per-floor and this restart can
        // only fire before this floor's first save, so the live state holds
        // nothing a save has ever recorded — the constructor's fresh state is
        // the correct rewind, the same as taking the stairs down.
        marketStock: this.marketStock,
        mercenaryRoster: this.mercenaryRoster,
        godModeState: this.godModeState,
        companionStance: this.companionStance,
        tacticsNoticesSeen: this.tacticsNoticesSeen,
        // The deaths and time the restart cost are the run's; it keeps them.
        gameStats: this.gameStats,
        suppressArrivalSave: true,
      }),
    );
  }

  /** See {@link shouldShowInteractionPrompts}: a hostile in attack range takes the press. */
  private shouldShowInteractionPrompts(active: HumanPlayer | CatPlayer): boolean {
    return shouldShowInteractionPrompts(active, this.world.roster.grid);
  }

  /**
   * Whether a link ahead of the ground pickups in `triggerSpaceAction` would
   * claim a press from `active`. Asks each link's own `wouldInteract`, the
   * predicate its `tryInteract` is built on, so this cannot drift from the chain.
   */
  private earlierSpaceLinkClaims(active: HumanPlayer | CatPlayer): boolean {
    return (
      this.treasureChests.wouldInteract(active) ||
      this.defendQuest.wouldInteract(active) ||
      this.spiderQuest.wouldInteract(active) ||
      this.circusQuest.wouldInteract(active) ||
      this.murderQuest.wouldInteract(active) ||
      this.bossRoomDressings.wouldInteract(active)
    );
  }

  /**
   * Floats "Pick up" over the nearest ground pickup, only when a press would
   * actually reach it. Returns whether it drew, because every link after it in
   * the Space chain (market, props, signs, the village, citizens, the hireling)
   * is then out of reach and must not float a prompt of its own.
   */
  private renderGroundPickupPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): boolean {
    // `triggerSpaceAction` hands the press to whatever overlay owns the screen.
    if (this.focusedOverlay !== null) return false;
    const active = this.active();
    // The safe room's Space chain ends at its own fixtures and never reaches a pickup.
    if (this.safeRoom.isEntityInSafeRoom(active)) return false;
    if (!this.shouldShowInteractionPrompts(active)) return false;
    if (this.earlierSpaceLinkClaims(active)) return false;
    return this.destruction.groundPickups.renderPrompt(ctx, camX, camY, active);
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
    if (this.townProps === null && this.market === null && this.crawlerSigns === null) return;
    if (
      this.noticeBoard?.isOpen === true ||
      this.marketPanel?.isOpen === true ||
      this.fortuneTeller?.isOpen === true ||
      this.bounty?.isDialogOpen === true
    ) {
      return;
    }
    const active = this.active();
    if (!this.shouldShowInteractionPrompts(active)) return;
    // Same order as the Space chain in `tryInteract`, so the prompt always names
    // the thing that press would actually reach.
    if (this.market?.renderPrompt(ctx, camX, camY, active) === true) return;
    if (this.bounty?.renderPrompt(ctx, camX, camY, active) === true) return;
    this.townProps?.renderPrompt(ctx, camX, camY, active);
    if (this.signDialog?.isOpen !== true) this.crawlerSigns?.renderPrompt(ctx, camX, camY, active);
  }

  /** Floats a "Talk" prompt over the nearest citizen when one is in range and idle. */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.citizenDialog === null || this.townLife === null) return;
    if (this.citizenDialog.isOpen) return;
    const active = this.active();
    if (!this.shouldShowInteractionPrompts(active)) return;
    const target = this.townLife.findTalkTarget(active.x, active.y);
    if (target === null) return;
    drawInteractionPrompt(ctx, target.x - camX, target.y - camY, TILE_SIZE, 'Talk');
  }

  /**
   * Floats a "Pet" prompt over Mongo when a press would reach him.
   *
   * Sits just ahead of the hireling in the Space chain, so it draws just ahead
   * of it too: it yields to a chest, a quest giver, a citizen or a harvest
   * already claiming the press, the same way `renderMercenaryPrompt` yields to
   * this one.
   */
  private renderMongoPetPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) return;
    if (interactionPromptsDrawnThisFrame() > 0) return;
    if (this.gathering?.wouldStartHarvest(active) === true) return;
    if (this.briarHollowKit?.wouldInteract(active) === true) return;
    this.mongoSystem.renderPetPrompt(
      ctx,
      camX,
      camY,
      active,
      this.gameMap,
      this.world.roster.mobs,
      this.world.roster.grid,
      this.levelDef.isOverworld === true,
    );
  }

  /**
   * Floats a "Talk" prompt over the hireling when a press would reach it.
   *
   * Talking is the last link of the Space chain, so this draws last of all the
   * world prompts and yields to any of them already on screen: a chest, a quest
   * giver or a citizen in reach takes the press first, and its prompt says so.
   * `talkTarget` holds back while a fight is on, as the chain does.
   */
  private renderMercenaryPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) return;
    if (interactionPromptsDrawnThisFrame() > 0) return;
    // Gathering sits ahead of the hireling in the Space chain but draws no
    // prompt of its own, so it has to be asked whether it would take the press.
    if (this.gathering?.wouldStartHarvest(active) === true) return;
    // The village's own prompt normally answers first, but only while it is
    // drawn; asking it directly keeps a cow or villager in reach from ever
    // sharing the press with the hireling.
    if (this.briarHollowKit?.wouldInteract(active) === true) return;
    const merc = this.mercenarySystem.talkTarget(active, this.world.roster.mobs);
    if (merc === null) return;
    drawInteractionPrompt(ctx, merc.x - camX, merc.y - camY, TILE_SIZE, 'Talk');
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
    const signDialog = this.signDialog;
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
      modal(this.menus.mongoExplainer.isOpen, MONGO_EXPLAINER_FOCUS_ID),
      modal(this.menus.craftExplainers.isOpen, this.menus.craftExplainers.focusId),
      modal(this.menus.skillBookPrompt.isOpen, 'skill-book-prompt'),
      this.menus.itemQuantityPicker.overlayClaim(),
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
      modal(this.runCompleteScreen.isActive, RUN_COMPLETE_FOCUS_ID),
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
      floatingDialog(this.spiderQuest.isOutcomeOverlayShowing, () =>
        this.dismissOutcomeOverlay(this.spiderQuest.advanceOutcomeOverlay()),
      ),
      // The quest systems below own their own window listener for Space, so the
      // claim here only has to keep the press away from the world behind them.
      modal(this.spiderQuest.isDialogOpen, 'spider-quest'),
      modal(this.bounty?.isDialogOpen === true, 'quest-dialog'),
      modal(this.circusQuest.isDialogOpen, 'quest-dialog'),
      modal(this.murderQuest.isDialogOpen, 'quest-dialog'),
      modal(this.anchorQuest.isDialogOpen, 'quest-dialog'),
      floatingDialog(this.safeRoom.mordecaiDialogOpen, () => this.safeRoom.advanceMordecaiDialog()),
      modal(this.stairwell.menuOpen, 'stairwell'),
      modal(this.building?.menuOpen === true, 'building-entry'),
      this.grateSpikes.overlayClaim(),
      ...(this.briarHollowKit?.overlayClaims() ?? []),
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
      {
        isOpen: signDialog?.isOpen === true,
        space: { kind: 'advance', advance: () => signDialog?.advance() },
        locksKeyboard: true,
        haltsWorld: false,
        focusContext: null,
      },
      ...(this.briarHollowKit?.conversationClaims() ?? []),
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
   * Cuts the boots off.
   *
   * The walking and wading loops are started and stopped from `updateGameplay`,
   * which a halted frame never reaches — so a loop already playing when an
   * overlay opens keeps playing under it for as long as the overlay is up. Every
   * path that skips `updateGameplay` calls this, because none of them is a frame
   * in which the crawler is walking anywhere.
   */
  private silenceMovementLoops(): void {
    this.audio?.stopWalkingLoop();
    this.audio?.stopWadingLoop();
  }

  /**
   * Anything that takes the floor away from ordinary play.
   *
   * Derived from the claim registry rather than restated as a second boolean
   * chain: two hand-maintained lists of the same overlays drift, and a dialog
   * added to one of them and not the other is a menu the world keeps running
   * underneath. The spider lab's cutscene is the one term with no
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

  /** What the right-hand HUD column has to lay itself out around this frame. */
  private syncColumnLayoutState(): void {
    UIRenderer.setBuildSlotReserved(this.briarHollowKit?.defences?.buildButtonVisible === true);
    UIRenderer.setLevelTimerShown(this.levelDef.hasCollapseTimer === true);
    const banner = this.achievementUI.lootBoxIconRect;
    UIRenderer.setLootBoxBannerRect(banner.w > 0 ? banner : null);
  }

  /** Whether the finger held on the world walked the crawler toward it. */
  private crawlerWalkedDuringHold(): boolean {
    const start = this.holdStartActivePos;
    if (start === null) return false;
    const active = this.active();
    return Math.hypot(active.x - start.x, active.y - start.y) > HOLD_WALK_TOLERANCE_PX;
  }

  /**
   * Whether the finger held on the world is a long-press on a structure the
   * active crawler can work on, which must not walk them toward it. Decided
   * where the finger came down (see `StructureHold`).
   */
  private holdRestsOnStructure(): boolean {
    const target = this.touch.moveTarget;
    if (target === null) return false;
    return this.structureHold.suppressesWalk(target.x, target.y, MENU_TAP_MAX_DISTANCE);
  }

  /** Whether a finger coming down here lands on something the Structure menu can open on. */
  private fingerOnWorkableStructure(screenX: number, screenY: number): boolean {
    const cam = this.camera();
    if (this.briarHollowKit?.isStructureUnderFinger(screenX, screenY, cam.x, cam.y) === true) {
      return true;
    }
    const tileX = Math.floor((screenX + cam.x) / TILE_SIZE);
    const tileY = Math.floor((screenY + cam.y) / TILE_SIZE);
    return this.grateSpikes.isSpikeableGrateAt(tileX, tileY);
  }

  /**
   * Small talk loses to anything that seized the frame — a quest interjection
   * the player walked into, a level-up, the death screen. Without this the two
   * boxes render on top of each other and the chat eats the Space presses meant
   * for the interruption.
   */
  private yieldCitizenDialogToInterruption(): void {
    if (this.citizenDialog?.isOpen === true && this.gameplayHalted) this.citizenDialog.close();
    if (this.signDialog?.isOpen === true && this.gameplayHalted) this.signDialog.close();
    if (this.gameplayHalted) this.briarHollowKit?.dismissDialog();
    // Death, or anything else that halts the world over them, takes the
    // construction panels down with it: drawn over a death screen they would
    // take its first click. Their own dismantle confirm is the one halt they
    // raise themselves, and it must not close itself.
    const kitHaltsItself = this.briarHollowKit?.haltsWorldItself === true;
    if (this.gameOver || (this.gameplayHalted && !kitHaltsItself)) {
      this.briarHollowKit?.closeConstructionPanels();
      this.grateSpikes.close();
    }
    // Only on death: the shops' priced menu halts the world itself, so any
    // halt would have it closing itself the moment it opened.
    if (this.gameOver) this.briarHollowKit?.closeServicePanels();
  }

  /** Same walk-away rule as a street conversation, measured to the sign's tile. */
  private dismissSignDialogIfWalkedAway(): void {
    const target = this.signDialogTarget;
    const dialog = this.signDialog;
    if (target === null || dialog?.isOpen !== true) return;
    const active = this.active();
    const distance = Math.hypot(
      active.x - target.tile.x * TILE_SIZE,
      active.y - target.tile.y * TILE_SIZE,
    );
    if (distance > TILE_SIZE * CONVERSATION_WALK_AWAY_TILES) dialog.close();
  }

  /**
   * Mordecai's answer, from the highest-ranked of three sources that has one:
   *
   *     tutorial (if it handles it) → post-boss debrief → floor advice → AI chat
   *
   * The tutorial keeps first claim, as it always had. Floor advice sits above the
   * AI chat because it is the deterministic answer to "what is left to do here",
   * and it needs no server; the chat becomes the flavour path for a cleared floor.
   */
  private talkToMordecai(active: { x: number; y: number }): void {
    if (this.tutorial?.onMordecaiInteracted() === true) return;

    if (this.speakPostBossDebrief(active)) return;

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
   * Saves after the talk: the entry save predates it, so a reload in this room
   * would otherwise congratulate them again.
   */
  private speakPostBossDebrief(active: { x: number; y: number }): boolean {
    const room = this.safeRoom.safeRoomInfoAt(active);
    const bossType = this.exitRoomBoss(room);
    if (room === null || bossType === null) return false;
    const state = this.debriefState();
    const memory = this.debriefMemoryFor(bossType, state);
    const pages = debriefPages(bossType, memory, state);
    if (pages === null) return false;

    const remembered = rememberDebriefSpoken(memory, state);
    this.mordecaiDebrief[bossType] = remembered;
    this.safeRoom.openMordecaiPages(pages);
    // Boxes repeat every talk; don't pay a server round trip for a repeat.
    const worthSaving = !sameDebriefMemory(memory, remembered);
    if (
      worthSaving &&
      this.tutorial === null &&
      !this.isBossFightInProgress &&
      !this.isRevivePending
    ) {
      // `safeRoomEntered` fires once, for whichever crawler got in first. A
      // checkpoint comes with it, so a death here rewinds to after the talk.
      this.captureSavePoint(room.centre, { announce: false });
    }
    return true;
  }

  private exitRoomBoss(room: SafeRoomInfo | null): DebriefBossType | null {
    if (room === null) return null;
    const bossType = debriefBossType(room.followsBossType);
    if (bossType === null) return null;
    const defeated = this.bossRoom.defeatedBossTypes;
    if (!defeated.has(bossType) || isSupersededDebrief(bossType, defeated)) return null;
    return bossType;
  }

  /**
   * The checkpoint can predate a kill when the companion reached the exit room
   * first, so a rewind can bring a debriefed boss back.
   */
  private forgetDebriefsOfLivingBosses(): void {
    const defeated = this.bossRoom.defeatedBossTypes;
    const kept: MordecaiDebriefCheckpoint = {};
    for (const bossType of ALL_DEBRIEF_BOSS_TYPES) {
      const memory = this.mordecaiDebrief[bossType];
      if (memory !== undefined && defeated.has(bossType)) kept[bossType] = memory;
    }
    this.mordecaiDebrief = kept;
  }

  private debriefMemoryFor(bossType: DebriefBossType, state: DebriefState): DebriefMemory {
    const stored = this.mordecaiDebrief[bossType] ?? EMPTY_DEBRIEF_MEMORY;
    const reconciled = reconcileDebriefMemory(stored, state.pendingBoxes);
    if (reconciled !== stored) this.mordecaiDebrief[bossType] = reconciled;
    return reconciled;
  }

  private debriefState(): DebriefState {
    return {
      pendingBoxes: {
        human: this.humanAchievements.pendingBoxes.length,
        cat: this.catAchievements.pendingBoxes.length,
      },
      unworn: [
        ...unwornGear('human', this.human.inventory),
        ...unwornGear('cat', this.cat.inventory),
      ],
    };
  }

  private mordecaiMarkerFor(room: SafeRoomInfo): QuestMarkerState {
    const bossType = this.exitRoomBoss(room);
    if (bossType === null) return 'none';
    const state = this.debriefState();
    const hasNews = debriefHasNews(this.debriefMemoryFor(bossType, state), state);
    return hasNews ? 'exclamation' : 'none';
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
      // Walking order. The nursery entry retires itself when the party arrives
      // rather than when they fight (see `defendQuestObjective`), which is what
      // lets it sit in front of a boss without a declined wave silencing him,
      // and what makes the heads-up a heads-up: it is spoken while the room is
      // still ahead of them. Whether they hear it at all depends on where they
      // next take advice — a gateway safe room speaks only about the boss it
      // guards until that boss is dead — so on floor 1 it reaches a party that
      // sits down again after the Hoarder rather than one that walks straight
      // on, while on floor 2 the spine's own station usually seats ahead of the
      // nursery and catches them on the way.
      //
      // `asOptional` is for work a party who is not interested never finishes,
      // and which would therefore stand in front of everything listed behind it
      // for the rest of the floor: the spider lab is a dead end, and the Ball of
      // Swine only *guarantees* a way down, which is why Mordecai's own speech
      // about it says to find another if you would rather keep your bones.
      case DUNGEON_FLOOR_ONE:
        return [
          this.bossObjective('the_hoarder'),
          this.defendQuestObjective(),
          this.bossObjective('juicer'),
        ];
      case DUNGEON_FLOOR_TWO:
        return [
          this.bossObjective('krakaren_clone'),
          this.defendQuestObjective(),
          asOptional(this.spiderLabObjective()),
          asOptional(this.ballOfSwineObjective('ball_of_swine_distant')),
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
    // Optional, which for a slot that is never complete is the difference
    // between "the standing work, once the floor's own errands are done" and a
    // permanent full stop in front of everything listed after it.
    return asOptional(
      adviceObjective('shady_bounties', false, bounty.trackerEntries()[0]?.target ?? null),
    );
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
    // Spent, not completed. The advice is a heads-up about a room on the way,
    // so it is done the moment the party gets there — however the wave went,
    // and whether or not they took it. A floor with no nursery has nothing to
    // say about one.
    const hasNursery = this.gameMap.questRooms.length > 0;
    return adviceObjective(
      'defend_goblin_mother',
      this.defendQuest.isSpentAsAdvice,
      hasNursery ? this.gameMap.questRooms[0].centre : null,
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
      // Beside the Mordecai check rather than above it: each fixture owns its
      // own corner of the room, so only one of the two can ever be in range.
      if (this.bopca.tryInteract(active)) {
        return;
      }
      if (this.safeRoom.isNearMordecai(active)) {
        this.talkToMordecai(active);
      }
      return;
    }
    // If an enemy is within attack range, prefer attacking over interacting
    if (hostileWithinAttackRange(active, this.world.roster.grid)) {
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
      if (this.bossRoomDressings.tryInteract(active)) {
        return;
      }
      if (this.destruction.groundPickups.tryPickupNear(active)) {
        return;
      }
      if (this.arenaRoom.tryPickupNear(active) || this.barriers.tryPickupNear(active)) {
        this.audio?.play('picking_up_ground_object');
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
      if (this.crawlerSigns?.tryInteract(active) === true) {
        return;
      }
      if (this.briarHollowKit?.tryInteract(active) === true) {
        return;
      }
      if (this.tryTalkToCitizen(active)) {
        return;
      }
      // After citizen talk: a townsperson in range is who a press is meant for,
      // and a tree beside them is scenery until nobody is there to answer.
      if (this.gathering?.tryStartHarvest(active) === true) {
        return;
      }
      if (
        this.mongoSystem.tryPet(
          active,
          this.gameMap,
          this.world.roster.mobs,
          this.world.roster.grid,
          this.levelDef.isOverworld === true,
        )
      ) {
        this.audio?.play('happy_hearts');
        const isGrownUp =
          (this.mongoSystem.mongo?.growthLevel ?? 0) >= MONGO_ADULT_SQUAWK_MIN_LEVEL;
        this.audio?.playRandom(isGrownUp ? MONGO_ADULT_HAPPY_SQUAWKS : MONGO_BABY_HAPPY_SQUAWKS);
        return;
      }
      // Last in the chain: the hireling stands at the party's shoulder all
      // floor, so anything else within reach is what a press is meant for.
      if (this.mercenarySystem.tryTalk(active, this.world.roster.mobs)) {
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
    if (this.menus.mongoExplainer.handleClick(mx, my)) return;
    if (this.menus.craftExplainers.handleClick(mx, my)) return;
    if (this.menus.skillBookPrompt.isOpen) {
      const reader = this.menus.pendingSkillBookReader(this.menus.inventoryPlayer());
      const choice = resolveSkillBookPrompt(this.menus.skillBookFlowHost(), reader, mx, my);
      if (choice !== null) this.menus.releaseSkillBookReader();
      return;
    }
    if (this.menus.itemQuantityPicker.handleClick(mx, my)) {
      const invPlayer = this.menus.inventoryPlayer();
      this.menus.resolvePendingInventoryActions(invPlayer, (id, quantity) =>
        this.destruction.loot.addPlayerDrop(invPlayer.x, invPlayer.y, id, quantity, invPlayer),
      );
      return;
    }
    // Ranked where its overlay claim is: under the award stack, which can land
    // on the same frame the run ends, and over every panel and HUD button.
    if (this.runCompleteScreen.handleClick(mx, my)) return;
    if (this.defendQuest.handleClick(mx, my)) return;
    if (this.grateSpikes.handleClick(mx, my)) return;
    if (this.spiderQuest.handleClick(mx, my, eventTimeStampMs)) return;
    if (this.bounty?.handleClick(mx, my) === true) return;
    if (this.circusQuest.handleClick(mx, my)) return;
    if (this.murderQuest.handleClick(mx, my)) return;
    if (this.anchorQuest.handleClick(mx, my)) return;
    // Only the dialog's own box is consumed: a conversation does not halt the
    // world, so the bag can be open underneath it and its slots must stay live.
    if (this.citizenDialog?.handleClick(mx, my) === true) return;
    if (this.signDialog?.handleClick(mx, my) === true) return;
    if (this.briarHollowKit?.handleClick(mx, my) === true) return;
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

    // His own box only: the conversation floats over a live floor, so a press
    // anywhere else is the world's — and on a phone it is the move order the
    // player needs to walk away from him with.
    if (this.safeRoom.mordecaiDialogContains(mx, my)) {
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
    if (this.buildButtonRect !== null && pointInRect(mx, my, this.buildButtonRect)) {
      this.briarHollowKit?.openConstruction();
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

    for (const chest of this.treasureChests.allChests) {
      if (!isChestOpenable(chest)) continue;
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
    // Ahead of the pause menu: the explainer opens over it, and a press there
    // must not start a drag in the tab hidden underneath.
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    // Delegated rather than swallowed: the pause menu's Equipment tab drags gear
    // between the bag and the doll, and a drag is a press and a release, not a
    // click. Every other tab ignores these.
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseDown(mx, my, this.human, this.cat);
      return;
    }
    // Ahead of the blocking-overlay return below, which the picker's own
    // `isOpen` feeds into: without this branch a press on its step buttons
    // would never reach them.
    if (this.menus.itemQuantityPicker.isOpen) {
      this.menus.itemQuantityPicker.handlePointerDown(mx, my);
      return;
    }
    if (this.gameOver || this.isOverlayBlockingPointer) return;
    this.briarHollowKit?.handlePointerDown(mx, my);
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
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseMove(mx, my, this.human, this.cat);
      return;
    }
    if (this._miniMapDragging) {
      this.miniMap.pan(mx - this._miniMapDragLastX, my - this._miniMapDragLastY);
      this._miniMapDragLastX = mx;
      this._miniMapDragLastY = my;
    }
    this.menus.inventoryPanel.handleMouseMove(mx, my, this.menus.inventoryPlayer().inventory);
    this.menus.gearPanel.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseDown = false;
    this._miniMapDragging = false;
    this.briarHollowKit?.handlePointerUp();
    this.menus.itemQuantityPicker.handlePointerUp();
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleMouseUp(mx, my, this.human, this.cat);
      return;
    }
    if (this.gameOver || this.isOverlayBlockingPointer) return;
    this.menus.inventoryPanel.handleMouseUp(mx, my, this.menus.inventoryPlayer().inventory);
  }

  handleMouseLeave(): void {
    this._mouseDown = false;
    this.briarHollowKit?.handlePointerUp();
    this.menus.itemQuantityPicker.handlePointerUp();
    this._miniMapDragging = false;
    clearButtonMouseState();
  }

  handleContextMenu(mx: number, my: number): void {
    if (this.gameOver || this.menus.pauseMenu.isOpen || this.isOverlayBlockingPointer) return;
    this.menus.inventoryPanel.openContextMenu(mx, my, this.menus.inventoryPlayer().inventory);
  }

  handleWheel(deltaY: number): void {
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    if (this.menus.pauseMenu.isOpen) {
      this.menus.pauseMenu.handleWheel(deltaY);
      return;
    }
    if (this.followerMenu.isOpen) {
      this.followerMenu.handleWheel(deltaY);
      return;
    }
    this.noticeBoard?.handleWheel(deltaY);
    this.marketPanel?.handleWheel(deltaY);
    this.briarHollowKit?.handleWheel(deltaY);
  }

  update(): void {
    this.yieldCitizenDialogToInterruption();
    this.dismissCitizenDialogIfWalkedAway();
    this.dismissSignDialogIfWalkedAway();
    if (this.citizenDialogTarget !== null && this.citizenDialog?.isOpen !== true) {
      this.citizenDialogTarget.frozen = false;
      this.citizenDialogTarget = null;
    }
    aiAdapter.update();
    this.chat.update();
    this.citizenDialog?.update();
    this.signDialog?.update();
    if (this._companionErrorMsg !== null) {
      this._companionErrorMsg.framesLeft--;
      if (this._companionErrorMsg.framesLeft <= 0) {
        this._companionErrorMsg = null;
      }
    }
    this.achievementUI.tick();
    playRewardLandingCues(this.audio, this.rewardFly.update());
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
      this.silenceMovementLoops();
      this.bossIntro.tick();
      return;
    }

    // Spider quest ticks even while other systems are paused (keyboard hero must advance)
    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      const sqCtx = this.buildSystemContext();
      this.spiderQuest.update(sqCtx);
      this._processSpiderQuestSounds();
    }

    // A harvest does not outlast the pause menu: the block below stops ticking
    // under it, so without this the swing would pick straight back up on close.
    if (this.menus.pauseMenu.isOpen) this.gathering?.harvest.stopAll();
    // The village is not ticked under either, so its loops would play on unattended.
    if (this.menus.pauseMenu.isOpen || this.gameOver) this.briarHollowKit?.silenceLoops();

    // Town keeps living through citizen chats and other overlay dialogs — only a
    // hard stop (game over, the pause menu, or a level- or run-complete screen)
    // should freeze the streets.
    if (
      !this.gameOver &&
      !this.menus.pauseMenu.isOpen &&
      !this.levelCompleteScreen.isActive &&
      !this.runCompleteScreen.isActive
    ) {
      this.townLife?.update(this.buildSystemContext());
      this.briarHollowKit?.update(this.buildSystemContext());
      this.gathering?.update(this.buildSystemContext(), this.focusedOverlay !== null);
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

    // Ahead of the halt for the same reason: most conversations halt the
    // world, and he is to be seen talking through them.
    this.humanTalk.update(this.human, this.humanTalkSpeaker(), this.gameplayHalted);

    // The world stops under the death screen, but the fall he died in plays
    // out beneath it as it fades in.
    if (this.gameOver) this.human.tickReactionWhileDefeated();

    if (this.gameplayHalted) {
      this.silenceMovementLoops();
      this.marketPanel?.update();
      return;
    }
    this.gameStats.recordPlayedFrame();

    if (this.tutorial?.showNearGoblinDialog === true) {
      this.silenceMovementLoops();
      return;
    }
    if (this.tutorial?.showTutorialMordecaiDialog === true) {
      this.silenceMovementLoops();
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
      townProps:
        this.briarHollowKit !== null || this.gathering !== null
          ? [
              ...(this.townPropRenderables ?? []),
              ...(this.briarHollowKit?.renderEntities() ?? []),
              ...(this.gathering?.renderEntities() ?? []),
            ]
          : (this.townPropRenderables ?? undefined),
      gameOver: this.gameOver,
      pauseMenuOpen: this.menus.pauseMenu.isOpen,
      gore: this.combat.gore,
      bodyPartGore: this.combat.bodyPartGore,
      safeRoom: this.safeRoom,
      bossRoom: this.bossRoom,
      bossRoomDressings: this.bossRoomDressings,
      arenaRoom: this.arenaRoom,
      stairwell: this.stairwell,
      building: this.building,
      barriers: this.barriers,
      spells: this.combat.spells,
      dynamite: this.destruction.dynamite,
      smushFx: this.combat.smushFx,
      lavaBalls: this.lavaBalls,
      rockThrows: this.rockThrows,
      hirelingShots: this.hirelingShots,
      skeletonShots: this.skeletonShots,
      goblinArrows: this.goblinArrows,
      clownGas: this.clownGas,
      fairies: this.fairies,
      fairyFireballs: this.fairyFireballs,
      knightMissiles: this.knightMissiles,
      destructibles: this.destruction.destructibles,
      trees: this.trees,
      water: this.water,
      loot: this.destruction.loot,
      groundPickups: this.destruction.groundPickups,
      interactionPromptsAllowed: this.shouldShowInteractionPrompts(this.active()),
      treasureChests: this.treasureChests,
      miniMap: this.miniMap,
      mongoSystem: this.mongoSystem,
      mercenarySystem: this.mercenarySystem,
      crawlerBarks: this.crawlerBarks,
      speechBubblePulse: this.speechBubblePulse,
    };

    this.renderPipeline.renderWorld(ctx, rc);
    this.briarHollowKit?.renderGround(ctx, camX, camY);
    this.gathering?.renderGround(ctx, camX, camY);
    this.bopca.renderObjects(ctx, camX, camY, this.active(), this.inactive());
    this.tutorial?.renderGatesAndLedge(ctx, camX, camY);
    const activeCrawler = this.active();
    this.defendQuest.renderObjects(ctx, camX, camY, activeCrawler, activeCrawler);
    this.spiderQuest.render(ctx, camX, camY, this.active());
    this.circusQuest.render(ctx, camX, camY, this.active());
    this.murderQuest.render(ctx, camX, camY, this.active());
    // Puddles and telegraphs are floor paint, so players/mobs always appear on top of them
    for (const spider of this.grotesqueSpiders) {
      spider.renderSpitGroundTraps(ctx, camX, camY, TILE_SIZE);
      spider.renderGroundTelegraphs(ctx, camX, camY);
    }

    this.renderPipeline.renderEntities(ctx, rc);
    for (const spider of this.grotesqueSpiders) {
      spider.renderAboveEntities(ctx, camX, camY, [this.human, this.cat]);
    }
    this.murderQuest.renderWellClueOverlay(ctx, camX, camY, this.active());
    this.spiderQuest.renderLifeMachinesForeground(ctx, camX, camY, this.active());
    // Over every body in the lab and under every warning: the dark her roars
    // bring down, with her telegraphs, puddles and eggs drawn back over it.
    this.spiderQuest.renderLabDarkness(ctx, camX, camY, this.active());
    this.bossRoom.renderProjectiles(ctx, camX, camY);
    this.treasureChests.renderLootArrows(ctx, camX, camY);
    // Projectile renders after entities so it flies visually over mobs/players
    for (const spider of this.grotesqueSpiders) {
      spider.renderSpitProjectile(ctx, camX, camY, TILE_SIZE);
    }
    this.spiderQuest.renderCutsceneEffects(ctx, camX, camY);
    this.briarHollowKit?.renderAbove(ctx, camX, camY);
    this.gathering?.renderAbove(ctx, camX, camY);
    // Over the entities: a label spawned on a large body (a boss) would
    // otherwise rise out of sight behind its own sprite.
    this.combat.floatingText.render(ctx, camX, camY);

    this.chat.renderBubble(ctx, camX, camY);

    this.renderPipeline.renderTowerBalconyOverlay(ctx, rc);

    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) => {
      UIRenderer.renderLevelUpFlash(c, cx, cy, this.pm);
      UIRenderer.renderStatBoostFlash(c, cx, cy, this.pm);
    });

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
    const hudResult = drawHUD(
      ctx,
      this.human,
      this.cat,
      this.notifPulse,
      this._hudCollapsed,
      this.skillPointReminderActive,
      this.skillPointsSuppressed,
      {
        pendingAmount: this.rewardFly.pendingCoinAmount(),
        pulse: this.rewardFly.coinCounterPulse(),
      },
    );
    this._hudToggleRect = hudResult.toggleRect;
    this._hudRect = hudResult.hudRect;
    UIRenderer.setHudPanelRect(this._hudRect);
    if (!platform.isMobile) {
      this._hudSkillBannerRect = hudResult.notifRect;
    }
    this.briarHollowKit?.renderHud(ctx, this.miniMap, this._hudRect);
    if (this.briarHollowKit?.hidesResourceStrip(this.miniMap, this._hudRect) !== true) {
      this.gathering?.renderHud(ctx, this.miniMap, this._hudRect, this.active());
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
      this.mercenarySystem.renderDownedArrow(
        ctx,
        camX,
        camY,
        this.active(),
        visibilityRadiusPx(this.active()),
        this._hudRect,
      );
      this.renderStairwellRevealArrow(ctx, camX, camY);
      this.renderSpiderLabArrow(ctx, camX, camY);
      if (this.shouldShowBountyArrow()) {
        this.bounty?.renderArrow(ctx, this.active(), camX, camY, this._hudRect);
      }
      this.renderAvailableQuestBeacons(ctx, camX, camY);
      this.renderPinnedObjectiveBeacon(ctx, camX, camY);
      this.renderPinnedObjectiveArrow(ctx, camX, camY);
      this.recall.render(ctx, this.active(), camX, camY, this._hudRect);
    }

    if (!this.gameOver && !this.menus.pauseMenu.isOpen) {
      this.miniMap.escapeMarkerTile = this.doomsdayEscape.escapeMarkerTile;
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
        this.skillPointReminderActive,
        this.skillPointsSuppressed,
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

    // Told before anything in the right-hand column is placed — the chip just
    // below is the first — so the whole column lays out from this frame's HUD.
    this.syncColumnLayoutState();
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
      this.menus.syncPotionCooldownOverlay(invPlayer);
      // Keyed by item id rather than ability id — the stone is a plain item that
      // happens to have a cooldown; `renderSlot` falls back to the id for it.
      this.menus.inventoryPanel.abilityCooldowns.set('wayfinders_anchor', {
        current: this.recall.cooldownRemainingFrames,
        max: RECALL_COOLDOWN_FRAMES,
      });
      const mmSz = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
      this.menus.inventoryPanel.mmSize = mmSz;
      this.menus.inventoryPanel.bagBouncePulse = this.rewardFly.bagBouncePulse();

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
      const defences = this.briarHollowKit?.defences ?? null;
      this.buildButtonRect =
        defences?.buildButtonVisible === true
          ? UIRenderer.drawBuildButton(
              ctx,
              this.miniMap,
              defences.constructionMenuOpen,
              defences.buildButtonPulseSeconds,
            )
          : null;
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
          hasUnseenUpgrade: this.menus.inventoryPlayer().inventory.unseenUpgrades.size > 0,
          bagBouncePulse: this.rewardFly.bagBouncePulse(),
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
      const pickupPromptShown = this.renderGroundPickupPrompt(ctx, camX, camY);
      if (!pickupPromptShown) this.renderCitizenPrompt(ctx, camX, camY);
      this.bounty?.renderShadyOverlay(ctx, camX, camY, this.active());
      if (!pickupPromptShown) {
        this.renderPropPrompt(ctx, camX, camY);
        if (!this.earlierSpaceLinkClaims(this.active())) {
          this.briarHollowKit?.renderPrompt(ctx, camX, camY, this.active());
        }
        this.renderMongoPetPrompt(ctx, camX, camY);
        this.renderMercenaryPrompt(ctx, camX, camY);
      }
    }

    if (this.safeRoom.mordecaiDialogOpen) {
      this.safeRoom.renderMordecaiDialog(ctx);
    }

    this.bopca.renderDialog(ctx);

    this.bounty?.renderDialog(ctx);
    this.citizenDialog?.render(ctx);
    this.signDialog?.render(ctx);
    this.briarHollowKit?.renderDialog(ctx, camX, camY);
    this.grateSpikes.render(ctx, camX, camY);
    this.noticeBoard?.render(ctx);
    this.marketPanel?.render(ctx, this.active());
    this.fortuneTeller?.render(ctx, this.active());

    if (this.stairwell.menuOpen) {
      this.stairwell.renderMenu(ctx);
    }

    if (this.levelCompleteScreen.isActive) {
      this.levelCompleteScreen.render(ctx);
    }
    this.runCompleteScreen.render(ctx);

    if (this.building?.menuOpen) {
      this.building.renderMenu(ctx);
    }

    if (this.followerMenu.isOpen) {
      this.followerMenu.restrictedToButtonIndex = this.tutorial?.followerMenuRestriction ?? null;
      this.followerMenu.render(
        ctx,
        this.companion.getMovementMode(this.human.isActive),
        this.companion.getCombatStance(this.human.isActive),
        this.human.isActive,
        this.mongoSystem.unlocked ? settings.catAutoSummonsMongo : null,
      );
    }

    // The award stack, drawn lowest-priority first so that draw order matches
    // the order `overlayClaims` and `handleClick` rank these same surfaces in.
    // Whichever one is on top is then also the one that owns the keyboard's
    // focus ring and the one a click reaches. Were the three orders to
    // disagree, the topmost dialog would be visible but un-activatable.
    this.menus.renderOverlays(ctx);
    this.achievementUI.renderOverlays(ctx);
    if (this.chestRewardDialog.isOpen) {
      this.chestRewardDialog.render(ctx);
    }

    // Flies over every dialog above: it is reporting a grant that already
    // happened, not asking for input, so nothing on screen should be able to
    // hide it mid-flight.
    const coinTarget = hudCoinCounterScreenPos(this._hudCollapsed);
    this.rewardFly.render(ctx, {
      coinX: coinTarget.x,
      coinY: coinTarget.y,
      bagRect: platform.isMobile
        ? this.touch.bagBtnRect
        : this.menus.inventoryPanel.toggleBtnRect(),
    });

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
    if (this.briarHollowKit !== null) markers.push(...this.briarHollowKit.questMarkers);
    markers.push(...this.safeRoom.mordecaiMarkers);
    const pinned = resolvePinnedEntry(
      this.journalProgress.pinnedTrackerId,
      this._trackerEntries,
      this.activeTile,
    );
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
        this.doomsdayEscape,
        this.briarHollowKit,
      ]),
    );
    return entries;
  }

  /**
   * Refreshes and returns the shared per-frame system context: one mutable
   * object, and one `extraTargets` array, reused across every system and every
   * call in a frame rather than allocated afresh by each.
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
    this.briarHollowKit?.pushAlliedDefenders(targets);
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
      this.holdRestsOnStructure() ? null : this.touch.moveTarget,
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

    // Every map without a town plan answers false here, so dungeon floors never
    // take this path.
    const nowInTown = this.isInsideTownWall(player);
    if (nowInTown && !this.wasInTown) this.onTownEntered(player);
    this.wasInTown = nowInTown;

    const nowInBriarHollowSquare = this.isInBriarHollowSquare(player);
    if (nowInBriarHollowSquare && !this.wasInBriarHollowSquare) {
      this.onBriarHollowSquareEntered(player);
    }
    this.wasInBriarHollowSquare = nowInBriarHollowSquare;

    // A stairwell room that was already empty of hostiles the moment this
    // floor's mobs first spawned — no last guard to die and trigger the
    // `mobKilled` path — still earns its save on this, its first quiet visit.
    this.updateStairwellEntrySave(player);

    // After the safe-room and town checks, so an arrival that already stands
    // in one is saved once, by that check, rather than twice.
    if (this.arrivalSavePending) {
      this.arrivalSavePending = false;
      const onlyStaleSave =
        this.lastSave !== null && this.lastSave.progress === this.staleCarriedSave;
      if (this.lastSave === null || onlyStaleSave)
        this.captureSavePoint(this.saveTileUnder(player));
    }

    const ctx = this.buildSystemContext();

    this.safeRoom.update(ctx);
    this.tickSkillPointReminder(ctx);
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
    // Before `systemNotices`, so a notice queued this frame drains on this
    // same frame's toast pass rather than sitting a frame behind.
    this.tacticsNotices.update(ctx);
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
    this.briarHollowKit?.updateSiege(ctx);
    this.grateSpikes.update();
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
      // One cue however many trees land together: overlapping copies of the
      // same sample stack into a blast rather than a fall.
      this.audio?.playRandom(TREE_FALL_SOUNDS);
    }
    if (this.defendQuest.menuOpenSoundPending) {
      this.defendQuest.menuOpenSoundPending = false;
      this.audio?.play('menu_open');
    }
    if (this.defendQuest.woodPickupSoundPending) {
      this.defendQuest.woodPickupSoundPending = false;
      this.audio?.play('picking_up_ground_object');
    }
    this.circusQuest.update(ctx);
    this.murderQuest.update(ctx);
    this.anchorQuest.update();
    // She is a plaza prop, not a `Player`, so unlike every other quest giver
    // she has no `markerType` field of her own for the beacon to read.
    this.townProps?.setFortuneTellerMarker(this.anchorQuest.markerState);
    this.updateSpeedFizzDiscovery();
    this.doomsdayEscape.update(ctx);
    if (this.doomsdayEscape.pinRequested) {
      this.doomsdayEscape.pinRequested = false;
      this.journalProgress.pinnedTrackerId = DOOMSDAY_TRACKER_ID;
      // Not an auto-pin: the escape is the floor's own emergency, and must not
      // be quietly handed back to whatever quest is active when the next one
      // starts.
      this.journalProgress.pinSource = 'player';
    }
    if (this.doomsdayEscape.floorEscapedPending) {
      this.doomsdayEscape.floorEscapedPending = false;
      this.completeRun();
      // The run is saved and over: nothing else may act this frame, or a blow
      // landing after the save would raise a death screen under the celebration.
      return;
    }
    this.overworldMusic?.update(ctx);
    this.updateVillageAmbience(ctx.active);
    this.ambientSound?.update(ctx);
    this.bossRoomDressings.update(ctx);
    const colosseumCue = this.bossRoomDressings.parts.colosseum?.takeSoundCue() ?? null;
    if (colosseumCue !== null) this.audio?.play(colosseumCue);
    for (const cue of this.juicerRoom.drainSoundCues()) this.audio?.play(cue);
    for (const cue of this.bossRoomDressings.parts.krakaren?.drainSoundCues() ?? []) {
      this.audio?.play(cue.id, { volume: cue.volume });
    }
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
    setVisibleWorldView(cameraWorldView(this.camera(), clearSightOf(this.active())));
    this.combat.updateMobs(ctx);
    this.spiderQuest.updateImpactFeedback();
    for (const name of this.combat.spells.takeFogResistedNames()) {
      this.menus.announce(`${name} sees you through the fog`);
    }

    this.combat.drainMobAudioCues(this.audio);

    const activePlayer = this.active();
    const spiderWalkTriggerDist = TILE_SIZE * GROTESQUE_SPIDER_WALKING_TRIGGER_DISTANCE_TILES;
    const spiderWalkTriggerDistSq = spiderWalkTriggerDist * spiderWalkTriggerDist;
    let anySpiderWalkingNear = false;

    for (const spider of this.grotesqueSpiders) {
      const cancelledAttack = spider.drainCancelledAttackAudio();
      if (cancelledAttack === 'slam') this.audio?.stopSound('grotesque_spider_slam_attack');
      if (cancelledAttack === 'screech') this.audio?.stopSound('grotesque_spider_screech_attack');
      if (spider.slamSoundPending) {
        spider.slamSoundPending = false;
        this.audio?.play('grotesque_spider_slam_attack', { startOffset: SLAM_AUDIO_SEEK_SECONDS });
      }
      if (spider.screechSoundPending) {
        spider.screechSoundPending = false;
        this.audio?.play('grotesque_spider_screech_attack', {
          startOffset: SCREECH_AUDIO_SEEK_SECONDS,
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
      structures: this.briarHollowKit?.defences?.defense,
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
    this.mercenarySystem.checkHealth((merc) => this.combat.spawnKillGore(merc, null));
    this.combat.resolveKills();

    this.combat.resolveSpellAftermath();

    this.carryMongoIn();
    this.mongoSystem.update(ctx);
    this.autoSummonMongo(ctx);
    this.mercenarySystem.update(ctx);
    this.drainWardExplainerBarks();
    this.crawlerBarks.update();
    if (this.building?.menuOpen === true || this.recall.isChannelling) {
      this.mercenarySystem.warnIfLeavingDowned();
    }
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
    this.hirelingShots.update(ctx);
    // Summons first, so a skeleton raised this frame is already in `ctx.roster.mobs`
    // when the projectile system walks it. Neither ordering can strand a shot —
    // the drain reads the whole list every frame — but this one keeps a wave and
    // the bolts covering it on the same tick.
    this.skeletonSummons.update(ctx);
    this.fairies.update(ctx);
    this.skeletonShots.update(ctx);
    this.goblinArrows.update(ctx);
    this.clownGas.update(ctx);
    this.fairyFireballs.update(ctx);
    this.knightMissiles.update(ctx);
    this.trees?.update(ctx);
    this.destruction.update(ctx);
    this.destruction.drainAudioCues(this.audio);
    playFairySystemCues(this.fairies.takeCues(), this.audio);
    playFairyFireballCues(this.fairyFireballs.takeCues(), this.audio);
    playFrostCues([this.human, this.cat], this.audio);

    // The llama's own impact cue. It is drained here rather than from
    // `playMobAudioCues` because the ball outlives its llama, and a shot that
    // lands after the animal died has no mob left to carry the flag.
    if (this.lavaBalls.burstSoundPending) {
      this.lavaBalls.burstSoundPending = false;
      this.audio?.play('llama_fireball_explosion');
    }

    playHirelingProjectileCues(this.rockThrows, this.hirelingShots, this.audio);

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
      const framesBefore = this.levelTimerFrames;
      this.levelTimerFrames--;
      this.playLevelTimerCue(UIRenderer.levelTimerCue(framesBefore, this.levelTimerFrames));
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
      bus: this.bus,
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
      this.gameStats.recordDeath();
      this.barriers.cancelConstruct();
      const deathCause = resolveDeathCause(
        this.human,
        this.cat,
        this.levelDef.hasCollapseTimer === true,
        this.levelTimerFrames,
      );
      this.combat.deathScreen.activate(
        pickDeathExplanation(deathCause),
        respawnModeFor(respawnRouteFor(this.lastSave)),
      );
    }
  }

  private playLevelTimerCue(cue: UIRenderer.LevelTimerCue | null): void {
    if (cue === 'final_minute_heartbeat') {
      this.audio?.play('level_timer_final_minute_heartbeat');
    } else if (cue === 'five_minute_warning') {
      this.audio?.play('level_timer_warning', { playbackRate: FIVE_MINUTE_WARNING_PLAYBACK_RATE });
    } else if (cue === 'ten_minute_warning') {
      this.audio?.play('level_timer_warning');
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
    if (this.spiderQuest.levelMusicStopPending) {
      this.spiderQuest.levelMusicStopPending = false;
      this.audio?.stopMusic(KEYBOARD_HERO_MUSIC_HANDOVER_FADE_MS);
    }
    if (this.spiderQuest.levelMusicRestorePending) {
      this.spiderQuest.levelMusicRestorePending = false;
      this.audio?.playMusic(this.levelDef.music, { fadeInMs: MUSIC_FADE_IN_MS });
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
    if (this.spiderQuest.keyboardHeroHitTickPending) {
      this.spiderQuest.keyboardHeroHitTickPending = false;
      // A terminal keystroke, not a drum: the tick has to sit under the track
      // rather than compete with it, so it plays well below the SFX bed.
      this.audio?.play('typing_click', { volume: KEYBOARD_HERO_HIT_TICK_VOLUME });
    }
    if (this.spiderQuest.keyboardHeroPipShatterPending) {
      this.spiderQuest.keyboardHeroPipShatterPending = false;
      this.audio?.play('glass_break_1');
    }
    if (this.spiderQuest.keyboardHeroAccessGrantedPending) {
      this.spiderQuest.keyboardHeroAccessGrantedPending = false;
      this.audio?.play('new_unlock');
    }
    if (this.spiderQuest.cutsceneSpitFireSoundPending) {
      this.spiderQuest.cutsceneSpitFireSoundPending = false;
      this.audio?.play('grotesque_spider_spit_attack');
    }
    if (this.spiderQuest.cutsceneSpitImpactSoundPending) {
      this.spiderQuest.cutsceneSpitImpactSoundPending = false;
      this.audio?.play('grotesque_spider_spit_landing');
    }
    if (this.spiderQuest.cutsceneGoreSoundPending) {
      this.spiderQuest.cutsceneGoreSoundPending = false;
      this.audio?.play('flesh_being_sliced');
    }
    if (this.spiderQuest.eggLandSoundPending) {
      this.spiderQuest.eggLandSoundPending = false;
      this.audio?.play('splat_1');
    }
    if (this.spiderQuest.eggBurstSoundPending) {
      this.spiderQuest.eggBurstSoundPending = false;
      this.audio?.play('splat_2');
    }
    if (this.spiderQuest.eggHatchSoundPending) {
      this.spiderQuest.eggHatchSoundPending = false;
      this.audio?.play('splat_3');
    }
    const lab = this.spiderQuest.labDressing;
    if (lab?.glassShatterSoundPending === true) {
      lab.glassShatterSoundPending = false;
      this.audio?.play('glass_break_1');
    }
    if (lab?.cocoonSplatSoundPending === true) {
      lab.cocoonSplatSoundPending = false;
      this.audio?.play('splat_2');
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
        false,
        true,
      );
    }
    if (humanItems.length > 0) {
      this.destruction.loot.addLoot(
        cx,
        cy,
        { coins: 0, items: humanItems },
        this.human,
        isBossLoot,
        false,
        true,
      );
    }
    if (catItems.length > 0) {
      this.destruction.loot.addLoot(
        cx,
        cy,
        { coins: 0, items: catItems },
        this.cat,
        isBossLoot,
        false,
        true,
      );
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
        this.signDialog?.isOpen === true ||
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
    const villageShake = this.briarHollowKit?.cameraOffset ?? { x: 0, y: 0 };
    // Applied after the clamp so the sway can drift past the map edge rather than
    // being flattened to nothing whenever the camera is already against a border.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return {
      x:
        clamp(camX, 0, mapPxW - viewportWidth()) +
        shakeOffset.x +
        sway.x +
        smushShake.x +
        juicerShake.x +
        villageShake.x,
      y:
        clamp(camY, 0, mapPxH - viewportHeight()) +
        shakeOffset.y +
        sway.y +
        smushShake.y +
        juicerShake.y +
        villageShake.y,
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
        this.menus.rewardGrantedDialog.isShowing ||
        this.menus.mongoExplainer.isOpen ||
        this.menus.craftExplainers.isOpen ||
        this.levelCompleteScreen.isActive ||
        this.runCompleteScreen.isActive
      ) {
        this.handleClick(x, y, e.timeStamp);
        continue;
      }

      // The bag's Drop/Trade "how many?" prompt, ahead of every mobile HUD hit
      // test below: its step buttons sit over the same screen band as the bag,
      // build and minimap buttons, and a tap on one must neither press what's
      // drawn beneath it nor start hold-to-repeat on the wrong control.
      if (this.menus.itemQuantityPicker.isOpen) {
        this.menus.itemQuantityPicker.handlePointerDown(x, y);
        this.handleClick(x, y, e.timeStamp);
        continue;
      }

      // A village or grate panel owns every finger while it is up, for the same
      // reason: its rows sit over the Bag, Build and Journal buttons on a phone,
      // and a tap on one must neither press what is drawn beneath it nor start
      // a walk that re-aims the placement the row is about to build.
      if (this.briarHollowKit?.isMenuOpen === true || this.grateSpikes.isOpen) {
        this.briarHollowKit?.handlePointerDown(x, y);
        this.handleClick(x, y, e.timeStamp);
        continue;
      }

      // The follower menu covers the whole screen, so it owns every finger — a
      // tap must not reach the HUD buttons drawn beneath it. Its rows scroll
      // under a drag, so the release decides whether the press was a click.
      if (this.followerMenu.isOpen) {
        this.followerMenu.touchStart(touch.identifier, x, y);
        continue;
      }

      if (this.menus.gearPanel.hitsPanel(x, y)) {
        this.handleClick(x, y, e.timeStamp);
        continue;
      }

      const coveredByPanel = this.menus.panelCovers(x, y);

      if (platform.isMobile && !this.menus.pauseMenu.isOpen && !coveredByPanel) {
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
        !coveredByPanel &&
        this.menus.tryOpenSpendScreen(x, y, this._hudSkillBannerRect)
      ) {
        continue;
      }

      if (platform.isMobile && !this.gameOver && !this.menus.pauseMenu.isOpen && !coveredByPanel) {
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

      if (platform.isMobile && !this.gameOver && !this.menus.pauseMenu.isOpen && !coveredByPanel) {
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
        !coveredByPanel &&
        this.journalButtonRect !== null &&
        pointInRect(x, y, this.journalButtonRect)
      ) {
        notifyButtonClick(x, y);
        this.openQuestJournal();
        continue;
      }
      // The Build button, for the same reason as the compass above.
      if (
        platform.isMobile &&
        !this.gameOver &&
        !this.menus.pauseMenu.isOpen &&
        !coveredByPanel &&
        this.buildButtonRect !== null &&
        pointInRect(x, y, this.buildButtonRect)
      ) {
        notifyButtonClick(x, y);
        this.briarHollowKit?.openConstruction();
        continue;
      }

      if (
        platform.isMobile &&
        !this.menus.pauseMenu.isOpen &&
        !coveredByPanel &&
        this.mongoSystem.canShow &&
        this.cat.isActive
      ) {
        const mb = this.touch.summonBtnRect;
        if (pointInRect(x, y, mb)) {
          if (!this.gameOver) this.toggleMongoSummon();
          continue;
        }
      }

      if (platform.isMobile && !this.menus.pauseMenu.isOpen && !coveredByPanel) {
        const sb = this.touch.switchBtnRect;
        if (pointInRect(x, y, sb)) {
          if (!this.gameOver) this.triggerSwitchCharacter();
          continue;
        }
        const fb = this.touch.followBtnRect;
        if (pointInRect(x, y, fb)) {
          if (!this.gameOver) this.triggerCompanionFollow();
          continue;
        }
      }

      if (!this.menus.pauseMenu.isOpen && !this.gameOver && !coveredByPanel) {
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
        // Mordecai's dialog is deliberately absent: it is a floating claim the
        // player is meant to walk out of, and walking is tap-to-move, so routing
        // its touches straight to `handleClick` left a phone player unable to
        // end the conversation at all. A tap on his box still advances it there.
        this.bopca.isDialogOpen ||
        this.spiderQuest.isDialogOpen ||
        this.circusQuest.isDialogOpen ||
        this.murderQuest.isDialogOpen ||
        this.anchorQuest.isDialogOpen ||
        this.citizenDialog?.isOpen === true ||
        this.signDialog?.isOpen === true ||
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
        const isDynamiteSlot =
          dynIdx >= 0 && this.human.inventory.actionBar.slots[dynIdx]?.id === 'goblin_dynamite';
        if (isDynamiteSlot && this.human.canAct) {
          if (this.destruction.dynamite.beginCharge(dynIdx, this.human)) {
            this.touch.dynamiteTouchId = touch.identifier;
          } else {
            refuseDynamiteInSafeRoom(this.hotbarHost());
          }
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
        this.structureHold.begin(this.fingerOnWorkableStructure(x, y), x, y);
        const starter = this.active();
        this.holdStartActivePos = { x: starter.x, y: starter.y };
        this.menus.pauseMenu.touchScrollStart(x, y, this.human, this.cat);
      }
    }
  }

  handleTouchMove(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (this.followerMenu.touchMove(touch.identifier, x, y)) continue;

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
    // Any lifted finger ends a held picker step; a picker's own buttons never
    // start a move or a drag, so there is nothing else to match it to.
    this.briarHollowKit?.handlePointerUp();
    this.menus.itemQuantityPicker.handlePointerUp();
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const followerMenuTouch = this.followerMenu.touchEnd(touch.identifier);
      if (followerMenuTouch !== null) {
        if (followerMenuTouch === 'tap') this.handleClick(x, y, e.timeStamp);
        continue;
      }

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
        this.destruction.dynamite.release(this.human);
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
              this.destruction.dynamite.release(this.human);
              this.bus.emit('dynamiteUsed', { player: 'Human' });
            } else {
              // Captured before `handleClick`, which may turn the last page of
              // a dialog and close it: without this the same tap falls through
              // to `triggerSpaceAction` and starts the conversation again
              // (the player is still in range), which is the close-then-reopen trap.
              const dialogWasOpen =
                this.safeRoom.mordecaiDialogOpen ||
                this.citizenDialog?.isOpen === true ||
                this.signDialog?.isOpen === true ||
                this.briarHollowKit?.isConversationOpen === true;
              // Also captured first: a menu or dialog that owned the screen had
              // this tap, and the village behind it must not open a
              // conversation or pet a cow underneath it.
              const overlayWasFocused = this.focusedOverlay !== null;
              this.handleClick(x, y, e.timeStamp);
              if (!dialogWasOpen && !this.menus.pauseMenu.isOpen && !this.gameOver) {
                const cam = this.camera();
                let villageConsumed = false;
                if (this.briarHollowKit !== null && !overlayWasFocused) {
                  const now = Date.now();
                  const isDoubleTap =
                    this.briarHollowLastWorldTapAt !== null &&
                    now - this.briarHollowLastWorldTapAt < BRIAR_HOLLOW_DOUBLE_TAP_WINDOW_MS;
                  this.briarHollowLastWorldTapAt = now;
                  villageConsumed = isDoubleTap
                    ? this.briarHollowKit.handleDoubleTap(x, y, cam.x, cam.y, this.active())
                    : this.briarHollowKit.handleTap(x, y, cam.x, cam.y, this.active());
                }
                // A tap a menu took is spent: the world behind it must not also swing at it.
                if (!villageConsumed && !overlayWasFocused) {
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
          } else if (
            elapsed >= MENU_TAP_DURATION_MS &&
            moved < MENU_TAP_MAX_DISTANCE &&
            !this.crawlerWalkedDuringHold()
          ) {
            // Held roughly in place past tap duration, rather than dragged — and
            // without the hold having walked the crawler, which is just the end
            // of a walk with the finger resting somewhere: the Structure menu's
            // gesture. A village structure under the finger
            // wins; otherwise a boarded grate in reach, for a crawler who can
            // spike it. With neither, the press means nothing, as it always has.
            const cam = this.camera();
            const villageTook =
              this.briarHollowKit?.handleLongPress(x, y, cam.x, cam.y, this.active()) === true;
            if (!villageTook) this.grateSpikes.tryOpen();
          }
        }
        this.menus.pauseMenu.touchScrollEnd(x, y, this.human, this.cat);
        this.touch.moveTouchId = null;
        this.touch.moveTarget = null;
        this.touch.tapStart = null;
        this.structureHold.end();
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

  /**
   * Where the one Carl is in conversation with stands, while a conversation
   * with somebody is open; null otherwise. Only the conversations whose
   * speaker this scene can place — a townsperson, Mordecai, the defend-quest
   * giver.
   */
  private humanTalkSpeaker(): Pt | null {
    const citizen = this.citizenDialogTarget;
    if (this.citizenDialog?.isOpen === true && citizen !== null) return citizen;
    const mordecai = this.safeRoom.speakingMordecaiPosition;
    if (mordecai !== null) return mordecai;
    if (this.defendQuest.isDialogOpen) return this.defendQuest.questNPC;
    const villager = this.briarHollowKit?.humanTalkSpeaker() ?? null;
    if (villager !== null) return villager;
    return null;
  }

  /**
   * Hands over what is inside a chest the moment it is opened, and returns
   * what its reward dialog is to show and what dismissing that dialog grants
   * (the Mongo unlock, the tutorial's cat reward). The dialog only previews
   * the loot already handed over, so showing it never grants twice.
   */
  private grantChestContents(chest: TreasureChest): ChestReward {
    const tutorial = this.tutorial;
    if (tutorial !== null && tutorial.state === 'CAT_INSIDE_TREASURE_ROOM') {
      return {
        split: {
          humanLoot: { coins: 0, items: [] },
          catLoot: {
            coins: 0,
            items: [
              { id: 'magic_missile_tome', quantity: 1 },
              { id: 'health_potion', quantity: TUTORIAL_CHEST_CAT_POTIONS },
            ],
          },
          displayLabels: { magic_missile_tome: 'Magic Missile Ability' },
        },
        onDismissed: () => {
          tutorial.onCatRewardDialogDismissed(this.cat);
          this.bus.emit('rewardGranted', {
            rewards: [this._makeAbilityReward('magic_missile')],
          });
        },
      };
    }

    const baseSplit = chest.loot !== null ? splitChestLoot(chest.loot) : null;
    this._grantChestLootSplit(baseSplit);
    this.tutorial?.onChestOpened();

    if (chest.bossRoomIndex !== null && chest.bossRoomIndex === this.krakarenBossRoomIdx) {
      return {
        split: {
          humanLoot: baseSplit?.humanLoot ?? { coins: 0, items: [] },
          catLoot: baseSplit?.catLoot ?? { coins: 0, items: [] },
          customCatEntries: ['Mongo (pet)'],
        },
        onDismissed: () => {
          this.mongoSystem.unlocked = true;
          this.bus.emit('rewardGranted', { rewards: [this._makeMongoReward()] });
          // Only this first grant explains him: the circus quest hands back a pet
          // the player already knows, and the Abilities tab reopens it on request.
          this.menus.rewardGrantedDialog.afterQueueDrains(() => this.menus.mongoExplainer.open());
        },
      };
    }

    if (chest.bossRoomIndex !== null && chest.bossRoomIndex === this.juicerBossRoomIdx) {
      return {
        split: {
          humanLoot: baseSplit?.humanLoot ?? { coins: 0, items: [] },
          catLoot: baseSplit?.catLoot ?? { coins: 0, items: [] },
          customHumanEntries: [DESPERADO_TATTOO_REWARD_LABEL],
        },
      };
    }

    return { split: baseSplit };
  }

  /** A chest's lid is up: show what came out of it. */
  private showChestReward(chest: TreasureChest, reward: ChestReward): void {
    // The loot was already granted the moment the chest was pressed
    // (`grantChestContents`); this only shows it, so the fly is queued here and
    // held until the dialog the player is looking at actually closes. Kept as
    // its own handle (not shared with any other hold) so a `restoreFromCheckpoint`
    // that rewinds this exact chest can cancel only this queue.
    const flyHold = this.rewardFly.hold();
    this.chestRewardFlyHold = flyHold;
    const dialogCenter = { x: viewportWidth() / 2, y: viewportHeight() / 2 };
    const split = reward.split;
    if (split !== null) {
      this.rewardFly.enqueueCoins(split.humanLoot.coins, dialogCenter.x, dialogCenter.y, flyHold);
      this.rewardFly.enqueueCoins(split.catLoot.coins, dialogCenter.x, dialogCenter.y, flyHold);
      for (const item of [...split.humanLoot.items, ...split.catLoot.items]) {
        this.rewardFly.enqueueItem(
          item.id,
          ITEM_DEF[item.id].name,
          dialogCenter.x,
          dialogCenter.y,
          flyHold,
        );
      }
    }
    this.chestRewardDialog.open(chest, reward.split, () => {
      this.rewardFly.release(flyHold);
      this.chestRewardFlyHold = null;
      reward.onDismissed?.();
    });
    this.audio?.play('opening_treasure_chest');
  }

  /** Flies a quest's coin reward from the active crawler's own position. */
  private flyQuestCoins(coins: number): void {
    const active = this.active();
    const cam = this.camera();
    this.rewardFly.enqueueCoins(coins, active.x - cam.x, active.y - cam.y);
  }

  /** Flies a quest's item reward from the active crawler's own position. */
  private flyQuestItem(id: ItemId): void {
    const active = this.active();
    const cam = this.camera();
    this.rewardFly.enqueueItem(id, ITEM_DEF[id].name, active.x - cam.x, active.y - cam.y);
  }

  /** From a ground pile's world position, to wherever the HUD's coin/bag targets sit this frame. */
  private flyLootReward(loot: PendingLoot): void {
    const cam = this.camera();
    const screenX = loot.x - cam.x;
    const screenY = loot.y - cam.y;
    this.rewardFly.enqueueCoins(loot.loot.coins, screenX, screenY);
    for (const item of loot.loot.items) {
      this.rewardFly.enqueueItem(item.id, ITEM_DEF[item.id].name, screenX, screenY);
    }
  }

  private _grantChestLootSplit(split: { humanLoot: LootDrop; catLoot: LootDrop } | null): void {
    if (split === null) return;
    for (const item of split.humanLoot.items) {
      this.human.inventory.addItem(item.id, item.quantity);
    }
    this.human.earnCoins(split.humanLoot.coins);
    for (const item of split.catLoot.items) {
      this.cat.inventory.addItem(item.id, item.quantity);
    }
    this.cat.earnCoins(split.catLoot.coins);
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

  private updateVillageAmbience(listener: Pick<Player, 'x' | 'y'>): void {
    const emitter = this.villageAmbientEmitter;
    if (emitter === null) return;
    const inVillage = this.gameMap.isInBriarHollow(listener.x, listener.y);
    emitter.maxVolume = inVillage ? VILLAGE_AMBIENT_VOLUME : 0;
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
