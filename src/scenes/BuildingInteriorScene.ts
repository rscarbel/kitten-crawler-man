import { type SceneManager } from '../core/Scene';
import { type InputManager } from '../core/InputManager';
import { keybindings } from '../core/Keybindings';
import { TILE_SIZE } from '../core/constants';
import { GameMap, TOWER_FLOOR_COUNT, TOWER_INTERIOR_W, type InteriorVariant } from '../map/GameMap';
import { BRAZIER, FIREPLACE } from '../map/tileTypes';
import { PlayerManager } from '../core/PlayerManager';
import type { BuildingEntry } from '../systems/BuildingSystem';
import { snapPlayer, restorePlayer, type PlayerSnapshot } from '../core/PlayerSnapshot';
import { SafeRoomSystem } from '../systems/SafeRoomSystem';
import { BopcaSystem } from '../systems/BopcaSystem';
import { stampSafeRoomCounters } from '../map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../map/safeRoomDecorLayout';
import { ShopSystem } from '../systems/ShopSystem';
import { MobileHUDSystem } from '../systems/MobileHUDSystem';
import type { MobileHUDButton } from '../systems/MobileHUDSystem';
import { platform } from '../core/Platform';
import * as UIRenderer from '../systems/DungeonUIRenderer';
import { TowerStairSystem } from '../systems/TowerStairSystem';
import {
  readMovement,
  applyMovement,
  triggerPlayerAttack,
  KNOCKOUT_TIMEOUT_FRAMES,
} from '../systems/GameLoopPhases';
import { renderKnockedOutUI, updateKnockoutState } from '../systems/KnockoutRevive';
import { GameplayScene } from './GameplayScene';
import { pointInRect } from '../utils';
import { AchievementManager } from '../core/AchievementManager';
import { GameStats } from '../core/GameStats';
import type { PauseMenu } from '../ui/PauseMenu';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { AbilityManager } from '../core/AbilityManager';
import type { AudioManager } from '../audio/AudioManager';
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
import { SystemNoticeSystem } from '../systems/SystemNoticeSystem';
import { causeFromDamageSource } from '../systems/DeathCauseSystem';
import { pickDeathExplanation } from '../ui/DeathExplanations';
import { resolveSkillBookPrompt } from '../systems/skillBookUse';
import type { Mob } from '../creatures/Mob';
import type { Townsperson } from '../creatures/Townsperson';
import { CONVERSATION_WALK_AWAY_TILES } from '../creatures/townInteraction';
import {
  BIG_TOP_BUILDING_NAME,
  isCircusResolvedStage,
  type CircusQuestProgress,
} from '../core/CircusQuestProgress';
import { adviceObjective, MordecaiAdvisor, type AdviceSnapshot } from '../systems/mordecaiAdvice';
import type { MurderQuestProgress, MurderQuestStage } from '../core/MurderQuestProgress';
import { createDoomsdayProgress, type DoomsdayProgress } from '../core/DoomsdayProgress';
import { createClubMembership, type ClubMembership } from '../core/ClubMembership';
import { FollowerMenu } from '../systems/FollowerMenu';
import {
  CompanionSystem,
  createCompanionStanceState,
  type CompanionStanceState,
} from '../systems/CompanionSystem';
import { createMercenaryRoster, type MercenaryRoster } from '../core/MercenaryRoster';
import { createGodModeState, type GodModeState } from '../core/GodMode';
import { isWearable, type InventoryItem, type ItemId } from '../core/ItemDefs';
import { DesperadoClubSystem } from '../systems/DesperadoClubSystem';
import { InteriorOccupantSystem } from '../systems/InteriorOccupantSystem';
import { InteriorReadableSystem } from '../systems/InteriorReadableSystem';
import { AmbientSoundSystem, type AmbientEmitter } from '../systems/AmbientSoundSystem';
import {
  buildCitizenConversation,
  isTownInDanger,
  roleDisplayName,
  type TownDialogContext,
} from '../systems/townDialog';
import {
  buildResidentConversation,
  residentById,
  residentHost,
  type ResidentDef,
  type ResidentHost,
} from '../systems/townResidents';
import { buildApothecaryMenu, serveRemedy } from '../systems/townApothecary';
import { buildSmithyMenu, sharpenEdges } from '../systems/townSmithy';
import { buildInnMenu, serveInn } from '../systems/townInn';
import { isInnRoomKey } from '../systems/townInnRooms';
import {
  buildCartwrightMenu,
  buildMillerMenu,
  buildShepherdMenu,
  sellCartwrightGoods,
  serveMillerGoods,
  serveShepherdRest,
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
} from '../ui/PricedMenuPanel';
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
import { CitizenDialog } from '../ui/CitizenDialog';
import { FortuneTellerPanel, HEDGE_WITCH } from '../ui/FortuneTellerPanel';
import { ReadablePanel } from '../ui/ReadablePanel';
import { drawInteractionPrompt, setInteractionPromptsSuppressed } from '../ui/InteractionPrompt';
import { SpellSystem } from '../systems/SpellSystem';
import { MAZE_CAT_SPAWN_TILE, MAZE_HUMAN_SPAWN_TILE } from '../map/bigTopMazeLayout';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { GrimaldiVine } from '../creatures/GrimaldiVine';
import { MobRoster, type SceneWorld } from '../systems/kits/SceneWorld';
import { CombatKit } from '../systems/kits/CombatKit';
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
import { BigTopMazeSystem } from '../systems/BigTopMazeSystem';
import { CultHideoutSystem } from '../systems/CultHideoutSystem';
import { QuillConfrontationSystem } from '../systems/QuillConfrontationSystem';
import { SoulCrystalSystem } from '../systems/SoulCrystalSystem';
import { SkeletonProjectileSystem } from '../systems/SkeletonProjectileSystem';
import { SkeletonSummonSystem } from '../systems/SkeletonSummonSystem';
import type { SystemContext } from '../systems/GameSystem';
import type { InteriorFigure } from '../core/InteriorFigure';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { tickMongoRegen, type MongoPetState } from '../core/MongoPetState';
import { getMongoStats } from '../abilities/mongo';

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

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
const RECENT_EVENTS_LIMIT = 5;
const TILE_CENTER_RATIO = 0.5;
const SAFE_ROOM_PULSE_BASE = 0.6;
const SAFE_ROOM_PULSE_PERIOD_MS = 600;
const PULSE_SWING = 0.3;
const INTERIOR_LABEL_BAR_HEIGHT = 28;
const INTERIOR_TOP_MARGIN = 8;
const MM_TO_PAUSE_BTN_SPACING = 20;
const GEAR_BTN_SPACING = 34;
const MOBILE_BUTTONS_EXTRA_Y = 52;
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
/**
 * A dozen vents can light in the same second, so the whoosh is held well under
 * the cues the player actually has to react to.
 */
const VENT_IGNITION_VOLUME = 0.35;
/** The cured vine's own tile hugs the south face of the pole cluster he wraps. */
const CURED_GRIMALDI_POLE_SOUTH_OFFSET = 1;
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
  circusProgress: CircusQuestProgress | undefined,
): InteriorVariant {
  const isMaze = buildingName === BIG_TOP_BUILDING_NAME && circusProgress?.stage === 'bigtop_ready';
  return isMaze ? 'bigtop_maze' : 'default';
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
   * One bus rather than the three this scene used to run (skill unlocks, the
   * Bopca's grunts, and a combat stack's own) is what lets every system indoors
   * hear every other one, and what makes `AudioManager.wireEvents` — rather than
   * a hand-played sound at each emit site — the place a cue is chosen.
   */
  private readonly bus = new EventBus();
  private readonly systemNotices: SystemNoticeSystem;
  /** Bag, gear, pause menu, award stack, toasts and the hotbar's one routine. */
  private readonly menus: MenusKit;

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
  private bopcaKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Shared mobile HUD (buttons, touch state) — the panels it draws are the kit's.
  private readonly mobileHUD: MobileHUDSystem;

  // Companion command state + menu, mirrored from the overworld so movement mode
  // and combat stance carry into buildings. The stance is threaded by reference
  // so passive/aggressive chosen here persists back out to the overworld.
  private readonly companionStance: CompanionStanceState;
  private readonly companion: CompanionSystem;
  private readonly followerMenu = new FollowerMenu();

  // Notif pulse (unused but needed for HUD signature)
  protected readonly notifPulse = { value: 0 };

  // Tower multi-floor state
  private towerFloors: GameMap[] = [];
  private currentFloor = 0;
  private towerStairs: TowerStairSystem | null = null;

  private readonly audio: AudioManager | null;

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
  /**
   * Resident lore progress and the apothecary's batch. Threaded in by reference
   * because this scene is rebuilt on every door entry — anything held here
   * instead would reset each visit, which is exactly the bug it exists to fix.
   */
  private readonly townMemory: TownMemory;
  private readonly anchorQuestProgress: AnchorQuestProgress;
  /** The anchor questline's business in this room; null in every other room. */
  private readonly anchorInterior: AnchorInteriorSystem | null;
  // Talk surface for ambient occupants; null when there are no occupants or no audio.
  private readonly citizenDialog: CitizenDialog | null;
  /** Occupant the open conversation belongs to; used to notice the player walking off. */
  private citizenDialogTarget: Townsperson | null = null;
  /**
   * A service NPC whose story is playing, and the turn their menu should open
   * on. The turn is captured here rather than re-read later: `noteTalk` runs the
   * moment the story starts, so re-reading it after the story ends would rotate
   * the shopkeeper's greeting one line further than the same visit's direct
   * talk does.
   */
  private pendingServiceTalk: { target: Townsperson; turn: number; role: TownRole } | null = null;
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
    input: InputManager,
    sceneManager: SceneManager,
    private readonly onExitCallback: (
      humanSnap: PlayerSnapshot,
      catSnap: PlayerSnapshot,
      /** True when the exit was a defeat, so the caller can respawn away from the door. */
      defeated: boolean,
    ) => void,
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
     * The pet's shared state, so his off-duty recovery keeps running indoors.
     *
     * He cannot follow the party inside, and recovery that only ticked in the
     * dungeon meant an hour spent shopping healed him by nothing.
     */
    private readonly mongoPetState?: MongoPetState,
    private readonly mongoPetLevel?: () => number,
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
  ) {
    super(input, sceneManager);
    this.audio = audio ?? null;
    // Additive and cheap on repeat entry: preloading the same interior's SFX
    // group twice is a no-op, so re-entering a shop never re-pays the decode
    // cost (see the DungeonScene equivalent for the matching per-floor case).
    void this.audio?.preload(sfxGroupsForBuildingEntry(entry));
    this.abilityManager = abilityManager ?? new AbilityManager();
    this.townMemory = townMemory ?? createTownMemory();
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

    const isTower = entry.type === 'tower';
    // Read once and reused below: the room's shape and where the two crawlers are
    // put down have to be the same decision, or the maze gets built and then
    // entered through the ring's single door.
    const variant = interiorVariantFor(entry.name, this.circus?.progress);

    // prebuiltStructure skips dungeon generation entirely (mapSize 0 would
    // crash the generator); generateInterior() builds the real room next.
    if (isTower) {
      // Generate 4 tower floors
      for (let f = 0; f < TOWER_FLOOR_COUNT; f++) {
        const floorMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
        // Every storey of a tower passes `false`: a tower is not a safe-room
        // building, and the flag belongs to the building rather than the floor.
        floorMap.generateInterior('tower', f, entry.name, false);
        this.towerFloors.push(floorMap);
      }
      this.map = this.towerFloors[0];
    } else {
      // Build single interior map
      this.map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
      this.map.generateInterior(entry.type, 0, entry.name, entry.hasSafeRoom === true, variant);
    }

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
    this.pm = new PlayerManager(sx, sy);
    this.cat.setMap(this.map);

    restorePlayer(this.human, humanSnap);
    restorePlayer(this.cat, catSnap);
    // Re-position after restore (restore doesn't set x/y).
    this.pm.setPositions(sx, sy);
    // The maze is two people walking two sealed halves, so they come in through
    // two flaps. After `setPositions`, which puts both on one tile.
    if (variant === 'bigtop_maze') {
      this.human.x = MAZE_HUMAN_SPAWN_TILE.x * TILE_SIZE;
      this.human.y = MAZE_HUMAN_SPAWN_TILE.y * TILE_SIZE;
      this.cat.x = MAZE_CAT_SPAWN_TILE.x * TILE_SIZE;
      this.cat.y = MAZE_CAT_SPAWN_TILE.y * TILE_SIZE;
    }

    this.audio?.wireEvents(this.bus);

    // The same companion drive the overworld runs, sharing the overworld stance
    // so movement mode and combat stance are consistent everywhere. It owns the
    // companion's feet as well as its hands: a second mover on the same body
    // fights this one for every step.
    this.companion = new CompanionSystem(this.map, sx, sy, this.companionStance);
    this.wireFollowerMenu();

    this.safeRoom =
      entry.hasSafeRoom === true
        ? new SafeRoomSystem(this.map, sx, sy, 'level3', this.audio)
        : null;

    if (entry.hasSafeRoom === true) {
      this.bopca = new BopcaSystem(this.map, stampSafeRoomCounters(this.map), this.bus, this.audio);
      // After the counter, because the furnishings keep clear of every tile it
      // owns and cannot know them until it is planned.
      stampSafeRoomDecor(this.map);
    } else {
      this.bopca = null;
    }

    this.shop = entry.type === 'store' ? new ShopSystem(this.mapW) : null;

    this.club =
      entry.type === 'club'
        ? new DesperadoClubSystem(
            this.map,
            this.clubMembership,
            this.mercenaryRoster,
            this.audio,
            this.human.hasDesperadoPassTattoo || this.cat.hasDesperadoPassTattoo,
            this.humanAchievements,
            this.catAchievements,
          )
        : null;

    // Tower stair system
    if (isTower) {
      this.towerStairs = new TowerStairSystem(
        this.map,
        0,
        () => this.changeFloor(this.currentFloor + 1),
        () => this.changeFloor(this.currentFloor - 1),
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
      this.floors.push({
        world,
        destruction: new DestructionKit(world, OVERWORLD_FLOOR_NUMBER),
        skeletonShots: new SkeletonProjectileSystem(floorMap),
        skeletonSummons: new SkeletonSummonSystem(floorMap, (mob) => world.roster.add(mob)),
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
    this.systemNotices = new SystemNoticeSystem(this.bus, this.menus.hotbarToast);
    this.chat = new ChatKit({
      world: this.floors[GROUND_FLOOR_INDEX].world,
      abilityManager: this.abilityManager,
      godModeState: this.godModeState,
      describeSituation: () =>
        `Human is level ${this.human.level}, Cat is level ${this.cat.level}. ` +
        `Inside: ${this.entry.name}. ` +
        `Human HP: ${this.human.hp}/${this.human.maxHp}, Cat HP: ${this.cat.hp}/${this.cat.maxHp}.`,
    });
    this.chat.applyCarriedCheat();
    this.wirePauseMenu();
    this.wireCombatGore();
    this.initEntryEncounter(this.circus?.progress);
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
      this.audio,
    );

    // Ambient occupants only where no live encounter owns the room; the tower's
    // confrontation can start after entry, so towers are excluded outright.
    this.occupants =
      this.encounter === null
        ? InteriorOccupantSystem.forBuilding(this.map, entry.type, entry.name)
        : null;
    this.citizenDialog =
      this.occupants !== null && this.audio !== null ? new CitizenDialog(this.audio) : null;
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
    const roomBed = INTERIOR_AMBIENT_BEDS.get(this.entry.name);
    if (roomBed !== undefined) {
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

  /** That floor's raised skeletons. */
  private get skeletonSummons(): SkeletonSummonSystem {
    return this.floors[this.currentFloor].skeletonSummons;
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
    const citizenDialog = this.citizenDialog;
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
      // The award stack outranks the death screen because it draws over it — a
      // level-up earned by the blow that killed you is still on top and still
      // has to be dismissible.
      modal(this.menus.levelUpDialog.isShowing, 'level-up'),
      modal(this.menus.rewardGrantedDialog.isShowing, 'reward-granted'),
      modal(this.menus.skillBookPrompt.isOpen, 'skill-book-prompt'),
      // `locksKeyboard` even though the death screen accepts from the keyboard:
      // its focus ring listens in the capture phase and consumes the press
      // before this handler is reached, so locking here only stops a hotbar key
      // spending a potion the revive is about to throw away.
      modal(this.gameOver, 'death-screen'),
      {
        isOpen: this.chat.isOpen,
        space: { kind: 'passThrough' },
        locksKeyboard: true,
        haltsWorld: true,
        // The DOM input owns every key while it is up, the ring included.
        focusContext: null,
      },
      {
        isOpen: this.bopca?.isDialogOpen === true,
        space: { kind: 'advance', advance: () => this.bopca?.advanceDialog() },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'bopca-dialog',
      },
      {
        isOpen: this.safeRoom?.mordecaiDialogOpen === true,
        space: { kind: 'advance', advance: () => this.safeRoom?.advanceMordecaiDialog() },
        // Locked, unlike the dungeon's copy of this claim: out there the world
        // keeps running under his box, and in here `update` stops dead on it.
        // An unlocked keyboard over a frozen room drinks potions nothing is
        // ticking down.
        locksKeyboard: true,
        haltsWorld: true,
        // Advance-anywhere: one speaker line, no buttons to reach.
        focusContext: null,
      },
      // A timed fade with no buttons; the sleep ends itself.
      modal(this.safeRoom?.isSleeping === true, null),
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
      // The tower's own conversation: the magistrate's body, and the reveal
      // that ends with a boss in the room. Ahead of the ambient surfaces below
      // for the same reason the anchor questline is — a quest box is always the
      // one being read.
      {
        isOpen:
          this.currentFloor === TOWER_CONFRONTATION_FLOOR &&
          this.towerConfrontation?.isDialogOpen === true,
        space: { kind: 'advance', advance: () => this.towerConfrontation?.advanceDialog() },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'quest-dialog',
      },
      // The tent's own conversation, at the moment the potion lands on the vine.
      {
        isOpen: this.bigTopMaze?.isDialogOpen === true,
        space: { kind: 'advance', advance: () => this.bigTopMaze?.advanceDialog() },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'quest-dialog',
      },
      // Ahead of both service surfaces it can intercept: while the anchor
      // questline has something to say, its box is the one that is drawn.
      {
        isOpen: this.anchorInterior?.isDialogOpen === true,
        space: { kind: 'advance', advance: () => this.anchorInterior?.advanceDialog() },
        locksKeyboard: true,
        haltsWorld: true,
        focusContext: 'quest-dialog',
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
    this.bus.on('mobKilled', (e) => {
      this.gameStats.recordKill(e.mob.displayName);
      this.combat.spawnKillGore(e.mob, e.killer);
      // Onto the floor, the same as the dungeon, rather than straight into the
      // purse: a pile you have to walk over is how a kill reads as having paid.
      // Nothing is lost by the door — `doExit` sweeps whatever is still lying
      // there into the pack on the way out.
      const owner = e.topDamageDealer ?? e.killer;
      if (owner !== null && e.mob.droppedLoot !== null) {
        const { x, y } = this.destruction.loot.findDropPosition(e.mob.x, e.mob.y);
        this.destruction.loot.addLoot(x, y, e.mob.droppedLoot, owner);
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
  private initEntryEncounter(circusProgress: CircusQuestProgress | undefined): void {
    if (this.entry.name === BIG_TOP_BUILDING_NAME && circusProgress?.stage === 'bigtop_ready') {
      this.startEncounter(GROUND_FLOOR_INDEX, (bus, addMob) => {
        const maze = new BigTopMazeSystem(this.map, bus, addMob, circusProgress, this.audio);
        this.bigTopMaze = maze;
        // The maze's fire is ground the companion has to be steered out of, the
        // same as a gas cloud or a boss's puddle.
        this.companion.registerHazardSource(maze);
        // Both parked, not just whoever is standing in for the companion right
        // now: each crawler walks their own half, and the moment the player uses
        // the switch key — which is the whole mechanic — the other stance would
        // still be on follow and would march that crawler into a corridor nobody
        // is steering them through.
        this.companion.anchorBoth(this.human, this.cat);
        return maze;
      });
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
    departing.skeletonSummons.resetForCheckpoint();
    this.currentFloor = newFloor;
    this.map = this.towerFloors[newFloor];
    this.mapW = this.map.structure[0]?.length ?? TOWER_INTERIOR_W;
    this.cat.setMap(this.map);
    this.towerStairs?.setMap(this.map, newFloor);

    // Spawn at the opposite stair on the new floor:
    // if ascending, place at the down-stairs; if descending, place at the up-stairs
    const spawnTiles = goingUp ? this.map._interiorStairDownTiles : this.map._interiorStairUpTiles;
    const spawn = spawnTiles[0] ?? this.map.startTile;
    // Clear of the *whole* stair block, not one tile below its first tile: a
    // staircase spans several rows, so landing one row down would still be on it
    // and would re-open the menu the arrival just came through.
    const stairBottomRow = spawnTiles.reduce((lowest, tile) => Math.max(lowest, tile.y), spawn.y);
    const spawnY = stairBottomRow + 1;
    const spawnX = spawnTiles.reduce((leftmost, tile) => Math.min(leftmost, tile.x), spawn.x);
    this.human.x = spawnX * TILE_SIZE;
    this.human.y = spawnY * TILE_SIZE;
    this.cat.x = (spawnX + 1) * TILE_SIZE;
    this.cat.y = spawnY * TILE_SIZE;
    // After both crawlers have been placed, so the companion's re-seeded anchors
    // and its leash both read the landing they actually arrived on rather than
    // the storey they left.
    this.companion.setMap(this.map, this.human, this.cat);

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
    // Override the overworld's persisted music with the room's own; the
    // overworld's zone music (OverworldMusicSystem) restores itself on exit.
    const musicTracks = this.interiorMusicTracks();
    if (musicTracks !== null) {
      this.audio?.playMusicPlaylist(musicTracks, { fadeInMs: INTERIOR_MUSIC_FADE_IN_MS });
    }

    // The Bopca's three-way order is picked with 1/2/3, which the hotbar also
    // owns. Stopped rather than merely defaulted: the shared handler's
    // suppression gate reads whether her dialog is open *after* this ran, and
    // the choice that closes it — "leave" — would otherwise land on a hotbar
    // slot on its way out.
    this.bopcaKeyHandler = (e: KeyboardEvent) => {
      if (this.bopca?.handleKeyDown(e.key) !== true) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.bopcaKeyHandler);

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
        if (this.menus.skillBookPrompt.isOpen) {
          // Escape declines the read; the book stays in the pack.
          this.menus.skillBookPrompt.close();
          this.menus.releaseSkillBookReader();
          return true;
        }
        if (this.bopca?.dismissDialog() === true) return true;
        if (this.bigTopMaze?.dismissDialog() === true) return true;
        if (this.towerConfrontation?.dismissDialog() === true) return true;
        if (this.safeRoom?.mordecaiDialogOpen === true) {
          this.safeRoom.mordecaiDialogOpen = false;
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
        if (this.citizenDialog?.isOpen === true && !worldHalted(this.overlayClaims)) {
          this.citizenDialog.close();
          // Escape is a refusal, not a page turn: a menu queued behind the
          // story must not open on the way out of it.
          this.pendingServiceTalk = null;
          this.releaseCitizenDialogTarget();
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
      // No `toggleQuestTracker` or `mongoSummon`: the journal and the pet both
      // belong to systems the overworld owns.
      openChat: () => this.openChat(),
      hotbarActivation: (idx) => activateHotbarSlot(this.hotbarHost(), idx),
      dynamiteRelease: (idx) => releaseChargedDynamite(this.hotbarHost(), idx),
      interactPressStarted: () => {
        this.interactArmed = true;
      },
      interactReleased: () => {
        this.interactArmed = true;
      },
    });
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
    // Backstop for any teardown that does not route through `doExit`, which
    // closes the club's panels itself while the coins can still reach the
    // player. Idempotent, so running twice costs nothing.
    this.club?.closeAll(this.active());
    // Same contract as DungeonScene's bus: subscribers are re-wired per scene, so
    // the listeners this scene added must not outlive it.
    this.bus.clear();
    this.menus.dispose();
    this.ambientSound?.dispose();
    this.bopca?.dispose();
    // Every floor's kit, not just the live one: each holds its own mob loop, and
    // the pack-alert grid that loop publishes is a module-level handle. An
    // interior that exited without this leaves its mobs — and through them its
    // maps — reachable for the rest of the page's life.
    for (const floor of this.floors) floor.combat.dispose();
    // Drop this scene's hit-rects so the next scene doesn't inherit stale hover.
    clearButtonMouseState();
    this.inputHandler.unbind();
    // A real <input> on document.body, which swallows every key it is focused
    // for. Left behind, it makes the scene that replaces this one unplayable.
    this.chat.dispose();
    if (this.bopcaKeyHandler !== null) {
      window.removeEventListener('keydown', this.bopcaKeyHandler);
      this.bopcaKeyHandler = null;
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
    return !worldHalted(this.overlayClaims) && this.citizenDialog?.isOpen !== true;
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
    this.followerMenu.onSetPassive = () => {
      this.audio?.play('menu_click');
      this.companion.setPassive(this.human.isActive);
    };
  }

  /**
   * True while the companion lies knocked out somewhere in this building — as
   * opposed to having gone down outside before the party came in, which is the
   * case `companionLeftBehind` describes.
   */
  private companionDownIndoors = false;

  /**
   * True when the companion went down outside and was left lying there. They are
   * not in this building at all: they don't follow, don't render, and can't be
   * switched to — only walking back out reaches them.
   */
  private get companionLeftBehind(): boolean {
    return this.inactive().isKnockedOut && !this.companionDownIndoors;
  }

  /** The companion as a render-list fragment — empty when they were left outside. */
  private presentCompanion(): ReturnType<BuildingInteriorScene['inactive']>[] {
    return this.companionLeftBehind ? [] : [this.inactive()];
  }

  /** Hands control to the companion, unless they're lying knocked out — outside or in here. */
  private trySwitchActive(): void {
    // Guarded here rather than only at the keyboard poll, because the mobile HUD
    // reaches this by a different road: a script that is driving both bodies
    // must not have one swapped out from under it by either of them.
    if (this.bigTopMaze?.playerLocked === true) return;
    if (this.inactive().isKnockedOut) {
      this.audio?.play('error');
      return;
    }
    this.audio?.play('menu_change_follower');
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
   * Keeps the left-behind companion's revive deadline running while the player is
   * indoors. Returns true once it has expired, which the overworld turns into a
   * game over as soon as the scene hands control back.
   */
  private tickCompanionLeftBehind(): boolean {
    if (!this.companionLeftBehind) return false;
    const companion = this.inactive();
    companion.isMoving = false;
    companion.knockedOutFrames++;
    return companion.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES;
  }

  /**
   * The same downed-teammate flow the overworld runs, for a companion who drops
   * inside the building: knocked out where they fell, revived by standing over
   * them, and a bleed-out ending the run. This scene used to hand the death
   * straight out the front door instead, which teleported the player outside
   * mid-visit.
   */
  private updateCompanionKnockout(): void {
    if (this.companionLeftBehind) return;
    const inactive = this.inactive();
    // Latched before the state machine flips `isKnockedOut`, so
    // `companionLeftBehind` never mistakes this body for one lying outside.
    if (!inactive.isAlive && !inactive.isKnockedOut) this.companionDownIndoors = true;
    updateKnockoutState({
      active: this.active(),
      inactive,
      inactiveIsHuman: inactive === this.human,
      audio: this.audio,
    });
    if (!inactive.isKnockedOut) {
      this.companionDownIndoors = false;
      return;
    }
    if (inactive.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) this.raiseDeathScreen();
  }

  update(): void {
    // Above the death-screen return: an award earned by the blow that killed the
    // party is still drawn on top of the screen announcing it, and a dialog that
    // is not ticked sits frozen at its first frame with its accept button inert.
    this.menus.update();

    // The death screen accepts through its own focus ring, which reaches
    // `handleClick` — nothing to poll for here.
    if (this.gameOver) return;

    // Ticked on every floor of every building, and the one exception is the
    // return above: a party that is already dead has nothing left to contain.
    const isOnCrystalFloor =
      this.entry.type === 'tower' && this.currentFloor === TOWER_CONFRONTATION_FLOOR;
    this.soulCrystal.update(this.human, this.cat, this.active(), isOnCrystalFloor);
    if (this.soulCrystal.crystalContainedPending) {
      this.soulCrystal.crystalContainedPending = false;
      this.humanAchievements.tryUnlock('doomsday_contained');
      this.catAchievements.tryUnlock('doomsday_contained');
    }

    this.systemNotices.drainFor(this.human, this.cat);
    this.combat.floatingText.updateFor(this.human, this.cat);
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

    const reviveDeadlineExpired = this.tickCompanionLeftBehind();

    // Caught here as well as at the end of `updateCombat`, because a death can
    // arrive from something the frame stops before reaching it — the doomsday
    // countdown ticks above every modal's early return.
    if (!this.active().isAlive) {
      this.raiseDeathScreen();
      return;
    }
    // A companion who bled out on the doorstep while the party was indoors is
    // the overworld's defeat to declare: hand it out and let the scene behind
    // turn it into a game over.
    if (reviveDeadlineExpired) {
      this.doExit();
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
    if (this.exitMenuOpen) return;
    if (this.towerStairs?.menuOpen) return;
    // The three dialogs below advance from the claim registry, on the key event
    // rather than from the held-key set: a polled advance on top of the handler's
    // would turn one press into two pages.
    if (this.bopca?.isDialogOpen === true) {
      // The cook timer has to keep running through the conversation — the dish
      // is meant to land while the player is still reading the order line.
      this.bopca.tick(this.human, this.cat, this.active(), this.inactive());
      return;
    }
    if (this.safeRoom?.mordecaiDialogOpen) {
      this.safeRoom.tickDialog();
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
      this.club.tickOpenModals(this.active());
      return;
    }
    if (this.bigTopMaze?.isDialogOpen === true) {
      // Ticked rather than merely halted, for the same reason the blackjack
      // table and the Bopca's cook timer are: the box is one beat of a script
      // that is holding both crawlers still, and the script is what closes it.
      // A bare `return` here strands the party locked in place forever.
      this.bigTopMaze.update(this.buildSystemContext());
      return;
    }
    if (this.anchorInterior?.isDialogOpen === true) {
      if (this.consumeModalClose()) this.anchorInterior.dismissDialog();
      return;
    }
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
    // Deliberately does not return: the player has to be able to walk while the
    // box is up, because walking off is what dismisses it.
    this.dismissCitizenDialogIfWalkedAway();
    if (this.resolvePendingServiceTalk()) return;
    const conversationOpen = this.citizenDialog?.isOpen === true;
    if (conversationOpen) this.citizenDialog.update();

    // Sleep tick
    if (this.safeRoom?.isSleeping) {
      this.safeRoom.updateSleep(this.human, this.cat);
      this.safeRoom.updateWander();
      this.human.tickTimers();
      this.cat.tickTimers();
      return;
    }

    // Below every gameplay-halting return above — the blackjack table and the
    // service panel each have their own, and the pet must not heal on wall-clock
    // time behind any of them. `DungeonScene` runs its regen inside
    // `updateGameplay`, which the same halts skip.
    if (this.mongoPetState !== undefined && this.mongoPetLevel !== undefined) {
      tickMongoRegen(this.mongoPetState, getMongoStats(this.mongoPetLevel()).maxHp);
    }

    const player = this.active();
    // A cutscene drives both bodies itself. Every input below is withheld for
    // its whole run, movement included, or the player walks Carl out of the
    // scripted walk-up he is halfway through.
    const scriptOwnsParty = this.bigTopMaze?.playerLocked === true;

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

    // Held back mid-conversation to match the street: swapping characters would
    // hand the walk-away check a body standing several tiles back, closing the
    // box on a player who never moved.
    if (
      !conversationOpen &&
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

    // Safe room: sleep / talk to Mordecai. Only consume Space when actually
    // acting, so an unrelated press can still fall through to talking to an
    // ambient occupant sharing the room.
    if (this.bopca !== null && interactPressed() && this.bopca.tryInteract(player)) {
      keybindings.release(this.input, 'attack');
    }

    if (
      interactPressed() &&
      this.currentFloor === TOWER_CONFRONTATION_FLOOR &&
      this.towerConfrontation?.tryExamine(player) === true
    ) {
      keybindings.release(this.input, 'attack');
    }

    if (this.safeRoom && interactPressed()) {
      if (this.safeRoom.isNearBed(player)) {
        keybindings.release(this.input, 'attack');
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        keybindings.release(this.input, 'attack');
        this.talkToMordecai();
      }
    }

    // Store: open the shop when standing at the counter. Closing is the ladder's
    // job, through the same edge-triggered helper every other interior panel
    // uses — the key that opens one is the key that shuts it.
    if (this.shop !== null && interactPressed() && this.shop.isNearShopkeeper(player)) {
      keybindings.release(this.input, 'attack');
      this.shop.shopOpen = true;
      this.beginModalGrace();
    }

    // Club: talk to a station NPC (the Sledge, bar, casino, …) with Space.
    // Only consume when a station actually answered, so a press beside an
    // ambient occupant still reaches the conversation below.
    if (this.club !== null && interactPressed() && this.club.handleInteract(player)) {
      keybindings.release(this.input, 'attack');
    }

    // The tent's one interaction: the potion over the vine. Ahead of the swing
    // below, because the whole point of the room is that a swing is the wrong
    // answer here.
    if (interactPressed() && this.bigTopMaze?.tryInteract(this.buildSystemContext()) === true) {
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

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();
    this.safeRoom?.updateWander();
    this.bopca?.tick(this.human, this.cat, player, this.inactive());
    this.shop?.update();
    this.club?.update(this.active(), this.presentCompanion()[0] ?? null);
    this.occupants?.update();
    this.applyAnchorQuestMarkers();
    this.anchorInterior?.update();
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

  /** The tent's own cues, played from the flags its script sets. */
  private drainMazeAudioCues(): void {
    const maze = this.bigTopMaze;
    const audio = this.audio;
    if (maze === null || audio === null) return;
    if (maze.gateSoundPending) {
      maze.gateSoundPending = false;
      audio.play('gate_opening');
    }
    if (maze.braceSoundPending) {
      maze.braceSoundPending = false;
      audio.play('wood_breaking_1');
    }
    if (maze.ventIgnitionSoundPending) {
      maze.ventIgnitionSoundPending = false;
      audio.play('llama_fireball', { volume: VENT_IGNITION_VOLUME });
    }
    if (maze.burnoutSoundPending) {
      maze.burnoutSoundPending = false;
      // [STAND-IN] The llama's fireball burst is the library's closest thing to
      // a body going up, until a scorch-and-drop cue is sourced.
      audio.play('llama_fireball_explosion');
    }
    if (maze.pourSoundPending) {
      maze.pourSoundPending = false;
      audio.play('healing_potion');
    }
    if (maze.vineGroanSoundPending) {
      maze.vineGroanSoundPending = false;
      audio.play('grimaldi_vine_taking_damage');
    }
    if (maze.cureSoundPending) {
      maze.cureSoundPending = false;
      audio.play('reviving_tone');
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
    };
  }

  private updateCombat(): void {
    const combat = this.combat;
    const ctx = this.buildSystemContext();
    const active = ctx.active;

    const destruction = this.destruction;

    // Ahead of the swings it decides on.
    this.companion.update(ctx);
    if (this.cat.pendingAutoFireSound) {
      this.cat.pendingAutoFireSound = false;
      this.audio?.play('cat_missile_fire', { volume: CAT_MISSILE_VOLUME });
    }

    combat.updatePlayerAttacks();
    combat.updateMobs(ctx);
    this.activeEncounter?.update(ctx);
    // Beside the update that sets it, and ahead of next frame's companion pass:
    // a burnout moves both crawlers itself, but the anchors are the scene's to
    // fix, and an anchored companion still pointing at a corridor walks straight
    // back into the fire that just took them.
    if (this.bigTopMaze?.partyResetPending === true) {
      this.bigTopMaze.partyResetPending = false;
      this.companion.anchorBoth(this.human, this.cat);
      // The party is no longer standing where the offer was made. A burnout can
      // land on the same frame the active crawler steps onto an exit mat — the
      // parked one is what burned — and the menu that opened would then be a
      // question about a doorway two tiles from anybody, stacked over the box
      // explaining why they moved.
      this.exitMenuOpen = false;
    }
    this.drainMazeAudioCues();
    combat.drainMobAudioCues(this.audio);

    combat.resolvePlayerAttacks({ destructibles: destruction.destructibles });
    combat.resolveKills();
    combat.resolveSpellAftermath();
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
    this.skeletonSummons.update(ctx);
    this.skeletonShots.update(ctx);
    this.drainCasterAudioCues();
    destruction.update(ctx);
    if (destruction.drainAudioCues(this.audio)) {
      // A hearth or brazier that has just been smashed is floor now, and the
      // emitters were scanned off the layout before it was — left alone, the
      // fire keeps crackling from bare boards for the rest of the visit.
      this.ambientSound?.setEmitters(this.buildAmbientEmitters());
    }

    if (!active.isAlive) this.raiseDeathScreen();
  }

  /**
   * The cues a caster's shots and summons leave behind.
   *
   * Drained here rather than with the rest of the mob audio because both outlive
   * the caster: a bolt that lands after the thing that fired it died has no mob
   * left to carry the flag, and the rise belongs to the skeletons coming out of
   * the floor rather than to whoever called them.
   */
  private drainCasterAudioCues(): void {
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
  }

  /**
   * The interior's own defeat, whatever killed the party: the quest fight that
   * owns the room if there is one, and otherwise the room itself — a building
   * with a hostile in it can now kill you, and dropping the party back on the
   * doorstep at nought hit points to die again outside is not an ending.
   */
  private raiseDeathScreen(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    // A death arrives from the fight, not from a key or a click, so nothing else
    // here has taken the keyboard off a bag left open behind it.
    this.menus.cancelInventoryDragForOverlay();
    this.combat.deathScreen.activate(this.deathScreenMessage());
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
   * Death inside an encounter: patch both crawlers up and send them back to the
   * level's respawn point rather than the building's doorstep, so a defeat costs
   * the walk back. The fight resets on re-entry.
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
    // Ranked above the death screen, matching both the claim registry and the
    // draw order: the award stack is painted on top of it, so a press aimed at
    // an OK button there must not reach the screen underneath.
    if (this.menus.levelUpDialog.handleClick(mx, my)) return;
    if (this.menus.rewardGrantedDialog.handleClick(mx, my)) return;
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
      this.club.handleClick(mx, my, this.active());
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
    if (this.anchorInterior?.isDialogOpen === true) {
      this.anchorInterior.handleClick(mx, my);
      return;
    }
    if (this.servicePanel?.isOpen === true) {
      this.servicePanel.handleClick(mx, my, this.active());
      return;
    }
    if (this.readingPanel?.isOpen === true) {
      this.readingPanel.handleClick(mx, my, this.active());
      return;
    }
    if (this.readablePanel.handleClick()) {
      return;
    }
    if (this.bopca?.handleClick(mx, my) === true) {
      return;
    }
    // Only the dialog's own box is consumed: a conversation does not halt the
    // world, so the bag can be open underneath it and its slots must stay live.
    if (this.citizenDialog?.handleClick(mx, my) === true) {
      return;
    }

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

  handleMouseDown(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = true;
    // Delegated rather than swallowed: the pause menu's Equipment tab drags gear
    // between the bag and the doll, and a drag is a press and a release, not a
    // click. Every other tab ignores these.
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleMouseDown(mx, my, this.human, this.cat);
      return;
    }
    if (this.isOverlayBlockingPointer) return;
    this.mobileHUD.handleMouseDown(mx, my, this.inventoryPlayer().inventory);
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleMouseMove(mx, my);
      return;
    }
    this.mobileHUD.handleMouseMove(mx, my);
    this.menus.gearPanel.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
    this._mouseDown = false;
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
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    this.onExitCallback(humanSnap, catSnap, defeated);
  }

  /**
   * Hangs the anchor questline's glyph over Hilda or Deacon Aviel.
   *
   * The questline answers `null` for everybody it has no business with, so this
   * can never wipe a marker some other system put on a citizen — a marker is
   * only ever written by whoever claims that citizen.
   */
  private applyAnchorQuestMarkers(): void {
    const quest = this.anchorInterior;
    if (quest === null || this.occupants === null) return;
    for (const person of this.occupants.people) {
      if (person.residentId === null) continue;
      const marker = quest.markerFor(person.residentId);
      if (marker !== null) person.markerType = marker;
    }
  }

  /** The `R` press indoors: Old Hilda's repairs, and nothing else so far. */
  private triggerAnchorRepair(): void {
    this.anchorInterior?.tryRepair(this.active());
  }

  /**
   * Opens a conversation with the nearest ambient occupant in range — or the
   * building's service menu, when that occupant is the one who sells here.
   * Returns whether something opened, so the caller can consume the triggering
   * input. Shared by the desktop Space path and the mobile tap path so occupants
   * are talkable on both.
   *
   * A named resident who also runs the service tells their story first: the
   * lore conversation plays, and `pendingServiceTalk` opens the menu the moment
   * it ends, so a player who came in for a drink is never more than one
   * dismissal from one.
   */
  private tryTalkToOccupant(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    if (this.citizenDialog === null || this.occupants === null) return false;
    const target = this.occupants.findTalkTarget(player.x, player.y);
    if (target === null) return false;
    target.faceToward(player.x, player.y);

    const ctx = this.townDialogContext();
    const inDanger = isTownInDanger(ctx);
    const resident = target.residentId === null ? null : residentById(target.residentId);
    const service = interiorServiceForRole(this.entry.name, target.role);
    const sellsHere = service !== undefined;
    const turn = this.turnFor(target);

    // The anchor questline outranks even a resident's own untold lore — Hilda
    // and Aviel are otherwise still finishing their first-meeting flavor lines
    // (`hasUntoldLore`) for several visits after the quest goes active, and a
    // player who has just been asked to fetch boards or clear rats should not
    // have to sit through small talk to hear the thing they actually came for.
    if (resident !== null && this.anchorInterior?.tryOpenDialog(resident.id, player) === true) {
      this.noteTalk(target, inDanger);
      return true;
    }

    if (sellsHere && !this.hasUntoldLore(target)) {
      this.openService(turn, resident, target.role);
      this.noteTalk(target, inDanger);
      return true;
    }

    const lines =
      resident !== null
        ? buildResidentConversation(resident, turn, ctx)
        : buildCitizenConversation(target.role, target.appearance.seed, turn, ctx);
    this.citizenDialog.open(resident?.name ?? roleDisplayName(target.role), lines);
    // Pinned for the same reason street citizens are: the conversation ends when
    // the *player* walks off, which only holds if the other party stays put.
    target.frozen = true;
    this.citizenDialogTarget = target;
    this.pendingServiceTalk = sellsHere ? { target, turn, role: target.role } : null;
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
   * Opens the service menu queued behind a resident's story as soon as that
   * story is dismissed. `SERVICE_MENU_GRACE_FRAMES` is what stops the press that
   * closed the last page from also closing the menu it just opened.
   *
   * Returns whether it opened one, so `update` can end the frame there rather
   * than running movement and exit-tile detection behind a modal that is now up.
   */
  private resolvePendingServiceTalk(): boolean {
    const queued = this.pendingServiceTalk;
    if (queued === null) return false;
    if (this.citizenDialog?.isOpen === true) return false;

    const target = queued.target;
    this.pendingServiceTalk = null;
    // Re-checked rather than assumed: the story can be dismissed on one side of
    // the room and the key released on the other, and a counter you have walked
    // away from should not throw its menu at you.
    const player = this.active();
    const distance = Math.hypot(player.x - target.x, player.y - target.y);
    if (distance > TILE_SIZE * CONVERSATION_WALK_AWAY_TILES) return false;

    const resident = target.residentId === null ? null : residentById(target.residentId);
    this.openService(queued.turn, resident, queued.role);
    return true;
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

  /** Ends an occupant conversation once the player has plainly walked off. */
  private dismissCitizenDialogIfWalkedAway(): void {
    const target = this.citizenDialogTarget;
    if (target === null) return;
    if (this.citizenDialog?.isOpen !== true) {
      this.releaseCitizenDialogTarget();
      return;
    }
    const player = this.active();
    const distance = Math.hypot(player.x - target.x, player.y - target.y);
    if (distance > TILE_SIZE * CONVERSATION_WALK_AWAY_TILES) {
      this.citizenDialog.close();
      // Walking out mid-story is a refusal, not a queue: the shop must not
      // ambush a player who left the counter.
      this.pendingServiceTalk = null;
      this.releaseCitizenDialogTarget();
    }
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
    // The anchor questline gets the counter first, exactly as it gets Madame
    // Voss's Consult prompt first out on the plaza: while it has something to
    // say, Hilda reads no cards and Aviel sells no blessings.
    if (
      resident !== null &&
      this.anchorInterior?.tryOpenDialog(resident.id, this.active()) === true
    ) {
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
        panel.open(() => buildArmouryMenu(turn, host), confirmed(issueArmour, never));
        return;
      case 'Herb & Remedy':
        panel.open(
          () => buildApothecaryMenu(party, this.townMemory, turn, host),
          confirmed(serveRemedy(party, this.townMemory), never),
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
        );
        return;
      case "Miller's Farm":
        panel.open(
          () => buildMillerMenu(this.active(), turn, host),
          confirmed(serveMillerGoods(turn), never),
        );
        return;
      case "Shepherd's Cabin":
        panel.open(
          () => buildShepherdMenu(party, turn, host),
          confirmed(serveShepherdRest(party, turn), never),
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
  private talkToMordecai(): void {
    if (this.safeRoom === null) return;

    const pages = this.mordecaiAdvisor.nextAdvice(this.circusAdviceSnapshot());
    if (pages !== null) {
      this.safeRoom.openMordecaiPages(pages);
      return;
    }

    const humanEvents = this.humanAchievements.getTopRecentEvents(RECENT_EVENTS_LIMIT);
    const catEvents = this.catAchievements.getTopRecentEvents(RECENT_EVENTS_LIMIT);
    const merged = [...humanEvents, ...catEvents]
      .sort((a, b) => a.secondsAgo - b.secondsAgo)
      .slice(0, RECENT_EVENTS_LIMIT);
    this.safeRoom.openMordecaiDialog(
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
   * Floats one interact prompt over whatever the next press would reach: the
   * nearest occupant, or — when nobody is in range — whatever there is to read.
   * One prompt at a time, because two hovering key-caps in a small room read as
   * a bug rather than as two options.
   */
  private renderCitizenPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.citizenDialog?.isOpen === true) return;
    if (worldHalted(this.overlayClaims)) return;
    const active = this.active();
    const target =
      this.citizenDialog === null
        ? null
        : (this.occupants?.findTalkTarget(active.x, active.y) ?? null);
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
    if (page === null) return;
    drawInteractionPrompt(ctx, page.x - camX, page.y - camY, TILE_SIZE, READ_PROMPT_LABEL);
  }

  /**
   * Opens whatever is in reach to read. Returns whether something opened, so
   * the caller can consume the triggering input.
   */
  private tryReadNearby(player: ReturnType<BuildingInteriorScene['active']>): boolean {
    if (this.readables === null || this.readablePanel.isOpen) return false;
    if (this.citizenDialog?.isOpen === true) return false;
    const page = this.readables.findReadTarget(player.x, player.y);
    if (page === null) return false;
    this.readablePanel.openWith(page.readable);
    this.beginModalGrace();
    this.audio?.play('menu_open');
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
    return this.turnFor(target) < residentById(target.residentId).lore.length;
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
    combat.renderGround(ctx, camX, camY);
    // Under the figures: the highlight rings sit on the floor around the broken
    // furniture, and a crawler standing at one must not be drawn beneath it.
    this.anchorInterior?.renderObjects(ctx, camX, camY, this.active());
    this.activeEncounter?.renderWorld?.(ctx, camX, camY, this.active());
    this.renderSortedEntities(ctx, camX, camY, [
      // The same test the dungeon's render pass uses: a corpse that still draws
      // keeps its place in the sort until it expires.
      ...this.world.roster.mobs.filter((mob) => mob.belongsInMobGrid),
      ...this.presentCompanion(),
      this.active(),
      ...(this.occupants?.people ?? []),
      ...safeRoomFigures,
      ...(this.club?.sortedRenderables() ?? []),
    ]);
    combat.renderEffects(ctx, camX, camY, this.cat);
    // Over the creatures, so a shot never disappears behind the one it passes.
    this.skeletonShots.render(ctx, camX, camY);
    destruction.renderEffects(ctx, camX, camY, this.human);
    // Over the crawlers, so a column standing between the camera and one of them
    // still reads as fire they are inside rather than fire they are behind.
    this.bigTopMaze?.renderEffects(ctx, camX, camY);
    this.bigTopMaze?.renderPrompts(ctx, camX, camY, this.buildSystemContext());
    destruction.renderLoot(ctx, camX, camY, this.active());
    // A room hosting a live fight is not offering conversation.
    if (this.activeEncounter === null) this.renderCitizenPrompt(ctx, camX, camY);

    combat.floatingText.render(ctx, camX, camY);
    this.chat.renderBubble(ctx, camX, camY);

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

    this.renderHUD(ctx);

    if (!this.gameOver && !this.pauseMenu.isOpen && this.companionDownIndoors) {
      renderKnockedOutUI(
        ctx,
        camX,
        camY,
        this.active(),
        this.inactive(),
        this.mobileHUD.miniMapSize,
      );
    }

    // Interior label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, viewportWidth(), INTERIOR_LABEL_BAR_HEIGHT);
    const floorSuffix = this.towerFloors.length > 0 ? ` (${FLOOR_LABELS[this.currentFloor]})` : '';
    drawText(ctx, `Inside: ${this.entry.name}${floorSuffix}`, {
      x: viewportWidth() / 2,
      y: 8,
      size: 13,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    // Minimap + right-side buttons (pause, gear, bag)
    if (!this.exitMenuOpen && !this.pauseMenu.isOpen) {
      const mmSize = this.mobileHUD.renderInteriorMiniMap(
        ctx,
        this.map,
        this.active(),
        this.inactive(),
      );
      const pauseY = INTERIOR_TOP_MARGIN + mmSize + MM_TO_PAUSE_BTN_SPACING;
      this.mobileHUD.renderPauseButton(ctx, pauseY);
      const gearY = pauseY + GEAR_BTN_SPACING;

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
      this.mobileHUD.renderPanels(
        ctx,
        invPlayer.inventory,
        invName,
        invPlayer.coins,
        this.menus.inventoryWieldedWeaponId(),
      );
      if (platform.isMobile) {
        // Hidden rather than merely inert where the room refuses the command:
        // a button that answers every press with an error sound is a control the
        // player keeps trying.
        const extraButtons: MobileHUDButton[] = this.followDisabled
          ? []
          : [
              {
                id: 'follow',
                icon: '↩',
                label: 'Follow',
                active: this.companion.getMovementMode(this.human.isActive) === 'anchored',
              },
            ];
        this.mobileHUD.renderButtons(
          ctx,
          this.human.isActive,
          extraButtons,
          MOBILE_BUTTONS_EXTRA_Y,
          gearY,
        );
      }
    }

    if (this.safeRoom) {
      this.safeRoom.renderUI(
        ctx,
        camX,
        camY,
        this.active(),
        this.bopca?.hasInteraction(this.active()) === true,
      );
      if (this.safeRoom.mordecaiDialogOpen) this.safeRoom.renderMordecaiDialog(ctx);
      if (this.safeRoom.isSleeping) this.safeRoom.renderSleepOverlay(ctx);
    }

    if (this.bopca !== null) {
      this.bopca.renderUI(ctx, camX, camY, this.active());
      this.bopca.renderDialog(ctx);
    }

    if (this.shop) {
      this.shop.renderUI(ctx, this.active());
      this.shop.renderShopPanel(ctx, this.active());
    }

    if (this.club) {
      this.club.renderUI(ctx, this.active());
    }

    this.citizenDialog?.render(ctx);
    this.servicePanel?.render(ctx, this.active());
    this.readingPanel?.render(ctx, this.active());
    this.readablePanel.render(ctx);
    // Last of this group, because it outranks all three above it in
    // `overlayClaims` and the focus ring goes to whoever declares it last. They
    // are mutually exclusive in practice — the questline takes the counter
    // before either service surface opens — but the two orders still have to
    // agree, or the audit is measuring a coincidence.
    this.anchorInterior?.renderUI(ctx);

    this.activeEncounter?.renderUI(ctx);
    this.soulCrystal.renderUI(ctx);

    // The doormat draws over the stairs, not under them: `handleClick` answers
    // the exit menu first, and the focus ring goes to whichever declares last,
    // so drawing them the other way round would hand the keyboard to the stair
    // menu while the mouse still drove the exit menu.
    if (this.towerStairs?.menuOpen) this.towerStairs.renderMenu(ctx);
    if (this.exitMenuOpen) this.renderExitMenu(ctx);

    this.destruction.dynamite.renderChargeBar(ctx, viewportWidth(), viewportHeight());
    this.menus.hotbarToast.render(ctx, this.mobileHUD.inventoryPanel.hotbarBandHeight());

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
    if (this.gameOver) this.combat.deathScreen.render(ctx);
    this.menus.renderOverlays(ctx);
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
        // The Equipment tab is the one halting surface a finger can drag across
        // rather than only tap, so it takes the press now and the release from
        // the drag branch in `handleTouchEnd`, which already ends with a click.
        if (this.pauseMenu.isOpen && this.pauseMenu.currentTab === 'equipment') {
          this.handleMouseDown(x, y);
          this.mobileHUD.inventoryDragTouchId ??= touch.identifier;
          continue;
        }
        this.handleClick(x, y);
        continue;
      }

      // HUD collapse/expand toggle (mobile only)
      if (platform.isMobile) {
        const ht = this._hudToggleRect;
        if (pointInRect(x, y, ht)) {
          this._hudCollapsed = !this._hudCollapsed;
          continue;
        }
        // The skill badge sits under the HUD bar on mobile, where there is no
        // banner to click — tapping it is the only route to the Spend screen.
        if (this.menus.tryOpenSpendScreen(x, y, this._hudSkillBannerRect)) continue;
      }

      // Mobile button hit-test (Switch, Gear, Bag, Pause, Minimap, Follow)
      if (platform.isMobile) {
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
      if (hi >= 0) {
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
        if (hi >= 0 && !this.isOverlayBlockingPointer && !this.pauseMenu.isOpen) {
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
          const dialogWasOpen =
            this.citizenDialog?.isOpen === true ||
            this.servicePanel?.isOpen === true ||
            this.readingPanel?.isOpen === true ||
            this.readablePanel.isOpen;
          const bopcaWasOpen = this.bopca?.isDialogOpen === true;
          // A tap whose finger went down before an award overlay appeared still
          // arrives here. `handleClick` routes it to the overlay; the
          // space-equivalents must not also fire while the game is paused.
          const overlayClaimedTap = this.isOverlayBlockingPointer;
          this.handleClick(x, y);
          if (!overlayClaimedTap) {
            this.triggerTapInteractions(dialogWasOpen, bopcaWasOpen, x, y);
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
   * @param dialogWasOpen Whether a citizen dialog or service panel was already
   *   up before `handleClick` ran — that call would have advanced or closed it,
   *   and reopening one in the same tap is the close-then-reopen trap.
   * @param bopcaWasOpen The same guard for the Bopca's own conversation.
   * @param tapScreenX Where the finger landed, so a swing that reaches nothing
   *   to interact with is still aimed the way the player pointed it.
   * @param tapScreenY See `tapScreenX`.
   */
  private triggerTapInteractions(
    dialogWasOpen: boolean,
    bopcaWasOpen: boolean,
    tapScreenX: number,
    tapScreenY: number,
  ): void {
    // A finger that went down on open ground can come up after something has
    // taken the screen — the release belongs to whatever that is, and `update`
    // is not running the world underneath it anyway.
    if (worldHalted(this.overlayClaims)) return;
    // The keyboard's swing is withheld for the whole cure sequence; the tap has
    // to be too, or a stray finger spins Carl round mid-scripted walk-up and
    // swings at the vine he is there to save.
    if (this.bigTopMaze?.playerLocked === true) return;
    if (this.bopca !== null && !bopcaWasOpen) {
      this.bopca.tryInteract(this.active());
    }
    if (this.safeRoom) {
      const player = this.active();
      if (this.safeRoom.isNearBed(player)) {
        this.safeRoom.startSleep();
      } else if (this.safeRoom.isNearMordecai(player)) {
        this.talkToMordecai();
      }
    }
    if (this.shop?.isNearShopkeeper(this.active()) === true) {
      this.shop.shopOpen = true;
      this.beginModalGrace();
    }
    if (this.currentFloor === TOWER_CONFRONTATION_FLOOR) {
      this.towerConfrontation?.tryExamine(this.active());
    }
    this.club?.handleInteract(this.active());
    // Talk to a nearby occupant only when nothing else claimed the tap: no
    // shop/club panel is up (the store has both a shop and shelf-browsers), and
    // the safe room didn't just sleep or open Mordecai (that building has both
    // Mordecai/bed and ambient occupants within one tap's reach).
    if (
      !dialogWasOpen &&
      this.shop?.shopOpen !== true &&
      this.club?.modalOpen !== true &&
      this.safeRoom?.isSleeping !== true &&
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
      if (!repaired && !poured && !this.tryTalkToOccupant(active) && !this.tryReadNearby(active)) {
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
