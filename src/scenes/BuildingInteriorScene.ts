import { MONGO_EXPLAINER_FOCUS_ID } from '../ui/MongoExplainer';
import { firstResidentMarker, type ResidentQuestHook } from '../systems/residentQuestHooks';
import { WendellBlueprintsHook } from '../systems/briarHollow/blueprints/WendellBlueprintsHook';
import { forwardQuestItemEvictions } from '../systems/questItemEvictions';
import { displayHp } from '../core/crawlerFormulas';
import type { XpDiminishingTier } from '../levels/xpDiminishing';
import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { keybindings } from '../core/Keybindings';
import { TILE_SIZE } from '../core/constants';
import { GameMap, TOWER_FLOOR_COUNT, TOWER_INTERIOR_W, type InteriorVariant } from '../map/GameMap';
import { setFloorArtSeed } from '../map/ground/floorArtSeed';
import { requestGroundSheets } from '../map/ground/runtimeGroundSheets';
import { requestEnvironmentSheetsForGroups } from '../sprites/sheets/environmentSheets';
import { BRAZIER, FIREPLACE } from '../map/tileTypes';
import { PlayerManager } from '../core/PlayerManager';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { ShopSystem, GENERAL_STORE_CONFIG } from '../systems/ShopSystem';
import { MobileHUDSystem, type Rect } from '../systems/MobileHUDSystem';
import { constructionUnlocked } from '../core/villageUnlocks';
import { platform } from '../core/Platform';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { TowerStairSystem } from '../systems/TowerStairSystem';
import {
  readMovement,
  applyMovement,
  triggerPlayerAttack,
  KNOCKOUT_TIMEOUT_FRAMES,
} from '../systems/GameLoopPhases';
import {
  downedCompanionArrowCandidate,
  renderKnockedOutUI,
  updateKnockoutState,
} from '../systems/KnockoutRevive';
import { drawTopArrowCandidate, type ArrowCandidate } from '../ui/WorldArrow';
import { GameplayScene } from './GameplayScene';
import { hudCoinCounterScreenPos } from '../ui/HUD';
import { pointInRect } from '../utils';
import { AchievementManager } from '../core/AchievementManager';
import { AchievementUISystem } from '../systems/AchievementUISystem';
import type { JournalProgress } from '../core/JournalProgress';
import { isOutstanding, type TrackerEntry } from '../systems/questTracker';
import { GameStats, bindRunStats } from '../core/GameStats';
import { MENU_TAP_DURATION_MS, MENU_TAP_MAX_DISTANCE, type PauseMenu } from '../ui/PauseMenu';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import { HumanTalkDriver } from '../creatures/humanGestures';
import type { CatPlayer } from '../creatures/CatPlayer';
import { AbilityManager } from '../core/AbilityManager';
import type { AudioManager } from '../audio/AudioManager';
import { Conversation } from '../dialog/Conversation';
import {
  CLUB_MUSIC_TRACKS,
  DEFAULT_BUILDING_MUSIC_TRACKS,
  TAVERN_MUSIC_TRACKS,
  TEMPLE_MUSIC_TRACKS,
  TOWER_MUSIC_TRACKS,
  type SoundId,
} from '../audio/sounds';
import { sfxGroupsForBuildingEntry } from '../audio/sfxGroups';
import { prewarmGroups } from '../core/SpriteLoader';
import { aiAdapter } from '../ai/AIAdapter';
import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay } from '../ui/Box';
import { addButton, beginMenuFocus, endMenuFocus, menuFocusContextId } from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import { EventBus } from '../core/EventBus';
import { CrawlerBarkSystem } from '../systems/CrawlerBarkSystem';
import { barkWhenBlueprintsItemEvicted } from '../systems/briarHollow/blueprints/blueprintsEvictionBark';
import { CRAWLER_BARKS, barkTexts } from '../dialog/scripts/crawlerBarks';
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { TacticsNoticeSystem } from '../systems/TacticsNoticeSystem';
import type { TacticsTrait } from '../creatures/tactics/tacticsTraits';
import type { RespawnMode } from '../ui/DeathScreen';
import { causeFromDamageSource } from '../systems/DeathCauseSystem';
import { pickDeathExplanation } from '../ui/DeathExplanations';
import { resolveSkillBookPrompt } from '../systems/skillBookUse';
import type { Mob } from '../creatures/Mob';
import type { Townsperson } from '../creatures/Townsperson';
import { CITIZEN_TALK_RADIUS_TILES } from '../creatures/townInteraction';
import { safeRoomPressLeavesSpeaker, safeRoomSpeakerFor } from '../systems/safeRoomSpeaker';
import { prewarmAndPinCitizenTalk } from '../creatures/citizenFigure';
import {
  BIG_TOP_BUILDING_NAME,
  isCircusResolvedStage,
  type CircusQuestProgress,
} from '../core/CircusQuestProgress';
import { adviceObjective, MordecaiAdvisor, type AdviceSnapshot } from '../systems/mordecaiAdvice';
import type { MurderQuestProgress, MurderQuestStage } from '../core/MurderQuestProgress';
import { createDoomsdayProgress, type DoomsdayProgress } from '../core/DoomsdayProgress';
import { createClubMembership, type ClubMembership } from '../core/ClubMembership';
import type { MarketStock } from '../systems/market/MarketStock';
import { FollowerMenu } from '../systems/FollowerMenu';
import {
  CompanionSystem,
  createCompanionStanceState,
  type CompanionStanceState,
} from '../systems/CompanionSystem';
import {
  createMercenaryRoster,
  type HiredMercenary,
  type MercenaryRoster,
} from '../core/MercenaryRoster';
import { createGodModeState, type GodModeState } from '../core/GodMode';
import { ITEM_DEF, isWearable, type InventoryItem, type ItemId } from '../core/ItemDefs';
import { DesperadoClubSystem } from '../systems/DesperadoClubSystem';
import { InteriorOccupantSystem } from '../systems/InteriorOccupantSystem';
import { InteriorReadableSystem } from '../systems/InteriorReadableSystem';
import {
  InteriorPropInteractionSystem,
  TownMemoryInteriorPayoutRecord,
} from '../systems/InteriorPropInteractionSystem';
import { TownInteriorPropDestructionSystem } from '../systems/TownInteriorPropDestructionSystem';
import { InteriorBreakReactionBarks } from '../systems/InteriorBreakReactionBarks';
import { AmbientSoundSystem, type AmbientEmitter } from '../systems/AmbientSoundSystem';
import {
  buildCitizenConversation,
  citizenSpecies,
  isTownInDanger,
  type TownDialogContext,
} from '../systems/townDialog';
import {
  buildResidentConversation,
  residentById,
  residentHost,
  type ResidentDef,
  type ResidentHost,
  type ResidentId,
} from '../systems/townResidents';
import { residentLinesFor } from '../dialog/scripts/residents';
import { buildApothecaryMenu, serveRemedy } from '../systems/townApothecary';
import { buildSmithyMenu, sharpenEdges } from '../systems/townSmithy';
import { buildInnMenu, serveInn } from '../systems/townInn';
import { isInnRoomKey } from '../systems/townInnRooms';
import {
  buildCartwrightMenu,
  buildMillerMenu,
  buildPlumblineFarmMenu,
  sellCartwrightGoods,
  serveMillerGoods,
  servePlumblineFarmRest,
} from '../systems/townHomesteads';
import { buildTavernMenu, serveDrinkAt } from '../systems/townPub';
import { buildBlessingMenu, grantBlessing } from '../systems/townTemple';
import { buildTattooMenu, inkTattoo } from '../systems/townTattooParlor';
import { buildArmouryMenu, issueArmour } from '../systems/townArmoury';
import { buildDrillYardMenu, runDrill } from '../systems/townDrillYard';
import {
  PricedMenuPanel,
  type PricedOption,
  type PricedPurchaseHandler,
  type SellConfig,
} from '../ui/PricedMenuPanel';
import {
  ARMOURY_PRICING,
  APOTHECARY_PRICING,
  MERCHANT_STALL_PRICING,
  FARMER_PRICING,
} from '../systems/market/shopProfiles';
import type { ShopPricingProfile } from '../systems/market/shopPricing';
import {
  setButtonMouseState,
  setButtonAudio,
  notifyButtonClick,
  clearButtonMouseState,
} from '../ui/Button';
import { interiorServiceForRole, interiorServicesFor } from '../systems/townServices';
import type { TownRole } from '../sprites/person/PersonAppearance';
import {
  createTownMemory,
  noteResidentTalk,
  residentTalkCount,
  type TownMemory,
} from '../core/TownMemory';
import { createPartyCraftsState, type PartyCraftsState } from '../core/partyCrafts';
import { createBriarHollowState, type BriarHollowState } from '../core/briarHollowState';
import {
  plumblineFarmExamineLine,
  PlumblineFarmRoomSync,
} from '../systems/briarHollow/blueprints/plumblineFarmRoom';
import { PLUMBLINE_FARM_NAME } from '../systems/briarHollow/blueprints/blueprintsProgress';
import { partyCount } from '../core/partyResources';
import { indoorsConstructionSource } from '../systems/briarHollow/ConstructionSystem';
import { FortuneTellerPanel, HEDGE_WITCH } from '../ui/FortuneTellerPanel';
import { ReadablePanel } from '../ui/ReadablePanel';
import {
  drawInteractionPrompt,
  interactionPromptsDrawnThisFrame,
  setInteractionPromptsSuppressed,
} from '../ui/InteractionPrompt';
import { MercenarySystem } from '../systems/MercenarySystem';
import { RockThrowSystem } from '../systems/RockThrowSystem';
import { HirelingBoltSystem } from '../systems/HirelingBoltSystem';
import { playHirelingProjectileCues } from '../systems/hirelingProjectileCues';
import { SpellSystem } from '../systems/SpellSystem';
import {
  MAZE_CAT_SPAWN_TILE,
  MAZE_HUMAN_SPAWN_TILE,
  planBigTopMaze,
  type BigTopMazePlan,
} from '../map/bigTopMazeLayout';
import { BIG_TOP_AMBIENT_BED } from '../systems/bigTop/bigTopSoundCues';
import { findPartyArrivalTiles, findNearbyWalkableTile } from '../map/findWalkableTile';
import { GrimaldiVine } from '../creatures/GrimaldiVine';
import { MobRoster, type SceneWorld } from '../systems/kits/SceneWorld';
import { CombatKit } from '../systems/kits/CombatKit';
import { SkillPointReminderSystem } from '../systems/SkillPointReminderSystem';
import { interiorHostilesFor, noteRoomCleared } from '../systems/interiorHostiles';
import { partyLevelOf } from '../levels/spawner';
import { AnchorInteriorSystem, SKY_TEMPLE_NAME } from '../systems/AnchorInteriorSystem';
import { createAnchorQuestProgress, type AnchorQuestProgress } from '../core/AnchorQuestProgress';
import { MenusKit } from '../systems/kits/MenusKit';
import { HOTBAR_REFUSAL_MESSAGE } from '../ui/InventoryInteraction';
import { ChatKit } from '../systems/kits/ChatKit';
import {
  activateHotbarSlot,
  drinkAnyHealthPotion,
  releaseChargedDynamite,
  type HotbarHost,
} from '../systems/kits/hotbarActions';
import { GameplayInputHandler } from '../systems/GameplayInputHandler';
import {
  advanceFocusedOverlay,
  auditOverlayFocus,
  focusedOverlay,
  keyboardSuppressed,
  worldHalted,
  type OverlayInputClaim,
} from '../systems/kits/OverlayClaims';
import { DestructionKit } from '../systems/kits/DestructionKit';
import { RewardFlySystem } from '../systems/RewardFlySystem';
import { playRewardLandingCues } from '../systems/rewardFlyAudio';
import type { PendingLoot } from '../systems/LootSystem';
import { BigTopMazeSystem } from '../systems/BigTopMazeSystem';
import { restartBigTopTent } from '../systems/bigTop/bigTopTent';
import type { GroundHazardSource } from '../systems/GroundHazardSource';
import type { Difficulty } from '../core/difficultyProfiles';
import { CultHideoutSystem } from '../systems/CultHideoutSystem';
import { QuillConfrontationSystem } from '../systems/QuillConfrontationSystem';
import { SoulCrystalSystem } from '../systems/SoulCrystalSystem';
import { SkeletonProjectileSystem } from '../systems/SkeletonProjectileSystem';
import { SkeletonSummonSystem } from '../systems/SkeletonSummonSystem';
import { FairySystem } from '../systems/FairySystem';
import { playFairySystemCues } from '../systems/fairyAudioCues';
import type { SystemContext } from '../systems/GameSystem';
import type { InteriorFigure } from '../core/InteriorFigure';
import {
  drawTownInteriorGroundProps,
  townInteriorPropFigures,
} from '../systems/townInteriorPropFigures';
import { shouldShowInteractionPrompts } from '../systems/interactionPromptGate';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import {
  ClearViewMemo,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  type ScreenRect,
  type WorldRect,
} from './interiorCamera';
import {
  drawInteriorNameplate,
  interiorHudLayout,
  interiorRoomTitle,
  interiorHudOccluders,
  type InteriorHudLayout,
  type InteriorHudLayoutInput,
} from './interiorHudLayout';
import { cameraWorldView, setVisibleWorldView } from '../core/visibleWorldView';
import { createMongoPetState, type MongoPetState } from '../core/MongoPetState';
import { settings } from '../core/Settings';
import { awardFirstHundred, bindAbilityLevelUps } from '../systems/abilityLevelUps';
import { bindCraftLevelUps } from '../systems/craftLevelUps';
import { MongoSystem, mongoXpFraction } from '../systems/MongoSystem';
import {
  carryCompanions,
  NO_INTERIOR_COMPANIONS,
  type CarriedCompanion,
  type InteriorCompanionArrival,
  type InteriorCompanionDeparture,
} from '../systems/companionCarry';
import { getMongoStats } from '../abilities/mongo';

/** Parks the cursor outside any button until a real mouse move reports a position. */
const OFFSCREEN_CURSOR_POS = -9999;

/** Every hearth and brazier in a room emits its own fire crackle at this reach. */
const HEARTH_AMBIENT_RADIUS_TILES = 7;
const HEARTH_AMBIENT_VOLUME = 0.4;
/** Volume of a room-wide crowd/shop bed, quiet enough to sit under dialog and music. */
const BAR_CROWD_AMBIENT_VOLUME = 0.35;
const MAGIC_SHOP_AMBIENT_VOLUME = 0.3;
/** Prompt shown over an occupant who has nothing special to offer. */
const TALK_PROMPT_LABEL = 'Talk';
/** Prompt shown over a ledger, letter or board sitting on the furniture. */
const READ_PROMPT_LABEL = 'Read';

/**
 * Frames a freshly-opened interior modal ignores the interact key entirely.
 *
 * The same key opens these panels and closes them, and `InputManager` only
 * tracks whether a key is currently *down*. Opening a panel releases the key
 * that opened it, so a still-held key reads as released — until the browser's
 * auto-repeat puts it back and the panel shuts itself the moment it appeared.
 *
 * The window has to outlast that repeat delay, which is an OS setting and can be
 * as long as a second, so this is deliberately generous: a player who just
 * opened a shop or a ledger is not reaching for the key again inside a second,
 * and `modalCloseArmed` takes over as soon as it expires.
 */
const MODAL_REOPEN_GRACE_FRAMES = 60;

/** Rooms that hum with their own constant ambience regardless of where you stand. */
const INTERIOR_AMBIENT_BEDS = new Map<string, { soundId: SoundId; volume: number }>([
  ['The Sunken Stump Pub', { soundId: 'ambient_bar_crowd', volume: BAR_CROWD_AMBIENT_VOLUME }],
  ['The Horned Flagon', { soundId: 'ambient_bar_crowd', volume: BAR_CROWD_AMBIENT_VOLUME }],
  ['The Sleeping Cat Inn', { soundId: 'ambient_bar_crowd', volume: BAR_CROWD_AMBIENT_VOLUME }],
  ['The Desperado Club', { soundId: 'ambient_bar_crowd', volume: BAR_CROWD_AMBIENT_VOLUME }],
  ['Herb & Remedy', { soundId: 'ambient_magic_shop', volume: MAGIC_SHOP_AMBIENT_VOLUME }],
  // No entry for The Rusty Anvil on purpose: its braziers already emit the
  // forge crackle through `buildAmbientEmitters`, and a room-wide bed on top of
  // them would only double the same loop against itself.
]);

/** The town's drinking houses, which share the rotating tavern soundtrack. */
const TAVERN_BUILDING_NAMES: ReadonlySet<string> = new Set([
  'The Sunken Stump Pub',
  'The Horned Flagon',
  'The Sleeping Cat Inn',
]);

const MAX_TOWER_FLOOR_INDEX = TOWER_FLOOR_COUNT - 1;
const DEFAULT_MAP_FALLBACK_WIDTH = 18;
/** The companion cat's missile is a constant patter in a fight; held under the swings it covers. */
const CAT_MISSILE_VOLUME = 0.5;
/** Quieter than the siege cue it's borrowed from — a counter bell, not an alarm. */
const SHOP_BELL_VOLUME = 0.5;
const RECENT_EVENTS_LIMIT = 5;
const TILE_CENTER_RATIO = 0.5;
const SAFE_ROOM_PULSE_BASE = 0.6;
const SAFE_ROOM_PULSE_PERIOD_MS = 600;
const PULSE_SWING = 0.3;
/**
 * How far the active crawler can see indoors, for the pet's off-screen marker.
 * Interiors are lit end to end, so only the viewport edge can hide him.
 */
const INTERIOR_SIGHT_RADIUS_PX = Number.POSITIVE_INFINITY;
/**
 * The Build button's first-sighting pulse belongs to the village, which
 * starts it the first time the button appears outdoors; indoors it never pulses.
 */
const NO_BUILD_BUTTON_PULSE = 0;
const EXIT_HINT_PULSE_PERIOD_MS = 500;
const EXIT_ARROW_Y_OFFSET = 15;
const EXIT_MENU_TITLE_Y = 22;
const EXIT_MENU_QUESTION_Y = 58;
const EXIT_MENU_HINT_Y = 79;
const EXIT_BTN_Y_OFFSET = 110;
const EXIT_BTN_GAP = 8;
const EXIT_MENU_OVERLAY_ALPHA = 0.55;
const EXIT_MENU_PANEL_WIDTH = 340;
const EXIT_MENU_PANEL_HEIGHT = 190;
const EXIT_MENU_TITLE_SIZE = 18;
const EXIT_MENU_QUESTION_SIZE = 13;
const EXIT_MENU_HINT_SIZE = 11;
const EXIT_MENU_BUTTON_WIDTH = 120;
const EXIT_MENU_BUTTON_HEIGHT = 42;
const EXIT_MENU_BUTTON_TEXT_SIZE = 14;
const EXIT_MENU_BG_COLOR = '#0d1a09';
const EXIT_MENU_BORDER_COLOR = '#6aaa44';
const EXIT_MENU_BORDER_WIDTH = 2;
const EXIT_MENU_BUTTON_BORDER_WIDTH = 1.5;
const EXIT_MENU_LEAVE_BG_COLOR = '#1a4d0d';
const EXIT_MENU_LEAVE_TEXT_COLOR = '#d4edaa';
const EXIT_MENU_STAY_BG_COLOR = '#1e293b';
const EXIT_MENU_STAY_BORDER_COLOR = '#475569';
const EXIT_MENU_STAY_TEXT_COLOR = '#94a3b8';
const EXIT_MENU_HINT_TEXT_COLOR = '#64748b';
/** Shown when the party falls indoors to something no quest encounter owns. */
const INTERIOR_DEFEAT_MESSAGE = 'The building kept what was left of you.';
/** Fraction of max HP both players are revived to after falling in an interior fight. */
const INTERIOR_REVIVE_HP_FRACTION = 0.5;
/** Single-room buildings, and the storey a tower is entered on. */
const GROUND_FLOOR_INDEX = 0;
/** The Quill confrontation happens in the magistrate's office on the tower's top floor. */
const TOWER_CONFRONTATION_FLOOR = 3;
/** Offset from a stair tile's corner to its centre, as a fraction of a tile. */
const STAIR_TILE_CENTRE = 0.5;
/**
 * Quest stages that put the magistrate's office on screen.
 *
 * Wider than the stage that starts the Quill fight: the room owns Featherfall's
 * body as much as it owns the fights, and it has to be standing there before
 * the first of them, between the two, and after the last — including on a
 * revisit once the questline is closed.
 */
const TOWER_CONFRONTATION_STAGES: ReadonlyArray<MurderQuestStage> = [
  'confrontation',
  'quill_slain',
  'lich_slain',
  'complete',
];
/** Fade-in for an interior's own music when the building is entered. */
const INTERIOR_MUSIC_FADE_IN_MS = 800;
/** The cured vine's own tile hugs the south face of the pole cluster he wraps. */
const CURED_GRIMALDI_POLE_SOUTH_OFFSET = 1;
const GRIMALDI_TILE_CENTRE = 0.5;
const CURED_GRIMALDI_SEARCH_RADIUS_TILES = 4;

/** A quest encounter that runs inside a building (the Big Top maze, cult hideout, tower fight). */
interface InteriorEncounter {
  update(ctx: SystemContext): void;
  renderUI(ctx: CanvasRenderingContext2D): void;
  /**
   * World-space furniture the encounter owns — props that belong to the room
   * rather than to any creature in it, drawn under the figures so a crawler
   * crossing the room passes in front of them.
   */
  renderWorld?(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void;
  /**
   * World-space hazards the encounter owns, drawn *after* the sorted pass — a
   * wall of fire is something a crawler stands inside, not behind.
   */
  renderEffects?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  /**
   * The party has walked off the storey this encounter lives on. Anything the
   * encounter is holding that only its own update can release — a scripted
   * slide, an input lock — has to be let go of here, because that update stops
   * running the moment the floor changes.
   */
  leaveFloor?(ctx: SystemContext): void;
  /**
   * Teardown for anything the encounter owns that outlives its own mobs — a
   * boss phase driver holding the creature's body, hazards it published to the
   * companion, waves and orbs still in the air.
   */
  dispose?(): void;
  /** Death-screen message when the players fall during this encounter. */
  readonly defeatMessage: string;
}

/**
 * One storey of an interior, with everything that is a property of *that map*.
 *
 * Single-room buildings have exactly one; a tower has one per floor. Kept per
 * floor rather than per scene because each member is bound to a map at
 * construction — a roster ticked against the wrong floor's grid would run the
 * top floor's fight while the player stands on the ground floor.
 */
interface InteriorFloor {
  readonly world: SceneWorld;
  readonly combat: CombatKit;
  readonly destruction: DestructionKit;
  /**
   * A caster's shots and its raised escort, per storey for the same reason the
   * roster is: both are bound to one map at construction, and a bolt in flight
   * on the floor below is not something the floor above should be advancing.
   */
  readonly skeletonShots: SkeletonProjectileSystem;
  readonly skeletonSummons: SkeletonSummonSystem;
  /**
   * A boss fought indoors on the hardest difficulty brings a healing fairy, and
   * its heals and its death wave are drawn and resolved by this — per storey,
   * because it reads the storey's roster.
   */
  readonly fairies: FairySystem;
  /** A golem hire's boulders, per storey because each flies over one storey's map. */
  readonly rockThrows: RockThrowSystem;
  /** A water mage hire's bolts and waves, per storey for the same reason. */
  readonly hirelingShots: HirelingBoltSystem;
}

/**
 * The overworld's Quest Journal, handed through the door.
 *
 * Every quest source it lists is an overworld system that stays behind, so
 * the lines are asked of the overworld rather than rebuilt here; a pin set
 * indoors lands in the same `progress` the overworld follows once the party
 * walks back out.
 */
export interface InteriorJournalSource {
  /** This frame's lines, rebuilt from the overworld's quest systems on each call. */
  readonly entries: () => readonly TrackerEntry[];
  readonly progress: JournalProgress;
}

/**
 * Everything an interior needs to know about the circus questline, in one
 * parameter.
 *
 * Grouped rather than added as another positional argument to an already long
 * constructor, and grouped *here* rather than anywhere else because the two
 * fields are read together: Mordecai's floor-3 advice needs both whether the
 * circus is done and where it is.
 */
export interface BuildingInteriorCircusContext {
  readonly progress: CircusQuestProgress;
  /**
   * The circus's centre in **overworld** tile coordinates.
   *
   * An interior builds its own `GameMap` with its own origin, so nothing inside
   * this scene can compute an overworld bearing from its own grid — the door the
   * player came through is the only position that exists in both spaces.
   */
  readonly overworldCentre: { x: number; y: number } | undefined;
  /**
   * The overworld's `GameMap.worldSeed`. The interior's own map is seeded
   * apart from it, and the tent's hall of mirrors deals one board per world.
   */
  readonly worldSeed: number;
}

/** Every enterable building stands on the level-3 overworld. */
const OVERWORLD_FLOOR_NUMBER = 3;

/**
 * Which shape this room is built in.
 *
 * The Big Top is the only building with more than one, and only for the length
 * of the circus questline's final act: at `bigtop_ready` the tent is the trap
 * maze, and at every other enterable stage it is the calm ring the questline
 * leaves behind.
 */
function interiorVariantFor(
  buildingName: string,
  circus: BuildingInteriorCircusContext | undefined,
): InteriorVariant {
  const isMaze =
    buildingName === BIG_TOP_BUILDING_NAME && circus?.progress.stage === 'bigtop_ready';
  if (!isMaze) return 'default';
  // Dealt before the room exists: the hall's tiles, its floor marks and its
  // stage lights are all built from the board, once.
  return { kind: 'bigtop_maze', plan: planBigTopMaze(circus.worldSeed, settings.difficulty) };
}

export class BuildingInteriorScene extends GameplayScene {
  private map: GameMap;
  readonly pm: PlayerManager;
  private mapW: number;

  // Exit menu state
  private onExitTile = false;
  // Cursor state fed to the shared Button module each frame so hover/press works
  // on the interior's panels. Parked far off-screen until the mouse actually moves.
  private _mouseX = OFFSCREEN_CURSOR_POS;
  private _mouseY = OFFSCREEN_CURSOR_POS;
  private _mouseDown = false;
  /** The finger scrolling a pause-menu tab; its release is a click only if it never became a drag. */
  private pauseScrollTouch: { id: number; x: number; y: number; time: number } | null = null;
  private exitMenuOpen = false;
  private exitDismissed = false;
  /** Exit/Stay hit-rects, rebuilt by `renderExitMenu` and read by `handleExitMenuClick`. */
  private exitMenuButtons: ButtonRect[] = [];

  // Safe room — the one building the town plan flags with `hasSafeRoom`
  private readonly safeRoom: SafeRoomSystem | null;
  private readonly mordecaiAdvisor = new MordecaiAdvisor();
  /** Null in every interior but the one the town plan flags as the safe room. */
  private readonly bopca: BopcaSystem | null;
  /**
   * This scene's single event bus, wired to audio once and cleared once on exit —
   * the same contract `DungeonScene` follows.
   *
   * One bus rather than one per concern (skill unlocks, the Bopca's grunts,
   * and a combat stack's own) is what lets every system indoors
   * hear every other one, and what makes `AudioManager.wireEvents` — rather than
   * a hand-played sound at each emit site — the place a cue is chosen.
   */
  private readonly bus = new EventBus();
  /** Stops forwarding the crawlers' quest-slot evictions onto this scene's bus; set while the scene is running. */
  private stopForwardingQuestItemEvictions: (() => void) | null = null;
  private readonly systemNotices: SystemNoticeSystem;
  private readonly tacticsNotices: TacticsNoticeSystem;
  /** Bag, gear, pause menu, award stack, toasts and the hotbar's one routine. */
  private readonly menus: MenusKit;
  /** The unread-achievement chip, its notifications and the loot-box opener, as outdoors. */
  private readonly achievementUI: AchievementUISystem;
  /** The overworld's Quest Journal, read through the door; null on a floor with none. */
  private readonly overworldJournal: InteriorJournalSource | null;
  /** Where this frame's HUD drew the Build button, or null when it is not offered. */
  private buildButtonRect: Rect | null = null;
  /** Where this frame's HUD drew the Journal button, or null when it is not offered. */
  private journalButtonRect: Rect | null = null;

  protected get pauseMenu(): PauseMenu {
    return this.menus.pauseMenu;
  }

  // Shop (store only)
  private readonly shop: ShopSystem | null;

  // Desperado Club (club only)
  private readonly clubMembership: ClubMembership;
  private readonly mercenaryRoster: MercenaryRoster;
  private readonly godModeState: GodModeState;
  private readonly club: DesperadoClubSystem | null;

  private readonly inputHandler = new GameplayInputHandler();
  /** Enter opens chat indoors too, with the same universal cheat table. */
  private readonly chat: ChatKit;
  /**
   * The Bopca's own number keys. Bound separately because her dialog is the one
   * surface that reads 1/2/3 as a menu choice rather than as hotbar slots.
   */
  private conversationKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Shared mobile HUD (buttons, touch state) — the panels it draws are the kit's.
  private readonly mobileHUD: MobileHUDSystem;

  /** Coins/items flying to this scene's own HUD. One instance for the whole building — floors change, this doesn't. */
  protected readonly rewardFly = new RewardFlySystem();

  // Companion command state + menu, mirrored from the overworld so movement mode
  // and combat stance carry into buildings. The stance is threaded by reference
  // so passive/aggressive chosen here persists back out to the overworld.
  private readonly companionStance: CompanionStanceState;
  private readonly companion: CompanionSystem;
  private readonly followerMenu = new FollowerMenu();
  /**
   * Mongo. Owned by the scene rather than by a storey: he climbs a tower's
   * stairs with the party, and `changeFloor` moves him between storey rosters.
   */
  private readonly mongoSystem: MongoSystem;
  /**
   * The Meat Shields hire, stood up from the roster on the first frame like
   * outdoors. Scene-owned for the same reason Mongo is.
   */
  private readonly mercenarySystem: MercenarySystem;
  private readonly crawlerBarks = new CrawlerBarkSystem();
  /**
   * The contract the standing hire was stood up for. The club's desk can sign
   * or end one under this roof, and the figure in the room has to follow it.
   */
  private hireContract: HiredMercenary | null = null;
  /** Where the Summon button was drawn this frame, for the click and the tap. */
  private summonButtonRect: { x: number; y: number; w: number; h: number } | null = null;
  private readonly clearViewMemo = new ClearViewMemo();

  // Notif pulse (unused but needed for HUD signature)
  protected readonly notifPulse = { value: 0 };

  /**
   * One instance shared across every floor: it only reads the roster each
   * frame's `ctx` hands it, so it has nothing floor-specific to reset when the
   * party changes storeys.
   */
  protected readonly skillPointReminder = new SkillPointReminderSystem((ctx) =>
    this.isEncounterFightUnresolved(ctx),
  );

  // Tower multi-floor state
  private towerFloors: GameMap[] = [];
  private currentFloor = 0;
  private towerStairs: TowerStairSystem | null = null;

  protected readonly audio: AudioManager | null;

  /**
   * One per map: the ground floor of a shop, or all four storeys of the tower.
   * Every one of them carries a full `CombatKit`, which is what makes a swing in
   * an ordinary tavern do the same thing it does in the dungeon.
   */
  private readonly floors: InteriorFloor[] = [];
  /** The quest fight running in this building, if any, and the floor it holds. */
  private encounter: InteriorEncounter | null = null;
  private encounterFloor = 0;
  /**
   * The tower fight, held by its own type as well as by `encounter`.
   *
   * It is the one encounter with a conversation in it — the body at the desk
   * and the reveal that follows — so the overlay list, the Escape chain and the
   * Space chain all have to be able to ask it questions no other encounter
   * answers.
   */
  private towerConfrontation: QuillConfrontationSystem | null = null;
  /**
   * The Big Top's trap maze, held by its own type as well as by `encounter`.
   *
   * Like the tower's confrontation it has a conversation in it, and more besides
   * — a camera the script takes over, a follow command it refuses, and a door it
   * sends the party out through — so the overlay list, the Space chain and the
   * render pass all ask it questions no other encounter answers.
   */
  private bigTopMaze: BigTopMazeSystem | null = null;
  /**
   * The maze's hazards as the companion and the mob tactics see them, through
   * whichever tent is standing: registered once, because a restarted tent is a
   * new system and neither list can be told to forget the old one.
   */
  private readonly bigTopHazards: GroundHazardSource = {
    getHazardEscapeVector: (x, y) => this.bigTopMaze?.getHazardEscapeVector(x, y) ?? null,
  };
  /** Storeys still holding hostiles that were not put there by a quest encounter. */
  private readonly hostileRoomFloors = new Set<number>();
  // Ambient occupants (null in encounter interiors, towers, the club, and unpopulated buildings)
  private readonly occupants: InteriorOccupantSystem | null;
  private readonly ambientSound: AmbientSoundSystem | null;
  /** Priced-service menu for this room's NPC (drinks, blessing, ink); null where none is offered. */
  private readonly servicePanel: PricedMenuPanel | null;
  /** Old Hilda's reading surface; null in every room that sells rather than reads. */
  private readonly readingPanel: FortuneTellerPanel | null;
  /** Ledgers, letters and tally boards sitting on this room's furniture. */
  private readonly readables: InteriorReadableSystem | null;
  private readonly readablePanel = new ReadablePanel();
  /** Examine/search/use on this room's placed props; null where nothing here offers any of the three. */
  private readonly propInteractions: InteriorPropInteractionSystem | null;
  /** This room's breakable placed props (barrels, crates, jars…); null where nothing here is breakable. */
  private readonly interiorPropDestruction: TownInteriorPropDestructionSystem | null;
  /**
   * Resident lore progress and the apothecary's batch. Threaded in by reference
   * because this scene is rebuilt on every door entry — anything held here
   * instead would reset each visit, which is exactly the bug it exists to fix.
   */
  private readonly townMemory: TownMemory;
  /**
   * Shared tool tiers and seen craft explainers, threaded by reference like
   * `townMemory`. Public: nothing in this scene reads it yet, but the village
   * kit built beside it reads it directly rather than through an accessor.
   */
  public readonly partyCrafts: PartyCraftsState;
  /**
   * Briar Hollow's quest, structures and soldier orders, threaded by
   * reference like `townMemory`. Public for the same reason as `partyCrafts`.
   */
  public readonly briarHollowState: BriarHollowState;
  private readonly anchorQuestProgress: AnchorQuestProgress;
  /** The anchor questline's business in this room; null in every other room. */
  private readonly anchorInterior: AnchorInteriorSystem | null;
  /**
   * Every questline with business with this room's residents, in priority
   * order: the Anchor's first, then "The Borrowed Blueprints". Talking to a
   * resident, their glyph, and the quest's open conversation all walk this
   * list, so a questline indoors is one more entry rather than a special case.
   */
  private readonly residentQuestHooks: readonly ResidentQuestHook[];
  /** Plumbline Farm's quest-driven props; null in every other building. */
  private readonly plumblineFarmRoom: PlumblineFarmRoomSync | null;
  /** The one conversation panel every speaking system in this room shares. */
  private readonly conversation: Conversation;
  /** Occupant the open conversation belongs to; used to notice the player walking off. */
  private citizenDialogTarget: Townsperson | null = null;
  /** Keeps Carl talking, turned to whoever he is in conversation with. */
  private readonly humanTalk = new HumanTalkDriver();
  /** Frames left in which a freshly-opened interior modal ignores the interact key. */
  private modalGraceFrames = 0;
  /**
   * Whether the interact key has been observed genuinely released since the open
   * modal appeared. Nothing releases it while one of these panels is
   * up, so inside that window "not held" really does mean the key came up —
   * which makes this the edge trigger `isHeld` cannot be on its own.
   */
  private modalCloseArmed = false;
  /**
   * Whether the interact key has been released since an overlay last spent it.
   * The same edge trigger `modalCloseArmed` is, one layer out: it guards the
   * whole interaction chain rather than a single panel's close.
   *
   * Re-armed from the key *events*, never from the held-key set: a panel that
   * closes releases the key, which the polled set cannot tell apart from a
   * finger coming off the key — and reading it that way is what let a held press
   * re-open the panel it had just shut, half a second later, on the first
   * auto-repeat. Both the release and the start of the next non-repeat press
   * re-arm, so a keyup the browser drops (a window blurred mid-hold) costs
   * nothing rather than swallowing the press after it.
   */
  private interactArmed = true;
  /**
   * Never absent in practice — the overworld always hands its own across — but
   * defaulted so the Stats and Achievements tabs are real screens rather than a
   * shell in any scene that constructs this without them.
   */
  private readonly humanAchievements: AchievementManager;
  private readonly catAchievements: AchievementManager;
  private readonly gameStats: GameStats;
  private gameOver = false;
  /** Drives ability XP and levelling for everything the party does indoors. */
  private readonly abilityManager: AbilityManager;

  private readonly doomsdayProgress: DoomsdayProgress;
  /**
   * Ticked every frame regardless of floor/building — the containment
   * deadline must keep being checked even if the player leaves the crystal's
   * floor, or the tower, before containing it. See SoulCrystalSystem's doc.
   */
  private readonly soulCrystal: SoulCrystalSystem;

  constructor(
    private readonly entry: BuildingEntry,
    humanSnap: PlayerSnapshot,
    catSnap: PlayerSnapshot,
    /** The curve of the floor this building stands on: XP earned indoors is earned there. */
    private readonly xpCurve: readonly XpDiminishingTier[] | undefined,
    input: InputManager,
    sceneManager: SceneManager,
    private readonly onExitCallback: (
      humanSnap: PlayerSnapshot,
      catSnap: PlayerSnapshot,
      /** True when the exit was a defeat, so the caller can respawn away from the door. */
      defeated: boolean,
      /** Who walks out of the door with the party. */
      companions: InteriorCompanionDeparture,
    ) => void,
    /**
     * The overworld market's stock counters, threaded by reference like
     * `clubMembership` so a club line bought out stays sold out on the next
     * visit and through a checkpoint restore.
     */
    private readonly marketStock: MarketStock,
    humanAchievements?: AchievementManager,
    catAchievements?: AchievementManager,
    audio?: AudioManager,
    abilityManager?: AbilityManager,
    private readonly circus?: BuildingInteriorCircusContext,
    private readonly murderQuestProgress?: MurderQuestProgress,
    doomsdayQuestProgress?: DoomsdayProgress,
    clubMembership?: ClubMembership,
    townMemory?: TownMemory,
    mercenaryRoster?: MercenaryRoster,
    godModeState?: GodModeState,
    companionStance?: CompanionStanceState,
    /**
     * The pet's shared state, threaded by reference: he is rebuilt from it when
     * he walks in with the party, written back into it when he walks out, and
     * his off-duty recovery keeps ticking on it while he is recalled indoors.
     */
    mongoPetState?: MongoPetState,
    mongoPetLevel?: () => number,
    /** The run's tallies, so the Stats tab reads the same numbers indoors. */
    gameStats?: GameStats,
    /**
     * "The Anchor is Broken", two of whose three shards are earned indoors.
     *
     * By reference like `townMemory`, and for the same reason: this scene is
     * rebuilt on every door entry, so Hilda's mended furniture and the temple's
     * remaining vermin have nowhere else to survive the trip back outside.
     */
    anchorQuestProgress?: AnchorQuestProgress,
    /**
     * The town's art seed, so a shop's floorboards are painted from the same
     * draw as the street outside and stay the same on every visit. Omitted only
     * by a harness with no town behind it, which then gets its own draw.
     */
    townArtSeed?: number,
    /**
     * Tactics-trait System notices already shown this run, threaded by
     * reference from `DungeonScene` like `townMemory`, so a trait first met
     * indoors (a cultist, a rat) isn't announced a second time outside.
     */
    tacticsNoticesSeen?: Set<TacticsTrait>,
    /** What the overworld does with a defeat here, so the death screen names it. */
    private readonly defeatRespawnMode: RespawnMode = 'floorRestart',
    /** Who came through the door with the party. */
    companionArrival: InteriorCompanionArrival = NO_INTERIOR_COMPANIONS,
    partyCrafts?: PartyCraftsState,
    briarHollowState?: BriarHollowState,
    overworldJournal?: InteriorJournalSource,
  ) {
    super(input, sceneManager);
    this.overworldJournal = overworldJournal ?? null;
    this.audio = audio ?? null;
    this.conversation = new Conversation(this.audio);
    // Additive and cheap on repeat entry: preloading the same interior's SFX
    // group twice is a no-op, so re-entering a shop never re-pays the decode
    // cost (see the DungeonScene equivalent for the matching per-floor case).
    void this.audio?.preload(sfxGroupsForBuildingEntry(entry));
    this.abilityManager = abilityManager ?? new AbilityManager();
    this.townMemory = townMemory ?? createTownMemory();
    this.partyCrafts = partyCrafts ?? createPartyCraftsState();
    this.briarHollowState = briarHollowState ?? createBriarHollowState();
    this.anchorQuestProgress = anchorQuestProgress ?? createAnchorQuestProgress();
    this.gameStats = gameStats ?? new GameStats();
    this.humanAchievements = humanAchievements ?? new AchievementManager();
    this.catAchievements = catAchievements ?? new AchievementManager();
    this.doomsdayProgress = doomsdayQuestProgress ?? createDoomsdayProgress();
    this.soulCrystal = new SoulCrystalSystem(this.doomsdayProgress, this.audio);
    this.clubMembership = clubMembership ?? createClubMembership();
    this.mercenaryRoster = mercenaryRoster ?? createMercenaryRoster();
    this.godModeState = godModeState ?? createGodModeState();
    this.companionStance = companionStance ?? createCompanionStanceState();
    const petLevel = mongoPetLevel ?? ((): number => this.abilityManager.getLevel('mongo'));
    const petMaxHp = getMongoStats(petLevel()).maxHp;
    this.mongoSystem = new MongoSystem(
      mongoPetState ?? createMongoPetState(petMaxHp, petMaxHp),
      petLevel,
      (amount) => {
        this.abilityManager.addXp('mongo', amount);
      },
      () => mongoXpFraction(this.abilityManager),
      (message) => this.menus.hotbarToast.show(message),
    );
    this.mongoSystem.unlocked = companionArrival.mongoUnlocked;
    this.hireContract = this.mercenaryRoster.active;
    this.mercenarySystem = new MercenarySystem(
      this.mercenaryRoster,
      null,
      (entity) => this.safeRoom?.isEntityInSafeRoom(entity) ?? false,
      {
        toast: (message) => this.menus.hotbarToast.show(message),
        sound: (id) => this.audio?.play(id),
      },
    );

    const isTower = entry.type === 'tower';
    // Read once and reused below: the room's shape and where the two crawlers are
    // put down have to be the same decision, or the maze gets built and then
    // entered through the ring's single door.
    const variant = interiorVariantFor(entry.name, this.circus);

    // prebuiltStructure skips dungeon generation entirely (mapSize 0 would
    // crash the generator); generateInterior() builds the real room next.
    if (isTower) {
      // Generate 4 tower floors
      for (let f = 0; f < TOWER_FLOOR_COUNT; f++) {
        const floorMap = new GameMap({
          tileHeight: TILE_SIZE,
          prebuiltStructure: [],
          artSeed: townArtSeed,
        });
        // Every storey of a tower passes `false`: a tower is not a safe-room
        // building, and the flag belongs to the building rather than the floor.
        floorMap.generateInterior('tower', f, entry.name, false);
        this.towerFloors.push(floorMap);
      }
      this.map = this.towerFloors[0];
    } else {
      // Build single interior map
      this.map = new GameMap({
        tileHeight: TILE_SIZE,
        prebuiltStructure: [],
        artSeed: townArtSeed,
      });
      this.map.generateInterior(entry.type, 0, entry.name, entry.hasSafeRoom === true, variant);
    }

    // Every storey shares the one seed, so this covers the tower as well as a
    // single room. Set before any ground sheet or tile chunk is baked indoors.
    setFloorArtSeed(this.map.artSeed);
    // Indoors uses one generated sheet, plus the corner masks every pair is
    // composited through. Queued rather than painted outright, so the fade into
    // the shop is not the frame that pays for its floorboards.
    const repaintTileArt = (): void => {
      for (const floor of isTower ? this.towerFloors : [this.map]) floor.invalidateAllTileArt();
    };
    requestGroundSheets(['ground_interior'], repaintTileArt);
    // The town's furniture stands indoors too — a shop counter and a notice
    // board are the same sheets the street uses — and entering a building never
    // releases them, so this is a no-op on every visit after the first.
    requestEnvironmentSheetsForGroups(['town'], { onSheetPainted: repaintTileArt });

    this.mapW = this.map.structure[0]?.length ?? DEFAULT_MAP_FALLBACK_WIDTH;

    // Interiors (shops, the club, the tower) all draw from the town furniture
    // sheets — 'town' is a safe superset here rather than a per-entry-type
    // breakdown, since every interior variant is cheap to re-request and
    // already covered by that one lazily-loaded group.
    // `prewarmGroups` (not `loadGroups`) also forces the GPU texture upload
    // during the fade into the interior rather than on the first draw —
    // still fire-and-forget, must not block construction. Ground
    // tiles/decorations bake into cached chunk canvases on first draw and
    // never re-look at a sheet that finishes loading after that bake (see
    // `GameMap.invalidateAllTileArt`'s doc comment) — every tower floor was
    // built above from the same 'town' group, so one resolution covers all
    // of them; `changeFloor` never re-triggers this load.
    const interiorMaps = isTower ? this.towerFloors : [this.map];
    void prewarmGroups(['town']).then(() => {
      for (const m of interiorMaps) m.invalidateAllTileArt();
    });

    const { x: sx, y: sy } = this.map.startTile;
    this.pm = new PlayerManager(sx, sy, this.xpCurve);
    this.cat.setMap(this.map);

    restorePlayer(this.human, humanSnap);
    restorePlayer(this.cat, catSnap);
    this.plumblineFarmRoom =
      entry.name === PLUMBLINE_FARM_NAME ? new PlumblineFarmRoomSync(this.map) : null;
    this.syncPlumblineFarmRoom();
    // Restoring a snapshot leaves positions alone, so the party is stood at
    // the door here; it is set down again once the room's fittings exist.
    this.pm.setPartyDown(findPartyArrivalTiles(this.map, this.map.startTile));
    // The maze is two people walking two sealed halves, so they come in through
    // two flaps rather than side by side at one door.
    if (variant !== 'default') {
      this.human.x = MAZE_HUMAN_SPAWN_TILE.x * TILE_SIZE;
      this.human.y = MAZE_HUMAN_SPAWN_TILE.y * TILE_SIZE;
      this.cat.x = MAZE_CAT_SPAWN_TILE.x * TILE_SIZE;
      this.cat.y = MAZE_CAT_SPAWN_TILE.y * TILE_SIZE;
    }

    this.audio?.wireEvents(this.bus);
    this.wireSaveIndicator(this.bus);

    // The same companion drive the overworld runs, sharing the overworld stance
    // so movement mode and combat stance are consistent everywhere. It owns the
    // companion's feet as well as its hands: a second mover on the same body
    // fights this one for every step.
    this.companion = new CompanionSystem(this.map, sx, sy, this.companionStance);
    this.wireFollowerMenu();

    this.safeRoom =
      entry.hasSafeRoom === true
        ? new SafeRoomSystem(this.map, sx, sy, this.conversation, 'level3')
        : null;

    if (entry.hasSafeRoom === true) {
      this.bopca = new BopcaSystem(
        this.map,
        stampSafeRoomCounters(this.map),
        this.bus,
        this.conversation,
        this.audio,
        true,
      );
      // After the counter, because the furnishings keep clear of every tile it
      // owns and cannot know them until it is planned.
      stampSafeRoomDecor(this.map);
    } else {
      this.bopca = null;
    }

    // After the safe room's fittings are stamped: the arrival has to keep clear
    // of them just as it keeps clear of the room's own furniture. The maze's
    // two flaps are fixed marks on two sealed halves and are left as set.
    if (variant === 'default') {
      this.setPartyDown(this.map.startTile);
      this.companion.setMap(this.map, this.human, this.cat);
    }

    // Keyed by the building's own name rather than a shared constant: two
    // different General Stores must not pool the stock each one holds from
    // the player's sales.
    this.shop =
      entry.type === 'store'
        ? new ShopSystem(this.mapW, GENERAL_STORE_CONFIG, {
            stock: this.marketStock,
            vendorId: `general_store:${entry.name}`,
          })
        : null;

    this.club =
      entry.type === 'club'
        ? new DesperadoClubSystem(
            this.map,
            this.clubMembership,
            this.mercenaryRoster,
            this.conversation,
            this.audio,
            this.human.hasDesperadoPassTattoo || this.cat.hasDesperadoPassTattoo,
            this.active(),
            this.marketStock,
            this.humanAchievements,
            this.catAchievements,
          )
        : null;
    if (this.club !== null) {
      this.club.onCasinoWinnings = (coins, screenX, screenY) => {
        this.rewardFly.enqueueCoins(coins, screenX, screenY);
      };
    }

    // Tower stair system
    if (isTower) {
      this.towerStairs = new TowerStairSystem(
        this.map,
        0,
        () => this.changeFloor(this.currentFloor + 1),
        () => this.changeFloor(this.currentFloor - 1),
        () => this.ascentEntersTowerFinale(),
      );
    }

    // Every storey gets a full combat stack, not just the one a quest fight
    // happens to live on: the whole point is that a swing in an ordinary shop
    // does what a swing in the dungeon does. An empty roster costs nothing —
    // every member of the kit is a no-op over empty arrays.
    // One spell system for the whole building rather than one per storey: the
    // shell's cooldown is something the party spent, and a per-storey copy would
    // hand it back to anyone who took the stairs and came straight back.
    const spells = new SpellSystem();
    for (const floorMap of interiorMaps) {
      const world: SceneWorld = {
        gameMap: floorMap,
        bus: this.bus,
        audio: this.audio,
        pm: this.pm,
        roster: new MobRoster(floorMap, spells),
      };
      const skeletonSummons = new SkeletonSummonSystem(floorMap, (mob) => world.roster.add(mob));
      this.floors.push({
        world,
        destruction: new DestructionKit(world, OVERWORLD_FLOOR_NUMBER),
        skeletonShots: new SkeletonProjectileSystem(floorMap),
        rockThrows: new RockThrowSystem(floorMap),
        hirelingShots: new HirelingBoltSystem(
          floorMap,
          (point) => this.safeRoom?.isEntityInSafeRoom(point) ?? false,
        ),
        skeletonSummons,
        fairies: new FairySystem({
          bus: this.bus,
          gameMap: floorMap,
          ledger: null,
          getMobs: () => world.roster.mobs,
          getCrawlers: () => [this.human, this.cat],
          addMob: (mob) => world.roster.add(mob),
          skeletonSummons,
        }),
        combat: new CombatKit({
          world,
          abilityManager: this.abilityManager,
          // Null even in the building that does host a safe room: narrowing
          // attacks inside it would leave a crawler unable to swing anywhere
          // indoors, and nothing hostile reaches a town interior, so there is no
          // protection to lose.
          safeRoom: null,
        }),
      });
    }
    // Every storey has its own LootSystem/GroundPickupSystem (per-floor, like
    // the roster), so the fly-to-HUD hook is wired once per floor here rather
    // than once for the building.
    for (const floor of this.floors) {
      floor.destruction.loot.onCredited = (loot) => this.flyLootReward(floor, loot);
      floor.destruction.groundPickups.onCollected = (itemId, quantity, worldX, worldY) => {
        const cam = this.computeCamera(floor.world.gameMap);
        const name = ITEM_DEF[itemId].name;
        for (let i = 0; i < quantity; i++) {
          this.rewardFly.enqueueItem(itemId, name, worldX - cam.x, worldY - cam.y);
        }
      };
    }
    // Built from the ground floor's world, whose bus, audio and party every
    // storey shares — only the map and the roster are per floor, and no menu
    // reads either.
    this.menus = new MenusKit({
      world: this.floors[GROUND_FLOOR_INDEX].world,
      abilityManager: this.abilityManager,
      onOverlayRaised: () => this.mobileHUD.clearInvLongPress(),
      onPotionDrunk: (id) => this.noteDrinkAchievement(id),
    });
    this.menus.inventoryPanel.interaction.onBlockedHotbarDrop = () => {
      this.audio?.play('error');
      this.menus.announce(HOTBAR_REFUSAL_MESSAGE);
    };
    this.mobileHUD = new MobileHUDSystem(this.menus.inventoryPanel, this.menus.gearPanel);
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
        player.x + TILE_SIZE * TILE_CENTER_RATIO,
        player.y + TILE_SIZE * TILE_CENTER_RATIO,
        { coins: 0, items: [{ id, quantity }] },
        player,
        true,
      );
    };
    this.systemNotices = new SystemNoticeSystem(this.bus, this.menus.hotbarToast);
    this.tacticsNotices = new TacticsNoticeSystem(tacticsNoticesSeen ?? new Set<TacticsTrait>());
    this.chat = new ChatKit({
      world: this.floors[GROUND_FLOOR_INDEX].world,
      abilityManager: this.abilityManager,
      godModeState: this.godModeState,
      describeSituation: () =>
        `Human is level ${this.human.level}, Cat is level ${this.cat.level}. ` +
        `Inside: ${this.entry.name}. ` +
        `Human HP: ${displayHp(this.human.hp)}/${this.human.maxHp}, Cat HP: ${displayHp(this.cat.hp)}/${this.cat.maxHp}.`,
    });
    this.chat.applyCarriedCheat();
    this.wirePauseMenu();
    // No tutorial runs indoors, so the talisman needs none of the overworld's guard.
    bindAbilityLevelUps({
      abilityManager: this.abilityManager,
      menus: this.menus,
      audio: this.audio,
      onPetLevelUp: () => this.mongoSystem.onPetLevelUp(),
      onTalismanLevel: () => awardFirstHundred(this.catAchievements, this.bus),
    });
    bindCraftLevelUps({ bus: this.bus, menus: this.menus, audio: this.audio });
    this.wireCombatGore();
    this.initEntryEncounter(this.circus, variant === 'default' ? null : variant.plan);
    this.populateHostileRooms();

    // Before the occupants are placed, because breaking Hilda's shelf takes it
    // out of the furniture an occupant may anchor to — a citizen standing at a
    // heap of boards is a citizen standing at nothing.
    const ground = this.floors[GROUND_FLOOR_INDEX].world;
    this.anchorInterior = AnchorInteriorSystem.forBuilding(
      entry.name,
      GROUND_FLOOR_INDEX,
      this.anchorQuestProgress,
      ground.gameMap,
      () => [this.human, this.cat],
      (mob) => ground.roster.add(mob),
      (message) => this.menus.hotbarToast.show(message),
      this.conversation,
      this.audio,
    );
    const flyGrantedItem = (id: ItemId, quantity: number, worldX: number, worldY: number): void => {
      const cam = this.computeCamera(ground.gameMap);
      for (let i = 0; i < quantity; i++) {
        this.rewardFly.enqueueItem(id, ITEM_DEF[id].name, worldX - cam.x, worldY - cam.y);
      }
    };
    if (this.anchorInterior !== null) this.anchorInterior.onItemGranted = flyGrantedItem;
    const wendellHook = WendellBlueprintsHook.forBuilding(entry.name, GROUND_FLOOR_INDEX, {
      state: this.briarHollowState,
      bus: this.bus,
      audio: this.audio,
      conversation: this.conversation,
      human: this.human,
      cat: this.cat,
      toast: (message) => this.menus.hotbarToast.show(message),
      onItemGranted: flyGrantedItem,
    });
    this.residentQuestHooks = [this.anchorInterior, wendellHook].flatMap((hook) =>
      hook === null ? [] : [hook],
    );

    // Ambient occupants only where no live encounter owns the room; the tower's
    // confrontation can start after entry, so towers are excluded outright.
    this.occupants =
      this.encounter === null
        ? InteriorOccupantSystem.forBuilding(this.map, entry.type, entry.name, () => this.active())
        : null;
    // Kestrel is a counter-anchored occupant, not a figure `ShopSystem` owns
    // itself; it only needs her position for the "Shop" prompt and interact
    // range, so it is handed a pointer to her own `Townsperson` here, once
    // the roster that places her exists.
    this.shop?.setKeeper(
      this.occupants?.people.find((person) => person.residentId === 'keeper_brenna_kestrel') ??
        null,
    );
    // Suppressed for the same reason occupants are: a room hosting a live quest
    // encounter is a fight, not a library.
    this.readables =
      this.encounter === null
        ? InteriorReadableSystem.forBuilding(
            this.map,
            entry.name,
            this.occupants?.occupiedFurniture ?? new Set(),
          )
        : null;
    // One record shared by both search and break, since both pay out from
    // the same "first time only" rule against the same `TownMemory` — a
    // player who searches a chest and breaks a crate in the same visit must
    // not get two separate first-timer's grace periods on one room.
    const interiorPayoutRecord = new TownMemoryInteriorPayoutRecord(
      this.townMemory,
      entry.name,
      GROUND_FLOOR_INDEX,
    );
    // Same suppression as the two above: a live encounter room is a fight,
    // not a general store to shop and break crockery in.
    this.propInteractions =
      this.encounter === null
        ? InteriorPropInteractionSystem.forBuilding(this.map, interiorPayoutRecord)
        : null;
    if (this.propInteractions !== null && entry.name === PLUMBLINE_FARM_NAME) {
      this.propInteractions.examineOverride = (id) =>
        plumblineFarmExamineLine(id, this.briarHollowState.blueprints.phase);
    }
    this.interiorPropDestruction =
      this.encounter === null && TownInteriorPropDestructionSystem.hasAnyDestructible(this.map)
        ? new TownInteriorPropDestructionSystem(
            this.map,
            this.destruction.loot,
            interiorPayoutRecord,
          )
        : null;
    // Same ground-floor kit whose loot system the prop-destruction system was
    // just built from — a stick of dynamite thrown indoors should flatten a
    // placed barrel exactly as it flattens a dungeon crate.
    this.floors[GROUND_FLOOR_INDEX].destruction.dynamite.interiorProps =
      this.interiorPropDestruction;

    this.ambientSound =
      this.audio !== null ? new AmbientSoundSystem(this.audio, this.buildAmbientEmitters()) : null;

    // One panel of each kind however many counters this building has: only one
    // surface is ever open at a time, because the player can only be standing at
    // one of them.
    const services = interiorServicesFor(entry.name);
    this.servicePanel = services.some((service) => service.surface === 'menu')
      ? new PricedMenuPanel()
      : null;
    this.readingPanel = services.some((service) => service.surface === 'reading')
      ? new FortuneTellerPanel()
      : null;

    // Last, once the party stands where it came in and the entry storey's roster
    // exists to receive him.
    if (companionArrival.mongoWasOut) this.carryMongoIn();
  }

  /**
   * Ambience for the room the player just walked into: every hearth and brazier
   * in the generated layout crackles from where it stands, and rooms that should
   * sound busy get a constant crowd or shop bed on top.
   */
  private buildAmbientEmitters(): AmbientEmitter[] {
    const emitters: AmbientEmitter[] = [];
    for (let ty = 0; ty < this.map.structure.length; ty++) {
      const row = this.map.structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const type = row[tx].type;
        if (type !== FIREPLACE && type !== BRAZIER) continue;
        emitters.push({
          soundId: 'ambient_fire_crackling',
          x: tx,
          y: ty,
          radiusTiles: HEARTH_AMBIENT_RADIUS_TILES,
          maxVolume: HEARTH_AMBIENT_VOLUME,
        });
      }
    }
    const roomBed =
      INTERIOR_AMBIENT_BEDS.get(this.entry.name) ??
      (this.entry.name === BIG_TOP_BUILDING_NAME ? BIG_TOP_AMBIENT_BED : null);
    if (roomBed !== null) {
      emitters.push({
        soundId: roomBed.soundId,
        x: 0,
        y: 0,
        radiusTiles: 0,
        maxVolume: roomBed.volume,
        constant: true,
      });
    }
    return emitters;
  }

  /** The floor the player is standing on, with its map, bus, audio and roster. */
  private get world(): SceneWorld {
    return this.floors[this.currentFloor].world;
  }

  /** That floor's combat stack. Always present — every storey has one. */
  private get combat(): CombatKit {
    return this.floors[this.currentFloor].combat;
  }

  /** That floor's smashable props, floor loot and dynamite. */
  private get destruction(): DestructionKit {
    return this.floors[this.currentFloor].destruction;
  }

  /** That floor's soul bolts and bone arrows. */
  private get skeletonShots(): SkeletonProjectileSystem {
    return this.floors[this.currentFloor].skeletonShots;
  }

  /** That floor's hireling boulders. */
  private get rockThrows(): RockThrowSystem {
    return this.floors[this.currentFloor].rockThrows;
  }

  /** That floor's hireling bolts and waves. */
  private get hirelingShots(): HirelingBoltSystem {
    return this.floors[this.currentFloor].hirelingShots;
  }

  /** That floor's raised skeletons. */
  private get skeletonSummons(): SkeletonSummonSystem {
    return this.floors[this.currentFloor].skeletonSummons;
  }

  /** That floor's fairy heals, links and death effects. */
  private get fairies(): FairySystem {
    return this.floors[this.currentFloor].fairies;
  }

  /**
   * An interior's boss fights are its quest encounters, and each fills the
   * storey it runs on, so the storey is the room: the fight is unfinished while
   * anything hostile on it is still alive.
   */
  private isEncounterFightUnresolved(ctx: SystemContext): boolean {
    if (this.activeEncounter === null) return false;
    return ctx.roster.mobs.some((mob) => mob.isAlive && mob.isHostile);
  }

  /** The quest fight, but only while the player is on the floor holding it. */
  private get activeEncounter(): InteriorEncounter | null {
    return this.currentFloor === this.encounterFloor ? this.encounter : null;
  }

  /**
   * Every overlay this room can raise, ordered by which one a press should reach
   * first. The keyboard gate, the Space chain and the mobile tap path all read
   * this one list, so none of them can drift apart.
   */
  private get overlayClaims(): readonly OverlayInputClaim[] {
    const servicePanel = this.servicePanel;
    const readingPanel = this.readingPanel;
    /** Every modal in this room stops the world; only the shop-floor chat does not. */
    const modal = (isOpen: boolean, focusContext: string | null): OverlayInputClaim => ({
      isOpen,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext,
    });
    return [
      // Floating, as outdoors: the notification and the loot-box reveal each
      // declare their own ring, and the room keeps running under them. Drawn
      // over every other award, so ranked above them all.
      {
        isOpen: this.achievementUI.isBlocking,
        space: { kind: 'advance', advance: () => void this.achievementUI.handleSpaceBar() },
        locksKeyboard: false,
        haltsWorld: false,
        focusContext: null,
      },
      // The award stack outranks the death screen because it draws over it — a
      // level-up earned by the blow that killed you is still on top and still
      // has to be dismissible.
      modal(this.menus.levelUpDialog.isShowing, 'level-up'),
      modal(this.menus.rewardGrantedDialog.isShowing, 'reward-granted'),
      modal(this.menus.mongoExplainer.isOpen, MONGO_EXPLAINER_FOCUS_ID),
      modal(this.menus.craftExplainers.isOpen, this.menus.craftExplainers.focusId),
      modal(this.menus.skillBookPrompt.isOpen, 'skill-book-prompt'),
      this.menus.itemQuantityPicker.overlayClaim(),
      // `locksKeyboard` even though the death screen accepts from the keyboard:
      // its focus ring listens in the capture phase and consumes the press
      // before this handler is reached, so locking here only stops a hotbar key
      // spending a potion the revive is about to throw away.
      modal(this.gameOver, 'death-screen'),
      this.menus.constructionMenu.overlayClaim(),
      {
        isOpen: this.chat.isOpen,
        space: { kind: 'passThrough' },
        locksKeyboard: true,
        haltsWorld: true,
        // The DOM input owns every key while it is up, the ring included.
        focusContext: null,
      },
      // Mordecai's own conversation opens on the shared one below, so it needs no claim of its own here.
      modal(this.shop?.shopOpen === true, 'shop'),
      {
        isOpen: this.club?.modalOpen === true,
        space: { kind: 'advance', advance: () => this.club?.dismissModal(this.active()) },
        locksKeyboard: true,
        haltsWorld: true,
        // One claim over five stations — shop, casino, guild, VIP lounge, quest
        // dialog — so the club answers for whichever of them is drawn.
        focusContext: this.club?.focusContext ?? null,
      },
      modal(servicePanel?.isOpen === true, 'priced-menu'),
      modal(readingPanel?.isOpen === true, 'fortune-teller'),
      // Pages of text with no buttons; Space turns them, and the panel declares
      // an empty ring so nothing behind it keeps one.
      modal(this.readablePanel.isOpen, 'readable'),
      modal(this.exitMenuOpen, 'exit-building'),
      modal(this.towerStairs?.menuOpen === true, 'tower-stairs'),
      modal(this.followerMenu.isOpen, 'follower-menu'),
      modal(this.pauseMenu.isOpen, 'pause'),
      // Last: the one overlay the world keeps running under — walking away from
      // an occupant is what ends the conversation — and the one every other
      // surface here is drawn over. Ranking it above them would hand Space and
      // Escape to the box underneath whatever the player is looking at.
      this.conversation.overlayClaim(),
    ];
  }

  /**
   * The pause menu's own buttons. The two inventory rows open the bag on the
   * named crawler's pack rather than the active one's, which is the only way to
   * reach a companion's bag without switching to them.
   */
  private wirePauseMenu(): void {
    this.pauseMenu.onOpenChat = () => {
      this.pauseMenu.close();
      this.openChat();
    };
    const openInventoryFor = (player: HumanPlayer | CatPlayer): void => {
      this.menus.openInventoryFor(player, () => this.pauseMenu.openToInventory());
    };
    this.pauseMenu.onManageHumanInventory = () => openInventoryFor(this.human);
    this.pauseMenu.onManageCatInventory = () => openInventoryFor(this.cat);
  }

  /** Whose pack the bag is showing: an override picked from the pause menu, or the active crawler. */
  private inventoryPlayer(): HumanPlayer | CatPlayer {
    return this.menus.inventoryPlayer();
  }

  /** From a ground pile's world position on `floor`, to wherever the HUD's coin/bag targets sit this frame. */
  private flyLootReward(floor: InteriorFloor, loot: PendingLoot): void {
    const cam = this.computeCamera(floor.world.gameMap);
    const screenX = loot.x - cam.x;
    const screenY = loot.y - cam.y;
    this.rewardFly.enqueueCoins(loot.loot.coins, screenX, screenY);
    for (const item of loot.loot.items) {
      this.rewardFly.enqueueItem(item.id, ITEM_DEF[item.id].name, screenX, screenY);
    }
  }

  /**
   * The achievement for a Dirty Shirley is for drinking it where it is poured.
   * Carrying one down a floor and drinking it in a corridor is allowed; it just
   * isn't this.
   */
  private noteDrinkAchievement(id: ItemId): void {
    if (id !== 'dirty_shirley' || this.entry.type !== 'club') return;
    this.humanAchievements.tryUnlock('ask_for_it_dirty');
    this.catAchievements.tryUnlock('ask_for_it_dirty');
  }

  private openChat(): void {
    // Nothing may raise the chat box over a menu that already owns the screen:
    // its DOM input takes focus and the surface underneath keeps its own click
    // routing, so the two would be answering the same keys.
    if (worldHalted(this.overlayClaims)) return;
    this.chat.open(this.sceneManager.canvas);
  }

  /**
   * The scene's one subscription per gore event, dispatched to whichever floor's
   * kit is live.
   *
   * Wired here rather than inside `CombatKit` because a tower builds four kits
   * onto this one bus: a kit that subscribed for itself would have every floor
   * nobody is standing on spawning the same viscera into a system that is never
   * ticked or drawn.
   *
   * The splat and the level-up sting are deliberately absent — this bus is wired
   * to `AudioManager`, which owns both cues for every scene.
   */
  private wireCombatGore(): void {
    this.bus.on('healingPotionUsed', () => this.gameStats.recordPotionUsed());
    this.bus.on('spawnGore', (e) => {
      this.combat.spawnGore(e.x, e.y, e.impactDx, e.impactDy);
    });
    this.bus.on('crawlerKnockedOut', (e) => {
      e.player.applyCockroachKnockoutRelief();
      if (e.player === this.cat && this.human.isAlive && !this.human.isKnockedOut) {
        this.crawlerBarks.say(this.human, [CRAWLER_BARKS.donutKnockedOut.paragraphs[0]]);
      }
    });
    barkWhenBlueprintsItemEvicted(
      this.bus,
      { human: this.human, cat: this.cat },
      this.crawlerBarks,
    );
    this.bus.on('mobKilled', (e) => {
      this.gameStats.recordMobKilled(e);
      // A kill the party earned speeds his recovery, indoors as outdoors.
      if (e.killer !== null) this.mongoSystem.onKill();
      this.combat.spawnKillGore(e.mob, e.killer);
      // Onto the floor, the same as the dungeon, rather than straight into the
      // purse: seeing the loot fall and land is how a kill reads as having paid.
      // Nothing is lost by the door — `doExit` sweeps whatever is still lying
      // there into the pack on the way out.
      const owner = e.topDamageDealer ?? e.killer;
      if (owner !== null && e.mob.droppedLoot !== null) {
        const { x, y } = this.destruction.loot.findDropPosition(e.mob.x, e.mob.y);
        this.destruction.loot.addLoot(x, y, e.mob.droppedLoot, owner, false, false, true);
        e.mob.droppedLoot = null;
      }
    });
  }

  /**
   * Whatever hostile is standing in each of this building's rooms.
   *
   * Content, not wiring: the guards join through the roster each storey already
   * has, are fought with the kit it already has, and drop through the loot
   * system it already has. Adding a fight to a room that never had one is a
   * table entry in `interiorHostiles`, and nothing else.
   */
  /** What every scripted interior enemy is levelled against. */
  private get partyLevel(): number {
    return partyLevelOf(this.human.level, this.cat.level);
  }

  private populateHostileRooms(): void {
    this.floors.forEach((floor, floorIndex) => {
      const hostiles = interiorHostilesFor({
        buildingName: this.entry.name,
        buildingType: this.entry.type,
        floor: floorIndex,
        map: floor.world.gameMap,
        memory: this.townMemory,
        murderQuest: this.murderQuestProgress,
        partyLevel: this.partyLevel,
      });
      for (const hostile of hostiles) floor.world.roster.add(hostile);
      if (hostiles.length > 0) this.hostileRoomFloors.add(floorIndex);
    });
  }

  /**
   * `Player.noteWardBlockedHit` has no scene to bark through, so it raises a
   * pending flag instead; this is the one place both crawlers' flags are
   * drained into the actual bark.
   */
  private drainWardExplainerBarks(): void {
    if (this.human.pendingWardExplainerBark) {
      this.human.pendingWardExplainerBark = false;
      this.crawlerBarks.say(this.human, barkTexts(CRAWLER_BARKS.wardExplainer.carl));
    }
    if (this.cat.pendingWardExplainerBark) {
      this.cat.pendingWardExplainerBark = false;
      this.crawlerBarks.say(this.cat, barkTexts(CRAWLER_BARKS.wardExplainer.donut));
    }
  }

  /**
   * Marks a room quiet once the last of its guards is down, so walking back
   * through the door does not restock the fight.
   */
  private noteHostileRoomsCleared(): void {
    for (const floorIndex of [...this.hostileRoomFloors]) {
      const roster = this.floors[floorIndex].world.roster;
      if (roster.mobs.some((mob) => mob.isAlive && mob.isHostile)) continue;
      this.hostileRoomFloors.delete(floorIndex);
      noteRoomCleared(this.townMemory, this.entry.name, floorIndex);
    }
  }

  /**
   * Encounters that are live from the moment the building is entered: the
   * Big Top's trap maze and the Blackwood Lodge cult hideout. The tower's Quill
   * confrontation is created later, on reaching the top floor.
   */
  private initEntryEncounter(
    circus: BuildingInteriorCircusContext | undefined,
    /** The tent as dealt at the door, when this room is the maze. */
    plan: BigTopMazePlan | null,
  ): void {
    const circusProgress = circus?.progress;
    if (plan !== null && circusProgress !== undefined) {
      this.raiseBigTopMaze(circusProgress, plan);
      this.parkBothInTheMaze();
      // The maze's fire is ground the companion has to be steered out of, the
      // same as a gas cloud or a boss's puddle.
      //
      // Registered once, which is only safe because the Big Top is a single
      // storey: a storey change clears the companion's hazard list, and an
      // encounter in a building with stairs has to re-register from its own
      // update the way the tower's Lich fight does.
      this.companion.registerHazardSource(this.bigTopHazards);
      this.combat.mobLoop.registerHazardSource(this.bigTopHazards);
      return;
    }

    if (
      this.entry.name === BIG_TOP_BUILDING_NAME &&
      circusProgress !== undefined &&
      isCircusResolvedStage(circusProgress.stage)
    ) {
      this.placeCuredGrimaldi();
      return;
    }

    const murderProgress = this.murderQuestProgress;
    if (this.entry.name === 'Blackwood Lodge' && murderProgress?.stage === 'cult_hideout') {
      this.startEncounter(
        GROUND_FLOOR_INDEX,
        (bus, addMob) =>
          new CultHideoutSystem(this.map, bus, addMob, murderProgress, this.partyLevel),
      );
    }
  }

  /** Stands the maze up on the map already built from `plan`. */
  private raiseBigTopMaze(progress: CircusQuestProgress, plan: BigTopMazePlan): BigTopMazeSystem {
    const { world } = this.floors[GROUND_FLOOR_INDEX];
    const maze = new BigTopMazeSystem(
      this.map,
      this.bus,
      (mob) => world.roster.add(mob),
      progress,
      this.audio,
      this.conversation,
      plan,
      (next) => this.restartBigTopMaze(progress, next),
    );
    this.startEncounter(GROUND_FLOOR_INDEX, () => maze);
    this.bigTopMaze = maze;
    // Baked while the door is still loading, not on the fire walk's first frame.
    maze.lighting.prewarm();
    return maze;
  }

  /**
   * Both crawlers parked, not just whoever is standing in for the companion
   * right now: each walks their own half, and the moment the player uses the
   * switch key — which is the whole mechanic — the other stance would still be
   * on follow and would march that crawler into a corridor nobody is steering
   * them through.
   */
  private parkBothInTheMaze(): void {
    this.companion.anchorBoth(this.human, this.cat);
  }

  /**
   * The show starts over on another difficulty: the player confirmed a change
   * the maze was holding. The shared restart deals the new board, rebuilds the
   * room on the same map and puts the party at the flaps; around it the scene
   * closes its menu and settles what only it owns.
   */
  private restartBigTopMaze(progress: CircusQuestProgress, next: Difficulty): void {
    const old = this.bigTopMaze;
    const worldSeed = this.circus?.worldSeed;
    if (old === null || worldSeed === undefined) return;
    this.pauseMenu.close();
    // The same as closing it with Escape: a key still held from the menu must
    // not walk a crawler off the flap the moment the show starts again.
    this.input.clear();
    this.bigTopMaze = null;
    this.encounter = null;
    restartBigTopTent(
      old,
      {
        map: this.map,
        roster: this.world.roster,
        conversation: this.conversation,
        human: this.human,
        cat: this.cat,
        worldSeed,
        raise: (plan) => this.raiseBigTopMaze(progress, plan),
      },
      next,
    );
    this.parkBothInTheMaze();
    carryCompanions(this.carriedCompanions(), this.world.roster, this.world.roster, this.map);
    this.exitMenuOpen = false;
  }

  /**
   * The vine as the questline leaves him: still wrapped around the tent pole,
   * cured, in the ordinary ring the tent goes back to being.
   *
   * Not an encounter — nothing in the room is live any more — so he joins the
   * ground floor's roster the way any other furniture-shaped creature would, and
   * the room keeps its occupants, its readables and its own music.
   */
  private placeCuredGrimaldi(): void {
    const pole = this.map.bigtopRingCentre;
    if (pole === null) return;
    const tile = findNearbyWalkableTile(
      this.map,
      pole.x,
      pole.y + CURED_GRIMALDI_POLE_SOUTH_OFFSET,
      CURED_GRIMALDI_SEARCH_RADIUS_TILES,
    );
    if (tile === null) return;
    const grimaldi = new GrimaldiVine(tile.x, tile.y, TILE_SIZE);
    // The ring's 2×2 pole is centred on the corner its ring centre names.
    grimaldi.poleOffsetTiles = pole.x - (tile.x + GRIMALDI_TILE_CENTRE);
    grimaldi.setMap(this.map);
    grimaldi.cureAmount = 1;
    this.floors[GROUND_FLOOR_INDEX].world.roster.add(grimaldi);
  }

  /**
   * Brings a quest fight to life on one floor. The encounter spawns its mobs
   * through that floor's roster, so it is fought with the kit that floor already
   * had rather than one built around it.
   */
  private startEncounter(
    floor: number,
    makeEncounter: (bus: EventBus, addMob: (mob: Mob) => void) => InteriorEncounter,
  ): void {
    const { world } = this.floors[floor];
    this.encounterFloor = floor;
    this.encounter = makeEncounter(this.bus, (mob) => world.roster.add(mob));
  }

  /**
   * Whether climbing from the storey the party is standing on walks straight
   * into the murder quest's final battle.
   *
   * Only the two stages that still owe a fight qualify: `lich_slain` and
   * `complete` are also tower-confrontation stages, but the office is empty by
   * then and asking a returning player whether they are ready would be the game
   * threatening them with nothing.
   */
  private ascentEntersTowerFinale(): boolean {
    if (this.entry.type !== 'tower') return false;
    if (this.currentFloor + 1 !== TOWER_CONFRONTATION_FLOOR) return false;
    const stage = this.murderQuestProgress?.stage;
    return stage === 'confrontation' || stage === 'quill_slain';
  }

  /**
   * The Quill confrontation spawns the first time the players reach the
   * tower's top floor while the murder quest is at its confrontation stage.
   */
  private maybeStartTowerConfrontation(): void {
    if (this.encounter !== null) return;
    if (this.entry.type !== 'tower' || this.currentFloor !== TOWER_CONFRONTATION_FLOOR) return;
    const murderProgress = this.murderQuestProgress;
    if (murderProgress === undefined) return;
    if (!TOWER_CONFRONTATION_STAGES.includes(murderProgress.stage)) return;

    const floorMap = this.map;
    this.startEncounter(TOWER_CONFRONTATION_FLOOR, (bus, addMob) => {
      const confrontation = new QuillConfrontationSystem(
        floorMap,
        bus,
        addMob,
        murderProgress,
        this.audio,
        this.doomsdayProgress,
        this.partyLevel,
        this.companion,
        this.conversation,
      );
      this.towerConfrontation = confrontation;
      return confrontation;
    });
  }

  private changeFloor(newFloor: number): void {
    if (newFloor < 0 || newFloor > MAX_TOWER_FLOOR_INDEX) return;
    const goingUp = newFloor > this.currentFloor;
    // Anything the storey has in the air has to be dropped on the way out. A
    // stick thrown as the player left would otherwise hang there unticked and go
    // off when they came back down; a shell is the opposite problem — the spell
    // system is one instance for the whole building, so a shell left standing
    // would keep protecting on the *new* storey from the old one's coordinates.
    const departing = this.floors[this.currentFloor];
    departing.combat.leaveFloor();
    departing.destruction.resetForCheckpoint();
    // A bolt already loosed belongs to the storey it was fired on, and the rise
    // cue belongs to skeletons the player is walking away from.
    departing.skeletonShots.resetForCheckpoint();
    departing.rockThrows.resetForCheckpoint();
    departing.hirelingShots.resetForCheckpoint();
    departing.skeletonSummons.resetForCheckpoint();
    departing.fairies.resetForCheckpoint(departing.world.roster.mobs, new Set<string>());
    // Before `currentFloor` moves, while `activeEncounter` still resolves to the
    // encounter being walked away from.
    this.activeEncounter?.leaveFloor?.(this.buildSystemContext());
    this.currentFloor = newFloor;
    this.map = this.towerFloors[newFloor];
    this.mapW = this.map.structure[0]?.length ?? TOWER_INTERIOR_W;
    this.cat.setMap(this.map);
    this.towerStairs?.setMap(this.map, newFloor);

    // An ascending party arrives at the new storey's stair down, a descending
    // one at its stair up.
    const spawnTiles = goingUp ? this.map._interiorStairDownTiles : this.map._interiorStairUpTiles;
    const spawn = spawnTiles[0] ?? this.map.startTile;
    // Clear of the *whole* stair block, not one tile below its first tile: a
    // staircase spans several rows, so landing one row down would still be on it
    // and would re-open the menu the arrival just came through.
    const stairBottomRow = spawnTiles.reduce((lowest, tile) => Math.max(lowest, tile.y), spawn.y);
    const spawnY = stairBottomRow + 1;
    const spawnX = spawnTiles.reduce((leftmost, tile) => Math.min(leftmost, tile.x), spawn.x);
    this.setPartyDown({ x: spawnX, y: spawnY });
    // After both crawlers have been placed, so the companion's re-seeded anchors
    // and its leash both read the landing they actually arrived on rather than
    // the storey they left.
    this.companion.setMap(this.map, this.human, this.cat);
    // After the crawlers are placed, since each companion lands beside the one
    // it follows. The departing storey's roster is not ticked while the party is
    // elsewhere, so a companion left in it would stand frozen until they return.
    this.mercenarySystem.leaveStorey(departing.world.roster.mobs, departing.world.roster.grid);
    carryCompanions(this.carriedCompanions(), departing.world.roster, this.world.roster, this.map);

    // Reset menu states
    this.onExitTile = false;
    this.exitMenuOpen = false;
    this.exitDismissed = false;

    // Emitters were scanned from the previous floor's grid — every hearth on it
    // would otherwise keep crackling from coordinates that mean nothing here.
    this.ambientSound?.setEmitters(this.buildAmbientEmitters());

    this.maybeStartTowerConfrontation();
  }

  /**
   * The soundtrack this interior owns: a rotating playlist in the club and the
   * taverns, the tower's own theme, the temple's own theme, and a shared
   * default in every other room. Null where an entry encounter already
   * started its own battle music.
   */
  private interiorMusicTracks(): ReadonlyArray<SoundId> | null {
    if (this.encounter !== null) return null;
    if (this.entry.type === 'club') return CLUB_MUSIC_TRACKS;
    if (this.entry.type === 'tower') return TOWER_MUSIC_TRACKS;
    if (this.entry.name === SKY_TEMPLE_NAME) return TEMPLE_MUSIC_TRACKS;
    if (TAVERN_BUILDING_NAMES.has(this.entry.name)) return TAVERN_MUSIC_TRACKS;
    return DEFAULT_BUILDING_MUSIC_TRACKS;
  }

  onEnter(): void {
    bindRunStats(this.gameStats);
    this.stopForwardingQuestItemEvictions?.();
    this.stopForwardingQuestItemEvictions = forwardQuestItemEvictions(this.bus, {
      human: this.human,
      cat: this.cat,
    });
    // Override the overworld's persisted music with the room's own; the
    // overworld's zone music (OverworldMusicSystem) restores itself on exit.
    const musicTracks = this.interiorMusicTracks();
    if (musicTracks !== null) {
      this.audio?.playMusicPlaylist(musicTracks, { fadeInMs: INTERIOR_MUSIC_FADE_IN_MS });
    }

    // A conversation's numbered choices are picked with 1/2/3, which the hotbar
    // also owns. Stopped rather than merely defaulted: the shared handler's
    // suppression gate reads whether it is open *after* this ran, and the
    // choice that closes it — "leave" — would otherwise land on a hotbar slot
    // on its way out.
    this.conversationKeyHandler = (e: KeyboardEvent) => {
      const taken =
        this.menus.constructionMenu.handleKey(e.key, e.repeat) ||
        this.menus.itemQuantityPicker.handleKey(e.key) ||
        this.conversation.handleKeyDown(e.key);
      if (!taken) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.conversationKeyHandler);

    this.inputHandler.bind({
      isSuppressed: () => keyboardSuppressed(this.overlayClaims),
      isGameOver: () => this.gameOver,
      // No chest reward dialog indoors: chests are a dungeon fixture.
      dismissChestDialog: () => false,
      dismissDialog: () => {
        // First, because it is a DOM field that has taken focus: a click on the
        // canvas blurs it without closing it, and every gate below reads it as
        // still owning the screen.
        if (this.chat.isOpen) {
          this.chat.cancel();
          return true;
        }
        if (this.menus.mongoExplainer.isOpen && !this.menus.isAwardStackShowing) {
          this.menus.mongoExplainer.close();
          return true;
        }
        if (this.menus.craftExplainers.isOpen && !this.menus.isAwardStackShowing) {
          this.menus.craftExplainers.close();
          return true;
        }
        if (this.menus.constructionMenu.isOpen) {
          this.menus.constructionMenu.close();
          return true;
        }
        if (this.menus.skillBookPrompt.isOpen) {
          // Escape declines the read; the book stays in the pack.
          this.menus.skillBookPrompt.close();
          this.menus.releaseSkillBookReader();
          return true;
        }
        if (this.bopca?.dismissDialog() === true) return true;
        if (this.bigTopMaze?.dismissDialog() === true) return true;
        if (this.towerConfrontation?.dismissDialog() === true) return true;
        if (this.dismissResidentQuestDialog()) return true;
        if (this.safeRoom?.mordecaiDialogOpen === true) {
          this.conversation.dismiss();
          return true;
        }
        if (this.shop?.shopOpen === true) {
          this.shop.shopOpen = false;
          return true;
        }
        if (this.club?.modalOpen === true) {
          this.club.closeModals(this.active());
          return true;
        }
        if (this.servicePanel?.isOpen === true) {
          this.servicePanel.close();
          return true;
        }
        if (this.readingPanel?.isOpen === true) {
          this.readingPanel.close();
          return true;
        }
        if (this.readablePanel.isOpen) {
          this.readablePanel.close();
          return true;
        }
        // The bottom-most surface Escape can be aimed at: anything that can be
        // raised over a live conversation also renders over it. The handler
        // reaches the tower-stair, exit and follower menus *after* this
        // callback, so this branch has to decline while any of them is up —
        // otherwise Escape silently shuts the conversation underneath the modal
        // the player is actually looking at.
        if (this.citizenDialogTarget !== null && !worldHalted(this.overlayClaims)) {
          // `dismiss` rather than `close`: a service queued behind the story
          // must not open on the way out of it, and `onDismissed` is what
          // skips straight to unfreezing the target instead.
          this.conversation.dismiss();
          return true;
        }
        return false;
      },
      // The interior's two structural menus take the dungeon's stairwell and
      // building slots: both are "a door you are standing in", and both have to
      // close before Escape reaches the pause menu.
      dismissStairwell: () => {
        if (this.towerStairs?.menuOpen !== true) return false;
        this.towerStairs.closeMenu();
        return true;
      },
      dismissBuilding: () => {
        if (!this.exitMenuOpen) return false;
        this.closeExitMenu();
        return true;
      },
      dismissFollowerMenu: () => {
        if (!this.followerMenu.isOpen) return false;
        this.followerMenu.close();
        return true;
      },
      togglePause: () => {
        this.pauseMenu.toggle();
        if (this.pauseMenu.isOpen) {
          this.menus.closePanels();
          this.audio?.play('menu_open');
        } else {
          this.input.clear();
        }
      },
      advanceDialog: () => {
        if (this.handOffConversationPress()) {
          this.interactArmed = false;
          return true;
        }
        const outcome = advanceFocusedOverlay(this.overlayClaims);
        // Disarmed rather than cleared. The press is spent, and the page turn
        // that closes the last page leaves no claim behind for the polled chain
        // in `update` to check — so without this, the press that dismissed a
        // conversation immediately starts it again. Clearing the input instead
        // would look like a release to `consumeModalClose`, whose whole job is
        // to tell a real release from a held key, and would re-arm on the next
        // auto-repeat anyway.
        if (outcome !== 'ignored') this.interactArmed = false;
        return outcome !== 'ignored';
      },
      // No `switchCharacter` or `spaceAction`: both are polled from the held-key
      // set in `update`, where the interaction chain can order them against
      // movement and against each other. The keys are still swallowed here.
      usePotion: () => drinkAnyHealthPotion(this.hotbarHost()),
      toggleInventory: () => this.menus.toggleInventory(),
      toggleGear: () => this.menus.toggleGear(),
      // Closing is `dismissFollowerMenu`'s job, which the handler tries first.
      companionFollow: () => {
        if (this.followDisabled) {
          this.audio?.play('error');
          return;
        }
        if (this.canOpenFollowerMenu()) this.followerMenu.open();
      },
      toggleMiniMap: () => this.mobileHUD.toggleMiniMap(),
      // Indoors this is Old Hilda's hammer rather than the dungeon's barricades,
      // but it is the same key doing the same thing: spending boards on a
      // broken thing you are standing at.
      buildAction: () => this.triggerAnchorRepair(),
      toggleQuestTracker: () => {
        if (this.openQuestJournal()) this.audio?.play('menu_open');
      },
      mongoSummon: () => this.toggleMongoSummon(),
      openChat: () => this.openChat(),
      hotbarActivation: (idx) => activateHotbarSlot(this.hotbarHost(), idx),
      dynamiteRelease: (idx) => releaseChargedDynamite(this.hotbarHost(), idx),
      interactPressStarted: () => {
        this.interactArmed = true;
      },
      interactReleased: () => {
        this.interactArmed = true;
      },
      onConstruction: () => this.toggleConstructionMenu(),
      // Structures and trebuchets are an outdoor fixture of the Briar Hollow
      // palisade; there is nothing indoors for either key to reach yet.
      onStructureMenu: () => this.noVillageStructuresIndoors(),
      onQuickLoad: () => this.noVillageStructuresIndoors(),
    });
  }

  /** Indoors has no structure to open a menu for or deposit ammo into. */
  private noVillageStructuresIndoors(): void {
    // Nothing to do: the Structure menu and Quick Load only ever act outdoors.
  }

  /**
   * Opens the Construction menu as outdoors, over the indoor rows: each kind
   * lists what it costs, and any kind that cannot be built under a roof is
   * refused when chosen.
   */
  private toggleConstructionMenu(): void {
    const menu = this.menus.constructionMenu;
    if (menu.isOpen) {
      menu.close();
      return;
    }
    const active = this.active();
    if (!active.craftSkills.isLearned('construction')) {
      this.menus.announce('You have not learned Construction yet.');
      return;
    }
    if (this.briarHollowState.unlocks.construction.length === 0) {
      this.menus.announce("You don't have any construction plans yet.");
      return;
    }
    menu.openWith(
      indoorsConstructionSource(this.human, this.cat, () => this.briarHollowState.unlocks),
    );
  }

  /** Whether the HUD offers the Build button: under the same rule as outdoors. */
  private get buildButtonOffered(): boolean {
    return constructionUnlocked([this.human, this.cat], this.briarHollowState.unlocks);
  }

  /**
   * Hands the pause menu the overworld's journal, or null to hide its row.
   * Distances are measured from the building's door: the entries' targets
   * are overworld tiles, and the door is where the party rejoins them.
   */
  private syncJournalContext(): void {
    const journal = this.overworldJournal;
    if (journal === null) {
      this.pauseMenu.journalContext = null;
      return;
    }
    this.pauseMenu.journalContext = {
      playerTileX: this.entry.doorTile.x,
      playerTileY: this.entry.doorTile.y,
      entries: journal.entries(),
      progress: journal.progress,
    };
  }

  /** Pauses into the Journal — the compass button's action and the J key's. */
  private openQuestJournal(): boolean {
    if (this.overworldJournal === null || this.gameOver) return false;
    if (this.conversation.isOpen) this.conversation.dismiss();
    this.syncJournalContext();
    this.pauseMenu.openToJournal();
    this.menus.closePanels();
    return true;
  }

  /**
   * The Build button, the achievement chip, the loot-box banner and the
   * Journal. Returns whether the press was theirs.
   */
  private tryPressColumnPieces(mx: number, my: number): boolean {
    if (this.gameOver || this.pauseMenu.isOpen) return false;
    if (this.achievementUI.handleAchievIconClick(mx, my)) return true;
    if (this.achievementUI.handleLootBoxIconClick(mx, my, () => this.pauseMenu.close())) {
      return true;
    }
    const build = this.buildButtonRect;
    if (build !== null && pointInRect(mx, my, build)) {
      this.toggleConstructionMenu();
      return true;
    }
    const journal = this.journalButtonRect;
    if (journal !== null && pointInRect(mx, my, journal)) {
      this.openQuestJournal();
      return true;
    }
    return false;
  }

  /** The collaborators a hotbar press reaches, resolved against the live floor. */
  private hotbarHost(): HotbarHost {
    return {
      world: this.world,
      menus: this.menus,
      abilityManager: this.abilityManager,
      spells: this.combat.spells,
      dynamite: this.destruction.dynamite,
      trySceneSlot: (slot) => this.trySceneHotbarSlot(slot),
    };
  }

  /**
   * The Wayfinder's Anchor has no `RecallSystem` indoors — that system is
   * `DungeonScene`-owned — so without this the press would fall through the
   * whole hotbar chain and do nothing at all, a silent refusal no other item
   * in this game gives.
   */
  private trySceneHotbarSlot(slot: InventoryItem): boolean {
    if (slot.id !== 'wayfinders_anchor') return false;
    this.audio?.play('error_taking_action');
    this.menus.hotbarToast.show('The stone needs open sky to find its way.');
    return true;
  }

  onExit(): void {
    this.stopForwardingQuestItemEvictions?.();
    this.stopForwardingQuestItemEvictions = null;
    // See the matching note in DungeonScene.onExit: defensive, since a fresh
    // scene already starts with a fresh RewardFlySystem.
    this.rewardFly.reset();
    // Backstop for any teardown that does not route through `doExit`, which
    // closes the club's panels itself while the coins can still reach the
    // player. Idempotent, so running twice costs nothing.
    this.club?.closeAll(this.active());
    this.humanTalk.stop(this.human);
    // The next scene binds its own; a level-up must never reach this one's menus.
    this.abilityManager.onLevelUp = null;
    // Same contract as DungeonScene's bus: subscribers are re-wired per scene, so
    // the listeners this scene added must not outlive it.
    this.bus.clear();
    this.menus.dispose();
    this.ambientSound?.dispose();
    this.bopca?.dispose();
    // Ahead of the companion's own teardown, because a quest fight's cleanup
    // withdraws the orders and hazards it gave the companion, and it should be
    // able to do that against a companion that still exists.
    this.encounter?.dispose?.();
    // Drops any standing order along with the hazard sources that were meant to
    // steer around it. Both name systems this scene is taking with it.
    this.companion.dispose();
    // Every floor's kit, not just the live one: each holds its own mob loop, and
    // the pack-alert grid that loop publishes is a module-level handle. An
    // interior that exited without this leaves its mobs — and through them its
    // maps — reachable for the rest of the page's life.
    for (const floor of this.floors) floor.combat.dispose();
    for (const floor of this.floors) floor.fairies.dispose();
    // Drop this scene's hit-rects so the next scene doesn't inherit stale hover.
    clearButtonMouseState();
    this.inputHandler.unbind();
    // A real <input> on document.body, which swallows every key it is focused
    // for. Left behind, it makes the scene that replaces this one unplayable.
    this.chat.dispose();
    if (this.conversationKeyHandler !== null) {
      window.removeEventListener('keydown', this.conversationKeyHandler);
      this.conversationKeyHandler = null;
    }
  }

  /**
   * True when no other modal owns the screen, so the follower menu may open.
   *
   * Read off the claim registry rather than restated as a second list of the
   * same panels: a panel added to one and forgotten in the other is a menu that
   * opens on top of another menu. The street-chat exception is deliberate here
   * too — a conversation the player can walk out of should not block a command.
   */
  private canOpenFollowerMenu(): boolean {
    if (this.followDisabled) return false;
    return !worldHalted(this.overlayClaims) && this.citizenDialogTarget === null;
  }

  /**
   * Whether this room refuses the follow command outright.
   *
   * The Big Top's maze is the only one that does: it is two people solving one
   * room from opposite sides, and a companion trailing the active crawler would
   * walk into a corridor nobody is steering them through.
   */
  private get followDisabled(): boolean {
    return this.bigTopMaze?.followDisabled === true;
  }

  /** Hook the shared follower menu to the companion's commands (same set as the overworld). */
  private wireFollowerMenu(): void {
    this.followerMenu.onFollowMe = () => {
      this.audio?.play('menu_click');
      this.companion.setFollowMe(this.human.isActive);
    };
    this.followerMenu.onDoNotMove = () => {
      this.audio?.play('menu_click');
      this.companion.setDoNotMove(this.inactive(), this.human.isActive);
    };
    this.followerMenu.onSetAggressive = () => {
      this.audio?.play('menu_click');
      this.companion.setAggressive(this.human.isActive);
    };
    this.followerMenu.onSwitchCharacter = () => this.trySwitchActive();
    this.followerMenu.onSetPassive = () => {
      this.audio?.play('menu_click');
      this.companion.setPassive(this.human.isActive);
    };
  }

  /**
   * True while the companion lies knocked out in this building. Always in this
   * building: no door opens while either crawler is down, so a knocked-out
   * companion can only have gone down in here.
   */
  private get companionDownIndoors(): boolean {
    return this.inactive().isKnockedOut;
  }

  /**
   * Every party-side creature this scene moves with the crawlers: up and down
   * the tower's stairs, and back to their marks when a script resets the party.
   */
  private carriedCompanions(): CarriedCompanion[] {
    return [
      this.mongoSystem.asCarriedCompanion(this.cat),
      this.mercenarySystem.asCarriedCompanion(),
    ];
  }

  /**
   * The party-side creatures hostiles may go for this frame, beside the
   * crawlers. Not Mongo while he is retreating: on one hit point, with the
   * interception holding him there, further hits are a fight he cannot leave.
   */
  private companionTargets(): Player[] {
    const targets: Player[] = [];
    const mongo = this.mongoSystem.mongo;
    if (mongo !== null && !mongo.recalling && !mongo.collapsing) targets.push(mongo);
    const merc = this.mercenarySystem.activeMerc;
    if (merc !== null) targets.push(merc);
    return targets;
  }

  /** Who walks out of the door with the party. Read before anything is put away. */
  private companionDeparture(): InteriorCompanionDeparture {
    return { mongoWasOut: this.mongoSystem.followsThroughDoor };
  }

  /**
   * Stands the driven crawler on `landing` and the other beside them, each on
   * a tile they can walk off. Everything that lands beside a crawler — Mongo,
   * the hire — reads these positions, so this comes before any of them.
   */
  private setPartyDown(landing: { readonly x: number; readonly y: number }): void {
    this.pm.setPartyDown(findPartyArrivalTiles(this.map, landing));
  }

  private carryMongoIn(): void {
    const mongo = this.mongoSystem.carryIn(this.cat, this.map);
    if (mongo !== null) this.world.roster.add(mongo);
  }

  /**
   * The Summon button and the R key are one toggle, exactly as outdoors: out of
   * play he is summoned, in play he is called back and runs home.
   */
  private toggleMongoSummon(): void {
    if (this.gameOver) return;
    if (!this.cat.isActive || !this.active().canAct) return;
    if (this.mongoSystem.mongo !== null) {
      this.mongoSystem.toggleRecall();
      return;
    }
    this.summonMongo();
  }

  /** Returns whether he came out; a refusal has already been spoken by the cat. */
  private summonMongo(): boolean {
    const mongo = this.mongoSystem.summon(this.cat, this.map);
    if (mongo === null) return false;
    this.world.roster.add(mongo);
    this.abilityManager.addUsageXp('mongo');
    this.audio?.play('mongo_released');
    return true;
  }

  /**
   * The companion cat sends Mongo in on her own when a fight reaches her — only
   * while the human is being driven, never against a passive stance, and never
   * from inside a safe room, which is a rest stop rather than a staging ground.
   */
  private autoSummonMongo(ctx: SystemContext): void {
    if (!settings.catAutoSummonsMongo) return;
    if (!this.human.isActive || this.mongoSystem.mongo !== null) return;
    if (this.companion.getCombatStance(true) === 'passive') return;
    if (this.safeRoom !== null && this.pm.isAnySafe(this.safeRoom)) return;
    if (!this.mongoSystem.catWantsToSummon(ctx)) return;
    if (!this.summonMongo()) this.mongoSystem.onAutoSummonRefused();
  }

  /**
   * Mongo's Summon/Recall button: on a phone stacked on the Switch button as
   * outdoors, elsewhere bottom-left above the hotbar band the room is already
   * lifted clear of. Null where it is not drawn, so nothing hit-tests a button
   * the player cannot see.
   */
  private renderSummonButton(
    ctx: CanvasRenderingContext2D,
    layout: InteriorHudLayout,
  ): { x: number; y: number; w: number; h: number } | null {
    const rect = layout.summon;
    if (rect === null) return null;
    return this.mongoSystem.renderSummonButton(ctx, rect.x, rect.y, rect.w, rect.h, true);
  }

  /** Whether a press at this point landed on the Summon button, which it then toggles. */
  private tryPressSummonButton(x: number, y: number): boolean {
    const rect = this.summonButtonRect;
    if (rect === null || !pointInRect(x, y, rect)) return false;
    this.toggleMongoSummon();
    return true;
  }

  /**
   * True while a scripted beat is driving both crawlers' bodies.
   *
   * One accessor rather than a condition repeated at each site: the keyboard
   * poll, the switch key and the touch swing are three roads to the same
   * question, and when the tower fight added a second script only the first of
   * them learned about it — leaving a tap able to swap bodies mid-slide, out
   * from under the code writing their positions.
   */
  private get scriptOwnsParty(): boolean {
    return this.bigTopMaze?.playerLocked === true || this.towerConfrontation?.playerLocked === true;
  }

  /** Hands control to the companion, unless they're lying knocked out. */
  private trySwitchActive(): void {
    // Guarded here rather than only at the keyboard poll, because the mobile HUD
    // reaches this by a different road: a script that is driving both bodies
    // must not have one swapped out from under it by either of them.
    if (this.scriptOwnsParty) return;
    if (this.inactive().isKnockedOut) {
      this.audio?.play('error');
      return;
    }
    this.audio?.play('menu_change_follower');
    // The new body is standing somewhere else, so the walk-away check would read
    // a distance the player never walked. Ending the conversation outright is
    // what the dungeon does, and the mobile Switch button reaches this same
    // method, so both roads agree.
    this.safeRoom?.closeMordecaiDialog();
    const wasHumanActive = this.human.isActive;
    this.pm.switchActive();
    // The crawler who just stopped being driven is now standing somewhere new,
    // and an anchored stance has to be told so. Without this its anchor is still
    // wherever it was set — which indoors is the door they came in by — and the
    // follow drive walks them all the way back to it, through whatever is
    // between. Harmless in a shop, where nothing is anchored; ruinous under the
    // Big Top, where the room anchors both crawlers and the ground burns.
    const parked = wasHumanActive ? this.human : this.cat;
    // Parked where they stand, unless the room says that spot is about to be on
    // fire — an anchor inside a trap corridor is a crawler walking back into it
    // every time the follow drive goes out.
    const restingSpot = this.bigTopMaze?.restingSpotFor(parked) ?? parked;
    this.companion.notifyBecameCompanion(restingSpot, wasHumanActive);
    this.human.autoTarget = null;
    this.cat.autoTarget = null;
    this.companion.isFollowOverride = false;
  }

  /**
   * The same downed-teammate flow the overworld runs, for a companion who drops
   * inside the building: knocked out where they fell, revived by standing over
   * them, and a bleed-out ending the run — never a death handed straight out
   * the front door, which would teleport the player outside mid-visit.
   */
  private updateCompanionKnockout(): void {
    const inactive = this.inactive();
    updateKnockoutState({
      active: this.active(),
      inactive,
      inactiveIsHuman: inactive === this.human,
      audio: this.audio,
      bus: this.bus,
    });
    if (!inactive.isKnockedOut) return;
    if (inactive.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) this.raiseDeathScreen();
  }

  /**
   * Where the one Carl is in conversation with stands, while a street-style
   * conversation is open — a resident, or Mordecai; null otherwise.
   */
  private humanTalkSpeaker(): { x: number; y: number } | null {
    const citizen = this.citizenDialogTarget;
    if (citizen !== null) return citizen;
    return this.safeRoom?.speakingMordecaiPosition ?? null;
  }

  update(): void {
    // Above the death-screen return: an award earned by the blow that killed the
    // party is still drawn on top of the screen announcing it, and a dialog that
    // is not ticked sits frozen at its first frame with its accept button inert.
    this.menus.update();
    this.achievementUI.tick();
    playRewardLandingCues(this.audio, this.rewardFly.update());

    // The death screen accepts through its own focus ring, which reaches
    // `handleClick` — nothing to poll for here. The fall he died in still
    // plays out beneath it as it fades in.
    if (this.gameOver) {
      this.human.tickReactionWhileDefeated();
      return;
    }

    // Ticked on every floor of every building, and the one exception is the
    // return above: a party that is already dead has nothing left to contain.
    const isOnCrystalFloor =
      this.entry.type === 'tower' && this.currentFloor === TOWER_CONFRONTATION_FLOOR;
    this.soulCrystal.update(this.human, this.cat, this.active(), isOnCrystalFloor);
    if (this.soulCrystal.crystalContainedPending) {
      this.soulCrystal.crystalContainedPending = false;
      this.humanAchievements.tryUnlock('doomsday_contained');
      this.catAchievements.tryUnlock('doomsday_contained');
      const active = this.active();
      const cam = this.computeCamera(this.map);
      this.rewardFly.enqueueItem(
        'doomsday_scenario',
        ITEM_DEF.doomsday_scenario.name,
        active.x - cam.x,
        active.y - cam.y,
      );
    }

    // Before `drainFor`, so a notice queued this frame drains on this same
    // frame's toast pass rather than sitting a frame behind.
    this.tacticsNotices.scan(this.world.roster.mobs, this.human);
    this.systemNotices.drainFor(this.human, this.cat);
    this.combat.floatingText.updateFor(this.human, this.cat, this.world.roster.mobs);
    this.menus.openPendingSkillBookPrompt(this.inventoryPlayer());
    const invPlayer = this.inventoryPlayer();
    this.menus.resolvePendingInventoryActions(invPlayer, (id, quantity) =>
      this.destruction.loot.addPlayerDrop(invPlayer.x, invPlayer.y, id, quantity, invPlayer),
    );
    this.chat.update();
    // Drained here rather than inside the panel branches that read it: a panel
    // dismissed with the mouse before the grace expired would otherwise leave a
    // stale count behind to swallow an unrelated key press later.
    if (this.modalGraceFrames > 0) this.modalGraceFrames--;

    // Caught here as well as at the end of `updateCombat`, because a death can
    // arrive from something the frame stops before reaching it — the doomsday
    // countdown ticks above every modal's early return.
    if (!this.active().isAlive) {
      this.raiseDeathScreen();
      return;
    }

    if (this.menus.skillBookPrompt.isOpen) return;
    // Both award dialogs accept through their own focus rings, which reach
    // `handleClick`; polling the key here would be the second path to the same
    // OK button.
    if (this.menus.levelUpDialog.isShowing) return;
    if (this.menus.rewardGrantedDialog.isShowing) return;
    // The chat box says it halts the world in `overlayClaims`, and this is where
    // that has to be true: a fight left running under a DOM text field is one
    // the player cannot answer.
    if (this.chat.isOpen) return;
    if (this.pauseMenu.isOpen) return;
    if (this.followerMenu.isOpen) return;
    // Asked while the party can still turn back: a door or a stair would leave
    // a downed hire behind for good.
    if (this.exitMenuOpen || this.towerStairs?.menuOpen === true) {
      this.mercenarySystem.warnIfLeavingDowned();
    }
    if (this.exitMenuOpen) return;
    if (this.towerStairs?.menuOpen) return;
    // Above every modal branch below: a conversation that halts the world is
    // still the one thing that has to keep revealing and counting walk-away,
    // and the branches below return before the world's own tick.
    this.conversation.update({ x: this.active().x, y: this.active().y });
    // The dialogs below advance from the claim registry, on the key event
    // rather than from the held-key set: a polled advance on top of the handler's
    // would turn one press into two pages.
    if (this.bopca?.isDialogOpen === true) {
      // The cook timer has to keep running through the conversation — the dish
      // is meant to land while the player is still reading the order line.
      this.bopca.tick(this.human, this.cat, this.active(), this.inactive());
      return;
    }
    if (this.shop?.shopOpen === true) {
      if (this.consumeModalClose()) this.shop.shopOpen = false;
      return;
    }
    if (this.club?.modalOpen) {
      // The blackjack table deals, flips and settles on its own clock, so it has
      // to keep ticking through its own panel — the same reason the Bopca's cook
      // timer runs through her dialog above.
      this.club.tickOpenModals(this.active(), this.inactive());
      return;
    }
    // The tower's own conversation: the office scene, the reveal, the Lich's
    // phase barks and the victory page. Its claim has always promised
    // `haltsWorld: true`, and this return is what makes that true — without it
    // the room kept fighting behind the box, which meant a boss phase advancing
    // and orbs landing on a party that was reading. A bare return is safe here
    // where it is not for the maze: nothing inside the confrontation is waiting
    // on a timer while its dialog is up. Every one of those pages is closed by
    // the player, and closing it is what starts the next beat.
    if (
      this.currentFloor === TOWER_CONFRONTATION_FLOOR &&
      this.towerConfrontation?.isDialogOpen === true
    ) {
      return;
    }
    if (this.bigTopMaze?.isDialogOpen === true) {
      // Ticked rather than merely halted, for the same reason the blackjack
      // table and the Bopca's cook timer are: the box is one beat of a script
      // that is holding both crawlers still, and the script is what closes it.
      // A bare `return` here strands the party locked in place forever.
      this.bigTopMaze.update(this.buildSystemContext());
      // And its cues are drained here rather than left for the frame the box
      // closes: a barrier that opened on the same frame a reset notice came up
      // would otherwise be heard several seconds later, over nothing.
      this.drainMazeQueues();
      return;
    }
    // Space reaches this conversation through the claim registry's advance
    // chain on the key event, and Escape through `dismissDialog`. Polling the
    // held key here as well would turn the press that turns a page into one
    // that also closes the box.
    if (this.residentQuestDialogOpen()) return;
    if (this.servicePanel?.isOpen === true) {
      this.servicePanel.update();
      if (this.consumeModalClose()) this.servicePanel.close();
      return;
    }
    if (this.readingPanel?.isOpen === true) {
      if (this.consumeModalClose()) this.readingPanel.close();
      return;
    }
    if (this.readablePanel.isOpen) {
      // Advances rather than closing: a long readable is paged, and the last
      // page is where `advance` closes it.
      if (this.consumeModalClose()) this.readablePanel.advance();
      return;
    }
    this.gameStats.recordPlayedFrame();
    // Deliberately does not return: the player has to be able to walk while the
    // box is up, because walking off is what dismisses it. Mordecai's own
    // conversation is the shared one, already ticked above; this only measures
    // whether the player has walked out of his room.
    this.safeRoom?.tickMordecaiWalkAway(this.active());
    this.humanTalk.update(this.human, this.humanTalkSpeaker(), false);

    const player = this.active();
    // A cutscene drives both bodies itself. Every input below is withheld for
    // its whole run, movement included, or the player walks Carl out of the
    // scripted walk-up he is halfway through.
    const scriptOwnsParty = this.scriptOwnsParty;

    // Movement via shared GameLoopPhases
    if (!scriptOwnsParty) {
      const move = readMovement(
        this.input,
        this.mobileHUD.moveTarget,
        this.mobileHUD.tapStart,
        player,
        this.computeCamera(this.map),
      );
      // Interiors are small enough that the south wall is always on screen, so a
      // crawler with their feet planted on it is the first thing you notice.
      applyMovement(player, move, this.map, 'sole');
    }

    // A citizen conversation blocks the swap outright rather than surviving it:
    // its walk-away check has no way to be told the body changed, unlike
    // Mordecai's, which trySwitchActive closes on the way through.
    if (
      this.citizenDialogTarget === null &&
      !scriptOwnsParty &&
      keybindings.isHeld(this.input, 'switchCharacter')
    ) {
      keybindings.release(this.input, 'switchCharacter');
      this.trySwitchActive();
    }

    // Whatever owns the screen has already had this press: the keydown handler
    // runs the claim registry's advance chain before anything here. Withholding
    // it is what keeps the world behind an overlay from seeing it too — without
    // this, the press that turned a conversation's page also re-opens that same
    // conversation, and then swings at the person having it.
    //
    // Withheld rather than `input.clear()`-ed, because the one overlay that
    // reaches this line is the one the player has to be able to *walk away*
    // from: clearing would drop the movement keys too, and the conversation
    // ends only when they have walked off.
    //
    const overlayOwnsInteract = focusedOverlay(this.overlayClaims) !== null;
    const interactPressed = (): boolean =>
      this.interactArmed && !overlayOwnsInteract && keybindings.isHeld(this.input, 'attack');

    // Safe room: whichever of the Bopca and Mordecai is nearer. Only consume
    // Space when actually acting, so an unrelated press can still fall through
    // to talking to an ambient occupant sharing the room.
    const safeRoomSpeaker = safeRoomSpeakerFor(this.bopca, this.safeRoom, player);
    if (
      this.bopca !== null &&
      safeRoomSpeaker === 'bopca' &&
      interactPressed() &&
      this.bopca.tryInteract(player)
    ) {
      keybindings.release(this.input, 'attack');
    }

    if (
      interactPressed() &&
      this.currentFloor === TOWER_CONFRONTATION_FLOOR &&
      this.towerConfrontation?.tryExamine(player) === true
    ) {
      keybindings.release(this.input, 'attack');
    }

    if (safeRoomSpeaker === 'mordecai' && interactPressed()) {
      keybindings.release(this.input, 'attack');
      this.talkToMordecai(player);
    }

    // Store: open the shop when standing at the counter. Closing is the ladder's
    // job, through the same edge-triggered helper every other interior panel
    // uses — the key that opens one is the key that shuts it.
    if (this.shop !== null && interactPressed() && this.shop.isNearShopkeeper(player)) {
      keybindings.release(this.input, 'attack');
      this.shop.shopOpen = true;
      this.beginModalGrace();
    }

    // Club: talk to a station NPC (Clarabelle, bar, casino, …) with Space.
    // Only consume when a station actually answered, so a press beside an
    // ambient occupant still reaches the conversation below.
    if (
      this.club !== null &&
      interactPressed() &&
      this.club.handleInteract(player, this.inactive())
    ) {
      keybindings.release(this.input, 'attack');
    }

    // The tent's one interaction: the potion over the vine. Ahead of the swing
    // below, because the whole point of the room is that a swing is the wrong
    // answer here.
    if (interactPressed() && this.bigTopMaze?.tryInteract(this.buildSystemContext()) === true) {
      keybindings.release(this.input, 'attack');
    }

    if (interactPressed() && this.tryGroundPickup(player)) {
      keybindings.release(this.input, 'attack');
    }

    // Ambient occupants: talk to the nearest one with Space
    if (interactPressed() && this.tryTalkToOccupant(player)) {
      keybindings.release(this.input, 'attack');
    }

    // Readables sit on furniture the occupants stand beside, so this runs after
    // the talk above: a person in reach always wins the same press.
    //
    // The press is deliberately *not* cleared. The panel's own early-return owns
    // every frame after, and leaving the key alone is what lets
    // `consumeModalClose` see the player's real hold — a clear here would fake a
    // release and the page would shut on the first auto-repeat. Which is why the
    // swing below has to be told about it separately.
    const openedReadable = interactPressed() && this.tryReadNearby(player);

    // Examine/search/use, same non-clearing press as the readable above, and
    // only tried once nothing readable answered it.
    const openedPropInteraction =
      !openedReadable && interactPressed() && this.tryInteractWithPropNearby(player);

    // Last of the conversations, as outdoors: the hire stands at the party's
    // shoulder the whole visit, so a counter, a quest giver, a citizen or a page
    // within reach is what a press is meant for. Refused while a fight is on.
    if (
      !openedReadable &&
      !openedPropInteraction &&
      interactPressed() &&
      this.mercenarySystem.tryTalk(player, this.world.roster.mobs)
    ) {
      keybindings.release(this.input, 'attack');
    }

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();
    this.safeRoom?.updateWander();
    this.bopca?.tick(this.human, this.cat, player, this.inactive());
    this.shop?.update();
    this.club?.update(this.active(), this.inactive());
    this.occupants?.update();
    this.syncPlumblineFarmRoom();
    this.applyResidentQuestMarkers();
    for (const hook of this.residentQuestHooks) hook.update();
    this.ambientSound?.updateListener(player.x, player.y);
    if (this.shop?.purchasePending) {
      this.shop.purchasePending = false;
      this.audio?.play('purchase_success');
    }

    // Exit tile detection
    const ptx = Math.floor((player.x + TILE_SIZE * TILE_CENTER_RATIO) / TILE_SIZE);
    const pty = Math.floor((player.y + TILE_SIZE * TILE_CENTER_RATIO) / TILE_SIZE);
    const wasOnExit = this.onExitTile;
    this.onExitTile = this.map._interiorExitTiles.some((t) => t.x === ptx && t.y === pty);
    if (!this.onExitTile) {
      this.exitDismissed = false;
    } else if (!wasOnExit && !this.exitDismissed) {
      this.exitMenuOpen = true;
    }

    // Tower stair detection
    this.towerStairs?.detect(player);

    // Last claim on the interact key: every interaction above clears the input
    // when it consumes the press, so a swing only happens where there was
    // nothing to talk to, buy from or read.
    if (!openedReadable && !scriptOwnsParty && interactPressed()) {
      keybindings.release(this.input, 'attack');
      triggerPlayerAttack(this.human, this.cat, this.world.roster.grid, this.map, this.audio);
    }

    this.updateCombat();
    this.updateCompanionKnockout();

    // Last, so the frame that ends the tent's cutscene finishes before the scene
    // that replaces this one is built out of the party it was still moving.
    if (this.bigTopMaze?.exitPending === true) {
      this.bigTopMaze.exitPending = false;
      this.doExit();
    }
  }

  /**
   * The tent's own cues, played in the order its script raised them, and any
   * coins it owes.
   *
   * Drained whether or not there is anything to play it on. A muted run — the
   * headless gate is one — still raises a cue every time a vent lights, and a
   * queue nobody empties grows for the length of the session.
   */
  private drainMazeQueues(): void {
    const maze = this.bigTopMaze;
    if (maze === null) return;
    const audio = this.audio;
    for (const cue of maze.drainSounds()) {
      audio?.play(cue.id, cue.volume === undefined ? undefined : { volume: cue.volume });
    }
    // The encore's coins are Carl's: the pivots that aim the light are his.
    // Dropped rather than credited, so they fall from the star and land first.
    for (const reward of maze.drainRewards()) {
      this.destruction.loot.addLoot(
        reward.tile.x * TILE_SIZE,
        reward.tile.y * TILE_SIZE,
        { coins: reward.coins, items: [] },
        this.human,
        false,
        false,
        true,
      );
    }
  }

  /**
   * The floor's combat frame, run in every building rather than only where a
   * quest fight lives. With an empty roster every step below is a no-op over
   * empty arrays, which is what makes universal combat free.
   */
  /**
   * The per-frame shared state every system on this storey reads.
   *
   * Built on demand rather than kept as a field because half of it — who is
   * active, whether they are moving — is only true for the frame it is asked
   * on, and a cached copy would be answering last frame's question.
   *
   * `bossRoom` is deliberately absent: an interior has none, and the
   * companion's boss-room veto answers "no room, no veto" — which is right,
   * since a quest fight indoors only exists once it has started.
   */
  private buildSystemContext(): SystemContext {
    const active = this.active();
    return {
      human: this.human,
      cat: this.cat,
      active,
      inactive: this.inactive(),
      activeIsMoving: active.isMoving,
      roster: this.world.roster,
      gameMap: this.map,
      extraTargets: this.companionTargets(),
      crawlerBarks: this.crawlerBarks,
    };
  }

  private updateCombat(): void {
    const combat = this.combat;
    const ctx = this.buildSystemContext();
    const active = ctx.active;

    const destruction = this.destruction;

    this.tickSkillPointReminder(ctx);
    this.tickSaveIndicator();

    // Ahead of the swings it decides on.
    this.companion.update(ctx);
    if (this.cat.pendingAutoFireSound) {
      this.cat.pendingAutoFireSound = false;
      this.audio?.play('cat_missile_fire', { volume: CAT_MISSILE_VOLUME });
    }

    combat.updatePlayerAttacks();
    setVisibleWorldView(
      cameraWorldView(
        this.computeCamera(this.map),
        null,
        viewportHeight() - this.viewportBottomInset(),
      ),
    );
    combat.updateMobs(ctx);
    this.activeEncounter?.update(ctx);
    // Beside the update that sets it, and ahead of next frame's companion pass:
    // a burnout moves both crawlers itself, but the anchors are the scene's to
    // fix, and an anchored companion still pointing at a corridor walks straight
    // back into the fire that just took them.
    if (this.bigTopMaze?.partyResetPending === true) {
      this.bigTopMaze.partyResetPending = false;
      this.companion.anchorBoth(this.human, this.cat);
      // Companions go back with the crawlers: a pet left mid-crossing is on the
      // far side of a curtain the party has just been sent back behind.
      carryCompanions(this.carriedCompanions(), this.world.roster, this.world.roster, this.map);
      // The party is no longer standing where the offer was made. A burnout can
      // land on the same frame the active crawler steps onto an exit mat — the
      // parked one is what burned — and the menu that opened would then be a
      // question about a doorway two tiles from anybody, stacked over the box
      // explaining why they moved.
      this.exitMenuOpen = false;
    }
    this.drainMazeQueues();
    combat.drainMobAudioCues(this.audio);

    this.interiorPropDestruction?.setActivePlayer(active);
    combat.resolvePlayerAttacks({
      destructibles: destruction.destructibles,
      interiorProps: this.interiorPropDestruction ?? undefined,
    });
    // Before kills are resolved: a companion's lethal hit is intercepted here,
    // or it runs the whole kill path and pays the party for its own pet.
    this.mongoSystem.checkHealth();
    this.mercenarySystem.checkHealth((merc) => combat.spawnKillGore(merc, null));
    combat.resolveKills();
    combat.resolveSpellAftermath();
    // Also where his off-duty recovery ticks, and so only while he is not out,
    // and never behind any of the world-halting returns in `update`.
    this.mongoSystem.update(ctx);
    this.autoSummonMongo(ctx);
    if (this.mercenaryRoster.active !== this.hireContract) {
      this.hireContract = this.mercenaryRoster.active;
      this.mercenarySystem.onContractChanged(ctx.roster.mobs, ctx.roster.grid);
    }
    this.mercenarySystem.update(ctx);
    this.drainWardExplainerBarks();
    this.crawlerBarks.update();
    this.breakReactions.update();
    this.noteHostileRoomsCleared();
    combat.playerTick.tickRegen(this.human, this.cat);
    // Auto-potion only while something in the room is actually trying to kill
    // them. It exists to keep a companion standing through a fight; in a shop it
    // is a consumable spent on a wound the regen above was about to close.
    if (this.world.roster.mobs.some((mob) => mob.isAlive && mob.isHostile)) {
      combat.playerTick.tickAutoPotion(this.human, this.cat);
    }
    combat.updatePostCombat(this.audio);
    // Summons first, so a skeleton raised this frame is already in the roster the
    // projectile system walks — a wave and the bolts covering it land on one tick.
    this.rockThrows.update(ctx);
    this.hirelingShots.update(ctx);
    this.skeletonSummons.update(ctx);
    this.fairies.update(ctx);
    this.skeletonShots.update(ctx);
    this.drainCasterAudioCues();
    destruction.update(ctx);
    if (destruction.drainAudioCues(this.audio)) {
      // A hearth or brazier that has just been smashed is floor now, and the
      // emitters were scanned off the layout before it was — left alone, the
      // fire keeps crackling from bare boards for the rest of the visit.
      this.ambientSound?.setEmitters(this.buildAmbientEmitters());
    }
    this.interiorPropDestruction?.update();
    this.drainInteriorPropBreaks();

    if (!active.isAlive) this.raiseDeathScreen();
  }

  /**
   * Plays a break's cue and, if the room is occupied, lets the nearest
   * occupant react — the consequence side of breaking things in someone's
   * building (the loot itself was already rolled when the prop broke). The
   * reaction is a bubble over their head, never the conversation box: it
   * must not stop the fight or wait to be dismissed.
   */
  private drainInteriorPropBreaks(): void {
    if (this.interiorPropDestruction === null) return;
    const breaks = this.interiorPropDestruction.drainBreaks();
    if (breaks.length === 0) return;
    this.interiorPropDestruction.playBreakCues(this.audio, breaks);
    this.breakReactions.react(breaks, this.occupants?.people ?? []);
  }

  private readonly breakReactions = new InteriorBreakReactionBarks();

  /**
   * The cues a caster's shots and summons leave behind.
   *
   * Drained here rather than with the rest of the mob audio because both outlive
   * the caster: a bolt that lands after the thing that fired it died has no mob
   * left to carry the flag, and the rise belongs to the skeletons coming out of
   * the floor rather than to whoever called them.
   */
  private drainCasterAudioCues(): void {
    playHirelingProjectileCues(this.rockThrows, this.hirelingShots, this.audio);
    if (this.skeletonShots.burstSoundPending) {
      this.skeletonShots.burstSoundPending = false;
      this.audio?.play('magic_ball_impact');
    }
    // A bone shaft does not go off, so it is a separate cue from the burst above
    // — the same frame can end one of each.
    if (this.skeletonShots.arrowImpactSoundPending) {
      this.skeletonShots.arrowImpactSoundPending = false;
      this.audio?.play('arrow_impact');
    }
    if (this.skeletonSummons.riseSoundPending) {
      this.skeletonSummons.riseSoundPending = false;
      this.audio?.play('bones_rattling');
    }
    playFairySystemCues(this.fairies.takeCues(), this.audio);
  }

  /**
   * A candidate for the shared arrow arbiter: the arrow to the loose soul
   * crystal, or to the stairs that climb toward it.
   */
  private soulCrystalArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): ArrowCandidate | null {
    if (this.gameOver || this.pauseMenu.isOpen || this.entry.type !== 'tower') return null;
    const upTiles = this.map._interiorStairUpTiles;
    const middleUpTile = upTiles[Math.floor(upTiles.length / 2)];
    const upStairs =
      upTiles.length === 0
        ? null
        : {
            x: (middleUpTile.x + STAIR_TILE_CENTRE) * TILE_SIZE,
            y: (middleUpTile.y + STAIR_TILE_CENTRE) * TILE_SIZE,
          };
    return this.soulCrystal.guidanceArrowCandidate(
      ctx,
      camX,
      camY,
      this.active(),
      this.currentFloor === TOWER_CONFRONTATION_FLOOR,
      upStairs,
    );
  }

  /**
   * The interior's own defeat, whatever killed the party: the quest fight that
   * owns the room if there is one, and otherwise the room itself — a building
   * with a hostile in it can kill you, and dropping the party back on the
   * doorstep at nought hit points to die again outside is not an ending.
   */
  private raiseDeathScreen(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameStats.recordDeath();
    // A death arrives from the fight, not from a key or a click, so nothing else
    // here has taken the keyboard off a bag left open behind it.
    this.menus.cancelInventoryDragForOverlay();
    this.combat.deathScreen.activate(this.deathScreenMessage(), this.defeatRespawnMode);
  }

  /**
   * What the death screen says.
   *
   * An encounter's own `defeatMessage` is the room's voice, and it is the right
   * answer for a fight the room staged — but not for a hazard that names itself,
   * which is one specific way to die with one specific thing to say about it. A
   * crawler can walk in already burning or poisoned and go down to that rather
   * than to anything in the room. So a named hazard wins; anything else falls
   * back to the room, and then to the building.
   */
  private deathScreenMessage(): string {
    const fallen =
      this.human.isActive && !this.human.isAlive
        ? this.human
        : this.cat.isActive && !this.cat.isAlive
          ? this.cat
          : null;
    const source = fallen?.lastDamageSource ?? null;
    if (source !== null && source.kind === 'environmental') {
      return pickDeathExplanation(causeFromDamageSource(source));
    }
    return this.activeEncounter?.defeatMessage ?? INTERIOR_DEFEAT_MESSAGE;
  }

  /**
   * Death inside an encounter: hands the defeat to the overworld, which respawns
   * the party at the last save. The patch-up only matters on the fallback for a
   * floor with no save yet, which sets them down alive at the start tile. The
   * fight resets on re-entry.
   */
  private reviveAndExit(): void {
    for (const player of [this.human, this.cat]) {
      player.hp = Math.max(player.hp, Math.ceil(player.maxHp * INTERIOR_REVIVE_HP_FRACTION));
    }
    this.gameOver = false;
    this.doExit(true);
  }

  handleClick(mx: number, my: number): void {
    notifyButtonClick(mx, my);
    // Before the routing chain below, because most of its branches return long
    // before the bag is offered the click: a field left focused by a press that
    // opened a counter or the pause menu would go on eating that overlay's keys.
    this.menus.blurInventorySearchUnlessClicked(mx, my);
    // First, ahead of every HUD rect and world hit-test below: a long-press
    // context menu floats over whatever was drawn underneath it, and those
    // rects are tested by raw coordinates rather than draw order, so a menu
    // option sitting over the pause button or a shop counter would otherwise
    // also fire whatever is beneath it. The menu always closes on this click,
    // so it must always be the thing that answers it.
    if (this.menus.inventoryPanel.interaction.contextMenu !== null) {
      const invPlayer = this.inventoryPlayer();
      this.menus.inventoryPanel.handleClick(mx, my, invPlayer.inventory);
      return;
    }
    // Ranked above the death screen, matching both the claim registry and the
    // draw order: the award stack is painted on top of it, so a press aimed at
    // an OK button there must not reach the screen underneath.
    if (this.achievementUI.handleClick(mx, my)) return;
    if (this.menus.levelUpDialog.handleClick(mx, my)) return;
    if (this.menus.rewardGrantedDialog.handleClick(mx, my)) return;
    if (this.menus.mongoExplainer.handleClick(mx, my)) return;
    if (this.menus.craftExplainers.handleClick(mx, my)) return;
    if (this.menus.constructionMenu.handleClick(mx, my)) return;
    if (this.menus.itemQuantityPicker.handleClick(mx, my)) return;
    if (this.menus.skillBookPrompt.isOpen) {
      const reader = this.menus.pendingSkillBookReader(this.inventoryPlayer());
      if (resolveSkillBookPrompt(this.menus.skillBookFlowHost(), reader, mx, my) !== null) {
        this.menus.releaseSkillBookReader();
      }
      return;
    }
    if (this.gameOver) {
      if (this.combat.deathScreen.handleClick(mx, my)) this.reviveAndExit();
      return;
    }
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }
    if (this.followerMenu.isOpen) {
      this.followerMenu.handleClick(mx, my);
      return;
    }
    // With the other modals rather than at the end of the method, and above the
    // HUD chrome below it: its panel is viewport-centred and the bag's is too,
    // so a bag left open behind it swallows every press aimed at Exit or Stay —
    // and the exit menu locks the keyboard, so there is no key that could shut
    // the bag either.
    if (this.exitMenuOpen) {
      this.handleExitMenuClick(mx, my);
      return;
    }
    // Pause button (works on desktop + mobile)
    const btn = this.mobileHUD.hitTest(mx, my);
    if (btn === 'pause') {
      this.pauseMenu.toggle();
      return;
    }
    // With the rest of the HUD chrome, above every world hit-test below: those
    // compare screen coordinates against loot on the floor, so anything drawn
    // behind the banner would otherwise take a click aimed at it.
    if (this.menus.tryOpenSpendScreen(mx, my, this._hudSkillBannerRect)) return;
    if (this.towerStairs?.menuOpen) {
      this.towerStairs.handleClick(mx, my);
      return;
    }
    if (this.shop?.shopOpen) {
      this.shop.handleClick(mx, my);
      return;
    }
    if (this.club?.modalOpen) {
      this.club.handleClick(mx, my, this.active(), this.inactive());
      return;
    }
    if (this.bigTopMaze?.isDialogOpen === true) {
      this.bigTopMaze.handleClick(mx, my);
      return;
    }
    if (this.towerConfrontation?.isDialogOpen === true) {
      this.towerConfrontation.handleClick(mx, my);
      return;
    }
    const questHook = this.openResidentQuestHook();
    if (questHook !== null) {
      questHook.handleClick(mx, my);
      return;
    }
    if (this.servicePanel?.isOpen === true) {
      this.servicePanel.handleClick(mx, my, this.active(), this.inactive());
      return;
    }
    if (this.readingPanel?.isOpen === true) {
      this.readingPanel.handleClick(mx, my, this.active(), this.inactive());
      return;
    }
    if (this.readablePanel.handleClick()) {
      return;
    }
    // Only the dialog's own box is consumed: a conversation does not halt the
    // world, so the bag can be open underneath it and its slots must stay live.
    if (this.conversation.handleClick(mx, my)) {
      return;
    }
    if (!this.menus.panelCovers(mx, my) && this.tryPressSummonButton(mx, my)) return;
    // Below every panel branch above, which is where they are drawn: a shop's
    // Buy column can sit over the Build button on a phone.
    if (!this.menus.panelCovers(mx, my) && this.tryPressColumnPieces(mx, my)) return;

    const invPlayer = this.inventoryPlayer();
    const active = this.active();
    if (this.menus.gearPanel.handleClick(mx, my, active.inventory)) {
      active.onEquipmentChanged();
      return;
    }
    // Both panels open is the equip flow: a click on an armour slot in the bag
    // puts it on rather than picking it up.
    if (this.menus.gearPanel.isOpen && this.menus.inventoryPanel.isOpen) {
      const slotIdx = this.menus.inventoryPanel.getClickedInventorySlot(
        mx,
        my,
        invPlayer.inventory,
      );
      const item = slotIdx === null ? null : invPlayer.inventory.bag.slots[slotIdx];
      if (
        slotIdx !== null &&
        isWearable(item) &&
        this.menus.inventoryPanel.interaction.bagSlotIsInteractive(item)
      ) {
        // The click is spent either way — it was aimed at armour — but a refusal
        // (wrong wearer, same id already worn) changes nothing, and announcing
        // a change that never happened is a lie to every listener.
        if (invPlayer.inventory.canEquipSlot(slotIdx)) {
          invPlayer.inventory.equip(slotIdx);
          invPlayer.onEquipmentChanged();
        }
        return;
      }
    }
    const wasInventoryOpen = this.menus.inventoryPanel.isOpen;
    if (this.menus.inventoryPanel.handleClick(mx, my, invPlayer.inventory)) {
      if (this.menus.inventoryPanel.isOpen && !wasInventoryOpen) {
        this.menus.gearPanel.isOpen = false;
      }
      return;
    }

    const { x: camX, y: camY } = this.computeCamera(this.map);
    if (
      this.destruction.loot.tryCollectLootAt(mx, my, camX, camY, this.active(), this.inactive())
    ) {
      return;
    }
  }

  /**
   * Exit or Stay, dispatched through the hit-rects `renderExitMenu` registered.
   *
   * The registered rects rather than a second call to `menuRects()`: the focus
   * ring activates a button by synthesizing a click at the rect the *render*
   * produced, so a click path measuring its own geometry is a second list that
   * can disagree with the one the keyboard aims at.
   */
  private handleExitMenuClick(mx: number, my: number): void {
    for (const button of this.exitMenuButtons) {
      if (pointInRect(mx, my, { x: button.x, y: button.y, w: button.w, h: button.h })) {
        button.action?.();
        return;
      }
    }
  }

  /** Stay: shut the menu and remember the refusal until the player steps off the mat. */
  private closeExitMenu(): void {
    this.exitMenuOpen = false;
    this.exitDismissed = true;
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

  /** The buy panel currently open, whether the shop floor's own or one of the club's. */
  private get scrollableShop(): ShopSystem | null {
    if (this.shop?.shopOpen === true) return this.shop;
    return this.club?.openShop ?? null;
  }

  handleWheel(deltaY: number): void {
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleWheel(deltaY);
      return;
    }
    if (this.followerMenu.isOpen) {
      this.followerMenu.handleWheel(deltaY);
      return;
    }
    this.scrollableShop?.handleWheel(deltaY);
    this.servicePanel?.handleWheel(deltaY);
  }

  handleMouseDown(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = true;
    // Ahead of everything below: the explainer opens over the pause menu, and a
    // press there must not start a drag or a scroll in the surface underneath.
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    const openShop = this.scrollableShop;
    if (openShop !== null) {
      openShop.handlePointerDown(mx, my);
      return;
    }
    // Delegated rather than swallowed: the pause menu's Equipment tab drags gear
    // between the bag and the doll, and a drag is a press and a release, not a
    // click. Every other tab ignores these.
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleMouseDown(mx, my, this.human, this.cat);
      return;
    }
    // Ahead of the blocking-overlay return below, which the picker's own
    // `isOpen` feeds into: without this branch a press on its step buttons
    // would never reach them.
    if (this.menus.itemQuantityPicker.isOpen) {
      this.menus.itemQuantityPicker.handlePointerDown(mx, my);
      return;
    }
    if (this.isOverlayBlockingPointer) return;
    this.mobileHUD.handleMouseDown(mx, my, this.inventoryPlayer().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    this.scrollableShop?.handlePointerMove(mx, my);
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleMouseMove(mx, my, this.human, this.cat);
      return;
    }
    this.mobileHUD.handleMouseMove(mx, my, this.inventoryPlayer().inventory);
    this.menus.gearPanel.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = false;
    this.scrollableShop?.handlePointerUp();
    this.menus.itemQuantityPicker.handlePointerUp();
    if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) return;
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleMouseUp(mx, my, this.human, this.cat);
      return;
    }
    if (this.isOverlayBlockingPointer) return;
    this.mobileHUD.handleMouseUp(mx, my, this.inventoryPlayer().inventory);
  }

  handleContextMenu(mx: number, my: number): void {
    // Read off the claim registry like every other pointer path in this scene:
    // a context menu opened under a shop or a ledger is drawn beneath it, so the
    // player never sees it and the next click is eaten resolving something
    // invisible.
    if (this.isOverlayBlockingPointer || worldHalted(this.overlayClaims)) return;
    this.menus.inventoryPanel.openContextMenu(mx, my, this.inventoryPlayer().inventory);
  }

  /**
   * `mouseup` only fires on the canvas, so a press that is released off it would
   * otherwise leave a button stuck in its held state forever.
   */
  handleMouseLeave(): void {
    this._mouseDown = false;
    this.scrollableShop?.handlePointerUp();
    this.menus.itemQuantityPicker.handlePointerUp();
    clearButtonMouseState();
  }

  private doExit(defeated = false): void {
    // Before the snapshot, not after: `onExit` runs only once the replacement
    // scene has already been built from these snapshots, so a refund credited
    // there lands on a Player object that is about to be discarded. The
    // blackjack table debits chips the moment they hit the felt, so a teardown
    // under an open table would otherwise cost the player real coins.
    this.club?.closeAll(this.active());
    // Every floor, not just the one being left from: a tower's storeys are all
    // discarded together, and a pile left two flights down is as gone as one by
    // the door. The interior map is regenerated on the next entry, so anything
    // still lying on it ceases to exist the moment this scene is replaced.
    for (const floor of this.floors) {
      floor.destruction.loot.sweepUncollected(this.pm.players());
    }
    // God mode rides on top of base stats rather than being folded into them, so
    // snapshots are already clean and the overworld can re-apply its own overlay.
    // Read before the dismiss that clears it; the dismiss writes his remaining
    // health into the pet state the next scene rebuilds him from.
    const companions = this.companionDeparture();
    this.mongoSystem.dismiss(this.world.roster.mobs, this.world.roster.grid);
    // Writes the hire's health into the roster the next scene stands it up
    // from; a hire lying downed at the door is lost with the room.
    this.mercenarySystem.dismissForTransition(this.world.roster.mobs, this.world.roster.grid);
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    this.onExitCallback(humanSnap, catSnap, defeated, companions);
  }

  /**
   * Hangs each questline's glyph over the residents it has business with —
   * Hilda or Deacon Aviel for the Anchor, Wendell for the blueprints — the
   * first hook in priority order with an opinion winning.
   *
   * A hook answers `null` for everybody it has no business with, so this can
   * never wipe a marker some other system put on a citizen — a marker is only
   * ever written by whoever claims that citizen.
   */
  private applyResidentQuestMarkers(): void {
    if (this.residentQuestHooks.length === 0 || this.occupants === null) return;
    for (const person of this.occupants.people) {
      if (person.residentId === null) continue;
      const marker = firstResidentMarker(this.residentQuestHooks, person.residentId);
      if (marker !== null) person.markerType = marker;
    }
  }

  private syncPlumblineFarmRoom(): void {
    this.plumblineFarmRoom?.sync(this.briarHollowState.blueprints.phase, [this.human, this.cat]);
  }

  /** The resident quest hook whose conversation is on screen, or null when none is. */
  private openResidentQuestHook(): ResidentQuestHook | null {
    return this.residentQuestHooks.find((hook) => hook.isDialogOpen) ?? null;
  }

  /** Whether any resident questline's conversation is on screen. */
  private residentQuestDialogOpen(): boolean {
    return this.openResidentQuestHook() !== null;
  }

  /** Escape on a resident questline's conversation. Returns whether there was one. */
  private dismissResidentQuestDialog(): boolean {
    return this.openResidentQuestHook()?.dismissDialog() === true;
  }

  /**
   * Each resident questline's first refusal on talking to `residentId`, in
   * priority order. Returns whether one opened a beat and took the press.
   */
  private tryResidentQuestDialog(residentId: ResidentId, talker: Player): boolean {
    return this.residentQuestHooks.some((hook) => hook.tryOpenDialog(residentId, talker));
  }

  /** The `R` press indoors: Old Hilda's repairs, and nothing else so far. */
  private triggerAnchorRepair(): boolean {
    return this.anchorInterior?.tryRepair(this.active()) ?? false;
  }

  /**
   * An interact press or world tap made while a conversation the player can
   * walk away from is up, offered to whoever else they have walked up to
   * first — see `Conversation.handOff`. Only while that conversation is the one
   * overlay open: any panel over it owns the press outright. Indoors the other
   * speakers are the safe room's two and the occupants; the rest of the room's
   * interactions are furniture, not someone to turn to.
   */
  private handOffConversationPress(): boolean {
    if (!this.conversation.isOpen) return false;
    const openOverlays = this.overlayClaims.filter((claim) => claim.isOpen);
    if (openOverlays.length !== 1) return false;
    const player = this.active();
    const pressIsForSomeoneElse = safeRoomPressLeavesSpeaker(this.bopca, this.safeRoom, player);
    return this.conversation.handOff(
      player,
      pressIsForSomeoneElse,
      () => this.trySafeRoomPress(player) || this.tryTalkToOccupant(player),
    );
  }

  /** Whichever of the Bopca and Mordecai is nearer. Returns whether either took the press. */
  private trySafeRoomPress(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    const speaker = safeRoomSpeakerFor(this.bopca, this.safeRoom, player);
    if (speaker === 'bopca') return this.bopca?.tryInteract(player) === true;
    if (speaker === 'mordecai') {
      this.talkToMordecai(player);
      return true;
    }
    return false;
  }

  /**
   * Opens a conversation with the nearest ambient occupant in range — or the
   * building's service menu, when that occupant is the one who sells here.
   * Returns whether something opened, so the caller can consume the triggering
   * input. Shared by the desktop Space path and the mobile tap path so occupants
   * are talkable on both.
   *
   * A named resident who also runs the service tells their story first: the
   * lore conversation plays, and its `ending` opens the menu the moment it is
   * read, so a player who came in for a drink is never more than one
   * dismissal from one.
   */
  private tryTalkToOccupant(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    if (this.occupants === null) return false;
    const target = this.occupants.findTalkTarget(player.x, player.y);
    if (target === null || target === this.citizenDialogTarget) return false;
    target.faceToward(player.x, player.y);

    const ctx = this.townDialogContext();
    const inDanger = isTownInDanger(ctx);
    const resident = target.residentId === null ? null : residentById(target.residentId);
    const service = interiorServiceForRole(this.entry.name, target.role);
    const sellsHere = service !== undefined;
    const turn = this.turnFor(target);

    // A resident questline outranks even a resident's own untold lore — Hilda,
    // Aviel and Wendell are otherwise still finishing their first-meeting
    // flavor lines (`hasUntoldLore`) for several visits, and a player who has
    // just been asked to fetch boards, clear rats or borrow blueprints should
    // not have to sit through small talk to hear the thing they came for.
    if (resident !== null && this.tryResidentQuestDialog(resident.id, player)) {
      this.noteTalk(target, inDanger);
      return true;
    }

    if (sellsHere && !this.hasUntoldLore(target)) {
      this.openService(turn, resident, target.role);
      this.noteTalk(target, inDanger);
      return true;
    }

    const line =
      resident !== null
        ? buildResidentConversation(resident, turn, ctx)
        : buildCitizenConversation(
            target.role,
            citizenSpecies(target),
            target.dialogSeed,
            turn,
            ctx,
          );
    // Frozen in place for the same reason street citizens are: the conversation
    // ends when the *player* walks off, which only holds if the other party
    // stays put.
    target.frozen = true;
    const facing = target.facingXY();
    prewarmAndPinCitizenTalk(target.figure, facing.x, facing.y);
    this.conversation.open({
      lines: [line],
      reward: null,
      questRelated: false,
      ending: {
        kind: 'close',
        onClosed: () => {
          this.releaseCitizenDialogTarget();
          if (sellsHere) this.openService(turn, resident, target.role);
        },
      },
      dismiss: { kind: 'allowed', onDismissed: () => this.releaseCitizenDialogTarget() },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: target.x, y: target.y }),
        talkRangeTiles: CITIZEN_TALK_RADIUS_TILES,
      },
      locksKeyboard: true,
    });
    // Only once `open` has run: an occupant this press was handed on from is
    // released by that call, through `releaseCitizenDialogTarget`, and must
    // still be the one it finds there.
    this.citizenDialogTarget = target;
    this.noteTalk(target, inDanger);
    return true;
  }

  /**
   * How many conversations this occupant has already had with the player.
   *
   * A named resident's count comes from `TownMemory`, which outlives the scene:
   * the whole point of a lore list is that it advances across visits, and this
   * scene — along with every `Townsperson` in it — is rebuilt every time the
   * door opens. An unnamed extra has nothing worth remembering, so their count
   * stays on the figure and resets with the room.
   */
  private turnFor(target: Townsperson): number {
    if (target.residentId === null) return target.conversationCount;
    return residentTalkCount(this.townMemory, target.residentId);
  }

  /**
   * Counts a conversation, unless the town is in danger — a panicking one-liner
   * is not a conversation, and counting it would burn a lore entry the player
   * never got to hear.
   */
  private noteTalk(target: Townsperson, inDanger: boolean): void {
    if (inDanger) return;
    if (target.residentId === null) {
      target.conversationCount++;
      return;
    }
    noteResidentTalk(this.townMemory, target.residentId);
  }

  /**
   * Whether the interact key is asking to close the open interior modal.
   *
   * Edge-triggered rather than level-triggered: the key must be seen released
   * before a press counts, so the press that opened the panel — and every
   * auto-repeat of it — is ignored while the player keeps holding it.
   */
  private consumeModalClose(): boolean {
    if (this.modalGraceFrames > 0) return false;
    if (!keybindings.isHeld(this.input, 'attack')) {
      this.modalCloseArmed = true;
      return false;
    }
    if (!this.modalCloseArmed) return false;
    this.modalCloseArmed = false;
    keybindings.release(this.input, 'attack');
    // Disarmed for the same reason a consumed overlay press is: this press is
    // spent, and without saying so the browser's next auto-repeat would hand the
    // same hold to the interaction chain, which would re-open the panel that
    // just closed. Only a real release or a new press re-arms.
    this.interactArmed = false;
    return true;
  }

  private releaseCitizenDialogTarget(): void {
    if (this.citizenDialogTarget === null) return;
    this.citizenDialogTarget.frozen = false;
    this.citizenDialogTarget = null;
  }

  /**
   * Opens whatever the NPC in `role` does here — a priced menu almost
   * everywhere, a reading in Old Hilda's kitchen.
   *
   * Keyed on the role rather than on the building, because a building may run
   * more than one counter and the player walked up to exactly one of them.
   */
  private openService(turn: number, resident: ResidentDef | null, role: TownRole): void {
    const service = interiorServiceForRole(this.entry.name, role);
    if (service === undefined) return;
    // A resident questline gets the counter first, exactly as the Anchor gets
    // Madame Voss's Consult prompt first out on the plaza: while it has
    // something to say, Hilda reads no cards and Aviel sells no blessings.
    if (resident !== null && this.tryResidentQuestDialog(resident.id, this.active())) {
      this.beginModalGrace();
      return;
    }
    if (service.surface === 'reading') {
      if (this.readingPanel === null) return;
      this.readingPanel.openWith(this.townDialogContext(), HEDGE_WITCH);
      this.beginModalGrace();
      this.audio?.play('menu_open');
      return;
    }
    if (this.servicePanel === null) return;
    this.openServiceMenu(this.servicePanel, turn, residentHost(resident, turn), role);
    this.beginModalGrace();
    this.audio?.play('menu_open');
  }

  /**
   * Starts the window in which a newly-opened modal ignores the interact key.
   * Every path that opens one goes through here, including the ones whose caller
   * already released the interact key — that release is exactly the protection
   * this mechanism exists because it does not provide.
   */
  private beginModalGrace(): void {
    this.modalGraceFrames = MODAL_REOPEN_GRACE_FRAMES;
    this.modalCloseArmed = false;
  }

  /**
   * Fill the service panel with whatever this building sells. Each builder returns
   * both the rows and the handler that performs the service, so the two can never
   * drift apart.
   *
   * Switched on the building's name, and — inside a branch whose building runs
   * more than one priced counter — on the role of the NPC the player walked up
   * to. `openService` has already resolved that role from the talk target, so
   * this never has to guess which counter is in front of the player.
   */
  /**
   * A Sell tab for a building service that trades in actual goods, keyed off
   * this scene's own `marketStock` — the same held-stock store the General
   * Store and the Desperado Club's counters already use — so a sale here and
   * a sale at the General Store never share a shelf.
   */
  private sellConfigFor(vendorId: string, pricing: ShopPricingProfile): SellConfig {
    return {
      pricing,
      heldStock: this.marketStock.held,
      vendorId,
      onSold: () => this.audio?.play('purchase_success'),
    };
  }

  private openServiceMenu(
    panel: PricedMenuPanel,
    turn: number,
    host: ResidentHost | null,
    role: TownRole,
  ): void {
    const party = [this.human, this.cat];
    // Every service confirms with the same purchase chime; a counter that has a
    // sound of its own layers that underneath, so a round sounds like a round
    // and a rented room sounds like the door closing behind you.
    const POUR_CUE = 'ambient_pouring_a_drink';
    const never = (): SoundId | null => null;
    const always = (): SoundId | null => POUR_CUE;
    const confirmed = (
      handler: PricedPurchaseHandler,
      cue: (option: PricedOption) => SoundId | null,
    ): PricedPurchaseHandler => {
      return (option, buyer) => {
        const result = handler(option, buyer);
        if (!result.ok) return result;
        const layered = cue(option);
        if (layered !== null) this.audio?.play(layered);
        this.audio?.play('purchase_success');
        return result;
      };
    };

    switch (this.entry.name) {
      case 'Temple of the Sky':
        panel.open(
          () => buildBlessingMenu(party, turn, host),
          confirmed(() => ({ ok: true, line: grantBlessing(party, turn) }), never),
        );
        return;
      case 'The Quiet Needle':
        // Rebuilt per purchase, so inking one stat design marks the other stat
        // designs as spent — and the skill mark as spent independently of them.
        panel.open(() => buildTattooMenu(this.active(), turn, host), confirmed(inkTattoo, never));
        return;
      case 'The Barracks':
        // The garrison's two counters. Split on role rather than on anything the
        // room can be asked, because both stand in the same building and only
        // the NPC the player talked to says which one they are at.
        if (role === 'guard') {
          panel.open(
            () => buildDrillYardMenu(this.active(), turn, host),
            confirmed(runDrill, never),
          );
          return;
        }
        panel.open(
          () => buildArmouryMenu(turn, host),
          confirmed(issueArmour, never),
          undefined,
          undefined,
          0,
          this.sellConfigFor('armoury', ARMOURY_PRICING),
        );
        return;
      case 'Herb & Remedy':
        panel.open(
          () => buildApothecaryMenu(party, this.townMemory, turn, host),
          confirmed(serveRemedy(party, this.townMemory), never),
          undefined,
          undefined,
          0,
          this.sellConfigFor('apothecary', APOTHECARY_PRICING),
        );
        return;
      case 'The Rusty Anvil':
        panel.open(
          () => buildSmithyMenu(party, this.active(), turn, host),
          confirmed(sharpenEdges(party, turn), never),
        );
        return;
      case "Cartwright's Workshop":
        panel.open(
          () => buildCartwrightMenu(turn, host),
          confirmed(sellCartwrightGoods(turn), never),
          undefined,
          undefined,
          0,
          this.sellConfigFor('cartwright_workshop', MERCHANT_STALL_PRICING),
        );
        return;
      case "Miller's Farm":
        panel.open(
          () => buildMillerMenu(this.active(), turn, host),
          confirmed(serveMillerGoods(turn), never),
          undefined,
          undefined,
          0,
          this.sellConfigFor('millers_farm', FARMER_PRICING),
        );
        return;
      case 'Plumbline Farm':
        panel.open(
          () => buildPlumblineFarmMenu(party, turn, host),
          confirmed(servePlumblineFarmRest(party, turn), never),
        );
        return;
      case 'The Sleeping Cat Inn':
        panel.open(
          () =>
            buildInnMenu(
              this.entry.name,
              this.active(),
              turn,
              host,
              isTownInDanger(this.townDialogContext()),
            ),
          // A round off the kitchen board pours; a room gets the safe room's own
          // cue instead, because that is what the player just bought a night of.
          confirmed(serveInn(this.entry.name, party, turn), (option) =>
            isInnRoomKey(option.key) ? 'entered_safe_room' : POUR_CUE,
          ),
        );
        return;
      default:
        panel.open(
          () => buildTavernMenu(this.entry.name, this.active(), turn, host),
          confirmed(serveDrinkAt(this.entry.name), always),
        );
    }
  }

  /**
   * Mordecai's answer, from the highest-ranked source that has one: his floor
   * advice while anything is left to do, the AI chat once the floor is clear.
   *
   * The tutorial's Mordecai never runs in here — it only exists in the dungeon —
   * so this is the two-way version of the dungeon's three-way chain.
   */
  private talkToMordecai(active: { x: number; y: number }): void {
    if (this.safeRoom === null) return;

    const line = this.mordecaiAdvisor.nextAdvice(this.circusAdviceSnapshot());
    if (line !== null) {
      this.safeRoom.openMordecaiLine(active, line);
      return;
    }

    const humanEvents = this.humanAchievements.getTopRecentEvents(RECENT_EVENTS_LIMIT);
    const catEvents = this.catAchievements.getTopRecentEvents(RECENT_EVENTS_LIMIT);
    const merged = [...humanEvents, ...catEvents]
      .sort((a, b) => a.secondsAgo - b.secondsAgo)
      .slice(0, RECENT_EVENTS_LIMIT);
    this.safeRoom.openMordecaiDialog(
      active,
      aiAdapter.chatWithMordecai({
        recentEvents: merged,
        humanLevel: this.human.level,
        catLevel: this.cat.level,
      }),
    );
  }

  /**
   * The floor-3 objective, measured from the door the player walked in through.
   *
   * `this.map` is the interior's own 22x16 grid with its own origin, so nothing
   * in this scene's coordinate space means anything in overworld terms — the
   * bearing has to be taken between two overworld positions, and `entry.doorTile`
   * is the only one this scene holds.
   */
  private circusAdviceSnapshot(): AdviceSnapshot {
    const stage = this.circus?.progress.stage;
    const complete = stage === 'grimaldi_redeemed' || stage === 'complete';
    return {
      floorNumber: OVERWORLD_FLOOR_NUMBER,
      bearingOrigin: this.entry.doorTile,
      objectives: [adviceObjective('the_circus', complete, this.circus?.overworldCentre ?? null)],
    };
  }

  private townDialogContext(): TownDialogContext {
    const circus = this.circus?.progress;
    const murder = this.murderQuestProgress;
    return {
      circus: circus?.stage ?? 'not_started',
      murder: murder?.stage ?? 'not_started',
      doomsday: this.doomsdayProgress.stage,
      heatherSlain: circus?.heatherSlain ?? false,
      quillNamed: murder?.quillNamed ?? false,
    };
  }

  /**
   * Gathers whatever lies on the floor within reach, unless a hostile is in
   * attack range — then the press is the swing's, as it is outdoors.
   */
  private tryGroundPickup(active: HumanPlayer | CatPlayer): boolean {
    if (!shouldShowInteractionPrompts(active, this.world.roster.grid)) return false;
    return this.destruction.groundPickups.tryPickupNear(active);
  }

  /**
   * Floats a "Talk" prompt over the hireling when a press would reach it.
   *
   * Talking is the last link of the Space chain, so this is drawn after every
   * surface that raises a prompt of its own — the counters, the desk, the bed,
   * Mordecai, the Bopca, the readables, the quest fights — and yields to any
   * of them already on screen: that one takes the press first.
   */
  private renderMercenaryPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (interactionPromptsDrawnThisFrame() > 0) return;
    const merc = this.mercenarySystem.talkTarget(this.active(), this.world.roster.mobs);
    if (merc === null) return;
    drawInteractionPrompt(ctx, merc.x - camX, merc.y - camY, TILE_SIZE, 'Talk');
  }

  /**
   * Floats one interact prompt over whatever the next press would reach: the
   * nearest occupant, or — when nobody is in range — whatever there is to read.
   * One prompt at a time, because two hovering key-caps in a small room read as
   * a bug rather than as two options.
   */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.citizenDialogTarget !== null) return;
    if (worldHalted(this.overlayClaims)) return;
    const active = this.active();
    const target = this.occupants?.findTalkTarget(active.x, active.y) ?? null;
    if (target !== null) {
      drawInteractionPrompt(
        ctx,
        target.x - camX,
        target.y - camY,
        TILE_SIZE,
        this.promptFor(target),
      );
      return;
    }
    const page = this.readables?.findReadTarget(active.x, active.y) ?? null;
    if (page !== null) {
      drawInteractionPrompt(ctx, page.x - camX, page.y - camY, TILE_SIZE, READ_PROMPT_LABEL);
      return;
    }
    const propTarget = this.propInteractions?.findTarget(active.x, active.y) ?? null;
    if (propTarget === null) return;
    drawInteractionPrompt(
      ctx,
      propTarget.x - camX,
      propTarget.y - camY,
      TILE_SIZE,
      this.propInteractions?.promptFor(propTarget) ?? '',
    );
  }

  /**
   * Opens whatever is in reach to read. Returns whether something opened, so
   * the caller can consume the triggering input.
   */
  private tryReadNearby(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    if (this.readables === null || this.readablePanel.isOpen) return false;
    if (this.citizenDialogTarget !== null) return false;
    const page = this.readables.findReadTarget(player.x, player.y);
    if (page === null) return false;
    this.readablePanel.openWith(page.readable);
    this.beginModalGrace();
    this.audio?.play('menu_open');
    return true;
  }

  /**
   * Runs whatever a nearby prop's interaction is (examine/search/use).
   * Returns whether one ran, so the caller can consume the triggering input.
   */
  private tryInteractWithPropNearby(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    if (this.propInteractions === null || this.conversation.isOpen) return false;
    if (this.citizenDialogTarget !== null) return false;
    const target = this.propInteractions.findTarget(player.x, player.y);
    if (target === null) return false;
    this.propInteractions.perform(
      target,
      this.conversation,
      this.destruction.loot,
      player,
      (this.occupants?.people.length ?? 0) > 0,
    );
    if (target.interaction.kind === 'use' && target.interaction.id === 'shop_bell') {
      // The nearest existing cue to a small shop counter bell — reused per
      // the ground rule against registering a cue with no audio file behind it.
      this.audio?.play('bell_toll_hit', { volume: SHOP_BELL_VOLUME });
    } else {
      this.audio?.play('menu_open');
    }
    return true;
  }

  /**
   * What pressing interact on `target` will actually do. A service NPC still
   * holding a story reads as "Talk", because that is what the press gets you —
   * the verb only appears once the story is behind them.
   */
  private promptFor(target: Townsperson): string {
    const service = interiorServiceForRole(this.entry.name, target.role);
    if (service === undefined) return TALK_PROMPT_LABEL;
    if (this.hasUntoldLore(target)) return TALK_PROMPT_LABEL;
    return service.verb;
  }

  /**
   * Whether this occupant is a named resident with a story still to tell. False
   * while the town is in danger: nobody reminisces through an alarm, so the lore
   * list neither plays nor advances until it is over.
   */
  private hasUntoldLore(target: Townsperson): boolean {
    if (target.residentId === null) return false;
    if (isTownInDanger(this.townDialogContext())) return false;
    return this.turnFor(target) < residentLinesFor(target.residentId).lore.length;
  }

  /**
   * Y-sorted pass over the room's occupants and its decoration tiles. Decorations
   * (braziers, hearth props) are drawn base-only by `renderCanvas`, which expects
   * a later overlay pass — without this they simply never appear indoors. Sorting
   * them in with the entities rather than blanket-drawing them on top is what lets
   * a player walk in front of a brazier and occlude it.
   */
  private renderSortedEntities(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    entities: ReadonlyArray<InteriorFigure>,
  ): void {
    const drawables: Array<{ sortY: number; draw: () => void }> = entities.map((entity) => ({
      sortY: entity.y + TILE_SIZE,
      draw: () => entity.render(ctx, camX, camY, TILE_SIZE),
    }));
    for (const deco of this.map.getVisibleDecorationTiles(
      camX,
      camY,
      viewportWidth(),
      viewportHeight(),
    )) {
      drawables.push({
        sortY: deco.ty * TILE_SIZE + deco.sortYAnchorPx,
        draw: () => this.map.drawDecorationAt(ctx, deco.tx, deco.ty, camX, camY),
      });
    }
    drawables.sort((a, b) => a.sortY - b.sortY);
    for (const drawable of drawables) drawable.draw();
  }

  /**
   * Interiors are only a few screens across and their exit door sits in the
   * bottom wall, so the hotbar strip would otherwise cover the one tile the
   * player needs to see to leave. Reserving its band lifts the whole room above
   * it — on mobile, where the strip is opaque and the room is centred, this is
   * the difference between a visible door and none at all.
   */
  protected override viewportBottomInset(): number {
    return this.mobileHUD.inventoryPanel.hotbarBandHeight();
  }

  /**
   * Where this frame's chrome sits. The Follow and Summon buttons count only
   * when this room offers them, the same tests their draw calls make.
   */
  private hudLayoutInput(): InteriorHudLayoutInput {
    return {
      viewportWidth: viewportWidth(),
      viewportHeight: viewportHeight(),
      mobile: platform.isMobile,
      hudCollapsed: this._hudCollapsed,
      miniMapExpanded: this.mobileHUD.miniMapExpanded,
      hotbarBandHeight: this.mobileHUD.inventoryPanel.hotbarBandHeight(),
      followButton: !this.followDisabled,
      summonButton: this.mongoSystem.canShow && this.cat.isActive,
      buildButton: this.buildButtonOffered,
      journalButton: this.overworldJournal !== null,
    };
  }

  private hudLayout(): InteriorHudLayout {
    return interiorHudLayout(this.hudLayoutInput());
  }

  protected override hudToggleClearOfX(): number {
    return this.hudLayout().miniMap.x;
  }

  /**
   * The room is framed clear of the HUD panel, the name plate, the minimap
   * column and a phone's buttons, so no floor tile — and nothing standing on
   * one — and none of the far wall is only ever on screen underneath them.
   */
  protected override cameraClearView(
    map: GameMap,
    view: ScreenRect,
    bounds: WorldRect,
  ): ScreenRect {
    const layoutInput = this.hudLayoutInput();
    const key = JSON.stringify({ layoutInput, view, bounds });
    return this.clearViewMemo.clearView(map, key, (mustSee) =>
      hudClearView(view, interiorHudOccluders(interiorHudLayout(layoutInput)), bounds, mustSee),
    );
  }

  protected override cameraFocusRange(map: GameMap): WorldRect {
    return interiorFocusRange(map);
  }

  /** On a narrow phone the name plate takes the slot under the HUD panel, so the badge goes under it. */
  protected override mobileSkillBadgeTop(): number {
    return this.hudLayout().skillBadgeTop;
  }

  /**
   * The room's visual bounds with a margin, so panning reaches past the far
   * wall's tallest art and every edge of the room can be seen with dark
   * space beyond it.
   */
  protected override cameraWorldBounds(map: GameMap): WorldRect {
    return interiorCameraBounds(map);
  }

  /**
   * The cure under the Big Top is the one thing that happens in a town interior
   * the party is not driving, so it is the one thing the camera leaves them for.
   */
  protected override cameraFocus(): { x: number; y: number } {
    return this.bigTopMaze?.cameraTargetOverride ?? super.cameraFocus();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { x: camX, y: camY } = this.computeCamera(this.map);

    // Drive the shared Button module before anything draws a button: it clears
    // last frame's hit-rects and resolves hover/press for this one.
    setButtonAudio(this.audio);
    setButtonMouseState(this._mouseX, this._mouseY, this._mouseDown);
    // Any overlay at all, not only the world-halting ones: a shop-floor
    // conversation leaves the player free to walk, and the prompt that opened it
    // must not go on hovering over the person now talking.
    setInteractionPromptsSuppressed(focusedOverlay(this.overlayClaims) !== null);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    this.map.renderCanvas(ctx, camX, camY, viewportWidth(), viewportHeight());
    drawTownInteriorGroundProps(
      ctx,
      this.map,
      camX,
      camY,
      TILE_SIZE,
      this.interiorPropDestruction?.broken,
    );

    // Before the entity pass, not after: the Bopca render redraws the counter's
    // front face over itself, and a player standing at the counter reaches up
    // into that tile. Drawn here, the player is painted on top of the counter —
    // which is right, since the player is on the near side of it.
    this.bopca?.renderObjects(ctx, camX, camY, this.active(), this.inactive());

    // With the room's fixtures — the bed, the lantern pools, the stove steam.
    // Ahead of the sorted pass, not after it, because Mordecai now sorts *in*
    // that pass: left here he would be drawn before his own bed and stand
    // behind it. The dungeon scene has always ordered these two this way.
    if (this.safeRoom) {
      this.safeRoom.renderObjects(ctx, camX, camY, this.active());
    }

    // The club's rugs, floor wear and dance lights are ground paint; its
    // furniture and staff join the sorted pass below so crawlers can stand in
    // front of a counter rather than under it.
    this.club?.renderFloor(ctx, camX, camY);

    const safeRoomFigures =
      this.safeRoom?.sortedRenderables(
        this.active(),
        SAFE_ROOM_PULSE_BASE + Math.sin(Date.now() / SAFE_ROOM_PULSE_PERIOD_MS) * PULSE_SWING,
      ) ?? [];

    const combat = this.combat;
    const destruction = this.destruction;
    destruction.renderGround(ctx, camX, camY);
    this.interiorPropDestruction?.renderGround(ctx, camX, camY);
    combat.renderGround(ctx, camX, camY);
    this.fairies.renderGround(ctx, camX, camY);
    // Under the figures: the highlight rings sit on the floor around the broken
    // furniture, and a crawler standing at one must not be drawn beneath it.
    this.anchorInterior?.renderObjects(ctx, camX, camY, this.active());
    this.activeEncounter?.renderWorld?.(ctx, camX, camY, this.active());
    this.renderSortedEntities(ctx, camX, camY, [
      // The same test the dungeon's render pass uses: a corpse that still draws
      // keeps its place in the sort until it expires.
      ...this.world.roster.mobs.filter((mob) => mob.belongsInMobGrid),
      this.inactive(),
      this.active(),
      ...(this.occupants?.people ?? []),
      ...safeRoomFigures,
      ...(this.club?.sortedRenderables() ?? []),
      ...townInteriorPropFigures(this.map, this.interiorPropDestruction?.broken),
      ...destruction.groundPickups.renderEntities(),
      ...(this.bigTopMaze?.sortedFigures() ?? []),
    ]);
    combat.renderEffects(ctx, camX, camY, this.cat);
    // Over the creatures, so a shot never disappears behind the one it passes.
    this.skeletonShots.render(ctx, camX, camY);
    this.rockThrows.render(ctx, camX, camY);
    this.hirelingShots.render(ctx, camX, camY);
    this.fairies.render(ctx, camX, camY);
    destruction.renderEffects(ctx, camX, camY, this.human);
    this.interiorPropDestruction?.renderEffects(ctx, camX, camY);
    // Over the crawlers, so a column standing between the camera and one of them
    // still reads as fire they are inside rather than fire they are behind.
    // Through `activeEncounter` rather than named directly, so an encounter's
    // hazards are gated on its own storey the way its ground paint already is —
    // otherwise a party that walks downstairs mid-fight watches the fire keep
    // burning over the room below at the floor above's coordinates.
    this.activeEncounter?.renderEffects?.(ctx, camX, camY);
    this.bigTopMaze?.renderPrompts(ctx, camX, camY, this.buildSystemContext());
    destruction.renderLoot(ctx, camX, camY, this.active());
    if (shouldShowInteractionPrompts(this.active(), this.world.roster.grid)) {
      destruction.groundPickups.renderPrompt(ctx, camX, camY, this.active());
    }
    // A room hosting a live fight is not offering conversation.
    if (this.activeEncounter === null) this.renderCitizenPrompt(ctx, camX, camY);

    combat.floatingText.render(ctx, camX, camY);
    UIRenderer.renderLevelUpFlash(ctx, camX, camY, this.pm);
    UIRenderer.renderStatBoostFlash(ctx, camX, camY, this.pm);
    this.chat.renderBubble(ctx, camX, camY);
    this.mongoSystem.renderSpeechBubble(ctx, this.cat.x - camX, this.cat.y - camY);
    this.mercenarySystem.renderSpeech(ctx, camX, camY);
    this.crawlerBarks.render(ctx, camX, camY, this.human, this.cat);
    this.breakReactions.render(ctx, camX, camY, this.occupants?.people ?? []);

    // Independent of `combat` — the crystal must still be visible/containable
    // if the player returns to this floor after the encounter was torn down.
    const isOnCrystalFloor =
      this.entry.type === 'tower' && this.currentFloor === TOWER_CONFRONTATION_FLOOR;
    this.soulCrystal.render(ctx, camX, camY, this.active(), isOnCrystalFloor);

    if (this.shop) {
      this.shop.renderObjects(ctx, camX, camY, this.active());
    }

    if (this.club) {
      this.club.renderObjects(ctx, camX, camY, this.active());
    }

    // Exit hint above door
    this.renderExitHint(ctx, camX, camY);

    // Tower stair hints
    this.towerStairs?.renderStairHints(ctx, camX, camY);

    // Before the HUD: the marker is clamped to the screen edge, and a pet off
    // the top of the room would otherwise sit on top of the health bars.
    if (!this.gameOver && !this.pauseMenu.isOpen) {
      this.mongoSystem.renderOffscreenMarker(
        ctx,
        camX,
        camY,
        this.active(),
        INTERIOR_SIGHT_RADIUS_PX,
      );
    }

    this.renderHUD(ctx);

    if (!this.gameOver && !this.pauseMenu.isOpen) {
      // Only one of these may be on screen at once — a downed companion always
      // wins the slot, and every other kind has a fixed place behind it.
      drawTopArrowCandidate([
        this.companionDownIndoors
          ? downedCompanionArrowCandidate(ctx, this.active(), this.inactive(), camX, camY)
          : null,
        this.mercenarySystem.downedArrowCandidate(
          ctx,
          camX,
          camY,
          this.active(),
          INTERIOR_SIGHT_RADIUS_PX,
        ),
        this.soulCrystalArrowCandidate(ctx, camX, camY),
      ]);
    }

    if (!this.gameOver && !this.pauseMenu.isOpen && this.companionDownIndoors) {
      renderKnockedOutUI(ctx, this.inactive(), this.mobileHUD.miniMapSize);
    }

    const hudLayout = this.hudLayout();
    const towerFloor = this.towerFloors.length > 0 ? this.currentFloor : null;
    if (hudLayout.nameplate !== null) {
      drawInteriorNameplate(
        ctx,
        hudLayout.nameplate,
        interiorRoomTitle(this.entry.name, towerFloor),
      );
    }

    // Every frame, not only when the Journal is opened from its button: Escape
    // reaches the same pause menu, whose Game tab offers the Journal row from
    // this, and an open Journal has to keep following the quests it lists.
    this.syncJournalContext();
    this.summonButtonRect = null;
    if (!this.exitMenuOpen && !this.pauseMenu.isOpen) {
      this.mobileHUD.renderInteriorMiniMap(ctx, this.map, this.active(), this.inactive());
      this.mobileHUD.renderPauseButton(ctx, hudLayout.pause);

      // The bag can be showing the companion's pack, opened from the pause
      // menu; the gear screen is always the active crawler's.
      const invPlayer = this.inventoryPlayer();
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
      this.menus.inventoryPanel.bagBouncePulse = this.rewardFly.bagBouncePulse();
      this.mobileHUD.renderPanels(
        ctx,
        invPlayer.inventory,
        invName,
        invPlayer.coins,
        this.menus.inventoryWieldedWeaponId(),
      );
      const { gear, bag, switchButton, follow } = hudLayout;
      if (platform.isMobile && gear !== null && bag !== null && switchButton !== null) {
        // Hidden rather than merely inert where the room refuses the command:
        // a button that answers every press with an error sound is a control the
        // player keeps trying. The layout only places Follow where it is offered.
        const extraButtons =
          follow === null
            ? []
            : [
                {
                  button: {
                    id: 'follow',
                    icon: '↩',
                    label: 'Follow',
                    active: this.companion.getMovementMode(this.human.isActive) === 'anchored',
                  },
                  rect: follow,
                },
              ];
        this.mobileHUD.renderButtons(
          ctx,
          this.human.isActive,
          { switchButton, gear, bag, extraButtons },
          this.inventoryPlayer().inventory.unseenUpgrades.size > 0,
          this.rewardFly.bagBouncePulse(),
        );
      }
      // After the mobile buttons, whose Switch it is stacked on.
      this.summonButtonRect = this.renderSummonButton(ctx, hudLayout);
      this.renderColumnPieces(ctx, hudLayout);
    } else {
      this.buildButtonRect = null;
      this.journalButtonRect = null;
    }

    const safeRoomSpeaker = safeRoomSpeakerFor(this.bopca, this.safeRoom, this.active());
    if (this.safeRoom) {
      this.safeRoom.renderUI(ctx, camX, camY, this.active(), safeRoomSpeaker === 'bopca');
    }

    if (this.bopca !== null) {
      this.bopca.renderUI(ctx, camX, camY, this.active(), safeRoomSpeaker === 'mordecai');
    }
    // Last of the world prompts; see the method for why.
    this.renderMercenaryPrompt(ctx, camX, camY);

    if (this.shop) {
      this.shop.renderUI(ctx, this.active());
      this.shop.renderShopPanel(ctx, this.active(), this.inactive());
    }

    if (this.club) {
      this.club.renderUI(ctx, this.active(), this.inactive());
    }

    this.conversation.render(ctx);
    this.servicePanel?.render(ctx, this.active(), this.inactive());
    this.readingPanel?.render(ctx, this.active(), this.inactive());
    this.readablePanel.render(ctx);

    this.activeEncounter?.renderUI(ctx);
    this.soulCrystal.renderUI(ctx);

    // The doormat draws over the stairs, not under them: `handleClick` answers
    // the exit menu first, and the focus ring goes to whichever declares last,
    // so drawing them the other way round would hand the keyboard to the stair
    // menu while the mouse still drove the exit menu.
    if (this.towerStairs?.menuOpen) this.towerStairs.renderMenu(ctx);
    if (this.exitMenuOpen) this.renderExitMenu(ctx);

    this.destruction.dynamite.renderChargeBar(ctx, viewportWidth(), viewportHeight());
    // With the Construction menu up, its refusals are drawn over the panel
    // below instead: a refusal hidden behind the row that raised it says nothing.
    const toastOverConstructionMenu = this.menus.constructionMenu.isOpen;
    if (!toastOverConstructionMenu) {
      this.menus.hotbarToast.render(ctx, this.mobileHUD.inventoryPanel.hotbarBandHeight());
    }

    if (platform.showEntityTooltip && !this.gameOver && !this.pauseMenu.isOpen) {
      UIRenderer.renderEntityTooltip(
        ctx,
        camX,
        camY,
        this._mouseX,
        this._mouseY,
        this.world.roster.grid,
      );
    }

    if (this.pauseMenu.isOpen) {
      // The full argument list, not the stripped three: without the achievement
      // managers, the stats and the ability manager this is a shell with no
      // Spend screen, which is what left skill points unspendable indoors.
      this.menus.renderPauseMenu(ctx, {
        humanAchievements: this.humanAchievements,
        catAchievements: this.catAchievements,
        gameStats: this.gameStats,
        mouseX: this._mouseX,
        mouseY: this._mouseY,
      });
    }

    this.followerMenu.render(
      ctx,
      this.companion.getMovementMode(this.human.isActive),
      this.companion.getCombatStance(this.human.isActive),
      this.human.isActive,
    );

    // These last two in this order, so draw order matches the order
    // `overlayClaims` and `handleClick` rank the same surfaces in: the death
    // screen over the menus it outranks, and the award stack over the death
    // screen, because an award earned by the killing blow is still the thing on
    // top. Whichever draws last also takes the focus ring, so three orders that
    // disagree leave the topmost dialog visible and un-activatable.
    // A death takes the read-only Construction menu down: drawn under the death
    // screen, it would otherwise still take that screen's first click.
    if (this.gameOver) this.menus.constructionMenu.close();
    const menuCrawler = this.human.isActive ? this.human : this.cat;
    this.menus.constructionMenu.render(
      ctx,
      { name: menuCrawler === this.human ? 'Carl' : 'Donut', skills: menuCrawler.craftSkills },
      (id) => partyCount(this.human, this.cat, id),
    );
    if (toastOverConstructionMenu) {
      this.menus.hotbarToast.render(ctx, this.mobileHUD.inventoryPanel.hotbarBandHeight());
    }
    if (this.gameOver) this.combat.deathScreen.render(ctx);
    this.menus.renderOverlays(ctx);
    this.achievementUI.renderOverlays(ctx);

    // Flies over every dialog above, same as DungeonScene: it's reporting a
    // grant that already happened, not asking for input.
    const coinTarget = hudCoinCounterScreenPos(this._hudCollapsed);
    this.rewardFly.render(ctx, {
      coinX: coinTarget.x,
      coinY: coinTarget.y,
      bagRect: platform.isMobile
        ? this.mobileHUD.bagBtnRect
        : this.menus.inventoryPanel.toggleBtnRect(),
    });

    this.chat.renderHint(ctx);

    // Last, once every surface has drawn: the ring belongs to whoever declared
    // it last, so this is the only point at which the frame's answer to "who
    // owns the keyboard" is final.
    //
    // The bag declares no claim of its own, so every claim in that list outranks
    // it. Checked per frame rather than at each overlay's open, because a room
    // raises them from the interact chain, the mobile tap path and a death the
    // player never touched a button for.
    if (keyboardSuppressed(this.overlayClaims)) this.menus.blurInventorySearch();
    auditOverlayFocus(this.overlayClaims, menuFocusContextId());
  }

  /**
   * The Build button, the achievement chip (or the safe room's banners) and
   * the Journal, where the layout placed them.
   */
  private renderColumnPieces(ctx: CanvasRenderingContext2D, layout: InteriorHudLayout): void {
    this.achievementUI.drawAchievementIcon(
      ctx,
      layout.achievementChip,
      this.gameOver,
      this.pauseMenu.isOpen,
    );
    this.achievementUI.drawLootBoxIcon(ctx, this.gameOver, this.pauseMenu.isOpen);
    this.buildButtonRect =
      layout.build === null
        ? null
        : UIRenderer.drawBuildButton(
            ctx,
            layout.build,
            this.menus.constructionMenu.isOpen,
            NO_BUILD_BUTTON_PULSE,
          );
    const journal = layout.journal;
    if (journal === null) {
      this.journalButtonRect = null;
      return;
    }
    const entries = this.pauseMenu.journalContext?.entries ?? [];
    const outstanding = entries.filter((entry) => isOutstanding(entry.status)).length;
    this.journalButtonRect = UIRenderer.drawJournalButton(ctx, journal, outstanding);
  }

  private renderExitHint(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const pulse =
      SAFE_ROOM_PULSE_BASE + Math.sin(Date.now() / EXIT_HINT_PULSE_PERIOD_MS) * PULSE_SWING;
    const arrowSize = Math.floor(TILE_SIZE * TILE_CENTER_RATIO);
    for (const t of this.map._interiorExitTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      // baseline was sy - 2; top = baseline - round(size * 0.8) = (sy - 2) - 13 = sy - 15
      drawText(ctx, '▼', {
        x: sx,
        y: sy - EXIT_ARROW_Y_OFFSET,
        size: arrowSize,
        bold: true,
        color: `rgba(250,220,80,1)`,
        alpha: pulse,
        align: 'center',
      });
    }
  }

  private renderExitMenu(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const ch = viewportHeight();

    this.exitMenuButtons = [];
    drawOverlay(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      alpha: EXIT_MENU_OVERLAY_ALPHA,
    });

    const panelW = EXIT_MENU_PANEL_WIDTH;
    const panelH = EXIT_MENU_PANEL_HEIGHT;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    drawBox(ctx, {
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      fill: EXIT_MENU_BG_COLOR,
      border: EXIT_MENU_BORDER_COLOR,
      borderWidth: EXIT_MENU_BORDER_WIDTH,
      radius: 0,
    });

    drawText(ctx, '▼  Exit Building  ▼', {
      x: cw / 2,
      y: panelY + EXIT_MENU_TITLE_Y,
      size: EXIT_MENU_TITLE_SIZE,
      bold: true,
      color: EXIT_MENU_LEAVE_TEXT_COLOR,
      align: 'center',
    });

    drawText(ctx, `Leave ${this.entry.name}?`, {
      x: cw / 2,
      y: panelY + EXIT_MENU_QUESTION_Y,
      size: EXIT_MENU_QUESTION_SIZE,
      color: EXIT_MENU_STAY_TEXT_COLOR,
      align: 'center',
    });

    drawText(ctx, '(Esc or Stay to remain inside)', {
      x: cw / 2,
      y: panelY + EXIT_MENU_HINT_Y,
      size: EXIT_MENU_HINT_SIZE,
      color: EXIT_MENU_HINT_TEXT_COLOR,
      align: 'center',
    });

    const rects = this.menuRects();

    // Exit is the default selection, shown highlighted from the moment the menu
    // appears: standing on the doormat is how the player asks to leave, and the
    // door menu on the way in reads the same way round. Unlike the stairwell,
    // which keeps Stay as its default, nothing here is one-way — an accidental
    // Exit puts the party back on the doorstep it came from.
    beginMenuFocus('exit-building', true);
    addButton(ctx, this.exitMenuButtons, {
      x: rects.exit.x,
      y: rects.exit.y,
      width: rects.exit.w,
      height: rects.exit.h,
      label: 'Exit',
      fill: EXIT_MENU_LEAVE_BG_COLOR,
      border: EXIT_MENU_BORDER_COLOR,
      borderWidth: EXIT_MENU_BUTTON_BORDER_WIDTH,
      radius: 0,
      labelSize: EXIT_MENU_BUTTON_TEXT_SIZE,
      labelColor: EXIT_MENU_LEAVE_TEXT_COLOR,
      primaryAction: true,
      action: () => this.doExit(),
    });
    addButton(ctx, this.exitMenuButtons, {
      x: rects.stay.x,
      y: rects.stay.y,
      width: rects.stay.w,
      height: rects.stay.h,
      label: 'Stay',
      fill: EXIT_MENU_STAY_BG_COLOR,
      border: EXIT_MENU_STAY_BORDER_COLOR,
      borderWidth: EXIT_MENU_BUTTON_BORDER_WIDTH,
      radius: 0,
      labelSize: EXIT_MENU_BUTTON_TEXT_SIZE,
      labelColor: EXIT_MENU_STAY_TEXT_COLOR,
      action: () => this.closeExitMenu(),
    });
    endMenuFocus();
  }

  private menuRects(): {
    exit: { x: number; y: number; w: number; h: number };
    stay: { x: number; y: number; w: number; h: number };
  } {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const panelY = ch / 2 - EXIT_MENU_PANEL_HEIGHT / 2;
    const btnW = EXIT_MENU_BUTTON_WIDTH;
    const btnH = EXIT_MENU_BUTTON_HEIGHT;
    const btnY = panelY + EXIT_BTN_Y_OFFSET;
    return {
      exit: { x: cw / 2 - btnW - EXIT_BTN_GAP, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + EXIT_BTN_GAP, y: btnY, w: btnW, h: btnH },
    };
  }

  // Mobile touch handlers

  handleTouchStart(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // Route to click for modals. Read from the claim registry rather than a
      // second hand-maintained list, so a panel added to one is never missing
      // from the other.
      if (worldHalted(this.overlayClaims)) {
        // The follower menu's rows scroll under a drag, so the release decides
        // whether the press was a click.
        // Opened over the pause menu from the Abilities tab, where the pause
        // menu's scroll gesture below would otherwise take the tap.
        if (this.menus.mongoExplainer.isOpen || this.menus.craftExplainers.isOpen) {
          this.handleClick(x, y);
          continue;
        }
        if (this.followerMenu.isOpen && !this.pauseMenu.isOpen) {
          this.followerMenu.touchStart(touch.identifier, x, y);
          continue;
        }
        // The Equipment tab is the one halting surface a finger can drag across
        // rather than only tap, so it takes the press now and the release from
        // the drag branch in `handleTouchEnd`, which already ends with a click.
        const shopIsScrollable = this.scrollableShop !== null;
        if (
          shopIsScrollable ||
          (this.pauseMenu.isOpen && this.pauseMenu.currentTab === 'equipment')
        ) {
          this.handleMouseDown(x, y);
          this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
          continue;
        }
        // A tab taller than the box scrolls under the finger, so the press
        // can't be a click yet: the release decides between the two.
        if (this.pauseMenu.isOpen && this.pauseScrollTouch === null) {
          this.pauseScrollTouch = { id: touch.identifier, x, y, time: Date.now() };
          this.pauseMenu.touchScrollStart(x, y, this.human, this.cat);
          continue;
        }
        this.handleClick(x, y);
        continue;
      }

      // Neither halts the world, but both own every tap on screen while they
      // are up: the menu closes on a tap outside it, and the award overlays
      // take any tap as their continue. Left to the world, a tap on a row
      // would walk the crawler instead of choosing it.
      if (this.menus.constructionMenu.isOpen || this.achievementUI.isBlocking) {
        this.handleClick(x, y);
        continue;
      }

      // The bag's Drop/Trade "how many?" prompt: not world-halting (it can open
      // mid-shop, same as everywhere else it's used), so it falls outside the
      // block above. Routed through `handleMouseDown` rather than straight to
      // `handleClick` so a held step button starts repeating under a finger the
      // same way it does under a held mouse button.
      if (this.menus.itemQuantityPicker.isOpen) {
        this.handleMouseDown(x, y);
        this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
        continue;
      }

      if (this.menus.gearPanel.hitsPanel(x, y)) {
        this.handleClick(x, y);
        continue;
      }

      const coveredByPanel = this.menus.panelCovers(x, y);

      // HUD collapse/expand toggle (mobile only)
      if (platform.isMobile && !coveredByPanel) {
        const ht = this._hudToggleRect;
        if (pointInRect(x, y, ht)) {
          this._hudCollapsed = !this._hudCollapsed;
          continue;
        }
        // The skill badge sits under the HUD bar on mobile, where there is no
        // banner to click — tapping it is the only route to the Spend screen.
        if (this.menus.tryOpenSpendScreen(x, y, this._hudSkillBannerRect)) continue;
      }

      if (!coveredByPanel && this.tryPressSummonButton(x, y)) continue;
      if (!coveredByPanel && this.tryPressColumnPieces(x, y)) continue;

      // Mobile button hit-test (Switch, Gear, Bag, Pause, Minimap, Follow)
      if (platform.isMobile && !coveredByPanel) {
        const btn = this.mobileHUD.hitTest(x, y);
        if (btn === 'switch') {
          this.trySwitchActive();
          continue;
        }
        if (btn === 'gear') {
          this.menus.toggleGear();
          continue;
        }
        if (btn === 'bag') {
          this.menus.toggleInventory();
          continue;
        }
        if (btn === 'pause') {
          this.pauseMenu.toggle();
          continue;
        }
        if (btn === 'minimap') {
          this.mobileHUD.toggleMiniMap();
          continue;
        }
        if (btn === 'follow') {
          if (this.canOpenFollowerMenu()) this.followerMenu.open();
          continue;
        }
      }

      // Hotbar slot tap — activation is deferred to touch end so a drag off the
      // slot doesn't also fire the item.
      const hi = this.menus.inventoryPanel.getHotbarTappedIndex(x, y);
      if (hi >= 0 && !coveredByPanel) {
        this.mobileHUD.inventoryDragTouchId = touch.identifier;
        this.handleMouseDown(x, y);
        continue;
      }

      // Inventory panel drag start, and the long-press that opens a slot's
      // context menu — both of which need clicks to reach the panel, which is
      // exactly what this scene gained.
      if (this.menus.inventoryPanel.isOpen) {
        if (this.menus.inventoryPanel.hitsPanel(x, y)) {
          this.handleMouseDown(x, y);
          this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
          this.mobileHUD.startInvLongPress(x, y, () => this.handleContextMenu(x, y));
          continue;
        }
      }

      // Game world touch: movement / tap tracking
      if (this.mobileHUD.moveTouchId === null) {
        this.mobileHUD.startMovement(touch.identifier, x, y);
      }
    }
  }

  handleTouchMove(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (touch.identifier === this.pauseScrollTouch?.id) {
        this.pauseMenu.touchScrollMove(x, y);
        continue;
      }

      if (this.followerMenu.touchMove(touch.identifier, x, y)) continue;

      // Update inventory drag
      this.handleMouseMove(x, y);
      this.mobileHUD.checkInvLongPressMove(x, y);

      // Update movement target
      if (touch.identifier === this.mobileHUD.moveTouchId) {
        this.mobileHUD.moveTarget = { x, y };
      }
    }
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const followerMenuTouch = this.followerMenu.touchEnd(touch.identifier);
      if (followerMenuTouch !== null) {
        if (followerMenuTouch === 'tap') this.handleClick(x, y);
        continue;
      }

      const pauseScroll = this.pauseScrollTouch;
      if (pauseScroll !== null && touch.identifier === pauseScroll.id) {
        this.pauseScrollTouch = null;
        this.pauseMenu.touchScrollEnd(x, y, this.human, this.cat);
        const elapsed = Date.now() - pauseScroll.time;
        const moved = Math.hypot(x - pauseScroll.x, y - pauseScroll.y);
        if (elapsed < MENU_TAP_DURATION_MS && moved < MENU_TAP_MAX_DISTANCE) {
          this.handleClick(x, y);
        } else {
          // No click follows a drag, so the menu's held-back click would
          // otherwise sit waiting and eat the next tap.
          this.pauseMenu.clearSuppressedClick();
        }
        continue;
      }

      // Inventory / hotbar drag end
      if (touch.identifier === this.mobileHUD.inventoryDragTouchId) {
        const openedContextMenu = this.mobileHUD.invLongPressFired;
        this.mobileHUD.clearInvLongPress();
        this.handleMouseUp(x, y);
        // A release that only ended a long press must not also fire the slot it
        // was held on, or the menu it just opened is dismissed by its own tap.
        if (openedContextMenu) {
          this.mobileHUD.inventoryDragTouchId = null;
          continue;
        }
        const hi = this.mobileHUD.inventoryPanel.getHotbarTappedIndex(x, y);
        // A second finger can land on the bar in the same frame an overlay goes
        // up; its release must resolve the overlay, not fire the slot beneath.
        // The pause menu is named separately because it covers the bar without
        // being a pointer-blocking overlay: the hotbar is not drawn under it, so
        // a release over where it used to be must go to the menu instead.
        // An open shop is drawn over the bar and is not a pointer-blocking overlay,
        // so its Close and lower Buy rows would otherwise fire the slot beneath.
        if (
          hi >= 0 &&
          !this.isOverlayBlockingPointer &&
          !this.pauseMenu.isOpen &&
          this.scrollableShop === null
        ) {
          activateHotbarSlot(this.hotbarHost(), hi);
        } else {
          this.handleClick(x, y);
        }
        this.mobileHUD.inventoryDragTouchId = null;
        continue;
      }

      // Game world touch end
      if (touch.identifier === this.mobileHUD.moveTouchId) {
        if (this.mobileHUD.isTap(x, y)) {
          // Capture before handleClick, which may advance/close an open dialog —
          // guarding the talk trigger below against reopening a fresh one in the
          // same tap (the close-then-reopen trap).
          const mordecaiWasOpen = this.safeRoom?.mordecaiDialogOpen === true;
          const dialogWasOpen =
            mordecaiWasOpen ||
            this.citizenDialogTarget !== null ||
            this.servicePanel?.isOpen === true ||
            this.readingPanel?.isOpen === true ||
            this.readablePanel.isOpen;
          const bopcaWasOpen = this.bopca?.isDialogOpen === true;
          // A tap whose finger went down before an award overlay appeared still
          // arrives here. `handleClick` routes it to the overlay; the
          // space-equivalents must not also fire while the game is paused.
          const overlayClaimedTap = this.isOverlayBlockingPointer;
          // Off the box, a tap is the touch form of the interact press, and
          // may be for whoever the crawler has walked up to since.
          const tapMissedConversation =
            this.conversation.isOpen && !this.conversation.hitsSurface(x, y);
          this.handleClick(x, y);
          const handedOff = tapMissedConversation && this.handOffConversationPress();
          if (!overlayClaimedTap && !handedOff) {
            this.triggerTapInteractions(dialogWasOpen, bopcaWasOpen, mordecaiWasOpen, x, y);
          }
        }
        this.mobileHUD.clearMovement();
      }
    }
  }

  /**
   * The space-equivalent actions a world tap performs, once `handleClick` has
   * had its chance at it.
   *
   * @param dialogWasOpen Whether a citizen dialog, service panel or Mordecai's
   *   own box was already up before `handleClick` ran — that call would have
   *   advanced or closed it, and reopening one in the same tap is the
   *   close-then-reopen trap.
   * @param bopcaWasOpen The same guard for the Bopca's own conversation.
   * @param mordecaiWasOpen The same guard for Mordecai's, which needs its own
   *   flag because the safe room's talk trigger below runs whether or not any
   *   other dialog was up.
   * @param tapScreenX Where the finger landed, so a swing that reaches nothing
   *   to interact with is still aimed the way the player pointed it.
   * @param tapScreenY See `tapScreenX`.
   */
  private triggerTapInteractions(
    dialogWasOpen: boolean,
    bopcaWasOpen: boolean,
    mordecaiWasOpen: boolean,
    tapScreenX: number,
    tapScreenY: number,
  ): void {
    // A finger that went down on open ground can come up after something has
    // taken the screen — the release belongs to whatever that is, and `update`
    // is not running the world underneath it anyway.
    if (worldHalted(this.overlayClaims)) return;
    // The keyboard's swing is withheld for the whole of a scripted beat; the tap
    // has to be too, or a stray finger spins Carl round mid-walk-up and swings
    // at the vine he is there to save.
    if (this.scriptOwnsParty) return;
    const safeRoomSpeaker = safeRoomSpeakerFor(this.bopca, this.safeRoom, this.active());
    if (this.bopca !== null && !bopcaWasOpen && safeRoomSpeaker === 'bopca') {
      this.bopca.tryInteract(this.active());
    }
    if (!mordecaiWasOpen && safeRoomSpeaker === 'mordecai') {
      this.talkToMordecai(this.active());
    }
    if (this.shop?.isNearShopkeeper(this.active()) === true) {
      this.shop.shopOpen = true;
      this.beginModalGrace();
    }
    if (this.currentFloor === TOWER_CONFRONTATION_FLOOR) {
      this.towerConfrontation?.tryExamine(this.active());
    }
    this.club?.handleInteract(this.active(), this.inactive());
    // Talk to a nearby occupant only when nothing else claimed the tap: no
    // shop/club panel is up (the store has both a shop and shelf-browsers), and
    // the safe room didn't just open Mordecai (that building has both Mordecai
    // and ambient occupants within one tap's reach).
    if (
      !dialogWasOpen &&
      this.shop?.shopOpen !== true &&
      this.club?.modalOpen !== true &&
      this.safeRoom?.mordecaiDialogOpen !== true &&
      this.bopca?.isDialogOpen !== true &&
      this.servicePanel?.isOpen !== true &&
      this.readingPanel?.isOpen !== true &&
      !this.readablePanel.isOpen
    ) {
      const active = this.active();
      // The prompt already reads "Tap to repair" on mobile (`AnchorInteriorSystem
      // .renderObjects`), but nothing routed the tap there — a phone player could
      // never earn Hilda's shard, since `buildAction` is bound to the `R` key.
      const repaired = this.anchorInterior?.tryRepair(active) ?? false;
      // The same trap, and a worse one: the Big Top's prompt reads "Tap to pour"
      // on a phone, and the pour is the *only* way out of the finale. Without
      // this the tap falls through to the swing below and Carl beats on a vine
      // that cannot be hurt, forever.
      const poured = this.bigTopMaze?.tryInteract(this.buildSystemContext()) ?? false;
      if (
        !repaired &&
        !poured &&
        !this.tryGroundPickup(active) &&
        !this.tryTalkToOccupant(active) &&
        !this.tryReadNearby(active)
      ) {
        this.attackTowardTap(active, tapScreenX, tapScreenY);
      }
    }
  }

  /**
   * A world tap with nothing to talk to, buy from or read under it is a swing —
   * the mobile equivalent of the interact key's last claim in `update`.
   *
   * Aimed at the tap first, then snapped by `triggerPlayerAttack` to the nearest
   * mob in that direction, so a deliberate tap behind the crawler turns them
   * round rather than swinging at their own back.
   */
  private attackTowardTap(
    active: HumanPlayer | CatPlayer,
    tapScreenX: number,
    tapScreenY: number,
  ): void {
    const cam = this.computeCamera(this.map);
    const dx = tapScreenX + cam.x - (active.x + TILE_SIZE * TILE_CENTER_RATIO);
    const dy = tapScreenY + cam.y - (active.y + TILE_SIZE * TILE_CENTER_RATIO);
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      active.facingX = dx / distance;
      active.facingY = dy / distance;
    }
    triggerPlayerAttack(this.human, this.cat, this.world.roster.grid, this.map, this.audio);
  }
}
