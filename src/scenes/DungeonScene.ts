import { TRASH_PILE_ROACH_BURST } from '../systems/bossSoundCues';
import { ABILITY_DEFS } from '../abilities/abilityDefs';
import { labApproachZoneAt } from '../map/labApproach';
import { VILLAGE_CUES } from '../audio/villageSoundCues';
import { forwardQuestItemEvictions } from '../systems/questItemEvictions';
import { forwardEquipmentChanges } from '../systems/equipmentChangeEvents';
import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/input/InputManager';
import { platform } from '../core/input/Platform';
import { TILE_SIZE } from '../core/constants';
import { clamp, frameTime } from '../utils';
import {
  renderEntityTooltip,
  renderHealthVignette,
  renderLevelUpFlash,
  renderStatBoostFlash,
} from '../systems/worldEffects';
import type {
  DockButtonModel,
  HudModel,
  HudViewState,
  MinimapModel,
  SkillPointsModel,
} from '../ui/hud/hudModel';
import { HudSurface, surfacesOverHud, toCssRect } from '../ui/hud/HudSurface';
import { inventoryTabRect, itemMenuEntryRects } from '../ui/screens/inventory/renderInventory';
import type { Rect } from '../ui/core/geom';
import { levelTimerCue, type LevelTimerCue } from '../ui/hud/levelTimer';
import { promptSurface } from '../ui/hud/prompt';
import type { TopBandEntry } from '../ui/hud/topBand';
import { hotbarPressInput, hotbarSlotModels } from '../systems/kits/hudHotbar';
import { interiorRoomOwnedByStory } from '../systems/interiorStoryOwnership';
import { GameMap } from '../map/GameMap';
import { DEFAULT_DUNGEON_FLOOR_THEME, setDungeonFloorTheme } from '../map/dungeon/floorTheme';
import type { GameProgressInput } from '../auth/AuthClient';
import { WORLD_GENERATOR_VERSION } from '../core/save/SavedWorld';
import { setFloorArtSeed } from '../map/ground/floorArtSeed';
import { prepareGroundTone } from '../map/tiles/groundTiles';
import { groundSheetKeysAmong, requestGroundSheets } from '../map/ground/runtimeGroundSheets';
import { releaseEnvironmentArt } from '../map/environmentArtCache';
import { requestEnvironmentSheetsForGroups } from '../sprites/sheets/environmentSheets';
import { type HumanPlayer } from '../creatures/HumanPlayer';
import { type CatPlayer } from '../creatures/CatPlayer';
import { despawnMob, type Mob, type LootDrop } from '../creatures/Mob';
import type { Player } from '../Player';
import { PlayerManager } from '../core/party/PlayerManager';
import { setSkillBookReaders } from '../creatures/skillBookDrop';
import { TouchMoveState } from '../core/input/TouchMoveState';
import type { LevelDef, MobLevelRange } from '../levels/types';
import type { MobKind } from '../levels/mobKinds';
import { liveSpawnContext, spawnMob } from '../levels/spawnFunnel';
import { floorEncounter } from '../levels/encounters';
import { NO_SPAWN_TERRAIN } from '../map/overworld/spawnTerrain';
import {
  spawnForLevel,
  spawnExtraMobs,
  spawnTreasureRoomMobs,
  partyLevelOf,
  pickRule,
  recommendedPartyLevelFor,
  resolveAmbientLevel,
} from '../levels/spawner';
import {
  activeDifficultyProfile,
  applySpawnDifficulty,
  DIFFICULTY_LABELS,
  DIFFICULTY_PROFILES,
  type Difficulty,
} from '../core/difficulty/difficultyProfiles';
import { setFloorReferencePartyLevel } from '../core/difficulty/floorReferenceLevel';
import {
  getSpriteMissCounts,
  prewarmGroups,
  releaseSpritesExcept,
} from '../core/spriteAssets/SpriteLoader';
import { flushFigureFrameCache } from '../sprites/figure/figureFrameCache';
import { requiredSpriteKeysForLevel } from '../core/spriteAssets/systemAssetRequirements';
import { getLevelDef, levelLoadingKicker } from '../levels';
import { dungeonOptionsForLevel } from '../levels/dungeonOptions';
import { TUTORIAL_LEVEL_ID } from '../levels/tutorial';
import { LevelCompleteScreen } from '../ui/screens/dialogs/LevelCompleteScreen';
import {
  buildRunSummary,
  countPartyAchievements,
  finishRun,
  RunCompleteScreen,
} from '../ui/screens/dialogs/RunCompleteScreen';
import { TitleScene } from './title/TitleScene';
import { MENU_TAP_MAX_DISTANCE } from '../ui/core/pointer';
import {
  PAUSE_SURFACE_ID,
  type PauseFrame,
  type PauseScreen,
} from '../ui/screens/pause/PauseScreen';
import { isStatSpendButtonOf, statSpendButtonId } from '../ui/screens/pause/characterSection';
import { SpellSystem } from '../systems/SpellSystem';
import type { InventoryItem } from '../core/items/defs/ItemDefs';
import {
  ACHIEVEMENT_DEFS,
  AchievementManager,
  DYNAMITE_MULTIKILL_THRESHOLD,
  MULTIKILL_ACHIEVEMENT_THRESHOLD,
} from '../core/progression/AchievementManager';
import { presentationAwardId, type RewardPresentation } from '../loot/rewardChest';
import { partyOwnsGear, rollKillGear, withGearLoot, type GearId } from '../loot/gearPools';
import { AchievementUISystem } from '../systems/AchievementUISystem';
import { AchievementAwards } from '../systems/AchievementAwards';
import {
  deinonychusPortrait,
  introduceDeinonychus,
  joinDeinonychusOnOpen,
  presentsDeinonychus,
} from '../systems/deinonychusArrival';

import { MiniMapSystem, type QuestMarkerType } from '../systems/MiniMapSystem';
import {
  captureJournalProgress,
  createJournalProgress,
  restoreJournalProgress,
  type JournalProgress,
} from '../core/quests/JournalProgress';
import {
  ARROW_PRIORITY,
  drawArrowAbovePlayer,
  drawTopArrowCandidate,
  isWorldPointOnScreen,
  OBJECTIVE_ARROW_SUPPRESS_TILES,
  type ArrowCandidate,
} from '../ui/WorldArrow';
import { drawObjectiveBeacon } from '../ui/ObjectiveBeacon';
import { WorldTrail } from '../ui/world/worldTrail';
import { QuestRouteGuide } from '../systems/questRoute/QuestRouteGuide';
import { crawlerGroundPoint, crawlerSpriteBox } from '../systems/questRoute/routeOrigin';
import {
  objectiveBeamTargets,
  characterTarget,
  collectTrackerEntries,
  isOutstanding,
  pinMatchesEntry,
  resolvePinnedEntry,
  type ObjectiveBeaconSource,
  type TrackerEntry,
  type TrackerTarget,
} from '../systems/questTracker';
import {
  buildContractWorld,
  CONSTRUCTION_CONTRACT_QUEST_ID,
  releaseContractAutoPinOnEnd,
} from '../systems/constructionContracts/contractQuest';
import {
  issueNextContract,
  noticeBoardMarkerFor,
  workOrderStateFor,
} from '../systems/constructionContracts/contractIssue';
import { contractContactName } from '../systems/constructionContracts/contractContacts';
import { playContractCue } from '../systems/constructionContracts/contractSoundCues';
import { WORK_ORDERS } from '../dialog/scripts/workOrders';
import { isVillageUnderSiege } from '../core/quests/villageQuestPhase';
import { playInteriorCue } from '../systems/interiorInteractionSoundCues';
import { SafeRoomSystem, type SafeRoomInfo } from '../systems/SafeRoomSystem';
import { DaveGuideSystem, DaveWhereabouts } from '../systems/DaveGuideSystem';
import { sameSafeRoom, type SafeRoomId } from '../map/safeRoomId';
import { SkillPointReminderSystem } from '../systems/SkillPointReminderSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { TacticsNoticeSystem } from '../systems/TacticsNoticeSystem';
import type { TacticsTrait } from '../creatures/tactics/tacticsTraits';
import { isEngagedInFight } from '../creatures/tactics/tacticalFrame';
import { crawlerName } from '../characters/characters';
import { CRAWLER_KINDS } from '../core/skills/SkillManager';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { BossRoomSystem, BOSS_META } from '../systems/BossRoomSystem';
import { LavaBallSystem } from '../systems/LavaBallSystem';
import { RockThrowSystem } from '../systems/RockThrowSystem';
import { HirelingShotSystem } from '../systems/HirelingShotSystem';
import { playHirelingProjectileCues } from '../systems/hirelingProjectileCues';
import { bindAbilityLevelUps } from '../systems/abilityLevelUps';
import { bindCraftLevelUps } from '../systems/craftLevelUps';
import { SkeletonProjectileSystem } from '../systems/SkeletonProjectileSystem';
import { GoblinArrowSystem } from '../systems/GoblinArrowSystem';
import { GoblinBombSystem } from '../systems/GoblinBombSystem';
import { ExplosionShake } from '../systems/ExplosionShake';
import { BOMBER_GOBLIN_CUES, FuseSizzleLoops } from '../systems/bomberGoblinSoundCues';
import { SkeletonSummonSystem } from '../systems/SkeletonSummonSystem';
import { ClownGasSystem } from '../systems/ClownGasSystem';
import { FairySystem } from '../systems/FairySystem';
import { FairyFireballSystem } from '../systems/FairyFireballSystem';
import {
  playFairyFireballCues,
  playFairySystemCues,
  playFrostCues,
} from '../systems/fairyAudioCues';
import { FAIRY_KINDS } from '../sprites/art/fairyTiming';
import {
  createFairy,
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
import { safeRoomPressLeavesSpeaker, safeRoomSpeakerFor } from '../systems/safeRoomSpeaker';
import { ALL_BREAKABLE_PROPS, NO_BREAKABLE_PROPS } from '../systems/DestructiblePropSystem';
import { MenusKit } from '../systems/kits/MenusKit';
import { ChatKit, type ChatCommand } from '../systems/kits/ChatKit';
import { CutsceneKit } from '../systems/kits/CutsceneKit';
import { walkUpTo } from '../systems/cutscene/walkUp';
import type { WalkToStep } from '../systems/cutscene/cutsceneSteps';
import {
  activateHotbarSlot,
  drinkAnyHealthPotion,
  releaseChargedDynamite,
  throwReadiedDynamiteAt,
  type HotbarHost,
} from '../systems/kits/hotbarActions';
import { MobRoster, type SceneWorld } from '../systems/kits/SceneWorld';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../systems/mobCheckpoint';
import { deadFairyUpgradeBosses, replayFairyRateUpgrades } from '../systems/fairyUpgradeBosses';
import {
  CompanionSystem,
  createCompanionStanceState,
  type CompanionStanceState,
} from '../systems/CompanionSystem';
import { StairwellSystem } from '../systems/StairwellSystem';
import {
  RECALL_COOLDOWN_FRAMES,
  RecallSystem,
  type RecallCheckpoint,
} from '../systems/RecallSystem';
import { TravelMenu } from '../ui/TravelMenu';
import {
  recordCircusGroundsVisit,
  TRAVEL_LANDING_SEARCH_TILES,
  TRAVEL_LANDING_STANDOFF_TILES,
  type TravelUnlockState,
} from '../systems/travel/travelDestinations';
import { BuildingSystem, downedPartnerEntryRefusal } from '../systems/BuildingSystem';
import type { BuildingEntry } from '../map/buildingEntry';
import { interiorSellsSomething } from '../systems/townServices';
import { TownLifeSystem } from '../systems/TownLifeSystem';
import { CrowdResidentSet } from '../systems/CrowdResidentSet';
import {
  EnvironmentSheetResidentSet,
  environmentSheetPlacements,
  FACADE_LIFE_RING,
  FACADE_RING,
} from '../systems/EnvironmentSheetResidentSet';
import {
  WorldResidency,
  tileFocus,
  type ResidencyFocus,
  type ResidencyOutlook,
} from '../systems/WorldResidency';
import type { Townsperson } from '../creatures/Townsperson';
import { CITIZEN_TALK_RADIUS_TILES } from '../creatures/townInteraction';
import { unpinCitizenTalk } from '../creatures/citizenFigure';
import { prewarmAndPinTownspersonTalk } from '../creatures/townspersonBody';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { TownDecorSystem } from '../systems/TownDecorSystem';
import { TownPropSystem } from '../systems/TownPropSystem';
import { CRAWLER_SIGN_READ_RADIUS_TILES, CrawlerSignSystem } from '../systems/CrawlerSignSystem';
import { signLine } from '../dialog/scripts/crawlerSigns';
import type { CrawlerSignPlacement } from '../map/crawlerSigns';
import { MarketSystem, type MarketBrowse } from '../systems/market/MarketSystem';
import type { TownPropRenderable } from '../systems/townPropRenderable';
import {
  captureShopStock,
  createShopStock,
  restoreShopStock,
  tickShopStock,
  type ShopStock,
} from '../economy/shopStock';
import {
  buildCitizenConversation,
  citizenSpecies,
  type TownDialogContext,
} from '../systems/townDialog';
import {
  buildTownNotices,
  buildVillageNotices,
  type TownNoticeContext,
} from '../systems/townNotices';
import {
  NoticeBoard,
  VILLAGE_TITLE,
  type NoticeBoardAction,
} from '../ui/screens/dialogs/NoticeBoard';
import { ShopSession } from '../ui/screens/shop/shopSession';
import { shopScreenSurface } from '../ui/screens/shop/ShopScreen';
import { priceBreakdownsShown } from '../ui/screens/shop/priceBreakdowns';
import { FortuneTable, fortuneScreenSurface } from '../ui/screens/shop/FortuneScreen';
import {
  drawInteractionPromptOver,
  interactionPromptsDrawnThisFrame,
  setInteractionPromptsSuppressed,
} from '../ui/InteractionPrompt';
import type { GymRoomSystem } from '../systems/GymRoomSystem';
import {
  BossRoomDressings,
  buildColosseumDressing,
  buildGauntletRoomDressings,
  registerBossRoomMoodLights,
} from '../systems/bossRooms/BossRoomDressings';
import { ArenaRoomSystem } from '../systems/ArenaRoomSystem';
import { BarrierSystem } from '../systems/BarrierSystem';
import { ArenaSystem } from '../systems/ArenaSystem';
import { type TreasureChest, TreasureChestSystem } from '../systems/TreasureChestSystem';
import { HumanTalkDriver } from '../creatures/humanGestures';
import { type Pt } from '../sprites/art/bipedArt';
import type { ChestLootSplit } from '../ui/ChestRewardDialog';
import { ChestKit, forcedRecipientFor, type ChestReward } from '../systems/kits/ChestKit';
import { ConfirmDialog } from '../ui/screens/dialogs/ConfirmDialog';
import { deathScreenSurface } from '../ui/screens/dialogs/deathScreen';
import { nearGoblinHintSurface } from '../ui/screens/dialogs/nearGoblinHint';
import { defendTutorialSurface } from '../ui/screens/dialogs/defendTutorial';
import { stairwellPromptSurface } from '../ui/screens/dialogs/stairwellPrompt';
import { buildingEntryPromptSurface } from '../ui/screens/dialogs/buildingEntryPrompt';
import { ActivityDifficultyGate } from '../ui/screens/dialogs/activityDifficultyPicker';
import { keyboardHeroSurface } from '../ui/screens/dialogs/keyboardHeroSurface';
import { spiderTutorialSurface } from '../ui/screens/dialogs/spiderTutorial';
import { hackFailedPromptSurface } from '../ui/screens/dialogs/hackFailedPrompt';
import { RewardFlySystem } from '../systems/RewardFlySystem';
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
  withoutIncurableStatuses,
  type PlayerSnapshot,
} from '../core/save/PlayerSnapshot';
import type { LevelCheckpoint } from '../core/save/LevelCheckpoint';
import {
  carriedSaveRegeneratesFloor,
  owesArrivalSave,
  respawnModeFor,
  respawnRouteFor,
  savePointAfterWrite,
  type SavePoint,
} from '../core/save/SavePoint';
import { progressForRespawn, sceneSetupFromSave } from './resumeFromSave';
import { type TilePoint } from '../map/town/townPlan';
import type { WorldCheckpoint } from '../core/save/WorldCheckpoint';
import {
  toPersistedArenaCheckpoint,
  fromPersistedArenaCheckpoint,
  toPersistedTreasureChestCheckpoint,
  fromPersistedTreasureChestCheckpoint,
  toPersistedDefendQuestCheckpoint,
  fromPersistedDefendQuestCheckpoint,
  toPersistedSpiderQuestCheckpoint,
  fromPersistedSpiderQuestCheckpoint,
  toPersistedMurderMysteryQuestCheckpoint,
  fromPersistedMurderMysteryQuestCheckpoint,
  toPersistedBountyCheckpoint,
  fromPersistedBountyCheckpoint,
  type PersistedWorldState,
} from '../core/save/PersistedWorldState';
import { assertNoFieldsLeft } from '../core/util/guards';
import { BossIntroSystem } from '../systems/BossIntroSystem';
import { DungeonIntroSystem } from '../systems/DungeonIntroSystem';
import { TreeSystem } from '../systems/TreeSystem';
import { WaterAnimationSystem } from '../systems/WaterAnimationSystem';
import { AbilityManager, perkText, type AbilityId } from '../core/skills/AbilityManager';
import { FollowerScreen } from '../ui/screens/follower/FollowerScreen';
import { MAGIC_MISSILE_SPARK_LEVEL } from '../abilities/magicMissile';
import { getDeinonychusStats } from '../abilities/deinonychus';
import {
  captureDeinonychusPetState,
  createDeinonychusPetState,
  restoreDeinonychusPetState,
  type DeinonychusPetState,
} from '../core/state/DeinonychusPetState';

import type { GrantedReward } from '../core/items/loot/GrantedReward';
import { EventBus } from '../core/EventBus';
import { CrawlerBarkSystem } from '../systems/CrawlerBarkSystem';
import { siegeHudKeepouts } from '../ui/hud/siegeBellAlert';
import { barkWhenBlueprintsItemEvicted } from '../systems/briarHollow/blueprints/blueprintsEvictionBark';
import { CRAWLER_BARKS, barkTexts } from '../dialog/scripts/crawlerBarks';
import { isWardExplainerDue } from '../creatures/fairies/ShieldFairy';
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
import { intoxicationCameraOffset } from '../core/combat/Intoxication';
import {
  captureStarlightTentProgress,
  createStarlightTentProgress,
  restoreStarlightTentProgress,
  type StarlightTentProgress,
} from '../core/state/StarlightTentProgress';
import {
  FloorSfxGates,
  groupsActiveAnywhere,
  type FloorSfxGate,
  type OverworldActivity,
} from '../systems/FloorSfxGates';
import type { GatedSfxGroup } from '../audio/sfxGroups';
import { CircusGroundsAmbience } from '../systems/circus/CircusGroundsAmbience';
import { HighStrikerSystem } from '../systems/circus/HighStrikerSystem';
import {
  captureMurderQuestProgress,
  createMurderQuestProgress,
  restoreMurderQuestProgress,
  type MurderQuestProgress,
} from '../core/quests/MurderQuestProgress';
import {
  captureAnchorQuestProgress,
  createAnchorQuestProgress,
  restoreAnchorQuestProgress,
  type AnchorQuestProgress,
} from '../core/quests/AnchorQuestProgress';
import {
  captureBountyProgress,
  createBountyProgress,
  restoreBountyProgress,
  type BountyProgress,
} from '../core/quests/BountyProgress';
import { createMidgeEscortCarry, type MidgeEscortCarry } from '../core/quests/midgeEscortCarry';
import { BountySystem, BOUNTY_TRACKER_ID } from '../systems/BountySystem';
import { findBountyDef } from '../systems/bountyDefs';
import {
  findNearbyWalkableTile,
  findPartyArrivalTiles,
  findWarpLandingTile,
  hasRoomToMove,
} from '../map/findWalkableTile';
import { resolveDeathCause } from '../systems/DeathCauseSystem';
import { pickDeathExplanation } from '../ui/DeathExplanations';
import { BuildingInteriorScene } from './BuildingInteriorScene';
import { DeinonychusSystem, deinonychusXpFraction } from '../systems/DeinonychusSystem';
import {
  NO_INTERIOR_COMPANIONS,
  type InteriorCompanionArrival,
  type InteriorCompanionDeparture,
} from '../systems/companionCarry';
import type { DungeonInteriorReturn } from './dungeonInteriorReturn';
import {
  TOWN_INTERIOR_FLOOR,
  interiorArt,
  type InteriorFloorContext,
} from './interiorFloorContext';
import { DEFEND_QUEST_ID, DefendQuestSystem } from '../systems/DefendQuestSystem';
import { CloggedBathroomSystem } from '../systems/cloggedBathroom/CloggedBathroomSystem';
import { StealthKeySnatchSystem } from '../systems/stealthKeySnatch/StealthKeySnatchSystem';
import { prisonDoorRefusal } from '../systems/stealthKeySnatch/prisonDoorGate';
import { seatCompanionsWaitingOutsidePrison } from '../systems/stealthKeySnatch/prisonCompanions';
import { planGoblinPrison } from '../map/goblinPrisonPlan';
import type { PrisonLayout } from '../map/goblinPrisonLayouts';
import type { QuestRewardSpec } from '../ui/questReward/types';
import { DungeonLightingSystem, type OverDarknessPainter } from '../systems/DungeonLightingSystem';
import {
  DungeonAmbienceSystem,
  type AmbienceFrame,
} from '../systems/dungeon/DungeonAmbienceSystem';
import { LabHallwayAtmosphere } from '../systems/spiderQuest/LabHallwayAtmosphere';
import {
  DungeonLifeSystem,
  type LifeFrame,
  type Walker,
} from '../systems/dungeon/DungeonLifeSystem';
import { floorSurfaceOf } from '../map/dungeon/floorSurface';
import { dungeonFloorTheme } from '../map/dungeon/floorTheme';
import { partyLightSource, type PartyCompanion } from '../systems/lighting/partyLights';
import { beginAboveDarkness, flushAboveDarkness } from '../systems/lighting/aboveDarkness';
import { SpiderQuestSystem } from '../systems/SpiderQuestSystem';
import { spiderQuestCueSound, spiderQuestLoop } from '../systems/spiderQuest/spiderQuestSoundCues';
import type { SafeRoomService } from '../map/DungeonGenerator';
import { MurderMysteryQuestSystem, MURDER_QUEST_ID } from '../systems/MurderMysteryQuestSystem';
import { AnchorQuestSystem } from '../systems/AnchorQuestSystem';
import { stallBeaconTarget, doorwayBeaconTarget } from '../systems/objectiveBeaconTargets';
import { TINKER_VENDOR_ID } from '../systems/market/vendorDefs';
import {
  capturePersistedDoomsday,
  createDoomsdayProgress,
  rearmExpiredDoomsday,
  restoreDoomsdayProgress,
  type DoomsdayProgress,
} from '../core/quests/DoomsdayProgress';
import {
  captureCasinoState,
  createCasinoState,
  restoreCasinoState,
  type CasinoState,
} from '../core/club/CasinoState';
import {
  createWheelLedger,
  createWheelQuestFreeSpins,
  grantQuestFreeSpin,
  type WheelLedger,
} from '../core/save/WheelLedger';
import {
  captureAttackCowState,
  createAttackCowState,
  restoreAttackCowState,
  type AttackCowState,
} from '../core/state/AttackCowState';
import { doubleDamageRemainingOf } from '../core/save/doubleDamageSave';
import { drainBloodVomitRetches } from '../systems/bloodVomitRetches';
import { drainHpThresholdCrossings } from '../systems/hpThresholdCrossings';
import { PAGE_SAVE_LATCH, type SaveWriteOutcome } from '../core/save/progressPersistence';
import type { InteriorPartyRun, SaveParty } from './interiorPartyRun';
import type { RunSaveFields } from '../core/save/saveFormat';
import { WipeHold, type ProgressWipe } from '../ui/screens/dialogs/wipeHold';
import {
  captureTownMemory,
  createTownMemory,
  forgetClearedCamps,
  noteCampCasualty,
  restoreTownMemory,
  type TownMemory,
} from '../core/state/TownMemory';
import {
  clonePartyCraftsState,
  createPartyCraftsState,
  restorePartyCraftsState,
  type PartyCraftsState,
} from '../core/labour/partyCrafts';
import {
  captureBriarHollowState,
  createBriarHollowState,
  isVillageSavePoint,
  restoreBriarHollowState,
  type BriarHollowState,
} from '../core/quests/briarHollowState';
import { PartyTools } from '../core/items/gathering/PartyTools';
import { keybindings } from '../core/input/Keybindings';
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
} from '../core/party/MercenaryRoster';
import { createGodModeState, type GodModeState } from '../core/state/GodMode';
import { MercenarySystem } from '../systems/MercenarySystem';
import { AttackCowSystem } from '../systems/AttackCowSystem';
import { settleWheelLedger } from '../systems/casino/wheel/wheelPrizes';
import { adoptWhenCommitted } from '../core/save/adoptWhenCommitted';
import {
  DOOMSDAY_TRACKER_ID,
  DoomsdayEscapeSystem,
  STAIRWELL_KNOCKED_OUT_TOAST,
} from '../systems/DoomsdayEscapeSystem';
import {
  clearSightOf,
  RenderPipeline,
  VISIBILITY_RADIUS_PX,
  type RenderContext,
} from '../systems/RenderPipeline';
import { cameraWorldView, setVisibleWorldView } from '../core/rendering/visibleWorldView';
import type { SystemContext } from '../systems/GameSystem';
import { GameplayInputHandler } from '../systems/GameplayInputHandler';
import { GameplayScene } from './GameplayScene';
import { TutorialController, type TutorialRenderContext } from '../systems/TutorialController';
import { TUTORIAL_CUES, tutorialCueSource } from '../systems/tutorialSoundCues';
import { TUTORIAL_CHEST_POS, TUTORIAL_TREASURE_ROOM_BOUNDS } from '../map/TutorialMap';
import { HOTBAR_COUNT, ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { SmallSpider } from '../creatures/SmallSpider';
import {
  GrotesqueSpider,
  SLAM_AUDIO_SEEK_SECONDS,
  SCREECH_AUDIO_SEEK_SECONDS,
} from '../creatures/GrotesqueSpider';
import { randomInt, randomIntFrom, pointInRect, pixelToTile } from '../utils';
import { aiAdapter } from '../ai/AIAdapter';
import {
  adviceIntel,
  adviceObjective,
  adviceTactics,
  asOptional,
  gatewayAdviceId,
  nextAdviceObjective,
  type AdviceObjective,
  type AdviceObjectiveId,
  type AdviceSlot,
} from '../systems/daveAdvice';
import {
  ALL_DEBRIEF_BOSS_TYPES,
  debriefBossType,
  debriefHasNews,
  debriefPages,
  EMPTY_DEBRIEF_MEMORY,
  isSupersededDebrief,
  rememberDebriefHeard,
  debriefTalk,
  sameDebriefMemory,
  unwornGear,
  type DebriefBossType,
  type DebriefMemory,
  type DebriefState,
  type DaveDebriefCheckpoint,
} from '../systems/daveDebrief';
import { displayPageCount } from '../dialog/Conversation';
import type { CarolineMessage } from '../dialog/caroline';
import type { DialogLine } from '../dialog/line';
import type { ConversationHandle } from '../dialog/request';
import type { QuestMarkerState } from '../sprites/questNPCSprite';
import type { AISceneContext } from '../ai/aiActions';
import { AIInteractionStage } from '../ai/interactions/AIInteractionStage';
import { AIChallengeSystem } from '../systems/AIChallengeSystem';
import { forwardSceneHooksToBus } from '../systems/sceneHookEvents';
import { aiFloorKey, type AILevelTimer } from '../ai/actions/types';
import { aiCameraSpotlight } from '../ai/actions/cameraSpotlight';
import type { AIContextSource, SemanticLocation, SessionInput } from '../ai/context/types';
import { readCrawler, readNearbyMobs, tileOf } from '../ai/context/sceneReaders';
import { mobLabel } from '../ai/context/eventMapping';
import { GameStats, bindRunStats, type GameStatsSnapshot } from '../core/progression/GameStats';
import { MusicLibrary, bindMusicLibrary } from '../core/music/MusicLibrary';
import { StoryDirector } from '../story/StoryDirector';
import { persistStoryBeatsSeen } from '../story/storySave';
import type { StoryBeatId } from '../story/storyBeats';
import { storyPreviewEvent } from '../story/storyPreview';
import {
  StoryDelivery,
  partyIsEngaged,
  storyFloorOf,
  MAX_DAVE_TALK_PAGES,
  type DaveTalkExtra,
} from '../systems/StoryDelivery';
import { PetNameBook, petWords } from '../core/party/petNames';
import { MissingPetNames, attackCowPortrait, namePetThen } from '../systems/petNaming';
import { musicUnlocksFromProgress } from '../core/music/musicBackfill';
import { restoreMusicPlayback } from '../audio/music/playerPreference';
import { difficultyStats } from '../core/difficulty/DifficultyStats';
import { settings } from '../core/input/Settings';
import {
  placedGain,
  type AudioManager,
  type PlacedReach,
  type PlayOptions,
} from '../audio/AudioManager';
import { KEYBOARD_HERO_SONG, type AudioScope } from '../audio/AudioScope';
import { bossTrack, wireBossMusic } from '../audio/music/bossTracks';
import type { MusicSelection } from '../audio/music/MusicDirector';
import {
  MACHINERY_LOOP,
  SPIDER_WALKING_LOOP,
  WADING_LOOP,
  WALKING_LOOP,
} from '../audio/loopLevels';
import { Conversation } from '../dialog/Conversation';
import { WOOD_SMASHING_SOUNDS, type MusicTrackId, type SoundId } from '../audio/sounds';
import { rectCentre, rectContains } from '../map/overworld/briarHollowSite';
import { sfxGroupsForLevelId, compressedSfxForLevelId } from '../audio/sfxGroups';
import { DUNGEON_CUES, playDungeonCue, type DungeonCue } from '../systems/dungeon/dungeonSoundCues';
import {
  downedCompanionArrowCandidate,
  knockedOutBandEntry,
  updateKnockoutState,
} from '../systems/KnockoutRevive';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { renderQuality } from '../core/perf/RenderQuality';
import { floorArrivalLoadTasks } from './floorArrivalLoad';
import { ArrivalLoader, type WarpLoadRequest } from './ArrivalLoader';
import { steppedWork, type LoadTask } from '../core/perf/LoadRunner';
import { postMusicLibraryNotices, returnUnreadMusicNotices } from '../ui/hud/nowPlaying';
import { createSceneUi, sceneMouse } from '../ui/core/sceneUi';
import { byInputMode } from '../ui/core/inputMode';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import { drawUnknownAbilityIcon } from '../ui/icons/rewardIcons';
import { dynamiteChargeSurface } from '../systems/DynamiteSystem';
import type { HitRegion, Surface, UiRoot, WorldGesture } from '../ui/core/UiRoot';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import { buildingDisplayName, type BriarHollowBuildingId } from '../map/buildingIds';

/** A save as a scene writes it: every run-level field present, the floor's `world` optional. */
export type SaveProgressInput = GameProgressInput & RunSaveFields;

/**
 * Persists a run. Everything a resumed game needs that the scene cannot
 * re-derive: both crawlers, the floor they are on, and the party's ability
 * progress — which belongs to neither `PlayerSnapshot` because it is shared —
 * plus the floor's generation seeds and the safe room to stand back in.
 */
export type SaveProgressFn = (data: SaveProgressInput) => Promise<SaveWriteOutcome>;

export interface DungeonSceneOptions {
  /** Tile coordinates to spawn players at (instead of map start tile). */
  spawnAt?: { x: number; y: number };
  /** The HUD toggles the party walked out of a building with, so the door moves no button. */
  hudView?: HudViewState;
  /** Preserved human player state from a previous scene (e.g. building interior). */
  humanSnap?: PlayerSnapshot;
  /** Preserved cat player state from a previous scene. */
  catSnap?: PlayerSnapshot;
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
  /** The Wayfinder's Anchor's cooldown, carried across a building-exit rebuild. */
  existingRecallState?: RecallCheckpoint;
  /**
   * Whatever was lying on the ground to be picked up, carried across a
   * building-exit rebuild — only meaningful alongside `existingMap`, since the
   * spots they lie on are only still open ground on the same map instance.
   */
  existingGroundPickups?: GroundPickupCheckpoint;
  /**
   * The run's music library, threaded by reference like `gameStats`. Absent
   * on a new game, which starts it empty.
   */
  musicLibrary?: MusicLibrary;
  /**
   * The run's story progress, threaded by reference like `musicLibrary` so a
   * death never rewinds a beat already heard. Absent on a new game.
   */
  storyDirector?: StoryDirector;
  /**
   * The room Dave was last in, threaded by reference across a building visit
   * so the floor finds him where it left him. Absent on arriving at a floor.
   */
  daveWhereabouts?: DaveWhereabouts;
  /**
   * A new run that skipped the tutorial: Dave is waiting in the start room
   * and tells the party what the tutorial would have, then leaves.
   */
  skippedTutorial?: boolean;
  /**
   * The party has just come down to this floor, by the stairs or at the
   * start of a run, so Caroline's message about the floor is due. A reload,
   * a respawn or a walk out of a building is no arrival.
   */
  arrivedOnFloor?: boolean;
  /** A dev preview: the beat is played as soon as the floor is up. */
  storyPreview?: StoryBeatId;
  /**
   * The run's pet names, threaded by reference like `musicLibrary` so a death
   * never takes back a name. Absent on a new game, which names them afresh.
   */
  petNames?: PetNameBook;
  /**
   * Silently unlocks every song the floor's starting state proves the party
   * already passed through, before the floor's own music is claimed. For a
   * dev preset that drops the party onto a later floor without walking there,
   * whose library would otherwise be empty.
   */
  backfillMusicLibrary?: boolean;
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
  /** Whether the Deinonychus has been unlocked (persists across floors). */
  deinonychusUnlocked?: boolean;
  /**
   * The pet's HP and quest lock, threaded by reference like the quest progress
   * objects. His health persists across summons, floors and buildings, and the
   * `Deinonychus` instance that carries it in play is destroyed on every despawn.
   */
  deinonychusPetState?: DeinonychusPetState;
  /**
   * Whether Deinonychus was out beside the party at the building door they just came
   * out of. He is rebuilt beside the cat on the first frame, at the health the
   * pet state carries.
   */
  deinonychusWasOut?: boolean;
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
  /**
   * Reset Game's restart, called once the wipe has landed (or straight away
   * where nothing is saved). Starts the game afresh.
   */
  onResetGame?: () => void;
  /**
   * The page's wipe: latches every save write and deletes the save. Reset Game
   * holds the player behind a blocking screen until it lands.
   */
  progressWipe?: ProgressWipe;
  /** The Starlight Tent's record, threaded by reference across building/scene transitions. */
  starlightTentProgress?: StarlightTentProgress;
  /** Murder-mystery questline state, threaded by reference across building/scene transitions. */
  murderQuestProgress?: MurderQuestProgress;
  /** Wayfinder's Anchor questline state, threaded by reference across building/scene transitions. */
  anchorQuestProgress?: AnchorQuestProgress;
  /** Journal state that must survive a door: the pinned objective. */
  journalProgress?: JournalProgress;
  /** Tactics-trait System notices already shown this run, threaded like `journalProgress`. */
  tacticsNoticesSeen?: Set<TacticsTrait>;
  /** Bounty-board state, threaded by reference across building/scene transitions. */
  bountyProgress?: BountyProgress;
  /**
   * Midge's escort across a door: where she stood and how hurt she was, so
   * the overworld rebuilt on the way out finds her still led. Threaded by
   * reference like `bountyProgress`, and deliberately never saved.
   */
  midgeEscortCarry?: MidgeEscortCarry;
  /** Doomsday-finale state (soul crystal containment + escape), threaded by reference across building/scene transitions. */
  doomsdayQuestProgress?: DoomsdayProgress;
  /** Cloak & Dagger casino state, threaded by reference across building/scene transitions. */
  casinoState?: CasinoState;
  /** The Wheel of Fortune's won prizes and pending spin, threaded by reference. */
  wheelLedger?: WheelLedger;
  /** The human crawler's attack cow, threaded by reference like `deinonychusPetState`. */
  attackCowState?: AttackCowState;
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
  /**
   * Every shop's stock, threaded by reference so a building trip can't restock
   * a shelf, and ticked by whichever scene is running so restocking is global.
   */
  shopStock?: ShopStock;
  /** Hired-mercenary roster, threaded by reference across building/scene transitions. */
  mercenaryRoster?: MercenaryRoster;
  /** Companion combat stance, threaded by reference so passive/aggressive survives building/floor transitions. */
  companionStance?: CompanionStanceState;
  /** `!god` / `!tough` / `!lucky` cheat state, threaded by reference so it survives scene transitions. */
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
  preDefeatedBossTypes?: readonly MobKind[];
  /**
   * Dev bootstrap only: picks the spawn tile from this floor's freshly generated
   * map — a gateway safe room, the spider lab's station. A callback rather than a
   * coordinate because the coordinate does not exist until the constructor has
   * generated the map, and because keeping the landmark vocabulary out of here
   * is what lets a release build drop the dev bootstrap entirely. Returning null
   * falls back to the floor's own start tile.
   */
  resolveSpawnTile?: (gameMap: GameMap) => { x: number; y: number } | null;
  /**
   * Dev bootstrap only: whether the floor's clogged bathrooms start fixed — a
   * playtest preset dropping the party past them, whose way back to the start
   * would otherwise be shut behind a queue the party never met. Asked of the
   * freshly generated map, before the bathroom system is built.
   */
  bathroomSolvedAtStart?: (gameMap: GameMap) => boolean;
  /**
   * Dev bootstrap only: whether the floor's stealth gate starts open, for a
   * start dropped past the gate room. Asked of the freshly generated map,
   * before the gate's system is built.
   */
  stealthGateOpenAtStart?: (gameMap: GameMap) => boolean;
  /**
   * Dev bootstrap only: Pest Control starts already taken up, Dr. Moult at his
   * lab post waiting for the hack — as a save made in the lab's station has it.
   */
  spiderQuestAwaitingHackingAtStart?: boolean;
  /**
   * Dev bootstrap only: the party walks straight through the prison door on
   * the first gameplay frame, the guard's briefing taken as given. Never
   * carried to a rebuilt scene, or every exit would walk straight back in.
   */
  devEnterPrisonAtStart?: boolean;
  /**
   * Dev bootstrap only: the prison is built from this layout rather than the
   * world's own, on every visit from this floor. Carried through every rebuild
   * of the same floor: a building exit, a respawn and a floor restart.
   */
  devPrisonLayout?: PrisonLayout;
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
   * checkpoint's mob flags belong to the roster that captured it. A floor held
   * aside for a building visit keeps both, through `interiorReturn` instead.
   *
   * Absent on a new floor, which takes its own save on arrival.
   */
  lastSave?: GameProgressInput;
  /** Floor and run state from a resumed save; absent on a fresh game. */
  persistedWorldState?: PersistedWorldState;
  /**
   * The floor this scene was built from, held aside while the party was inside
   * one of its buildings. The scene keeps that party and population rather
   * than spawning its own, and puts every system back the way it was at the
   * door. Only meaningful alongside `existingMap`.
   */
  interiorReturn?: DungeonInteriorReturn;
  /**
   * The party is walking out of the prison, which admits neither Deinonychus nor the
   * hire: both are found standing on the gate room's waiting tiles.
   */
  companionsWaitAtPrisonDoor?: boolean;
}

// Items with a designated owner — kept in sync with non-boss floor loot routing below
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
/** Distance-attenuated ambience tuning for the overworld town. */
const FOUNTAIN_AMBIENT_RADIUS_TILES = 10;
const FOUNTAIN_AMBIENT_VOLUME = 0.5;
const FORGE_AMBIENT_RADIUS_TILES = 8;
const FORGE_AMBIENT_VOLUME = 0.45;
/**
 * The club's beat is heard through its walls, so it carries a street's width
 * past the door but dies out well before the square's crowd bed takes over.
 */
const CLOAK_AND_DAGGER_EXTERIOR_AMBIENT_RADIUS_TILES = 10;
const CLOAK_AND_DAGGER_EXTERIOR_AMBIENT_VOLUME = 1;
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

/** The tutorial shares `floorNumber: 1` with this level, so the id is what tells them apart. */
const FIRST_DUNGEON_LEVEL_ID = 'level1';

// Companion/Follower system
const FOLLOWER_FOLLOW_RANGE_TILES = 2.5;
/**
 * How far the recall spell will look for a walking route before it gives up and
 * teleports the companion. Map-scale, because "no route" is what makes recall
 * teleport, and a companion left across town can still walk back.
 */
const RECALL_MAX_PATH_DISTANCE_TILES = 96;
const TILE_CENTER_OFFSET = 0.5;

/**
 * Loading-screen frames a warp's crowd task may take before it is called done
 * whatever it has left (ten seconds at 60 Hz), for a cache that keeps its requests queued
 * without baking them, as one whose canvases are being refused does.
 */
const WARP_COVER_MAX_STEPS = 600;

/**
 * Loading-screen frames over which a warp's crowd rows the queue gives up on
 * are asked for again. Nothing is drawn under the screen, so after a couple
 * of frames every unpinned row counts as out of use and may be evicted; a
 * refusal that outlasts this is one no room will cure.
 */
const WARP_COVER_FORGIVING_STEPS = 10;

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

/**
 * How far around Big Rooster's room a rooster of his flock still counts as one
 * of his guards. His minions stand outside the gym door, not in the room, so
 * the radius has to reach past the room itself.
 */
const PECKING_ORDER_GUARD_RADIUS_TILES = 20;
const PECKING_ORDER_GUARD_RADIUS = PECKING_ORDER_GUARD_RADIUS_TILES * TILE_SIZE;

/** Spawn-table keys of the roosters that guard Big Rooster's gateway. */
const ROOSTER_FLOCK_SPAWN_KEYS: ReadonlySet<MobKind> = new Set<MobKind>([
  'little_rooster',
  'slightly_bent_rooster',
]);

/** How far under the player's music level the tutorial's track sits, as gain. */
const TUTORIAL_MUSIC_DUCK_LEVEL = 0.25;

/** How a panel's ✕ button's region id ends, whatever the panel is called. */
const CLOSE_BUTTON_ID_SUFFIX = '/close';

/** The keyboard-hero per-hit tick sits under the track rather than over it. */
const KEYBOARD_HERO_HIT_TICK_VOLUME = 0.45;
/** Escape opens the pause menu; it is not a rebindable action, so its keycap is fixed. */
const PAUSE_KEY_LABEL = 'Esc';
/** The id `Conversation.surface` mounts under. */
const CONVERSATION_SURFACE_ID = 'conversation';
const PRISON_DIFFICULTY_SURFACE_ID = 'prison-difficulty';
const SPIDER_TERMINAL_DIFFICULTY_SURFACE_ID = 'spider-terminal-difficulty';
/** How far Dr. Moult's footsteps carry while he runs back to his lab, in tiles. */
const SCIENTIST_FOOTSTEPS_HEARING_TILES = 16;
/** His footsteps' loop, or null while its recording is still missing. */
const SCIENTIST_FOOTSTEPS_LOOP = spiderQuestLoop('panickedFootstepsLoop');
/**
 * The level of every line Dr. Moult speaks to the player. Each recording is
 * already trimmed to the effects target, which leaves words the player has to
 * catch no louder than a sword swing, so his voice is lifted above the effects.
 */
const SCIENTIST_SPEECH_VOLUME = 3.5;
/**
 * The player is always in sight when he speaks to them, so where he stands sets
 * only the side his voice comes from, never how loud it is. That point also
 * places the call-out's off-screen caption.
 */
const SCIENTIST_SPEECH_REACH = 'panOnly' as const satisfies PlacedReach;
/** How close two world taps must land, in time, to read as the village kit's double-tap gesture. */
const BRIAR_HOLLOW_DOUBLE_TAP_WINDOW_MS = 300;
/** A hold that moved the crawler further than this was a walk, not a long-press. */
const HOLD_WALK_TOLERANCE_PX = 4;

/** Where the intro's "begin" hint sits, as a fraction of the screen's height from the top. */
const INTRO_BEGIN_HINT_Y_FRACTION = 0.78;
const INTRO_BEGIN_HINT_SIZE = 18;

/** The nearest and furthest Dave waits from the party when he is met outside a safe room, in tiles. */
const DAVE_WAITING_MIN_TILES = 2;
const DAVE_WAITING_MAX_TILES = 4;
/** The ways out from the party tried for his tile, best first: in front of them on screen, then beside. */
const DAVE_WAITING_DIRECTIONS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

/** Floors Dave has a list of objectives for; the rest fall through to the AI chat. */
const DUNGEON_FLOOR_ONE = 1;
const DUNGEON_FLOOR_TWO = 2;
/**
 * Taloncrest: the only floor that is a town rather than a dungeon, and the
 * first with more than one questline running at once — which is why it is also
 * where the Quest Journal starts being offered.
 */
const OVERWORLD_FLOOR_THREE = 3;
const GROTESQUE_SPIDER_WALKING_TRIGGER_DISTANCE_TILES = 12;
const COMBAT_COOLDOWN_FRAMES = 300;
/** The chest each crawler earns for a boss after Boss Slayer is already theirs. */
const BOSS_REPEAT_CHEST_RARITY = ACHIEVEMENT_DEFS.boss_slayer.reward.rarity;
const PLAYER_IDLE_REPORT_INTERVAL_FRAMES = 300;
const FRAMES_PER_SECOND = 60;
/** Within this many tiles of a stairwell the AI is told the party is at it. */
const AI_AT_STAIRWELL_TILES = 3;
/** Within this many tiles, places are described as "near the stairwell". */
const AI_NEAR_STAIRWELL_TILES = 15;
const MS_PER_SECOND = 1000;
const TREE_FALL_SOUNDS = ['tree_fall_1', 'tree_fall_2', 'tree_fall_3', 'tree_fall_4'] as const;
/** A nursery barrier giving way — the smash, not the per-blow crack the scene cycles separately. */
const BARRIER_BREAK_SOUNDS = WOOD_SMASHING_SOUNDS;
const DEINONYCHUS_ADULT_SQUAWK_MIN_LEVEL = 5;
const DEINONYCHUS_ADULT_HAPPY_SQUAWKS = [
  'deinonychus_adult_happy_squawk_1',
  'deinonychus_adult_happy_squawk_2',
  'deinonychus_adult_happy_squawk_3',
  'deinonychus_adult_happy_squawk_4',
] as const;
const DEINONYCHUS_JUVENILE_HAPPY_SQUAWKS = [
  'deinonychus_juvenile_happy_squawk_1',
  'deinonychus_juvenile_happy_squawk_2',
  'deinonychus_juvenile_happy_squawk_3',
  'deinonychus_juvenile_happy_squawk_4',
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
  ...DUNGEON_CUES.gasCylinderHiss,
  ...VILLAGE_CUES.miasmaHiss,
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
const SPIDER_LAB_MUSIC = 'spider_lab' as const satisfies MusicTrackId;

/** A per-frame record the scene owns and rewrites in place rather than rebuilding. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** Gold, matching the pinned Journal row it belongs to. */
const PINNED_ARROW_COLOR = worldPalette.objective.ready;
/** The span of an objective target that does not say how wide it is. */
const SINGLE_TILE_TARGET_WIDTH = 1;
const STAIRWELL_ARROW_COLOR = worldPalette.ink.gold;

/** How far off screen, in tiles, an objective beacon's beam can still reach into view. */
const BEACON_VIEW_REACH_TILES = 6;
/** Cull margin for a front-standing beam of default height, whose art rises past its anchor tile. */
const FRONT_BEAM_CULL_MARGIN_TILES = 4;

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

/**
 * A room that becomes a save point once its puzzle is done — walking in saves —
 * without becoming a safe room: mobs still follow the party in.
 */
interface RoomSaveSource {
  /** Where a save taken by `body` would resume, or null when it is not standing in a saving room. */
  saveTileAt(body: { readonly x: number; readonly y: number }): TilePoint | null;
}

/**
 * Edge detection for one {@link RoomSaveSource}. `wasInside` follows the same
 * first-frame convention as the scene's `wasInTown`. Unlike the town gate, a
 * refused entry stays `owed` while the crawler is still inside: a dungeon room
 * is often entered one step ahead of a pursuer, and the save belongs to the
 * room, not to the exact step through its door.
 */
interface RoomSaveLatch {
  wasInside: boolean;
  owed: boolean;
}

interface RoomSaveEntry {
  readonly source: RoomSaveSource;
  readonly latch: RoomSaveLatch;
}

export class DungeonScene extends GameplayScene {
  private gameMap: GameMap;
  /**
   * Set when a building visit takes this scene's map and minimap to hand to
   * the scene rebuilt at the door, so leaving this scene must not give their
   * art back. Every other exit abandons them.
   */
  private floorArtHeldByBuildingVisit = false;
  readonly pm: PlayerManager;
  /** Map, bus, audio and population — what every kit this scene builds is handed. */
  private readonly world: SceneWorld;
  private grotesqueSpiders: GrotesqueSpider[] = [];

  protected override get pauseScreen(): PauseScreen {
    return this.menus.pauseScreen;
  }

  /**
   * The frame's shared system context and its `extraTargets` list, held as
   * fields and refreshed by `buildSystemContext` rather than rebuilt, so the
   * per-frame system pass allocates nothing.
   */
  private readonly _extraTargets: Player[] = [];
  /** Reused per-frame array of the minimap's quest markers. */
  private readonly _questMarkers: Array<{ x: number; y: number; type: QuestMarkerType }> = [];
  /** Reused per-frame array of the minimap's `$` vendor markers. */
  private readonly _vendorMinimapPositions: Array<{ x: number; y: number }> = [];
  /** Reused per-frame array of the Journal's entries, for the same reason. */
  private readonly _trackerEntries: TrackerEntry[] = [];
  /** The way to the pinned objective: the arrow's next gate and the ground trail. */
  private readonly questRoute = new QuestRouteGuide();
  private readonly questRouteTrail = new WorldTrail();
  /** Systems that beam over their own objective places whether or not the Journal tracks them. */
  private readonly objectiveBeaconSources: ObjectiveBeaconSource[] = [];
  private readonly _systemContext: SystemContext;

  // Systems
  private miniMap: MiniMapSystem;
  private safeRoom: SafeRoomSystem;
  private dave: DaveGuideSystem;
  private readonly daveWhereabouts: DaveWhereabouts;
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
  /**
   * Saved, but not rewound on death, so heard speeches stay heard; see
   * `forgetDebriefsOfLivingBosses` for the one rewind that must reset it.
   */
  private daveDebrief: DaveDebriefCheckpoint = {};
  /**
   * Saved, but not rewound on death, so a heard System notice stays heard.
   * Threaded by reference across building/scene transitions like
   * `journalProgress`, so a trait met indoors is still met on the way back out.
   */
  private readonly tacticsNoticesSeen: Set<TacticsTrait>;
  private lavaBalls: LavaBallSystem;
  private rockThrows: RockThrowSystem;
  private hirelingShots: HirelingShotSystem;
  private skeletonShots: SkeletonProjectileSystem;
  private goblinArrows: GoblinArrowSystem;
  private readonly goblinBombs: GoblinBombSystem;
  private readonly explosionShake: ExplosionShake;
  private readonly fuseSizzle = new FuseSizzleLoops();
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
  /** The Wayfinder's Anchor: channel and cooldown. */
  private readonly recall: RecallSystem;
  private readonly travelMenu: TravelMenu;
  /** The questlines that bind the anchor's destinations, read by the menu and every reward screen that names one. */
  private readonly travelUnlocks: TravelUnlockState;
  private building: BuildingSystem | null = null;
  private townLife: TownLifeSystem | null = null;
  private readonly residency = new WorldResidency();
  protected readonly arrivalLoading = new ArrivalLoader();
  /** The arrival's own screen and work, for a warp within the floor that needs covering. */
  private warpLoadRequest: WarpLoadRequest | null = null;
  private townProps: TownPropSystem | null = null;
  /** Shady's bounty loop. Overworld only — null on every other floor. */
  private bounty: BountySystem | null = null;
  /** Holds floor 3's gated SFX groups decoded while the party is near or they are under way. */
  private readonly sfxGates: FloorSfxGates | null;
  private townDecor: TownDecorSystem | null = null;
  private market: MarketSystem | null = null;
  /**
   * Every town fixture in one Y-sort list. Built once, since both owning systems
   * fill their prop arrays in their constructors and never add to them.
   */
  private townPropRenderables: ReadonlyArray<TownPropRenderable> | null = null;
  /** Reused every frame so the merged prop list costs no allocation. */
  private readonly propRenderableScratch: TownPropRenderable[] = [];
  private crawlerSigns: CrawlerSignSystem | null = null;
  /** The sign currently open on the shared conversation; unfrozen once it closes. */
  private signDialogTarget: CrawlerSignPlacement | null = null;
  /** The handle the sign's conversation opened with — `conversation.isActive` on it says whether that beat, and not something that has since superseded it, is what's on screen. */
  private signDialogHandle: ConversationHandle | null = null;
  /** Citizen currently frozen mid-conversation; unfrozen once the shared conversation closes. */
  private citizenDialogTarget: Townsperson | null = null;
  /** The talk row pinned for {@link citizenDialogTarget}, unpinned with it. */
  private citizenTalkRow: DrawnFigureRow | null = null;
  /** The handle the citizen's conversation opened with — see `signDialogHandle`. */
  private citizenDialogHandle: ConversationHandle | null = null;
  /** Keeps the human crawler talking, turned to whoever he is in conversation with. */
  private readonly humanTalk = new HumanTalkDriver();
  private noticeBoard: NoticeBoard | null = null;
  private marketPanel: ShopSession | null = null;
  /** Stops this scene's bus hearing every shop counter's trades; set in `wireEventBus`. */
  private stopForwardingSceneHooks: () => void = () => undefined;
  private fortuneTeller: FortuneTable | null = null;
  private gymRoom: GymRoomSystem;
  private bossRoomDressings: BossRoomDressings;
  private arenaRoom: ArenaRoomSystem;
  private barriers: BarrierSystem;
  private defendQuest: DefendQuestSystem;
  /** Floor 2's clogged bathrooms, their queue, their plumber and the floor's one pipe board; inert on every other floor. */
  readonly cloggedBathroom: CloggedBathroomSystem;
  private readonly isCrawlerHidden = (crawler: HumanPlayer | CatPlayer): boolean =>
    this.cloggedBathroom.isCrawlerHidden(crawler);
  /** Floor 2's stealth gate, its guard and the prison key quest; inert on every other floor. */
  readonly stealthKeySnatch: StealthKeySnatchSystem;
  /** Light and dark on floors 1 and 2; null on every other map. */
  private readonly dungeonLighting: DungeonLightingSystem | null;
  /** Beds, positional loops and distant one-shots on floors 1 and 2; null elsewhere. */
  private readonly dungeonAmbience: DungeonAmbienceSystem | null;
  /** The spider lab's approach: its webs overhead and its sounds; null on a floor with no lab. */
  private readonly labHallway: LabHallwayAtmosphere | null;
  /** Drips, splashes, critters, flies, motes and paper on floors 1 and 2; null elsewhere. */
  private readonly dungeonLife: DungeonLifeSystem | null;
  /** The Structure menu over a boarded grate, for a crawler who can spike it. */
  private readonly grateSpikes: GrateSpikesMenu;
  /** Whether the current world touch came down on a structure, making it a long-press rather than a walk. */
  private readonly structureHold = new StructureHold();
  /** Where the active crawler stood when the current world touch began. */
  private holdStartActivePos: { x: number; y: number } | null = null;
  private spiderQuest: SpiderQuestSystem;
  private readonly dungeonCuesPlayed = new Map<DungeonCue, number>();
  private murderQuest: MurderMysteryQuestSystem;
  private anchorQuest: AnchorQuestSystem;
  private doomsdayEscape: DoomsdayEscapeSystem;
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
  private readonly starlightTentProgress: StarlightTentProgress;
  private readonly murderQuestProgress: MurderQuestProgress;
  private readonly anchorQuestProgress: AnchorQuestProgress;
  private readonly journalProgress: JournalProgress;
  private readonly bountyProgress: BountyProgress;
  private readonly midgeEscortCarry: MidgeEscortCarry;
  private readonly doomsdayQuestProgress: DoomsdayProgress;
  private readonly casinoState: CasinoState;
  /** Read and written by the wheel host; saved as top-level fields. */
  readonly wheelLedger: WheelLedger;
  /** Read and written by the attack cow's system; saved as top-level fields. */
  readonly attackCowState: AttackCowState;
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
  /**
   * The circus grounds' live dressing: lamp flames, bunting, bulbs, the
   * arch's marionette, balloons. Built on any map with circus grounds; null
   * elsewhere.
   */
  private circusAmbience: CircusGroundsAmbience | null = null;
  /** The circus grounds' high striker, which a crawler can swing at for fun. Null off the grounds. */
  private highStriker: HighStrikerSystem | null = null;
  /** The gathering kit's own checkpoint, taken and put back beside the village kit's. */
  private gatheringCheckpoint: GatheringCheckpoint | null = null;
  /** When the last world tap resolved, so a second one close behind it reads as the kit's double-tap gesture. */
  private briarHollowLastWorldTapAt: number | null = null;
  private readonly shopStock: ShopStock;
  private readonly mercenaryRoster: MercenaryRoster;
  /** Companion combat stance, threaded by reference so it survives building trips and floor changes. */
  private readonly companionStance: CompanionStanceState;
  private readonly godModeState: GodModeState;
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
  private readonly deinonychusSystem: DeinonychusSystem;
  private readonly deinonychusPetState: DeinonychusPetState;
  /**
   * Deinonychus walked out of a building with the party and is waiting to be put down
   * beside the cat. Held for the first gameplay frame rather than done in the
   * constructor, which runs before the party is placed at the door.
   */
  private deinonychusCarryPending = false;
  /** Set for the first gameplay frame after the prison: see {@link DungeonSceneOptions.companionsWaitAtPrisonDoor}. */
  private companionsWaitingAtPrisonDoor = false;
  /** See {@link DungeonSceneOptions.devPrisonLayout}. */
  private readonly devPrisonLayout: PrisonLayout | null;
  private devPrisonEntryPending: boolean;
  private readonly prisonDifficulty = new ActivityDifficultyGate();
  /**
   * The lab terminal's difficulty question, owned here so it is mounted with
   * the scene's other surfaces; the spider quest opens it.
   */
  readonly spiderTerminalDifficulty = new ActivityDifficultyGate();
  /** Dr. Moult's last line, stopped before his next so he never talks over himself. */
  private lastScientistVoice: SoundId | null = null;
  private readonly mercenarySystem: MercenarySystem;
  private readonly attackCowSystem: AttackCowSystem;
  private renderPipeline = new RenderPipeline();
  private bus = new EventBus();
  /** Stops forwarding the crawlers' quest-slot evictions onto this scene's bus; set while the scene is running. */
  private stopForwardingQuestItemEvictions: (() => void) | null = null;
  /** Stops forwarding the crawlers' equipment changes onto this scene's bus; set while the scene is running. */
  private stopForwardingEquipmentChanges: (() => void) | null = null;
  private readonly crawlerBarks = new CrawlerBarkSystem();

  private levelCompleteScreen = new LevelCompleteScreen();
  private readonly runCompleteScreen = new RunCompleteScreen();

  private achievementUI: AchievementUISystem;
  /** Pays every award this scene's crawlers earn; see {@link AchievementAwards}. */
  private awards: AchievementAwards;
  /** The AI's timed bounties on this floor. */
  private readonly aiChallenges: AIChallengeSystem;
  /** Where the AI's questions and challenge offers appear. */
  private readonly aiInteractions: AIInteractionStage;
  private humanAchievements: AchievementManager;
  private catAchievements: AchievementManager;

  private bossIntro = new BossIntroSystem();
  private readonly dungeonIntro = new DungeonIntroSystem();
  // Becomes true once the AudioContext is running so intro ticks in sync with sound.
  private introStarted = false;
  private readonly skipIntro: boolean;

  private readonly abilityManager: AbilityManager;

  private arena: ArenaSystem;
  private readonly treasureChests = new TreasureChestSystem();
  private readonly chestKit: ChestKit;
  /** Coins/items flying to the HUD from wherever they were earned. Screen-space; ticks and draws every frame regardless of what else is on screen. */
  protected readonly rewardFly = new RewardFlySystem();

  private floorEntryHumanSnap: PlayerSnapshot;
  private floorEntryCatSnap: PlayerSnapshot;
  private floorEntryHumanAchievements: AchievementManager;
  private floorEntryCatAchievements: AchievementManager;
  private floorEntryAbilityManager: AbilityManager;
  private readonly floorEntryGameStats: GameStatsSnapshot;
  private readonly floorEntryMercenaryRoster: MercenaryRosterCheckpoint;

  private readonly followerMenu = new FollowerScreen();

  private _revealStairwell = false;
  private _revealSpiderLab = false;

  private gameOver = false;
  protected readonly notifPulse = { value: 0 };
  private levelTimerFrames = 0;
  /**
   * The tutorial has no `LevelDef` collapse timer of its own — it isn't built
   * from one — so it runs on a flat hour, named
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
  private wasInBriarHollowSaveZone = false;
  /** A fixed bathroom and the stealth gate room once its gate is open. */
  private readonly roomSaves: readonly RoomSaveEntry[];
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
   * The creatures a system stood up in this scene's constructor (the bathroom's
   * queue, say). A scene rebuilt from a held floor gets these from its own
   * systems again, so they are the ones a held floor leaves behind.
   */
  private systemSpawnedMobs: ReadonlySet<Mob> = new Set();
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

  private readonly touch = new TouchMoveState();
  private krakarenKilled = false;
  /**
   * The run's damage-taken total when the current boss fight began, or null
   * outside one: a boss that dies with the total unchanged was beaten unhurt.
   */
  private damageTakenAtBossFightStart: number | null = null;
  private bigRoosterKilled = false;
  private bigRoosterBossRoomIdx = -1;
  private woodBreakSoundIdx = 0;
  private combatCooldownFrames = 0;
  private playerIdleFrames = 0;
  private readonly gameStats: GameStats;
  private readonly musicLibrary: MusicLibrary;
  private readonly storyDirector: StoryDirector;
  /** Plays the story's beats, debriefs and intel through the cutscene director. */
  private readonly story: StoryDelivery;
  /**
   * The newest save handed to storage, which a beat's seen-write builds on.
   * Not `lastSave`: a save written from indoors is adopted there only once
   * storage has taken it, and writing over an older one would undo it.
   */
  private lastDispatchedSave: SaveProgressInput | null = null;
  private readonly skippedTutorialStart: boolean;
  private readonly arrivedOnFloor: boolean;
  private readonly storyPreview: StoryBeatId | null;
  /** The floor's first frame has not opened its story yet: arrival messages, a waiting Dave. */
  private storyOpeningPending = true;
  /**
   * The room Dave last teleported into, whose talk has not started yet: it
   * starts once the active crawler is in there with him and nothing is
   * fighting the party.
   */
  private daveArrivalOwed: SafeRoomInfo | null = null;
  private readonly petNames: PetNameBook;
  private readonly missingPetNames: MissingPetNames;
  private musicBackfillPending: boolean;

  /** The HUD, drawn from {@link hudModel} each frame. */
  protected readonly hud = new HudSurface({
    visible: () => this.hudTakesInput,
    model: () => this.hudModel(),
    toasts: () => this.menus.toasts,
    nowPlaying: () => this.menus.nowPlaying,
    captions: () => this.menus.captions,
  });
  /** Takes the scythe's timed key off the stack; set while a village floor is entered. */
  private removeHarvestKeyHook: (() => void) | null = null;
  /**
   * The scene's surface stack: every menu, dialog and the HUD take pointer
   * and key input through it, and the world sees only what none of them took.
   */
  readonly ui: UiRoot;

  private onSaveProgress: SaveProgressFn | undefined;

  private readonly onResetGameCallback: (() => void) | null;
  private readonly progressWipe: ProgressWipe | null;
  private readonly wipeHold = new WipeHold();

  protected readonly audio: AudioManager | null;
  /** Every loop and ambient bed this floor starts; disposed as the scene exits. */
  private readonly audioScope: AudioScope | null;
  /**
   * The one conversation panel every speaking system on this floor shares,
   * so two conversation boxes can never be open at once. This scene is the
   * only thing that ticks it, once per frame, and it is drawn through its
   * own surface on the scene's `UiRoot`. Systems only open requests on it.
   */
  private readonly conversation: Conversation;
  /** Scripted moments that own the party: the tutorial's talks with Dave. */
  private readonly cutscenes: CutsceneKit;
  private readonly tutorial: TutorialController | null = null;
  private readonly questSwitchConfirm: ConfirmDialog;
  /**
   * A quest started while the player was already tracking a different active
   * one. Held until every other modal on screen has closed, so the prompt
   * never lands on top of the conversation or reward cards that started the
   * quest in the first place.
   */
  private pendingQuestSwitch: { fromId: string; fromName: string; toId: string } | null = null;

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
    // On the normal profile whatever the setting: the difficulty already
    // scales every blow a crawler takes, and a floor's yardstick should not
    // move with it.
    setFloorReferencePartyLevel(recommendedPartyLevelFor(levelDef, DIFFICULTY_PROFILES.normal));

    // Both are needed before the roster below, which hands every mob it accepts
    // the spell context, and by the level spawners' audio-carrying siblings.
    this.audio = options?.audio ?? null;
    this.audioScope = this.audio?.createScope() ?? null;
    this.ui = createSceneUi({
      audio: this.audio,
      handleWorldPointer: (gesture) => this.handleWorldPointer(gesture),
    });
    this.conversation = new Conversation(this.audio);
    this.cutscenes = new CutsceneKit({
      conversation: this.conversation,
      teleportDaveOut: () => this.dave.teleportOut(),
      pauseButton: () => {
        const rect = this.hud.frame?.dock.get('pause');
        return rect === undefined ? null : { rect, press: () => this.openPauseFromButton() };
      },
    });
    this.questSwitchConfirm = new ConfirmDialog(this.audio);
    this.companionStance = options?.companionStance ?? createCompanionStanceState();
    this.godModeState = options?.godModeState ?? createGodModeState();
    this.gameStats = options?.gameStats ?? new GameStats();
    this.floorEntryGameStats = options?.floorEntryGameStats ?? this.gameStats.snapshot();
    this.humanAchievements = options?.humanAchievements ?? new AchievementManager();
    this.catAchievements = options?.catAchievements ?? new AchievementManager();
    this.musicLibrary = options?.musicLibrary ?? new MusicLibrary();
    this.storyDirector = options?.storyDirector ?? new StoryDirector();
    this.story = new StoryDelivery({
      director: this.storyDirector,
      cutscenes: this.cutscenes.director,
      persist: () => this.persistStory(),
      calm: () => this.carolineMaySpeak(),
    });
    this.skippedTutorialStart = options?.skippedTutorial === true;
    this.arrivedOnFloor = options?.arrivedOnFloor === true;
    this.storyPreview = options?.storyPreview ?? null;
    this.daveWhereabouts = options?.daveWhereabouts ?? new DaveWhereabouts();
    this.petNames = options?.petNames ?? new PetNameBook();
    this.musicBackfillPending = options?.backfillMusicLibrary === true;
    // Ahead of the kits: `CombatKit` levels abilities off kills and `MenusKit`
    // draws the ability screen, so both want this before they exist.
    this.abilityManager = options?.abilityManager ?? new AbilityManager();
    for (const def of Object.values(ABILITY_DEFS)) this.abilityManager.register(def);

    const tutorialController = options?.tutorialController ?? null;
    const interiorReturn = options?.interiorReturn ?? null;
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
      const tutMap = tutorialController.map;
      this.gameMap = tutMap;
      this.tutorial = tutorialController;
      this.levelTimerFrames = this.TUTORIAL_TIME_LIMIT_FRAMES;

      spawnTileX = tutMap.humanStartTile.x;
      spawnTileY = tutMap.humanStartTile.y;
      this.pm = new PlayerManager(spawnTileX, spawnTileY, levelDef.xpDiminishingTiers);
      setSkillBookReaders([this.pm.human, this.pm.cat]);
      // Place cat at its own spawn room, separated from the human
      this.pm.cat.x = tutMap.catStartTile.x * TILE_SIZE;
      this.pm.cat.y = tutMap.catStartTile.y * TILE_SIZE;

      tutorialController.initializePlayers(this.human, this.cat);
      this.floorEntryHumanSnap = snapPlayer(this.human);
      this.floorEntryCatSnap = snapPlayer(this.cat);

      initialMobs.push(...tutorialController.allMobs);
      // The tutorial's treasure room has no guards, so its chest unlocks at once.
      this.treasureChests.addWoodenChest(
        TUTORIAL_CHEST_POS.x,
        TUTORIAL_CHEST_POS.y,
        TUTORIAL_TREASURE_ROOM_BOUNDS,
        { coins: 0, items: [] },
        'when_room_clear',
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
      this.pm = new PlayerManager(
        spawnTileX,
        spawnTileY,
        levelDef.xpDiminishingTiers,
        interiorReturn ?? undefined,
      );
      setSkillBookReaders([this.pm.human, this.pm.cat]);
      if (interiorReturn !== null) {
        // Built fresh, a crawler carries nothing a snapshot does not; a held one
        // must match, or the swing it was frozen in at the door resumes outside.
        for (const crawler of this.pm.players()) {
          crawler.clearTransientCombatState();
          crawler.resetCombatState();
        }
      }

      if (options?.humanSnap) restorePlayer(this.human, options.humanSnap);
      if (options?.catSnap) restorePlayer(this.cat, options.catSnap);
      this.pm.setPartyDown(findPartyArrivalTiles(this.gameMap, spawn));

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
      if (interiorReturn !== null) {
        initialMobs.push(...interiorReturn.mobs);
        fairyLedger = interiorReturn.fairyLedger;
      } else {
        const partyLevel = partyLevelOf(this.human.level, this.cat.level);
        const difficultyProfile = activeDifficultyProfile();
        // Read from the save itself on a resume: the saved `townMemory` is only
        // applied once every system exists, long after the roster is filled.
        const clearedCamps = new Set(
          options?.persistedWorldState?.townMemory.clearedCamps ??
            options?.townMemory?.clearedCamps,
        );
        const preDefeatedBossTypes = options?.preDefeatedBossTypes ?? [];
        initialMobs.push(
          ...spawnForLevel(
            levelDef,
            this.gameMap,
            partyLevel,
            difficultyProfile,
            clearedCamps,
            Math.random,
          ).filter(
            // Left out of the roster entirely, not just marked dead: a boss
            // skipped this way never fights, so nothing should ever find it
            // alive, and the hard-mode healer spawn below only puts one beside a
            // boss it can find in its room.
            (mob) =>
              !(mob.isBoss && preDefeatedBossTypes.some((type) => type === mob.spawnTypeKey)),
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
        initialMobs.push(
          ...spawnExtraMobs(levelDef, this.gameMap, partyLevel, difficultyProfile, Math.random),
        );

        if (levelDef.hasTreasureRoomGuards === true) {
          initialMobs.push(
            ...spawnTreasureRoomMobs(
              this.gameMap.treasureRooms,
              levelDef,
              this.gameMap,
              partyLevel,
              difficultyProfile,
              Math.random,
            ),
          );
        }
      }
    }

    // The map — freshly generated, reused across a checkpoint restore, or the
    // tutorial's — is what owns the art seed, and every runtime painter reads it
    // from the module slot rather than being handed it. Set before the first tile
    // chunk or ground sheet is baked, and never again while this floor is live:
    // a chunk baked under one seed and drawn under another is a silent tear.
    setFloorArtSeed(this.gameMap.artSeed);
    prepareGroundTone(this.gameMap.structure);

    // Queued, not painted: the cache spends a few milliseconds a frame on these
    // so the floor fades in while its ground arrives, and re-bakes the tile
    // chunks each time a sheet lands — chunks near the player bake against each
    // material's fallback colour first and would otherwise keep it forever.
    const repaintTileArt = (): void => this.gameMap.markTileArtStale({ includeFacades: false });
    this.gameMap.setTileArtDetail(() => renderQuality.fullDetail);
    requestGroundSheets(
      groundSheetKeysAmong(requiredSpriteKeysForLevel(levelDef.id, levelDef.spriteGroups)),
      repaintTileArt,
    );
    // After the ground, because the queue drains in request order and a floor
    // with no ground yet is unreadable while a floor with no trees yet is merely
    // sparse. The same tile-art invalidation applies: a decoration bakes into a
    // chunk, and a chunk baked before its sheet landed would keep the gap.
    requestEnvironmentSheetsForGroups(levelDef.spriteGroups, { onSheetPainted: repaintTileArt });
    // The buildings' sheets are asked for by these sets, from the arrival's
    // decision on, nearest the party first.
    const sheetPlacements = environmentSheetPlacements(
      this.gameMap.structure,
      levelDef.spriteGroups,
    );
    this.residency.register(
      new EnvironmentSheetResidentSet(FACADE_RING, sheetPlacements.still, {
        bakesUnderLoadingScreen: true,
      }),
    );
    this.residency.register(
      new EnvironmentSheetResidentSet(FACADE_LIFE_RING, sheetPlacements.life, {
        bakesUnderLoadingScreen: false,
      }),
    );

    this.world = {
      gameMap: this.gameMap,
      bus: this.bus,
      audio: this.audio,
      audioScope: this.audioScope,
      pm: this.pm,
      roster: new MobRoster(this.gameMap, new SpellSystem()),
    };
    for (const mob of initialMobs) this.world.roster.add(mob);

    // After the initial spawn, and only ever here: this is the floor's true
    // starting occupancy, which a stairwell room's *entry* save is gated on.
    this.roomsClearAtFloorStart =
      interiorReturn?.roomsClearAtFloorStart ??
      new Set(
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
    if (options?.hudView !== undefined) {
      this.miniMap.setExpanded(options.hudView.miniMapExpanded);
    }
    this.safeRoom = new SafeRoomSystem(this.gameMap, { kind: 'floor', level: this.levelDef.id });
    this.dave = new DaveGuideSystem(
      {
        safeRooms: this.safeRoom,
        conversation: this.conversation,
        whereabouts: this.daveWhereabouts,
        camera: () => this.camera(),
        audio: this.audio,
        onArrived: (room) => this.onDaveArrived(room),
      },
      // A reload resumes in the room it saved in, where he already stands.
      this.partySafeRoom() ?? this.daveWhereabouts.room,
    );
    this.dave.setMarkerSource((room) => this.daveMarkerFor(room));
    this.dave.holdWhile(() => this.cutscenes.isActive);
    this.combat = new CombatKit({
      world: this.world,
      abilityManager: this.abilityManager,
      safeRoom: this.safeRoom,
    });
    this.menus = new MenusKit({
      world: this.world,
      abilityManager: this.abilityManager,
      petNames: this.petNames,
      heldItemId: () => this.readiedDynamiteId(),
      ...(tutorialController === null
        ? {}
        : {
            inventoryRestrictions: () => tutorialController.inventoryRestrictions(),
            onBlockedInventoryDrag: () => tutorialController.triggerHoodieDragHint(),
            inventoryCrawlerLock: () => {
              const restriction = tutorialController.pauseRestriction();
              return restriction?.kind === 'inventory' ? restriction.crawler : null;
            },
          }),
      // The tutorial waits on this one: `SWITCHED_TO_CAT` locks the cat in place
      // until she drinks, or until she is at full health without drinking.
      onPotionDrunk: (id) => {
        if (id === 'health_potion') this.tutorial?.onPotionUsed();
      },
    });
    this.menus.questReward.setOpenConditions({
      conversationOpen: () => this.conversation.isOpen,
      worldHeld: () => this.gameplayHalted,
    });
    this.missingPetNames = new MissingPetNames({
      prompt: this.menus.petNamePrompt,
      petNames: this.petNames,
      keyboardAnchor: this.sceneManager.canvas,
      owned: {
        deinonychus: () => this.deinonychusSystem.unlocked,
        attackCow: () => this.attackCowState.owned,
      },
      portraits: {
        deinonychus: deinonychusPortrait(() => this.abilityManager.getLevel('deinonychus')),
        attackCow: attackCowPortrait,
      },
    });
    this.menus.questReward.onClosed = (spec) => this.flyQuestRewards(spec);
    this.menus.useSceneItem = (item) => {
      if (item.id === 'wayfinders_anchor') this.recall.requestTravel(this.active());
    };
    this.chat = new ChatKit({
      world: this.world,
      abilityManager: this.abilityManager,
      godModeState: this.godModeState,
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
    this.systemNotices = new SystemNoticeSystem(this.bus, this.menus.toasts);
    // The safe-room counter is stamped here rather than in the generators: it
    // belongs to every safe room on every map, and this and BuildingInteriorScene
    // are the only two places a safe room is ever brought to life. Idempotent,
    // because a reused map instance passes through here again on every scene
    // reconstruction.
    this.bopca = new BopcaSystem(
      this.gameMap,
      stampSafeRoomCounters(this.gameMap),
      this.bus,
      this.conversation,
      this.audioScope,
      false,
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
    this.gymRoom = gauntletRoomDressings.gym;
    // Anchored to the room he spawns into rather than to where his corpse ends
    // up: a knockback onto a doorway or boundary tile can land his death
    // position outside every tracked boss room, which would otherwise pin
    // this at -1 and make the Pecking Order gauntlet permanently unclearable.
    this.bigRoosterBossRoomIdx =
      levelDef.bossRooms?.findIndex((b) => b.type === 'big_rooster') ?? -1;
    this.arenaRoom = new ArenaRoomSystem(this.gameMap.arenaExteriors[0]);
    this.barriers = new BarrierSystem(this.gameMap);
    this.defendQuest = new DefendQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => this.world.roster.add(mob),
      this.conversation,
      () => {
        const band = levelDef.defendQuestWave;
        if (band === undefined) return 1;
        return resolveAmbientLevel(
          band,
          levelDef,
          partyLevelOf(this.human.level, this.cat.level),
          activeDifficultyProfile(),
          Math.random,
        );
      },
      levelDef.levelledCurve,
      levelDef.defendQuestIntensity,
      this.audioScope,
    );
    this.cloggedBathroom = new CloggedBathroomSystem({
      gameMap: this.gameMap,
      bus: this.bus,
      roster: this.world.roster,
      conversation: this.conversation,
      audio: this.audio,
      audioScope: this.audioScope,
      announce: (message, opts) => this.menus.announce(message, opts),
      startSolved: options?.bathroomSolvedAtStart?.(this.gameMap) ?? false,
    });
    this.objectiveBeaconSources.push(this.cloggedBathroom);
    this.stealthKeySnatch = new StealthKeySnatchSystem({
      gameMap: this.gameMap,
      bus: this.bus,
      roster: this.world.roster,
      conversation: this.conversation,
      audio: this.audio,
      announce: (message, opts) => this.menus.announce(message, opts),
      startOpened: options?.stealthGateOpenAtStart?.(this.gameMap) ?? false,
    });
    this.objectiveBeaconSources.push(this.stealthKeySnatch);
    if (this.tutorial !== null) this.objectiveBeaconSources.push(this.tutorial);
    this.roomSaves = [this.cloggedBathroom, this.stealthKeySnatch].map((source) => ({
      source,
      latch: { wasInside: false, owed: false },
    }));
    this.grateSpikes = new GrateSpikesMenu({
      defendQuest: this.defendQuest,
      human: this.human,
      cat: this.cat,
      audio: this.audio,
      announce: (message) => this.menus.announce(message),
    });
    this.spiderQuest = new SpiderQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => {
        this.world.roster.add(mob);
        // The lab's boss arrives through this closure rather than the level's
        // initial spawn, so it missed the one-shot filter that builds this
        // list at construction — which is what renders its ground traps and
        // spit and plays its slam. Without this the boss is silent and
        // trapless until something else rebuilds the list.
        if (mob instanceof GrotesqueSpider) this.grotesqueSpiders.push(mob);
      },
      this.conversation,
      (questId) => grantQuestFreeSpin(this.wheelLedger, questId),
      this.spiderTerminalDifficulty,
    );
    if (options?.spiderQuestAwaitingHackingAtStart === true) {
      this.spiderQuest.startAwaitingHacking();
    }
    this.spiderQuest.labDressing?.setLootSink(this.destruction.loot);
    this.starlightTentProgress = options?.starlightTentProgress ?? createStarlightTentProgress();
    this.murderQuestProgress = options?.murderQuestProgress ?? createMurderQuestProgress();
    this.anchorQuestProgress = options?.anchorQuestProgress ?? createAnchorQuestProgress();
    this.journalProgress = options?.journalProgress ?? createJournalProgress();
    this.tacticsNoticesSeen = options?.tacticsNoticesSeen ?? new Set<TacticsTrait>();
    this.tacticsNotices = new TacticsNoticeSystem(this.tacticsNoticesSeen);
    this.bountyProgress = options?.bountyProgress ?? createBountyProgress();
    this.midgeEscortCarry = options?.midgeEscortCarry ?? createMidgeEscortCarry();
    this.doomsdayQuestProgress = options?.doomsdayQuestProgress ?? createDoomsdayProgress();
    this.casinoState = options?.casinoState ?? createCasinoState();
    this.wheelLedger = options?.wheelLedger ?? createWheelLedger();
    this.attackCowState = options?.attackCowState ?? createAttackCowState();
    // Whatever the wheel still owes (a spin a closed tab committed but never
    // paid, a freeze not yet spent, a prize waiting for bag room) is paid
    // now, silently, so a reload can never undo a spin.
    settleWheelLedger(this.wheelLedger, {
      human: this.human,
      cat: this.cat,
      grantAttackCow: () => {
        this.attackCowState.owned = true;
        this.attackCowState.hp = null;
        this.attackCowState.restingUntilFull = false;
      },
    });
    this.townMemory = options?.townMemory ?? createTownMemory();
    this.partyCrafts = options?.partyCrafts ?? createPartyCraftsState();
    this.partyTools = new PartyTools(this.partyCrafts.tools);
    // Self-heals any drift between the two inventories (a stray other-tier
    // tool, one crawler missing the current tier entirely). A no-op while no
    // tool has ever been granted, since `reconcile` only touches a kind whose
    // tier is non-null.
    this.partyTools.reconcile(this.human, this.cat);
    this.briarHollowState = options?.briarHollowState ?? createBriarHollowState();
    this.shopStock = options?.shopStock ?? createShopStock();
    this.mercenaryRoster = options?.mercenaryRoster ?? createMercenaryRoster();
    this.floorEntryMercenaryRoster =
      options?.floorEntryMercenaryRoster ?? captureMercenaryRoster(this.mercenaryRoster);
    this.mercenarySystem = new MercenarySystem(
      this.mercenaryRoster,
      levelDef.id,
      (entity) => this.safeRoom.isEntityInSafeRoom(entity),
      {
        toast: (message) => this.menus.toasts.post(message),
        sound: (id) => this.audio?.play(id),
      },
    );
    this.attackCowSystem = new AttackCowSystem(
      this.attackCowState,
      levelDef.floorNumber,
      this.petNames,
      {
        toast: (message) => this.menus.toasts.post(message),
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
      ? new TreeSystem(this.gameMap, (tileX, tileY) => this.miniMap.markTileChanged(tileX, tileY))
      : null;
    // Overworld-only, mirroring `TreeSystem` above: no other map is ever
    // generated with a water tile on it, so elsewhere this would scan the
    // viewport every frame to find nothing.
    this.water = levelDef.isOverworld
      ? new WaterAnimationSystem(this.gameMap, () => renderQuality.fullDetail)
      : null;
    this.lavaBalls = new LavaBallSystem(this.gameMap);
    this.rockThrows = new RockThrowSystem(this.gameMap);
    this.hirelingShots = new HirelingShotSystem(this.gameMap, (point) =>
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
    this.explosionShake = new ExplosionShake(this.bus, () => this.active());
    this.goblinBombs = new GoblinBombSystem({
      gameMap: this.gameMap,
      bus: this.bus,
      destructibles: this.destruction.destructibles,
      trees: () => this.trees,
      siegeStructures: () => {
        const kit = this.briarHollowKit;
        if (kit?.assault?.inSiege !== true) return null;
        return kit.defences?.defense ?? null;
      },
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
    this.companion.registerHazardSource(this.goblinBombs);
    this.companion.registerHazardSource(this.bossRoomDressings);
    this.combat.mobLoop.registerHazardSource(this.bossRoom);
    this.combat.mobLoop.registerHazardSource(this.bossRoomDressings);
    this.combat.mobLoop.registerHazardSource(this.clownGas);
    this.combat.mobLoop.registerHazardSource(this.fairyFireballs);
    this.combat.mobLoop.registerHazardSource(this.goblinBombs);
    this.combat.mobLoop.registerHazardSource(this.lavaBalls);
    // Burning oil is floor anyone can step out of, so both sides steer clear of it.
    this.companion.registerHazardSource(this.destruction.destructibles);
    this.combat.mobLoop.registerHazardSource(this.destruction.destructibles);
    this.destruction.destructibles.setFlameSources([
      this.destruction.dynamite,
      this.fairyFireballs,
      this.lavaBalls,
      this.combat.spells,
    ]);
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
            this.menus.toasts.post(`The ${companionName} is too far away.`, {
              tone: 'danger',
              durationTicks: COMPANION_ERROR_DISPLAY_FRAMES,
            });
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
    this.followerMenu.onToggleDeinonychusAutoSummon = () => {
      this.audio?.play('menu_change_follower');
      settings.setCatAutoSummonsDeinonychus(!settings.catAutoSummonsDeinonychus);
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

        // Gear's once-per-floor effects are readied for the floor below before
        // the save, so a reload on arrival finds them ready too.
        this.human.gear.startNewFloor();
        this.cat.gear.startNewFloor();

        // Save progress immediately so the floor is recorded as complete even if
        // the player closes the browser during the celebration screen.
        const floorCompleteHumanSnap = revivedSnapshot(snapPlayer(this.human));
        const floorCompleteCatSnap = revivedSnapshot(snapPlayer(this.cat));
        void this.dispatchSaveProgress({
          humanSnap: floorCompleteHumanSnap,
          catSnap: floorCompleteCatSnap,
          ...this.partyRunSaveFields({
            human: floorCompleteHumanSnap,
            cat: floorCompleteCatSnap,
            ...this.deinonychusPetSaveState(),
          }),
          levelId: levelDef.nextLevelId,
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
          // Dismiss Deinonychus and any hired merc before floor transition
          this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
          this.attackCowSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
          this.attackCowSystem.prepareForNewFloor();
          // The cache-wide flush below returns cells but keeps pins, so what
          // this floor's residency holds is unpinned here.
          this.residency.releaseAll();
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
              arrivedOnFloor: true,
              // Taking the stairs regroups the party: a companion carried down
              // still knocked out would time out on arrival with no way to reach them.
              humanSnap: revivedSnapshot(snapPlayer(this.human)),
              catSnap: revivedSnapshot(snapPlayer(this.cat)),
              humanAchievements: this.humanAchievements,
              catAchievements: this.catAchievements,
              musicLibrary: this.musicLibrary,
              storyDirector: this.storyDirector,
              petNames: this.petNames,
              deinonychusUnlocked: this.deinonychusSystem.unlocked,
              deinonychusPetState: this.deinonychusPetState,
              wheelLedger: this.wheelLedger,
              attackCowState: this.attackCowState,
              abilityManager: this._cleanAbilityManager(),
              // Party progress, not floor state: an axe bought on this floor is
              // still the axe in hand on the next one.
              partyCrafts: this.partyCrafts,
              saveProgress: this.onSaveProgress,
              audio: this.audio ?? undefined,
              onResetGame: this.onResetGameCallback ?? undefined,
              progressWipe: this.progressWipe ?? undefined,
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

    const travelState: TravelUnlockState = {
      townMemory: this.townMemory,
      briarHollow: this.briarHollowState,
      anchor: this.anchorQuestProgress,
    };
    this.travelUnlocks = travelState;
    this.travelMenu = new TravelMenu(this.gameMap, travelState, (caster, destination) =>
      this.recall.beginChannelTo(caster, destination),
    );
    this.recall = new RecallSystem(
      this.gameMap,
      levelDef,
      this.bus,
      () => this.bossRoom.anyLocked,
      (player, rangePx) => hostileWithinRadius(player, this.world.roster.grid, rangePx),
      (tile) => this.warpPartyForRecall(tile),
      (message) => this.menus.toasts.post(message),
      this.audio,
      travelState,
      (caster) => {
        this.travelMenu.open(caster);
        this.audio?.play('menu_open');
      },
    );
    if (options?.existingMap !== undefined && options.existingRecallState !== undefined) {
      this.recall.restoreCheckpoint(options.existingRecallState);
    }
    if (options?.existingMap !== undefined && options.existingGroundPickups !== undefined) {
      this.destruction.groundPickups.restoreCheckpoint(options.existingGroundPickups);
    }

    if (this.gameMap.buildingEntries.length > 0) {
      this.building = new BuildingSystem(
        this.gameMap,
        (entry) => this.requestBuildingEntry(entry),
        {
          blockedMessage: (entry) => this.sealedBuildingMessage(entry),
          onRefused: (message) => {
            this.audio?.play('error');
            this.menus.toasts.post(message);
          },
        },
      );
    }

    if (levelDef.isOverworld) {
      this.noticeBoard = new NoticeBoard();
      this.marketPanel = new ShopSession();
      this.fortuneTeller = new FortuneTable();
      // Both built before TownLifeSystem so their blocked tiles are excluded from
      // the citizen spawn candidates — and the market first, so the other props
      // can steer clear of the stall footprints it claims.
      this.market = new MarketSystem(
        this.gameMap,
        this.shopStock,
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
      this.townLife = new TownLifeSystem(this.gameMap, () => renderQuality.fullDetail);
      const townLife = this.townLife;
      this.residency.register(
        new CrowdResidentSet({
          people: () => [...townLife.people, ...(this.market?.vendors ?? [])],
        }),
      );
      this.bounty = new BountySystem(
        this.gameMap,
        this.bus,
        this.bountyProgress,
        (mob) => this.world.roster.add(mob),
        this.conversation,
        this.audio,
        (coins, worldX, worldY) => {
          const cam = this.camera();
          this.rewardFly.enqueueCoins(coins, worldX - cam.x, worldY - cam.y);
        },
      );
      if (bountyGiverTile !== null) {
        this.bounty.placeShady(bountyGiverTile);
      } else {
        // No room beside the parlour — he cannot be talked to, so send the
        // collect arrow to its door rather than nowhere.
        const fallbackTile = this.townProps.bountyGiverFallbackTile;
        if (fallbackTile !== null) {
          this.bounty.setCollectPoint(
            (fallbackTile.x + TILE_CENTER_OFFSET) * TILE_SIZE,
            (fallbackTile.y + TILE_CENTER_OFFSET) * TILE_SIZE,
          );
        }
      }
      this.circusAmbience =
        this.gameMap.circusGrounds === null ? null : new CircusGroundsAmbience();
      this.highStriker =
        this.gameMap.circusGrounds === null ? null : new HighStrikerSystem({ audio: this.audio });
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
        crafts: this.partyCrafts,
        openDualHarvestHint: () => void this.menus.craftExplainers.open('dual_harvest'),
      });
      const gathering = this.gathering;
      this.companion.registerHarvestSource(gathering);
      this.menus.inventoryActions.extraContextOptions = (item) => gathering.contextOptionsFor(item);
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
              conversation: this.conversation,
              keybindings,
              groundPickups: this.destruction.groundPickups,
              dynamite: this.destruction.dynamite,
              noteResourceActivity: () => gathering.hud.noteActivity(),
              onTileChanged: (tileX, tileY) => this.miniMap.markTileChanged(tileX, tileY),
              worldHalted: () => this.gameplayHalted,
              isInSafeRoom: (point) => this.safeRoom.isEntityInSafeRoom(point),
              music: () => this.audioScope,
              bossIntro: (name, color) => {
                this.bossIntro.trigger(NECROMANCER_BOSS_TYPE, name, color);
              },
              assaultLevel: () =>
                resolveVillageAssaultLevel(
                  levelDef,
                  partyLevelOf(this.human.level, this.cat.level),
                  activeDifficultyProfile(),
                  Math.random,
                ),
              midgeEscortCarry: this.midgeEscortCarry,
              travelUnlocks: this.travelUnlocks,
              grantWheelFreeSpin: (questId) => grantQuestFreeSpin(this.wheelLedger, questId),
              flyCoins: (coins, worldX, worldY) => {
                const cam = this.camera();
                this.rewardFly.enqueueCoins(coins, worldX - cam.x, worldY - cam.y);
              },
              taloncrestRoomOwnedByStory: (buildingId) =>
                interiorRoomOwnedByStory(buildingId, {
                  murderStage: this.murderQuestProgress.stage,
                  anchor: this.anchorQuestProgress,
                }),
              openNoticeBoard: () => this.openVillageNoticeBoard(),
              fullDetail: () => renderQuality.fullDetail,
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
      this.audio,
    );
    this.awards = new AchievementAwards({
      owns: this.partyOwnsGear,
      humanAchievements: this.humanAchievements,
      catAchievements: this.catAchievements,
      human: this.human,
      cat: this.cat,
      bus: this.bus,
      activeCrawler: () => (this.cat.isActive ? 'cat' : 'human'),
      inTutorial: () => this.tutorial !== null,
    });
    this.bossRoom.setHostileWorldClock(() => this.combat.worldStepTaken);
    this.combat.gear.onSetCompleted = (kind) => this.awards.unlockDressedForTheOccasion(kind);
    this.combat.gear.onRelicKill = (kind) => this.awards.recordRelicKill(kind);
    this.aiChallenges = new AIChallengeSystem({
      bus: this.bus,
      gameMap: this.gameMap,
      human: this.human,
      cat: this.cat,
      postToast: (text, opts) => this.menus.toasts.post(text, opts),
      grantReward: (side, rarity) => {
        this.awards.grantChest(side === 'Human' ? 'human' : 'cat', { rarity, source: 'challenge' });
      },
    });
    this.aiInteractions = new AIInteractionStage({
      bus: this.bus,
      challenges: this.aiChallenges,
    });
    this.achievementUI.presentationGate = () => this.showsAchievementUi;
    this.achievementUI.onPresentationOpened = (presentation) =>
      joinDeinonychusOnOpen(presentation, this.deinonychusSystem);
    this.achievementUI.onPresentationClosed = (presentation) =>
      this.onRewardPresentationClosed(presentation);

    this.floorEntryHumanAchievements =
      options?.floorEntryHumanAchievements ?? this.humanAchievements.clone();
    this.floorEntryCatAchievements =
      options?.floorEntryCatAchievements ?? this.catAchievements.clone();

    // Built here rather than as a field initialiser because it needs both the
    // shared pet state and a live read of the pet's ability level: a scene
    // handed no pet state still seeds him at the maximum his level carries.
    const petMaxHp = getDeinonychusStats(this.abilityManager.getLevel('deinonychus')).maxHp;
    this.deinonychusPetState =
      options?.deinonychusPetState ?? createDeinonychusPetState(petMaxHp, petMaxHp);
    this.deinonychusSystem = new DeinonychusSystem(
      this.deinonychusPetState,
      () => this.abilityManager.getLevel('deinonychus'),
      (amount) => {
        this.abilityManager.addXp('deinonychus', amount);
      },
      () => deinonychusXpFraction(this.abilityManager),
      this.menus.toasts,
      this.petNames,
    );
    if (options?.deinonychusUnlocked) {
      this.deinonychusSystem.unlocked = true;
    }
    this.deinonychusCarryPending = options?.deinonychusWasOut === true;
    this.companionsWaitingAtPrisonDoor = options?.companionsWaitAtPrisonDoor === true;
    this.devPrisonLayout = options?.devPrisonLayout ?? null;
    this.devPrisonEntryPending = options?.devEnterPrisonAtStart === true;
    this.floorEntryAbilityManager =
      options?.floorEntryAbilityManager ?? this.abilityManager.clone();
    bindAbilityLevelUps({
      abilityManager: this.abilityManager,
      menus: this.menus,
      audio: this.audio,
      petNames: this.petNames,
      onPetLevelUp: () => this.deinonychusSystem.onPetLevelUp(),
      onSparkLevel: () => this.unlockSparkToFlame(),
    });
    bindCraftLevelUps({ bus: this.bus, menus: this.menus, audio: this.audio });
    this.cat.setAbilityManager(this.abilityManager);
    this.human.setAbilityManager(this.abilityManager);
    this.dungeonLighting = this.buildDungeonLighting(levelDef);
    this.dungeonLife = this.buildDungeonLife();
    this.dungeonAmbience = this.buildDungeonAmbience(this.dungeonLife);
    this.labHallway = LabHallwayAtmosphere.forMap({
      gameMap: this.gameMap,
      audio: this.audio,
      audioScope: this.audioScope,
      lights: this.dungeonLighting,
    });

    // Re-apply cheat overlays carried in from the previous scene. God mode is an
    // overlay on top of base stats and so is never present in a snapshot — an
    // active cheat has to be rebuilt here rather than surviving in the stats.
    this.chat.applyCarriedCheat();

    this.onSaveProgress = options?.saveProgress;
    const carriedSave = options?.lastSave;
    if (carriedSave !== undefined) {
      this.lastSave = { progress: carriedSave, checkpoint: null };
      // A safe-room save with no room under either crawler names no tile of its
      // own, so it keeps the resume tile the carried save already had.
      this.lastSavePointTile = carriedSave.world?.resumeTile ?? null;
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
    if (interiorReturn !== null) {
      this.lastSave = interiorReturn.lastSave;
      this.lastSavePointTile = interiorReturn.lastSavePointTile;
      this.staleCarriedSave = interiorReturn.staleCarriedSave;
      this.arrivalSavePending = false;
      for (const roomIndex of interiorReturn.stairwellRoomsSaved) {
        this.stairwellRoomsSaved.add(roomIndex);
      }
      this.daveDebrief = { ...interiorReturn.daveDebrief };
    }
    this.wasInTown = options?.suppressArrivalSave === true;
    this.wasInBriarHollowSaveZone = options?.suppressArrivalSave === true;
    for (const { latch } of this.roomSaves) {
      latch.wasInside = options?.suppressArrivalSave === true;
    }
    this.onResetGameCallback = options?.onResetGame ?? null;
    this.progressWipe = options?.progressWipe ?? null;
    // Additive and cheap even on a re-entry: `preload` skips any id already in
    // `buffers`, so this just tops up whatever this floor needs without
    // re-decoding what a previous floor already loaded. This is the per-floor
    // SFX unload/reload cycle: only the current floor's sounds stay resident.
    void this.audioScope?.preload(sfxGroupsForLevelId(levelDef.id));
    void this.audioScope?.keepCompressed(compressedSfxForLevelId(levelDef.id));
    // Same "additive, cheap on re-entry" reasoning as the SFX preload above,
    // for this floor's declared sprite groups.
    // `prewarmGroups` also forces each sheet's GPU texture upload during this
    // floor's fade-in rather than on whichever frame first draws it.
    // Never awaited here: this must not block scene construction/rendering. A
    // floor with an arrival loading screen waits for it there instead.
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
    const spriteGroupsReady = prewarmGroups(levelDef.spriteGroups).then(() =>
      this.gameMap.markTileArtStale({ includeFacades: true }),
    );
    this.spiderQuest.setSongClock(() => this.audioScope?.keyboardHeroMusicTimeMs() ?? null);
    {
      const signs = new CrawlerSignSystem(
        CrawlerSignSystem.placementsFromMap(this.gameMap),
        (sign) => this.openSignConversation(sign),
      );
      if (!signs.isEmpty) this.crawlerSigns = signs;
    }
    this.skipIntro = options?.skipIntro ?? false;
    if (this.skipIntro) this.dungeonIntro.skip();
    this.overworldMusic =
      levelDef.isOverworld && this.audioScope !== null
        ? new OverworldMusicSystem(this.gameMap, this.audioScope)
        : null;
    this.ambientSound =
      levelDef.isOverworld && this.audioScope !== null
        ? new AmbientSoundSystem(this.audioScope, this.buildTownAmbientEmitters())
        : null;
    this.sfxGates = this.buildSfxGates(levelDef);
    this.murderQuest = new MurderMysteryQuestSystem(
      this.gameMap,
      this.bus,
      (mob) => this.world.roster.add(mob),
      this.murderQuestProgress,
      this.audioScope,
      this.audio,
      this.conversation,
    );
    // Reads the plaza's fortune tile and the tinker's counter through accessors
    // rather than holding either system: both are null on floors with no town.
    this.anchorQuest = new AnchorQuestSystem(
      this.bus,
      this.anchorQuestProgress,
      () => ({ human: this.human, cat: this.cat }),
      () => {
        const tile = this.townProps?.fortuneTellerTile ?? null;
        return tile === null ? null : characterTarget(tile);
      },
      () => stallBeaconTarget(this.market?.stallTileFor(TINKER_VENDOR_ID) ?? null),
      (buildingId) =>
        doorwayBeaconTarget(
          this.gameMap.buildingEntries.find((entry) => entry.id === buildingId) ?? null,
        ),
      (message) => this.menus.announce(message),
      this.conversation,
      this.travelUnlocks,
      this.audio,
    );
    this.doomsdayEscape = new DoomsdayEscapeSystem(
      this.gameMap,
      this.doomsdayQuestProgress,
      (message) => this.menus.toasts.post(message),
      () => (this.human.isKnockedOut || this.cat.isKnockedOut ? STAIRWELL_KNOCKED_OUT_TOAST : null),
    );
    // Y-sorted with the town's fixtures, so the tower above it can never paint over it.
    if (this.townPropRenderables !== null) {
      this.townPropRenderables = [...this.townPropRenderables, this.doomsdayEscape.stairwellProp];
    }
    if (this.tutorial !== null) {
      this.tutorial.setCutscenes(this.cutscenes.director);
    }
    this.menus.pauseScreen.onResetGame =
      this.onResetGameCallback === null ? null : () => this.resetGame();
    this.menus.pauseScreen.skipAudioPause = () =>
      (this.tutorial?.pauseRestriction() ?? null) !== null;
    this.menus.pauseScreen.onOpenChat = () => {
      this.menus.pauseScreen.close();
      this.triggerOpenChat();
    };

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
      this.treasureChests.addWoodenChest(
        tr.centre.x,
        tr.centre.y,
        tr.bounds,
        { coins, items },
        'after_guards_seen',
      );
      this.gameMap.blockTilePermanently(tr.centre.x, tr.centre.y);
    }

    this.chestKit = new ChestKit({
      pm: this.pm,
      audio: this.audio,
      rewardFly: this.rewardFly,
      floorNumber: this.levelDef.floorNumber,
      partyOwnsGear: this.partyOwnsGear,
      reward: (chest, payStandard) => this.chestReward(chest, payStandard),
    });
    this.chestKit.bind(this.treasureChests);

    if (options?.persistedWorldState !== undefined) {
      this.applyPersistedWorldState(options.persistedWorldState);
    }
    if (interiorReturn !== null) this.applyInteriorReturn(interiorReturn);
    this.updateSfxGates();

    this.wireEventBus();
    this.checkFloorEntryAchievements();
    aiAdapter.bindScene(this.createAISceneContext(), this.bus, this.createAIContextSource(), () =>
      this.aiChallenges.endQuietly('left the floor'),
    );

    // From where every arrival path has set the party down, so only what is
    // within reach of it is held and queued.
    this.residency.settleNow(this.residencyOutlook());
    // Last, so every system that queues art or figures on construction — the
    // residency's arrival decision, the residents, the party — has queued it
    // before the loader measures what is owed. Checked on every construction rather than at the
    // call sites that build this scene, because there are several and a floor
    // is arrived on through all of them: stairs, a save, a restart, a door.
    this.warpLoadRequest = {
      kicker: levelLoadingKicker(levelDef),
      title: levelDef.name,
      screen: levelDef.arrivalLoadingScreen,
      tasks: () =>
        floorArrivalLoadTasks({
          gameMap: this.gameMap,
          camera: () => this.camera(),
          viewport: () => ({ width: viewportWidth(), height: viewportHeight() }),
          spriteGroupsReady,
        }),
    };
    this.arrivalLoading.begin({
      ...this.warpLoadRequest,
      returning: options?.existingMap !== undefined,
    });
    for (const surface of this.surfaces()) this.ui.mount(surface);
    const startingPopulation = new Set(initialMobs);
    this.systemSpawnedMobs = new Set(
      this.world.roster.mobs.filter((mob) => !startingPopulation.has(mob)),
    );
    if (interiorReturn !== null) this.enrolSystemSpawnedMobsInCarriedCheckpoint();
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
    if (this.levelDef.id === FIRST_DUNGEON_LEVEL_ID) this.awards.unlockParty('down_the_hatch');
    if (this.abilityManager.getRealLevel('magic_missile') >= MAGIC_MISSILE_SPARK_LEVEL) {
      this.unlockSparkToFlame();
    }
  }

  private unlockSparkToFlame(): void {
    if (this.tutorial !== null) return;
    this.awards.unlock('cat', 'spark_to_flame');
  }

  /**
   * What closing a reward presentation sets going: the tutorial's next step
   * after its first-kill chest, and Deinonychus's arrival after the chest that
   * brought him, each held until the chest is put away so neither stacks
   * over it.
   */
  private onRewardPresentationClosed(presentation: RewardPresentation): void {
    const tutorial = this.tutorial;
    if (
      tutorial !== null &&
      presentation.crawler === 'human' &&
      presentationAwardId(presentation) === 'first_kill'
    ) {
      tutorial.onHumanRewardDialogDismissed();
      this.bus.emit('rewardGranted', {
        rewards: [
          this._makeAbilityReward('seismic_stomp'),
          this._makeAbilityReward('energy_shield'),
        ],
      });
    }
    if (presentsDeinonychus(presentation)) {
      introduceDeinonychus(this.bus, this.menus, {
        deinonychusLevel: () => this.abilityManager.getLevel('deinonychus'),
        petNames: this.petNames,
        keyboardAnchor: this.sceneManager.canvas,
      });
    }
  }

  /**
   * Whether Big Rooster is dead and none of his gateway guards are still
   * standing — the pair of conditions the Pecking Order award needs, which can
   * complete in either order.
   */
  private roosterGauntletFullyCleared(): boolean {
    if (!this.bigRoosterKilled) return false;
    // -1 on a level with no Big Rooster gauntlet, which leaves no centre to measure
    // his guards against.
    if (this.bigRoosterBossRoomIdx < 0) return false;
    const room = this.gameMap.bossRooms[this.bigRoosterBossRoomIdx];
    const guards = this.countLivingMobsOfKindsNear(
      ROOSTER_FLOCK_SPAWN_KEYS,
      room.centre.x * TILE_SIZE,
      room.centre.y * TILE_SIZE,
      PECKING_ORDER_GUARD_RADIUS,
    );
    return guards === 0;
  }

  private tryUnlockPeckingOrder(): void {
    if (this.tutorial !== null) return;
    if (!this.roosterGauntletFullyCleared()) return;
    this.awards.unlock('human', 'pecking_order');
  }

  /** The achievements a kill the party earned can advance or unlock. */
  private awardKillAchievements(mob: Mob, killer: HumanPlayer | CatPlayer): void {
    const kind = killer === this.human ? 'human' : 'cat';
    this.awards.unlock(kind, 'first_kill');
    if (this.tutorial !== null) return;
    if (this.levelDef.isOverworld !== true) this.awards.recordDungeonKill();
    if (kind === 'human' && (mob.killType === 'melee' || mob.killType === 'seismic_stomp')) {
      this.awards.unlock('human', 'up_close');
    }
    if (kind === 'cat' && mob.killType === 'missile') this.awards.unlock('cat', 'magic_touch');
    if (kind === 'cat' && mob.killedUnseen) this.awards.advance('unseenKills', 'cat');
    // The archer is a goblin to the player even though it descends from `Mob`
    // rather than from `Goblin`, so it is named alongside it.
    const isGoblin = mob instanceof Goblin || mob instanceof GoblinArcher;
    if (kind === 'human' && mob.killType === 'seismic_stomp' && isGoblin) {
      this.awards.unlock('human', 'flat_out');
    }
  }

  /**
   * How many living mobs spawned as any of `kinds` are inside the patch of
   * map centred on (x, y) — the encounter's own neighbourhood, not the floor.
   */
  private countLivingMobsOfKindsNear(
    kinds: ReadonlySet<MobKind>,
    x: number,
    y: number,
    radius: number,
  ): number {
    let count = 0;
    for (const mob of this.world.roster.grid.queryCircle(x, y, radius)) {
      if (mob.isAlive && mob.spawnTypeKey !== null && kinds.has(mob.spawnTypeKey)) count++;
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
    this.stopForwardingSceneHooks = forwardSceneHooksToBus(bus, {
      conversation: this.conversation,
    });

    bus.on('spawnGore', (e) => {
      this.combat.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });
    bus.on('bloodVomitRetch', (e) => {
      this.combat.spawnGore(e.x, e.y, e.dirX, e.dirY);
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

    bus.on('bossDefeated', (e) => {
      const boss = debriefBossType(e.bossType);
      if (boss !== null) this.story.noteCarolineMoment({ kind: 'bossDefeated', boss });
    });
    // Her first message is the tutorial's: past it, the intro a skipped
    // tutorial plays tells it in her place.
    if (this.tutorial !== null) {
      bus.on('achievementUnlocked', () =>
        this.story.noteCarolineMoment({ kind: 'firstAchievement' }),
      );
    }

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
      e.player.applyNineLivesKnockoutRelief();
      if (e.player === this.cat && this.human.isAlive && !this.human.isKnockedOut) {
        this.crawlerBarks.say(this.human, [CRAWLER_BARKS.catKnockedOut.paragraphs[0]]);
      }
    });
    barkWhenBlueprintsItemEvicted(bus, { human: this.human, cat: this.cat }, this.crawlerBarks);

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
      if (creditedKiller !== null) this.deinonychusSystem.onKill(this.cat.isActive);

      this.combat.spawnKillGore(mob, killer);
      this.miniMap.addCorpseMarker(cx, cy);
      noteCampCasualty(this.townMemory, mob, this.world.roster.mobs);

      this.attemptStairwellSave(
        this.gameMap.roomIndexAt(Math.floor(cx / TILE_SIZE), Math.floor(cy / TILE_SIZE)),
      );

      if (creditedKiller !== null) this.awardKillAchievements(mob, creditedKiller);

      if (mob.spawnTypeKey !== null && ROOSTER_FLOCK_SPAWN_KEYS.has(mob.spawnTypeKey)) {
        this.tryUnlockPeckingOrder();
      }

      if (this.tutorial === null && mob.paysRewards) {
        mob.droppedLoot = withGearLoot(
          mob.droppedLoot,
          rollKillGear(mob, this.levelDef.floorNumber, Math.random, this.partyOwnsGear),
        );
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
          // Trash Gremlin's guaranteed 9 Lives book is the cat's only reliable
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
        // Every listener that cares which boss died (the difficulty stats, the
        // arena, the music) matches snake_case spawn keys, so the
        // event carries the mob's `spawnTypeKey`.
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
          const alreadyAliveNearby = this.countLivingMobsOfKindsNear(
            new Set<MobKind>([rule.type]),
            mob.x,
            mob.y,
            ON_KILL_SPAWN_CAP_RADIUS,
          );
          const headroom = MAX_CONCURRENT_ON_KILL_SPAWNS - alreadyAliveNearby;
          if (headroom <= 0) continue;
          const onKillContext = liveSpawnContext(
            floorEncounter(this.levelDef.floorNumber, 'on-kill'),
          );
          const rolledCount = randomIntFrom(onKillContext.random, rule.minCount, rule.maxCount);
          const count = Math.min(headroom, rolledCount);
          for (let i = 0; i < count; i++) {
            let placed = false;
            for (let attempt = 0; attempt < SPIT_PLACEMENT_ATTEMPTS && !placed; attempt++) {
              const ox = Math.floor(
                (onKillContext.random() - SPIT_PLACEMENT_RANDOMNESS) * rule.spreadRadius * 2,
              );
              const oy = Math.floor(
                (onKillContext.random() - SPIT_PLACEMENT_RANDOMNESS) * rule.spreadRadius * 2,
              );
              const gtx = tx + ox;
              const gty = ty + oy;
              if (!this.gameMap.isMobSpawnTile(gtx, gty)) continue;
              const spawned = spawnMob(rule.type, { x: gtx, y: gty }, this.gameMap, onKillContext);
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

    bus.on('bossFightInitiated', () => {
      this.damageTakenAtBossFightStart = this.gameStats.damageTaken;
    });

    bus.on('bossDefeated', () => {
      if (this.tutorial === null) {
        for (const kind of CRAWLER_KINDS) {
          if (!this.awards.unlock(kind, 'boss_slayer')) {
            this.awards.grantChest(kind, {
              rarity: BOSS_REPEAT_CHEST_RARITY,
              source: 'bossRepeat',
            });
          }
        }
        const unhurt = this.gameStats.damageTaken === this.damageTakenAtBossFightStart;
        if (unhurt) this.awards.advance('flawlessBossKills', 'human');
      }
      this.damageTakenAtBossFightStart = null;
    });

    bus.on('bossDefeated', (e) => {
      const bossLabel = `Defeated boss: ${e.bossType.replace(/_/g, ' ')}`;
      this.humanAchievements.logRecentEvent(bossLabel);
      this.catAchievements.logRecentEvent(bossLabel);

      if (e.bossType === 'krakaren_clone') this.krakarenKilled = true;

      if (e.bossType === 'big_rooster' && !this.bigRoosterKilled) {
        this.bigRoosterKilled = true;
        this.tryUnlockPeckingOrder();
      }
    });

    bus.on('multiKill', (e) => {
      if (this.tutorial !== null) return;
      if (e.count >= MULTIKILL_ACHIEVEMENT_THRESHOLD) {
        this.awards.unlock(e.killer.crawlerKind, 'wrecking_ball');
      }
    });

    bus.on('dynamiteKills', (e) => {
      if (this.tutorial !== null) return;
      const thrower = e.killer.crawlerKind;
      if (e.kills >= DYNAMITE_MULTIKILL_THRESHOLD)
        this.awards.unlock(thrower, 'two_birds_one_stick');
      if (e.bossKilled) this.awards.unlock(thrower, 'finish_with_a_blow');
    });

    bus.on('rewardGranted', (e) => {
      for (const reward of e.rewards) this.menus.rewardGrantedDialog.enqueue(reward);
    });

    bus.on('playerLevelUp', (e) => {
      const isHuman = e.player === this.human;
      const who = isHuman ? 'Human' : 'Cat';
      const mgr = isHuman ? this.humanAchievements : this.catAchievements;
      mgr.logRecentEvent(`${who} reached level ${e.newLevel}`);
    });

    bus.on('safeRoomEntered', ({ room }) => {
      if (this.tutorial === null) this.awards.unlockParty('safe_haven');
      // Reachable mid-fight: the event fires for either crawler, and one left
      // outside a locked boss room can still walk into a safe room. Both the
      // saved game and the death checkpoint are skipped, so neither one can
      // resume a fight that is still in progress.
      if (this.isBossFightInProgress) return;
      // Nor while anyone is down: a reload would stand them up for free.
      if (this.isRevivePending) return;
      // The room either crawler reached: the active one may still be outside
      // it, and the save point is then the room the companion reached.
      const enteredRoom = this.safeRoom.safeRoomInfo(room);
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
    // rather than waiting for a pin the player has to know exists — unless that
    // would knock a still-active quest off the arrow, in which case the player
    // is asked first (see `pendingQuestSwitch` and `resolvePendingQuestSwitch`).
    //
    // The quest's own id, not the id of whichever step is being tracked right
    // now: the anchor questline re-keys its entry per shard, and a pin on one
    // shard's row would die the moment that shard was found. `pinMatchesEntry`
    // is what lets the shorter id keep resolving.
    bus.on('questStarted', (e) => {
      const pinnedId = this.journalProgress.pinnedTrackerId;
      if (pinnedId !== null && pinnedId !== e.questId) {
        const trackedEntry = resolvePinnedEntry(pinnedId, this._trackerEntries);
        if (trackedEntry !== null) {
          this.pendingQuestSwitch = {
            fromId: pinnedId,
            fromName: trackedEntry.name,
            toId: e.questId,
          };
          return;
        }
      }
      this.journalProgress.pinnedTrackerId = e.questId;
      this.journalProgress.pinSource = 'auto';
    });

    // Each quest pays its own XP and coins and asks for its reward screen; what
    // stays here is what only the scene owns: the achievements it pays, and
    // both crawlers' quest slots. Guardian Angel pays once; every later rescue
    // still earns each crawler a chest of the same rarity.
    bus.on('questCompleted', (e) => {
      if (e.questId === DEFEND_QUEST_ID) {
        for (const kind of CRAWLER_KINDS) {
          if (!this.awards.unlock(kind, 'quest_defend_npc')) {
            this.awards.grantChest(kind, {
              rarity: ACHIEVEMENT_DEFS.quest_defend_npc.reward.rarity,
              source: 'quest',
            });
          }
        }
        this.human.inventory.clearQuestItem('quest_wood_board');
        this.cat.inventory.clearQuestItem('quest_wood_board');
      }
    });

    releaseContractAutoPinOnEnd(bus, this.journalProgress);

    bus.on('questFailed', (e) => {
      if (e.questId === DEFEND_QUEST_ID) {
        this.human.inventory.clearQuestItem('quest_wood_board');
        this.cat.inventory.clearQuestItem('quest_wood_board');
      }
    });

    this.audio?.wireEvents(bus);
    if (this.audioScope !== null) wireBossMusic(bus, this.audioScope);
    this.wireSaveIndicator(bus, this.menus.toasts);
  }

  onEnter(): void {
    bindRunStats(this.gameStats);
    // Ahead of any claim, so the floor's own music is part of the silent backfill.
    if (this.musicBackfillPending) {
      this.musicBackfillPending = false;
      this.backfillMusicFromStartingState();
    }
    bindMusicLibrary(this.musicLibrary);
    if (this.audio !== null) restoreMusicPlayback(this.audio.music, this.musicLibrary);
    this.stopForwardingQuestItemEvictions?.();
    this.stopForwardingQuestItemEvictions = forwardQuestItemEvictions(this.bus, {
      human: this.human,
      cat: this.cat,
    });
    this.stopForwardingEquipmentChanges?.();
    this.stopForwardingEquipmentChanges = forwardEquipmentChanges(this.bus, {
      human: this.human,
      cat: this.cat,
    });
    // Level entry is the one stretch of real rendering the player cannot act
    // during, which is what makes it usable cover for the quality probe.
    renderQuality.requestProbe();
    this.audio?.resume();
    // Delay intro ticking until the AudioContext is running so the intro sound
    // plays in sync with the visual. On desktop this is nearly instant; on mobile
    // it waits for the first user gesture and shows a "Tap to begin" prompt.
    // A floor's own track already playing (back out of a building) is claimed
    // at once, so it carries on through the scene change; a new one starts
    // with the intro, not under the loading screen.
    const music = this.audio?.music ?? null;
    const floorMusic = this.floorMusic;
    if (music !== null && floorMusic !== null && music.isPlaying(floorMusic)) {
      this.claimFloorMusic();
    }
    const arrival = this.active();
    const zoneMusic = this.overworldMusic?.zoneSelectionAt(arrival.x, arrival.y) ?? null;
    if (music !== null && zoneMusic !== null && music.isPlaying(zoneMusic)) {
      this.overworldMusic?.claimZoneAt(arrival.x, arrival.y);
    }
    const startIntro = (): void => {
      this.introStarted = true;
      if (this.tutorial !== null) {
        this.audio?.duckMusic('tutorial', TUTORIAL_MUSIC_DUCK_LEVEL);
      } else {
        // The duck outlives the tutorial's scene, so every later floor lets go of it.
        this.audio?.unduckMusic('tutorial');
        if (!this.skipIntro) this.audio?.playWhenReady('level_begins');
      }
      this.claimFloorMusic();
    };
    // Behind the loading screen too: the sting announces the floor, so it is
    // heard with the banner it belongs to, not over the loading bar.
    this.arrivalLoading.whenClosed(() => {
      if (this.audio === null || this.audio.isRunning) {
        startIntro();
      } else {
        this.audio.onRunning(startIntro);
      }
    });

    const village = this.briarHollowKit;
    this.removeHarvestKeyHook?.();
    this.removeHarvestKeyHook =
      village === null ? null : this.ui.addKeyHook(village.harvestKeyHook);

    this.inputHandler.bind({
      // A key reaches this handler only when no surface consumed it; a pausing
      // or keyboard-taking surface still keeps the rest from gameplay.
      isSuppressed: () => this.ui.keyboardLocked(),
      // The two end-of-floor screens count as over for Escape: each owns the
      // screen until its own button is pressed, and a pause menu opened behind
      // one would take the keyboard from it.
      // The loading screen counts too: a pause menu opened under it would be
      // waiting, unseen, over a floor the player has not been shown yet.
      isGameOver: () =>
        this.gameOver ||
        this.levelCompleteScreen.isActive ||
        this.runCompleteScreen.isActive ||
        this.arrivalLoading.isOpen,
      togglePause: () => this.togglePause(),
      switchCharacter: () => this.triggerSwitchCharacter(),
      spaceAction: () => this.triggerSpaceAction(),
      // No slot: the dedicated potion key means "any bottle you have", unlike a
      // hotbar key or a menu click, which each name one.
      usePotion: () => drinkAnyHealthPotion(this.hotbarHost()),
      toggleInventory: () => {
        this.closeConversationForMenu();
        this.menus.toggleInventory();
      },
      toggleGear: () => {
        this.closeConversationForMenu();
        this.menus.toggleGear();
      },
      companionFollow: () => this.triggerCompanionFollow(),
      toggleMiniMap: () => {
        this.miniMap.toggle();
        this.audio?.play('menu_expand_map');
      },
      toggleMute: () => this.menus.toggleMute(),
      toggleQuestTracker: () => {
        // Same gate as its button: a menu tab that opens onto a floor with no
        // quests to list is worse than a key that does nothing.
        if (!this.hasQuestJournal) return;
        if (this.openQuestJournal()) this.audio?.play('menu_open');
      },
      openChat: () => this.triggerOpenChat(),
      deinonychusSummon: () => this.toggleDeinonychusSummon(),
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

  /**
   * The overworld's gated groups: each held near its place (the village, the
   * circus grounds; a bounty has none) or while `groupsActiveAnywhere` says
   * something under way can play it. Off the overworld there are none, so every
   * held group is let go.
   */
  private buildSfxGates(levelDef: LevelDef): FloorSfxGates | null {
    const audio = this.audio;
    if (audio === null) return null;
    if (!levelDef.isOverworld) return new FloorSfxGates(audio, []);
    const activeAnywhere = (group: GatedSfxGroup) => (): boolean =>
      groupsActiveAnywhere(this.overworldActivity())[group];
    const gates: FloorSfxGate[] = [
      { group: 'bounty', activeAnywhere: activeAnywhere('bounty'), places: [] },
    ];
    const village = this.gameMap.briarHollow;
    if (village !== null) {
      gates.push({
        group: 'briarHollowSiege',
        activeAnywhere: activeAnywhere('briarHollowSiege'),
        places: [village.palisadeBounds],
      });
    }
    const circusCentre = this.gameMap.circusCentre;
    const circusRadius = this.gameMap.circusRadiusTiles ?? 0;
    gates.push({
      group: 'starlightTent',
      activeAnywhere: activeAnywhere('starlightTent'),
      places:
        circusCentre === undefined
          ? []
          : [
              {
                x: circusCentre.x - circusRadius,
                y: circusCentre.y - circusRadius,
                w: circusRadius * 2 + 1,
                h: circusRadius * 2 + 1,
              },
            ],
    });
    return new FloorSfxGates(audio, gates);
  }

  private overworldActivity(): OverworldActivity {
    const assault = this.briarHollowKit?.assault;
    return {
      siegeRunning: assault?.inSiege === true,
      siegeDeadStanding: assault?.hasLivingSiegeMobs === true,
      escortUnderWay: this.briarHollowState.blueprints.phase === 'escort_midge',
      escortAmbushersStanding:
        this.briarHollowKit?.blueprints?.escort.ambush.hasLivingAmbushers === true,
      bountyOut: this.bountyProgress.phase !== 'available',
    };
  }

  private updateSfxGates(): void {
    const gates = this.sfxGates;
    if (gates === null) return;
    const partyTiles = [this.human, this.cat].map((crawler) => ({
      x: Math.floor(crawler.x / TILE_SIZE + TILE_CENTER_OFFSET),
      y: Math.floor(crawler.y / TILE_SIZE + TILE_CENTER_OFFSET),
    }));
    const landing = this.recall.channelLandingTile;
    gates.update(landing === null ? partyTiles : [...partyTiles, landing]);
  }

  onExit(): void {
    // A conversation cut off by the scene changing never closes on its own,
    // and its talk row would stay pinned.
    this.releaseCitizenDialogTarget();
    this.stopForwardingQuestItemEvictions?.();
    this.stopForwardingQuestItemEvictions = null;
    this.stopForwardingEquipmentChanges?.();
    this.stopForwardingEquipmentChanges = null;
    // A scene left while still loading must not leave the probe blindfolded,
    // nor the figure cache unable to let anything go.
    this.arrivalLoading.dispose();
    // Every floor is a fresh `DungeonScene`, which would already start this
    // fresh too — reset defensively anyway, so a hold left outstanding by a
    // dialog that never got its close callback can never surface as a
    // permanently-low coin counter on whatever replaces this scene.
    this.rewardFly.reset();
    this.humanTalk.stop(this.human);
    // Every loop and bed the floor started dies with the scene — unlike music,
    // which may deliberately survive a building round-trip.
    this.audioScope?.dispose();
    this.ambientSound?.dispose();
    this.dungeonAmbience?.dispose();
    this.labHallway?.dispose();
    this.bopca.dispose();
    this.cloggedBathroom.dispose();
    this.stealthKeySnatch.dispose();
    returnUnreadMusicNotices(this.menus, this.musicLibrary);
    this.menus.dispose();
    this.cutscenes.dispose();
    this.inputHandler.unbind();
    this.removeHarvestKeyHook?.();
    this.removeHarvestKeyHook = null;
    // A real <input> on document.body, which swallows every key it is focused
    // for. Left behind, it makes the scene that replaces this one unplayable.
    this.chat.dispose();
    this.spiderQuest.dispose();
    this.bounty?.dispose();
    this.questRoute.dispose();
    this.briarHollowKit?.dispose();
    this.gathering?.dispose();
    this.circusAmbience?.dispose();
    this.highStriker?.dispose();
    this.fairies.dispose();
    this.fairyFireballs.dispose();
    // A floor left mid-fight would otherwise leave its boss's rows pinned in the
    // figure cache for the rest of the page's life.
    this.bossRoom.dispose();
    this.goblinBombs.dispose();
    this.explosionShake.dispose();
    this.fuseSizzle.stopAll(this.audioScope);
    this.dungeonLighting?.dispose();
    // Drops any standing order along with the hazard sources that were meant to
    // steer around it. Both name systems this scene is taking with it.
    this.companion.dispose();
    // Drops the pack-alert grid among other things. It is a module-level handle,
    // so a scene that exited without this leaves its whole mob roster — and
    // through it its `GameMap` — reachable for the rest of the page's life.
    this.combat.dispose();
    // The AI's leave hook (bound in the constructor) has already ended any open
    // challenge, either when the next scene bound or in this unbind, while the
    // AI still heard this bus; dispose only lets go of the subscriptions.
    aiAdapter.unbindScene(this.bus);
    this.aiChallenges.dispose();
    this.stopForwardingSceneHooks();
    this.bus.clear();
    if (!this.floorArtHeldByBuildingVisit) this.releaseFloorArt();
  }

  /**
   * Gives back the baked tile art and the minimap of a map no scene will draw
   * again, at once rather than whenever the browser gets round to collecting
   * the canvases.
   */
  private releaseFloorArt(): void {
    this.gameMap.releaseTileArt();
    this.miniMap.dispose();
  }

  /**
   * Ambient emitters for the overworld town: the fountain, the smithy's forges and
   * the Cloak & Dagger's muffled beat swell as you approach them, a quiet crowd bed fills the square, and city
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
      const workshopBeds: ReadonlyArray<{ id: BriarHollowBuildingId; soundId: SoundId }> = [
        { id: 'briar_hollow_forge', soundId: 'ambient_forge' },
        { id: 'briar_hollow_cookhouse', soundId: 'ambient_cookhouse' },
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
    const smithy = this.gameMap.buildingEntries.find((e) => e.id === 'taloncrest_smithy');
    if (smithy !== undefined) {
      emitters.push({
        soundId: 'ambient_fire_crackling',
        x: smithy.doorTile.x,
        y: smithy.doorTile.y,
        radiusTiles: FORGE_AMBIENT_RADIUS_TILES,
        maxVolume: FORGE_AMBIENT_VOLUME,
      });
    }
    const club = this.gameMap.buildingEntries.find((e) => e.id === 'taloncrest_nightclub');
    if (club !== undefined) {
      emitters.push({
        soundId: 'ambient_cloak_and_dagger_exterior',
        x: club.doorTile.x,
        y: club.doorTile.y,
        radiusTiles: CLOAK_AND_DAGGER_EXTERIOR_AMBIENT_RADIUS_TILES,
        maxVolume: CLOAK_AND_DAGGER_EXTERIOR_AMBIENT_VOLUME,
      });
    }
    return emitters;
  }

  private triggerSwitchCharacter(force = false): void {
    if (!force && this.tutorial !== null && !this.tutorial.canSwitchCharacter) {
      this.audio?.play('error');
      return;
    }
    if (this.inactive().isKnockedOut || this.cloggedBathroom.isStallVisitActive) {
      this.audio?.play('error');
      return;
    }
    this.audio?.play('menu_change_follower');
    this.dave.closeDialog();
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

  /**
   * The `!reveal` cheat: an exact, unquantized bearing to the nearest
   * stairwell. A candidate for the shared arrow arbiter — a debug aid, but
   * still only one arrow may be on screen at a time.
   */
  private stairwellRevealArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ArrowCandidate | null {
    if (!this._revealStairwell) return null;
    const player = this.active();
    const target = this.stairwell.nearestStairwellCenter(player);
    if (target === null) return null;

    return {
      priority: ARROW_PRIORITY.CHEAT_REVEAL,
      draw: () =>
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
            avoidRect: this.hudFramesRect(),
          },
        ),
    };
  }

  private spiderLabArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ArrowCandidate | null {
    if (!this._revealSpiderLab) return null;
    const lab = this.gameMap.spiderLabRoom;
    if (lab === null) return null;

    const player = this.active();
    const px = player.x + TILE_SIZE / 2;
    const py = player.y + TILE_SIZE / 2;
    const targetX = lab.centre.x * TILE_SIZE;
    const targetY = lab.centre.y * TILE_SIZE;

    const dx = targetX - px;
    const dy = targetY - py;
    const angle = Math.atan2(dy, dx);

    return {
      priority: ARROW_PRIORITY.CHEAT_REVEAL,
      draw: () => {
        const t = Date.now();
        const bounce = Math.sin(t * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
        const len = ARROW_LENGTH_PIXELS;
        const arrowX = player.x - camX + TILE_SIZE / 2;
        const arrowY = player.y - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES + bounce;

        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);
        ctx.fillStyle = worldPalette.waymark.cheatReveal;
        ctx.strokeStyle = worldPalette.shade;
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
      },
    };
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

  /**
   * Ends whatever floating conversation is on screen before a full menu opens
   * over it.
   *
   * A street or shop-floor conversation (Dave, a citizen, a sign) never
   * halts the world or locks the keyboard, so the player can keep walking
   * while it's up — but that also means nothing already stopped `i`/`g`/Esc,
   * the HUD buttons or a mobile tap from opening a menu on top of it. Every
   * path that opens the pause menu, the bag or the gear screen calls this
   * first, so the two can never both be on screen.
   */
  private closeConversationForMenu(): void {
    if (this.conversation.isOpen) this.conversation.dismiss();
  }

  /** Pauses into the Journal — the compass button's action and the J key's. */
  private openQuestJournal(): boolean {
    if (this.gameOver) return false;
    this.closeConversationForMenu();
    this.syncJournalContext();
    this.menus.pauseScreen.open('journal');
    // The same housekeeping `togglePause` does, because this opens the same
    // menu: two panels left open behind it would be waiting on the far side of
    // a Resume the player pressed to get back to the game.
    this.menus.closePanels();
    // No sound here: the compass button declares its own, which `UiRoot` plays
    // when the tap fires. The key path plays it at the binding instead, exactly
    // as `togglePause` does.
    return true;
  }

  /**
   * Hands the pause screen this frame's journal, or takes it away.
   *
   * Null is what hides the Journal entry from the pause screen, so the menu has
   * one condition to read rather than a floor number it would have to be told
   * about separately.
   */
  private syncJournalContext(): void {
    if (!this.hasQuestJournal) {
      this.menus.pauseScreen.journalContext = null;
      return;
    }
    const active = this.active();
    this.menus.pauseScreen.journalContext = {
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
   * Whether {@link renderObjectiveBeacons} would draw anything in the view at
   * (`camX`, `camY`): a beacon's beam rises well above its tile, so one a few
   * tiles off screen still counts.
   */
  private hasObjectiveBeacons(camX: number, camY: number): boolean {
    if (this.gameOver || this.menus.pauseScreen.isOpen) return false;
    const reach = TILE_SIZE * BEACON_VIEW_REACH_TILES;
    const inView = (tileX: number, tileY: number): boolean => {
      const x = tileX * TILE_SIZE;
      const y = tileY * TILE_SIZE;
      return (
        x >= camX - reach &&
        x <= camX + viewportWidth() + reach &&
        y >= camY - reach &&
        y <= camY + viewportHeight() + reach
      );
    };
    return this.objectiveBeamTargets().some((target) => inView(target.x, target.y));
  }

  /**
   * The column of light over every objective place on screen: the pinned
   * objective's own tile, and every quest still on offer, unaccepted — Madame
   * Voss's table included, before the player has ever spoken to her.
   *
   * The pinned beam is the counterpart to the world arrow, and deliberately the
   * opposite trade: the arrow gives a bearing from anywhere and goes quiet up
   * close, where a direction is no longer the question. The beam is only ever
   * drawn when the tile is on screen, and answers the question that replaces
   * it — which of the things now in front of the player is the one.
   *
   * The available beams are independent of the pin on purpose: nothing about
   * them implies a quest is under way, only that one could be started.
   * `resolvePinnedEntry` never falls back to picking one of these for the
   * player — that would read as the floor starting with a quest already active
   * — so this is the only thing that points at a quest giver before their quest
   * is accepted.
   *
   * Drawn before the Y-sorted pass, so the marked building or prop — and anyone
   * walking past it — stands in front of its own light. That reads the tracker
   * list a frame before this frame's rebuild, which no one can see.
   *
   * The beams that stand in front are left to the Y-sorted pass, except when
   * restoring light over the darkness: there every beam is floor light the
   * dark must not swallow, wherever it was first drawn.
   */
  private renderObjectiveBeacons(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frontBeams: 'withFrontBeams' | 'withoutFrontBeams' = 'withoutFrontBeams',
  ): void {
    const now = performance.now();
    for (const target of this.objectiveBeamTargets()) {
      if (target.standsInFront === true && frontBeams === 'withoutFrontBeams') continue;
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

  /** Every place that gets a beam this frame; see the `objectiveBeamTargets` it wraps. */
  private objectiveBeamTargets(): ReadonlyArray<TrackerTarget> {
    if (this.gameOver || this.menus.pauseScreen.isOpen) return [];
    return objectiveBeamTargets(
      this.pinnedObjectiveTile,
      this._trackerEntries,
      this.objectiveBeaconSources,
    );
  }

  /**
   * The beams that stand in the street in front of a building, as Y-sorted
   * fixtures: sorted on their own ground line, the building north of them draws
   * first and the crawler walking south of them draws over them.
   */
  private frontObjectiveBeams(): TownPropRenderable[] {
    const renderables: TownPropRenderable[] = [];
    for (const target of this.objectiveBeamTargets()) {
      if (target.standsInFront !== true) continue;
      renderables.push({
        x: target.x * TILE_SIZE,
        y: target.y * TILE_SIZE,
        cullMarginTiles: target.heightTiles ?? FRONT_BEAM_CULL_MARGIN_TILES,
        render(ctx, camX, camY, tileSize) {
          drawObjectiveBeacon(
            ctx,
            target.x * tileSize - camX,
            target.y * tileSize - camY,
            tileSize,
            PINNED_ARROW_COLOR,
            performance.now(),
            target,
          );
        },
      });
    }
    return renderables;
  }

  /**
   * The world arrow for whichever Journal entry the player pinned — including
   * the Briar Hollow siege's assault entry, whose target becomes Vordrick
   * Boneharrow's own position for as long as he is in the field.
   *
   * Suppressed within a few tiles of the target, where the thing is plainly
   * in front of the player. A target flagged `hidesArrowOnScreen` — Vordrick
   * leading his army — stands the arrow down as soon as it is anywhere in
   * view, since an army is visible from much further off than a doorway.
   */
  private pinnedObjectiveArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ArrowCandidate | null {
    const pinned = this.pinnedObjectiveEntry;
    // A pin on the bounty is drawn by the bounty's own arrow, which knows
    // whether it is a hunt or a collect and colours itself accordingly — this
    // generic arrow would otherwise stack a second one under it.
    if (pinned !== null && pinMatchesEntry(BOUNTY_TRACKER_ID, pinned)) return null;
    const target = pinned?.target ?? null;
    if (target === null) return null;
    const aim = target.drawsOwnRoute === true ? null : this.questRoute.aim();
    return this.objectiveArrowCandidate(
      ctx,
      camX,
      camY,
      target,
      ARROW_PRIORITY.PINNED_OBJECTIVE,
      aim,
    );
  }

  /**
   * The pinned target the route guide routes toward, or null when there is
   * none for it: nothing pinned, the bounty (which draws its own arrow), or a
   * target whose source paints its own route.
   */
  private routedPinnedTarget(): TrackerTarget | null {
    const pinned = this.pinnedObjectiveEntry;
    if (pinned === null || pinMatchesEntry(BOUNTY_TRACKER_ID, pinned)) return null;
    const target = pinned.target ?? null;
    if (target === null || target.drawsOwnRoute === true) return null;
    return target;
  }

  /**
   * The route on the ground toward the pinned objective, under every body,
   * led from the active crawler's feet. Stands down with the arrow near the
   * destination, where the place is plainly in front of the player.
   */
  private renderQuestRouteTrail(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!settings.questRouteTrail || this.gameOver || this.menus.pauseScreen.isOpen) return;
    const target = this.routedPinnedTarget();
    if (target === null || this.isObjectiveArrowSuppressed(target, camX, camY)) return;
    const active = this.active();
    const shape = this.questRoute.trailShape(crawlerGroundPoint(active));
    this.questRouteTrail.paint(ctx, shape, camX, camY, performance.now(), {
      view: { width: viewportWidth(), height: viewportHeight() },
      body: crawlerSpriteBox(active),
    });
  }

  /** The world-pixel middle of an objective target's footprint. */
  private objectiveTargetCentre(target: TrackerTarget): { x: number; y: number } {
    const footprintCentreTiles =
      (target.widthTiles ?? SINGLE_TILE_TARGET_WIDTH) * TILE_CENTRE_FRACTION;
    return {
      x: (target.x + footprintCentreTiles) * TILE_SIZE,
      y: (target.y + TILE_CENTRE_FRACTION) * TILE_SIZE,
    };
  }

  /**
   * Whether the player is close enough to `target` that an arrow toward it
   * would say nothing: within a few tiles, or for a target flagged
   * `hidesArrowOnScreen`, anywhere on screen.
   */
  private isObjectiveArrowSuppressed(target: TrackerTarget, camX: number, camY: number): boolean {
    const player = this.active();
    const centre = this.objectiveTargetCentre(target);
    if (target.hidesArrowOnScreen === true) {
      return isWorldPointOnScreen(
        centre.x,
        centre.y,
        camX,
        camY,
        viewportWidth(),
        viewportHeight(),
      );
    }
    const distanceTiles =
      Math.hypot(centre.x - (player.x + TILE_SIZE / 2), centre.y - (player.y + TILE_SIZE / 2)) /
      TILE_SIZE;
    return distanceTiles < OBJECTIVE_ARROW_SUPPRESS_TILES;
  }

  /**
   * The arrow toward the nearest room objective that is lit without a Journal
   * pin — the pipe wall once the plumber has asked for help, the prison door
   * once the guard has explained the key. Floor 2 has no Journal, so without
   * this the beam is the only hint and it is invisible from the room next door.
   * Stands down while the pipe board is up, since the player is already there.
   */
  private roomObjectiveArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ArrowCandidate | null {
    // The tutorial's step arrow already points at every place it lights, and a
    // second arrow toward the same beam would only fight it.
    if (this.tutorial !== null) return null;
    const bathroom = this.cloggedBathroom;
    const atThePipeWall =
      bathroom.isPipeBoardOpen ||
      bathroom.isPipeBoardExplainerOpen ||
      bathroom.difficultyGate.isOpen;
    if (atThePipeWall) return null;
    const player = this.active();
    let nearest: TrackerTarget | null = null;
    let nearestDistance = Infinity;
    for (const source of this.objectiveBeaconSources) {
      for (const target of source.objectiveBeacons()) {
        const distance = Math.hypot(
          target.x * TILE_SIZE - player.x,
          target.y * TILE_SIZE - player.y,
        );
        if (distance < nearestDistance) {
          nearest = target;
          nearestDistance = distance;
        }
      }
    }
    if (nearest === null) return null;
    return this.objectiveArrowCandidate(ctx, camX, camY, nearest, ARROW_PRIORITY.ROOM_OBJECTIVE);
  }

  /**
   * The arrow above the player toward an objective target, aimed at the middle
   * of its footprint so a three-tile doorway is pointed at, not its west tile.
   * Given an `aim`, the bearing comes from it instead (the next gate on the
   * way); whether the arrow shows is still decided by the target itself.
   */
  private objectiveArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    target: TrackerTarget,
    priority: number,
    aim: { readonly x: number; readonly y: number } | null = null,
  ): ArrowCandidate | null {
    if (this.isObjectiveArrowSuppressed(target, camX, camY)) return null;
    const player = this.active();
    const facing = aim ?? this.objectiveTargetCentre(target);

    return {
      priority,
      draw: () =>
        drawArrowAbovePlayer(
          ctx,
          player.x,
          player.y,
          facing.x,
          facing.y,
          camX,
          camY,
          PINNED_ARROW_COLOR,
          {
            avoidRect: this.hudFramesRect(),
          },
        ),
    };
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
    if (this.gameOver || this.menus.pauseScreen.isOpen) return;
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
    const band: MobLevelRange = pickRule(floorRules, Math.random, NO_SPAWN_TERRAIN) ?? {};
    let spawned = 0;
    for (let attempt = 0; attempt < FAIRY_CHEAT_ATTEMPTS && spawned < count; attempt++) {
      const tileX = originX + randomInt(-FAIRY_CHEAT_SPREAD_TILES, FAIRY_CHEAT_SPREAD_TILES);
      const tileY = originY + randomInt(-FAIRY_CHEAT_SPREAD_TILES, FAIRY_CHEAT_SPREAD_TILES);
      if (!this.gameMap.isMobSpawnTile(tileX, tileY)) continue;
      const mob = createFairy(
        kind,
        { x: tileX, y: tileY },
        this.gameMap,
        liveSpawnContext('dev:spawn'),
      );
      this.world.roster.add(mob);
      mob.setHostFloor(this.levelDef.floorNumber);
      mob.applyMobLevel(
        resolveAmbientLevel(band, this.levelDef, partyLevel, profile, Math.random),
        this.levelDef.levelledCurve,
      );
      applySpawnDifficulty(mob, profile);
      mob.stampPotency(settings.difficulty);
      spawned++;
    }
    return spawned > 0 ? `🧚 ${spawned}× ${kind.toUpperCase()} FAIRY` : null;
  }

  /**
   * The cheats this scene adds to the universal ones in `ChatKit`. They reach
   * systems a scene may not have, so a scene without those systems simply does
   * not offer them.
   */
  private dungeonChatCommands(): ReadonlyArray<ChatCommand> {
    return [
      {
        name: '!fairy',
        run: (argument) => this.runFairyCheat(argument),
      },
      {
        name: '!cow',
        run: () => {
          if (!this.grantAttackCow()) return null;
          this.nameAttackCow();
          return '🐄 ATTACK COW';
        },
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
   * Gives the party the human crawler's attack cow and stands her beside him now — the
   * `!cow` cheat. Returns false if she is already owned. A cow the wheel
   * paid on a load is granted by `settleWheelLedger` instead, and named by
   * `missingPetNames` once the floor is up.
   */
  grantAttackCow(): boolean {
    return this.attackCowSystem.grant(this.human, this.gameMap, this.world.roster);
  }

  /** Asks for the attack cow's name unless the run has one. */
  private nameAttackCow(): void {
    namePetThen(
      {
        prompt: this.menus.petNamePrompt,
        petNames: this.petNames,
        keyboardAnchor: this.sceneManager.canvas,
      },
      'attackCow',
      attackCowPortrait,
    );
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
    const landing = findWarpLandingTile(
      this.gameMap,
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
   * What the next frames may be drawn around: the active crawler, whom the
   * camera follows; the other one, whom a switch moves the camera to at once,
   * unless knocked out and so not switchable to; and the landing of a warp
   * that is coming — a recall channel's, or the save point a death screen
   * will put the party back at. Only the death screen covers the world: a
   * channel is played through, its caster still in the fight.
   */
  private residencyOutlook(): ResidencyOutlook {
    const active = this.active();
    const inactive = this.inactive();
    const focus: ResidencyFocus[] = [{ x: active.x, y: active.y }];
    if (!inactive.isKnockedOut) focus.push({ x: inactive.x, y: inactive.y });
    const landing = this.recall.channelLandingTile;
    if (landing !== null) focus.push({ ...tileFocus(landing), landing: true });
    const respawn = this.gameOver ? this.checkpointRespawnFocus() : null;
    if (respawn !== null) focus.push({ ...respawn, landing: true });
    return { focus, covered: respawn !== null };
  }

  /** Where a checkpoint restore would put the party, or null when the death screen leads elsewhere. */
  private checkpointRespawnFocus(): ResidencyFocus | null {
    const route = respawnRouteFor(this.lastSave);
    if (route.kind !== 'checkpoint') return null;
    return { x: route.checkpoint.respawnX, y: route.checkpoint.respawnY };
  }

  /**
   * Readies the landing of a warp that moved the party within this floor. The
   * sound groups are decided here rather than on the next update, because the
   * screen the warp may raise halts updates, and a group the landing needs has
   * to decode under it.
   */
  private settleAfterWarp(): void {
    this.updateSfxGates();
    this.coverWarpIfLandingCold();
  }

  /**
   * Puts the arrival's loading screen over a warp that has just landed the
   * party among resident art not yet baked — a cache full of a fight's rows
   * can outrun the death screen's boosted rewarm and a recall channel's
   * normal-budget one — rather than show stand-ins. A warm landing shows
   * nothing.
   */
  private coverWarpIfLandingCold(): void {
    const residency = this.residency;
    const request = this.warpLoadRequest;
    if (request === null) return;
    // Decided now rather than at the next check, so the rows the landing
    // needs are queued before the screen measures what it owes.
    residency.settleNow(this.residencyOutlook());
    const active = this.active();
    const landing: ResidencyFocus = { x: active.x, y: active.y };
    if (residency.isWarmAround(landing)) return;
    // Its own task, ahead of the arrival's: a row the queue gave up on while
    // a fight held the room is not in the queue the arrival's task drains.
    // Forgiven for the first few frames only, then done when the rows are
    // warm or given up on again: a cache that cannot make room under the
    // screen either — its surfaces refused, its room pinned — leaves a few
    // stand-ins rather than a screen that never lifts.
    let steps = 0;
    const landingTask: LoadTask = {
      label: 'Waking the world',
      work: steppedWork((budgetMs, mustProgress) => {
        steps++;
        if (steps <= WARP_COVER_FORGIVING_STEPS) residency.forgiveAndWarmAround(landing);
        residency.bakeFor(budgetMs, mustProgress);
        const warmth = residency.warmthAround(landing);
        const settled = warmth.share === 1 || !warmth.anyQueued;
        return settled || steps >= WARP_COVER_MAX_STEPS ? 1 : warmth.share;
      }),
    };
    this.arrivalLoading.coverWarp({ ...request, tasks: () => [landingTask, ...request.tasks()] });
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
    const landing = findWarpLandingTile(
      this.gameMap,
      tile.x,
      tile.y,
      TRAVEL_LANDING_STANDOFF_TILES,
      TRAVEL_LANDING_SEARCH_TILES,
    );
    if (landing === null) return false;

    // Deinonychus cannot follow a warp — he goes home and waits to be resummoned.
    // The hire's contract still stands in this same scene, so it respawns
    // beside the party on the next update; dismissing it first is what keeps
    // `mobs` and `mobGrid` in step through the jump rather than leaving it
    // standing where the party no longer is.
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
    this.attackCowSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.placePartyAtTile(landing);
    this.settleAfterWarp();
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
    // With nowhere beside the human the search stacks the companion on the
    // human rather than leaving it behind: the companion is dragged along by
    // every shipped warp, and CompanionSystem gives up past its path budget.
    const { leader, follower } = findPartyArrivalTiles(this.gameMap, landing);
    this.human.x = leader.x * TILE_SIZE;
    this.human.y = leader.y * TILE_SIZE;
    this.cat.x = follower.x * TILE_SIZE;
    this.cat.y = follower.y * TILE_SIZE;
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
  private toggleDeinonychusSummon(): void {
    if (!this.cat.isActive || !this.active().canAct) return;
    if (this.deinonychusSystem.deinonychus) {
      this.deinonychusSystem.toggleRecall();
      return;
    }
    this.summonDeinonychus();
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

  /** Once, on the first gameplay frame of a dev boot that opens inside the prison. */
  private enterPrisonForDev(): void {
    if (!this.devPrisonEntryPending) return;
    this.devPrisonEntryPending = false;
    const entry = this.gameMap.buildingEntries.find((candidate) => candidate.type === 'prison');
    if (entry === undefined) return;
    if (this.stealthKeySnatch.phase === 'unmet') {
      this.stealthKeySnatch.restoreCheckpoint({
        ...this.stealthKeySnatch.captureCheckpoint(),
        phase: 'briefed',
      });
    }
    this.enterBuilding(entry);
  }

  /**
   * The building prompt's Enter. The prison first asks which difficulty to
   * play its stealth at; every other door opens at once.
   */
  private requestBuildingEntry(entry: BuildingEntry): void {
    if (entry.type !== 'prison') {
      this.enterBuilding(entry);
      return;
    }
    this.building?.closeMenu();
    this.prisonDifficulty.open({
      activity: buildingDisplayName(entry.id),
      onPick: (difficulty) => this.enterBuilding(entry, difficulty),
    });
  }

  /**
   * What only the prison's door adds to {@link interiorFloorContext}. The
   * prison is planned here, at the door, and never again: a reload or a
   * defeat inside lands back on this floor, so the picked difficulty lives
   * exactly as long as the visit.
   */
  private prisonVisitContext(
    difficulty: Difficulty,
  ): Pick<InteriorFloorContext, 'stealthKeySnatch' | 'variant'> {
    const worldSeed = this.gameMap.worldSeed;
    const plan =
      this.devPrisonLayout === null
        ? planGoblinPrison(worldSeed, difficulty)
        : planGoblinPrison(worldSeed, difficulty, this.devPrisonLayout);
    return {
      stealthKeySnatch: this.stealthKeySnatch,
      variant: { kind: 'goblin_prison', plan },
    };
  }

  /** Once, on the first frame after the prison, after Deinonychus and the hire have been stood up. */
  private seatCompanionsAtPrisonDoor(): void {
    if (!this.companionsWaitingAtPrisonDoor) return;
    this.companionsWaitingAtPrisonDoor = false;
    const room = this.gameMap.stealthGateRoom;
    if (room === null) return;
    seatCompanionsWaitingOutsidePrison(
      room,
      this.deinonychusSystem.deinonychus,
      this.mercenarySystem.activeMerc,
      this.world.roster.grid,
    );
  }

  private carryDeinonychusIn(): void {
    if (!this.deinonychusCarryPending) return;
    this.deinonychusCarryPending = false;
    const deinonychus = this.deinonychusSystem.carryIn(this.cat, this.gameMap);
    if (deinonychus !== null) this.world.roster.add(deinonychus);
  }

  /**
   * `Player.noteWardBlockedHit` has no scene to bark through, so it raises a
   * pending flag instead; this is the one place both crawlers' flags are
   * drained into the actual bark.
   */
  private drainWardExplainerBarks(): void {
    const humanPending = this.human.pendingWardExplainerBark;
    const catPending = this.cat.pendingWardExplainerBark;
    this.human.pendingWardExplainerBark = false;
    this.cat.pendingWardExplainerBark = false;
    if (!humanPending && !catPending) return;
    if (!isWardExplainerDue(this.gameStats)) return;
    this.gameStats.recordWardExplainerHeard();
    if (humanPending) {
      this.crawlerBarks.say(this.human, barkTexts(CRAWLER_BARKS.wardExplainer.human));
    } else {
      this.crawlerBarks.say(this.cat, barkTexts(CRAWLER_BARKS.wardExplainer.cat));
    }
  }

  /** Returns whether he came out; a refusal has already been spoken by the cat. */
  private summonDeinonychus(): boolean {
    const deinonychus = this.deinonychusSystem.summon(this.cat, this.gameMap);
    if (deinonychus === null) return false;
    this.world.roster.add(deinonychus);
    this.abilityManager.addUsageXp('deinonychus');
    this.audio?.play('deinonychus_released');
    return true;
  }

  /**
   * The companion cat sends Deinonychus in on her own when a fight reaches her.
   *
   * Only while the human is being driven: with the cat in hand the player has
   * the Summon button, and a pet that deployed himself would take the decision
   * away from them. A passive stance is an order to stay out of fights, and
   * sending the pet in would break it by proxy.
   */
  private autoSummonDeinonychus(ctx: SystemContext): void {
    if (!settings.catAutoSummonsDeinonychus) return;
    if (!this.human.isActive || this.deinonychusSystem.deinonychus !== null) return;
    if (this.companion.getCombatStance(true) === 'passive') return;
    // A rest stop is not a staging ground: a hostile in sight through the door
    // would otherwise have him deployed from inside the sanctuary.
    if (this.pm.isAnySafe(this.safeRoom)) return;
    if (!this.deinonychusSystem.catWantsToSummon(ctx)) return;
    if (!this.summonDeinonychus()) this.deinonychusSystem.onAutoSummonRefused();
  }

  /**
   * Routes a death-screen exit to the last save: rewound in place when this
   * scene took it, rebuilt from it when the scene was built after it, and the
   * floor restart only when the run has never saved.
   */
  /** The safe room either crawler stands in, or null. */
  private partySafeRoom(): SafeRoomId | null {
    return this.safeRoom.safeRoomAt(this.human) ?? this.safeRoom.safeRoomAt(this.cat);
  }

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
        this.settleAfterWarp();
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
   * Takes the party through a building's door into its interior, and sets up
   * how they come back out.
   *
   * The overworld is rebuilt around the party on the way out, its creatures
   * regenerated. Any other floor is held aside instead ({@link holdFloorForInterior})
   * and handed back exactly as it was left. `prisonDifficulty` is what the
   * prison's stealth is played at; no other building reads it.
   */
  private enterBuilding(
    entry: BuildingEntry,
    prisonDifficulty: Difficulty = settings.difficulty,
  ): void {
    const levelDef = this.levelDef;
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
      deinonychusUnlocked: this.deinonychusSystem.unlocked,
      deinonychusWasOut: this.deinonychusSystem.followsThroughDoor,
    };
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // A standing hire's health goes into the roster the interior stands it
    // up from; a hire lying downed at the door is lost with this scene.
    this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
    // Her health goes into the shared state the interior stands her up from;
    // down at the door, she goes to rest instead.
    this.attackCowSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // The prison admits neither companion: they wait in the gate room, and
    // Deinonychus walks back out with the party exactly as he stood at the door.
    const companionsWaitOutside = entry.type === 'prison';
    const departureFor = (indoors: InteriorCompanionDeparture): InteriorCompanionDeparture =>
      companionsWaitOutside
        ? { ...indoors, deinonychusWasOut: companionArrival.deinonychusWasOut }
        : indoors;
    const heldFloor = this.floorRegeneratesAroundBuildings
      ? null
      : this.holdFloorForInterior(returnTile);
    this.floorArtHeldByBuildingVisit = true;
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    const hudView: HudViewState = { miniMapExpanded: this.miniMap.isExpanded };
    this.sceneManager.replace(
      new BuildingInteriorScene(
        entry,
        humanSnap,
        catSnap,
        levelDef.xpDiminishingTiers,
        levelDef.arrivalLoadingScreen,
        this.input,
        this.sceneManager,
        (hSnap, cSnap, defeated, companionDeparture) => {
          if (heldFloor !== null) {
            const outside = new DungeonScene(levelDef, this.input, this.sceneManager, {
              ...this.buildingExitOptions(hudView, hSnap, cSnap, departureFor(companionDeparture)),
              spawnAt: heldFloor.returnTile,
              levelTimerFrames: heldFloor.levelTimerFrames,
              interiorReturn: this.withVisitOutcome(heldFloor),
              companionsWaitAtPrisonDoor: companionsWaitOutside,
            });
            this.sceneManager.replace(outside);
            // The floor comes back first, so a defeat indoors is answered exactly
            // as a death outside would be: rewound in place to the last save's
            // checkpoint, with the creatures killed before it still dead.
            if (defeated) outside.respawnAfterDeath();
            return;
          }
          // A defeat indoors is a death like any other, so it lands on the
          // last save rather than on the doorstep the party died behind.
          const lastSave = this.lastSave;
          if (defeated) rearmExpiredDoomsday(this.doomsdayQuestProgress, Date.now());
          if (defeated && lastSave !== null) {
            // The save rebuilds its floor from scratch, so nothing takes over
            // the map this visit was holding.
            this.releaseFloorArt();
            this.respawnFromSave(lastSave.progress);
            return;
          }
          // Unreachable once the floor has taken its arrival save, which
          // the overworld does on its first frame; the start tile at least
          // keeps a defeat off the doorstep.
          const exitTile = defeated ? this.gameMap.startTile : returnTile;
          // A building-exit rebuild is still the same floor, so what the new
          // scene's residency holds moments from now is mostly the same
          // working set — cheap to give back and hold again, and the only way
          // every leave-town path stays covered without special cases for
          // which ones happen to be "the same floor."
          this.residency.releaseAll();
          this.sceneManager.replace(
            new DungeonScene(levelDef, this.input, this.sceneManager, {
              ...this.buildingExitOptions(hudView, hSnap, cSnap, companionDeparture),
              spawnAt: exitTile,
              // The save, not its checkpoint: the rebuilt scene regenerates the
              // overworld's creatures, so mob flags captured against this
              // scene would mean nothing there. An exit inside the town wall
              // saves afresh on its first frame whenever a town save is
              // allowed; until then — and for good after an exit outside the
              // wall, such as the Starlight Tent's — a death respawns from this save.
              lastSave: this.lastSave?.progress,
              existingRecallState: this.recall.captureCheckpoint(),
              existingGroundPickups: this.destruction.groundPickups.captureCheckpoint(),
            }),
          );
        },
        this.shopStock,
        this.humanAchievements,
        this.catAchievements,
        this.audio ?? undefined,
        this.abilityManager,
        {
          starlightTent: this.starlightTentProgress,
          worldSeed: this.gameMap.worldSeed,
        },
        this.murderQuestProgress,
        this.doomsdayQuestProgress,
        this.casinoState,
        this.townMemory,
        this.mercenaryRoster,
        this.godModeState,
        this.companionStance,
        this.deinonychusPetState,
        () => this.abilityManager.getLevel('deinonychus'),
        this.gameStats,
        this.anchorQuestProgress,
        this.gameMap.artSeed,
        this.tacticsNoticesSeen,
        respawnModeFor(respawnRouteFor(this.lastSave)),
        companionsWaitOutside ? NO_INTERIOR_COMPANIONS : companionArrival,
        this.partyCrafts,
        this.briarHollowState,
        // Asked live rather than snapshotted: progress threaded by
        // reference (the anchor shards, the murders) moves indoors, and
        // the Journal should say so while the party is still inside.
        this.hasQuestJournal
          ? { entries: () => this.collectTrackerEntries(), progress: this.journalProgress }
          : undefined,
        hudView,
        heldFloor === null
          ? { ...TOWN_INTERIOR_FLOOR, aiFloorKey: this.aiFloorKey() }
          : this.interiorFloorContext(heldFloor, entry, prisonDifficulty),
        this.interiorPartyRun(returnTile),
      ),
    );
  }

  /**
   * Whether a building's door rebuilds this floor around the party on the way
   * out, creatures regenerated, rather than handing back the floor they left.
   * Only the overworld can afford to: its townsfolk and wildlife are scenery,
   * where a dungeon floor's creatures are the record of the party's progress.
   */
  private get floorRegeneratesAroundBuildings(): boolean {
    return this.levelDef.isOverworld === true;
  }

  /**
   * Holds this floor aside for the length of a building visit: the live party
   * and population, a checkpoint of every system, and the save a death returns
   * to. See {@link DungeonInteriorReturn}.
   *
   * Writes a save at the door first, when one is allowed, so a reload inside
   * resumes on this floor in front of the door rather than at an older save
   * point the party has since walked a long way from. Never with a fight
   * going on at the door: a save cannot hold the creatures in it.
   */
  private holdFloorForInterior(returnTile: TilePoint): DungeonInteriorReturn {
    const saveAllowed =
      this.tutorial === null &&
      !this.isBossFightInProgress &&
      !this.isRevivePending &&
      !this.hasEngagedHostileNearActive();
    if (saveAllowed) this.captureSavePoint(returnTile);
    return {
      human: this.human,
      cat: this.cat,
      mobs: this.world.roster.mobs.filter((mob) => !this.systemSpawnedMobs.has(mob)),
      fairyLedger: this.fairies.ledger,
      world: this.captureWorldCheckpoint(),
      levelTimerFrames: this.levelTimerFrames,
      returnTile,
      lastSave: this.lastSave,
      lastSavePointTile: this.lastSavePointTile,
      staleCarriedSave: this.staleCarriedSave,
      roomsClearAtFloorStart: this.roomsClearAtFloorStart,
      stairwellRoomsSaved: new Set(this.stairwellRoomsSaved),
      daveDebrief: { ...this.daveDebrief },
    };
  }

  /** How a building under this floor is painted, lit and clocked. */
  private interiorFloorContext(
    heldFloor: DungeonInteriorReturn,
    entry: BuildingEntry,
    prisonDifficulty: Difficulty,
  ): InteriorFloorContext {
    const levelDef = this.levelDef;
    return {
      ...(entry.type === 'prison' ? this.prisonVisitContext(prisonDifficulty) : {}),
      levelId: levelDef.id,
      ...interiorArt(levelDef.spriteGroups, levelDef),
      sightRadiusPx: VISIBILITY_RADIUS_PX,
      ownsMusic: false,
      heldLevelTimerFrames: levelDef.hasCollapseTimer === true ? heldFloor.levelTimerFrames : null,
      aiFloorKey: this.aiFloorKey(),
    };
  }

  /** This floor's key for the AI's per-floor allowances, shared with every building on it. */
  private aiFloorKey(): string {
    return aiFloorKey(this.levelDef.id, this.gameMap.worldSeed);
  }

  /**
   * The held floor with what the visit changed folded back in. The checkpoint
   * was taken at the door, but this scene's own stealth gate quest stayed live
   * through the visit as the prison's {@link InteriorFloorContext.stealthKeySnatch},
   * so its explainer and key state are re-captured here on the way out.
   */
  private withVisitOutcome(heldFloor: DungeonInteriorReturn): DungeonInteriorReturn {
    return {
      ...heldFloor,
      world: { ...heldFloor.world, stealthKeySnatch: this.stealthKeySnatch.captureCheckpoint() },
      // Read now rather than kept from the door: a save committed indoors
      // replaces the door's, and a death outside has to land on it.
      lastSave: this.lastSave,
      lastSavePointTile: this.lastSavePointTile,
    };
  }

  /**
   * What every scene rebuilt at a building's door carries over from this one:
   * the party as it walked out, the run's threaded progress, and the floor's
   * entry snapshots — entering a building is a detour, not a new floor, so a
   * floor restart stays pinned to where this floor began.
   */
  private buildingExitOptions(
    hudView: HudViewState,
    humanSnap: PlayerSnapshot,
    catSnap: PlayerSnapshot,
    companionDeparture: InteriorCompanionDeparture,
  ): DungeonSceneOptions {
    return {
      hudView,
      humanSnap,
      catSnap,
      floorEntryHumanSnap: this.floorEntryHumanSnap,
      floorEntryCatSnap: this.floorEntryCatSnap,
      floorEntryHumanAchievements: this.floorEntryHumanAchievements,
      floorEntryCatAchievements: this.floorEntryCatAchievements,
      floorEntryAbilityManager: this.floorEntryAbilityManager,
      floorEntryGameStats: this.floorEntryGameStats,
      floorEntryMercenaryRoster: this.floorEntryMercenaryRoster,
      devPrisonLayout: this.devPrisonLayout ?? undefined,
      existingMap: this.gameMap,
      existingMiniMap: this.miniMap,
      humanAchievements: this.humanAchievements,
      catAchievements: this.catAchievements,
      musicLibrary: this.musicLibrary,
      storyDirector: this.storyDirector,
      petNames: this.petNames,
      daveWhereabouts: this.daveWhereabouts,
      deinonychusUnlocked:
        this.deinonychusSystem.unlocked || companionDeparture.deinonychusUnlocked,
      deinonychusPetState: this.deinonychusPetState,
      wheelLedger: this.wheelLedger,
      attackCowState: this.attackCowState,
      deinonychusWasOut: companionDeparture.deinonychusWasOut,
      abilityManager: this._cleanAbilityManager(),
      partyCrafts: this.partyCrafts,
      saveProgress: this.onSaveProgress,
      audio: this.audio ?? undefined,
      onResetGame: this.onResetGameCallback ?? undefined,
      progressWipe: this.progressWipe ?? undefined,
      starlightTentProgress: this.starlightTentProgress,
      murderQuestProgress: this.murderQuestProgress,
      anchorQuestProgress: this.anchorQuestProgress,
      journalProgress: this.journalProgress,
      bountyProgress: this.bountyProgress,
      midgeEscortCarry: this.midgeEscortCarry,
      doomsdayQuestProgress: this.doomsdayQuestProgress,
      casinoState: this.casinoState,
      townMemory: this.townMemory,
      briarHollowState: this.briarHollowState,
      shopStock: this.shopStock,
      mercenaryRoster: this.mercenaryRoster,
      godModeState: this.godModeState,
      companionStance: this.companionStance,
      gameStats: this.gameStats,
      tacticsNoticesSeen: this.tacticsNoticesSeen,
      skipIntro: true,
    };
  }

  /**
   * Hands a floor held aside for a building visit back to this freshly built
   * scene: the systems are put back to the checkpoint taken at the door, and
   * the scene's own save-point bookkeeping is carried on where it left off.
   * The party and the population were already handed to the constructor.
   */
  private applyInteriorReturn(heldFloor: DungeonInteriorReturn): void {
    this.applyWorldCheckpoint(heldFloor.world, heldFloor.levelTimerFrames, 'keep');
    // Every carried creature joined through `MobRoster.add`, corpses included,
    // and only the living belong in the index.
    this.world.roster.rebuildGrid();
  }

  /**
   * Enrols the creatures this scene's own systems stood up in the checkpoint
   * the held floor carried in. That checkpoint was taken before they existed,
   * so without this a death's rewind would drop them as having arrived after
   * the save, and the system that owns them would be left with no one.
   */
  private enrolSystemSpawnedMobsInCarriedCheckpoint(): void {
    for (const mob of this.systemSpawnedMobs) {
      mob.presentAtCheckpoint = true;
      mob.aliveAtCheckpoint = mob.isAlive;
      mob.resurrectedAtCheckpoint = mob.wasResurrected;
    }
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
   * the deaths and time played of the run in progress. Achievements are the
   * save's copy.
   */
  private respawnFromSave(progress: GameProgressInput): void {
    // His HP only reaches the shared state through a despawn, and the instance
    // holding it is about to be discarded.
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.audio?.stopSound('death_sequence');
    this.stopHazardSoundsForRespawn();
    const sameFloor = progress.levelId === this.levelDef.id;
    const { levelDef, options } = sceneSetupFromSave(
      {
        audio: this.audio ?? undefined,
        saveProgress: this.onSaveProgress,
        onResetGame: this.onResetGameCallback ?? undefined,
        progressWipe: this.progressWipe ?? undefined,
        musicLibrary: this.musicLibrary,
        storyDirector: this.storyDirector,
        petNames: this.petNames,
        // A respawn is not a new floor, so a later floor restart still rewinds
        // to where this one began.
        floorEntryHumanSnap: sameFloor ? this.floorEntryHumanSnap : undefined,
        floorEntryCatSnap: sameFloor ? this.floorEntryCatSnap : undefined,
        floorEntryHumanAchievements: sameFloor ? this.floorEntryHumanAchievements : undefined,
        floorEntryCatAchievements: sameFloor ? this.floorEntryCatAchievements : undefined,
        floorEntryAbilityManager: sameFloor ? this.floorEntryAbilityManager : undefined,
        floorEntryGameStats: sameFloor ? this.floorEntryGameStats : undefined,
        floorEntryMercenaryRoster: sameFloor ? this.floorEntryMercenaryRoster : undefined,
        devPrisonLayout: sameFloor ? (this.devPrisonLayout ?? undefined) : undefined,
        doomsdayQuestProgress: this.doomsdayQuestProgress,
        godModeState: this.godModeState,
        companionStance: this.companionStance,
        gameStats: this.gameStats,
        skipIntro: true,
      },
      progressForRespawn(progress),
    );
    // The save's own floor may not be this one, so what this scene holds has
    // no guaranteed successor to inherit it.
    this.residency.releaseAll();
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
    // A rewound world is not the one the challenge was set in.
    this.aiChallenges.endQuietly('the run rewound to a checkpoint');
    this.audio?.stopSound('death_sequence');
    this.highStriker?.abandonAll();
    this.stopHazardSoundsForRespawn();
    this.combat.deathScreen.reset();
    this.gameOver = false;
    // Whatever is on the shared box belongs to a world that is about to be
    // rewound out from under it — a citizen or sign chat's target may no
    // longer exist on the other side, and a quest beat's closures still
    // reference the state this call is about to replace.
    this.conversation.close();
    this.releaseCitizenDialogTarget();
    this.releaseSignDialogTarget();
    // Its pending callback grants a chest's reward against a world that is
    // about to be rewound to before the chest was opened.
    this.chestKit.discard();
    // The same for granted-reward cards and whatever waits on them (the
    // Resourcing explainer after Oren's tools): the rewind takes the grant back.
    this.menus.rewardGrantedDialog.discard();
    this.menus.questReward.discard();

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

    // The pet goes home rather than being healed where he stands: his HP is the
    // whole cost of using him, and a free full heal on every safe-room restore
    // would hand it back. Dismissing also writes his real remaining HP into the
    // shared state, which nothing else on this path does.
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // The same problem one companion over: the roster rewind below can un-hire a
    // mercenary taken on after the safe room, and nothing reachable from a
    // snapshot can splice the body out of the scene once that reference is gone.
    this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // Before her state is rewound below: the dismiss writes her health into it.
    this.attackCowSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);

    this.rewindRosterToCheckpoint();

    this.combat.resetForCheckpoint();
    this.destruction.resetForCheckpoint();
    this.explosionShake.reset();
    this.lavaBalls.resetForCheckpoint();
    this.rockThrows.resetForCheckpoint();
    this.hirelingShots.resetForCheckpoint();
    this.skeletonShots.resetForCheckpoint();
    this.goblinArrows.resetForCheckpoint();
    this.goblinBombs.resetForCheckpoint();
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
    this.applyWorldCheckpoint(cp.world, cp.levelTimerFrames, 'rewind');
    if (this.briarHollowKitCheckpoint !== null) {
      this.briarHollowKit?.restoreCheckpoint(this.briarHollowKitCheckpoint);
    }
    if (this.gatheringCheckpoint !== null) {
      this.gathering?.restoreCheckpoint(this.gatheringCheckpoint);
    }

    this.bossIntro.cancel();
    this.combatCooldownFrames = 0;

    // Dying mid-fight and restoring here never emits `bossDefeated`, so
    // nothing else lets go of the boss's track or the hack's song.
    this.audioScope?.releaseMusic('boss');
    this.releaseKeyboardHeroMusic();

    // A town save can predate a quest fight that was still being fought when
    // the party fell. Rewound to before it, the quest no longer holds its
    // track; one rewound into it has just claimed it again.
    if (!this.murderQuest.isTownFightInProgress) this.audioScope?.releaseMusic('night_attack');

    // The party is standing on the save point right now — the latches have to
    // agree, or the respawn frame would read as a fresh entry and save the
    // rewound world over itself.
    this.wasInSafeRoom = true;
    this.dave.resumeIn(this.partySafeRoom());
    this.wasInTown = this.isInsideTownWall(this.active());
    this.wasInBriarHollowSaveZone = this.isInBriarHollowSaveZone(this.active());
    for (const { source, latch } of this.roomSaves) {
      latch.wasInside = source.saveTileAt(this.active()) !== null;
      latch.owed = false;
    }
  }

  /**
   * Puts the floor's systems, and its clock, back to a checkpoint. Shared by a
   * death rewind in place and by a scene rebuilt from a floor held aside for a
   * building visit, which differ only in what they do to the party and the
   * population before this. A death rewinds the run's progress with the floor;
   * a building exit keeps it, because the party went on spending, earning and
   * questing indoors and the run-wide objects already hold that.
   */
  private applyWorldCheckpoint(
    world: WorldCheckpoint,
    levelTimerFrames: number,
    runProgress: 'rewind' | 'keep',
  ): void {
    this.levelTimerFrames = levelTimerFrames;
    this.restoreFloorCheckpoint(world);
    if (runProgress === 'rewind') this.restoreRunProgress(world);
    this.fairies.resetForCheckpoint(
      this.world.roster.mobs,
      deadFairyUpgradeBosses(this.bossRoom, this.arena),
    );
    this.forgetDebriefsOfLivingBosses();
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
      deinonychus: this.deinonychusSystem.captureCheckpoint(),

      defendQuest: this.defendQuest.captureCheckpoint(),
      cloggedBathroom: this.cloggedBathroom.captureCheckpoint(),
      stealthKeySnatch: this.stealthKeySnatch.captureCheckpoint(),
      spiderQuest: this.spiderQuest.captureCheckpoint(),
      murderQuest: this.murderQuest.captureCheckpoint(),
      doomsdayEscape: this.doomsdayEscape.captureCheckpoint(),

      trees: this.trees?.captureCheckpoint() ?? null,
      bounty: this.bounty?.captureCheckpoint() ?? null,

      starlightTentProgress: captureStarlightTentProgress(this.starlightTentProgress),
      murderQuestProgress: captureMurderQuestProgress(this.murderQuestProgress),
      anchorQuestProgress: captureAnchorQuestProgress(this.anchorQuestProgress),
      journal: captureJournalProgress(this.journalProgress),
      bountyProgress: captureBountyProgress(this.bountyProgress),
      casinoState: captureCasinoState(this.casinoState),
      townMemory: captureTownMemory(this.townMemory),
      shopStock: captureShopStock(this.shopStock),
      mercenaryRoster: captureMercenaryRoster(this.mercenaryRoster),
      deinonychusPetState: captureDeinonychusPetState(this.deinonychusPetState),
      attackCowState: captureAttackCowState(this.attackCowState),
      briarHollow: captureBriarHollowState(this.briarHollowState),

      krakarenKilled: this.krakarenKilled,
      bigRoosterKilled: this.bigRoosterKilled,
      bigRoosterBossRoomIdx: this.bigRoosterBossRoomIdx,
    };
  }

  /**
   * Puts every owner of the floor's durable state back to what it described at
   * capture; the run's own progress is {@link restoreRunProgress}.
   *
   * Ordering is load-bearing in three places, each noted below; everything else
   * is independent and listed in the same order as the capture above.
   */
  private restoreFloorCheckpoint(world: WorldCheckpoint): void {
    // Before the systems that might re-issue one: a rewind puts the party back
    // before the fight that gave the companion its standing order, and nothing
    // in `CompanionSystem` revokes an order on its own.
    this.companion.clearDirective();
    this.gameMap.restoreCheckpoint(world.gameMap);

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
    // The room comes back as it was saved, not broken over again in front of the player.
    this.dungeonLighting?.settleCarriedLights();
    this.dungeonAmbience?.markDirty();
    this.dungeonLife?.clearSurprises();
    this.dungeonLife?.rescan();
    this.bopca.restoreCheckpoint(world.bopca);
    this.difficultyTelemetry.restoreCheckpoint(world.difficultyTelemetry);

    this.defendQuest.restoreCheckpoint(world.defendQuest);
    // After the map's own restore, which already put the plumbing back: this
    // re-seats every goblin to match it and drops any stall visit in progress.
    this.cloggedBathroom.restoreCheckpoint(world.cloggedBathroom);
    // After the map's restore too: the gate follows the quest's phase.
    this.stealthKeySnatch.restoreCheckpoint(world.stealthKeySnatch);
    this.spiderQuest.restoreCheckpoint(world.spiderQuest);
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

    this.krakarenKilled = world.krakarenKilled;
    this.bigRoosterKilled = world.bigRoosterKilled;
    this.bigRoosterBossRoomIdx = world.bigRoosterBossRoomIdx;
  }

  /**
   * Puts the run's own progress back to what it was at capture: the tallies,
   * the companions, and every object threaded by reference from scene to
   * scene. After {@link restoreFloorCheckpoint}, whose systems some of these
   * pair with.
   */
  private restoreRunProgress(world: WorldCheckpoint): void {
    this.gameStats.restore(world.gameStats);
    this.mercenarySystem.restoreCheckpoint(world.mercenary);
    this.deinonychusSystem.restoreCheckpoint(world.deinonychus);

    restoreStarlightTentProgress(this.starlightTentProgress, world.starlightTentProgress);
    restoreMurderQuestProgress(this.murderQuestProgress, world.murderQuestProgress);
    restoreAnchorQuestProgress(this.anchorQuestProgress, world.anchorQuestProgress);
    restoreJournalProgress(this.journalProgress, world.journal);
    // Paired with the bounty system above: the re-stage reads the mark's type,
    // name and site from this record, so an un-restored cursor would re-stage
    // the wrong contract — or burn a name the player never saw.
    restoreBountyProgress(this.bountyProgress, world.bountyProgress);
    restoreCasinoState(this.casinoState, world.casinoState);
    restoreTownMemory(this.townMemory, world.townMemory);
    restoreShopStock(this.shopStock, world.shopStock);
    restoreMercenaryRoster(this.mercenaryRoster, world.mercenaryRoster);
    // After `deinonychusSystem.dismiss()`, which writes the live pet's remaining HP
    // and rest latch into this very object on its way out — restoring first
    // would hand the despawn a snapshot to overwrite.
    restoreDeinonychusPetState(this.deinonychusPetState, world.deinonychusPetState);
    // After `attackCowSystem.dismiss()` for the same reason as the pet's.
    restoreAttackCowState(this.attackCowState, world.attackCowState);
    restoreBriarHollowState(this.briarHollowState, world.briarHollow);
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
      cloggedBathroom: this.cloggedBathroom.captureCheckpoint(),
      stealthKeySnatch: this.stealthKeySnatch.captureCheckpoint(),
      spiderQuest: toPersistedSpiderQuestCheckpoint(this.spiderQuest.captureCheckpoint()),
      murderQuest: toPersistedMurderMysteryQuestCheckpoint(this.murderQuest.captureCheckpoint()),
      bounty:
        this.bounty === null ? null : toPersistedBountyCheckpoint(this.bounty.captureCheckpoint()),

      starlightTentProgress: captureStarlightTentProgress(this.starlightTentProgress),
      anchorQuestProgress: captureAnchorQuestProgress(this.anchorQuestProgress),
      murderQuestProgress: captureMurderQuestProgress(this.murderQuestProgress),
      journal: captureJournalProgress(this.journalProgress),
      bountyProgress: captureBountyProgress(this.bountyProgress),
      casinoState: captureCasinoState(this.casinoState),
      shopStock: captureShopStock(this.shopStock),
      townMemory: captureTownMemory(this.townMemory),
      mercenaryRoster: captureMercenaryRoster(this.mercenaryRoster),
      deinonychusPetState: captureDeinonychusPetState({
        ...this.deinonychusPetState,
        hp: this.deinonychusSystem.hp,
      }),
      daveDebrief: { ...this.daveDebrief },
      tacticsNoticesSeen: [...this.tacticsNoticesSeen],
      doomsday: capturePersistedDoomsday(this.doomsdayQuestProgress, Date.now()),
      bossRoomDressing: this.bossRoomDressings.captureCheckpoint(),
      briarHollow: captureBriarHollowState(this.briarHollowState),

      krakarenKilled: this.krakarenKilled,
      bigRoosterKilled: this.bigRoosterKilled,
      bigRoosterBossRoomIdx: this.bigRoosterBossRoomIdx,
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
      cloggedBathroom,
      stealthKeySnatch,
      spiderQuest,
      murderQuest,
      bounty,
      starlightTentProgress,
      anchorQuestProgress,
      murderQuestProgress,
      journal,
      bountyProgress,
      casinoState,
      shopStock,
      townMemory,
      mercenaryRoster,
      deinonychusPetState,
      daveDebrief,
      tacticsNoticesSeen,
      doomsday,
      bossRoomDressing,
      briarHollow,
      krakarenKilled,
      bigRoosterKilled,
      bigRoosterBossRoomIdx,
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
    this.cloggedBathroom.restoreCheckpoint(cloggedBathroom);
    this.stealthKeySnatch.restoreCheckpoint(stealthKeySnatch);
    this.spiderQuest.restoreCheckpoint(fromPersistedSpiderQuestCheckpoint(spiderQuest));
    this.bossRoomDressings.restoreCheckpoint(bossRoomDressing);
    this.replayBossRoomDefeats();

    // Before the quest systems' own restores: they reconcile the NPCs their
    // constructors spawned against this same progress object, and must see the
    // saved progress rather than the default those constructors read.
    restoreStarlightTentProgress(this.starlightTentProgress, starlightTentProgress);
    restoreMurderQuestProgress(this.murderQuestProgress, murderQuestProgress);

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
    restoreCasinoState(this.casinoState, casinoState);
    restoreTownMemory(this.townMemory, townMemory);
    restoreShopStock(this.shopStock, shopStock);
    restoreMercenaryRoster(this.mercenaryRoster, mercenaryRoster);
    restoreDeinonychusPetState(this.deinonychusPetState, deinonychusPetState);
    restoreBriarHollowState(this.briarHollowState, briarHollow);

    this.daveDebrief = { ...daveDebrief };
    // `TacticsNoticeSystem` holds this exact Set by reference, so it's refilled
    // in place rather than replaced — a reassignment here would leave the
    // system watching the stale, pre-load one.
    this.tacticsNoticesSeen.clear();
    for (const trait of tacticsNoticesSeen) this.tacticsNoticesSeen.add(trait);
    restoreDoomsdayProgress(this.doomsdayQuestProgress, doomsday, Date.now());

    this.krakarenKilled = krakarenKilled;
    this.bigRoosterKilled = bigRoosterKilled;
    this.bigRoosterBossRoomIdx = bigRoosterBossRoomIdx;
  }

  /**
   * Writes the save and makes it the one a death respawns from, paired with
   * `checkpoint` when the caller took one alongside it. A save without one still
   * replaces the last checkpoint: a death then rebuilds from this save rather
   * than rewinding to an older moment than the one just persisted.
   */
  private saveProgress(checkpoint: LevelCheckpoint | null): void {
    const progress = this.buildSaveProgress({
      human: snapPlayer(this.human),
      cat: snapPlayer(this.cat),
      ...this.deinonychusPetSaveState(),
    });
    this.lastSave = savePointAfterWrite(progress, checkpoint, this.tutorial !== null);
    void this.dispatchSaveProgress(progress);
  }

  /**
   * Writes a save from inside a building on this floor, with the party as it
   * stands indoors, and once storage has taken it, makes it the save a death
   * respawns from. The world
   * half is this scene's own, still the one the party walks back out into.
   * A save cannot resume indoors, so a reload resumes on `doorstep`, the
   * building's own front step. Resolves once storage has answered, for a
   * caller that must not run ahead of the write.
   */
  private commitSaveFromInterior(party: SaveParty, doorstep: TilePoint): Promise<SaveWriteOutcome> {
    const progress = this.buildSaveProgress(party, doorstep);
    const previous = this.lastSave;
    const point = savePointAfterWrite<LevelCheckpoint>(progress, null, this.tutorial !== null);
    return adoptWhenCommitted(
      this.dispatchSaveProgress(progress),
      () => this.lastSave === previous,
      () => {
        this.lastSave = point;
        this.lastSavePointTile = doorstep;
      },
    );
  }

  /** Reset Game: wipes the save behind a blocking hold, then restarts. */
  private resetGame(): void {
    const restart = this.onResetGameCallback;
    if (restart === null) return;
    if (this.progressWipe === null) {
      restart();
      return;
    }
    this.wipeHold.begin(this.progressWipe, restart);
  }

  private interiorPartyRun(doorstep: TilePoint): InteriorPartyRun {
    return {
      wheelLedger: this.wheelLedger,
      attackCowState: this.attackCowState,
      petNames: this.petNames,
      daveWhereabouts: this.daveWhereabouts,
      story: {
        director: this.storyDirector,
        persist: () => this.persistStory(),
        floor: storyFloorOf(this.levelDef.id),
        currentObjective: () => nextAdviceObjective(this.floorObjectives()),
        bearingOrigin: doorstep,
      },
      commitSave: (party) => this.commitSaveFromInterior(party, doorstep),
      maySave: () => this.canSaveInTown,
      progressWipe: this.progressWipe,
    };
  }

  /**
   * Deinonychus's pet state as the system holds it right now. The accessor, not the
   * stored value: a save can fire with Deinonychus still out, and the stored value is
   * only written back when he despawns, so it would record a hurt dinosaur as full.
   */
  private deinonychusPetSaveState(): Pick<SaveParty, 'deinonychusPetHp' | 'deinonychusPetResting'> {
    return {
      deinonychusPetHp: this.deinonychusSystem.hp,
      deinonychusPetResting: this.deinonychusSystem.restingUntilFull,
    };
  }

  /**
   * Every run-level field of a save, from the party as it stands. Each save path
   * builds them here, so none of them can drop one a floor change must carry.
   */
  private partyRunSaveFields(party: SaveParty): RunSaveFields {
    return {
      abilityStates: this.abilityManager.serializeStates(),
      crafts: this.partyCrafts,
      gameStats: this.gameStats.snapshot(),
      humanAchievements: this.humanAchievements.serialize(),
      catAchievements: this.catAchievements.serialize(),
      deinonychusUnlocked: this.deinonychusSystem.unlocked,
      deinonychusPetHp: party.deinonychusPetHp,
      deinonychusPetResting: party.deinonychusPetResting,
      wheelPrizesWon: [...this.wheelLedger.prizesWon],
      pendingWheelOutcome:
        this.wheelLedger.pendingOutcome === null ? null : { ...this.wheelLedger.pendingOutcome },
      wheelFreeSpinBet: this.wheelLedger.freeSpinBet,
      wheelOwedFreeze: this.wheelLedger.owedFreeze,
      wheelQuestFreeSpins: createWheelQuestFreeSpins(this.wheelLedger.questFreeSpins),
      doubleDamageRemaining: doubleDamageRemainingOf(party.human, party.cat),
      attackCowOwned: this.attackCowState.owned,
      attackCowHp: this.attackCowState.hp ?? undefined,
      attackCowResting: this.attackCowState.restingUntilFull,
      musicLibrary: this.musicLibrary.serialize(),
      storyBeatsSeen: this.storyDirector.seenInPlayOrder(),
      objectivesBriefed: this.storyDirector.briefedInOrder(),
      petNames: this.petNames.saved(),
    };
  }

  private backfillMusicFromStartingState(): void {
    const progress = this.buildSaveProgress({
      human: snapPlayer(this.human),
      cat: snapPlayer(this.cat),
      ...this.deinonychusPetSaveState(),
    });
    this.musicLibrary.absorbBackfill(musicUnlocksFromProgress(progress, progress.world?.persisted));
  }

  private buildSaveProgress(
    party: SaveParty,
    resumeTile: TilePoint | null = this.lastSavePointTile,
  ): SaveProgressInput {
    const humanSnap = revivedSnapshot(party.human);
    const catSnap = revivedSnapshot(party.cat);
    return {
      humanSnap,
      catSnap,
      ...this.partyRunSaveFields({ ...party, human: humanSnap, cat: catSnap }),
      levelId: this.levelDef.id,
      // The tutorial's hand-built map has no layout to regenerate.
      world:
        this.tutorial === null
          ? {
              generatorVersion: WORLD_GENERATOR_VERSION,
              worldSeed: this.gameMap.worldSeed,
              artSeed: this.gameMap.artSeed,
              resumeTile,
              levelTimerFrames:
                this.levelDef.hasCollapseTimer === true ? this.levelTimerFrames : null,
              persisted: this.persistedWorldStateFor(party),
            }
          : undefined,
    };
  }

  /**
   * The floor's persisted state with Deinonychus as the saving party has him. A save
   * written indoors carries the pet the interior's own system holds, and the
   * pet state in the persisted world is what a resume applies last.
   */
  private persistedWorldStateFor(party: SaveParty): PersistedWorldState {
    const persisted = this.capturePersistedWorldState();
    return {
      ...persisted,
      deinonychusPetState: {
        ...persisted.deinonychusPetState,
        hp: party.deinonychusPetHp,
        restingUntilFull: party.deinonychusPetResting,
      },
    };
  }

  /**
   * The one place a game-progress write actually leaves the scene — every
   * caller routes through here (or through `saveProgress` above, which calls
   * this) rather than `onSaveProgress` directly, so the save banner and its
   * cue fire for every checkpoint, safe-room save and floor-complete save
   * without each call site having to remember to announce itself.
   */
  private dispatchSaveProgress(progress: SaveProgressInput): Promise<SaveWriteOutcome> {
    // No banner either: a wiped run is on its way to a reload, and announcing
    // a save that was thrown away would be a lie.
    if (PAGE_SAVE_LATCH.engaged) return Promise.resolve('latched');
    const outcome = this.writeSaveProgress(progress);
    this.bus.emit('gameSaved', {});
    return outcome;
  }

  /** Hands `progress` to storage without announcing it, as the newest save a beat's seen-write builds on. */
  private writeSaveProgress(progress: SaveProgressInput): Promise<SaveWriteOutcome> {
    if (PAGE_SAVE_LATCH.engaged) return Promise.resolve('latched');
    this.lastDispatchedSave = progress;
    return this.onSaveProgress?.(progress) ?? Promise.resolve('disabled');
  }

  /** The party is down the escape stairwell: the game is won. */
  private completeRun(): void {
    finishRun(this.runCompleteScreen, {
      // A hire lying downed cannot follow the party down the stairs, so it dies
      // here as it would at any door. A standing one keeps walking with them.
      settleParty: () =>
        this.mercenarySystem.forfeitDownedHire(this.world.roster.mobs, this.world.roster.grid),
      unlockAchievements: () => {
        this.awards.unlockParty('out_before_the_fall');
      },
      save: () => this.captureSavePoint(this.saveTileUnder(this.active())),
      summarize: () =>
        buildRunSummary({
          stats: this.gameStats,
          humanLevel: this.human.level,
          catLevel: this.cat.level,
          deinonychusLevel: this.deinonychusSystem.unlocked
            ? this.abilityManager.getRealLevel('deinonychus')
            : null,
          petNames: this.petNames,
          achievements: countPartyAchievements(this.humanAchievements, this.catAchievements),
        }),
      handlers: {
        // Nothing to undo: the stairwell stays where it is, and stepping back
        // onto it after walking away ends the run again.
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
    // Leaves the floor for the title screen, not just this scene — whatever
    // this floor holds has no claim on the memory once the player is back at
    // the menu, continuing or not.
    this.residency.releaseAll();
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    const baseOptions: DungeonSceneOptions = {
      audio: this.audio ?? undefined,
      saveProgress: this.onSaveProgress,
      onResetGame: this.onResetGameCallback ?? undefined,
      progressWipe: this.progressWipe ?? undefined,
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
      new TitleScene(this.input, this.sceneManager, baseOptions, onContinue),
    );
  }

  /**
   * Takes a save point at `respawnTile`: the persisted game, which resumes on
   * that tile, and — outside the tutorial — the in-run checkpoint that rewinds
   * a death to the same moment in place. Callers own the guards; this never
   * refuses.
   *
   * The tutorial takes no checkpoint: its hand-scripted flow cannot be
   * rewound in place, and a death there restarts it rather than returning here.
   */
  private captureSavePoint(respawnTile: TilePoint): void {
    this.lastSavePointTile = respawnTile;
    this.saveProgress(this.tutorial === null ? this.captureLevelCheckpoint(respawnTile) : null);
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

  /**
   * Whether a body's centre stands where entering Briar Hollow saves: the
   * square always, and anywhere inside the palisade once the village is a
   * save point.
   */
  private isInBriarHollowSaveZone(body: Pick<Mob, 'x' | 'y'>): boolean {
    const centreX = body.x + TILE_SIZE * TILE_CENTRE_FRACTION;
    const centreY = body.y + TILE_SIZE * TILE_CENTRE_FRACTION;
    if (this.gameMap.briarHollowDistrictAt(centreX, centreY) === 'square') return true;
    return (
      isVillageSavePoint(this.briarHollowState) && this.gameMap.isInBriarHollow(centreX, centreY)
    );
  }

  /**
   * Briar Hollow saves on entry the same way the walled town's gate does:
   * walking in is what saves. Its square, with the bell tower, always counts;
   * once the Plea is won, so does the whole palisade interior, which makes any
   * gate or village doorway a save. Guarded the same way everywhere — never
   * mid-siege, never with a hostile still fighting in the village, so a reload
   * can't skip either. A broken bell tower doesn't ring for a save either: the
   * village needs its bell whole to call the crawlers back to it.
   */
  private onBriarHollowSaveZoneEntered(active: Pick<Mob, 'x' | 'y'>): void {
    if (!this.canSaveInBriarHollow) return;
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

  private get canSaveInBriarHollow(): boolean {
    return (
      !this.isRevivePending &&
      !this.isBriarHollowUnderAttack &&
      !this.isBossFightInProgress &&
      !this.briarHollowState.quest.bellTowerBroken
    );
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

  /** The pipe puzzle's own track plays over the floor's while its board is on screen. */
  private updatePipeBoardMusic(): void {
    const scope = this.audioScope;
    if (scope === null) return;
    const boardTrack = this.cloggedBathroom.pipeBoardMusic;
    if (boardTrack === null) {
      scope.releaseMusic('pipe_board');
      return;
    }
    scope.claimMusic({
      owner: 'pipe_board',
      layer: 'activity',
      selection: { kind: 'loop', id: boardTrack },
    });
  }

  /**
   * The lab's own track plays over the floor's from the moment the active
   * crawler turns into either of the lab's hallways until they walk back out of
   * them. Held a layer above the floor's claim, so the floor re-claiming its
   * track after the intro or a respawn cannot bury it.
   */
  private updateSpiderLabMusic(): void {
    const scope = this.audioScope;
    if (scope === null) return;
    if (!this.isInSpiderLabWing(this.active())) {
      scope.releaseMusic('spider_lab');
      return;
    }
    scope.claimMusic({
      owner: 'spider_lab',
      layer: 'activity',
      selection: { kind: 'loop', id: SPIDER_LAB_MUSIC },
    });
  }

  private isInSpiderLabWing(body: Pick<Mob, 'x' | 'y'>): boolean {
    const lab = this.gameMap.spiderLabRoom;
    if (lab === null) return false;
    const tileX = Math.floor((body.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
    const tileY = Math.floor((body.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
    if (pointInRect(tileX, tileY, lab.bounds)) return true;
    return labApproachZoneAt(lab, tileX, tileY) !== null;
  }

  /** What this floor plays when nothing outranks it; null on the overworld, whose zones claim their own. */
  private get floorMusic(): MusicSelection | null {
    if (this.overworldMusic !== null) return null;
    const id = this.tutorial !== null ? 'tutorial_island' : this.levelDef.music;
    return { kind: 'loop', id };
  }

  private claimFloorMusic(): void {
    const selection = this.floorMusic;
    if (selection === null) return;
    this.audioScope?.claimMusic({ owner: 'floor', layer: 'area', selection });
  }

  /** The hack's song stops and lets go of the music, so the floor's comes back. */
  private releaseKeyboardHeroMusic(): void {
    this.audioScope?.stopKeyboardHeroMusic();
    this.audioScope?.releaseMusic('keyboard_hero');
  }

  /**
   * Saves on entering any {@link RoomSaveSource}. Guarded like a stairwell
   * room's save, so a reload can never skip a fight that is still on.
   */
  private updateRoomSaves(active: Pick<Mob, 'x' | 'y'>): void {
    for (const entry of this.roomSaves) this.updateRoomSave(entry, active);
  }

  private updateRoomSave({ source, latch }: RoomSaveEntry, active: Pick<Mob, 'x' | 'y'>): void {
    const saveTile = source.saveTileAt(active);
    const inside = saveTile !== null;
    if (inside && !latch.wasInside) latch.owed = true;
    latch.wasInside = inside;
    if (saveTile === null) {
      latch.owed = false;
      return;
    }
    if (!latch.owed) return;
    if (this.isRevivePending || this.isBossFightInProgress || this.hasEngagedHostileNearActive()) {
      return;
    }
    latch.owed = false;
    this.captureSavePoint(saveTile);
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
  static readonly STAIRWELL_SAVE_ENGAGEMENT_RADIUS_TILES = 4;

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
    // The tutorial's rooms are recorded only so its cellars are dressed and lit;
    // its exit room is the end of a lesson, not a room to bank a save in.
    if (this.tutorial !== null) return;
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
    this.captureSavePoint(respawnTile);
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
    return (
      this.human.isKnockedOut ||
      this.cat.isKnockedOut ||
      this.mercenarySystem.revivePending ||
      this.attackCowSystem.revivePending
    );
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
    this.deinonychusSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.audio?.stopSound('death_sequence');
    this.stopHazardSoundsForRespawn();
    // The restart generates the floor from a fresh seed and rewinds the party
    // to floor entry, so every camp is a new place with fresh XP in it.
    forgetClearedCamps(this.townMemory);
    // The party is rewound to floor entry, so the kills, gold and damage of the
    // failed attempt go with it; deaths and time played are the run's and stay.
    this.gameStats.restore(this.floorEntryGameStats);
    this.mercenarySystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    this.attackCowSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    restoreMercenaryRoster(this.mercenaryRoster, this.floorEntryMercenaryRoster);
    // A fresh-seed restart of the same floor identity — the new scene's own
    // residency holds what is near the party moments from now, so there is
    // nothing gained by leaving the old one's held meanwhile.
    this.residency.releaseAll();
    this.sceneManager.replace(
      new DungeonScene(this.levelDef, this.input, this.sceneManager, {
        // Only ever reached from a death, which clears the incurable statuses.
        humanSnap: withoutIncurableStatuses(this.floorEntryHumanSnap),
        catSnap: withoutIncurableStatuses(this.floorEntryCatSnap),
        floorEntryHumanSnap: this.floorEntryHumanSnap,
        floorEntryCatSnap: this.floorEntryCatSnap,
        humanAchievements: this.floorEntryHumanAchievements.clone(),
        catAchievements: this.floorEntryCatAchievements.clone(),
        musicLibrary: this.musicLibrary,
        storyDirector: this.storyDirector,
        petNames: this.petNames,
        floorEntryHumanAchievements: this.floorEntryHumanAchievements,
        floorEntryAbilityManager: this.floorEntryAbilityManager,
        floorEntryGameStats: this.floorEntryGameStats,
        floorEntryMercenaryRoster: this.floorEntryMercenaryRoster,
        floorEntryCatAchievements: this.floorEntryCatAchievements,
        devPrisonLayout: this.devPrisonLayout ?? undefined,
        abilityManager: this.floorEntryAbilityManager.clone(),
        deinonychusUnlocked: this.deinonychusSystem.unlocked,
        deinonychusPetState: this.deinonychusPetState,
        wheelLedger: this.wheelLedger,
        attackCowState: this.attackCowState,
        audio: this.audio ?? undefined,
        tutorialController:
          this.tutorial !== null ? TutorialController.createForTutorial() : undefined,
        saveProgress: this.onSaveProgress,
        onResetGame: this.onResetGameCallback ?? undefined,
        progressWipe: this.progressWipe ?? undefined,
        // Preserved rather than reset — a death restart shouldn't force-replay an
        // already-completed boss fight (Quill), and for the doomsday
        // timer specifically, resetting it here would let a player cancel a
        // lethal countdown for free by simply dying to anything else.
        starlightTentProgress: this.starlightTentProgress,
        murderQuestProgress: this.murderQuestProgress,
        anchorQuestProgress: this.anchorQuestProgress,
        // Carried through a death restart with the questlines it belongs to, so
        // the objective the player pinned is still pinned when they get up.
        journalProgress: this.journalProgress,
        bountyProgress: this.bountyProgress,
        doomsdayQuestProgress: this.doomsdayQuestProgress,
        casinoState: this.casinoState,
        townMemory: this.townMemory,
        partyCrafts: this.partyCrafts,
        // No `briarHollowState`: the village is per-floor and this restart can
        // only fire before this floor's first save, so the live state holds
        // nothing a save has ever recorded — the constructor's fresh state is
        // the correct rewind, the same as taking the stairs down.
        shopStock: this.shopStock,
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
      this.linksBeforeBarriersClaim(active) ||
      this.barriers.wouldPickUp(active) ||
      this.bossRoomDressings.wouldInteract(active)
    );
  }

  /** {@link earlierSpaceLinkClaims} for the links ahead of a placed gym barrier. */
  private linksBeforeBarriersClaim(active: HumanPlayer | CatPlayer): boolean {
    return (
      this.treasureChests.wouldInteract(active) ||
      this.defendQuest.wouldInteract(active) ||
      this.spiderQuest.wouldInteract(active) ||
      this.murderQuest.wouldInteract(active) ||
      this.cloggedBathroom.wouldInteract(active) ||
      this.stealthKeySnatch.wouldInteract(active)
    );
  }

  /**
   * Who the placed barriers and the boss rooms may float a prompt for this
   * frame: nobody while a hostile in reach turns the press into a swing, and
   * each only when no link ahead of it in the Space chain would take the press.
   */
  private gymPromptTargets(): {
    barrier: HumanPlayer | CatPlayer | undefined;
    bossRoom: HumanPlayer | CatPlayer | undefined;
  } {
    const active = this.active();
    const pressReachesWorld =
      !this.overlayOpen &&
      !this.safeRoom.isEntityInSafeRoom(active) &&
      this.shouldShowInteractionPrompts(active);
    const barrierReached = pressReachesWorld && !this.linksBeforeBarriersClaim(active);
    const bossRoomReached = barrierReached && !this.barriers.wouldPickUp(active);
    return {
      barrier: barrierReached ? active : undefined,
      bossRoom: bossRoomReached ? active : undefined,
    };
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
    if (this.overlayOpen) return false;
    const active = this.active();
    // The safe room's Space chain ends at its own fixtures and never reaches a pickup.
    if (this.safeRoom.isEntityInSafeRoom(active)) return false;
    if (!this.shouldShowInteractionPrompts(active)) return false;
    if (this.earlierSpaceLinkClaims(active)) return false;
    return this.destruction.groundPickups.renderPrompt(ctx, camX, camY, active);
  }

  private townDialogContext(): TownDialogContext {
    return {
      murder: this.murderQuestProgress.stage,
      doomsday: this.doomsdayQuestProgress.stage,
      quillNamed: this.murderQuestProgress.quillNamed,
    };
  }

  private townNoticeContext(): TownNoticeContext {
    const murder = this.murderQuestProgress;
    const cluesFound = [murder.wellClueFound, murder.homeClueFound, murder.roostClueFound].filter(
      Boolean,
    ).length;
    return {
      murder: murder.stage,
      murderCluesFound: cluesFound,
      doomsday: this.doomsdayQuestProgress.stage,
      bounty: this.bounty?.noticeState ?? null,
      workOrder: workOrderStateFor(this.briarHollowState),
    };
  }

  /** Opens the town notice board panel, populated with the current postings. */
  private openNoticeBoard(): void {
    if (this.noticeBoard === null) return;
    this.noticeBoard.openWith(buildTownNotices(this.townNoticeContext()), {
      action: this.workOrderAction(),
    });
    this.playNoticeBoardOpened();
  }

  /** Opens Briar Hollow's notice board: the siege call while it lasts, and Wendell's work order. */
  private openVillageNoticeBoard(): void {
    if (this.noticeBoard === null) return;
    const notices = buildVillageNotices({
      workOrder: workOrderStateFor(this.briarHollowState),
      underSiege: isVillageUnderSiege(this.briarHollowState.quest.phase),
    });
    this.noticeBoard.openWith(notices, {
      title: VILLAGE_TITLE,
      action: this.workOrderAction(),
    });
    this.playNoticeBoardOpened();
  }

  private playNoticeBoardOpened(): void {
    this.audio?.play('menu_open');
    playInteriorCue(this.audio, 'noticeUnfold');
  }

  /** The board's "tear off a work order" button, offered only while a contract is there to take. */
  private workOrderAction(): NoticeBoardAction | null {
    if (workOrderStateFor(this.briarHollowState).kind !== 'open') return null;
    return { label: WORK_ORDERS.takeLabel, onTap: () => this.takeWorkOrder() };
  }

  private takeWorkOrder(): void {
    this.noticeBoard?.close();
    const contracts = this.briarHollowState.contracts;
    // The posting has already explained the arrangement, so Wendell skips his pitch.
    contracts.introSeen = true;
    const world = buildContractWorld({
      murderQuest: this.murderQuestProgress,
      anchorQuest: this.anchorQuestProgress,
      briarHollow: this.briarHollowState,
    });
    const issued = issueNextContract(contracts, world, this.gameMap.worldSeed);
    if (issued === null) {
      this.openWorkOrderLine(WORK_ORDERS.nothingDoing);
      return;
    }
    this.openWorkOrderLine(
      WORK_ORDERS.issued({
        siteName: issued.site.name,
        contactName: contractContactName(issued.site),
        costText: issued.costText,
      }),
    );
    this.bus.emit('questStarted', { questId: CONSTRUCTION_CONTRACT_QUEST_ID });
    playContractCue(this.audio, 'noticeTearOff');
    playContractCue(this.audio, 'contractSigned');
  }

  private openWorkOrderLine(line: DialogLine): void {
    this.conversation.open({
      lines: [line],
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** Opens a market stall's buy panel on the rows the market system built. */
  private openMarketStall(browse: MarketBrowse): void {
    if (this.marketPanel === null) return;
    this.marketPanel.open(browse.buildMenu, browse.purchase, {
      onBlocked: browse.onBlocked,
      blockedLine: null,
      rebuyGuardTicks: 0,
      sell: browse.sell,
      liveRows: false,
    });
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
    if (
      this.townProps === null &&
      this.market === null &&
      this.crawlerSigns === null &&
      this.highStriker === null
    ) {
      return;
    }
    if (
      this.noticeBoard?.isOpen === true ||
      this.marketPanel?.isOpen === true ||
      this.travelMenu.isOpen ||
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
    if (this.highStriker?.renderPrompt(ctx, camX, camY, active) === true) return;
    if (this.signDialogTarget === null) this.crawlerSigns?.renderPrompt(ctx, camX, camY, active);
  }

  /** Floats a "Talk" prompt over the nearest citizen when one is in range and idle. */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.townLife === null) return;
    if (this.citizenDialogTarget !== null) return;
    const active = this.active();
    if (!this.shouldShowInteractionPrompts(active)) return;
    const target = this.townLife.findTalkTarget(active.x, active.y);
    if (target === null) return;
    drawInteractionPromptOver(ctx, target, camX, camY, 'Talk');
  }

  /**
   * Floats a "Pet" prompt over Deinonychus when a press would reach him.
   *
   * Sits just ahead of the hireling in the Space chain, so it draws just ahead
   * of it too: it yields to a chest, a quest giver, a citizen or a harvest
   * already claiming the press, the same way `renderMercenaryPrompt` yields to
   * this one.
   */
  private renderDeinonychusPetPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) return;
    if (interactionPromptsDrawnThisFrame() > 0) return;
    if (this.gathering?.wouldStartHarvest(active) === true) return;
    if (this.briarHollowKit?.wouldInteract(active) === true) return;
    this.deinonychusSystem.renderPetPrompt(
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
    drawInteractionPromptOver(ctx, merc, camX, camY, 'Talk');
  }

  /** Opens a conversation with the nearest street citizen, if one is in range. */
  private tryTalkToCitizen(active: Player): boolean {
    if (this.townLife === null) return false;
    const target = this.townLife.findTalkTarget(active.x, active.y);
    if (target === null || target === this.citizenDialogTarget) return false;
    target.faceToward(active.x, active.y);
    target.frozen = true;
    const line = buildCitizenConversation(
      target.role,
      citizenSpecies(target),
      target.dialogSeed,
      target.conversationCount,
      this.townDialogContext(),
      target.speechStyle,
    );
    this.citizenDialogHandle = this.conversation.open({
      lines: [line],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => this.releaseCitizenDialogTarget() },
      dismiss: { kind: 'allowed', onDismissed: () => this.releaseCitizenDialogTarget() },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: target.x, y: target.y }),
        talkRangeTiles: CITIZEN_TALK_RADIUS_TILES,
      },
      locksKeyboard: true,
    });
    // Only once `open` has run: a citizen this press was handed on from is
    // released by that call, through `releaseCitizenDialogTarget`, and must
    // still be the one it finds there, and its talk row unpinned before this
    // one, which may be the same row, is pinned.
    const facing = target.facingXY();
    this.citizenTalkRow = prewarmAndPinTownspersonTalk(target.body, facing.x, facing.y);
    this.citizenDialogTarget = target;
    target.conversationCount++;
    return true;
  }

  private releaseCitizenDialogTarget(): void {
    if (this.citizenDialogTarget === null) return;
    this.citizenDialogTarget.frozen = false;
    this.citizenDialogTarget = null;
    this.citizenDialogHandle = null;
    if (this.citizenTalkRow !== null) unpinCitizenTalk(this.citizenTalkRow);
    this.citizenTalkRow = null;
  }

  /** Opens a sign's conversation on the shared box, from `CrawlerSignSystem`'s `onRead` callback. */
  private openSignConversation(sign: CrawlerSignPlacement): void {
    this.signDialogHandle = this.conversation.open({
      lines: [signLine({ direction: sign.direction })],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => this.releaseSignDialogTarget() },
      dismiss: { kind: 'allowed', onDismissed: () => this.releaseSignDialogTarget() },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: sign.tile.x * TILE_SIZE, y: sign.tile.y * TILE_SIZE }),
        talkRangeTiles: CRAWLER_SIGN_READ_RADIUS_TILES,
      },
      locksKeyboard: true,
    });
    // After `open`, for the same reason as the citizen's target.
    this.signDialogTarget = sign;
  }

  private releaseSignDialogTarget(): void {
    this.signDialogTarget = null;
    this.signDialogHandle = null;
  }

  /**
   * Every surface on this floor that can take input or hide the world. The
   * band places each in the stack and, within a band, the one opened last is
   * on top; that order decides what draws over what, which surface a press
   * reaches, and where Escape goes.
   */
  private surfaces(): Surface[] {
    const party = (): { readonly active: Player; readonly companion: Player } => ({
      active: this.active(),
      companion: this.inactive(),
    });
    const camera = (): { readonly x: number; readonly y: number } => this.camera();
    const tutorial = this.tutorial;
    return [
      ...this.arrivalLoading.surfaces(),
      this.wipeHold.surface('wipe-hold'),
      promptSurface(),
      this.hud,
      this.hud.overlay(),
      ...aiAdapter.surfaces(() => this.hud.isOpen()),
      ...this.aiInteractions.surfaces(),
      ...this.menus.surfaces({
        pauseFrame: () => this.pauseFrame(),
        togglePause: () => this.togglePause(),
        resolveInventoryActions: () => this.resolveInventoryActions(),
        pauseRestriction: () => this.tutorial?.pauseRestriction() ?? null,
      }),
      this.conversation.surface({
        handOffPress: () => this.handOffConversationPress(),
        dismiss: () => this.conversationEscapeOwner()?.(),
        wantsEscape: () => this.conversationEscapeOwner() !== null,
        offBoxClick: (x, y) => this.pressPastHaltingConversation(x, y),
      }),
      this.chestKit.surface(),
      this.questSwitchConfirm.surface('quest-switch-confirm', 'system'),
      nearGoblinHintSurface({
        get showNearGoblinDialog(): boolean {
          return tutorial?.showNearGoblinDialog === true;
        },
        dismissNearGoblinDialog: () => tutorial?.dismissNearGoblinDialog(),
      }),
      this.cutscenes.surface(),
      this.achievementUI.surface(),
      deathScreenSurface(this.combat.deathScreen, {
        isOpen: () => this.gameOver,
        onRespawn: () => this.respawnAfterDeath(),
      }),
      this.levelCompleteScreen.surface(),
      this.runCompleteScreen.surface(),
      this.chat.surface(),
      ...(this.noticeBoard === null ? [] : [this.noticeBoard.surface('notice-board')]),
      ...(this.marketPanel === null
        ? []
        : [
            shopScreenSurface({
              id: 'market-stall',
              session: this.marketPanel,
              party,
              showPriceBreakdowns: priceBreakdownsShown,
            }),
          ]),
      shopScreenSurface({
        id: 'travel-menu',
        session: this.travelMenu.session,
        party,
        showPriceBreakdowns: priceBreakdownsShown,
      }),
      ...(this.fortuneTeller === null
        ? []
        : [fortuneScreenSurface({ id: 'fortune-teller', table: this.fortuneTeller, party })]),
      defendTutorialSurface(this.defendQuest),
      this.defendQuest.failedBannerSurface('defend-quest', this.audio),
      dynamiteChargeSurface({
        id: 'dynamite-charge',
        dynamite: () => this.destruction.dynamite,
        shows: () => !this.gameOver && !this.menus.pauseScreen.isOpen,
      }),
      keyboardHeroSurface('keyboard-hero', this.spiderQuest),
      ...this.cloggedBathroom.surfaces(),
      spiderTutorialSurface(this.spiderQuest, 'spider-tutorial'),
      hackFailedPromptSurface('spider-hack-failed', this.spiderQuest),
      stairwellPromptSurface('stairwell', this.stairwell),
      buildingEntryPromptSurface('building-entry', () => this.building ?? null),
      ...this.prisonDifficulty.surfaces(PRISON_DIFFICULTY_SURFACE_ID),
      ...this.spiderTerminalDifficulty.surfaces(SPIDER_TERMINAL_DIFFICULTY_SURFACE_ID),
      this.grateSpikes.surface(camera),
      ...(this.briarHollowKit?.surfaces(camera, () => siegeHudKeepouts(this.hud)) ?? []),
      this.followerMenu.surface({
        haltsWorld: false,
        state: () => ({
          movementMode: this.companion.getMovementMode(this.human.isActive),
          combatStance: this.companion.getCombatStance(this.human.isActive),
          companionIsCat: this.human.isActive,
          deinonychus: this.deinonychusSystem.unlocked
            ? {
                autoSummon: settings.catAutoSummonsDeinonychus,
                pet: petWords(this.petNames, 'deinonychus'),
              }
            : null,
        }),
        restriction: () => this.tutorial?.followerMenuRestriction ?? null,
      }),
    ];
  }

  /** Whether the HUD's buttons, hotbar and panels answer presses: not under the death screen, the pause menu or the loading screen. */
  private get hudTakesInput(): boolean {
    return !this.gameOver && !this.menus.pauseScreen.isOpen && !this.arrivalLoading.isOpen;
  }

  /**
   * Who answers Escape on the conversation now up, or null when Escape is the
   * pause key's instead (the pause key then closes the conversation for the
   * menu). Only the speakers listed here take it, in this order: the defend
   * offer, the lab's scientist, the bounty man, the murder and the
   * Anchor questlines, Dave, the Bopca, and, while nothing else has halted
   * the floor, a citizen, a villager or the recruiter, and a sign. A request
   * that must be read to its end still spends the press on its speaker.
   */
  private conversationEscapeOwner(): (() => void) | null {
    const dismiss = (): void => void this.conversation.dismiss();
    if (this.defendQuest.isDialogOpen && !this.defendQuest.isTutorialOpen) {
      return () => void this.defendQuest.dismissDialog();
    }
    if (this.spiderQuest.isDialogOpen && !this.spiderQuest.isModalPhaseOpen) {
      return () => void this.spiderQuest.dismissDialog();
    }
    if (
      this.bounty?.isDialogOpen === true ||
      this.murderQuest.isDialogOpen ||
      this.anchorQuest.isDialogOpen ||
      this.cloggedBathroom.isDialogOpen ||
      this.stealthKeySnatch.isDialogOpen ||
      this.dave.dialogOpen
    ) {
      return dismiss;
    }
    if (this.bopca.isDialogOpen) return () => void this.bopca.dismissDialog();
    // A street chat floats over a running world: while something else has
    // halted the floor, Escape is meant for that and passes the chat by.
    if (this.gameplayHalted) return null;
    if (this.citizenDialogTarget !== null || this.signDialogTarget !== null) return dismiss;
    const village = this.briarHollowKit;
    if (
      village?.isConversationOpen === true ||
      village?.recruiter?.isDialogOpen === true ||
      village?.contracts?.isFollowUpOpen === true
    ) {
      return () => void village.dismissDialog();
    }
    return null;
  }

  /**
   * The two HUD controls that stay live under a conversation that halts the
   * floor and covers the screen: the pause button and the skill-point badge.
   */
  private pressPastHaltingConversation(x: number, y: number): void {
    const control = this.hud.controlUnderHalt(x, y);
    if (control === 'pause') this.openPauseFromButton();
    // A cutscene's talk must be read through, so any other press turns its page.
    else if (this.cutscenes.isActive) this.conversation.advance();
    else if (control === 'skill-points') this.menus.openSpendScreen();
  }

  /** The HUD's pause button: the button sounds its own click, so this plays none. */
  private openPauseFromButton(): void {
    this.closeConversationForMenu();
    this.menus.pauseScreen.toggle();
    this.menus.closePanels();
    this.input.clear();
  }

  private pauseFrame(): PauseFrame {
    return {
      humanAchievements: this.humanAchievements,
      catAchievements: this.catAchievements,
      gameStats: this.gameStats,
    };
  }

  /** The pause key and the pause menu's own close. Opening it takes every panel down with it. */
  private togglePause(): void {
    this.closeConversationForMenu();
    this.menus.pauseScreen.toggle();
    if (this.menus.pauseScreen.isOpen) {
      this.menus.closePanels();
      this.audio?.play('menu_open');
    } else {
      this.input.clear();
    }
  }

  /** Drains what a click on the bag, its context menu or the picker queued, dropping onto this floor. */
  private resolveInventoryActions(): void {
    const invPlayer = this.menus.inventoryPlayer();
    this.menus.resolvePendingInventoryActions(invPlayer, (id, quantity) =>
      this.destruction.loot.addPlayerDrop(invPlayer.x, invPlayer.y, id, quantity, invPlayer),
    );
  }

  /** Whether any menu or dialog is open over the HUD, a conversation the world runs under included. */
  private get overlayOpen(): boolean {
    return surfacesOverHud(this.ui).length > 0;
  }

  /**
   * Opens the tracked-quest switch confirm once the new quest has a tracker
   * line to name it, and only once nothing else — the conversation or reward
   * cards that started the quest, a menu, the death screen — is already
   * asking for the player's attention.
   */
  private resolvePendingQuestSwitch(): void {
    const pending = this.pendingQuestSwitch;
    if (pending === null || this.questSwitchConfirm.isOpen) return;
    if (this.gameOver || this.overlayOpen) return;
    // The exact id first — the quest's own header row, which is what carries the
    // quest's name — falling back to a sub-step for a source that never emits one.
    const toEntry =
      this._trackerEntries.find((entry) => entry.id === pending.toId) ??
      this._trackerEntries.find((entry) => pinMatchesEntry(pending.toId, entry));
    if (toEntry === undefined) return;
    this.pendingQuestSwitch = null;
    this.questSwitchConfirm.open({
      title: 'NEW QUEST',
      message: `Would you like to stop tracking ${pending.fromName} and start tracking ${toEntry.name}?`,
      subtext: '*you can always change this via the quest menu by clicking the blue quest icon',
      yesLabel: 'Yes',
      noLabel: 'No',
      onYes: () => {
        this.journalProgress.pinnedTrackerId = pending.toId;
        this.journalProgress.pinSource = 'player';
      },
      onNo: () => undefined,
    });
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
    this.audioScope?.stopLoop(WALKING_LOOP);
    this.audioScope?.stopLoop(WADING_LOOP);
  }

  /**
   * For a frame the world does not run: footsteps and burning fuses go quiet,
   * and the fuses come back on the next live frame if their sticks still burn.
   */
  private silenceFrozenWorldLoops(): void {
    this.silenceMovementLoops();
    this.fuseSizzle.stopAll(this.audioScope);
  }

  /**
   * Anything that takes the floor away from ordinary play.
   *
   * Read off the surface stack rather than restated as a second boolean
   * chain: two hand-maintained lists of the same overlays drift, and a dialog
   * added to one of them and not the other is a menu the world keeps running
   * underneath. The spider lab's cutscene is the one term with no surface
   * behind it — the quest freezes the floor from inside its own state machine.
   */
  private get gameplayHalted(): boolean {
    return this.ui.worldHalted() || this.spiderQuest.isDungeonPaused;
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
    if (
      this.citizenDialogTarget !== null &&
      this.gameplayHalted &&
      this.citizenDialogHandle !== null &&
      this.conversation.isActive(this.citizenDialogHandle)
    ) {
      this.conversation.close();
      this.releaseCitizenDialogTarget();
    }
    if (
      this.signDialogTarget !== null &&
      this.gameplayHalted &&
      this.signDialogHandle !== null &&
      this.conversation.isActive(this.signDialogHandle)
    ) {
      this.conversation.close();
      this.releaseSignDialogTarget();
    }
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

  /**
   * Dave's answer when tapped, from the highest-ranked source that has one:
   *
   *     tutorial reminder → post-boss debrief → tactics for the current objective → AI chat
   *
   * His tactics sit above the AI chat because they are the deterministic
   * answer to "how do I get through what is next", and need no server; the
   * chat is the flavour path for a cleared floor.
   */
  private talkToDave(active: { x: number; y: number }): void {
    const reminder = this.tutorial?.daveReminder() ?? null;
    if (reminder !== null) {
      this.cutscenes.director.play([
        { kind: 'conversation', request: { lines: [reminder], reward: null, questRelated: false } },
      ]);
      return;
    }

    if (this.speakPostBossDebrief(active)) return;

    const tactics = this.floorTactics(active);
    if (tactics !== null) {
      this.dave.openLine(active, tactics);
      return;
    }

    this.dave.openChat(active, aiAdapter.chatWithDave());
  }

  private speakPostBossDebrief(active: { x: number; y: number }): boolean {
    const room = this.safeRoom.safeRoomInfoAt(active);
    const debrief = room === null ? null : this.pendingDebrief(room, MAX_DAVE_TALK_PAGES);
    if (debrief === null) return false;
    this.dave.openLine(active, debrief.line);
    debrief.onHeard();
    return true;
  }

  /**
   * What Dave owes the party about the boss behind `room`, or null when he
   * has nothing new to say. Hearing it saves: the entry save predates the
   * talk, so a reload in this room would otherwise congratulate them again.
   */
  private pendingDebrief(room: SafeRoomInfo, pageBudget: number): DaveTalkExtra | null {
    const bossType = this.exitRoomBoss(room);
    if (bossType === null) return null;
    const memory = this.debriefMemoryFor(bossType);
    const pages = debriefPages(bossType, memory, this.debriefState()) ?? [];
    const talk = debriefTalk(pages, pageBudget, displayPageCount);
    if (talk === null) return null;
    return {
      line: talk.line,
      onHeard: () => {
        const remembered = rememberDebriefHeard(memory, talk.heard);
        this.daveDebrief[bossType] = remembered;
        // Boxes repeat every talk; don't pay a server round trip for a repeat.
        const worthSaving = !sameDebriefMemory(memory, remembered);
        if (
          worthSaving &&
          this.tutorial === null &&
          !this.isBossFightInProgress &&
          !this.isRevivePending
        ) {
          // A checkpoint comes with it, so a death here rewinds to after the talk.
          this.captureSavePoint(room.centre);
        }
      },
    };
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
    const kept: DaveDebriefCheckpoint = {};
    for (const bossType of ALL_DEBRIEF_BOSS_TYPES) {
      const memory = this.daveDebrief[bossType];
      if (memory !== undefined && defeated.has(bossType)) kept[bossType] = memory;
    }
    this.daveDebrief = kept;
  }

  private debriefMemoryFor(bossType: DebriefBossType): DebriefMemory {
    return this.daveDebrief[bossType] ?? EMPTY_DEBRIEF_MEMORY;
  }

  private debriefState(): DebriefState {
    return {
      unworn: [
        ...unwornGear('human', this.human.inventory),
        ...unwornGear('cat', this.cat.inventory),
      ],
    };
  }

  /** His `!`: news about gear behind a boss, or tactics for what is next that he has not yet given. */
  private daveMarkerFor(room: SafeRoomInfo): QuestMarkerState {
    const bossType = this.exitRoomBoss(room);
    if (bossType !== null && debriefHasNews(this.debriefMemoryFor(bossType), this.debriefState())) {
      return 'exclamation';
    }
    const objective = this.currentObjective(room);
    const tacticsOwed = objective !== null && !this.daveWhereabouts.tacticsGiven.has(objective.id);
    return tacticsOwed ? 'exclamation' : 'none';
  }

  /**
   * The objective a safe room is concerned with: the boss a gateway room
   * guards or the room a field station serves while either is unfinished,
   * and otherwise the one the floor wants raised next. Null when nothing is
   * left.
   */
  private currentObjective(room: SafeRoomInfo): AdviceObjective | null {
    return (
      this.pinnedGatewayAdvice(room.guardsBossType) ??
      this.pinnedStationAdvice(room.servesSpecialRoom) ??
      nextAdviceObjective(this.floorObjectives())
    );
  }

  /** Dave's tactics for the objective of the safe room the player is standing in, or null when there is none. */
  private floorTactics(active: { x: number; y: number }): DialogLine | null {
    const room = this.safeRoom.safeRoomInfoAt(active);
    const objective = room === null ? null : this.currentObjective(room);
    if (objective === null) return null;
    this.bus.emit('daveAdviceGiven', { objectiveId: objective.id });
    this.daveWhereabouts.tacticsGiven.add(objective.id);
    return adviceTactics(objective);
  }

  // ── The story ──────────────────────────────────────────────────────────────

  /** Once a frame, after Dave has moved: opens the floor's story, starts a tutorial talk that is due, and lets Caroline speak. */
  private tellStory(): void {
    if (this.storyOpeningPending) {
      this.storyOpeningPending = false;
      this.openStory();
    }
    const daveFree =
      this.dave.isPresent &&
      !this.story.isTellingDaveMoment &&
      !this.cutscenes.isActive &&
      !partyIsEngaged(this.world.roster.mobs, [this.human, this.cat]);
    const owedRoom = this.daveArrivalOwed;
    if (owedRoom !== null && daveFree && this.activeCrawlerIsWithDaveIn(owedRoom)) {
      this.daveArrivalOwed = null;
      this.playArrivalMoment(owedRoom);
    }
    const tutorialMoment = this.tutorial?.daveMomentDue ?? null;
    if (tutorialMoment !== null && daveFree) {
      this.story.playDaveMoment({
        event: { kind: tutorialMoment },
        walkUp: () => this.walkUpToDave(),
        extra: () => null,
        leavesAfter: false,
        onDone: () => this.tutorial?.onDaveMomentHeard(),
      });
    }
    this.story.update();
  }

  /** The floor's first frame: Caroline's arrival message, and Dave waiting for a party that skipped the tutorial. */
  private openStory(): void {
    if (this.storyPreview !== null) {
      this.previewStoryBeat(this.storyPreview);
      return;
    }
    const floor = storyFloorOf(this.levelDef.id);
    if (floor !== null && this.arrivedOnFloor) {
      this.story.noteCarolineMoment({ kind: 'floorArrival', floor });
    }
    if (this.skippedTutorialStart) this.meetPartyAtStart();
  }

  /** Dave stands beside the party in the start room, gives his short version of the tutorial, and leaves. */
  private meetPartyAtStart(): void {
    const tile = this.daveWaitingTile();
    if (tile === null) return;
    this.dave.waitAt(tile);
    this.story.playDaveMoment({
      event: { kind: 'skippedTutorialStart' },
      walkUp: () => this.walkUpToDave(),
      extra: () => null,
      leavesAfter: true,
      onDone: () => undefined,
    });
  }

  /** The dev preview: the beat's own moment, played at once with Dave beside the party when it is his. */
  private previewStoryBeat(id: StoryBeatId): void {
    const preview = storyPreviewEvent(id);
    if (preview.kind === 'caroline') {
      this.story.noteCarolineMoment(preview.event);
      return;
    }
    const tile = this.daveWaitingTile();
    if (tile === null) return;
    this.dave.waitAt(tile);
    this.story.playDaveMoment({
      event: preview.event,
      walkUp: () => this.walkUpToDave(),
      extra: () => null,
      leavesAfter: true,
      onDone: () => undefined,
    });
  }

  /** A tile beside the active crawler for Dave to wait on: open floor a short walk away, or null when none is. */
  private daveWaitingTile(): { x: number; y: number } | null {
    const active = this.active();
    const origin = { x: pixelToTile(active.x), y: pixelToTile(active.y) };
    for (let distance = DAVE_WAITING_MIN_TILES; distance <= DAVE_WAITING_MAX_TILES; distance++) {
      for (const direction of DAVE_WAITING_DIRECTIONS) {
        const tile = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
        if (this.gameMap.isWalkable(tile.x, tile.y)) return tile;
      }
    }
    return null;
  }

  /** The walk up to Dave from where the active crawler stands, or null while he cannot be spoken to. */
  private walkUpToDave(): WalkToStep | null {
    const tile = this.dave.standingTile;
    if (tile === null) return null;
    const active = this.active();
    return walkUpTo(this.gameMap, tile, { x: pixelToTile(active.x), y: pixelToTile(active.y) });
  }

  /**
   * Dave has finished teleporting into the room the party walked into: the
   * story's beat and the debrief behind a boss, if either is due, and then
   * Caroline's intel about what the room is concerned with. The tutorial's
   * talks are its own, started by {@link tellStory}.
   */
  private onDaveArrived(room: SafeRoomInfo): void {
    if (this.tutorial !== null || storyFloorOf(this.levelDef.id) === null) return;
    this.daveArrivalOwed = room;
  }

  /**
   * Whether the active crawler stands in `room` with Dave: an arrival's talk
   * waits for that, so a party that walked out, or is fighting, is never
   * pulled back in mid-fight. Dave stays put meanwhile.
   */
  private activeCrawlerIsWithDaveIn(room: SafeRoomInfo): boolean {
    const daveState = this.dave.state;
    const crawlerRoom = this.safeRoom.safeRoomAt(this.active());
    return (
      daveState.kind === 'inRoom' &&
      sameSafeRoom(daveState.room, room.id) &&
      crawlerRoom !== null &&
      sameSafeRoom(crawlerRoom, room.id)
    );
  }

  private playArrivalMoment(room: SafeRoomInfo): void {
    const floor = storyFloorOf(this.levelDef.id);
    if (floor === null) return;
    this.story.playDaveMoment({
      event: { kind: 'safeRoomArrival', floor, defeatedBosses: this.defeatedStoryBosses() },
      walkUp: () => this.walkUpToDave(),
      extra: (pageBudget) => this.pendingDebrief(room, pageBudget),
      leavesAfter: false,
      onDone: () => this.afterDaveArrival(room),
    });
  }

  private afterDaveArrival(room: SafeRoomInfo): void {
    // A boss message missed when it was due, lost to a fight that ran on or a
    // floor left too soon, is caught up in the first calm room after.
    for (const boss of this.defeatedStoryBosses()) {
      this.story.noteCarolineMoment({ kind: 'bossDefeated', boss });
    }
    const objective = this.currentObjective(room);
    if (objective !== null) {
      this.story.briefObjective(objective.id, () => this.intelStillDue(objective.id));
    }
  }

  /**
   * Caroline's intel about `objective` as it stands when her turn comes,
   * with its bearing from the safe room the party is then in; null once it
   * is no longer that room's objective or the party is in no safe room, so
   * it is offered again at the next arrival.
   */
  private intelStillDue(objective: AdviceObjectiveId): CarolineMessage | null {
    const room = this.safeRoom.safeRoomInfoAt(this.active());
    const current = room === null ? null : this.currentObjective(room);
    if (room === null || current?.id !== objective) return null;
    return adviceIntel(current, room.centre);
  }

  private defeatedStoryBosses(): ReadonlySet<DebriefBossType> {
    const defeated = this.bossRoom.defeatedBossTypes;
    return new Set(ALL_DEBRIEF_BOSS_TYPES.filter((boss) => defeated.has(boss)));
  }

  /**
   * Caroline speaks only into a calm moment: nothing hostile is fighting
   * either crawler, nothing halts the world and no other box is open. In the
   * tutorial she also waits until Dave has met the human and for any lesson
   * taught inside a menu to finish, unless a preview asked for her straight
   * away.
   */
  private carolineMaySpeak(): boolean {
    if (this.gameOver || this.gameplayHalted || this.conversation.isOpen) return false;
    const tutorial = this.storyPreview === null ? this.tutorial : null;
    const lessonHoldsHer =
      tutorial !== null && (!tutorial.showAchievementUI || tutorial.pauseRestriction() !== null);
    if (lessonHoldsHer) return false;
    return !partyIsEngaged(this.world.roster.mobs, [this.human, this.cat]);
  }

  /**
   * Writes the seen beats and briefings into the newest save handed to
   * storage, at once and outside the checkpoint. The tutorial writes none
   * here: none of its saves is a point a death returns to
   * (`savePointAfterWrite`), so no beat could replay from one, and its beats
   * reach storage with its next save, which carries the seen set like every
   * save.
   */
  private persistStory(): void {
    if (this.tutorial !== null) return;
    const newest = this.lastDispatchedSave;
    const written = persistStoryBeatsSeen(this.storyDirector, newest, (progress) =>
      this.writeSaveProgress(progress),
    );
    if (written === null) return;
    const last = this.lastSave;
    if (last?.progress !== newest) return;
    this.lastSave = { progress: written.progress, checkpoint: last.checkpoint };
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

  /**
   * The speech a special room's field station owes that room, or null.
   *
   * The spider lab's station sits on the lab's own dead-end branch, so for as
   * long as Pest Control is unfinished it talks about nothing else: an aside
   * about the scientist before the quest is taken up, the warning once it is.
   * Neither carries a bearing — the lab is at the end of the hallway outside.
   */
  private pinnedStationAdvice(service: SafeRoomService | undefined): AdviceObjective | null {
    if (service !== 'spider_lab') return null;
    const progress = this.pestControlProgress();
    if (progress === 'complete') return null;
    const id = progress === 'unstarted' ? 'spider_lab_station' : 'spider_lab_started';
    return adviceObjective(id, false, null);
  }

  /** How far the party has got with Pest Control. */
  private pestControlProgress(): 'unstarted' | 'started' | 'complete' {
    if (this.spiderQuest.isComplete) return 'complete';
    return this.spiderQuest.hasStarted ? 'started' : 'unstarted';
  }

  /** What this floor still asks of the player, in the order Dave raises it. */
  private floorObjectives(): ReadonlyArray<AdviceSlot> {
    // The tutorial shares floor 1's number but not its map: its hand-crafted
    // grid has no boss rooms, no goblin mother and no stairs down, so the floor-1
    // list would send the player after a Trash Gremlin that does not exist — and with
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
      // sits down again after the Trash Gremlin rather than one that walks straight
      // on, while on floor 2 the spine's own station usually seats ahead of the
      // nursery and catches them on the way.
      //
      // `asOptional` is for work a party who is not interested never finishes,
      // and which would therefore stand in front of everything listed behind it
      // for the rest of the floor: the spider lab is a dead end, and the Ball of
      // Swine only *guarantees* a way down, which is why Dave's own speech
      // about it says to find another if you would rather keep your bones.
      case DUNGEON_FLOOR_ONE:
        return [
          this.bossObjective('trash_gremlin'),
          this.defendQuestObjective(),
          this.bossObjective('big_rooster'),
        ];
      case DUNGEON_FLOOR_TWO:
        return [
          this.bossObjective('krakaren_clone'),
          this.defendQuestObjective(),
          this.stealthGateObjective(),
          asOptional(this.spiderLabObjective()),
          asOptional(this.ballOfSwineObjective('ball_of_swine_distant')),
        ];
      case OVERWORLD_FLOOR_THREE:
        // The Anchor's offer leads the list: accepting it is what makes every
        // later trip on this floor shorter, so he raises it before the other
        // three errands rather than after them.
        return [
          this.anchorOfferObjective(),
          this.murderQuestObjective(),
          this.bountyObjective(),
          this.anchorStoneObjective(),
          this.speedFizzObjective(),
        ].filter((objective): objective is AdviceSlot => objective !== null);
      default:
        return [];
    }
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
   * the loop. Dave therefore keeps offering it, which is correct — it is the
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
  private bossObjective(
    bossType: 'trash_gremlin' | 'big_rooster' | 'krakaren_clone',
  ): AdviceObjective {
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
      DEFEND_QUEST_ID,
      this.defendQuest.isSpentAsAdvice,
      hasNursery ? this.gameMap.questRooms[0].centre : null,
    );
  }

  /** The stealth gate: mandatory, on the only way to the arena, and spent once it is open. */
  private stealthGateObjective(): AdviceObjective {
    return adviceObjective(
      'stealth_gate',
      this.stealthKeySnatch.phase === 'opened',
      this.gameMap.stealthGateRoom?.centre ?? null,
    );
  }

  /**
   * Pest Control as floor advice: before it starts, a heads-up pointing at Dr.
   * Moult by the taped-off hallway; once it has, the warning about the lab.
   */
  private spiderLabObjective(): AdviceObjective {
    const lab = this.gameMap.spiderLabRoom;
    if (!this.spiderQuest.hasStarted) {
      return adviceObjective('spider_lab', false, lab?.hallwayPostTile ?? null);
    }
    return adviceObjective('spider_lab_started', this.spiderQuest.isComplete, lab?.centre ?? null);
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
    // Whatever surface owns the screen has already been offered this press.
    // The world behind it must not also see it, or an NPC conversation opens
    // underneath the building menu and both boxes fight over the same clicks.
    if (this.overlayOpen) return;
    // Behind a stall door there is nothing to reach and nothing to swing at.
    if (this.cloggedBathroom.isStallVisitActive) return;

    const fromTap = tapScreenX !== undefined;
    const active = this.active();
    if (this.safeRoom.isEntityInSafeRoom(active)) {
      // Nothing in a safe room is a swing, whether or not a speaker answered.
      this.trySafeRoomPress(active);
      return;
    }
    // Ahead of the hostile check: while a crawler's striker meter is up or
    // their swing at it has yet to land, their press is the lock-in or
    // nothing, never a punch.
    if (this.highStriker?.claimPress(active) === true) return;
    if (this.tryInteractWithWorld(active, fromTap)) return;
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
   * An interact press or world tap made while a conversation the player can
   * walk away from is up, offered to the world first — see
   * `Conversation.handOff`. Only while that conversation is the one overlay
   * open: any menu over it owns the press outright.
   */
  private handOffConversationPress(): boolean {
    if (!this.conversation.isOpen) return false;
    const openSurfaces = surfacesOverHud(this.ui);
    if (openSurfaces.length !== 1 || openSurfaces[0] !== CONVERSATION_SURFACE_ID) return false;
    const active = this.active();
    const inSafeRoom = this.safeRoom.isEntityInSafeRoom(active);
    const pressIsForSomeoneElse =
      inSafeRoom && safeRoomPressLeavesSpeaker(this.bopca, this.dave, active);
    return this.conversation.handOff(active, pressIsForSomeoneElse, () =>
      inSafeRoom ? this.trySafeRoomPress(active) : this.tryHandOffToWorld(active),
    );
  }

  /**
   * The world's half of a hand-off: only what the player walks up to. Deinonychus
   * and the hireling follow at the party's shoulder, and a tree is beside
   * half the street, so any of them would take a press made while reading a
   * street box from wherever the player happened to drift — dismissing the
   * box mid-read for a pet or a bark the player never asked for.
   */
  private tryHandOffToWorld(active: HumanPlayer | CatPlayer): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    return this.tryWalkedUpToInteraction(active, false);
  }

  /** The safe room's half of the interact chain: whichever of the Bopca and Dave is nearer. Returns whether either took the press. */
  private trySafeRoomPress(active: HumanPlayer | CatPlayer): boolean {
    const speaker = safeRoomSpeakerFor(this.bopca, this.dave, active);
    if (speaker === 'bopca') return this.bopca.tryInteract(active);
    if (speaker === 'dave') {
      this.talkToDave(active);
      return true;
    }
    return false;
  }

  /**
   * Everything outside a safe room an interact press can reach, in priority
   * order, short of a swing. Returns whether anything took it. Nothing does
   * while a hostile is inside the attack range: the press is a swing then.
   */
  private tryInteractWithWorld(active: HumanPlayer | CatPlayer, fromTap: boolean): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    return (
      this.tryWalkedUpToInteraction(active, fromTap) || this.tryInteractWithSurroundings(active)
    );
  }

  /**
   * The part of the interact chain the player reaches by walking up to it:
   * chests, quest givers, pickups, stalls, signs, villagers and citizens.
   * Returns whether anything took the press.
   */
  private tryWalkedUpToInteraction(active: HumanPlayer | CatPlayer, fromTap: boolean): boolean {
    if (this.treasureChests.tryInteract(active)) {
      return true;
    }
    if (this.defendQuest.tryInteract(active, { human: this.human, cat: this.cat })) {
      return true;
    }
    if (this.spiderQuest.tryInteract(active)) {
      return true;
    }
    if (this.murderQuest.tryInteract(active)) {
      return true;
    }
    if (this.cloggedBathroom.tryInteract(active, { human: this.human, cat: this.cat })) {
      return true;
    }
    if (this.stealthKeySnatch.tryInteract(active, { human: this.human, cat: this.cat })) {
      return true;
    }
    // Ahead of the boss room: standing on a placed piece singles it out, where
    // a gym rack answers anyone merely near it.
    if (this.barriers.tryPickupNear(active)) {
      this.audio?.play('picking_up_ground_object');
      return true;
    }
    if (this.bossRoomDressings.tryInteract(active)) {
      return true;
    }
    if (this.destruction.groundPickups.tryPickupNear(active)) {
      return true;
    }
    if (this.arenaRoom.tryPickupNear(active)) {
      this.audio?.play('picking_up_ground_object');
      return true;
    }
    if (this.market?.tryInteract(active) === true) {
      return true;
    }
    // Before the board he stands beside: with both in reach, a press should
    // reach the man, not the noticeboard behind him.
    if (this.bounty?.tryInteract(active, this.human, this.cat) === true) {
      return true;
    }
    if (this.townProps?.tryInteract(active) === true) {
      return true;
    }
    if (this.highStriker?.tryInteract(active) === true) {
      return true;
    }
    if (this.crawlerSigns?.tryInteract(active) === true) {
      return true;
    }
    if (this.briarHollowKit?.tryInteract(active, fromTap) === true) {
      return true;
    }
    return this.tryTalkToCitizen(active);
  }

  /**
   * The tail of the interact chain: what is within reach almost everywhere —
   * the trees, Deinonychus, the hireling — and so only answers a press nothing the
   * player walked up to wanted. Returns whether anything took it.
   */
  private tryInteractWithSurroundings(active: HumanPlayer | CatPlayer): boolean {
    // After citizen talk: a townsperson in range is who a press is meant for,
    // and a tree beside them is scenery until nobody is there to answer.
    if (this.gathering?.tryStartHarvest(active) === true) {
      return true;
    }
    if (
      this.deinonychusSystem.tryPet(
        active,
        this.gameMap,
        this.world.roster.mobs,
        this.world.roster.grid,
        this.levelDef.isOverworld === true,
      )
    ) {
      this.audio?.play('happy_hearts');
      const isGrownUp =
        (this.deinonychusSystem.deinonychus?.growthLevel ?? 0) >=
        DEINONYCHUS_ADULT_SQUAWK_MIN_LEVEL;
      this.audio?.playRandom(
        isGrownUp ? DEINONYCHUS_ADULT_HAPPY_SQUAWKS : DEINONYCHUS_JUVENILE_HAPPY_SQUAWKS,
      );
      return true;
    }
    // Last in the chain: the hireling stands at the party's shoulder all
    // floor, so anything else within reach is what a press is meant for.
    if (this.mercenarySystem.tryTalk(active, this.world.roster.mobs)) {
      return true;
    }
    return false;
  }

  /** The dynamite in his hand waiting to be thrown, which the hotbars mark in use. */
  private readiedDynamiteId(): ItemId | null {
    return this.destruction.dynamite.readiedItem;
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
    if (this.cloggedBathroom.isStallVisitActive) {
      this.audio?.play('error');
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
    if (slot.id === 'wayfinders_anchor') {
      this.recall.requestTravel(this.active());
      return true;
    }
    return false;
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  /** What the HUD shows this frame. */
  private hudModel(): HudModel {
    const invPlayer = this.menus.inventoryPlayer();
    return {
      crawlers: this.hudCrawlerFrames(),
      activeCrawler: this.human.isActive ? 'human' : 'cat',
      coins: this.hudCoins(),
      skillPoints: this.dungeonSkillPoints(),
      minimap: this.hudMinimap(),
      dock: this.hudDock(),
      summon: this.hudSummon(),
      hotbar: {
        slots: hotbarSlotModels(
          this.menus.itemCooldowns,
          invPlayer,
          invPlayer === this.human ? this.readiedDynamiteId() : null,
        ),
        input: hotbarPressInput(
          () => this.hotbarHost(),
          () => this.ui.worldHalted(),
        ),
        arrange: this.menus.inventoryScreen.hotbarArranger(),
      },
      topBand: this.topBandEntries(),
      levelTimer:
        this.levelDef.hasCollapseTimer === true && this.tutorial === null
          ? { frames: this.levelTimerFrames, paused: this.isLevelTimerPaused() }
          : null,
    };
  }

  /** Puts away the pause menu and panels once a tutorial step finished inside them asks to. */
  private closeMenusForTutorial(tutorial: TutorialController): void {
    if (!tutorial.needsAutoCloseMenus) return;
    tutorial.needsAutoCloseMenus = false;
    this.menus.pauseScreen.close();
    this.menus.closePanels();
  }

  /** The skill-point badge, which the tutorial's stat step keeps on screen while it points at it. */
  private dungeonSkillPoints(): SkillPointsModel {
    const skillPoints = this.hudSkillPoints(() => void this.menus.openSpendScreen());
    return this.tutorial?.forcesSkillPointBadge === true
      ? { ...skillPoints, hidden: false }
      : skillPoints;
  }

  private hudMinimap(): MinimapModel {
    this.miniMap.escapeMarkerTile = this.doomsdayEscape.escapeMarkerTile;
    return {
      expanded: this.miniMap.isExpanded,
      hint: platform.miniMapHint(this.miniMap.isExpanded),
      paint: (ctx, rect) =>
        this.miniMap.render(
          ctx,
          rect,
          this.active(),
          this.inactive(),
          this.world.roster.grid,
          this.dave.minimapTile,
          this.collectQuestMarkers(),
          this.deinonychusSystem.deinonychus,
          this.briarHollowKit?.minimapProcessingStations ?? [],
          this.collectVendorMinimapPositions(),
        ),
      toggle: () => this.miniMap.toggle(),
      pan: (dx, dy) => this.miniMap.pan(dx, dy),
    };
  }

  /** The dock's buttons in column order; one this floor does not offer is left out. */
  private hudDock(): DockButtonModel[] {
    const dock: DockButtonModel[] = [
      {
        id: 'pause',
        icon: 'pause',
        label: 'Pause',
        key: PAUSE_KEY_LABEL,
        sound: 'menu_open',
        onTap: () => this.openPauseFromButton(),
      },
    ];
    const unseenUpgrades = this.menus.inventoryPlayer().inventory.unseenUpgrades.size;
    dock.push({
      id: 'bag',
      icon: 'bag',
      label: 'Bag',
      key: keybindings.labelFor('toggleInventory'),
      badge: unseenUpgrades > 0 ? String(unseenUpgrades) : undefined,
      selected: this.menus.inventoryScreen.isOpen,
      bounce: this.rewardFly.bagBouncePulse(),
      onTap: () => this.toggleBagFromHud(),
    });
    const defences = this.briarHollowKit?.defences ?? null;
    if (defences?.buildButtonVisible === true) {
      dock.push({
        id: 'build',
        icon: 'hammer',
        label: 'Build',
        key: keybindings.labelFor('construction'),
        selected: defences.constructionMenuOpen,
        pulse: defences.buildButtonPulseSeconds > 0,
        sound: 'menu_open',
        onTap: () => this.briarHollowKit?.openConstruction(),
      });
    }
    const waiting = this.achievementUI.hudChipCount();
    if (waiting !== null) {
      dock.push({
        id: 'chip',
        icon: 'trophy',
        label: 'Rewards waiting',
        badge: String(waiting),
        pulse: true,
        onTap: () => void this.achievementUI.openRewards(),
      });
    }
    if (this.hasQuestJournal) {
      const outstanding = this._trackerEntries.filter((entry) =>
        isOutstanding(entry.status),
      ).length;
      dock.push({
        id: 'journal',
        icon: 'compass',
        label: 'Quest Journal',
        key: keybindings.labelFor('toggleQuestTracker'),
        badge: outstanding > 0 ? String(outstanding) : undefined,
        sound: 'menu_open',
        onTap: () => void this.openQuestJournal(),
      });
    }
    if (this.showsFollowerButton) {
      const humanLeads = this.human.isActive;
      const ordersChanged =
        this.companion.getMovementMode(humanLeads) === 'anchored' ||
        this.companion.getCombatStance(humanLeads) === 'passive';
      dock.push({
        id: 'follower',
        icon: 'users',
        label: 'Follower orders',
        key: keybindings.labelFor('companionFollow'),
        selected: ordersChanged,
        onTap: () => this.triggerCompanionFollow(),
      });
    }
    if (this.showsSwitchButton) {
      const other = this.human.isActive ? 'cat' : 'human';
      dock.push({
        id: 'switch',
        icon: other === 'cat' ? 'cat' : 'user',
        label: `Switch to ${crawlerName(other)}`,
        key: keybindings.labelFor('switchCharacter'),
        onTap: () => this.triggerSwitchCharacter(),
      });
    }
    return dock;
  }

  private hudSummon(): HudModel['summon'] {
    const card = this.deinonychusSystem.summonCard(this.cat.isActive);
    return card === null ? null : { ...card, onTap: () => this.toggleDeinonychusSummon() };
  }

  /** Every bar the top band stacks this frame. */
  private topBandEntries(): TopBandEntry[] {
    const entries: (TopBandEntry | null)[] = [
      this.achievementUI.rewardsBanner(this.human.isProtected || this.cat.isProtected),
      this.bossRoom.topBandEntry(this.world.roster.mobs, this.human, this.cat),
      ...this.arena.topBandEntries(this.active()),
      this.defendQuest.topBandEntry(),
      this.murderQuest.topBandEntry(),
      this.doomsdayEscape.topBandEntry(),
      this.spiderQuest.topBandEntry(),
      ...(this.briarHollowKit?.topBandEntries() ?? []),
      ...(this.gathering?.topBandEntries(this.active()) ?? []),
      ...this.aiInteractions.topBandEntries(),
      knockedOutBandEntry(this.inactive()),
    ];
    return entries.filter((entry): entry is TopBandEntry => entry !== null);
  }

  /**
   * The dock's Bag button. A finger on it also ends a conversation the world
   * runs under, the way a phone's buttons always have.
   */
  private toggleBagFromHud(): void {
    if (this.ui.viewport.density === 'touch') this.closeConversationForMenu();
    this.menus.toggleInventory();
  }

  private get showsAchievementUi(): boolean {
    return this.tutorial === null || this.tutorial.showAchievementUI;
  }

  private get showsFollowerButton(): boolean {
    return this.tutorial === null || this.tutorial.showFollowerButton;
  }

  private get showsSwitchButton(): boolean {
    return this.tutorial === null || this.tutorial.showSwitchButton;
  }

  // ── World input ──────────────────────────────────────────────────────────

  /**
   * Every pointer gesture that landed on no surface: walking and tapping on a
   * phone, and clicking loot and chests with a mouse. Coordinates are canvas
   * CSS pixels, the space the camera works in.
   */
  private handleWorldPointer(gesture: WorldGesture): void {
    if (gesture.button !== PRIMARY_BUTTON) return;
    const x = gesture.cssX;
    const y = gesture.cssY;
    switch (gesture.kind) {
      case 'down':
        if (gesture.source === 'touch')
          this.beginWorldTouch(gesture.pointerId, x, y, gesture.timeStamp);
        return;
      case 'move':
        if (gesture.pointerId === this.touch.moveTouchId) this.touch.updateMove(x, y);
        return;
      case 'up':
        if (gesture.source === 'mouse') {
          if (gesture.tap) this.collectWorldPickupAt(x, y);
          return;
        }
        if (gesture.pointerId === this.touch.moveTouchId) {
          this.endWorldTouch(x, y, gesture.timeStamp);
        } else {
          const pressedAt = this.touch.endExtraFinger(gesture.pointerId, x, y);
          if (pressedAt !== null) this.tapWorld(x, y, pressedAt);
        }
        return;
      case 'cancel':
        if (gesture.pointerId === this.touch.moveTouchId) this.clearWorldTouch();
        else this.touch.cancelExtraFinger(gesture.pointerId);
        return;
      case 'wheel':
        return;
    }
  }

  /**
   * The finger that walks the crawler: the first one down on the world. Any
   * finger after it only taps, leaving the walk running.
   */
  private beginWorldTouch(
    pointerId: number,
    x: number,
    y: number,
    timeStamp: number | undefined,
  ): void {
    const pressedAt = timeStamp ?? performance.now();
    if (this.touch.moveTouchId !== null) {
      this.touch.startExtraFinger(pointerId, x, y, pressedAt);
      return;
    }
    this.touch.startMove(pointerId, x, y, pressedAt);
    this.structureHold.begin(this.fingerOnWorkableStructure(x, y), x, y);
    const starter = this.active();
    this.holdStartActivePos = { x: starter.x, y: starter.y };
  }

  private endWorldTouch(x: number, y: number, timeStamp: number | undefined): void {
    if (this.touch.tapStart !== null) {
      if (this.touch.isTap(x, y)) {
        this.tapWorld(x, y, this.touch.tapStartEventMs ?? timeStamp ?? performance.now());
      } else if (this.touch.heldInPlace(x, y) && !this.crawlerWalkedDuringHold()) {
        // Held roughly in place past tap duration, rather than dragged — and
        // without the hold having walked the crawler, which is just the end of
        // a walk with the finger resting somewhere: the Structure menu's
        // gesture. A village structure under the finger wins; otherwise a
        // boarded grate in reach, for a crawler who can spike it.
        const cam = this.camera();
        const villageTook =
          this.briarHollowKit?.handleLongPress(x, y, cam.x, cam.y, this.active()) === true;
        if (!villageTook) this.grateSpikes.tryOpen();
      }
    }
    this.clearWorldTouch();
  }

  private clearWorldTouch(): void {
    this.touch.endMove();
    this.structureHold.end();
  }

  /**
   * A short tap on the world: the touch form of the interact press. It throws
   * a readied stick of dynamite at the tap, picks up loot or opens a chest under it, is
   * offered to whoever the crawler walked up to mid-conversation, works the
   * village, boards a grate, and otherwise interacts or swings toward it.
   *
   * @param pressedAt When the tapping finger came down, which a timed press
   *   is graded by.
   */
  private tapWorld(x: number, y: number, pressedAt: number): void {
    // A phone tap anywhere on the world dismisses these, and does nothing else.
    if (this.tutorial?.showNearGoblinDialog === true) {
      this.tutorial.dismissNearGoblinDialog();
      return;
    }
    if (this.defendQuest.isOutcomeOverlayShowing) {
      this.defendQuest.dismissFailedBanner();
      return;
    }
    // A readied stick waits out a conversation or a menu rather than flying
    // at a tap meant for it.
    const tapIsForTheWorld = !this.overlayOpen && !this.conversation.isOpen;
    if (tapIsForTheWorld) {
      const cam = this.camera();
      if (throwReadiedDynamiteAt(this.hotbarHost(), x + cam.x, y + cam.y)) return;
    }
    if (this.collectWorldPickupAt(x, y)) return;
    if (this.conversation.isOpen && this.handOffConversationPress()) return;
    // A conversation or menu up over the world had this tap's chance; the
    // world behind it must not open another conversation or swing underneath.
    if (this.overlayOpen) return;
    const cam = this.camera();
    const kit = this.briarHollowKit;
    if (kit !== null) {
      const now = Date.now();
      const lastTap = this.briarHollowLastWorldTapAt;
      const isDoubleTap = lastTap !== null && now - lastTap < BRIAR_HOLLOW_DOUBLE_TAP_WINDOW_MS;
      this.briarHollowLastWorldTapAt = now;
      // A live scythe swing takes every tap as its timed press, graded by when
      // the finger came down, however soon after the tap that started it.
      const villageTook =
        isDoubleTap && !kit.claimsWorldTaps
          ? kit.handleDoubleTap(x, y, cam.x, cam.y, this.active())
          : kit.handleTap(x, y, cam.x, cam.y, this.active(), pressedAt);
      if (villageTook) return;
    }
    if (this.defendQuest.tryMobileTapOnGrate(x, y, cam.x, cam.y, this.active())) return;
    this.triggerSpaceAction(x, y);
  }

  /**
   * Loot, an openable chest or a gym piece in reach under a click or tap.
   * Returns whether any took it.
   */
  private collectWorldPickupAt(x: number, y: number): boolean {
    const active = this.active();
    const { x: camX, y: camY } = this.camera();
    if (this.destruction.loot.tryCollectLootAt(x, y, camX, camY, active, this.inactive())) {
      return true;
    }
    if (this.treasureChests.tryInteractAt(x, y, camX, camY, active)) return true;
    const worldX = x + camX;
    const worldY = y + camY;
    const gymPieceTaken =
      this.barriers.tryPickupAt(worldX, worldY, active) ||
      this.bossRoomDressings.parts.gym?.tryPickupBenchAt(worldX, worldY, active) === true ||
      this.arenaRoom.tryPickupAt(worldX, worldY, active);
    if (gymPieceTaken) this.audio?.play('picking_up_ground_object');
    return gymPieceTaken;
  }

  update(): void {
    // Ahead of everything, the town's streets included: the arrival's own work
    // is being done under this screen, and a world ticked behind it would be
    // played by nobody — a crowd walking off from where it was warmed, a save
    // taken of a floor the player has not seen.
    if (this.arrivalLoading.isOpen) return;
    // Ahead of every halting return, so a sound the party walks into range of
    // is decoding even while a menu or conversation holds the world.
    this.updateSfxGates();
    this.yieldCitizenDialogToInterruption();
    const active = this.active();
    // Ahead of every halting return, because a conversation that halts the world
    // still has to keep revealing — but not under the pause menu, which freezes
    // the voice along with everything else.
    if (!this.gameOver && !this.menus.pauseScreen.isOpen) {
      this.conversation.update({ x: active.x, y: active.y });
    }
    aiAdapter.update();
    this.chat.update();
    this.achievementUI.tick();
    this.resolvePendingQuestSwitch();
    playRewardLandingCues(this.audio, this.rewardFly.update());
    // Above the boss-intro return below: an award overlay raised on the frame a
    // boss room locks would otherwise sit frozen at its first frame for the
    // length of the intro, and a potion's effect cue would be held with it.
    this.menus.update();
    this.missingPetNames.update(this.ui.worldHalted());
    if (this.tutorial !== null) {
      this.tutorial.updateUnderMenus(this.human, this.cat);
      this.closeMenusForTutorial(this.tutorial);
    }
    // The floor's song starts with the intro banner, which is drawn over the
    // HUD for most of a credit's display time; its notices wait in the library.
    const introBannerShowing = this.tutorial === null && this.dungeonIntro.isActive;
    if (!introBannerShowing) postMusicLibraryNotices(this.musicLibrary.drainNotices(), this.menus);
    this.tickSaveIndicator();
    this.chestKit.tick();

    // Only tick once audio is ready so the intro visual and sound start together.
    if (this.introStarted && this.tutorial === null) {
      this.dungeonIntro.tick();
    }

    if (this.bossIntro.isActive) {
      this.silenceFrozenWorldLoops();
      this.bossIntro.tick();
      return;
    }

    // Spider quest ticks even while other systems are paused (keyboard hero must advance)
    if (!this.gameOver && !this.menus.pauseScreen.isOpen) {
      const sqCtx = this.buildSystemContext();
      this.spiderQuest.update(sqCtx);
      this._processSpiderQuestSounds();
    }

    // A harvest does not outlast the pause menu: the block below stops ticking
    // under it, so without this the swing would pick straight back up on close.
    if (this.menus.pauseScreen.isOpen) this.gathering?.harvest.stopAll();
    // The village is not ticked under either, so its loops would play on unattended.
    if (this.menus.pauseScreen.isOpen || this.gameOver) {
      this.briarHollowKit?.silenceLoops();
      this.silenceScientistFootsteps();
    }
    // Gameplay stops ticking the soundscape under all three end screens, so its
    // loops would hold their last volume behind the screen until it closed.
    const endScreenShowing =
      this.gameOver || this.levelCompleteScreen.isActive || this.runCompleteScreen.isActive;
    if (endScreenShowing) {
      this.dungeonAmbience?.silence();
      this.labHallway?.silence();
    }

    // Town keeps living through citizen chats and other overlay dialogs — only a
    // hard stop (game over, the pause menu, or a level- or run-complete screen)
    // should freeze the streets.
    // Ungated: a death screen or a pause is exactly when the next place the
    // party is drawn may be a warp away, and the caches can use the time.
    this.residency.update(() => this.residencyOutlook());
    if (
      !this.gameOver &&
      !this.menus.pauseScreen.isOpen &&
      !this.levelCompleteScreen.isActive &&
      !this.runCompleteScreen.isActive
    ) {
      this.townLife?.update(this.buildSystemContext());
      this.briarHollowKit?.update(this.buildSystemContext());
      this.gathering?.update(this.buildSystemContext(), this.overlayOpen);
      this.circusAmbience?.update(this.gameMap, 1 / FRAMES_PER_SECOND);
      recordCircusGroundsVisit(this.townMemory, this.gameMap, this.active());
      this.highStriker?.update(this.gameMap, this.gameplayHalted);
      this.townProps?.update();
      this.townDecor?.update();
      this.market?.update();
    }

    // Above the gameplay-halted early return below: his talk pose is only ever
    // wanted while his own dialog is open, which is exactly when gameplay is
    // halted and `updateGameplay` never runs.
    this.bounty?.syncShady();
    // Same reason, for the two givers whose beacon and glyph are drawn by
    // different owners. Their marker state is suppressed while their own dialog
    // is open, and an open dialog is a halted frame — so setting it in `update`
    // alone would leave a column of light standing over somebody mid-sentence.
    this.murderQuest.syncMarkers();
    // The board's generation runs behind the explainer and the board, both of
    // which halt the world, so it is stepped ahead of the halt.
    this.cloggedBathroom.tickGeneration();
    this.cloggedBathroom.syncMarkers();
    this.stealthKeySnatch.syncMarkers();
    // Ahead of the halt: the pipe board halts the world, and it is the only
    // time the puzzle's music plays.
    this.updatePipeBoardMusic();
    this.updateSpiderLabMusic();
    this.questRoute.update(
      this.gameMap,
      crawlerGroundPoint(this.active()),
      this.routedPinnedTarget(),
    );

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
      this.silenceFrozenWorldLoops();
      this.marketPanel?.update();
      this.travelMenu.update();
      return;
    }
    this.gameStats.recordPlayedFrame();
    tickShopStock(this.shopStock);
    tickShopStock(this.briarHollowState.shopStock);

    if (this.tutorial?.showNearGoblinDialog === true) {
      this.silenceFrozenWorldLoops();
      return;
    }

    this.updateGameplay();
  }

  /**
   * The lighting pass for floors 1 and 2, or null for any other map: one
   * with no room characters has no lighting profiles to light it by.
   */
  private buildDungeonLighting(levelDef: LevelDef): DungeonLightingSystem | null {
    if (levelDef.groundTheme === undefined) return null;
    if (this.gameMap.regionCharacters.roomAssignments().length === 0) return null;
    const lighting = new DungeonLightingSystem({
      gameMap: this.gameMap,
      now: () => performance.now(),
      additiveGlows: () => renderQuality.fullDetail,
    });
    for (const sconce of this.defendQuest.sconceLights()) {
      lighting.registerStaticLight({
        tileX: sconce.tileX,
        tileY: sconce.tileY,
        kind: 'wall_sconce',
        centre: { x: sconce.centreX, y: sconce.centreY },
      });
    }
    registerBossRoomMoodLights(
      lighting,
      this.gameMap,
      levelDef.bossRooms?.map((b) => b.type) ?? [],
    );
    lighting.addDynamicLightSource(
      partyLightSource({
        crawlers: () => this.lightedCrawlers(),
        companions: () => this.lightedCompanions(),
      }),
    );
    lighting.addDynamicLightSource(this.cat);
    lighting.addDynamicLightSource(this.destruction.dynamite);
    lighting.addDynamicLightSource(this.fairyFireballs);
    lighting.addDynamicLightSource(this.goblinBombs);
    lighting.addDynamicLightSource(this.lavaBalls);
    lighting.addDynamicLightSource(this.knightMissiles);
    lighting.addDynamicLightSource(this.skeletonShots);
    lighting.addDynamicLightSource(this.combat.spells);
    lighting.addDynamicLightSource(this.combat.stormcaller);
    lighting.addDynamicLightSource(this.destruction.destructibles);
    lighting.addDynamicLightSource({
      collectLights: (sink) => {
        for (const mob of this.world.roster.mobs) {
          if (mob instanceof BrindleGrub) mob.collectLights(sink);
        }
      },
    });
    return lighting;
  }

  /**
   * The small moving things for floors 1 and 2, or null for any other map:
   * like the lighting, they are dressing for a floor dressed by room
   * characters.
   */
  private buildDungeonLife(): DungeonLifeSystem | null {
    if (this.levelDef.groundTheme === undefined) return null;
    if (this.gameMap.regionCharacters.roomAssignments().length === 0) return null;
    const life = new DungeonLifeSystem({
      gameMap: this.gameMap,
      floor: dungeonFloorTheme().id,
      puddles: floorSurfaceOf(this.gameMap.structure) ?? null,
      lights: this.dungeonLighting,
      fullDetail: () => renderQuality.fullDetail,
      raiseCue: (cue, x, y, volume) => this.dungeonAmbience?.playAt(cue, x, y, volume),
      wreckage: () => this.destruction.destructibles.wreckage,
    });
    this.destruction.destructibles.setSurpriseSink((x, y) => {
      // The critters are left out whenever full detail is off — at the
      // performance preset, or once auto has downgraded — so nothing bursts then.
      if (!renderQuality.fullDetail) return false;
      life.scatterSurprise(x, y);
      return true;
    });
    return life;
  }

  /** The soundscape for floors 1 and 2; null wherever there is no dungeon life. */
  private buildDungeonAmbience(life: DungeonLifeSystem | null): DungeonAmbienceSystem | null {
    if (life === null) return null;
    const lighting = this.dungeonLighting;
    return new DungeonAmbienceSystem({
      gameMap: this.gameMap,
      audio: this.audio,
      audioScope: this.audioScope,
      floor: dungeonFloorTheme().id,
      lights: lighting === null ? null : () => lighting.staticLightTiles(),
      puddles: { tiles: life.puddles },
      onDrip: (tileX, tileY, volume) => life.spawnDrip(tileX, tileY, volume),
      wreckage: () => this.destruction.destructibles.wreckage,
    });
  }

  /** Ticks the floor's small moving things and its soundscape, after this frame's breaks. */
  private updateDungeonLife(active: HumanPlayer | CatPlayer): void {
    const life = this.dungeonLife;
    if (life === null) return;
    const party = this._lifeParty;
    party.length = 0;
    party.push(this.human, this.cat);
    const deinonychus = this.deinonychusSystem.deinonychus;
    if (deinonychus?.isAlive === true) party.push(deinonychus);
    const hireling = this.mercenarySystem.activeMerc;
    if (hireling !== null) party.push(hireling);
    const cow = this.attackCowSystem.standingCow;
    if (cow !== null) party.push(cow);
    const camera = this.camera();
    const lifeFrame = this._lifeFrame;
    lifeFrame.others = this.world.roster.mobs;
    lifeFrame.camX = camera.x;
    lifeFrame.camY = camera.y;
    lifeFrame.viewW = viewportWidth();
    lifeFrame.viewH = viewportHeight();
    life.update(lifeFrame);
    const ambienceFrame = this._ambienceFrame;
    ambienceFrame.listenerX = active.x + TILE_SIZE * TILE_CENTRE_FRACTION;
    ambienceFrame.listenerY = active.y + TILE_SIZE * TILE_CENTRE_FRACTION;
    ambienceFrame.inSafeRoom = this.safeRoom.isEntityInSafeRoom(active);
    ambienceFrame.bossFight = this.bossRoom.anyLocked;
    this.dungeonAmbience?.update(ambienceFrame);
    this.labHallway?.update(ambienceFrame, active);
  }

  private readonly _lifeParty: Walker[] = [];
  /** Reused every frame rather than rebuilt, like the party list it carries. */
  private readonly _lifeFrame: Mutable<LifeFrame> = {
    party: this._lifeParty,
    others: [],
    camX: 0,
    camY: 0,
    viewW: 0,
    viewH: 0,
  };
  private readonly _ambienceFrame: Mutable<AmbienceFrame> = {
    listenerX: 0,
    listenerY: 0,
    inSafeRoom: false,
    bossFight: false,
  };

  /** Deinonychus and the hireling, standing or down, for the party's lights. */
  private lightedCompanions(): ReadonlyArray<PartyCompanion> {
    const companions = this._lightedCompanions;
    companions.length = 0;
    const deinonychus = this.deinonychusSystem.deinonychus;
    if (deinonychus?.isAlive === true)
      companions.push({ x: deinonychus.x, y: deinonychus.y, downed: false });
    const standing = this.mercenarySystem.activeMerc;
    if (standing !== null) companions.push({ x: standing.x, y: standing.y, downed: false });
    const downed = this.mercenarySystem.downedMerc;
    if (downed !== null) companions.push({ x: downed.x, y: downed.y, downed: true });
    const cow = this.attackCowSystem.cow;
    if (cow !== null) companions.push({ x: cow.x, y: cow.y, downed: !cow.isStanding });
    return companions;
  }

  private readonly _lightedCompanions: PartyCompanion[] = [];

  /** Refilled rather than rebuilt: the lighting asks for it every frame. */
  private lightedCrawlers(): ReadonlyArray<HumanPlayer | CatPlayer> {
    const crawlers = this._lightedCrawlers;
    crawlers.length = 0;
    crawlers.push(this.human, this.cat);
    return crawlers;
  }

  private readonly _lightedCrawlers: (HumanPlayer | CatPlayer)[] = [];

  /**
   * What the darkness pass draws back over the dark this frame: the objective
   * beacons and the floor warnings, set before each use rather than captured
   * in a fresh closure.
   */
  private readonly overDarknessPainter: OverDarknessPainter & {
    rc: RenderContext | null;
    beacons: boolean;
    warnings: boolean;
  } = {
    rc: null,
    beacons: false,
    warnings: false,
    paintOverDarkness: (target) => {
      const rc = this.overDarknessPainter.rc;
      if (rc === null) return;
      if (this.overDarknessPainter.beacons) {
        this.renderObjectiveBeacons(target, rc.camX, rc.camY, 'withFrontBeams');
      }
      if (this.overDarknessPainter.warnings) this.renderPipeline.renderGroundWarnings(target, rc);
    },
  };

  /** Whether the light hung at a tile is shining this instant; every light is, unlit by this pass. */
  private readonly lightShining = (tileX: number, tileY: number): boolean =>
    this.dungeonLighting?.isShiningAt(tileX, tileY) ?? true;

  /**
   * The darkness, then everything the dark must never hide drawn back over
   * it: floor warnings and objective beacons restored to full strength where
   * the dark dimmed them, eye-shine,
   * and the chrome the entity pass held back. The flying gore goes under it,
   * so a dark room's blood is as dim as the room.
   */
  private renderDungeonDarkness(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const lighting = this.dungeonLighting;
    if (lighting === null) return;
    const { camX, camY } = rc;
    const viewW = viewportWidth();
    const viewH = viewportHeight();
    this.renderPipeline.renderFlyingGore(ctx, rc);
    lighting.render(ctx, camX, camY, viewW, viewH);
    const warnings = this.renderPipeline.hasGroundWarnings(rc);
    const beacons = this.hasObjectiveBeacons(camX, camY);
    if (warnings || beacons) {
      const painter = this.overDarknessPainter;
      painter.rc = rc;
      painter.beacons = beacons;
      painter.warnings = warnings;
      lighting.renderOverDarkness(ctx, this.sceneManager.renderScale, painter);
    }
    lighting.renderEyeShine(ctx, camX, camY, viewW, viewH, this.world.roster.mobs);
    flushAboveDarkness(ctx);
  }

  private mergedPropRenderables(
    frontBeams: ReadonlyArray<TownPropRenderable>,
  ): ReadonlyArray<TownPropRenderable> {
    const merged = this.propRenderableScratch;
    merged.length = 0;
    for (const prop of this.townPropRenderables ?? []) merged.push(prop);
    for (const beam of frontBeams) merged.push(beam);
    for (const piece of this.briarHollowKit?.renderEntities() ?? []) merged.push(piece);
    for (const piece of this.gathering?.renderEntities() ?? []) merged.push(piece);
    for (const piece of this.circusAmbience?.renderEntities() ?? []) merged.push(piece);
    for (const piece of this.highStriker?.renderEntities() ?? []) merged.push(piece);
    return merged;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.arrivalLoading.renderLoading(this.ui, ctx)) return;
    // Any overlay at all, not only the world-halting ones: a street conversation
    // lets the player keep walking, and a "SPACE — Talk" cap still hovering over
    // the citizen they are already talking to is the loudest of these.
    setInteractionPromptsSuppressed(this.overlayOpen || this.gameOver);
    const { x: camX, y: camY } = this.camera();
    this.keepPromptsClearOfCrawlers(ctx, camX, camY, this.crawlerBarks, this.isCrawlerHidden);
    const frontBeams = this.frontObjectiveBeams();

    const rc: RenderContext = {
      camX,
      camY,
      gameMap: this.gameMap,
      pm: this.pm,
      active: this.active(),
      inactive: this.inactive(),
      mobs: this.world.roster.mobs,
      mobGrid: this.world.roster.grid,
      townsfolk: this.townLife?.renderablePeople(camX, camY),
      townProps:
        this.briarHollowKit !== null ||
        this.gathering !== null ||
        this.circusAmbience !== null ||
        this.highStriker !== null ||
        frontBeams.length > 0
          ? this.mergedPropRenderables(frontBeams)
          : (this.townPropRenderables ?? undefined),
      gameOver: this.gameOver,
      pauseMenuOpen: this.menus.pauseScreen.isOpen,
      gore: this.combat.gore,
      bodyPartGore: this.combat.bodyPartGore,
      safeRoom: this.safeRoom,
      dave: this.dave,
      bossRoom: this.bossRoom,
      bossRoomDressings: this.bossRoomDressings,
      arenaRoom: this.arenaRoom,
      stairwell: this.stairwell,
      building: this.building,
      barriers: this.barriers,
      spells: this.combat.spells,
      dynamite: this.destruction.dynamite,
      seismicStompFx: this.combat.seismicStompFx,
      meleeFx: this.combat.meleeFx,
      stormcallerFx: this.combat.stormcaller,
      gearFx: this.combat.gear,
      missileFx: this.combat.missileFx,
      lavaBalls: this.lavaBalls,
      rockThrows: this.rockThrows,
      hirelingShots: this.hirelingShots,
      skeletonShots: this.skeletonShots,
      goblinArrows: this.goblinArrows,
      goblinBombs: this.goblinBombs,
      clownGas: this.clownGas,
      fairies: this.fairies,
      fairyFireballs: this.fairyFireballs,
      knightMissiles: this.knightMissiles,
      destructibles: this.destruction.destructibles,
      trees: this.trees,
      water: this.water,
      circusGrounds: this.circusAmbience,
      loot: this.destruction.loot,
      groundPickups: this.destruction.groundPickups,
      interactionPromptsAllowed: this.shouldShowInteractionPrompts(this.active()),
      gymPromptTargets: this.gymPromptTargets(),
      treasureChests: this.treasureChests,
      miniMap: this.miniMap,
      deinonychusSystem: this.deinonychusSystem,
      mercenarySystem: this.mercenarySystem,
      attackCowSystem: this.attackCowSystem,
      crawlerBarks: this.crawlerBarks,
      speechBubblePulse: this.speechBubblePulse,
      goreUnderDarkness: this.dungeonLighting !== null,
      lightShining: this.lightShining,
      isCrawlerHidden: this.isCrawlerHidden,
      sortedFixtures: [
        ...this.cloggedBathroom.sortedFixtures(),
        ...(this.tutorial?.gateRenderables() ?? []),
        ...(this.labHallway?.sortedRenderables() ?? []),
      ],
    };

    this.renderPipeline.renderWorld(ctx, rc);
    this.dungeonLife?.renderGround(ctx, camX, camY, viewportWidth(), viewportHeight());
    // Straight after the floor, ahead of every quest system's own props, so a
    // clue scene or a grate stands in front of the light marking it.
    this.renderObjectiveBeacons(ctx, camX, camY);
    this.renderQuestRouteTrail(ctx, camX, camY);
    this.briarHollowKit?.renderGround(ctx, camX, camY);
    this.gathering?.renderGround(ctx, camX, camY);
    this.bopca.renderObjects(ctx, camX, camY, this.active(), this.inactive());
    const activeCrawler = this.active();
    this.defendQuest.renderObjects(ctx, camX, camY, activeCrawler, activeCrawler);
    this.cloggedBathroom.renderGround(
      ctx,
      camX,
      camY,
      rc.interactionPromptsAllowed && !this.overlayOpen ? activeCrawler : undefined,
    );
    this.stealthKeySnatch.renderPrompt(
      ctx,
      camX,
      camY,
      rc.interactionPromptsAllowed && !this.overlayOpen ? activeCrawler : undefined,
    );
    this.spiderQuest.render(ctx, camX, camY, this.active());
    this.murderQuest.render(ctx, camX, camY, this.active());
    // Puddles and telegraphs are floor paint, so players/mobs always appear on top of them
    for (const spider of this.grotesqueSpiders) {
      spider.renderSpitGroundTraps(ctx, camX, camY, TILE_SIZE);
      spider.renderGroundTelegraphs(ctx, camX, camY);
    }

    if (this.dungeonLighting !== null) beginAboveDarkness(this.dungeonLighting.darknessAtWorld);
    this.renderPipeline.renderEntities(ctx, rc);
    for (const spider of this.grotesqueSpiders) {
      spider.renderAboveEntities(ctx, camX, camY, [this.human, this.cat]);
    }
    this.murderQuest.renderWellClueOverlay(ctx, camX, camY, this.active());
    this.spiderQuest.renderLifeMachinesForeground(ctx, camX, camY, this.active());
    this.dungeonLife?.renderAir(ctx, camX, camY, viewportWidth(), viewportHeight());
    this.labHallway?.render(ctx, camX, camY, viewportWidth(), viewportHeight());
    // Over every body and under every warning, health bar and label.
    this.renderDungeonDarkness(ctx, rc);
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
    this.defendQuest.renderAbove(ctx, camX, camY, this.active());
    this.cloggedBathroom.renderAbove(ctx, camX, camY);
    this.briarHollowKit?.renderAbove(ctx, camX, camY);
    this.gathering?.renderAbove(ctx, camX, camY);
    this.circusAmbience?.renderAbove(ctx, camX, camY);
    this.highStriker?.renderAbove(ctx, camX, camY);
    // Over the entities: a label spawned on a large body (a boss) would
    // otherwise rise out of sight behind its own sprite.
    this.combat.floatingText.render(ctx, camX, camY);

    this.chat.renderBubble(ctx, camX, camY);

    this.renderPipeline.renderTowerBalconyOverlay(ctx, rc);

    this.renderPipeline.renderEffects(ctx, rc, (c, cx, cy) => {
      renderLevelUpFlash(c, cx, cy, this.pm);
      renderStatBoostFlash(c, cx, cy, this.pm);
    });

    this.renderPipeline.renderVisibilityFog(ctx, rc);

    renderHealthVignette(ctx, this.active(), this.gameOver);

    // After the fog, which fills everything past its outer radius with solid
    // black: a marker clamped to the screen edge is by definition out at that
    // radius or further — further still once the camera clamps at a map border
    // and puts the party on the opposite side of the screen — so drawn with the
    // world effects it was painted out in precisely the far-from-the-cat case it
    // exists to answer. The HUD and every menu draw after it and cover it where
    // they meet.
    if (!this.gameOver && !this.menus.pauseScreen.isOpen) {
      this.deinonychusSystem.renderOffscreenMarker(
        ctx,
        camX,
        camY,
        this.active(),
        VISIBILITY_RADIUS_PX,
      );
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
    // pause screen can also be reached with Escape, and it decides whether to
    // offer the Journal from whether this is null.
    this.syncJournalContext();

    const framesRect = this.hudFramesRect();
    this.briarHollowKit?.renderHud(ctx, {
      keepouts: this.hudKeepoutsCss(),
      buildButton: this.hud.cssDockRect('build'),
    });

    if (!this.gameOver && !this.menus.pauseScreen.isOpen) {
      this.recall.render(ctx, camX, camY);

      // Only one of these may be on screen at once — a downed companion always
      // wins the slot, and every other kind has a fixed place behind it.
      drawTopArrowCandidate([
        downedCompanionArrowCandidate(ctx, this.active(), this.inactive(), camX, camY),
        this.briarHollowKit?.siegeBellArrowCandidate(ctx, this.active(), camX, camY, framesRect) ??
          null,
        this.mercenarySystem.downedArrowCandidate(
          ctx,
          camX,
          camY,
          this.active(),
          VISIBILITY_RADIUS_PX,
          framesRect,
        ),
        this.attackCowSystem.downedArrowCandidate(
          ctx,
          camX,
          camY,
          this.active(),
          VISIBILITY_RADIUS_PX,
        ),
        this.stairwellRevealArrowCandidate(ctx, camX, camY),
        this.spiderLabArrowCandidate(ctx, camX, camY),
        this.pinnedObjectiveArrowCandidate(ctx, camX, camY),
        this.roomObjectiveArrowCandidate(ctx, camX, camY),
        this.shouldShowBountyArrow()
          ? (this.bounty?.arrowCandidate(ctx, this.active(), camX, camY, framesRect) ?? null)
          : null,
      ]);
    }

    this.bossRoom.renderSealedBorders(ctx, camX, camY);
    this.destruction.loot.render(ctx, camX, camY, this.active());

    if (!this.gameOver && !this.menus.pauseScreen.isOpen) {
      const invPlayer = this.menus.inventoryPlayer();
      const cooldowns = this.menus.itemCooldowns;
      cooldowns.set('energy_shield', {
        current: this.combat.spells.energyShieldCooldown,
        max: this.combat.spells.energyShieldCooldownMax,
      });
      cooldowns.set('magic_missile', {
        current: this.cat.missileCooldownCurrent,
        max: Math.max(1, this.cat.missileCooldownMax),
      });
      cooldowns.set('seismic_stomp', {
        current: this.human.seismicStompCooldown,
        max: Math.max(1, this.human.getSeismicStompCooldownMax()),
      });
      this.menus.syncPotionCooldownOverlay(invPlayer);
      // Keyed by item id rather than ability id — the stone is a plain item that
      // happens to have a cooldown; the hotbar falls back to the id for it.
      cooldowns.set('wayfinders_anchor', {
        current: this.recall.cooldownRemainingFrames,
        max: RECALL_COOLDOWN_FRAMES,
      });
      this.barriers.renderConstructUI(ctx);
    }

    const anyMenuOpen =
      this.menus.pauseScreen.isOpen ||
      this.menus.inventoryScreen.isOpen ||
      this.followerMenu.isOpen;
    if (!this.gameOver && !anyMenuOpen) {
      const safeRoomSpeaker = safeRoomSpeakerFor(this.bopca, this.dave, this.active());
      this.safeRoom.renderUI(ctx, this.active());
      this.dave.renderUI(ctx, camX, camY, this.active(), safeRoomSpeaker === 'bopca');
      this.bopca.renderUI(ctx, camX, camY, this.active(), safeRoomSpeaker === 'dave');
      // Once no overlay owns the press, `claimPress` takes it at the striker
      // ahead of everything else, so its lock-in prompt is drawn ahead of
      // every check that could hide or replace it, and no other prompt offers
      // a press it would not reach.
      const strikerOwnsPress =
        !this.overlayOpen &&
        (this.highStriker?.renderLockPrompt(ctx, camX, camY, this.active()) === true ||
          this.highStriker?.holdsCrawler(this.active()) === true);
      const laterPromptsOutOfReach =
        strikerOwnsPress || this.renderGroundPickupPrompt(ctx, camX, camY);
      if (!laterPromptsOutOfReach) this.renderCitizenPrompt(ctx, camX, camY);
      this.bounty?.renderShadyOverlay(ctx, camX, camY, this.active());
      if (!laterPromptsOutOfReach) {
        this.renderPropPrompt(ctx, camX, camY);
        if (!this.earlierSpaceLinkClaims(this.active())) {
          this.briarHollowKit?.renderPrompt(ctx, camX, camY, this.active());
        }
        this.renderDeinonychusPetPrompt(ctx, camX, camY);
        this.renderMercenaryPrompt(ctx, camX, camY);
      }
    }

    // Every menu and dialog, bottom to top in stack order; the hit regions
    // they register here are what the next press is tested against.
    this.ui.frame(ctx);

    // Flies over every dialog above: it is reporting a grant that already
    // happened, not asking for input, so nothing on screen should be able to
    // hide it mid-flight.
    this.rewardFly.render(ctx, this.hudFlyTargets());

    // Hidden behind the pause menu, like every other overlay above: the intro
    // card is drawn last and would otherwise cover the menu it was opened over,
    // leaving a screen of buttons nobody can see to aim at.
    if (this.tutorial === null && !this.menus.pauseScreen.isOpen) {
      this.dungeonIntro.render(ctx);

      if (this.dungeonIntro.isActive && !this.introStarted) {
        const hint = byInputMode(this.ui.viewport.density, {
          touch: 'Tap to begin',
          pointer: 'Press any key to begin',
        });
        worldText(ctx, hint, {
          x: Math.round(viewportWidth() / 2),
          y: Math.round(viewportHeight() * INTRO_BEGIN_HINT_Y_FRACTION),
          align: 'center',
          size: INTRO_BEGIN_HINT_SIZE,
          bold: true,
          color: worldPalette.introPrompt,
          outline: true,
          glow: true,
        });
      }
    }

    // While its modals or the song are up, they draw with their own surface.
    this.spiderQuest.renderUI(ctx, camX, camY);

    if (this.bossIntro.isActive) {
      this.bossIntro.render(ctx);
    }

    const mouse = sceneMouse(this.ui);
    if (
      platform.showEntityTooltip &&
      mouse !== null &&
      !this.ui.pointerOverUi() &&
      !this.gameOver &&
      !this.menus.pauseScreen.isOpen &&
      !this.achievementUI.isBlocking
    ) {
      renderEntityTooltip(
        ctx,
        camX,
        camY,
        mouse.x,
        mouse.y,
        this.world.roster.grid,
        this.briarHollowKit?.villagers?.villagers ?? [],
      );
    }

    if (this.tutorial !== null) {
      const { x: tutCamX, y: tutCamY } = this.camera();
      const activePlayer = this.active();
      const pauseButton = this.hud.cssDockRect('pause');
      const hotbarFrame = this.hud.frame;
      const screen = this.menus.inventoryScreen;
      const uiScale = this.ui.uiScale;
      const bagSlots = this.menus.inventoryPlayer().inventory.bag.slots;
      const bagItemRect = (id: ItemId): Rect | null => {
        const rect = screen.geometry.bagCells.get(bagSlots.findIndex((slot) => slot?.id === id));
        return rect === undefined ? null : toCssRect(rect, uiScale);
      };
      const inventoryFrame = screen.isOpen ? screen.geometry.frame : null;
      const bagTab = screen.isOpen
        ? inventoryTabRect(screen.surface.id, this.ui.regions(), 'bag')
        : null;
      const pauseInventoryEntry = this.menus.pauseScreen.guidedEntryRect;
      const pauseFrame = this.menus.pauseScreen.frameRect;
      const regions = this.ui.regions();
      const regionCssRect = (matches: (region: HitRegion) => boolean): Rect | null => {
        const region = regions.find(matches);
        return region === undefined ? null : toCssRect(region.rect, uiScale);
      };
      const closeButtonOf = (surfaceId: string): Rect | null =>
        regionCssRect(
          (region) => region.surfaceId === surfaceId && region.id.endsWith(CLOSE_BUTTON_ID_SUFFIX),
        );
      const menuCloseRect = this.menus.pauseScreen.isOpen
        ? closeButtonOf(PAUSE_SURFACE_ID)
        : screen.isOpen
          ? closeButtonOf(screen.surface.id)
          : null;
      const pausePrefix = `${PAUSE_SURFACE_ID}/`;
      const suggestedSpendId = `${pausePrefix}${statSpendButtonId('human', 'health')}`;
      // Health first; any other of the human crawler's "+" when it has scrolled out of view.
      const statSpendButtonRect =
        regionCssRect((region) => region.id === suggestedSpendId) ??
        regionCssRect(
          (region) =>
            region.surfaceId === PAUSE_SURFACE_ID &&
            isStatSpendButtonOf('human', region.id.slice(pausePrefix.length)),
        );
      const tutRenderCtx: TutorialRenderContext = {
        pauseMenuOpen: this.menus.pauseScreen.isOpen,
        inventoryPanelOpen: screen.isOpen && screen.tab === 'bag',
        inventoryFrame: inventoryFrame === null ? null : toCssRect(inventoryFrame, uiScale),
        inventoryBagTabRect: bagTab === null ? null : toCssRect(bagTab, uiScale),
        pauseInventoryEntryRect:
          pauseInventoryEntry === null ? null : toCssRect(pauseInventoryEntry, uiScale),
        pauseButtonRect: pauseButton,
        bagItemRects: {
          seismic_stomp_tome: bagItemRect('seismic_stomp_tome'),
          health_potion: bagItemRect('health_potion'),
          lucky_hoodie: bagItemRect('lucky_hoodie'),
          magic_missile_tome: bagItemRect('magic_missile_tome'),
        },
        hotbarSlotRects:
          hotbarFrame === null
            ? []
            : hotbarFrame.geometry.hotbar.slots.map((slot) => toCssRect(slot, hotbarFrame.uiScale)),
        bagHotbarSlotRects: Array.from({ length: HOTBAR_COUNT }, (_, index) => {
          const rect = screen.geometry.hotbarCells.get(index);
          return rect === undefined ? null : toCssRect(rect, uiScale);
        }),
        isDragActive: screen.drag !== null,
        isContextMenuOpen: screen.menu?.kind === 'item',
        contextMenuOptionRects: itemMenuEntryRects(screen.surface.id, this.ui.regions()).map(
          (entry) => ({ id: entry.id, ...toCssRect(entry.rect, uiScale) }),
        ),
        isAbilityDialogShowing: this.menus.levelUpDialog.isShowing,
        isRewardGrantedDialogShowing: this.menus.rewardGrantedDialog.isShowing,
        followerButtonRect: this.hud.cssDockRect('follower'),
        followerMenuOpen: this.followerMenu.isOpen,
        followerMenuFollowMeRect: this.followerMenu.isOpen
          ? this.followerMenu.followMeButtonRect
          : null,
        davePosition: this.dave.standingPosition,
        isRewardScreenOpen: this.achievementUI.isBlocking,
        rewardsChipRect: this.hud.cssDockRect('chip'),
        isChestRewardOpen: this.chestKit.isOpen,
        switchButtonRect: this.hud.cssDockRect('switch'),
        levelBadgeRect: this.hud.cssSkillBadgeRect(),
        pauseFrame: pauseFrame === null ? null : toCssRect(pauseFrame, uiScale),
        characterSectionOpen: this.menus.pauseScreen.shownSectionId === 'character',
        statSpendButtonRect,
        menuCloseRect,
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

    // Over everything, HUD included: the loading screen fades out over the
    // finished frame rather than cutting to it.
    this.arrivalLoading.renderFadeOut(ctx);
  }

  /**
   * The refusal a doorway answers with, or null when it opens normally.
   *
   * Every door refuses while the partner is down. Beyond that, floor 2's
   * prison is held shut by its quest until the gate guard has explained it. `BuildingSystem` asks rather than decides, so
   * each reason for being closed stays with the questline that closes it.
   */
  private sealedBuildingMessage(entry: BuildingEntry): string | null {
    const partner = this.inactive();
    const partnerName = partner === this.human ? crawlerName('human') : crawlerName('cat');
    const partnerDown = downedPartnerEntryRefusal(partner, partnerName);
    if (partnerDown !== null) return partnerDown;
    const prisonRefusal = prisonDoorRefusal(entry, this.stealthKeySnatch.isGuardBriefed);
    return prisonRefusal;
  }

  /**
   * Gathers every seller's minimap position into one reused array: Briar
   * Hollow's shop villagers plus every town building where an occupant keeps a
   * menu or a desk, read off `interiorSellsSomething` rather than a hand-kept
   * list of buildings — a service given to an occupant's spec in
   * `buildingOccupants.ts` shows up here without touching this.
   */
  private collectVendorMinimapPositions(): Array<{ x: number; y: number }> {
    const positions = this._vendorMinimapPositions;
    positions.length = 0;
    if (this.briarHollowKit !== null) positions.push(...this.briarHollowKit.minimapVendorPositions);
    for (const entry of this.gameMap.buildingEntries) {
      if (!interiorSellsSomething(entry.id)) continue;
      positions.push({ x: entry.doorTile.x * TILE_SIZE, y: entry.doorTile.y * TILE_SIZE });
    }
    return positions;
  }

  /** Gathers every quest's minimap markers into one reused array. */
  private collectQuestMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const markers = this._questMarkers;
    markers.length = 0;
    markers.push(...this.defendQuest.questMarkers);
    markers.push(...this.cloggedBathroom.questMarkers);
    markers.push(...this.stealthKeySnatch.questMarkers);
    markers.push(...this.spiderQuest.questMarkers);
    markers.push(...this.murderQuest.questMarkers);
    markers.push(...this.anchorQuest.questMarkers);
    if (this.bounty !== null) markers.push(...this.bounty.questMarkers);
    if (this.briarHollowKit !== null) markers.push(...this.briarHollowKit.questMarkers);
    const daveMarker = this.dave.minimapMarker;
    if (daveMarker !== null) markers.push(daveMarker);
    const pinned = resolvePinnedEntry(
      this.journalProgress.pinnedTrackerId,
      this._trackerEntries,
      this.activeTile,
    );
    // The pinned objective gets a marker of its own on top of whatever its own
    // system already contributes. That is not redundant: a quest can be pinned
    // while its system's marker rules say nothing (a bounty being collected),
    // and the pin is the player's own answer to "where
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
        this.cloggedBathroom,
        this.stealthKeySnatch,
        this.spiderQuest,
        this.murderQuest,
        this.anchorQuest,
        this.bounty,
        this.doomsdayEscape,
        this.briarHollowKit,
        this.aiChallenges,
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
    const deinonychus = this.deinonychusSystem.deinonychus;
    if (deinonychus && !deinonychus.recalling && !deinonychus.collapsing) targets.push(deinonychus);
    if (this.mercenarySystem.activeMerc) targets.push(this.mercenarySystem.activeMerc);
    const attackCow = this.attackCowSystem.standingCow;
    if (attackCow !== null) targets.push(attackCow);
    this.briarHollowKit?.pushAlliedDefenders(targets);
    this.briarHollowKit?.pushEscortTargets(targets);
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

    // A dungeon wall is a wall seen from in front, the same as an interior's,
    // so a crawler walking south into one has to stop with their feet on the
    // last floor tile rather than planting their whole lower half on the
    // masonry — see `SOLE_COLLISION_OFFSET`. Only the outdoor town keeps the
    // waist anchor: out there the "walls" are building facades and town
    // walls whose art and clearances are a separate question from this one.
    const southAnchor: SouthCollisionAnchor = this.levelDef.isOverworld === true ? 'waist' : 'sole';
    const scriptMovedParty = this.cutscenes.tickWorld(player, this.gameMap, southAnchor);
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
    const inStall = this.cloggedBathroom.isStallVisitActive;
    // A walk would carry the swinger off the striking spot and turn the blow
    // off the pad before it lands.
    const swingingAtStriker = this.highStriker?.holdsCrawler(player) === true;
    const movementHeld =
      this.spiderQuest.holdsPartyMovement ||
      inStall ||
      catMoveBlocked ||
      humanMoveBlocked ||
      swingingAtStriker;
    if (!scriptMovedParty) {
      // Only `applyMovement` writes `isMoving`, so a crawler held here keeps
      // the last frame's: a direction key held as the hold began would leave
      // them striding in place, footsteps and all.
      if (movementHeld) player.isMoving = false;
      else applyMovement(player, move, this.gameMap, southAnchor);
    }
    // Both crawlers, not just the active one — a thrown dumbbell can knock back
    // whichever player it hits, including the companion the input above never moved.
    applyKnockbackMotion(this.human, this.gameMap);
    applyKnockbackMotion(this.cat, this.gameMap);

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
      this.audioScope?.stopLoop(WALKING_LOOP);
      this.audioScope?.startLoop(WADING_LOOP);
    } else if (player.isMoving) {
      this.audioScope?.stopLoop(WADING_LOOP);
      this.audioScope?.startLoop(WALKING_LOOP);
    } else {
      this.silenceMovementLoops();
    }

    this.pm.updateProtection(this.safeRoom);

    const nowInSafeRoom = this.pm.isAnySafe(this.safeRoom);
    const enteredRoom =
      this.wasInSafeRoom || !nowInSafeRoom
        ? null
        : (this.safeRoom.safeRoomAt(this.active()) ?? this.safeRoom.safeRoomAt(this.inactive()));
    if (enteredRoom !== null) {
      this.bus.emit('safeRoomEntered', { room: enteredRoom });
      this.dave.onSafeRoomEntered(enteredRoom);
      this.tutorial?.onSafeRoomEntered();
    }
    this.wasInSafeRoom = nowInSafeRoom;

    // Every map without a town plan answers false here, so dungeon floors never
    // take this path.
    const nowInTown = this.isInsideTownWall(player);
    if (nowInTown && !this.wasInTown) this.onTownEntered(player);
    this.wasInTown = nowInTown;

    const nowInBriarHollowSaveZone = this.isInBriarHollowSaveZone(player);
    if (nowInBriarHollowSaveZone && !this.wasInBriarHollowSaveZone) {
      this.onBriarHollowSaveZoneEntered(player);
    }
    this.wasInBriarHollowSaveZone = nowInBriarHollowSaveZone;

    this.updateRoomSaves(player);

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
    this.dave.update(this.active());
    this.tellStory();
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

    if (this.bossRoom.fightAbortedPending) {
      this.bossRoom.fightAbortedPending = false;
      this.audioScope?.releaseMusic('boss');
    }
    if (this.bossRoom.sealedBossType !== null) {
      const track = bossTrack(this.bossRoom.sealedBossType);
      this.bossRoom.sealedBossType = null;
      if (track !== null) {
        this.audioScope?.claimMusic({
          owner: 'boss',
          layer: 'boss',
          selection: { kind: 'loop', id: track },
        });
      }
    }
    if (this.bossRoom.newlyLockedBossType !== null) {
      const bt = this.bossRoom.newlyLockedBossType;
      this.bossRoom.newlyLockedBossType = null;
      const meta = BOSS_META[bt] ?? {
        displayName: 'THE BOSS',
        color: worldPalette.ink.danger,
      };
      this.bossIntro.trigger(bt, meta.displayName, meta.color);
      this.bus.emit('bossFightInitiated', { bossType: bt });
    }

    this.backfillDefeatedBossChests();

    this.barriers.update(ctx);
    this.defendQuest.update(ctx);
    this.aiChallenges.update(ctx);
    this.cloggedBathroom.update(ctx);
    this.stealthKeySnatch.update(ctx);
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
    if (this.defendQuest.noWoodSoundPending) {
      this.defendQuest.noWoodSoundPending = false;
      this.audio?.play('error_taking_action');
    }
    if (this.defendQuest.barrierBrokenSoundPending) {
      this.defendQuest.barrierBrokenSoundPending = false;
      this.audio?.playRandom(BARRIER_BREAK_SOUNDS);
    }
    this.murderQuest.update(ctx);
    this.anchorQuest.update();
    // She is a plaza prop, not a `Player`, so unlike every other quest giver
    // she has no `markerType` field of her own for the beacon to read.
    this.townProps?.setFortuneTellerMarker(this.anchorQuest.markerState);
    this.townProps?.setNoticeBoardMarker(noticeBoardMarkerFor(this.briarHollowState));
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
    if (this.combat.worldStepTaken) this.bossRoomDressings.update(ctx);
    const colosseumCue = this.bossRoomDressings.parts.colosseum?.takeSoundCue() ?? null;
    if (colosseumCue !== null) this.audio?.play(colosseumCue);
    for (const takes of this.gymRoom.drainSoundCues()) this.audio?.playRandom(takes);
    for (const cue of this.bossRoomDressings.parts.krakaren?.drainSoundCues() ?? []) {
      this.audio?.play(cue.id, { volume: cue.volume });
    }
    for (const burst of this.bossRoomDressings.parts.trashGremlin?.drainRoachBursts() ?? []) {
      this.audio?.playRandomAt(TRASH_PILE_ROACH_BURST, burst.x, burst.y);
    }
    this.arenaRoom.update(ctx);
    // Advance tutorial state machine; anchor companion when tutorial requires it
    if (this.tutorial !== null) {
      this.tutorial.update(this.human, this.cat);
      this.tutorial.updateGates(this.human, this.cat, {
        camera: this.camera(),
        dialogOpen: this.conversation.isOpen || this.overlayOpen,
      });
      if (this.tutorial.needsSwitchToCat) {
        this.tutorial.needsSwitchToCat = false;
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

      this.closeMenusForTutorial(this.tutorial);
      this.playTutorialGateCues(this.tutorial);
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
      this.audioScope?.startLoop(SPIDER_WALKING_LOOP);
    } else {
      this.audioScope?.stopLoop(SPIDER_WALKING_LOOP);
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

    this.deinonychusSystem.checkHealth();
    this.mercenarySystem.checkHealth((merc) => this.combat.spawnKillGore(merc, null));
    this.attackCowSystem.checkHealth();
    this.combat.resolveKills();

    this.combat.resolveSpellAftermath();

    this.carryDeinonychusIn();
    this.deinonychusSystem.update(ctx);
    this.autoSummonDeinonychus(ctx);
    this.mercenarySystem.update(ctx);
    this.attackCowSystem.update(ctx);
    this.seatCompanionsAtPrisonDoor();
    this.enterPrisonForDev();
    this.drainWardExplainerBarks();
    this.crawlerBarks.update();
    if (this.building?.menuOpen === true || this.recall.isChannelling) {
      this.mercenarySystem.warnIfLeavingDowned();
    }
    this.pm.tickTimers();
    drainBloodVomitRetches([this.human, this.cat], this.bus);
    drainHpThresholdCrossings({ human: this.human, cat: this.cat }, this.bus);

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
    this.hirelingShots.update(ctx);
    // The hostile world's own step: skipped together on the frames a last
    // stand holds it back (`CombatKit.worldStepTaken`).
    if (this.combat.worldStepTaken) {
      this.lavaBalls.update(ctx);
      this.rockThrows.update(ctx);
      // Summons first, so a skeleton raised this frame is already in `ctx.roster.mobs`
      // when the projectile system walks it. Neither ordering can strand a shot —
      // the drain reads the whole list every frame — but this one keeps a wave and
      // the bolts covering it on the same tick.
      this.skeletonSummons.update(ctx);
      this.fairies.update(ctx);
      this.skeletonShots.update(ctx);
      this.goblinArrows.update(ctx);
      this.goblinBombs.update(ctx);
      this.clownGas.update(ctx);
      this.fairyFireballs.update(ctx);
      this.knightMissiles.update(ctx);
    }
    this.trees?.update(ctx);
    this.destruction.update(ctx);
    this.explosionShake.update();
    // After every system that can smash a lamp or a sconce this frame, so a
    // light broken now goes dark on the frame it breaks rather than the next.
    this.dungeonLighting?.update();
    if (this.destruction.drainAudioCues(this.audio)) {
      this.dungeonAmbience?.markDirty();
      this.dungeonLife?.rescan();
    }
    this.updateDungeonLife(ctx.active);
    playFairySystemCues(this.fairies.takeCues(), this.audio);
    playFairyFireballCues(this.fairyFireballs.takeCues(), this.audio);
    playFrostCues([this.human, this.cat], this.audio);

    // The llama's own impact cue. It is drained here rather than from
    // `playMobAudioCues` because the ball outlives its llama, and a shot that
    // lands after the animal died has no mob left to carry the flag.
    const lavaBurst = this.lavaBalls.burstSoundAt;
    if (lavaBurst !== null) {
      this.lavaBalls.burstSoundAt = null;
      this.audio?.playAt('llama_fireball_explosion', lavaBurst.x, lavaBurst.y);
    }

    playHirelingProjectileCues(this.rockThrows, this.hirelingShots, this.audio);

    // Drained here rather than from `playMobAudioCues` for the same reason the
    // llama's is: a soul bolt outlives its caster, and one that lands after the
    // lord died has no mob left to carry the flag.
    const soulBurst = this.skeletonShots.burstSoundAt;
    if (soulBurst !== null) {
      this.skeletonShots.burstSoundAt = null;
      this.audio?.playAt('magic_ball_impact', soulBurst.x, soulBurst.y);
    }

    // A bone shaft does not go off, so it is drained separately from the bolt
    // burst above — the same frame can end one of each.
    const boneShaft = this.skeletonShots.arrowImpactSoundAt;
    if (boneShaft !== null) {
      this.skeletonShots.arrowImpactSoundAt = null;
      this.audio?.playAt('arrow_impact', boneShaft.x, boneShaft.y);
    }

    const goblinArrow = this.goblinArrows.impactSoundAt;
    if (goblinArrow !== null) {
      this.goblinArrows.impactSoundAt = null;
      this.audio?.playAt('arrow_impact', goblinArrow.x, goblinArrow.y);
    }

    // Drained here rather than from `playMobAudioCues` for the arrow's reason:
    // a stick still burning on the floor has outlived the goblin that threw it.
    for (const raised of this.goblinBombs.takeCues()) {
      this.audio?.playRandomAt(BOMBER_GOBLIN_CUES[raised.cue], raised.x, raised.y);
    }
    this.fuseSizzle.update(this.audioScope, this.goblinBombs.liveSticks, {
      x: ctx.active.x + TILE_SIZE * TILE_CENTRE_FRACTION,
      y: ctx.active.y + TILE_SIZE * TILE_CENTRE_FRACTION,
    });

    // Likewise the rise: the mob that made it happen is the lord, but the sound
    // belongs to the skeletons coming out of the ground.
    if (this.skeletonSummons.riseSoundPending) {
      this.skeletonSummons.riseSoundPending = false;
      this.audio?.play('bones_rattling');
    }
    const gasShatter = this.clownGas.shatterSoundAt;
    if (gasShatter !== null) {
      this.clownGas.shatterSoundAt = null;
      // Two cues on one beat by design: the bottle breaking, and the cloud it
      // lets out. They are simultaneous in the fiction and in `ClownGasSystem`,
      // which spawns the shatter and the cloud on the same frame.
      const shatter = this.audio?.placedAt(gasShatter.x, gasShatter.y);
      shatter?.playRandom(['glass_break_1', 'glass_break_2', 'glass_break_3', 'glass_break_4']);
      shatter?.play('gas_cloud');
    }
    const knightBurst = this.knightMissiles.impactSoundAt;
    if (knightBurst !== null) {
      this.knightMissiles.impactSoundAt = null;
      this.audio?.playRandomAt(
        ['small_magic_impact_1', 'small_magic_impact_2', 'small_magic_impact_3'],
        knightBurst.x,
        knightBurst.y,
      );
    }

    if (
      this.levelDef.hasCollapseTimer === true &&
      this.levelTimerFrames > 0 &&
      !this.isLevelTimerPaused()
    ) {
      const framesBefore = this.levelTimerFrames;
      this.levelTimerFrames--;
      this.playLevelTimerCue(levelTimerCue(framesBefore, this.levelTimerFrames));
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
      // Nothing at the striker may land under the death screen or carry into the respawn.
      this.highStriker?.abandonAll();
      difficultyStats.recordDeath();
      this.gameStats.recordDeath();
      this.barriers.cancelConstruct();
      // The death screen stops the village's ticks, so a contract's work loop would play on under it.
      this.briarHollowKit?.contracts?.cancelWork();
      const deathCause = resolveDeathCause(
        this.human,
        this.cat,
        this.levelDef.hasCollapseTimer === true,
        this.levelTimerFrames,
      );
      this.bus.emit('playerDied', { fallen: this.fallenCrawler(), cause: deathCause });
      this.combat.deathScreen.activate(
        pickDeathExplanation(deathCause),
        respawnModeFor(respawnRouteFor(this.lastSave)),
      );
    }
  }

  /**
   * A safe room is a refuge from the floor's collapse as well as from its
   * mobs: standing in one to cook, craft or sort a bag must not cost the run
   * its clock. Keyed on the controlled character only, so parking the other
   * one inside while the active one explores does not stop the countdown.
   *
   * A visit to one of the floor's buildings stops the clock too, for all of
   * it: this scene is not updated while the party is indoors, and the scene
   * rebuilt at the door resumes from the frame the party walked in on. A
   * building under a dungeon floor is a puzzle, and the floor's collapse must
   * not punish taking one slowly.
   */
  private isLevelTimerPaused(): boolean {
    return this.safeRoom.isEntityInSafeRoom(this.active());
  }

  /** Frames left on this floor's collapse timer; 0 on floors without one. */
  get levelTimerRemainingFrames(): number {
    return this.levelTimerFrames;
  }

  private playLevelTimerCue(cue: LevelTimerCue | null): void {
    if (cue === 'final_minute_heartbeat') {
      this.audio?.play('level_timer_final_minute_heartbeat');
    } else if (cue === 'five_minute_warning') {
      this.audio?.play('level_timer_warning', { playbackRate: FIVE_MINUTE_WARNING_PLAYBACK_RATE });
    } else if (cue === 'ten_minute_warning') {
      this.audio?.play('level_timer_warning');
    }
  }

  /** Plays one of Dr. Moult's lines, cutting off whatever he was still saying. */
  private sayAsScientist(
    id: SoundId | null,
    at: { readonly x: number; readonly y: number } | null,
    opts?: PlayOptions,
  ): void {
    if (id === null) return;
    if (this.lastScientistVoice !== null) this.audio?.stopSound(this.lastScientistVoice);
    this.lastScientistVoice = id;
    if (at === null) this.audio?.play(id, opts);
    else this.audio?.playAt(id, at.x, at.y, opts, SCIENTIST_SPEECH_REACH);
  }

  /** Dr. Moult's footsteps are not ticked under the pause menu or the death screen, so they stop there. */
  private silenceScientistFootsteps(): void {
    if (SCIENTIST_FOOTSTEPS_LOOP !== null) this.audioScope?.stopLoop(SCIENTIST_FOOTSTEPS_LOOP);
  }

  /** His footsteps follow him down the hallway while he runs, louder the nearer he is. */
  private updateScientistFootsteps(): void {
    const scope = this.audioScope;
    const footsteps = SCIENTIST_FOOTSTEPS_LOOP;
    if (scope === null || footsteps === null) return;
    const endScreenShowing = this.levelCompleteScreen.isActive || this.runCompleteScreen.isActive;
    if (!this.spiderQuest.isScientistRunning || endScreenShowing) {
      scope.stopLoop(footsteps);
      return;
    }
    const feet = this.spiderQuest.scientistFeet;
    const listener = this.active();
    const distanceTiles = Math.hypot(feet.x - listener.x, feet.y - listener.y) / TILE_SIZE;
    scope.startLoop(footsteps);
    scope.setAmbientLoopVolume(
      footsteps.id,
      footsteps.volume * placedGain(distanceTiles, SCIENTIST_FOOTSTEPS_HEARING_TILES),
    );
  }

  private _processSpiderQuestSounds(): void {
    const voice = this.spiderQuest.scientistVoicePending;
    if (voice !== null) {
      this.spiderQuest.scientistVoicePending = null;
      this.sayAsScientist(spiderQuestCueSound(voice.cue, Math.random()), voice, {
        volume: SCIENTIST_SPEECH_VOLUME,
      });
    }
    this.updateScientistFootsteps();
    if (this.spiderQuest.machineryStartPending) {
      this.spiderQuest.machineryStartPending = false;
      this.audioScope?.startLoop(MACHINERY_LOOP);
    }
    if (this.spiderQuest.machineryStopPending) {
      this.spiderQuest.machineryStopPending = false;
      this.audioScope?.stopLoop(MACHINERY_LOOP);
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
      this.sayAsScientist('scientist_exclaiming_about_an_escape', null, {
        volume: SCIENTIST_SPEECH_VOLUME,
      });
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
      this.sayAsScientist('scientist_explaining_request', null, {
        volume: SCIENTIST_SPEECH_VOLUME,
      });
    }
    if (this.spiderQuest.keyboardHeroMusicReleasePending) {
      this.spiderQuest.keyboardHeroMusicReleasePending = false;
      this.releaseKeyboardHeroMusic();
    }
    if (this.spiderQuest.keyboardHeroMusicStartPending) {
      this.spiderQuest.keyboardHeroMusicStartPending = false;
      // Outranks everything, the player's own choice included: the song is
      // what the note chart is timed to.
      this.audioScope?.claimMusic({
        owner: 'keyboard_hero',
        layer: 'exclusive',
        selection: { kind: 'held', id: KEYBOARD_HERO_SONG },
      });
      this.audioScope?.startKeyboardHeroMusic();
    }
    if (this.spiderQuest.keyboardHeroMusicStopPending) {
      this.spiderQuest.keyboardHeroMusicStopPending = false;
      this.audioScope?.stopKeyboardHeroMusic();
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
    if (lab?.webTearSoundPending === true) {
      lab.webTearSoundPending = false;
      playDungeonCue(this.audio ?? null, 'cobwebTear', this.dungeonCuesPlayed);
    }
    if (lab?.cocoonSplatSoundPending === true) {
      lab.cocoonSplatSoundPending = false;
      this.audio?.play('splat_2');
    }
    if (this.spiderQuest.bossFightStartPending) {
      this.spiderQuest.bossFightStartPending = false;
      this.bossIntro.trigger(
        'grotesque_spider',
        'GROTESQUE SPIDER',
        worldPalette.bossIntro.spiderAccent,
      );
    }
    if (this.spiderQuest.bossMusicStartPending) {
      this.spiderQuest.bossMusicStartPending = false;
      this.releaseKeyboardHeroMusic();
      this.bus.emit('bossFightInitiated', { bossType: 'grotesque_spider' });
    }
    if (this.spiderQuest.bossMusicStopPending) {
      this.spiderQuest.bossMusicStopPending = false;
      this.audioScope?.releaseMusic('boss');
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
      isPaused: () => this.gameOver || this.menus.pauseScreen.isOpen || this.aiMenuOpen(),
      isInSafeRoom: () => this.safeRoom.isEntityInSafeRoom(this.active()),
      postToast: (text, opts) => this.menus.toasts.post(text, opts),
      getAwards: () => this.awards,
      getAudio: () => this.audio,
      getAudioScope: () => this.audioScope,
      getLevelTimer: () => this.aiLevelTimer(),
      getFloorKey: () => this.aiFloorKey(),
      spotlight: (point, frames) => aiCameraSpotlight.start(point, frames),
      getInteractions: () => this.aiInteractions,
    };
  }

  /** The collapse clock as the AI's timer action reads and moves it; null on an untimed floor. */
  private aiLevelTimer(): AILevelTimer | null {
    if (this.levelDef.hasCollapseTimer !== true) return null;
    return {
      remainingFrames: this.levelTimerFrames,
      limitFrames: this.levelDef.collapseTimeLimitFrames ?? this.TUTORIAL_TIME_LIMIT_FRAMES,
      setRemainingFrames: (frames) => {
        this.levelTimerFrames = Math.max(0, Math.round(frames));
      },
    };
  }

  /** A menu or dialog the AI must not act over, other than the pause screen. */
  private aiMenuOpen(): boolean {
    return (
      this.stairwell.menuOpen ||
      (this.building?.menuOpen ?? false) ||
      this.defendQuest.isDialogOpen ||
      this.murderQuest.isDialogOpen ||
      this.anchorQuest.isDialogOpen ||
      this.citizenDialogTarget !== null ||
      this.signDialogTarget !== null ||
      this.chat.isOpen ||
      this.cutscenes.isActive ||
      // The pause screen halts the world too, but it is `isPaused`, not a menu.
      (this.ui.worldHalted() && !this.menus.pauseScreen.isOpen)
    );
  }

  /** The crawler whose death or bleed-out ended the run, or null for a party still standing. */
  private fallenCrawler(): HumanPlayer | CatPlayer | null {
    const active = this.human.isActive ? this.human : this.cat;
    const inactive = this.human.isActive ? this.cat : this.human;
    if (!active.isAlive) return active;
    if (inactive.isKnockedOut || !inactive.isAlive) return inactive;
    return null;
  }

  private createAIContextSource(): AIContextSource {
    const activeCrawler = (): HumanPlayer | CatPlayer =>
      this.human.isActive ? this.human : this.cat;
    return {
      petNames: this.petNames,
      crawlerNameOf: (player) =>
        player === this.human
          ? crawlerName('human')
          : player === this.cat
            ? crawlerName('cat')
            : null,
      isPartyInSafeRoom: () => this.safeRoom.isEntityInSafeRoom(activeCrawler()),
      isCrawlerInSafeRoom: (crawler) =>
        this.safeRoom.isEntityInSafeRoom(crawler === crawlerName('human') ? this.human : this.cat),
      readSession: () => {
        const levelDef = this.levelDef;
        const session: SessionInput = {
          floorNumber: levelDef.floorNumber,
          levelId: levelDef.id,
          floorName: levelDef.name,
          levelTimerRunning: levelDef.hasCollapseTimer === true && !this.isLevelTimerPaused(),
          difficulty: DIFFICULTY_LABELS[settings.difficulty],
          secondsPlayed: Math.floor(this.gameStats.framesPlayed / FRAMES_PER_SECOND),
          deaths: this.gameStats.deaths,
          activeQuests: this.collectTrackerEntries()
            .filter((entry) => entry.status === 'active')
            .map((entry) => ({ id: entry.id, name: entry.name, objective: entry.objective })),
          companions: this.aiCompanionNames(),
          indoors: false,
        };
        if (levelDef.hasCollapseTimer === true) {
          session.levelTimerSeconds = Math.ceil(this.levelTimerFrames / FRAMES_PER_SECOND);
        }
        const roomCount = this.gameMap.roomBounds.length;
        if (roomCount > 0) session.roomCount = roomCount;
        return session;
      },
      readLive: () => {
        const active = activeCrawler();
        const menuOpen = this.aiMenuOpen();
        return {
          activeCrawler: crawlerName(this.human.isActive ? 'human' : 'cat'),
          crawlers: {
            human: readCrawler(this.human, crawlerName('human')),
            cat: readCrawler(this.cat, crawlerName('cat')),
          },
          location: this.aiLocation(active),
          nearbyMobs: readNearbyMobs(this.world.roster.mobs, active, this.petNames),
          combatInProgress: this.combatCooldownFrames > 0,
          bossFightActive: this.bossRoom.anyLocked,
          isPaused: this.gameOver || this.menus.pauseScreen.isOpen || menuOpen,
          menuOpen,
        };
      },
    };
  }

  private aiCompanionNames(): string[] {
    const names: string[] = [];
    if (this.deinonychusSystem.deinonychus !== null) {
      names.push(petWords(this.petNames, 'deinonychus').described);
    }
    const hireling = this.mercenarySystem.activeMerc;
    if (hireling !== null) names.push(mobLabel(hireling, this.petNames));
    if (this.attackCowSystem.standingCow !== null) {
      names.push(petWords(this.petNames, 'attackCow').described);
    }
    return names;
  }

  /** Where the active crawler is, in the words the AI uses. */
  private aiLocation(active: HumanPlayer | CatPlayer): SemanticLocation {
    const tile = tileOf(active);
    const roomIndex = this.gameMap.roomIndexAt(tile.x, tile.y);
    const inRoom = roomIndex >= 0;
    const base = { inSafeRoom: false, inBossArena: false, ...(inRoom ? { roomIndex } : {}) };
    if (this.safeRoom.isEntityInSafeRoom(active)) {
      return { ...base, kind: 'safeRoom', label: 'safe room', inSafeRoom: true };
    }
    if (this.bossRoom.isEntityInAnyBossRoom(active)) {
      const label = this.bossRoom.anyLocked ? 'boss arena, sealed in mid-fight' : 'boss arena';
      return { ...base, kind: 'bossArena', label, inBossArena: true };
    }
    const stairwell = this.stairwell.nearestStairwellCenter(active);
    const stairwellTiles =
      stairwell === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(stairwell.x - active.x, stairwell.y - active.y) / TILE_SIZE;
    if (stairwellTiles <= AI_AT_STAIRWELL_TILES) {
      return { ...base, kind: 'stairwell', label: 'at the stairwell' };
    }
    const nearStairwell = stairwellTiles <= AI_NEAR_STAIRWELL_TILES ? ' near the stairwell' : '';
    if (this.levelDef.isOverworld === true) {
      const village = this.gameMap.briarHollow;
      const inVillage = village !== null && rectContains(village.palisadeBounds, tile.x, tile.y);
      return {
        ...base,
        kind: 'overworld',
        label: inVillage ? 'Briar Hollow' : `the overworld${nearStairwell}`,
      };
    }
    if (inRoom) return { ...base, kind: 'room', label: `dungeon room${nearStairwell}` };
    return { ...base, kind: 'corridor', label: `dark corridor${nearStairwell}` };
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

  /**
   * After any switch of crawler this frame, and heard from whoever is active
   * now: CombatKit only moves the listener later in the frame, and a gate
   * unlocked by the switch itself would otherwise be heard from the crawler
   * the player just left.
   */
  private playTutorialGateCues(tutorial: TutorialController): void {
    const listener = this.active();
    this.audio?.setListenerToCrawler(listener);
    for (const raised of tutorial.drainGateCues()) {
      const source = tutorialCueSource(raised, listener);
      this.audio?.playRandomAt(TUTORIAL_CUES[raised.cue], source.x, source.y);
    }
  }

  private camera(): { x: number; y: number } {
    const tutorialCam = this.tutorial?.cameraOverride;
    if (tutorialCam !== null && tutorialCam !== undefined) return tutorialCam;

    const player = this.active();
    const { w: mapPxW, h: mapPxH } = this.mapExtentsPx();

    const targetOverride = this.spiderQuest.cameraTargetOverride ?? aiCameraSpotlight.focus();
    const targetX = targetOverride !== null ? targetOverride.x : player.x;
    const targetY = targetOverride !== null ? targetOverride.y : player.y;

    const camX = targetX + TILE_SIZE / 2 - viewportWidth() / 2;
    const camY = targetY + TILE_SIZE / 2 - viewportHeight() / 2;

    const shakeOffset = this.spiderQuest.cameraOffset;
    const seismicStompShake = this.combat.seismicStompFx.cameraOffset;
    const gymShake = this.gymRoom.cameraOffset;
    const villageShake = this.briarHollowKit?.cameraOffset ?? { x: 0, y: 0 };
    const blastShake = this.explosionShake.cameraOffset;
    // Applied after the clamp so the sway can drift past the map edge rather than
    // being flattened to nothing whenever the camera is already against a border.
    const sway = intoxicationCameraOffset(player, frameTime);
    return {
      x:
        clamp(camX, 0, mapPxW - viewportWidth()) +
        shakeOffset.x +
        sway.x +
        seismicStompShake.x +
        gymShake.x +
        villageShake.x +
        blastShake.x,
      y:
        clamp(camY, 0, mapPxH - viewportHeight()) +
        shakeOffset.y +
        sway.y +
        seismicStompShake.y +
        gymShake.y +
        villageShake.y +
        blastShake.y,
    };
  }

  private _makeAbilityReward(abilityId: AbilityId): GrantedReward {
    const def = this.abilityManager.getDef(abilityId);
    const name = def?.name ?? abilityId;
    const firstPerk = def?.perks.find((p) => p.level === 1);
    const description =
      firstPerk === undefined
        ? 'A new ability has been granted!'
        : perkText(firstPerk.description, this.petNames);
    const renderIcon: GrantedReward['renderIcon'] =
      def !== null ? (ctx, rect) => def.renderIcon(ctx, rect, 1) : drawUnknownAbilityIcon;
    return { kind: 'ability', name, description, renderIcon };
  }

  /**
   * Where the one the human crawler is in conversation with stands, while a conversation
   * with somebody is open; null otherwise. Only the conversations whose
   * speaker this scene can place — a townsperson, Dave, the defend-quest
   * giver.
   */
  private humanTalkSpeaker(): Pt | null {
    const citizen = this.citizenDialogTarget;
    if (citizen !== null) return citizen;
    const dave = this.dave.speakingPosition;
    if (dave !== null) return dave;
    if (this.defendQuest.isDialogOpen) return this.defendQuest.questNPC;
    const villager = this.briarHollowKit?.humanTalkSpeaker() ?? null;
    if (villager !== null) return villager;
    return null;
  }

  /** Whether the party already has `id`, carried or still on the ground: gear is one of a kind per party. */
  private readonly partyOwnsGear = (id: GearId): boolean =>
    partyOwnsGear([this.human, this.cat], id) ||
    this.destruction.loot.holds(id) ||
    this.treasureChests.holds(id);

  /**
   * This floor's answer for an opened chest: the tutorial's scripted first
   * chest in place of its loot, and the cat's reward once its card is put
   * away.
   */
  private chestReward(chest: TreasureChest, payStandard: () => ChestLootSplit | null): ChestReward {
    const tutorial = this.tutorial;
    const tutorialSplit = tutorial?.openTreasureChest() ?? null;
    if (tutorial !== null && tutorialSplit !== null) {
      return {
        split: tutorialSplit,
        onDismissed: () => {
          tutorial.onCatRewardDialogDismissed(this.cat);
          this.bus.emit('rewardGranted', {
            rewards: [this._makeAbilityReward('magic_missile')],
          });
        },
      };
    }

    return { split: payStandard() };
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

  /**
   * Flies what a dismissed quest-complete screen announced to the HUD, now
   * that the HUD is visible again: its coins to the purse and its bag items
   * to the bag.
   */
  private flyQuestRewards(spec: QuestRewardSpec): void {
    for (const section of spec.sections) {
      if (section.kind === 'coins') this.flyQuestCoins(section.amount);
      if (section.kind !== 'items') continue;
      for (const item of section.items) {
        if (item.itemId !== undefined) this.flyQuestItem(item.itemId);
      }
    }
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
